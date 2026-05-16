import { Octokit } from "@octokit/rest";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import path from "node:path";
import fs from "node:fs";

/**
 * SQLite-over-Octokit storage layer — inventory app.
 *
 * Mirrors the pattern shipped in `raghavakk-campaign-app/lib/db.ts`
 * (2026-05-14). Same OCC retry loop, same warm-instance read cache, same
 * race-safe bootstrap, same idempotent migrations.
 *
 * Three deliberate divergences from the campaign-app copy:
 *
 *   1. DB filename is `inventory.sqlite`, repo is
 *      `ragskk/raghavakk-inventory-data`. Different blob, different repo.
 *
 *   2. SCHEMA_DDL is NOT inlined in this file. It is read from
 *      `./schema.sql` at module init via `fs.readFileSync`. The 19-table
 *      relational schema lives in version control as a SQL file (the
 *      canonical source of truth) and `next.config.mjs` traces it into
 *      the serverless function bundle. Migrations remain
 *      `CREATE … IF NOT EXISTS` so re-running on every open is free.
 *
 *   3. PRAGMA foreign_keys is enabled at every open. Campaign-app has no
 *      relational integrity; inventory does. ON DELETE CASCADE on artwork
 *      images / history rows is only honored when this is set.
 *
 * See `INVENTORY_APP_NOTES.md` and `ROADMAP.md` at the repo root for the
 * full architectural rationale. This file is intentionally low-level
 * plumbing; query helpers belong in `lib/inventory.ts`.
 */

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export function useDb(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

// ---------------------------------------------------------------------------
// Octokit client
// ---------------------------------------------------------------------------

const OWNER = process.env.INVENTORY_DATA_OWNER || "ragskk";
const REPO = process.env.INVENTORY_DATA_REPO || "raghavakk-inventory-data";
const BRANCH = process.env.INVENTORY_DATA_BRANCH || "main";
const DB_PATH = "inventory.sqlite";

let octokitInstance: Octokit | null = null;

function getOctokit(): Octokit {
  if (octokitInstance) return octokitInstance;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN not set — sqlite/Octokit backend requires a fine-grained PAT"
    );
  }
  octokitInstance = new Octokit({ auth: token });
  return octokitInstance;
}

// ---------------------------------------------------------------------------
// sql.js initialization
// ---------------------------------------------------------------------------

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJsPromise) return sqlJsPromise;
  // Vercel functions run on Node. By default sql.js looks for `sql-wasm.wasm`
  // next to its own JS, which works in dev but Vercel's file-trace bundler
  // doesn't always include it. We point it at the absolute node_modules path
  // and pair this with `outputFileTracingIncludes` in next.config.mjs so the
  // .wasm gets bundled into the function.
  sqlJsPromise = initSqlJs({
    locateFile: (file: string) =>
      path.join(process.cwd(), "node_modules/sql.js/dist/", file)
  });
  return sqlJsPromise;
}

// ---------------------------------------------------------------------------
// Schema — read from disk at module init
// ---------------------------------------------------------------------------

/**
 * The schema lives at the repo root as `schema.sql`. Reading it at module
 * init (rather than at every hydrate) keeps the file I/O off the hot path.
 * `next.config.mjs` lists `./schema.sql` in `outputFileTracingIncludes` so
 * Vercel's file-trace bundler ships it into the function.
 */
const SCHEMA_DDL: string = (() => {
  const p = path.join(process.cwd(), "schema.sql");
  return fs.readFileSync(p, "utf-8");
})();

// ---------------------------------------------------------------------------
// DB cache (per warm function instance)
// ---------------------------------------------------------------------------

