# Handoff — RKK Inventory App

Date: 2026-05-16. Supersedes the prior 2026-05-16 Session-1 handoff. **Session 2 of 9 is closed.** Code shipped and typechecks; the `_cm` → `_in` post-push fix is in (see "Post-push fix" below). Seeding the first artworks is happening in a parallel chat thread; Session 3 (series + locations + contacts + move-artwork) starts after that work lands. **Before Session 3 writes any schema changes, address the bootstrap-once trap noted at the bottom of this file.**

## State at end of Session 2

The artworks spine — query layer, validation, API routes, and a long-form registrar UI for create / read / update / archive — is in place behind the auth-gated `/artworks` surface. `tsc --noEmit` is clean. No live data has been written yet; the seed step and end-to-end test are queued for Raghava.

Carrying forward, intact from Session 1:
- Signed in as `raghava.kk@gmail.com` via Google SSO at `https://raghavakk-inventory-app.vercel.app/`
- Data repo `ragskk/raghavakk-inventory-data` connected, `inventory.sqlite` bootstrapped, `meta.schema_version = '1'`
- All 19 tables created on first read; `CREATE TABLE … IF NOT EXISTS` paths on every subsequent open

## What shipped in Session 2

```
lib/
├── inventory.ts                          (extended — see "Public API" below)
└── validation/
    └── artwork.ts                        (NEW — Zod schemas)

app/
├── api/
│   ├── artworks/
│   │   ├── route.ts                      (GET list, POST create)
│   │   └── [slug]/
│   │       ├── route.ts                  (GET detail, PATCH update)
│   │       └── archive/route.ts          (POST archive)
│   └── series/
│       └── route.ts                      (GET list, POST upsert — Session 2 stub)
└── artworks/
    ├── page.tsx                          (list + filters)
    ├── new/page.tsx                      (create — server shell)
    ├── [slug]/page.tsx                   (detail)
    ├── [slug]/edit/page.tsx              (edit — server shell)
    └── _components/
        └── ArtworkForm.tsx               (long-form, shared by create + edit)

scripts/
└── seed-fixture-series.ts                (NEW — one-shot seed for verification)
```

### Public API (lib/inventory.ts)

```ts
// reads
listArtworks(filters: ListArtworksQuery): Promise<ArtworkListRow[]>
getArtworkBySlug(slug: string): Promise<ArtworkRow | null>
getArtworkById(id: number): Promise<ArtworkRow | null>
listSeries(): Promise<SeriesRow[]>

// writes — all inside runDbWrite, OCC-safe
createArtwork(input: CreateArtworkInput): Promise<ArtworkRow>
updateArtwork(id: number, patch: UpdateArtworkPatch): Promise<ArtworkRow>
archiveArtwork(id: number, reason: string): Promise<ArtworkRow>
upsertSeriesByCode(input: {...}): Promise<SeriesRow>

// session-1 carry-over (untouched)
getArtworkPrimaryImageSourceUrl(artworkId: string)
getSchemaVersion()
```

### Locked Session 2 decisions

1. **Required-on-create matches schema NOT NULL exactly.** `series_id`, `title`, `year_start`, `height_cm`, `width_cm`. Everything else optional. Lets Sonia create stubs fast during migration; richer validation deferred to a "ready to publish" check in Session 9.
2. **Slug auto-derived from `kebab(title)-{series_code}-{NNN}[-eN|-apN]`.** SEO-friendly, predictable, collision-walked with `-2`, `-3` suffix inside the same transaction. Title changes do NOT auto-update slug — link stability wins.
3. **`inventory_number` is normally auto-generated** via `UPDATE series SET next_seq = next_seq + 1 RETURNING next_seq` inside the `runDbWrite` callback (atomic, idempotent across OCC retries). Override field on the create form accepts a hand-allocated number; validated against `INVENTORY_NUMBER_RE` and against the series's `code`. Override path does NOT advance `next_seq` — that's the importer's job (Session 4) when seeding from pre-existing inventory.
4. **Form layout: long-form one-page** (the HANDOFF default). Stepped flow can be added later without changing the API.
5. **Soft-delete only.** `is_archived` flag + reason + timestamp; archive cascades `availability_status` to `withdrawn`. No hard-delete UI in v1.
6. **`series_id` and `inventory_number` are immutable on update.** Re-categorising = archive + new. The Zod patch schema excludes both fields.

