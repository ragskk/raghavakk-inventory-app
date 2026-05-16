import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth config.
 *
 * This file is imported by `middleware.ts`, which runs in the Edge
 * Runtime and cannot resolve Node built-ins like `node:crypto` or
 * `node:fs`. So it deliberately contains NO providers and NO database
 * imports — the Google provider lives in `lib/auth.ts` and is composed
 * in only on the Node side, behind the /api/auth callback.
 *
 * The allow-list check (`isAllowListed`) lives here because middleware
 * may want to inspect it on every request. It reads only `process.env`,
 * which is edge-safe.
 *
 * Single sign-in surface: Google. No magic link, no Credentials, no
 * verification-code dance. Inventory is studio-only — fewer auth paths
 * means fewer doors to monitor.
 */

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days — match campaign-app

export function allowListEmails(): string[] {
  return (
    process.env.AUTH_ALLOWLIST ||
    "raghava.kk@gmail.com,raghavakkstudio@gmail.com"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowListed(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowListEmails().includes(email.trim().toLowerCase());
}

export const authConfig = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  pages: { signIn: "/auth/signin" },
  trustHost: true,
  providers: [], // populated in lib/auth.ts on the Node runtime
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (token.email && session.user) {
        session.user.email = token.email as string;
      }
      return session;
    },
    /**
     * Authorized check runs in middleware (edge-safe). Used by NextAuth
     * v5 when `auth()` wraps the request — returning false would mark
     * the request as unauthenticated for redirect logic. We keep the
     * actual redirect in middleware.ts so it can read PUBLIC_PREFIXES.
     */
    async authorized({ auth: a }) {
      return !!a?.user && isAllowListed(a.user.email);
    }
  }
} satisfies NextAuthConfig;
