import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listSeries, upsertSeriesByCode } from "@/lib/inventory";

/**
 * GET  /api/series — list (used by the new-artwork form's dropdown).
 * POST /api/series — upsert by code.
 *
 * This is a minimal Session 2 stub: enough to seed a fixture series and
 * populate the artwork form. Full series CRUD (delete, ordering, cover
 * image, website_visible flag UI) lands in Session 3.
 */

export const dynamic = "force-dynamic";

const UpsertSeries = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{2,4}$/, "code must be 2-4 uppercase letters"),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase kebab-case")
    .min(1)
    .max(80),
  name: z.string().min(1).max(200),
  short_description: z.string().max(500).optional(),
  full_description: z.string().max(5000).optional()
});

async function requireSession(): Promise<{ email: string } | NextResponse> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return { email };
}

export async function GET() {
  const guard = await requireSession();
  if (guard instanceof NextResponse) return guard;
  const rows = await listSeries();
  return NextResponse.json({ series: rows });
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

  const parsed = UpsertSeries.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const series = await upsertSeriesByCode(parsed.data);
  return NextResponse.json({ series }, { status: 201 });
}
