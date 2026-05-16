"use client";

import { useState } from "react";
import {
  AVAILABILITY_STATUSES,
  CONDITION_STATUSES,
} from "@/lib/validation/artwork";
import type { MediumRow } from "@/lib/inventory";

/**
 * Sticky bottom bar — appears when ≥1 artwork is selected.
 *
 *   [N selected]  [field ▾]  [value]  [Apply]  [Clear]
 *
 * Posts to /api/artworks/bulk. On success, clears selection and asks
 * parent to refresh (router.refresh + optimistic local merge).
 */

type FieldKind = "enum" | "bool" | "int" | "decimal" | "money" | "text";

interface BatchField {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  currency?: "USD" | "INR";
  /** map of dynamic options (e.g. medium_id) — values are { id, label } */
  dynamicOptions?: { value: string | number; label: string }[];
  placeholder?: string;
}

interface Props {
  selectedIds: number[];
  mediums: MediumRow[];
  onClear: () => void;
  onApplied: (updatedIds: number[]) => void;
}

export function BatchActionBar({
  selectedIds,
  mediums,
  onClear,
  onApplied,
}: Props) {
  const fields: BatchField[] = [
    {
      key: "availability_status",
      label: "Availability",
      kind: "enum",
      options: AVAILABILITY_STATUSES,
    },
    {
      key: "condition_status",
      label: "Condition",
      kind: "enum",
      options: CONDITION_STATUSES,
    },
    {
      key: "medium_id",
      label: "Medium",
      kind: "enum",
      dynamicOptions: mediums.map((m) => ({ value: m.id, label: m.name })),
    },
    { key: "year_start", label: "Year start", kind: "int" },
    { key: "year_end", label: "Year end", kind: "int" },
    {
      key: "materials",
      label: "Materials (free text)",
      kind: "text",
      placeholder: "e.g. oil on linen with gold leaf",
    },
    { key: "height_in", label: "Height (in)", kind: "decimal" },
    { key: "width_in", label: "Width (in)", kind: "decimal" },
    { key: "depth_in", label: "Depth (in)", kind: "decimal" },
    {
      key: "price_usd_cents",
      label: "Price USD",
      kind: "money",
      currency: "USD",
    },
    {
      key: "price_inr_paise",
      label: "Price INR",
      kind: "money",
      currency: "INR",
    },
    { key: "website_visible", label: "Visible on website", kind: "bool" },
    { key: "featured", label: "Featured", kind: "bool" },
    {
      key: "price_visible_public",
      label: "Show price to public",
      kind: "bool",
    },
    {
      key: "price_visible_dealer",
      label: "Show price to dealer",
      kind: "bool",
    },
  ];

  const [fieldKey, setFieldKey] = useState<string>(fields[0].key);
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const field = fields.find((f) => f.key === fieldKey)!;

  // When the field changes, reset the value to a sensible default.
  function pickField(next: string) {
    setFieldKey(next);
    const f = fields.find((x) => x.key === next)!;
    if (f.kind === "bool") setValue("1");
    else if (f.kind === "enum") {
      const opts = f.options ?? f.dynamicOptions?.map((o) => String(o.value));
      setValue(opts?.[0] ?? "");
    } else {
      setValue("");
    }
    setErr(null);
    setMsg(null);
  }

  function parseValue(): string | number | boolean | null | undefined {
    if (field.kind === "bool") return value === "1" ? 1 : 0;
    if (field.kind === "enum") {
      if (field.dynamicOptions) {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      }
      return value;
    }
    if (field.kind === "int") {
      const t = value.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? Math.trunc(n) : undefined;
    }
    if (field.kind === "decimal") {
      const t = value.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : undefined;
    }
    if (field.kind === "money") {
      const t = value.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n * 100) : undefined;
    }
    // text
    const t = value.trim();
    return t === "" ? null : t;
  }

  async function apply() {
    setErr(null);
    setMsg(null);
    const parsed = parseValue();
    if (parsed === undefined) {
      setErr("invalid value");
      return;
    }
    setBusy(true);
    try {
      const patch = { [field.key]: parsed };
      const res = await fetch("/api/artworks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, patch }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error +
            (json?.details ? `: ${JSON.stringify(json.details)}` : "") ||
            `HTTP ${res.status}`,
        );
      }
      const updated: number[] = json.updated_ids ?? [];
      const skipped: { id: number; reason: string }[] = json.skipped ?? [];
      const skippedSummary =
        skipped.length > 0
          ? ` · skipped ${skipped.length} (${skipped[0].reason}${skipped.length > 1 ? "…" : ""})`
          : "";
      setMsg(`updated ${updated.length}${skippedSummary}`);
      onApplied(updated);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-current bg-paper-1 shadow-[0_-4px_20px_rgba(14,14,12,0.08)]">
      <div className="max-w-editorial mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
        <span className="font-display text-xl text-[var(--red)] leading-none">
          {selectedIds.length}
        </span>
        <span className="font-mono text-meta">
          selected · set
        </span>

        <select
          value={fieldKey}
          onChange={(e) => pickField(e.target.value)}
          disabled={busy}
          className="border border-current/40 bg-paper-2 px-2 py-1 font-mono text-meta"
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        <span className="font-mono text-meta text-muted">to</span>

        {/* value input — kind-aware */}
        {field.kind === "bool" ? (
          <select
            value={value || "1"}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="border border-current/40 bg-paper-2 px-2 py-1 font-mono text-meta"
          >
            <option value="1">yes / on</option>
            <option value="0">no / off</option>
          </select>
        ) : field.kind === "enum" && field.dynamicOptions ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="border border-current/40 bg-paper-2 px-2 py-1 font-mono text-meta"
          >
            <option value="">— pick —</option>
            {field.dynamicOptions.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        ) : field.kind === "enum" ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="border border-current/40 bg-paper-2 px-2 py-1 font-mono text-meta"
          >
            <option value="">— pick —</option>
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={
              field.kind === "int" ||
              field.kind === "decimal" ||
              field.kind === "money"
                ? "number"
                : "text"
            }
            step={
              field.kind === "decimal" || field.kind === "money" ? "0.01" : undefined
            }
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="border border-current/40 bg-paper-2 px-2 py-1 font-mono text-meta min-w-[10rem]"
          />
        )}

        <button
          type="button"
          disabled={busy || selectedIds.length === 0}
          onClick={apply}
          className="border border-current bg-[var(--red)] text-paper-1 px-4 py-1 font-mono text-meta disabled:opacity-50 hover:brightness-110 transition"
        >
          {busy ? "applying…" : "apply"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="font-mono text-meta underline text-muted hover:text-current disabled:opacity-50"
        >
          clear
        </button>

        {msg && (
          <span className="font-mono text-meta text-muted ml-auto">{msg}</span>
        )}
        {err && (
          <span className="font-mono text-meta text-[var(--red)] ml-auto">
            error: {err}
          </span>
        )}
      </div>
    </div>
  );
}
