import Link from "next/link";
import { listSeries } from "@/lib/inventory";
import { ArtworkForm } from "../_components/ArtworkForm";

/**
 * Create form. Server component fetches series (for the dropdown), passes
 * to the client form. If no series exist yet, render a stub message
 * pointing to the seed step — until Session 3 ships series CRUD, the only
 * way to make a series is via POST /api/series.
 */
export default async function NewArtworkPage() {
  const series = await listSeries();

  return (
    <main className="dash-chrome min-h-dvh px-6 py-10 max-w-editorial mx-auto">
      <p className="eyebrow mb-3">
        <Link href="/artworks" className="underline">
          inventory
        </Link>{" "}
        / new
      </p>
      <h1 className="font-display text-display leading-none mb-8">
        New <span className="red-word">artwork</span>
      </h1>

      {series.length === 0 ? (
        <div className="border border-current p-6 max-w-reading">
          <p className="font-body mb-3">
            No series exist yet. An artwork must belong to a series.
          </p>
          <p className="font-mono text-meta text-muted">
            Seed a series with{" "}
            <code className="text-[var(--ink)]">POST /api/series</code> —{" "}
            full series CRUD lands in Session 3.
          </p>
          <p className="font-mono text-meta mt-3">
            Example body:{" "}
            <code className="text-[var(--ink)]">
              {
                '{"code":"IB","slug":"impossible-bouquet","name":"The Impossible Bouquet"}'
              }
            </code>
          </p>
        </div>
      ) : (
        <ArtworkForm mode="create" series={series} />
      )}
    </main>
  );
}
