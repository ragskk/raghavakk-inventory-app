"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ArtworkListRow,
  MediumRow,
  SeriesRow,
} from "@/lib/inventory";
import { ArtworkThumb } from "./ArtworkThumb";
import { BatchActionBar } from "./BatchActionBar";

/**
 * Infinite-scroll grid + multi-select + batch action bar.
 *
 * Each card has a checkbox in the top-left. Click to toggle. Shift+click
 * a checkbox to select a range. Card body navigates to detail. When
 * ≥ 1 selected, <BatchActionBar> appears stuck to the bottom.
 *
 * Pagination: server hands us the first 24, IntersectionObserver near
 * the bottom triggers GET /api/artworks?offset=N for the next batch.
 */

const BATCH = 24;

const AVAIL_TONE: Record<string, string> = {
  available: "bg-green-100 text-green-900 border-green-300",
  on_hold: "bg-amber-100 text-amber-900 border-amber-300",
  reserved: "bg-amber-100 text-amber-900 border-amber-300",
  sold: "bg-rose-100 text-rose-900 border-rose-300",
  not_for_sale: "bg-stone-200 text-stone-700 border-stone-400",
  withdrawn: "bg-stone-200 text-stone-700 border-stone-400",
};

interface Props {
  initialRows: ArtworkListRow[];
  series: SeriesRow[];
  mediums: MediumRow[];
  filterQuery: string;
}

