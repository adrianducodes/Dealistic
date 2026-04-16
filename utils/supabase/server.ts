import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server client — reads/writes the auth session cookie.
// Use in Server Components, Server Actions, and Route Handlers.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
            // setAll is called from a Server Component.
            // Cookies can only be mutated in middleware or Route Handlers.
            // The middleware below keeps the session refreshed so this is safe to ignore.
          }
        },
      },
    }
  );
}