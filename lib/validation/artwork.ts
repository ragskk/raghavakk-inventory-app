import { z } from "zod";

/**
 * Zod schemas for the artworks surface.
 *
 * Single source of truth for what's accepted at the API boundary and what
 * the UI forms expect. Mirrors the CHECK constraints in `schema.sql` so we
 * fail loudly in the app layer before sqlite ever sees a bad value.
 *
 * Session 2 decisions (locked 2026-05-16):
 *  - Required-on-create matches the schema's NOT NULL set exactly. Everything
 *    else is optional and can be filled in later. Lets Sonia create stubs
 *    fast during migration and edit detail when she's at a desk.
 *  - Slug is auto-derived in the lib layer; not accepted as input.
 *  - inventory_number is auto-derived, but an optional override is accepted
 *    for cases where Sonia needs to reserve or hand-allocate a number.
 *  - On update, `series_id` and `inventory_number` are immutable. Move a
 *    work into a new series? Archive and re-create.
 */

// ---------------------------------------------------------------------------
// Enum constants (mirror CHECK constraints in schema.sql §5 artworks)
// ---------------------------------------------------------------------------

export const AVAILABILITY_STATUSES = [
  "available",
  "on_hold",
  "reserved",
  "sold",
  "not_for_sale",
  "withdrawn"
] as const;

export const CONDITION_STATUSES = [
  "pristine",
  "good",
  "fair",
  "needs_attention",
  "damaged",
  "lost",
  "destroyed"
] as const;

export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inventory-number format: RKK-{CODE}-{NNN}[/E{N}|/AP{N}]
 *   CODE = 2-4 uppercase letters
 *   NNN  = 3+ digits (zero-padded, but we accept any width)
 *   /E{N} = edition copy number (1+)
 *   /AP{N} = artist proof number (1+)
 *
 * Used to validate the optional override field on create.
 */
export const INVENTORY_NUMBER_RE = /^RKK-[A-Z]{2,4}-\d{3,}(\/E\d+|\/AP\d+)?$/;

// ---- CREATE helpers ---------------------------------------------------------
//
// For INSERT statements an omitted optional field must materialise as a
// concrete value the DB can store (NULL for nullable columns, 0 for the
// integer-encoded boolean flags). The transforms below collapse undefined
// down to that concrete value.
//
// IMPORTANT: do NOT use these in UpdateArtworkPatch. On update, "the caller
// did not mention this field" must stay distinguishable from "the caller set
// this field to NULL/0". Otherwise a single-key bulk patch ends up rewriting
// every nullable column on every row. There's a separate set of patch-
// preserving helpers below for that purpose.

