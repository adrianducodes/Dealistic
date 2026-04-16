import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Supabase client — use in Server Components, Server Actions, Route Handlers.
// Reads and writes the session cookie so sessions persist across requests.
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Add them to .env.local (dev) or Vercel → Settings → Environment Variables (prod)."
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
          // Called from a Server Component — cookie writes are only allowed
          // in middleware and Route Handlers. The middleware refreshes tokens
          // automatically so this is safe to ignore.
        }
      },
    },
  });
}