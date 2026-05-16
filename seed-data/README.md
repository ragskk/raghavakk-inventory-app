# seed-data

First metadata seed for `ragskk/raghavakk-inventory-data/inventory.sqlite`.

## Contents

| File | Rows | Purpose |
|---|---:|---|
| `users.json` | 2 | Artist + studio_admin allow-list entries |
| `mediums.json` | 4 | Acrylic on canvas, Oil on canvas, Hand-carved mahogany, Acrylic + digital print on archival cotton rag |
| `series.json` | 20 | 13 series with works + 5 brochure-only placeholders + 2 from the older Drive folder (Powerfluff, Toy Faces) |
| `artworks.json` | 58 | One row per physical object. Dimensions in inches (template convention); seed script converts to cm. |
| `skipped.json` | 17 + 12 | Deferred artworks (need titles/dims) and unattached Drive files |
| `seed-artworks.ts` | — | Idempotent seed script. `npx tsx scripts/seed-artworks.ts` after copying into the app repo. |

## Inventory numbering (after seed runs)

Allocated atomically per series via `UPDATE series SET next_seq = next_seq + 1 RETURNING …`. Expected post-seed:

| Code | Series | Works | Range |
|---|---|---:|---|
| TH | The History Series | 6 | RKK-TH-001 → RKK-TH-006 |
| IB | Impossible Bouquets | 5 | RKK-IB-001 → RKK-IB-005 |
| GP | The Guernica Project | 4 | RKK-GP-001 → RKK-GP-004 |
| SM | Sublime Machines | 6 | RKK-SM-001 → RKK-SM-006 |
| CC | Catch 'em if you can | 5 | RKK-CC-001 → RKK-CC-005 |
| OP | The Orgasm Project | 6 | RKK-OP-001 → RKK-OP-006 |
| ED | Edges | 9 | RKK-ED-001 → RKK-ED-009 |
| MT | Mysterium Tremendum | 0 | (4 deferred) |
| EC | Eye Candy | 3 | RKK-EC-001 → RKK-EC-003 |
| TT | The Toy Trojan | 1 | RKK-TT-001 |
| FS | The Figure Series | 5 | RKK-FS-001 → RKK-FS-005 |
| IB2 | Impossible Bouquet 2.0 | 8 | RKK-IB2-001 → RKK-IB2-008 |
| GV | Gods Vs Gods | 0 | (1 deferred) |
| PF | Powerfluff Toys | 0 | (6 deferred) |
| TF | Toy Faces | 0 | (6 deferred) |
| AG, TLG, AC, MK, RC | brochure-only placeholders | 0 | — |

**Total artworks: 58. Total images: 67** (6 alternates: 2C copy, 3D Liberty, 7F panels, 7G panels, plus 6 Toy Trojan views).

## Open items to ratify before running

1. **`AC` (Anthropocene) placeholder vs work 4E "Anthropocene V".** Work 4E lives in the Sublime Machines folder and is being seeded under `SM`. The brochure-only `AC` placeholder is also created. Decide: keep `AC` as separate series, or delete since the work is folded into SM?
2. **`7F` diptych.** Drive has `7F_A.jpg` and `7F_A(1).jpg` — the second is almost certainly the B panel mislabeled. Currently both are inserted as `image_type: main`. Confirm so I can rename one to `7F_B.jpg` source-side.
3. **`2C copy.jpg`.** Two image files for the same work (`2C.tif` + `2C copy.jpg`). Both attached as `main`. Should one be downgraded to `detail`?
4. **Unattached files in folder 02** — `Woman-IB1.jpg`, `Woman IB4.jpg`, `TIBAW.jpg`, `CEIYC*.jpg`, six `IMG_*.heic`. See `skipped.json`. Tell me if any should be force-attached to existing rows.

## How to run

1. Copy `seed-data/` into the inventory-app repo at the same level as `lib/db.ts`.
2. Optionally move `seed-artworks.ts` to `scripts/` and adjust the JSON imports.
3. `npx tsx scripts/seed-artworks.ts` (or equivalent for the repo's runner).
4. The script will report counts. On OCC retry from Octokit, the whole callback re-runs — slug-existence checks make this safe but next_seq values not yet committed are discarded (small gaps possible, that's fine).
5. After seeding, run `scripts/cache-images.ts` (already shipped in Session 1) to backfill `images/<artwork_id>/{thumb,hero,label}.jpg` from the Drive `source_url`s. Drive folder must be shared "Anyone with the link → Viewer" for `lh3.googleusercontent.com` fetches to work without auth.
