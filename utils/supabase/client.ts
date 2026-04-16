import { createBrowserClient } from "@supabase/ssr";

// Singleton browser client — safe to call in any Client Component.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Add them to .env.local (dev) or Vercel Environment Variables (prod)."
    );
  }

  return createBrowserClient(url, key);
}