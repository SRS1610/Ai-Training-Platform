"use client";

import { Input, cn, type InputProps } from "@praxis/ui";
import { Eye, EyeOff, Lock } from "lucide-react";
import * as React from "react";

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, "type">>(function PasswordInput(props, ref) {
  const [show, setShow] = React.useState(false);
  return (
    <Input
      ref={ref}
      type={show ? "text" : "password"}
      leftIcon={<Lock />}
      rightSlot={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:focus-ring"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
        >
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      }
      {...props}
    />
  );
});

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "admin", "iloveyou", "changeme"];

/** Heuristic strength 0-4 aligned with the API's policy (min 10 chars, not common, not repetitive). */
export function passwordScore(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; issues: string[] } {
  const issues: string[] = [];
  if (pw.length < 10) issues.push("At least 10 characters");
  if (new Set(pw).size < 5) issues.push("Use more varied characters");
  if (COMMON.some((c) => pw.toLowerCase().includes(c))) issues.push("Avoid common words");
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s += 0.5;
  if (/[^A-Za-z0-9]/.test(pw)) s += 0.5;
  if (issues.length) s = Math.min(s, 1);
  const score = Math.max(0, Math.min(4, Math.floor(s))) as 0 | 1 | 2 | 3 | 4;
  const label = pw ? ["Too weak", "Weak", "Fair", "Strong", "Excellent"][score]! : "";
  return { score, label, issues };
}

const COLORS = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"];
const TEXT = ["text-rose-700", "text-orange-700", "text-amber-800", "text-emerald-700", "text-emerald-700"];

export function PasswordStrength({ password, id }: { password: string; id?: string }) {
  const { score, label, issues } = passwordScore(password);
  if (!password) return <p id={id} className="text-xs text-muted-foreground">Use 10+ characters. A short phrase works great.</p>;
  return (
    <div id={id} className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < Math.max(1, score) ? COLORS[score] : "bg-slate-200")} />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-xs">
        <span className={cn("font-semibold", TEXT[score])}>Strength: {label}</span>
        {issues.length > 0 && <span className="text-slate-600">· {issues.join(" · ")}</span>}
      </p>
    </div>
  );
}
