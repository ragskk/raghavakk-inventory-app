import Link from "next/link";
import { listArtworks, listMediums, listSeries } from "@/lib/inventory";
import { ListArtworksQuery } from "@/lib/validation/artwork";
import { ArtworkFilters } from "./_components/ArtworkFilters";
import { ArtworkGrid } from "./_components/ArtworkGrid";

/**
 * Artworks list — image-first grid with live filters + infinite scroll.
 *
 * Server fetches the first batch (24). Client component <ArtworkGrid>
 * fetches subsequent batches via GET /api/artworks as the sentinel
 * scrolls into view. <ArtworkFilters> auto-pushes URL params on change —
 * no apply button.
 */

const INITIAL_BATCH = 24;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function normalizeParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = Array.isArray(v)
      ? (v[v.length - 1] ?? "")
      : typeof v === "string"
        ? v
        : "";
    if (s === "") continue; // Drop empties so they don't fail Zod parse
    out[k] = s;
  }
  return out;
}

/** Build the canonical filter-query string passed to the client. */
function buildFilterQuery(raw: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const k of ["series_id", "availability", "q", "include_archived"]) {
    if (raw[k]) sp.set(k, raw[k]);
  }
  return sp.toString();
}

export default async function ArtworksListPage({ searchParams }: PageProps) {
  const raw = normalizeParams(await searchParams);

  const parsed = ListArtworksQuery.safeParse({
    ...raw,
    limit: String(INITIAL_BATCH),
    offset: "0",
  });
  const filters = parsed.success ? parsed.data : ListArtworksQuery.parse({});

  const [rows, series, mediums] = await Promise.all([
    listArtworks(filters),
    listSeries(),
    listMediums(),
  ]);

  const filterQuery = buildFilterQuery(raw);

  return (
    <main className="dash-chrome min-h-dvh px-6 py-8 max-w-editorial mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-x-6 gap-y-2 mb-6">
        <div>
          <p className="eyebrow mb-1">RKK · inventory</p>
          <h1 className="font-display text-display leading-none">
            <span className="red-word">Artworks</span>
          </h1>
        </div>
        <Link
          href="/artworks/new"
          className="font-mono text-meta border border-current px-3 py-2 hover:bg-paper-2 transition-colors"
        >
          + new
        </Link>
      </div>

      <ArtworkFilters
        series={series}
        initial={{
          series_id: filters.series_id ?? null,
          availability: (filters.availability ?? [])[0] ?? "",
          q: filters.q ?? "",
          include_archived: filters.include_archived,
        }}
      />

      <ArtworkGrid
        initialRows={rows}
        series={series}
        mediums={mediums}
        filterQuery={filterQuery}
      />
    </main>
  );
}
