import { openDbForRead, runDbWrite } from "@/lib/db";
import {
  type CreateArtworkInput,
  type UpdateArtworkPatch,
  type ListArtworksQuery,
  INVENTORY_NUMBER_RE
} from "@/lib/validation/artwork";

/**
 * Typed query helpers over the inventory DB.
 *
 * Pattern: every helper opens a fresh Database via `openDbForRead` (for
 * reads) or `runDbWrite` (for writes). The 5s warm-instance read cache and
 * OCC retry loop live in `lib/db.ts` — callers don't coordinate either.
 *
 * Writes inside `runDbWrite` MUST be idempotent across retries. We achieve
 * this by re-reading the relevant state at the start of every callback run,
 * never holding values across the closure boundary.
 */

// =====================================================================
// Types
// =====================================================================

/**
 * Row shape returned by `SELECT * FROM artworks`. Mirrors schema.sql §5.
 * sqlite booleans are 0/1 integers; we leave that representation as-is on
 * the way out so callers can pass values straight back to API responses.
 */
export interface ArtworkRow {
  id: number;
  inventory_number: string;
  series_id: number;
  edition_id: number | null;
  edition_number: number | null;
  artist_proof: 0 | 1;
  ap_number: number | null;

  title: string;
  slug: string;

  year_start: number;
  year_end: number | null;
  medium_id: number | null;
  materials: string | null;

  height_in: number;
  width_in: number;
  depth_in: number | null;
  framed_height_in: number | null;
  framed_width_in: number | null;
  framed_depth_in: number | null;
  weight_kg: number | null;

  short_description: string | null;
  full_description: string | null;
  artist_note: string | null;
  internal_note: string | null;

  price_usd_cents: number | null;
  price_inr_paise: number | null;
  price_visible_public: 0 | 1;
  price_visible_dealer: 0 | 1;

  availability_status: string;
  condition_status: string;

  website_visible: 0 | 1;
  featured: 0 | 1;
  display_order: number | null;
  seo_title: string | null;
  seo_description: string | null;

  primary_image_id: number | null;

  is_archived: 0 | 1;
  archived_at: string | null;
  archived_reason: string | null;

  created_at: string;
  updated_at: string;
}

/**
 * Row shape for the list view — joins in fields callers actually need so
 * the React side doesn't waterfall N queries per row.
 */
export interface ArtworkListRow extends ArtworkRow {
  series_code: string;
  series_name: string;
  image_count: number;
}

// =====================================================================
// Existing helpers (Session 1 — kept intact)
// =====================================================================

