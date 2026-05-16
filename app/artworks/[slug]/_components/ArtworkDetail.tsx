"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { ArtworkThumb } from "../../_components/ArtworkThumb";

/* ---------------------------------------------------------------------------
 * Artwork detail — compact, inline-editable.
 *
 * Every value is click-to-edit. Auto-save on blur (text/number) or change
 * (toggle/select). Esc cancels. Cmd+Enter saves longtext. Global ticker
 * top-right shows last save state.
 *
 * Image area: hero + horizontal thumb strip + drag-drop zone. No separate
 * "edit images" page — drop a file, server normalizes via sharp pipeline.
 *
 * Layout: 1 column. Hero up top. Pills row for status. Field sections
 * below in a tight 2-up grid that collapses to 1-up on narrow viewports.
 * ------------------------------------------------------------------------- */

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

const AVAIL_TONE: Record<AvailabilityStatus, string> = {
  available: "bg-green-100 text-green-900 border-green-300",
  on_hold: "bg-amber-100 text-amber-900 border-amber-300",
  reserved: "bg-amber-100 text-amber-900 border-amber-300",
  sold: "bg-rose-100 text-rose-900 border-rose-300",
  not_for_sale: "bg-stone-200 text-stone-700 border-stone-400",
  withdrawn: "bg-stone-200 text-stone-700 border-stone-400",
};

const CONDITION_TONE: Record<ConditionStatus, string> = {
  pristine: "bg-emerald-100 text-emerald-900 border-emerald-300",
  good: "bg-green-100 text-green-900 border-green-300",
  fair: "bg-yellow-100 text-yellow-900 border-yellow-300",
  needs_attention: "bg-orange-100 text-orange-900 border-orange-300",
  damaged: "bg-rose-100 text-rose-900 border-rose-300",
  lost: "bg-stone-300 text-stone-800 border-stone-400",
  destroyed: "bg-stone-300 text-stone-800 border-stone-400",
};

/* ============================================================================
 * Save status ticker
 * ========================================================================= */

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

function SaveTicker({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return (
      <span className="font-mono text-meta text-muted inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        saving…
      </span>
    );
  }
  if (state.kind === "saved") {
    return (
      <span className="font-mono text-meta text-muted inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        saved
      </span>
    );
  }
  return (
    <span className="font-mono text-meta text-[var(--red)] inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      error: {state.message}
    </span>
  );
}

/* ============================================================================
 * InlineField — the click-to-edit primitive
 * ========================================================================= */

type InlineFieldKind =
  | "text"
  | "longtext"
  | "int"
  | "decimal"
  | "money"
  | "enum"
  | "bool";

interface InlineFieldProps {
  label: string;
  /** rendered as the display value; null/undefined/"" → empty hint */
  value: string | number | boolean | null | undefined;
  kind: InlineFieldKind;
  /** Only for kind=enum */
  options?: readonly string[];
  /** Only for kind=money */
  currency?: "USD" | "INR";
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** if disabled, value renders but is not clickable */
  disabled?: boolean;
  /** what to show when empty in view mode */
  emptyHint?: string;
  onSave: (v: string | number | boolean | null) => Promise<void>;
  onSaveStateChange?: (s: SaveState) => void;
  /** optional formatter for view mode (e.g. money pretty-print) */
  format?: (v: string | number | boolean | null | undefined) => string;
}

function moneyDisplay(v: number | null | undefined, currency: "USD" | "INR"): string {
  if (v == null) return "";
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
  }).format(v / 100);
}

