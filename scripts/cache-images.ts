/**
 * Image-blob backfill — inventory app.
 *
 * Walks every row in `artwork_images` that has a `source_url`, fetches
 * each variant (thumb / hero / label), re-encodes with the color-fidelity
 * guarantees baked in, and commits to `ragskk/raghavakk-inventory-data`
 * at `images/<artwork_id>/<variant>.jpg`.
 *
 * Usage:
 *   GITHUB_TOKEN=<pat> npx tsx scripts/cache-images.ts
 *   GITHUB_TOKEN=<pat> npx tsx scripts/cache-images.ts --force
 *   GITHUB_TOKEN=<pat> npx tsx scripts/cache-images.ts --only=12,17,42
 *   GITHUB_TOKEN=<pat> npx tsx scripts/cache-images.ts --variant=label
 *
 * Auth: a GITHUB_TOKEN PAT with contents:write on the inventory-data repo.
 *
 * Idempotency: by default, skips (artwork_id, variant) pairs that are
 * already present in the data repo. Pass --force to overwrite. Each
 * commit is one variant of one artwork — small diffs, easy to revert.
 *
 * Color fidelity (DO NOT regress this):
 *   - withMetadata() → preserves ICC color profile + EXIF orientation
 *   - chromaSubsampling "4:4:4" → never 4:2:0
 *
 * 4:2:0 halves color resolution; stripping ICC makes the browser assume
 * sRGB and shifts AdobeRGB / ProPhoto source images darker + saturated.
 * Both regressions were observed in campaign-app and corrected
 * 2026-05-15. Same constraint applies here.
 *
 * Compression ladder kicks in only above 10 MB:
 *   q98 → q92 → q85 → q78. Stops at the first step under the budget. If
 *   none fit, the smallest produced is committed with a warning. For
 *   typical lh3 widths (=w400/=w1200/=w2000) the ladder rarely runs.
 */

import { Octokit } from "@octokit/rest";
import sharp from "sharp";
import { openDbForRead } from "../lib/db";

const MAX_BYTES = 10 * 1024 * 1024;

const LADDER: { label: string; quality: number }[] = [
  { label: "mozjpeg q98 4:4:4 +ICC", quality: 98 },
  { label: "mozjpeg q92 4:4:4 +ICC", quality: 92 },
  { label: "mozjpeg q85 4:4:4 +ICC", quality: 85 },
  { label: "mozjpeg q78 4:4:4 +ICC", quality: 78 }
];

async function compressIfOversized(
  bytes: Uint8Array,
  label: string
): Promise<Uint8Array> {
  if (bytes.length <= MAX_BYTES) return bytes;
  let best: Uint8Array = bytes;
  for (const step of LADDER) {
    const out = await sharp(bytes)
      .withMetadata()
      .jpeg({ mozjpeg: true, quality: step.quality, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const u8 = new Uint8Array(out);
    if (u8.length < best.length) best = u8;
    console.log(
      `    compress: ${label} ${step.label} → ${u8.length} bytes (was ${bytes.length})`
    );
    if (u8.length <= MAX_BYTES) return u8;
  }
  console.warn(
    `    compress: ${label} still ${best.length} bytes after full ladder — saving best`
  );
  return best;
}

const OWNER = process.env.INVENTORY_DATA_OWNER || "ragskk";
const REPO = process.env.INVENTORY_DATA_REPO || "raghavakk-inventory-data";
const BRANCH = process.env.INVENTORY_DATA_BRANCH || "main";

const VARIANTS: { name: string; width: number }[] = [
  { name: "thumb", width: 400 },
  { name: "label", width: 1200 },
  { name: "hero", width: 2000 }
];

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  return new Octokit({ auth: token });
}

async function getExistingSha(
  ok: Octokit,
  path: string
): Promise<string | null> {
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
      ref: BRANCH
    });
    if (Array.isArray(res.data)) return null;
    return (res.data as { sha: string }).sha;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    throw err;
  }
}

