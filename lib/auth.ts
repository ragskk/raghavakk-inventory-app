import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authConfig, isAllowListed } from "@/lib/auth.config";

/**
 * Auth — Node-runtime half.
 *
 * One sign-in path: Google OAuth, gated by an allow-list. Returning a
 * string from the `signIn` callback aborts auth and redirects; returning
 * `false` rejects silently. We use the silent path so allow-list
 * membership doesn't leak.
 *
 * Why simpler than campaign-app:
 *   - No recipient-facing surface. Galleries / dealers use signed
 *     share-links instead of accounts.
 *   - No magic-link fallback. Studio team always has Google, and the
 *     allow-list is two emails (Raghava + Sonia) at this point.
 *   - No code-verification step. Campaign-app added it because of an
 *     OAuth gotcha around first-time provider linkage; inventory is
 *     fresh, so we skip it.
 *
 * If we ever need to tear out Google: delete the providers block,
 * remove AUTH_GOOGLE_* env vars, and supply some other provider here.
 * The middleware contract (req.auth + isAllowListed) stays the same.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...(process.env.AUTH_GOOGLE_ID
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET
          })
        ]
      : [])
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider !== "google") return false;
      const email = (user?.email || "").toLowerCase();
      if (!isAllowListed(email)) {
        return "/auth/signin?error=not-allowed";
      }
      return true;
    }
  }
});
