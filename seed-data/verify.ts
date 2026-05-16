/**
 * verify.ts — diagnostic for inventory.sqlite.
 * Prints actual column shape and row counts without assuming column names.
 *
 * Run: npx tsx --env-file=.env.local seed-data/verify.ts
 */

import { openDbForRead } from '../lib/db';

async function verify() {
  const { db, sha } = await openDbForRead();

  function rows(sql: string): any[] {
    const stmt = db.prepare(sql);
    const out: any[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  }

  const tables = rows(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  const artworkCols = rows(`PRAGMA table_info(artworks)`).map((c: any) => c.name);
  const imageCols = rows(`PRAGMA table_info(artwork_images)`).map((c: any) => c.name);

  const counts: Record<string, number> = {};
  for (const t of ['users', 'mediums', 'series', 'artworks', 'artwork_images']) {
    const r = rows(`SELECT COUNT(*) AS n FROM ${t}`);
    counts[t] = (r[0]?.n as number) ?? 0;
  }

  const seriesList = rows(
    `SELECT code, name, next_seq,
            (SELECT COUNT(*) FROM artworks WHERE series_id = series.id) AS artwork_count
     FROM series ORDER BY display_order, code`
  );

  const sample = rows(
    `SELECT inventory_number, title, slug FROM artworks ORDER BY id LIMIT 5`
  );

  console.log('--- inventory.sqlite diagnostic ---');
  console.log('DB sha:', sha);
  console.log('tables:', tables.map((t: any) => t.name));
  console.log('artworks columns:', artworkCols);
  console.log('artwork_images columns:', imageCols);
  console.log('counts:', counts);
  console.log('\nseries:');
  for (const s of seriesList) {
    console.log(`  ${String(s.code).padEnd(4)} ${String(s.name).padEnd(38)} next=${s.next_seq}  works=${s.artwork_count}`);
  }
  console.log('\nfirst 5 artworks:');
  for (const a of sample) {
    console.log(`  ${a.inventory_number}  ${a.title}  (slug=${a.slug})`);
  }

  db.close();
}

verify().catch((err) => {
  console.error('[verify] failed:', err);
  process.exit(1);
});
