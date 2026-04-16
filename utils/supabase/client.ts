import { createBrowserClient } from "@supabase/ssr";

// Singleton browser client — safe to call in any Client Component.
// Reads from NEXT_PUBLIC_* env vars which are baked in at build time.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}