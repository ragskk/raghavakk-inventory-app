import { auth, signOut } from "@/lib/auth";

/**
 * SessionChip — fixed top-right pill showing the signed-in email + a
 * sign-out button. Server component: calls `auth()` and renders nothing
 * when there's no session, so it's safe to mount in the root layout
 * (the /auth/signin page renders cleanly).
 *
 * Why global: editing happens inline across many surfaces (list, detail,
 * new). Anchoring sign-out on the list page only meant users had to
 * navigate back to log out. One chip, always reachable.
 *
 * Sign-out posts back to a server action and redirects to "/", which
 * the middleware bounces to /auth/signin.
 */
export async function SessionChip() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  return (
    <div
      className="fixed top-3 right-3 z-50 print:hidden"
      style={{
        paddingRight: "env(safe-area-inset-right)",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
        className="flex items-center gap-2 bg-[var(--paper-1)]/85 backdrop-blur-sm border border-[var(--rule)] px-2.5 py-1.5 shadow-sm"
      >
        <span
          className="font-mono text-meta text-muted hidden sm:inline max-w-[22ch] truncate"
          title={email}
        >
          {email}
        </span>
        <button
          type="submit"
          className="font-mono text-meta border border-current/40 px-2.5 py-1 hover:bg-paper-2 hover:border-current transition-colors"
        >
          sign out
        </button>
      </form>
    </div>
  );
}
