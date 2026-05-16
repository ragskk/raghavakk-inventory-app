/**
 * Re-link artworks.primary_image_id from artwork_images rows.
 *
 * Why this exists
 * ---------------
 * A regression in lib/validation/artwork.ts (now fixed) caused
 * UpdateArtworkPatch to populate every "absent" patch field with NULL/0
 * before reaching bulkUpdateArtworks. A bulk "set availability_status =
 * sold" wiped primary_image_id (and a dozen other nullable columns) on
 * every selected row. Cards then rendered the "no image" placeholder
 * because ArtworkGrid checks `r.primary_image_id != null`.
 *
 * This script only restores primary_image_id. It does NOT restore prices,
 * descriptions, dimensions, edition data, visibility flags, SEO, etc. —
 * those are lost from the SQLite blob and can only be recovered by
 * reverting raghavakk-inventory-data to a commit before the bad bulk
 * update. Use this script as a stopgap so the grid is usable while you
 * decide whether to revert.
 *
 * Selection rule: for each artwork with primary_image_id IS NULL but at
 * least one row in artwork_images, pick:
 *   1. image_type = 'main' if present, lowest display_order, lowest id
 *   2. else lowest display_order, lowest id
 *
 * Usage:
 *   GITHUB_TOKEN=<pat> npx tsx scripts/restore-primary-images.ts
 *   GITHUB_TOKEN=<pat> npx tsx scripts/restore-primary-images.ts --dry
 *   GITHUB_TOKEN=<pat> npx tsx scripts/restore-primary-images.ts --only=12,17,42
 *
 * Runs inside one runDbWrite callback so the whole restore is one commit
 * to the data repo (OCC retry-safe).
 */

import { runDbWrite, openDbForRead } from "../lib/db";

interface NullPrimaryRow {
  id: number;
  title: string;
  inventory_number: string;
}

interface ImageCandidate {
  id: number;
  image_type: string;
  display_order: number;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry") || args.has("--dry-run");
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlyIds = onlyArg
    ? onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : null;

  // 1. Read pass — find candidates.
  const { db } = await openDbForRead();
  let candidates: NullPrimaryRow[] = [];
  try {
    const where: string[] = ["a.primary_image_id IS NULL", "a.is_archived = 0"];
    if (onlyIds && onlyIds.length > 0) {
      where.push(`a.id IN (${onlyIds.join(",")})`);
    }
    const res = db.exec(
      `SELECT a.id, a.title, a.inventory_number
         FROM artworks a
        WHERE ${where.join(" AND ")}
          AND EXISTS (
            SELECT 1 FROM artwork_images ai WHERE ai.artwork_id = a.id
          )
        ORDER BY a.id ASC`
    );
    if (res[0]) {
      candidates = res[0].values.map((row) => ({
        id: row[0] as number,
        title: row[1] as string,
        inventory_number: row[2] as string,
      }));
    }
  } finally {
    db.close();
  }

  console.log(
    `Found ${candidates.length} artwork(s) with primary_image_id NULL and at least one artwork_image row.`
  );
  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (dry) {
    console.log("\n--dry — listing first 20 candidates, no writes:");
    for (const c of candidates.slice(0, 20)) {
      console.log(`  ${c.inventory_number}  #${c.id}  ${c.title}`);
    }
    if (candidates.length > 20) console.log(`  … and ${candidates.length - 20} more`);
    return;
  }

  // 2. Write pass — one runDbWrite, one Octokit commit.
  const result = await runDbWrite<{ patched: number; skipped: number }>(
    async (db) => {
      let patched = 0;
      let skipped = 0;

      for (const c of candidates) {
        const imgRes = db.exec(
          `SELECT id, image_type, display_order
             FROM artwork_images
            WHERE artwork_id = $id
            ORDER BY (image_type = 'main') DESC,
                     display_order ASC,
                     id ASC
            LIMIT 1`,
          { $id: c.id } as Record<string, number>
        );
        const row = imgRes?.[0]?.values?.[0];
        if (!row) {
          skipped += 1;
          continue;
        }
        const newPrimaryId = row[0] as number;
        db.run(
          `UPDATE artworks
              SET primary_image_id = $img,
                  updated_at = datetime('now')
            WHERE id = $id
              AND primary_image_id IS NULL`,
          { $img: newPrimaryId, $id: c.id }
        );
        patched += 1;
      }

      return { patched, skipped };
    },
    `restore primary_image_id for ${candidates.length} artworks`
  );

  console.log(
    `Restored primary_image_id on ${result.patched} artwork(s). Skipped ${result.skipped} (no image rows after re-check).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
