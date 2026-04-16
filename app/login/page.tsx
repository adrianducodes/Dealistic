"use client";
// ─── app/login/page.tsx ── LOGIN PAGE ─────────────────────────────────────────
// Next.js route: GET /login
// Drop this file into your Next.js app/login/ directory.
// No external imports — works in both Next.js dev server and artifact preview.

import React, { useState, Suspense } from "react";

// ── Supabase client shim ──────────────────────────────────────────────────────
// Artifact-safe stub. In Next.js, replace getSupabase() body with:
//   return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
function getSupabase() {
  const SK = "supa_stub_session", AK = "supa_stub_accounts";
  function ph(pw: string) { let h=0; for(let i=0;i<pw.length;i++) h=(Math.imul(31,h)+pw.charCodeAt(i))|0; return h.toString(36); }
  function accts(): Record<string,{name:string;hash:string}> { try{return JSON.parse(localStorage.getItem(AK)??"{}"); }catch{return {};} }
  return {
    auth: {
      async signInWithPassword({email,password}:{email:string;password:string}) {
        const key=email.trim().toLowerCase(), a=accts()[key];
        if(!a) return {data:{user:null},error:{message:"User not found"}};
        if(ph(password)!==a.hash) return {data:{user:null},error:{message:"Invalid credentials"}};
        const user={id:key,email:key,user_metadata:{full_name:a.name}};
        localStorage.setItem(SK,JSON.stringify({user}));
        return {data:{user},error:null};
      }
    }
  };
}

function useQueryParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}
function go(href: string) { window.location.href = href; }

// ── Styled input field ─────────────────────────────────────────────────────────
function Field({ label, type, placeholder, value, onChange, error, autoComplete }: {
  label:string; type:string; placeholder:string; value:string;
  onChange:(v:string)=>void; error?:string; autoComplete?:string;
}) {
  const [f,setF]=useState(false);
  const F = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      <label style={{fontSize:11,fontWeight:600,color:"#374151",fontFamily:F}}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} autoComplete={autoComplete}
        onChange={e=>onChange(e.target.value)}
        onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:"100%",boxSizing:"border-box",background:"#fff",border:`1.5px solid ${error?"#dc2626":f?"#2563eb":"#e2e8f0"}`,borderRadius:10,color:"#0f172a",fontSize:14,padding:"10px 14px",outline:"none",fontFamily:F,boxShadow:f?`0 0 0 3px ${error?"rgba(220,38,38,.12)":"rgba(37,99,235,.12)"}`:"none",transition:"border-color .18s,box-shadow .18s"}}
      />
      {error&&<p style={{fontSize:11,color:"#dc2626",margin:0,fontFamily:F}}>{error}</p>}
    </div>
  );
}

