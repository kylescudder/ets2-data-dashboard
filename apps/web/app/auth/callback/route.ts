import { type NextRequest } from "next/server";
import { supabaseServer } from "../../../lib/supabase/server";

// Use a plain Response with an explicit Location header instead of
// NextResponse.redirect — under @netlify/plugin-nextjs the latter (and even
// plain redirects) can get its Location query string mutated by surrounding
// middleware. A bare Response with the exact Location pins the target.
function redirect(location: string, status = 303): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

// On Netlify the route handler sees request.url with the internal
// *.netlify.app host, not the public custom domain. Reconstruct from the
// x-forwarded-* headers so users stay on the canonical hostname after sign-in.
function publicOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = publicOrigin(request);

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirect(`${origin}/`);
    }
  }

  return redirect(`${origin}/login?error=auth`);
}
