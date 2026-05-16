import NextAuth from "next-auth";
import { authConfig, isAllowListed } from "@/lib/auth.config";
import { NextResponse } from "next/server";

/**
 * Auth gate for the inventory surface.
 *
 * Studio-only by default. PUBLIC_PREFIXES below are the carve-outs:
 *   - `/api/work-image` — image bytes for share-link recipients (no login)
 *   - `/share/[token]`  — dealer share view (no login)
 *   - `/auth` + `/api/auth` — the sign-in flow itself
 *   - Next internals + favicon
 *
 * Everything else redirects to /auth/signin?from=<pathname>.
 *
 * NoIndex header on every registrar surface — inventory must never appear
 * in search engines regardless of auth state.
 *
 * Edge-safe: imports `authConfig` (no providers, no node:crypto) rather
 * than `lib/auth.ts`. The Google provider is composed only on the Node
 * side (lib/auth.ts) for the /api/auth callback.
 */

const { auth } = NextAuth(authConfig);

const PUBLIC_PREFIXES = [
  "/auth",
  "/api/auth",
  "/api/work-image",
  "/share",
  "/_next",
  "/favicon"
];

function applyRobots(res: NextResponse): NextResponse {
  // The whole inventory surface is noindex. Public share-links live under
  // /share and are served with their own noindex page-level metadata; this
  // header is a backstop.
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return applyRobots(NextResponse.next());
  }

  if (!req.auth || !isAllowListed(req.auth.user?.email)) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return applyRobots(NextResponse.next());
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
