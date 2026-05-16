import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { attachArtworkImage, type ImageType } from "@/lib/image-attach";
import { getArtworkById } from "@/lib/inventory";

/**
 * POST /api/artwork-images/[artwork_id]
 *
 * Multipart upload. Accepts any sharp-readable format (JPEG / PNG / TIFF /
 * WebP / AVIF / GIF / HEIC) up to the Vercel platform body limit
 * (4.5 MB hobby, 100 MB pro). Normalizes to JPEG at 3 widths with full
 * color fidelity (see lib/image-attach.ts).
 *
 * Form fields:
 *   file               (required) the image blob
 *   image_type         (optional) main | detail | process | studio |
 *                       installation | mockup — defaults to "main"
 *   caption            (optional) text
 *   alt_text           (optional) text
 *   credit             (optional) "Photo: …"
 *   set_as_primary     (optional) "true" | "false" — defaults to auto
 *                       (set as primary only if artwork has no primary yet)
 *
 * Auth: requires signed-in user (matches other write endpoints).
 *
 * Notes for the Vercel body-size limit: if Sonia uploads a RAW or huge
 * TIFF and it bounces with 413, two options — convert to JPEG client-side
 * first, or we add an OffscreenCanvas downscale to the uploader before
 * POST. Both produce the same final variants because sharp re-encodes
 * server-side regardless.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // sharp needs Node, not Edge.
export const maxDuration = 60; // image processing can take a few seconds.

interface RouteCtx {
  params: Promise<{ artwork_id: string }>;
}

const VALID_IMAGE_TYPES: ImageType[] = [
  "main",
  "detail",
  "process",
  "studio",
  "installation",
  "mockup",
];

function parseImageType(v: FormDataEntryValue | null): ImageType {
  const s = String(v ?? "main");
  return VALID_IMAGE_TYPES.includes(s as ImageType)
    ? (s as ImageType)
    : "main";
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function parsePrimary(v: FormDataEntryValue | null): boolean | undefined {
  if (v === null) return undefined;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { artwork_id: idStr } = await ctx.params;
  const artwork_id = Number(idStr);
  if (!Number.isFinite(artwork_id) || artwork_id <= 0) {
    return NextResponse.json({ error: "bad artwork_id" }, { status: 400 });
  }

  const artwork = await getArtworkById(artwork_id);
  if (!artwork) {
    return NextResponse.json({ error: "artwork not found" }, { status: 404 });
  }
  if (artwork.is_archived === 1) {
    return NextResponse.json(
      { error: "cannot attach image to archived artwork" },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid multipart body",
        message: String(err instanceof Error ? err.message : err),
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing file field (multipart 'file')" },
      { status: 400 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      {
        error: "failed to read uploaded file",
        message: String(err instanceof Error ? err.message : err),
      },
      { status: 400 },
    );
  }

  if (bytes.length === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }

  try {
    const result = await attachArtworkImage(artwork_id, bytes, {
      image_type: parseImageType(form.get("image_type")),
      caption: strOrNull(form.get("caption")),
      alt_text: strOrNull(form.get("alt_text")),
      credit: strOrNull(form.get("credit")),
      set_as_primary: parsePrimary(form.get("set_as_primary")),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`attachArtworkImage(${artwork_id}) failed:`, err);
    // Sharp throws "Input file contains unsupported image format" for HEIC
    // when libheif isn't bundled, and various decode errors for corrupt
    // files. Surface the message verbatim so the UI can show it.
    return NextResponse.json(
      {
        error: "image processing failed",
        message: String(err instanceof Error ? err.message : err),
      },
      { status: 500 },
    );
  }
}
