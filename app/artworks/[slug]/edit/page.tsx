import Link from "next/link";
import { notFound } from "next/navigation";
import { getArtworkBySlug, listSeries } from "@/lib/inventory";
import { ArtworkForm } from "../../_components/ArtworkForm";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function EditArtworkPage({ params }: PageProps) {
  const { slug } = await params;
  const [artwork, series] = await Promise.all([
    getArtworkBySlug(slug),
    listSeries()
  ]);
  if (!artwork) notFound();
  if (artwork.is_archived === 1) {
    return (
      <main className="dash-chrome min-h-dvh px-6 py-10 max-w-editorial mx-auto">
        <p className="eyebrow mb-3">
          <Link href={`/artworks/${slug}`} className="underline">
            {artwork.inventory_number}
          </Link>{" "}
          / edit
        </p>
        <div className="border border-current p-6 max-w-reading">
          <p className="font-body">
            This artwork is archived and cannot be edited. Unarchive it
            first (Session 9 ships the unarchive UI; for now, use the API
            or restore from a prior commit on the data repo).
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="dash-chrome min-h-dvh px-6 py-10 max-w-editorial mx-auto">
      <p className="eyebrow mb-3">
        <Link href="/artworks" className="underline">
          inventory
        </Link>{" "}
        /{" "}
        <Link href={`/artworks/${slug}`} className="underline">
          {artwork.inventory_number}
        </Link>{" "}
        / edit
      </p>
      <h1 className="font-display text-display leading-none mb-8">
        Edit <span className="red-word">{artwork.title}</span>
      </h1>
      <ArtworkForm mode="edit" series={series} artwork={artwork} />
    </main>
  );
}
