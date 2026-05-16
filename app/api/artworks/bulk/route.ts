import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { UpdateArtworkPatch } from "@/lib/validation/artwork";
import { bulkUpdateArtworks } from "@/lib/inventory";

/**
 * POST /api/artworks/bulk
 *
 * Apply the same partial update to many artworks in one commit.
 *
 *   body: { ids: number[], patch: UpdateArtworkPatch }
 *
 * Series / inventory_number remain immutable (UpdateArtworkPatch schema
 * already excludes them). Archived artworks are skipped and reported in
 * the response.
 */

export const dynamic = "force-dynamic";

const BulkBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  patch: UpdateArtworkPatch,
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = BulkBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await bulkUpdateArtworks(parsed.data.ids, parsed.data.patch);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("bulkUpdateArtworks failed:", err);
    return NextResponse.json(
      {
        error: "internal error",
        message: String(err instanceof Error ? err.message : err),
      },
      { status: 500 },
    );
  }
}
