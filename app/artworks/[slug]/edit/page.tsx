import { redirect } from "next/navigation";

/**
 * /artworks/[slug]/edit is deprecated. Editing now happens inline on the
 * detail page via per-section toggles. Redirect any saved bookmarks.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function EditRedirect({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/artworks/${slug}`);
}
