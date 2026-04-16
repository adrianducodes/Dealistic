"use client";
// ─── app/login/page.tsx ───────────────────────────────────────────────────────
// Uses the Supabase browser client directly (no Server Action import needed).
// Place utils/supabase/client.ts at your project root with createBrowserClient.

import React, { useState, Suspense } from "react";
import { createClient as createSupabaseClient } from "@/utils/supabase/client";

// ── Browser Supabase client ───────────────────────────────────────────────────
function getSupabase() {
  return createSupabaseClient();
}

// ── Profile upsert ────────────────────────────────────────────────────────────
// Called after every successful sign-in to guarantee a profiles row exists.
// Uses maybeSingle() so a missing row returns null instead of throwing.
// A missing profile row is NOT the same as a missing auth account — the auth
// user already exists at this point and is confirmed.
async function ensureProfile(userId: string, email: string, name?: string) {
  const supabase = getSupabase();

  // 1. Look up existing profile
  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id, email, full_name, created_at")
    .eq("id", userId)
    .maybeSingle();

  console.log("[ensureProfile] lookup:", {
    userId,
    found: existing ? { id: existing.id, email: existing.email } : null,
    error: lookupError ? lookupError.message : null,
  });

  if (lookupError) {
    // A lookup error (e.g. table doesn't exist yet) should never block login.
    console.error("[ensureProfile] lookup error — skipping upsert:", lookupError.message);
    return;
  }

  // 2. Profile already exists — nothing to do
  if (existing) {
    console.log("[ensureProfile] profile exists, no action needed");
    return;
  }

  // 3. No profile row — create one now
  console.log("[ensureProfile] no profile found — creating row for", userId);
  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id:         userId,          // matches auth.users.id (UUID)
      email:      email,
      full_name:  name ?? "",
      created_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();

  console.log("[ensureProfile] creation result:", {
    created: created ? { id: created.id, email: created.email } : null,
    error:   insertError ? insertError.message : null,
  });

  if (insertError) {
    console.error("[ensureProfile] insert error:", insertError.message);
  }
}

function useQueryParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function Field({ label, type, placeholder, value, onChange, error, autoComplete }: {
  label: string; type: string; placeholder: string; value: string;
  onChange: (v: string) => void; error?: string; autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);
  const F = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", fontFamily: F }}>{label}</label>
      <input
        type={type} placeholder={placeholder} value={value} autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          width: "100%", boxSizing: "border-box", background: "#fff",
          border: `1.5px solid ${error ? "#dc2626" : focused ? "#2563eb" : "#e2e8f0"}`,
          borderRadius: 10, color: "#0f172a", fontSize: 14, padding: "10px 14px",
          outline: "none", fontFamily: F,
          boxShadow: focused ? `0 0 0 3px ${error ? "rgba(220,38,38,.12)" : "rgba(37,99,235,.12)"}` : "none",
          transition: "border-color .18s, box-shadow .18s",
        }}
      />
      {error && <p style={{ fontSize: 11, color: "#dc2626", margin: 0, fontFamily: F }}>{error}</p>}
    </div>
  );
}

function LoginForm() {
  const params     = useQueryParams();
  const redirectTo = params.get("redirectTo") ?? "/";
  const infoCode   = params.get("info");

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const F = "'Helvetica Neue',Helvetica,Arial,sans-serif";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    setError(null);
    console.log("[login] signInWithPassword →", trimEmail);

    const supabase = getSupabase();
    const { data, error: sbError } = await supabase.auth.signInWithPassword({
      email: trimEmail,
      password,
    });

    console.log("[login] result:", {
      user:    data?.user  ? { id: data.user.id, email: data.user.email } : null,
      session: data?.session ? "present" : "null",
      error:   sbError ? { message: sbError.message, status: sbError.status } : null,
    });

    setLoading(false);

    if (sbError) {
      console.error("[login] error:", sbError.message);
      // Supabase returns "Invalid login credentials" for both wrong password
      // and non-existent account — always show a safe generic message.
      setError("Incorrect email or password. Please try again.");
      return;
    }

    if (data?.user) {
      console.log("[login] success — ensuring profile exists");
      await ensureProfile(
        data.user.id,
        data.user.email ?? trimEmail,
        (data.user.user_metadata?.full_name as string | undefined),
      );
      console.log("[login] redirecting to", redirectTo);
      window.location.href = redirectTo;
    }
  }

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(24px,6vw,80px) 16px", fontFamily: F }}>

      {/* ← Back */}
      <div style={{ width: "100%", maxWidth: 400, marginBottom: 24 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748b", textDecoration: "none", fontFamily: F }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#64748b"; }}>
          ← Back to Home
        </a>
      </div>

      {/* Brand */}
      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.03em", color: "#0f172a", fontFamily: F }}>Dealistic</span>
      </div>

      {/* Card */}
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 20, border: "1px solid #e2e8f0", padding: "clamp(24px,5vw,36px) clamp(20px,5vw,36px)", boxShadow: "0 4px 24px rgba(15,23,42,.07)" }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", margin: "0 0 6px", fontFamily: F }}>Welcome back</h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0, fontFamily: F }}>Log in to your Dealistic account</p>
        </div>

        {/* Email confirmation info */}
        {infoCode === "check_email" && (
          <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#065f46", margin: 0, fontFamily: F }}>
              Account created! Check your email for a confirmation link, then log in here.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "10px 14px", background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#dc2626", margin: 0, fontFamily: F }}>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Email"    type="email"    placeholder="you@example.com" value={email}    onChange={setEmail}    autoComplete="email" />
          <Field label="Password" type="password" placeholder="Your password"   value={password} onChange={setPassword} autoComplete="current-password" />
          <button
            type="submit" disabled={loading}
            style={{ width: "100%", padding: "12px", border: "none", borderRadius: 10, background: loading ? "#94a3b8" : "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: F, boxShadow: loading ? "none" : "0 4px 14px rgba(37,99,235,.3)", transition: "opacity .15s" }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            {loading ? "Logging in…" : "Log In →"}
          </button>
        </form>

        <div style={{ height: 1, background: "#f1f5f9", margin: "24px 0 20px" }} />

        <div style={{ background: "linear-gradient(135deg,#eff6ff,#f0fdf4)", border: "1px solid #bfdbfe", borderRadius: 14, padding: "16px 18px" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: "0 0 4px", fontFamily: F }}>New to Dealistic?</p>
          <p style={{ fontSize: 12, color: "#475569", margin: "0 0 14px", lineHeight: 1.55, fontFamily: F }}>Save deals, keep your defaults, and access your dashboard from any device.</p>
          <a href="/signup"
            style={{ display: "block", padding: "10px", border: "1.5px solid #0f172a", borderRadius: 9, background: "transparent", color: "#0f172a", fontSize: 13, fontWeight: 700, textAlign: "center", textDecoration: "none", fontFamily: F }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#0f172a"; el.style.color = "#fff"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "#0f172a"; }}>
            Create free account →
          </a>
        </div>

        <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 18, textAlign: "center", lineHeight: 1.6, fontFamily: F }}>
          Session is managed by Supabase and persists across refreshes.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}