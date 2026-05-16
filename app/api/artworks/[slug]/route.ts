import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UpdateArtworkPatch } from "@/lib/validation/artwork";
import { getArtworkBySlug, updateArtwork } from "@/lib/inventory";

/**
 * GET   /api/artworks/[slug] — single record, by slug.
 * PATCH /api/artworks/[slug] — update.
 *
 * Slug is the canonical URL identifier; numeric ids are an internal
 * concern. PATCH resolves the slug to an id once, then updates by id.
 */

export const dynamic = "force-dynamic";

async function requireSession(): Promise<{ email: string } | NextResponse> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return { email };
}

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const guard = await requireSession();
  if (guard instanceof NextResponse) return guard;

  const { slug } = await ctx.params;
  const artwork = await getArtworkBySlug(slug);
  if (!artwork) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ artwork });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const guard = await requireSession();
  if (guard instanceof NextResponse) return guard;

  const { slug } = await ctx.params;
  const existing = await getArtworkBySlug(slug);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.is_archived === 1) {
    return NextResponse.json(
      { error: "archived artworks cannot be edited; unarchive first" },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = UpdateArtworkPatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const artwork = await updateArtwork(existing.id, parsed.data);
    return NextResponse.json({ artwork });
  } catch (err) {
    console.error(`updateArtwork(${existing.id}) failed:`, err);
    return NextResponse.json(
      { error: "internal error", message: String(err) },
      { status: 500 }
    );
  }
}
