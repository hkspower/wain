// KNET (KPC) direct-integration crypto + helpers.
//
// KNET encrypts the "trandata" payload with AES-128-CBC using your Terminal
// Resource Key as the key and a FIXED IV of "PGKEYENCDECIVSPC", PKCS7 padding,
// hex-encoded. This matches KNET Co's Java reference (AES/CBC/PKCS5Padding).
//
// Keep the resource key server-side only (Supabase function secret). Never ship
// it to the browser.

const IV = new TextEncoder().encode("PGKEYENCDECIVSPC"); // 16 bytes, fixed by KNET

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function importKey(resourceKey: string): Promise<CryptoKey> {
  // KNET keys are ASCII; AES needs 16/24/32 bytes. Most terminals use a 16-char
  // key. If yours differs, KNET will have told you the exact key to use as-is.
  const raw = new TextEncoder().encode(resourceKey);
  return crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// Encrypt the trandata query string -> uppercase hex (what KNET expects).
export async function knetEncrypt(plain: string, resourceKey: string): Promise<string> {
  const key = await importKey(resourceKey);
  const enc = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: IV },
    key,
    new TextEncoder().encode(plain),
  );
  return bytesToHex(new Uint8Array(enc));
}

// Decrypt KNET's hex response trandata -> plain query string.
export async function knetDecrypt(hex: string, resourceKey: string): Promise<string> {
  const key = await importKey(resourceKey);
  const dec = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: IV },
    key,
    hexToBytes(hex),
  );
  return new TextDecoder().decode(dec);
}

// Build a KNET trandata query string from key/value pairs (order matters to
// some terminals; keep the canonical order below).
export function buildTrandata(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// Parse KNET's response query string back into an object.
export function parseResponse(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    const [k, ...rest] = pair.split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}