async function commitFile(
  ok: Octokit,
  path: string,
  bytes: Uint8Array,
  existingSha: string | null,
  message: string
): Promise<void> {
  await ok.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path,
    message,
    content: Buffer.from(bytes).toString("base64"),
    branch: BRANCH,
    sha: existingSha || undefined
  });
}

async function fetchVariant(
  sourceUrl: string,
  width: number
): Promise<Uint8Array> {
  const url = /lh3\.googleusercontent\.com/i.test(sourceUrl)
    ? sourceUrl.replace(/=w\d+(-h\d+)?$/, "") + `=w${width}`
    : sourceUrl;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

interface TargetRow {
  artwork_id: number;
  source_url: string;
}

async function loadTargets(onlyIds: Set<number> | null): Promise<TargetRow[]> {
  // Pick the resolved primary image per artwork. Falls back to the first
  // 'main' image, then any image — mirrors the resolution order used by
  // /api/work-image so the backfill caches what the route would serve.
  const { db } = await openDbForRead();
  try {
    const res = db.exec(`
      WITH ranked AS (
        SELECT
          ai.artwork_id,
          ai.source_url,
          ROW_NUMBER() OVER (
            PARTITION BY ai.artwork_id
            ORDER BY
              (a.primary_image_id = ai.id) DESC,
              (ai.image_type = 'main') DESC,
              ai.display_order ASC,
              ai.id ASC
          ) AS rn
        FROM artwork_images ai
        JOIN artworks a ON a.id = ai.artwork_id
        WHERE ai.source_url IS NOT NULL
          AND length(ai.source_url) > 0
      )
      SELECT artwork_id, source_url FROM ranked WHERE rn = 1
    `);
    const rows = res?.[0]?.values || [];
    const out: TargetRow[] = [];
    for (const row of rows) {
      const id = Number(row[0]);
      const url = String(row[1] || "");
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      if (onlyIds && !onlyIds.has(id)) continue;
      out.push({ artwork_id: id, source_url: url });
    }
    return out;
  } finally {
    db.close();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has("--force");
  const onlyFlag = [...args].find((a) => a.startsWith("--only="));
  const variantFlag = [...args].find((a) => a.startsWith("--variant="));
  const onlyIds = onlyFlag
    ? new Set(
        onlyFlag
          .slice("--only=".length)
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    : null;
  const variantFilter = variantFlag ? variantFlag.slice("--variant=".length) : null;
  const targets = await loadTargets(onlyIds);
  const variants = variantFilter
    ? VARIANTS.filter((v) => v.name === variantFilter)
    : VARIANTS;

  if (variantFilter && variants.length === 0) {
    throw new Error(
      `--variant=${variantFilter} unknown. Expected one of: ${VARIANTS.map((v) => v.name).join(", ")}`
    );
  }

  console.log(
    `backfill: ${targets.length} artworks × ${variants.length} variants` +
      (force ? " (force)" : "") +
      (onlyIds ? ` (filtered to ${onlyIds.size} ids)` : "")
  );

  const ok = getOctokit();
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    for (const v of variants) {
      const path = `images/${t.artwork_id}/${v.name}.jpg`;
      try {
        const existing = await getExistingSha(ok, path);
        if (existing && !force) {
          skipped++;
          continue;
        }
        const raw = await fetchVariant(t.source_url, v.width);
        const bytes = await compressIfOversized(
          raw,
          `${t.artwork_id}/${v.name}`
        );
        await commitFile(
          ok,
          path,
          bytes,
          existing,
          `cache-images: ${t.artwork_id} ${v.name} (=w${v.width})`
        );
        done++;
        const note =
          bytes.length !== raw.length ? ` (compressed from ${raw.length})` : "";
        console.log(`  ok ${t.artwork_id} ${v.name} (${bytes.length} bytes${note})`);
      } catch (err) {
        failed++;
        console.error(
          `  fail ${t.artwork_id} ${v.name}:`,
          (err as Error).message
        );
      }
    }
  }

  console.log(`done. committed=${done} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
