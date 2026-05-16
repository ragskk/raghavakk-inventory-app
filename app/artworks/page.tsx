import Link from "next/link";
import { listArtworks, listSeries } from "@/lib/inventory";
import { ListArtworksQuery } from "@/lib/validation/artwork";

/**
 * Artworks list — registrar overview.
 *
 * Session 2 minimal UI: title + inventory_number + series + status pills
 * + thumb-count, link to detail. Filters via URL search params so the page
 * stays a server component and bookmarks survive refresh.
 *
 * Polish (sort handles, sticky filter bar, image thumbnails, saved views)
 * lives in Session 9.
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function normalizeParams(
  raw: Record<string, string | string[] | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) out[k] = v[v.length - 1] ?? "";
    else if (typeof v === "string") out[k] = v;
  }
  return out;
}

export default async function ArtworksListPage({ searchParams }: PageProps) {
  const raw = normalizeParams(await searchParams);
  const parsed = ListArtworksQuery.safeParse(raw);
  const filters = parsed.success
    ? parsed.data
    : ListArtworksQuery.parse({});

  const [rows, series] = await Promise.all([listArtworks(filters), listSeries()]);

  const seriesById = new Map(series.map((s) => [s.id, s]));

  return (
    <main className="dash-chrome min-h-dvh px-6 py-10 max-w-editorial mx-auto">
      <p className="eyebrow mb-3">RKK / inventory</p>
      <div className="flex items-baseline justify-between flex-wrap gap-x-6 gap-y-2 mb-8">
        <h1 className="font-display text-display leading-none">
          <span className="red-word">Artworks</span>
        </h1>
        <Link
          href="/artworks/new"
          className="font-mono text-meta border border-current px-3 py-2"
        >
          new artwork
        </Link>
      </div>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 mb-8 font-mono text-meta"
      >
        <label className="flex flex-col gap-1">
          <span className="eyebrow">series</span>
          <select
            name="series_id"
            defaultValue={filters.series_id ?? ""}
            className="border border-current bg-transparent px-2 py-1 min-w-[12rem]"
          >
            <option value="">all</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">search</span>
          <input
            type="text"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="title or inventory #"
            className="border border-current bg-transparent px-2 py-1 min-w-[16rem]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">availability</span>
          <select
            name="availability"
            defaultValue={(filters.availability ?? []).join(",")}
            className="border border-current bg-transparent px-2 py-1"
          >
            <option value="">any</option>
            <option value="available">available</option>
            <option value="on_hold">on hold</option>
            <option value="reserved">reserved</option>
            <option value="sold">sold</option>
            <option value="not_for_sale">not for sale</option>
            <option value="withdrawn">withdrawn</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="include_archived"
            value="1"
            defaultChecked={filters.include_archived}
          />
          <span className="eyebrow">archived</span>
        </label>

        <button type="submit" className="border border-current px-3 py-2">
          apply
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted font-body">
          No artworks match the current filters. Try{" "}
          <Link href="/artworks" className="underline">
            clearing filters
          </Link>{" "}
          or{" "}
          <Link href="/artworks/new" className="underline">
            create the first artwork
          </Link>
          .
        </p>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>inventory #</th>
              <th>title</th>
              <th>series</th>
              <th>year</th>
              <th>availability</th>
              <th>condition</th>
              <th className="text-right">images</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = seriesById.get(r.series_id);
              const archived = r.is_archived === 1;
              return (
                <tr key={r.id} className={archived ? "opacity-50" : undefined}>
                  <td className="font-mono text-meta">
                    <Link href={`/artworks/${r.slug}`} className="underline">
                      {r.inventory_number}
                    </Link>
                  </td>
                  <td>{r.title}</td>
                  <td className="font-mono text-meta">
                    {s ? `${s.code} ${s.name}` : `#${r.series_id}`}
                  </td>
                  <td className="font-mono text-meta">{r.year_start}</td>
                  <td>
                    <span
                      className={`pill ${
                        r.availability_status === "available" ? "active" : ""
                      } ${r.availability_status === "sold" ? "red" : ""}`}
                    >
                      {r.availability_status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>
                    <span className="pill">
                      {r.condition_status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="text-right font-mono text-meta">
                    {r.image_count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-muted font-mono text-meta">
        {rows.length} result{rows.length === 1 ? "" : "s"} — limit{" "}
        {filters.limit}, offset {filters.offset}
      </p>
    </main>
  );
}
