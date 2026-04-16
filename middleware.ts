import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that require a logged-in session.
// Any route not in this list is public.
const PROTECTED_ROUTES = ["/dashboard", "/account"];

// Routes that should redirect logged-in users away (e.g. already authed).
const AUTH_ROUTES = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write cookies onto the outgoing response so the browser persists them.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add any logic between createServerClient and getUser().
  // A simple mistake here could make session tokens expire prematurely.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users away from protected routes.
  if (!user && PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth routes.
  if (user && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    const redirectTo = request.nextUrl.searchParams.get("redirectTo") ?? "/";
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all routes except static files and Next.js internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};