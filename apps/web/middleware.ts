import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge guard for the authenticated area. We cannot validate the JWT here (no secret at the edge),
 * so this is a presence check that avoids flashing the app shell to signed-out visitors.
 * `praxis_access` lives 15 minutes; `praxis_csrf` lives as long as the refresh token, so either
 * means "session probably alive" and the client will refresh / redirect if it is not.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("praxis_access") || req.cookies.has("praxis_csrf");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
