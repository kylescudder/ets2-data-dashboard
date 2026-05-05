import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};

export async function middleware(request: NextRequest) {
  return updateSession(request);
}
