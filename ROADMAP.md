# RKK Inventory App — Build Roadmap

Drafted 2026-05-16. Companion to `HANDOFF.md`, `INVENTORY_APP_NOTES.md`, `schema.sql`, `schema-diagram.md`. This doc is the per-session execution plan; the others are the architectural source of truth.

## Architecture (already locked — do not re-litigate)

Pattern: SQLite-over-Octokit, lifted verbatim from `../raghavakk-campaign-app/lib/db.ts` (384 lines, fully commented). sql.js (WASM, no native binding → runs on Vercel functions), Octokit File API for read/write, OCC via sha tokens, 5s warm-instance read cache, race-safe bootstrap on 404, idempotent migrations via `CREATE TABLE IF NOT EXISTS` on every open.

Two repos: `ragskk/raghavakk-inventory-app` (Next.js 15, deploys to Vercel) and `ragskk/raghavakk-inventory-data` (private; holds `inventory.sqlite`, `images/<artwork_id>/{thumb,hero,label}.jpg`, `documents/<doc_id>.pdf`).

Stack: Next.js 15 + Tailwind 3 + Auth.js v5 (Google SSO) + sql.js + Octokit + Resend + react-pdf. Mirrors campaign-app.

Schema divergence from campaign-app: campaign uses `data TEXT` JSON blobs; inventory uses proper relational columns because price lists, wall labels, and exhibition checklists need joins and SQL aggregation. Only freeform addenda stay as TEXT.

Users: Sonia + studio team via Google SSO. Galleries / dealers via signed share-links, no login.

## Open questions — resolved 2026-05-16

1. **raghavakkstudio.com stack.** **PARKED until Session 7.** Raghava prioritizes inventory entry first; the public-API shape will be decided when we get there, informed by what the data actually looks like in use. Sessions 1–6 build inventory standalone.
2. **Migration source.** **MULTI-SOURCE.** Data scattered across spreadsheets + Notion + Drive folders. Session 4 splits in two: (a) discovery sub-session — Raghava walks Claude through each source on screen, we map columns and flag conflicts; (b) coding sub-session — write multi-source importer with idempotent upserts and per-source audit logs.
3. **Existing inventory_numbers.** **HYBRID.** Pre-existing numbers persist; new works auto-increment. Importer must (i) seed `series.next_seq = max(existing_N for that series) + 1` per series after first pass, (ii) detect collisions before inserting new auto-numbered works. No schema change.
4. **AP numbering convention.** **AP1 / AP2 / AP3.** Confirmed. Schema already correct (`artist_proof` boolean, `ap_number` int, `ap_size` int on edition).

## Cross-cutting constraints (apply every session)

**Write idempotency.** `runDbWrite()` re-runs the callback on 409 conflict. Every write must be an upsert or append. Counter increments (e.g. `series.next_seq` for new inventory numbers) MUST happen inside the callback as a SQL `UPDATE … SET next_seq = next_seq + 1 RETURNING next_seq`, not via a JS variable read-then-write. Otherwise OCC retries will race.

**JPEG re-encode discipline.** Inherited from campaign-app, learned the hard way. Always `withMetadata()` (preserves ICC profile). Always `chromaSubsampling: "4:4:4"`. Never 4:2:0. Never strip ICC. Compression ladder mozjpeg q98 → q92 → q85 → q78, kicks in only above 10 MB. Raghava note 2026-05-15: "defaults make artwork darker + saturated."

**Git from Mac, not sandbox.** Sandbox FS has an unlink quirk that leaves `.git/index.lock` stale. All git commits in the inventory-app repo should happen from Raghava's Mac terminal, not from the sandbox. Same convention as campaign-app.

**Backup tags before major changes.** Mirror campaign-app convention: before any large refactor, take a backup tag (e.g. `raghavakk-inventory-app.backup-2026-MM-DD-pre-<change>`).

**Schema changes are migrations.** When `schema.sql` is updated, the SCHEMA_DDL constant in `lib/db.ts` updates with it. Migrations apply automatically on next open (idempotent). For destructive changes (DROP, ALTER), add an explicit migration step gated by `meta.schema_version`.

## Session-by-session plan

Each session is ~1–3 focused hours. v1 timeline is 6–8 weeks; sessions are paced ~1–2 per week.

**Session 0 — Open questions + repo setup** (Raghava, no Claude). Answer the four questions above. Relocate `_memory-drafts/` files into auto-memory dir (instructions in `_memory-drafts/MEMORY_md_index_lines.md`). Create the two empty private GitHub repos. No code.

**Session 1 — Scaffold + db + auth.** `pnpm create next-app raghavakk-inventory-app` (App Router, TS, Tailwind). Port `lib/db.ts` from campaign-app, swap repo name (`raghavakk-inventory-data`) and DB filename (`inventory.sqlite`). Load `schema.sql` as the `SCHEMA_DDL` constant (read at build time, inlined as string). Port `/api/work-image/[artwork_id]/[variant]/route.ts` (reads from data repo via Octokit, 404 → fallback to `source_url`, `Cache-Control: immutable`). Port `scripts/cache-images.ts` and `scripts/revert-images.ts`. Wire Auth.js v5 with Google SSO, gate all routes via middleware. Bootstrap the data repo by running any read operation (race-safe 404 path will create `inventory.sqlite` with the empty schema).

