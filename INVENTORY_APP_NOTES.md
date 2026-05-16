# RKK Inventory App — canonical notes

Persistent project doc. Lives in workspace, not auto-memory (harness blocked memory writes 2026-05-15). Edit freely.

## Scope decisions (locked 2026-05-15)

- **Users**: Sonia / studio team (auth'd) + galleries/dealers (share-link only, no login).
- **Platform**: Web + mobile, equally. Next.js 15 + Tailwind, mirror campaign-app stack.
- **Build**: Bespoke. No SaaS art-tool dependency.
- **Hosting**: Vercel (free tier). No paid services.
- **Data**: SQLite over Octokit — single `inventory.sqlite` file in private repo `raghavakk-inventory-data`. Pattern lifted verbatim from `raghavakk-campaign-app/lib/db.ts`.
- **Image storage**: same data repo at `images/<artwork_id>/<variant>.jpg`. Variants: `thumb` 400px, `hero` 2000px, `label` 1200px (for PDF wall labels + COA).
- **Documents**: same data repo at `documents/<doc_id>.pdf`.
- **Public site**: this app IS the CMS for raghavakkstudio.com. Public surface consumes a read-only API.
- **Aesthetic**: editorial / museum catalog. Inherits website design DNA — cream paper (#F4F1EA / #ECE7DA / #E3DCC8), ink (#0E0E0C), sang-de-bœuf red (#E63D22). Instrument Serif italic + Fraunces + JetBrains Mono. No em-dashes. Single accent.
- **Outputs**: PDF dossier, wall labels, COA, price list — all four.
- **Currency**: USD and INR stored separately as cents/paise. No FX conversion at any layer.
- **Scale**: 200–1,000 physical objects (one row per copy; edition of 10 = 10 rows).
- **Timeline**: 6–8 weeks for v1 with CMS + share-links + PDF dossier. Other outputs and gallery portal in v2.

## v1 / v2 / v3 phasing

**v1** (weeks 1–8): inventory CRUD, images, locations, conditions, prices, share-links, PDF dossier, public CMS feed, Google SSO, spreadsheet import.

**v2** (months 3–4): sales records + commission, consignment / sales_rights, gallery portal with login, COA generation, wall labels, price-list export.

**v3** (months 4–6): exhibitions module, condition history, mockups, marketing/storytelling layer.

**v4+**: insurance/legal, advanced reporting.

## Canonical SQLite-over-Octokit pattern (inherited from campaign app)

```
read:  Octokit GET → bytes + sha → new SQL.Database(bytes) → applyMigrations → query
write: read fresh → callback mutates → db.export() → Octokit PUT with sha
       → 200 OK or 409 conflict → retry up to 3 times (OCC)

cache: 5s warm-instance window for reads only
fallback: GITHUB_TOKEN unset → per-module filesystem impls (dev)
migrations: SCHEMA_DDL = CREATE TABLE/INDEX IF NOT EXISTS, idempotent, runs every open
bootstrap: 404 on first fetch → init empty DB → commit. Race-safe (409/422 → re-fetch).
```

Schema style choice: campaign app uses `data TEXT` JSON-blob columns. **Inventory app uses proper relational columns** because artworks need joins (series, editions, locations) and SQL aggregations (price lists, wall labels). Only freeform addenda stay as TEXT.

## Image pipeline (inherited from campaign app)

Route: `/api/work-image/[artwork_id]/[variant]` reads from data repo via Octokit, 404 → `source_url` fallback (lh3 or original Drive), `Cache-Control: public, max-age=31536000, immutable`.

Backfill script: `scripts/cache-images.ts`.
- Compression ladder: kicks in above 10 MB only. mozjpeg q98 → q92 → q85 → q78.
- Mandatory: `withMetadata()` (preserves ICC) and `chromaSubsampling: "4:4:4"`. Never 4:2:0, never strip ICC. (Raghava 2026-05-15: defaults make artwork darker + saturated.)

Revert script: `scripts/revert-images.ts` deletes everything under `images/` in the data repo.

Both scripts need `GITHUB_TOKEN` with `contents:write`. Run via `GITHUB_TOKEN=<pat> npx tsx scripts/<name>.ts`.

## Inventory numbering scheme

Format: `RKK-{series_code}-{NNN}[/E{N}|/AP{N}]`

- Top-level: `RKK-IB-014` — work 14 in Impossible Bouquet, unique
- Edition: `RKK-IB-014/E03` — copy 3 of the edition
- AP: `RKK-IB-014/AP1` — first artist proof

Per-series counter at `series.next_seq`. App increments atomically inside `runDbWrite()` callback (idempotent across OCC retries because retry replays the increment from fresh state).

## Spreadsheet template — FK resolution convention

The template `RKK_inventory_schema_template.xlsx` uses **name-based pickers** for the two highest-friction foreign keys on the artworks and editions tabs:

- Column header `series` (not `series_id`) → dropdown sourced from `series.name`. Migrate script resolves `WHERE series.name = ?` to get the FK id.
- Column header `medium` (not `medium_id`) → dropdown sourced from `mediums.name`. Migrate script resolves `WHERE mediums.name = ?`.

If a referenced series or medium does not yet exist when an artwork row is imported, the script should create it on-the-fly using `series.code` derived from the slug or fail with a clear error — pick one behavior before v1.

Other FK columns (`edition_id`, `artwork_id`, `contact_id`, `location_id`, `tag_id`, `*_doc_id`, `*_image_id`) remain integer-id columns. Add dropdowns later if data-entry friction warrants.

## Status enums

| Field | Allowed values |
|---|---|
| `artworks.availability_status` | available, on_hold, reserved, sold, not_for_sale, withdrawn |
| `artworks.condition_status` | pristine, good, fair, needs_attention, damaged, lost, destroyed |
| `artwork_images.image_type` | main, detail, process, studio, installation, mockup |
| `artwork_images.visibility` | internal, dealer_share, public_website |
| `locations.type` | studio, storage, gallery, collector, exhibition, shipper, transit, other |
| `location_history.reason` | storage, consignment, exhibition, loan, sale, shipping, return, intake |
| `sales.payment_status` | unpaid, partial, paid, refunded |
| `sales.delivery_status` | pending, in_transit, delivered, returned |
| `documents.document_type` | coa, invoice, condition_report, appraisal, insurance, shipping, agreement, other |
| `documents.visibility` | internal, dealer_share, public_website |
| `contacts.type` | collector, gallery, dealer, agent, institution, press, other |
| `users.role` | artist, studio_admin, registrar |

## Open questions (resolve before v1 codegen)

1. **raghavakkstudio.com stack** — Next.js? Static HTML? Determines whether the public read API ships as REST/JSON or as a build-time JSON export consumed by the existing site.
2. **Migration source** — share the current Available Works spreadsheet (or its column list + a few sample rows). Drives the `scripts/migrate-from-sheet.ts` shape.
3. **Where does Sonia's existing inventory data live** — same sheet, separate sheet, anywhere structured at all? Determines migration scope.
4. **Featured / display_order strategy** — site-wide ordering, per-series, or both?
5. **AP numbering convention** — is `AP1/AP2/AP3` enough, or do you want `EA 1/3` (épreuve d'artiste) style?
6. **Existing inventory_numbers** — do any of your works already have numbers we need to honor, or is everything fresh?

## Repo layout (proposed)

```
ragskk/raghavakk-inventory-app           (Next.js, source code, deploys to Vercel)
  app/
    api/
      work-image/[id]/[variant]/route.ts  (port from campaign app)
      public/work/[slug]/route.ts          (NEW — public site read API)
      share/[token]/route.ts               (NEW — dealer share view)
    artworks/[slug]/...                   (registrar UI)
    series/...                            (registrar UI)
    locations/...                         (registrar UI)
    sales/...                             (v2)
  lib/
    db.ts                                  (port from campaign app, swap repo name)
    schema.sql                             (this schema)
    inventory.ts                           (typed query helpers)
    pdf-dossier.tsx                        (react-pdf renderer for dossier output)
    pdf-wall-label.tsx                     (v2)
    pdf-coa.tsx                            (v2)
  scripts/
    cache-images.ts                        (port from campaign app)
    revert-images.ts                       (port from campaign app)
    migrate-from-sheet.ts                  (NEW)

ragskk/raghavakk-inventory-data           (PRIVATE, data only, NOT a Vercel project)
  inventory.sqlite
  images/<artwork_id>/{thumb,hero,label}.jpg
  documents/<doc_id>.pdf
  mockups/<mockup_id>.jpg
```

## What's deliberately NOT in v1 schema

- **Insurance/legal table** — appraisal docs and insured-value tracking are v4.
- **Auction history** — out of scope.
- **Series-level sales rights** — sales_rights is per-artwork only. Add `series_sales_rights` if needed.
- **Multi-tenant** — single artist. No `artist_id` column anywhere. Hard fork if you ever need it.
- **Soft delete on every table** — only `artworks` has `is_archived`. Other tables hard-delete cascades from artwork (CASCADE on FKs).

## Stale memory to correct next session with memory write access

- `raghavakk_campaign_system.md` says "NO database — Raghava chose GitHub-as-storage." Wrong as of 2026-05-14. Project migrated to SQLite-over-Octokit. Pattern lives at `raghavakk-campaign-app/lib/db.ts`.
- New memory file should be created: `raghavakk_sqlite_octokit_pattern.md` (template content already drafted in conversation).
- New memory file: `raghavakk_inventory_app.md` indexing this project, pointing to this `INVENTORY_APP_NOTES.md`.
