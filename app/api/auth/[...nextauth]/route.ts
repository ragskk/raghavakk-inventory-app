import { handlers } from "@/lib/auth";

/**
 * NextAuth v5 catch-all handler. Both GET and POST are exported from
 * `lib/auth.ts`'s `handlers` and re-bound here. App-Router convention.
 */
export const { GET, POST } = handlers;
