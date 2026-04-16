import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Handles the OAuth redirect from Supabase after the user authenticates
// with Google (or any other provider). Supabase sends:
//   GET /auth/callback?code=<authorization_code>
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code        = searchParams.get("code");
  const redirectTo  = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }

    console.error("[auth/callback] exchangeCodeForSession error:", error.message);
  }

  // Something went wrong — send back to login with a generic error.
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Could not complete sign-in. Please try again.")}`
  );
}