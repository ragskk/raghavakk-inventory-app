/**
 * seed-artworks.ts
 *
 * Seeds users, mediums, series, and artworks into inventory.sqlite from the JSON
 * files in this directory. Idempotent — re-running picks up edits to series
 * descriptions but never duplicates artworks (slug-existence check).
 *
 * Suggested location in the app repo: scripts/seed-artworks.ts
 * Adjust the JSON import paths if you move this file.
 *
 * Conversion: artworks.json stores inches (matching the studio canonical template);
 * this script converts inches → cm at write time since schema.sql uses *_cm columns.
 *
 * Inventory numbering: RKK-{code}-{NNN}, allocated atomically inside runDbWrite()
 * via UPDATE…RETURNING on series.next_seq. Per the SQLite-over-Octokit OCC pattern,
 * the entire callback may re-run on conflict — that can leave gaps in numbering,
 * which is acceptable. Slug-existence is checked BEFORE allocation so re-running
 * the seed against an already-populated DB doesn't advance next_seq.
 *
 * Run:
 *   npx tsx scripts/seed-artworks.ts
 */

import { runDbWrite } from '../lib/db';
import usersData from './users.json';
import mediumsData from './mediums.json';
import seriesData from './series.json';
import artworksData from './artworks.json';

const IN_TO_CM = 2.54;

