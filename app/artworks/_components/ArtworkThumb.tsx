"use client";

import { useState } from "react";

/**
 * Thumbnail that gracefully degrades:
 *   - no primary_image_id  → "no image" placeholder
 *   - <img> load error     → "broken image" placeholder
 *   - otherwise            → render the JPEG variant
 *
 * Used by the artworks list grid and the detail page hero/thumb strip.
 */

interface Props {
  artworkId: number;
  /** "thumb" | "hero" | "label" — defaults to "thumb" */
  variant?: "thumb" | "hero" | "label";
  /** if false (no primary_image_id), shows "no image" — never tries to load */
  hasImage: boolean;
  alt?: string;
  className?: string;
  /** if true, use object-contain (hero); else object-cover (thumb) */
  contain?: boolean;
  /** for cache-busting after a fresh upload — pass artwork.updated_at */
  cacheKey?: string | number | null;
}

export function ArtworkThumb({
  artworkId,
  variant = "thumb",
  hasImage,
  alt = "",
  className = "",
  contain,
  cacheKey,
}: Props) {
  const [broken, setBroken] = useState(false);

  if (!hasImage) {
    return (
      <div
        aria-hidden
        className={
          "flex w-full h-full items-center justify-center font-mono text-meta text-muted " +
          className
        }
      >
        no image
      </div>
    );
  }

  if (broken) {
    return (
      <div
        aria-hidden
        className={
          "flex w-full h-full items-center justify-center font-mono text-meta text-[var(--red)] " +
          className
        }
      >
        broken image
      </div>
    );
  }

  const url =
    `/api/work-image/${artworkId}/${variant}` +
    (cacheKey ? `?v=${encodeURIComponent(String(cacheKey))}` : "");

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={alt}
      loading={variant === "hero" ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(true)}
      className={
        (contain ? "object-contain" : "object-cover") +
        " w-full h-full " +
        className
      }
    />
  );
}
