/**
 * /app/api/parse-property/route.ts
 *
 * Save this file at: app/api/parse-property/route.ts
 * (App Router — NOT pages/api/)
 *
 * Run:  npm run dev   then paste a Zillow URL in the Dealistic UI.
 * Logs: watch your terminal — every step is logged with [parse-property].
 */

import { NextRequest, NextResponse } from "next/server";

const TAG = "[parse-property]";

export interface ParsedProperty {
  address?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  propertyType?: string;
  yearBuilt?: number;
  rent?: number;
  source: string;
  confidence: "high" | "medium" | "low";
  rawUrl: string;
  warnings: string[];
  debugInfo?: string[];
}

// ─── URL-path extraction ──────────────────────────────────────────────────────
function extractFromUrlPath(rawUrl: string): {
  data: Partial<ParsedProperty>; warnings: string[]; debug: string[];
} {
  const warnings: string[] = [];
  const debug: string[] = [];
  const data: Partial<ParsedProperty> = {};
  try {
    const u = new URL(rawUrl);
    const path = u.pathname;
    debug.push(`host=${u.hostname} path=${path}`);

    if (u.hostname.includes("zillow.com")) {
      const m = path.match(/\/homedetails\/([^/]+)\//);
      if (m) {
        const slug = m[1];
        const clean = slug
          .replace(/-([A-Z]{2})-(\d{5})/, ", $1 $2")
          .replace(/-(\d{5}(?:-\d{4})?)$/, ", $1")
          .replace(/-/g, " ");
        data.address = clean.replace(/\b\w/g, c => c.toUpperCase()).trim();
        debug.push(`Zillow slug -> address: ${data.address}`);
      } else {
        warnings.push("Paste the full Zillow listing URL (it should contain /homedetails/).");
      }
    }

    if (u.hostname.includes("redfin.com")) {
      const m = path.match(/\/([A-Z]{2})\/([^/]+)\/([^/]+)\/home\//);
      if (m) {
        const [, state, city, street] = m;
        const fmt = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        data.address = `${fmt(street)}, ${fmt(city)}, ${state}`;
        debug.push(`Redfin slug -> address: ${data.address}`);
      }
    }

    if (u.hostname.includes("realtor.com")) {
      const m = path.match(/\/realestateandhomes-detail\/([^/]+)/);
      if (m) {
        const slug = m[1].replace(/_M[\d-]+$/, "").replace(/_/g, ", ").replace(/-/g, " ");
        data.address = slug.split(", ").map(p => p.replace(/\b\w/g, c => c.toUpperCase()).trim()).join(", ");
        debug.push(`Realtor slug -> address: ${data.address}`);
      }
    }
  } catch (e) {
    warnings.push("URL parse error: " + String(e));
  }
  return { data, warnings, debug };
}

// ─── HTML extraction ──────────────────────────────────────────────────────────
async function extractFromHtml(rawUrl: string): Promise<{
  data: Partial<ParsedProperty>; warnings: string[]; debug: string[];
}> {
  const warnings: string[] = [];
  const debug: string[] = [];
  const data: Partial<ParsedProperty> = {};

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
  };

  let html = "";
  try {
    console.log(`${TAG} Fetching: ${rawUrl}`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(rawUrl, { headers, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    debug.push(`HTTP ${res.status} ${res.statusText}`);
    console.log(`${TAG} HTTP status: ${res.status}`);

    if (res.status === 403) {
      warnings.push("Zillow blocked this request (403 Forbidden — bot protection active). Address was extracted from the URL. Please enter price and other details manually.");
      return { data, warnings, debug };
    }
    if (res.status === 429) {
      warnings.push("Rate limited (429). Wait a minute and try again, or enter details manually.");
      return { data, warnings, debug };
    }
    if (!res.ok) {
      warnings.push(`Site returned HTTP ${res.status}. URL-based data only.`);
      return { data, warnings, debug };
    }
    html = await res.text();
    debug.push(`HTML bytes: ${html.length}`);
    console.log(`${TAG} HTML length: ${html.length} chars`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.includes("abort") || msg.toLowerCase().includes("timeout");
    warnings.push(isTimeout
      ? "Request timed out (9s). The site may be slow or blocking access."
      : `Fetch error: ${msg}`);
    console.error(`${TAG} Fetch threw:`, msg);
    return { data, warnings, debug };
  }

  // Detect bot/CAPTCHA wall
  const isBotWall =
    html.length < 5000 ||
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("Enable JavaScript and cookies to continue") ||
    html.toLowerCase().includes("captcha");

  if (isBotWall) {
    console.warn(`${TAG} Bot wall detected (HTML length: ${html.length})`);
    warnings.push("This listing site blocked automatic extraction (bot/CAPTCHA wall). Address has been extracted from the URL — please enter the price and other details manually.");
    return { data, warnings, debug };
  }

  // JSON-LD
  const jlds = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  debug.push(`JSON-LD blocks: ${jlds.length}`);
  for (const m of jlds) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const t = String(item["@type"] ?? "").toLowerCase();
        if (t.includes("realestate") || t.includes("residence") || t.includes("house")) {
          if (item.address && !data.address) {
            const a = item.address;
            const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(", ");
            if (parts) { data.address = parts; debug.push(`JSON-LD addr: ${parts}`); }
          }
          if (item.price && !data.price) {
            const p = parseInt(String(item.price).replace(/\D/g, ""), 10);
            if (p > 10000) { data.price = p; debug.push(`JSON-LD price: ${p}`); }
          }
        }
      }
    } catch { /* skip malformed */ }
  }

  // Zillow __NEXT_DATA__
  if (rawUrl.includes("zillow.com")) {
    const ndm = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (ndm) {
      debug.push("Found __NEXT_DATA__");
      try {
        const flat = JSON.stringify(JSON.parse(ndm[1]));
        const pick = (re: RegExp) => flat.match(re)?.[1];
        const p  = pick(/"price":(\d{5,})/);
        const bd = pick(/"bedrooms":(\d+)/);
        const ba = pick(/"bathrooms":([\d.]+)/);
        const sf = pick(/"livingArea":(\d+)/);
        const yr = pick(/"yearBuilt":(\d{4})/);
        const tp = pick(/"homeType":"([^"]+)"/);
        const rz = pick(/"rentZestimate":(\d+)/);
        const st = pick(/"streetAddress":"([^"]+)"/);
        const ci = pick(/"city":"([^"]+)"/);
        const sv = pick(/"state":"([^"]+)"/);
        const zp = pick(/"zipcode":"([^"]+)"/);
        if (p  && !data.price)        { data.price        = parseInt(p, 10);     debug.push(`ND price: ${data.price}`); }
        if (bd && !data.bedrooms)     { data.bedrooms     = parseInt(bd, 10); }
        if (ba && !data.bathrooms)    { data.bathrooms    = parseFloat(ba); }
        if (sf && !data.sqft)         { data.sqft         = parseInt(sf, 10); }
        if (yr && !data.yearBuilt)    { data.yearBuilt    = parseInt(yr, 10); }
        if (tp && !data.propertyType) {
          const map: Record<string,string> = { SINGLE_FAMILY:"Single Family", CONDO:"Condo", TOWNHOUSE:"Townhouse", MULTI_FAMILY:"Multi-Family", APARTMENT:"Apartment" };
          data.propertyType = map[tp.toUpperCase()] ?? tp;
        }
        if (rz && !data.rent)         { data.rent         = parseInt(rz, 10); }
        if (st && ci && sv && !data.address) {
          data.address = `${st}, ${ci}, ${sv}${zp ? " " + zp : ""}`;
          debug.push(`ND address: ${data.address}`);
        }
      } catch (e) { debug.push("__NEXT_DATA__ parse fail: " + String(e)); }
    } else {
      debug.push("No __NEXT_DATA__ block (Zillow may have changed schema)");
    }

    // Title fallback
    const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tm) {
      const t = tm[1];
      debug.push(`Title: ${t}`);
      if (!data.price) {
        const pm = t.match(/\$([0-9,]+)/);
        if (pm) { data.price = parseInt(pm[1].replace(/,/g,""), 10); debug.push(`Title price: ${data.price}`); }
      }
      if (!data.bedrooms) { const bm = t.match(/(\d+)\s*bd/i); if (bm) data.bedrooms = parseInt(bm[1], 10); }
      if (!data.bathrooms) { const bm = t.match(/([\d.]+)\s*ba/i); if (bm) data.bathrooms = parseFloat(bm[1]); }
    }
  }

  // OG fallback for address
  if (!data.address) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og) {
      const addr = og[1].split("|")[0].split(" - ")[0].trim();
      if (addr.length > 5 && addr.length < 120) { data.address = addr; debug.push(`OG addr: ${addr}`); }
    }
  }

  const found = Object.entries(data).filter(([,v]) => v !== undefined).map(([k]) => k).join(", ");
  console.log(`${TAG} HTML parse done. Found: ${found || "nothing"}`);
  return { data, warnings, debug };
}