// ── Main login form ────────────────────────────────────────────────────────────
function LoginForm() {
  const params = useQueryParams();
  const redirectTo = params.get("redirectTo") ?? "/";
  const urlError   = params.get("error");

  const [email,setEmail]       = useState("");
  const [password,setPassword] = useState("");
  const [errors,setErrors]     = useState<Record<string,string>>({});
  const [loading,setLoading]   = useState(false);
  const F = "'Helvetica Neue',Helvetica,Arial,sans-serif";

  async function submit(e:React.FormEvent) {
    e.preventDefault();
    const trimEmail = email.trim().toLowerCase();
    if(!trimEmail||!password){setErrors({general:"Please enter your email and password."});return;}
    setLoading(true); setErrors({});
    const {data,error} = await getSupabase().auth.signInWithPassword({email:trimEmail,password});
    setLoading(false);
    if(error){
      const m=error.message.toLowerCase();
      if(m.includes("invalid")||m.includes("credentials")) setErrors({password:"Incorrect password. Please try again."});
      else if(m.includes("not found")) setErrors({general:"No account found. Did you mean to sign up?"});
      else setErrors({general:error.message});
      return;
    }
    if(data?.user) go(redirectTo==="/"?"/":redirectTo);
  }

  const err: Record<string, string | undefined> = {...errors, ...(urlError?{general:decodeURIComponent(urlError)}:{})};

  return (
    <div style={{background:"#f8fafc",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"clamp(24px,6vw,80px) 16px",fontFamily:F}}>

      {/* ← Back */}
      <div style={{width:"100%",maxWidth:400,marginBottom:24}}>
        <a href="/" style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:13,color:"#64748b",textDecoration:"none",fontFamily:F}}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color="#0f172a";}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color="#64748b";}}>
          ← Back to Home
        </a>
      </div>

      {/* Brand */}
      <div style={{marginBottom:28,textAlign:"center"}}>
        <span style={{fontSize:20,fontWeight:900,letterSpacing:"-0.03em",color:"#0f172a",fontFamily:F}}>Dealistic</span>
      </div>

      {/* Card */}
      <div style={{width:"100%",maxWidth:400,background:"#fff",borderRadius:20,border:"1px solid #e2e8f0",padding:"clamp(24px,5vw,36px) clamp(20px,5vw,36px)",boxShadow:"0 4px 24px rgba(15,23,42,.07),0 1px 4px rgba(15,23,42,.04)"}}>

        <div style={{marginBottom:24}}>
          <h1 style={{fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:"-0.03em",margin:"0 0 6px",fontFamily:F}}>Welcome back</h1>
          <p style={{fontSize:13,color:"#64748b",margin:0,fontFamily:F}}>Log in to your Dealistic account</p>
        </div>

        {err.general&&(
          <div style={{padding:"10px 14px",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:10,marginBottom:16}}>
            <p style={{fontSize:12,color:"#dc2626",margin:0,fontFamily:F}}>{err.general}</p>
          </div>
        )}

        <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:16}}>
          <Field label="Email"    type="email"    placeholder="you@example.com" value={email}    onChange={setEmail}    error={err.email}    autoComplete="email" />
          <Field label="Password" type="password" placeholder="Your password"   value={password} onChange={setPassword} error={err.password} autoComplete="current-password" />
          <button type="submit" disabled={loading}
            style={{width:"100%",padding:"12px",border:"none",borderRadius:10,background:loading?"#94a3b8":"linear-gradient(135deg,#2563eb,#0ea5e9)",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",fontFamily:F,boxShadow:loading?"none":"0 4px 14px rgba(37,99,235,.3)",transition:"opacity .15s"}}
            onMouseEnter={e=>{if(!loading)(e.currentTarget as HTMLElement).style.opacity="0.88";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.opacity="1";}}>
            {loading?"Logging in…":"Log In →"}
          </button>
        </form>

        <div style={{height:1,background:"#f1f5f9",margin:"24px 0 20px"}}/>

        {/* Create account CTA */}
        <div style={{background:"linear-gradient(135deg,#eff6ff,#f0fdf4)",border:"1px solid #bfdbfe",borderRadius:14,padding:"16px 18px"}}>
          <p style={{fontSize:13,fontWeight:700,color:"#0f172a",margin:"0 0 4px",fontFamily:F}}>New to Dealistic?</p>
          <p style={{fontSize:12,color:"#475569",margin:"0 0 14px",lineHeight:1.55,fontFamily:F}}>Save deals, keep your defaults, and access your dashboard from any device.</p>
          <a href="/signup"
            style={{display:"block",padding:"10px",border:"1.5px solid #0f172a",borderRadius:9,background:"transparent",color:"#0f172a",fontSize:13,fontWeight:700,textAlign:"center",textDecoration:"none",fontFamily:F,transition:"all .15s"}}
            onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.background="#0f172a";el.style.color="#fff";}}
            onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.background="transparent";el.style.color="#0f172a";}}>
            Create free account →
          </a>
        </div>

        <p style={{fontSize:10,color:"#94a3b8",marginTop:18,textAlign:"center",lineHeight:1.6,fontFamily:F}}>
          Session persists across page refreshes via Supabase.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}