**Session 2 — Artworks CRUD.** The spine. List view (filter by series, availability, condition; default to "not archived, available, has-images"). Detail page (all fields, image gallery, condition + price + location summaries). Create/edit form. Inventory number generated inside `runDbWrite()` via SQL `UPDATE series SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq`, formatted as `RKK-{code}-{NNN}[/E{N}|/AP{N}]`. Image upload via `/api/work-image POST` which writes to data repo + regenerates thumb/hero/label variants. Per artwork, save dimensions, prices (both currencies), short + full descriptions, artist note, internal note, condition, availability, visibility flags. This session takes time; the form ergonomics determine how much Sonia hates or loves using the app.

**Session 3 — Series, locations, contacts.** CRUD UIs for `series` (show `next_seq` counter so Raghava can see what number is next), `locations` (with `location_history` append-only log), `contacts` (taxonomy: collector / gallery / dealer / agent / institution / press / other). Wire move-artwork action on the artwork detail page: on submit, append a new `location_history` row with from_date=now and close the previous row's to_date=now in the same `runDbWrite()`. Add "Where is X?" (artwork view) and "What's at Y?" (location view).

**Session 4 — Multi-source importer.** Two phases.

*Phase A — discovery (Cowork, no code).* Raghava opens each source on screen (xlsx files, Notion databases, Drive folders). Claude inspects shape, maps source columns to schema columns, flags ambiguous mappings, notes per-source conflicts (same artwork mentioned twice with different titles? same number reused across series? mismatched dimensions?). Output: `scripts/migrations/MAPPING.md` — one section per source with column map, transform rules, conflict resolution policy.

*Phase B — code (separate session).* `scripts/migrate-from-source.ts <source-name>` driven by `MAPPING.md`. Per source: read raw, normalize to schema shape, upsert series + mediums first (referential integrity), upsert artworks (with collision detection against pre-existing inventory_numbers), upload images via `cache-images.ts`. Idempotent across re-runs. `--dry-run` prints what would change. Per-run audit log to `scripts/migrations/logs/YYYY-MM-DD-HHMMSS-<source>.log`. After the full multi-source pass: `scripts/seed-next-seq.ts` walks artworks per series, sets `series.next_seq = max(existing_N) + 1`.

**Session 5 — Share-link surface.** Create-link UI: pick artworks, set label ("For Aicon Mumbai June 2026"), optional password, optional expiry, opt-in price visibility (default off). Token via `nanoid(32)`. Dealer-facing `/share/[token]` page: read-only catalog, no login, opens tracked in `share_link_opens` (hashed IP, user agent). Revoke action. Per-link analytics view (open count, unique IPs, last opened).

**Session 6 — PDF dossier renderer.** `lib/pdf-dossier.tsx` using react-pdf. Per-artwork dossier: hero image (label-variant 1200px, color-correct), title, year, series, medium, dimensions, current price (currency selectable), short + full description, artist note (if present and visibility allows), condition summary, exhibition list (when v3 exhibitions ship; placeholder text now), provenance summary. Available as a download button on artwork detail page and on share-link pages (if dealer view allows). Streamable response.

**Session 7 — Public-API endpoint.** Decision point on website integration (parked at Session 0). By this point inventory entry is mature; we'll see what the dealer surface and Sonia's saved queries actually expose, and pick the right consumption shape. Likely options: (a) if raghavakkstudio.com stays static HTML, build-time `scripts/export-public-json.ts` writes `data/public.json` into the website repo; (b) if migrating to Next.js, `/api/public/series`, `/api/public/series/[slug]`, `/api/public/works/[slug]` REST/JSON with CORS allow-list. Either way: filter by `website_visible=1 AND is_archived=0`, long cache headers.

**Session 8 — Condition + price history UIs.** Add-condition-report form per artwork (writes to `condition_reports`, updates `artworks.condition_status` in the same `runDbWrite()`). Change-price form (writes to `price_history`, updates `artworks.price_usd_cents` + `price_inr_paise`). Per-artwork timeline view: condition events and price events interleaved chronologically.

**Session 9 — Ops dashboard + polish.** Homepage cards driven by saved SQL queries — "needs photographing" (no rows in `artwork_images`), "needs measuring" (height_in OR width_in null), "needs pricing" (both price columns null), "needs artist note" (artist_note null and visibility public), "ready for website" (has main image AND price AND short_description AND website_visible=1). Per-card list view with one-click jump-to-edit. CSV export per table for ad-hoc spreadsheet work. Final v1 polish pass: empty states, error toasts, keyboard shortcuts on the artwork form.

## v2 / v3 / v4 scope (deferred — for context only)

**v2** (months 3–4): sales records + commission, consignment / sales_rights, gallery portal with login (separate from share-links), COA generation, wall labels, price-list export.

**v3** (months 4–6): exhibitions module (artwork_exhibitions wired), condition history advanced views, mockups (per-artwork interior renders), marketing/storytelling layer (press kit generator).

**v4+**: insurance/legal table, advanced reporting, possibly multi-tenant if expanded to other artists.

## File map (this folder)

```
raghavakk-inventory-app/                  ← you are here (planning + schema, no code yet)
├── HANDOFF.md                            previous-session handoff, includes locked decisions
├── INVENTORY_APP_NOTES.md                canonical project doc; phasing, repo layout, gotchas
├── ROADMAP.md                            this file; per-session execution plan
├── schema.sql                            19-table SQLite DDL, 3NF, idempotent
├── schema-diagram.md                     Mermaid ER diagram + reading notes
├── RKK_inventory_schema_template.xlsx    human-readable schema mirror (review-only)
└── _memory-drafts/                       awaiting relocation into auto-memory dir
```

After Session 1 this folder becomes the actual Next.js app; the planning docs stay in `_planning/` or move to the data repo's `README.md`.
