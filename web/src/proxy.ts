/**
 * proxy.ts: Next.js request proxy; route guard based on the login token.
 * Main functions/types:
 *   - proxy: redirects to /login when accessing protected pages logged out; allows everything in mock mode
 *   - config: matcher excluding internal routes, API, and static assets
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_PAGES = ["/login", "/setup"];

export function proxy(request: NextRequest) {
  // Mock demo: no real login; allow all pages (the client auth guard also allows them).
  if (process.env.NEXT_PUBLIC_MOCK === "1") return NextResponse.next();

  const { pathname } = request.nextUrl;
  const token = request.cookies.get("artex_token")?.value;
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Logged out → redirect to the login page
  if (!token && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Logged in and visiting login/setup pages → redirect to the main UI
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL("/function/tasks", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next.js internal routes, API routes, favicon, and static files under public/ (images, fonts, etc.)
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$).*)"],
};
