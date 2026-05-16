import { auth } from "@/lib/auth";
import { useDb } from "@/lib/db";
import { getSchemaVersion } from "@/lib/inventory";

/**
 * Session-1 heartbeat. Gated by middleware (studio-only). Reads
 * `meta.schema_version` from the data repo to confirm the SQLite-over-
 * Octokit layer round-trips end-to-end. If `GITHUB_TOKEN` is unset
 * (e.g. fresh checkout, dev), we fall back to "no-db" mode rather than
 * crashing — useful for verifying the page-level chrome without a token.
 *
 * Session 2 replaces this with the actual artworks list.
 */
export default async function Home() {
  const session = await auth();
  const dbOn = useDb();
  const schemaVersion = dbOn ? await safe(getSchemaVersion) : null;

  return (
    <main className="dash-chrome min-h-dvh px-6 py-12 max-w-editorial mx-auto">
      <p className="eyebrow mb-6">RKK / inventory</p>
      <h1 className="font-display text-display leading-none">
        Studio <span className="red-word">inventory</span>
      </h1>
      <p className="font-body text-lede text-muted mt-6 max-w-reading">
        Registrar surface. Session 1 scaffold. The artworks spine ships
        in session 2.
      </p>

      <section className="mt-12 space-y-2">
        <p className="eyebrow">heartbeat</p>
        <dl className="font-mono text-meta grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
          <dt className="text-muted">signed in</dt>
          <dd>{session?.user?.email || "no session"}</dd>
          <dt className="text-muted">data repo</dt>
          <dd>{dbOn ? "connected" : "no token (dev)"}</dd>
          <dt className="text-muted">schema version</dt>
          <dd>{schemaVersion || (dbOn ? "unreachable" : "—")}</dd>
        </dl>
      </section>
    </main>
  );
}

/**
 * Soft-fail wrapper so a transient Octokit error doesn't render a 500
 * during Session 1 smoke-testing. Surface "unreachable" instead.
 */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error("[heartbeat] db read failed:", err);
    return null;
  }
}