function moneyToCents(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToInput(v: number | null | undefined): string {
  if (v == null) return "";
  return (v / 100).toFixed(2);
}

function InlineField(props: InlineFieldProps) {
  const {
    label,
    value,
    kind,
    options,
    currency = "USD",
    required,
    min,
    max,
    step,
    placeholder,
    disabled,
    emptyHint = "—",
    onSave,
    onSaveStateChange,
    format,
  } = props;

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>(() => initialDraft());
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  function initialDraft(): string {
    if (kind === "bool") return value ? "1" : "0";
    if (kind === "money") return centsToInput(value as number | null);
    if (value === null || value === undefined) return "";
    return String(value);
  }

  // Reset draft when the upstream value changes (e.g. patch result, refresh).
  useEffect(() => {
    if (!editing) setDraft(initialDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing]);

  function startEdit() {
    if (disabled) return;
    setError(null);
    setDraft(initialDraft());
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setDraft(initialDraft());
  }

  async function commit(rawNext: string) {
    const next = parseOut(rawNext);
    // Skip save if unchanged.
    if (kind !== "bool" && equalsCurrent(next)) {
      setEditing(false);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    onSaveStateChange?.({ kind: "saving" });
    try {
      await onSave(next);
      onSaveStateChange?.({ kind: "saved", at: Date.now() });
      setEditing(false);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      setError(msg);
      onSaveStateChange?.({ kind: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }

  function parseOut(raw: string): string | number | boolean | null {
    if (kind === "bool") return raw === "1";
    if (kind === "enum") return raw;
    if (kind === "text" || kind === "longtext") {
      const t = raw.trim();
      return t === "" ? null : t;
    }
    if (kind === "int") {
      const t = raw.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    if (kind === "decimal") {
      const t = raw.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
    if (kind === "money") return moneyToCents(raw);
    return raw;
  }

  function equalsCurrent(next: string | number | boolean | null): boolean {
    if (kind === "money") {
      return (next ?? null) === ((value as number | null) ?? null);
    }
    if (value === null || value === undefined) {
      return next === null || next === "";
    }
    return String(next) === String(value);
  }

  function viewLabel(): ReactNode {
    if (format) {
      const s = format(value);
      if (s) return s;
    }
    if (kind === "money") {
      const s = moneyDisplay(value as number | null, currency);
      if (s) return s;
    }
    if (kind === "bool") {
      return (
        <span
          className={
            value
              ? "inline-flex items-center gap-1.5"
              : "inline-flex items-center gap-1.5 text-muted"
          }
        >
          <span
            className={
              "w-2 h-2 rounded-full " +
              (value ? "bg-green-500" : "bg-stone-300")
            }
          />
          {value ? "yes" : "no"}
        </span>
      );
    }
    if (kind === "enum") {
      return value ? String(value).replace(/_/g, " ") : emptyHint;
    }
    if (value === null || value === undefined || value === "") return emptyHint;
    return String(value);
  }

  if (editing) {
    const commonClass =
      "w-full border border-current bg-paper-1 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--red)]";
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-mono text-meta text-muted">{label}</span>
        {kind === "longtext" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={Math.max(4, Math.min(12, draft.split("\n").length + 1))}
            disabled={busy}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(draft);
            }}
            onBlur={() => commit(draft)}
            className={commonClass + " font-body resize-y"}
          />
        ) : kind === "enum" ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={draft}
            autoFocus
            disabled={busy}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
            }}
            className={commonClass}
          >
            {options?.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={kind === "int" || kind === "decimal" || kind === "money" ? "number" : "text"}
            step={
              step ??
              (kind === "decimal" ? 0.01 : kind === "money" ? 0.01 : undefined)
            }
            min={min}
            max={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            disabled={busy}
            required={required}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onBlur={() => commit(draft)}
            className={commonClass}
          />
        )}
        {error && (
          <span className="font-mono text-meta text-[var(--red)]">
            {error}
          </span>
        )}
        {kind === "longtext" && (
          <div className="font-mono text-meta text-muted flex items-center gap-3">
            <span>⌘+enter to save · esc to cancel</span>
            {busy && <span>saving…</span>}
          </div>
        )}
      </div>
    );
  }

  // bool view mode: click toggles immediately
  if (kind === "bool") {
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-mono text-meta text-muted">{label}</span>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => commit(value ? "0" : "1")}
          className="text-left font-body hover:underline disabled:opacity-50 cursor-pointer"
        >
          {viewLabel()}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1 min-w-0 group"
      onClick={startEdit}
    >
      <span className="font-mono text-meta text-muted">{label}</span>
      <button
        type="button"
        disabled={disabled}
        className={
          "text-left font-body cursor-text " +
          (disabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:underline hover:decoration-dotted underline-offset-4")
        }
      >
        {value === null || value === undefined || value === ""
          ? <span className="text-muted italic">{emptyHint}</span>
          : viewLabel()}
      </button>
    </div>
  );
}

/* ============================================================================
 * Drop-zone upload
 * ========================================================================= */

function DropZone({
  artworkId,
  disabled,
  onUploaded,
}: {
  artworkId: number;
  disabled: boolean;
  onUploaded: (img: ArtworkImageRow) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageType, setImageType] =
    useState<(typeof IMAGE_TYPES)[number]>("main");
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("image_type", imageType);
      const res = await fetch(`/api/artwork-images/${artworkId}`, {
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
        caption: null,
        alt_text: null,
        credit: null,
        display_order: 0,
        visibility: "internal",
        created_at: new Date().toISOString(),
      };
      onUploaded(newImage);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className={
        "border-2 border-dashed transition-colors p-4 " +
        (dragOver
          ? "border-[var(--red)] bg-paper-2"
          : "border-current/40 bg-transparent")
      }
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-body">
            {uploading
              ? "processing…"
              : "Drop image here or click to browse"}
          </p>
          <p className="font-mono text-meta text-muted mt-1">
            JPEG · PNG · TIFF · WebP · AVIF · HEIC · GIF. Server normalizes
            to 3 JPEG variants.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={imageType}
            disabled={uploading || disabled}
            onChange={(e) =>
              setImageType(e.target.value as (typeof IMAGE_TYPES)[number])
            }
            className="border border-current bg-paper-1 px-2 py-1 font-mono text-meta"
          >
            {IMAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={uploading || disabled}
            onClick={() => inputRef.current?.click()}
            className="border border-current px-3 py-1 font-mono text-meta disabled:opacity-50"
          >
            choose file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPick}
          />
        </div>
      </div>
      {error && (
        <p className="font-mono text-meta text-[var(--red)] mt-2">
          error: {error}
        </p>
      )}
    </div>
  );
}

/* ============================================================================
 * Status pills (avail + condition + visibility)
 * ========================================================================= */

function StatusPill({
  value,
  options,
  tone,
  disabled,
  onChange,
}: {
  value: string;
  options: readonly string[];
  tone: Record<string, string>;
  disabled?: boolean;
  onChange: (v: string) => Promise<void>;
}) {
  return (
    <label
      className={
        "relative inline-flex items-center font-mono text-meta border px-2 py-0.5 cursor-pointer " +
        (tone[value] || "bg-paper-2 border-current") +
        (disabled ? " opacity-50 cursor-not-allowed" : "")
      }
    >
      <span className="pointer-events-none">{value.replace(/_/g, " ")}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ============================================================================
 * Strip thumbnail
 *
 * The data repo stores only ONE canonical thumb per artwork (keyed by
 * artwork_id + variant), not per artwork_images.id. Per-image blobs are
 * a deferred refactor — see raghavakk_inventory_bulk_safeguards.md.
 *
 * Resolution order, in order of preference:
 *   1. The artwork's canonical /api/work-image/<id>/thumb. That route
 *      falls back from data-repo blob → artwork-level source_url, so it
 *      works whether the artwork was uploaded through the app or
 *      imported from Drive. Same blob serves every strip entry — the
 *      primary is still distinguished by its red border.
 *   2. If that 404s AND this specific row has its own source_url, use
 *      it directly (Drive lh3 URLs accept a width hint).
 *   3. Otherwise show the metadata placeholder.
 *
 * Putting the canonical thumb first means every strip entry has a real
 * thumbnail in the common case, instead of falling to placeholders
 * whenever source_url happens to be null (app uploads, post-backfill).
 * ========================================================================= */

function StripThumb({
  artworkId,
  image,
  cacheKey,
}: {
  artworkId: number;
  image: ArtworkImageRow;
  cacheKey?: string | number | null;
}) {
  const [canonicalBroken, setCanonicalBroken] = useState(false);
  const [sourceBroken, setSourceBroken] = useState(false);

  const canonicalUrl =
    `/api/work-image/${artworkId}/thumb` +
    (cacheKey ? `?v=${encodeURIComponent(String(cacheKey))}` : "");

  if (!canonicalBroken) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={canonicalUrl}
        alt={image.alt_text || ""}
        loading="lazy"
        decoding="async"
        onError={() => setCanonicalBroken(true)}
        className="object-cover w-full h-full"
      />
    );
  }

  const src = image.source_url;
  if (src && !sourceBroken) {
    const url = /lh3\.googleusercontent\.com/i.test(src)
      ? src.replace(/=w\d+(-h\d+)?$/, "") + "=w400"
      : src;
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt={image.alt_text || ""}
        loading="lazy"
        decoding="async"
        onError={() => setSourceBroken(true)}
        className="object-cover w-full h-full"
      />
    );
  }

  return (
    <div className="w-full h-full bg-paper-2 flex items-center justify-center text-center px-1">
      <span className="font-mono text-[10px] text-muted leading-tight">
        {image.image_type}
        <br />#{image.id}
      </span>
    </div>
  );
}

/* ============================================================================
 * Main component
 * ========================================================================= */

export function ArtworkDetail({
  artwork: initial,
  series,
  images: initialImages,
}: Props) {
  const router = useRouter();
  const [artwork, setArtwork] = useState<ArtworkRow>(initial);
  const [images, setImages] = useState<ArtworkImageRow[]>(initialImages);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // Decay "saved" → "idle" after a moment so the indicator doesn't linger.
  useEffect(() => {
    if (saveState.kind !== "saved") return;
    const t = setTimeout(
      () => setSaveState({ kind: "idle" }),
      1800,
    );
    return () => clearTimeout(t);
  }, [saveState]);

  const seriesRow = series.find((s) => s.id === artwork.series_id);
  const archived = artwork.is_archived === 1;

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
    (img: ArtworkImageRow) => {
      setImages((prev) => [...prev, img]);
      router.refresh();
    },
    [router],
  );

  // Find primary image for the hero slot.
  const primary = images.find((i) => i.id === artwork.primary_image_id) ??
    images.find((i) => i.image_type === "main") ??
    images[0] ?? null;

  // Build short factbar string
  const sizeStr = artwork.depth_in
    ? `${trimNum(artwork.height_in)} × ${trimNum(artwork.width_in)} × ${trimNum(artwork.depth_in)} in`
    : `${trimNum(artwork.height_in)} × ${trimNum(artwork.width_in)} in`;

  return (
    <main className="dash-chrome min-h-dvh">
      {/* Top bar — breadcrumb + save ticker */}
      <div className="px-6 pt-6 max-w-editorial mx-auto flex items-center justify-between gap-4">
        <p className="eyebrow">
          <Link href="/artworks" className="underline">
            inventory
          </Link>{" "}
          / {artwork.inventory_number}
        </p>
        <SaveTicker state={saveState} />
      </div>

      {/* Hero — title is editable big text */}
      <header className="px-6 pt-3 pb-2 max-w-editorial mx-auto">
        <EditableTitle artwork={artwork} patch={patch} setSaveState={setSaveState} disabled={archived} />
        <p className="font-mono text-meta text-muted mt-1.5">
          {seriesRow ? seriesRow.name : `series #${artwork.series_id}`} ·{" "}
          {artwork.year_start}
          {artwork.year_end && artwork.year_end !== artwork.year_start
            ? `–${artwork.year_end}`
            : ""} · {sizeStr}
        </p>

        {/* Pill row */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <StatusPill
            value={artwork.availability_status}
            options={AVAILABILITY_STATUSES}
            tone={AVAIL_TONE as Record<string, string>}
            disabled={archived}
            onChange={async (v) => {
              setSaveState({ kind: "saving" });
              try {
                await patch({ availability_status: v });
                setSaveState({ kind: "saved", at: Date.now() });
              } catch (err) {
                setSaveState({
                  kind: "error",
                  message: String(err instanceof Error ? err.message : err),
                });
              }
            }}
          />
          <StatusPill
            value={artwork.condition_status}
            options={CONDITION_STATUSES}
            tone={CONDITION_TONE as Record<string, string>}
            disabled={archived}
            onChange={async (v) => {
              setSaveState({ kind: "saving" });
              try {
                await patch({ condition_status: v });
                setSaveState({ kind: "saved", at: Date.now() });
              } catch (err) {
                setSaveState({
                  kind: "error",
                  message: String(err instanceof Error ? err.message : err),
                });
              }
            }}
          />
        </div>
      </header>

      {archived && (
        <div className="px-6 max-w-editorial mx-auto">
          <aside className="border border-current p-3 mt-3 font-mono text-meta">
            archived · {artwork.archived_reason || "(no reason)"} ·{" "}
            {artwork.archived_at}
          </aside>
        </div>
      )}

      {/* Image area */}
      <section className="px-6 mt-6 max-w-editorial mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
          {/* Hero */}
          <div className="bg-paper-2 aspect-[4/3] overflow-hidden flex items-center justify-center">
            <ArtworkThumb
              artworkId={artwork.id}
              variant="hero"
              hasImage={primary != null}
              alt={primary?.alt_text || artwork.title}
              contain
              cacheKey={artwork.updated_at}
            />
          </div>

          {/* Thumb strip */}
          <div className="md:w-48 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto md:max-h-[60vh] pb-2 md:pb-0">
            {images.length === 0 ? (
              <p className="font-mono text-meta text-muted">no other images</p>
            ) : (
              images.map((img) => {
                const isPrimary = img.id === artwork.primary_image_id;
                return (
                  <figure
                    key={img.id}
                    className={
                      "shrink-0 w-20 md:w-full border " +
                      (isPrimary ? "border-[var(--red)]" : "border-current/30")
                    }
                  >
                    <div className="w-full aspect-square">
                      <StripThumb
                        artworkId={artwork.id}
                        image={img}
                        cacheKey={artwork.updated_at}
                      />
                    </div>
                  </figure>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-3">
          <DropZone
            artworkId={artwork.id}
            disabled={archived}
            onUploaded={onImageUploaded}
          />
        </div>
      </section>

      {/* Fields — magazine-style numbered sections */}
      <div className="px-6 mt-16 max-w-editorial mx-auto grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-14 pb-24">
        <FieldGroup num={1} title="Dimensions">
          <InlineField
            label="height (in)"
            value={artwork.height_in}
            kind="decimal"
            required
            disabled={archived}
            onSave={(v) => patch({ height_in: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="width (in)"
            value={artwork.width_in}
            kind="decimal"
            required
            disabled={archived}
            onSave={(v) => patch({ width_in: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="depth (in)"
            value={artwork.depth_in}
            kind="decimal"
            disabled={archived}
            emptyHint="add depth"
            onSave={(v) => patch({ depth_in: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="materials"
            value={artwork.materials}
            kind="text"
            disabled={archived}
            emptyHint="add materials"
            placeholder="e.g. oil on linen with gold leaf"
            onSave={(v) => patch({ materials: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="framed h"
            value={artwork.framed_height_in}
            kind="decimal"
            disabled={archived}
            emptyHint="—"
            onSave={(v) => patch({ framed_height_in: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="framed w"
            value={artwork.framed_width_in}
            kind="decimal"
            disabled={archived}
            emptyHint="—"
            onSave={(v) => patch({ framed_width_in: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="framed d"
            value={artwork.framed_depth_in}
            kind="decimal"
            disabled={archived}
            emptyHint="—"
            onSave={(v) => patch({ framed_depth_in: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="weight (kg)"
            value={artwork.weight_kg}
            kind="decimal"
            disabled={archived}
            emptyHint="—"
            onSave={(v) => patch({ weight_kg: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
        </FieldGroup>

        <FieldGroup num={2} title="Year">
          <InlineField
            label="year start"
            value={artwork.year_start}
            kind="int"
            required
            min={1900}
            max={2100}
            disabled={archived}
            onSave={(v) => patch({ year_start: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="year end"
            value={artwork.year_end}
            kind="int"
            min={1900}
            max={2100}
            disabled={archived}
            emptyHint="add end year"
            onSave={(v) => patch({ year_end: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
        </FieldGroup>

        <FieldGroup num={3} title="Edition / AP">
          <InlineField
            label="edition #"
            value={artwork.edition_number}
            kind="int"
            min={1}
            disabled={archived}
            emptyHint="—"
            onSave={(v) => patch({ edition_number: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="artist proof"
            value={artwork.artist_proof === 1}
            kind="bool"
            disabled={archived}
            onSave={(v) =>
              patch({ artist_proof: v ? 1 : 0 }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="AP #"
            value={artwork.ap_number}
            kind="int"
            min={1}
            disabled={archived}
            emptyHint="—"
            onSave={(v) => patch({ ap_number: v }).then(() => undefined)}
            onSaveStateChange={setSaveState}
          />
        </FieldGroup>

        <FieldGroup num={4} title="Pricing">
          <InlineField
            label="USD"
            value={artwork.price_usd_cents}
            kind="money"
            currency="USD"
            disabled={archived}
            emptyHint="add USD price"
            placeholder="12500.00"
            onSave={(v) =>
              patch({ price_usd_cents: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="INR"
            value={artwork.price_inr_paise}
            kind="money"
            currency="INR"
            disabled={archived}
            emptyHint="add INR price"
            placeholder="1000000.00"
            onSave={(v) =>
              patch({ price_inr_paise: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="show price to public"
            value={artwork.price_visible_public === 1}
            kind="bool"
            disabled={archived}
            onSave={(v) =>
              patch({ price_visible_public: v ? 1 : 0 }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="show price to dealer"
            value={artwork.price_visible_dealer === 1}
            kind="bool"
            disabled={archived}
            onSave={(v) =>
              patch({ price_visible_dealer: v ? 1 : 0 }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
        </FieldGroup>

        <FieldGroup num={5} title="Public website">
          <InlineField
            label="visible on website"
            value={artwork.website_visible === 1}
            kind="bool"
            disabled={archived}
            onSave={(v) =>
              patch({ website_visible: v ? 1 : 0 }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="featured"
            value={artwork.featured === 1}
            kind="bool"
            disabled={archived}
            onSave={(v) =>
              patch({ featured: v ? 1 : 0 }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="display order"
            value={artwork.display_order}
            kind="int"
            disabled={archived}
            emptyHint="—"
            onSave={(v) =>
              patch({ display_order: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="SEO title"
            value={artwork.seo_title}
            kind="text"
            disabled={archived}
            emptyHint="add SEO title"
            onSave={(v) =>
              patch({ seo_title: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="SEO description"
            value={artwork.seo_description}
            kind="longtext"
            disabled={archived}
            emptyHint="add SEO description"
            onSave={(v) =>
              patch({ seo_description: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
        </FieldGroup>

        <FieldGroup num={6} title="Descriptions" full prose>
          <InlineField
            label="short description (one-liner)"
            value={artwork.short_description}
            kind="longtext"
            disabled={archived}
            emptyHint="add short description"
            onSave={(v) =>
              patch({ short_description: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="full description"
            value={artwork.full_description}
            kind="longtext"
            disabled={archived}
            emptyHint="add full description"
            onSave={(v) =>
              patch({ full_description: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="artist note (public, first-person)"
            value={artwork.artist_note}
            kind="longtext"
            disabled={archived}
            emptyHint="add artist note"
            onSave={(v) =>
              patch({ artist_note: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
          <InlineField
            label="internal note (registrar only — never shared)"
            value={artwork.internal_note}
            kind="longtext"
            disabled={archived}
            emptyHint="add internal note"
            onSave={(v) =>
              patch({ internal_note: v }).then(() => undefined)
            }
            onSaveStateChange={setSaveState}
          />
        </FieldGroup>

        <FieldGroup num={7} title="Meta" full>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-meta text-muted">
            <ReadOnly label="slug" value={artwork.slug} />
            <ReadOnly label="created" value={artwork.created_at} />
            <ReadOnly label="updated" value={artwork.updated_at} />
            <ReadOnly
              label="primary image id"
              value={artwork.primary_image_id}
            />
          </div>
        </FieldGroup>
      </div>
    </main>
  );
}

/* ============================================================================
 * Helpers
 * ========================================================================= */

function trimNum(n: number | null | undefined): string {
  if (n == null) return "—";
  // Drop trailing zeros: 60.0 → 60, 84.6 → 84.6
  return Number(n).toString();
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function FieldGroup({
  title,
  children,
  full,
  num,
  prose,
}: {
  title: string;
  children: ReactNode;
  full?: boolean;
  /** 1-indexed section number; will be rendered as a Roman numeral */
  num?: number;
  /** wider single-column layout for editorial prose (descriptions, meta) */
  prose?: boolean;
}) {
  return (
    <section className={full ? "md:col-span-2" : undefined}>
      <header className="flex items-baseline gap-3 mb-4 pb-2 border-b border-current/30">
        {num !== undefined && (
          <span
            aria-hidden
            className="font-display text-h2 leading-none text-[var(--red)]"
          >
            {ROMAN[num - 1] ?? num}
          </span>
        )}
        <h2 className="font-display text-h2 leading-none">{title}</h2>
      </header>
      <div
        className={
          prose
            ? "space-y-6 max-w-reading"
            : "grid grid-cols-2 gap-x-6 gap-y-4"
        }
      >
        {children}
      </div>
    </section>
  );
}

function ReadOnly({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="font-mono text-meta text-muted">{label}</span>
      <span className="font-mono text-meta truncate">
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
    </div>
  );
}

/* ----- the title is special: huge editable headline ---------------------- */

function EditableTitle({
  artwork,
  patch,
  setSaveState,
  disabled,
}: {
  artwork: ArtworkRow;
  patch: (b: Record<string, unknown>) => Promise<ArtworkRow>;
  setSaveState: (s: SaveState) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(artwork.title);

  useEffect(() => {
    if (!editing) setDraft(artwork.title);
  }, [artwork.title, editing]);

  async function commit() {
    const next = draft.trim();
    if (next === "" || next === artwork.title) {
      setEditing(false);
      setDraft(artwork.title);
      return;
    }
    setSaveState({ kind: "saving" });
    try {
      await patch({ title: next });
      setSaveState({ kind: "saved", at: Date.now() });
      setEditing(false);
    } catch (err) {
      setSaveState({
        kind: "error",
        message: String(err instanceof Error ? err.message : err),
      });
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(artwork.title);
            setEditing(false);
          }
        }}
        className="font-display text-display leading-none w-full bg-transparent border-b border-dashed border-current/40 focus:outline-none focus:border-[var(--red)]"
      />
    );
  }

  return (
    <h1
      className={
        "font-display text-display leading-none " +
        (disabled
          ? ""
          : "cursor-text hover:text-[var(--red)]/90 transition-colors")
      }
      onClick={() => !disabled && setEditing(true)}
      title={disabled ? undefined : "click to edit title"}
    >
      {artwork.title}
    </h1>
  );
}
