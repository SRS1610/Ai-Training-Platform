"use client";

import { cn } from "@praxis/ui";
import * as React from "react";

/** Accessible 6-digit one-time code input (paste-friendly, auto-advance, autocomplete="one-time-code"). */
export function OtpInput({
  value,
  onChange,
  length = 6,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  "aria-describedby": describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  "aria-describedby"?: string;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  return (
    <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          maxLength={length}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={d}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (!v) {
              set(value.slice(0, i) + value.slice(i + 1));
              return;
            }
            if (v.length > 1) {
              set(value.slice(0, i) + v);
              refs.current[Math.min(length - 1, i + v.length)]?.focus();
              return;
            }
            const arr = digits.slice();
            arr[i] = v;
            set(arr.join(""));
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const v = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            set(v);
            refs.current[Math.min(length - 1, v.length)]?.focus();
          }}
          className={cn(
            "h-14 w-full min-w-0 rounded-xl border bg-white text-center font-display text-2xl font-bold text-slate-900 shadow-sm transition focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15 disabled:opacity-60",
            invalid ? "border-rose-500" : d ? "border-brand-300 bg-brand-50/40" : "border-input",
          )}
        />
      ))}
    </div>
  );
}
