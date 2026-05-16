import { signIn } from "@/lib/auth";

/**
 * Sign-in surface. One button: Google. The allow-list lives in
 * `lib/auth.config.ts` and is enforced by both the signIn callback and
 * middleware — this page is just the door.
 *
 * Wrong-account state: ?error=not-allowed. We tell the user the email
 * isn't allow-listed without enumerating who is.
 *
 * The "from" query param is preserved across the OAuth round-trip via
 * `redirectTo` so the user lands back where they tried to go.
 */
export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const redirectTo = from && from.startsWith("/") ? from : "/";

  return (
    <main className="dash-chrome min-h-dvh px-6 py-12 max-w-reading mx-auto">
      <p className="eyebrow mb-6">RKK / inventory</p>
      <h1 className="font-display text-h1 leading-none">
        Sign <span className="red-word">in</span>
      </h1>
      <p className="font-body text-lede text-muted mt-6">
        Studio access only. Use the Google account associated with the
        studio allow-list.
      </p>

      {error === "not-allowed" ? (
        <p className="font-mono text-meta mt-6 text-red-ink">
          that email is not on the allow-list.
        </p>
      ) : null}

      <form
        className="mt-10"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo });
        }}
      >
        <button
          type="submit"
          className="font-mono text-meta uppercase tracking-caps border border-ink px-5 py-3 hover:bg-ink hover:text-paper-1 transition-colors"
        >
          Continue with Google
        </button>
      </form>

      <p className="font-mono text-meta mt-12 text-muted">
        Galleries and dealers: you don't need an account. The studio sends
        you a share-link per consignment.
      </p>
    </main>
  );
}