### Verified

- `npx tsc --noEmit` exits 0 on a clean run. All types resolve.
- `app/page.tsx` (Session 1 heartbeat) untouched; `meta.schema_version` round-trip still healthy.

### Post-push fix — unit mismatch (2026-05-16)

After the initial Session 2 push, `/artworks` threw `no such column: a.height_cm` at runtime. Cause: the canonical schema in the code repo uses `_in` (inches, per the explicit "canonical unit" comment in `schema.sql`), but Session 2 code was written against the stale planning-folder `schema.sql` which had `_cm`. Fix: renamed all column references in `lib/inventory.ts`, `lib/validation/artwork.ts`, `app/artworks/_components/ArtworkForm.tsx`, and `app/artworks/[slug]/page.tsx` from `_cm` to `_in` (height / width / depth / framed_* — `weight_kg` stays kg). UI labels updated to "(in)". No DB migration needed since the live schema was already correct. `tsc --noEmit` clean post-fix.

Sibling hygiene: the planning-folder `schema.sql` at `Art inventory app/schema.sql` is stale (has `_cm`) and contradicts the canonical one in this repo. Delete or update separately to prevent the same trap.

### NOT verified (Raghava's local-run checklist)

This needs to happen on the Mac with the live `GITHUB_TOKEN`. The sandbox can't run a full `next build` within its time budget, and writing to the live `raghavakk-inventory-data` repo from the sandbox is the wrong shape regardless.

```
# 0. (recommended) take a backup tag of the data repo first
#    in raghavakk-inventory-data/, on Mac terminal:
#    git tag raghavakk-inventory-data.backup-2026-05-16-pre-session-2-seed
#    git push origin --tags

# 1. seed the fixture series — idempotent, safe to re-run
cd "/Users/raghavakalyanaraman/Documents/Claude/Projects/The New Raghava KK Website/raghavakk-inventory-app"
GITHUB_TOKEN=<pat> npx tsx scripts/seed-fixture-series.ts
# Expect output:
#   [seed] upserting series IB — The Impossible Bouquet
#   [seed]   id=1  next_seq=1  created_at=...
#   [seed] done — 1 series upserted.

# 2. dev server + browser walkthrough
npm run dev
# → http://localhost:3000/artworks
#   - list page renders (empty state with "create the first artwork" CTA)
# → /artworks/new
#   - dropdown shows "IB — The Impossible Bouquet (next: 1)"
# → fill title + year_start + height + width, leave inventory # override blank
# → submit
#   - expect redirect to /artworks/{slug} with inventory_number = RKK-IB-001
#   - data repo gets a commit titled
#     `create artwork — series 1 — "<title>"`
# → /artworks → row appears in list
# → /artworks/{slug}/edit → change description, save
#   - data repo gets a second commit `update artwork {id}`
# → POST /api/artworks/{slug}/archive with body `{"reason":"smoke test"}`
#   - third commit `archive artwork {id}`, row dimmed in list

# 3. confirm Vercel deploy still green after pushing the code
git status
git add .
git commit -m "session 2: artworks CRUD spine + minimal UI"
git push origin main
# → wait for Vercel build, then visit raghavakk-inventory-app.vercel.app/artworks
```

If `next build` fails on a route Raghava hits in dev, the error will appear in the terminal — that's the second-pass typecheck the sandbox couldn't run.

## Known limitations Session 2 leaves for later

- **No image upload yet.** The image-serve route (`/api/work-image/[artwork_id]/[variant]`) from Session 1 still works; what's missing is a `POST` that accepts a multipart upload, generates thumb/hero/label variants via sharp, commits to the data repo, and inserts an `artwork_images` row. Either Session 2.5 or rolled into Session 9 (ops polish). The detail page renders without images for now.
- **Series CRUD is minimal.** Only `listSeries` and `upsertSeriesByCode` shipped — enough to populate the form dropdown and seed. Session 3 builds the real series management surface (edit cover image, display_order, website_visible, delete-if-empty, etc.).
- **No locations, contacts, or move-artwork action.** Session 3.
- **No condition / price history surfaces.** Session 8.
- **Edit form sends nulls for cleared fields.** Confirm with Sonia that this is the desired clear-semantics (vs. omit-to-preserve). If we want both, we'd need a tri-state UI (set / clear / leave alone), which is more form than Session 2's spine warrants.

## Cross-cutting constraints (still apply)

