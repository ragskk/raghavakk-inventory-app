import { notFound } from "next/navigation";
import {
  getArtworkBySlug,
  listSeries,
  listArtworkImages,
} from "@/lib/inventory";
import { ArtworkDetail } from "./_components/ArtworkDetail";

/**
 * Artwork detail — view + inline section editing + image upload.
 *
 * Server component fetches the read-fresh data; the client component
 * handles edit toggles per section and the upload form.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ArtworkDetailPage({ params }: PageProps) {
  const { slug } = await params;

  const artwork = await getArtworkBySlug(slug);
  if (!artwork) notFound();

  const [series, images] = await Promise.all([
    listSeries(),
    listArtworkImages(artwork.id),
  ]);

  return <ArtworkDetail artwork={artwork} series={series} images={images} />;
}
