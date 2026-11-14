/**
 * not-found.tsx: 404 page shown when no route matches, with a "page not found"
 * message and a link back to the home page.
 * Main functions/types:
 *   - NotFound: renders the 404 message and back button
 */
"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center space-y-2 text-center">
      <h1 className="font-semibold text-2xl">Page not found.</h1>
      <p className="text-muted-foreground">The page you are looking for could not be found.</p>
      <Link prefetch={false} replace href="/function/tasks">
        <Button variant="outline">Go back home</Button>
      </Link>
    </div>
  );
}