function inToCm(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(v * IN_TO_CM * 100) / 100;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Drive's "lh3" CDN serves public Drive files without auth. Folder must be
 * shared "Anyone with the link → Viewer" for this to work. /api/work-image
 * fetches this URL and re-encodes into the data repo with the JPEG settings
 * from memory (withMetadata, 4:4:4 chroma, mozjpeg ladder).
 */
function driveUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

interface Artwork {
  work_id: string;
  series_code: string;
  title: string;
  year_start: number;
  year_end?: number | null;
  medium_slug: string;
  materials?: string | null;
  height_in: number;
  width_in: number;
  depth_in?: number | null;
  short_description?: string | null;
  full_description?: string | null;
  artist_note?: string | null;
  internal_note?: string | null;
  images: Array<{
    drive_file_id: string;
    filename: string;
    image_type: 'main' | 'detail' | 'process' | 'studio' | 'installation' | 'mockup';
    display_order: number;
    caption?: string | null;
    alt_text?: string | null;
    credit?: string | null;
  }>;
}

async function seed() {
  let usersInserted = 0;
  let mediumsInserted = 0;
  let seriesUpserted = 0;
  let artworksInserted = 0;
  let artworksSkipped = 0;
  let imagesInserted = 0;

  await runDbWrite(async (db) => {
    // -------------------- users --------------------
    for (const u of usersData) {
      const r = db.prepare(
        `INSERT OR IGNORE INTO users (email, name, role, active)
         VALUES (?, ?, ?, ?)`
      ).run([u.email, u.name, u.role, u.active]);
      if ((r as any).changes > 0) usersInserted++;
    }

    // -------------------- mediums --------------------
    for (const m of mediumsData) {
      const r = db.prepare(
        `INSERT OR IGNORE INTO mediums (name, slug, category) VALUES (?, ?, ?)`
      ).run([m.name, m.slug, m.category]);
      if ((r as any).changes > 0) mediumsInserted++;
    }

    // -------------------- series (upsert) --------------------
    // We upsert so editing descriptions in series.json and re-running picks them up.
    // next_seq is NOT touched on conflict — it's allocated dynamically per artwork insert.
    for (const s of seriesData) {
      db.prepare(
        `INSERT INTO series
           (code, slug, name, iteration, short_description, full_description,
            website_visible, display_order, next_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(code) DO UPDATE SET
           slug = excluded.slug,
           name = excluded.name,
           iteration = excluded.iteration,
           short_description = excluded.short_description,
           full_description = excluded.full_description,
           website_visible = excluded.website_visible,
           display_order = excluded.display_order,
           updated_at = datetime('now')`
      ).run([
        s.code,
        s.slug,
        s.name,
        s.iteration ?? null,
        s.short_description ?? null,
        s.full_description ?? null,
        s.website_visible ?? 0,
        s.display_order ?? null,
      ]);
      seriesUpserted++;
    }

    // -------------------- artworks --------------------
    for (const a of artworksData as Artwork[]) {
      const slug = slugify(a.title);

      // Idempotency check — must happen BEFORE next_seq allocation.
      const existing = db.prepare(
        `SELECT id FROM artworks WHERE slug = ?`
      ).get([slug]) as { id: number } | undefined;
      if (existing) {
        artworksSkipped++;
        continue;
      }

      // Resolve FKs.
      const seriesRow = db.prepare(
        `SELECT id FROM series WHERE code = ?`
      ).get([a.series_code]) as { id: number } | undefined;
      if (!seriesRow) {
        throw new Error(
          `[seed] Series code "${a.series_code}" not found (artwork ${a.work_id})`
        );
      }

      const mediumRow = db.prepare(
        `SELECT id FROM mediums WHERE slug = ?`
      ).get([a.medium_slug]) as { id: number } | undefined;
      if (!mediumRow) {
        throw new Error(
          `[seed] Medium slug "${a.medium_slug}" not found (artwork ${a.work_id})`
        );
      }

      // Atomically allocate inventory_number.
      // UPDATE…RETURNING returns the *post-increment* value, so the slot we just
      // claimed is (returned - 1). We zero-pad to 3 digits.
      const seqRow = db.prepare(
        `UPDATE series SET next_seq = next_seq + 1, updated_at = datetime('now')
         WHERE code = ?
         RETURNING next_seq`
      ).get([a.series_code]) as { next_seq: number };
      const allocated = seqRow.next_seq - 1;
      const inventoryNumber = `RKK-${a.series_code}-${String(allocated).padStart(3, '0')}`;

      // Insert artwork.
      const insertArtwork = db.prepare(
        `INSERT INTO artworks (
           inventory_number, series_id, title, slug,
           year_start, year_end, medium_id, materials,
           height_cm, width_cm, depth_cm,
           short_description, full_description, artist_note, internal_note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const ar = insertArtwork.run([
        inventoryNumber,
        seriesRow.id,
        a.title,
        slug,
        a.year_start,
        a.year_end ?? null,
        mediumRow.id,
        a.materials ?? null,
        inToCm(a.height_in)!,
        inToCm(a.width_in)!,
        inToCm(a.depth_in ?? null),
        a.short_description ?? null,
        a.full_description ?? null,
        a.artist_note ?? null,
        a.internal_note ?? null,
      ]);
      const artworkId = Number((ar as any).lastInsertRowid);
      artworksInserted++;

      // Insert images; first image becomes primary_image_id.
      let firstImageId: number | null = null;
      for (const img of a.images) {
        const ir = db.prepare(
          `INSERT INTO artwork_images
             (artwork_id, image_type, source_url, caption, alt_text, credit,
              display_order, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internal')`
        ).run([
          artworkId,
          img.image_type,
          driveUrl(img.drive_file_id),
          img.caption ?? null,
          img.alt_text ?? null,
          img.credit ?? null,
          img.display_order,
        ]);
        const imageId = Number((ir as any).lastInsertRowid);
        if (firstImageId === null) firstImageId = imageId;
        imagesInserted++;
      }

      if (firstImageId !== null) {
        db.prepare(
          `UPDATE artworks SET primary_image_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run([firstImageId, artworkId]);
      }
    }
  });

  console.log('seed complete:', {
    users: usersInserted,
    mediums: mediumsInserted,
    series: seriesUpserted,
    artworks_inserted: artworksInserted,
    artworks_skipped_already_present: artworksSkipped,
    images: imagesInserted,
  });
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
