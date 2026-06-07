// Verify a Firebase Auth ID token (RS256 JWT) inside a Cloudflare Worker using Web Crypto —
// no Node, no SDK. Returns the Firebase uid (the `sub` claim) or null if invalid/expired.
//
// Steps: fetch Google's rotating public keys (JWK), match by `kid`, verify the RSA signature,
// and check aud === <projectId>, iss === https://securetoken.google.com/<projectId>, and exp.
import type { Env } from "./types";

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg: string;
}

// Per-isolate cache of imported verify keys, honoring the endpoint's Cache-Control max-age.
let keyCache: { keys: Record<string, CryptoKey>; exp: number } | null = null;

const JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

async function getKeys(): Promise<Record<string, CryptoKey>> {
  const now = Date.now();
  if (keyCache && keyCache.exp > now) return keyCache.keys;
  const res = await fetch(JWK_URL);
  const body = (await res.json()) as { keys: Jwk[] };
  const keys: Record<string, CryptoKey> = {};
  for (const jwk of body.keys) {
    keys[jwk.kid] = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  const cc = res.headers.get("cache-control") ?? "";
  const m = cc.match(/max-age=(\d+)/);
  const ttl = m ? parseInt(m[1], 10) * 1000 : 3_600_000;
  keyCache = { keys, exp: now + ttl };
  return keys;
}

function b64urlToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

export interface VerifiedToken {
  uid: string;
  email: string | null;
}

/** Returns the verified uid + email, or null if the token is missing/invalid/expired. */
export async function verifyFirebaseToken(token: string, env: Env): Promise<VerifiedToken | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string; iss?: string; sub?: string; exp?: number; email?: string };
  try {
    header = JSON.parse(b64urlToString(h));
    payload = JSON.parse(b64urlToString(p));
  } catch {
    return null;
  }
  const projectId = env.FIREBASE_PROJECT_ID;
  if (header.alg !== "RS256" || !header.kid) return null;
  if (payload.aud !== projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (!payload.sub) return null;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;

  const key = (await getKeys())[header.kid];
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  return ok ? { uid: payload.sub, email: payload.email ?? null } : null;
}
