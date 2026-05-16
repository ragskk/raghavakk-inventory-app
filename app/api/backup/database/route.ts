import { Octokit } from "@octokit/rest";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/backup/database
 *
 * Streams the current `inventory.sqlite` blob from the data repo as a
 * downloadable file. Filename includes UTC date for easy versioning.
 *
 * Auth-gated. Anyone who can sign in can download — same trust level as
 * editing access.
 *
 * For a true full backup (DB + image variants + documents), clone the
 * data repo directly:
 *   git clone git@github.com:ragskk/raghavakk-inventory-data.git
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER = process.env.INVENTORY_DATA_OWNER || "ragskk";
const REPO = process.env.INVENTORY_DATA_REPO || "raghavakk-inventory-data";
const BRANCH = process.env.INVENTORY_DATA_BRANCH || "main";
const DB_PATH = "inventory.sqlite";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN not configured" },
      { status: 500 },
    );
  }
  const ok = new Octokit({ auth: token });

  try {
    const res = await ok.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: DB_PATH,
      ref: BRANCH,
    });
    if (Array.isArray(res.data)) {
      return NextResponse.json(
        { error: `expected file at ${DB_PATH}` },
        { status: 500 },
      );
    }
    const data = res.data as {
      type: string;
      content?: string;
      sha: string;
      size: number;
    };
    if (data.type !== "file" || !data.content) {
      return NextResponse.json(
        { error: `expected file content at ${DB_PATH}` },
        { status: 500 },
      );
    }
    const bytes = Buffer.from(data.content, "base64");
    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `rkk-inventory-${stamp}.sqlite`;

    return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.length),
        "X-DB-Sha": data.sha,
        "X-DB-Branch": BRANCH,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("backup/database GET failed:", err);
    return NextResponse.json(
      {
        error: "fetch failed",
        message: String(err instanceof Error ? err.message : err),
      },
      { status: 500 },
    );
  }
}
