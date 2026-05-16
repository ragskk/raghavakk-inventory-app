"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SeriesRow } from "@/lib/inventory";

/**
 * Live filter bar — every change pushes URL params. No apply button.
 * Search input is debounced (350ms). Selects + checkbox commit on change.
 */

interface Props {
  series: SeriesRow[];
  initial: {
    series_id?: number | null;
    availability?: string;
    q?: string;
    include_archived?: boolean;
  };
}

export function ArtworkFilters({ series, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [seriesId, setSeriesId] = useState<string>(
    initial.series_id ? String(initial.series_id) : "",
  );
  const [availability, setAvailability] = useState(initial.availability ?? "");
  const [q, setQ] = useState(initial.q ?? "");
  const [includeArchived, setIncludeArchived] = useState(
    !!initial.include_archived,
  );

  // Push the current filter state to /artworks?...
  function push(next?: Partial<{
    seriesId: string;
    availability: string;
    q: string;
    includeArchived: boolean;
  }>) {
    const sp = new URLSearchParams();
    const v = {
      seriesId: next?.seriesId ?? seriesId,
      availability: next?.availability ?? availability,
      q: next?.q ?? q,
      includeArchived:
        next?.includeArchived !== undefined
          ? next.includeArchived
          : includeArchived,
    };
    if (v.seriesId) sp.set("series_id", v.seriesId);
    if (v.availability) sp.set("availability", v.availability);
    if (v.q.trim()) sp.set("q", v.q.trim());
    if (v.includeArchived) sp.set("include_archived", "1");
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `/artworks?${qs}` : "/artworks");
    });
  }

  // Debounced search push
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    const t = setTimeout(() => {
      if (qRef.current !== (initial.q ?? "")) push({ q: qRef.current });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div
      className={
        "flex flex-wrap items-center gap-2 mb-8 font-mono text-meta border border-current/40 p-2 bg-paper-2/40 transition-opacity " +
        (pending ? "opacity-60" : "opacity-100")
      }
    >
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search title or inventory #"
        className="border border-current/40 bg-paper-1 px-2 py-1 flex-1 min-w-[14rem] focus:outline-none focus:ring-2 focus:ring-[var(--red)]"
      />
      <select
        value={seriesId}
        onChange={(e) => {
          setSeriesId(e.target.value);
          push({ seriesId: e.target.value });
        }}
        className="border border-current/40 bg-paper-1 px-2 py-1"
      >
        <option value="">all series</option>
        {series.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
      </select>
      <select
        value={availability}
        onChange={(e) => {
          setAvailability(e.target.value);
          push({ availability: e.target.value });
        }}
        className="border border-current/40 bg-paper-1 px-2 py-1"
      >
        <option value="">any availability</option>
        <option value="available">available</option>
        <option value="on_hold">on hold</option>
        <option value="reserved">reserved</option>
        <option value="sold">sold</option>
        <option value="not_for_sale">not for sale</option>
        <option value="withdrawn">withdrawn</option>
      </select>
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => {
            setIncludeArchived(e.target.checked);
            push({ includeArchived: e.target.checked });
          }}
        />
        <span>archived</span>
      </label>
      <Link
        href="/artworks"
        className="underline text-muted hover:text-current ml-auto"
      >
        clear
      </Link>
    </div>
  );
}