export function ArtworkGrid({
  initialRows,
  series,
  mediums,
  filterQuery,
}: Props) {
  const router = useRouter();
  const seriesById = useMemo(
    () => new Map(series.map((s) => [s.id, s])),
    [series],
  );

  const [rows, setRows] = useState<ArtworkListRow[]>(initialRows);
  const [done, setDone] = useState(initialRows.length < BATCH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state — Set<artwork_id>
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const lastToggledRef = useRef<number | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset on filter change
  useEffect(() => {
    setRows(initialRows);
    setDone(initialRows.length < BATCH);
    setError(null);
    setSelected(new Set());
    lastToggledRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQuery]);

  // Infinite scroll
  useEffect(() => {
    if (done) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, rows.length, filterQuery]);

  async function loadMore() {
    if (loading || done) return;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams(filterQuery);
      sp.set("offset", String(rows.length));
      sp.set("limit", String(BATCH));
      const res = await fetch(`/api/artworks?${sp.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const next: ArtworkListRow[] = json.artworks ?? [];
      setRows((prev) => [...prev, ...next]);
      if (next.length < BATCH) setDone(true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  function toggleOne(id: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const isOn = next.has(id);
      if (shift && lastToggledRef.current !== null) {
        // Range select
        const ids = rows.map((r) => r.id);
        const a = ids.indexOf(lastToggledRef.current);
        const b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          // Set everything in the range to the OPPOSITE of the clicked id's old state.
          const targetOn = !isOn;
          for (let i = lo; i <= hi; i++) {
            if (targetOn) next.add(ids[i]);
            else next.delete(ids[i]);
          }
        }
      } else {
        if (isOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    lastToggledRef.current = id;
  }

  function selectAllVisible() {
    setSelected(new Set(rows.map((r) => r.id)));
  }
  function clearSelection() {
    setSelected(new Set());
    lastToggledRef.current = null;
  }

  function onApplied(updatedIds: number[]) {
    // Selection clears, then router.refresh pulls fresh server data.
    clearSelection();
    router.refresh();
    // (The grid re-renders with whatever the server returned. For users
    //  who haven't scrolled past the first batch, this is fully consistent.
    //  Lazy-loaded batches will update on next load.)
    void updatedIds;
  }

  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-current/40 p-12 text-center">
        <p className="font-body text-muted mb-3">
          No artworks match the current filters.
        </p>
        <div className="flex items-center justify-center gap-3 font-mono text-meta">
          <Link href="/artworks" className="underline">
            clear filters
          </Link>
          <span className="text-muted">·</span>
          <Link href="/artworks/new" className="underline">
            create the first artwork
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Selection helpers */}
      <div className="flex items-center justify-between mb-3 font-mono text-meta gap-3 flex-wrap">
        <span className="text-muted">
          {rows.length} loaded
          {selected.size > 0 ? (
            <>
              {" · "}
              <strong className="text-current">
                {selected.size} selected
              </strong>
            </>
          ) : (
            ""
          )}
        </span>
        <div className="flex items-center gap-3">
          {selected.size === 0 ? (
            <span className="text-muted italic">
              tip · click the checkbox on a card to start a batch · shift+click
              to range-select
            </span>
          ) : null}
          <button
            type="button"
            onClick={selectAllVisible}
            className="border border-current px-2 py-1 hover:bg-paper-2 transition-colors"
          >
            select all visible
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="underline hover:text-current"
            >
              clear selection
            </button>
          )}
        </div>
      </div>

      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {rows.map((r) => {
          const s = seriesById.get(r.series_id);
          const archived = r.is_archived === 1;
          const isSelected = selected.has(r.id);
          return (
            <li
              key={r.id}
              className={
                "relative group " +
                (isSelected
                  ? "ring-2 ring-[var(--red)] ring-offset-2 ring-offset-paper-1"
                  : "")
              }
            >
              {/* Checkbox overlay — always visible so the affordance is obvious */}
              <label
                className={
                  "absolute top-2 left-2 z-10 w-8 h-8 flex items-center justify-center bg-paper-1 border-2 cursor-pointer transition-all shadow-sm " +
                  (isSelected
                    ? "border-[var(--red)] opacity-100"
                    : "border-current/70 opacity-80 group-hover:opacity-100 group-hover:border-current")
                }
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleOne(r.id, e.shiftKey);
                  }}
                  className="w-4 h-4 cursor-pointer accent-[var(--red)]"
                  aria-label={`select ${r.title}`}
                />
              </label>

              <Link
                href={`/artworks/${r.slug}`}
                className={
                  "block group focus:outline-none focus:ring-2 focus:ring-[var(--red)] " +
                  (archived ? "opacity-50" : "")
                }
              >
                <div className="bg-paper-2 aspect-square overflow-hidden border border-current/20 group-hover:border-current/60 transition-colors">
                  <ArtworkThumb
                    artworkId={r.id}
                    hasImage={r.primary_image_id != null}
                    cacheKey={r.updated_at}
                    className="group-hover:scale-[1.02] transition-transform duration-300"
                  />
                </div>
                <div className="mt-2 space-y-0.5">
                  <p className="font-body leading-tight line-clamp-2 group-hover:underline">
                    {r.title}
                  </p>
                  <p className="font-mono text-meta text-muted">
                    {r.inventory_number}
                    {s ? ` · ${s.code}` : ""}
                    {r.year_start ? ` · ${r.year_start}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    <span
                      className={
                        "inline-flex items-center font-mono text-[10px] border px-1.5 py-0.5 " +
                        (AVAIL_TONE[r.availability_status] ||
                          "bg-paper-2 border-current/40")
                      }
                    >
                      {r.availability_status.replace(/_/g, " ")}
                    </span>
                    {r.image_count > 1 && (
                      <span className="font-mono text-[10px] text-muted">
                        {r.image_count} imgs
                      </span>
                    )}
                    {archived && (
                      <span className="font-mono text-[10px] text-muted italic">
                        archived
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Sentinel + status row */}
      <div
        ref={sentinelRef}
        className="mt-8 mb-24 flex items-center justify-center font-mono text-meta text-muted"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
            loading more…
          </span>
        ) : error ? (
          <span className="text-[var(--red)]">
            error: {error}
            <button
              type="button"
              onClick={loadMore}
              className="ml-3 underline hover:no-underline"
            >
              retry
            </button>
          </span>
        ) : done ? (
          <span>· end of list · {rows.length} total ·</span>
        ) : null}
      </div>

      {selected.size > 0 && (
        <BatchActionBar
          selectedIds={Array.from(selected)}
          mediums={mediums}
          onClear={clearSelection}
          onApplied={onApplied}
        />
      )}
    </>
  );
}
