import Link from "next/link";
import { cn } from "@praxis/ui";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="praxis-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--brand-600))" />
          <stop offset=".55" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#praxis-logo)" />
      <path d="M22 46V18h12.5a9.5 9.5 0 0 1 0 19H29" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="44" cy="45" r="4" fill="#fde68a" />
    </svg>
  );
}

export function Logo({ href = "/", className, collapsed }: { href?: string; className?: string; collapsed?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-lg focus-visible:focus-ring", className)} aria-label="Praxis home">
      <LogoMark />
      {!collapsed && <span className="font-display text-lg font-bold tracking-tight text-slate-900">Praxis</span>}
    </Link>
  );
}
