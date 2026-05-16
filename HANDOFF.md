# Handoff — RKK Inventory App

Date: 2026-05-16 (Session 2.5 — seeding + image upload + UX redesign + batch ops + backup). Supersedes the prior Session-2-close handoff. Session 3 (series + locations + contacts + move-artwork action) is now what comes next.

## State at end of this session

`/artworks` is the live working surface. Production: `https://raghavakk-inventory-app.vercel.app/artworks` (root `/` now redirects there). Data repo `ragskk/raghavakk-inventory-data` holds the SQLite blob + cached image variants + (future) documents. `tsc --noEmit` clean.

Database is seeded:

| Table | Rows |
|---|---:|
| users | 2 (raghava.kk@gmail.com artist · raghavakkstudio@gmail.com studio_admin) |
| mediums | 4 (acrylic on canvas, oil on canvas, hand-carved mahogany, acrylic+digital print on archival cotton rag) |
| series | 20 (13 with works · 5 brochure-only placeholders · 2 from older Drive folder) |
| artworks | 58 |
| artwork_images | 67 |
| cached image variants | 168 of 174 (2 source URLs broke: `guernica-2-0`, `to-see-or-not-to-see`) |

Inventory-number ranges allocated: `RKK-TH-001..006`, `RKK-IB-001..005`, `RKK-GP-001..004`, `RKK-SM-001..006`, `RKK-CC-001..005`, `RKK-OP-001..006`, `RKK-ED-001..009`, `RKK-EC-001..003`, `RKK-TT-001`, `RKK-FS-001..005`, `RKK-IB2-001..008`. Per-series `next_seq` advanced accordingly.

## What shipped this session

```
seed-data/                                (workspace folder mirror)
├── mediums.json                          4 rows
├── series.json                           20 rows incl. AC/MK/RC/AG/TLG placeholders
├── artworks.json                         58 rows · inches end-to-end
├── users.json                            2 rows
├── seed-artworks.ts                      idempotent · INSERT OR IGNORE + slug check
├── verify.ts                             diagnostic · PRAGMA table_info + counts
├── skipped.json                          17 deferred works + 12 unattached Drive files
└── README.md

lib/
├── image-attach.ts                       NEW · sharp pipeline · 3 variants per upload
└── inventory.ts                          extended
    ├── listArtworkImages(artwork_id)
    ├── listMediums()
    └── bulkUpdateArtworks(ids, patch)    one runDbWrite, N updates, one commit

app/
├── page.tsx                              now redirect → /artworks
├── api/
│   ├── artwork-images/[artwork_id]/route.ts   POST upload · multipart · any format
│   ├── artworks/bulk/route.ts                 POST bulk update
│   └── backup/database/route.ts               GET download inventory.sqlite
└── artworks/
    ├── page.tsx                          server shell · fetches first batch + series + mediums
    ├── _components/
    │   ├── ArtworkFilters.tsx            live filter bar · no apply button · 350ms debounce on search
    │   ├── ArtworkGrid.tsx               image-first 4-up grid · infinite scroll · multi-select
    │   ├── ArtworkThumb.tsx              graceful no-image / broken-image fallback
    │   └── BatchActionBar.tsx            sticky bottom · field+value+apply
    ├── [slug]/
    │   ├── page.tsx                      thin server wrapper
    │   ├── _components/
    │   │   └── ArtworkDetail.tsx         click-to-edit · auto-save · status pills · drop zone · magazine sections
    │   └── edit/page.tsx                 redirects → /artworks/[slug] (old form deprecated)
```

## Locked decisions this session

1. **Canonical unit: inches.** Studio sheet template + DB columns + JSON + UI inputs all use inches end-to-end. No conversion at any layer. `height_in / width_in / depth_in / framed_*_in`. `weight_kg` stays kg (global shipping default).
2. **IB and IB2 are separate series rows** (acrylic-on-canvas vs acrylic+digital-print). Schema `code UNIQUE` forces the split; iteration field on each row.
3. **Toy Trojan is one artwork, six images.** Sheet rows 11A–F collapsed to one `artworks` row, six `artwork_images` rows.
4. **Brochure-only series (AG / TLG / AC / MK / RC) seeded as placeholder rows** so the spine exists for later population. `Anthropocene V` (work 4E) is filed under Sublime Machines; AC placeholder still exists — confirm whether to fold it.
5. **Edges diptychs (7F, 7G) are one row each.** Stored with combined dims, `materials: "Diptych (two panels)"`, two image rows per diptych. `7F_A(1).jpg` is presumed mislabeled B panel — needs source-side rename to `7F_B.jpg`.
6. **Bootstrap commits orphan blobs over orphan DB rows.** `image-attach.ts` commits the 3 variant blobs to the data repo BEFORE inserting the DB row, so a half-failure leaves a re-uploadable orphan path, not a broken thumb pointer.
7. **No apply button on list filters.** Search input debounced 350ms; selects + checkbox commit immediately via `router.push`.
8. **Infinite scroll batch size: 24.** Initial batch on server, `IntersectionObserver` 300px-from-bottom fetches next 24 via `GET /api/artworks?offset=N`.
9. **Bulk endpoint excludes `series_id` and `inventory_number`** (immutable per `UpdateArtworkPatch` Zod schema). Series re-assignment + inventory renumbering belong in the dedicated move-artwork action — Session 3.
10. **Auth redirect URI:** Google OAuth client has only the production alias registered. Preview-URL auth requires either registering each hash in Cloud Console OR setting `AUTH_URL=https://raghavakk-inventory-app.vercel.app` in Vercel env vars.

