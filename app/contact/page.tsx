"use client";
import React, { useState } from "react";

const CONTACT_EMAIL = "dealistic.app@gmail.com";

type FormState = { name: string; email: string; phone: string; message: string };
const EMPTY: FormState = { name: "", email: "", phone: "", message: "" };

const CSS = [
  "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
  "body { background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0f172a; }",
  ".cnt-bar { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid #e2e8f0; background: rgba(255,255,255,0.88); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }",
  ".cnt-bar-inner { max-width: 640px; margin: 0 auto; padding: 0 clamp(16px,4vw,40px); height: 52px; display: flex; align-items: center; justify-content: space-between; }",
  ".cnt-brand { font-size: 15px; font-weight: 800; color: #0f172a; letter-spacing: -0.025em; text-decoration: none; background: none; border: none; cursor: pointer; font-family: inherit; transition: color 0.18s; padding: 0; }",
  ".cnt-brand:hover { color: #2563eb; }",
  ".cnt-back { font-size: 13px; color: #64748b; background: none; border: none; cursor: pointer; font-family: inherit; padding: 0; transition: color 0.18s; text-decoration: none; }",
  ".cnt-back:hover { color: #0f172a; }",
  ".cnt-main { max-width: 640px; margin: 0 auto; padding: clamp(40px,6vw,72px) clamp(16px,4vw,40px) clamp(48px,7vw,88px); }",
  ".cnt-card { background: rgba(255,255,255,0.92); border: 1px solid #e2e8f0; border-radius: 24px; padding: clamp(28px,4vw,48px); box-shadow: 0 4px 24px rgba(15,23,42,0.06); }",
  ".cnt-label { font-size: 11px; font-weight: 800; color: #374151; display: block; margin-bottom: 6px; letter-spacing: 0.01em; }",
  ".cnt-input { width: 100%; padding: 12px 14px; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; font-size: 14px; color: #0f172a; font-family: inherit; outline: none; box-shadow: 0 1px 3px rgba(15,23,42,0.04); transition: border-color 0.18s, box-shadow 0.18s; resize: none; }",
  ".cnt-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }",
  ".cnt-input::placeholder { color: #94a3b8; }",
  ".cnt-btn { padding: 13px 32px; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all 0.18s; flex-shrink: 0; }",
  ".cnt-btn:disabled { background: #e2e8f0; color: #94a3b8; cursor: not-allowed; box-shadow: none; }",
  ".cnt-btn:not(:disabled) { background: linear-gradient(135deg,#2563eb,#0ea5e9); color: #fff; box-shadow: 0 4px 14px rgba(37,99,235,0.28); }",
  ".cnt-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(37,99,235,0.36); }",
  ".cnt-footer { border-top: 1px solid #e2e8f0; background: rgba(255,255,255,0.7); backdrop-filter: blur(8px); }",
  ".cnt-footer-inner { max-width: 640px; margin: 0 auto; padding: 22px clamp(16px,4vw,40px); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }",
  ".cnt-footer p { font-size: 12px; color: #94a3b8; }",
  ".cnt-flinks { display: flex; gap: 20px; align-items: center; }",
  ".cnt-flinks a { font-size: 12px; color: #94a3b8; text-decoration: none; font-weight: 500; transition: color 0.18s; }",
  ".cnt-flinks a:hover { color: #2563eb; }",
].join(" ")

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitted, setSubmitted] = useState(false);

  const ready = form.name.trim() && form.email.trim() && form.message.trim();

  const handleSubmit = () => {
    if (!ready) return;
    const subject = encodeURIComponent("Dealistic Contact: " + form.name);
    const body = encodeURIComponent(
      "Name: " + form.name +
      "\nEmail: " + form.email +
      (form.phone ? "\nPhone: " + form.phone : "") +
      "\n\n" + form.message
    );
    window.location.href = "mailto:" + CONTACT_EMAIL + "?subject=" + subject + "&body=" + body;
    setSubmitted(true);
  };

  return (
    <>
      <style>{CSS}</style>
      <div style={{ background:"#f8fafc", minHeight:"100vh" }}>

        {/* Top bar */}
        <div className="cnt-bar">
          <div className="cnt-bar-inner">
            <a href="/" className="cnt-brand">Dealistic</a>
            <a href="/" className="cnt-back">&larr; Back</a>
          </div>
        </div>

        <div className="cnt-main">
          {/* Page header */}
          <div style={{ marginBottom:44, textAlign:"center" }}>
            <span style={{ fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", color:"#94a3b8", fontWeight:800, display:"block", marginBottom:14 }}>
              Get in touch
            </span>
            <h1 style={{ fontSize:"clamp(28px,5vw,44px)", fontWeight:900, letterSpacing:"-0.045em", color:"#0f172a", lineHeight:1.1, margin:"0 0 14px" }}>
              Contact Dealistic
            </h1>
            <p style={{ fontSize:15, color:"#64748b", lineHeight:1.7, margin:"0 auto", maxWidth:420 }}>
              Have a question, found a bug, or want to suggest a feature? We would love to hear from you.
            </p>
          </div>

          {submitted ? (
            /* Success state */
            <div className="cnt-card" style={{ textAlign:"center" }}>
              <div style={{ width:56, height:56, borderRadius:"50%", background:"linear-gradient(135deg,#f0fdf4,#dcfce7)", border:"1.5px solid #bbf7d0", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px", fontSize:22 }}>
                ✓
              </div>
              <h2 style={{ fontSize:22, fontWeight:800, color:"#0f172a", letterSpacing:"-0.03em", marginBottom:10 }}>
                Message sent!
              </h2>
              <p style={{ fontSize:14, color:"#64748b", lineHeight:1.7, marginBottom:28, maxWidth:360, margin:"0 auto 28px" }}>
                Your mail app should have opened with the message pre-filled. We will reply to{" "}
                <strong style={{ color:"#0f172a" }}>{form.email}</strong> as soon as possible.
              </p>
              <button
                className="cnt-btn"
                onClick={() => { setSubmitted(false); setForm(EMPTY); }}
                style={{ background:"none", border:"1.5px solid #e2e8f0", borderRadius:10, color:"#475569", fontSize:13, fontWeight:600, padding:"10px 24px", cursor:"pointer", fontFamily:"inherit", transition:"all 0.18s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#2563eb"; (e.currentTarget as HTMLElement).style.color = "#2563eb"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLElement).style.color = "#475569"; }}
              >
                Send another message
              </button>
            </div>
          ) : (
            /* Form card */
            <div className="cnt-card">
              <div style={{ display:"flex", flexDirection:"column", gap:22 }}>

                {/* Name + Email row */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:16 }}>
                  <div>
                    <label className="cnt-label">Name <span style={{ color:"#dc2626" }}>*</span></label>
                    <input
                      type="text" className="cnt-input" placeholder="Your name"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="cnt-label">Email <span style={{ color:"#dc2626" }}>*</span></label>
                    <input
                      type="email" className="cnt-input" placeholder="your@email.com"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="cnt-label">
                    Phone{" "}
                    <span style={{ fontSize:11, color:"#94a3b8", fontWeight:500 }}>(optional)</span>
                  </label>
                  <input
                    type="tel" className="cnt-input" placeholder="+1 (555) 000-0000"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="cnt-label">Message <span style={{ color:"#dc2626" }}>*</span></label>
                  <textarea
                    className="cnt-input" rows={5}
                    placeholder="Tell us what is on your mind — feedback, questions, feature requests, or bug reports are all welcome."
                    value={form.message}
                    onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                    style={{ minHeight:120 }}
                  />
                </div>

                {/* Footer row */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap" }}>
                  <p style={{ fontSize:12, color:"#94a3b8", margin:0 }}>
                    Or email directly:{" "}
                    <a href={"mailto:" + CONTACT_EMAIL} style={{ color:"#2563eb", fontWeight:600, textDecoration:"none" }}>
                      {CONTACT_EMAIL}
                    </a>
                  </p>
                  <button
                    className="cnt-btn"
                    onClick={handleSubmit}
                    disabled={!ready}
                  >
                    Send Message &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Trust note */}
          <p style={{ fontSize:12, color:"#94a3b8", textAlign:"center", marginTop:24, lineHeight:1.6 }}>
            We typically respond within 1&ndash;2 business days. Your message goes directly to the founder.
          </p>
        </div>

        {/* Footer */}
        <footer className="cnt-footer">
          <div className="cnt-footer-inner">
            <p>&copy; 2026 Dealistic. All rights reserved.</p>
            <div className="cnt-flinks">
              <a href="/privacy">Privacy</a>
              <a href="https://www.linkedin.com/in/adriandu2004" target="_blank" rel="noopener noreferrer">LinkedIn &rarr;</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}