const optionalNullableInt = z
  .union([z.number().int(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

const optionalNullableNum = z
  .union([z.number(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

const optionalNullableString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

const boolFlag = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .optional()
  .transform((v) => (v === true || v === 1 ? 1 : 0));

// ---- PATCH helpers ----------------------------------------------------------
//
// Same input shape as the create helpers, but undefined is preserved end-to-
// end. That lets bulkUpdateArtworks / updateArtwork tell the difference
// between "omit this column from the SET clause" and "set this column to
// NULL". Trimming/0-1 coercion still runs when the caller actually supplies
// a value.

const patchInt = z.union([z.number().int(), z.null()]).optional();

const patchNum = z.union([z.number(), z.null()]).optional();

const patchString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

const patchBool = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return v === true || v === 1 ? 1 : 0;
  });

// ---------------------------------------------------------------------------
// Create input
// ---------------------------------------------------------------------------

export const CreateArtworkInput = z
  .object({
    // required by schema (NOT NULL columns; no DB default)
    series_id: z.number().int().positive(),
    title: z.string().min(1).max(500).transform((s) => s.trim()),
    year_start: z.number().int().min(1900).max(2100),
    height_in: z.number().positive(),
    width_in: z.number().positive(),

    // optional inventory-number override (validated against INVENTORY_NUMBER_RE)
    inventory_number_override: z
      .string()
      .regex(INVENTORY_NUMBER_RE, {
        message: "must match RKK-{CODE}-{NNN}[/E{N}|/AP{N}]"
      })
      .optional(),

    // edition / AP — optional, but DB CHECK constraint enforces shape consistency
    edition_id: optionalNullableInt,
    edition_number: optionalNullableInt,
    artist_proof: boolFlag,
    ap_number: optionalNullableInt,

    // dimensions (additional)
    year_end: optionalNullableInt,
    medium_id: optionalNullableInt,
    materials: optionalNullableString,
    depth_in: optionalNullableNum,
    framed_height_in: optionalNullableNum,
    framed_width_in: optionalNullableNum,
    framed_depth_in: optionalNullableNum,
    weight_kg: optionalNullableNum,

    // descriptions
    short_description: optionalNullableString,
    full_description: optionalNullableString,
    artist_note: optionalNullableString,
    internal_note: optionalNullableString,

    // pricing
    price_usd_cents: optionalNullableInt,
    price_inr_paise: optionalNullableInt,
    price_visible_public: boolFlag,
    price_visible_dealer: boolFlag,

    // status
    availability_status: z.enum(AVAILABILITY_STATUSES).optional(),
    condition_status: z.enum(CONDITION_STATUSES).optional(),

    // visibility
    website_visible: boolFlag,
    featured: boolFlag,
    display_order: optionalNullableInt,
    seo_title: optionalNullableString,
    seo_description: optionalNullableString
  })
  // mirror the schema CHECK constraints in the validator so we surface
  // the error as a 400 from the API rather than a sqlite constraint failure
  .refine(
    (v) =>
      v.edition_id == null ||
      v.edition_number != null ||
      v.artist_proof === 1,
    {
      message:
        "edition_id requires edition_number or artist_proof = true",
      path: ["edition_number"]
    }
  )
  .refine((v) => v.artist_proof !== 1 || v.ap_number != null, {
    message: "artist_proof requires ap_number",
    path: ["ap_number"]
  });

export type CreateArtworkInput = z.infer<typeof CreateArtworkInput>;

// ---------------------------------------------------------------------------
// Update patch
// ---------------------------------------------------------------------------

/**
 * Update patch — every field optional, omitted means "don't touch".
 *
 * Deliberately excludes: `id`, `series_id`, `inventory_number`, `slug`,
 * `created_at`. These are immutable; re-categorising requires archive + new.
 *
 * `is_archived` / `archived_at` / `archived_reason` are not on the update
 * patch either — use the dedicated archive endpoint.
 */
export const UpdateArtworkPatch = z
  .object({
    title: z.string().min(1).max(500).transform((s) => s.trim()).optional(),

    edition_id: patchInt,
    edition_number: patchInt,
    artist_proof: patchBool,
    ap_number: patchInt,

    year_start: z.number().int().min(1900).max(2100).optional(),
    year_end: patchInt,
    medium_id: patchInt,
    materials: patchString,

    height_in: z.number().positive().optional(),
    width_in: z.number().positive().optional(),
    depth_in: patchNum,
    framed_height_in: patchNum,
    framed_width_in: patchNum,
    framed_depth_in: patchNum,
    weight_kg: patchNum,

    short_description: patchString,
    full_description: patchString,
    artist_note: patchString,
    internal_note: patchString,

    price_usd_cents: patchInt,
    price_inr_paise: patchInt,
    price_visible_public: patchBool,
    price_visible_dealer: patchBool,

    availability_status: z.enum(AVAILABILITY_STATUSES).optional(),
    condition_status: z.enum(CONDITION_STATUSES).optional(),

    website_visible: patchBool,
    featured: patchBool,
    display_order: patchInt,
    seo_title: patchString,
    seo_description: patchString,

    primary_image_id: patchInt
  })
  .refine(
    (v) =>
      Object.values(v).some((x) => x !== undefined),
    {
      message: "patch must contain at least one field"
    }
  );

export type UpdateArtworkPatch = z.infer<typeof UpdateArtworkPatch>;

/**
 * Fields permitted through /api/artworks/bulk.
 *
 * The single-row PATCH endpoint trusts UpdateArtworkPatch wholesale because
 * the caller is acting on one artwork in front of them. The bulk endpoint
 * touches up to 500 rows in one shot, so the blast radius of an accidental
 * field is much bigger — a stray `primary_image_id: null` would silently
 * orphan the hero image for every selected artwork.
 *
 * Locked 2026-05-17 after Raghava batch-set "sold" and noticed images
 * looked off on the affected rows. Even though that specific patch didn't
 * touch images, the bulk endpoint should never be ABLE to touch identity
 * fields (slug, inventory_number, series_id), archive metadata, or the
 * primary_image_id pointer — those need their own dedicated surfaces.
 *
 * If a new field needs batch-edit support, add it here AND wire it into
 * BatchActionBar's `fields[]`. Keep both lists in sync.
 */
export const BULK_ALLOWED_FIELDS = [
  "title",
  "edition_number",
  "ap_number",
  "artist_proof",
  "edition_id",
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
  "seo_description"
] as const;

export type BulkAllowedField = (typeof BULK_ALLOWED_FIELDS)[number];

const BULK_ALLOWED_SET: ReadonlySet<string> = new Set(BULK_ALLOWED_FIELDS);

/**
 * Tighter wrapper around UpdateArtworkPatch for the bulk endpoint.
 * Strips any field the BatchActionBar shouldn't be able to reach AND
 * rejects the patch if a forbidden field was present at all (so a
 * misbehaved client gets a 400 instead of a silent partial-apply).
 */
export const BulkUpdateArtworkPatch = UpdateArtworkPatch.superRefine(
  (val, ctx) => {
    for (const key of Object.keys(val)) {
      if ((val as Record<string, unknown>)[key] === undefined) continue;
      if (!BULK_ALLOWED_SET.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `field "${key}" cannot be edited via bulk; use the single-artwork surface`
        });
      }
    }
  }
);

export type BulkUpdateArtworkPatch = z.infer<typeof BulkUpdateArtworkPatch>;

// ---------------------------------------------------------------------------
// Archive input
// ---------------------------------------------------------------------------

export const ArchiveArtworkInput = z.object({
  reason: z.string().min(1).max(1000)
});

export type ArchiveArtworkInput = z.infer<typeof ArchiveArtworkInput>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

/**
 * GET /api/artworks query string shape. All optional. Defaults applied in
 * `lib/inventory.ts` (not_archived = true unless explicitly include_archived).
 *
 * Filters are AND-ed. `q` matches `title` and `inventory_number` (LIKE).
 * Multi-valued filters (availability, condition) accept comma-separated
 * strings to keep URL parsing trivial.
 */
export const ListArtworksQuery = z.object({
  series_id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().positive().optional()),
  availability: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : v.split(",").map((s) => s.trim()).filter(Boolean)
    )
    .pipe(z.array(z.enum(AVAILABILITY_STATUSES)).optional()),
  condition: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : v.split(",").map((s) => s.trim()).filter(Boolean)
    )
    .pipe(z.array(z.enum(CONDITION_STATUSES)).optional()),
  q: z.string().trim().min(1).max(200).optional(),
  website_visible: z
    .union([z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "1" || v === "true";
    }),
  include_archived: z
    .union([z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  has_images: z
    .union([z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "1" || v === "true";
    }),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? 50 : Number(v)))
    .pipe(z.number().int().min(1).max(500)),
  offset: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? 0 : Number(v)))
    .pipe(z.number().int().min(0))
});

export type ListArtworksQuery = z.infer<typeof ListArtworksQuery>;
