/**
 * Seed fixture series — Session 2 verification helper.
 *
 * The schema requires every artwork to belong to a series (NOT NULL FK).
 * Session 3 ships series CRUD; until then, this script seeds the first
 * series so the new-artwork form has something to point at.
 *
 * Usage:
 *   GITHUB_TOKEN=<pat> npx tsx scripts/seed-fixture-series.ts
 *
 * Idempotent: re-running with the same code is a no-op (ON CONFLICT DO
 * UPDATE refreshes name / descriptions; never touches `next_seq`, so it's
 * safe to run after artworks have been created against this series).
 *
 * Edit the SEEDS array below to add more series. Each entry must:
 *   - code: 2–4 uppercase letters, unique across all series
 *   - slug: lowercase kebab-case, unique
 *   - name: human-readable
 *
 * After running this, restart `npm run dev` (or wait for Vercel cache to
 * miss) and the dropdown on /artworks/new will show the seeded entries.
 */

import { upsertSeriesByCode } from "../lib/inventory";

const SEEDS = [
  {
    code: "IB",
    slug: "impossible-bouquet",
    name: "The Impossible Bouquet",
    short_description:
      "Paintings of bouquets that could never coexist in nature; flowers from different seasons, hemispheres, and centuries forced into one vase.",
    full_description: null
  }
  // Add more series here as needed, e.g.:
  // {
  //   code: "ANF",
  //   slug: "after-nightfall",
  //   name: "After Nightfall",
  //   short_description: null,
  //   full_description: null
  // }
];

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error(
      "GITHUB_TOKEN is required (fine-grained PAT with contents:write on the data repo)."
    );
    process.exit(1);
  }

  for (const seed of SEEDS) {
    console.log(`[seed] upserting series ${seed.code} — ${seed.name}`);
    const row = await upsertSeriesByCode(seed);
    console.log(
      `[seed]   id=${row.id}  next_seq=${row.next_seq}  created_at=${row.created_at}`
    );
  }
  console.log(`[seed] done — ${SEEDS.length} series upserted.`);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