Unchanged from the ROADMAP. The Session 2 code follows all of them:

- **Write idempotency.** `createArtwork`, `updateArtwork`, `archiveArtwork`, `upsertSeriesByCode` all run inside `runDbWrite` callbacks that re-read state from fresh on every retry. Counter increments use `UPDATE … RETURNING`, never JS read-modify-write. Verified by inspection.
- **JPEG re-encode discipline.** Image upload isn't in Session 2; Session 1's `cache-images.ts` already enforces `withMetadata()` + `chromaSubsampling: "4:4:4"`. When upload lands, it must reuse the same encoder settings.
- **Git from Mac, not sandbox.** Sandbox FS unlink quirk is unchanged. All commits happen from Raghava's terminal.
- **Backup tags before destructive changes.** Seeding the first series is technically destructive (first write to the previously-empty `series` table). The verification checklist above includes the tag.

## Open questions for Session 3 / 4

- **Default `display_order` strategy for series and artworks.** Currently nullable; Session 3 may want a "next available" auto-allocator. Worth deciding when we build the series form, not now.
- **Edit-form clear semantics.** See above — if Sonia wants tri-state, we add a "leave alone" mode to the PATCH path.
- **Edition record creation.** Schema has an `editions` table that `artworks.edition_id` references, but Session 2 doesn't create or expose it. New edition copies currently set `edition_id = null` and rely on `edition_number` / `artist_proof` / `ap_number` alone. Session 3 (or 4 during migration) needs to populate `editions` so the suffix logic stays accurate for multi-copy works.

## Known gotchas (carried forward from Session 1)

1. **Sign in only from the production alias**, not from preview URLs. Unchanged.
2. **Env vars in Vercel only apply to new deploys.** Unchanged.
3. **`personal_access_token.txt`** was deleted 2026-05-16. Value lives in `.env.local` (dev) and Vercel encrypted env vars (prod). Don't recreate the plaintext file.
4. **Git commits from the Mac terminal, not the sandbox.** Unchanged.

## How to start Session 3

```
cd "/Users/raghavakalyanaraman/Documents/Claude/Projects/The New Raghava KK Website/raghavakk-inventory-app"
npm run dev
```

Open `localhost:3000/artworks`, confirm Session 2 spine works end-to-end (a few real artworks created via the UI is a stronger smoke test than the single fixture). Then say "let's do Session 3" and we'll start on series + locations + contacts + the move-artwork action.

If anything in Session 2 misbehaves before Session 3 starts: check `lib/inventory.ts` (query layer), `lib/validation/artwork.ts` (boundary contract), and `app/artworks/_components/ArtworkForm.tsx` (the only client component). The API routes are thin and shouldn't be the failure mode.

## Prerequisites for Session 3 (handle before any new schema work)

**1. Bootstrap-once trap.** The current `lib/db.ts` only ever runs `CREATE TABLE/INDEX IF NOT EXISTS`. If `schema.sql` adds a new column to an existing table, the live DB will not pick it up — `IF NOT EXISTS` is no-op when the table is already there. We dodged this in Session 2 only because the live schema and the new code happened to match after the fix. Session 3 adds tables that already exist in `schema.sql` (locations, location_history, contacts) — `IF NOT EXISTS` covers those because they're new tables, not new columns. But the moment we ever add a column to `artworks`, `series`, etc., we hit silent breakage at query time.

Fix to ship at the top of Session 3: add a real migration step in `lib/db.ts` gated by `meta.schema_version`. Bump from 1 to 2 only when we have something to migrate; for now, the scaffolding plus a comment block documenting the pattern is enough. Use `ALTER TABLE ADD COLUMN` for additive changes; explicit table rebuilds (CREATE new + INSERT SELECT + DROP old + RENAME) for destructive ones.

**2. Stale planning-folder `schema.sql`.** The file at `Art inventory app/schema.sql` (outside the code repo, in the planning folder) has the old `_cm` column names. This is what fooled me into writing `_cm` in Session 2 code. Either delete that whole planning folder (its purpose ended at Session 0) or update its `schema.sql` to match the canonical one in the code repo. Don't leave both versions sitting around.

**3. Seeding state.** First artworks are being loaded via a parallel chat thread before Session 3 starts. Session 3 should open by reading the current state of `series`, `artworks`, and any location data already in the DB before generating any UI — what's there decides which series CRUD ergonomics matter first.
