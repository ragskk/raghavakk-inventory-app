"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AVAILABILITY_STATUSES,
  CONDITION_STATUSES,
  INVENTORY_NUMBER_RE,
  type AvailabilityStatus,
  type ConditionStatus
} from "@/lib/validation/artwork";
import type { ArtworkRow, SeriesRow } from "@/lib/inventory";

/**
 * Shared form for create + edit.
 *
 * Long-form one-page layout (the HANDOFF's recommended default; can be
 * swapped for a stepped flow in a later session without changing the API).
 * Schema-minimum required: series, title, year_start, height_in, width_in.
 * Everything else optional.
 *
 * Submit posts JSON to /api/artworks (create) or PATCHes
 * /api/artworks/[slug] (edit). The body strips empty strings to null so
 * the server-side Zod sees a clean shape.
 *
 * On create success, the API redirects us to the new artwork's detail page
 * (we resolve the slug from the response). On edit success, we navigate
 * back to detail with router.refresh() so the server data is fresh.
 */

interface Props {
  mode: "create" | "edit";
  series: SeriesRow[];
  artwork?: ArtworkRow;
}

type FieldValue = string | number | boolean | null;

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function intOrNull(v: FormDataEntryValue | null): number | null {
  const s = strOrNull(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = strOrNull(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function moneyToMinorUnits(
  v: FormDataEntryValue | null
): number | null {
  // User enters e.g. "12500.50" — store as 1250050. Empty → null.
  const s = strOrNull(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function minorUnitsToMoney(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function ArtworkForm({ mode, series, artwork }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreate = mode === "create";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);

    // Booleans come through as "on" / missing. Normalize to 0/1.
    const flag = (k: string) => (fd.get(k) === "on" ? 1 : 0);

    const body: Record<string, FieldValue> = {
      title: strOrNull(fd.get("title")),
      year_start: intOrNull(fd.get("year_start")),
      year_end: intOrNull(fd.get("year_end")),
      height_in: numOrNull(fd.get("height_in")),
      width_in: numOrNull(fd.get("width_in")),
      depth_in: numOrNull(fd.get("depth_in")),
      framed_height_in: numOrNull(fd.get("framed_height_in")),
      framed_width_in: numOrNull(fd.get("framed_width_in")),
      framed_depth_in: numOrNull(fd.get("framed_depth_in")),
      weight_kg: numOrNull(fd.get("weight_kg")),
      materials: strOrNull(fd.get("materials")),
      short_description: strOrNull(fd.get("short_description")),
      full_description: strOrNull(fd.get("full_description")),
      artist_note: strOrNull(fd.get("artist_note")),
      internal_note: strOrNull(fd.get("internal_note")),
      price_usd_cents: moneyToMinorUnits(fd.get("price_usd")),
      price_inr_paise: moneyToMinorUnits(fd.get("price_inr")),
      price_visible_public: flag("price_visible_public"),
      price_visible_dealer: flag("price_visible_dealer"),
      availability_status: strOrNull(fd.get("availability_status")),
      condition_status: strOrNull(fd.get("condition_status")),
      website_visible: flag("website_visible"),
      featured: flag("featured"),
      display_order: intOrNull(fd.get("display_order")),
      seo_title: strOrNull(fd.get("seo_title")),
      seo_description: strOrNull(fd.get("seo_description")),
      edition_number: intOrNull(fd.get("edition_number")),
      ap_number: intOrNull(fd.get("ap_number")),
      artist_proof: flag("artist_proof")
    };

    if (isCreate) {
      body.series_id = intOrNull(fd.get("series_id"));
      const override = strOrNull(fd.get("inventory_number_override"));
      if (override) body.inventory_number_override = override;
    }

    // Drop undefined entries so the patch endpoint doesn't see them.
    if (!isCreate) {
      for (const k of Object.keys(body)) {
        if (body[k] === null && k !== "primary_image_id") {
          // Send nulls — PATCH treats them as "set to null". That's the
          // behavior we want for clearing optional fields. Keep all keys.
        }
      }
    }

    try {
      const url = isCreate
        ? "/api/artworks"
        : `/api/artworks/${artwork!.slug}`;
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = json?.details
          ? JSON.stringify(json.details)
          : json?.error || "request failed";
        throw new Error(`${res.status}: ${detail}`);
      }
      const newSlug: string = json.artwork.slug;
      router.push(`/artworks/${newSlug}`);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setSubmitting(false);
    }
  }

  // Initial values from existing artwork (edit mode)
  const v = artwork;

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6"
    >
      <Section title="identity" full>
        {isCreate && (
          <Field label="series *">
            <select
              name="series_id"
              required
              defaultValue=""
              className="w-full border border-current bg-transparent px-2 py-1"
            >
              <option value="" disabled>
                — choose —
              </option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name} (next: {s.next_seq})
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="title *">
          <input
            type="text"
            name="title"
            required
            defaultValue={v?.title ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>

        {isCreate && (
          <Field
            label={`inventory # (optional override — format: ${INVENTORY_NUMBER_RE.source})`}
          >
            <input
              type="text"
              name="inventory_number_override"
              placeholder="RKK-IB-014 — leave blank to auto-generate"
              className="w-full border border-current bg-transparent px-2 py-1 font-mono text-meta"
            />
          </Field>
        )}

        {!isCreate && (
          <Field label="inventory # (immutable)">
            <input
              type="text"
              value={v?.inventory_number ?? ""}
              readOnly
              disabled
              className="w-full border border-current bg-transparent px-2 py-1 font-mono text-meta opacity-60"
            />
          </Field>
        )}
      </Section>

      <Section title="edition / AP">
        <Field label="edition number">
          <input
            type="number"
            name="edition_number"
            min={1}
            defaultValue={v?.edition_number ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="artist proof">
          <input
            type="checkbox"
            name="artist_proof"
            defaultChecked={v?.artist_proof === 1}
          />
        </Field>
        <Field label="AP number">
          <input
            type="number"
            name="ap_number"
            min={1}
            defaultValue={v?.ap_number ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
      </Section>

      <Section title="year">
        <Field label="year start *">
          <input
            type="number"
            name="year_start"
            required
            min={1900}
            max={2100}
            defaultValue={v?.year_start ?? new Date().getFullYear()}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="year end">
          <input
            type="number"
            name="year_end"
            min={1900}
            max={2100}
            defaultValue={v?.year_end ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="materials">
          <input
            type="text"
            name="materials"
            defaultValue={v?.materials ?? ""}
            placeholder="e.g. oil on linen with gold leaf"
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
      </Section>

      <Section title="dimensions (in)" full>
        <Field label="height *">
          <input
            type="number"
            step="0.01"
            name="height_in"
            required
            min={0}
            defaultValue={v?.height_in ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="width *">
          <input
            type="number"
            step="0.01"
            name="width_in"
            required
            min={0}
            defaultValue={v?.width_in ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="depth">
          <input
            type="number"
            step="0.01"
            name="depth_in"
            min={0}
            defaultValue={v?.depth_in ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="framed h">
          <input
            type="number"
            step="0.01"
            name="framed_height_in"
            min={0}
            defaultValue={v?.framed_height_in ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="framed w">
          <input
            type="number"
            step="0.01"
            name="framed_width_in"
            min={0}
            defaultValue={v?.framed_width_in ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="framed d">
          <input
            type="number"
            step="0.01"
            name="framed_depth_in"
            min={0}
            defaultValue={v?.framed_depth_in ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="weight (kg)">
          <input
            type="number"
            step="0.001"
            name="weight_kg"
            min={0}
            defaultValue={v?.weight_kg ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
      </Section>

      <Section title="pricing">
        <Field label="USD (whole dollars + cents)">
          <input
            type="number"
            step="0.01"
            name="price_usd"
            min={0}
            defaultValue={minorUnitsToMoney(v?.price_usd_cents ?? null)}
            placeholder="12500.00"
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="INR (whole rupees + paise)">
          <input
            type="number"
            step="0.01"
            name="price_inr"
            min={0}
            defaultValue={minorUnitsToMoney(v?.price_inr_paise ?? null)}
            placeholder="1000000.00"
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="visible to public">
          <input
            type="checkbox"
            name="price_visible_public"
            defaultChecked={v?.price_visible_public === 1}
          />
        </Field>
        <Field label="visible to dealer">
          <input
            type="checkbox"
            name="price_visible_dealer"
            defaultChecked={(v?.price_visible_dealer ?? 1) === 1}
          />
        </Field>
      </Section>

      <Section title="status">
        <Field label="availability">
          <select
            name="availability_status"
            defaultValue={v?.availability_status ?? "available"}
            className="w-full border border-current bg-transparent px-2 py-1"
          >
            {AVAILABILITY_STATUSES.map((s: AvailabilityStatus) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="condition">
          <select
            name="condition_status"
            defaultValue={v?.condition_status ?? "good"}
            className="w-full border border-current bg-transparent px-2 py-1"
          >
            {CONDITION_STATUSES.map((s: ConditionStatus) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="public visibility">
        <Field label="show on website">
          <input
            type="checkbox"
            name="website_visible"
            defaultChecked={v?.website_visible === 1}
          />
        </Field>
        <Field label="featured">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={v?.featured === 1}
          />
        </Field>
        <Field label="display order">
          <input
            type="number"
            name="display_order"
            defaultValue={v?.display_order ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="SEO title">
          <input
            type="text"
            name="seo_title"
            defaultValue={v?.seo_title ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="SEO description">
          <textarea
            name="seo_description"
            rows={2}
            defaultValue={v?.seo_description ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
      </Section>

      <Section title="descriptions" full>
        <Field label="short — one-liner for cards and labels">
          <textarea
            name="short_description"
            rows={2}
            defaultValue={v?.short_description ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="full — for the website and the dossier">
          <textarea
            name="full_description"
            rows={6}
            defaultValue={v?.full_description ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="artist note — public-facing first-person">
          <textarea
            name="artist_note"
            rows={4}
            defaultValue={v?.artist_note ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
        <Field label="internal note — registrar-only, never in shares">
          <textarea
            name="internal_note"
            rows={3}
            defaultValue={v?.internal_note ?? ""}
            className="w-full border border-current bg-transparent px-2 py-1"
          />
        </Field>
      </Section>

      <div className="md:col-span-2 flex items-center gap-4 mt-4">
        <button
          type="submit"
          disabled={submitting}
          className="border border-current px-4 py-2 font-mono text-meta disabled:opacity-50"
        >
          {submitting ? "saving…" : isCreate ? "create artwork" : "save changes"}
        </button>
        {error && (
          <p className="font-mono text-meta text-[var(--red)]">
            error: {error}
          </p>
        )}
      </div>
    </form>
  );
}

function Section({
  title,
  full,
  children
}: {
  title: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={full ? "md:col-span-2" : undefined}>
      <h2 className="eyebrow mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children
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
