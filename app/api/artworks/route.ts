import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  CreateArtworkInput,
  ListArtworksQuery
} from "@/lib/validation/artwork";
import {
  createArtwork,
  listArtworks,
  ArtworkCreateError
} from "@/lib/inventory";

/**
 * GET /api/artworks — list view, with filters.
 * POST /api/artworks — create one artwork.
 *
 * Auth: middleware already gates non-public surface, but we double-check
 * here so a misconfigured matcher can't quietly open the API.
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

export async function GET(req: Request) {
  const guard = await requireSession();
  if (guard instanceof NextResponse) return guard;

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = ListArtworksQuery.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const rows = await listArtworks(parsed.data);
  return NextResponse.json({ artworks: rows, count: rows.length });
}

export async function POST(req: Request) {
  const guard = await requireSession();
  if (guard instanceof NextResponse) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = CreateArtworkInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const artwork = await createArtwork(parsed.data);
    return NextResponse.json({ artwork }, { status: 201 });
  } catch (err) {
    if (err instanceof ArtworkCreateError) {
      const status =
        err.code === "inventory_number_conflict" ? 409 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }
    console.error("createArtwork failed:", err);
    return NextResponse.json(
      { error: "internal error", message: String(err) },
      { status: 500 }
    );
  }
}
