"use client";

import { Button, Sheet, SheetContent, SheetTitle, SheetTrigger, cn } from "@praxis/ui";
import { Menu } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/common/logo";
import { readCookie } from "@/lib/api";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#simulations", label: "Simulations" },
  { href: "#ai", label: "AI" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState(false);
  React.useEffect(() => {
    setSignedIn(!!readCookie("praxis_csrf"));
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-300",
        scrolled ? "border-b border-slate-200/70 bg-white/80 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-900 focus-visible:focus-ring">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Button asChild variant="gradient">
              <Link href="/app/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild variant="gradient">
                <Link href="/register">Start free</Link>
              </Button>
            </>
          )}
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="!size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="px-6">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <nav aria-label="Mobile" className="flex flex-col">
              {LINKS.map((l) => (
                <a key={l.href} href={l.href} className="rounded-xl px-3 py-3 text-base font-medium text-slate-800 hover:bg-slate-50">
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="grid grid-cols-2 gap-2 pb-2">
              <Button asChild variant="secondary" size="lg">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild variant="gradient" size="lg">
                <Link href="/register">Start free</Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