## Pending commits (not yet pushed)

```
?? app/api/backup/                         GET /api/backup/database — sqlite download endpoint
```

To ship:
```
cd "/Users/raghavakalyanaraman/Documents/Claude/Projects/The New Raghava KK Website/raghavakk-inventory-app"
git add app/api/backup/
git commit -m "feat: download inventory.sqlite as backup"
git push
```

Direct download URL (once deployed): `https://raghavakk-inventory-app.vercel.app/api/backup/database` — auth-gated, streams the live blob with filename `rkk-inventory-YYYY-MM-DD.sqlite`.

Quick polish item: add a "backup" link in the `/artworks` header next to "+ new" so it's discoverable. One line in `app/artworks/page.tsx`.

## Known limitations Session 2.5 leaves for later

- **Storage path keyed by `artwork_id`, not `image_id`.** Multiple images per artwork share one set of `images/<artwork_id>/{thumb,hero,label}.jpg` blobs — a new upload overwrites the variants of any prior image. Detail-page gallery shows the primary's thumb; non-primary slots show a metadata-only tile. Migration plan: switch new uploads to `images/<artwork_id>/<image_id>/<variant>.jpg`; update `/api/work-image` to read keyed first then fall back to flat. Worth doing before galleries become a real surface.
- **2 broken source URLs.** `RKK-GP-003` (Guernica 2.0) and `RKK-IB-005` (To See Or Not To See) failed `cache-images.ts`. Source images were bad or moved on Drive. Re-upload via the detail-page drop zone replaces them.
- **17 deferred artworks** in `seed-data/skipped.json`:
  - MT 8A–D (4 works, Mysterium Tremendum) — Untitled, dims TK
  - GV 15A (1, Gods Vs Gods) — Untitled, medium TK, dims TK
  - PF 9A–F (6, Powerfluff Toys) — full metadata missing
  - TF 13A–F (6, Toy Faces) — full metadata missing
- **HEIC support is sharp-version-dependent.** sharp 0.33 bundles libheif on Vercel but some serverless layers strip it. If a HEIC upload returns "Input file contains unsupported image format", convert locally to JPEG first.
- **Vercel hobby tier body limit ~4.5 MB.** RAW / huge TIFF uploads need a client-side downscale before POST. Not implemented yet; document or upgrade tier.
- **`AC` placeholder vs work 4E "Anthropocene V".** Both exist. Decide: keep AC as a sibling placeholder or fold it into SM.
- **No bulk archive flow.** Bulk endpoint patches via `UpdateArtworkPatch`; archive needs the dedicated route (captures a reason). Wire into the BatchActionBar with a reason prompt when needed.
- **Bootstrap-once migration trap (carried over from Session 2).** `lib/db.ts` only runs `CREATE TABLE/INDEX IF NOT EXISTS`. Adding a column to an existing table won't propagate — needs a real migration step gated by `meta.schema_version`. Has to ship at the top of Session 3 before any schema change.

## Cross-cutting constraints (still apply)

- **Write idempotency.** Every write uses `runDbWrite`; counter increments via `UPDATE … RETURNING` not JS read-modify-write. `image-attach.ts` does blobs-then-DB so retries don't double-allocate.
- **JPEG re-encode discipline.** `withMetadata()` + `chromaSubsampling: "4:4:4"`. Compression ladder mozjpeg q98→q92→q85→q78 only above 10 MB. Applied in both `cache-images.ts` and `image-attach.ts`.
- **Git from Mac, not sandbox.** Unchanged.
- **Backup tags before destructive changes.** Tag the data repo before any bulk operation that you'd want to roll back.

## How to back up the studio data

Two paths, both produce a recoverable snapshot:

- **Quick download:** sign in, then `GET /api/backup/database` (browser fetches and saves `rkk-inventory-YYYY-MM-DD.sqlite`). Single-file SQLite; opens in DB Browser for SQLite, Postico, or any sqlite CLI.
- **Full repo clone:** `git clone git@github.com:ragskk/raghavakk-inventory-data.git`. Pulls every commit: SQLite blob, all 168 cached image variants, future documents. Every change is a commit you can `git log` and `git checkout` to roll back.

## What to test before Session 3

1. `/artworks` — confirm grid renders 58 cards with thumbs. Two cards (`guernica-2-0`, `to-see-or-not-to-see`) should show "broken image" in red.
2. Click a checkbox on 2–3 cards → bottom bar appears → set `availability_status` to `sold` → apply → cards turn rose.
3. Click any artwork → detail page reads like magazine numbered sections (§ I Dimensions through § VII Meta) → click any field value → input appears → type → Tab/Enter → ticker says "saved".
4. Click an availability pill → menu → pick new status → ticker says "saved".
5. Drop a JPEG into the drop zone of a broken-image artwork → variants commit → primary thumb updates.
6. Backup endpoint: visit `/api/backup/database` → file downloads with today's date.

## How to start Session 3

```
cd "/Users/raghavakalyanaraman/Documents/Claude/Projects/The New Raghava KK Website/raghavakk-inventory-app"
npm run dev
```

Session 3 scope per ROADMAP: series + locations + contacts + move-artwork action. The bootstrap-once trap is a prerequisite — bump `meta.schema_version` to 2 and add an explicit migration step in `lib/db.ts` before adding any column.

Also queued for early Session 3:
- Per-image storage paths (image_id-keyed) before non-primary galleries become real surfaces.
- Resolve AC placeholder vs SM-folded decision.
- Wire backup link into header (5-minute UI polish).
