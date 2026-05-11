"use client";

import { useEffect } from "react";

// Strips the `?code=…` magic-link parameter from the URL after sign-in. The
// /auth/callback handler exchanges the code server-side and sets the session
// cookie, but Netlify Edge re-appends the original request's query string on
// route-handler redirects, so users land on / with a useless code param in
// their address bar. This pulls it off on first paint.
const STRIP_PARAMS = ["code", "error", "error_description"];

export function UrlCleaner() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let touched = false;
    for (const p of STRIP_PARAMS) {
      if (url.searchParams.has(p)) {
        url.searchParams.delete(p);
        touched = true;
      }
    }
    if (touched) {
      const search = url.searchParams.toString();
      window.history.replaceState(
        {},
        "",
        url.pathname + (search ? `?${search}` : "") + url.hash,
      );
    }
  }, []);
  return null;
}
