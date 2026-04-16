import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server client — reads/writes the auth session cookie.
// Use in Server Components, Server Actions, and Route Handlers.
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Add them to .env.local (dev) or Vercel Environment Variables (prod)."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — cookie mutation is only allowed
          // in middleware and Route Handlers. Safe to ignore here; middleware
          // keeps the session token refreshed.
        }
      },
    },
  });
}