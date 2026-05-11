import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Skip /auth/callback so its 303 response isn't merged with the middleware's
// session-refresh response (which preserves the inbound query string and
// re-attaches ?code=… to our redirect target).
export const config = {
  matcher: ["/((?!_next/|favicon.ico|auth/callback).*)"],
};

export async function middleware(request: NextRequest) {
  return updateSession(request);
}