export async function getArtworkPrimaryImageSourceUrl(
  artworkId: string
): Promise<string | null> {
  const id = Number(artworkId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { db } = await openDbForRead();
  try {
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

// =====================================================================
// Slug + inventory-number helpers
// =====================================================================

const ARTWORK_COLUMNS = [
  "id",
  "inventory_number",
  "series_id",
  "edition_id",
  "edition_number",
  "artist_proof",
  "ap_number",
  "title",
  "slug",
  "year_start",
  "year_end",
  "medium_id",
  "materials",
  "height_in",
  "width_in",
  "depth_in",
  "framed_height_in",
  "framed_width_in",
  "framed_depth_in",
  "weight_kg",
  "short_description",
  "full_description",
  "artist_note",
  "internal_note",
  "price_usd_cents",
  "price_inr_paise",
  "price_visible_public",
  "price_visible_dealer",
  "availability_status",
  "condition_status",
  "website_visible",
  "featured",
  "display_order",
  "seo_title",
  "seo_description",
  "primary_image_id",
  "is_archived",
  "archived_at",
  "archived_reason",
  "created_at",
  "updated_at"
] as const;

const ARTWORK_SELECT = ARTWORK_COLUMNS.join(", ");

function kebab(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function zfill(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

interface ParsedInventoryNumber {
  code: string;
  seq: number;
  suffix: "" | `/E${number}` | `/AP${number}`;
  editionN: number | null;
  apN: number | null;
}

function parseInventoryNumber(s: string): ParsedInventoryNumber | null {
  if (!INVENTORY_NUMBER_RE.test(s)) return null;
  // RKK-{CODE}-{NNN}[/E{N}|/AP{N}]
  const m = /^RKK-([A-Z]{2,4})-(\d{3,})(?:\/(E|AP)(\d+))?$/.exec(s);
  if (!m) return null;
  const code = m[1];
  const seq = Number(m[2]);
  if (m[3] === "E") {
    const n = Number(m[4]);
    return { code, seq, suffix: `/E${n}`, editionN: n, apN: null };
  }
  if (m[3] === "AP") {
    const n = Number(m[4]);
    return { code, seq, suffix: `/AP${n}`, editionN: null, apN: n };
  }
  return { code, seq, suffix: "", editionN: null, apN: null };
}

function buildSlugBase(opts: {
  title: string;
  code: string;
  seq: number;
  editionN: number | null;
  apN: number | null;
}): string {
  const parts = [kebab(opts.title), opts.code.toLowerCase(), zfill(opts.seq, 3)];
  if (opts.apN != null) parts.push(`ap${opts.apN}`);
  else if (opts.editionN != null) parts.push(`e${opts.editionN}`);
  return parts.join("-");
}

// Internal: sql.js exec helper that returns columns + values for a single
// result set. Returns null if no rows.
function execRows(
  db: import("sql.js").Database,
  sql: string,
  params?: Record<string, string | number | null>
): { columns: string[]; values: unknown[][] } | null {
  const res = db.exec(sql, params as Record<string, never>);
  if (!res || res.length === 0) return null;
  return { columns: res[0].columns, values: res[0].values };
}

function rowsToObjects<T>(
  result: { columns: string[]; values: unknown[][] } | null
): T[] {
  if (!result) return [];
  return result.values.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj as T;
  });
}

// =====================================================================
// Reads
// =====================================================================

export async function listArtworks(
  filters: ListArtworksQuery
): Promise<ArtworkListRow[]> {
  const { db } = await openDbForRead();
  try {
    const where: string[] = [];
    const params: Record<string, string | number> = {};

    if (!filters.include_archived) where.push("a.is_archived = 0");

    if (filters.series_id != null) {
      where.push("a.series_id = $series_id");
      params.$series_id = filters.series_id;
    }

    if (filters.availability && filters.availability.length > 0) {
      // sql.js doesn't accept array bindings; expand into named params
      const keys = filters.availability.map((_, i) => `$av${i}`);
      filters.availability.forEach((v, i) => {
        params[`$av${i}`] = v;
      });
      where.push(`a.availability_status IN (${keys.join(", ")})`);
    }

    if (filters.condition && filters.condition.length > 0) {
      const keys = filters.condition.map((_, i) => `$co${i}`);
      filters.condition.forEach((v, i) => {
        params[`$co${i}`] = v;
      });
      where.push(`a.condition_status IN (${keys.join(", ")})`);
    }

    if (filters.q) {
      where.push(
        "(a.title LIKE $q ESCAPE '\\' OR a.inventory_number LIKE $q ESCAPE '\\')"
      );
      params.$q = "%" + filters.q.replace(/[%_\\]/g, "\\$&") + "%";
    }

    if (filters.website_visible !== undefined) {
      where.push("a.website_visible = $wv");
      params.$wv = filters.website_visible ? 1 : 0;
    }

    if (filters.has_images === true) {
      where.push(
        "EXISTS (SELECT 1 FROM artwork_images ai WHERE ai.artwork_id = a.id)"
      );
    } else if (filters.has_images === false) {
      where.push(
        "NOT EXISTS (SELECT 1 FROM artwork_images ai WHERE ai.artwork_id = a.id)"
      );
    }

    params.$limit = filters.limit;
    params.$offset = filters.offset;

    const sql = `
      SELECT ${ARTWORK_COLUMNS.map((c) => "a." + c).join(", ")},
             s.code AS series_code,
             s.name AS series_name,
             (SELECT COUNT(*) FROM artwork_images ai WHERE ai.artwork_id = a.id)
               AS image_count
        FROM artworks a
        JOIN series s ON s.id = a.series_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $limit OFFSET $offset
    `;

    return rowsToObjects<ArtworkListRow>(execRows(db, sql, params));
  } finally {
    db.close();
  }
}

export async function getArtworkBySlug(slug: string): Promise<ArtworkRow | null> {
  const { db } = await openDbForRead();
  try {
    const rows = rowsToObjects<ArtworkRow>(
      execRows(
        db,
        `SELECT ${ARTWORK_SELECT} FROM artworks WHERE slug = $slug LIMIT 1`,
        { $slug: slug }
      )
    );
    return rows[0] ?? null;
  } finally {
    db.close();
  }
}

export interface ArtworkImageRow {
  id: number;
  artwork_id: number;
  image_type:
    | "main"
    | "detail"
    | "process"
    | "studio"
    | "installation"
    | "mockup";
  source_url: string | null;
  caption: string | null;
  alt_text: string | null;
  credit: string | null;
  display_order: number;
  visibility: "internal" | "dealer_share" | "public_website";
  created_at: string;
}

export async function listArtworkImages(
  artwork_id: number
): Promise<ArtworkImageRow[]> {
  const { db } = await openDbForRead();
  try {
    return rowsToObjects<ArtworkImageRow>(
      execRows(
        db,
        `SELECT id, artwork_id, image_type, source_url, caption, alt_text,
                credit, display_order, visibility, created_at
           FROM artwork_images
          WHERE artwork_id = $id
          ORDER BY display_order ASC, id ASC`,
        { $id: artwork_id }
      )
    );
  } finally {
    db.close();
  }
}

export async function getArtworkById(id: number): Promise<ArtworkRow | null> {
  const { db } = await openDbForRead();
  try {
    const rows = rowsToObjects<ArtworkRow>(
      execRows(
        db,
        `SELECT ${ARTWORK_SELECT} FROM artworks WHERE id = $id LIMIT 1`,
        { $id: id }
      )
    );
    return rows[0] ?? null;
  } finally {
    db.close();
  }
}

// =====================================================================
// Writes
// =====================================================================

export class ArtworkCreateError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "series_not_found"
      | "series_code_mismatch"
      | "inventory_number_conflict"
      | "slug_exhausted"
      | "edition_invalid"
  ) {
    super(message);
    this.name = "ArtworkCreateError";
  }
}

/**
 * Insert a new artwork.
 *
 * Idempotency: the entire body runs inside `runDbWrite`'s callback, which
 * may re-run on OCC conflict. We never compute anything outside that
 * callback. On retry: series is re-read, counter is re-incremented (atomic
 * via SQL UPDATE … RETURNING), slug uniqueness is re-checked, all from
 * fresh state. The first attempt's bytes never reach GitHub if a conflict
 * fires, so we're not double-allocating numbers.
 */
export async function createArtwork(
  input: CreateArtworkInput
): Promise<ArtworkRow> {
  return runDbWrite<ArtworkRow>(async (db) => {
    // 1. Resolve series
    const seriesRows = rowsToObjects<{ code: string }>(
      execRows(db, "SELECT code FROM series WHERE id = $id", {
        $id: input.series_id
      })
    );
    if (seriesRows.length === 0) {
      throw new ArtworkCreateError(
        `series ${input.series_id} not found`,
        "series_not_found"
      );
    }
    const seriesCode = seriesRows[0].code;

    // 2. Determine inventory_number
    let inventoryNumber: string;
    let parsedSeq: number;
    let parsedEditionN: number | null = null;
    let parsedApN: number | null = null;

    if (input.inventory_number_override) {
      const parsed = parseInventoryNumber(input.inventory_number_override);
      if (!parsed) {
        // Should not happen — Zod has already validated. Defensive.
        throw new ArtworkCreateError(
          "inventory_number_override failed parse",
          "inventory_number_conflict"
        );
      }
      if (parsed.code !== seriesCode) {
        throw new ArtworkCreateError(
          `override code "${parsed.code}" does not match series code "${seriesCode}"`,
          "series_code_mismatch"
        );
      }
      // Check uniqueness inside the transaction.
      const dup = rowsToObjects<{ n: number }>(
        execRows(
          db,
          `SELECT COUNT(*) AS n FROM artworks WHERE inventory_number = $inv`,
          { $inv: input.inventory_number_override }
        )
      );
      if ((dup[0]?.n ?? 0) > 0) {
        throw new ArtworkCreateError(
          `inventory_number "${input.inventory_number_override}" already in use`,
          "inventory_number_conflict"
        );
      }
      inventoryNumber = input.inventory_number_override;
      parsedSeq = parsed.seq;
      parsedEditionN = parsed.editionN;
      parsedApN = parsed.apN;
    } else {
      // Atomic increment of series.next_seq via SQL — NOT a JS read-modify-write.
      // RETURNING gives the post-update value; the allocated seq is (next_seq - 1).
      const upd = rowsToObjects<{ next_seq: number }>(
        execRows(
          db,
          `UPDATE series SET next_seq = next_seq + 1, updated_at = datetime('now')
            WHERE id = $id RETURNING next_seq`,
          { $id: input.series_id }
        )
      );
      if (upd.length === 0) {
        throw new ArtworkCreateError(
          `failed to increment series ${input.series_id}.next_seq`,
          "series_not_found"
        );
      }
      const allocatedSeq = upd[0].next_seq - 1;
      parsedSeq = allocatedSeq;
      // Compute suffix from edition/AP inputs
      let suffix = "";
      if (input.artist_proof === 1 && input.ap_number != null) {
        suffix = `/AP${input.ap_number}`;
        parsedApN = input.ap_number;
      } else if (input.edition_id != null && input.edition_number != null) {
        suffix = `/E${input.edition_number}`;
        parsedEditionN = input.edition_number;
      }
      inventoryNumber = `RKK-${seriesCode}-${zfill(allocatedSeq, 3)}${suffix}`;
    }

    // 3. Generate slug with collision-walking
    const slugBase = buildSlugBase({
      title: input.title,
      code: seriesCode,
      seq: parsedSeq,
      editionN: parsedEditionN,
      apN: parsedApN
    });
    // We're inside the txn; SELECT will see anything inserted by this same
    // callback. Walk -2, -3, … until we find a free slug. Bounded loop.
    let slug = slugBase || `untitled-${seriesCode.toLowerCase()}-${zfill(parsedSeq, 3)}`;
    for (let attempt = 1; attempt <= 50; attempt++) {
      const existing = rowsToObjects<{ n: number }>(
        execRows(
          db,
          `SELECT COUNT(*) AS n FROM artworks WHERE slug = $slug`,
          { $slug: slug }
        )
      );
      if ((existing[0]?.n ?? 0) === 0) break;
      if (attempt === 50) {
        throw new ArtworkCreateError(
          `could not find unique slug after 50 attempts (base: ${slugBase})`,
          "slug_exhausted"
        );
      }
      slug = `${slugBase}-${attempt + 1}`;
    }

    // 4. INSERT.
    // Build the column list explicitly — sql.js named-param insert.
    const insertSql = `
      INSERT INTO artworks (
        inventory_number, series_id, edition_id, edition_number,
        artist_proof, ap_number, title, slug, year_start, year_end,
        medium_id, materials, height_in, width_in, depth_in,
        framed_height_in, framed_width_in, framed_depth_in, weight_kg,
        short_description, full_description, artist_note, internal_note,
        price_usd_cents, price_inr_paise, price_visible_public, price_visible_dealer,
        availability_status, condition_status, website_visible, featured,
        display_order, seo_title, seo_description
      ) VALUES (
        $inventory_number, $series_id, $edition_id, $edition_number,
        $artist_proof, $ap_number, $title, $slug, $year_start, $year_end,
        $medium_id, $materials, $height_in, $width_in, $depth_in,
        $framed_height_in, $framed_width_in, $framed_depth_in, $weight_kg,
        $short_description, $full_description, $artist_note, $internal_note,
        $price_usd_cents, $price_inr_paise, $price_visible_public, $price_visible_dealer,
        $availability_status, $condition_status, $website_visible, $featured,
        $display_order, $seo_title, $seo_description
      )
    `;

    db.run(insertSql, {
      $inventory_number: inventoryNumber,
      $series_id: input.series_id,
      $edition_id: input.edition_id,
      $edition_number: input.edition_number,
      $artist_proof: input.artist_proof ?? 0,
      $ap_number: input.ap_number,
      $title: input.title,
      $slug: slug,
      $year_start: input.year_start,
      $year_end: input.year_end,
      $medium_id: input.medium_id,
      $materials: input.materials,
      $height_in: input.height_in,
      $width_in: input.width_in,
      $depth_in: input.depth_in,
      $framed_height_in: input.framed_height_in,
      $framed_width_in: input.framed_width_in,
      $framed_depth_in: input.framed_depth_in,
      $weight_kg: input.weight_kg,
      $short_description: input.short_description,
      $full_description: input.full_description,
      $artist_note: input.artist_note,
      $internal_note: input.internal_note,
      $price_usd_cents: input.price_usd_cents,
      $price_inr_paise: input.price_inr_paise,
      $price_visible_public: input.price_visible_public ?? 0,
      $price_visible_dealer: input.price_visible_dealer ?? 1,
      $availability_status: input.availability_status ?? "available",
      $condition_status: input.condition_status ?? "good",
      $website_visible: input.website_visible ?? 0,
      $featured: input.featured ?? 0,
      $display_order: input.display_order,
      $seo_title: input.seo_title,
      $seo_description: input.seo_description
    } as Record<string, string | number | null>);

    // 5. Read back the inserted row to return.
    const newRows = rowsToObjects<ArtworkRow>(
      execRows(
        db,
        `SELECT ${ARTWORK_SELECT} FROM artworks WHERE id = last_insert_rowid()`
      )
    );
    if (newRows.length === 0) {
      throw new Error("createArtwork: insert succeeded but no row returned");
    }
    return newRows[0];
  }, `create artwork — series ${input.series_id} — "${input.title.slice(0, 60)}"`);
}

/**
 * Patch an existing artwork. Only fields present in the patch are touched;
 * everything else is preserved. `series_id` and `inventory_number` are
 * intentionally immutable — re-categorising requires archive + new.
 */
export async function updateArtwork(
  id: number,
  patch: UpdateArtworkPatch
): Promise<ArtworkRow> {
  return runDbWrite<ArtworkRow>(async (db) => {
    // Confirm the row exists.
    const existing = rowsToObjects<{ id: number; title: string }>(
      execRows(
        db,
        `SELECT id, title FROM artworks WHERE id = $id AND is_archived = 0`,
        { $id: id }
      )
    );
    if (existing.length === 0) {
      throw new Error(`artwork ${id} not found or archived`);
    }

    // Build the SET clause from non-undefined patch keys.
    const sets: string[] = [];
    const params: Record<string, string | number | null> = { $id: id };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = $${k}`);
      params[`$${k}`] = v as string | number | null;
    }
    if (sets.length === 0) {
      // Zod refines this, but be safe.
      throw new Error("updateArtwork: empty patch");
    }
    sets.push("updated_at = datetime('now')");

    db.run(`UPDATE artworks SET ${sets.join(", ")} WHERE id = $id`, params);

    const after = rowsToObjects<ArtworkRow>(
      execRows(db, `SELECT ${ARTWORK_SELECT} FROM artworks WHERE id = $id`, {
        $id: id
      })
    );
    if (after.length === 0) {
      throw new Error(`updateArtwork: row ${id} disappeared mid-update`);
    }
    return after[0];
  }, `update artwork ${id}`);
}

/**
 * Apply the same patch to many artworks in a single Octokit commit.
 *
 * Skips artworks that don't exist or are archived (returned in `skipped`).
 * Atomicity: every update happens inside ONE runDbWrite callback, so
 * either all UPDATEs land or none do (OCC retry re-runs the whole batch).
 */
export interface BulkUpdateResult {
  updated_ids: number[];
  skipped: { id: number; reason: string }[];
}

export async function bulkUpdateArtworks(
  ids: number[],
  patch: UpdateArtworkPatch
): Promise<BulkUpdateResult> {
  if (ids.length === 0) {
    return { updated_ids: [], skipped: [] };
  }
  const patchKeys = Object.keys(patch).filter(
    (k) => (patch as Record<string, unknown>)[k] !== undefined
  );
  if (patchKeys.length === 0) {
    throw new Error("bulkUpdateArtworks: empty patch");
  }

  return runDbWrite<BulkUpdateResult>(
    async (db) => {
      const updated: number[] = [];
      const skipped: { id: number; reason: string }[] = [];

      const sets = patchKeys.map((k) => `${k} = $${k}`).join(", ");
      const baseParams: Record<string, string | number | null> = {};
      for (const k of patchKeys) {
        baseParams[`$${k}`] = (patch as Record<string, string | number | null>)[k];
      }

      for (const id of ids) {
        const existing = rowsToObjects<{ id: number; is_archived: 0 | 1 }>(
          execRows(
            db,
            `SELECT id, is_archived FROM artworks WHERE id = $id`,
            { $id: id }
          )
        );
        if (existing.length === 0) {
          skipped.push({ id, reason: "not found" });
          continue;
        }
        if (existing[0].is_archived === 1) {
          skipped.push({ id, reason: "archived" });
          continue;
        }
        db.run(
          `UPDATE artworks SET ${sets}, updated_at = datetime('now') WHERE id = $id`,
          { ...baseParams, $id: id }
        );
        updated.push(id);
      }

      return { updated_ids: updated, skipped };
    },
    `bulk update ${ids.length} artworks (${patchKeys.join(", ")})`
  );
}

/**
 * Soft-delete. Sets is_archived = 1, records timestamp + reason, and
 * preserves all other fields so the row can be revived later if needed.
 */
export async function archiveArtwork(
  id: number,
  reason: string
): Promise<ArtworkRow> {
  return runDbWrite<ArtworkRow>(async (db) => {
    const existing = rowsToObjects<{ id: number }>(
      execRows(db, `SELECT id FROM artworks WHERE id = $id`, { $id: id })
    );
    if (existing.length === 0) {
      throw new Error(`artwork ${id} not found`);
    }

    db.run(
      `UPDATE artworks
          SET is_archived = 1,
              archived_at = datetime('now'),
              archived_reason = $reason,
              availability_status = 'withdrawn',
              updated_at = datetime('now')
        WHERE id = $id`,
      { $id: id, $reason: reason }
    );

    const after = rowsToObjects<ArtworkRow>(
      execRows(db, `SELECT ${ARTWORK_SELECT} FROM artworks WHERE id = $id`, {
        $id: id
      })
    );
    return after[0]!;
  }, `archive artwork ${id}`);
}

// =====================================================================
// Series helpers (Session 2 — minimal, enough to seed the spine)
// =====================================================================

export interface SeriesRow {
  id: number;
  code: string;
  slug: string;
  name: string;
  iteration: string | null;
  short_description: string | null;
  full_description: string | null;
  cover_image_id: number | null;
  website_visible: 0 | 1;
  display_order: number | null;
  next_seq: number;
  created_at: string;
  updated_at: string;
}

export interface MediumRow {
  id: number;
  name: string;
  slug: string;
  category: string;
}

export async function listMediums(): Promise<MediumRow[]> {
  const { db } = await openDbForRead();
  try {
    return rowsToObjects<MediumRow>(
      execRows(
        db,
        `SELECT id, name, slug, category FROM mediums ORDER BY name ASC`
      )
    );
  } finally {
    db.close();
  }
}

export async function listSeries(): Promise<SeriesRow[]> {
  const { db } = await openDbForRead();
  try {
    return rowsToObjects<SeriesRow>(
      execRows(
        db,
        `SELECT id, code, slug, name, iteration, short_description, full_description,
                cover_image_id, website_visible, display_order, next_seq,
                created_at, updated_at
           FROM series
          ORDER BY display_order IS NULL, display_order ASC, name ASC`
      )
    );
  } finally {
    db.close();
  }
}

/**
 * Upsert a series by code. Used by Session 2 to seed a fixture series for
 * end-to-end testing; full CRUD lands in Session 3. Returns the row.
 *
 * Idempotent: re-running with the same code is a no-op (or refreshes
 * descriptions if provided).
 */
export async function upsertSeriesByCode(input: {
  code: string;
  slug: string;
  name: string;
  short_description?: string | null;
  full_description?: string | null;
}): Promise<SeriesRow> {
  return runDbWrite<SeriesRow>(async (db) => {
    db.run(
      `INSERT INTO series (code, slug, name, short_description, full_description)
            VALUES ($code, $slug, $name, $short, $full)
        ON CONFLICT(code) DO UPDATE SET
              name = excluded.name,
              short_description = COALESCE(excluded.short_description, series.short_description),
              full_description = COALESCE(excluded.full_description, series.full_description),
              updated_at = datetime('now')`,
      {
        $code: input.code,
        $slug: input.slug,
        $name: input.name,
        $short: input.short_description ?? null,
        $full: input.full_description ?? null
      }
    );
    const rows = rowsToObjects<SeriesRow>(
      execRows(
        db,
        `SELECT id, code, slug, name, iteration, short_description, full_description,
                cover_image_id, website_visible, display_order, next_seq,
                created_at, updated_at
           FROM series WHERE code = $code`,
        { $code: input.code }
      )
    );
    return rows[0]!;
  }, `upsert series ${input.code}`);
}
