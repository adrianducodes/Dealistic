import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_ROUTES = ["/dashboard", "/account"];
const AUTH_ROUTES      = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  // ── Guard: skip entirely if env vars are missing ───────────────────────────
  // This prevents MIDDLEWARE_INVOCATION_FAILED when vars aren't set in Vercel.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Env vars not configured yet — pass all requests through unmodified.
    console.warn("[middleware] Supabase env vars missing — skipping auth check.");
    return NextResponse.next({ request });
  }

  try {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // Do not add logic between createServerClient and getUser().
    const { data: { user } } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;

    // Redirect unauthenticated users away from protected routes.
    if (!user && PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(url);
    }

    // Redirect already-authed users away from login/signup.
    if (user && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
      const redirectTo = request.nextUrl.searchParams.get("redirectTo") ?? "/";
      const url = request.nextUrl.clone();
      url.pathname = redirectTo;
      url.search = "";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;

  } catch (err) {
    // Never crash the middleware — always let the request through.
    console.error("[middleware] Supabase error:", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    // Skip static files and Next.js internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};