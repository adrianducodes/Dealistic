"use client";
import React, { useState, useRef, useEffect, useCallback, Fragment } from "react";

// ─── Storage keys ─────────────────────────────────────────────────────────────
// Auth sessions are now managed by Supabase (cookie-based, see middleware.ts)
const LS_DEALS    = "dealistic_deals";     // SavedDeal[] keyed by userEmail
const LS_DEFAULTS   = "dealistic_defaults";  // { vacancy, repairs, mgmt, rate, state }
const LS_FORM_DRAFT = "dealistic_form_draft"; // last form state for autosave


// ─── Supabase client ──────────────────────────────────────────────────────────
// ARTIFACT STUB — works in the Claude preview without external dependencies.
// To deploy to Next.js, replace the entire function body with a real browser client.
// See lib/supabase/client.ts for the exact implementation.
// The stub stores accounts in localStorage so sign-up/login/session-persist
// all work correctly inside the artifact preview.
function createClient() {
  type SupaUser = { id: string; email: string; last_sign_in_at: string; user_metadata: Record<string, string> };
  type Listener = (event: string, session: { user: SupaUser } | null) => void;
  const SESSION_KEY  = "supa_stub_session";
  const ACCOUNTS_KEY = "supa_stub_accounts";
  const listeners: Listener[] = [];

  function stored(): { user: SupaUser } | null {
    try { const v = localStorage.getItem(SESSION_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  function emit(ev: string, session: { user: SupaUser } | null) {
    listeners.forEach(fn => fn(ev, session));
  }
  function pwHash(pw: string): string {
    let h = 0;
    for (let i = 0; i < pw.length; i++) h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0;
    return h.toString(36);
  }
  function accounts(): Record<string, { name: string; hash: string }> {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "{}"); } catch { return {}; }
  }

  return {
    auth: {
      async getUser() {
        const s = stored();
        return { data: { user: s?.user ?? null }, error: null };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const key = email.trim().toLowerCase();
        const acct = accounts()[key];
        if (!acct) return { data: { user: null }, error: { message: "User not found" } };
        if (pwHash(password) !== acct.hash) return { data: { user: null }, error: { message: "Invalid credentials" } };
        const user: SupaUser = { id: key, email: key, last_sign_in_at: new Date().toISOString(), user_metadata: { full_name: acct.name } };
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user }));
        setTimeout(() => emit("SIGNED_IN", { user }), 0);
        return { data: { user }, error: null };
      },
      async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, string> } }) {
        const key  = email.trim().toLowerCase();
        const accts = accounts();
        if (accts[key]) return { data: { user: null }, error: { message: "User already registered" } };
        const name = options?.data?.full_name ?? key.split("@")[0];
        accts[key] = { name, hash: pwHash(password) };
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accts));
        const user: SupaUser = { id: key, email: key, last_sign_in_at: new Date().toISOString(), user_metadata: { full_name: name } };
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user }));
        setTimeout(() => emit("SIGNED_IN", { user }), 0);
        return { data: { user }, error: null };
      },
      async signOut() {
        localStorage.removeItem(SESSION_KEY);
        setTimeout(() => emit("SIGNED_OUT", null), 0);
        return { error: null };
      },
      onAuthStateChange(fn: Listener) {
        listeners.push(fn);
        const s = stored();
        if (s) setTimeout(() => fn("SIGNED_IN", s), 0);
        return {
          data: {
            subscription: {
              unsubscribe() {
                const i = listeners.indexOf(fn);
                if (i > -1) listeners.splice(i, 1);
              },
            },
          },
        };
      },
    },
  };
}
// ─── END Supabase stub ────────────────────────────────────────────────────────

function lsGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; }
  catch { return null; }
}
function lsSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function lsDel(key: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(key); } catch {}
}

// ─── Palette ──────────────────────────────────────────────────────────────────

// ─── State smart defaults — vacancy + insurance estimates per state ─────────────
// Insurance: monthly $ per $100k of home value (rough median; varies greatly)
// Vacancy:   typical annual vacancy % for that state's rental market
const STATE_SMART_DEFAULTS: Record<string, { insurance100k: number; vacancy: number }> = {
  AL: { insurance100k: 6.5,  vacancy: 7  },
  AK: { insurance100k: 7.0,  vacancy: 5  },
  AZ: { insurance100k: 5.5,  vacancy: 6  },
  AR: { insurance100k: 6.8,  vacancy: 8  },
  CA: { insurance100k: 8.5,  vacancy: 5  },
  CO: { insurance100k: 5.8,  vacancy: 5  },
  CT: { insurance100k: 6.2,  vacancy: 6  },
  DE: { insurance100k: 5.5,  vacancy: 6  },
  FL: { insurance100k: 11.0, vacancy: 7  },
  GA: { insurance100k: 6.5,  vacancy: 7  },
  HI: { insurance100k: 5.0,  vacancy: 4  },
  ID: { insurance100k: 5.2,  vacancy: 5  },
  IL: { insurance100k: 6.0,  vacancy: 7  },
  IN: { insurance100k: 5.8,  vacancy: 8  },
  IA: { insurance100k: 6.5,  vacancy: 8  },
  KS: { insurance100k: 8.0,  vacancy: 8  },
  KY: { insurance100k: 5.8,  vacancy: 8  },
  LA: { insurance100k: 12.0, vacancy: 8  },
  ME: { insurance100k: 5.8,  vacancy: 7  },
  MD: { insurance100k: 5.5,  vacancy: 5  },
  MA: { insurance100k: 6.0,  vacancy: 5  },
  MI: { insurance100k: 6.2,  vacancy: 8  },
  MN: { insurance100k: 6.0,  vacancy: 6  },
  MS: { insurance100k: 7.5,  vacancy: 9  },
  MO: { insurance100k: 6.5,  vacancy: 8  },
  MT: { insurance100k: 6.0,  vacancy: 6  },
  NE: { insurance100k: 7.5,  vacancy: 7  },
  NV: { insurance100k: 5.5,  vacancy: 6  },
  NH: { insurance100k: 5.5,  vacancy: 5  },
  NJ: { insurance100k: 6.0,  vacancy: 5  },
  NM: { insurance100k: 6.5,  vacancy: 8  },
  NY: { insurance100k: 6.5,  vacancy: 5  },
  NC: { insurance100k: 6.5,  vacancy: 7  },
  ND: { insurance100k: 6.5,  vacancy: 7  },
  OH: { insurance100k: 5.8,  vacancy: 8  },
  OK: { insurance100k: 8.5,  vacancy: 8  },
  OR: { insurance100k: 5.5,  vacancy: 5  },
  PA: { insurance100k: 5.5,  vacancy: 7  },
  RI: { insurance100k: 6.0,  vacancy: 5  },
  SC: { insurance100k: 7.5,  vacancy: 7  },
  SD: { insurance100k: 6.5,  vacancy: 7  },
  TN: { insurance100k: 6.5,  vacancy: 7  },
  TX: { insurance100k: 9.0,  vacancy: 7  },
  UT: { insurance100k: 5.2,  vacancy: 5  },
  VT: { insurance100k: 5.5,  vacancy: 6  },
  VA: { insurance100k: 5.8,  vacancy: 6  },
  WA: { insurance100k: 5.5,  vacancy: 5  },
  WV: { insurance100k: 5.8,  vacancy: 9  },
  WI: { insurance100k: 5.8,  vacancy: 7  },
  WY: { insurance100k: 5.5,  vacancy: 7  },
};
// Returns smart defaults for a given state + reference price
function getStateDefaults(stateAbbr: string, price = 350000): {
  vacancy: string; insurance: string; taxes: string;
} {
  const sd = stateAbbr ? (STATE_SMART_DEFAULTS[stateAbbr] ?? null) : null;
  const taxInfo = stateAbbr ? estimateMonthlyTax(price, stateAbbr) : null;
  return {
    vacancy:   sd ? String(sd.vacancy) : "5",
    insurance: sd ? String(Math.round((price / 100000) * sd.insurance100k)) : String(Math.round((price * 0.0065) / 12)),
    taxes:     taxInfo ? String(taxInfo.monthly) : "0",
  };
}

const C = {
  // Base — clean white/light blue-grey, like Clearbit's product UI
  bg:      "#f0f4ff",       // very light periwinkle white — page background
  bg2:     "#e4ecff",       // slightly deeper for card surfaces
  text:    "#0f172a",       // deep navy — strong, trustworthy
  muted:   "#475569",       // slate — readable secondary text
  faint:   "#94a3b8",       // light slate — tertiary / hints
  rule:    "#cbd5e1",       // soft blue-grey border
  blue:    "#2563eb",       // vibrant Clearbit blue — primary action
  pill:    "#1e3a5f",       // deep navy pill background
  pillTxt: "#e0f2fe",       // light sky for pill text
  green:   "#059669",       // teal-green — positive metrics, success
  red:     "#dc2626",       // clear red — warnings
  amber:   "#d97706",       // warm amber — cautions
  // Extended gradient colors used in hero and CTA
  gradStart: "#e0f2fe",     // lightest sky blue
  gradMid:   "#bfdbfe",     // soft blue
  gradEnd:   "#a7f3d0",     // mint green — the "blue-green-white" theme
  accent:    "#0ea5e9",     // sky blue — highlights and tags
  accentGreen: "#10b981",   // emerald — step 02 accent
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface DealInput {
  address: string; price: number; down: number; rate: number; term: number;
  rent: number; vacancy: number; taxes: number; insurance: number;
  hoa: number; repairs: number; mgmt: number; other: number;
}
interface DealResult {
  mortgage: number; effectiveRent: number; opEx: number; totalMonthly: number;
  cashflow: number; annualCashflow: number; coc: number; capRate: number;
  dscr: number;
  // scoring
  baseScore: number;       // raw financial score (pre-state)
  stateAdj: number;        // state adjustment (–8 to +8)
  stateAdjLabel: string;   // e.g. "Texas taxes & insurance risk"
  score: number;           // final clamped score
  label: "Great Deal" | "Average" | "Risky";
  reason: string;
}
interface AnalysisResult {
  r: DealResult; d: DealInput; rentMissing: boolean;
  stateAbbr?: string;      // forwarded so UI can show state name
}
interface SavedDeal extends DealInput, DealResult { id: number; saved: boolean; savedAt?: string; userEmail?: string; }

type Page = "landing" | "analyzer" | "dashboard" | "learn" | "privacy" | "contact";
type AuthPage = "login" | "signup" | "account";
type Mode = "manual" | "csv";
type SortKey = "score" | "cashflow" | "cap" | "coc";
type AppMode = "buyer" | "investor";

// AuthUser is derived from the Supabase User object
interface AuthUser { email: string; name: string; loginAt?: string; id?: string; }

// ─── State investment scoring data ───────────────────────────────────────────
// Each dimension is scored –2 (very bad) to +2 (very good) for investor.
// Final state modifier = weighted sum, clamped to –8 … +8 points.
interface StateScoreFactors {
  tax: number;        // property tax burden: –2 = very high, +2 = very low
  insurance: number;  // insurance risk/cost: –2 = very high, +2 = very low
  landlord: number;   // landlord-friendliness: –2 = tenant, +2 = landlord
  climate: number;    // climate/disaster risk: –2 = severe, +2 = minimal
  demand: number;     // rental demand / investor market: –2 = weak, +2 = strong
  label: string;      // short explanation shown in UI
}

const STATE_SCORE_FACTORS: Record<string, StateScoreFactors> = {
  AL: { tax: 2, insurance: 0, landlord: 2, climate: -1, demand: 0,  label: "low taxes, landlord-friendly" },
  AK: { tax: 0, insurance: -1, landlord: 0, climate: -1, demand: -1, label: "remote market, high costs" },
  AZ: { tax: 1, insurance: 1, landlord: 2, climate: -1, demand: 2,  label: "landlord-friendly, strong demand" },
  AR: { tax: 1, insurance: 0, landlord: 2, climate: -1, demand: 0,  label: "low costs, landlord-friendly" },
  CA: { tax: 1, insurance: -2, landlord: -2, climate: -2, demand: 1, label: "tenant laws, insurance, wildfire risk" },
  CO: { tax: 1, insurance: -1, landlord: 0, climate: -1, demand: 1,  label: "balanced, rising costs" },
  CT: { tax: -2, insurance: 0, landlord: -1, climate: 0, demand: 0,  label: "high property taxes" },
  DE: { tax: 1, insurance: 0, landlord: 0, climate: 0, demand: 1,   label: "low taxes, mid-Atlantic demand" },
  FL: { tax: 0, insurance: -2, landlord: 2, climate: -2, demand: 2,  label: "hurricane & insurance risk, strong demand" },
  GA: { tax: 0, insurance: 0, landlord: 2, climate: -1, demand: 2,  label: "landlord-friendly, growing market" },
  HI: { tax: 2, insurance: -1, landlord: -2, climate: -1, demand: 0, label: "high prices, tenant laws" },
  ID: { tax: 1, insurance: 1, landlord: 2, climate: 0, demand: 1,   label: "landlord-friendly, low risk" },
  IL: { tax: -2, insurance: 0, landlord: -1, climate: -1, demand: 0, label: "very high property taxes" },
  IN: { tax: 0, insurance: 0, landlord: 2, climate: 0, demand: 1,   label: "very landlord-friendly, Midwest value" },
  IA: { tax: -1, insurance: -1, landlord: 0, climate: -1, demand: 0, label: "above-avg taxes, tornado risk" },
  KS: { tax: -1, insurance: -1, landlord: 1, climate: -2, demand: 0, label: "tornado risk, above-avg taxes" },
  KY: { tax: 0, insurance: 1, landlord: 2, climate: 0, demand: 0,   label: "landlord-friendly, low costs" },
  LA: { tax: 1, insurance: -2, landlord: 0, climate: -2, demand: 0,  label: "hurricane & flood risk, high insurance" },
  ME: { tax: -1, insurance: 0, landlord: -1, climate: 0, demand: 0,  label: "high taxes, thin market" },
  MD: { tax: -1, insurance: 0, landlord: -1, climate: 0, demand: 1,  label: "high taxes, tenant-leaning" },
  MA: { tax: -1, insurance: 0, landlord: -2, climate: 0, demand: 1,  label: "tenant laws, high taxes" },
  MI: { tax: -2, insurance: 0, landlord: 0, climate: 0, demand: 0,   label: "high property taxes" },
  MN: { tax: 0, insurance: 0, landlord: 0, climate: -1, demand: 0,  label: "balanced, cold climate" },
  MS: { tax: 1, insurance: -1, landlord: 2, climate: -1, demand: -1, label: "low taxes, landlord-friendly, thin market" },
  MO: { tax: 0, insurance: -1, landlord: 2, climate: -1, demand: 0,  label: "landlord-friendly, tornado risk" },
  MT: { tax: 0, insurance: -1, landlord: 0, climate: -1, demand: 0,  label: "wildfire risk, remote market" },
  NE: { tax: -2, insurance: -1, landlord: 1, climate: -1, demand: 0, label: "high taxes, tornado risk" },
  NV: { tax: 1, insurance: 1, landlord: 2, climate: 0, demand: 1,   label: "landlord-friendly, no income tax" },
  NH: { tax: -2, insurance: 0, landlord: 0, climate: 0, demand: 0,  label: "very high property taxes" },
  NJ: { tax: -2, insurance: -1, landlord: -2, climate: -1, demand: 1, label: "highest taxes, tenant laws, flood risk" },
  NM: { tax: 1, insurance: 1, landlord: 0, climate: 0, demand: 0,   label: "low taxes, low risk" },
  NY: { tax: -2, insurance: -1, landlord: -2, climate: -1, demand: 1, label: "high taxes, very tenant-friendly" },
  NC: { tax: 0, insurance: -1, landlord: 2, climate: -1, demand: 2,  label: "landlord-friendly, hurricane coastal risk" },
  ND: { tax: 0, insurance: 0, landlord: 1, climate: -1, demand: 0,  label: "stable market, cold climate" },
  OH: { tax: -1, insurance: 0, landlord: 2, climate: 0, demand: 1,  label: "landlord-friendly, high taxes" },
  OK: { tax: 0, insurance: -1, landlord: 2, climate: -2, demand: 0,  label: "landlord-friendly, tornado risk" },
  OR: { tax: 0, insurance: -1, landlord: -2, climate: -1, demand: 0,  label: "tenant laws, wildfire risk" },
  PA: { tax: -1, insurance: 0, landlord: 0, climate: 0, demand: 1,  label: "high taxes, balanced laws" },
  RI: { tax: -2, insurance: -1, landlord: -1, climate: -1, demand: 0, label: "high taxes, tenant-leaning" },
  SC: { tax: 1, insurance: -1, landlord: 2, climate: -1, demand: 2,  label: "landlord-friendly, strong SE growth" },
  SD: { tax: 0, insurance: 0, landlord: 2, climate: -1, demand: 0,  label: "no income tax, landlord-friendly" },
  TN: { tax: 1, insurance: 0, landlord: 2, climate: -1, demand: 2,  label: "no income tax, landlord-friendly, growing" },
  TX: { tax: -2, insurance: -1, landlord: 2, climate: -1, demand: 2, label: "high taxes, landlord-friendly, strong demand" },
  UT: { tax: 1, insurance: 1, landlord: 2, climate: 0, demand: 1,   label: "landlord-friendly, low risk" },
  VT: { tax: -2, insurance: 0, landlord: -1, climate: 0, demand: -1, label: "highest taxes, thin market" },
  VA: { tax: 0, insurance: 0, landlord: 0, climate: 0, demand: 1,   label: "balanced, DC corridor demand" },
  WA: { tax: 0, insurance: -1, landlord: -1, climate: -1, demand: 1,  label: "tenant-leaning, wildfire/earthquake risk" },
  WV: { tax: 1, insurance: 0, landlord: 2, climate: -1, demand: -1,  label: "landlord-friendly, very thin market" },
  WI: { tax: -2, insurance: 0, landlord: 0, climate: 0, demand: 0,  label: "high property taxes" },
  WY: { tax: 1, insurance: 0, landlord: 2, climate: -1, demand: -1,  label: "no income tax, landlord-friendly, thin market" },
};

// Weights for each factor (must sum to ~1.0 for normalization)
const STATE_SCORE_WEIGHTS = { tax: 0.30, insurance: 0.20, landlord: 0.25, climate: 0.15, demand: 0.10 };

// Returns a modifier in range –8 to +8 (integer)
function calcStateAdj(stateAbbr: string): { adj: number; label: string } {
  const s = STATE_SCORE_FACTORS[stateAbbr];
  if (!s) return { adj: 0, label: "" };
  const raw =
    s.tax      * STATE_SCORE_WEIGHTS.tax +
    s.insurance * STATE_SCORE_WEIGHTS.insurance +
    s.landlord  * STATE_SCORE_WEIGHTS.landlord +
    s.climate   * STATE_SCORE_WEIGHTS.climate +
    s.demand    * STATE_SCORE_WEIGHTS.demand;
  // raw is in range –2 to +2; scale to –8 to +8
  const adj = Math.round(raw * 4);
  return { adj: Math.max(-8, Math.min(8, adj)), label: s.label };
}

// ─── Calculations ─────────────────────────────────────────────────────────────
function calcDeal(d: DealInput, stateAbbr = ""): DealResult {
  const loan = d.price - d.down;
  const mr = d.rate / 100 / 12;
  const n = d.term * 12;
  const mortgage = (mr === 0 || n === 0)
    ? (n > 0 ? loan / n : 0)
    : (loan * mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
  const effectiveRent = d.rent * (1 - d.vacancy / 100);
  const opEx = d.taxes + d.insurance + d.hoa + d.repairs + d.mgmt + d.other;
  const totalMonthly = mortgage + opEx;
  const cashflow = effectiveRent - totalMonthly;
  const annualCashflow = cashflow * 12;
  const coc = d.down > 0 ? (annualCashflow / d.down) * 100 : 0;
  const noi = (effectiveRent - opEx) * 12;
  const capRate = d.price > 0 ? (noi / d.price) * 100 : 0;
  const dscr = totalMonthly > 0 ? effectiveRent / totalMonthly : 0;

  // Financial base score (max 60 pts swing from 50)
  let baseScore = 50;
  if (coc > 10) baseScore += 20; else if (coc > 6) baseScore += 10; else if (coc < 0) baseScore -= 20; else if (coc < 3) baseScore -= 10;
  if (capRate > 8) baseScore += 15; else if (capRate > 5) baseScore += 8; else if (capRate < 3) baseScore -= 15; else if (capRate < 5) baseScore -= 5;
  if (dscr > 1.4) baseScore += 15; else if (dscr > 1.2) baseScore += 8; else if (dscr < 1.0) baseScore -= 20; else if (dscr < 1.1) baseScore -= 10;
  if (cashflow > 300) baseScore += 10; else if (cashflow > 0) baseScore += 3; else if (cashflow < -300) baseScore -= 15; else if (cashflow < 0) baseScore -= 8;
  baseScore = Math.max(1, Math.min(100, Math.round(baseScore)));

  // State modifier: –8 to +8 pts (~15–20% influence on a typical deal)
  const { adj: stateAdj, label: stateAdjLabel } = calcStateAdj(stateAbbr);
  const score = Math.max(1, Math.min(100, baseScore + stateAdj));

  const label: "Great Deal" | "Average" | "Risky" = score >= 70 ? "Great Deal" : score >= 45 ? "Average" : "Risky";

  // Reason blends financial and state context
  const financeVerdict = score >= 70
    ? `Strong cash flow of $${Math.round(cashflow)}/mo, ${capRate.toFixed(1)}% cap rate, DSCR ${dscr.toFixed(2)}.`
    : score >= 45
    ? `Moderate performance — $${Math.round(cashflow)}/mo at ${capRate.toFixed(1)}% cap rate.`
    : `Weak financials: $${Math.round(cashflow)}/mo, ${capRate.toFixed(1)}% cap rate, DSCR ${dscr.toFixed(2)}.`;

  const stateClause = stateAdj > 2
    ? ` ${stateAdjLabel.charAt(0).toUpperCase() + stateAdjLabel.slice(1)} boosts the outlook.`
    : stateAdj < -2
    ? ` ${stateAdjLabel.charAt(0).toUpperCase() + stateAdjLabel.slice(1)} reduces attractiveness.`
    : stateAdj !== 0
    ? ` State factors have a minor effect.`
    : "";

  const reason = financeVerdict + stateClause;

  return { mortgage, effectiveRent, opEx, totalMonthly, cashflow, annualCashflow, coc, capRate, dscr, baseScore, stateAdj, stateAdjLabel, score, label, reason };
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? "$" + (abs / 1000).toFixed(1) + "k" : "$" + Math.round(abs);
  return n < 0 ? "-" + s : s;
}
function fmtSigned(n: number): string {
  return (n >= 0 ? "+" : "-") + fmt(Math.abs(n));
}
// Parses user-friendly formatted numeric strings into plain numbers.
// Handles: "$700,000" → 700000 | "6.5%" → 6.5 | "$2,950/mo" → 2950 | "700,000" → 700000
function parseFormattedNumber(s: unknown): number {
  if (s === null || s === undefined || s === "") return 0;
  const str = String(s)
    .replace(/\$|,|\s|\/mo|\/yr|%/g, "")  // strip currency, commas, spaces, /mo, /yr, %
    .trim();
  if (str === "") return 0;
  const v = parseFloat(str);
  return isNaN(v) ? 0 : v;
}
// Short alias used throughout the file
const pf = parseFormattedNumber;

// ─── Shared primitives ────────────────────────────────────────────────────────
const HR = () => <div style={{ height: 1, background: C.rule, width: "100%" }} />;

function Tag({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint }}>{children}</span>;
}

function ScoreChip({ label }: { label: string }) {
  const color = label === "Great Deal" ? C.green : label === "Average" ? C.amber : C.red;
  return <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color, fontWeight: 600 }}>{label}</span>;
}

function MetRow({ label, value, accent }: { label: string; value: string; accent?: "green" | "red" }) {
  const color = accent === "green" ? C.green : accent === "red" ? C.red : C.text;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 0", borderBottom: `1px solid ${C.rule}` }}>
      <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 500, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function PillBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: h ? C.text : "transparent", color: h ? "#fff" : C.text,
        border: `1px solid ${C.text}`, borderRadius: 0,
        padding: "12px 28px", fontSize: 12, letterSpacing: "0.1em",
        textTransform: "uppercase", fontWeight: 500, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}


// ─── StateSelect — premium custom dropdown (CSS-class based, dark-mode ready) ──
function StateSelect({
  value, onChange, width,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = US_STATES.find(s => s.abbr === value);
  const filtered = search.trim()
    ? US_STATES.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.abbr.toLowerCase().includes(search.toLowerCase()))
    : US_STATES;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search + scroll to selected when opening
  useEffect(() => {
    if (!open) return;
    setTimeout(() => searchRef.current?.focus(), 30);
    if (value && listRef.current) {
      const el = listRef.current.querySelector(".ss-selected") as HTMLElement | null;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [open, value]);

  function pick(abbr: string) { onChange(abbr); setOpen(false); setSearch(""); }

  return (
    <div ref={ref} style={{ position: "relative", width: width ?? "100%" }}>
      {/* Trigger */}
      <button
        type="button"
        className={"ss-trigger" + (open ? " open" : "") + (!selected ? " placeholder" : "")}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
          {selected ? (width && Number(width) <= 100 ? selected.abbr : `${selected.abbr} — ${selected.name}`) : "State…"}
        </span>
        <svg className="ss-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="ss-panel">
          {/* Search — icon + input as flex row, no absolute positioning */}
          <div className="ss-search-wrap">
            <span className="ss-search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              ref={searchRef}
              type="text"
              className="ss-search"
              placeholder="Search states…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); setSearch(""); }
                if (e.key === "Enter" && filtered.length === 1) pick(filtered[0].abbr);
              }}
            />
          </div>

          {/* List */}
          <div ref={listRef} className="ss-list">
            {/* Clear */}
            <div
              className={"ss-option ss-clear" + (!value ? " ss-selected" : "")}
              onClick={() => pick("")}
            >
              Any state
            </div>

            {filtered.length === 0 ? (
              <div className="ss-option ss-empty">No results for "{search}"</div>
            ) : filtered.map(s => {
              const isSel = s.abbr === value;
              return (
                <div key={s.abbr} className={"ss-option" + (isSel ? " ss-selected" : "")} onClick={() => pick(s.abbr)}>
                  <span className="ss-abbr">{s.abbr}</span>
                  <span className="ss-name">{s.name}</span>
                  {isSel && (
                    <svg className="ss-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── SmartField ───────────────────────────────────────────────────────────────
interface SmartFieldProps {
  label: string; placeholder: string; prefix?: string; suffix?: string;
  value: string; onChange: (v: string) => void;
  hint?: string; tooltip?: string; autoLabel?: string;
}

function SmartField({ label, placeholder, prefix, suffix, value, onChange, hint, tooltip, autoLabel }: SmartFieldProps) {
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <label className="az-label" style={{ margin: 0 }}>{label}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {autoLabel && (
            <span style={{ fontSize: 9, letterSpacing: "0.07em", textTransform: "uppercase",
              background: "rgba(37,99,235,0.1)", color: "#2563eb",
              border: "1px solid rgba(37,99,235,0.2)",
              padding: "2px 7px", fontWeight: 700, borderRadius: 5 }}>
              {autoLabel}
            </span>
          )}
          {tooltip && (
            <div style={{ position: "relative", display: "inline-flex" }}>
              <button
                onMouseEnter={() => setTipOpen(true)}
                onMouseLeave={() => setTipOpen(false)}
                style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #e2e8f0",
                  background: "#f8fafc", cursor: "default", display: "flex", alignItems: "center",
                  justifyContent: "center", fontFamily: "inherit", padding: 0 }}
              >
                <span style={{ fontSize: 9, color: "#64748b", fontWeight: 700 }}>?</span>
              </button>
              {tipOpen && (
                <div style={{ position: "absolute", right: 0, top: 24, zIndex: 50,
                  background: "#0f172a", color: "#fff", fontSize: 11, lineHeight: 1.5,
                  padding: "9px 13px", whiteSpace: "nowrap", pointerEvents: "none",
                  boxShadow: "0 8px 24px rgba(15,23,42,0.2)", borderRadius: 8 }}>
                  {tooltip}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div style={{ position: "relative" }}>
        {prefix && (
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
            fontSize: 13, color: "#94a3b8", pointerEvents: "none", zIndex: 1 }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`az-input${prefix ? " az-input-prefix" : ""}${suffix ? " az-input-suffix" : ""}`}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
            fontSize: 13, color: "#94a3b8", pointerEvents: "none" }}>
            {suffix}
          </span>
        )}
      </div>

      {hint && <p className="az-hint">{hint}</p>}
    </div>
  );
}

// ─── RentEstimatorPanel ───────────────────────────────────────────────────────
// Extracted as its own component to avoid IIFE-in-JSX issues
function RentEstimatorPanel({ price, onSelect }: { price: number; onSelect: (v: string) => void }) {
  const suggestions = [
    { pct: 0.006, label: "Conservative", desc: "0.6% — lower-end or slower markets" },
    { pct: 0.0075, label: "Moderate", desc: "0.75% — typical US rental market" },
    { pct: 0.010, label: "Strong", desc: "1% — high-demand or cash-flow market" },
  ];

  return (
    <div style={{ marginTop: 8, background: C.bg2, border: `1px solid ${C.rule}` }}>
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Estimates based on purchase price
        </p>
      </div>
      {suggestions.map((s, i) => {
        const est = Math.round(price * s.pct);
        const isLast = i === suggestions.length - 1;
        return (
          <div
            key={s.label}
            onClick={() => onSelect(String(est))}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "11px 14px",
              borderBottom: isLast ? "none" : `1px solid ${C.rule}`,
              cursor: "pointer", transition: "background 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.rule; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <div>
              <p style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 1 }}>{s.label}</p>
              <p style={{ fontSize: 10, color: C.faint }}>{s.desc}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                ${est.toLocaleString()}<span style={{ fontSize: 10, fontWeight: 400, color: C.faint }}>/mo</span>
              </p>
              <span style={{ fontSize: 9, color: C.blue, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Use</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── RentalCompsSection ───────────────────────────────────────────────────────
interface Comp { id: number; value: string; }

function RentalCompsSection({ onUseAverage }: { onUseAverage: (v: string) => void }) {
  const [comps, setComps] = useState<Comp[]>([{ id: 1, value: "" }, { id: 2, value: "" }, { id: 3, value: "" }]);
  const [nextId, setNextId] = useState(4);

  function addComp() {
    setComps(prev => [...prev, { id: nextId, value: "" }]);
    setNextId(n => n + 1);
  }

  function removeComp(id: number) {
    setComps(prev => prev.length > 1 ? prev.filter(c => c.id !== id) : prev);
  }

  function updateComp(id: number, value: string) {
    setComps(prev => prev.map(c => c.id === id ? { ...c, value } : c));
  }

  const validVals = comps.map(c => pf(c.value)).filter(v => v > 0);
  const avg = validVals.length > 0 ? Math.round(validVals.reduce((a, b) => a + b, 0) / validVals.length) : 0;
  const hasEnough = validVals.length >= 2;

  return (
    <div style={{ marginTop: 32, border: `1px solid ${C.rule}`, background: C.bg }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>
            Rental Comps
          </p>
          <p style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>
            Enter rents from similar nearby units to calculate an average.
          </p>
        </div>
        {hasEnough && (
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 16 }}>
            <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
              Avg of {validVals.length}
            </p>
            <p style={{ fontSize: 20, fontWeight: 600, color: C.text, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
              ${avg.toLocaleString()}<span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>/mo</span>
            </p>
          </div>
        )}
      </div>

      {/* Comp rows */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {comps.map((comp, i) => (
          <div key={comp.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: C.faint, width: 18, flexShrink: 0, textAlign: "right" }}>{i + 1}</span>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.faint, pointerEvents: "none" }}>$</span>
              <input
                type="number"
                placeholder="e.g. 2,200"
                value={comp.value}
                onChange={e => updateComp(comp.id, e.target.value)}
                onFocus={e => { e.currentTarget.style.borderColor = C.text; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.rule; }}
                style={{ width: "100%", background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 0, color: C.text, fontSize: 14, padding: "9px 10px 9px 24px", outline: "none", fontFamily: "inherit", transition: "border-color 0.12s", boxSizing: "border-box" }}
              />
            </div>
            <button
              onClick={() => removeComp(comp.id)}
              style={{ width: 28, height: 28, flexShrink: 0, background: "transparent", border: `1px solid ${C.rule}`, color: C.faint, cursor: "pointer", fontFamily: "inherit", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.red; (e.currentTarget as HTMLElement).style.color = C.red; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.rule; (e.currentTarget as HTMLElement).style.color = C.faint; }}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Footer: add row + use average */}
      <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button
          onClick={addComp}
          style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, color: C.muted, padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.text; (e.currentTarget as HTMLElement).style.color = C.text; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.rule; (e.currentTarget as HTMLElement).style.color = C.muted; }}
        >
          + Add Comp
        </button>

        {hasEnough ? (
          <button
            onClick={() => onUseAverage(String(avg))}
            style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: C.text, color: C.bg, border: "none", padding: "7px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, transition: "opacity 0.12s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            Use Average — ${avg.toLocaleString()}/mo
          </button>
        ) : (
          <p style={{ fontSize: 11, color: C.faint, fontStyle: "italic" }}>
            {validVals.length === 0 ? "Enter at least 2 comps to calculate average" : "Add one more comp to calculate average"}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── RentometerSection ───────────────────────────────────────────────────────
// Always links to the Rentometer homepage — no assumed deep-link paths.
const RENTOMETER_URL = "https://www.rentometer.com/";

function RentometerSection({ address: _address }: { address: string }) {
  return (
    <div style={{ marginTop: 12, border: `1px solid ${C.rule}`, background: C.bg }}>

      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>
              Rentometer
            </p>
            <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", background: C.blue, color: "#fff", padding: "2px 6px", fontWeight: 600 }}>
              External
            </span>
          </div>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
            Look up median rents, percentile ranges, and comparable units for any zip code or address — free, no account required.
          </p>
        </div>

        {/* Button */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <a
            href={RENTOMETER_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600,
              background: C.text, color: C.bg,
              padding: "9px 16px", textDecoration: "none",
              fontFamily: "inherit", transition: "opacity 0.12s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            Research on Rentometer
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
              <path d="M1 9L9 1M9 1H3M9 1V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
          <p style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap" }}>Opens in a new tab</p>
        </div>
      </div>

      {/* Steps */}
      <div style={{ padding: "4px 16px 4px" }}>
        {[
          { n: "1", text: "Enter your property address or zip code in the Rentometer search bar" },
          { n: "2", text: "Choose the bedroom count that matches your unit" },
          { n: "3", text: "Note the median rent and the 25th–75th percentile range" },
          { n: "4", text: "Use that figure as your monthly rent or add it as a comp above" },
        ].map((step, i, arr) => (
          <div
            key={step.n}
            style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              padding: "11px 0",
              borderBottom: i < arr.length - 1 ? `1px solid ${C.rule}` : "none",
            }}
          >
            <span style={{
              flexShrink: 0, width: 20, height: 20,
              background: C.bg2, border: `1px solid ${C.rule}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: C.muted,
            }}>
              {step.n}
            </span>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, paddingTop: 2 }}>{step.text}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.rule}`, background: C.bg2 }}>
        <p style={{ fontSize: 10, color: C.faint, lineHeight: 1.5 }}>
          Rentometer opens in a new tab for local rent research. Dealistic does not share your data with any third party.
        </p>
      </div>
    </div>
  );
}

// ─── BuyerResults — no IIFE, proper component ────────────────────────────────
function BuyerResults({ result, onSwitchToInvestor }: { result: AnalysisResult; onSwitchToInvestor: () => void }) {
  const monthly = result.r.totalMonthly;
  const mortgage = result.r.mortgage;
  const downPct = result.d.price > 0 ? result.d.down / result.d.price : 0;
  const downPctRound = Math.round(downPct * 100);
  const income28 = Math.round(monthly / 0.28 * 12);
  const income36 = Math.round(monthly / 0.36 * 12);
  const loan = result.d.price - result.d.down;
  const annualCost = Math.round(monthly * 12);

  // Affordability score: based on down payment and DTI comfort zone
  // 80–100 = very comfortable, 60–79 = manageable, 40–59 = tight, <40 = stretched
  let afScore = 70;
  if (downPctRound >= 20) afScore += 15; else if (downPctRound >= 10) afScore += 5; else afScore -= 15;
  if (result.d.rate <= 6) afScore += 10; else if (result.d.rate <= 7.5) afScore += 3; else afScore -= 7;
  if (result.d.term >= 30) afScore += 2;
  afScore = Math.max(1, Math.min(100, Math.round(afScore)));

  const afLabel = afScore >= 75 ? "Comfortable" : afScore >= 55 ? "Manageable" : "Stretched";
  const afColor = afScore >= 75 ? C.green : afScore >= 55 ? C.amber : C.red;
  const afReason = afScore >= 75
    ? `Strong down payment (${downPctRound}%) and reasonable rate keep monthly costs in check.`
    : afScore >= 55
    ? `This home is within reach, but budget carefully. ${downPctRound < 20 ? "PMI adds cost until you hit 20% equity." : "Rate is elevated — consider a 15-year or buydown."}`
    : `Monthly costs may be a stretch. ${downPctRound < 10 ? "Low down payment increases long-term cost significantly." : "Consider a lower price point or larger down payment."}`;

  const pmiBadge = downPctRound < 20;

  return (
    <div>
      {/* Affordability Score — buyer equivalent of Deal Score */}
      <div style={{ paddingBottom: 40, marginBottom: 40, borderBottom: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 6 }}>
          Affordability Score
        </p>
        <p style={{ fontSize: 11, color: C.faint, marginBottom: 20, fontStyle: "italic" }}>
          How comfortably this purchase fits your financial profile
        </p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 28, marginBottom: 16 }}>
          <span style={{ fontSize: 100, fontWeight: 500, lineHeight: 0.9, letterSpacing: "-0.055em", color: afColor, fontVariantNumeric: "tabular-nums" }}>
            {afScore}
          </span>
          <div>
            <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: afColor, fontWeight: 600 }}>{afLabel}</span>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 1.7, maxWidth: 200 }}>{afReason}</p>
          </div>
        </div>
        {pmiBadge && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#fdf5e8", border: "1px solid #e8c87a" }}>
            <span style={{ fontSize: 9, background: C.amber, color: "#fff", padding: "1px 6px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>NOTE</span>
            <span style={{ fontSize: 11, color: "#7a5500" }}>PMI likely required — down payment below 20%</span>
          </div>
        )}
      </div>

      {/* Monthly cost breakdown */}
      <div style={{ paddingBottom: 36, marginBottom: 36, borderBottom: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 24 }}>
          Monthly Cost Breakdown
        </p>
        <MetRow label="Principal & Interest" value={fmt(mortgage)} />
        {result.d.taxes > 0 && <MetRow label="Property Taxes" value={fmt(result.d.taxes)} />}
        {result.d.insurance > 0 && <MetRow label="Homeowner's Insurance" value={fmt(result.d.insurance)} />}
        {result.d.hoa > 0 && <MetRow label="HOA Fees" value={fmt(result.d.hoa)} />}
        {result.d.other > 0 && <MetRow label="Other Expenses" value={fmt(result.d.other)} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 0 2px", borderTop: `1px solid ${C.rule}`, marginTop: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>Total Monthly Cost</span>
          <span style={{ fontSize: 20, fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmt(monthly)}</span>
        </div>
      </div>

      {/* Affordability summary */}
      <div style={{ paddingBottom: 36, marginBottom: 36, borderBottom: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 24 }}>
          Affordability Summary
        </p>
        <div style={{ padding: "12px 0", borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Min. Income (28% rule)</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>${income28.toLocaleString()}/yr</span>
          </div>
          <p style={{ fontSize: 10, color: C.faint, marginTop: 3, fontStyle: "italic" }}>Housing costs ≤ 28% of gross monthly income</p>
        </div>
        <div style={{ padding: "12px 0", borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Min. Income (36% rule)</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>${income36.toLocaleString()}/yr</span>
          </div>
          <p style={{ fontSize: 10, color: C.faint, marginTop: 3, fontStyle: "italic" }}>Total debt ≤ 36% of gross monthly income</p>
        </div>
        <div style={{ padding: "12px 0", borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Down Payment</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: downPctRound < 20 ? C.amber : C.text, fontVariantNumeric: "tabular-nums" }}>
              {fmt(result.d.down)} ({downPctRound}%)
            </span>
          </div>
          <p style={{ fontSize: 10, color: downPctRound < 20 ? C.amber : C.faint, marginTop: 3, fontStyle: "italic" }}>
            {downPctRound >= 20 ? "20%+ — PMI not required" : "Below 20% — expect PMI until you reach 20% equity"}
          </p>
        </div>
        <div style={{ padding: "12px 0", borderBottom: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Loan Amount</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmt(loan)}</span>
          </div>
        </div>
        <div style={{ padding: "12px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Annual Housing Cost</span>
            <span style={{ fontSize: 15, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>${annualCost.toLocaleString()}/yr</span>
          </div>
        </div>
      </div>

      {/* Investor nudge */}
      <div style={{ padding: "14px 16px", background: C.bg2, border: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
          Thinking about renting this property out?{" "}
          <button
            onClick={onSwitchToInvestor}
            style={{ background: "none", border: "none", color: C.blue, fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}
          >
            Switch to Investor mode
          </button>
          {" "}to see cash flow, cap rate, and your Deal Score.
        </p>
      </div>
    </div>
  );
}

// ─── InvestorDashboard ────────────────────────────────────────────────────────
function BarChart({ income, expenses, d: dealInput }: {
  income: number;
  expenses: number;
  d?: DealInput;
}) {
  const cashflow = income - expenses;
  const positive = cashflow >= 0;
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Bar chart values ──────────────────────────────────────────────────────
  const peak = Math.max(income, expenses, 1);
  const BAR_MAX_H = 120;
  const bars = [
    { label: "Income",    value: income,   color: "#059669", pct: income / peak,   signed: false },
    { label: "Expenses",  value: expenses, color: "#f87171", pct: expenses / peak, signed: false },
    { label: "Net Flow",  value: Math.abs(cashflow), color: positive ? "#059669" : "#dc2626",
      pct: Math.max(0.03, Math.abs(cashflow) / peak), signed: true },
  ];

  // ── Donut (expense breakdown) — only when we have dealInput ──────────────
  const slices: { label: string; value: number; color: string }[] = [];
  if (dealInput) {
    const mtg = expenses - (dealInput.taxes + dealInput.insurance + dealInput.hoa
      + dealInput.repairs + dealInput.mgmt + dealInput.other);
    const items: [string, number, string][] = [
      ["Mortgage",   Math.max(0, mtg),          "#3b82f6"],
      ["Taxes",      dealInput.taxes,            "#8b5cf6"],
      ["Insurance",  dealInput.insurance,        "#f59e0b"],
      ["HOA",        dealInput.hoa,              "#06b6d4"],
      ["Repairs",    dealInput.repairs,          "#10b981"],
      ["Management", dealInput.mgmt,             "#f97316"],
      ["Other",      dealInput.other,            "#94a3b8"],
    ];
    items.forEach(([label, value, color]) => {
      if (value > 0) slices.push({ label, value, color });
    });
  }
  const donutTotal = slices.reduce((s, x) => s + x.value, 0);

  // Build SVG arc paths for donut
  const R = 52, r = 32, CX = 64, CY = 64;
  let cursor = -Math.PI / 2; // start at 12 o'clock
  const donutPaths = slices.map(sl => {
    const angle = (sl.value / donutTotal) * 2 * Math.PI;
    const x1 = CX + R * Math.cos(cursor);
    const y1 = CY + R * Math.sin(cursor);
    cursor += angle;
    const x2 = CX + R * Math.cos(cursor);
    const y2 = CY + R * Math.sin(cursor);
    const mx1 = CX + r * Math.cos(cursor);
    const my1 = CY + r * Math.sin(cursor);
    cursor -= angle;
    const mx2 = CX + r * Math.cos(cursor);
    const my2 = CY + r * Math.sin(cursor);
    const large = angle > Math.PI ? 1 : 0;
    const path = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${mx1} ${my1} A ${r} ${r} 0 ${large} 0 ${mx2} ${my2} Z`;
    cursor += angle;
    return { ...sl, path };
  });

  return (
    <div ref={ref}>
      {/* ── Bar chart ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: slices.length > 0 ? "1fr 1fr" : "1fr",
        gap: 20, alignItems: "end",
      }}>
        <div>
          {/* Bars */}
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 12,
            height: BAR_MAX_H + 28, paddingBottom: 0,
          }}>
            {bars.map((bar, i) => {
              const h = Math.round(bar.pct * BAR_MAX_H);
              const delay = i * 0.08;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                  {/* Value label */}
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: bar.color, fontVariantNumeric: "tabular-nums",
                    opacity: visible ? 1 : 0,
                    transition: `opacity 0.4s ease ${delay + 0.4}s`,
                    letterSpacing: "-0.01em",
                  }}>
                    {bar.signed ? fmtSigned(cashflow) : fmt(bar.value)}
                  </span>
                  {/* Bar */}
                  <div style={{
                    width: "100%", borderRadius: "6px 6px 0 0",
                    background: bar.color,
                    opacity: i === 1 ? 0.75 : i === 2 && !positive ? 0.85 : 0.9,
                    height: visible ? h : 0,
                    transition: `height 0.55s cubic-bezier(.22,1,.36,1) ${delay}s`,
                    minHeight: visible ? 4 : 0,
                    boxShadow: `0 -2px 8px ${bar.color}40`,
                  }} />
                </div>
              );
            })}
          </div>
          {/* Baseline + labels */}
          <div style={{ borderTop: "1.5px solid #e2e8f0", paddingTop: 8, display: "flex", gap: 12 }}>
            {bars.map((bar, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <span style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
                  {bar.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Donut chart ── */}
        {slices.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, margin: 0 }}>
              Expense Breakdown
            </p>
            <svg
              width="128" height="128" viewBox="0 0 128 128"
              style={{ overflow: "visible", flexShrink: 0 }}
            >
              <defs>
                <filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08" />
                </filter>
              </defs>
              <g filter="url(#donut-shadow)">
                {donutPaths.map((sl, i) => {
                  const dashLen = (sl.value / donutTotal) * 2 * Math.PI * R;
                  return (
                    <path
                      key={i}
                      d={sl.path}
                      fill={sl.color}
                      opacity={visible ? 0.88 : 0}
                      style={{ transition: `opacity 0.5s ease ${i * 0.06 + 0.2}s` }}
                    />
                  );
                })}
              </g>
              {/* Center label */}
              <text x={CX} y={CY - 5} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: "#0f172a" }}>
                {fmt(expenses)}
              </text>
              <text x={CX} y={CY + 9} textAnchor="middle" style={{ fontSize: 8, fill: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                /mo
              </text>
            </svg>
            {/* Legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
              {slices.map((sl, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  opacity: visible ? 1 : 0,
                  transition: `opacity 0.4s ease ${i * 0.05 + 0.35}s`,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: sl.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#64748b", flex: 1, fontWeight: 500 }}>{sl.label}</span>
                  <span style={{ fontSize: 10, color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(sl.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MiniBarChart — compact 3-bar chart for deal cards ───────────────────────
function MiniBarChart({ income, expenses }: { income: number; expenses: number }) {
  const cashflow = income - expenses;
  const positive = cashflow >= 0;
  const peak = Math.max(income, expenses, 1);

  // Bar heights scaled to 48px max — keeps the chart compact
  const iH = Math.max(4, Math.round((income / peak) * 48));
  const eH = Math.max(4, Math.round((expenses / peak) * 48));
  const cH = Math.max(4, Math.round((Math.abs(cashflow) / peak) * 48));

  const bars = [
    { label: "Income",   h: iH,  color: "#059669", value: fmt(income)          },
    { label: "Expenses", h: eH,  color: "#f87171", value: fmt(expenses)         },
    { label: "Flow",     h: cH,  color: positive ? "#059669" : "#dc2626",
      value: fmtSigned(cashflow) },
  ];

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Bars */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 6,
        height: 60, paddingBottom: 0,
      }}>
        {bars.map((b, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            {/* value label above bar */}
            <span style={{
              fontSize: 8, fontWeight: 700, color: b.color,
              fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
              whiteSpace: "nowrap", lineHeight: 1,
            }}>{b.value}</span>
            {/* the bar itself */}
            <div style={{
              width: "100%", height: b.h,
              background: b.color, opacity: i === 1 ? 0.72 : 0.85,
              borderRadius: "4px 4px 0 0",
            }} />
          </div>
        ))}
      </div>
      {/* Baseline + labels */}
      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 5, display: "flex", gap: 6 }}>
        {bars.map((b, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 8, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildInsights(r: DealResult, d: DealInput): { type: "positive" | "warning" | "risk"; title: string; body: string }[] {
  const insights: { type: "positive" | "warning" | "risk"; title: string; body: string }[] = [];

  // Cash flow insight
  if (r.cashflow >= 300) {
    insights.push({ type: "positive", title: "Strong cash flow", body: `This property generates ${fmt(r.cashflow)}/mo net — well above the $200 threshold most investors target.` });
  } else if (r.cashflow >= 0) {
    insights.push({ type: "warning", title: "Thin cash flow margin", body: `Only ${fmt(r.cashflow)}/mo net. One vacancy or repair could push you negative. Consider negotiating price or raising rent.` });
  } else {
    insights.push({ type: "risk", title: "Negative cash flow", body: `You'd lose ${fmt(Math.abs(r.cashflow))}/mo out of pocket. This may still build equity, but cash flow is a concern.` });
  }

  // Cap rate insight
  if (r.capRate >= 7) {
    insights.push({ type: "positive", title: "Solid cap rate", body: `${r.capRate.toFixed(1)}% cap rate suggests strong income relative to price — a healthy return if you bought all-cash.` });
  } else if (r.capRate >= 4.5) {
    insights.push({ type: "warning", title: "Average cap rate", body: `${r.capRate.toFixed(1)}% cap rate is typical for this market. Returns are modest but the deal may still make sense long-term.` });
  } else if (r.capRate > 0) {
    insights.push({ type: "risk", title: "Low cap rate", body: `${r.capRate.toFixed(1)}% cap rate means income is low relative to purchase price. You're relying heavily on appreciation.` });
  }

  // DSCR insight
  if (r.dscr >= 1.25) {
    insights.push({ type: "positive", title: "Healthy DSCR", body: `DSCR of ${r.dscr.toFixed(2)} means the property generates ${((r.dscr - 1) * 100).toFixed(0)}% more income than it costs to service — lenders love this.` });
  } else if (r.dscr >= 1.0) {
    insights.push({ type: "warning", title: "Tight debt coverage", body: `DSCR of ${r.dscr.toFixed(2)} just covers debt service. Vacancy or rate increases could put you underwater.` });
  } else {
    insights.push({ type: "risk", title: "Below 1.0 DSCR", body: `DSCR of ${r.dscr.toFixed(2)} means rent doesn't fully cover mortgage and expenses. High risk of negative carry.` });
  }

  // CoC insight
  if (r.coc >= 8) {
    insights.push({ type: "positive", title: "Excellent CoC return", body: `${r.coc.toFixed(1)}% cash-on-cash is above the 8% benchmark most investors aim for. Strong use of leverage.` });
  } else if (r.coc >= 4) {
    insights.push({ type: "warning", title: "Below-average CoC", body: `${r.coc.toFixed(1)}% CoC return is below the 8% benchmark. You might do better in other markets or deal structures.` });
  }

  // Down payment efficiency
  const downPct = d.price > 0 ? (d.down / d.price) * 100 : 0;
  if (downPct > 30 && r.coc < 6) {
    insights.push({ type: "warning", title: "High down payment drag", body: `Putting ${Math.round(downPct)}% down reduces your CoC return significantly. A lower down payment would improve leverage.` });
  }

  return insights.slice(0, 3);
}


// ─── AI-style narrative insight ───────────────────────────────────────────────
function buildNarrative(r: DealResult, d: DealInput, stateAbbr: string): string {
  const cf   = Math.round(r.cashflow);
  const cap  = r.capRate.toFixed(1);
  const dscr = r.dscr.toFixed(2);
  const coc  = r.coc.toFixed(1);
  const downPct = d.price > 0 ? Math.round((d.down / d.price) * 100) : 0;
  const rentRatio = d.price > 0 ? ((d.rent / d.price) * 100).toFixed(2) : "0";
  const stateName = stateAbbr
    ? (({ AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming" } as Record<string,string>)[stateAbbr] ?? stateAbbr)
    : null;

  // Opening — financial verdict
  let opening = "";
  if (cf >= 400 && r.capRate >= 7)
    opening = `This deal posts ${fmt(cf)}/mo in cash flow against a ${cap}% cap rate — both meaningfully above typical benchmarks.`;
  else if (cf >= 200 && r.capRate >= 5)
    opening = `The property generates ${fmt(cf)}/mo after all expenses, with a ${cap}% cap rate that sits in respectable territory.`;
  else if (cf >= 0)
    opening = `Cash flow is thin at ${fmt(cf)}/mo. The ${cap}% cap rate suggests this is more of an appreciation play than a cash-flow machine.`;
  else
    opening = `With a ${fmt(cf)}/mo shortfall, this property is cash-flow negative at current numbers. The ${cap}% cap rate doesn't offset the carry cost.`;

  // Middle — DSCR and leverage
  let middle = "";
  if (r.dscr >= 1.3)
    middle = ` Debt coverage at ${dscr}x is comfortable — lenders and vacancy can absorb before you're in the red.`;
  else if (r.dscr >= 1.0)
    middle = ` Debt coverage at ${dscr}x is tight. One extended vacancy or rate adjustment could flip it negative.`;
  else
    middle = ` Debt coverage of ${dscr}x is below 1.0 — rent doesn't fully cover the debt service. High-risk leverage.`;

  // Middle 2 — CoC and down payment
  let cocNote = "";
  if (r.coc >= 10)
    cocNote = ` Your ${coc}% cash-on-cash return is exceptional use of leverage.`;
  else if (r.coc >= 6)
    cocNote = ` Cash-on-cash of ${coc}% with ${downPct}% down is reasonable.`;
  else if (r.coc >= 0)
    cocNote = ` Cash-on-cash of ${coc}% is below the 8% threshold most investors target.`;
  else
    cocNote = ` Negative cash-on-cash (${coc}%) means you're subsidizing this property each month.`;

  // Closing — rent-to-price ratio
  const rtpNote = parseFloat(rentRatio) >= 0.9
    ? ` The ${rentRatio}% rent-to-price ratio clears the 1% rule — strong income relative to purchase price.`
    : parseFloat(rentRatio) >= 0.65
    ? ` Rent-to-price ratio of ${rentRatio}% misses the 1% rule but may be viable in lower-appreciation markets.`
    : ` The ${rentRatio}% rent-to-price ratio is well below the 1% rule, indicating price significantly outpaces income potential.`;

  // State close
  const stateNote = stateName && r.stateAdj !== 0
    ? ` ${stateName}'s market conditions ${r.stateAdj > 0 ? "add a modest tailwind" : "create a headwind"} to the overall score.`
    : "";

  return opening + middle + cocNote + rtpNote + stateNote;
}

// ─── Score drivers breakdown ───────────────────────────────────────────────────
interface ScoreDriver { label: string; pts: number; note: string; }

function buildDrivers(r: DealResult, d: DealInput, stateAbbr: string): ScoreDriver[] {
  const drivers: ScoreDriver[] = [];

  // CoC
  if (r.coc > 10)      drivers.push({ label: "Cash-on-cash return", pts: +20, note: `${r.coc.toFixed(1)}% — excellent` });
  else if (r.coc > 6)  drivers.push({ label: "Cash-on-cash return", pts: +10, note: `${r.coc.toFixed(1)}% — above average` });
  else if (r.coc < 0)  drivers.push({ label: "Cash-on-cash return", pts: -20, note: `${r.coc.toFixed(1)}% — negative` });
  else if (r.coc < 3)  drivers.push({ label: "Cash-on-cash return", pts: -10, note: `${r.coc.toFixed(1)}% — well below target` });
  else                  drivers.push({ label: "Cash-on-cash return", pts:  0,  note: `${r.coc.toFixed(1)}% — neutral range` });

  // Cap rate
  if (r.capRate > 8)      drivers.push({ label: "Cap rate", pts: +15, note: `${r.capRate.toFixed(1)}% — above benchmark` });
  else if (r.capRate > 5) drivers.push({ label: "Cap rate", pts:  +8, note: `${r.capRate.toFixed(1)}% — respectable` });
  else if (r.capRate < 3) drivers.push({ label: "Cap rate", pts: -15, note: `${r.capRate.toFixed(1)}% — well below target` });
  else if (r.capRate < 5) drivers.push({ label: "Cap rate", pts:  -5, note: `${r.capRate.toFixed(1)}% — below average` });
  else                    drivers.push({ label: "Cap rate", pts:   0, note: `${r.capRate.toFixed(1)}% — neutral` });

  // DSCR
  if (r.dscr > 1.4)      drivers.push({ label: "Debt coverage (DSCR)", pts: +15, note: `${r.dscr.toFixed(2)}x — strong` });
  else if (r.dscr > 1.2) drivers.push({ label: "Debt coverage (DSCR)", pts:  +8, note: `${r.dscr.toFixed(2)}x — healthy` });
  else if (r.dscr < 1.0) drivers.push({ label: "Debt coverage (DSCR)", pts: -20, note: `${r.dscr.toFixed(2)}x — rent < expenses` });
  else if (r.dscr < 1.1) drivers.push({ label: "Debt coverage (DSCR)", pts: -10, note: `${r.dscr.toFixed(2)}x — barely covers` });
  else                   drivers.push({ label: "Debt coverage (DSCR)", pts:   0, note: `${r.dscr.toFixed(2)}x — neutral` });

  // Cash flow
  if (r.cashflow > 300)       drivers.push({ label: "Monthly cash flow", pts: +10, note: `+${fmt(r.cashflow)}/mo` });
  else if (r.cashflow > 0)    drivers.push({ label: "Monthly cash flow", pts:  +3, note: `+${fmt(r.cashflow)}/mo — positive but thin` });
  else if (r.cashflow < -300) drivers.push({ label: "Monthly cash flow", pts: -15, note: `${fmt(r.cashflow)}/mo — significantly negative` });
  else if (r.cashflow < 0)    drivers.push({ label: "Monthly cash flow", pts:  -8, note: `${fmt(r.cashflow)}/mo — negative` });
  else                        drivers.push({ label: "Monthly cash flow", pts:   0, note: "Break-even" });

  // State modifier
  if (stateAbbr && r.stateAdj !== 0) {
    drivers.push({
      label: `${stateAbbr} market factors`,
      pts: r.stateAdj,
      note: r.stateAdjLabel || "state adjustment",
    });
  }

  // Sort by absolute impact, keep top 5
  return drivers
    .filter(d => d.pts !== 0)
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, 5);
}

// ─── Optimization suggestions ─────────────────────────────────────────────────
interface Optimization { action: string; detail: string; scoreDelta: number; }

function buildOptimizations(r: DealResult, d: DealInput): Optimization[] {
  const opts: Optimization[] = [];

  // Only suggest things that are genuinely improvable
  // 1. Rent increase
  if (d.rent > 0) {
    const higherRent = d.rent * 1.10;
    const improved = { ...d, rent: higherRent };
    const newR = calcDeal(improved);
    const delta = newR.baseScore - r.baseScore;
    if (delta > 0) opts.push({
      action: `Increase monthly rent by ${fmt(d.rent * 0.10)}`,
      detail: `From ${fmt(d.rent)} to ${fmt(higherRent)}/mo — improves cash flow to ${fmt(newR.cashflow)}/mo`,
      scoreDelta: delta,
    });
  }

  // 2. Price reduction
  if (d.price > 0) {
    const lowerPrice = d.price * 0.95;
    const newDown = d.down * (lowerPrice / d.price); // proportional down
    const improved = { ...d, price: lowerPrice, down: newDown };
    const newR = calcDeal(improved);
    const delta = newR.baseScore - r.baseScore;
    if (delta > 0) opts.push({
      action: `Negotiate price down 5% (−${fmt(d.price * 0.05)})`,
      detail: `At ${fmt(lowerPrice)}, cap rate rises to ${newR.capRate.toFixed(1)}%, cash flow ${fmt(newR.cashflow)}/mo`,
      scoreDelta: delta,
    });
  }

  // 3. Lower down payment (improve CoC — only if CoC is the weak point)
  if (r.coc < 6 && d.down > 0 && r.dscr >= 1.0) {
    const lowerDown = d.price * 0.20;
    if (lowerDown < d.down) {
      const improved = { ...d, down: lowerDown };
      const newR = calcDeal(improved);
      const delta = newR.baseScore - r.baseScore;
      if (delta > 0) opts.push({
        action: `Reduce down payment to 20% (${fmt(lowerDown)})`,
        detail: `Improves CoC from ${r.coc.toFixed(1)}% → ${newR.coc.toFixed(1)}%, preserves more capital`,
        scoreDelta: delta,
      });
    }
  }

  // 4. Higher down payment (improve DSCR — only if DSCR is the problem)
  if (r.dscr < 1.1 && d.price > 0) {
    const higherDown = d.price * 0.30;
    if (higherDown > d.down) {
      const improved = { ...d, down: higherDown };
      const newR = calcDeal(improved);
      const delta = newR.baseScore - r.baseScore;
      if (delta > 0) opts.push({
        action: `Increase down payment to 30% (${fmt(higherDown)})`,
        detail: `Lowers mortgage, improves DSCR from ${r.dscr.toFixed(2)} → ${newR.dscr.toFixed(2)}x`,
        scoreDelta: delta,
      });
    }
  }

  // 5. Reduce expenses — if opEx is heavy
  const opExRatio = r.totalMonthly > 0 ? r.opEx / r.totalMonthly : 0;
  if (opExRatio > 0.45 && r.opEx > 0) {
    const trimmedExpenses = { ...d, repairs: Math.round(d.repairs * 0.7), mgmt: Math.round(d.mgmt * 0.7), other: 0 };
    const newR = calcDeal(trimmedExpenses);
    const delta = newR.baseScore - r.baseScore;
    if (delta > 0) opts.push({
      action: "Self-manage and trim maintenance budget",
      detail: `Operating expenses at ${Math.round(opExRatio * 100)}% of outflow — self-managing saves ~${fmt(d.mgmt)}/mo`,
      scoreDelta: delta,
    });
  }

  return opts.sort((a, b) => b.scoreDelta - a.scoreDelta).slice(0, 3);
}

// ─── RentVsBuyCard ─────────────────────────────────────────────────────────────
interface RvbAssumptions {
  holdYears:      number;   // 1–20
  appreciation:   number;   // % per year
  rentGrowth:     number;   // % per year
  opportunityCost:number;   // % per year on down payment
  sellingCost:    number;   // % of sale price
  currentRent:    number;   // alternative monthly rent
}
const RVB_DEFAULTS: RvbAssumptions = {
  holdYears: 7, appreciation: 3.5, rentGrowth: 3,
  opportunityCost: 6, sellingCost: 6, currentRent: 0,
};

function calcRvb(d: DealInput, r: DealResult, a: RvbAssumptions) {
  const { holdYears: Y, appreciation: appPct, rentGrowth: rgPct,
          opportunityCost: ocPct, sellingCost: scPct, currentRent: altRent } = a;

  // ── Buy side per year ──────────────────────────────────────────────────────
  const downCash    = d.down;
  const loanAmt     = d.price - d.down;
  const monthlyRate = d.rate / 100 / 12;
  const nMonths     = d.term * 12;
  // Mortgage P&I (same as calcDeal)
  const pAndI       = monthlyRate > 0
    ? loanAmt * (monthlyRate * Math.pow(1 + monthlyRate, nMonths)) / (Math.pow(1 + monthlyRate, nMonths) - 1)
    : loanAmt / nMonths;

  // Opportunity cost of down payment (compounded)
  const ocRate = ocPct / 100;

  // Build year-by-year buy totals
  const buyYearly: number[] = [0];
  let remainingBal = loanAmt;
  let cumBuyCost = 0;
  // Closing costs (approx 2.5% of price up front)
  cumBuyCost += d.price * 0.025;
  // Down payment is not a "cost" but the opportunity cost is
  let ocBase = downCash;

  for (let yr = 1; yr <= 20; yr++) {
    let yearCost = 0;
    for (let mo = 0; mo < 12; mo++) {
      const interest = remainingBal * monthlyRate;
      const principal = pAndI - interest;
      remainingBal = Math.max(0, remainingBal - principal);
      // True costs: interest, taxes, insurance, HOA, repairs (not principal — that's equity)
      yearCost += interest + (d.taxes + d.insurance + d.hoa + d.repairs + d.mgmt + d.other);
    }
    // Opportunity cost of equity tied up (compounded on down + equity accumulated) — simplified: use down * (1+ocRate)^yr each year delta
    const ocCost = ocBase * ocRate;
    ocBase = ocBase * (1 + ocRate);
    yearCost += ocCost;

    // Sale proceeds net (value - remaining balance - selling costs)
    const saleVal     = d.price * Math.pow(1 + appPct / 100, yr);
    const sellingCosts = saleVal * (scPct / 100);
    const netProceeds  = saleVal - remainingBal - sellingCosts - d.down; // equity gain

    cumBuyCost += yearCost;
    // Effective buy cost = cumulative costs - net equity gain
    const effectiveBuyCost = Math.max(0, cumBuyCost - Math.max(0, netProceeds));
    buyYearly.push(Math.round(effectiveBuyCost));
  }

  // ── Rent side per year ─────────────────────────────────────────────────────
  const baseRent   = altRent > 0 ? altRent : (d.rent > 0 ? d.rent : Math.round(d.price * 0.007));
  const rentYearly: number[] = [0];
  let cumRentCost  = 0;
  for (let yr = 1; yr <= 20; yr++) {
    const mo = baseRent * Math.pow(1 + rgPct / 100, yr - 1) * 12;
    // Renter keeps the down — grows at opportunity cost rate (gain, so subtract from rent cost)
    const downGrowth = downCash * (Math.pow(1 + ocRate, yr) - Math.pow(1 + ocRate, yr - 1));
    cumRentCost += mo - downGrowth;
    rentYearly.push(Math.round(Math.max(0, cumRentCost)));
  }

  // ── Break-even year ────────────────────────────────────────────────────────
  let breakEvenYear = -1;
  for (let yr = 1; yr <= 20; yr++) {
    if (buyYearly[yr] <= rentYearly[yr]) { breakEvenYear = yr; break; }
  }

  const holdBuy  = buyYearly[Math.min(Y, 20)];
  const holdRent = rentYearly[Math.min(Y, 20)];
  const diff     = holdRent - holdBuy;
  const cheaper  = diff > 0 ? "buy" : "rent";
  const savings  = Math.abs(diff);
  const monthly  = Math.round(savings / 12 / Y);

  return { buyYearly, rentYearly, breakEvenYear, cheaper, savings, monthly, holdBuy, holdRent, baseRent };
}

function RentVsBuyCard({ d, r }: { d: DealInput; r: DealResult }) {
  const [open, setOpen]         = useState(false);
  const [adv, setAdv]           = useState(false); // advanced panel
  const [assume, setAssume]     = useState<RvbAssumptions>({ ...RVB_DEFAULTS });
  const [hovered, setHovered]   = useState<number | null>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const upd = (k: keyof RvbAssumptions) => (v: number) =>
    setAssume(a => ({ ...a, [k]: v }));

  if (!open) {
    return (
      <div style={{ marginBottom: 32 }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            width: "100%", padding: "14px 20px",
            background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0",
            borderRadius: 16, cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            transition: "all 0.18s", boxShadow: "0 1px 4px rgba(15,23,42,0.04)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2563eb"; (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px rgba(37,99,235,0.1)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(15,23,42,0.04)"; }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 18 }}>🏠</span>
            <div style={{ textAlign: "left" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>Rent vs. Buy Comparison</p>
              <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>See when buying breaks even vs. renting</p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    );
  }

  const calc = calcRvb(d, r, assume);
  const { buyYearly, rentYearly, breakEvenYear, cheaper, monthly, baseRent } = calc;
  const Y = Math.min(assume.holdYears, 20);

  // ── SVG chart geometry ─────────────────────────────────────────────────────
  const W = 460, H = 200, PL = 52, PR = 16, PT = 16, PB = 32;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const maxVal = Math.max(...buyYearly.slice(1, 21), ...rentYearly.slice(1, 21), 1);
  const px = (yr: number) => PL + (yr - 1) / 19 * chartW;
  const py = (v: number)  => PT + chartH - (v / maxVal) * chartH;

  const buyPath  = buyYearly.slice(1, 21).map((v, i) => `${i === 0 ? "M" : "L"}${px(i + 1)},${py(v)}`).join(" ");
  const rentPath = rentYearly.slice(1, 21).map((v, i) => `${i === 0 ? "M" : "L"}${px(i + 1)},${py(v)}`).join(" ");

  const fmt$ = (n: number) => n >= 1000000
    ? "$" + (n / 1000000).toFixed(1) + "M"
    : "$" + Math.round(n / 1000) + "k";

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - PL;
    const yr = Math.round(x / chartW * 19) + 1;
    if (yr >= 1 && yr <= 20) { setHovered(yr); setTooltipX(px(yr)); }
  };

  const summaryBuy   = cheaper === "buy";
  const summaryColor = summaryBuy ? "#059669" : "#2563eb";

  return (
    <div style={{ marginBottom: 32 }}>
      {/* ── Section header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
          <span>Rent vs. Buy</span>
          <div style={{ flex: 1, height: 1, background: "#e2e8f0", width: 40 }} />
        </div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#94a3b8", fontFamily: "inherit", padding: 0, transition: "color 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}>
          Hide ↑
        </button>
      </div>

      {/* ── Summary headline ── */}
      <div style={{
        background: summaryBuy ? "linear-gradient(135deg,#f0fdf4,#f0f9ff)" : "linear-gradient(135deg,#f0f9ff,#f5f3ff)",
        border: `1px solid ${summaryBuy ? "#bbf7d0" : "#bfdbfe"}`,
        borderRadius: 14, padding: "14px 18px", marginBottom: 16,
      }}>
        <p style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", margin: "0 0 4px" }}>
          {summaryBuy
            ? `Buying is cheaper if you stay ${Y} year${Y !== 1 ? "s" : ""}.`
            : `Renting is cheaper for ${Y} year${Y !== 1 ? "s" : ""}.`}
        </p>
        <p style={{ fontSize: 12, color: "#64748b", margin: 0, lineHeight: 1.5 }}>
          {summaryBuy
            ? `You save roughly $${monthly.toLocaleString()}/mo (avg) by buying over renting at $${baseRent.toLocaleString()}/mo.`
            : `You save roughly $${monthly.toLocaleString()}/mo (avg) by renting instead of buying.`}
          {breakEvenYear > 0 && ` Break-even at year ${breakEvenYear}.`}
          {breakEvenYear < 0 && ` Buying never outpaces renting in this scenario.`}
        </p>
      </div>

      {/* ── Hold period slider ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>Hold period</span>
        <input type="range" min={1} max={20} step={1} value={assume.holdYears}
          onChange={e => upd("holdYears")(+e.target.value)}
          style={{ flex: 1, accentColor: summaryColor, height: 4, cursor: "pointer" }}
        />
        <span style={{ fontSize: 13, fontWeight: 800, color: summaryColor, minWidth: 40, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {assume.holdYears} yr{assume.holdYears !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── SVG chart ── */}
      <div style={{ background: "#fff", border: "1px solid #f1f5f9", borderRadius: 14, padding: "12px 8px 6px", marginBottom: 12, position: "relative", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", display: "block", userSelect: "none", touchAction: "none" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map(f => (
            <line key={f}
              x1={PL} y1={PT + chartH - f * chartH}
              x2={W - PR} y2={PT + chartH - f * chartH}
              stroke="#f1f5f9" strokeWidth={1} />
          ))}
          {/* Y axis labels */}
          {[0.25, 0.5, 0.75, 1].map(f => (
            <text key={f} x={PL - 6} y={PT + chartH - f * chartH + 4}
              textAnchor="end" style={{ fontSize: 9, fill: "#94a3b8" }}>
              {fmt$(maxVal * f)}
            </text>
          ))}
          {/* X axis labels */}
          {[1, 5, 10, 15, 20].map(yr => (
            <text key={yr} x={px(yr)} y={H - 6}
              textAnchor="middle" style={{ fontSize: 9, fill: "#94a3b8" }}>
              Yr {yr}
            </text>
          ))}
          {/* Baseline */}
          <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke="#e2e8f0" strokeWidth={1} />

          {/* Break-even dashed vertical line */}
          {breakEvenYear > 0 && breakEvenYear <= 20 && (
            <>
              <line
                x1={px(breakEvenYear)} y1={PT}
                x2={px(breakEvenYear)} y2={PT + chartH}
                stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={px(breakEvenYear) + 5} y={PT + 10} style={{ fontSize: 9, fill: "#94a3b8", fontWeight: 600 }}>
                Break-even
              </text>
            </>
          )}

          {/* Hold period vertical line */}
          <line
            x1={px(Y)} y1={PT}
            x2={px(Y)} y2={PT + chartH}
            stroke={summaryColor} strokeWidth={2} strokeDasharray="5 3" opacity={0.7} />

          {/* Rent line (filled area) */}
          <path d={`${rentPath} L${px(20)},${PT + chartH} L${px(1)},${PT + chartH}Z`}
            fill="#3b82f680" fillOpacity={0.08} />
          <path d={rentPath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Buy line (filled area) */}
          <path d={`${buyPath} L${px(20)},${PT + chartH} L${px(1)},${PT + chartH}Z`}
            fill="#059669" fillOpacity={0.06} />
          <path d={buyPath} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Hover crosshair */}
          {hovered !== null && (
            <>
              <line x1={tooltipX} y1={PT} x2={tooltipX} y2={PT + chartH}
                stroke="#cbd5e1" strokeWidth={1} />
              <circle cx={tooltipX} cy={py(buyYearly[hovered])}  r={4} fill="#059669" />
              <circle cx={tooltipX} cy={py(rentYearly[hovered])} r={4} fill="#3b82f6" />
              {/* Tooltip bubble */}
              <rect x={Math.min(tooltipX + 8, W - 90)} y={PT + 4} width={82} height={40} rx={6}
                fill="#0f172a" opacity={0.9} />
              <text x={Math.min(tooltipX + 49, W - 49)} y={PT + 17} textAnchor="middle"
                style={{ fontSize: 9, fill: "#94a3b8" }}>Year {hovered}</text>
              <text x={Math.min(tooltipX + 49, W - 49)} y={PT + 28} textAnchor="middle"
                style={{ fontSize: 9, fill: "#4ade80" }}>Buy {fmt$(buyYearly[hovered])}</text>
              <text x={Math.min(tooltipX + 49, W - 49)} y={PT + 38} textAnchor="middle"
                style={{ fontSize: 9, fill: "#93c5fd" }}>Rent {fmt$(rentYearly[hovered])}</text>
            </>
          )}
        </svg>

        {/* Legend */}
        <div style={{ display: "flex", gap: 20, padding: "4px 12px 8px", justifyContent: "center" }}>
          {[["#059669", "Buy (cumulative cost)"], ["#3b82f6", "Rent (cumulative cost)"]].map(([col, lbl]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 24, height: 2.5, background: col, borderRadius: 99 }} />
              <span style={{ fontSize: 10, color: "#64748b" }}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Cost breakdown table ── */}
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "10px 16px", borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Over {Y} year{Y !== 1 ? "s" : ""}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 80, textAlign: "right" }}>Buy</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 80, textAlign: "right" }}>Rent</span>
        </div>
        {([
          { label: "Mortgage interest",  buy: Math.round((r.mortgage - (d.price - d.down) / (d.term * 12)) * 12 * Y), rent: 0 },
          { label: "Property taxes",     buy: d.taxes * 12 * Y,      rent: 0 },
          { label: "Insurance + HOA",    buy: (d.insurance + d.hoa) * 12 * Y, rent: 0 },
          { label: "Maintenance",        buy: d.repairs * 12 * Y,    rent: 0 },
          { label: "Monthly rent paid",  buy: 0,                      rent: Math.round(assume.currentRent > 0 ? assume.currentRent : baseRent) * 12 * Y },
          { label: "Opportunity cost",   buy: Math.round(d.down * (Math.pow(1 + assume.opportunityCost / 100, Y) - 1)), rent: 0, tip: "What your down payment could earn invested instead" },
          { label: "Selling costs",      buy: Math.round(d.price * Math.pow(1 + assume.appreciation / 100, Y) * assume.sellingCost / 100), rent: 0 },
          { label: "Equity gained",      buy: -Math.round(Math.max(0, d.price * Math.pow(1 + assume.appreciation / 100, Y) - (d.price - d.down) - d.price * 0.025)), rent: 0, isGain: true },
        ] as { label: string; buy: number; rent: number; tip?: string; isGain?: boolean }[]).map((row, i, arr) => {
          const showBuy  = row.buy  !== 0;
          const showRent = row.rent !== 0;
          if (!showBuy && !showRent) return null;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "9px 16px", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 5 }}>
                {row.label}
                {row.tip && (
                  <span title={row.tip} style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid #cbd5e1", background: "#f8fafc", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#64748b", cursor: "default" }}>?</span>
                )}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: row.isGain ? "#059669" : "#0f172a", minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {showBuy ? (row.isGain ? "−" : "") + "$" + Math.abs(row.buy).toLocaleString() : "—"}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {showRent ? "$" + row.rent.toLocaleString() : "—"}
              </span>
            </div>
          );
        })}
        {/* Total row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "12px 16px", background: "#fff", borderTop: "2px solid #e2e8f0" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Total estimated cost</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: calc.holdBuy < calc.holdRent ? "#059669" : "#0f172a", minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ${calc.holdBuy.toLocaleString()}
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: calc.holdRent < calc.holdBuy ? "#3b82f6" : "#0f172a", minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ${calc.holdRent.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── Advanced assumptions ── */}
      <button
        onClick={() => setAdv(v => !v)}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: "#64748b", padding: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: adv ? 12 : 0, transition: "color 0.15s" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points={adv ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
        </svg>
        Advanced assumptions
      </button>
      {adv && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px 20px" }}>
          {([
            { label: "Monthly rent alternative", key: "currentRent" as const, suffix: "/mo", prefix: "$", step: 50, min: 0, max: 10000, tip: "What you'd pay renting instead" },
            { label: "Home appreciation", key: "appreciation" as const, suffix: "%/yr", step: 0.5, min: 0, max: 10 },
            { label: "Annual rent growth", key: "rentGrowth" as const, suffix: "%/yr", step: 0.5, min: 0, max: 10 },
            { label: "Opportunity cost rate", key: "opportunityCost" as const, suffix: "%/yr", step: 0.5, min: 0, max: 15, tip: "Expected return if down payment was invested" },
            { label: "Selling costs", key: "sellingCost" as const, suffix: "% of sale", step: 0.5, min: 0, max: 12 },
          ] as { label: string; key: keyof RvbAssumptions; suffix: string; prefix?: string; step: number; min: number; max: number; tip?: string }[]).map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
                {f.label}
                {f.tip && <span title={f.tip} style={{ marginLeft: 5, width: 12, height: 12, borderRadius: "50%", border: "1px solid #cbd5e1", background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#64748b", cursor: "default" }}>?</span>}
              </label>
              <div style={{ position: "relative" }}>
                {f.prefix && <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8", pointerEvents: "none" }}>{f.prefix}</span>}
                <input type="number" step={f.step} min={f.min} max={f.max}
                  value={assume[f.key]}
                  onChange={e => upd(f.key)(+e.target.value)}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: f.prefix ? "6px 10px 6px 20px" : "6px 10px",
                    border: "1.5px solid #e2e8f0", borderRadius: 8,
                    fontSize: 12, color: "#0f172a", fontFamily: "inherit",
                    background: "#fff", outline: "none",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#2563eb"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
                />
              </div>
              <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>{f.suffix}</p>
            </div>
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 10, lineHeight: 1.5 }}>
        Estimates based on simplified assumptions. Not financial advice. Actual costs depend on your market, tax situation, and mortgage terms.
      </p>
    </div>
  );
}

// ─── MarketOutlookPanel ────────────────────────────────────────────────────────
function MarketOutlookPanel({ data, address }: { data: MarketRow[]; address: string }) {
  const [open, setOpen]         = useState(true);
  const [searchQ, setSearchQ]   = useState(address.split(",")[0].trim() || "");

  // Filter rows matching the address/state
  const matches = data.filter(r =>
    r.region_name.toLowerCase().includes(searchQ.toLowerCase()) ||
    r.state_name.toLowerCase().includes(searchQ.toLowerCase())
  ).slice(0, 40);

  const topRow = matches[0] ?? null;
  const medApp1 = matches.reduce((s, r) => s + (r.appreciation_1y_pct ?? 0), 0) / Math.max(matches.filter(r => r.appreciation_1y_pct !== null).length, 1);
  const medApp5 = matches.reduce((s, r) => s + (r.appreciation_5y_pct ?? 0), 0) / Math.max(matches.filter(r => r.appreciation_5y_pct !== null).length, 1);

  if (!open) {
    return (
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => setOpen(true)} style={{
          width: "100%", padding: "12px 18px",
          background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0",
          borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          transition: "all 0.18s",
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2563eb"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Market Outlook</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>{data.length.toLocaleString()} regions loaded</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#64748b", display: "flex", alignItems: "center", gap: 8 }}>
          <span>Market Outlook</span>
          <div style={{ height: 1, background: "#e2e8f0", width: 32 }} />
        </div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: "#94a3b8", padding: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}>
          Hide ↑
        </button>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
        <input
          type="text"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Filter by city, metro, or state…"
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "8px 12px 8px 30px",
            border: "1.5px solid #e2e8f0", borderRadius: 10,
            fontSize: 13, color: "#0f172a", fontFamily: "inherit",
            background: "#fff", outline: "none",
            transition: "border-color 0.18s",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "#2563eb"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
        />
      </div>

      {/* Summary stat cards */}
      {matches.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Regions Matched", value: matches.length.toLocaleString(), color: "#2563eb" },
            { label: "Avg 1yr Appreciation", value: medApp1.toFixed(1) + "%", color: medApp1 >= 0 ? "#059669" : "#dc2626" },
            { label: "Avg 5yr Appreciation", value: medApp5.toFixed(1) + "%", color: medApp5 >= 0 ? "#059669" : "#dc2626" },
            ...(topRow?.latest_value ? [{ label: "Median Value", value: "$" + Math.round(topRow.latest_value / 1000) + "k", color: "#0f172a" }] : []),
          ].map(s => (
            <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>{s.label}</p>
              <p style={{ fontSize: 16, fontWeight: 800, color: s.color, letterSpacing: "-0.03em", margin: 0, fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {matches.length > 0 ? (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
                <tr>
                  {["Region", "State", "Median Value", "1yr %", "5yr %"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matches.map((row, i) => {
                  const c1 = row.appreciation_1y_pct !== null ? (row.appreciation_1y_pct >= 0 ? "#059669" : "#dc2626") : "#94a3b8";
                  const c5 = row.appreciation_5y_pct !== null ? (row.appreciation_5y_pct >= 0 ? "#059669" : "#dc2626") : "#94a3b8";
                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 12px", fontWeight: 600, color: "#0f172a" }}>{row.region_name || "—"}</td>
                      <td style={{ padding: "7px 12px", color: "#64748b" }}>{row.state_name || "—"}</td>
                      <td style={{ padding: "7px 12px", color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                        {row.latest_value !== null ? "$" + Math.round(row.latest_value / 1000) + "k" : "—"}
                      </td>
                      <td style={{ padding: "7px 12px", color: c1, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {row.appreciation_1y_pct !== null ? (row.appreciation_1y_pct >= 0 ? "+" : "") + row.appreciation_1y_pct + "%" : "—"}
                      </td>
                      <td style={{ padding: "7px 12px", color: c5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {row.appreciation_5y_pct !== null ? (row.appreciation_5y_pct >= 0 ? "+" : "") + row.appreciation_5y_pct + "%" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "28px 0", color: "#94a3b8", fontSize: 12 }}>
          No regions match "{searchQ}". Try a different city or state name.
        </div>
      )}

      <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 10, lineHeight: 1.5 }}>
        {data.length.toLocaleString()} total regions from your imported file · Appreciation = % change in median home value
      </p>
    </div>
  );
}

// ─── DealScorePreview — premium ghost state shown before analysis ─────────────
function ScoreRing({ score, color, size = 120 }: { score: number; color: string; size?: number }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTimeout(() => setAnimated(score), 60);
    });
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const animFilled = (animated / 100) * circ;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color === "#059669" ? "#10b981" : color === "#d97706" ? "#f59e0b" : "#ef4444"} />
        </linearGradient>
      </defs>
      {/* Track */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={8} />
      {/* Fill */}
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="url(#ring-grad)" strokeWidth={8}
        strokeDasharray={`${animFilled} ${circ - animFilled}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(.22,1,.36,1)" }}
      />
      {/* Score text */}
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" style={{ fontSize: 26, fontWeight: 900, fill: color, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}>
        {score}
      </text>
      <text x={size / 2} y={size / 2 + 12} textAnchor="middle" style={{ fontSize: 11, fill: "#94a3b8" }}>
        / 100
      </text>
    </svg>
  );
}

interface ScoreCategory {
  key: string;
  label: string;
  weight: number;
  score: number;
  color: string;
  tooltip: string;
  icon: React.ReactNode;
}

function ScoreBar({ score, color, delay }: { score: number; color: string; delay: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(score), delay);
    return () => clearTimeout(t);
  }, [score, delay]);
  return (
    <div style={{ height: 5, borderRadius: 99, background: "#f1f5f9", overflow: "hidden", flex: 1 }}>
      <div style={{
        height: "100%", borderRadius: 99,
        width: w + "%",
        background: `linear-gradient(90deg, ${color}, ${color}cc)`,
        transition: "width 0.65s cubic-bezier(.22,1,.36,1)",
      }} />
    </div>
  );
}

function DealScorePreview({ isBuyer }: { isBuyer: boolean }) {
  // Ghost data — shown blurred before analysis runs
  const ghostCats: ScoreCategory[] = [
    { key: "cashflow",    label: "Cash Flow",    weight: 35, score: 72, color: "#059669", tooltip: "Monthly income after all expenses", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
    { key: "returns",     label: "Returns",      weight: 30, score: 81, color: "#2563eb", tooltip: "Cap rate, CoC return, and overall yield", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
    { key: "coverage",    label: "Debt Coverage", weight: 20, score: 65, color: "#7c3aed", tooltip: "DSCR — does rent cover the mortgage and all expenses?", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> },
    { key: "market",      label: "Market",       weight: 15, score: 58, color: "#ea580c", tooltip: "State-level factors: taxes, landlord laws, insurance risk", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
  ];
  const ghostScore = 74;
  const ghostColor = "#059669";

  if (isBuyer) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.9)", borderRadius: 20,
        border: "1px solid #e2e8f0",
        boxShadow: "0 2px 12px rgba(15,23,42,0.06), 0 8px 32px rgba(15,23,42,0.04)",
        padding: "28px 24px",
      }}>
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 32, marginBottom: 14, opacity: 0.3 }}>🏠</div>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#475569", marginBottom: 8 }}>Cost breakdown will appear here</p>
          <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>Fill in your purchase details and click Calculate.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "linear-gradient(160deg, #ffffff 0%, #f8faff 100%)",
      borderRadius: 20, border: "1px solid #e2e8f0",
      boxShadow: "0 2px 12px rgba(15,23,42,0.06), 0 8px 32px rgba(15,23,42,0.04)",
      overflow: "hidden", position: "relative",
    }}>
      {/* Blurred ghost content */}
      <div style={{ filter: "blur(3.5px)", userSelect: "none", pointerEvents: "none", opacity: 0.55 }}>
        {/* Header */}
        <div style={{ padding: "24px 24px 0", textAlign: "center", marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 6 }}>Deal Score Breakdown</p>
          <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, margin: 0 }}>See how this deal is evaluated across key investment factors</p>
        </div>

        {/* Ring + label */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #f1f5f9" }}>
          <ScoreRing score={ghostScore} color={ghostColor} size={120} />
          <div style={{ marginTop: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 999, padding: "4px 14px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>Strong Investment</span>
          </div>
        </div>

        {/* Category rows */}
        <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {ghostCats.map((cat, i) => (
            <div key={cat.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ color: cat.color, flexShrink: 0, display: "flex" }}>{cat.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", flex: 1 }}>{cat.label}</span>
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>{cat.weight}%</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: cat.color, minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{cat.score}%</span>
              </div>
              <ScoreBar score={cat.score} color={cat.color} delay={i * 80} />
            </div>
          ))}
        </div>
      </div>

      {/* Overlay CTA */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 40%, rgba(255,255,255,0.92) 100%)",
        padding: "24px",
      }}>
        <div style={{
          marginTop: "auto",
          background: "rgba(255,255,255,0.98)", borderRadius: 16,
          border: "1px solid #e2e8f0",
          boxShadow: "0 4px 20px rgba(15,23,42,0.1)",
          padding: "20px 24px", textAlign: "center", maxWidth: 260,
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#eff6ff,#f0fdf4)", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: 20 }}>
            📊
          </div>
          <p style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 6 }}>
            Enter a property to generate your deal score
          </p>
          <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.55, margin: 0 }}>
            Fill in purchase price, rent, and expenses — we'll score the deal across 4 key dimensions.
          </p>
        </div>
      </div>
    </div>
  );
}

interface InvestorDashboardProps {
  result: AnalysisResult;
  saved: boolean;
  onSave: () => void;
  onFocusRent: () => void;
  scoreColor: string;
  user: AuthUser | null;
  onOpenLogin: () => void;
  stateAbbr?: string;
}

function InvestorDashboard({ result, saved, onSave, onFocusRent, scoreColor, user, onOpenLogin, stateAbbr = "" }: InvestorDashboardProps) {
  const { r, d, rentMissing } = result;

  if (rentMissing) {
    return (
      <div>
        <div style={{ marginBottom: 28, padding: "14px 16px", background: "#fdf5e8", border: "1px solid #e8c87a", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 9, background: C.amber, color: "#fff", padding: "2px 7px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0, marginTop: 1 }}>NOTE</span>
          <div>
            <p style={{ fontSize: 12, color: "#7a5500", fontWeight: 500, marginBottom: 3 }}>Rent is required for full investment analysis</p>
            <p style={{ fontSize: 11, color: "#9a7020", lineHeight: 1.5 }}>Showing mortgage and cost estimates. Add a monthly rent to unlock the full dashboard.</p>
          </div>
        </div>
        <MetRow label="Monthly Mortgage" value={fmt(r.mortgage)} />
        <MetRow label="Total Monthly Expenses" value={fmt(r.totalMonthly)} />
        <div style={{ marginTop: 16, border: `1px dashed ${C.rule}`, padding: "20px 16px", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: C.faint, marginBottom: 12, lineHeight: 1.6 }}>Add a monthly rent to unlock the full results dashboard.</p>
          <button onClick={onFocusRent} style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: C.text, color: C.bg, border: "none", padding: "8px 18px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Add Rent to Unlock</button>
        </div>
      </div>
    );
  }

  const narrative   = buildNarrative(r, d, stateAbbr);
  const drivers     = buildDrivers(r, d, stateAbbr);
  const opts        = buildOptimizations(r, d);
  const vacancyLoss = d.rent - r.effectiveRent;

  // Section header shared style
  const sh: React.CSSProperties = {
    fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase",
    color: "#64748b", fontWeight: 700, marginBottom: 16,
    display: "flex", alignItems: "center", gap: 8,
  };
  // Thin rule after label — done with a flex child
  const rule = <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ══ 1. SCORE HERO ══════════════════════════════════════════════════════ */}
      <div>
        <div style={{ ...sh }}><span>Deal Score</span>{rule}</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 14 }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <span style={{
              fontSize: 80, fontWeight: 800, lineHeight: 0.88,
              letterSpacing: "-0.055em", color: scoreColor,
              fontVariantNumeric: "tabular-nums", display: "block",
            }}>{r.score}</span>
            <span style={{ fontSize: 10, color: "#94a3b8", marginTop: 5, display: "block" }}>/ 100</span>
          </div>
          <div style={{ paddingTop: 4, flex: 1 }}>
            <ScoreChip label={r.label} />
            <div style={{ marginTop: 10, height: 5, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 999, width: `${r.score}%`,
                background: r.score >= 70 ? "linear-gradient(90deg,#059669,#10b981)"
                  : r.score >= 45 ? "linear-gradient(90deg,#d97706,#f59e0b)"
                  : "linear-gradient(90deg,#dc2626,#ef4444)",
                transition: "width 0.6s ease",
              }} />
            </div>
            <p style={{ fontSize: 11, color: "#475569", marginTop: 8, lineHeight: 1.6 }}>{r.reason}</p>
          </div>
        </div>
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Base deal score</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{r.baseScore}</span>
          </div>
          {stateAbbr ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>State factors <span style={{ color: "#94a3b8" }}>({stateAbbr})</span></span>
              {r.stateAdj !== 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.stateAdj > 0 ? "#059669" : "#dc2626" }}>{r.stateAdj > 0 ? "+" : ""}{r.stateAdj}</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{r.stateAdjLabel}</span>
                </div>
              ) : <span style={{ fontSize: 11, color: "#94a3b8" }}>Neutral</span>}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>Select a state to factor in market conditions</div>
          )}
          <div style={{ height: 1, background: "#e2e8f0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Final score</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>{r.score}</span>
          </div>
        </div>
      </div>

      {/* ══ 2. KPI CARDS ═══════════════════════════════════════════════════════ */}
      <div>
        <div style={{ ...sh }}><span>Key Metrics</span>{rule}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {[
            { label: "Cash Flow / mo", value: fmtSigned(r.cashflow), sub: `${fmtSigned(r.annualCashflow)}/yr`, color: r.cashflow >= 0 ? C.green : C.red },
            { label: "Cap Rate",       value: r.capRate.toFixed(2) + "%", sub: r.capRate >= 6 ? "Above benchmark" : r.capRate >= 4 ? "Average" : "Below avg", color: r.capRate >= 6 ? C.green : r.capRate < 4 ? C.red : "#475569" },
            { label: "Cash-on-Cash",   value: r.coc.toFixed(2) + "%", sub: r.coc >= 8 ? "Excellent" : r.coc >= 5 ? "Acceptable" : "Below target", color: r.coc >= 8 ? C.green : r.coc < 3 ? C.red : "#475569" },
            { label: "DSCR",           value: r.dscr.toFixed(2), sub: r.dscr >= 1.25 ? "Healthy coverage" : r.dscr >= 1.0 ? "Breakeven" : "Negative carry", color: r.dscr >= 1.25 ? C.green : r.dscr < 1.0 ? C.red : "#475569" },
          ].map(card => (
            <div key={card.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
              <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7 }}>{card.label}</p>
              <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.04em", color: card.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 5 }}>{card.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ══ 3. AI INVESTMENT INSIGHT ═══════════════════════════════════════════ */}
      <div>
        <div style={{ ...sh }}><span>AI Investment Insight</span>{rule}</div>
        <div style={{ background: "linear-gradient(135deg,#eff6ff,#f0fdf4)", border: "1px solid #bfdbfe", borderRadius: 12, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#2563eb,#059669)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
            <span style={{ fontSize: 13 }}>✦</span>
          </div>
          <p style={{ fontSize: 12, color: "#1e3a5f", lineHeight: 1.7, margin: 0 }}>{narrative}</p>
        </div>
      </div>

      {/* ══ 4. SCORE DRIVERS ═══════════════════════════════════════════════════ */}
      {drivers.length > 0 && (
        <div>
          <div style={{ ...sh }}><span>Score Drivers</span>{rule}</div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            {drivers.map((drv, i) => {
              const positive = drv.pts > 0;
              const barWidth = Math.min(100, Math.abs(drv.pts) / 20 * 100);
              return (
                <div key={i} style={{ padding: "10px 14px", borderBottom: i < drivers.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{drv.label}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 7 }}>{drv.note}</span>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                      color: positive ? "#059669" : "#dc2626",
                      background: positive ? "#f0fdf4" : "#fff1f2",
                      border: `1px solid ${positive ? "#bbf7d0" : "#fecdd3"}`,
                      borderRadius: 5, padding: "1px 7px", flexShrink: 0,
                    }}>{positive ? "+" : ""}{drv.pts} pts</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 999, width: `${barWidth}%`, background: positive ? "#10b981" : "#f87171", transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ 5. OPTIMIZATION SUGGESTIONS ═══════════════════════════════════════ */}
      {opts.length > 0 && (
        <div>
          <div style={{ ...sh }}><span>Optimization Suggestions</span>{rule}</div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            {opts.map((opt, i) => (
              <div key={i} style={{ padding: "10px 14px", borderBottom: i < opts.length - 1 ? "1px solid #f1f5f9" : "none", display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 12 }}>↑</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>{opt.action}</p>
                  <p style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{opt.detail}</p>
                </div>
                <div style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#059669", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                  +{opt.scoreDelta} pts
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ 6. INCOME vs EXPENSES ══════════════════════════════════════════════ */}
      <div>
        <div style={{ ...sh }}><span>Income vs. Expenses</span>{rule}</div>
        <BarChart income={r.effectiveRent} expenses={r.totalMonthly} d={d} />
      </div>

      {/* ══ 7. MONTHLY BREAKDOWN ═══════════════════════════════════════════════ */}
      <div>
        <div style={{ ...sh }}><span>Monthly Breakdown</span>{rule}</div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          {/* Income sub-header */}
          <div style={{ padding: "8px 16px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Income</span>
          </div>
          <div style={{ padding: "4px 16px" }}>
            <MetRow label="Gross Rent" value={fmt(d.rent)} />
            <MetRow label="Vacancy Loss" value={"−" + fmt(vacancyLoss)} accent="red" />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Effective Rent</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.green, fontVariantNumeric: "tabular-nums" }}>{fmt(r.effectiveRent)}</span>
            </div>
          </div>
          {/* Expenses sub-header */}
          <div style={{ padding: "8px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Expenses</span>
          </div>
          <div style={{ padding: "4px 16px" }}>
            <MetRow label="Mortgage (P&I)" value={fmt(r.mortgage)} />
            {d.taxes > 0 && <MetRow label="Property Taxes" value={fmt(d.taxes)} />}
            {d.insurance > 0 && <MetRow label="Insurance" value={fmt(d.insurance)} />}
            {d.hoa > 0 && <MetRow label="HOA" value={fmt(d.hoa)} />}
            {d.repairs > 0 && <MetRow label="Repairs & Maint." value={fmt(d.repairs)} />}
            {d.mgmt > 0 && <MetRow label="Mgmt" value={fmt(d.mgmt)} />}
            {d.other > 0 && <MetRow label="Other" value={fmt(d.other)} />}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Total Expenses</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.red, fontVariantNumeric: "tabular-nums" }}>{fmt(r.totalMonthly)}</span>
            </div>
          </div>
          {/* Net cash flow */}
          <div style={{
            padding: "11px 16px", borderTop: "1.5px solid #e2e8f0",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: r.cashflow >= 0 ? "#f0fdf4" : "#fff1f2",
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Net Cash Flow / mo</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: r.cashflow >= 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{fmtSigned(r.cashflow)}</span>
          </div>
        </div>
      </div>

      {/* ══ 8. RENT VS BUY ════════════════════════════════════════════════════ */}
      <RentVsBuyCard d={d} r={r} />

      {/* ══ 9. SAVE BUTTON ═════════════════════════════════════════════════════ */}
      {user ? (
        <button
          onClick={onSave}
          disabled={saved}
          onMouseEnter={e => { if (!saved) { (e.currentTarget as HTMLElement).style.opacity = "0.88"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
          style={{
            width: "100%", padding: "13px",
            background: saved ? "#f1f5f9" : "linear-gradient(135deg,#2563eb,#0ea5e9)",
            color: saved ? "#94a3b8" : "#fff",
            border: `1.5px solid ${saved ? "#e2e8f0" : "transparent"}`,
            borderRadius: 12, fontSize: 13, letterSpacing: "0.06em",
            fontWeight: 700, cursor: saved ? "default" : "pointer",
            fontFamily: "inherit", transition: "all 0.18s",
            boxShadow: saved ? "none" : "0 4px 14px rgba(37,99,235,0.3)",
          }}
        >
          {saved ? "✓  Saved to Dashboard" : "Save Deal →"}
        </button>
      ) : (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 2 }}>Want to save this deal?</p>
            <p style={{ fontSize: 11, color: "#64748b" }}>Log in to save deals to your dashboard.</p>
          </div>
          <button onClick={onOpenLogin} style={{ flexShrink: 0, padding: "8px 18px", background: "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s", boxShadow: "0 2px 8px rgba(37,99,235,0.25)" }}>
            Log In
          </button>
        </div>
      )}
    </div>
  );
}




// ─── useInView — scroll-triggered visibility hook ─────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

// ─── Showcase Section ─────────────────────────────────────────────────────────
// Feature preview cards used on the landing page

function ShowCard({ title, tag, tagColor, desc, delay, children }: {
  title: string; tag: string; tagColor: string; desc: string; delay: number; children: React.ReactNode;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <FadeIn delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: "rgba(255,255,255,0.92)", border: `1px solid ${C.rule}`,
          borderRadius: 20, overflow: "hidden",
          boxShadow: hovered ? "0 8px 32px rgba(15,23,42,0.12)" : "0 2px 8px rgba(15,23,42,0.05)",
          transform: hovered ? "translateY(-3px)" : "none",
          transition: "all 0.22s cubic-bezier(.22,1,.36,1)",
        }}
      >
        {/* Preview area */}
        <div style={{ background: C.bg2, borderBottom: `1px solid ${C.rule}`, padding: "28px 24px 20px", minHeight: 130 }}>
          {children}
        </div>
        {/* Text */}
        <div style={{ padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: "-0.02em", flex: 1 }}>{title}</p>
            <span style={{ fontSize: 9, fontWeight: 800, color: tagColor, background: tagColor + "14", border: `1px solid ${tagColor}30`, borderRadius: 999, padding: "2px 9px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{tag}</span>
          </div>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.65, margin: 0 }}>{desc}</p>
        </div>
      </div>
    </FadeIn>
  );
}

function CardFinancial() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[
        { label: "Mortgage (P&I)", value: "$1,647/mo", color: C.text },
        { label: "Property Taxes",  value: "$420/mo",   color: C.text },
        { label: "Insurance",       value: "$98/mo",    color: C.text },
        { label: "Net Cash Flow",   value: "+$385/mo",  color: C.green },
      ].map(row => (
        <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#fff", borderRadius: 8, border: `1px solid ${C.rule}` }}>
          <span style={{ fontSize: 11, color: C.muted }}>{row.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: row.color, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function CardDealScore() {
  const score = 74;
  const circ = 2 * Math.PI * 30;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={30} fill="none" stroke={C.rule} strokeWidth={7} />
        <circle cx={40} cy={40} r={30} fill="none" stroke={C.green} strokeWidth={7}
          strokeDasharray={`${(score/100)*circ} ${circ}`} strokeDashoffset={circ/4} strokeLinecap="round" />
        <text x={40} y={44} textAnchor="middle" style={{ fontSize: 18, fontWeight: 900, fill: C.green }}>{score}</text>
      </svg>
      <div>
        <p style={{ fontSize: 13, fontWeight: 800, color: C.green, marginBottom: 4 }}>Strong Deal</p>
        {["Cash flow ✓", "Cap rate ✓", "DSCR healthy"].map(t => (
          <p key={t} style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{t}</p>
        ))}
      </div>
    </div>
  );
}

function CardCSV() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginBottom: 8 }}>
        {["Address","Price","Rent","Score"].map(h => (
          <div key={h} style={{ fontSize: 8, fontWeight: 700, color: C.faint, letterSpacing: "0.07em", textTransform: "uppercase", textAlign: "center" }}>{h}</div>
        ))}
      </div>
      {[
        ["8901 Maple Dr", "$320k", "$2,200", "78"],
        ["14 River Rd",   "$415k", "$2,950", "82"],
        ["3801 Oak Ave",  "$289k", "$1,850", "61"],
      ].map((row, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginBottom: 4 }}>
          {row.map((cell, j) => (
            <div key={j} style={{ fontSize: 10, color: j === 3 ? C.green : C.text, fontWeight: j === 3 ? 700 : 400, textAlign: "center", background: "#fff", borderRadius: 5, padding: "3px 2px", border: `1px solid ${C.rule}` }}>{cell}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CardCompare() {
  const deals = [
    { addr: "8901 Maple", cf: "+$385", score: 74, color: C.green },
    { addr: "14 River Rd", cf: "+$512", score: 82, color: C.blue },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {deals.map(d => (
        <div key={d.addr} style={{ background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 10, padding: "12px 12px 10px", textAlign: "center" }}>
          <p style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 500 }}>{d.addr}</p>
          <p style={{ fontSize: 22, fontWeight: 800, color: d.color, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{d.cf}</p>
          <p style={{ fontSize: 10, color: C.faint, marginTop: 4 }}>Score: <strong style={{ color: d.color }}>{d.score}</strong></p>
        </div>
      ))}
    </div>
  );
}

function CardDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[
        { addr: "8901 Maple Dr", score: 74, cf: "+$385/mo", tag: "Watching" },
        { addr: "14 River Rd",   score: 82, cf: "+$512/mo", tag: "Saved" },
        { addr: "3801 Oak Ave",  score: 61, cf: "+$120/mo", tag: "Saved" },
      ].map(d => (
        <div key={d.addr} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", borderRadius: 8, border: `1px solid ${C.rule}`, padding: "8px 10px" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: C.bg2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: C.muted, flexShrink: 0 }}>{d.score}</span>
          <span style={{ fontSize: 11, color: C.text, flex: 1, fontWeight: 500 }}>{d.addr}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.green, fontVariantNumeric: "tabular-nums" }}>{d.cf}</span>
        </div>
      ))}
    </div>
  );
}

function ShowcaseSection() {
  return (
    <section style={{ background: "rgba(255,255,255,0.5)", borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}`, backdropFilter: "blur(8px)" }}>
      <style>{`
        @keyframes float-up {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
      `}</style>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(48px,7vw,88px) clamp(16px,4vw,40px)" }}>
        <FadeIn>
          <div style={{ marginBottom: 60 }}>
            <p style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, fontWeight: 600, marginBottom: 14 }}>What you get</p>
            <h2 style={{ fontSize: "clamp(32px,4vw,52px)", fontWeight: 800, letterSpacing: "-0.04em", color: C.text, lineHeight: 1.08, margin: "0 0 18px", maxWidth: 620 }}>
              Every tool to analyze,<br />compare, and decide.
            </h2>
            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, maxWidth: 440, margin: 0 }}>
              Manual entry, CSV upload, or bulk analysis — Dealistic gives you the numbers that matter.
            </p>
          </div>
        </FadeIn>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <ShowCard title="Full Financial Breakdown" tag="Cash Flow" tagColor={C.green} delay={0}
            desc="See mortgage, taxes, insurance, and net cash flow side by side — before you ever make an offer.">
            <CardFinancial />
          </ShowCard>

          <ShowCard title="Deal Score — 1 to 100" tag="AI Score" tagColor={C.blue} delay={0.08}
            desc="Every deal gets a score. See exactly why it's great, average, or risky — in plain language.">
            <CardDealScore />
          </ShowCard>

          <ShowCard title="CSV Bulk Upload" tag="Batch Import" tagColor={C.amber} delay={0.14}
            desc="Import dozens of deals at once. Strong deals are flagged automatically so you know where to focus.">
            <CardCSV />
          </ShowCard>

          <ShowCard title="Side-by-Side Comparison" tag="Compare" tagColor="#7c3aed" delay={0.20}
            desc="Stack properties head-to-head on every metric. The winner is always obvious.">
            <CardCompare />
          </ShowCard>

          <ShowCard title="Save & Organize" tag="Dashboard" tagColor={C.green} delay={0.26}
            desc="Tag deals, track your pipeline, and revisit your best opportunities from one clean dashboard.">
            <CardDashboard />
          </ShowCard>
        </div>
      </div>
    </section>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────
// Premium redesign inspired by eloqwnt.com — large type, marquee, rounded cards

// Marquee ticker strip
function Marquee() {
  const items = [
    "/ Deal Score", "/ Cash Flow Analysis", "/ Cap Rate", "/ CoC Return",
    "/ DSCR", "/ Investment Grade", "/ Portfolio Tracker", "/ Bulk CSV Import",
  ];
  const doubled = [...items, ...items]; // duplicate for seamless loop
  return (
    <div style={{ overflowX: "hidden", borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}`, padding: "18px 0", background: "rgba(255,255,255,0.7)", backdropFilter: "blur(8px)", width: "100%" }}>
      <style>{`
        @keyframes marquee-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-track {
          display: flex;
          width: max-content;
          animation: marquee-scroll 24s linear infinite;
        }
        .marquee-track:hover { animation-play-state: paused; }
      `}</style>
      <div className="marquee-track">
        {doubled.map((item, i) => (
          <span key={i} style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.14em",
            textTransform: "uppercase", color: C.text,
            padding: "0 40px", whiteSpace: "nowrap",
          }}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// Animated fade-in wrapper (pure CSS, no Framer Motion dependency)
function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number; key?: React.Key }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(28px)",
      transition: `opacity 0.65s ease ${delay}s, transform 0.65s ease ${delay}s`,
    }}>
      {children}
    </div>
  );
}

// Stat card
// ── Premium StatCard — Stripe / Apple level ───────────────────────────────────
function StatCard({
  numStr, numEnd, suffix = "", label, icon, sub,
  accent = "#2563eb", delay = 0,
}: {
  numStr?: string;    // static symbol shown smaller as icon (e.g. "∞")
  numEnd?: number;    // count-up target
  suffix?: string;    // appended after count (e.g. "+")
  label?: string;     // primary display text (overrides count / numStr)
  icon?: string;      // small supporting symbol shown beneath label
  sub: string;        // description line
  accent?: string;    // per-card accent color
  delay?: number;
}) {
  const { ref, visible } = useInView(0.25);
  const [count, setCount] = useState(0);
  const [hovered, setHovered] = useState(false);

  // Count-up animation
  useEffect(() => {
    if (!visible || numEnd === undefined) return;
    const duration = 1000;
    const startTime = performance.now();
    const id = setTimeout(() => {
      const tick = () => {
        const p = Math.min((performance.now() - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setCount(Math.round(eased * numEnd));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay * 1000);
    return () => clearTimeout(id);
  }, [visible, numEnd, delay]);

  // Derive accent variants
  const accentRGB = accent === "#2563eb" ? "37,99,235"
    : accent === "#7c3aed" ? "124,58,237"
    : accent === "#059669" ? "5,150,105"
    : "234,88,12"; // orange fallback

  const display = label ?? (numEnd !== undefined ? `${count}${suffix}` : undefined);

  return (
    <FadeIn delay={delay}>
      <div
        ref={ref}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative", overflow: "hidden",
          // Resting: soft white with a barely-there tinted gradient
          background: hovered
            ? `linear-gradient(148deg, ${accent} 0%, ${accent}cc 100%)`
            : `linear-gradient(160deg, #ffffff 0%, ${accent}08 100%)`,
          border: hovered
            ? `1.5px solid ${accent}60`
            : "1.5px solid rgba(226,232,240,0.85)",
          borderRadius: 24,
          padding: "32px 28px 30px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          transition: [
            "background 0.32s ease",
            "border-color 0.25s ease",
            "transform 0.26s cubic-bezier(.22,1,.36,1)",
            "box-shadow 0.26s ease",
          ].join(", "),
          transform: hovered ? "translateY(-7px) scale(1.015)" : "translateY(0) scale(1)",
          boxShadow: hovered
            ? `0 24px 56px rgba(${accentRGB},0.26), 0 6px 20px rgba(${accentRGB},0.14), inset 0 1px 0 rgba(255,255,255,0.18)`
            : `0 1px 4px rgba(15,23,42,0.05), 0 6px 20px rgba(${accentRGB},0.07)`,
          cursor: "default",
        }}
      >
        {/* Top-edge gloss */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "52%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%)",
          borderRadius: "24px 24px 0 0", pointerEvents: "none",
          opacity: hovered ? 1 : 0, transition: "opacity 0.3s",
        }} />

        {/* Accent dot — top-right corner indicator */}
        <div style={{
          position: "absolute", top: 18, right: 20,
          width: 8, height: 8, borderRadius: "50%",
          background: hovered ? "rgba(255,255,255,0.5)" : accent,
          opacity: hovered ? 0.7 : 0.5,
          transition: "background 0.25s, opacity 0.25s",
          boxShadow: hovered ? "none" : `0 0 8px ${accent}60`,
        }} />

        {/* Primary display */}
        <p style={{
          fontSize: "clamp(32px,3.4vw,46px)",
          fontWeight: 900,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          margin: "0 0 4px",
          color: hovered ? "#ffffff" : "#0f172a",
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.25s",
        }}>
          {display}
        </p>

        {/* Supporting icon (e.g. ∞ symbol below "Unlimited") */}
        {icon && (
          <p style={{
            fontSize: 18, lineHeight: 1, margin: "0 0 10px",
            color: hovered ? "rgba(255,255,255,0.6)" : accent,
            transition: "color 0.25s",
          }}>{icon}</p>
        )}

        {/* Animated accent underline */}
        <div style={{ position: "relative", marginBottom: 16, height: 2.5, width: 40, overflow: "hidden", borderRadius: 99 }}>
          <div style={{
            position: "absolute", inset: 0,
            background: hovered ? "rgba(255,255,255,0.22)" : `${accent}20`,
            borderRadius: 99, transition: "background 0.25s",
          }} />
          <div style={{
            position: "absolute", top: 0, left: 0, height: "100%",
            width: hovered ? "100%" : "30%",
            background: hovered ? "rgba(255,255,255,0.9)" : accent,
            borderRadius: 99,
            transition: "width 0.38s cubic-bezier(.22,1,.36,1), background 0.25s",
          }} />
        </div>

        {/* Description */}
        <p style={{
          fontSize: 12.5,
          lineHeight: 1.68,
          margin: 0,
          color: hovered ? "rgba(255,255,255,0.75)" : "#475569",
          transition: "color 0.25s",
          letterSpacing: "0.005em",
        }}>
          {sub}
        </p>
      </div>
    </FadeIn>
  );
}

// ── Feature card (kept, still referenced elsewhere) ───────────────────────────
function FeatureCard({ icon, title, desc, delay = 0 }: { icon: string; title: string; desc: string; delay?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <FadeIn delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: C.bg,
          border: `1px solid ${C.rule}`,
          borderRadius: 20,
          padding: "36px 32px",
          height: "100%",
          boxSizing: "border-box",
          transition: "box-shadow 0.2s, transform 0.2s, border-color 0.2s",
          boxShadow: hovered ? "0 8px 32px rgba(0,0,0,0.08)" : "0 1px 4px rgba(0,0,0,0.03)",
          transform: hovered ? "translateY(-3px)" : "none",
          borderColor: hovered ? C.muted : C.rule,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 20 }}>{icon}</div>
        <p style={{ fontSize: 17, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", marginBottom: 10, lineHeight: 1.25 }}>{title}</p>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.75 }}>{desc}</p>
      </div>
    </FadeIn>
  );
}

// ── Step mini-visuals — enriched with more motion and richer data ────────────

// Shared: a glowing "active" pulse dot
function PulseDot({ color }: { color: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8, flexShrink: 0 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%", background: color,
        animation: "pulse-ring 1.8s ease-out infinite", opacity: 0.4,
      }} />
      <span style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: color }} />
      <style>{`@keyframes pulse-ring { 0%{transform:scale(1);opacity:.4} 70%{transform:scale(2.4);opacity:0} 100%{transform:scale(2.4);opacity:0} }`}</style>
    </span>
  );
}

// ── Visual 01: Typewriter URL → address card → fields fill sequentially ──────
function StepVisual01() {
  const { ref, visible } = useInView(0.25);
  // phase: 0=idle 1=typing-url 2=address-revealed 3=fields-filling
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState("");
  const fullUrl = "8901-Maple-Dr-Austin-TX-78701";

  // Drive the phase sequence once visible
  useEffect(() => {
    if (!visible || phase !== 0) return;
    setPhase(1);
  }, [visible, phase]);

  useEffect(() => {
    if (phase !== 1) return;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setTyped(fullUrl.slice(0, i));
      if (i >= fullUrl.length) { clearInterval(iv); setTimeout(() => setPhase(2), 350); }
    }, 30);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    if (phase !== 2) return;
    const t = setTimeout(() => setPhase(3), 500);
    return () => clearTimeout(t);
  }, [phase]);

  const fields = [
    { label: "Address",        value: "8901 Maple Dr, Austin TX",  delay: 0,    accent: false },
    { label: "Purchase Price", value: "$389,000",                  delay: 0.15, accent: false },
    { label: "Monthly Rent",   value: "$2,950",                    delay: 0.30, accent: true  },
    { label: "Interest Rate",  value: "6.875%",                    delay: 0.45, accent: false },
    { label: "Down Payment",   value: "$77,800  (20%)",            delay: 0.60, accent: false },
  ];

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {/* URL input bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: C.bg, border: `2px solid ${phase >= 2 ? C.green : C.rule}`,
        borderRadius: 10, padding: "8px 12px",
        transition: "border-color 0.4s, box-shadow 0.4s",
        boxShadow: phase >= 2 ? `0 0 0 3px ${C.green}18` : "none",
      }}>
        <span style={{ fontSize: 13 }}>🔗</span>
        <span style={{ fontSize: 10, fontFamily: "monospace", flex: 1, color: phase >= 2 ? C.text : C.muted,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {typed || <span style={{ color: C.faint, fontStyle: "italic" }}>Enter an address or property details…</span>}
          {phase === 1 && (
            <span style={{ display: "inline-block", width: 2, height: 11, background: C.text,
              verticalAlign: "middle", marginLeft: 1, animation: "blink-cur 0.9s step-start infinite" }} />
          )}
        </span>
        {phase >= 2 && (
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em",
            background: C.green, color: "#fff", borderRadius: 999, padding: "2px 8px", flexShrink: 0 }}>FOUND</span>
        )}
      </div>

      <style>{`@keyframes blink-cur { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      {/* Address chip appears first */}
      <div style={{
        opacity: phase >= 2 ? 1 : 0,
        transform: phase >= 2 ? "none" : "translateY(8px)",
        transition: "opacity 0.4s, transform 0.4s",
        display: "flex", alignItems: "center", gap: 8,
        background: "#e8f5ef", border: `1px solid ${C.green}40`,
        borderRadius: 10, padding: "9px 12px",
      }}>
        <PulseDot color={C.green} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "#1a5a34" }}>8901 Maple Dr, Austin TX 78759</span>
      </div>

      {/* Fields fill in sequentially */}
      {fields.slice(1).map((f, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.bg, border: `1px solid ${f.accent ? C.green + "60" : C.rule}`,
          borderRadius: 9, padding: "8px 12px",
          opacity: phase === 3 ? 1 : 0,
          transform: phase === 3 ? "none" : "translateX(-12px)",
          transition: `opacity 0.38s ease ${f.delay}s, transform 0.38s ease ${f.delay}s, border-color 0.3s`,
        }}>
          <span style={{ fontSize: 10, color: C.faint, letterSpacing: "0.04em" }}>{f.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: f.accent ? C.green : C.text }}>{f.value}</span>
        </div>
      ))}

      {/* "or upload CSV" pill */}
      <div style={{
        opacity: phase === 3 ? 1 : 0,
        transition: "opacity 0.4s ease 0.8s",
        display: "flex", gap: 6,
      }}>
        {["or upload a CSV", "or enter manually"].map(t => (
          <span key={t} style={{ fontSize: 9, color: "#4a6cf7",
            background: "#eef0ff", border: "1px solid #c8d0f0",
            borderRadius: 999, padding: "3px 9px", fontWeight: 600 }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ── Visual 02: Mortgage breakdown bar + metric tiles counting up ──────────────
function StepVisual02() {
  const { ref, visible } = useInView(0.25);
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const [barW, setBarW] = useState(0);
  const targets = [295, 71, 132, 96]; // cashflow, cap×10, DSCR×100, CoC×10

  useEffect(() => {
    if (!visible) return;
    // Stagger bar then tiles
    const bTimer = setTimeout(() => setBarW(100), 100);
    targets.forEach((target, idx) => {
      const delay = 300 + idx * 110;
      const tRef = { id: 0 };
      const start = setTimeout(() => {
        let n = 0;
        tRef.id = window.setInterval(() => {
          n = Math.min(n + Math.ceil(target / 28), target);
          setCounts(prev => { const nx = [...prev]; nx[idx] = n; return nx; });
          if (n >= target) clearInterval(tRef.id);
        }, 28);
      }, delay);
      // capture for cleanup
      return () => { clearTimeout(start); clearInterval(tRef.id); };
    });
    return () => clearTimeout(bTimer);
  }, [visible]);

  // Mortgage breakdown bar segments
  const segments = [
    { label: "Mortgage", pct: 68, color: "#4a6cf7" },
    { label: "Tax/Ins",  pct: 17, color: C.amber   },
    { label: "Mgmt",     pct: 8,  color: C.muted   },
    { label: "Flow",     pct: 7,  color: C.green    },
  ];

  const metrics = [
    { label: "Cash Flow",    val: `+$${counts[0]}/mo`,               color: C.green },
    { label: "Cap Rate",     val: `${(counts[1]/10).toFixed(1)}%`,    color: "#4a6cf7" },
    { label: "DSCR",         val: `${(counts[2]/100).toFixed(2)}`,    color: C.text },
    { label: "Cash-on-Cash", val: `${(counts[3]/10).toFixed(1)}%`,   color: C.amber },
  ];

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Rent input summary */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        background: C.bg, borderRadius: 10, padding: "10px 14px", border: `1px solid ${C.rule}` }}>
        <span style={{ fontSize: 11, color: C.muted }}>$389,000 · 20% down · 6.875% · 30yr</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#4a6cf7" }}>calculating…</span>
      </div>

      {/* Stacked bar — where does rent $2,950 go? */}
      <div>
        <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7 }}>
          Where your $2,950 rent goes
        </p>
        <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: C.rule, gap: 1 }}>
          {segments.map((s, i) => (
            <div key={i} style={{
              background: s.color, height: "100%",
              width: visible ? `${(s.pct / 100) * barW}%` : "0%",
              transition: `width 0.9s cubic-bezier(.22,1,.36,1) ${i * 0.07}s`,
              flexShrink: 0,
            }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 7, flexWrap: "wrap" }}>
          {segments.map((s, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.muted }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* 4 metric tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
        {metrics.map((m, i) => (
          <div key={i} style={{
            background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 12,
            padding: "12px 13px",
            opacity: visible ? 1 : 0,
            transform: visible ? "none" : "translateY(10px)",
            transition: `opacity 0.4s ease ${0.3 + i * 0.1}s, transform 0.4s ease ${0.3 + i * 0.1}s`,
          }}>
            <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>{m.label}</p>
            <p style={{ fontSize: 20, fontWeight: 900, color: m.color, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{m.val}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Visual 03: Score gauge + progressive verdict reveal ───────────────────────
function StepVisual03() {
  const { ref, visible } = useInView(0.25);
  const [score, setScore] = useState(0);
  const [showVerdict, setShowVerdict] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let n = 0;
    const iv = setInterval(() => {
      n = Math.min(n + 2, 82);
      setScore(n);
      if (n >= 82) { clearInterval(iv); setTimeout(() => setShowVerdict(true), 200); }
    }, 15);
    return () => clearInterval(iv);
  }, [visible]);

  const radius = 46;
  const circ   = 2 * Math.PI * radius;
  const filled = (score / 100) * circ;
  const scoreColor = score >= 70 ? C.green : score >= 45 ? C.amber : C.red;

  // Scorecard breakdown rows
  const rows: { label: string; val: string; delta: "good" | "ok" | "warn" }[] = [
    { label: "Rent-to-price ratio",  val: "0.76%",  delta: "good" },
    { label: "Monthly cash flow",    val: "+$295",   delta: "good" },
    { label: "Cap rate",             val: "7.1%",    delta: "ok"   },
    { label: "Rehab estimate",       val: "$14,000", delta: "warn" },
  ];
  const deltaColor = (d: string) => d === "good" ? C.green : d === "ok" ? "#4a6cf7" : C.amber;
  const deltaIcon  = (d: string) => d === "good" ? "↑" : d === "ok" ? "→" : "!";

  return (
    <div ref={ref}>
      {/* Gauge + headline side by side */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 14 }}>
        {/* SVG gauge */}
        <div style={{ position: "relative", width: 104, height: 104, flexShrink: 0 }}>
          <svg width="104" height="104" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="52" cy="52" r={radius} fill="none" stroke={C.rule} strokeWidth="9" />
            <circle cx="52" cy="52" r={radius} fill="none" stroke={scoreColor} strokeWidth="9"
              strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.04s linear, stroke 0.3s ease" }}
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: scoreColor,
              letterSpacing: "-0.06em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{score}</span>
            <span style={{ fontSize: 9, color: C.faint, letterSpacing: "0.06em" }}>/ 100</span>
          </div>
        </div>

        {/* Verdict text */}
        <div style={{ flex: 1 }}>
          <div style={{
            opacity: showVerdict ? 1 : 0, transform: showVerdict ? "none" : "translateY(6px)",
            transition: "opacity 0.5s, transform 0.5s",
          }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8,
              background: "#e8f5ef", border: `1px solid ${C.green}40`, borderRadius: 8, padding: "4px 10px" }}>
              <PulseDot color={C.green} />
              <span style={{ fontSize: 10, fontWeight: 800, color: C.green, letterSpacing: "0.06em" }}>GREAT DEAL</span>
            </div>
            <p style={{ fontSize: 12, color: C.text, fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
              Strong cash-flowing rental.
            </p>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.4, marginTop: 3 }}>
              Watch the rehab budget — it narrows your margin.
            </p>
          </div>
        </div>
      </div>

      {/* Score breakdown table */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 9, padding: "8px 12px",
            opacity: showVerdict ? 1 : 0,
            transform: showVerdict ? "none" : "translateX(10px)",
            transition: `opacity 0.35s ease ${i * 0.08}s, transform 0.35s ease ${i * 0.08}s`,
          }}>
            <span style={{ fontSize: 11, color: C.muted }}>{r.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{r.val}</span>
              <span style={{
                fontSize: 9, fontWeight: 800,
                background: deltaColor(r.delta) + "18", color: deltaColor(r.delta),
                border: `1px solid ${deltaColor(r.delta)}40`,
                borderRadius: 999, padding: "1px 6px", width: 16, textAlign: "center",
              }}>{deltaIcon(r.delta)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Redesigned Step card ──────────────────────────────────────────────────────
function Step({
  n, stepColor, title, desc, bullets, visual, delay = 0,
}: {
  n: string; stepColor: string; title: string; desc: string;
  bullets: string[]; visual: React.ReactNode; delay?: number;
}) {
  const [hov, setHov] = useState(false);
  return (
    <FadeIn delay={delay}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: "rgba(255,255,255,0.85)",
          border: `1px solid ${hov ? C.blue + "50" : "rgba(203,213,225,0.6)"}`,
          borderRadius: 24,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          height: "100%",
          backdropFilter: "blur(12px)",
          transition: "box-shadow 0.22s, transform 0.22s, border-color 0.22s",
          boxShadow: hov
            ? `0 20px 56px rgba(37,99,235,0.15), 0 4px 16px rgba(14,165,233,0.1)`
            : "0 2px 12px rgba(14,165,233,0.07)",
          transform: hov ? "translateY(-6px)" : "none",
        }}
      >
        {/* Coloured top accent line */}
        <div style={{ height: 3, background: stepColor, flexShrink: 0 }} />

        {/* Visual demo area */}
        <div style={{
          background: `linear-gradient(158deg, ${C.gradStart} 0%, ${C.gradEnd} 100%)`,
          padding: "24px 22px 20px", flexShrink: 0,
        }}>
          {visual}
        </div>

        {/* Text block */}
        <div style={{ padding: "20px 24px 26px", flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Step number badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
              background: stepColor + "18", color: stepColor,
              border: `1px solid ${stepColor}40`,
              borderRadius: 6, padding: "3px 9px",
            }}>{n}</span>
            <div style={{ flex: 1, height: 1, background: C.rule }} />
          </div>

          <p style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.02em",
            marginBottom: 8, lineHeight: 1.3 }}>{title}</p>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>{desc}</p>

          {/* Bullet list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: "auto" }}>
            {bullets.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                  background: stepColor + "18", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: 8, fontWeight: 900, color: stepColor }}>✓</span>
                </span>
                <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.55 }}>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}


// ─── SiteFooter — shared across LandingPage and LearnPage ───────────────────
function SiteFooter({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const navLinks: { label: string; action: () => void }[] = [
    { label: "Analyzer",  action: () => onNavigate("analyzer") },
    { label: "Dashboard", action: () => onNavigate("dashboard") },
    { label: "Learn",     action: () => onNavigate("learn") },
    { label: "Privacy",   action: () => onNavigate("privacy") },
    { label: "Contact",   action: () => onNavigate("contact") },
  ];

  const linkBase: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: "#475569",
    textDecoration: "none", cursor: "pointer",
    transition: "color 0.18s ease",
    background: "none", border: "none", fontFamily: "inherit", padding: 0,
    position: "relative",
  };

  return (
    <footer style={{
      borderTop: "1px solid #e2e8f0",
      background: "rgba(255,255,255,0.7)",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        maxWidth: 1100, margin: "0 auto",
        padding: "clamp(28px,4vw,44px) clamp(16px,4vw,40px)",
        display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 24,
      }}>

        {/* ── Left: brand + credit + copyright ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <button
            onClick={() => onNavigate("landing")}
            style={{ ...linkBase, fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em", textAlign: "left" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
          >
            Dealistic
          </button>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
            Built by{" "}
            <a
              href="https://www.linkedin.com/in/adriandu2004"
              target="_blank" rel="noopener noreferrer"
              style={{ color: "#475569", fontWeight: 600, textDecoration: "none", transition: "color 0.18s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
            >
              Adrian Du
            </a>
          </p>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>© 2026 Dealistic. All rights reserved.</p>
        </div>

        {/* ── Right: nav links + LinkedIn ── */}
        <nav style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          {navLinks.map(link => (
            <button
              key={link.label}
              onClick={link.action}
              style={linkBase}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
            >
              {link.label}
            </button>
          ))}

          {/* Divider */}
          <div style={{ width: 1, height: 14, background: "#e2e8f0", flexShrink: 0 }} />

          {/* LinkedIn — external */}
          <a
            href="https://www.linkedin.com/in/adriandu2004"
            target="_blank" rel="noopener noreferrer"
            style={{ ...linkBase, display: "inline-flex", alignItems: "center", gap: 5 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0a66c2"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 .774 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
            LinkedIn
          </a>
        </nav>
      </div>
    </footer>
  );
}

function LandingPage({ onAnalyze, onLearn, onNavigate }: { onAnalyze: () => void; onLearn: () => void; onNavigate: (p: Page) => void }) {
  const [ctaHovered, setCtaHovered] = useState(false);

  return (
    <div style={{ background: "transparent", minHeight: "100vh", color: C.text, fontFamily: "inherit" }}>

      {/* ── HERO ── */}
      <section style={{
        maxWidth: 1100, margin: "0 auto",
        padding: "clamp(40px,8vw,80px) clamp(16px,4vw,40px) clamp(32px,6vw,60px)",
        textAlign: "center", position: "relative",
      }}>
        {/* Soft radial glow behind hero content — Clearbit style */}
        <div style={{
          position: "absolute", top: "10%", left: "50%",
          transform: "translateX(-50%)",
          width: "80%", maxWidth: 700, height: 400,
          background: "radial-gradient(ellipse at center, rgba(14,165,233,0.18) 0%, rgba(16,185,129,0.10) 50%, transparent 75%)",
          pointerEvents: "none", zIndex: 0, borderRadius: "50%",
        }} />
        <div style={{ position: "relative", zIndex: 1 }}>

        {/* Brand wordmark — primary, dominant, centered */}
        <FadeIn>
          <p style={{
            fontSize: "clamp(36px,5.2vw,62px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: C.text,
            lineHeight: 1,
            margin: "0 auto 28px",
            fontFamily: "inherit",
          }}>
            Dealistic
          </p>
        </FadeIn>

        {/* Headline */}
        <FadeIn delay={0.08}>
          <h1 style={{
            fontSize: "clamp(22px,3.6vw,46px)",
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-0.028em",
            margin: "0 auto 36px",
            background: `linear-gradient(135deg, ${C.text} 0%, ${C.blue} 55%, ${C.green} 100%)`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            maxWidth: 660,
          }}>
            Analyze real estate deals in seconds.
          </h1>
        </FadeIn>

        {/* Sub */}
        <FadeIn delay={0.16}>
          <p style={{ fontSize: "clamp(14px,1.5vw,17px)", color: "#334155", lineHeight: 1.75, maxWidth: 500, margin: "0 auto 44px" }}>
            Cash flow, cap rate, CoC return, DSCR — every metric you need to decide fast. Built for investors who move quickly.
          </p>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.22}>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={onAnalyze}
              onMouseEnter={() => setCtaHovered(true)}
              onMouseLeave={() => setCtaHovered(false)}
              style={{
                padding: "15px 32px",
                background: `linear-gradient(135deg, ${C.blue}, ${C.accent})`,
                color: "#fff",
                border: "none",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.02em",
                transition: "transform 0.18s, box-shadow 0.18s",
                transform: ctaHovered ? "scale(1.03)" : "scale(1)",
                boxShadow: ctaHovered ? "0 8px 28px rgba(37,99,235,0.35)" : "0 2px 12px rgba(37,99,235,0.2)",
              }}
            >
              Analyze a Deal →
            </button>
            <button
              onClick={onAnalyze}
              style={{
                padding: "15px 28px",
                background: "transparent",
                color: C.muted,
                border: `1px solid ${C.rule}`,
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "color 0.15s, border-color 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; (e.currentTarget as HTMLElement).style.borderColor = C.text; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; (e.currentTarget as HTMLElement).style.borderColor = C.rule; }}
            >
              See how it works
            </button>
          </div>
        </FadeIn>
        </div>
      </section>

      {/* ── MARQUEE ── */}
      <Marquee />

      {/* ── STATS ROW ── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(28px,4vw,56px) clamp(16px,4vw,40px)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <StatCard
            label="Instant"
            sub="Instant analysis of all key rental metrics, from cash flow to DSCR."
            accent="#2563eb"
            delay={0}
          />
          <StatCard
            numEnd={12} suffix="+"
            sub="Cash flow, cap rate, DSCR, CoC return, NOI, LTV, and more — all calculated at once."
            accent="#7c3aed"
            delay={0.08}
          />
          <StatCard
            label="Dealistic Score"
            sub="Our signature 1–100 deal score. Complex math distilled into one clear verdict."
            accent="#059669"
            delay={0.16}
          />
          <StatCard
            label="Unlimited"
            icon="∞"
            sub="Analyze one deal or thousands at once — no caps, no paywalls on analysis."
            accent="#ea580c"
            delay={0.24}
          />
        </div>
      </section>

      {/* ── HOW IT WORKS — compact 3-step list ── */}
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(40px,6vw,72px)" }}>
        <FadeIn>
          <p style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "#94a3b8", fontWeight: 700, marginBottom: 24, textAlign: "center" }}>How it works</p>
        </FadeIn>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {([
            { n: "01", color: C.blue,        icon: "✏️", title: "Enter details or upload a CSV",  desc: "Fill in a few property fields manually, or upload a CSV to analyze multiple deals at once. Smart defaults fill in what you skip." },
            { n: "02", color: C.accentGreen,  icon: "⚡", title: "Get 12+ metrics instantly",     desc: "Cash flow, cap rate, DSCR, CoC — calculated in real time with a full monthly breakdown." },
            { n: "03", color: "#ea580c",      icon: "🎯", title: "Read your Dealistic Score",     desc: "Every deal scores 1–100. You see exactly what's working, what to watch, and why." },
          ] as { n: string; color: string; icon: string; title: string; desc: string }[]).map((step, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div style={{
                display: "flex", gap: 20, alignItems: "flex-start", padding: "22px 24px",
                background: "rgba(255,255,255,0.75)", border: "1px solid rgba(226,232,240,0.8)",
                borderRadius: 18, backdropFilter: "blur(8px)",
              }}>
                {/* Step number */}
                <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                  background: step.color + "14", border: `1.5px solid ${step.color}40`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: step.color }}>{step.n}</span>
                </div>
                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>
                    <span style={{ marginRight: 8 }}>{step.icon}</span>{step.title}
                  </p>
                  <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
                </div>
                {/* Connector line (not last) */}
              </div>
              {i < 2 && (
                <div style={{ width: 1.5, height: 4, background: "rgba(203,213,225,0.7)", marginLeft: 41 }} />
              )}
            </FadeIn>
          ))}
        </div>
        <FadeIn delay={0.32}>
          <div style={{ textAlign: "center", marginTop: 28 }}>
            <button
              onClick={onLearn}
              style={{
                background: "none", border: "none", color: C.blue, fontSize: 13,
                fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                textDecoration: "underline", textUnderlineOffset: 3, padding: 0,
              }}
            >
              See detailed walkthrough →
            </button>
          </div>
        </FadeIn>
      </section>
      {/* ── CTA BLOCK ── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(56px,8vw,100px) clamp(16px,4vw,40px)" }}>
        <FadeIn>
          <div style={{
            background: `linear-gradient(135deg, ${C.pill} 0%, ${C.blue} 60%, ${C.accent} 100%)`,
            borderRadius: 28,
            padding: "clamp(32px,5vw,72px) clamp(20px,5vw,64px)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 40,
            flexWrap: "wrap",
          }}>
            <div>
              <h2 style={{ fontSize: "clamp(28px,4vw,52px)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.1, margin: "0 0 14px", color: "#fff", maxWidth: 480 }}>
                Make smarter decisions,<br />starting now.
              </h2>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", margin: 0, lineHeight: 1.6 }}>
                Free to use. No account required to analyze your first deal.
              </p>
            </div>
            <button
              onClick={onAnalyze}
              style={{
                flexShrink: 0,
                padding: "16px 36px",
                background: "#fff",
                color: C.blue,
                border: "none",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.02em",
                transition: "transform 0.18s, box-shadow 0.18s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.04)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
            >
              Analyze a Deal →
            </button>
          </div>
        </FadeIn>
      </section>

      <SiteFooter onNavigate={onNavigate} />
    </div>
  );
}

// ─── CSV types, constants, and parsing layer ─────────────────────────────────

type CsvField =
  | "address" | "purchase_price" | "monthly_rent" | "down_payment"
  | "interest_rate" | "loan_term" | "vacancy_rate" | "taxes"
  | "insurance" | "hoa" | "repairs" | "management" | "other" | "ignore";

type ColType = "numeric" | "text" | "mixed" | "empty";

interface CsvFieldDef {
  key: CsvField;
  label: string;
  required?: boolean;
  unit?: string;
  defaultVal?: string | ((row: Record<string,string>, price: number, rent: number) => string);
}

interface DatasetAnalysis {
  isMarketDataset: boolean;
  dateColCount: number;
  marketSignals: string[];
}

interface CsvParsed {
  headers: string[];
  usableHeaders: string[];
  rows: Record<string, string>[];
  mapping: Record<string, CsvField>;
  confidence: Record<string, "high" | "medium" | "low">;
  colTypes: Record<string, ColType>;
  dataset: DatasetAnalysis;
  warnings: string[];
}

const CSV_FIELDS: CsvFieldDef[] = [
  { key: "address",        label: "Address",        required: true },
  { key: "purchase_price", label: "Purchase Price",  required: true },
  { key: "monthly_rent",   label: "Monthly Rent" },
  { key: "down_payment",   label: "Down Payment",    defaultVal: (_, price) => String(Math.round(price * 0.2)) },
  { key: "interest_rate",  label: "Interest Rate",   defaultVal: "6.5" },
  { key: "loan_term",      label: "Loan Term (yrs)", defaultVal: "30" },
  { key: "vacancy_rate",   label: "Vacancy Rate %",  defaultVal: "5" },
  { key: "taxes",          label: "Monthly Taxes",   defaultVal: (_, price) => String(Math.round(price * 0.012 / 12)) },
  { key: "insurance",      label: "Insurance/mo",    defaultVal: (_, price) => String(Math.round(price * 0.0065 / 12)) },
  { key: "hoa",            label: "HOA/mo",          defaultVal: "0" },
  { key: "repairs",        label: "Repairs/mo",      defaultVal: (_, __, rent) => String(Math.round(rent * 0.05)) },
  { key: "management",     label: "Management/mo",   defaultVal: (_, __, rent) => String(Math.round(rent * 0.08)) },
  { key: "other",          label: "Other/mo",        defaultVal: "0" },
];

const NUMERIC_FIELDS: CsvField[] = [
  "purchase_price","monthly_rent","down_payment","interest_rate","loan_term",
  "vacancy_rate","taxes","insurance","hoa","repairs","management","other",
];

function isNoiseColumn(header: string): boolean {
  const h = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^\d{4}\d{2}\d{2}$/.test(h)) return true;
  if (/^\d{4}[-/]\d{2}/.test(header.trim())) return true;
  if (/^\d{4}q\d$/i.test(header.trim())) return true;
  const noiseExact = new Set(["regionid","sizerank","regionname","regiontype","statename",
    "metro","countyname","msaid","country","cbsa","cbsatitle"]);
  if (noiseExact.has(h)) return true;
  return false;
}

function classifyColumn(header: string, rows: Record<string, string>[]): ColType {
  const vals = rows.slice(0, 10).map(r => (r[header] ?? "").trim()).filter(v => v !== "");
  if (vals.length === 0) return "empty";
  const numericCount = vals.filter(v => !isNaN(Number(v.replace(/[$,%]/g, "")))).length;
  if (numericCount === vals.length) return "numeric";
  if (numericCount === 0) return "text";
  return "mixed";
}

function analyzeDataset(headers: string[], rows: Record<string, string>[]): DatasetAnalysis {
  const dateColCount = headers.filter(h => /^\d{4}[-/]\d{2}/.test(h.trim())).length;
  const marketSignals: string[] = [];
  if (dateColCount >= 3) marketSignals.push(`${dateColCount} date columns detected (e.g. 2000-01-31)`);
  const hasRegionId = headers.some(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,"") === "regionid");
  const hasSizeRank = headers.some(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,"") === "sizerank");
  if (hasRegionId) marketSignals.push("RegionID column found");
  if (hasSizeRank) marketSignals.push("SizeRank column found");
  const usable = headers.filter(h => !isNoiseColumn(h));
  const hasNumericCol = usable.some(h => classifyColumn(h, rows) === "numeric");
  if (!hasNumericCol && usable.length > 0) marketSignals.push("No numeric columns found");
  return { isMarketDataset: marketSignals.length >= 2, dateColCount, marketSignals };
}

const AUTOMAP_TIERS: Record<CsvField, { high: string[]; medium: string[] }> = {
  address:        { high: ["address","property address"], medium: ["location","street","addr","property name"] },
  purchase_price: { high: ["purchase_price","purchase price","list price","asking price"], medium: ["price","cost","sale price","property price","value"] },
  monthly_rent:   { high: ["monthly_rent","monthly rent","rental income"], medium: ["rent","gross rent","monthly income","income"] },
  down_payment:   { high: ["down_payment","down payment","downpayment"], medium: ["down","deposit","equity down"] },
  interest_rate:  { high: ["interest_rate","interest rate","mortgage rate"], medium: ["rate","apr","int rate"] },
  loan_term:      { high: ["loan_term","loan term","amortization period"], medium: ["term","loan years","years"] },
  vacancy_rate:   { high: ["vacancy_rate","vacancy rate","vacancy"], medium: ["vacancy %","vacancy pct","empty rate"] },
  taxes:          { high: ["taxes","property taxes","property tax"], medium: ["tax","annual tax","monthly tax"] },
  insurance:      { high: ["insurance","landlord insurance","homeowners insurance"], medium: ["ins","property insurance"] },
  hoa:            { high: ["hoa","hoa fees","hoa fee"], medium: ["homeowners association","monthly hoa","association fee"] },
  repairs:        { high: ["repairs","repair costs","maintenance"], medium: ["capex","capital expenditure","repairs & maintenance"] },
  management:     { high: ["management","property management","management fee"], medium: ["pm","mgmt","prop mgmt"] },
  other:          { high: ["other","other expenses","other costs"], medium: ["misc","miscellaneous"] },
  ignore:         { high: [], medium: [] },
};

function autoMapWithConfidence(
  header: string, colType: ColType, usedFields: Set<CsvField>
): { field: CsvField; confidence: "high" | "medium" | "low" } {
  const clean = header.trim().toLowerCase().replace(/[^a-z0-9 _]/g, "");
  for (const [field, tiers] of Object.entries(AUTOMAP_TIERS) as [CsvField, { high: string[]; medium: string[] }][]) {
    if (field === "ignore") continue;
    if (usedFields.has(field)) continue;
    if (NUMERIC_FIELDS.includes(field) && colType === "text") continue;
    if (tiers.high.some(s => s === clean || clean === s.replace(/ /g, "_"))) {
      return { field, confidence: "high" };
    }
  }
  for (const [field, tiers] of Object.entries(AUTOMAP_TIERS) as [CsvField, { high: string[]; medium: string[] }][]) {
    if (field === "ignore") continue;
    if (usedFields.has(field)) continue;
    if (NUMERIC_FIELDS.includes(field) && colType !== "numeric") continue;
    if (tiers.medium.some(s => s === clean || clean.includes(s))) {
      return { field, confidence: "medium" };
    }
  }
  return { field: "ignore", confidence: "low" };
}

function autoMapHeaders(
  headers: string[], rows: Record<string, string>[]
): { mapping: Record<string, CsvField>; confidence: Record<string, "high" | "medium" | "low"> } {
  const mapping: Record<string, CsvField> = {};
  const confidence: Record<string, "high" | "medium" | "low"> = {};
  const usedFields = new Set<CsvField>();
  headers.forEach(h => {
    if (isNoiseColumn(h)) { mapping[h] = "ignore"; confidence[h] = "high"; return; }
    const colType = classifyColumn(h, rows);
    const result = autoMapWithConfidence(h, colType, usedFields);
    mapping[h] = result.field;
    confidence[h] = result.confidence;
    if (result.field !== "ignore") usedFields.add(result.field);
  });
  return { mapping, confidence };
}


// ─── Market dataset types + transformer ──────────────────────────────────────
interface MarketRow {
  region_id:           string;
  region_name:         string;
  region_type:         string;
  state_name:          string;
  latest_date:         string;
  latest_value:        number | null;
  value_12mo_ago:      number | null;
  value_60mo_ago:      number | null;
  appreciation_1y_pct: number | null;
  appreciation_5y_pct: number | null;
}

function transformMarketDataset(headers: string[], rows: Record<string, string>[]): MarketRow[] {
  // Identify date columns (e.g. "2000-01-31") and sort chronologically
  const dateCols = headers
    .filter(h => /^\d{4}[-/]\d{2}/.test(h.trim()))
    .sort((a, b) => a.localeCompare(b));

  if (dateCols.length === 0) return [];

  const latestCol = dateCols[dateCols.length - 1];

  // Find the col that is approximately 12 months prior
  const latestDate = new Date(latestCol.trim());
  const target12 = new Date(latestDate);
  target12.setMonth(target12.getMonth() - 12);
  const target60 = new Date(latestDate);
  target60.setMonth(target60.getMonth() - 60);

  function closestCol(target: Date): string | null {
    let best: string | null = null;
    let bestDiff = Infinity;
    for (const col of dateCols) {
      const d = new Date(col.trim());
      const diff = Math.abs(d.getTime() - target.getTime());
      if (diff < bestDiff) { bestDiff = diff; best = col; }
    }
    // Only use if within ±45 days
    return best && bestDiff < 45 * 24 * 60 * 60 * 1000 ? best : null;
  }

  const col12 = closestCol(target12);
  const col60 = closestCol(target60);

  // Helper to find column by partial case-insensitive match
  function findCol(names: string[]): string | null {
    for (const name of names) {
      const found = headers.find(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,"") === name.replace(/[^a-z0-9]/g,""));
      if (found) return found;
    }
    return null;
  }

  const regionIdCol    = findCol(["regionid", "region_id"]);
  const regionNameCol  = findCol(["regionname", "region_name", "regiontype", "metro", "city", "county"]);
  const regionTypeCol  = findCol(["regiontype", "region_type", "type"]);
  const stateNameCol   = findCol(["statename", "state_name", "state"]);

  function safeNum(s: string | undefined): number | null {
    if (!s || s.trim() === "" || s.trim() === ".") return null;
    const n = Number(s.replace(/[$,%]/g, "").trim());
    return isNaN(n) ? null : n;
  }

  function pctChange(from: number | null, to: number | null): number | null {
    if (from === null || to === null || from === 0) return null;
    return Math.round(((to - from) / from) * 1000) / 10; // 1 decimal
  }

  return rows
    .filter(row => {
      const v = safeNum(row[latestCol]);
      return v !== null && v > 0;
    })
    .map(row => {
      const latest   = safeNum(row[latestCol]);
      const ago12    = col12 ? safeNum(row[col12]) : null;
      const ago60    = col60 ? safeNum(row[col60]) : null;
      return {
        region_id:           regionIdCol   ? (row[regionIdCol]   ?? "") : "",
        region_name:         regionNameCol ? (row[regionNameCol] ?? "") : "",
        region_type:         regionTypeCol ? (row[regionTypeCol] ?? "") : "",
        state_name:          stateNameCol  ? (row[stateNameCol]  ?? "") : "",
        latest_date:         latestCol.trim(),
        latest_value:        latest,
        value_12mo_ago:      ago12,
        value_60mo_ago:      ago60,
        appreciation_1y_pct: pctChange(ago12, latest),
        appreciation_5y_pct: pctChange(ago60, latest),
      };
    })
    .slice(0, 500); // cap for performance
}

function parseCsvText(text: string): CsvParsed | { error: string } {
  // Handle both CRLF and LF
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { error: "The file appears to be empty." };
  if (lines.length < 2) return { error: "CSV needs at least a header row and one data row." };

  // Parse quoted CSV properly
  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim()); current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseCsvLine(lines[0]);
  if (headers.length < 2) return { error: "Only one column detected. Make sure the file uses commas as separators." };

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
    if (Object.values(row).some(v => v !== "")) rows.push(row);
  }
  if (rows.length === 0) return { error: "No data rows found after the header." };

  const dataset = analyzeDataset(headers, rows);
  const usableHeaders = headers.filter(h => !isNoiseColumn(h));
  const colTypes: Record<string, ColType> = {};
  headers.forEach(h => { colTypes[h] = classifyColumn(h, rows); });

  const { mapping, confidence } = autoMapHeaders(headers, rows);

  const warnings: string[] = [];
  // Only require purchase_price mapping for actual property/deal files
  if (!dataset.isMarketDataset && !Object.values(mapping).includes("purchase_price")) {
    warnings.push("Could not auto-detect a Purchase Price column — please map it below.");
  }
  return { headers, usableHeaders, rows, mapping, confidence, colTypes, dataset, warnings };
}

function applyMapping(
  rows: Record<string, string>[],
  mapping: Record<string, CsvField>,
  colTypes?: Record<string, ColType>
): DealInput[] {
  // Build safe mapping — strip text→numeric invalid assignments
  const safeMapping: Record<string, CsvField> = {};
  Object.entries(mapping).forEach(([h, field]) => {
    if (colTypes && NUMERIC_FIELDS.includes(field) && colTypes[h] === "text") {
      safeMapping[h] = "ignore";
    } else {
      safeMapping[h] = field;
    }
  });

  return rows.map((row, i) => {
    const get = (field: CsvField) => {
      const col = Object.entries(safeMapping).find(([, f]) => f === field)?.[0];
      return col ? (row[col] ?? "") : "";
    };
    const price = pf(get("purchase_price"));
    const rent  = pf(get("monthly_rent"));

    const resolve = (field: CsvField, def: CsvFieldDef) => {
      const raw = get(field);
      if (raw !== "") return pf(raw);
      if (typeof def.defaultVal === "function") return pf(String(def.defaultVal(row, price, rent)));
      return pf(def.defaultVal ?? "0");
    };

    const F = (key: CsvField) => CSV_FIELDS.find(f => f.key === key)!;
    return {
      address:   get("address") || `Property ${i + 1}`,
      price,
      rent,
      down:      resolve("down_payment",  F("down_payment")),
      rate:      resolve("interest_rate", F("interest_rate")),
      term:      resolve("loan_term",     F("loan_term")),
      vacancy:   resolve("vacancy_rate",  F("vacancy_rate")),
      taxes:     resolve("taxes",         F("taxes")),
      insurance: resolve("insurance",     F("insurance")),
      hoa:       resolve("hoa",           F("hoa")),
      repairs:   resolve("repairs",       F("repairs")),
      mgmt:      resolve("management",    F("management")),
      other:     resolve("other",         F("other")),
    };
  }).filter(d => d.price > 0);
}

// ─── AnalyzerPage ─────────────────────────────────────────────────────────────
// ─── CsvMappingUI ─────────────────────────────────────────────────────────────
interface CsvMappingUIProps {
  csvParsed: CsvParsed;
  csvMapping: Record<string, CsvField>;
  setCsvMapping: React.Dispatch<React.SetStateAction<Record<string, CsvField>>>;
  onNext: () => void;
  onCancel: () => void;
  onImportMarket?: (rows: MarketRow[]) => void;
}

function CsvMappingUI({ csvParsed, csvMapping, setCsvMapping, onNext, onCancel, onImportMarket }: CsvMappingUIProps) {
  const [showOptional, setShowOptional] = useState(false);
  const hasPriceMapping = Object.values(csvMapping).includes("purchase_price");

  const REQUIRED_KEYS: CsvField[] = ["purchase_price", "address"];
  const OPTIONAL_KEYS: CsvField[] = CSV_FIELDS.filter(f => !REQUIRED_KEYS.includes(f.key)).map(f => f.key);

  // Safety: usableHeaders may be absent on stale state — fall back gracefully
  const safeUsable: string[] = csvParsed.usableHeaders ?? csvParsed.headers?.filter(h => !isNoiseColumn(h)) ?? [];
  const safeColTypes = csvParsed.colTypes ?? {};
  const safeConfidence = csvParsed.confidence ?? {};
  const safeDataset = csvParsed.dataset ?? { isMarketDataset: false, dateColCount: 0, marketSignals: [] };

  const ignoredCount = (csvParsed.headers ?? []).filter(h => isNoiseColumn(h)).length;

  // Partition usable headers: required-bucket vs optional-bucket
  const requiredBucket = safeUsable.filter(h =>
    REQUIRED_KEYS.includes(csvMapping[h]) || (!OPTIONAL_KEYS.includes(csvMapping[h]))
  );
  const optionalBucket = safeUsable.filter(h =>
    OPTIONAL_KEYS.includes(csvMapping[h])
  );
  const autoMappedOptional = optionalBucket.filter(h => csvMapping[h] !== "ignore").length;

  // MappingRow — shows col name, colType badge, sample values, confidence badge, dropdown
  function MappingRow({ h }: { h: string; key?: React.Key }) {
    const mapped = csvMapping[h] ?? "ignore";
    const isMapped = mapped !== "ignore";
    const colType = safeColTypes[h] ?? "mixed";
    const conf = safeConfidence[h];
    const sampleVals = csvParsed.rows.slice(0, 3).map(r => (r[h] ?? "").trim()).filter(Boolean).join("  ·  ");

    // Which options to show in dropdown — block text-only columns from numeric fields
    const isTextCol = colType === "text";

    return (
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px",
        borderBottom: `1px solid ${C.rule}`,
        background: mapped === "purchase_price" ? "#f0f8f4" : mapped === "address" ? "#f4f4ff" : "transparent",
      }}>
        {/* Status dot */}
        <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 6,
          background: isMapped ? C.green : C.rule }} />

        {/* Col info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{h}</p>
            {/* Col type badge */}
            <span style={{ fontSize: 9, padding: "1px 6px", letterSpacing: "0.06em", textTransform: "uppercase",
              background: colType === "numeric" ? "#e8f5f0" : colType === "text" ? "#f0f0f8" : C.bg2,
              color: colType === "numeric" ? C.green : colType === "text" ? C.blue : C.faint,
              fontWeight: 600 }}>
              {colType}
            </span>
            {/* Confidence badge — only show for auto-mapped cols */}
            {isMapped && conf === "high" && (
              <span style={{ fontSize: 9, padding: "1px 6px", letterSpacing: "0.06em", textTransform: "uppercase",
                background: "#f0f8f0", color: C.green, fontWeight: 600 }}>Auto-detected</span>
            )}
            {isMapped && conf === "medium" && (
              <span style={{ fontSize: 9, padding: "1px 6px", letterSpacing: "0.06em", textTransform: "uppercase",
                background: "#fdf5e8", color: C.amber, fontWeight: 600 }}>Suggested</span>
            )}
          </div>
          {sampleVals && (
            <p style={{ fontSize: 10, color: C.faint, fontStyle: "italic", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
              {sampleVals}
            </p>
          )}
          {isTextCol && isMapped && NUMERIC_FIELDS.includes(mapped) && (
            <p style={{ fontSize: 10, color: C.red, marginTop: 3 }}>
              This column contains text — financial fields need numeric values.
            </p>
          )}
        </div>

        {/* Dropdown */}
        <select
          value={mapped}
          onChange={e => setCsvMapping(prev => ({ ...prev, [h]: e.target.value as CsvField }))}
          style={{
            flexShrink: 0, background: C.bg2,
            border: `1px solid ${isMapped && !(isTextCol && NUMERIC_FIELDS.includes(mapped)) ? C.green : C.rule}`,
            color: isMapped ? C.text : C.faint,
            fontSize: 11, padding: "7px 10px", outline: "none",
            fontFamily: "inherit", cursor: "pointer", minWidth: 170,
          }}
        >
          <option value="ignore">— Ignore —</option>
          <optgroup label="Required">
            {CSV_FIELDS.filter(f => REQUIRED_KEYS.includes(f.key)).map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
          <optgroup label="Optional">
            {CSV_FIELDS
              .filter(f => !REQUIRED_KEYS.includes(f.key))
              .filter(f => !(isTextCol && NUMERIC_FIELDS.includes(f.key)))
              .map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </optgroup>
        </select>
      </div>
    );
  }

  // ── Market dataset — transform + premium UI ──────────────────────────────────
  if (safeDataset.isMarketDataset) {
    const transformed = transformMarketDataset(csvParsed.headers, csvParsed.rows);
    const sampleRows  = transformed.slice(0, 8);
    const dateColCount = safeDataset.dateColCount;

    return (
      <div>
        {/* ── Success banner ── */}
        <div style={{
          background: "linear-gradient(135deg,#f0fdf4,#eff6ff)",
          border: "1px solid #bbf7d0", borderRadius: 18,
          padding: "18px 22px", marginBottom: 20,
          display: "flex", alignItems: "flex-start", gap: 14,
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#2563eb,#059669)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 18 }}>📈</span>
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 4, letterSpacing: "-0.015em" }}>
              Market dataset detected.
            </p>
            <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, margin: 0 }}>
              We converted this file into market trend insights for Dealistic.
              {dateColCount > 0 && ` Found ${dateColCount} time-series columns across ${transformed.length.toLocaleString()} regions.`}
            </p>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Regions", value: transformed.length.toLocaleString() },
            { label: "Latest Date", value: transformed[0]?.latest_date?.slice(0, 7) ?? "—" },
            { label: "With 1yr Data", value: transformed.filter(r => r.appreciation_1y_pct !== null).length.toLocaleString() },
            { label: "With 5yr Data", value: transformed.filter(r => r.appreciation_5y_pct !== null).length.toLocaleString() },
          ].map(s => (
            <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
              <p style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Preview table ── */}
        {sampleRows.length > 0 && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Preview — first {sampleRows.length} rows
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Region", "State", "Type", "Latest Value", "1yr %", "5yr %"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, i) => {
                    const is1Pos = row.appreciation_1y_pct !== null && row.appreciation_1y_pct >= 0;
                    const is5Pos = row.appreciation_5y_pct !== null && row.appreciation_5y_pct >= 0;
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 600, color: "#0f172a" }}>{row.region_name || "—"}</td>
                        <td style={{ padding: "9px 12px", color: "#475569" }}>{row.state_name || "—"}</td>
                        <td style={{ padding: "9px 12px", color: "#94a3b8" }}>{row.region_type || "—"}</td>
                        <td style={{ padding: "9px 12px", color: "#0f172a", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {row.latest_value !== null ? "$" + Math.round(row.latest_value).toLocaleString() : "—"}
                        </td>
                        <td style={{ padding: "9px 12px", color: row.appreciation_1y_pct === null ? "#94a3b8" : is1Pos ? "#059669" : "#dc2626", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {row.appreciation_1y_pct !== null ? (is1Pos ? "+" : "") + row.appreciation_1y_pct + "%" : "—"}
                        </td>
                        <td style={{ padding: "9px 12px", color: row.appreciation_5y_pct === null ? "#94a3b8" : is5Pos ? "#059669" : "#dc2626", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {row.appreciation_5y_pct !== null ? (is5Pos ? "+" : "") + row.appreciation_5y_pct + "%" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              if (onImportMarket) onImportMarket(transformed);
            }}
            style={{
              flex: 1, minWidth: 160, padding: "13px",
              background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
              color: "#fff", border: "none", borderRadius: 12,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit", boxShadow: "0 4px 14px rgba(37,99,235,0.28)",
              transition: "opacity 0.18s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            Import Market Insights →
          </button>
          <button onClick={onCancel}
            style={{ padding: "13px 20px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, fontSize: 13, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#94a3b8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; }}
          >
            Upload Different File
          </button>
        </div>
      </div>
    );
  }

  // ── Normal mapping UI (property/deal dataset) ──────────────────────────────
  return (
    <div>
      {/* Property dataset badge */}
      <div style={{
        background: "linear-gradient(135deg,#eff6ff,#f0fdf4)",
        border: "1px solid #bfdbfe", borderRadius: 14,
        padding: "14px 18px", marginBottom: 20,
        display: "flex", alignItems: "flex-start", gap: 12,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#2563eb,#059669)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 15 }}>🏠</span>
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 3, letterSpacing: "-0.01em" }}>
            Property dataset detected.
          </p>
          <p style={{ fontSize: 12, color: "#475569", margin: 0, lineHeight: 1.55 }}>
            Map <strong style={{ color: "#0f172a" }}>Purchase Price</strong> to continue. Other fields use smart defaults if left unmapped.
          </p>
        </div>
      </div>
      {/* Noise columns notice */}
      {ignoredCount > 0 && (
        <p style={{ fontSize: 11, color: C.faint, marginBottom: 18, fontStyle: "italic" }}>
          {ignoredCount} column{ignoredCount !== 1 ? "s" : ""} automatically hidden (date columns, region IDs, metadata).
        </p>
      )}

      {/* ── Step 1: Required Fields ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>
            Step 1 — Required Fields
          </p>
          <span style={{ fontSize: 10, color: hasPriceMapping ? C.green : C.red, fontWeight: 600 }}>
            {hasPriceMapping ? "✓ Purchase Price mapped" : "Purchase Price not yet mapped"}
          </span>
        </div>
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.55 }}>
          Map <strong style={{ color: C.text }}>Purchase Price</strong> to continue.
          Address is recommended but optional — we auto-label rows without one.
        </p>
        <div style={{ border: `1px solid ${C.rule}` }}>
          {requiredBucket.length > 0
            ? requiredBucket.map(h => <MappingRow key={h} h={h} />)
            : <div style={{ padding: "14px 16px", textAlign: "center" }}>
                <p style={{ fontSize: 12, color: C.faint }}>All columns were auto-detected. Check optional fields below if needed.</p>
              </div>
          }
        </div>
      </div>

      {/* ── Step 2: Optional Enhancements ── */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => setShowOptional(v => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 8, padding: 0, marginBottom: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>
            Step 2 — Optional Enhancements
          </p>
          <span style={{ fontSize: 10, color: C.faint }}>
            {showOptional ? "▲ Hide" : `▼ Show${autoMappedOptional > 0 ? ` (${autoMappedOptional} auto-detected)` : ""}`}
          </span>
        </button>
        {!showOptional && (
          <p style={{ fontSize: 11, color: C.faint, fontStyle: "italic" }}>
            Rent, taxes, insurance, HOA, and more. Smart defaults apply automatically to anything left unmapped.
          </p>
        )}
        {showOptional && (
          <>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.55 }}>
              These improve analysis accuracy. Missing values use smart defaults (20% down, 6.5% rate, 5% vacancy, etc.)
            </p>
            <div style={{ border: `1px solid ${C.rule}` }}>
              {safeUsable
                .filter(h => OPTIONAL_KEYS.includes(csvMapping[h]) || (csvMapping[h] === "ignore" && !requiredBucket.includes(h)))
                .length === 0
                ? <div style={{ padding: "14px", textAlign: "center" }}>
                    <p style={{ fontSize: 12, color: C.faint }}>No additional columns found.</p>
                  </div>
                : safeUsable
                    .filter(h => OPTIONAL_KEYS.includes(csvMapping[h]) || (csvMapping[h] === "ignore" && !requiredBucket.includes(h)))
                    .map(h => <MappingRow key={h} h={h} />)
              }
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onNext} disabled={!hasPriceMapping}
          onMouseEnter={e => { if (hasPriceMapping) (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          style={{ flex: 1, padding: "13px", background: hasPriceMapping ? C.text : C.bg2, color: hasPriceMapping ? C.bg : C.faint, border: "none", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, cursor: hasPriceMapping ? "pointer" : "default", fontFamily: "inherit", transition: "opacity 0.12s" }}>
          Preview Deals →
        </button>
        <button onClick={onCancel} style={{ padding: "13px 20px", background: "transparent", color: C.muted, border: `1px solid ${C.rule}`, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" }}>
          Cancel
        </button>
      </div>
      {!hasPriceMapping && (
        <p style={{ fontSize: 11, color: "#d97706", marginTop: 10 }}>Assign a column to Purchase Price above — it's required to analyze deals.</p>
      )}
    </div>
  );
}

const EMPTY_FORM: Record<string, string> = {
  address: "", state: "", price: "", down: "", rate: "", term: "30",
  rent: "", vacancy: "5", taxes: "", insurance: "",
  hoa: "0", repairs: "", mgmt: "", other: "0",
};
// ─── State-level effective property tax rates (median, as % of home value/yr) ─
// Source: Tax Foundation / Census ACS median estimates (2023)
// Format: monthly amount per $100k of purchase price
const STATE_TAX_RATES: Record<string, { rate: number; label: string }> = {
  AL: { rate: 0.41, label: "Alabama state avg" },
  AK: { rate: 1.04, label: "Alaska state avg" },
  AZ: { rate: 0.62, label: "Arizona state avg" },
  AR: { rate: 0.61, label: "Arkansas state avg" },
  CA: { rate: 0.73, label: "California state avg" },
  CO: { rate: 0.51, label: "Colorado state avg" },
  CT: { rate: 2.14, label: "Connecticut state avg" },
  DE: { rate: 0.57, label: "Delaware state avg" },
  FL: { rate: 0.89, label: "Florida state avg" },
  GA: { rate: 0.92, label: "Georgia state avg" },
  HI: { rate: 0.28, label: "Hawaii state avg" },
  ID: { rate: 0.69, label: "Idaho state avg" },
  IL: { rate: 2.23, label: "Illinois state avg" },
  IN: { rate: 0.87, label: "Indiana state avg" },
  IA: { rate: 1.57, label: "Iowa state avg" },
  KS: { rate: 1.41, label: "Kansas state avg" },
  KY: { rate: 0.86, label: "Kentucky state avg" },
  LA: { rate: 0.55, label: "Louisiana state avg" },
  ME: { rate: 1.36, label: "Maine state avg" },
  MD: { rate: 1.07, label: "Maryland state avg" },
  MA: { rate: 1.23, label: "Massachusetts state avg" },
  MI: { rate: 1.54, label: "Michigan state avg" },
  MN: { rate: 1.12, label: "Minnesota state avg" },
  MS: { rate: 0.65, label: "Mississippi state avg" },
  MO: { rate: 1.01, label: "Missouri state avg" },
  MT: { rate: 0.84, label: "Montana state avg" },
  NE: { rate: 1.73, label: "Nebraska state avg" },
  NV: { rate: 0.60, label: "Nevada state avg" },
  NH: { rate: 2.18, label: "New Hampshire state avg" },
  NJ: { rate: 2.47, label: "New Jersey state avg" },
  NM: { rate: 0.80, label: "New Mexico state avg" },
  NY: { rate: 1.72, label: "New York state avg" },
  NC: { rate: 0.82, label: "North Carolina state avg" },
  ND: { rate: 0.98, label: "North Dakota state avg" },
  OH: { rate: 1.59, label: "Ohio state avg" },
  OK: { rate: 0.90, label: "Oklahoma state avg" },
  OR: { rate: 0.97, label: "Oregon state avg" },
  PA: { rate: 1.58, label: "Pennsylvania state avg" },
  RI: { rate: 1.63, label: "Rhode Island state avg" },
  SC: { rate: 0.57, label: "South Carolina state avg" },
  SD: { rate: 1.22, label: "South Dakota state avg" },
  TN: { rate: 0.71, label: "Tennessee state avg" },
  TX: { rate: 1.80, label: "Texas state avg" },
  UT: { rate: 0.63, label: "Utah state avg" },
  VT: { rate: 1.90, label: "Vermont state avg" },
  VA: { rate: 0.87, label: "Virginia state avg" },
  WA: { rate: 0.98, label: "Washington state avg" },
  WV: { rate: 0.59, label: "West Virginia state avg" },
  WI: { rate: 1.85, label: "Wisconsin state avg" },
  WY: { rate: 0.61, label: "Wyoming state avg" },
};
const NATIONAL_TAX_RATE = 1.07; // US median effective rate

/** Returns estimated monthly property tax for a given price + state. */
function estimateMonthlyTax(price: number, stateAbbr: string): { monthly: number; label: string } {
  const entry = stateAbbr ? STATE_TAX_RATES[stateAbbr] : null;
  const rate = entry ? entry.rate : NATIONAL_TAX_RATE;
  const label = entry ? entry.label : "national average";
  return { monthly: Math.round((price * (rate / 100)) / 12), label };
}



function applySmartDefaults(f: Record<string, string>): Record<string, string> {
  const price = pf(f.price);
  const rent = pf(f.rent);
  const out = { ...f };
  if (!f.repairs && rent > 0) out.repairs = String(Math.round(rent * 0.05));
  if (!f.mgmt && rent > 0) out.mgmt = String(Math.round(rent * 0.08));
  if (!f.insurance && price > 0) out.insurance = String(Math.round((price * 0.0065) / 12));
  if (!f.vacancy) out.vacancy = "5";
  return out;
}

// ─── U.S. State data for the Analyzer ────────────────────────────────────────

const US_STATES: { abbr: string; name: string }[] = [
  { abbr: "AL", name: "Alabama" },       { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" },       { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" },    { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" },   { abbr: "DE", name: "Delaware" },
  { abbr: "FL", name: "Florida" },       { abbr: "GA", name: "Georgia" },
  { abbr: "HI", name: "Hawaii" },        { abbr: "ID", name: "Idaho" },
  { abbr: "IL", name: "Illinois" },      { abbr: "IN", name: "Indiana" },
  { abbr: "IA", name: "Iowa" },          { abbr: "KS", name: "Kansas" },
  { abbr: "KY", name: "Kentucky" },      { abbr: "LA", name: "Louisiana" },
  { abbr: "ME", name: "Maine" },         { abbr: "MD", name: "Maryland" },
  { abbr: "MA", name: "Massachusetts" }, { abbr: "MI", name: "Michigan" },
  { abbr: "MN", name: "Minnesota" },     { abbr: "MS", name: "Mississippi" },
  { abbr: "MO", name: "Missouri" },      { abbr: "MT", name: "Montana" },
  { abbr: "NE", name: "Nebraska" },      { abbr: "NV", name: "Nevada" },
  { abbr: "NH", name: "New Hampshire" }, { abbr: "NJ", name: "New Jersey" },
  { abbr: "NM", name: "New Mexico" },    { abbr: "NY", name: "New York" },
  { abbr: "NC", name: "North Carolina" },{ abbr: "ND", name: "North Dakota" },
  { abbr: "OH", name: "Ohio" },          { abbr: "OK", name: "Oklahoma" },
  { abbr: "OR", name: "Oregon" },        { abbr: "PA", name: "Pennsylvania" },
  { abbr: "RI", name: "Rhode Island" },  { abbr: "SC", name: "South Carolina" },
  { abbr: "SD", name: "South Dakota" },  { abbr: "TN", name: "Tennessee" },
  { abbr: "TX", name: "Texas" },         { abbr: "UT", name: "Utah" },
  { abbr: "VT", name: "Vermont" },       { abbr: "VA", name: "Virginia" },
  { abbr: "WA", name: "Washington" },    { abbr: "WV", name: "West Virginia" },
  { abbr: "WI", name: "Wisconsin" },     { abbr: "WY", name: "Wyoming" },
];

interface StateSummaryData {
  taxRate: string;        // typical effective property tax rate
  taxNote: string;        // short plain-English description
  insurance: string;      // typical insurance cost note
  investorFriendly: "high" | "medium" | "low";
  investorNote: string;
  climate: string;        // brief climate / hazard note
  opportunity: string;    // key opportunity or caution
}

const STATE_SUMMARIES: Record<string, StateSummaryData> = {
  AL: { taxRate: "~0.40%", taxNote: "Very low property taxes — one of the lowest in the nation.", insurance: "Moderate. Coastal counties carry elevated wind/hurricane risk.", investorFriendly: "high", investorNote: "Landlord-friendly state with straightforward eviction process.", climate: "Hurricane risk in coastal south; tornadoes inland.", opportunity: "Low entry prices and strong rent-to-price ratios in Birmingham and Huntsville." },
  AK: { taxRate: "~1.04%", taxNote: "Moderate property taxes; no state income or sales tax.", insurance: "Higher due to remote location and extreme weather.", investorFriendly: "medium", investorNote: "Smaller rental market; high carrying costs in remote areas.", climate: "Extreme cold; infrastructure costs are high.", opportunity: "Strong demand near Anchorage. Limited supply keeps vacancy low." },
  AZ: { taxRate: "~0.62%", taxNote: "Below-average property taxes with homestead exemptions.", insurance: "Low to moderate. Wildfire risk in northern higher elevations.", investorFriendly: "high", investorNote: "Very landlord-friendly. Fast eviction process (~30 days).", climate: "Extreme heat in Phoenix metro. Wildfire risk in Flagstaff area.", opportunity: "Phoenix and Tucson see strong population growth and rental demand." },
  AR: { taxRate: "~0.63%", taxNote: "Low property taxes; assessment system can be inconsistent.", insurance: "Moderate. Tornado alley increases some risk.", investorFriendly: "high", investorNote: "Straightforward landlord laws, fast eviction timelines.", climate: "Severe thunderstorms and tornado risk.", opportunity: "Very low purchase prices in Little Rock and Fayetteville with solid cap rates." },
  CA: { taxRate: "~0.74%", taxNote: "Below-average effective rate but high home prices mean large absolute bills. Prop 13 caps annual increases.", insurance: "High and rising sharply. Wildfire risk has driven many carriers to exit the state.", investorFriendly: "low", investorNote: "Heavily tenant-friendly laws. Eviction can take 6–18+ months. Rent control in many cities.", climate: "Wildfire risk statewide. Earthquake risk in coastal areas.", opportunity: "Cash flow is very difficult. Appreciation plays work better. Look at Inland Empire or Central Valley for better numbers." },
  CO: { taxRate: "~0.51%", taxNote: "Low effective rate; TABOR limits tax increases.", insurance: "Moderate to high. Hail and wildfire risk is significant.", investorFriendly: "medium", investorNote: "Balanced laws. Denver has some rent stabilization pressure.", climate: "Hail risk along Front Range. Wildfire risk in mountain communities.", opportunity: "Denver and Colorado Springs offer strong demand; cash flow is tight at current prices." },
  CT: { taxRate: "~1.79%", taxNote: "High property taxes — among the highest in New England.", insurance: "Moderate. Coastal areas carry hurricane/flood risk.", investorFriendly: "low", investorNote: "Tenant-friendly state. Evictions can be slow and expensive.", climate: "Nor'easters and coastal storm risk.", opportunity: "Bridgeport and Hartford offer lower prices but require careful tenant screening." },
  DE: { taxRate: "~0.57%", taxNote: "Low property taxes and no sales tax.", insurance: "Moderate. Some coastal flood exposure.", investorFriendly: "medium", investorNote: "Balanced landlord-tenant laws.", climate: "Coastal storm and flooding risk in Sussex County.", opportunity: "Small market but strong demand near Wilmington from Philadelphia commuters." },
  FL: { taxRate: "~0.89%", taxNote: "No state income tax. Homestead exemption reduces tax on primary residence (not rentals).", insurance: "Very high and rising sharply due to hurricane risk. Get quotes before closing.", investorFriendly: "high", investorNote: "Very landlord-friendly with fast eviction (3-day notice). No rent control statewide.", climate: "Hurricane and flood risk statewide, especially coastal. Flood insurance often mandatory.", opportunity: "Strong population growth drives demand. Insurance costs are the key variable — budget carefully." },
  GA: { taxRate: "~0.87%", taxNote: "Moderate property taxes with homestead exemptions.", insurance: "Moderate. Atlanta metro is low risk; coastal areas higher.", investorFriendly: "high", investorNote: "Landlord-friendly laws, efficient eviction process.", climate: "Hurricane risk on coast; occasional ice storms inland.", opportunity: "Atlanta suburbs offer strong cash flow and appreciation. Growing job market." },
  HI: { taxRate: "~0.28%", taxNote: "Lowest property tax rate in the US — but high values mean high bills.", insurance: "High. Hurricane and volcanic risk depending on island.", investorFriendly: "low", investorNote: "Strict tenant protections. Short-term rentals heavily restricted.", climate: "Volcanic activity on Big Island. Hurricane risk.", opportunity: "Extremely high prices make traditional cash flow nearly impossible. Luxury and vacation rentals only." },
  ID: { taxRate: "~0.69%", taxNote: "Moderate and stable property taxes.", insurance: "Low to moderate. Minimal natural disaster risk.", investorFriendly: "high", investorNote: "Landlord-friendly with efficient courts.", climate: "Low risk. Occasional drought.", opportunity: "Boise has seen rapid growth. Prices have risen but fundamentals remain solid." },
  IL: { taxRate: "~2.08%", taxNote: "Among the highest property taxes in the US — factor this carefully.", insurance: "Moderate. Tornado risk in southern Illinois.", investorFriendly: "low", investorNote: "Chicago has rent control pressure. Eviction courts are backlogged.", climate: "Severe winters. Tornado risk downstate.", opportunity: "Chicago south suburbs offer very low prices and high cap rates — but require hands-on management." },
  IN: { taxRate: "~0.85%", taxNote: "Moderate property taxes with circuit-breaker caps.", insurance: "Low to moderate. Tornado risk in southern counties.", investorFriendly: "high", investorNote: "Very landlord-friendly. One of the best states for investor protections.", climate: "Cold winters. Occasional tornado risk.", opportunity: "Indianapolis is one of the best cash-flow markets in the Midwest. Strong fundamentals." },
  IA: { taxRate: "~1.50%", taxNote: "Above-average property taxes — watch your expense model.", insurance: "Moderate. Tornado and flooding risk.", investorFriendly: "medium", investorNote: "Balanced laws. Evictions are straightforward.", climate: "Tornado and flooding risk especially in river valleys.", opportunity: "Des Moines offers stable demand and low acquisition costs." },
  KS: { taxRate: "~1.41%", taxNote: "Above-average property taxes. Rates vary by county.", insurance: "Moderate. Significant tornado risk — Tornado Alley.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Major tornado and hail risk.", opportunity: "Wichita and Kansas City suburbs offer strong rent-to-price ratios." },
  KY: { taxRate: "~0.83%", taxNote: "Moderate property taxes.", insurance: "Low to moderate.", investorFriendly: "high", investorNote: "Landlord-friendly with clear eviction procedures.", climate: "Ice storms and flooding risk. Tornado risk in western counties.", opportunity: "Louisville offers one of the best cash-flow profiles of any mid-size US city." },
  LA: { taxRate: "~0.55%", taxNote: "Low effective tax rate but complex assessment system.", insurance: "High — hurricane and flooding risk is significant. Flood insurance often required.", investorFriendly: "medium", investorNote: "Balanced laws, though courts can be slow.", climate: "Major hurricane and flooding risk statewide.", opportunity: "New Orleans offers character but insurance costs and flood risk require careful underwriting." },
  ME: { taxRate: "~1.09%", taxNote: "Above-average property taxes.", insurance: "Moderate. Coastal storm risk.", investorFriendly: "medium", investorNote: "Balanced, somewhat tenant-leaning laws.", climate: "Harsh winters. Coastal storm risk.", opportunity: "Short-term rentals near coast perform well. Long-term rental demand is thin outside Portland." },
  MD: { taxRate: "~1.09%", taxNote: "Above-average taxes. Baltimore City rates are especially high.", insurance: "Moderate.", investorFriendly: "low", investorNote: "Baltimore City has strong tenant protections and a slow eviction process.", climate: "Coastal storm risk. Occasional flooding.", opportunity: "DC suburbs offer strong demand but high prices. Baltimore proper has high cash flow but high management burden." },
  MA: { taxRate: "~1.17%", taxNote: "Above-average property taxes, though well-funded public services.", insurance: "Moderate. Coastal storm risk in Cape Cod and islands.", investorFriendly: "low", investorNote: "Strong tenant protections. Just-cause eviction laws in many cities.", climate: "Nor'easters, coastal flooding risk.", opportunity: "Strong rental demand near universities. Cash flow very difficult in Boston metro." },
  MI: { taxRate: "~1.54%", taxNote: "High property taxes — one of the highest effective rates in the Midwest.", insurance: "Moderate.", investorFriendly: "medium", investorNote: "Balanced laws. Detroit evictions can be slow.", climate: "Harsh winters. Great Lakes wind chill.", opportunity: "Detroit metro offers very low prices and high cap rates. Grand Rapids has stronger fundamentals." },
  MN: { taxRate: "~1.02%", taxNote: "Moderate to high taxes. Classification system varies for rentals.", insurance: "Moderate. Some tornado risk.", investorFriendly: "medium", investorNote: "Balanced laws with some tenant-leaning protections in Minneapolis.", climate: "Extreme cold winters. Tornado risk in summer.", opportunity: "Minneapolis-St. Paul has strong rental demand but prices have risen significantly." },
  MS: { taxRate: "~0.65%", taxNote: "Low property taxes.", insurance: "Moderate to high on Gulf Coast due to hurricane risk.", investorFriendly: "high", investorNote: "Very landlord-friendly state.", climate: "Hurricane and tornado risk.", opportunity: "Lowest home prices in the nation with solid cap rates — high management intensity required." },
  MO: { taxRate: "~0.97%", taxNote: "Moderate property taxes.", insurance: "Moderate. Tornado risk.", investorFriendly: "high", investorNote: "Landlord-friendly with efficient courts.", climate: "Tornado and flooding risk.", opportunity: "Kansas City and St. Louis offer solid cash flow markets with affordable entry." },
  MT: { taxRate: "~0.83%", taxNote: "Moderate taxes. Rates vary significantly by county.", insurance: "Moderate. Wildfire risk is increasing.", investorFriendly: "medium", investorNote: "Balanced laws.", climate: "Wildfire risk. Harsh winters in northern counties.", opportunity: "Bozeman has seen rapid appreciation. Missoula has stable rental demand." },
  NE: { taxRate: "~1.67%", taxNote: "High property taxes — factor carefully.", insurance: "Moderate. Tornado and hail risk.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Tornado and hail risk. Cold winters.", opportunity: "Omaha offers stable demand and low prices. Strong military and university tenant base." },
  NV: { taxRate: "~0.60%", taxNote: "Low property taxes; no state income tax.", insurance: "Low to moderate. Some wildfire risk.", investorFriendly: "high", investorNote: "Very landlord-friendly. Fast eviction process.", climate: "Extreme heat in Las Vegas. Low precipitation.", opportunity: "Las Vegas has strong short-term and long-term rental demand with growing tech sector." },
  NH: { taxRate: "~1.86%", taxNote: "Very high property taxes — highest in New England alongside NJ.", insurance: "Moderate.", investorFriendly: "medium", investorNote: "Balanced laws.", climate: "Harsh winters. Nor'easter risk.", opportunity: "Manchester offers lower prices than Boston with proximity to the metro area." },
  NJ: { taxRate: "~2.47%", taxNote: "Highest effective property tax rate in the nation. Factor this into every analysis.", insurance: "Moderate to high. Coastal flood and hurricane risk.", investorFriendly: "low", investorNote: "Strong tenant protections. Evictions can be extremely slow — 12+ months.", climate: "Coastal storm and flooding risk. Nor'easters.", opportunity: "Proximity to NYC drives strong demand but taxes and tenant laws make cash flow very difficult." },
  NM: { taxRate: "~0.55%", taxNote: "Low property taxes.", insurance: "Low to moderate. Wildfire risk in forested areas.", investorFriendly: "medium", investorNote: "Balanced laws.", climate: "Drought and wildfire risk. Desert heat.", opportunity: "Albuquerque offers affordable prices and stable university/military tenant base." },
  NY: { taxRate: "~1.72%", taxNote: "High property taxes — NYC has complex additional tax rules.", insurance: "Moderate to high in NYC metro and coastal areas.", investorFriendly: "low", investorNote: "Heavily tenant-friendly — among the strongest in the nation. NYC has strict rent stabilization. Evictions can take 18+ months.", climate: "Coastal storm risk. Harsh winters upstate.", opportunity: "NYC cash flow is nearly impossible. Upstate cities like Buffalo and Rochester have high cap rates but require intensive management." },
  NC: { taxRate: "~0.80%", taxNote: "Moderate property taxes.", insurance: "Moderate. Coastal areas have hurricane risk; inland has tornado risk.", investorFriendly: "high", investorNote: "Landlord-friendly with efficient eviction process.", climate: "Hurricane risk on coast. Tornado risk in piedmont.", opportunity: "Charlotte and Raleigh-Durham are among the strongest fundamentals in the Southeast." },
  ND: { taxRate: "~0.98%", taxNote: "Moderate property taxes.", insurance: "Low to moderate.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Extreme cold. High wind.", opportunity: "Fargo offers stable demand, low prices, and solid yields — energy sector tenant base." },
  OH: { taxRate: "~1.59%", taxNote: "High property taxes for the Midwest — verify county rates.", insurance: "Moderate.", investorFriendly: "high", investorNote: "Landlord-friendly with efficient courts.", climate: "Cold winters. Lake effect snow in northern counties.", opportunity: "Cleveland, Columbus, and Cincinnati offer excellent cash flow with low entry costs." },
  OK: { taxRate: "~0.90%", taxNote: "Moderate property taxes.", insurance: "Moderate to high. Tornado risk is among the highest in the nation.", investorFriendly: "high", investorNote: "Very landlord-friendly.", climate: "Major tornado and severe weather risk — Tornado Alley.", opportunity: "Oklahoma City and Tulsa offer very strong rent-to-price ratios." },
  OR: { taxRate: "~0.93%", taxNote: "Moderate taxes; Measure 5/50 caps limit increases.", insurance: "Moderate. Earthquake and wildfire risk.", investorFriendly: "low", investorNote: "Tenant-friendly. Portland has just-cause eviction and rent stabilization.", climate: "Wildfire risk in eastern/central Oregon. Earthquake risk statewide.", opportunity: "Portland cash flow is challenging. Eugene and Salem offer better fundamentals." },
  PA: { taxRate: "~1.49%", taxNote: "High property taxes — varies significantly by municipality.", insurance: "Moderate.", investorFriendly: "medium", investorNote: "Balanced laws. Philadelphia has some tenant protections.", climate: "Cold winters. Nor'easter risk in east.", opportunity: "Pittsburgh offers strong cash flow. Philadelphia requires careful market selection." },
  RI: { taxRate: "~1.63%", taxNote: "High property taxes.", insurance: "Moderate. Coastal storm risk.", investorFriendly: "low", investorNote: "Tenant-friendly laws.", climate: "Coastal storm and flooding risk.", opportunity: "Small market. Providence offers university rental demand." },
  SC: { taxRate: "~0.57%", taxNote: "Low property taxes. Investment properties taxed at 6% assessment ratio vs. 4% for owner-occupied.", insurance: "Moderate to high on coast. Hurricane and wind risk.", investorFriendly: "high", investorNote: "Landlord-friendly with fast eviction process.", climate: "Hurricane risk on coast.", opportunity: "Charleston and Greenville are among the strongest growing markets in the Southeast." },
  SD: { taxRate: "~1.08%", taxNote: "Moderate taxes. No state income tax.", insurance: "Low to moderate.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Extreme cold and wind. Blizzard risk.", opportunity: "Sioux Falls has surprisingly strong rental demand and low vacancy." },
  TN: { taxRate: "~0.66%", taxNote: "Low property taxes. No state income tax.", insurance: "Low to moderate. Tornado risk in Memphis area.", investorFriendly: "high", investorNote: "Very landlord-friendly. Among the best eviction timelines in the country.", climate: "Tornado risk in west. Flash flooding in Nashville area.", opportunity: "Nashville and Memphis are strong markets. Nashville has seen price compression; Memphis has high yields." },
  TX: { taxRate: "~1.68%", taxNote: "High property taxes offset by no state income tax. Factor this carefully — it materially affects cash flow.", insurance: "Moderate to high. Hail, wind, flood risk varies by region. Rising premiums statewide.", investorFriendly: "high", investorNote: "Very landlord-friendly. Fast eviction process (3–5 weeks typical).", climate: "Hail risk in DFW and central Texas. Hurricane risk on Gulf Coast. Flooding in Houston.", opportunity: "Dallas, Houston, San Antonio, and Austin all have strong fundamentals. Property taxes are the key expense to model correctly." },
  UT: { taxRate: "~0.56%", taxNote: "Low property taxes.", insurance: "Low to moderate. Earthquake risk along Wasatch Front.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Earthquake risk. Winter storms in mountains.", opportunity: "Salt Lake City has seen rapid appreciation. Strong job growth and population influx continue." },
  VT: { taxRate: "~1.83%", taxNote: "Very high property taxes.", insurance: "Moderate.", investorFriendly: "low", investorNote: "Tenant-friendly laws. Small market.", climate: "Harsh winters. Flooding risk.", opportunity: "Burlington has university demand but extremely thin inventory." },
  VA: { taxRate: "~0.82%", taxNote: "Moderate property taxes.", insurance: "Moderate. Coastal storm risk in Hampton Roads.", investorFriendly: "medium", investorNote: "Balanced laws. Some local jurisdictions have tenant-leaning ordinances.", climate: "Hurricane risk on coast. Snowstorms in northern VA.", opportunity: "Northern Virginia has strong demand driven by federal employment. Richmond offers better cash flow." },
  WA: { taxRate: "~0.93%", taxNote: "Moderate taxes. No state income tax.", insurance: "Moderate. Earthquake and wildfire risk.", investorFriendly: "low", investorNote: "Tenant-friendly. Seattle has just-cause eviction and rent increase notice requirements.", climate: "Wildfire risk in eastern WA. Earthquake risk statewide.", opportunity: "Seattle cash flow is very challenging. Spokane and Tri-Cities offer better fundamentals." },
  WV: { taxRate: "~0.57%", taxNote: "Low property taxes.", insurance: "Low to moderate. Flooding risk in river valleys.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Flooding risk. Harsh winters.", opportunity: "Very low prices but limited rental demand outside Charleston and Morgantown." },
  WI: { taxRate: "~1.73%", taxNote: "High property taxes — verify county rates carefully.", insurance: "Moderate.", investorFriendly: "medium", investorNote: "Balanced laws.", climate: "Extreme cold winters. Great Lakes wind chill.", opportunity: "Milwaukee and Madison offer affordable prices with solid rental demand." },
  WY: { taxRate: "~0.57%", taxNote: "Low property taxes. No state income tax.", insurance: "Low to moderate. Hail and wind risk.", investorFriendly: "high", investorNote: "Landlord-friendly state.", climate: "Extreme wind. Cold winters.", opportunity: "Cheyenne and Casper offer stability but limited population growth." },
};

const INVESTOR_FRIENDLY_LABELS = { high: "Investor-friendly", medium: "Balanced", low: "Tenant-leaning" };
const INVESTOR_FRIENDLY_COLORS = { high: "#1a7a4a", medium: "#a06010", low: "#c0392b" };

function StateSummaryCard({ stateAbbr }: { stateAbbr: string }) {
  if (!stateAbbr) return null;
  const data = STATE_SUMMARIES[stateAbbr];
  if (!data) return null;
  const stateName = US_STATES.find(s => s.abbr === stateAbbr)?.name ?? stateAbbr;
  const ifColor = INVESTOR_FRIENDLY_COLORS[data.investorFriendly];
  const ifLabel = INVESTOR_FRIENDLY_LABELS[data.investorFriendly];
  return (
    <div style={{
      background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 14,
      padding: "18px 20px", marginTop: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>{stateName} — Market Overview</p>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
          background: ifColor + "18", color: ifColor, border: `1px solid ${ifColor}40`,
          borderRadius: 999, padding: "3px 10px",
        }}>{ifLabel}</span>
      </div>
      {/* Four data rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { icon: "🏷️", label: "Property Tax", value: data.taxRate, note: data.taxNote },
          { icon: "🏠", label: "Insurance",    value: "",           note: data.insurance },
          { icon: "⚖️", label: "Landlord Laws", value: "",          note: data.investorNote },
          { icon: "🌤️", label: "Climate Risk", value: "",           note: data.climate },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{row.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{row.label}</span>
                {row.value && <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{row.value}</span>}
              </div>
              <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.55, marginTop: 2 }}>{row.note}</p>
            </div>
          </div>
        ))}
        {/* Opportunity callout */}
        <div style={{ marginTop: 4, paddingTop: 12, borderTop: `1px solid ${C.rule}` }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <p style={{ fontSize: 11, color: C.text, lineHeight: 1.6, fontStyle: "italic" }}>{data.opportunity}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyzerPage({ onSave, prefill, user, onOpenLogin }: { onSave: (d: SavedDeal) => void; prefill?: DealInput | null; user: AuthUser | null; onOpenLogin: () => void }) {
  const [mode, setMode] = useState<Mode>("manual");
  const [appMode, setAppMode] = useState<AppMode>("investor");

  // ── Auto-save: restore last draft on mount ────────────────────────────────
  const [form, setForm] = useState<Record<string, string>>(() => {
    if (prefill) return EMPTY_FORM; // prefill overrides draft
    const draft = lsGet<Record<string, string>>(LS_FORM_DRAFT);
    if (draft && draft.price) return { ...EMPTY_FORM, ...draft };
    return EMPTY_FORM;
  });
  const [draftStatus, setDraftStatus] = useState<"idle"|"saving"|"saved">("idle");

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showRentEstimate, setShowRentEstimate] = useState(false);
  const [autoTax, setAutoTax] = useState(true); // true = use state estimate, false = manual
  const [marketData, setMarketData] = useState<MarketRow[]>([]);
  const [showComps, setShowComps] = useState(false);
  const [csvError, setCsvError] = useState("");
  const [csvParsed, setCsvParsed] = useState<CsvParsed | null>(null);
  const [csvMapping, setCsvMapping] = useState<Record<string,CsvField>>({});
  const [csvStep, setCsvStep] = useState<"upload"|"map"|"preview">("upload");
  const [highlightFields, setHighlightFields] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rentInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced autosave: 1.2 s after last keystroke ────────────────────────
  useEffect(() => {
    // Only save if there's something meaningful in the form
    const hasContent = Object.entries(form).some(([k, v]) =>
      k !== "term" && k !== "vacancy" && v !== "" && v !== "0"
    );
    if (!hasContent) return;

    setDraftStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lsSet(LS_FORM_DRAFT, form);
      setDraftStatus("saved");
      // Reset to idle after 2.5 s
      setTimeout(() => setDraftStatus("idle"), 2500);
    }, 1200);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [form]);

  useEffect(() => {
    if (!prefill) return;
    setForm({
      address: prefill.address,
      price: String(prefill.price),
      down: String(prefill.down),
      rate: String(prefill.rate),
      term: String(prefill.term),
      rent: String(prefill.rent),
      vacancy: String(prefill.vacancy),
      taxes: String(prefill.taxes),
      insurance: String(prefill.insurance),
      hoa: String(prefill.hoa),
      repairs: String(prefill.repairs),
      mgmt: String(prefill.mgmt),
      other: String(prefill.other),
    });
  }, [prefill]);

  const setField = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  function analyze() {
    const price = pf(form.price);
    if (!price) {
      alert("Please enter a purchase price to continue.");
      return;
    }

    const filled = applySmartDefaults(form);
    setForm(filled);

    const d: DealInput = {
      address: filled.address || "Unnamed Property",
      price: pf(filled.price),
      down: pf(filled.down),
      rate: pf(filled.rate),
      term: pf(filled.term) || 30,
      rent: pf(filled.rent),
      vacancy: pf(filled.vacancy) || 5,
      taxes: (() => {
        if (!autoTax) return pf(filled.taxes);
        const manualVal = pf(filled.taxes);
        if (manualVal > 0) return manualVal; // user has typed something — respect it
        const price = pf(filled.price);
        if (price <= 0) return 0;
        return estimateMonthlyTax(price, form.state).monthly;
      })(),
      insurance: pf(filled.insurance),
      hoa: pf(filled.hoa),
      repairs: pf(filled.repairs),
      mgmt: pf(filled.mgmt),
      other: pf(filled.other),
    };

    const rentMissing = d.rent === 0;
    setResult({ r: calcDeal(d, form.state), d, rentMissing, stateAbbr: form.state });
    setSaved(false);
  }

  function handleSave() {
    if (!result) return;
    onSave({
      id: Date.now(),
      ...result.d,
      ...result.r,
      saved: false,
      savedAt: new Date().toISOString(),
      userEmail: user?.email ?? "guest",
    });
    setSaved(true);
  }


  function handleRentEstimate(val: string) {
    setField("rent")(val);
    setShowRentEstimate(false);
  }

  function handleUseAverage(val: string) {
    setField("rent")(val);
    setShowComps(false);
    if (rentInputRef.current) {
      rentInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function focusRentInput() {
    if (rentInputRef.current) {
      rentInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      rentInputRef.current.focus();
    }
  }

  function processCSV(file: File) {
    setCsvError("");
    setCsvParsed(null);
    setCsvStep("upload");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvError("Please upload a .csv file. Other formats are not supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCsvError("File is too large. Please use a CSV under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      if (!text) { setCsvError("Could not read the file. Try saving it as UTF-8 CSV."); return; }
      const result = parseCsvText(text);
      if ("error" in result) { setCsvError(result.error); return; }
      setCsvParsed(result);
      setCsvMapping(result.mapping);
      // Market datasets show the premium transform UI (map step)
      if (result.dataset.isMarketDataset) {
        setCsvStep("map");
        return;
      }
      // Only skip to preview if price is high-confidence auto-mapped AND no warnings
      const hasPriceMapping = Object.values(result.mapping).includes("purchase_price");
      const isPriceHighConf = Object.entries(result.confidence)
        .some(([h, c]) => result.mapping[h] === "purchase_price" && c === "high");
      setCsvStep(hasPriceMapping && isPriceHighConf && result.warnings.length === 0 ? "preview" : "map");
    };
    reader.onerror = () => setCsvError("Failed to read the file. Make sure it isn\'t open in another program.");
    reader.readAsText(file);
  }

  function importDeals() {
    if (!csvParsed) return;
    const deals = applyMapping(csvParsed.rows, csvMapping, csvParsed.colTypes);
    if (deals.length === 0) {
      setCsvError("No valid rows found. Make sure at least one row has a Purchase Price.");
      return;
    }
    deals.forEach(d => {
      onSave({
        id: Date.now() + Math.random(),
        ...d, ...calcDeal(d),
        saved: false,
        savedAt: new Date().toISOString(),
        userEmail: user?.email ?? "guest",
      });
    });
    setCsvParsed(null);
    setCsvStep("upload");
    setCsvError("");
    alert(`${deals.length} deal${deals.length !== 1 ? "s" : ""} imported and saved to My Deals.`);
  }

  function resetCsv() {
    setCsvParsed(null);
    setCsvMapping({});
    setCsvStep("upload");
    setCsvError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    const csv = [
      "address,purchase_price,down_payment,interest_rate,loan_term,monthly_rent,vacancy_rate,taxes,insurance,hoa,repairs,management,other",
      "123 Main St,325000,65000,7.25,30,2400,5,350,120,0,150,200,50",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "dealistic_template.csv";
    a.click();
  }

  const scoreColor = result ? (result.r.score >= 70 ? C.green : result.r.score >= 45 ? C.amber : C.red) : C.text;
  const priceVal = pf(form.price);

  function SectionLabel({ text }: { text: string }) {
    return <div className="az-section-label">{text}</div>;
  }

  const isBuyer = appMode === "buyer";

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", color: C.text }}>
      {/* ── Analyzer header — self-contained, no overlap with global fixed elements ── */}
      <div style={{ borderBottom: "1px solid #e2e8f0", background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 clamp(12px,3vw,32px)" }}>

          {/* Row 1: app mode + input mode toggles — clean, no auth overlap */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingTop: 14, paddingBottom: 14,
            borderBottom: `1px solid ${C.rule}`,
          }}>
            {/* Left: Home Buyer / Investor */}
            <div style={{ display: "flex", background: "#f1f5f9", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 3, gap: 2 }}>
              {([
                { key: "buyer" as AppMode, label: "Home Buyer" },
                { key: "investor" as AppMode, label: "Investor" },
              ]).map(opt => {
                const active = appMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => { setAppMode(opt.key); setResult(null); }}
                    style={{
                      padding: "7px 18px", border: "none", borderRadius: 7,
                      background: active ? "#2563eb" : "transparent",
                      color: active ? "#fff" : "#475569",
                      cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                      fontWeight: active ? 700 : 500, letterSpacing: "0.02em",
                      transition: "all 0.18s", whiteSpace: "nowrap",
                      boxShadow: active ? "0 2px 8px rgba(37,99,235,0.2)" : "none",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Right: Manual / CSV */}
            <div style={{ display: "flex", background: "#f1f5f9", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 3, gap: 2 }}>
              {(["manual", "csv"] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: "7px 16px", border: "none", borderRadius: 7,
                    background: mode === m ? "#0f172a" : "transparent",
                    color: mode === m ? "#fff" : "#475569",
                    cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                    fontWeight: mode === m ? 700 : 500, letterSpacing: "0.02em",
                    transition: "all 0.18s", whiteSpace: "nowrap",
                  }}
                >
                  {m === "manual" ? "Manual" : "CSV Upload"}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: page title + subtitle */}
          <div style={{ paddingTop: 20, paddingBottom: 20, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", margin: 0, color: "#0f172a", lineHeight: 1.2 }}>
                {isBuyer ? "Home Buyer Calculator" : "Deal Analyzer"}
              </h1>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 5 }}>
                {isBuyer ? "Understand your monthly costs before you buy" : "Enter details or upload a CSV"}
              </p>
            </div>
            {/* Draft status indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {draftStatus === "saved" && (
                <span style={{ fontSize: 11, color: "#059669", display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Draft saved
                </span>
              )}
              {draftStatus === "saving" && (
                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>Saving…</span>
              )}
              {lsGet<Record<string,string>>(LS_FORM_DRAFT)?.price && (
                <button
                  onClick={() => { setForm(EMPTY_FORM); lsDel(LS_FORM_DRAFT); setResult(null); setDraftStatus("idle"); }}
                  style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, transition: "color 0.15s" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#dc2626"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                >
                  Clear form
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      
      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "clamp(20px,3vw,40px) clamp(16px,3vw,40px)" }}>

        {/* ── Manual Mode ── */}
        {mode === "manual" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 560px), 1fr))", gap: "clamp(16px,2.5vw,32px)", alignItems: "start" }}>

            {/* ── Form column — 3 cards ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Address + State */}
              <div className="az-card" style={{ padding: "16px 18px" }}>
                <label className="az-label">Address <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" placeholder="123 Main St, Austin TX"
                    value={form.address} onChange={e => setField("address")(e.target.value)}
                    className="az-input" style={{ flex: 1, minWidth: 0 }} />
                  <StateSelect
                    value={form.state}
                    onChange={v => setField("state")(v)}
                    width={90}
                  />
                </div>
                <StateSummaryCard stateAbbr={form.state} />
              </div>

              {/* ── 2-col layout: Financing left, Income+Expenses right ── */}
              <style>{`
                .form-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
                @media (max-width: 520px) { .form-two-col { grid-template-columns: 1fr; } }
                .exp-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
                @media (max-width: 420px) { .exp-two-col { grid-template-columns: 1fr; } }
              `}</style>
              <div className="form-two-col">

                {/* ── LEFT: Financing ── */}
                <div className="az-card" style={{ padding: "16px 18px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#94a3b8", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    Financing
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                    {/* Purchase Price */}
                    <div>
                      <label className="az-label">Purchase Price</label>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.faint, pointerEvents: "none" }}>$</span>
                        <input ref={priceInputRef} type="number" placeholder="325,000"
                          value={form.price} onChange={e => setField("price")(e.target.value)}
                          className="az-input az-input-prefix"
                          style={{ border: highlightFields.has("price") ? "1.5px solid #2563eb" : undefined, boxShadow: highlightFields.has("price") ? "0 0 0 3px rgba(37,99,235,0.14)" : undefined }} />
                      </div>
                    </div>

                    <SmartField label="Down Payment" placeholder="65,000" prefix="$"
                      value={form.down} onChange={setField("down")}
                      tooltip="Usually 20–25% of purchase price for rentals" />
                    <SmartField label="Interest Rate" placeholder="7.25" suffix="%"
                      value={form.rate} onChange={setField("rate")}
                      tooltip="Check Bankrate.com for today's investment rates" />
                    <SmartField label="Loan Term (yrs)" placeholder="30"
                      value={form.term} onChange={setField("term")}
                      tooltip="30 years is standard. 15 years = higher payments, less total interest" />
                  </div>
                </div>

                {/* ── RIGHT: Income + Expenses stacked ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* Income card */}
                  {!isBuyer && (
                    <div className="az-card" style={{ padding: "16px 18px" }}>
                      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#94a3b8", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                        Income
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Monthly Rent */}
                        <div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <label className="az-label" style={{ margin: 0 }}>Monthly Rent <span style={{ color: "#94a3b8", fontWeight: 400 }}>(opt.)</span></label>
                            {priceVal > 0 && (
                              <button onClick={() => setShowRentEstimate(v => !v)} className="az-btn-ghost" style={{ fontSize: 9, padding: "2px 7px" }}>
                                {showRentEstimate ? "Hide" : "Estimate"}
                              </button>
                            )}
                          </div>
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.faint, pointerEvents: "none" }}>$</span>
                            <input ref={rentInputRef} type="number" placeholder="2,400"
                              value={form.rent} onChange={e => setField("rent")(e.target.value)}
                              className="az-input az-input-prefix"
                              style={{ border: highlightFields.has("rent") ? "1.5px solid #2563eb" : undefined, boxShadow: highlightFields.has("rent") ? "0 0 0 3px rgba(37,99,235,0.14)" : undefined }} />
                          </div>
                          {showRentEstimate && priceVal > 0 && <RentEstimatorPanel price={priceVal} onSelect={handleRentEstimate} />}
                        </div>
                        <SmartField label="Vacancy Rate" placeholder="5" suffix="%"
                          value={form.vacancy} onChange={setField("vacancy")}
                          autoLabel="5%" tooltip="5–8% is typical for most rental markets" />

                        {/* Rental tools */}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid #f1f5f9" }}>
                          <button onClick={() => setShowComps(v => !v)} className="az-btn-ghost" style={{ fontSize: 10 }}>
                            {showComps ? "Hide Comps" : "Rental Comps"}
                          </button>
                          </div>
                        {showComps && <RentalCompsSection onUseAverage={handleUseAverage} />}
                      </div>
                    </div>
                  )}

                  {/* Expenses card */}
                  <div className="az-card" style={{ padding: "16px 18px" }}>
                    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#94a3b8", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                      Expenses
                    </p>

                    {/* ── 2-col expense grid ── */}
                    <div className="exp-two-col">

                      {/* Left expense column */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Property Taxes — smart toggle */}
                        {(() => {
                          const price = pf(form.price);
                          const est = price > 0 ? estimateMonthlyTax(price, form.state) : null;
                          const estVal = est ? est.monthly : 0;
                          const hasManual = form.taxes !== "" && form.taxes !== "0";
                          return (
                            <div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <label className="az-label" style={{ margin: 0 }}>Taxes</label>
                                  <span title="Property taxes vary by county. This estimate uses the state average effective rate." style={{ width: 13, height: 13, borderRadius: "50%", border: "1px solid #e2e8f0", background: "#f8fafc", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#64748b", cursor: "default" }}>?</span>
                                </div>
                                <button onClick={() => { setAutoTax(!autoTax); }}
                                  style={{ display: "flex", alignItems: "center", gap: 3, background: autoTax ? "rgba(37,99,235,0.07)" : "#f1f5f9", border: `1px solid ${autoTax ? "rgba(37,99,235,0.2)" : "#e2e8f0"}`, borderRadius: 99, padding: "1px 6px 1px 3px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: autoTax ? "#2563eb" : "#94a3b8", display: "block", flexShrink: 0, transition: "background 0.15s" }} />
                                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: autoTax ? "#2563eb" : "#64748b" }}>{autoTax ? "Auto" : "Manual"}</span>
                                </button>
                              </div>
                              <div style={{ position: "relative" }}>
                                <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#94a3b8", pointerEvents: "none", zIndex: 1 }}>$</span>
                                <input type="number" placeholder={autoTax && estVal > 0 ? String(estVal) : "350"} value={form.taxes}
                                  onChange={e => { setField("taxes")(e.target.value); if (e.target.value) setAutoTax(false); }}
                                  className="az-input az-input-prefix"
                                  style={{ borderColor: autoTax && !hasManual ? "rgba(37,99,235,0.25)" : undefined, background: autoTax && !hasManual ? "rgba(37,99,235,0.025)" : undefined }} />
                              </div>
                              {(autoTax && !hasManual) && (
                                <p style={{ fontSize: 9, color: "#2563eb", margin: "2px 0 0" }}>
                                  {estVal > 0 ? `~$${estVal}/mo · ${est!.label}` : "Select state to estimate"}
                                </p>
                              )}
                              {!autoTax && (
                                <button onClick={() => { setAutoTax(true); setField("taxes")(""); }} style={{ fontSize: 9, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "1px 0 0", letterSpacing: "0.02em" }}>
                                  Reset to estimate
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        <SmartField label="HOA Fees" placeholder="0" prefix="$"
                          value={form.hoa} onChange={setField("hoa")}
                          tooltip="Listed in the MLS or ask the seller's agent. Enter 0 if none." />
                        <SmartField label="Other Costs" placeholder="50" prefix="$"
                          value={form.other} onChange={setField("other")}
                          tooltip={isBuyer ? "Lawn care, utilities you pay as owner" : "Utilities, lawn, pest control as landlord"} />
                      </div>

                      {/* Right expense column */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <SmartField label="Insurance" placeholder="120" prefix="$"
                          value={form.insurance} onChange={setField("insurance")}
                          autoLabel="Auto" tooltip="We estimate ~0.65% of price/year if left blank" />
                        {!isBuyer && (
                          <>
                            <SmartField label="Repairs & Maint." placeholder="150" prefix="$"
                              value={form.repairs} onChange={setField("repairs")}
                              autoLabel="5%" tooltip="Rule of thumb: ~5% of monthly rent" />
                            <SmartField label="Property Mgmt." placeholder="200" prefix="$"
                              value={form.mgmt} onChange={setField("mgmt")}
                              autoLabel="8%" tooltip="Typically 8–10% of monthly rent. Enter 0 if self-managing." />
                          </>
                        )}
                      </div>
                    </div>

                    <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 10, margin: "10px 0 0" }}>
                      Smart defaults apply to blank fields
                    </p>
                  </div>

                </div>
              </div>

              {/* Analyze button — full width below both columns */}
              <button onClick={analyze} className="az-btn-primary" style={{ marginTop: 0 }}>
                {isBuyer ? "Calculate My Costs" : "Analyze This Deal"}
              </button>
            </div>

            {/* Results column — sticky on desktop */}
            <div style={{ position: "sticky", top: 72, alignSelf: "start" }}>
              {/* Market Outlook — shown when market CSV has been imported */}
              {marketData.length > 0 && (
                <MarketOutlookPanel data={marketData} address={form.address} />
              )}
              {!result ? (
                <DealScorePreview isBuyer={isBuyer} />
              ) : isBuyer ? (

                /* ── HOME BUYER RESULTS ── */
                <BuyerResults result={result} onSwitchToInvestor={() => { setAppMode("investor"); setResult(null); }} />

              ) : (
                /* ── INVESTOR RESULTS → full dashboard ── */
                <InvestorDashboard
                  result={result}
                  stateAbbr={result.stateAbbr}
                  saved={saved}
                  onSave={handleSave}
                  onFocusRent={focusRentInput}
                  scoreColor={scoreColor}
                  user={user}
                  onOpenLogin={onOpenLogin}
                />
              )}
            </div>
          </div>
        )}

        {/* ── CSV Mode ── */}
        {mode === "csv" && (
          <div style={{ maxWidth: 900 }}>

            {/* Step indicator */}
            {csvParsed && (
              <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 32 }}>
                {(["upload","map","preview"] as const).map((step, i) => {
                  const labels = { upload: "Upload", map: "Map Columns", preview: "Preview & Import" };
                  const isDone = (csvStep === "map" && step === "upload") || (csvStep === "preview" && step !== "preview");
                  const isActive = csvStep === step;
                  return (
                    <div key={step} style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: "50%", background: isActive ? C.text : isDone ? C.green : C.bg2, border: `1px solid ${isActive ? C.text : isDone ? C.green : C.rule}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: (isActive || isDone) ? "#fff" : C.faint, fontWeight: 700, flexShrink: 0 }}>
                          {isDone ? "✓" : i + 1}
                        </span>
                        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: isActive ? C.text : C.faint }}>{labels[step]}</span>
                      </div>
                      {i < 2 && <span style={{ width: 32, height: 1, background: C.rule, margin: "0 8px" }} />}
                    </div>
                  );
                })}
                <button onClick={resetCsv} style={{ marginLeft: "auto", background: "transparent", border: "none", fontSize: 11, color: C.faint, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
                  Start over
                </button>
              </div>
            )}

            {/* Error banner */}
            {csvError && (
              <div style={{ border: "1px solid #d4a8a0", background: "#f9edec", padding: "16px 20px", marginBottom: 24, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 9, background: C.red, color: "#fff", padding: "2px 6px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, marginTop: 1 }}>Error</span>
                <div>
                  <p style={{ fontSize: 13, color: C.red }}>{csvError}</p>
                  <p style={{ fontSize: 11, color: "#9a4040", marginTop: 4 }}>Check your file and try again, or <button onClick={resetCsv} style={{ background: "none", border: "none", color: C.blue, fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>upload a different file</button>.</p>
                </div>
              </div>
            )}

            {/* Warnings */}
            {csvParsed?.warnings.map(w => (
              <div key={w} style={{ border: "1px solid #e8c87a", background: "#fdf5e8", padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 9, background: C.amber, color: "#fff", padding: "2px 6px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>Note</span>
                <p style={{ fontSize: 12, color: "#7a5500" }}>{w}</p>
              </div>
            ))}

            {/* STEP 1: Upload drop zone */}
            {csvStep === "upload" && !csvParsed && (
              <>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) processCSV(f); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.text; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.rule; }}
                  style={{ border: `1px solid ${C.rule}`, padding: "clamp(28px,5vw,64px) clamp(14px,4vw,48px)", textAlign: "center", cursor: "pointer", transition: "border-color 0.15s", marginBottom: 20 }}
                >
                  <p style={{ fontSize: 15, color: C.text, marginBottom: 6 }}>Drop your CSV here or click to browse</p>
                  <p style={{ fontSize: 11, color: C.faint }}>Any CSV format works — column names will be auto-detected</p>
                  <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) processCSV(f); }} />
                </div>

                <button onClick={downloadTemplate}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; (e.currentTarget as HTMLElement).style.borderColor = C.text; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.faint; (e.currentTarget as HTMLElement).style.borderColor = C.rule; }}
                  style={{ background: "transparent", color: C.faint, border: `1px solid ${C.rule}`, padding: "10px 20px", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit", marginBottom: 32, transition: "color 0.12s, border-color 0.12s" }}
                >
                  Download Template
                </button>

                <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 24 }}>
                  <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Only two columns are required</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {CSV_FIELDS.filter(f => f.required).map(f => (
                      <code key={f.key} style={{ fontSize: 10, fontFamily: "monospace", background: C.text, color: C.bg, padding: "4px 10px" }}>{f.key}</code>
                    ))}
                    {CSV_FIELDS.filter(f => !f.required).map(f => (
                      <code key={f.key} style={{ fontSize: 10, fontFamily: "monospace", background: C.bg2, border: `1px solid ${C.rule}`, padding: "4px 8px", color: C.muted }}>{f.key}</code>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: C.faint, marginTop: 10, fontStyle: "italic" }}>Bold = required. Everything else uses smart defaults if missing.</p>
                </div>
              </>
            )}

            {/* STEP 2: Column mapping UI — simplified 2-step layout */}
            {csvStep === "map" && csvParsed && (
              <CsvMappingUI
                csvParsed={csvParsed}
                csvMapping={csvMapping}
                setCsvMapping={setCsvMapping}
                onNext={() => { setCsvStep("preview"); setCsvError(""); }}
                onCancel={resetCsv}
                onImportMarket={(rows) => {
                  setMarketData(rows);
                  setMode("manual");
                  resetCsv();
                }}
              />
            )}

            {/* STEP 3: Preview table + import */}
            {csvStep === "preview" && csvParsed && (
              <div>
                {(() => {
                  const previewed = applyMapping(csvParsed.rows, csvMapping, csvParsed.colTypes);
                  const skipped = csvParsed.rows.length - previewed.length;
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{previewed.length} deal{previewed.length !== 1 ? "s" : ""} ready to import</p>
                          {skipped > 0 && <p style={{ fontSize: 11, color: C.amber, marginTop: 3 }}>{skipped} row{skipped !== 1 ? "s" : ""} skipped — no purchase price found</p>}
                        </div>
                        <button onClick={() => setCsvStep("map")} style={{ background: "transparent", border: "none", color: C.faint, fontSize: 11, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>← Edit mapping</button>
                      </div>

                      {/* Preview table */}
                      <div style={{ overflowX: "auto", marginBottom: 24, border: `1px solid ${C.rule}` }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${C.rule}`, background: C.bg2 }}>
                              {["Address","Price","Rent","Rate","Down","Score"].map(h => (
                                <th key={h} style={{ padding: "10px 12px", fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "left", fontWeight: 600 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {previewed.slice(0, 8).map((d, i) => {
                              const r = calcDeal(d);
                              const sc = r.score >= 70 ? C.green : r.score >= 45 ? C.amber : C.red;
                              return (
                                <tr key={i} style={{ borderBottom: `1px solid ${C.rule}` }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                                >
                                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.address}</td>
                                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmt(d.price)}</td>
                                  <td style={{ padding: "10px 12px", fontSize: 12, color: d.rent > 0 ? C.text : C.faint, fontVariantNumeric: "tabular-nums" }}>{d.rent > 0 ? fmt(d.rent) : "—"}</td>
                                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.text }}>{d.rate}%</td>
                                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmt(d.down)}</td>
                                  <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: sc }}>{r.score}</td>
                                </tr>
                              );
                            })}
                            {previewed.length > 8 && (
                              <tr>
                                <td colSpan={6} style={{ padding: "10px 12px", fontSize: 11, color: C.faint, fontStyle: "italic", textAlign: "center" }}>
                                  + {previewed.length - 8} more deal{previewed.length - 8 !== 1 ? "s" : ""}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ display: "flex", gap: 12 }}>
                        <button onClick={importDeals}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                          style={{ flex: 1, padding: "14px", background: C.text, color: C.bg, border: "none", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s" }}>
                          Import {previewed.length} Deal{previewed.length !== 1 ? "s" : ""}
                        </button>
                        <button onClick={resetCsv} style={{ padding: "14px 20px", background: "transparent", color: C.muted, border: `1px solid ${C.rule}`, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DashboardPage ────────────────────────────────────────────────────────────
// ─── DealDetailModal ──────────────────────────────────────────────────────────
function DealDetailModal({ deal, onClose }: { deal: SavedDeal; onClose: () => void }) {
  const sc = deal.score >= 70 ? C.green : deal.score >= 45 ? C.amber : C.red;
  const savedDate = deal.savedAt
    ? new Date(deal.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", width: "100%", maxWidth: 560,
          maxHeight: "90vh", overflowY: "auto",
          border: "1px solid #e2e8f0", borderRadius: 24,
          boxShadow: "0 24px 64px rgba(15,23,42,0.16)",
        }}
      >
        {/* Modal header */}
        <div style={{ padding: "24px 28px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>Deal Detail</p>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a", margin: 0 }}>{deal.address.split(",")[0]}</h2>
            {deal.address.includes(",") && (
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{deal.address.split(",").slice(1).join(",").trim()}</p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "#f1f5f9", border: "none", cursor: "pointer", fontSize: 16, color: "#64748b", fontFamily: "inherit", lineHeight: 1, padding: "7px 10px", borderRadius: 8, transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#e2e8f0"; (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "24px 28px" }}>
          {/* Score hero */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ flexShrink: 0 }}>
              <span style={{ fontSize: 80, fontWeight: 800, lineHeight: 0.85, letterSpacing: "-0.06em", color: sc, fontVariantNumeric: "tabular-nums", display: "block" }}>
                {deal.score}
              </span>
              <span style={{ fontSize: 10, color: "#94a3b8", display: "block", marginTop: 5 }}>/ 100</span>
            </div>
            <div style={{ paddingTop: 8, flex: 1 }}>
              <ScoreChip label={deal.label} />
              {/* score meter */}
              <div style={{ marginTop: 12, height: 5, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${deal.score}%`,
                  background: deal.score >= 70 ? "linear-gradient(90deg,#059669,#10b981)" : deal.score >= 45 ? "linear-gradient(90deg,#d97706,#f59e0b)" : "linear-gradient(90deg,#dc2626,#ef4444)"
                }} />
              </div>
              <p style={{ fontSize: 11, color: "#475569", marginTop: 10, lineHeight: 1.65 }}>{deal.reason}</p>
            </div>
          </div>

          {/* Key metrics */}
          <p style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>Key Metrics</p>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
            {([
              { label: "Monthly Cash Flow", value: fmtSigned(deal.cashflow),      accent: deal.cashflow >= 0 ? "green" : "red" },
              { label: "Annual Cash Flow",  value: fmtSigned(deal.annualCashflow), accent: deal.annualCashflow >= 0 ? "green" : "red" },
              { label: "Cap Rate",          value: deal.capRate.toFixed(2) + "%",  accent: deal.capRate >= 6 ? "green" : deal.capRate < 4 ? "red" : null },
              { label: "CoC Return",        value: deal.coc.toFixed(2) + "%",      accent: deal.coc >= 8 ? "green" : deal.coc < 3 ? "red" : null },
              { label: "DSCR",              value: deal.dscr.toFixed(2),            accent: deal.dscr >= 1.2 ? "green" : deal.dscr < 1 ? "red" : null },
              { label: "Monthly Mortgage",  value: fmt(deal.mortgage),              accent: null },
              { label: "Total Expenses",    value: fmt(deal.totalMonthly),          accent: null },
            ] as { label: string; value: string; accent: string | null }[]).map((row, i, arr) => {
              const color = row.accent === "green" ? "#059669" : row.accent === "red" ? "#dc2626" : "#0f172a";
              return (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: i < arr.length - 1 ? "1px solid #e2e8f0" : "none" }}>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
                </div>
              );
            })}
          </div>

          {/* Property details */}
          <p style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>Property Details</p>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
            {([
              { label: "Purchase Price", value: fmt(deal.price) },
              { label: "Down Payment",   value: fmt(deal.down) + " (" + Math.round(deal.down / deal.price * 100) + "%)" },
              { label: "Interest Rate",  value: deal.rate + "%" },
              { label: "Loan Term",      value: deal.term + " years" },
              { label: "Monthly Rent",   value: deal.rent > 0 ? fmt(deal.rent) : "—" },
            ] as { label: string; value: string }[]).map((row, i, arr) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: i < arr.length - 1 ? "1px solid #e2e8f0" : "none" }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
              </div>
            ))}
          </div>

          {savedDate && (
            <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 16, textAlign: "right" }}>
              Saved {savedDate}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DashboardPage ─────────────────────────────────────────────────────────────
function DashboardPage({ deals, onDelete, onDeleteAll, onAnalyze, user, onOpenLogin }: {
  deals: SavedDeal[];
  onDelete: (id: number) => void;
  onDeleteAll: (ids: number[]) => void;
  onAnalyze: () => void;
  user: AuthUser | null;
  onOpenLogin: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [viewDeal, setViewDeal] = useState<SavedDeal | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  const sorted = [...deals]
    .filter(d => d.address.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sort === "cashflow" ? b.cashflow - a.cashflow :
      sort === "cap" ? b.capRate - a.capRate :
      sort === "coc" ? b.coc - a.coc :
      b.score - a.score
    );

  const allVisibleIds = sorted.map(d => d.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(allVisibleIds));
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function deleteSelected() {
    onDeleteAll([...selected]);
    setSelected(new Set());
    setDeleteAllConfirm(false);
  }

  function confirmDelete(id: number) {
    onDelete(id);
    setDeleteConfirm(null);
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px" }}>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#eff6ff,#f0fdf4)", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 24 }}>
            🏠
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a", marginBottom: 10 }}>
            Log in to see your deals
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7, marginBottom: 32 }}>
            Your saved deals are tied to your account. Log in to view, manage, and compare them.
          </p>
          <button
            onClick={onOpenLogin}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
            style={{
              padding: "13px 36px", border: "none", borderRadius: 12,
              background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
              color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit", transition: "all 0.18s",
              boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
            }}
          >
            Log In →
          </button>
          <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 18 }}>
            No account?{" "}
            <button onClick={onAnalyze} style={{ background: "none", border: "none", color: "#2563eb", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0, fontWeight: 600 }}>
              Analyze a deal first
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", color: "#0f172a" }}>
      {/* Detail modal */}
      {viewDeal && <DealDetailModal deal={viewDeal} onClose={() => setViewDeal(null)} />}

      {/* Compare modal — launched from bulk action bar */}
      {compareOpen && selected.size >= 2 && (
        <CompareModal
          deals={deals.filter(d => selected.has(d.id)).slice(0, 4)}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {/* ── Header — matches Analyzer header style ── */}
      <div style={{ borderBottom: "1px solid #e2e8f0", background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "clamp(16px,2.5vw,28px) clamp(16px,3vw,40px)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", margin: 0, color: "#0f172a" }}>My Deals</h1>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                {deals.length === 0 ? "No saved deals yet" : `${deals.length} saved deal${deals.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              onClick={onAnalyze}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
              style={{
                padding: "10px 22px", border: "none", borderRadius: 10,
                background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.18s", boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
              }}
            >
              + Analyze New Deal
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "clamp(20px,3vw,36px) clamp(16px,3vw,40px)" }}>

        {/* ── Bulk action bar ── */}
        {deals.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 16, padding: "10px 16px",
            background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0",
            borderRadius: 12, flexWrap: "wrap", gap: 10,
          }}>
            {/* Left: select-all + count badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => allSelected ? clearSelection() : selectAll()}
                  style={{ accentColor: "#2563eb", cursor: "pointer", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>
                  {allSelected ? "Deselect All" : "Select All"}
                </span>
              </label>
              {selected.size > 0 && (
                <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", borderRadius: 6, padding: "2px 8px" }}>
                  {selected.size} selected
                </span>
              )}
            </div>

            {/* Right: action buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Compare Selected — primary action, enabled only when ≥2 selected */}
              {selected.size >= 1 && (
                <button
                  onClick={() => { if (selected.size >= 2) setCompareOpen(true); }}
                  disabled={selected.size < 2}
                  title={selected.size < 2 ? "Select at least 2 deals to compare" : `Compare ${selected.size} deals`}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: "7px 16px", borderRadius: 9,
                    border: "none", cursor: selected.size >= 2 ? "pointer" : "not-allowed",
                    fontFamily: "inherit", transition: "all 0.18s",
                    background: selected.size >= 2
                      ? "linear-gradient(135deg,#2563eb,#0ea5e9)"
                      : "#e2e8f0",
                    color: selected.size >= 2 ? "#fff" : "#94a3b8",
                    boxShadow: selected.size >= 2 ? "0 2px 8px rgba(37,99,235,0.25)" : "none",
                  }}
                  onMouseEnter={e => { if (selected.size >= 2) (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                >
                  {selected.size >= 2 ? `Compare ${selected.size} Deals ↗` : "Select 2+ to Compare"}
                </button>
              )}

              {/* Delete selected */}
              {selected.size > 0 && (
                !deleteAllConfirm ? (
                  <button
                    onClick={() => setDeleteAllConfirm(true)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#dc2626"; (e.currentTarget as HTMLElement).style.color = "#dc2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
                    style={{ fontSize: 12, background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, color: "#64748b", padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 500, transition: "all 0.15s" }}
                  >
                    Delete {selected.size}
                  </button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 500 }}>Delete {selected.size} deal{selected.size !== 1 ? "s" : ""}?</span>
                    <button onClick={deleteSelected}
                      style={{ fontSize: 12, background: "#dc2626", border: "none", borderRadius: 8, color: "#fff", padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                      Confirm
                    </button>
                    <button onClick={() => setDeleteAllConfirm(false)}
                      style={{ fontSize: 12, background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, color: "#64748b", padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                      Cancel
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        )}



        {/* ── Search + Sort toolbar ── */}
        {deals.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 24, alignItems: "center", flexWrap: "wrap" }}>
            {/* Search */}
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
              <input
                type="text" placeholder="Search by address…" value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%", background: "#fff", border: "1.5px solid #e2e8f0",
                  borderRadius: 12, color: "#0f172a", fontSize: 13,
                  padding: "11px 14px 11px 36px", outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box",
                  transition: "border-color 0.18s, box-shadow 0.18s",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.12)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; }}
              />
            </div>
            {/* Sort */}
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              style={{
                background: `#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 12px center`,
                border: "1.5px solid #e2e8f0", borderRadius: 12, color: "#475569",
                fontSize: 13, padding: "11px 36px 11px 14px",
                outline: "none", fontFamily: "inherit", cursor: "pointer",
                appearance: "none", WebkitAppearance: "none",
                transition: "border-color 0.18s",
              }}>
              <option value="score">Sort by Score</option>
              <option value="cashflow">Sort by Cash Flow</option>
              <option value="cap">Sort by Cap Rate</option>
              <option value="coc">Sort by CoC Return</option>
            </select>
          </div>
        )}

        {/* ── Empty state ── */}
        {sorted.length === 0 && (
          <div style={{
            background: "rgba(255,255,255,0.7)", border: "1.5px dashed #cbd5e1",
            borderRadius: 20, padding: "72px 32px", textAlign: "center",
          }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>
              {search ? "🔍" : "🏠"}
            </div>
            <p style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em" }}>
              {search ? "No deals match your search" : "No saved deals yet"}
            </p>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 28, lineHeight: 1.6 }}>
              {search ? "Try a different search term." : "Analyze a property, then save it to your dashboard to see it here."}
            </p>
            {!search && (
              <button onClick={onAnalyze}
                style={{
                  padding: "12px 28px", border: "none", borderRadius: 12,
                  background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
                  color: "#fff", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                  boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
                }}>
                Analyze a Deal →
              </button>
            )}
          </div>
        )}

        {/* ── Deal cards grid ── */}
        {sorted.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {sorted.map(d => {
              const sc = d.score >= 70 ? "#059669" : d.score >= 45 ? "#d97706" : "#dc2626";
              const isDeleting = deleteConfirm === d.id;
              const isSelected = selected.has(d.id);
              const savedDate = d.savedAt
                ? new Date(d.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : null;

              return (
                <div key={d.id} style={{
                  background: "rgba(255,255,255,0.92)", display: "flex", flexDirection: "column",
                  border: isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0",
                  borderRadius: 20, overflow: "hidden",
                  boxShadow: isSelected
                    ? "0 0 0 4px rgba(37,99,235,0.12), 0 4px 16px rgba(15,23,42,0.06)"
                    : "0 1px 3px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04)",
                  transition: "box-shadow 0.2s, border-color 0.2s, transform 0.2s",
                }}
                  onMouseEnter={e => { if (!isDeleting) (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; }}
                >
                  {/* Score accent bar */}
                  <div style={{ height: 4, background: sc, flexShrink: 0 }} />

                  {/* Card body */}
                  <div style={{ padding: "20px 22px 16px", flex: 1 }}>
                    {/* Top row: score chip + checkbox */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <ScoreChip label={d.label} />
                      <input
                        type="checkbox"
                        title="Select for comparison or bulk delete"
                        checked={isSelected}
                        onChange={() => toggleSelect(d.id)}
                        style={{ accentColor: "#2563eb", cursor: "pointer", width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
                      />
                    </div>

                    {/* Address hierarchy */}
                    <p style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em", marginBottom: 2, lineHeight: 1.25 }}>
                      {d.address.split(",")[0]}
                    </p>
                    {d.address.includes(",") && (
                      <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
                        {d.address.split(",").slice(1).join(",").trim()}
                      </p>
                    )}
                    <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16, fontVariantNumeric: "tabular-nums" }}>
                      {fmt(d.price)} · {d.rate}% · {d.term}yr
                    </p>

                    {/* 3 metric tiles */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                      {[
                        { label: "Cash Flow", value: fmtSigned(d.cashflow) + "/mo", color: d.cashflow >= 0 ? "#059669" : "#dc2626" },
                        { label: "Cap Rate",  value: d.capRate.toFixed(1) + "%",    color: "#0f172a" },
                        { label: "Score",     value: String(d.score),               color: sc },
                      ].map(m => (
                        <div key={m.label} style={{
                          background: "#f8fafc", borderRadius: 10, padding: "10px 8px",
                          textAlign: "center", border: "1px solid #f1f5f9",
                        }}>
                          <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{m.label}</p>
                          <p style={{ fontSize: 13, fontWeight: 800, color: m.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{m.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Mini income vs expenses chart — only when rent data exists */}
                    {d.effectiveRent > 0 && (
                      <MiniBarChart income={d.effectiveRent} expenses={d.totalMonthly} />
                    )}

                    {savedDate && (
                      <p style={{ fontSize: 10, color: "#94a3b8" }}>Saved {savedDate}</p>
                    )}
                  </div>

                  {/* Card actions footer */}
                  {!isDeleting ? (
                    <div style={{ display: "flex", borderTop: "1px solid #f1f5f9" }}>
                      <button
                        onClick={() => setViewDeal(d)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#eff6ff"; (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
                        style={{
                          flex: 1, padding: "13px 0", background: "transparent", border: "none",
                          borderRight: "1px solid #f1f5f9", fontSize: 12, fontWeight: 700,
                          color: "#0f172a", cursor: "pointer", fontFamily: "inherit",
                          transition: "all 0.15s", letterSpacing: "0.02em",
                        }}
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(d.id)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#fff1f2"; (e.currentTarget as HTMLElement).style.color = "#dc2626"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                        style={{
                          flex: 1, padding: "13px 0", background: "transparent", border: "none",
                          fontSize: 12, fontWeight: 600, color: "#94a3b8",
                          cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div style={{
                      borderTop: "1px solid #fecdd3", padding: "12px 16px",
                      background: "#fff1f2", display: "flex",
                      alignItems: "center", justifyContent: "space-between", gap: 8,
                    }}>
                      <p style={{ fontSize: 12, color: "#dc2626", fontWeight: 500 }}>Delete this deal?</p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          style={{ padding: "5px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 11, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>
                          Cancel
                        </button>
                        <button
                          onClick={() => confirmDelete(d.id)}
                          style={{ padding: "5px 12px", background: "#dc2626", border: "none", borderRadius: 7, fontSize: 11, color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CompareModal — inline modal, launched from My Deals ─────────────────────
type HighlightDir = "higher" | "lower" | "none";

interface CompareRow {
  label: string;
  group: string;
  getValue: (d: SavedDeal) => number;
  render: (d: SavedDeal) => string;
  highlight: HighlightDir;
}

function CompareModal({ deals, onClose }: { deals: SavedDeal[]; onClose: () => void }) {
  const rows: CompareRow[] = [
    { label: "Deal Score",          group: "Returns",  getValue: d => d.score,          render: d => d.score + " / 100",          highlight: "higher" },
    { label: "Monthly Cash Flow",   group: "Returns",  getValue: d => d.cashflow,        render: d => fmtSigned(d.cashflow) + "/mo", highlight: "higher" },
    { label: "Cash-on-Cash Return", group: "Returns",  getValue: d => d.coc,             render: d => d.coc.toFixed(2) + "%",      highlight: "higher" },
    { label: "Cap Rate",            group: "Returns",  getValue: d => d.capRate,         render: d => d.capRate.toFixed(2) + "%",  highlight: "higher" },
    { label: "DSCR",                group: "Returns",  getValue: d => d.dscr,            render: d => d.dscr.toFixed(2),           highlight: "higher" },
    { label: "Annual Cash Flow",    group: "Returns",  getValue: d => d.annualCashflow,  render: d => fmtSigned(d.annualCashflow) + "/yr", highlight: "higher" },
    { label: "Monthly Rent",        group: "Income",   getValue: d => d.rent,            render: d => d.rent > 0 ? fmt(d.rent) : "—", highlight: "higher" },
    { label: "Effective Rent",      group: "Income",   getValue: d => d.effectiveRent,   render: d => fmt(d.effectiveRent),        highlight: "higher" },
    { label: "Vacancy Rate",        group: "Income",   getValue: d => d.vacancy,         render: d => d.vacancy + "%",             highlight: "lower"  },
    { label: "Purchase Price",      group: "Property", getValue: d => d.price,           render: d => fmt(d.price),                highlight: "lower"  },
    { label: "Down Payment",        group: "Property", getValue: d => d.down,            render: d => fmt(d.down),                 highlight: "none"   },
    { label: "Interest Rate",       group: "Property", getValue: d => d.rate,            render: d => d.rate + "%",                highlight: "lower"  },
    { label: "Monthly Mortgage",    group: "Costs",    getValue: d => d.mortgage,        render: d => fmt(d.mortgage),             highlight: "lower"  },
    { label: "Total Expenses",      group: "Costs",    getValue: d => d.totalMonthly,    render: d => fmt(d.totalMonthly),         highlight: "lower"  },
    { label: "State Adjustment",    group: "Market",   getValue: d => d.stateAdj ?? 0,  render: d => (d.stateAdj ?? 0) > 0 ? "+" + (d.stateAdj ?? 0) + " pts" : (d.stateAdj ?? 0) < 0 ? (d.stateAdj ?? 0) + " pts" : "Neutral", highlight: "higher" },
  ];

  const groups = ["Returns", "Income", "Property", "Costs", "Market"];

  function getBestIds(row: CompareRow): Set<number> {
    if (row.highlight === "none" || deals.length < 2) return new Set();
    const vals = deals.map(d => ({ id: d.id, v: row.getValue(d) }));
    const best = row.highlight === "higher"
      ? Math.max(...vals.map(x => x.v))
      : Math.min(...vals.map(x => x.v));
    if (vals.every(x => x.v === best)) return new Set();
    return new Set(vals.filter(x => x.v === best).map(x => x.id));
  }

  const winner    = deals.length >= 2 ? deals.reduce((a, b) => a.score > b.score ? a : b) : null;
  const bestCF    = deals.length >= 2 ? deals.reduce((a, b) => a.cashflow > b.cashflow ? a : b) : null;
  const lowestRisk = deals.length >= 2 ? deals.reduce((a, b) => {
    const riskA = a.score >= 70 ? 0 : a.score >= 45 ? 1 : 2;
    const riskB = b.score >= 70 ? 0 : b.score >= 45 ? 1 : 2;
    return riskA <= riskB ? a : b;
  }) : null;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 400,
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px 24px", overflowY: "auto",
      }}
    >
      {/* Modal panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", width: "100%", maxWidth: 900,
          borderRadius: 24, overflow: "hidden",
          border: "1px solid #e2e8f0",
          boxShadow: "0 24px 64px rgba(15,23,42,0.2)",
          flexShrink: 0,
        }}
      >
        {/* ── Modal header ── */}
        <div style={{
          padding: "20px 28px", borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <div>
            <p style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>
              Comparing {deals.length} Deals
            </p>
            <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a", margin: 0 }}>
              Deal Comparison
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              ● = best in row &nbsp;|&nbsp; Esc to close
            </span>
            <button
              onClick={onClose}
              style={{ background: "#f1f5f9", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 16, color: "#64748b", padding: "7px 11px", transition: "all 0.15s", fontFamily: "inherit", lineHeight: 1 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#e2e8f0"; (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
            >×</button>
          </div>
        </div>

        {/* ── Deal header cards ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `160px repeat(${deals.length}, 1fr)`,
          gap: 0, padding: "20px 24px 0",
          background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
        }}>
          {/* empty label column header */}
          <div />
          {deals.map(d => {
            const sc = d.score >= 70 ? "#059669" : d.score >= 45 ? "#d97706" : "#dc2626";
            const isWinner  = winner?.id  === d.id;
            const isBestCF  = bestCF?.id  === d.id;
            const isLowest  = lowestRisk?.id === d.id;
            // build tags
            const tags: { label: string; color: string; bg: string }[] = [];
            if (isWinner)  tags.push({ label: "Highest Score",   color: "#059669", bg: "#f0fdf4" });
            if (isBestCF && !isWinner) tags.push({ label: "Best Cash Flow", color: "#2563eb", bg: "#eff6ff" });
            if (isLowest && !isWinner) tags.push({ label: "Lowest Risk",    color: "#7c3aed", bg: "#f5f3ff" });

            return (
              <div key={d.id} style={{
                padding: "0 12px 20px",
                borderLeft: "1px solid #e2e8f0",
                position: "relative",
              }}>
                {/* Colored top accent */}
                <div style={{ height: 3, background: sc, borderRadius: "0 0 3px 3px", marginBottom: 12, marginLeft: -12, marginRight: -12 }} />

                {/* Tags */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8, minHeight: 22 }}>
                  {tags.map(t => (
                    <span key={t.label} style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
                      textTransform: "uppercase", color: t.color, background: t.bg,
                      border: `1px solid ${t.color}30`, borderRadius: 6, padding: "2px 7px",
                    }}>{t.label}</span>
                  ))}
                </div>

                <p style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 2, lineHeight: 1.2 }}>
                  {d.address.split(",")[0]}
                </p>
                {d.address.includes(",") && (
                  <p style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>
                    {d.address.split(",").slice(1).join(",").trim()}
                  </p>
                )}
                {/* Score mini meter */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: sc, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.04em" }}>
                    {d.score}
                  </span>
                  <div style={{ flex: 1, height: 4, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 999, width: d.score + "%",
                      background: d.score >= 70 ? "linear-gradient(90deg,#059669,#10b981)" : d.score >= 45 ? "linear-gradient(90deg,#d97706,#f59e0b)" : "linear-gradient(90deg,#dc2626,#ef4444)"
                    }} />
                  </div>
                </div>
                <p style={{ fontSize: 10, color: sc, fontWeight: 700 }}>{d.label}</p>
              </div>
            );
          })}
        </div>

        {/* ── Comparison table ── */}
        <div style={{ overflowX: "auto", padding: "0 24px 24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 480 }}>
            <colgroup>
              <col style={{ width: 160 }} />
              {deals.map(d => <col key={d.id} />)}
            </colgroup>
            <tbody>
              {groups.map(group => {
                const groupRows = rows.filter(r => r.group === group);
                if (groupRows.length === 0) return null;
                return (
                  <Fragment key={group}>
                    <tr>
                      <td colSpan={deals.length + 1} style={{ padding: "16px 0 6px" }}>
                        <span style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
                          {group}
                        </span>
                      </td>
                    </tr>
                    {groupRows.map((row, ri) => {
                      const bestIds = getBestIds(row);
                      const isLast = ri === groupRows.length - 1;
                      return (
                        <tr key={row.label}
                          style={{ borderBottom: isLast ? "2px solid #f1f5f9" : "1px solid #f8fafc", transition: "background 0.1s" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <td style={{ padding: "11px 12px 11px 0", fontSize: 11, color: "#64748b", fontWeight: 500 }}>
                            {row.label}
                          </td>
                          {deals.map(d => {
                            const isBest = bestIds.has(d.id);
                            const val = row.getValue(d);
                            let textColor = "#0f172a";
                            if (isBest) textColor = "#059669";
                            else if (row.label.includes("Cash Flow") && val < 0) textColor = "#dc2626";
                            else if (row.label === "DSCR" && val < 1) textColor = "#dc2626";
                            else if (row.label === "State Adjustment") textColor = val > 0 ? "#059669" : val < 0 ? "#dc2626" : "#94a3b8";
                            return (
                              <td key={d.id} style={{ padding: "11px 0 11px 16px", borderLeft: "1px solid #f1f5f9" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  {isBest && (
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#059669", flexShrink: 0 }} />
                                  )}
                                  <span style={{
                                    fontSize: 13, fontWeight: isBest ? 800 : 500,
                                    color: textColor, fontVariantNumeric: "tabular-nums",
                                  }}>
                                    {row.render(d)}
                                  </span>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "14px 24px", borderTop: "1px solid #f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#f8fafc",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#059669", display: "inline-block" }} />
              Best value in row
            </span>
            <span style={{ fontSize: 10, color: "#cbd5e1" }}>·</span>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>Green = higher is better · Cost metrics: lower is better</span>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px 20px", border: "1px solid #e2e8f0", borderRadius: 9,
              background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#94a3b8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LearnPage — product deep dive: inputs, math, score, outputs ──────────────
function LearnPage({ onAnalyze, onNavigate }: { onAnalyze: () => void; onNavigate: (p: Page) => void }) {

  // Shared section header style
  const eyebrow = (label: string, color = "#94a3b8"): React.CSSProperties => ({
    fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
    color, fontWeight: 800, marginBottom: 12, display: "block",
  });
  const sectionH2: React.CSSProperties = {
    fontSize: "clamp(22px,2.8vw,34px)", fontWeight: 800,
    letterSpacing: "-0.035em", color: "#0f172a", lineHeight: 1.15, margin: "0 0 14px",
  };
  const prose: React.CSSProperties = {
    fontSize: 14, color: "#475569", lineHeight: 1.8, margin: 0,
  };
  // Divider between major sections
  const HR = () => (
    <div style={{ maxWidth: 860, margin: "0 auto clamp(40px,5vw,64px)", padding: "0 clamp(16px,4vw,40px)" }}>
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, #e2e8f0 20%, #e2e8f0 80%, transparent)" }} />
    </div>
  );

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", color: "#0f172a" }}>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(52px,7vw,96px) clamp(16px,4vw,40px) clamp(36px,5vw,56px)", textAlign: "center" }}>
        <FadeIn>
          <span style={eyebrow("Understanding Dealistic")}>Understanding Dealistic</span>
          <h1 style={{ fontSize: "clamp(28px,4.2vw,50px)", fontWeight: 800, letterSpacing: "-0.04em", color: "#0f172a", lineHeight: 1.12, margin: "0 auto 20px", maxWidth: 580 }}>
            How Dealistic evaluates a deal.
          </h1>
          <p style={{ ...prose, maxWidth: 520, margin: "0 auto", fontSize: 15, lineHeight: 1.75 }}>
            A deeper look at the inputs, calculations, and logic that turn raw property numbers into a clear investment verdict.
          </p>
        </FadeIn>
        {/* Page-level nav dots */}
        <FadeIn delay={0.1}>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 36, flexWrap: "wrap" }}>
            {[["A", "Inputs", "#2563eb"], ["B", "Calculations", "#7c3aed"], ["C", "Score", "#059669"], ["D", "Outputs", "#ea580c"]].map(([letter, label, color]) => (
              <div key={letter} style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0",
                borderRadius: 999, padding: "6px 14px 6px 8px",
                fontSize: 12, color: "#475569", fontWeight: 500,
              }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: color + "18", border: `1.5px solid ${color}50`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color }}>
                  {letter}
                </span>
                {label}
              </div>
            ))}
          </div>
        </FadeIn>
      </section>

      {/* ── A · INPUTS ────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(40px,5vw,64px)" }}>
        <FadeIn>
          <span style={eyebrow("A · Inputs", "#2563eb")}>A · Inputs</span>
          <h2 style={sectionH2}>What Dealistic needs from you.</h2>
          <p style={{ ...prose, maxWidth: 620, marginBottom: 32 }}>
            Dealistic works with whatever you have. Enter property details manually or upload a CSV to analyze multiple deals at once. The only truly required field is a purchase price — everything else falls back to a smart default based on market norms.
          </p>
        </FadeIn>

        {/* Input groups — 3 col desktop, 2 col tablet, 1 col mobile */}
        <style>{`
          .learn-inputs-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 14px;
            align-items: start;
          }
          @media (max-width: 860px) {
            .learn-inputs-grid { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 540px) {
            .learn-inputs-grid { grid-template-columns: 1fr; }
          }
        `}</style>
        <div className="learn-inputs-grid">
          {([
            {
              group: "Financing",
              color: "#2563eb",
              fields: [
                { name: "Purchase Price", note: "Required. The agreed or listed sale price." },
                { name: "Down Payment",   note: "Defaults to 20% — typical for investment properties." },
                { name: "Interest Rate",  note: "Your mortgage rate. Check Bankrate.com for current rates." },
                { name: "Loan Term",      note: "Defaults to 30 years. 15-year increases payments but reduces interest." },
              ],
            },
            {
              group: "Income",
              color: "#059669",
              fields: [
                { name: "Monthly Rent",  note: "Expected gross rent. Leave blank to see cost-only estimates." },
                { name: "Vacancy Rate",  note: "Defaults to 5% (~3 weeks empty per year). Adjust for your market." },
              ],
            },
            {
              group: "Expenses",
              color: "#ea580c",
              fields: [
                { name: "Property Taxes", note: "Monthly. Check your county assessor. Defaults ~1.2% of price/yr." },
                { name: "Insurance",      note: "Landlord insurance. Defaults ~0.65% of price/yr if blank." },
                { name: "HOA Fees",       note: "Enter 0 if none. Check the MLS listing." },
                { name: "Repairs",        note: "Defaults to 5% of monthly rent — a common rule of thumb." },
                { name: "Management",     note: "Self-managing? Enter 0. Managers typically charge 8–10% of rent." },
              ],
            },
          ] as { group: string; color: string; fields: { name: string; note: string }[] }[]).map((g, gi) => (
            <FadeIn key={gi} delay={gi * 0.06}>
              <div style={{
                background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0",
                borderRadius: 16, overflow: "hidden", height: "100%",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", letterSpacing: "0.02em" }}>{g.group}</span>
                </div>
                <div style={{ padding: "2px 0", flex: 1 }}>
                  {g.fields.map((f, fi) => (
                    <div key={fi} style={{ padding: "10px 16px", borderBottom: fi < g.fields.length - 1 ? "1px solid #f8fafc" : "none" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>{f.name}</p>
                      <p style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5, margin: 0 }}>{f.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Start Your Analysis — single centered card */}
        <FadeIn delay={0.2}>
          <div style={{
            marginTop: 28,
            background: "rgba(255,255,255,0.85)",
            border: "1px solid #e2e8f0",
            borderRadius: 20,
            padding: "32px 36px",
            backdropFilter: "blur(8px)",
            textAlign: "center",
          }}>
            <p style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em", marginBottom: 8 }}>
              Start Your Analysis
            </p>
            <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.65, margin: "0 auto", maxWidth: 400 }}>
              Enter your deal details below. Manual entry and CSV upload are both supported — smart defaults handle the rest.
            </p>
          </div>
        </FadeIn>
      </section>

      <HR />

      {/* ── B · CALCULATIONS ──────────────────────────────────────────────── */}
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(40px,5vw,64px)" }}>
        <FadeIn>
          <span style={eyebrow("B · Calculations", "#7c3aed")}>B · Calculations</span>
          <h2 style={sectionH2}>How every number is computed.</h2>
          <p style={{ ...prose, maxWidth: 620, marginBottom: 36 }}>
            Every metric is calculated in real time as you type. There are no estimates or averages — each number is derived directly from your inputs using standard real estate formulas. Here's what's happening under the hood.
          </p>
        </FadeIn>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {([
            {
              metric: "Monthly Cash Flow",
              color: "#059669",
              formula: "Effective Rent − (Mortgage + Taxes + Insurance + HOA + Repairs + Management + Other)",
              what: "The money left over each month after every expense is paid. This is the most direct measure of whether a rental generates income or costs you money.",
              good: "Most investors target > $200/mo per property. Negative cash flow means you're subsidizing the property out of pocket.",
              visual: <StepVisual02 />,
            },
            {
              metric: "Cap Rate",
              color: "#2563eb",
              formula: "Net Operating Income ÷ Purchase Price × 100",
              what: "NOI is annual rent minus annual operating expenses — excluding mortgage. Cap rate tells you what return you'd earn if you bought the property all-cash. It's a property-level metric, not affected by your financing.",
              good: "6%+ is considered solid. Below 4% usually means you're relying on appreciation rather than income.",
              visual: null,
            },
            {
              metric: "Cash-on-Cash Return (CoC)",
              color: "#7c3aed",
              formula: "Annual Cash Flow ÷ Total Cash Invested × 100",
              what: "This measures the actual return on your out-of-pocket investment — the down payment plus any upfront costs. Unlike cap rate, CoC accounts for your financing, so it reflects your real leverage.",
              good: "8% or higher is the commonly cited benchmark. If your CoC is low despite a decent cap rate, your financing terms may be the issue.",
              visual: null,
            },
            {
              metric: "DSCR — Debt Service Coverage Ratio",
              color: "#ea580c",
              formula: "Effective Rent ÷ Total Monthly Debt Service",
              what: "DSCR answers: does the property's income cover the mortgage payment and expenses? A DSCR of 1.0 means rent exactly covers costs. Below 1.0 means it doesn't. Lenders typically require 1.2–1.25 for DSCR loans.",
              good: "1.25+ is healthy. 1.0–1.25 is breakeven. Below 1.0 is negative carry — high risk.",
              visual: null,
            },
          ] as { metric: string; color: string; formula: string; what: string; good: string; visual: React.ReactNode | null }[]).map((item, i) => (
            <FadeIn key={i} delay={i * 0.05}>
              <div style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
                {/* Header */}
                <div style={{ padding: "16px 22px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" }}>{item.metric}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: item.visual ? "1fr auto" : "1fr", gap: 0 }}>
                  <div style={{ padding: "18px 22px" }}>
                    {/* Formula pill */}
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", marginBottom: 14, display: "inline-block" }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "#475569" }}>{item.formula}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.72, marginBottom: 10 }}>{item.what}</p>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, flexShrink: 0, marginTop: 4 }} />
                      <p style={{ fontSize: 12, color: item.color, fontWeight: 600, lineHeight: 1.55, margin: 0 }}>{item.good}</p>
                    </div>
                  </div>
                  {item.visual && (
                    <div style={{ width: 240, flexShrink: 0, borderLeft: "1px solid #f1f5f9", padding: "18px 18px", background: "linear-gradient(160deg,#f0f4ff,#e8f5ef)", display: "flex", alignItems: "center" }}>
                      {item.visual}
                    </div>
                  )}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      <HR />

      {/* ── C · DEALISTIC SCORE ───────────────────────────────────────────── */}
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(40px,5vw,64px)" }}>
        <FadeIn>
          <span style={eyebrow("C · The Dealistic Score", "#059669")}>C · The Dealistic Score</span>
          <h2 style={sectionH2}>One number that summarizes the whole deal.</h2>
          <p style={{ ...prose, maxWidth: 620, marginBottom: 32 }}>
            The Dealistic Score is a composite 1–100 rating calculated from a deal's core financial metrics. It's designed to give you an at-a-glance signal — not a replacement for judgment, but a fast way to compare and prioritize.
          </p>
        </FadeIn>

        {/* Score drivers table */}
        <FadeIn delay={0.06}>
          <div style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "14px 22px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a" }}>What moves the score</span>
            </div>
            {([
              { driver: "Cash-on-Cash Return",  weight: "Primary",   up: "> 10% CoC",   dn: "< 0% CoC",    pts: "±20 pts" },
              { driver: "Cap Rate",             weight: "Primary",   up: "> 8% cap",    dn: "< 3% cap",    pts: "±15 pts" },
              { driver: "DSCR",                 weight: "Primary",   up: "> 1.4×",      dn: "< 1.0×",      pts: "±15 pts" },
              { driver: "Monthly Cash Flow",    weight: "Secondary", up: "> $300/mo",   dn: "< $0/mo",     pts: "±10 pts" },
              { driver: "State Market Factors", weight: "Modifier",  up: "Landlord-friendly, low tax", dn: "Tenant laws, high insurance", pts: "±8 pts" },
            ] as { driver: string; weight: string; up: string; dn: string; pts: string }[]).map((row, i, arr) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 1fr 72px", gap: 0, padding: "12px 22px", borderBottom: i < arr.length - 1 ? "1px solid #f8fafc" : "none", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{row.driver}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>{row.weight}</span>
                <span style={{ fontSize: 11, color: "#059669" }}>↑ {row.up}</span>
                <span style={{ fontSize: 11, color: "#dc2626" }}>↓ {row.dn}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", textAlign: "right" }}>{row.pts}</span>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* Score tiers */}
        <FadeIn delay={0.1}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {([
              { range: "70 – 100", label: "Great Deal", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0", desc: "Strong cash flow, solid cap rate, healthy DSCR. Worth serious consideration." },
              { range: "45 – 69",  label: "Average",    color: "#d97706", bg: "#fffbeb", border: "#fde68a", desc: "Meets some thresholds but not all. May work depending on your goals and market." },
              { range: "1 – 44",   label: "Risky",      color: "#dc2626", bg: "#fff1f2", border: "#fecdd3", desc: "Weak financials. Negative cash flow, low cap rate, or poor DSCR. Proceed cautiously." },
            ] as { range: string; label: string; color: string; bg: string; border: string; desc: string }[]).map((tier, i) => (
              <div key={i} style={{ background: tier.bg, border: `1px solid ${tier.border}`, borderRadius: 14, padding: "18px 18px 16px" }}>
                <p style={{ fontSize: 22, fontWeight: 900, color: tier.color, letterSpacing: "-0.04em", margin: "0 0 4px" }}>{tier.range}</p>
                <p style={{ fontSize: 12, fontWeight: 800, color: tier.color, margin: "0 0 10px", letterSpacing: "0.02em" }}>{tier.label}</p>
                <p style={{ fontSize: 11, color: "#475569", lineHeight: 1.6, margin: 0 }}>{tier.desc}</p>
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.14}>
          <div style={{ marginTop: 20, padding: "16px 20px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12 }}>
            <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, margin: 0 }}>
              <strong style={{ color: "#0f172a" }}>State adjustment:</strong> If you select a U.S. state, Dealistic applies a market modifier of ±8 points based on property tax burden, insurance risk, landlord law friendliness, climate risk, and rental demand — weighted and combined into a single state-level adjustment layered on top of the financial base score.
            </p>
          </div>
        </FadeIn>
      </section>

      <HR />

      {/* ── D · OUTPUTS & DECISION VALUE ──────────────────────────────────── */}
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(40px,5vw,64px)" }}>
        <FadeIn>
          <span style={eyebrow("D · Outputs", "#ea580c")}>D · Outputs</span>
          <h2 style={sectionH2}>What you actually learn from an analysis.</h2>
          <p style={{ ...prose, maxWidth: 620, marginBottom: 32 }}>
            The results panel is organized to answer three questions in order: <em>Is this deal profitable?</em> — <em>What are the biggest risks?</em> — <em>How can the numbers improve?</em>
          </p>
        </FadeIn>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {([
            {
              label: "Key Metrics Dashboard",
              color: "#ea580c",
              items: [
                "Monthly and annual cash flow after all expenses",
                "Cap rate, CoC return, DSCR — each with a benchmark label (excellent / average / below target)",
                "Score breakdown: base financial score + state adjustment + final score",
              ],
            },
            {
              label: "AI Investment Insight",
              color: "#2563eb",
              items: [
                "A 3–4 sentence narrative synthesizing cash flow, DSCR, leverage, and rent-to-price ratio",
                "Calls out specific numbers — not generic advice",
                "Includes a state clause when a state is selected",
              ],
            },
            {
              label: "Score Drivers",
              color: "#7c3aed",
              items: [
                "Shows which 3–5 factors are most responsible for the score — positive or negative",
                "Each driver shows the point impact (e.g. +20 pts for CoC > 10%)",
                "Sorted by absolute impact so the most important factors surface first",
              ],
            },
            {
              label: "Optimization Suggestions",
              color: "#059669",
              items: [
                "3 concrete changes that would raise the score — with specific numbers",
                "Examples: raise rent 10%, negotiate price down 5%, adjust down payment",
                "Each suggestion shows the expected point improvement",
              ],
            },
            {
              label: "Monthly Breakdown",
              color: "#ea580c",
              items: [
                "Line-by-line: gross rent → vacancy loss → effective rent",
                "Line-by-line: mortgage → taxes → insurance → repairs → management → other → total",
                "Net cash flow per month — color-coded green or red",
              ],
            },
          ] as { label: string; color: string; items: string[] }[]).map((block, i) => (
            <FadeIn key={i} delay={i * 0.05}>
              <div style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 22px", display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: block.color, flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 10, letterSpacing: "-0.01em" }}>{block.label}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {block.items.map((item, j) => (
                      <p key={j} style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.6, margin: 0, paddingLeft: 12, borderLeft: `2px solid ${block.color}30` }}>
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      <HR />

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(52px,7vw,88px)" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <h2 style={{ fontSize: "clamp(22px,3vw,36px)", fontWeight: 800, letterSpacing: "-0.04em", color: "#0f172a", margin: "0 0 12px" }}>
              See it in action.
            </h2>
            <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7, margin: "0 0 24px" }}>
              The best way to understand Dealistic is to run a real deal through it. It takes about 30 seconds.
            </p>
            <button
              onClick={onAnalyze}
              style={{
                padding: "14px 36px", border: "none", borderRadius: 999,
                background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
                color: "#fff", fontSize: 15, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                transition: "transform 0.18s, box-shadow 0.18s",
                boxShadow: "0 4px 16px rgba(37,99,235,0.3)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(37,99,235,0.38)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(37,99,235,0.3)"; }}
            >
              Analyze a Deal →
            </button>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 12 }}>Free to use. No account required.</p>
          </div>
        </FadeIn>
      </section>

      <SiteFooter onNavigate={onNavigate} />
    </div>
  );
}

// ─── PrivacyPage ─────────────────────────────────────────────────────────────
function PrivacyPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const CONTACT_EMAIL = "dealistic.app@gmail.com";
  const sections: { id: string; title: string; body: React.ReactNode }[] = [
    {
      id: "intro", title: "Introduction",
      body: <>
        <p>Dealistic is a real estate deal analysis tool built to help investors and home buyers make faster, smarter decisions. This policy explains how we handle your data — written clearly, without legal jargon.</p>
        <p>By using Dealistic you agree to the practices described here.</p>
      </>,
    },
    {
      id: "collect", title: "Information We Collect",
      body: <>
        <p>We collect only what's needed to make the product work:</p>
        <ul>
          <li><strong>Account info</strong> — your name and email address when you create an account.</li>
          <li><strong>Property data you enter</strong> — purchase prices, rental income, expenses, and deal details you input manually or via CSV upload. This data belongs to you.</li>
          <li><strong>Usage data</strong> — general interaction patterns (pages visited, features used) to improve the product. Not linked to specific property analyses.</li>
          <li><strong>Browser storage</strong> — we use <code>localStorage</code> to save your session and deals locally in your browser.</li>
        </ul>
        <p>We do not collect payment information — Dealistic is free to use.</p>
      </>,
    },
    {
      id: "use", title: "How We Use Your Information",
      body: <>
        <p>Your information is used to authenticate your account, save and display your deal history, run calculations, and send only transactional emails (no promotional emails without your opt-in).</p>
        <p><strong>We do not sell your data.</strong> We do not use your property data to train models or share it with advertisers.</p>
      </>,
    },
    {
      id: "storage", title: "Data Storage",
      body: <>
        <p>Deal data entered into the analyzer is stored primarily in your browser via <code>localStorage</code> — it lives on your device and is not transmitted to our servers unless you explicitly save it to your account.</p>
        <p>When you create an account and save deals, that data is stored securely in our database and associated with your email. You can delete your account and all associated data at any time.</p>
      </>,
    },
    {
      id: "third-party", title: "Third-Party Services",
      body: <>
        <p>Dealistic uses a small number of third-party services:</p>
        <ul>
          <li><strong>Rentometer</strong> — opening Rentometer opens their site directly in your browser. We don't share your data with them.</li>
          
          <li><strong>Analytics</strong> — lightweight, privacy-respecting analytics for general usage patterns only.</li>
        </ul>
        <p>We do not embed advertising networks, social media trackers, or data brokers.</p>
      </>,
    },
    {
      id: "security", title: "Security",
      body: <>
        <p>We protect your information with encrypted connections (HTTPS), hashed password storage, and access controls. No system is perfectly secure — use a strong, unique password and log out of shared devices.</p>
        <p>If you believe your account has been compromised, contact us immediately.</p>
      </>,
    },
    {
      id: "rights", title: "Your Rights",
      body: <>
        <p>You have the right to access, correct, or delete your data at any time. You can also export your saved deals from your dashboard. To exercise any of these rights, email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>{CONTACT_EMAIL}</a>.</p>
      </>,
    },
    {
      id: "contact-section", title: "Contact",
      body: <>
        <p>Questions or concerns about this policy? Reach out:</p>
        <p style={{ marginTop: 8 }}>
          <strong>Email:</strong>{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>{CONTACT_EMAIL}</a>
        </p>
        <p>We aim to respond to all privacy-related inquiries within 5 business days.</p>
      </>,
    },
  ];

  const pStyle: React.CSSProperties = { fontSize: 14, color: "#334155", lineHeight: 1.8, margin: "0 0 12px" };
  const ulStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: "8px 0 14px", display: "flex", flexDirection: "column", gap: 9 };
  const liStyle: React.CSSProperties = { fontSize: 14, color: "#334155", lineHeight: 1.72, paddingLeft: 16, position: "relative" };

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      {/* Back bar */}
      <div style={{ borderBottom: "1px solid #e2e8f0", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 clamp(16px,4vw,40px)", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => onNavigate("landing")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em", transition: "color 0.18s", padding: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}>
            Dealistic
          </button>
          <button onClick={() => onNavigate("landing")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#64748b", padding: 0, transition: "color 0.18s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#64748b"; }}>
            ← Back
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(40px,6vw,72px) clamp(16px,4vw,40px) clamp(48px,7vw,80px)" }}>
        {/* Header */}
        <div style={{ marginBottom: 52, paddingBottom: 32, borderBottom: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#94a3b8", fontWeight: 700, display: "block", marginBottom: 14 }}>Legal</span>
          <h1 style={{ fontSize: "clamp(30px,5vw,48px)", fontWeight: 900, letterSpacing: "-0.045em", color: "#0f172a", lineHeight: 1.06, margin: "0 0 14px" }}>Privacy Policy</h1>
          <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: 0 }}>
            How Dealistic handles your data — written clearly, without the legalese.
            <br /><span style={{ color: "#94a3b8", fontSize: 13 }}>Last updated: April 15, 2026</span>
          </p>
        </div>

        {/* Sections */}
        {sections.map((s, i) => (
          <div key={s.id} id={s.id} style={{ padding: "32px 0", borderBottom: i < sections.length - 1 ? "1px solid #f1f5f9" : "none" }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 4, height: 16, background: "linear-gradient(180deg,#2563eb,#0ea5e9)", borderRadius: 99, flexShrink: 0, display: "inline-block" }} />
              {s.title}
            </h2>
            <div style={{ color: "#334155" }}>
              <style>{`
                #${s.id} p { ${Object.entries(pStyle).map(([k,v]) => `${k.replace(/([A-Z])/g,'-$1').toLowerCase()}:${v}`).join(';')} }
                #${s.id} ul { ${Object.entries(ulStyle).map(([k,v]) => `${k.replace(/([A-Z])/g,'-$1').toLowerCase()}:${v}`).join(';')} }
                #${s.id} li { ${Object.entries(liStyle).map(([k,v]) => `${k.replace(/([A-Z])/g,'-$1').toLowerCase()}:${v}`).join(';')} }
                #${s.id} li::before { content:''; position:absolute; left:0; top:9px; width:5px; height:5px; border-radius:50%; background:#94a3b8; }
                #${s.id} code { font-family:monospace; font-size:12px; background:#f1f5f9; border:1px solid #e2e8f0; color:#475569; padding:1px 6px; border-radius:5px; }
                #${s.id} strong { color:#0f172a; font-weight:700; }
              `}</style>
              {s.body}
            </div>
          </div>
        ))}
      </div>
      <SiteFooter onNavigate={onNavigate} />
    </div>
  );
}

// ─── ContactPage ──────────────────────────────────────────────────────────────
function ContactPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const CONTACT_EMAIL = "dealistic.app@gmail.com";
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) return;
    // mailto fallback — opens the user's mail client with pre-filled content
    const subject = encodeURIComponent(`Dealistic Contact: ${form.name}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}${form.phone ? `\nPhone: ${form.phone}` : ""}\n\n${form.message}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  const inputStyle = (field: string): React.CSSProperties => ({
    width: "100%", boxSizing: "border-box",
    padding: "12px 14px",
    background: "#fff",
    border: `1.5px solid ${focused === field ? "#2563eb" : "#e2e8f0"}`,
    borderRadius: 12,
    fontSize: 14, color: "#0f172a", fontFamily: "inherit",
    outline: "none",
    boxShadow: focused === field ? "0 0 0 3px rgba(37,99,235,0.12)" : "0 1px 3px rgba(15,23,42,0.04)",
    transition: "border-color 0.18s, box-shadow 0.18s",
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: "#374151",
    display: "block", marginBottom: 6, letterSpacing: "0.01em",
  };

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      {/* Back bar */}
      <div style={{ borderBottom: "1px solid #e2e8f0", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 clamp(16px,4vw,40px)", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => onNavigate("landing")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em", transition: "color 0.18s", padding: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}>
            Dealistic
          </button>
          <button onClick={() => onNavigate("landing")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#64748b", padding: 0, transition: "color 0.18s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#64748b"; }}>
            ← Back
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "clamp(40px,6vw,72px) clamp(16px,4vw,40px) clamp(48px,7vw,80px)" }}>

        {/* Page header */}
        <div style={{ marginBottom: 44, textAlign: "center" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#94a3b8", fontWeight: 700, display: "block", marginBottom: 14 }}>Get in touch</span>
          <h1 style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 900, letterSpacing: "-0.045em", color: "#0f172a", lineHeight: 1.1, margin: "0 0 14px" }}>
            Contact Dealistic
          </h1>
          <p style={{ fontSize: 15, color: "#64748b", lineHeight: 1.7, margin: "0 auto", maxWidth: 420 }}>
            Have a question, found a bug, or want to suggest a feature? We'd love to hear from you.
          </p>
        </div>

        {submitted ? (
          /* ── Success state ── */
          <div style={{ background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0", borderRadius: 24, padding: "52px 40px", textAlign: "center", boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1.5px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24 }}>
              ✓
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", marginBottom: 10 }}>Message sent!</h2>
            <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7, marginBottom: 28 }}>
              Your mail app should have opened with the message pre-filled. We'll reply to <strong style={{ color: "#0f172a" }}>{form.email}</strong> as soon as possible.
            </p>
            <button
              onClick={() => { setSubmitted(false); setForm({ name: "", email: "", phone: "", message: "" }); }}
              style={{ padding: "10px 24px", border: "1.5px solid #e2e8f0", borderRadius: 10, background: "#fff", color: "#475569", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2563eb"; (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLElement).style.color = "#475569"; }}
            >
              Send another message
            </button>
          </div>
        ) : (
          /* ── Form card ── */
          <div style={{ background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0", borderRadius: 24, padding: "clamp(28px,4vw,44px)", boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

              {/* Name + Email row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 16 }}>
                <div>
                  <label style={labelStyle}>Name <span style={{ color: "#dc2626" }}>*</span></label>
                  <input
                    type="text" placeholder="Your name"
                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    onFocus={() => setFocused("name")} onBlur={() => setFocused(null)}
                    style={inputStyle("name")}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Email <span style={{ color: "#dc2626" }}>*</span></label>
                  <input
                    type="email" placeholder="your@email.com"
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    onFocus={() => setFocused("email")} onBlur={() => setFocused(null)}
                    style={inputStyle("email")}
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label style={labelStyle}>
                  Phone <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>(optional)</span>
                </label>
                <input
                  type="tel" placeholder="+1 (555) 000-0000"
                  value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  onFocus={() => setFocused("phone")} onBlur={() => setFocused(null)}
                  style={inputStyle("phone")}
                />
              </div>

              {/* Message */}
              <div>
                <label style={labelStyle}>Message <span style={{ color: "#dc2626" }}>*</span></label>
                <textarea
                  placeholder="Tell us what's on your mind — feedback, questions, feature requests, or bug reports are all welcome."
                  rows={5}
                  value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  onFocus={() => setFocused("message")} onBlur={() => setFocused(null)}
                  style={{ ...inputStyle("message"), resize: "vertical", minHeight: 120 } as React.CSSProperties}
                />
              </div>

              {/* Submit */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>
                  Or email directly:{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>
                    {CONTACT_EMAIL}
                  </a>
                </p>
                <button
                  onClick={handleSubmit}
                  disabled={!form.name.trim() || !form.email.trim() || !form.message.trim()}
                  style={{
                    padding: "13px 32px", border: "none", borderRadius: 12,
                    background: (!form.name.trim() || !form.email.trim() || !form.message.trim())
                      ? "#e2e8f0"
                      : "linear-gradient(135deg,#2563eb,#0ea5e9)",
                    color: (!form.name.trim() || !form.email.trim() || !form.message.trim()) ? "#94a3b8" : "#fff",
                    fontSize: 14, fontWeight: 700, cursor: (!form.name.trim() || !form.email.trim() || !form.message.trim()) ? "not-allowed" : "pointer",
                    fontFamily: "inherit", transition: "all 0.18s",
                    boxShadow: (!form.name.trim() || !form.email.trim() || !form.message.trim()) ? "none" : "0 4px 14px rgba(37,99,235,0.28)",
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => { if (form.name.trim() && form.email.trim() && form.message.trim()) { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(37,99,235,0.36)"; } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = form.name.trim() && form.email.trim() && form.message.trim() ? "0 4px 14px rgba(37,99,235,0.28)" : "none"; }}
                >
                  Send Message →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trust note */}
        <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", marginTop: 24, lineHeight: 1.6 }}>
          We typically respond within 1–2 business days. Your message goes directly to the founder.
        </p>
      </div>
      <SiteFooter onNavigate={onNavigate} />
    </div>
  );
}

// ─── Auth Pages ───────────────────────────────────────────────────────────────

// Shared field for auth forms
// ─── Shared auth primitives ───────────────────────────────────────────────────
function AuthField({
  label, type, value, onChange, error, placeholder, hint,
}: {
  label: string; type: string; value: string; placeholder: string;
  onChange: (v: string) => void; error?: string; hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", letterSpacing: "0.01em" }}>
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "#fff",
          border: `1.5px solid ${error ? "#dc2626" : focused ? "#2563eb" : "#e2e8f0"}`,
          borderRadius: 10, color: "#0f172a", fontSize: 14,
          padding: "10px 14px", outline: "none", fontFamily: "inherit",
          boxShadow: focused ? `0 0 0 3px ${error ? "rgba(220,38,38,0.12)" : "rgba(37,99,235,0.12)"}` : "none",
          transition: "border-color 0.18s, box-shadow 0.18s",
        }}
      />
      {error && <p style={{ fontSize: 11, color: "#dc2626", margin: 0 }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>{hint}</p>}
    </div>
  );
}


// Shared card wrapper
function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#f8fafc", minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "clamp(24px,6vw,80px) 16px",
    }}>
      {/* Brand */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.03em", color: "#0f172a" }}>
          Dealistic
        </span>
      </div>
      {/* Card */}
      <div style={{
        width: "100%", maxWidth: 400,
        background: "#fff", borderRadius: 20,
        border: "1px solid #e2e8f0",
        padding: "clamp(24px,5vw,36px) clamp(20px,5vw,36px)",
        boxShadow: "0 4px 24px rgba(15,23,42,0.07), 0 1px 4px rgba(15,23,42,0.04)",
      }}>
        {children}
      </div>
    </div>
  );
}

// ─── Auth — backed by Supabase ────────────────────────────────────────────────
// Standalone login/signup pages live in:
//   app/login/page.tsx   — calls signIn() Server Action
//   app/signup/page.tsx  — calls signUp() Server Action
//   app/auth/actions.ts  — Server Actions (real Supabase calls)
//   middleware.ts        — session refresh + route protection
//
// The LogInPage / SignUpPage components below are kept for the in-SPA overlay flow
// (when user clicks "Log In" from within the analyzer). They call Supabase directly
// via the browser client.

// ─── Shared Auth Field ─────────────────────────────────────────────────────────
// (AuthField, AuthCard, etc. defined above are reused here)

// ─── Supabase-powered LogInPage ────────────────────────────────────────────────
function LogInPage({
  onSuccess, onGoSignUp,
}: { onSuccess: (user: AuthUser) => void; onGoSignUp: () => void; }) {
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(false);

  async function handleSubmit() {
    const trimEmail = email.trim().toLowerCase();
    if (!trimEmail || !password) {
      setErrors({ general: "Please enter your email and password." });
      return;
    }
    setLoading(true);
    setErrors({});
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimEmail,
      password,
    });
    setLoading(false);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
        setErrors({ password: "Incorrect password. Please try again." });
      } else if (msg.includes("user not found") || msg.includes("no user")) {
        setErrors({ general: "No account found. Did you mean to sign up?" });
      } else {
        setErrors({ general: error.message });
      }
      return;
    }
    const sbUser = data.user;
    if (!sbUser) { setErrors({ general: "Sign-in failed. Please try again." }); return; }
    onSuccess({
      id: sbUser.id,
      email: sbUser.email ?? trimEmail,
      name: (sbUser.user_metadata?.full_name as string | undefined) ?? trimEmail.split("@")[0],
      loginAt: new Date().toISOString(),
    });
  }

  function handleKey(e: React.KeyboardEvent) { if (e.key === "Enter") handleSubmit(); }
  const err = errors;

  return (
    <AuthCard>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", margin: "0 0 6px" }}>
          Welcome back
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>Log in to your Dealistic account</p>
      </div>

      {err.general && (
        <div style={{ padding: "10px 14px", background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{err.general}</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AuthField label="Email" type="email" placeholder="you@example.com" value={email} onChange={setEmail} error={err.email} />
        <AuthField label="Password" type="password" placeholder="Your password" value={password} onChange={setPassword}
          error={err.password} />
        <button
          onClick={handleSubmit}
          onKeyDown={handleKey}
          disabled={loading}
          onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.opacity = "0.88"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
          style={{
            width: "100%", padding: "12px", border: "none", borderRadius: 10,
            background: loading ? "#94a3b8" : "linear-gradient(135deg, #2563eb, #0ea5e9)",
            color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
            boxShadow: loading ? "none" : "0 4px 14px rgba(37,99,235,0.3)",
            transition: "opacity 0.15s, transform 0.15s",
          }}
        >
          {loading ? "Logging in…" : "Log In →"}
        </button>
      </div>

      <div style={{ height: 1, background: "#f1f5f9", margin: "24px 0 20px" }} />

      <div style={{ background: "linear-gradient(135deg, #eff6ff, #f0fdf4)", border: "1px solid #bfdbfe", borderRadius: 14, padding: "16px 18px" }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>New to Dealistic?</p>
        <p style={{ fontSize: 12, color: "#475569", margin: "0 0 14px", lineHeight: 1.55 }}>
          Save deals, keep your defaults, and access your dashboard from any device.
        </p>
        <button
          onClick={onGoSignUp}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#0f172a"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
          style={{ width: "100%", padding: "10px", border: "1.5px solid #0f172a", borderRadius: 9, background: "transparent", color: "#0f172a", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
        >
          Create free account →
        </button>
      </div>

      <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 18, textAlign: "center", lineHeight: 1.6 }}>
        Session persists across page refreshes via Supabase.
      </p>
    </AuthCard>
  );
}

// ─── Supabase-powered SignUpPage ───────────────────────────────────────────────
function SignUpPage({
  onSuccess, onGoLogin,
}: { onSuccess: (user: AuthUser) => void; onGoLogin: () => void; }) {
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(false);

  async function handleSubmit() {
    const errs: Record<string, string> = {};
    const trimEmail = email.trim().toLowerCase();
    if (!name.trim()) errs.name = "Name is required.";
    if (!trimEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    if (confirm !== password) errs.confirm = "Passwords do not match.";
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    setErrors({});
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: trimEmail,
      password,
      options: { data: { full_name: name.trim() } },
    });
    setLoading(false);
    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        setErrors({ email: "An account with this email already exists. Try logging in." });
      } else {
        setErrors({ general: error.message });
      }
      return;
    }
    const sbUser = data.user;
    if (!sbUser) { setErrors({ general: "Sign-up failed. Please try again." }); return; }
    onSuccess({
      id: sbUser.id,
      email: sbUser.email ?? trimEmail,
      name: name.trim(),
      loginAt: new Date().toISOString(),
    });
  }

  const err = errors;

  return (
    <AuthCard>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", margin: "0 0 6px" }}>
          Create your account
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>Free forever. No credit card required.</p>
      </div>

      {err.general && (
        <div style={{ padding: "10px 14px", background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{err.general}</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <AuthField label="Full Name" type="text" placeholder="Jane Smith" value={name} onChange={setName} error={err.name} />
        <AuthField label="Email" type="email" placeholder="you@example.com" value={email} onChange={setEmail} error={err.email} />
        <AuthField label="Password" type="password" placeholder="Min. 8 characters" value={password} onChange={setPassword}
          error={err.password} hint="At least 8 characters." />
        <AuthField label="Confirm Password" type="password" placeholder="Repeat password" value={confirm} onChange={setConfirm} error={err.confirm} />
        <button
          onClick={handleSubmit}
          disabled={loading}
          onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.opacity = "0.88"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
          style={{
            width: "100%", padding: "12px", border: "none", borderRadius: 10, marginTop: 2,
            background: loading ? "#94a3b8" : "linear-gradient(135deg, #2563eb, #0ea5e9)",
            color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
            boxShadow: loading ? "none" : "0 4px 14px rgba(37,99,235,0.3)",
            transition: "opacity 0.15s, transform 0.15s",
          }}
        >
          {loading ? "Creating account…" : "Create Account →"}
        </button>
      </div>

      <p style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 22 }}>
        Already have an account?{" "}
        <button onClick={onGoLogin}
          style={{ background: "none", border: "none", color: "#2563eb", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecoration = "underline"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecoration = "none"; }}>
          Log in
        </button>
      </p>
      <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 14, textAlign: "center", lineHeight: 1.6 }}>
        By signing up, you agree to our Terms and Privacy Policy.
      </p>
    </AuthCard>
  );
}


// ── Account Page ──────────────────────────────────────────────────────────────
interface UserDefaults {
  vacancy: string; repairs: string; mgmt: string; rate: string; state: string;
}
const DEFAULT_SETTINGS: UserDefaults = { vacancy: "5", repairs: "5", mgmt: "8", rate: "7.25", state: "" };

function AccountPage({
  user, onLogOut, onNavigate, onBack, deals: allDeals,
}: {
  user: AuthUser;
  onLogOut: () => void;
  onNavigate: (p: Page) => void;
  onBack: () => void;
  deals: SavedDeal[];
}) {
  const [showConfirm, setShowConfirm]   = useState(false);
  const [defaults, setDefaults]         = useState<UserDefaults>(() => lsGet<UserDefaults>(LS_DEFAULTS) ?? DEFAULT_SETTINGS);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [activeTab, setActiveTab]       = useState<"overview"|"deals"|"settings">("overview");

  // Filter this user's deals
  const myDeals = allDeals.filter(d => !d.userEmail || d.userEmail === user.email);
  const sorted  = [...myDeals].sort((a, b) => b.score - a.score);

  // Stats
  const totalDeals  = myDeals.length;
  const avgScore    = totalDeals > 0 ? Math.round(myDeals.reduce((s, d) => s + d.score, 0) / totalDeals) : 0;
  const bestScore   = totalDeals > 0 ? Math.max(...myDeals.map(d => d.score)) : 0;
  const totalCF     = myDeals.reduce((s, d) => s + d.cashflow, 0);
  const posDeals    = myDeals.filter(d => d.cashflow > 0).length;

  // Trend data for mini line chart (last 10 deals by savedAt, show score)
  const trendDeals = [...myDeals]
    .sort((a, b) => (a.savedAt ?? "").localeCompare(b.savedAt ?? ""))
    .slice(-10);

  // Insights
  const insights: { icon: string; text: string; color: string }[] = [];
  if (totalDeals === 0) {
    insights.push({ icon: "✏️", text: "Analyze your first deal to start building your portfolio.", color: "#2563eb" });
  } else {
    if (avgScore >= 70) insights.push({ icon: "🔥", text: `Strong portfolio — your average score is ${avgScore}. Keep targeting 70+.`, color: "#059669" });
    else if (avgScore < 50) insights.push({ icon: "⚠️", text: `Average score is ${avgScore}. Look for deals with better cap rates or cash flow.`, color: "#d97706" });
    if (myDeals.some(d => d.cashflow < 0)) insights.push({ icon: "📉", text: `${myDeals.filter(d => d.cashflow < 0).length} deal${myDeals.filter(d => d.cashflow < 0).length > 1 ? "s" : ""} with negative cash flow. Review expenses or pricing.`, color: "#dc2626" });
    if (posDeals > 0) insights.push({ icon: "💰", text: `${posDeals} cash-flowing deal${posDeals > 1 ? "s" : ""} generating an estimated ${totalCF >= 0 ? "+" : ""}$${Math.round(totalCF).toLocaleString()}/mo combined.`, color: "#059669" });
    if (bestScore >= 80) insights.push({ icon: "⭐", text: `Your top deal scores ${bestScore} — a strong benchmark for future analysis.`, color: "#2563eb" });
  }

  function saveDefaults(d: UserDefaults) {
    setDefaults(d);
    lsSet(LS_DEFAULTS, d);
    setDefaultsSaved(true);
    setTimeout(() => setDefaultsSaved(false), 2000);
  }

  const scoreColor = (s: number) => s >= 70 ? "#059669" : s >= 45 ? "#d97706" : "#dc2626";
  const fmt = (n: number) => n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + Math.round(n);

  // Mini SVG line chart
  function ScoreTrend() {
    if (trendDeals.length < 2) return (
      <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Analyze more deals to see trends</span>
      </div>
    );
    const W = 280, H = 60, pad = 8;
    const scores = trendDeals.map(d => d.score);
    const minS = Math.min(...scores), maxS = Math.max(...scores);
    const range = Math.max(maxS - minS, 10);
    const px = (i: number) => pad + (i / (scores.length - 1)) * (W - pad * 2);
    const py = (s: number) => H - pad - ((s - minS) / range) * (H - pad * 2);
    const path = scores.map((s, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(s)}`).join(" ");
    const area = path + ` L${px(scores.length - 1)},${H - pad} L${pad},${H - pad}Z`;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {scores.map((s, i) => (
          <circle key={i} cx={px(i)} cy={py(s)} r={3} fill="#2563eb" />
        ))}
        <text x={px(scores.length - 1)} y={py(scores[scores.length - 1]) - 6}
          textAnchor="middle" style={{ fontSize: 9, fill: "#2563eb", fontWeight: 700 }}>
          {scores[scores.length - 1]}
        </text>
      </svg>
    );
  }

  const tabStyle = (t: typeof activeTab): React.CSSProperties => ({
    padding: "8px 16px", border: "none", borderRadius: 8, cursor: "pointer",
    fontFamily: "inherit", fontSize: 12, fontWeight: 600, transition: "all 0.15s",
    background: activeTab === t ? "#0f172a" : "transparent",
    color: activeTab === t ? "#fff" : "#64748b",
  });

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "8px 12px",
    border: "1.5px solid #e2e8f0", borderRadius: 10,
    fontSize: 13, color: "#0f172a", fontFamily: "inherit",
    background: "#fff", outline: "none", transition: "border-color 0.18s",
  };

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
      {/* ── Top bar ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid #e2e8f0",
      }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 clamp(16px,4vw,32px)", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#64748b", padding: 0, display: "flex", alignItems: "center", gap: 6, transition: "color 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#64748b"; }}>
            ← Back
          </button>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em" }}>Dealistic</span>
          <div style={{ width: 52 }} /> {/* spacer to center brand */}
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(28px,4vw,48px) clamp(16px,4vw,32px) 80px" }}>

        {/* ── Profile header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#1e3a5f,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 14px rgba(37,99,235,0.3)" }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#e0f2fe", textTransform: "uppercase" }}>{user.name.charAt(0)}</span>
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", margin: "0 0 2px" }}>{user.name}</h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>{user.email}</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => onNavigate("analyzer")} style={{ padding: "8px 18px", background: "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 10px rgba(37,99,235,0.28)", transition: "opacity 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}>
              Analyze Deal
            </button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 12, padding: 4, marginBottom: 28, width: "fit-content" }}>
          {(["overview", "deals", "settings"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={tabStyle(t)}>
              {t === "overview" ? "Overview" : t === "deals" ? `Deals${totalDeals > 0 ? ` (${totalDeals})` : ""}` : "Settings"}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB: OVERVIEW
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              {[
                { label: "Deals Analyzed", value: totalDeals.toString(), sub: "total saved", color: "#2563eb" },
                { label: "Average Score",  value: totalDeals > 0 ? avgScore.toString() : "—", sub: "out of 100", color: scoreColor(avgScore) },
                { label: "Best Score",     value: totalDeals > 0 ? bestScore.toString() : "—", sub: sorted[0]?.address?.split(",")[0] ?? "no deals yet", color: scoreColor(bestScore) },
                { label: "Est. Cash Flow", value: totalDeals > 0 ? (totalCF >= 0 ? "+" : "") + "$" + Math.abs(Math.round(totalCF)).toLocaleString() : "—", sub: "combined / mo", color: totalCF >= 0 ? "#059669" : "#dc2626" },
              ].map(s => (
                <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
                  <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>{s.label}</p>
                  <p style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1, marginBottom: 5 }}>{s.value}</p>
                  <p style={{ fontSize: 10, color: "#94a3b8" }}>{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Score trend chart */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "18px 20px", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", margin: "0 0 2px" }}>Deal Score Trend</p>
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Last {Math.min(trendDeals.length, 10)} analyzed deals</p>
                </div>
                {totalDeals > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: avgScore >= 70 ? "#059669" : avgScore >= 45 ? "#d97706" : "#dc2626", background: avgScore >= 70 ? "#f0fdf4" : avgScore >= 45 ? "#fffbeb" : "#fff1f2", border: `1px solid ${avgScore >= 70 ? "#bbf7d0" : avgScore >= 45 ? "#fde68a" : "#fecdd3"}`, borderRadius: 999, padding: "3px 10px" }}>
                    avg {avgScore}
                  </span>
                )}
              </div>
              <ScoreTrend />
            </div>

            {/* Insights */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", margin: 0 }}>Insights</p>
              </div>
              {insights.length > 0 ? insights.map((ins, i) => (
                <div key={i} style={{ padding: "12px 20px", borderBottom: i < insights.length - 1 ? "1px solid #f8fafc" : "none", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ins.icon}</span>
                  <p style={{ fontSize: 12, color: "#334155", lineHeight: 1.6, margin: 0 }}>{ins.text}</p>
                </div>
              )) : (
                <div style={{ padding: "20px", textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "#94a3b8" }}>No insights yet — start analyzing deals.</p>
                </div>
              )}
            </div>

            {/* Quick nav */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "My Deals Dashboard", sub: `${totalDeals} saved`, page: "dashboard" as Page, icon: "📊" },
                { label: "Analyze a Deal",      sub: "manual or CSV",        page: "analyzer" as Page,  icon: "✏️" },
              ].map(item => (
                <button key={item.page} onClick={() => onNavigate(item.page)} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px 18px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "all 0.18s", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#2563eb"; el.style.transform = "translateY(-2px)"; el.style.boxShadow = "0 4px 14px rgba(37,99,235,0.12)"; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#e2e8f0"; el.style.transform = "none"; el.style.boxShadow = "0 1px 4px rgba(15,23,42,0.04)"; }}>
                  <span style={{ fontSize: 20, display: "block", marginBottom: 8 }}>{item.icon}</span>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>{item.label}</p>
                  <p style={{ fontSize: 11, color: "#94a3b8" }}>{item.sub}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB: DEALS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "deals" && (
          <div>
            {myDeals.length === 0 ? (
              <div style={{ background: "#fff", border: "1.5px dashed #e2e8f0", borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#475569", marginBottom: 8 }}>No deals saved yet</p>
                <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20, lineHeight: 1.6 }}>Analyze a property and click "Save Deal" to track it here.</p>
                <button onClick={() => onNavigate("analyzer")} style={{ padding: "10px 24px", background: "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Analyze Your First Deal
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Sorted by score — highest first</p>
                {sorted.map((deal, i) => {
                  const sc = scoreColor(deal.score);
                  return (
                    <div key={deal.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
                      {/* Score badge */}
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: sc + "12", border: `1.5px solid ${sc}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 15, fontWeight: 900, color: sc, fontVariantNumeric: "tabular-nums" }}>{deal.score}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.address}</p>
                        <p style={{ fontSize: 11, color: "#64748b" }}>
                          {fmt(deal.price)} · <span style={{ color: deal.cashflow >= 0 ? "#059669" : "#dc2626", fontWeight: 600 }}>{deal.cashflow >= 0 ? "+" : ""}${Math.round(deal.cashflow)}/mo</span> · {deal.capRate.toFixed(1)}% cap
                        </p>
                      </div>
                      <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>#{i + 1}</span>
                    </div>
                  );
                })}
                <button onClick={() => onNavigate("dashboard")} style={{ marginTop: 8, padding: "12px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 12, fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#2563eb"; el.style.color = "#2563eb"; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#e2e8f0"; el.style.color = "#475569"; }}>
                  Open Full Dashboard →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB: SETTINGS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Default analysis settings */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: "0 0 2px" }}>Default Analysis Settings</p>
                <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>Pre-filled when you open the analyzer</p>
              </div>
              <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px 20px" }}>
                {([
                  { label: "Vacancy Rate", key: "vacancy" as const, suffix: "%", placeholder: "5" },
                  { label: "Repairs %",    key: "repairs" as const, suffix: "% of rent", placeholder: "5" },
                  { label: "Management %", key: "mgmt" as const,    suffix: "% of rent", placeholder: "8" },
                  { label: "Interest Rate",key: "rate" as const,    suffix: "%",          placeholder: "7.25" },
                ] as { label: string; key: keyof UserDefaults; suffix: string; placeholder: string }[]).map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>{f.label}</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type="number" placeholder={f.placeholder} value={defaults[f.key]}
                        onChange={e => setDefaults(d => ({ ...d, [f.key]: e.target.value }))}
                        style={inp}
                        onFocus={e => { e.currentTarget.style.borderColor = "#2563eb"; }}
                        onBlur={e => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
                      />
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8", pointerEvents: "none" }}>{f.suffix}</span>
                    </div>
                  </div>
                ))}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>
                    Preferred State
                  </label>
                  <StateSelect
                    value={defaults.state}
                    onChange={abbr => {
                      // Auto-fill state-based smart defaults (using $350k reference price)
                      const sd = getStateDefaults(abbr, 350000);
                      setDefaults(d => ({
                        ...d,
                        state:    abbr,
                        vacancy:  abbr ? sd.vacancy   : d.vacancy,
                      }));
                    }}
                  />
                  {defaults.state && (() => {
                    const sd = STATE_SMART_DEFAULTS[defaults.state];
                    const tx = STATE_TAX_RATES[defaults.state];
                    return sd ? (
                      <p style={{ fontSize: 10, color: "#2563eb", marginTop: 5, lineHeight: 1.5 }}>
                        Smart estimate for {defaults.state}: vacancy ~{sd.vacancy}%
                        {tx ? `, tax rate ~${tx.rate}%/yr` : ""}.
                        {" "}These are pre-filled as defaults and can be overridden per deal.
                      </p>
                    ) : null;
                  })()}
                </div>
              </div>
              <div style={{ padding: "0 20px 20px" }}>
                <button onClick={() => saveDefaults(defaults)} style={{ padding: "10px 24px", background: defaultsSaved ? "#059669" : "linear-gradient(135deg,#2563eb,#0ea5e9)", color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", boxShadow: "0 2px 10px rgba(37,99,235,0.22)" }}>
                  {defaultsSaved ? "✓ Saved" : "Save Defaults"}
                </button>
              </div>
            </div>

            {/* Account info */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>Account</p>
              </div>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Name</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{user.name}</span>
              </div>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Email</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{user.email}</span>
              </div>
              {user.loginAt && (
                <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Last sign-in</span>
                  <span style={{ fontSize: 12, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                    {new Date(user.loginAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
            </div>

            {/* Log out */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "20px", boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}>
              {!showConfirm ? (
                <button onClick={() => setShowConfirm(true)} style={{ padding: "10px 20px", background: "transparent", color: "#dc2626", border: "1px solid #fecdd3", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#fff1f2"; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; }}>
                  Log Out
                </button>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "#0f172a", marginBottom: 14 }}>Are you sure you want to log out?</p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={onLogOut} style={{ padding: "10px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Log Out</button>
                    <button onClick={() => setShowConfirm(false)} style={{ padding: "10px 20px", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
              Account data is stored locally in this browser.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function Dealistic() {
  const [page, setPage] = useState<Page>("landing");
  const [prevPage, setPrevPage] = useState<Page>("landing");
  const [authPage, setAuthPage] = useState<AuthPage | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deals, setDeals] = useState<SavedDeal[]>([]);


  // ── Restore session via Supabase onAuthStateChange ─────────────────────
  useEffect(() => {
    const supabase = createClient();

    // Get current session immediately (handles page refresh)
    supabase.auth.getUser().then(({ data: { user: sbUser } }) => {
      if (sbUser) {
        const authUser: AuthUser = {
          id: sbUser.id,
          email: sbUser.email ?? "",
          name: (sbUser.user_metadata?.full_name as string | undefined) ?? (sbUser.email?.split("@")[0] ?? ""),
          loginAt: sbUser.last_sign_in_at ?? new Date().toISOString(),
        };
        setUser(authUser);
        const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
        const myDeals = allDeals.filter(d => d.userEmail === authUser.email);
        if (myDeals.length > 0) setDeals(myDeals);
      }
    });

    // Listen for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const sbUser = session.user;
        const authUser: AuthUser = {
          id: sbUser.id,
          email: sbUser.email ?? "",
          name: (sbUser.user_metadata?.full_name as string | undefined) ?? (sbUser.email?.split("@")[0] ?? ""),
          loginAt: sbUser.last_sign_in_at ?? new Date().toISOString(),
        };
        setUser(authUser);
        const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
        const myDeals = allDeals.filter(d => d.userEmail === authUser.email);
        if (myDeals.length > 0) setDeals(myDeals);
      } else {
        setUser(null);
        setDeals([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const addDeal = useCallback((deal: SavedDeal) => {
    setDeals(prev => {
      const next = [deal, ...prev.filter(d => d.id !== deal.id)];
      // Persist — merge with other users' deals already in storage
      const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
      const otherDeals = allDeals.filter(d => d.userEmail !== deal.userEmail);
      lsSet(LS_DEALS, [...next, ...otherDeals]);
      return next;
    });
  }, []);

  const deleteDeal = useCallback((id: number) => {
    setDeals(prev => {
      const next = prev.filter(d => d.id !== id);
      const userEmail = user?.email ?? "";
      const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
      const otherDeals = allDeals.filter(d => d.userEmail !== userEmail);
      lsSet(LS_DEALS, [...next, ...otherDeals]);
      return next;
    });
  }, [user]);

  const deleteManyDeals = useCallback((ids: number[]) => {
    const idSet = new Set(ids);
    setDeals(prev => {
      const next = prev.filter(d => !idSet.has(d.id));
      const userEmail = user?.email ?? "";
      const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
      const otherDeals = allDeals.filter(d => d.userEmail !== userEmail);
      lsSet(LS_DEALS, [...next, ...otherDeals]);
      return next;
    });
  }, [user]);

  const toggleFav = useCallback((id: number) => {
    setDeals(prev => {
      const next = prev.map(d => d.id === id ? { ...d, saved: !d.saved } : d);
      const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
      const userEmail = next[0]?.userEmail ?? "";
      const otherDeals = allDeals.filter(d => d.userEmail !== userEmail);
      lsSet(LS_DEALS, [...next, ...otherDeals]);
      return next;
    });
  }, []);


  const navigate = (p: Page) => { setPrevPage(page); setPage(p); setAuthPage(null); setMenuOpen(false); window.scrollTo(0, 0); };
  const openAuth = (ap: AuthPage) => { setAuthPage(ap); setMenuOpen(false); window.scrollTo(0, 0); };

  function handleAuthSuccess(u: AuthUser) {
    // Session is persisted automatically by Supabase via cookie (see middleware.ts).
    setUser(u);
    setAuthPage(null);
    window.scrollTo(0, 0);
  }
  async function handleLogOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setDeals([]);
    setAuthPage(null);
    setPage("landing");
    window.scrollTo(0, 0);
  }

  return (
    <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", background: "#f8fafc", minHeight: "100vh", overflowX: "hidden", width: "100%" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { max-width: 100%; overflow-x: hidden; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
        input[type=number] { -moz-appearance: textfield; }
        ::selection { background: ${C.blue}; color: #fff; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.gradStart}; }
        ::-webkit-scrollbar-thumb { background: ${C.rule}; border-radius: 2px; }

        /* ── Analyzer premium inputs ── */

        /* ── StateSelect ──────────────────────────────────────────────── */
        .ss-trigger {
          width: 100%;
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 10px 7px 12px;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          cursor: pointer;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.4;
          color: #0f172a;
          transition: border-color 0.18s, box-shadow 0.18s;
          box-sizing: border-box;
          outline: none;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
        }
        .ss-trigger:hover { border-color: #cbd5e1; }
        .ss-trigger:focus, .ss-trigger.open {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.14);
        }
        .ss-trigger.placeholder { color: #94a3b8; }
        .ss-trigger .ss-chevron {
          flex-shrink: 0;
          transition: transform 0.2s ease;
          color: #94a3b8;
          margin-left: auto;
        }
        .ss-trigger.open .ss-chevron { transform: rotate(180deg); }

        /* Panel sits below trigger, full-width of its container */
        .ss-panel {
          position: absolute;
          top: calc(100% + 5px);
          left: 0;
          right: 0;
          z-index: 400;
          border-radius: 12px;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          box-shadow: 0 12px 40px rgba(15,23,42,0.13), 0 2px 8px rgba(15,23,42,0.06);
          overflow: hidden;
        }

        /* Search row — icon is a sibling of input inside a flex row */
        .ss-search-wrap {
          display: flex;
          align-items: center;
          gap: 0;
          padding: 8px 8px 7px;
          border-bottom: 1px solid #f1f5f9;
          background: #fff;
        }
        .ss-search-icon {
          flex-shrink: 0;
          color: #94a3b8;
          margin-left: 4px;
          margin-right: 0;
          pointer-events: none;
          display: flex;
          align-items: center;
        }
        .ss-search {
          flex: 1;
          min-width: 0;
          padding: 6px 8px 6px 7px;
          background: transparent;
          border: none;
          outline: none;
          font-size: 13px;
          color: #0f172a;
          font-family: inherit;
          line-height: 1.4;
        }
        .ss-search::placeholder { color: #94a3b8; }
        /* Wrap gets the focus border, not the input */
        .ss-search-wrap:focus-within {
          background: #f8fafc;
          border-bottom-color: #e2e8f0;
        }

        /* Option list */
        .ss-list {
          max-height: 224px;
          overflow-y: auto;
          padding: 4px 0;
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 transparent;
        }
        .ss-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
          color: #0f172a;
          line-height: 1.3;
          transition: background 0.1s;
          user-select: none;
          white-space: nowrap;
          overflow: hidden;
        }
        .ss-option:hover { background: #f8fafc; }
        .ss-option.ss-selected {
          background: rgba(37,99,235,0.06);
          color: #2563eb;
        }
        .ss-option.ss-clear {
          color: #64748b;
          font-style: italic;
          font-size: 12px;
          padding: 7px 12px;
        }
        .ss-option.ss-clear:hover { background: #f8fafc; }
        .ss-option.ss-empty {
          color: #94a3b8;
          font-style: italic;
          justify-content: center;
          cursor: default;
          font-size: 12px;
        }
        .ss-option .ss-abbr {
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
          width: 28px;
          flex-shrink: 0;
          letter-spacing: 0.03em;
        }
        .ss-option.ss-selected .ss-abbr { color: #2563eb; }
        .ss-option .ss-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 400;
        }
        .ss-option.ss-selected .ss-name { font-weight: 600; }
        .ss-check { color: #2563eb; flex-shrink: 0; margin-left: auto; }

        .az-input {
          width: 100%;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          color: #0f172a;
          font-size: 12px;
          padding: 8px 12px;
          outline: none;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color 0.18s, box-shadow 0.18s;
          -moz-appearance: textfield;
        }
        .az-input::placeholder { color: #94a3b8; }
        .az-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
        }
        .az-input:hover:not(:focus) { border-color: #cbd5e1; }

        .az-input-prefix { padding-left: 30px; }
        .az-input-suffix { padding-right: 38px; }

        .az-select {
          width: 100%;
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 12px center;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          color: #0f172a;
          font-size: 13px;
          padding: 8px 32px 8px 12px;
          outline: none;
          font-family: inherit;
          cursor: pointer;
          box-sizing: border-box;
          -webkit-appearance: none;
          appearance: none;
          transition: border-color 0.18s, box-shadow 0.18s;
        }
        .az-select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
        }

        .az-card {
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(226,232,240,0.8);
          border-radius: 18px;
          padding: 20px 22px;
          box-shadow: 0 1px 3px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04);
          transition: box-shadow 0.2s;
        }

        .az-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .az-section-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #e2e8f0;
        }

        .az-label {
          font-size: 11px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 4px;
          display: block;
          letter-spacing: 0.01em;
        }

        .az-hint {
          font-size: 10px;
          color: #94a3b8;
          margin-top: 3px;
          line-height: 1.4;
        }

        .az-btn-primary {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #2563eb, #0ea5e9);
          color: #fff;
          border: none;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 0.18s, transform 0.18s, box-shadow 0.18s;
          box-shadow: 0 4px 14px rgba(37,99,235,0.3);
          margin-top: 24px;
        }
        .az-btn-primary:hover {
          opacity: 0.92;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(37,99,235,0.38);
        }
        .az-btn-primary:active { transform: translateY(0); }

        @media (max-width: 500px) {
          .az-card { padding: 16px; }
          .az-btn-primary { margin-top: 18px; }
          .az-input, .az-select { font-size: 16px; } /* prevent iOS zoom on focus */
        }

        .az-btn-ghost {
          font-size: 11px;
          letter-spacing: 0.06em;
          background: transparent;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          color: #64748b;
          padding: 5px 12px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .az-btn-ghost:hover {
          border-color: #2563eb;
          color: #2563eb;
          background: rgba(37,99,235,0.04);
        }

        .az-empty-state {
          background: rgba(255,255,255,0.7);
          border: 1.5px dashed #cbd5e1;
          border-radius: 20px;
          padding: 60px 32px;
          text-align: center;
        }

        .az-tip {
          background: linear-gradient(135deg, #eff6ff, #f0fdf4);
          border: 1px solid #bfdbfe;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-top: 20px;
        }
      `}</style>

      {/* ── Global top nav bar ── */}
      {!authPage && (
        <div style={{
          position: "sticky", top: 0, zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", height: 52,
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          borderBottom: `1px solid ${C.rule}`,
        }}>
          {/* Left: brand + hamburger */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              title={menuOpen ? "Close menu" : "Open menu"}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 4.5,
                width: 32, height: 32, border: "none", borderRadius: 7,
                background: menuOpen ? C.bg2 : "transparent",
                cursor: "pointer", transition: "background 0.15s", flexShrink: 0,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {menuOpen ? (
                /* × close icon */
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={C.text} strokeWidth="1.8" strokeLinecap="round">
                  <line x1="1" y1="1" x2="13" y2="13" /><line x1="13" y1="1" x2="1" y2="13" />
                </svg>
              ) : (
                /* ≡ hamburger */
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke={C.text} strokeWidth="1.5" strokeLinecap="round">
                  <line x1="0" y1="1" x2="16" y2="1" /><line x1="0" y1="6" x2="16" y2="6" /><line x1="0" y1="11" x2="16" y2="11" />
                </svg>
              )}
            </button>
            <button
              onClick={() => navigate("landing")}
              style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: "-0.025em", padding: 0, transition: "color 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.blue; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
            >
              Dealistic
            </button>
          </div>

          {/* Right: auth */}
          {user ? (
            <button
              onClick={() => openAuth("account")}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 5px",
                background: "transparent", border: `1px solid ${C.rule}`, borderRadius: 999,
                cursor: "pointer", fontFamily: "inherit", transition: "background 0.12s",
              }}
            >
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#1e3a5f", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#e0f2fe", textTransform: "uppercase" }}>{user.name.charAt(0)}</span>
              </div>
              <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>Account</span>
            </button>
          ) : (
            <button
              onClick={() => openAuth("login")}
              style={{
                padding: "6px 14px", background: "transparent", border: `1px solid ${C.rule}`,
                borderRadius: 999, fontSize: 12, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit", color: C.text,
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.text; (e.currentTarget as HTMLElement).style.color = C.bg; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text; }}
            >
              Log In
            </button>
          )}
        </div>
      )}

      {/* ── Slide-in sidebar ── */}
      {menuOpen && !authPage && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 299,
              background: "rgba(15,23,42,0.32)",
              backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
              animation: "sidebarFadeIn 0.2s ease",
            }}
          />
          {/* Panel */}
          <div style={{
            position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 300,
            width: 240, display: "flex", flexDirection: "column",
            background: "#ffffff",
            borderRight: "1px solid #e2e8f0",
            boxShadow: "4px 0 24px rgba(15,23,42,0.08)",
            animation: "sidebarSlideIn 0.22s cubic-bezier(.22,1,.36,1)",
          }}>
            <style>{`
              @keyframes sidebarFadeIn  { from { opacity: 0 } to { opacity: 1 } }
              @keyframes sidebarSlideIn { from { transform: translateX(-100%) } to { transform: translateX(0) } }
            `}</style>

            {/* Panel header — matches top nav height exactly */}
            <div style={{
              height: 52, display: "flex", alignItems: "center",
              justifyContent: "space-between", padding: "0 16px",
              borderBottom: "1px solid #f1f5f9", flexShrink: 0,
            }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em" }}>Dealistic</span>
              <button
                onClick={() => setMenuOpen(false)}
                style={{
                  width: 28, height: 28, display: "flex", alignItems: "center",
                  justifyContent: "center", border: "none", borderRadius: 6,
                  background: "transparent", cursor: "pointer", transition: "background 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="1" y1="1" x2="11" y2="11" /><line x1="11" y1="1" x2="1" y2="11" />
                </svg>
              </button>
            </div>

            {/* Primary nav */}
            <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
              {/* Section label */}
              <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 8px 8px", margin: 0 }}>
                Navigation
              </p>

              {([
                { page: "landing",  label: "Home",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
                { page: "analyzer", label: "Analyze",   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
                { page: "dashboard",label: "Dashboard", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
              ] as { page: Page; label: string; icon: React.ReactNode }[]).map(item => {
                const active = page === item.page;
                return (
                  <button
                    key={item.page}
                    onClick={() => { navigate(item.page); setMenuOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "8px 10px",
                      background: active ? "#eff6ff" : "transparent",
                      border: "none", borderRadius: 8, cursor: "pointer",
                      fontFamily: "inherit", textAlign: "left",
                      transition: "background 0.15s",
                      color: active ? "#2563eb" : "#374151",
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span style={{ color: active ? "#2563eb" : "#64748b", flexShrink: 0, display: "flex" }}>
                      {item.icon}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, letterSpacing: "-0.01em" }}>
                      {item.label}
                    </span>
                    {active && (
                      <span style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: "#2563eb", flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}

              {/* More section */}
              <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", padding: "16px 8px 8px", margin: 0 }}>
                More
              </p>

              {([
                { page: "learn",    label: "Learn",     icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> },
              ] as { page: Page; label: string; icon: React.ReactNode }[]).map(item => {
                const active = page === item.page;
                return (
                  <button
                    key={item.page}
                    onClick={() => { navigate(item.page); setMenuOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "8px 10px",
                      background: active ? "#eff6ff" : "transparent",
                      border: "none", borderRadius: 8, cursor: "pointer",
                      fontFamily: "inherit", textAlign: "left",
                      transition: "background 0.15s",
                      color: active ? "#2563eb" : "#374151",
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span style={{ color: active ? "#2563eb" : "#64748b", flexShrink: 0, display: "flex" }}>
                      {item.icon}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, letterSpacing: "-0.01em" }}>
                      {item.label}
                    </span>
                    {active && (
                      <span style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: "#2563eb", flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}

              {/* Auth item */}
              <div style={{ height: 1, background: "#f1f5f9", margin: "12px 0 10px" }} />
              <button
                onClick={() => { openAuth(user ? "account" : "login"); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "8px 10px",
                  background: "transparent", border: "none", borderRadius: 8,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  transition: "background 0.15s", color: "#374151",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{ color: "#64748b", flexShrink: 0, display: "flex" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em" }}>
                  {user ? `Account (${user.name})` : "Log In"}
                </span>
              </button>
            </nav>

            {/* Footer — Privacy + Contact */}
            <div style={{
              padding: "12px 16px 16px", borderTop: "1px solid #f1f5f9", flexShrink: 0,
              display: "flex", gap: 16, alignItems: "center",
            }}>
              {(["privacy", "contact"] as Page[]).map(p => (
                <button
                  key={p}
                  onClick={() => { navigate(p); setMenuOpen(false); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontFamily: "inherit", fontSize: 11, fontWeight: 500,
                    color: "#94a3b8", padding: 0, textTransform: "capitalize",
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
              <span style={{ fontSize: 11, color: "#e2e8f0", marginLeft: "auto" }}>© 2026</span>
            </div>
          </div>
        </>
      )}

{/* Blue sidebar removed — wordmark now in the top nav bar */}

      {/* Auth pages — rendered full-screen, no sidebar */}
      {authPage === "login" && (
        <LogInPage onSuccess={handleAuthSuccess} onGoSignUp={() => openAuth("signup")} />
      )}
      {authPage === "signup" && (
        <SignUpPage onSuccess={handleAuthSuccess} onGoLogin={() => openAuth("login")} />
      )}
      {authPage === "account" && user && (
        <AccountPage
          user={user}
          onLogOut={handleLogOut}
          onNavigate={navigate}
          deals={deals}
          onBack={() => { setAuthPage(null); setPage(prevPage); window.scrollTo(0, 0); }}
        />
      )}

      {/* Main app pages */}
      {!authPage && (
        <div>
          {page === "landing" && <LandingPage onAnalyze={() => navigate("analyzer")} onLearn={() => navigate("learn")} onNavigate={navigate} />}
          {page === "learn" && <LearnPage onAnalyze={() => navigate("analyzer")} onNavigate={navigate} />}
          {page === "privacy" && <PrivacyPage onNavigate={navigate} />}
          {page === "contact" && <ContactPage onNavigate={navigate} />}
          {page === "analyzer" && <AnalyzerPage onSave={addDeal} prefill={null} user={user} onOpenLogin={() => openAuth("login")} />}
          {page === "dashboard" && (
            <DashboardPage
              deals={deals}
              onDelete={deleteDeal}
              onDeleteAll={deleteManyDeals}
              onAnalyze={() => navigate("analyzer")}
              user={user}
              onOpenLogin={() => openAuth("login")}
            />
          )}

        </div>
      )}
    </div>
  );
}