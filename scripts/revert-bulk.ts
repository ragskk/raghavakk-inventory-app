/**
 * Revert a bulk update from its pre-write snapshot.
 *
 * Every /api/artworks/bulk call now writes a JSON snapshot of the
 * affected rows' prior state to `backups/bulk/<ts>-<count>rows.json` in
 * the data repo BEFORE applying the patch. This script reads that file
 * back and restores every row to that prior state in a single commit.
 *
 * Usage
 * -----
 *   GITHUB_TOKEN=<pat> npx tsx scripts/revert-bulk.ts                  # list
 *   GITHUB_TOKEN=<pat> npx tsx scripts/revert-bulk.ts --latest         # last
 *   GITHUB_TOKEN=<pat> npx tsx scripts/revert-bulk.ts --path=<path>    # exact
 *
 * Listing shows the 20 most-recent snapshots with timestamp, row count,
 * patch summary, and operator email so you can identify which to revert.
 *
 * The revert is itself a runDbWrite — one Octokit commit, idempotent on
 * OCC retry. It does NOT delete the snapshot file (those are an audit
 * trail; prune them manually if the repo gets noisy).
 */

import {
  listDataRepoDir,
  readDataRepoFile,
} from "../lib/db";
import { revertBulkFromSnapshot } from "../lib/inventory";

interface SnapshotHeader {
  version?: number;
  kind?: string;
  ts?: string;
  actor?: string | null;
  patch?: Record<string, unknown>;
  rows?: { id: number }[];
}

function shortPatchSummary(patch: Record<string, unknown> | undefined): string {
  if (!patch) return "(no patch)";
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return "(empty patch)";
  return keys
    .map((k) => `${k}=${JSON.stringify(patch[k])}`)
    .join(" ");
}

async function listSnapshots(): Promise<{ name: string; path: string }[]> {
  const files = await listDataRepoDir("backups/bulk");
  return files
    .filter((f) => f.name.endsWith(".json"))
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // reverse-chrono
}

async function describe(path: string): Promise<SnapshotHeader | null> {
  const bytes = await readDataRepoFile(path);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pathArg = args.find((a) => a.startsWith("--path="));
  const wantLatest = args.includes("--latest");

  if (!pathArg && !wantLatest) {
    const snaps = await listSnapshots();
    if (snaps.length === 0) {
      console.log("No bulk snapshots found under backups/bulk/.");
      return;
    }
    console.log(`Most recent bulk snapshots (newest first):\n`);
    const top = snaps.slice(0, 20);
    for (const s of top) {
      const header = await describe(s.path);
      const ts = header?.ts ?? "?";
      const actor = header?.actor ?? "?";
      const rowCount = header?.rows?.length ?? "?";
      console.log(`  ${s.name}`);
      console.log(`      ts:     ${ts}`);
      console.log(`      actor:  ${actor}`);
      console.log(`      rows:   ${rowCount}`);
      console.log(`      patch:  ${shortPatchSummary(header?.patch)}`);
      console.log("");
    }
    console.log(
      `To revert one of these, re-run with --path=backups/bulk/<filename> or --latest.`
    );
    return;
  }

  let targetPath: string;
  if (pathArg) {
    targetPath = pathArg.slice("--path=".length);
  } else {
    const snaps = await listSnapshots();
    if (snaps.length === 0) throw new Error("no snapshots to revert");
    targetPath = snaps[0].path;
  }

  console.log(`Reverting from ${targetPath}…`);
  const result = await revertBulkFromSnapshot(targetPath);
  console.log(
    `Restored ${result.restored_ids.length} row(s). ` +
      `Missing (already gone): ${result.missing_ids.length}.`
  );
  if (result.missing_ids.length > 0) {
    console.log(`  Missing ids: ${result.missing_ids.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
