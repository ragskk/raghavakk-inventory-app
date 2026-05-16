import { openDbForRead } from "@/lib/db";

/**
 * Typed query helpers over the inventory DB.
 *
 * This file is intentionally thin in Session 1 — only the helpers needed
 * by the image-serve route live here. Sessions 2 / 3 add the artworks-CRUD
 * and series/locations helpers.
 *
 * Pattern: every helper opens a fresh Database via `openDbForRead`, runs
 * its query, and ALWAYS closes the db in `finally`. The 5s warm-instance
 * read cache lives inside `lib/db.ts` — callers don't need to coordinate.
 */

/**
 * Look up the source URL for an artwork's main image. Used by
 * /api/work-image as a fallback when the bytes haven't been cached into
 * the data repo yet.
 *
 * Resolution order, all from `artwork_images` for the given artwork_id:
 *   1. The row referenced by `artworks.primary_image_id`, if set.
 *   2. The lowest-display_order row with `image_type = 'main'`.
 *   3. The lowest-display_order row of any type.
 *
 * Returns null if the artwork doesn't exist, has no images, or the
 * resolved row has no source_url. Once `scripts/cache-images.ts` backfills
 * a variant into the data repo, the route never reaches this fallback.
 */
export async function getArtworkPrimaryImageSourceUrl(
  artworkId: string
): Promise<string | null> {
  const id = Number(artworkId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { db } = await openDbForRead();
  try {
    // Try the explicit primary_image_id pointer first.
    const primary = db.exec(
      `SELECT ai.source_url
         FROM artworks a
         JOIN artwork_images ai ON ai.id = a.primary_image_id
        WHERE a.id = $id`,
      { $id: id } as Record<string, number>
    );
    const primaryUrl = primary?.[0]?.values?.[0]?.[0];
    if (typeof primaryUrl === "string" && primaryUrl.length > 0) {
      return primaryUrl;
    }

    // Fall back to the first 'main' image by display_order, then any image.
    const fallback = db.exec(
      `SELECT source_url
         FROM artwork_images
        WHERE artwork_id = $id
          AND source_url IS NOT NULL
          AND length(source_url) > 0
     ORDER BY (image_type = 'main') DESC, display_order ASC, id ASC
        LIMIT 1`,
      { $id: id } as Record<string, number>
    );
    const fallbackUrl = fallback?.[0]?.values?.[0]?.[0];
    if (typeof fallbackUrl === "string" && fallbackUrl.length > 0) {
      return fallbackUrl;
    }

    return null;
  } finally {
    db.close();
  }
}

/**
 * Lightweight smoke-test of the read path. Returns the schema version
 * stored in the `meta` table — bootstrap path sets it to '1' on the very
 * first read, so a non-null return value means the data repo is healthy.
 *
 * Used by `app/page.tsx` (heartbeat) to verify Session 1 wiring without
 * needing any artworks in the DB.
 */
export async function getSchemaVersion(): Promise<string | null> {
  const { db } = await openDbForRead();
  try {
    const res = db.exec(`SELECT value FROM meta WHERE key = 'schema_version'`);
    const v = res?.[0]?.values?.[0]?.[0];
    return typeof v === "string" ? v : null;
  } finally {
    db.close();
  }
}
