"use client";
// ─── app/signup/page.tsx ── SIGN UP PAGE ──────────────────────────────────────
// Next.js route: GET /signup
// Drop this file into your Next.js app/signup/ directory.
// No external imports — works in both Next.js dev server and artifact preview.

import React, { useState, Suspense } from "react";

// ── Supabase client shim ──────────────────────────────────────────────────────
// Artifact-safe stub. In Next.js, replace getSupabase() body with:
//   return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
function getSupabase() {
  const SK="supa_stub_session", AK="supa_stub_accounts";
  function ph(pw:string){let h=0;for(let i=0;i<pw.length;i++)h=(Math.imul(31,h)+pw.charCodeAt(i))|0;return h.toString(36);}
  function accts():Record<string,{name:string;hash:string}>{try{return JSON.parse(localStorage.getItem(AK)??"{}"); }catch{return {};}}
  return {
    auth: {
      async signUp({email,password,options}:{email:string;password:string;options?:{data?:{full_name?:string}}}) {
        const key=email.trim().toLowerCase(), a=accts();
        if(a[key]) return {data:{user:null},error:{message:"User already registered"}};
        const name=options?.data?.full_name??key.split("@")[0];
        a[key]={name,hash:ph(password)};
        localStorage.setItem(AK,JSON.stringify(a));
        const user={id:key,email:key,user_metadata:{full_name:name}};
        localStorage.setItem(SK,JSON.stringify({user}));
        return {data:{user},error:null};
      }
    }
  };
}

function useQueryParams(){if(typeof window==="undefined")return new URLSearchParams();return new URLSearchParams(window.location.search);}
function go(href:string){window.location.href=href;}

function Field({label,type,placeholder,value,onChange,error,hint,autoComplete}:{
  label:string;type:string;placeholder:string;value:string;
  onChange:(v:string)=>void;error?:string;hint?:string;autoComplete?:string;
}){
  const [f,setF]=useState(false);
  const F="'Helvetica Neue',Helvetica,Arial,sans-serif";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      <label style={{fontSize:11,fontWeight:600,color:"#374151",fontFamily:F}}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} autoComplete={autoComplete}
        onChange={e=>onChange(e.target.value)}
        onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:"100%",boxSizing:"border-box",background:"#fff",border:`1.5px solid ${error?"#dc2626":f?"#2563eb":"#e2e8f0"}`,borderRadius:10,color:"#0f172a",fontSize:14,padding:"10px 14px",outline:"none",fontFamily:F,boxShadow:f?`0 0 0 3px ${error?"rgba(220,38,38,.12)":"rgba(37,99,235,.12)"}`:"none",transition:"border-color .18s,box-shadow .18s"}}
      />
      {error&&<p style={{fontSize:11,color:"#dc2626",margin:0,fontFamily:F}}>{error}</p>}
      {hint&&!error&&<p style={{fontSize:11,color:"#94a3b8",margin:0,fontFamily:F}}>{hint}</p>}
    </div>
  );
}

function SignUpForm() {
  useQueryParams(); // reads ?error= from URL if redirected back after server error
  const [name,setName]         = useState("");
  const [email,setEmail]       = useState("");
  const [password,setPassword] = useState("");
  const [confirm,setConfirm]   = useState("");
  const [errors,setErrors]     = useState<Record<string,string>>({});
  const [loading,setLoading]   = useState(false);
  const F = "'Helvetica Neue',Helvetica,Arial,sans-serif";

  async function submit(e:React.FormEvent) {
    e.preventDefault();
    const errs:Record<string,string>={};
    const trimEmail=email.trim().toLowerCase();
    if(!name.trim())               errs.name="Name is required.";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) errs.email="Enter a valid email.";
    if(password.length<8)          errs.password="Password must be at least 8 characters.";
    if(confirm!==password)         errs.confirm="Passwords do not match.";
    if(Object.keys(errs).length){setErrors(errs);return;}
    setLoading(true); setErrors({});
    const {data,error}=await getSupabase().auth.signUp({email:trimEmail,password,options:{data:{full_name:name.trim()}}});
    setLoading(false);
    if(error){
      if(error.message.toLowerCase().includes("already registered"))
        setErrors({email:"An account with this email already exists. Try logging in."});
      else setErrors({general:error.message});
      return;
    }
    if(data?.user) go("/");
  }

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
          <h1 style={{fontSize:22,fontWeight:800,color:"#0f172a",letterSpacing:"-0.03em",margin:"0 0 6px",fontFamily:F}}>Create your account</h1>
          <p style={{fontSize:13,color:"#64748b",margin:0,fontFamily:F}}>Free forever. No credit card required.</p>
        </div>

        {errors.general&&(
          <div style={{padding:"10px 14px",background:"#fff1f2",border:"1px solid #fecdd3",borderRadius:10,marginBottom:16}}>
            <p style={{fontSize:12,color:"#dc2626",margin:0,fontFamily:F}}>{errors.general}</p>
          </div>
        )}

        <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:14}}>
          <Field label="Full Name"        type="text"     placeholder="Jane Smith"       value={name}     onChange={setName}     error={errors.name}     autoComplete="name" />
          <Field label="Email"            type="email"    placeholder="you@example.com"  value={email}    onChange={setEmail}    error={errors.email}    autoComplete="email" />
          <Field label="Password"         type="password" placeholder="Min. 8 characters" value={password} onChange={setPassword} error={errors.password} hint="At least 8 characters." autoComplete="new-password" />
          <Field label="Confirm Password" type="password" placeholder="Repeat password"  value={confirm}  onChange={setConfirm}  error={errors.confirm}  autoComplete="new-password" />

          <button type="submit" disabled={loading}
            style={{width:"100%",padding:"12px",border:"none",borderRadius:10,marginTop:2,background:loading?"#94a3b8":"linear-gradient(135deg,#2563eb,#0ea5e9)",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",fontFamily:F,boxShadow:loading?"none":"0 4px 14px rgba(37,99,235,.3)",transition:"opacity .15s"}}
            onMouseEnter={e=>{if(!loading)(e.currentTarget as HTMLElement).style.opacity="0.88";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.opacity="1";}}>
            {loading?"Creating account…":"Create Account →"}
          </button>
        </form>

        <p style={{fontSize:13,color:"#64748b",textAlign:"center",marginTop:22,fontFamily:F}}>
          Already have an account?{" "}
          <a href="/login" style={{color:"#2563eb",fontWeight:600,textDecoration:"none",fontFamily:F}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.textDecoration="underline";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.textDecoration="none";}}>
            Log in
          </a>
        </p>

        <p style={{fontSize:10,color:"#94a3b8",marginTop:14,textAlign:"center",lineHeight:1.6,fontFamily:F}}>
          By signing up, you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return <Suspense><SignUpForm /></Suspense>;
}