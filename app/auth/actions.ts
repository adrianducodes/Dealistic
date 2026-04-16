"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// ── Sign Up ────────────────────────────────────────────────────────────────────
export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email    = (formData.get("email")    as string).trim().toLowerCase();
  const password =  formData.get("password") as string;
  const name     = ((formData.get("name") as string | null) ?? "").trim();

  console.log("[signUp] attempting:", email);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });

  console.log("[signUp] result:", {
    userId:    data?.user?.id ?? null,
    email:     data?.user?.email ?? null,
    session:   data?.session ? "present" : "null",
    confirmed: data?.user?.email_confirmed_at ?? null,
    error:     error ? { message: error.message, status: error.status } : null,
  });

  if (error) {
    console.error("[signUp] error:", error.message);
    return redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // If email confirmation is ENABLED in Supabase dashboard:
  //   data.user is set, data.session is null → user must click confirmation email.
  // If email confirmation is DISABLED:
  //   data.user and data.session are both set → user is immediately logged in.
  if (!data.session) {
    console.log("[signUp] email confirmation required — session not yet created");
    return redirect(`/signup?info=check_email`);
  }

  revalidatePath("/", "layout");
  redirect("/");
}

// ── Sign In ────────────────────────────────────────────────────────────────────
export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const email      = (formData.get("email")      as string).trim().toLowerCase();
  const password   =  formData.get("password")   as string;
  const redirectTo = (formData.get("redirectTo") as string | null) ?? "/";

  console.log("[signIn] attempting:", email);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  console.log("[signIn] result:", {
    userId:  data?.user?.id ?? null,
    email:   data?.user?.email ?? null,
    session: data?.session ? "present" : "null",
    error:   error ? { message: error.message, status: error.status } : null,
  });

  if (error) {
    console.error("[signIn] error:", error.message);
    // IMPORTANT: Supabase returns "Invalid login credentials" for BOTH:
    //   - wrong password on existing account
    //   - email address that doesn't exist at all
    // Never show "no account found" — it would leak whether the email is registered.
    // Always return a safe, generic message.
    return redirect(
      `/login?error=${encodeURIComponent("invalid_credentials")}&redirectTo=${encodeURIComponent(redirectTo)}`
    );
  }

  // Double-check the session is real before redirecting
  const { data: { user: verifiedUser } } = await supabase.auth.getUser();
  console.log("[signIn] verified getUser:", verifiedUser ? { id: verifiedUser.id, email: verifiedUser.email } : null);

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

// ── Sign Out ───────────────────────────────────────────────────────────────────
export async function signOut() {
  const supabase = await createClient();
  console.log("[signOut] signing out");
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}