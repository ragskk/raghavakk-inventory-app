import { redirect } from "next/navigation";

/**
 * Root → /artworks. The Session 1 heartbeat page was useful for confirming
 * the SQLite-over-Octokit layer round-trips end-to-end; now that the real
 * surface is live, root just bounces straight into the inventory grid.
 *
 * Auth gating (middleware) runs before this, so unauthenticated users
 * still hit /auth/signin first.
 */
export default function Home() {
  redirect("/artworks");
}
