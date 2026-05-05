import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "ets2_session";
const SESSION_TTL_MS = 7 * 86_400_000;

const isProd = process.env.NODE_ENV === "production";

const DEFAULT_PASSWORD = "letmein";
const DEFAULT_SESSION_SECRET = "dev-session-secret-change-me";
const DEFAULT_INTERNAL_TOKEN = "dev-internal-token-change-me";

export const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? DEFAULT_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET ?? DEFAULT_SESSION_SECRET;
export const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? DEFAULT_INTERNAL_TOKEN;
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

export function checkSecretsAtBoot(log: { warn: (msg: string) => void }) {
  const usingDefaults: string[] = [];
  if (DASHBOARD_PASSWORD === DEFAULT_PASSWORD) usingDefaults.push("DASHBOARD_PASSWORD");
  if (SESSION_SECRET === DEFAULT_SESSION_SECRET) usingDefaults.push("SESSION_SECRET");
  if (INTERNAL_API_TOKEN === DEFAULT_INTERNAL_TOKEN) usingDefaults.push("INTERNAL_API_TOKEN");
  if (usingDefaults.length === 0) return;
  if (isProd) {
    throw new Error(
      `[auth] refusing to start with default secrets in production: ${usingDefaults.join(", ")}`,
    );
  }
  log.warn(`[auth] using insecure dev defaults for ${usingDefaults.join(", ")}`);
}

function hmac(msg: string): string {
  return createHmac("sha256", SESSION_SECRET).update(msg).digest("base64url");
}

export function signSession(iatMs = Date.now()): string {
  const iat = String(iatMs);
  return `${iat}.${hmac(iat)}`;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const iat = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const iatNum = Number(iat);
  if (!Number.isFinite(iatNum)) return false;
  if (Date.now() - iatNum > SESSION_TTL_MS) return false;
  const expected = hmac(iat);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function setSessionCookie(reply: FastifyReply) {
  reply.setCookie(SESSION_COOKIE, signSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

function bearer(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export function isAuthorized(req: FastifyRequest): boolean {
  if (bearer(req) === INTERNAL_API_TOKEN) return true;
  return verifySession(req.cookies?.[SESSION_COOKIE]);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!isAuthorized(req)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

export function ingestKey(req: FastifyRequest): string | null {
  return bearer(req);
}
