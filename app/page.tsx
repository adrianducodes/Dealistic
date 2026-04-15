"use client";
import { useState, useRef, useEffect, useCallback } from "react";

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
  bg:      "#e8e5df",
  bg2:     "#dedad3",
  text:    "#1a1a1a",
  muted:   "#6a6660",
  faint:   "#9a9690",
  rule:    "#d0ccc4",
  blue:    "#1126c8",
  pill:    "#1e1c1a",
  pillTxt: "#f0ede8",
  green:   "#1a7a4a",
  red:     "#c0392b",
  amber:   "#a06010",
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
  dscr: number; score: number; label: "Great Deal" | "Average" | "Risky"; reason: string;
}
interface AnalysisResult {
  r: DealResult; d: DealInput; rentMissing: boolean;
}
interface SavedDeal extends DealInput, DealResult { id: number; saved: boolean; savedAt?: string; userEmail?: string; }

type Page = "landing" | "analyzer" | "dashboard" | "compare";
type AuthPage = "login" | "signup" | "account";
type Mode = "manual" | "csv";
type SortKey = "score" | "cashflow" | "cap" | "coc";
type AppMode = "buyer" | "investor";

interface AuthUser { email: string; name: string; loginAt?: string; }

// ─── Calculations ─────────────────────────────────────────────────────────────
function calcDeal(d: DealInput): DealResult {
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

  let score = 50;
  if (coc > 10) score += 20; else if (coc > 6) score += 10; else if (coc < 0) score -= 20; else if (coc < 3) score -= 10;
  if (capRate > 8) score += 15; else if (capRate > 5) score += 8; else if (capRate < 3) score -= 15; else if (capRate < 5) score -= 5;
  if (dscr > 1.4) score += 15; else if (dscr > 1.2) score += 8; else if (dscr < 1.0) score -= 20; else if (dscr < 1.1) score -= 10;
  if (cashflow > 300) score += 10; else if (cashflow > 0) score += 3; else if (cashflow < -300) score -= 15; else if (cashflow < 0) score -= 8;
  score = Math.max(1, Math.min(100, Math.round(score)));

  const label: "Great Deal" | "Average" | "Risky" = score >= 70 ? "Great Deal" : score >= 45 ? "Average" : "Risky";
  const reason = score >= 70
    ? `Strong cash flow of $${Math.round(cashflow)}/mo, ${capRate.toFixed(1)}% cap rate, DSCR ${dscr.toFixed(2)}.`
    : score >= 45
    ? `Moderate performance. $${Math.round(cashflow)}/mo at ${capRate.toFixed(1)}% cap rate.`
    : `Weak numbers: $${Math.round(cashflow)}/mo, ${capRate.toFixed(1)}% cap rate, DSCR ${dscr.toFixed(2)}.`;

  return { mortgage, effectiveRent, opEx, totalMonthly, cashflow, annualCashflow, coc, capRate, dscr, score, label, reason };
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? "$" + (abs / 1000).toFixed(1) + "k" : "$" + Math.round(abs);
  return n < 0 ? "-" + s : s;
}
function fmtSigned(n: number): string {
  return (n >= 0 ? "+" : "-") + fmt(Math.abs(n));
}
function pf(s: string): number {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

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
  const [focused, setFocused] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <label style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, fontWeight: 500 }}>
          {label}
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {autoLabel && (
            <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", background: C.blue, color: "#fff", padding: "2px 7px", fontWeight: 600 }}>
              {autoLabel}
            </span>
          )}
          {tooltip && (
            <div style={{ position: "relative", display: "inline-flex" }}>
              <button
                onMouseEnter={() => setTipOpen(true)}
                onMouseLeave={() => setTipOpen(false)}
                style={{ width: 16, height: 16, borderRadius: "50%", border: `1px solid ${C.rule}`, background: "transparent", cursor: "default", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", padding: 0 }}
              >
                <span style={{ fontSize: 9, color: C.faint, fontWeight: 600 }}>?</span>
              </button>
              {tipOpen && (
                <div style={{ position: "absolute", right: 0, top: 22, zIndex: 50, background: C.pill, color: C.pillTxt, fontSize: 11, lineHeight: 1.5, padding: "9px 13px", whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}>
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
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.faint, pointerEvents: "none" }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%",
            background: C.bg2,
            border: `1px solid ${focused ? C.text : C.rule}`,
            borderRadius: 0,
            color: C.text,
            fontSize: 14,
            padding: prefix ? "11px 12px 11px 26px" : suffix ? "11px 28px 11px 12px" : "11px 12px",
            outline: "none",
            fontFamily: "inherit",
            transition: "border-color 0.12s",
            boxSizing: "border-box",
          }}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.faint, pointerEvents: "none" }}>
            {suffix}
          </span>
        )}
      </div>

      {hint && <p style={{ fontSize: 11, color: C.faint, marginTop: 5, lineHeight: 1.45, fontStyle: "italic" }}>{hint}</p>}
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

interface InvestorDashboardProps {
  result: AnalysisResult;
  saved: boolean;
  onSave: () => void;
  onFocusRent: () => void;
  scoreColor: string;
  user: AuthUser | null;
  onOpenLogin: () => void;
}

