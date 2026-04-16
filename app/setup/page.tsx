"use client";
// ─── app/signup/page.tsx ──────────────────────────────────────────────────────
// Uses the Supabase browser client directly (no Server Action import needed).

import React, { useState, Suspense } from "react";
import { createClient as createSupabaseClient } from "@/utils/supabase/client";

function getSupabase() {
  return createSupabaseClient();
}

// ── Profile upsert ────────────────────────────────────────────────────────────
// Called after signup to guarantee a profiles row exists.
// Uses maybeSingle() so a missing row returns null instead of throwing.
// A missing profile row is NOT the same as a missing auth account.
async function ensureProfile(userId: string, email: string, name?: string) {
  const supabase = getSupabase();

  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  console.log("[ensureProfile] lookup:", {
    userId,
    found: existing ? { id: existing.id, email: existing.email } : null,
    error: lookupError ? lookupError.message : null,
  });

  if (lookupError) {
    console.error("[ensureProfile] lookup error — skipping upsert:", lookupError.message);
    return;
  }

  if (existing) {
    console.log("[ensureProfile] profile exists, no action needed");
    return;
  }

  console.log("[ensureProfile] no profile found — creating row for", userId);
  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id:         userId,
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

function Field({ label, type, placeholder, value, onChange, error, hint, autoComplete }: {
  label: string; type: string; placeholder: string; value: string;
  onChange: (v: string) => void; error?: string; hint?: string; autoComplete?: string;
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
      {hint && !error && <p style={{ fontSize: 11, color: "#94a3b8", margin: 0, fontFamily: F }}>{hint}</p>}
    </div>
  );
}

function SignUpForm() {
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false); // email confirmation pending
  const F = "'Helvetica Neue',Helvetica,Arial,sans-serif";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const trimEmail = email.trim().toLowerCase();

    // Client-side validation
    if (!name.trim())  errs.name = "Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) errs.email = "Enter a valid email.";
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    if (confirm !== password) errs.confirm = "Passwords do not match.";
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    setErrors({});
    console.log("[signup] signUp →", trimEmail);

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email: trimEmail,
      password,
      options: { data: { full_name: name.trim() } },
    });

    console.log("[signup] result:", {
      user:      data?.user  ? { id: data.user.id, email: data.user.email, confirmed: data.user.email_confirmed_at } : null,
      session:   data?.session ? "present" : "null (email confirmation required)",
      error:     error ? { message: error.message, status: error.status } : null,
    });

    setLoading(false);

    if (error) {
      console.error("[signup] error:", error.message);
      const msg = error.message.toLowerCase();
      if (msg.includes("already registered") || msg.includes("user already exists")) {
        setErrors({ email: "An account with this email already exists. Try logging in." });
      } else {
        setErrors({ general: error.message });
      }
      return;
    }

    // data.session is null when email confirmation is ON in Supabase.
    // data.session is present when email confirmation is OFF.
    if (data?.session) {
      console.log("[signup] auto-signed in — ensuring profile exists");
      await ensureProfile(data.user!.id, data.user!.email ?? trimEmail, name.trim());
      console.log("[signup] redirecting to /");
      window.location.href = "/";
    } else if (data?.user) {
      // Email confirmation ON — profile row created now so it's ready when they confirm.
      console.log("[signup] email confirmation required — pre-creating profile");
      await ensureProfile(data.user.id, data.user.email ?? trimEmail, name.trim());
      setDone(true);
    }
  }

  const F2 = "'Helvetica Neue',Helvetica,Arial,sans-serif";

  if (done) {
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 16px", fontFamily: F2 }}>
        <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 20, border: "1px solid #e2e8f0", padding: "36px", boxShadow: "0 4px 24px rgba(15,23,42,.07)", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 10px", fontFamily: F2 }}>Check your email</h2>
          <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, margin: "0 0 24px", fontFamily: F2 }}>
            We sent a confirmation link to <strong style={{ color: "#0f172a" }}>{email.trim().toLowerCase()}</strong>. Click it to activate your account, then log in.
          </p>
          <a href="/login?info=check_email" style={{ display: "block", padding: "11px", background: "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: "none", fontFamily: F2 }}>
            Go to Login →
          </a>
        </div>
      </div>
    );
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
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", margin: "0 0 6px", fontFamily: F }}>Create your account</h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0, fontFamily: F }}>Free forever. No credit card required.</p>
        </div>

        {errors.general && (
          <div style={{ padding: "10px 14px", background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#dc2626", margin: 0, fontFamily: F }}>{errors.general}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Full Name"        type="text"     placeholder="Jane Smith"         value={name}     onChange={setName}     error={errors.name}     autoComplete="name" />
          <Field label="Email"            type="email"    placeholder="you@example.com"    value={email}    onChange={setEmail}    error={errors.email}    autoComplete="email" />
          <Field label="Password"         type="password" placeholder="Min. 8 characters"  value={password} onChange={setPassword} error={errors.password} hint="At least 8 characters." autoComplete="new-password" />
          <Field label="Confirm Password" type="password" placeholder="Repeat password"    value={confirm}  onChange={setConfirm}  error={errors.confirm}  autoComplete="new-password" />

          <button
            type="submit" disabled={loading}
            style={{ width: "100%", padding: "12px", border: "none", borderRadius: 10, marginTop: 2, background: loading ? "#94a3b8" : "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: F, boxShadow: loading ? "none" : "0 4px 14px rgba(37,99,235,.3)", transition: "opacity .15s" }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            {loading ? "Creating account…" : "Create Account →"}
          </button>
        </form>

        <p style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 22, fontFamily: F }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none", fontFamily: F }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecoration = "underline"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecoration = "none"; }}>
            Log in
          </a>
        </p>

        <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 14, textAlign: "center", lineHeight: 1.6, fontFamily: F }}>
          By signing up, you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return <Suspense><SignUpForm /></Suspense>;
}