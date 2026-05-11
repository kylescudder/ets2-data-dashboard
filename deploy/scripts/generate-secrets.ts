#!/usr/bin/env bun
// Emits a fresh set of Supabase self-host secrets to stdout, ready to paste
// into the .env of a new project. Run with `bun deploy/scripts/generate-secrets.ts`.
//
// Each invocation generates:
//   - JWT_SECRET                     HS256 signing key (64 hex chars)
//   - ANON_KEY, SERVICE_ROLE_KEY     10-year HS256 JWTs signed with JWT_SECRET
//   - POSTGRES_PASSWORD              48 hex chars
//   - DASHBOARD_PASSWORD             40 hex chars (Studio basic-auth)
//   - SECRET_KEY_BASE                Realtime service key
//   - VAULT_ENC_KEY                  pgsodium/vault encryption key
//   - LOGFLARE_*                     keys for the optional log stack
//
// Save the output once — losing JWT_SECRET means re-issuing every client key.

import { randomBytes } from "node:crypto";

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();
  const signingInput =
    b64url(enc.encode(JSON.stringify(header))) +
    "." +
    b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

const hex = (n: number) => randomBytes(n).toString("hex");
const b64 = (n: number) => randomBytes(n).toString("base64");

const now = Math.floor(Date.now() / 1000);
const tenYears = 10 * 365 * 24 * 3600;
const jwtSecret = hex(32);
const anonKey = await signJwt(
  { role: "anon", iss: "supabase", iat: now, exp: now + tenYears },
  jwtSecret,
);
const serviceRoleKey = await signJwt(
  { role: "service_role", iss: "supabase", iat: now, exp: now + tenYears },
  jwtSecret,
);

process.stdout.write(`# Generated ${new Date().toISOString()}
POSTGRES_PASSWORD=${hex(24)}
JWT_SECRET=${jwtSecret}
ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceRoleKey}
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=${hex(20)}
SECRET_KEY_BASE=${b64(48)}
VAULT_ENC_KEY=${hex(16)}
LOGFLARE_PUBLIC_ACCESS_TOKEN=${hex(16)}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${hex(16)}
`);
