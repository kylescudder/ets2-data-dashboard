import { type NextRequest } from "next/server";
import { supabaseServer } from "../../../lib/supabase/server";

// Use a plain Response with an explicit Location header instead of
// NextResponse.redirect — under @netlify/plugin-nextjs the latter appends the
// request's query string to the redirect target (so /auth/callback?code=X
// ends up redirecting to /?code=X with the code preserved). Bypassing the
// wrapper lets us pin the exact Location.
function redirect(location: string, status = 303): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirect(`${url.origin}/`);
    }
  }

  return redirect(`${url.origin}/login?error=auth`);
}
