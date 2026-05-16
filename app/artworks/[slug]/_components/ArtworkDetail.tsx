"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AVAILABILITY_STATUSES,
  CONDITION_STATUSES,
  type AvailabilityStatus,
  type ConditionStatus,
} from "@/lib/validation/artwork";
import type {
  ArtworkRow,
  SeriesRow,
  ArtworkImageRow,
} from "@/lib/inventory";

/**
 * Editable artwork detail. View mode renders prose-style sections; each
 * section has its own "edit" toggle that swaps the view for inline inputs
 * scoped to that section's fields. Save calls PATCH /api/artworks/[slug]
 * with only those fields. No standalone /edit page.
 *
 * Image upload sits at the top — multipart POST to
 * /api/artwork-images/[artwork_id], server-side sharp pipeline normalizes
 * to 3 JPEG variants regardless of input format.
 */

interface Props {
  artwork: ArtworkRow;
  series: SeriesRow[];
  images: ArtworkImageRow[];
}

const IMAGE_TYPES = [
  "main",
  "detail",
  "process",
  "studio",
  "installation",
  "mockup",
] as const;

function centsToMoney(v: number | null | undefined): string {
  if (v == null) return "";
  return (v / 100).toFixed(2);
}

function moneyToCents(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function formatPrice(cents: number | null, currency: "USD" | "INR"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function nullableTrim(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(s: string): number | null {
  const n = numOrNull(s);
  if (n == null) return null;
  return Math.trunc(n);
}

export function ArtworkDetail({
  artwork: initial,
  series,
  images: initialImages,
}: Props) {
  const router = useRouter();
  const [artwork, setArtwork] = useState<ArtworkRow>(initial);
  const [images, setImages] = useState<ArtworkImageRow[]>(initialImages);

  const seriesRow = series.find((s) => s.id === artwork.series_id);

  const patch = useCallback(
    async (body: Record<string, unknown>): Promise<ArtworkRow> => {
      const res = await fetch(`/api/artworks/${artwork.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = json?.details
          ? JSON.stringify(json.details)
          : json?.error || "request failed";
        throw new Error(`${res.status}: ${detail}`);
      }
      setArtwork(json.artwork);
      router.refresh();
      return json.artwork;
    },
    [artwork.slug, router],
  );

  const onImageUploaded = useCallback(
    (newImage: ArtworkImageRow, updatedArtwork: ArtworkRow | null) => {
      setImages((prev) => [...prev, newImage]);
      if (updatedArtwork) setArtwork(updatedArtwork);
      router.refresh();
    },
    [router],
  );

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
      </header>

      <p className="font-mono text-meta text-muted mb-8">
        {artwork.inventory_number} —{" "}
        {seriesRow ? seriesRow.name : `series #${artwork.series_id}`} —{" "}
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
        </aside>
      )}

      <ImageSection
        artwork={artwork}
        images={images}
        disabled={artwork.is_archived === 1}
        onUploaded={onImageUploaded}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 mt-10">
        <IdentitySection artwork={artwork} seriesRow={seriesRow} patch={patch} />
        <EditionSection artwork={artwork} patch={patch} />
        <YearSection artwork={artwork} patch={patch} />
        <DimensionsSection artwork={artwork} patch={patch} />
        <PricingSection artwork={artwork} patch={patch} />
        <StatusSection artwork={artwork} patch={patch} />
        <VisibilitySection artwork={artwork} patch={patch} />
        <DescriptionsSection artwork={artwork} patch={patch} />

        <section className="md:col-span-2">
          <h2 className="eyebrow mb-2">meta</h2>
          <dl>
            <DLRow label="slug" value={artwork.slug} />
            <DLRow label="created" value={artwork.created_at} />
            <DLRow label="updated" value={artwork.updated_at} />
            <DLRow label="primary image id" value={artwork.primary_image_id} />
          </dl>
        </section>
      </div>
    </main>
  );
}

// ===========================================================================
// Image section + uploader
// ===========================================================================

function ImageSection({
  artwork,
  images,
  disabled,
  onUploaded,
}: {
  artwork: ArtworkRow;
  images: ArtworkImageRow[];
  disabled: boolean;
  onUploaded: (img: ArtworkImageRow, art: ArtworkRow | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageType, setImageType] =
    useState<(typeof IMAGE_TYPES)[number]>("main");
  const [caption, setCaption] = useState("");
  const [credit, setCredit] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("pick a file first");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("image_type", imageType);
      if (caption.trim()) fd.append("caption", caption.trim());
      if (credit.trim()) fd.append("credit", credit.trim());

      const res = await fetch(`/api/artwork-images/${artwork.id}`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
      }

      const newImage: ArtworkImageRow = {
        id: json.image_id,
        artwork_id: json.artwork_id,
        image_type: imageType,
        source_url: null,
        caption: caption.trim() || null,
        alt_text: null,
        credit: credit.trim() || null,
        display_order: images.length,
        visibility: "internal",
        created_at: new Date().toISOString(),
      };
      onUploaded(newImage, null);

      // reset form
      if (fileRef.current) fileRef.current.value = "";
      setCaption("");
      setCredit("");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section>
      <h2 className="eyebrow mb-3">images</h2>

      {images.length === 0 ? (
        <p className="text-muted font-body mb-4">No images yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {images.map((img) => {
            const isPrimary = artwork.primary_image_id === img.id;
            return (
              <figure key={img.id} className="border border-current">
                {isPrimary ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/work-image/${artwork.id}/thumb`}
                    alt={img.alt_text || img.caption || ""}
                    loading="lazy"
                    decoding="async"
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="w-full aspect-square bg-paper-shade flex items-center justify-center font-mono text-meta text-muted text-center px-2"
                  >
                    no thumb in v1 — only primary is rendered
                  </div>
                )}
                <figcaption className="font-mono text-meta px-2 py-1 flex items-center justify-between gap-2">
                  <span>
                    {img.image_type}
                    {isPrimary ? " · primary" : ""}
                  </span>
                  <span className="text-muted">#{img.id}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {!disabled && (
        <form
          onSubmit={handleUpload}
          className="border border-current p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="flex flex-col gap-1">
              <span className="eyebrow">file</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                disabled={uploading}
                className="font-mono text-meta"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">type</span>
              <select
                value={imageType}
                onChange={(e) =>
                  setImageType(e.target.value as (typeof IMAGE_TYPES)[number])
                }
                disabled={uploading}
                className="border border-current bg-transparent px-2 py-1"
              >
                {IMAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">credit (optional)</span>
              <input
                type="text"
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                placeholder="Photo: …"
                disabled={uploading}
                className="border border-current bg-transparent px-2 py-1"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="border border-current px-4 py-2 font-mono text-meta disabled:opacity-50"
          >
            {uploading ? "processing…" : "upload"}
          </button>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="eyebrow">caption (optional)</span>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={uploading}
              className="border border-current bg-transparent px-2 py-1"
            />
          </label>

          {error && (
            <p className="font-mono text-meta text-[var(--red)] sm:col-span-2">
              error: {error}
            </p>
          )}

          <p className="font-mono text-meta text-muted sm:col-span-2">
            Accepts JPEG / PNG / TIFF / WebP / AVIF / GIF / HEIC. Server
            normalizes to 3 JPEG variants. Max ~4.5 MB on hobby Vercel
            tier — convert RAW / huge TIFF locally before upload.
          </p>
        </form>
      )}
    </section>
  );
}

// ===========================================================================
// Editable section primitive
// ===========================================================================

function EditableSection({
  title,
  full,
  children,
  edit,
  onSave,
  onAfterSave,
  archived,
}: {
  title: string;
  full?: boolean;
  children: React.ReactNode;
  edit: (close: () => void) => React.ReactNode;
  onSave?: () => Promise<void>;
  onAfterSave?: () => void;
  archived?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!onSave) {
      setEditing(false);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave();
      setEditing(false);
      onAfterSave?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={full ? "md:col-span-2" : undefined}>
      <header className="flex items-center justify-between mb-2 gap-3">
        <h2 className="eyebrow">{title}</h2>
        {!archived && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing((v) => !v);
            }}
            disabled={saving}
            className="font-mono text-meta underline disabled:opacity-50"
          >
            {editing ? "cancel" : "edit"}
          </button>
        )}
      </header>

      {editing ? (
        <div className="space-y-3">
          {edit(() => setEditing(false))}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="border border-current px-3 py-1 font-mono text-meta disabled:opacity-50"
            >
              {saving ? "saving…" : "save"}
            </button>
            {error && (
              <p className="font-mono text-meta text-[var(--red)]">
                error: {error}
              </p>
            )}
          </div>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function DLRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-6 py-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="font-body">
        {value === null || value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-meta text-muted">{label}</span>
      {children}
    </label>
  );
}

// ===========================================================================
// Sections
// ===========================================================================

function IdentitySection({
  artwork,
  seriesRow,
  patch,
}: {
  artwork: ArtworkRow;
  seriesRow: SeriesRow | undefined;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [title, setTitle] = useState(artwork.title);

  return (
    <EditableSection
      title="identity"
      onSave={async () => {
        await patch({ title: title.trim() });
      }}
      onAfterSave={() => setTitle(artwork.title)}
      edit={() => (
        <>
          <FieldLabel label="title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <p className="font-mono text-meta text-muted">
            inventory # and slug are immutable — set at creation, used
            everywhere downstream.
          </p>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow label="title" value={artwork.title} />
        <DLRow label="inventory #" value={artwork.inventory_number} />
        <DLRow
          label="series"
          value={
            seriesRow ? `${seriesRow.code} — ${seriesRow.name}` : null
          }
        />
      </dl>
    </EditableSection>
  );
}

function EditionSection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [editionNumber, setEditionNumber] = useState(
    artwork.edition_number?.toString() ?? "",
  );
  const [artistProof, setArtistProof] = useState(artwork.artist_proof === 1);
  const [apNumber, setApNumber] = useState(
    artwork.ap_number?.toString() ?? "",
  );

  return (
    <EditableSection
      title="edition / AP"
      onSave={async () => {
        await patch({
          edition_number: intOrNull(editionNumber),
          artist_proof: artistProof ? 1 : 0,
          ap_number: intOrNull(apNumber),
        });
      }}
      edit={() => (
        <>
          <FieldLabel label="edition number">
            <input
              type="number"
              min={1}
              value={editionNumber}
              onChange={(e) => setEditionNumber(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="artist proof">
            <input
              type="checkbox"
              checked={artistProof}
              onChange={(e) => setArtistProof(e.target.checked)}
            />
          </FieldLabel>
          <FieldLabel label="AP number">
            <input
              type="number"
              min={1}
              value={apNumber}
              onChange={(e) => setApNumber(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow label="edition #" value={artwork.edition_number} />
        <DLRow label="artist proof" value={artwork.artist_proof ? "yes" : "no"} />
        <DLRow label="AP #" value={artwork.ap_number} />
      </dl>
    </EditableSection>
  );
}

function YearSection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [yearStart, setYearStart] = useState(artwork.year_start.toString());
  const [yearEnd, setYearEnd] = useState(
    artwork.year_end?.toString() ?? "",
  );

  return (
    <EditableSection
      title="year"
      onSave={async () => {
        const body: Record<string, unknown> = {};
        const ys = intOrNull(yearStart);
        if (ys != null) body.year_start = ys;
        body.year_end = intOrNull(yearEnd);
        await patch(body);
      }}
      edit={() => (
        <>
          <FieldLabel label="year start *">
            <input
              type="number"
              min={1900}
              max={2100}
              value={yearStart}
              onChange={(e) => setYearStart(e.target.value)}
              required
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="year end">
            <input
              type="number"
              min={1900}
              max={2100}
              value={yearEnd}
              onChange={(e) => setYearEnd(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow label="year start" value={artwork.year_start} />
        <DLRow label="year end" value={artwork.year_end} />
      </dl>
    </EditableSection>
  );
}

function DimensionsSection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [heightIn, setHeightIn] = useState(artwork.height_in.toString());
  const [widthIn, setWidthIn] = useState(artwork.width_in.toString());
  const [depthIn, setDepthIn] = useState(
    artwork.depth_in?.toString() ?? "",
  );
  const [framedH, setFramedH] = useState(
    artwork.framed_height_in?.toString() ?? "",
  );
  const [framedW, setFramedW] = useState(
    artwork.framed_width_in?.toString() ?? "",
  );
  const [framedD, setFramedD] = useState(
    artwork.framed_depth_in?.toString() ?? "",
  );
  const [weightKg, setWeightKg] = useState(
    artwork.weight_kg?.toString() ?? "",
  );
  const [materials, setMaterials] = useState(artwork.materials ?? "");

  return (
    <EditableSection
      title="dimensions (in)"
      full
      onSave={async () => {
        const body: Record<string, unknown> = {};
        const h = numOrNull(heightIn);
        const w = numOrNull(widthIn);
        if (h != null) body.height_in = h;
        if (w != null) body.width_in = w;
        body.depth_in = numOrNull(depthIn);
        body.framed_height_in = numOrNull(framedH);
        body.framed_width_in = numOrNull(framedW);
        body.framed_depth_in = numOrNull(framedD);
        body.weight_kg = numOrNull(weightKg);
        body.materials = nullableTrim(materials);
        await patch(body);
      }}
      edit={() => (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <FieldLabel label="height *">
            <input
              type="number"
              step="0.01"
              value={heightIn}
              onChange={(e) => setHeightIn(e.target.value)}
              required
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="width *">
            <input
              type="number"
              step="0.01"
              value={widthIn}
              onChange={(e) => setWidthIn(e.target.value)}
              required
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="depth">
            <input
              type="number"
              step="0.01"
              value={depthIn}
              onChange={(e) => setDepthIn(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="framed h">
            <input
              type="number"
              step="0.01"
              value={framedH}
              onChange={(e) => setFramedH(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="framed w">
            <input
              type="number"
              step="0.01"
              value={framedW}
              onChange={(e) => setFramedW(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="framed d">
            <input
              type="number"
              step="0.01"
              value={framedD}
              onChange={(e) => setFramedD(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="weight (kg)">
            <input
              type="number"
              step="0.001"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="materials">
            <input
              type="text"
              value={materials}
              onChange={(e) => setMaterials(e.target.value)}
              placeholder="e.g. oil on linen with gold leaf"
              className="w-full border border-current bg-transparent px-2 py-1 sm:col-span-2"
            />
          </FieldLabel>
        </div>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow
          label="size (in)"
          value={
            artwork.depth_in
              ? `${artwork.height_in} × ${artwork.width_in} × ${artwork.depth_in}`
              : `${artwork.height_in} × ${artwork.width_in}`
          }
        />
        {artwork.framed_height_in && artwork.framed_width_in ? (
          <DLRow
            label="framed (in)"
            value={
              artwork.framed_depth_in
                ? `${artwork.framed_height_in} × ${artwork.framed_width_in} × ${artwork.framed_depth_in}`
                : `${artwork.framed_height_in} × ${artwork.framed_width_in}`
            }
          />
        ) : null}
        <DLRow label="weight (kg)" value={artwork.weight_kg} />
        <DLRow label="materials" value={artwork.materials} />
      </dl>
    </EditableSection>
  );
}

function PricingSection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [usd, setUsd] = useState(centsToMoney(artwork.price_usd_cents));
  const [inr, setInr] = useState(centsToMoney(artwork.price_inr_paise));
  const [visPublic, setVisPublic] = useState(
    artwork.price_visible_public === 1,
  );
  const [visDealer, setVisDealer] = useState(
    artwork.price_visible_dealer === 1,
  );

  return (
    <EditableSection
      title="pricing"
      onSave={async () => {
        await patch({
          price_usd_cents: moneyToCents(usd),
          price_inr_paise: moneyToCents(inr),
          price_visible_public: visPublic ? 1 : 0,
          price_visible_dealer: visDealer ? 1 : 0,
        });
      }}
      edit={() => (
        <>
          <FieldLabel label="USD (dollars . cents)">
            <input
              type="number"
              step="0.01"
              value={usd}
              onChange={(e) => setUsd(e.target.value)}
              placeholder="12500.00"
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="INR (rupees . paise)">
            <input
              type="number"
              step="0.01"
              value={inr}
              onChange={(e) => setInr(e.target.value)}
              placeholder="1000000.00"
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="visible to public">
            <input
              type="checkbox"
              checked={visPublic}
              onChange={(e) => setVisPublic(e.target.checked)}
            />
          </FieldLabel>
          <FieldLabel label="visible to dealer">
            <input
              type="checkbox"
              checked={visDealer}
              onChange={(e) => setVisDealer(e.target.checked)}
            />
          </FieldLabel>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow label="USD" value={formatPrice(artwork.price_usd_cents, "USD")} />
        <DLRow label="INR" value={formatPrice(artwork.price_inr_paise, "INR")} />
        <DLRow
          label="visible — public"
          value={artwork.price_visible_public ? "yes" : "no"}
        />
        <DLRow
          label="visible — dealer"
          value={artwork.price_visible_dealer ? "yes" : "no"}
        />
      </dl>
    </EditableSection>
  );
}

function StatusSection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [availability, setAvailability] = useState<AvailabilityStatus>(
    artwork.availability_status as AvailabilityStatus,
  );
  const [condition, setCondition] = useState<ConditionStatus>(
    artwork.condition_status as ConditionStatus,
  );

  return (
    <EditableSection
      title="status"
      onSave={async () => {
        await patch({
          availability_status: availability,
          condition_status: condition,
        });
      }}
      edit={() => (
        <>
          <FieldLabel label="availability">
            <select
              value={availability}
              onChange={(e) =>
                setAvailability(e.target.value as AvailabilityStatus)
              }
              className="w-full border border-current bg-transparent px-2 py-1"
            >
              {AVAILABILITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="condition">
            <select
              value={condition}
              onChange={(e) =>
                setCondition(e.target.value as ConditionStatus)
              }
              className="w-full border border-current bg-transparent px-2 py-1"
            >
              {CONDITION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </FieldLabel>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow
          label="availability"
          value={artwork.availability_status.replace(/_/g, " ")}
        />
        <DLRow
          label="condition"
          value={artwork.condition_status.replace(/_/g, " ")}
        />
      </dl>
    </EditableSection>
  );
}

function VisibilitySection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [websiteVisible, setWebsiteVisible] = useState(
    artwork.website_visible === 1,
  );
  const [featured, setFeatured] = useState(artwork.featured === 1);
  const [displayOrder, setDisplayOrder] = useState(
    artwork.display_order?.toString() ?? "",
  );
  const [seoTitle, setSeoTitle] = useState(artwork.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(
    artwork.seo_description ?? "",
  );

  return (
    <EditableSection
      title="public visibility"
      onSave={async () => {
        await patch({
          website_visible: websiteVisible ? 1 : 0,
          featured: featured ? 1 : 0,
          display_order: intOrNull(displayOrder),
          seo_title: nullableTrim(seoTitle),
          seo_description: nullableTrim(seoDescription),
        });
      }}
      edit={() => (
        <>
          <FieldLabel label="show on website">
            <input
              type="checkbox"
              checked={websiteVisible}
              onChange={(e) => setWebsiteVisible(e.target.checked)}
            />
          </FieldLabel>
          <FieldLabel label="featured">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
            />
          </FieldLabel>
          <FieldLabel label="display order">
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="SEO title">
            <input
              type="text"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="SEO description">
            <textarea
              rows={2}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl>
        <DLRow
          label="show on website"
          value={artwork.website_visible ? "yes" : "no"}
        />
        <DLRow label="featured" value={artwork.featured ? "yes" : "no"} />
        <DLRow label="display order" value={artwork.display_order} />
        <DLRow label="SEO title" value={artwork.seo_title} />
        <DLRow label="SEO description" value={artwork.seo_description} />
      </dl>
    </EditableSection>
  );
}

function DescriptionsSection({
  artwork,
  patch,
}: {
  artwork: ArtworkRow;
  patch: (body: Record<string, unknown>) => Promise<ArtworkRow>;
}) {
  const [shortDesc, setShortDesc] = useState(artwork.short_description ?? "");
  const [fullDesc, setFullDesc] = useState(artwork.full_description ?? "");
  const [artistNote, setArtistNote] = useState(artwork.artist_note ?? "");
  const [internalNote, setInternalNote] = useState(artwork.internal_note ?? "");

  return (
    <EditableSection
      title="descriptions"
      full
      onSave={async () => {
        await patch({
          short_description: nullableTrim(shortDesc),
          full_description: nullableTrim(fullDesc),
          artist_note: nullableTrim(artistNote),
          internal_note: nullableTrim(internalNote),
        });
      }}
      edit={() => (
        <>
          <FieldLabel label="short — one-liner for cards & labels">
            <textarea
              rows={2}
              value={shortDesc}
              onChange={(e) => setShortDesc(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="full — for website & dossier">
            <textarea
              rows={6}
              value={fullDesc}
              onChange={(e) => setFullDesc(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="artist note — public, first-person">
            <textarea
              rows={4}
              value={artistNote}
              onChange={(e) => setArtistNote(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
          <FieldLabel label="internal note — registrar-only, never shared">
            <textarea
              rows={3}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              className="w-full border border-current bg-transparent px-2 py-1"
            />
          </FieldLabel>
        </>
      )}
      archived={artwork.is_archived === 1}
    >
      <dl className="space-y-3">
        {artwork.short_description && (
          <div>
            <dt className="eyebrow">short</dt>
            <dd className="font-body">{artwork.short_description}</dd>
          </div>
        )}
        {artwork.full_description && (
          <div>
            <dt className="eyebrow">full</dt>
            <dd className="font-body whitespace-pre-line">
              {artwork.full_description}
            </dd>
          </div>
        )}
        {artwork.artist_note && (
          <div>
            <dt className="eyebrow">artist note</dt>
            <dd className="font-body whitespace-pre-line">
              {artwork.artist_note}
            </dd>
          </div>
        )}
        {artwork.internal_note && (
          <div>
            <dt className="eyebrow">
              internal note{" "}
              <span className="text-muted">(registrar only)</span>
            </dt>
            <dd className="font-body whitespace-pre-line">
              {artwork.internal_note}
            </dd>
          </div>
        )}
        {!artwork.short_description &&
          !artwork.full_description &&
          !artwork.artist_note &&
          !artwork.internal_note && (
            <p className="text-muted font-body">No descriptions yet.</p>
          )}
      </dl>
    </EditableSection>
  );
}