interface DbSnapshot {
  bytes: Uint8Array;
  sha: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5_000; // warm-instance reuse window
let cached: DbSnapshot | null = null;

// ---------------------------------------------------------------------------
// Fetch from GitHub
// ---------------------------------------------------------------------------

async function fetchDbFromGithub(): Promise<DbSnapshot | null> {
  const ok = getOctokit();
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: DB_PATH,
      ref: BRANCH
    });
    if (Array.isArray(res.data)) {
      throw new Error(`Expected file at ${DB_PATH}, got directory`);
    }
    const data = res.data as {
      type: string;
      content?: string;
      encoding?: string;
      sha: string;
    };
    if (data.type !== "file" || !data.content) {
      throw new Error(`Expected file at ${DB_PATH}, got ${data.type}`);
    }
    const bytes = Buffer.from(data.content, "base64");
    return {
      bytes: new Uint8Array(bytes),
      sha: data.sha,
      fetchedAt: Date.now()
    };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    throw err;
  }
}

async function commitDbToGithub(
  bytes: Uint8Array,
  expectedSha: string | null,
  message: string
): Promise<string> {
  const ok = getOctokit();
  const content = Buffer.from(bytes).toString("base64");
  const params: Parameters<typeof ok.repos.createOrUpdateFileContents>[0] = {
    owner: OWNER,
    repo: REPO,
    path: DB_PATH,
    message,
    content,
    branch: BRANCH
  };
  if (expectedSha) params.sha = expectedSha;
  const res = await ok.repos.createOrUpdateFileContents(params);
  const newSha = res.data.content?.sha;
  if (!newSha) throw new Error("commit succeeded but response had no sha");
  return newSha;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrapEmptyDb(SQL: SqlJsStatic): Promise<Uint8Array> {
  const db = new SQL.Database();
  // PRAGMA foreign_keys is set on every Database open (see applyMigrations);
  // the bootstrap session also runs it so the schema's FK constraints are
  // honored if any seed inserts ever live in SCHEMA_DDL.
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_DDL);
  const bytes = db.export();
  db.close();
  return bytes;
}

/**
 * Race-safe bootstrap: fetch the file; if 404, try to create it. If two
 * function instances cold-start at the same time, one will succeed and the
 * other will get a 409/422 "reference already exists" — in that case we
 * re-fetch (the file now exists) and use what was created.
 */
async function fetchOrBootstrap(): Promise<DbSnapshot> {
  const SQL = await loadSqlJs();
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = await fetchDbFromGithub();
    if (snap) return snap;
    const bytes = await bootstrapEmptyDb(SQL);
    try {
      const sha = await commitDbToGithub(
        bytes,
        null,
        "bootstrap: inventory.sqlite with empty schema"
      );
      return { bytes, sha, fetchedAt: Date.now() };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = (err as { message?: string })?.message || "";
      if (status === 409 || status === 422 || message.includes("already exists")) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("fetchOrBootstrap: exhausted 3 attempts");
}

// ---------------------------------------------------------------------------
// Hydrate + migrate
// ---------------------------------------------------------------------------

/**
 * Apply schema DDL to an in-memory database. Idempotent — every statement
 * is CREATE TABLE/INDEX IF NOT EXISTS plus INSERT OR IGNORE for meta seeds.
 * Cheap to run on every hydrate, and doubles as the migration path: when
 * tables are added to `schema.sql`, existing sqlite files pick them up on
 * the next open without a manual migration step.
 *
 * For destructive migrations (DROP, ALTER), add an explicit step gated by
 * `meta.schema_version` — see ROADMAP.md "Cross-cutting constraints".
 */
function applyMigrations(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_DDL);
}

/**
 * Open the db for a read operation. Uses cache if fresh; otherwise fetches
 * from GitHub. Caller MUST call .close() when done with the Database object.
 */
export async function openDbForRead(): Promise<{
  db: Database;
  sha: string | null;
}> {
  const SQL = await loadSqlJs();
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    const db = new SQL.Database(cached.bytes);
    applyMigrations(db);
    return { db, sha: cached.sha };
  }
  const snap = await fetchOrBootstrap();
  cached = snap;
  const db = new SQL.Database(snap.bytes);
  applyMigrations(db);
  return { db, sha: snap.sha };
}

