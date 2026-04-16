"use client";
import React from "react";

const CONTACT_EMAIL = "dealistic.app@gmail.com";
const LAST_UPDATED  = "April 15, 2026";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span style={{ display:"block", fontSize:10, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", color:"#94a3b8", marginBottom:14 }}>{children}</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ display:"flex", alignItems:"center", gap:10, fontSize:15, fontWeight:800, color:"#0f172a", letterSpacing:"-0.02em", margin:"0 0 18px" }}>
      <span style={{ display:"inline-block", width:4, height:16, flexShrink:0, background:"linear-gradient(180deg,#2563eb,#0ea5e9)", borderRadius:99 }} />
      {children}
    </h2>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize:14, color:"#334155", lineHeight:1.8, margin:"0 0 12px", ...style }}>{children}</p>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul style={{ listStyle:"none", padding:0, margin:"6px 0 14px", display:"flex", flexDirection:"column", gap:9 }}>{children}</ul>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ fontSize:14, color:"#334155", lineHeight:1.72, paddingLeft:18, position:"relative" }}>
      <span style={{ position:"absolute", left:0, top:9, width:5, height:5, borderRadius:"50%", background:"#94a3b8" }} />
      {children}
    </li>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return <strong style={{ color:"#0f172a", fontWeight:700 }}>{children}</strong>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily:"monospace", fontSize:12, background:"#f1f5f9", border:"1px solid #e2e8f0", color:"#475569", padding:"1px 6px", borderRadius:5 }}>{children}</code>;
}

function ELink() {
  return <a href={"mailto:" + CONTACT_EMAIL} style={{ color:"#2563eb", fontWeight:600, textDecoration:"none" }}>{CONTACT_EMAIL}</a>;
}

const sections: { id: string; title: string; body: React.ReactNode }[] = [
  { id:"introduction", title:"Introduction", body: (
    <>
      <P>Dealistic is a real estate deal analysis tool built to help investors and home buyers make faster, smarter decisions with their own property data. This policy explains what we collect, how we use it, and what choices you have — written clearly, without legal jargon.</P>
      <P>By using Dealistic you agree to the practices described here.</P>
    </>
  )},
  { id:"information-we-collect", title:"Information We Collect", body: (
    <>
      <P>We collect only what is needed to make the product work:</P>
      <Ul>
        <Li><Bold>Account info</Bold> — your name and email address when you create an account.</Li>
        <Li><Bold>Property data you enter</Bold> — purchase prices, rental income, expenses, and deal details you input manually or via CSV upload. This data belongs to you.</Li>
        <Li><Bold>Usage data</Bold> — general interaction patterns to help us improve the product. Not linked to specific property analyses.</Li>
        <Li><Bold>Browser storage</Bold> — we use <Mono>localStorage</Mono> to save your session and saved deals locally on your device.</Li>
      </Ul>
      <P>We do not collect payment information — Dealistic is free to use.</P>
    </>
  )},
  { id:"how-we-use", title:"How We Use Your Information", body: (
    <>
      <P>Your information is used to authenticate your account, save and display your deal history, run calculations and generate your deal score, and send only transactional emails — never promotional ones without your explicit opt-in.</P>
      <P><Bold>We do not sell your data.</Bold> We do not use your property data to train machine-learning models or share it with advertisers.</P>
    </>
  )},
  { id:"data-storage", title:"Data Storage", body: (
    <>
      <P>Deal data entered into the analyzer is stored primarily in your browser via <Mono>localStorage</Mono> — it lives on your device and is not transmitted to our servers unless you explicitly save it to your account.</P>
      <P>When you create an account and save deals, that data is stored securely in our database. You can delete your account and all associated data at any time.</P>
    </>
  )},
  { id:"third-party", title:"Third-Party Services", body: (
    <>
      <P>Dealistic uses a small number of third-party services:</P>
      <Ul>
        <Li><Bold>Rentometer</Bold> — opens their site directly in your browser. We do not share your data with them.</Li>
        <Li><Bold>Zillow / Redfin</Bold> — pasting a listing URL fetches publicly available listing data. No personal data is sent.</Li>
        <Li><Bold>Analytics</Bold> — lightweight, privacy-respecting analytics for general usage patterns only.</Li>
      </Ul>
      <P>We do not embed advertising networks, social media trackers, or third-party data brokers.</P>
    </>
  )},
  { id:"security", title:"Security", body: (
    <>
      <P>We protect your information with encrypted connections (HTTPS), hashed password storage, and access controls. Use a strong, unique password and log out of shared devices.</P>
      <P>If you believe your account has been compromised, contact us immediately at <ELink />.</P>
    </>
  )},
  { id:"your-rights", title:"Your Rights", body: (
    <P>You have the right to access, correct, or delete your data at any time. You can also export your saved deals from your dashboard. To exercise any of these rights, email <ELink />. We will process deletion requests within 30 days.</P>
  )},
  { id:"contact", title:"Contact", body: (
    <>
      <P>Questions or concerns? Reach out directly:</P>
      <div style={{ marginTop:14, background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:14, padding:"18px 20px" }}>
        <p style={{ fontSize:14, fontWeight:700, color:"#0f172a", margin:"0 0 4px" }}>Adrian Du — Dealistic</p>
        <p style={{ fontSize:13, color:"#64748b", margin:0 }}><ELink /></p>
      </div>
      <P style={{ marginTop:14 }}>We aim to respond to all privacy-related inquiries within 5 business days.</P>
    </>
  )},
];

