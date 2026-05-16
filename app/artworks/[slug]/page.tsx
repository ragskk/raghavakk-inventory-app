import Link from "next/link";
import { notFound } from "next/navigation";
import { getArtworkBySlug, listSeries } from "@/lib/inventory";

/**
 * Artwork detail — full record view.
 *
 * Session 2 minimal: every field rendered in a stack of definition lists,
 * grouped by topic. No image gallery yet (Session 2.5 / image upload).
 * Edit / archive links live in the right rail.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

function dl(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-6 py-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="font-body">{value}</dd>
    </div>
  );
}

function priceDisplay(cents: number | null, currency: "USD" | "INR") {
  if (cents == null) return null;
  // USD stored as cents, INR stored as paise — both 100ths.
  const major = cents / 100;
  const fmt = new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency
  });
  return fmt.format(major);
}

export default async function ArtworkDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [artwork, series] = await Promise.all([
    getArtworkBySlug(slug),
    listSeries()
  ]);
  if (!artwork) notFound();

  const seriesRow = series.find((s) => s.id === artwork.series_id);

  return (
    <main className="dash-chrome min-h-dvh px-6 py-10 max-w-editorial mx-auto">
      <p className="eyebrow mb-3">
        <Link href="/artworks" className="underline">
          inventory
        </Link>{" "}
        / {artwork.inventory_number}
      </p>

      <header className="flex items-baseline justify-between flex-wrap gap-x-6 gap-y-2 mb-2">
        <h1 className="font-display text-display leading-none">
          {artwork.title}
        </h1>
        <div className="flex gap-3 font-mono text-meta">
          <Link
            href={`/artworks/${artwork.slug}/edit`}
            className="border border-current px-3 py-2"
          >
            edit
          </Link>
        </div>
      </header>

      <p className="font-mono text-meta text-muted mb-8">
        {artwork.inventory_number} — {seriesRow ? seriesRow.name : `series #${artwork.series_id}`} —{" "}
        {artwork.year_start}
        {artwork.year_end && artwork.year_end !== artwork.year_start
          ? `–${artwork.year_end}`
          : ""}
      </p>

      {artwork.is_archived === 1 && (
        <aside className="border border-current p-4 mb-8">
          <p className="eyebrow mb-1">archived</p>
          <p className="font-body">
            {artwork.archived_reason || "(no reason recorded)"}
          </p>
          <p className="font-mono text-meta text-muted mt-2">
            archived at {artwork.archived_at}
          </p>
        </aside>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
        <section>
          <h2 className="eyebrow mb-2">identity</h2>
          <dl>
            {dl("inventory #", artwork.inventory_number)}
            {dl("slug", artwork.slug)}
            {dl(
              "series",
              seriesRow ? `${seriesRow.code} — ${seriesRow.name}` : null
            )}
            {dl("edition #", artwork.edition_number)}
            {dl("AP #", artwork.ap_number)}
          </dl>
        </section>

        <section>
          <h2 className="eyebrow mb-2">dimensions</h2>
          <dl>
            {dl(
              "size (in)",
              `${artwork.height_in} × ${artwork.width_in}${
                artwork.depth_in ? ` × ${artwork.depth_in}` : ""
              }`
            )}
            {artwork.framed_height_in && artwork.framed_width_in
              ? dl(
                  "framed (in)",
                  `${artwork.framed_height_in} × ${artwork.framed_width_in}${
                    artwork.framed_depth_in
                      ? ` × ${artwork.framed_depth_in}`
                      : ""
                  }`
                )
              : null}
            {dl("weight (kg)", artwork.weight_kg)}
            {dl("materials", artwork.materials)}
          </dl>
        </section>

        <section>
          <h2 className="eyebrow mb-2">pricing</h2>
          <dl>
            {dl("USD", priceDisplay(artwork.price_usd_cents, "USD"))}
            {dl(
              "INR",
              priceDisplay(artwork.price_inr_paise, "INR")
            )}
            {dl(
              "visible — public",
              artwork.price_visible_public ? "yes" : "no"
            )}
            {dl(
              "visible — dealer",
              artwork.price_visible_dealer ? "yes" : "no"
            )}
          </dl>
        </section>

        <section>
          <h2 className="eyebrow mb-2">status</h2>
          <dl>
            {dl(
              "availability",
              artwork.availability_status.replace(/_/g, " ")
            )}
            {dl("condition", artwork.condition_status.replace(/_/g, " "))}
            {dl("website visible", artwork.website_visible ? "yes" : "no")}
            {dl("featured", artwork.featured ? "yes" : "no")}
            {dl("display order", artwork.display_order)}
          </dl>
        </section>

        {artwork.short_description ? (
          <section className="md:col-span-2">
            <h2 className="eyebrow mb-2">short description</h2>
            <p className="font-body">{artwork.short_description}</p>
          </section>
        ) : null}

        {artwork.full_description ? (
          <section className="md:col-span-2">
            <h2 className="eyebrow mb-2">full description</h2>
            <p className="font-body whitespace-pre-line">
              {artwork.full_description}
            </p>
          </section>
        ) : null}

        {artwork.artist_note ? (
          <section className="md:col-span-2">
            <h2 className="eyebrow mb-2">artist note</h2>
            <p className="font-body whitespace-pre-line">
              {artwork.artist_note}
            </p>
          </section>
        ) : null}

        {artwork.internal_note ? (
          <section className="md:col-span-2">
            <h2 className="eyebrow mb-2">
              internal note <span className="text-muted">(registrar only)</span>
            </h2>
            <p className="font-body whitespace-pre-line">
              {artwork.internal_note}
            </p>
          </section>
        ) : null}

        <section className="md:col-span-2">
          <h2 className="eyebrow mb-2">meta</h2>
          <dl>
            {dl("created", artwork.created_at)}
            {dl("updated", artwork.updated_at)}
            {dl("primary image id", artwork.primary_image_id)}
          </dl>
        </section>
      </div>
    </main>
  );
}
