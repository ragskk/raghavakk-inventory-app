import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { BulkUpdateArtworkPatch } from "@/lib/validation/artwork";
import { bulkUpdateArtworks } from "@/lib/inventory";

/**
 * POST /api/artworks/bulk
 *
 * Apply the same partial update to many artworks in one commit.
 *
 *   body: { ids: number[], patch: BulkUpdateArtworkPatch }
 *
 * BulkUpdateArtworkPatch is stricter than UpdateArtworkPatch — it rejects
 * any field outside BULK_ALLOWED_FIELDS (primary_image_id, slug,
 * inventory_number, series_id, archive metadata). Single-artwork PATCH
 * still accepts the full set; bulk doesn't.
 *
 * Archived artworks are skipped and reported in the response. Every bulk
 * call snapshots affected rows to backups/bulk/<timestamp>.json in the
 * data repo BEFORE applying the SET — that file is the revert source
 * (see scripts/revert-bulk.ts).
 */

export const dynamic = "force-dynamic";

const BulkBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  patch: BulkUpdateArtworkPatch,
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
    const result = await bulkUpdateArtworks(
      parsed.data.ids,
      parsed.data.patch,
      { actor: session.user.email },
    );
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