function scoreConfidence(p: Partial<ParsedProperty>): "high" | "medium" | "low" {
  const n = [p.price, p.address, p.bedrooms, p.bathrooms, p.sqft].filter(Boolean).length;
  return n >= 4 ? "high" : n >= 2 ? "medium" : "low";
}

function detectSource(url: string): string {
  if (url.includes("zillow.com"))  return "Zillow";
  if (url.includes("redfin.com"))  return "Redfin";
  if (url.includes("realtor.com")) return "Realtor.com";
  if (url.includes("trulia.com"))  return "Trulia";
  return "Unknown";
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log(`\n${TAG} ── Incoming request ──`);

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    console.error(`${TAG} Bad request body`);
    return NextResponse.json({ error: "Invalid request — body must be JSON with a 'url' field." }, { status: 400 });
  }

  const { url } = body;
  console.log(`${TAG} URL: ${url}`);

  if (!url?.trim()) {
    return NextResponse.json({ error: "No URL provided." }, { status: 400 });
  }

  let parsedUrl: URL;
  try { parsedUrl = new URL(url.trim()); }
  catch {
    return NextResponse.json({
      error: "That doesn't look like a valid URL. Paste the full link starting with https://."
    }, { status: 400 });
  }

  const ALLOWED = ["zillow.com","redfin.com","realtor.com","trulia.com","homes.com","loopnet.com"];
  if (!ALLOWED.some(h => parsedUrl.hostname.includes(h))) {
    return NextResponse.json({
      error: `"${parsedUrl.hostname}" isn't supported. Paste a Zillow, Redfin, or Realtor.com listing URL.`
    }, { status: 400 });
  }

  const source = detectSource(url);
  console.log(`${TAG} Source: ${source}`);

  const urlRes  = extractFromUrlPath(url);
  const htmlRes = await extractFromHtml(url);
  console.log(`${TAG} URL data:`, urlRes.data, `| HTML data:`, htmlRes.data);

  const merged: Partial<ParsedProperty> = {
    address:      htmlRes.data.address      ?? urlRes.data.address,
    price:        htmlRes.data.price        ?? urlRes.data.price,
    bedrooms:     htmlRes.data.bedrooms     ?? urlRes.data.bedrooms,
    bathrooms:    htmlRes.data.bathrooms    ?? urlRes.data.bathrooms,
    sqft:         htmlRes.data.sqft         ?? urlRes.data.sqft,
    propertyType: htmlRes.data.propertyType ?? urlRes.data.propertyType,
    yearBuilt:    htmlRes.data.yearBuilt    ?? urlRes.data.yearBuilt,
    rent:         htmlRes.data.rent         ?? urlRes.data.rent,
  };

  const allWarnings = [...new Set([...urlRes.warnings, ...htmlRes.warnings])];
  const allDebug    = [...urlRes.debug, ...htmlRes.debug];

  if (!Object.values(merged).some(v => v !== undefined)) {
    const blocked = allWarnings.some(w => w.includes("blocked") || w.includes("403") || w.includes("bot"));
    console.warn(`${TAG} No data extracted. blocked=${blocked}`);
    return NextResponse.json({
      error: blocked
        ? "This listing site blocked automatic extraction. Please enter the property details manually."
        : "Could not extract any property data from this URL. The page structure may have changed. Please enter details manually.",
      source, rawUrl: url, warnings: allWarnings,
    }, { status: 422 });
  }

  const result: ParsedProperty = {
    ...merged, source,
    confidence: scoreConfidence(merged),
    rawUrl: url,
    warnings: allWarnings,
    ...(process.env.NODE_ENV === "development" ? { debugInfo: allDebug } : {}),
  };

  console.log(`${TAG} Done. confidence=${result.confidence} fields=${Object.entries(merged).filter(([,v])=>v!==undefined).map(([k])=>k).join(",")}\n`);
  return NextResponse.json(result);
}