import { cn } from "@praxis/ui";

export function AuthHeading({ title, description, icon, className }: { title: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-8", className)}>
      {icon && <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow [&_svg]:size-6">{icon}</span>}
      <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      {description && <p className="mt-2 text-slate-600">{description}</p>}
    </div>
  );
}

export function safeNext(next: string | null | undefined, fallback = "/app/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
