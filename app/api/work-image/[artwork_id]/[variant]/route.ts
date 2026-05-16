import { Octokit } from "@octokit/rest";
import { NextResponse } from "next/server";
import { getArtworkPrimaryImageSourceUrl } from "@/lib/inventory";

/**
 * Image-blob serve route — inventory app.
 *
 *   /api/work-image/<artwork_id>/<variant>
 *     variant ∈ "thumb" | "hero" | "label"
 *
 * Three variants, not two (campaign-app has two):
 *   - thumb  400px wide   list views, share previews
 *   - hero  2000px wide   detail pages, gallery galleries
 *   - label 1200px wide   wall labels + COA + PDF dossier hero
 *
 * Storage: `ragskk/raghavakk-inventory-data` repo, path
 * `images/<artwork_id>/<variant>.jpg`. On request:
 *
 *   1. Try Octokit getContent. Present → return bytes with long-lived
 *      immutable cache headers. The image is immutable for that
 *      (artwork_id, variant) pair until either backfilled with --force
 *      or the artwork itself is replaced under a new id.
 *
 *   2. 404 → fall back to `artwork_images.source_url` for that artwork
 *      (resolved via lib/inventory). Stream it through with the same
 *      cache headers. This keeps the surface working before backfill
 *      completes and after fresh imports that reference Drive originals.
 *
 *   3. No DB row, no source_url → 404.
 *
 * Cache: `public, max-age=31536000, immutable`. Path contains artwork_id
 * + variant only — no query string — so Vercel's edge cache treats each
 * variant as one key. New crops / re-shoots either get a new variant
 * name or run `cache-images.ts --force <artwork_id>` to overwrite.
 *
 * Auth: this route is in middleware.ts's PUBLIC_PREFIXES because dealer
 * share-links (no login) need to render `<img>` tags. PII visibility is
 * controlled at the share-link level, not by gating the bytes.
 */

const OWNER = process.env.INVENTORY_DATA_OWNER || "ragskk";
const REPO = process.env.INVENTORY_DATA_REPO || "raghavakk-inventory-data";
const BRANCH = process.env.INVENTORY_DATA_BRANCH || "main";

let octokitInstance: Octokit | null = null;
function getOctokit(): Octokit | null {
  if (octokitInstance) return octokitInstance;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  octokitInstance = new Octokit({ auth: token });
  return octokitInstance;
}

const VARIANT_WIDTH: Record<string, number> = {
  thumb: 400,
  hero: 2000,
  label: 1200
};

const CACHE_HEADERS = {
  "Content-Type": "image/jpeg",
  "Cache-Control": "public, max-age=31536000, immutable"
};

async function fetchFromDataRepo(
  artwork_id: string,
  variant: string
): Promise<Uint8Array | null> {
  const ok = getOctokit();
  if (!ok) return null;
  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: `images/${artwork_id}/${variant}.jpg`,
      ref: BRANCH
    });
    if (Array.isArray(res.data)) return null;
    const data = res.data as { type: string; content?: string };
    if (data.type !== "file" || !data.content) return null;
    return new Uint8Array(Buffer.from(data.content, "base64"));
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    throw err;
  }
}

async function fetchFromSourceUrl(
  artwork_id: string,
  variant: string
): Promise<Uint8Array | null> {
  const sourceUrl = await getArtworkPrimaryImageSourceUrl(artwork_id);
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
  // Drive lh3 URLs accept a =w<N> width hint. Other origins ignore it.
  const width = VARIANT_WIDTH[variant] || VARIANT_WIDTH.hero;
  const url = /lh3\.googleusercontent\.com/i.test(sourceUrl)
    ? sourceUrl.replace(/=w\d+(-h\d+)?$/, "") + `=w${width}`
    : sourceUrl;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ artwork_id: string; variant: string }> }
) {
  const { artwork_id, variant } = await ctx.params;
  if (!VARIANT_WIDTH[variant]) {
    return NextResponse.json({ error: "bad variant" }, { status: 400 });
  }

  // 1. Data-repo blob (the common path once cache-images.ts has run)
  try {
    const bytes = await fetchFromDataRepo(artwork_id, variant);
    if (bytes) {
      return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
        headers: CACHE_HEADERS
      });
    }
  } catch {
    // Fall through to source-url fallback.
  }

  // 2. Live fetch of artwork_images.source_url (used during migrations and
  // before backfill completes for that artwork).
  try {
    const bytes = await fetchFromSourceUrl(artwork_id, variant);
    if (bytes) {
      return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
        headers: CACHE_HEADERS
      });
    }
  } catch {
    // Fall through to 404.
  }

  return NextResponse.json({ error: "image not found" }, { status: 404 });
}
