import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Skip callback redirects and static map tiles; both need to pass through untouched.
export const config = {
  matcher: ["/((?!_next/|favicon.ico|auth/callback|ets2-map/).*)"],
};

export async function middleware(request: NextRequest) {
  return updateSession(request);
}
