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
 * Canonical unit: inches. The Google Sheet template, artworks.json, and the DB
 * schema (height_in / width_in / depth_in) all use inches end-to-end. No
 * conversion happens at any layer.
 *
 * Inventory numbering: RKK-{code}-{NNN}, allocated atomically inside runDbWrite()
 * via UPDATE…RETURNING on series.next_seq. Per the SQLite-over-Octokit OCC pattern,
 * the entire callback may re-run on conflict — that can leave gaps in numbering,
 * which is acceptable. Slug-existence is checked BEFORE allocation so re-running
 * the seed against an already-populated DB doesn't advance next_seq.
 *
 * Run:
 *   npx tsx --env-file=.env.local seed-data/seed-artworks.ts
 */

import type { Database } from 'sql.js';
import { runDbWrite } from '../lib/db';
import usersData from './users.json';
import mediumsData from './mediums.json';
import seriesData from './series.json';
import artworksData from './artworks.json';

// ---------------------------------------------------------------------------
// sql.js helpers
// ---------------------------------------------------------------------------
//
// sql.js's Statement.run()/get() don't behave like better-sqlite3. The clean
// way to use it is via Database.exec() (which returns result sets) and
// Database.run() (which executes without returning rows). For row IDs and
// change counts we have to query separately.

interface Row {
  [col: string]: any;
}

/** Run an INSERT/UPDATE/DELETE with bound params; returns lastInsertRowid + changes. */
function execWrite(
  db: Database,
  sql: string,
  params: any[] = []
): { changes: number; lastInsertRowid: number } {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const idRes = db.exec(`SELECT last_insert_rowid() AS id`);
  const lastInsertRowid = (idRes[0]?.values?.[0]?.[0] as number) ?? 0;
  return { changes, lastInsertRowid };
}

/** Run a SELECT (or RETURNING) with bound params; returns first row as object, or null. */
function queryOne(db: Database, sql: string, params: any[] = []): Row | null {
  const result = db.exec(sql, params);
  if (result.length === 0 || result[0].values.length === 0) return null;
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const obj: Row = {};
  for (let i = 0; i < cols.length; i++) obj[cols[i]] = vals[i];
  return obj;
}

// ---------------------------------------------------------------------------
// Slug + URL utilities
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Drive's "lh3" CDN serves public Drive files without auth. The folder must
 * be shared "Anyone with the link → Viewer" for this to work. /api/work-image
 * fetches this URL and re-encodes into the data repo.
 */
function driveUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

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
      const { changes } = execWrite(
        db,
        `INSERT OR IGNORE INTO users (email, name, role, active)
         VALUES (?, ?, ?, ?)`,
        [u.email, u.name, u.role, u.active]
      );
      if (changes > 0) usersInserted++;
    }

    // -------------------- mediums --------------------
    for (const m of mediumsData) {
      const { changes } = execWrite(
        db,
        `INSERT OR IGNORE INTO mediums (name, slug, category) VALUES (?, ?, ?)`,
        [m.name, m.slug, m.category]
      );
      if (changes > 0) mediumsInserted++;
    }

    // -------------------- series (upsert) --------------------
    // Edits to series descriptions propagate. next_seq is NEVER touched on
    // conflict — it's allocated dynamically per artwork insert.
    for (const s of seriesData) {
      execWrite(
        db,
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
           updated_at = datetime('now')`,
        [
          s.code,
          s.slug,
          s.name,
          s.iteration ?? null,
          s.short_description ?? null,
          s.full_description ?? null,
          s.website_visible ?? 0,
          s.display_order ?? null,
        ]
      );
      seriesUpserted++;
    }

    // -------------------- artworks --------------------
    for (const a of artworksData as Artwork[]) {
      const slug = slugify(a.title);

      // Idempotency: skip if slug exists. MUST happen before next_seq alloc.
      const existing = queryOne(
        db,
        `SELECT id FROM artworks WHERE slug = ?`,
        [slug]
      );
      if (existing) {
        artworksSkipped++;
        continue;
      }

      // Resolve FKs.
      const seriesRow = queryOne(
        db,
        `SELECT id FROM series WHERE code = ?`,
        [a.series_code]
      );
      if (!seriesRow) {
        throw new Error(
          `[seed] Series code "${a.series_code}" not found (artwork ${a.work_id})`
        );
      }

      const mediumRow = queryOne(
        db,
        `SELECT id FROM mediums WHERE slug = ?`,
        [a.medium_slug]
      );
      if (!mediumRow) {
        throw new Error(
          `[seed] Medium slug "${a.medium_slug}" not found (artwork ${a.work_id})`
        );
      }

      // Atomic next_seq allocation via UPDATE…RETURNING.
      const seqRow = queryOne(
        db,
        `UPDATE series SET next_seq = next_seq + 1, updated_at = datetime('now')
         WHERE code = ?
         RETURNING next_seq`,
        [a.series_code]
      );
      if (!seqRow) {
        throw new Error(`[seed] Failed to allocate next_seq for ${a.series_code}`);
      }
      const allocated = (seqRow.next_seq as number) - 1;
      const inventoryNumber = `RKK-${a.series_code}-${String(allocated).padStart(3, '0')}`;

      // Insert artwork. Dimensions are inches end-to-end.
      const { lastInsertRowid: artworkId } = execWrite(
        db,
        `INSERT INTO artworks (
           inventory_number, series_id, title, slug,
           year_start, year_end, medium_id, materials,
           height_in, width_in, depth_in,
           short_description, full_description, artist_note, internal_note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inventoryNumber,
          seriesRow.id,
          a.title,
          slug,
          a.year_start,
          a.year_end ?? null,
          mediumRow.id,
          a.materials ?? null,
          a.height_in,
          a.width_in,
          a.depth_in ?? null,
          a.short_description ?? null,
          a.full_description ?? null,
          a.artist_note ?? null,
          a.internal_note ?? null,
        ]
      );
      artworksInserted++;

      // Insert images; first image becomes primary_image_id.
      let firstImageId: number | null = null;
      for (const img of a.images) {
        const { lastInsertRowid: imageId } = execWrite(
          db,
          `INSERT INTO artwork_images
             (artwork_id, image_type, source_url, caption, alt_text, credit,
              display_order, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internal')`,
          [
            artworkId,
            img.image_type,
            driveUrl(img.drive_file_id),
            img.caption ?? null,
            img.alt_text ?? null,
            img.credit ?? null,
            img.display_order,
          ]
        );
        if (firstImageId === null) firstImageId = imageId;
        imagesInserted++;
      }

      if (firstImageId !== null) {
        execWrite(
          db,
          `UPDATE artworks SET primary_image_id = ?, updated_at = datetime('now') WHERE id = ?`,
          [firstImageId, artworkId]
        );
      }
    }
  }, 'seed: users + mediums + 20 series + 58 artworks + 67 images');

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
