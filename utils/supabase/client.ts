import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client — call this in any Client Component ("use client").
// Creates a new client each call; safe to use multiple times (SSR-compatible).
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Add them to .env.local (dev) or Vercel → Settings → Environment Variables (prod)."
    );
  }

  return createBrowserClient(url, key);
}