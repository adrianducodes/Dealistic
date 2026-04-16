"use client";
import React, { useState, useRef, useEffect, useCallback, Fragment } from "react";

// ─── Storage keys ─────────────────────────────────────────────────────────────
const LS_SESSION = "dealistic_session";   // { email, name, loginAt }
const LS_USERS   = "dealistic_users";     // [{ email, name, passwordHash }]
const LS_DEALS   = "dealistic_deals";     // SavedDeal[] keyed by userEmail

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

interface AuthUser { email: string; name: string; loginAt?: string; }

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
function BarChart({ income, expenses }: { income: number; expenses: number }) {
  const max = Math.max(income, expenses, 1);
  const incomeH = Math.round((income / max) * 140);
  const expensesH = Math.round((expenses / max) * 140);
  const cashflow = income - expenses;
  const positive = cashflow >= 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, height: 160, paddingBottom: 0 }}>
        {/* Income bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: C.green, fontVariantNumeric: "tabular-nums" }}>{fmt(income)}</span>
          <div style={{ width: "100%", height: incomeH, background: C.green, opacity: 0.85, transition: "height 0.5s ease" }} />
        </div>
        {/* Expenses bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: C.red, fontVariantNumeric: "tabular-nums" }}>{fmt(expenses)}</span>
          <div style={{ width: "100%", height: expensesH, background: C.red, opacity: 0.75, transition: "height 0.5s ease" }} />
        </div>
        {/* Cash flow bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: positive ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{fmtSigned(cashflow)}</span>
          <div style={{ width: "100%", height: Math.max(4, Math.round((Math.abs(cashflow) / max) * 140)), background: positive ? C.green : C.red, opacity: 0.6, transition: "height 0.5s ease" }} />
        </div>
      </div>
      {/* X-axis labels */}
      <div style={{ display: "flex", gap: 24, marginTop: 8, borderTop: `1px solid ${C.rule}`, paddingTop: 8 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>Income</p>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>Expenses</p>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>Cash Flow</p>
        </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ══ 1. SCORE HERO ══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ ...sh }}><span>Deal Score</span>{rule}</div>

        {/* Big number + chip */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24, marginBottom: 20 }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <span style={{
              fontSize: 96, fontWeight: 800, lineHeight: 0.85,
              letterSpacing: "-0.06em", color: scoreColor,
              fontVariantNumeric: "tabular-nums", display: "block",
            }}>
              {r.score}
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, display: "block" }}>out of 100</span>
          </div>
          <div style={{ paddingTop: 6, flex: 1 }}>
            <ScoreChip label={r.label} />
            {/* Mini bar — visual score meter */}
            <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 999, width: `${r.score}%`,
                background: r.score >= 70
                  ? "linear-gradient(90deg,#059669,#10b981)"
                  : r.score >= 45
                  ? "linear-gradient(90deg,#d97706,#f59e0b)"
                  : "linear-gradient(90deg,#dc2626,#ef4444)",
                transition: "width 0.6s ease",
              }} />
            </div>
            <p style={{ fontSize: 11, color: "#475569", marginTop: 10, lineHeight: 1.65 }}>{r.reason}</p>
          </div>
        </div>

        {/* Score breakdown card */}
        <div style={{
          background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14,
          padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Base deal score</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{r.baseScore}</span>
          </div>
          {stateAbbr ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>
                State factors <span style={{ color: "#94a3b8" }}>({stateAbbr})</span>
              </span>
              {r.stateAdj !== 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    color: r.stateAdj > 0 ? "#059669" : "#dc2626",
                  }}>{r.stateAdj > 0 ? "+" : ""}{r.stateAdj}</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{r.stateAdjLabel}</span>
                </div>
              ) : (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Neutral</span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
              Select a state to factor in market conditions
            </div>
          )}
          <div style={{ height: 1, background: "#e2e8f0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Final score</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>{r.score}</span>
          </div>
        </div>
      </div>

      {/* ══ 2. KPI CARDS ═══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ ...sh }}><span>Key Metrics</span>{rule}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {[
            { label: "Monthly Cash Flow", value: fmtSigned(r.cashflow), sub: `${fmtSigned(r.annualCashflow)}/yr`, color: r.cashflow >= 0 ? C.green : C.red },
            { label: "Cap Rate",          value: r.capRate.toFixed(2) + "%", sub: r.capRate >= 6 ? "Above benchmark" : r.capRate >= 4 ? "Average" : "Below average", color: r.capRate >= 6 ? C.green : r.capRate < 4 ? C.red : "#475569" },
            { label: "Cash-on-Cash",      value: r.coc.toFixed(2) + "%",    sub: r.coc >= 8 ? "Excellent" : r.coc >= 5 ? "Acceptable" : "Below target", color: r.coc >= 8 ? C.green : r.coc < 3 ? C.red : "#475569" },
            { label: "DSCR",              value: r.dscr.toFixed(2),          sub: r.dscr >= 1.25 ? "Healthy coverage" : r.dscr >= 1.0 ? "Breakeven" : "Negative carry", color: r.dscr >= 1.25 ? C.green : r.dscr < 1.0 ? C.red : "#475569" },
          ].map(card => (
            <div key={card.label} style={{
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
              padding: "18px 18px 16px", boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
            }}>
              <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>{card.label}</p>
              <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.04em", color: card.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 7 }}>{card.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ══ 3. AI INVESTMENT INSIGHT ═══════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ ...sh }}><span>AI Investment Insight</span>{rule}</div>
        <div style={{
          background: "linear-gradient(135deg,#eff6ff,#f0fdf4)",
          border: "1px solid #bfdbfe", borderRadius: 14, padding: "18px 20px",
          display: "flex", gap: 14, alignItems: "flex-start",
        }}>
          <div style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg,#2563eb,#059669)",
            display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1,
          }}>
            <span style={{ fontSize: 15 }}>✦</span>
          </div>
          <p style={{ fontSize: 13, color: "#1e3a5f", lineHeight: 1.75, margin: 0 }}>{narrative}</p>
        </div>
      </div>

      {/* ══ 4. BIGGEST DRIVERS ═════════════════════════════════════════════════ */}
      {drivers.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ ...sh }}><span>Score Drivers</span>{rule}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {drivers.map((drv, i) => {
              const positive = drv.pts > 0;
              const barWidth = Math.min(100, Math.abs(drv.pts) / 20 * 100);
              return (
                <div key={i} style={{
                  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
                  padding: "13px 16px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{drv.label}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>{drv.note}</span>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                      color: positive ? "#059669" : "#dc2626",
                      background: positive ? "#f0fdf4" : "#fff1f2",
                      border: `1px solid ${positive ? "#bbf7d0" : "#fecdd3"}`,
                      borderRadius: 6, padding: "2px 8px", flexShrink: 0, marginLeft: 12,
                    }}>{positive ? "+" : ""}{drv.pts} pts</span>
                  </div>
                  {/* Impact bar */}
                  <div style={{ height: 4, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 999,
                      width: `${barWidth}%`,
                      background: positive ? "#10b981" : "#f87171",
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ 5. OPTIMIZATION SUGGESTIONS ═══════════════════════════════════════ */}
      {opts.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ ...sh }}><span>Optimization Suggestions</span>{rule}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {opts.map((opt, i) => (
              <div key={i} style={{
                background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
                padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 14,
              }}>
                <div style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: 8,
                  background: "#f0fdf4", border: "1px solid #bbf7d0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: 13 }}>↑</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{opt.action}</p>
                  <p style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>{opt.detail}</p>
                </div>
                <div style={{
                  flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#059669",
                  background: "#f0fdf4", border: "1px solid #bbf7d0",
                  borderRadius: 8, padding: "4px 10px", whiteSpace: "nowrap",
                }}>+{opt.scoreDelta} pts</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ 6. INCOME vs EXPENSES ══════════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ ...sh }}><span>Income vs. Expenses</span>{rule}</div>
        <BarChart income={r.effectiveRent} expenses={r.totalMonthly} />
      </div>

      {/* ══ 7. MONTHLY BREAKDOWN ═══════════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ ...sh }}><span>Monthly Breakdown</span>{rule}</div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
          {/* Income */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
            <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 0 }}>Income</p>
          </div>
          <div style={{ padding: "6px 18px" }}>
            <MetRow label="Gross Rent" value={fmt(d.rent)} />
            <MetRow label="Vacancy Loss" value={"−" + fmt(vacancyLoss)} accent="red" />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Effective Rent</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.green, fontVariantNumeric: "tabular-nums" }}>{fmt(r.effectiveRent)}</span>
            </div>
          </div>
          {/* Expenses */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
            <p style={{ fontSize: 9, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 0 }}>Expenses</p>
          </div>
          <div style={{ padding: "6px 18px" }}>
            <MetRow label="Mortgage (P&I)" value={fmt(r.mortgage)} />
            {d.taxes > 0 && <MetRow label="Property Taxes" value={fmt(d.taxes)} />}
            {d.insurance > 0 && <MetRow label="Insurance" value={fmt(d.insurance)} />}
            {d.hoa > 0 && <MetRow label="HOA" value={fmt(d.hoa)} />}
            {d.repairs > 0 && <MetRow label="Repairs & Maintenance" value={fmt(d.repairs)} />}
            {d.mgmt > 0 && <MetRow label="Property Management" value={fmt(d.mgmt)} />}
            {d.other > 0 && <MetRow label="Other" value={fmt(d.other)} />}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Total Expenses</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.red, fontVariantNumeric: "tabular-nums" }}>{fmt(r.totalMonthly)}</span>
            </div>
          </div>
          {/* Net */}
          <div style={{
            padding: "16px 18px", borderTop: "2px solid #e2e8f0",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: r.cashflow >= 0 ? "#f0fdf4" : "#fff1f2",
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", letterSpacing: "0.03em" }}>Net Cash Flow / mo</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: r.cashflow >= 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{fmtSigned(r.cashflow)}</span>
          </div>
        </div>
      </div>

      {/* ══ 8. SAVE BUTTON ═════════════════════════════════════════════════════ */}
      {user ? (
        <button
          onClick={onSave}
          disabled={saved}
          onMouseEnter={e => { if (!saved) { (e.currentTarget as HTMLElement).style.opacity = "0.88"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
          style={{
            width: "100%", padding: "14px",
            background: saved ? "#f1f5f9" : "linear-gradient(135deg,#2563eb,#0ea5e9)",
            color: saved ? "#94a3b8" : "#fff",
            border: `1.5px solid ${saved ? "#e2e8f0" : "transparent"}`,
            borderRadius: 14, fontSize: 13, letterSpacing: "0.06em",
            fontWeight: 700, cursor: saved ? "default" : "pointer",
            fontFamily: "inherit", transition: "all 0.18s",
            boxShadow: saved ? "none" : "0 4px 14px rgba(37,99,235,0.3)",
          }}
        >
          {saved ? "✓  Saved to Dashboard" : "Save Deal →"}
        </button>
      ) : (
        <div style={{
          background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14,
          padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 3 }}>Want to save this deal?</p>
            <p style={{ fontSize: 11, color: "#64748b" }}>Log in to save deals to your dashboard.</p>
          </div>
          <button
            onClick={onOpenLogin}
            style={{
              flexShrink: 0, padding: "9px 20px",
              background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              transition: "opacity 0.15s", boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
            }}
          >
            Log In
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PropertyUrlBar ───────────────────────────────────────────────────────────
interface ParsedProperty {
  address?: string; price?: number; bedrooms?: number; bathrooms?: number;
  sqft?: number; propertyType?: string; yearBuilt?: number; rent?: number;
  source?: string; confidence?: "high" | "medium" | "low";
  rawUrl?: string; warnings?: string[]; error?: string;
  debugInfo?: string[];
}

// Site-specific human-friendly messages (no mention of "403", "blocked", "bot")
const SITE_BLOCKED_MESSAGES: Record<string, { headline: string; sub: string }> = {
  Zillow: {
    headline: "We couldn't fully import this Zillow listing, but we found the address.",
    sub:      "Zillow limits automatic data access. Please fill in the remaining property details manually.",
  },
  Redfin: {
    headline: "We couldn't fully import this Redfin listing, but we found the address.",
    sub:      "Please fill in the price and other details to complete your analysis.",
  },
  "Realtor.com": {
    headline: "We couldn't fully import this Realtor.com listing, but we found the address.",
    sub:      "Please fill in the remaining property details manually.",
  },
  Trulia: {
    headline: "We couldn't fully import this Trulia listing, but we found the address.",
    sub:      "Please fill in the price and details to continue.",
  },
  Unknown: {
    headline: "We couldn't fully import this listing, but we found the address.",
    sub:      "Please fill in the remaining property details manually.",
  },
};

function PropertyUrlBar({ onAutofill }: { onAutofill: (data: ParsedProperty) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [hardError, setHardError] = useState(""); // infra errors: 404, offline, non-JSON
  const [result, setResult] = useState<ParsedProperty | null>(null);
  const [partialResult, setPartialResult] = useState<ParsedProperty | null>(null); // blocked but has partial data

  function reset() {
    setHardError("");
    setResult(null);
    setPartialResult(null);
  }

  async function handleAnalyze() {
    if (!url.trim()) return;
    reset();
    setLoading(true);
    console.log("[Dealistic] → POST /api/parse-property", url.trim());

    let res: Response;
    try {
      res = await fetch("/api/parse-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
    } catch (netErr: unknown) {
      const msg = netErr instanceof Error ? netErr.message : String(netErr);
      console.error("[Dealistic] Network error:", msg);
      setHardError("Cannot reach the server. Make sure npm run dev is running. (" + msg + ")");
      setLoading(false);
      return;
    }

    console.log("[Dealistic] ← status:", res.status);

    if (res.status === 404) {
      setHardError("API route not found. Create app/api/parse-property/route.ts and restart the dev server.");
      setLoading(false);
      return;
    }

    let data: ParsedProperty & { error?: string };
    try {
      data = await res.json();
    } catch (jsonErr) {
      console.error("[Dealistic] Non-JSON response:", jsonErr);
      setHardError(`Server returned a non-JSON response (${res.status}). Check your terminal.`);
      setLoading(false);
      return;
    }

    console.log("[Dealistic] Parsed:", data);

    // 422 = blocked but may have partial URL-based data → soft amber panel
    if (res.status === 422) {
      // Treat as partial result — autofill what we have, show soft message
      setPartialResult({ ...data, error: undefined });
      setLoading(false);
      return;
    }

    if (!res.ok || data.error) {
      // Only truly hard errors (400 bad URL, 500 crash) get a red banner
      const isBlockedError = (data.error ?? "").toLowerCase().includes("block") ||
                             (data.error ?? "").toLowerCase().includes("403");
      if (isBlockedError) {
        // Even on a hard block, treat as partial if the data has an address
        if (data.address) {
          setPartialResult({ ...data, error: undefined });
        } else {
          setPartialResult({ source: data.source ?? "Unknown", confidence: "low", rawUrl: url, warnings: data.warnings ?? [] });
        }
      } else {
        setHardError(data.error ?? `Server error (${res.status}).`);
      }
      setLoading(false);
      return;
    }

    setResult(data);
    setLoading(false);
  }

  function handleUse(data: ParsedProperty) {
    onAutofill(data);
    reset();
    setUrl("");
  }

  const confColor = result?.confidence === "high" ? C.green : result?.confidence === "medium" ? C.amber : C.faint;

  const siteBlockedMsg = partialResult
    ? (SITE_BLOCKED_MESSAGES[partialResult.source ?? "Unknown"] ?? SITE_BLOCKED_MESSAGES.Unknown)
    : "";

  return (
    <div style={{ borderBottom: `1px solid ${C.rule}`, background: C.bg2, padding: "14px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <style>{`@keyframes dealistic-spin { to { transform: rotate(360deg); } }`}</style>

        {/* URL input row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="url"
            value={url}
            onChange={e => { setUrl(e.target.value); reset(); }}
            onKeyDown={e => { if (e.key === "Enter") handleAnalyze(); }}
            placeholder="Paste a Zillow, Redfin, or Realtor.com link to autofill the form"
            style={{
              flex: 1, background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 8,
              color: C.text, fontSize: 13, padding: "9px 14px", outline: "none",
              fontFamily: "inherit", boxSizing: "border-box", transition: "border-color 0.12s",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = C.text; }}
            onBlur={e => { e.currentTarget.style.borderColor = C.rule; }}
          />
          <button
            onClick={handleAnalyze}
            disabled={loading || !url.trim()}
            onMouseEnter={e => { if (!loading && url.trim()) (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            style={{
              flexShrink: 0, padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              letterSpacing: "0.04em", fontFamily: "inherit", whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s",
              background: (loading || !url.trim()) ? C.bg : C.text,
              color:      (loading || !url.trim()) ? C.faint : C.bg,
              border: `1px solid ${(loading || !url.trim()) ? C.rule : C.text}`,
              cursor: (loading || !url.trim()) ? "default" : "pointer",
            }}
          >
            {loading
              ? <><span style={{ width: 12, height: 12, border: `1.5px solid ${C.faint}`, borderTopColor: C.muted, borderRadius: "50%", display: "inline-block", animation: "dealistic-spin 0.7s linear infinite" }} /> Analyzing…</>
              : "Analyze Property"
            }
          </button>
        </div>

        {/* ── HARD ERROR — infra / bad URL only ── */}
        {hardError && (
          <div style={{ marginTop: 10, padding: "11px 14px", background: "#fdf0ef", border: `1px solid ${C.red}`, borderRadius: 7, display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ fontSize: 9, background: C.red, color: "#fff", padding: "2px 6px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, marginTop: 1 }}>Error</span>
            <div>
              <p style={{ fontSize: 12, color: C.red, lineHeight: 1.55 }}>{hardError}</p>
              {hardError.includes("404") && (
                <p style={{ fontSize: 11, color: "#9a4040", marginTop: 5 }}>
                  Create <code style={{ background: "#f5ddd8", padding: "1px 4px", fontSize: 10 }}>app/api/parse-property/route.ts</code> and run <code style={{ background: "#f5ddd8", padding: "1px 4px", fontSize: 10 }}>npm run dev</code>.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── PARTIAL / BLOCKED — calm info panel, not an error ── */}
        {partialResult && (() => {
          const msgs = SITE_BLOCKED_MESSAGES[partialResult.source ?? "Unknown"] ?? SITE_BLOCKED_MESSAGES.Unknown;
          const missingList = [
            !partialResult.price    && "Purchase Price",
            !partialResult.bedrooms && "Beds",
            !partialResult.bathrooms && "Baths",
            !partialResult.sqft     && "Sq Ft",
          ].filter(Boolean) as string[];
          return (
            <div style={{ marginTop: 10, background: "#f5f7ff", border: "1px solid #c8d0f0", borderRadius: 10, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 9, background: "#4a6cf7", color: "#fff", padding: "2px 8px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 3 }}>
                      Address Found
                    </span>
                    {partialResult.source && (
                      <span style={{ fontSize: 10, color: "#6070b0" }}>from {partialResult.source}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "#1a2050", lineHeight: 1.5, marginBottom: 3 }}>
                    {msgs.headline}
                  </p>
                  <p style={{ fontSize: 11, color: "#6070a0", lineHeight: 1.55 }}>
                    {msgs.sub}
                  </p>
                </div>
                <button
                  onClick={() => reset()}
                  style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#8090c0", fontSize: 18, lineHeight: 1, padding: "2px 4px" }}
                  title="Dismiss"
                >×</button>
              </div>

              {/* What we extracted */}
              <div style={{ padding: "0 16px 14px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {partialResult.address && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, background: "#eef0ff", border: "1px solid #c8d0f0", borderRadius: 5, padding: "4px 10px" }}>
                    <span style={{ fontSize: 9, color: "#8090c0", letterSpacing: "0.08em", textTransform: "uppercase" }}>Address</span>
                    <span style={{ fontSize: 12, color: "#1a2050", fontWeight: 500 }}>{partialResult.address}</span>
                  </div>
                )}
                {partialResult.price && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, background: "#eef0ff", border: "1px solid #c8d0f0", borderRadius: 5, padding: "4px 10px" }}>
                    <span style={{ fontSize: 9, color: "#8090c0", letterSpacing: "0.08em", textTransform: "uppercase" }}>Price</span>
                    <span style={{ fontSize: 12, color: "#1a2050", fontWeight: 500 }}>${partialResult.price.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Missing fields + CTA */}
              <div style={{ padding: "12px 16px", background: "#eef0ff", borderTop: "1px solid #c8d0f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <p style={{ fontSize: 11, color: "#4050a0", marginBottom: 4, fontWeight: 500 }}>
                    Still needed to analyze this deal:
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {missingList.map(f => (
                      <span key={f} style={{ fontSize: 10, color: "#4a6cf7", background: "#dde2ff", borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>{f}</span>
                    ))}
                    {missingList.length === 0 && (
                      <span style={{ fontSize: 10, color: "#4a6cf7" }}>All key fields found ✓</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleUse(partialResult)}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#3050e0"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#4a6cf7"; }}
                  style={{ flexShrink: 0, padding: "8px 18px", background: "#4a6cf7", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
                >
                  Autofill Form →
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── FULL SUCCESS — green/amber confidence panel ── */}
        {result && (
          <div style={{ marginTop: 10, padding: "14px 16px", background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, background: confColor, color: "#fff", padding: "2px 7px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {result.confidence === "high" ? "Full Import" : result.confidence === "medium" ? "Partial Data" : "Basic Data"}
                </span>
                {result.source && <span style={{ fontSize: 10, color: C.faint }}>from {result.source}</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { reset(); setUrl(""); }} style={{ fontSize: 10, color: C.faint, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Dismiss</button>
                <button
                  onClick={() => handleUse(result)}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: C.text, color: C.bg, border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s" }}
                >
                  Autofill Form →
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {result.address      && <DataChip label="Address"  value={result.address} />}
              {result.price        && <DataChip label="Price"    value={"$" + result.price.toLocaleString()} />}
              {result.bedrooms     && <DataChip label="Beds"     value={String(result.bedrooms)} />}
              {result.bathrooms    && <DataChip label="Baths"    value={String(result.bathrooms)} />}
              {result.sqft         && <DataChip label="Sq Ft"    value={result.sqft.toLocaleString()} />}
              {result.yearBuilt    && <DataChip label="Built"    value={String(result.yearBuilt)} />}
              {result.propertyType && <DataChip label="Type"     value={result.propertyType} />}
              {result.rent         && <DataChip label="Rent Est." value={"$" + result.rent.toLocaleString() + "/mo"} />}
            </div>

            {result.warnings && result.warnings.length > 0 && (
              <p style={{ fontSize: 10, color: C.amber, marginTop: 10, lineHeight: 1.5 }}>⚠ {result.warnings[0]}</p>
            )}

            {result.debugInfo && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 10, color: C.faint, cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Debug info
                </summary>
                <div style={{ marginTop: 6, padding: "8px 10px", background: C.bg2, borderRadius: 5, fontSize: 10, color: C.muted, lineHeight: 1.7, fontFamily: "monospace" }}>
                  {result.debugInfo!.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DataChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4, background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 5, padding: "4px 10px" }}>
      <span style={{ fontSize: 9, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, fontWeight: 500, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

// ─── Showcase Section — 6 rich illustrated feature cards ─────────────────────

// Shared showcase card shell
// ─── Showcase cards — rich animated feature demonstrations ───────────────────

// Reusable scroll-visibility hook
function useInView(threshold = 0.25) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// Shared showcase card shell — larger visual area, richer text
function ShowCard({
  title, desc, tag, tagColor, children, delay = 0,
}: {
  title: string; desc: string; tag: string; tagColor: string;
  children: React.ReactNode; delay?: number;
}) {
  const [hov, setHov] = useState(false);
  return (
    <FadeIn delay={delay}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: "rgba(255,255,255,0.88)",
          border: `1px solid ${hov ? C.blue + "40" : "rgba(203,213,225,0.5)"}`,
          borderRadius: 28,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          backdropFilter: "blur(12px)",
          transition: "box-shadow 0.25s, transform 0.25s, border-color 0.25s",
          boxShadow: hov
            ? "0 20px 60px rgba(37,99,235,0.16), 0 4px 16px rgba(14,165,233,0.10)"
            : "0 2px 12px rgba(14,165,233,0.07)",
          transform: hov ? "translateY(-6px) scale(1.005)" : "none",
        }}
      >
        {/* Visual demo area */}
        <div style={{
          background: `linear-gradient(160deg, ${C.gradStart} 0%, ${C.gradMid} 60%, ${C.gradEnd} 100%)`,
          padding: "32px 28px 24px",
          minHeight: 220,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Tag badge */}
          <span style={{
            position: "absolute", top: 18, right: 18,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
            background: tagColor + "18", color: tagColor,
            border: `1px solid ${tagColor}40`,
            borderRadius: 999, padding: "3px 10px",
          }}>{tag}</span>
          {children}
        </div>
        {/* Text block */}
        <div style={{ padding: "22px 28px 28px", borderTop: `1px solid ${C.rule}`, background: C.bg }}>
          <p style={{
            fontSize: 15, fontWeight: 700, color: C.text,
            letterSpacing: "-0.025em", marginBottom: 7, lineHeight: 1.25,
          }}>{title}</p>
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.72 }}>{desc}</p>
        </div>
      </div>
    </FadeIn>
  );
}

// ─── Card 1: Financial Breakdown ──────────────────────────────────────────────
function CardFinancial() {
  const { ref, visible } = useInView();
  const bars = [
    { label: "Gross Rent",    val: "$3,450", w: 100, color: C.green },
    { label: "Mortgage P&I", val: "$2,480", w: 72,  color: "#4a6cf7" },
    { label: "Tax & Ins.",   val: "$610",   w: 18,  color: C.amber  },
  ];
  return (
    <div ref={ref}>
      {/* Two headline numbers */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22 }}>
        <div>
          <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Purchase Price</p>
          <p style={{ fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: "-0.045em", lineHeight: 1 }}>$425,000</p>
        </div>
        <div style={{
          textAlign: "right",
          background: "#e8f5ef", border: `1px solid ${C.green}40`,
          borderRadius: 14, padding: "10px 16px",
        }}>
          <p style={{ fontSize: 10, color: C.green, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Net / Month</p>
          <p style={{ fontSize: 26, fontWeight: 800, color: C.green, letterSpacing: "-0.045em", lineHeight: 1 }}>+$360</p>
        </div>
      </div>

      {/* Animated bar breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {bars.map((b, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{b.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: b.color }}>{b.val}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: C.rule, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 999, background: b.color,
                width: visible ? b.w + "%" : "0%",
                transition: `width 1s cubic-bezier(.22,1,.36,1) ${i * 0.14}s`,
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Cash flow pill at bottom */}
      <div style={{
        marginTop: 18, display: "flex", alignItems: "center", gap: 8,
        opacity: visible ? 1 : 0, transition: "opacity 0.5s ease 0.7s",
      }}>
        <div style={{ flex: 1, height: 1, background: C.rule }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.green,
          background: "#e8f5ef", borderRadius: 999, padding: "4px 14px",
          border: `1px solid ${C.green}30`,
        }}>
          ✓ Positive cash flow
        </span>
        <div style={{ flex: 1, height: 1, background: C.rule }} />
      </div>
    </div>
  );
}

// ─── Card 2: Deal Score ───────────────────────────────────────────────────────
function CardDealScore() {
  const { ref, visible } = useInView();
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let n = 0;
    const t = setInterval(() => {
      n += 2; setScore(Math.min(n, 82));
      if (n >= 82) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [visible]);

  const radius = 52, circ = 2 * Math.PI * radius;
  const filled = (score / 100) * circ;
  const scoreColor = score >= 70 ? C.green : score >= 45 ? C.amber : C.red;
  const label = score >= 70 ? "Great Deal" : score >= 45 ? "Average" : "Risky";

  const reasons = [
    { text: "Strong rent-to-price ratio", ok: true },
    { text: "Solid projected cash flow",  ok: true },
    { text: "Healthy DSCR of 1.32",       ok: true },
    { text: "Moderate rehab estimate",    ok: true },
  ];

  return (
    <div ref={ref} style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
      {/* Gauge */}
      <div style={{ flexShrink: 0, position: "relative", width: 120, height: 120 }}>
        <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke={C.rule} strokeWidth="9" />
          <circle cx="60" cy="60" r={radius} fill="none" stroke={scoreColor} strokeWidth="9"
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.05s linear, stroke 0.3s" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 30, fontWeight: 900, color: scoreColor, letterSpacing: "-0.05em", lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: 10, color: C.faint, letterSpacing: "0.06em" }}>/ 100</span>
        </div>
      </div>

      {/* Verdict + reasons */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14,
          background: score >= 70 ? "#e8f5ef" : "#fdf5e8",
          border: `1px solid ${scoreColor}40`,
          borderRadius: 8, padding: "5px 12px",
          opacity: visible ? 1 : 0, transition: "opacity 0.4s ease 0.8s",
        }}>
          <span style={{ fontSize: 14 }}>{score >= 70 ? "🏆" : score >= 45 ? "📊" : "⚠️"}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{label}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reasons.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              opacity: visible ? 1 : 0,
              transform: visible ? "translateX(0)" : "translateX(-12px)",
              transition: `opacity 0.4s ease ${0.6 + i * 0.1}s, transform 0.4s ease ${0.6 + i * 0.1}s`,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                background: C.green + "18", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 9, color: C.green, fontWeight: 900 }}>✓</span>
              </span>
              <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{r.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Card 3: CSV Bulk Upload ──────────────────────────────────────────────────
function CardCSV() {
  const { ref, visible } = useInView();
  const [count, setCount] = useState(0);
  const [rowsShown, setRowsShown] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let n = 0;
    const t = setInterval(() => { n++; setCount(Math.min(n, 24)); if (n >= 24) clearInterval(t); }, 55);
    return () => clearInterval(t);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const timers = [0, 350, 700, 1050].map((d, i) =>
      setTimeout(() => setRowsShown(i + 1), d + 300)
    );
    return () => timers.forEach(clearTimeout);
  }, [visible]);

  const rows = [
    { addr: "1824 Oak Ln, Austin TX",    score: 78, badge: "Strong",   col: C.green },
    { addr: "3301 River Rd, Dallas TX",  score: 64, badge: "Average",  col: C.amber },
    { addr: "920 Pine St, Houston TX",   score: 51, badge: "Average",  col: C.amber },
    { addr: "47 Elm Ave, Fort Worth TX", score: 82, badge: "Strong",   col: C.green },
  ];

  const stats = [
    { val: String(count), sub: "imported" },
    { val: "6",           sub: "strong deals" },
    { val: "7.4%",        sub: "avg cap rate" },
  ];

  return (
    <div ref={ref}>
      {/* Stats strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            flex: 1, background: C.bg, borderRadius: 14, padding: "10px 8px", textAlign: "center",
            border: `1px solid ${C.rule}`,
            opacity: visible ? 1 : 0,
            transform: visible ? "none" : "translateY(10px)",
            transition: `opacity 0.45s ease ${i * 0.08}s, transform 0.45s ease ${i * 0.08}s`,
          }}>
            <p style={{ fontSize: 20, fontWeight: 900, color: C.text, letterSpacing: "-0.04em", lineHeight: 1, margin: 0 }}>{s.val}</p>
            <p style={{ fontSize: 9, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Animated rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: C.bg, borderRadius: 12, padding: "9px 14px",
            border: `1px solid ${C.rule}`,
            opacity: rowsShown > i ? 1 : 0,
            transform: rowsShown > i ? "translateX(0)" : "translateX(-20px)",
            transition: "opacity 0.35s ease, transform 0.35s ease",
          }}>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 12 }}>{r.addr}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.07em",
                background: r.col + "18", color: r.col,
                border: `1px solid ${r.col}40`,
                borderRadius: 999, padding: "2px 8px",
              }}>{r.badge}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: r.col, minWidth: 24, textAlign: "right" }}>{r.score}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Card 4: Side-by-Side Comparison ─────────────────────────────────────────
function CardCompare() {
  const { ref, visible } = useInView();
  const props = [
    { name: "Property A", cashflow:  410, cap: 7.2, score: 81, color: C.green, best: true  },
    { name: "Property B", cashflow:  180, cap: 5.4, score: 63, color: C.amber, best: false },
    { name: "Property C", cashflow:  -90, cap: 3.1, score: 38, color: C.red,   best: false },
  ];
  const maxAbs = 600;

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {props.map((p, i) => {
        const pct = Math.max(5, ((p.cashflow + 150) / (maxAbs + 150)) * 100);
        return (
          <div key={i} style={{
            background: p.best ? "#e8f5ef" : C.bg,
            border: `1px solid ${p.best ? C.green + "50" : C.rule}`,
            borderRadius: 14, padding: "12px 14px",
            opacity: visible ? 1 : 0,
            transform: visible ? "none" : "translateY(14px)",
            transition: `opacity 0.5s ease ${i * 0.13}s, transform 0.5s ease ${i * 0.13}s`,
            position: "relative",
          }}>
            {p.best && (
              <span style={{
                position: "absolute", top: -1, right: 12,
                fontSize: 8, fontWeight: 800, letterSpacing: "0.1em",
                background: C.green, color: "#fff",
                padding: "2px 8px", borderRadius: "0 0 6px 6px",
              }}>BEST</span>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{p.name}</span>
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: p.color }}>
                  {p.cashflow >= 0 ? "+" : ""}${Math.abs(p.cashflow)}/mo
                </span>
                <span style={{ fontSize: 11, color: C.faint }}>{p.cap}% cap</span>
              </div>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: C.rule, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 999, background: p.color,
                width: visible ? pct + "%" : "0%",
                transition: `width 0.85s cubic-bezier(.22,1,.36,1) ${0.45 + i * 0.13}s`,
              }} />
            </div>
          </div>
        );
      })}

      {/* Insight line */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        background: "#f0f8f4", borderRadius: 12, border: `1px solid ${C.green}30`,
        opacity: visible ? 1 : 0, transition: "opacity 0.5s ease 0.7s",
      }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <span style={{ fontSize: 11, color: "#2a6a46", fontWeight: 500, lineHeight: 1.4 }}>
          Property A generates <strong>2.3×</strong> more cash flow than Property B.
        </span>
      </div>
    </div>
  );
}

// ─── Card 5: Save & Organize ──────────────────────────────────────────────────
function CardSave() {
  const { ref, visible } = useInView();
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (!visible) return;
    const timers = [0, 1200, 2400].map((d, i) =>
      setTimeout(() => setActiveIdx(i), d + 600)
    );
    return () => timers.forEach(clearTimeout);
  }, [visible]);

  const deals = [
    { addr: "8901 Maple Dr, Austin TX",     tag: "Offer-worthy",     tagBg: "#e8f5ef", tagColor: C.green,  score: 82, scoreColor: C.green },
    { addr: "204 W 6th St, Dallas TX",      tag: "Reviewed",         tagBg: "#eef0ff", tagColor: C.blue,   score: 71, scoreColor: C.green },
    { addr: "5520 Lakeview Blvd, Plano TX", tag: "Needs better rent",tagBg: "#fdf5e8", tagColor: C.amber,  score: 48, scoreColor: C.amber },
  ];

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {deals.map((d, i) => {
        const isActive = activeIdx === i;
        return (
          <div key={i} style={{
            background: C.bg,
            border: `1px solid ${isActive ? d.tagColor + "60" : C.rule}`,
            borderRadius: 14,
            padding: "12px 14px",
            display: "flex", alignItems: "center", gap: 12,
            opacity: visible ? 1 : 0,
            transform: visible ? "translateX(0)" : "translateX(20px)",
            transition: `opacity 0.45s ease ${0.1 + i * 0.12}s, transform 0.45s ease ${0.1 + i * 0.12}s, border-color 0.3s, box-shadow 0.3s`,
            boxShadow: isActive ? `0 4px 20px ${d.tagColor}20` : "none",
          }}>
            {/* Score bubble */}
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              background: d.scoreColor + "18",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: d.scoreColor, lineHeight: 1, letterSpacing: "-0.04em" }}>{d.score}</span>
              <span style={{ fontSize: 7, color: d.scoreColor, opacity: 0.7 }}>/ 100</span>
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.addr}</p>
              <span style={{ fontSize: 10, background: d.tagBg, color: d.tagColor, border: `1px solid ${d.tagColor}30`, borderRadius: 999, padding: "2px 9px", fontWeight: 600 }}>
                {d.tag}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card 6: Paste Listing Link ───────────────────────────────────────────────
function CardPasteLink() {
  const { ref, visible } = useInView(0.2);
  const [phase, setPhase] = useState<"idle"|"typing"|"analyzing"|"done">("idle");
  const [typed, setTyped] = useState("");
  const fullUrl = "zillow.com/homedetails/11230-Cotillion-Dallas-TX-75228";

  useEffect(() => {
    if (!visible || phase !== "idle") return;
    const t = setTimeout(() => setPhase("typing"), 500);
    return () => clearTimeout(t);
  }, [visible, phase]);

  useEffect(() => {
    if (phase !== "typing") return;
    let i = 0;
    const t = setInterval(() => {
      i++; setTyped(fullUrl.slice(0, i));
      if (i >= fullUrl.length) { clearInterval(t); setTimeout(() => setPhase("analyzing"), 400); }
    }, 24);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "analyzing") return;
    const t = setTimeout(() => setPhase("done"), 900);
    return () => clearTimeout(t);
  }, [phase]);

  const fields = [
    { icon: "📍", label: "Address", value: "11230 Cotillion Dr, Dallas TX 75228" },
    { icon: "🏠", label: "Source",  value: "Zillow"  },
    { icon: "⚡", label: "Status",  value: "Ready to analyze" },
  ];

  return (
    <div ref={ref}>
      {/* URL input */}
      <div style={{
        background: C.bg, borderRadius: 14, padding: "11px 14px", marginBottom: 14,
        border: `2px solid ${phase === "done" ? C.green : phase === "analyzing" ? C.amber : C.rule}`,
        display: "flex", alignItems: "center", gap: 10,
        transition: "border-color 0.4s",
        boxShadow: phase === "done" ? `0 0 0 4px ${C.green}15` : "none",
      }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🔗</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: phase === "done" ? C.text : C.muted }}>
          {typed || <span style={{ color: C.faint, fontStyle: "italic" }}>Paste a Zillow or Redfin link…</span>}
          {phase === "typing" && <span style={{ display: "inline-block", width: 2, height: 12, background: C.text, marginLeft: 1, verticalAlign: "middle", animation: "dealistic-spin 0.8s step-start infinite" }} />}
        </span>
        {phase === "analyzing" && (
          <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.amber }}>
            <span style={{ width: 10, height: 10, border: `1.5px solid ${C.amber}`, borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "dealistic-spin 0.6s linear infinite" }} />
            Analyzing
          </span>
        )}
        {phase === "done" && (
          <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", background: C.green, color: "#fff", padding: "3px 9px", borderRadius: 999 }}>FOUND</span>
        )}
      </div>

      {/* Result fields */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fields.map((f, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: C.bg, borderRadius: 12, padding: "10px 13px",
            border: `1px solid ${C.rule}`,
            opacity: phase === "done" ? 1 : 0,
            transform: phase === "done" ? "none" : "translateY(10px)",
            transition: `opacity 0.4s ease ${i * 0.12}s, transform 0.4s ease ${i * 0.12}s`,
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{f.icon}</span>
            <span style={{ fontSize: 9, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase", width: 44, flexShrink: 0 }}>{f.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: f.label === "Status" ? C.green : C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Showcase Section wrapper ─────────────────────────────────────────────────
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

        {/* Section header */}
        <FadeIn>
          <div style={{ marginBottom: 60 }}>
            <p style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, fontWeight: 600, marginBottom: 14 }}>
              What you get
            </p>
            <h2 style={{
              fontSize: "clamp(32px,4vw,52px)", fontWeight: 800,
              letterSpacing: "-0.04em", color: C.text,
              lineHeight: 1.08, margin: "0 0 18px", maxWidth: 620,
            }}>
              Every tool to analyze,<br />compare, and decide.
            </h2>
            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, maxWidth: 440, margin: 0 }}>
              From a single URL to a full portfolio — Dealistic gives you the numbers that matter.
            </p>
          </div>
        </FadeIn>

        {/* 2-column grid — collapses to 1 col on mobile */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <ShowCard
            title="Full Financial Breakdown"
            tag="Cash Flow" tagColor={C.green}
            delay={0}
            desc="See mortgage, taxes, insurance, and net cash flow side by side — before you ever make an offer."
          >
            <CardFinancial />
          </ShowCard>

          <ShowCard
            title="Deal Score — 1 to 100"
            tag="AI Score" tagColor={C.blue}
            delay={0.08}
            desc="Every deal gets a score. See exactly why it's great, average, or risky — in plain language."
          >
            <CardDealScore />
          </ShowCard>

          <ShowCard
            title="CSV Bulk Upload"
            tag="Batch Import" tagColor={C.amber}
            delay={0.14}
            desc="Import dozens of deals at once. Strong deals are flagged automatically so you know where to focus."
          >
            <CardCSV />
          </ShowCard>

          <ShowCard
            title="Side-by-Side Comparison"
            tag="Compare" tagColor="#7c3aed"
            delay={0.20}
            desc="Stack properties head-to-head on every metric. The winner is always obvious."
          >
            <CardCompare />
          </ShowCard>

          <ShowCard
            title="Save & Organize"
            tag="Dashboard" tagColor={C.green}
            delay={0.26}
            desc="Tag deals, track your pipeline, and revisit your best opportunities from one clean dashboard."
          >
            <CardSave />
          </ShowCard>

          <ShowCard
            title="Paste Any Listing Link"
            tag="Auto-Import" tagColor={C.amber}
            delay={0.32}
            desc="Drop in a Zillow or Redfin URL. We extract the address and get your analysis started instantly."
          >
            <CardPasteLink />
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
  const fullUrl = "zillow.com/homedetails/8901-Maple-Dr-Austin-TX";

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
          {typed || <span style={{ color: C.faint, fontStyle: "italic" }}>Paste a Zillow or Redfin link…</span>}
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
            { n: "01", color: C.blue,        icon: "🔗", title: "Paste a link or enter details", desc: "Drop in a Zillow URL, upload a CSV, or fill in a few fields. Smart defaults fill in what you skip." },
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
  if (!Object.values(mapping).includes("purchase_price")) {
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
}

function CsvMappingUI({ csvParsed, csvMapping, setCsvMapping, onNext, onCancel }: CsvMappingUIProps) {
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

  // ── Market dataset BLOCKER — shown instead of mapping UI ──
  if (safeDataset.isMarketDataset) {
    return (
      <div>
        <div style={{ padding: "20px 24px", background: "#fdf5e8", border: "1px solid #e8c87a", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 9, background: C.amber, color: "#fff", padding: "3px 8px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, marginTop: 2 }}>Wrong Format</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#6a4000", marginBottom: 6 }}>
                This appears to be a market dataset (e.g. Zillow), not a property deal file.
              </p>
              <p style={{ fontSize: 12, color: "#9a7020", lineHeight: 1.65 }}>
                Dealistic expects one row per property with fields like purchase price, rent, and loan details.
                This file looks like a time-series or geographic dataset.
              </p>
            </div>
          </div>
          {safeDataset.marketSignals.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e8c87a" }}>
              <p style={{ fontSize: 10, color: "#9a7020", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Why we flagged it</p>
              {safeDataset.marketSignals.map(s => (
                <p key={s} style={{ fontSize: 11, color: "#7a5500", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #e8c87a" }}>{s}</p>
              ))}
            </div>
          )}
        </div>

        {/* Column preview table */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
            Your file's columns ({csvParsed.headers.length} total)
          </p>
          <div style={{ overflowX: "auto", border: `1px solid ${C.rule}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: C.bg2, borderBottom: `1px solid ${C.rule}` }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>Column</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>Type</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>Sample</th>
                </tr>
              </thead>
              <tbody>
                {csvParsed.headers.slice(0, 12).map(h => {
                  const sample = csvParsed.rows.slice(0, 2).map(r => r[h]).filter(Boolean).join(", ");
                  const noise = isNoiseColumn(h);
                  return (
                    <tr key={h} style={{ borderBottom: `1px solid ${C.rule}`, opacity: noise ? 0.5 : 1 }}>
                      <td style={{ padding: "8px 12px", color: C.text, fontWeight: 500 }}>{h}{noise ? " ✕" : ""}</td>
                      <td style={{ padding: "8px 12px", color: C.faint }}>{csvParsed.colTypes[h]}</td>
                      <td style={{ padding: "8px 12px", color: C.faint, fontStyle: "italic", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample || "—"}</td>
                    </tr>
                  );
                })}
                {csvParsed.headers.length > 12 && (
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 12px", color: C.faint, fontStyle: "italic", textAlign: "center" }}>
                      + {csvParsed.headers.length - 12} more columns
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.65 }}>
          <strong style={{ color: C.text }}>What Dealistic needs:</strong> a CSV with one row per property — columns like <code style={{ fontSize: 11, background: C.bg2, padding: "1px 5px" }}>purchase_price</code>, <code style={{ fontSize: 11, background: C.bg2, padding: "1px 5px" }}>monthly_rent</code>, <code style={{ fontSize: 11, background: C.bg2, padding: "1px 5px" }}>address</code>.
          Download the template below to see the expected format.
        </p>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onCancel}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            style={{ flex: 1, padding: "13px", background: C.text, color: C.bg, border: "none", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s" }}>
            Upload a Different File
          </button>
        </div>
      </div>
    );
  }

  // ── Normal mapping UI ──────────────────────────────────────────────────────
  return (
    <div>
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
            {hasPriceMapping ? "✓ Purchase Price mapped" : "Purchase Price required"}
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
        <p style={{ fontSize: 11, color: C.red, marginTop: 10 }}>Map at least one column to Purchase Price to continue.</p>
      )}
    </div>
  );
}

const EMPTY_FORM: Record<string, string> = {
  address: "", state: "", price: "", down: "", rate: "", term: "30",
  rent: "", vacancy: "5", taxes: "", insurance: "",
  hoa: "0", repairs: "", mgmt: "", other: "0",
};

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
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showRentEstimate, setShowRentEstimate] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const [showRentometer, setShowRentometer] = useState(false);
  const [csvError, setCsvError] = useState("");
  const [csvParsed, setCsvParsed] = useState<CsvParsed | null>(null);
  const [csvMapping, setCsvMapping] = useState<Record<string,CsvField>>({});
  const [csvStep, setCsvStep] = useState<"upload"|"map"|"preview">("upload");
  const [urlAutofillNotice, setUrlAutofillNotice] = useState<string | null>(null);
  const [highlightFields, setHighlightFields] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rentInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

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
      taxes: pf(filled.taxes),
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

  function handleUrlAutofill(data: ParsedProperty) {
    const updated: Record<string, string> = { ...form };
    if (data.address)  updated.address = data.address;
    if (data.price)    updated.price   = String(data.price);
    if (data.rent)     updated.rent    = String(data.rent);
    if (data.bedrooms) updated.beds    = String(data.bedrooms);
    if (data.bathrooms) updated.baths  = String(data.bathrooms);
    if (data.rent && appMode !== "investor") setAppMode("investor");
    setForm(updated);
    setResult(null);
    setSaved(false);

    // Compute which important fields are still empty → highlight them
    const missing = new Set<string>();
    if (!data.price)     missing.add("price");
    if (!data.rent)      missing.add("rent");
    if (!data.bedrooms)  missing.add("beds");
    if (!data.bathrooms) missing.add("baths");
    if (!data.sqft)      missing.add("sqft");
    setHighlightFields(missing);
    // Clear highlights after 12s so they don't linger forever
    setTimeout(() => setHighlightFields(new Set()), 12000);

    const filled  = [data.address && "address", data.price && "price", data.rent && "rent"].filter(Boolean) as string[];
    setUrlAutofillNotice(
      filled.length > 0
        ? `Pre-filled: ${filled.join(", ")}. Complete the highlighted fields below.`
        : "Address found from URL. Please fill in the highlighted fields to continue."
    );
    setTimeout(() => setUrlAutofillNotice(null), 10000);

    // Focus price field if missing, otherwise scroll to form
    setTimeout(() => {
      if (!data.price && priceInputRef.current) {
        priceInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        priceInputRef.current.focus();
      } else {
        window.scrollTo({ top: 220, behavior: "smooth" });
      }
    }, 200);
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
      // Market datasets always show the blocker — never skip to preview
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
          <div style={{ paddingTop: 20, paddingBottom: 20 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", margin: 0, color: "#0f172a", lineHeight: 1.2 }}>
              {isBuyer ? "Home Buyer Calculator" : "Deal Analyzer"}
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", marginTop: 5 }}>
              {isBuyer ? "Understand your monthly costs before you buy" : "Enter details or upload a CSV"}
            </p>
          </div>

        </div>
      </div>

      {/* URL autofill bar */}
      <PropertyUrlBar onAutofill={handleUrlAutofill} />

      {/* Autofill notice with highlighted field checklist */}
      {urlAutofillNotice && (
        <div style={{ padding: "10px 32px", background: "#f5f7ff", borderBottom: "1px solid #c8d0f0", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 9, background: "#4a6cf7", color: "#fff", padding: "2px 7px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 3, flexShrink: 0 }}>
            Imported
          </span>
          <p style={{ fontSize: 12, color: "#1a2050", flex: 1 }}>{urlAutofillNotice}</p>
          {highlightFields.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: "#6070a0" }}>Complete:</span>
              {[...highlightFields].map(f => (
                <span key={f} style={{ fontSize: 10, background: "#dde2ff", color: "#4a6cf7", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>
                  {f === "price" ? "Price" : f === "rent" ? "Rent" : f === "beds" ? "Beds" : f === "baths" ? "Baths" : "Sq Ft"}
                </span>
              ))}
            </div>
          )}
          <button onClick={() => { setUrlAutofillNotice(null); setHighlightFields(new Set()); }} style={{ fontSize: 14, color: "#8090c0", background: "none", border: "none", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>×</button>
        </div>
      )}

      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "clamp(20px,3vw,40px) clamp(16px,3vw,40px)" }}>

        {/* ── Manual Mode ── */}
        {mode === "manual" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "clamp(16px,2.5vw,32px)", alignItems: "start" }}>

            {/* Form column */}
            <div>
              {/* Property Details */}
              <div className="az-card" style={{ marginBottom: 20 }}>
                <SectionLabel text="Property Details" />
                {/* Address + State row */}
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
                  <label className="az-label">
                    Address <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="123 Main St, Austin TX"
                      value={form.address}
                      onChange={e => setField("address")(e.target.value)}
                      className="az-input"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <select
                      value={form.state}
                      onChange={e => setField("state")(e.target.value)}
                      className="az-select"
                      style={{ width: 100, flexShrink: 0 }}
                    >
                      <option value="">State</option>
                      {US_STATES.map(s => (
                        <option key={s.abbr} value={s.abbr}>{s.abbr}</option>
                      ))}
                    </select>
                  </div>
                  <p className="az-hint">Used to label your saved deal. Selecting a state unlocks a market overview.</p>
                </div>
                {/* State summary card — appears when state is selected */}
                <StateSummaryCard stateAbbr={form.state} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
                  {/* Purchase Price — has ref for URL autofill focus */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <label className="az-label">Purchase Price</label>
                    </div>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.faint, pointerEvents: "none" }}>$</span>
                      <input
                        ref={priceInputRef}
                        type="number"
                        placeholder="325,000"
                        value={form.price}
                        onChange={e => setField("price")(e.target.value)}
                        className="az-input az-input-prefix"
                        style={{ border: highlightFields.has("price") ? "1.5px solid #2563eb" : undefined, boxShadow: highlightFields.has("price") ? "0 0 0 3px rgba(37,99,235,0.14)" : undefined }}
                      />
                    </div>
                    <p className="az-hint">The agreed sale price — find it on Zillow or your MLS listing.</p>
                  </div>
                  <SmartField
                    label="Down Payment" placeholder="65,000" prefix="$"
                    value={form.down} onChange={setField("down")}
                    hint="Typically 20–25% for investment properties."
                    tooltip="Usually 20–25% of purchase price for rentals"
                  />
                  <SmartField
                    label="Interest Rate" placeholder="7.25" suffix="%"
                    value={form.rate} onChange={setField("rate")}
                    hint="Check current rates at Bankrate.com or ask your lender."
                    tooltip="Check Bankrate.com for today's investment rates"
                  />
                  <SmartField
                    label="Loan Term (yrs)" placeholder="30"
                    value={form.term} onChange={setField("term")}
                    hint="30 years is standard. 15 years = higher payments, less interest."
                  />
                </div>
              </div>

              {/* Income — investor mode only */}
              {!isBuyer && <div className="az-card" style={{ marginBottom: 20 }}>
                <SectionLabel text="Rental Income" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>

                  {/* Rent field — custom, not SmartField, so we can attach a ref and the estimator */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <label className="az-label">
                        Monthly Rent <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
                      </label>
                      {priceVal > 0 && (
                        <button
                          onClick={() => setShowRentEstimate(v => !v)}
                          className="az-btn-ghost"
                          style={{ fontSize: 10 }}
                        >
                          {showRentEstimate ? "Hide" : "Estimate Rent"}
                        </button>
                      )}
                    </div>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.faint, pointerEvents: "none" }}>$</span>
                      <input
                        ref={rentInputRef}
                        type="number"
                        placeholder="2,400"
                        value={form.rent}
                        onChange={e => setField("rent")(e.target.value)}
                        className="az-input az-input-prefix"
                        style={{ border: highlightFields.has("rent") ? "1.5px solid #2563eb" : undefined, boxShadow: highlightFields.has("rent") ? "0 0 0 3px rgba(37,99,235,0.14)" : undefined }}
                      />
                    </div>
                    <p className="az-hint">Leave blank to see mortgage &amp; cost estimates only.</p>
                    {/* Rent estimator — rendered as a component, not an IIFE */}
                    {showRentEstimate && priceVal > 0 && (
                      <RentEstimatorPanel price={priceVal} onSelect={handleRentEstimate} />
                    )}
                  </div>

                  <SmartField
                    label="Vacancy Rate" placeholder="5" suffix="%"
                    value={form.vacancy} onChange={setField("vacancy")}
                    autoLabel="Default 5%"
                    hint="Months the unit sits empty per year. 5% ≈ 3 weeks. Most markets: 5–10%."
                    tooltip="5–8% is typical for most rental markets"
                  />
                </div>

                {/* Rental Comps toggle */}
                <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <button
                    onClick={() => setShowComps(v => !v)}
                    className="az-btn-ghost"
                  >
                    {showComps ? "Hide Rental Comps" : "Add Rental Comps"}
                  </button>
                  {!showComps && (
                    <p style={{ fontSize: 11, color: C.faint, fontStyle: "italic" }}>
                      Compare similar nearby units to validate rent
                    </p>
                  )}
                </div>
                {showComps && <RentalCompsSection onUseAverage={handleUseAverage} />}

                {/* Rentometer reference toggle */}
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <button
                    onClick={() => setShowRentometer(v => !v)}
                    className="az-btn-ghost"
                  >
                    {showRentometer ? "Hide Rentometer" : "Look Up on Rentometer"}
                  </button>
                  {!showRentometer && (
                    <p style={{ fontSize: 11, color: C.faint, fontStyle: "italic" }}>
                      Real market rent data by zip code
                    </p>
                  )}
                </div>
                {showRentometer && <RentometerSection address={form.address} />}
              </div>}

              {/* Expenses */}
              <div className="az-card">
                <SectionLabel text="Monthly Expenses" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
                  <SmartField
                    label="Property Taxes" placeholder="350" prefix="$"
                    value={form.taxes} onChange={setField("taxes")}
                    hint="Typically 1–2% of price/year. Check your county assessor's site."
                    tooltip="Check your county assessor's website"
                  />
                  <SmartField
                    label="Insurance" placeholder="120" prefix="$"
                    value={form.insurance} onChange={setField("insurance")}
                    autoLabel="Auto-estimate"
                    hint="Landlord insurance ≈ 0.65% of price/year. We estimate if left blank."
                    tooltip="We estimate ~0.65% of price/year if left blank"
                  />
                  <SmartField
                    label="HOA Fees" placeholder="0" prefix="$"
                    value={form.hoa} onChange={setField("hoa")}
                    hint="Check the listing or ask the agent. Enter 0 if none."
                    tooltip="Listed in the MLS or ask the seller's agent"
                  />
                  {!isBuyer && <>
                  <SmartField
                    label="Repairs & Maintenance" placeholder="150" prefix="$"
                    value={form.repairs} onChange={setField("repairs")}
                    autoLabel="Default 5% rent"
                    hint="Budget ~5% of rent/mo. We fill this if left blank."
                    tooltip="Rule of thumb: 5% of monthly rent"
                  />
                  <SmartField
                    label="Property Management" placeholder="200" prefix="$"
                    value={form.mgmt} onChange={setField("mgmt")}
                    autoLabel="Default 8% rent"
                    hint="Self-managing? Enter 0. Managers typically charge 8–10% of rent."
                    tooltip="Typically 8–10% of monthly rent"
                  />
                  </>}
                  <SmartField
                    label="Other Monthly Costs" placeholder="50" prefix="$"
                    value={form.other} onChange={setField("other")}
                    hint={isBuyer ? "HOA, lawn care, utilities you pay as the owner." : "Utilities, lawn care, pest control, etc. you pay as landlord."}
                  />
                </div>

                {/* TIP callout */}
                <div className="az-tip">
                  <span style={{ fontSize: 9, background: "#2563eb", color: "#fff", padding: "2px 8px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 4, flexShrink: 0, marginTop: 1 }}>TIP</span>
                  <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.55 }}>
                    Leave <strong style={{ color: "#0f172a", fontWeight: 600 }}>Repairs</strong>, <strong style={{ color: "#0f172a", fontWeight: 600 }}>Management</strong>, and <strong style={{ color: "#0f172a", fontWeight: 600 }}>Insurance</strong> blank — we apply smart defaults automatically.
                  </p>
                </div>

                <button
                  onClick={analyze}
                  className="az-btn-primary"
                >
                  {isBuyer ? "Calculate My Costs" : "Analyze This Deal"}
                </button>
              </div>
            </div>

            {/* Results column — sticky on desktop */}
            <div style={{ position: "sticky", top: 72, alignSelf: "start" }}>
              {!result ? (
                <div className="az-empty-state">
                  <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.25 }}>📊</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#475569", marginBottom: 8 }}>
                    {isBuyer ? "Your cost breakdown will appear here" : "Your deal analysis will appear here"}
                  </p>
                  <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                    {isBuyer ? "Fill in your purchase details and click Calculate." : "Enter the property details and click Analyze This Deal."}
                  </p>
                </div>
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
      <section style={{ maxWidth: 860, margin: "0 auto", padding: "0 clamp(16px,4vw,40px) clamp(40px,5vw,64px)" }}>
        <FadeIn>
          <span style={eyebrow("A · Inputs", "#2563eb")}>A · Inputs</span>
          <h2 style={sectionH2}>What Dealistic needs from you.</h2>
          <p style={{ ...prose, maxWidth: 620, marginBottom: 32 }}>
            Dealistic works with whatever you have. You can paste a Zillow or Redfin listing link to auto-fill the address, enter everything manually, or upload a CSV to analyze multiple properties at once. The only truly required field is a purchase price — everything else either auto-fills or falls back to a smart default based on market norms.
          </p>
        </FadeIn>

        {/* Input groups */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
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
              <div style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", letterSpacing: "0.02em" }}>{g.group}</span>
                </div>
                <div style={{ padding: "4px 0" }}>
                  {g.fields.map((f, fi) => (
                    <div key={fi} style={{ padding: "11px 18px", borderBottom: fi < g.fields.length - 1 ? "1px solid #f8fafc" : "none" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 3 }}>{f.name}</p>
                      <p style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55, margin: 0 }}>{f.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Import methods */}
        <FadeIn delay={0.2}>
          <div style={{ marginTop: 20, background: "linear-gradient(135deg, #eff6ff, #f0fdf4)", border: "1px solid #bfdbfe", borderRadius: 16, padding: "20px 22px", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, flexShrink: 0 }}>💡</div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", marginBottom: 6 }}>Three ways to start an analysis</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px" }}>
                {["Paste a Zillow or Redfin URL — address auto-fills instantly", "Upload a CSV to analyze dozens of properties at once", "Type numbers manually — defaults fill in what you skip"].map((t, i) => (
                  <p key={i} style={{ fontSize: 12, color: "#2563eb", margin: 0 }}>→ {t}</p>
                ))}
              </div>
            </div>
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
          <li><strong>Zillow / Redfin</strong> — pasting a listing URL fetches publicly available listing data. No personal data is sent.</li>
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
function AuthField({
  label, type, value, onChange, error, placeholder, hint,
}: {
  label: string; type: string; value: string; placeholder: string;
  onChange: (v: string) => void; error?: string; hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, fontWeight: 500 }}>
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
          width: "100%",
          background: C.bg2,
          border: `1px solid ${error ? C.red : focused ? C.text : C.rule}`,
          borderRadius: 0,
          color: C.text,
          fontSize: 14,
          padding: "12px 14px",
          outline: "none",
          fontFamily: "inherit",
          transition: "border-color 0.12s",
          boxSizing: "border-box",
        }}
      />
      {error && <p style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: 11, color: C.faint, marginTop: 2, fontStyle: "italic" }}>{hint}</p>}
    </div>
  );
}

// ─── User store — persisted to localStorage ───────────────────────────────────
type StoredUser = { email: string; name: string; passwordHash: string };

function hashish(s: string): string {
  // Deterministic cheap hash — NOT for production use
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
  return String(h);
}

function getUsers(): StoredUser[] {
  return lsGet<StoredUser[]>(LS_USERS) ?? [];
}
function saveUsers(users: StoredUser[]): void {
  lsSet(LS_USERS, users);
}

function validate(email: string, password: string, name?: string) {
  const errs: Record<string, string> = {};
  if (!email.trim()) errs.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address.";
  if (!password) errs.password = "Password is required.";
  else if (password.length < 8) errs.password = "Password must be at least 8 characters.";
  if (name !== undefined && !name.trim()) errs.name = "Name is required.";
  return errs;
}

// ── Sign Up Page ──────────────────────────────────────────────────────────────
function SignUpPage({
  onSuccess, onGoLogin,
}: { onSuccess: (user: AuthUser) => void; onGoLogin: () => void; }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    setSubmitted(true);
    const errs = validate(email, password, name);
    if (confirm !== password) errs.confirm = "Passwords do not match.";
    const users = getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      errs.email = "An account with this email already exists.";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const stored = { email: email.toLowerCase(), name: name.trim(), passwordHash: hashish(password) };
    saveUsers([...users, stored]);
    onSuccess({ email: stored.email, name: stored.name, loginAt: new Date().toISOString() });
  }

  const e = submitted ? errors : {};

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 12 }}>Dealistic</p>
          <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em", color: C.text, margin: 0 }}>Create account</h1>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
            Already have an account?{" "}
            <button onClick={onGoLogin} style={{ background: "none", border: "none", color: C.blue, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>
              Log in
            </button>
          </p>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <AuthField label="Full Name" type="text" placeholder="Jane Smith" value={name} onChange={setName} error={e.name} />
          <AuthField label="Email" type="email" placeholder="you@example.com" value={email} onChange={setEmail} error={e.email} />
          <AuthField
            label="Password" type="password" placeholder="Min. 8 characters" value={password} onChange={setPassword}
            error={e.password} hint="At least 8 characters."
          />
          <AuthField label="Confirm Password" type="password" placeholder="Repeat password" value={confirm} onChange={setConfirm} error={e.confirm} />

          <button
            onClick={handleSubmit}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            style={{ width: "100%", padding: "15px", background: C.text, color: C.bg, border: "none", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s", marginTop: 4 }}
          >
            Create Account
          </button>
        </div>

        <p style={{ fontSize: 10, color: C.faint, marginTop: 24, lineHeight: 1.6, textAlign: "center" }}>
          By signing up, you agree to our Terms and Privacy Policy.<br />Your data is stored in this browser session only.
        </p>
      </div>
    </div>
  );
}

// ── Log In Page ───────────────────────────────────────────────────────────────
function LogInPage({
  onSuccess, onGoSignUp,
}: { onSuccess: (user: AuthUser) => void; onGoSignUp: () => void; }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    setSubmitted(true);
    const errs = validate(email, password);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const users = getUsers();
    const match = users.find(
      u => u.email === email.toLowerCase() && u.passwordHash === hashish(password)
    );
    if (!match) {
      setErrors({ general: "Email or password is incorrect." });
      return;
    }
    onSuccess({ email: match.email, name: match.name, loginAt: new Date().toISOString() });
  }

  const e = submitted ? errors : {};

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 12 }}>Dealistic</p>
          <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em", color: C.text, margin: 0 }}>Log in</h1>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
            No account?{" "}
            <button onClick={onGoSignUp} style={{ background: "none", border: "none", color: C.blue, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>
              Sign up free
            </button>
          </p>
        </div>

        {/* General error */}
        {e.general && (
          <div style={{ padding: "12px 14px", background: "#fdf0ef", border: `1px solid ${C.red}`, marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: C.red }}>{e.general}</p>
          </div>
        )}

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <AuthField label="Email" type="email" placeholder="you@example.com" value={email} onChange={setEmail} error={e.email} />
          <AuthField label="Password" type="password" placeholder="Your password" value={password} onChange={setPassword} error={e.password} />

          <button
            onClick={handleSubmit}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            style={{ width: "100%", padding: "15px", background: C.text, color: C.bg, border: "none", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s", marginTop: 4 }}
          >
            Log In
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Account Page ──────────────────────────────────────────────────────────────
function AccountPage({
  user, onLogOut, onNavigate,
}: { user: AuthUser; onLogOut: () => void; onNavigate: (p: Page) => void; }) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 12 }}>Dealistic</p>
          <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em", color: C.text, margin: 0 }}>Account</h1>
        </div>

        {/* User info card */}
        <div style={{ border: `1px solid ${C.rule}`, marginBottom: 20 }}>
          <div style={{ padding: "20px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: "50%", background: C.pill,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.pillTxt, textTransform: "uppercase" }}>
                {user.name.charAt(0)}
              </span>
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, color: C.text, marginBottom: 2 }}>{user.name}</p>
              <p style={{ fontSize: 12, color: C.faint }}>{user.email}</p>
            </div>
          </div>

          {[
            { label: "Analyzer", action: () => onNavigate("analyzer") },
            { label: "My Deals", action: () => onNavigate("dashboard") },
            
          ].map((item, i, arr) => (
            <button
              key={item.label}
              onClick={item.action}
              style={{
                width: "100%", padding: "14px 20px", background: "transparent", border: "none",
                borderBottom: i < arr.length - 1 ? `1px solid ${C.rule}` : "none",
                textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 13, color: C.text, transition: "background 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {item.label}
              <span style={{ fontSize: 16, color: C.faint, lineHeight: 1 }}>→</span>
            </button>
          ))}
        </div>

        {/* Log out */}
        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            style={{ width: "100%", padding: "13px", background: "transparent", color: C.muted, border: `1px solid ${C.rule}`, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.red; (e.currentTarget as HTMLElement).style.borderColor = C.red; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; (e.currentTarget as HTMLElement).style.borderColor = C.rule; }}
          >
            Log Out
          </button>
        ) : (
          <div style={{ border: `1px solid ${C.rule}`, padding: "16px 20px" }}>
            <p style={{ fontSize: 13, color: C.text, marginBottom: 14 }}>Are you sure you want to log out?</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={onLogOut}
                style={{ flex: 1, padding: "10px", background: C.red, color: "#fff", border: "none", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                Log Out
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, padding: "10px", background: "transparent", color: C.muted, border: `1px solid ${C.rule}`, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Session info */}
        {user.loginAt && (
          <div style={{ marginTop: 16, padding: "10px 14px", background: C.bg2, border: `1px solid ${C.rule}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>Last sign-in</span>
            <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
              {new Date(user.loginAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
        <p style={{ fontSize: 10, color: C.faint, marginTop: 16, textAlign: "center", lineHeight: 1.6 }}>
          Your session persists across page refreshes. Account data is stored locally in this browser.
        </p>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function Dealistic() {
  const [page, setPage] = useState<Page>("landing");
  const [authPage, setAuthPage] = useState<AuthPage | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deals, setDeals] = useState<SavedDeal[]>([]);


  // ── Restore session + deals on mount ────────────────────────────────────
  useEffect(() => {
    const session = lsGet<AuthUser>(LS_SESSION);
    if (session?.email && session?.name) {
      setUser(session);
      // Restore deals for this user
      const allDeals = lsGet<SavedDeal[]>(LS_DEALS) ?? [];
      const myDeals = allDeals.filter(d => d.userEmail === session.email);
      if (myDeals.length > 0) setDeals(myDeals);
    }
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


  const navigate = (p: Page) => { setPage(p); setAuthPage(null); setMenuOpen(false); window.scrollTo(0, 0); };
  const openAuth = (ap: AuthPage) => { setAuthPage(ap); setMenuOpen(false); window.scrollTo(0, 0); };

  function handleAuthSuccess(u: AuthUser) {
    lsSet(LS_SESSION, u);   // persist session
    setUser(u);
    setAuthPage(null);
    window.scrollTo(0, 0);
  }
  function handleLogOut() {
    lsDel(LS_SESSION);      // clear session
    setUser(null);
    setDeals([]);           // clear in-memory deals for this session
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
        .az-input {
          width: 100%;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          color: #0f172a;
          font-size: 14px;
          padding: 12px 14px;
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

        .az-input-prefix { padding-left: 34px; }
        .az-input-suffix { padding-right: 38px; }

        .az-select {
          width: 100%;
          background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 12px center;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          color: #0f172a;
          font-size: 13px;
          padding: 12px 36px 12px 14px;
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
          border-radius: 20px;
          padding: 28px;
          box-shadow: 0 1px 3px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04);
          transition: box-shadow 0.2s;
        }

        .az-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 18px;
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
          font-size: 12px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 6px;
          display: block;
        }

        .az-hint {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 5px;
          line-height: 1.5;
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

      {/* ── Global top nav bar — in-flow, never overlaps content ── */}
      {!authPage && (
        <div style={{
          position: "sticky", top: 0, zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 24px", height: 52,
          background: "rgba(255,255,255,0.82)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.rule}`,
        }}>
          {/* Left: hamburger menu button */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            title="Open menu"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 4.5, width: 36, height: 36, border: "none", borderRadius: 7,
              background: "transparent", cursor: "pointer", transition: "background 0.15s", flexShrink: 0,
            }}
          >
            {[0, 1, 2].map(i => (
              <span key={i} style={{ display: "block", width: 17, height: 1.5, background: C.text, borderRadius: 1 }} />
            ))}
          </button>

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
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.pill, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.pillTxt, textTransform: "uppercase" }}>{user.name.charAt(0)}</span>
              </div>
              <span style={{ fontSize: 11, color: C.text, fontWeight: 500, letterSpacing: "0.03em" }}>Account</span>
            </button>
          ) : (
            <button
              onClick={() => openAuth("login")}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.text; (e.currentTarget as HTMLElement).style.color = C.bg; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text; }}
              style={{
                padding: "6px 14px", background: "transparent", border: `1px solid ${C.rule}`,
                borderRadius: 999, fontSize: 11, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit", color: C.text,
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}
            >
              Log In
            </button>
          )}
        </div>
      )}

      {/* Fullscreen menu overlay */}
      {menuOpen && !authPage && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: `linear-gradient(150deg, ${C.pill} 0%, #0f2952 50%, #0c4a3a 100%)`, display: "flex", flexDirection: "column", padding: "16px 24px" }}>
          {/* Overlay top bar — close button matches global nav height */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, marginBottom: 48 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.pillTxt, letterSpacing: "-0.01em" }}>Dealistic</span>
            <button
              onClick={() => setMenuOpen(false)}
              title="Close menu"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              style={{ display: "flex", flexDirection: "column", gap: 4.5, alignItems: "center", justifyContent: "center", width: 36, height: 36, background: "transparent", border: "none", borderRadius: 7, cursor: "pointer", transition: "background 0.15s", position: "relative" }}
            >
              <span style={{ position: "absolute", width: 17, height: 1.5, background: C.pillTxt, borderRadius: 1, transform: "rotate(45deg)" }} />
              <span style={{ position: "absolute", width: 17, height: 1.5, background: C.pillTxt, borderRadius: 1, transform: "rotate(-45deg)" }} />
            </button>
          </div>
          <nav style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
            {([["landing", "Home"], ["analyzer", "Analyzer"], ["dashboard", "Dashboard"], ["learn", "Learn"], ["privacy", "Privacy"], ["contact", "Contact"]] as [Page, string][]).map(([p, label]) => (
              <button
                key={p}
                onClick={() => navigate(p)}
                style={{ background: "none", border: "none", textAlign: "left", fontSize: "clamp(44px,7vw,84px)", fontWeight: 500, letterSpacing: "-0.04em", color: page === p ? C.blue : C.pillTxt, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.1, padding: "2px 0", transition: "color 0.12s" }}
                onMouseEnter={e => { if (page !== p) (e.currentTarget as HTMLElement).style.color = "#8a8680"; }}
                onMouseLeave={e => { if (page !== p) (e.currentTarget as HTMLElement).style.color = C.pillTxt; }}
              >
                {label}
              </button>
            ))}
            {/* Auth link in menu */}
            <button
              onClick={() => openAuth(user ? "account" : "login")}
              style={{ background: "none", border: "none", textAlign: "left", fontSize: "clamp(44px,7vw,84px)", fontWeight: 500, letterSpacing: "-0.04em", color: C.pillTxt, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.1, padding: "2px 0", transition: "color 0.12s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#8a8680"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.pillTxt; }}
            >
              {user ? "Account" : "Log In"}
            </button>
          </nav>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: 40, borderTop: "1px solid #2e2c29" }}>
            <span style={{ fontSize: 11, color: "#4a4744", letterSpacing: "0.1em", textTransform: "uppercase" }}>Dealistic — 2026</span>
            {user && <span style={{ fontSize: 11, color: "#4a4744", letterSpacing: "0.1em" }}>Signed in as {user.email}</span>}
          </div>
        </div>
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
        <AccountPage user={user} onLogOut={handleLogOut} onNavigate={navigate} />
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