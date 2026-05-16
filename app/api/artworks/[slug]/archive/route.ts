import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ArchiveArtworkInput } from "@/lib/validation/artwork";
import { archiveArtwork, getArtworkBySlug } from "@/lib/inventory";

/**
 * POST /api/artworks/[slug]/archive
 *
 * Soft-delete with a required reason. Sets is_archived=1, archived_at=now,
 * archived_reason, and availability_status='withdrawn'. No hard-delete
 * surface — schema cascades make recovery painful and an explicit
 * un-archive is cheaper than restoring from a git revision.
 */

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

export async function POST(req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const existing = await getArtworkBySlug(slug);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.is_archived === 1) {
    return NextResponse.json({ artwork: existing });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = ArchiveArtworkInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const artwork = await archiveArtwork(existing.id, parsed.data.reason);
    return NextResponse.json({ artwork });
  } catch (err) {
    console.error(`archiveArtwork(${existing.id}) failed:`, err);
    return NextResponse.json(
      { error: "internal error", message: String(err) },
      { status: 500 }
    );
  }
}
