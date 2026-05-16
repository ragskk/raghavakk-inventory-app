# Handoff — RKK Inventory App

Date: 2026-05-16. Supersedes the 2026-05-15 handoff that previously occupied this file. Session 1 of 9 is **in_progress** — scaffold layer is complete on disk, data layer + auth + first commit are not yet done.

## State at end of session

Repo skeleton exists at `raghavakk-inventory-app/`. Eight Next.js config + app files have been written. Secrets are pasted into local files (gitignored). No `npm install` has run yet. No `git init` yet. The data layer (`lib/db.ts`) has NOT been ported.

## Files now in this folder

```
raghavakk-inventory-app/
├── HANDOFF.md                              ← this file
├── INVENTORY_APP_NOTES.md                  canonical decisions log (Sessions 0–9)
├── ROADMAP.md                              10-session execution plan
├── schema.sql                              19-table SQLite DDL (canonical, 24 KB)
├── schema-diagram.md                       Mermaid ER diagram
├── RKK_inventory_schema_template.xlsx      human-readable schema mirror (review-only)
├── .gitignore                              env*.local + personal_access_token.txt + _memory-drafts/ excluded
├── .env.local                              GITHUB_TOKEN filled; AUTH_SECRET + AUTH_GOOGLE_* + RESEND_API_KEY blank
├── personal_access_token.txt               PAT, single line
├── package.json                            next 15, react 19, tailwind 3, sql.js, octokit, auth.js, sharp, tsx, resend, zod
├── tsconfig.json                           target ES2022, paths { @/*: ./* }, strict
├── next.config.mjs                         outputFileTracingIncludes for sql-wasm.wasm + schema.sql; serverExternalPackages: sql.js
├── tailwind.config.ts                      design tokens mirror campaign-app
├── postcss.config.mjs                      tailwindcss + autoprefixer
├── app/
│   ├── layout.tsx                          metadata noindex, Fraunces body, viewport triplet
│   ├── page.tsx                            scaffold heartbeat — "RKK Inventory" + "alive"
│   └── globals.css                         design DNA mirror campaign-app, dash-chrome + dash-table + pill components
├── .DS_Store                               macOS junk, gitignored
└── .template_b64.txt                       39 KB base64 leftover from a prior session — origin unclear, safe to delete
```