const CSS = [
  "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
  "html { scroll-behavior: smooth; }",
  "body { background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0f172a; }",
  ".prv-bar { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid #e2e8f0; background: rgba(255,255,255,0.88); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }",
  ".prv-bar-inner { max-width: 800px; margin: 0 auto; padding: 0 clamp(16px,4vw,40px); height: 52px; display: flex; align-items: center; justify-content: space-between; }",
  ".prv-brand { font-size: 15px; font-weight: 800; color: #0f172a; letter-spacing: -0.025em; text-decoration: none; background: none; border: none; cursor: pointer; font-family: inherit; transition: color 0.18s; padding: 0; }",
  ".prv-brand:hover { color: #2563eb; }",
  ".prv-back { font-size: 13px; color: #64748b; background: none; border: none; cursor: pointer; font-family: inherit; padding: 0; transition: color 0.18s; text-decoration: none; }",
  ".prv-back:hover { color: #0f172a; }",
  ".prv-outer { max-width: 1100px; margin: 0 auto; padding: clamp(40px,6vw,72px) clamp(16px,4vw,40px) clamp(48px,7vw,88px); display: grid; grid-template-columns: 1fr; gap: 0 60px; }",
  "@media (min-width: 1020px) { .prv-outer { grid-template-columns: 172px 1fr; } .prv-toc { display: block !important; } }",
  ".prv-toc { display: none; }",
  ".prv-toc-sticky { position: sticky; top: 68px; }",
  ".prv-toc-label { font-size: 10px; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 10px; }",
  ".prv-toc-link { display: block; font-size: 12px; font-weight: 500; color: #64748b; text-decoration: none; padding: 5px 0; transition: color 0.15s; line-height: 1.4; }",
  ".prv-toc-link:hover { color: #2563eb; }",
  ".prv-title { font-size: clamp(30px,5vw,48px); font-weight: 900; letter-spacing: -0.045em; color: #0f172a; line-height: 1.06; margin: 0 0 14px; }",
  ".prv-section { padding: 30px 0; border-bottom: 1px solid #f1f5f9; }",
  ".prv-section:last-child { border-bottom: none; }",
  ".prv-footer { border-top: 1px solid #e2e8f0; background: rgba(255,255,255,0.7); backdrop-filter: blur(8px); }",
  ".prv-footer-inner { max-width: 1100px; margin: 0 auto; padding: 22px clamp(16px,4vw,40px); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }",
  ".prv-footer p { font-size: 12px; color: #94a3b8; }",
  ".prv-flinks { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }",
  ".prv-flinks a { font-size: 12px; color: #94a3b8; text-decoration: none; font-weight: 500; transition: color 0.18s; }",
  ".prv-flinks a:hover { color: #2563eb; }",
].join(" ")

export default function PrivacyPage() {
  return (
    <>
      <style>{CSS}</style>
      <div style={{ background:"#f8fafc", minHeight:"100vh" }}>
        <div className="prv-bar">
          <div className="prv-bar-inner">
            <a href="/" className="prv-brand">Dealistic</a>
            <a href="/" className="prv-back">&larr; Back</a>
          </div>
        </div>

        <div className="prv-outer">
          <aside className="prv-toc">
            <div className="prv-toc-sticky">
              <span className="prv-toc-label">On this page</span>
              {sections.map(s => <a key={s.id} href={"#" + s.id} className="prv-toc-link">{s.title}</a>)}
            </div>
          </aside>

          <main>
            <div style={{ marginBottom:48, paddingBottom:32, borderBottom:"1px solid #e2e8f0" }}>
              <Eyebrow>Legal</Eyebrow>
              <h1 className="prv-title">Privacy Policy</h1>
              <p style={{ fontSize:14, color:"#64748b", lineHeight:1.6, margin:0 }}>
                How Dealistic handles your data &mdash; written in plain language.
                <br />
                <time dateTime={LAST_UPDATED} style={{ color:"#94a3b8", fontSize:13 }}>Last updated: {LAST_UPDATED}</time>
              </p>
            </div>
            {sections.map(s => (
              <section key={s.id} id={s.id} className="prv-section">
                <SectionTitle>{s.title}</SectionTitle>
                <div>{s.body}</div>
              </section>
            ))}
          </main>
        </div>

        <footer className="prv-footer">
          <div className="prv-footer-inner">
            <p>&copy; 2026 Dealistic. All rights reserved.</p>
            <div className="prv-flinks">
              <a href="/contact">Contact</a>
              <a href="https://www.linkedin.com/in/adriandu2004" target="_blank" rel="noopener noreferrer">LinkedIn &rarr;</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}