/**
 * Run a write transaction. The callback receives a hydrated Database; any
 * mutations are persisted via commit. Optimistic concurrency: on 409 we
 * re-fetch, re-run the callback, retry up to 3 times.
 *
 * The callback MUST NOT close the db itself — this wrapper handles it.
 *
 * IMPORTANT: writes must be idempotent across retries. The callback may
 * run multiple times if there's a conflict. Don't use it for ops that
 * depend on the previous state having a specific shape (e.g. "increment
 * counter by reading current value then writing back" — that's racy).
 * For counter increments (e.g. series.next_seq), use SQL
 *   UPDATE series SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq
 * inside the callback, NOT a JS read-modify-write.
 */
export async function runDbWrite<T>(
  callback: (db: Database) => T | Promise<T>,
  commitMessage: string,
  maxRetries = 3
): Promise<T> {
  const SQL = await loadSqlJs();
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Always fetch fresh for writes — cache is for reads only.
    const snap = await fetchOrBootstrap();

    const db = new SQL.Database(snap.bytes);
    applyMigrations(db);
    let result: T;
    try {
      result = await callback(db);
    } catch (err) {
      db.close();
      throw err;
    }
    const newBytes = db.export();
    db.close();

    try {
      const newSha = await commitDbToGithub(newBytes, snap.sha, commitMessage);
      cached = { bytes: newBytes, sha: newSha, fetchedAt: Date.now() };
      return result;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 409 || status === 422) {
        lastErr = err;
        cached = null;
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `runDbWrite: exhausted ${maxRetries} retries due to concurrent writes; last error: ${String(lastErr)}`
  );
}

/**
 * Drop the cache. Useful in tests or after manual edits to the data repo.
 */
export function invalidateDbCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Data-repo file helpers (non-DB blobs: backups, manifests, etc.)
// ---------------------------------------------------------------------------

/**
 * Write an arbitrary file to the data repo. Used for pre-bulk snapshots
 * (lib/inventory.ts bulkUpdateArtworks) and any other audit artefact that
 * lives alongside the sqlite blob.
 *
 * Path is repo-relative ("backups/bulk/2026-05-17T12-34-56Z.json"). If
 * the file already exists at that path, the write overwrites in place —
 * callers should choose unique paths (timestamps) when they want a new
 * audit entry.
 *
 * Returns the resulting content sha.
 */
export async function writeDataRepoFile(
  path: string,
  bytes: Uint8Array,
  message: string
): Promise<string> {
  const ok = getOctokit();
  let existingSha: string | undefined;
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH
    });
    if (!Array.isArray(res.data) && "sha" in res.data) {
      existingSha = (res.data as { sha: string }).sha;
    }
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) throw err;
  }
  const params: Parameters<typeof ok.repos.createOrUpdateFileContents>[0] = {
    owner: OWNER,
    repo: REPO,
    path,
    message,
    content: Buffer.from(bytes).toString("base64"),
    branch: BRANCH
  };
  if (existingSha) params.sha = existingSha;
  const res = await ok.repos.createOrUpdateFileContents(params);
  const sha = res.data.content?.sha;
  if (!sha) throw new Error("writeDataRepoFile: commit succeeded but no sha");
  return sha;
}

/**
 * Read an arbitrary file from the data repo. Returns null on 404.
 */
export async function readDataRepoFile(
  path: string
): Promise<Uint8Array | null> {
  const ok = getOctokit();
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH
    });
    if (Array.isArray(res.data)) return null;
    const data = res.data as { type: string; content?: string };
    if (data.type !== "file" || !data.content) return null;
    return new Uint8Array(Buffer.from(data.content, "base64"));
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * List files in a directory of the data repo (one level deep). Used by
 * the revert script to enumerate available snapshots.
 */
export async function listDataRepoDir(
  path: string
): Promise<{ name: string; path: string; sha: string; size: number }[]> {
  const ok = getOctokit();
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH
    });
    if (!Array.isArray(res.data)) return [];
    return res.data
      .filter((e) => e.type === "file")
      .map((e) => ({ name: e.name, path: e.path, sha: e.sha, size: e.size }));
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return [];
    throw err;
  }
}