`_memory-drafts/` was deleted by Raghava from Mac terminal on 2026-05-16 (sandbox couldn't unlink — the FS-quirk gotcha named in INVENTORY_APP_NOTES.md).

## What Raghava does before next Claude session

In order, from his Mac terminal in `raghavakk-inventory-app/`:

1. `npm install` — installs ~600 packages, 30–90s. Watch for sharp install warnings; sharp has native bins and occasionally needs `npm rebuild sharp` on Apple Silicon.
2. `npm run dev` — starts Next on :3000. Visit `http://localhost:3000`. Expected: cream background, "RKK / INVENTORY" eyebrow in mono caps, "Studio *inventory*" headline in Instrument Serif with "inventory" in red italic, a sentence in Fraunces, "alive" heartbeat at the bottom. Paste the dev-server output back to the next Claude session — even just the first 20 lines.
3. `openssl rand -base64 32` — paste output into `.env.local` as `AUTH_SECRET=...`.
4. *(Optional, can defer)* Create Google OAuth client in Google Cloud Console. Authorized origin: `http://localhost:3000`. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`. Paste ID + secret into `.env.local` as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Next session can walk through this if needed.

## What the next Claude session does (Session 1 continuation)

Read this file, then read `INVENTORY_APP_NOTES.md`, then read `ROADMAP.md`, then read `../raghavakk-campaign-app/lib/db.ts` in full. Auto-memory should surface `raghavakk_sqlite_octokit_pattern.md` and `raghavakk_inventory_app.md` automatically. Then in order:

1. **Port `lib/db.ts`** from campaign-app. Diffs:
   - `OWNER` default: `ragskk` (unchanged).
   - `REPO` default: `raghavakk-campaign-data` → `raghavakk-inventory-data`.
   - `BRANCH` default: `main` (unchanged).
   - `DB_PATH`: `campaigns.sqlite` → `inventory.sqlite`.
   - Env var names: `CAMPAIGN_DATA_OWNER/REPO/BRANCH` → `INVENTORY_DATA_OWNER/REPO/BRANCH`.
   - `SCHEMA_DDL`: replace the inline template literal with `fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8')` — schema.sql is already traced into the bundle via `next.config.mjs`'s `outputFileTracingIncludes`.
   - `SCHEMA_VERSION`: bump to match whatever the head of `schema.sql` declares (or 1 if unmarked).
   - Keep everything else verbatim: 5s read cache, OCC retry, bootstrap-on-404, race-safe commit.

2. **Verify storage layer end-to-end.** Add `app/api/db-ping/route.ts`:
   ```ts
   import { openDbForRead } from "@/lib/db";
   import { NextResponse } from "next/server";

   export async function GET() {
     const { db } = await openDbForRead();
     try {
       const r = db.exec("SELECT COUNT(*) FROM artworks");
       return NextResponse.json({ ok: true, artworks: r[0]?.values[0]?.[0] ?? 0 });
     } finally {
       db.close();
     }
   }
   ```
   Visit `localhost:3000/api/db-ping`. First request triggers bootstrap (404 → empty SQLite committed to `ragskk/raghavakk-inventory-data`). Confirm in GitHub web UI that `inventory.sqlite` now exists. Subsequent requests should be ~50–200ms (cached).

3. **Port `/api/work-image/[artwork_id]/[variant]/route.ts`** from campaign-app. Adjust path param `work_id` → `artwork_id`. Variants stay `thumb` / `hero` / `label`. 404 fallback chain: data repo → `artwork_images.source_url` (queried via lib/db.ts) → 404 final.

4. **Port `scripts/cache-images.ts` and `scripts/revert-images.ts`** from campaign-app. Adjust:
   - Data repo → `raghavakk-inventory-data`.
   - Source-URL plumbing: campaign reads `inventory-v2.ts`; inventory queries `artwork_images.source_url` rows via `lib/db.ts`.
   - Variant set stays the same.
   - **Compression discipline stays exactly verbatim**: mozjpeg q98→q92→q85→q78 only above 10 MB, mandatory `withMetadata()` + `chromaSubsampling: "4:4:4"`. Raghava 2026-05-15: defaults make artwork darker + saturated.

5. **Wire Auth.js v5 + Google SSO.** Port `lib/auth.config.ts`, `lib/auth.ts`, `middleware.ts` from campaign-app. `AUTH_ALLOWLIST` is already set in `.env.local` to `raghava.kk@gmail.com,raghavakkstudio@gmail.com`. Verify sign-in flow with one of those accounts. If `AUTH_GOOGLE_*` aren't set yet, walk Raghava through creating the OAuth client in Google Cloud Console first.

6. **First commit + push.** From Mac terminal in `raghavakk-inventory-app/`:
   ```
   git init
   git remote add origin git@github.com:ragskk/raghavakk-inventory-app.git
   git branch -M main
   git add .
   git status                 # ← CRITICAL: verify .env.local + personal_access_token.txt are NOT staged
   git commit -m "Session 1: scaffold + db + auth"
   git push -u origin main
   ```
   If `git status` shows `.env.local` or `personal_access_token.txt`, STOP — gitignore failed somehow. Diagnose before any commit.

7. **Mark task #2 (Session 1) complete. Move to Session 2 — Artworks CRUD.** Task #3 already in the list with description of what's expected.

## Cross-cutting constraints (apply every session)

- **Write idempotency.** `runDbWrite()` callbacks may run multiple times on OCC retry. Counter increments via SQL `UPDATE … RETURNING`, never JS read-modify-write. Pattern doc: auto-memory `raghavakk_sqlite_octokit_pattern.md`.
- **JPEG re-encode.** Always `withMetadata()` + `chromaSubsampling: "4:4:4"`. Mozjpeg ladder q98→q92→q85→q78 only above 10 MB. Defaults make Raghava's paintings look darker and oversaturated.
- **Git from Mac, not sandbox.** Sandbox FS unlink quirk leaves `.git/index.lock` stale.
- **Backup tags before major changes.** Convention: `raghavakk-inventory-app.backup-YYYY-MM-DD-pre-<change>` (mirrored from campaign-app).
- **Secrets in chat = compromised.** Auto-memory: `feedback_secrets_in_chat.md`. Revoke first, regenerate, paste into `.env.local` not chat.

## Gotchas surfaced this session

- `pnpm create next-app` / `npx create-next-app` overwrite `.gitignore` and run `git init` + auto-commit in one move — a brand-new repo will end up with the PAT committed if you use these. **Don't use create-next-app in this repo.** New top-level deps later are fine via `npm install <pkg>` (npm install respects existing config without overwriting).
- Pasting multi-line shell blocks with `# comment` lines in zsh: the `#` becomes a command-not-found. Run lines one at a time, or strip comments before paste.
- Memory writes work in 2026-05-16 sessions; the previous session's "harness blocked memory writes" gotcha is resolved.
- `.template_b64.txt` (39 KB base64) at repo root is leftover from an earlier session. Origin unclear. Raghava can delete or keep; not load-bearing.

## References

Local docs (in this folder):
- `INVENTORY_APP_NOTES.md` — canonical decisions log.
- `ROADMAP.md` — 10-session plan with per-session deliverables and resolved open questions.
- `schema.sql` — 19-table 3NF DDL.
- `schema-diagram.md` — Mermaid ER diagram + reading notes.

Campaign-app sources to port from:
- `../raghavakk-campaign-app/lib/db.ts` — 384 lines, canonical SQLite-over-Octokit pattern.
- `../raghavakk-campaign-app/lib/auth.ts`, `lib/auth.config.ts`, `middleware.ts` — Auth.js v5 + Google SSO scaffold.
- `../raghavakk-campaign-app/scripts/cache-images.ts`, `scripts/revert-images.ts` — image pipeline with JPEG discipline.
- `../raghavakk-campaign-app/app/api/work-image/` — image serving route (path to verify in that repo).

Auto-memory (loaded automatically):
- `raghavakk_sqlite_octokit_pattern.md` — pattern doc.
- `raghavakk_inventory_app.md` — scope + locked decisions.
- `feedback_secrets_in_chat.md` — credential leak protocol.

## Open decisions deferred to later sessions

- raghavakkstudio.com integration shape (decided at Session 7 once inventory entry surface is mature).
- Multi-source migration column maps per source (Session 4 Phase A, Cowork walkthrough).