function InvestorDashboard({ result, saved, onSave, onFocusRent, scoreColor, user, onOpenLogin }: InvestorDashboardProps) {
  const { r, d, rentMissing } = result;
  const insights = rentMissing ? [] : buildInsights(r, d);
  const vacancyLoss = d.rent - r.effectiveRent;

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── 1. SUMMARY CARDS ── */}
      <div style={{ marginBottom: 36 }}>
        <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 20 }}>Investment Deal Score</p>
        {/* Score hero */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${C.rule}` }}>
          <span style={{ fontSize: 88, fontWeight: 500, lineHeight: 0.9, letterSpacing: "-0.05em", color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
            {r.score}
          </span>
          <div>
            <ScoreChip label={r.label} />
            <p style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.65, maxWidth: 200 }}>{r.reason}</p>
          </div>
        </div>

        {/* KPI cards — 2×2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: C.rule }}>
          {[
            {
              label: "Monthly Cash Flow",
              value: fmtSigned(r.cashflow),
              sub: `${fmtSigned(r.annualCashflow)}/yr`,
              color: r.cashflow >= 0 ? C.green : C.red,
            },
            {
              label: "Cap Rate",
              value: r.capRate.toFixed(2) + "%",
              sub: r.capRate >= 6 ? "Above benchmark" : r.capRate >= 4 ? "Average" : "Below average",
              color: r.capRate >= 6 ? C.green : r.capRate < 4 ? C.red : C.text,
            },
            {
              label: "Cash-on-Cash Return",
              value: r.coc.toFixed(2) + "%",
              sub: r.coc >= 8 ? "Excellent" : r.coc >= 5 ? "Acceptable" : "Below target",
              color: r.coc >= 8 ? C.green : r.coc < 3 ? C.red : C.text,
            },
            {
              label: "DSCR",
              value: r.dscr.toFixed(2),
              sub: r.dscr >= 1.25 ? "Healthy coverage" : r.dscr >= 1.0 ? "Breakeven" : "Negative carry",
              color: r.dscr >= 1.25 ? C.green : r.dscr < 1.0 ? C.red : C.text,
            },
          ].map(card => (
            <div key={card.label} style={{ background: C.bg, padding: "20px 18px" }}>
              <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>{card.label}</p>
              <p style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.03em", color: card.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 10, color: C.faint, marginTop: 6 }}>{card.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. INCOME VS EXPENSES CHART ── */}
      <div style={{ paddingBottom: 36, marginBottom: 36, borderBottom: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 20 }}>Income vs. Expenses</p>
        <BarChart income={r.effectiveRent} expenses={r.totalMonthly} />
      </div>

      {/* ── 3. BREAKDOWN TABLE ── */}
      <div style={{ paddingBottom: 36, marginBottom: 36, borderBottom: `1px solid ${C.rule}` }}>
        <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 20 }}>Monthly Breakdown</p>
        {/* Income side */}
        <div style={{ marginBottom: 4 }}>
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.rule}` }}>Income</p>
          <MetRow label="Gross Rent" value={fmt(d.rent)} />
          <MetRow label="Vacancy Loss" value={"−" + fmt(vacancyLoss)} accent="red" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: `1px solid ${C.rule}` }}>
            <span style={{ fontSize: 10, color: C.text, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Effective Rent</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.green, fontVariantNumeric: "tabular-nums" }}>{fmt(r.effectiveRent)}</span>
          </div>
        </div>

        {/* Expenses side */}
        <div style={{ marginTop: 16, marginBottom: 4 }}>
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.rule}` }}>Expenses</p>
          <MetRow label="Mortgage (P&I)" value={fmt(r.mortgage)} />
          {d.taxes > 0 && <MetRow label="Property Taxes" value={fmt(d.taxes)} />}
          {d.insurance > 0 && <MetRow label="Insurance" value={fmt(d.insurance)} />}
          {d.hoa > 0 && <MetRow label="HOA" value={fmt(d.hoa)} />}
          {d.repairs > 0 && <MetRow label="Repairs & Maintenance" value={fmt(d.repairs)} />}
          {d.mgmt > 0 && <MetRow label="Property Management" value={fmt(d.mgmt)} />}
          {d.other > 0 && <MetRow label="Other" value={fmt(d.other)} />}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: `1px solid ${C.rule}` }}>
            <span style={{ fontSize: 10, color: C.text, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Total Expenses</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.red, fontVariantNumeric: "tabular-nums" }}>{fmt(r.totalMonthly)}</span>
          </div>
        </div>

        {/* Net */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 0 0" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>Net Cash Flow</span>
          <span style={{ fontSize: 20, fontWeight: 600, color: r.cashflow >= 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>{fmtSigned(r.cashflow)}/mo</span>
        </div>
      </div>

      {/* ── 4. DEAL INSIGHTS ── */}
      {insights.length > 0 && (
        <div style={{ paddingBottom: 36, marginBottom: 36, borderBottom: `1px solid ${C.rule}` }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 20 }}>Deal Insights</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, background: C.rule }}>
            {insights.map((ins) => {
              const accent = ins.type === "positive" ? C.green : ins.type === "warning" ? C.amber : C.red;
              const bg = ins.type === "positive" ? "#f0f8f4" : ins.type === "warning" ? "#fdf5e8" : "#fdf0ef";
              return (
                <div key={ins.title} style={{ background: bg, padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 3, minHeight: 40, background: accent, flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>{ins.title}</p>
                    <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.65 }}>{ins.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SAVE BUTTON — auth-aware ── */}
      {user ? (
        <button
          onClick={onSave}
          disabled={saved}
          onMouseEnter={e => { if (!saved) (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          style={{ width: "100%", padding: "15px", background: saved ? C.bg2 : C.text, color: saved ? C.faint : C.bg, border: `1px solid ${saved ? C.rule : C.text}`, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, cursor: saved ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
        >
          {saved ? "✓  Saved to Dashboard" : "Save Deal"}
        </button>
      ) : (
        <div style={{ border: `1px solid ${C.rule}`, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 3 }}>Want to save this deal?</p>
            <p style={{ fontSize: 11, color: C.faint }}>Log in to save deals to your dashboard.</p>
          </div>
          <button
            onClick={onOpenLogin}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            style={{ flexShrink: 0, padding: "9px 18px", background: C.text, color: C.bg, border: "none", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s" }}
          >
            Log In
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────
function LandingPage({ onAnalyze }: { onAnalyze: () => void }) {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "inherit" }}>
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "110px 48px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 80 }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, marginBottom: 36 }}>
              Real estate deal analysis — 2026
            </p>
            <h1 style={{ fontSize: "clamp(54px,8.5vw,104px)", fontWeight: 500, lineHeight: 0.96, letterSpacing: "-0.045em", margin: 0, color: C.text }}>
              Find better<br />deals.<br />
              <span style={{ color: C.rule }}>Invest smarter.</span>
            </h1>
          </div>
          <div style={{ maxWidth: 260, paddingBottom: 4, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 28 }}>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.75, textAlign: "right" }}>
              Analyze cash flow, cap rate, and returns in seconds. Enter properties manually or upload a CSV.
            </p>
            <PillBtn onClick={onAnalyze}>Analyze a Deal</PillBtn>
          </div>
        </div>

        <HR />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          {[
            { num: "2.4s", label: "Analysis time" },
            { num: "12+", label: "Metrics calculated" },
            { num: "100", label: "Deal score scale" },
            { num: "∞", label: "Deals supported" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "44px 0", paddingLeft: i > 0 ? 40 : 0, paddingRight: i < 3 ? 40 : 0, borderRight: i < 3 ? `1px solid ${C.rule}` : "none" }}>
              <p style={{ fontSize: "clamp(40px,4.5vw,60px)", fontWeight: 500, letterSpacing: "-0.045em", margin: 0, lineHeight: 1, color: C.text }}>{s.num}</p>
              <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 10 }}>{s.label}</p>
            </div>
          ))}
        </div>

        <HR />
      </section>

      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "72px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 52 }}>
          <Tag>How it works</Tag>
          <span style={{ fontSize: 10, color: C.rule, letterSpacing: "0.1em", textTransform: "uppercase" }}>01 — 03</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: C.rule }}>
          {[
            { n: "01", title: "Enter details", desc: "Purchase price, loan terms, rental income, expenses. Or upload a CSV for multiple deals at once." },
            { n: "02", title: "Instant analysis", desc: "Cash flow, cap rate, DSCR, CoC return — calculated in real time with full breakdowns." },
            { n: "03", title: "Get your score", desc: "Every property scores 1–100. Great Deal, Average, or Risky — with a plain-language explanation." },
          ].map(s => (
            <div key={s.n} style={{ background: C.bg, padding: "52px 40px" }}>
              <p style={{ fontSize: 10, color: C.rule, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 52 }}>{s.n}</p>
              <p style={{ fontSize: 21, fontWeight: 500, color: C.text, letterSpacing: "-0.025em", marginBottom: 14, lineHeight: 1.15 }}>{s.title}</p>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.75 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <HR />

      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "72px 48px" }}>
        <Tag>What you get</Tag>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: C.rule, marginTop: 52 }}>
          {[
            { title: "Full financial breakdown", desc: "Monthly mortgage, total expenses, monthly and annual cash flow. Every number you need, instantly." },
            { title: "Deal Score — 1 to 100", desc: "A single number with a clear verdict and an explanation of exactly what's driving it." },
            { title: "CSV bulk upload", desc: "Analyze dozens of properties at once. Download the template, fill it in, upload — done." },
            { title: "Side-by-side comparison", desc: "Stack up to four properties head-to-head across every metric. Pick your winner." },
            { title: "Save & organize", desc: "Favorite properties, sort by returns, and track your pipeline in one clean dashboard." },
            { title: "Market insights", desc: "Coming — local rent estimates and comparable sales to validate your numbers." },
          ].map(f => (
            <div key={f.title} style={{ background: C.bg, padding: "44px 40px" }}>
              <p style={{ fontSize: 18, fontWeight: 500, color: C.text, letterSpacing: "-0.025em", marginBottom: 12 }}>{f.title}</p>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.75 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <HR />

      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "110px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <h2 style={{ fontSize: "clamp(40px,6vw,80px)", fontWeight: 500, letterSpacing: "-0.045em", lineHeight: 0.98, margin: 0, maxWidth: 600, color: C.text }}>
            Make smarter<br />decisions,<br />
            <span style={{ color: C.rule }}>starting now.</span>
          </h2>
          <PillBtn onClick={onAnalyze}>Analyze a Deal</PillBtn>
        </div>
      </section>

      {/* Premium footer */}
      <footer style={{ borderTop: `1px solid ${C.rule}`, padding: "56px 48px 52px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 40 }}>

          {/* Left — brand block */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.text, letterSpacing: "-0.01em" }}>Dealistic</p>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
              Built by{" "}
              <a
                href="https://www.linkedin.com/in/adriandu2004"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: C.text, textDecoration: "none", fontWeight: 500, transition: "color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.blue; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
              >
                Adrian Du
              </a>
            </p>
            <p style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>© 2026 Dealistic. All rights reserved.</p>
          </div>

          {/* Right — nav links */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 36, flexWrap: "wrap" }}>
            {[
              { label: "Analyzer",  href: null },
              { label: "Dashboard", href: null },
              { label: "Compare",   href: null },
              { label: "Privacy",   href: null },
            ].map(({ label }) => (
              <span
                key={label}
                style={{ fontSize: 12, color: C.faint, cursor: "pointer", transition: "color 0.15s", fontWeight: 400 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.faint; }}
              >
                {label}
              </span>
            ))}

            {/* LinkedIn — subtle with icon */}
            <a
              href="https://www.linkedin.com/in/adriandu2004"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, color: C.faint, textDecoration: "none",
                cursor: "pointer", transition: "color 0.15s", fontWeight: 400,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#0a66c2"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.faint; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, opacity: 0.7 }}>
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </a>
          </div>

        </div>
      </footer>
    </div>
  );
}

// ─── CSV pipeline types ───────────────────────────────────────────────────────
type CsvField = "address"|"purchase_price"|"monthly_rent"|"down_payment"|"interest_rate"|"loan_term"|"vacancy_rate"|"taxes"|"insurance"|"hoa"|"repairs"|"management"|"other"|"ignore";

interface CsvFieldDef {
  key: CsvField;
  label: string;
  required: boolean;
  defaultVal?: string | ((row: Record<string,string>, price: number, rent: number) => string);
}

const CSV_FIELDS: CsvFieldDef[] = [
  { key: "address",        label: "Address",           required: false, defaultVal: "" },
  { key: "purchase_price", label: "Purchase Price",    required: true },
  { key: "monthly_rent",   label: "Monthly Rent",      required: false, defaultVal: "0" },
  { key: "down_payment",   label: "Down Payment",      required: false, defaultVal: (_r, price) => String(Math.round(price * 0.20)) },
  { key: "interest_rate",  label: "Interest Rate (%)", required: false, defaultVal: "6.5" },
  { key: "loan_term",      label: "Loan Term (yrs)",   required: false, defaultVal: "30" },
  { key: "vacancy_rate",   label: "Vacancy Rate (%)",  required: false, defaultVal: "5" },
  { key: "taxes",          label: "Property Taxes",    required: false, defaultVal: "0" },
  { key: "insurance",      label: "Insurance",         required: false, defaultVal: (_r, price) => String(Math.round((price * 0.0065) / 12)) },
  { key: "hoa",            label: "HOA",               required: false, defaultVal: "0" },
  { key: "repairs",        label: "Repairs",           required: false, defaultVal: (_r, _p, rent) => String(Math.round(rent * 0.05)) },
  { key: "management",     label: "Management",        required: false, defaultVal: (_r, _p, rent) => String(Math.round(rent * 0.08)) },
  { key: "other",          label: "Other Expenses",    required: false, defaultVal: "0" },
];

// ─── CSV intelligence layer ───────────────────────────────────────────────────

// Fields that must receive numeric values — block non-numeric columns from mapping here
const NUMERIC_FIELDS: CsvField[] = [
  "purchase_price","monthly_rent","down_payment","interest_rate","loan_term",
  "vacancy_rate","taxes","insurance","hoa","repairs","management","other",
];

// Noise column detection — always ignored, never shown in UI
function isNoiseColumn(header: string): boolean {
  const h = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^\d{4}\d{2}\d{2}$/.test(h)) return true;          // 20000131
  if (/^\d{4}[-\/]\d{2}/.test(header.trim())) return true; // 2000-01-31
  if (/^\d{4}q\d$/i.test(header.trim())) return true;       // 2023Q1
  const noiseExact = new Set(["regionid","sizerank","regionname","regiontype","statename",
    "metro","countyname","msaid","country","cbsa","cbsatitle"]);
  if (noiseExact.has(h)) return true;
  return false;
}

// Classify a column's data type from sample values
type ColType = "numeric" | "text" | "mixed" | "empty";
function classifyColumn(header: string, rows: Record<string, string>[]): ColType {
  const vals = rows.slice(0, 10).map(r => (r[header] ?? "").trim()).filter(v => v !== "");
  if (vals.length === 0) return "empty";
  const numericCount = vals.filter(v => !isNaN(Number(v.replace(/[$,%]/g, "")))).length;
  if (numericCount === vals.length) return "numeric";
  if (numericCount === 0) return "text";
  return "mixed";
}

// Detect market/time-series dataset
interface DatasetAnalysis {
  isMarketDataset: boolean;
  dateColCount: number;
  marketSignals: string[]; // reasons why it's flagged
}
function analyzeDataset(headers: string[], rows: Record<string, string>[]): DatasetAnalysis {
  const dateColCount = headers.filter(h => /^\d{4}[-\/]\d{2}/.test(h.trim())).length;
  const marketSignals: string[] = [];
  if (dateColCount >= 3) marketSignals.push(`${dateColCount} date columns detected (e.g. 2000-01-31)`);
  const hasRegionId = headers.some(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,"") === "regionid");
  const hasSizeRank = headers.some(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,"") === "sizerank");
  if (hasRegionId) marketSignals.push("RegionID column found");
  if (hasSizeRank) marketSignals.push("SizeRank column found");
  // Check if there are NO columns that could plausibly be a purchase price
  const usable = headers.filter(h => !isNoiseColumn(h));
  const hasNumericCol = usable.some(h => classifyColumn(h, rows) === "numeric");
  if (!hasNumericCol && usable.length > 0) marketSignals.push("No numeric columns found");
  return {
    isMarketDataset: marketSignals.length >= 2,
    dateColCount,
    marketSignals,
  };
}

// Confidence-scored auto-mapping — only auto-maps on exact/high-confidence matches
interface AutoMapResult {
  field: CsvField;
  confidence: "high" | "medium" | "low";
}

// Synonyms with confidence tiers
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
  header: string,
  colType: ColType,
  usedFields: Set<CsvField>
): AutoMapResult {
  const clean = header.trim().toLowerCase().replace(/[^a-z0-9 _]/g, "");
  // Try high confidence first
  for (const [field, tiers] of Object.entries(AUTOMAP_TIERS) as [CsvField, { high: string[]; medium: string[] }][]) {
    if (field === "ignore") continue;
    if (usedFields.has(field)) continue;
    // Enforce numeric columns for financial fields
    if (NUMERIC_FIELDS.includes(field) && colType === "text") continue;
    if (tiers.high.some(s => s === clean || clean === s.replace(/ /g, "_"))) {
      return { field, confidence: "high" };
    }
  }
  // Medium confidence — only auto-apply for non-address text, numeric for financial
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
  headers: string[],
  rows: Record<string, string>[]
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

function parseCsvText(text: string): CsvParsed | { error: string } {
  const lines = text.split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.trim());
  if (lines.length === 0) return { error: "The file appears to be empty." };
  if (lines.length < 2) return { error: "CSV needs at least a header row and one data row." };
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  if (headers.length < 2) return { error: "Only one column detected. Make sure the file uses commas as separators." };

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
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
  // Build a safe mapping — strip any text column → numeric field mappings
  const safeMapping: Record<string, CsvField> = {};
  Object.entries(mapping).forEach(([h, field]) => {
    if (colTypes && NUMERIC_FIELDS.includes(field) && colTypes[h] === "text") {
      safeMapping[h] = "ignore"; // silently ignore invalid mapping
    } else {
      safeMapping[h] = field;
    }
  });
  return rows.map((row, i) => {
    const get = (field: CsvField) => {
      const col = Object.entries(safeMapping).find(([, f]) => f === field)?.[0];
      return col ? (row[col] ?? "") : "";
    };
    const priceStr = get("purchase_price");
    const price = pf(priceStr);
    const rentStr = get("monthly_rent");
    const rent = pf(rentStr);

    const resolve = (field: CsvField, def: CsvFieldDef) => {
      const raw = get(field);
      if (raw !== "") return pf(raw);
      if (typeof def.defaultVal === "function") return pf(def.defaultVal(row, price, rent));
      return pf(def.defaultVal ?? "0");
    };

    const F = (key: CsvField) => CSV_FIELDS.find(f => f.key === key)!;
    return {
      address: get("address") || `Property ${i + 1}`,
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
  function MappingRow({ h }: { h: string }) {
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
  address: "", price: "", down: "", rate: "", term: "30",
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
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rentInputRef = useRef<HTMLInputElement>(null);

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
    setResult({ r: calcDeal(d), d, rentMissing });
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
    return <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 24 }}>{text}</p>;
  }

  const isBuyer = appMode === "buyer";

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>
      {/* ── Analyzer header — self-contained, no overlap with global fixed elements ── */}
      <div style={{ borderBottom: `1px solid ${C.rule}`, background: C.bg }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>

          {/* Row 1: controls bar — mode type pill left, segmented + auth right */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingTop: 16, paddingBottom: 16,
            borderBottom: `1px solid ${C.rule}`,
          }}>
            {/* Left: app mode (Home Buyer / Investor) — compact pill toggle */}
            <div style={{ display: "flex", background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8, padding: 3, gap: 2 }}>
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
                      padding: "6px 16px",
                      border: "none",
                      borderRadius: 5,
                      background: active ? C.text : "transparent",
                      color: active ? "#fff" : C.muted,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 11,
                      fontWeight: active ? 600 : 500,
                      letterSpacing: "0.04em",
                      transition: "all 0.15s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Right: manual/csv segmented control + spacer + account */}
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {/* Input mode toggle */}
              <div style={{ display: "flex", background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 8, padding: 3, gap: 2 }}>
                {(["manual", "csv"] as Mode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    style={{
                      padding: "6px 14px",
                      border: "none",
                      borderRadius: 5,
                      background: mode === m ? C.text : "transparent",
                      color: mode === m ? "#fff" : C.muted,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 11,
                      fontWeight: mode === m ? 600 : 500,
                      letterSpacing: "0.04em",
                      transition: "all 0.15s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m === "manual" ? "Manual" : "CSV"}
                  </button>
                ))}
              </div>

              {/* Auth button — inline, no overlap */}
              {user ? (
                <button
                  onClick={() => onOpenLogin()}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "5px 12px 5px 5px",
                    background: "transparent", border: `1px solid ${C.rule}`, borderRadius: 999,
                    cursor: "pointer", fontFamily: "inherit", transition: "background 0.12s",
                  }}
                >
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.pill, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.pillTxt, textTransform: "uppercase" }}>{user.name.charAt(0)}</span>
                  </div>
                  <span style={{ fontSize: 11, color: C.text, fontWeight: 500, letterSpacing: "0.04em" }}>Account</span>
                </button>
              ) : (
                <button
                  onClick={() => onOpenLogin()}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.text; (e.currentTarget as HTMLElement).style.color = C.bg; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text; }}
                  style={{
                    padding: "6px 16px", background: "transparent", border: `1px solid ${C.rule}`,
                    borderRadius: 999, fontSize: 11, letterSpacing: "0.06em",
                    fontWeight: 500, cursor: "pointer", fontFamily: "inherit", color: C.text,
                    transition: "all 0.15s", whiteSpace: "nowrap",
                  }}
                >
                  Log In
                </button>
              )}
            </div>
          </div>

          {/* Row 2: page title + subtitle */}
          <div style={{ paddingTop: 20, paddingBottom: 20 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.025em", margin: 0, color: C.text, lineHeight: 1.2 }}>
              {isBuyer ? "Home Buyer Calculator" : "Deal Analyzer"}
            </h1>
            <p style={{ fontSize: 12, color: C.faint, marginTop: 4, letterSpacing: "0.04em" }}>
              {isBuyer ? "Understand your monthly costs before you buy" : "Enter details or upload a CSV"}
            </p>
          </div>

        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "52px 48px" }}>

        {/* ── Manual Mode ── */}
        {mode === "manual" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "start" }}>

            {/* Form column */}
            <div>
              {/* Property Details */}
              <div style={{ paddingBottom: 40, marginBottom: 40, borderBottom: `1px solid ${C.rule}` }}>
                <SectionLabel text="Property Details" />
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
                  <label style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, fontWeight: 500 }}>
                    Address <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="123 Main St, Austin TX"
                    value={form.address}
                    onChange={e => setField("address")(e.target.value)}
                    onFocus={e => { e.currentTarget.style.borderColor = C.text; }}
                    onBlur={e => { e.currentTarget.style.borderColor = C.rule; }}
                    style={{ width: "100%", background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 0, color: C.text, fontSize: 14, padding: "11px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box", transition: "border-color 0.12s" }}
                  />
                  <p style={{ fontSize: 11, color: C.faint, fontStyle: "italic", marginTop: 2 }}>Used to label your saved deal.</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <SmartField
                    label="Purchase Price" placeholder="325,000" prefix="$"
                    value={form.price} onChange={setField("price")}
                    hint="The agreed sale price — find it on Zillow or your MLS listing."
                    tooltip="Find this on Zillow or your MLS listing"
                  />
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
              {!isBuyer && <div style={{ paddingBottom: 40, marginBottom: 40, borderBottom: `1px solid ${C.rule}` }}>
                <SectionLabel text="Rental Income" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

                  {/* Rent field — custom, not SmartField, so we can attach a ref and the estimator */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <label style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, fontWeight: 500 }}>
                        Monthly Rent <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span>
                      </label>
                      {priceVal > 0 && (
                        <button
                          onClick={() => setShowRentEstimate(v => !v)}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.text; (e.currentTarget as HTMLElement).style.color = C.text; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.rule; (e.currentTarget as HTMLElement).style.color = C.muted; }}
                          style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, color: C.muted, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
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
                        onFocus={e => { e.currentTarget.style.borderColor = C.text; }}
                        onBlur={e => { e.currentTarget.style.borderColor = C.rule; }}
                        style={{ width: "100%", background: C.bg2, border: `1px solid ${C.rule}`, borderRadius: 0, color: C.text, fontSize: 14, padding: "11px 12px 11px 26px", outline: "none", fontFamily: "inherit", transition: "border-color 0.12s", boxSizing: "border-box" }}
                      />
                    </div>
                    <p style={{ fontSize: 11, color: C.faint, marginTop: 5, lineHeight: 1.45, fontStyle: "italic" }}>
                      Leave blank to see mortgage &amp; cost estimates only.
                    </p>
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
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.text; (e.currentTarget as HTMLElement).style.color = C.text; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.rule; (e.currentTarget as HTMLElement).style.color = C.muted; }}
                    style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, color: C.muted, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
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
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.text; (e.currentTarget as HTMLElement).style.color = C.text; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.rule; (e.currentTarget as HTMLElement).style.color = C.muted; }}
                    style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, color: C.muted, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
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
              <div>
                <SectionLabel text="Monthly Expenses" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
                <div style={{ marginTop: 20, padding: "14px 16px", background: C.bg2, border: `1px solid ${C.rule}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 9, background: C.blue, color: "#fff", padding: "2px 7px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0, marginTop: 1 }}>TIP</span>
                  <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                    Leave <strong style={{ color: C.text, fontWeight: 500 }}>Repairs</strong>, <strong style={{ color: C.text, fontWeight: 500 }}>Management</strong>, and <strong style={{ color: C.text, fontWeight: 500 }}>Insurance</strong> blank — we apply smart defaults automatically.
                  </p>
                </div>

                <button
                  onClick={analyze}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                  style={{ marginTop: 24, width: "100%", padding: "15px", background: C.text, color: C.bg, border: "none", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.12s" }}
                >
                  {isBuyer ? "Calculate My Costs" : "Analyze This Deal"}
                </button>
              </div>
            </div>

            {/* Results column */}
            <div>
              {!result ? (
                <div style={{ border: `1px solid ${C.rule}`, padding: "80px 48px", textAlign: "center" }}>
                  <p style={{ fontSize: 10, color: C.rule, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>Results appear here</p>
                  <p style={{ fontSize: 12, color: C.rule }}>
                    {isBuyer ? "Fill in the form to see your monthly cost breakdown." : "Fill in the form and click Analyze"}
                  </p>
                </div>
              ) : isBuyer ? (

                /* ── HOME BUYER RESULTS ── */
                <BuyerResults result={result} onSwitchToInvestor={() => { setAppMode("investor"); setResult(null); }} />

              ) : (
                /* ── INVESTOR RESULTS → full dashboard ── */
                <InvestorDashboard
                  result={result}
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
                  style={{ border: `1px solid ${C.rule}`, padding: "64px 48px", textAlign: "center", cursor: "pointer", transition: "border-color 0.15s", marginBottom: 20 }}
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
        background: "rgba(30,28,26,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.bg, width: "100%", maxWidth: 560,
          maxHeight: "90vh", overflowY: "auto",
          border: `1px solid ${C.rule}`,
        }}
      >
        {/* Modal header */}
        <div style={{ padding: "24px 28px", borderBottom: `1px solid ${C.rule}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>Deal Detail</p>
            <h2 style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: C.text, margin: 0 }}>{deal.address.split(",")[0]}</h2>
            <p style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{deal.address}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.faint, fontFamily: "inherit", lineHeight: 1, padding: 4, marginTop: -4 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.faint; }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "24px 28px" }}>
          {/* Score */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 28, paddingBottom: 24, borderBottom: `1px solid ${C.rule}` }}>
            <span style={{ fontSize: 72, fontWeight: 500, lineHeight: 0.9, letterSpacing: "-0.05em", color: sc, fontVariantNumeric: "tabular-nums" }}>
              {deal.score}
            </span>
            <div>
              <ScoreChip label={deal.label} />
              <p style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.6, maxWidth: 240 }}>{deal.reason}</p>
            </div>
          </div>

          {/* Key metrics */}
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>Key Metrics</p>
          {([
            { label: "Monthly Cash Flow", value: fmtSigned(deal.cashflow), accent: deal.cashflow >= 0 ? "green" : "red" },
            { label: "Annual Cash Flow",   value: fmtSigned(deal.annualCashflow), accent: deal.annualCashflow >= 0 ? "green" : "red" },
            { label: "Cap Rate",           value: deal.capRate.toFixed(2) + "%",  accent: deal.capRate >= 6 ? "green" : deal.capRate < 4 ? "red" : null },
            { label: "CoC Return",         value: deal.coc.toFixed(2) + "%",      accent: deal.coc >= 8 ? "green" : deal.coc < 3 ? "red" : null },
            { label: "DSCR",               value: deal.dscr.toFixed(2),            accent: deal.dscr >= 1.2 ? "green" : deal.dscr < 1 ? "red" : null },
            { label: "Monthly Mortgage",   value: fmt(deal.mortgage),              accent: null },
            { label: "Total Expenses",     value: fmt(deal.totalMonthly),          accent: null },
          ] as { label: string; value: string; accent: string | null }[]).map(row => {
            const color = row.accent === "green" ? C.green : row.accent === "red" ? C.red : C.text;
            return (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "11px 0", borderBottom: `1px solid ${C.rule}` }}>
                <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>{row.label}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
              </div>
            );
          })}

          {/* Property details */}
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 24, marginBottom: 14 }}>Property Details</p>
          {([
            { label: "Purchase Price", value: fmt(deal.price) },
            { label: "Down Payment",   value: fmt(deal.down) + " (" + Math.round(deal.down / deal.price * 100) + "%)" },
            { label: "Interest Rate",  value: deal.rate + "%" },
            { label: "Loan Term",      value: deal.term + " years" },
            { label: "Monthly Rent",   value: deal.rent > 0 ? fmt(deal.rent) : "—" },
          ] as { label: string; value: string }[]).map(row => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "11px 0", borderBottom: `1px solid ${C.rule}` }}>
              <span style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>{row.label}</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
            </div>
          ))}

          {savedDate && (
            <p style={{ fontSize: 10, color: C.faint, marginTop: 20, textAlign: "right", fontStyle: "italic" }}>
              Saved {savedDate}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DashboardPage ─────────────────────────────────────────────────────────────
function DashboardPage({ deals, onDelete, onDeleteAll, onCompare, onAnalyze, compareIds, onToggleCompare, user, onOpenLogin }: {
  deals: SavedDeal[];
  onDelete: (id: number) => void;
  onDeleteAll: (ids: number[]) => void;
  onCompare: () => void;
  onAnalyze: () => void;
  compareIds: number[];
  onToggleCompare: (id: number, checked: boolean) => void;
  user: AuthUser | null;
  onOpenLogin: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [viewDeal, setViewDeal] = useState<SavedDeal | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px" }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 20 }}>My Deals</p>
          <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.03em", color: C.text, marginBottom: 12 }}>Log in to see your saved deals</h1>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 32 }}>
            Your saved deals are tied to your account. Log in to view, manage, and compare them.
          </p>
          <button
            onClick={onOpenLogin}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            style={{ padding: "13px 32px", background: C.text, color: C.bg, border: "none", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Log In
          </button>
          <p style={{ fontSize: 12, color: C.faint, marginTop: 16 }}>
            No account?{" "}
            <button onClick={onAnalyze} style={{ background: "none", border: "none", color: C.blue, fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>
              Analyze a deal first
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>
      {/* Detail modal */}
      {viewDeal && <DealDetailModal deal={viewDeal} onClose={() => setViewDeal(null)} />}

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.rule}`, padding: "32px 48px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: C.text }}>My Deals</h1>
            <p style={{ fontSize: 11, color: C.faint, marginTop: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {deals.length === 0 ? "No saved deals yet" : `${deals.length} saved deal${deals.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <button onClick={onAnalyze} style={{ background: "transparent", color: C.text, border: `1px solid ${C.text}`, padding: "10px 22px", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            + Analyze New Deal
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "44px 48px" }}>

        {/* Bulk action bar — select all + delete selected */}
        {deals.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "12px 18px", background: C.bg2, border: `1px solid ${C.rule}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => allSelected ? clearSelection() : selectAll()}
                  style={{ accentColor: C.text, cursor: "pointer", width: 14, height: 14 }}
                />
                <span style={{ fontSize: 11, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {allSelected ? "Deselect All" : "Select All"}
                </span>
              </label>
              {selected.size > 0 && (
                <span style={{ fontSize: 11, color: C.faint }}>
                  {selected.size} selected
                </span>
              )}
            </div>
            {selected.size > 0 && (
              !deleteAllConfirm ? (
                <button
                  onClick={() => setDeleteAllConfirm(true)}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.red; (e.currentTarget as HTMLElement).style.borderColor = C.red; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; (e.currentTarget as HTMLElement).style.borderColor = C.rule; }}
                  style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, color: C.muted, padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}
                >
                  Delete {selected.size} Deal{selected.size !== 1 ? "s" : ""}
                </button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: C.red }}>Delete {selected.size} deal{selected.size !== 1 ? "s" : ""}?</span>
                  <button onClick={deleteSelected}
                    style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: C.red, border: "none", color: "#fff", padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                    Confirm
                  </button>
                  <button onClick={() => setDeleteAllConfirm(false)}
                    style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, color: C.muted, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                    Cancel
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {/* Compare bar */}
        {compareIds.length >= 2 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${C.rule}`, padding: "16px 24px", marginBottom: 36 }}>
            <p style={{ fontSize: 11, color: C.muted }}>
              <span style={{ color: C.text, fontWeight: 500 }}>{compareIds.length}</span> deals selected for comparison
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => compareIds.forEach(id => onToggleCompare(id, false))} style={{ background: "transparent", color: C.muted, border: `1px solid ${C.rule}`, padding: "8px 16px", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" }}>Clear</button>
              <button onClick={onCompare} style={{ background: C.text, color: C.bg, border: "none", padding: "8px 20px", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Compare</button>
            </div>
          </div>
        )}

        {/* Controls */}
        {deals.length > 0 && (
          <div style={{ display: "flex", gap: 14, marginBottom: 36, alignItems: "center" }}>
            <input
              type="text" placeholder="Search by address..." value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={e => { e.currentTarget.style.borderColor = C.text; }}
              onBlur={e => { e.currentTarget.style.borderColor = C.rule; }}
              style={{ background: C.bg2, border: `1px solid ${C.rule}`, color: C.text, fontSize: 13, padding: "10px 14px", outline: "none", fontFamily: "inherit", width: 260, transition: "border-color 0.12s" }}
            />
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              style={{ background: C.bg2, border: `1px solid ${C.rule}`, color: C.muted, fontSize: 10, padding: "10px 14px", outline: "none", fontFamily: "inherit", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
              <option value="score">Sort — Deal Score</option>
              <option value="cashflow">Sort — Best Cash Flow</option>
              <option value="cap">Sort — Cap Rate</option>
              <option value="coc">Sort — CoC Return</option>
            </select>
          </div>
        )}

        {/* Empty state */}
        {sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: "100px 0" }}>
            <p style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em", color: C.text, marginBottom: 8 }}>
              {search ? "No deals match your search" : "No saved deals yet"}
            </p>
            <p style={{ fontSize: 11, color: C.faint, marginBottom: 36, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {search ? "Try a different search term" : "Analyze a property and save it to see it here"}
            </p>
            {!search && <PillBtn onClick={onAnalyze}>Analyze a Deal</PillBtn>}
          </div>
        )}

        {/* Deal cards */}
        {sorted.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: C.rule }}>
            {sorted.map(d => {
              const sc = d.score >= 70 ? C.green : d.score >= 45 ? C.amber : C.red;
              const isDeleting = deleteConfirm === d.id;
              const savedDate = d.savedAt
                ? new Date(d.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : null;

              return (
                <div key={d.id} style={{ background: C.bg, display: "flex", flexDirection: "column" }}>
                  {/* Card body */}
                  <div style={{ padding: "28px 24px 20px", flex: 1 }}>
                    {/* Top row: label + selection checkbox */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <ScoreChip label={d.label} />
                      <input
                        type="checkbox"
                        title="Select deal"
                        checked={selected.has(d.id)}
                        onChange={() => toggleSelect(d.id)}
                        style={{ accentColor: C.text, cursor: "pointer", width: 13, height: 13, marginTop: 2 }}
                      />
                    </div>

                    {/* Address */}
                    <p style={{ fontSize: 15, fontWeight: 500, color: C.text, letterSpacing: "-0.02em", marginBottom: 3, lineHeight: 1.3 }}>
                      {d.address.split(",")[0]}
                    </p>
                    {d.address.includes(",") && (
                      <p style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>
                        {d.address.split(",").slice(1).join(",").trim()}
                      </p>
                    )}
                    <p style={{ fontSize: 10, color: C.faint, letterSpacing: "0.05em", marginBottom: 20, textTransform: "uppercase" }}>
                      {fmt(d.price)} · {d.rate}% · {d.term}yr
                    </p>

                    {/* 3 key metrics */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: `1px solid ${C.rule}`, paddingTop: 16, marginBottom: 16 }}>
                      <div style={{ borderRight: `1px solid ${C.rule}`, paddingRight: 8 }}>
                        <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Cash Flow</p>
                        <p style={{ fontSize: 13, fontWeight: 600, color: d.cashflow >= 0 ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>
                          {fmtSigned(d.cashflow)}<span style={{ fontSize: 9, fontWeight: 400 }}>/mo</span>
                        </p>
                      </div>
                      <div style={{ borderRight: `1px solid ${C.rule}`, padding: "0 8px", textAlign: "center" }}>
                        <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Cap Rate</p>
                        <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{d.capRate.toFixed(1)}%</p>
                      </div>
                      <div style={{ paddingLeft: 8, textAlign: "right" }}>
                        <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Score</p>
                        <p style={{ fontSize: 13, fontWeight: 600, color: sc, fontVariantNumeric: "tabular-nums" }}>{d.score}</p>
                      </div>
                    </div>

                    {savedDate && (
                      <p style={{ fontSize: 10, color: C.faint, fontStyle: "italic" }}>Saved {savedDate}</p>
                    )}
                  </div>

                  {/* Card actions */}
                  {!isDeleting ? (
                    <div style={{ display: "flex", borderTop: `1px solid ${C.rule}` }}>
                      <button
                        onClick={() => setViewDeal(d)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        style={{ flex: 1, padding: "12px 0", background: "transparent", border: "none", borderRight: `1px solid ${C.rule}`, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, color: C.text, cursor: "pointer", fontFamily: "inherit", transition: "background 0.1s" }}
                      >
                        View
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(d.id)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#fdf0ef"; (e.currentTarget as HTMLElement).style.color = C.red; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.faint; }}
                        style={{ flex: 1, padding: "12px 0", background: "transparent", border: "none", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, color: C.faint, cursor: "pointer", fontFamily: "inherit", transition: "all 0.1s" }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div style={{ borderTop: `1px solid ${C.rule}`, padding: "12px 16px", background: "#fdf0ef", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <p style={{ fontSize: 11, color: C.red }}>Delete this deal?</p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          style={{ padding: "5px 12px", background: "transparent", border: `1px solid ${C.rule}`, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => confirmDelete(d.id)}
                          style={{ padding: "5px 12px", background: C.red, border: "none", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                        >
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

// ─── ComparePage ──────────────────────────────────────────────────────────────
type HighlightDir = "higher" | "lower" | "none";

interface CompareRow {
  label: string;
  group?: string;
  getValue: (d: SavedDeal) => number;
  render: (d: SavedDeal) => string;
  highlight: HighlightDir; // "higher" = best is highest, "lower" = best is lowest
  format?: "currency" | "percent" | "number";
}

function ComparePage({ deals, onBack }: { deals: SavedDeal[]; onBack: () => void }) {
  const rows: CompareRow[] = [
    // Investment returns
    { label: "Deal Score",          group: "Returns",   getValue: d => d.score,        render: d => String(d.score) + " / 100",  highlight: "higher" },
    { label: "Monthly Cash Flow",   group: "Returns",   getValue: d => d.cashflow,     render: d => fmtSigned(d.cashflow) + "/mo", highlight: "higher" },
    { label: "Annual Cash Flow",    group: "Returns",   getValue: d => d.annualCashflow, render: d => fmtSigned(d.annualCashflow) + "/yr", highlight: "higher" },
    { label: "Cash-on-Cash Return", group: "Returns",   getValue: d => d.coc,          render: d => d.coc.toFixed(2) + "%",      highlight: "higher" },
    { label: "Cap Rate",            group: "Returns",   getValue: d => d.capRate,      render: d => d.capRate.toFixed(2) + "%",  highlight: "higher" },
    { label: "DSCR",                group: "Returns",   getValue: d => d.dscr,         render: d => d.dscr.toFixed(2),           highlight: "higher" },
    // Income
    { label: "Monthly Rent",        group: "Income",    getValue: d => d.rent,         render: d => d.rent > 0 ? fmt(d.rent) : "—", highlight: "higher" },
    { label: "Effective Rent",      group: "Income",    getValue: d => d.effectiveRent, render: d => fmt(d.effectiveRent),       highlight: "higher" },
    { label: "Vacancy Rate",        group: "Income",    getValue: d => d.vacancy,      render: d => d.vacancy + "%",             highlight: "lower" },
    // Costs
    { label: "Purchase Price",      group: "Property",  getValue: d => d.price,        render: d => fmt(d.price),               highlight: "lower" },
    { label: "Down Payment",        group: "Property",  getValue: d => d.down,         render: d => fmt(d.down),                highlight: "none" },
    { label: "Interest Rate",       group: "Property",  getValue: d => d.rate,         render: d => d.rate + "%",               highlight: "lower" },
    { label: "Monthly Mortgage",    group: "Costs",     getValue: d => d.mortgage,     render: d => fmt(d.mortgage),            highlight: "lower" },
    { label: "Total Expenses",      group: "Costs",     getValue: d => d.totalMonthly, render: d => fmt(d.totalMonthly),        highlight: "lower" },
  ];

  // For each row, compute which deal(s) have the best value
  function getBestIds(row: CompareRow): Set<number> {
    if (row.highlight === "none" || deals.length < 2) return new Set();
    const vals = deals.map(d => ({ id: d.id, v: row.getValue(d) }));
    const best = row.highlight === "higher"
      ? Math.max(...vals.map(x => x.v))
      : Math.min(...vals.map(x => x.v));
    // If all values are equal, no highlight
    if (vals.every(x => x.v === best)) return new Set();
    return new Set(vals.filter(x => x.v === best).map(x => x.id));
  }

  // Group rows
  const groups = ["Returns", "Income", "Property", "Costs"];

  // Score winner — highest score
  const winner = deals.length >= 2 ? deals.reduce((a, b) => a.score > b.score ? a : b) : null;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.rule}`, padding: "32px 48px" }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: C.text }}>Compare Deals</h1>
            <p style={{ fontSize: 11, color: C.faint, marginTop: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {deals.length >= 2 ? `${deals.length} deals · green = best value in column` : "Select 2–4 deals from My Deals"}
            </p>
          </div>
          <button onClick={onBack}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; (e.currentTarget as HTMLElement).style.borderColor = C.text; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.faint; (e.currentTarget as HTMLElement).style.borderColor = C.rule; }}
            style={{ background: "transparent", color: C.faint, border: `1px solid ${C.rule}`, padding: "10px 22px", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit", transition: "color 0.12s, border-color 0.12s" }}
          >
            ← My Deals
          </button>
        </div>
      </div>

      {deals.length < 2 ? (
        <div style={{ textAlign: "center", padding: "140px 48px" }}>
          <p style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em", color: C.text, marginBottom: 10 }}>No deals selected</p>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 32 }}>Go to My Deals, check the box on 2–4 cards, then click Compare.</p>
          <PillBtn onClick={onBack}>Go to My Deals</PillBtn>
        </div>
      ) : (
        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "40px 48px" }}>

          {/* Winner banner */}
          {winner && (
            <div style={{ marginBottom: 36, padding: "16px 24px", background: "#f0f8f4", border: `1px solid ${C.green}`, display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 3, height: 40, background: C.green, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 9, color: C.green, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>Best Deal</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
                  {winner.address.split(",")[0]}
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 400, marginLeft: 10 }}>
                    Score {winner.score} · {fmtSigned(winner.cashflow)}/mo · {winner.capRate.toFixed(1)}% cap rate
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Comparison table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 180 }} />
                {deals.map(d => <col key={d.id} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ padding: "0 0 16px", textAlign: "left" }} />
                  {deals.map(d => {
                    const isWinner = winner?.id === d.id;
                    const sc = d.score >= 70 ? C.green : d.score >= 45 ? C.amber : C.red;
                    return (
                      <th key={d.id} style={{ padding: "0 0 16px 20px", textAlign: "left", verticalAlign: "bottom" }}>
                        <div style={{ borderTop: `3px solid ${isWinner ? C.green : C.rule}`, paddingTop: 12 }}>
                          {isWinner && (
                            <span style={{ fontSize: 9, color: C.green, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 4 }}>Best</span>
                          )}
                          <p style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "-0.015em", marginBottom: 2 }}>
                            {d.address.split(",")[0]}
                          </p>
                          {d.address.includes(",") && (
                            <p style={{ fontSize: 10, color: C.faint, marginBottom: 6 }}>
                              {d.address.split(",").slice(1).join(",").trim()}
                            </p>
                          )}
                          <span style={{ fontSize: 11, fontWeight: 600, color: sc }}>
                            {d.label} · {d.score}/100
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const groupRows = rows.filter(r => r.group === group);
                  return (
                    <>
                      {/* Group header row */}
                      <tr key={group + "_header"}>
                        <td colSpan={deals.length + 1} style={{ padding: "20px 0 8px", borderBottom: `1px solid ${C.rule}` }}>
                          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>{group}</p>
                        </td>
                      </tr>

                      {/* Data rows */}
                      {groupRows.map(row => {
                        const bestIds = getBestIds(row);
                        return (
                          <tr key={row.label}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            style={{ borderBottom: `1px solid ${C.rule}`, transition: "background 0.1s" }}
                          >
                            <td style={{ padding: "13px 16px 13px 0", fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", verticalAlign: "middle" }}>
                              {row.label}
                            </td>
                            {deals.map(d => {
                              const isBest = bestIds.has(d.id);
                              const val = row.getValue(d);
                              // Absolute color: red for negative cashflow/coc regardless of "best"
                              let textColor = C.text;
                              if (isBest) textColor = C.green;
                              else if (row.label.includes("Cash Flow") && val < 0) textColor = C.red;
                              else if (row.label === "DSCR" && val < 1) textColor = C.red;

                              return (
                                <td key={d.id} style={{ padding: "13px 0 13px 20px", verticalAlign: "middle" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                    {isBest && (
                                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, flexShrink: 0, display: "inline-block" }} />
                                    )}
                                    <span style={{
                                      fontSize: 14, fontWeight: isBest ? 600 : 500,
                                      color: textColor,
                                      fontVariantNumeric: "tabular-nums",
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
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 20, paddingTop: 20, borderTop: `1px solid ${C.rule}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, display: "inline-block" }} />
              <span style={{ fontSize: 10, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>Best value in row</span>
            </div>
            <span style={{ fontSize: 10, color: C.rule }}>·</span>
            <span style={{ fontSize: 10, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Green = higher is better · Lower is better for cost metrics
            </span>
          </div>
        </div>
      )}
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
            { label: "Compare", action: () => onNavigate("compare") },
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
  const [compareIds, setCompareIds] = useState<number[]>([]);

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

  const toggleCompare = useCallback((id: number, checked: boolean) => {
    setCompareIds(prev => {
      if (checked) {
        if (prev.length >= 4) { alert("Max 4 deals for comparison"); return prev; }
        return [...prev, id];
      }
      return prev.filter(x => x !== id);
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
    <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", background: C.bg, minHeight: "100vh" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
        input[type=number] { -moz-appearance: textfield; }
        ::selection { background: ${C.blue}; color: #fff; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.rule}; border-radius: 2px; }
      `}</style>

      {/* Pill menu — top left — hidden on analyzer which has its own header */}
      {!authPage && page !== "analyzer" && (
        <div style={{ position: "fixed", top: 20, left: 20, zIndex: 200 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#2e2c29"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.pill; }}
            title="Menu"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4, background: C.pill, border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
          >
            {[0, 1, 2].map(i => <span key={i} style={{ display: "block", width: 16, height: 1.5, background: C.pillTxt, borderRadius: 1 }} />)}
          </button>
        </div>
      )}

      {/* Auth button — hidden on analyzer which has its own inline auth */}
      {!authPage && page !== "analyzer" && (
        <div style={{ position: "fixed", top: 20, right: 76, zIndex: 200 }}>
          {user ? (
            <button
              onClick={() => openAuth("account")}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.bg; }}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 999,
                cursor: "pointer", fontFamily: "inherit", transition: "background 0.12s",
              }}
            >
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: C.pill, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.pillTxt, textTransform: "uppercase" }}>
                  {user.name.charAt(0)}
                </span>
              </div>
              <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.text, fontWeight: 500 }}>
                Account
              </span>
            </button>
          ) : (
            <button
              onClick={() => openAuth("login")}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.text; (e.currentTarget as HTMLElement).style.color = C.bg; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text; }}
              style={{
                padding: "8px 18px", background: "transparent", border: `1px solid ${C.rule}`,
                borderRadius: 999, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                fontWeight: 500, cursor: "pointer", fontFamily: "inherit", color: C.text,
                transition: "all 0.15s",
              }}
            >
              Log In
            </button>
          )}
        </div>
      )}

      {/* Fullscreen menu overlay */}
      {menuOpen && !authPage && (
        <div style={{ position: "fixed", inset: 0, zIndex: 190, background: C.pill, display: "flex", flexDirection: "column", padding: "24px 36px" }}>
          <div style={{ marginBottom: 80 }}>
            <button
              onClick={() => setMenuOpen(false)}
              title="Close menu"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, background: C.bg, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
            >
              <span style={{ position: "relative", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ position: "absolute", width: 16, height: 1.5, background: C.text, transform: "rotate(45deg)" }} />
                <span style={{ position: "absolute", width: 16, height: 1.5, background: C.text, transform: "rotate(-45deg)" }} />
              </span>
            </button>
          </div>
          <nav style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
            {([["landing", "Home"], ["analyzer", "Analyzer"], ["dashboard", "Dashboard"], ["compare", "Compare"]] as [Page, string][]).map(([p, label]) => (
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

      {/* Blue sidebar wordmark — hidden on auth pages for cleaner focus */}
      {!authPage && (
        <div
          onClick={() => navigate("landing")}
          style={{ position: "fixed", top: 0, right: 0, zIndex: 100, background: C.blue, width: 56, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", writingMode: "vertical-rl", transform: "rotate(180deg)", userSelect: "none" }}>
            Dealistic
          </span>
        </div>
      )}

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
        <div style={{ paddingRight: 56 }}>
          {page === "landing" && <LandingPage onAnalyze={() => navigate("analyzer")} />}
          {page === "analyzer" && <AnalyzerPage onSave={addDeal} prefill={null} user={user} onOpenLogin={() => openAuth("login")} />}
          {page === "dashboard" && (
            <DashboardPage
              deals={deals}
              onDelete={deleteDeal}
              onDeleteAll={deleteManyDeals}
              onCompare={() => navigate("compare")}
              onAnalyze={() => navigate("analyzer")}
              compareIds={compareIds}
              onToggleCompare={toggleCompare}
              user={user}
              onOpenLogin={() => openAuth("login")}
            />
          )}
          {page === "compare" && (
            <ComparePage deals={deals.filter(d => compareIds.includes(d.id))} onBack={() => navigate("dashboard")} />
          )}
        </div>
      )}
    </div>
  );
}