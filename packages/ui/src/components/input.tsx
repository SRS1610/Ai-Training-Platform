import * as React from "react";
import { cn } from "../lib/cn";

export const inputBase =
  "flex w-full rounded-xl border border-input bg-white text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/15";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  inputSize?: "sm" | "md" | "lg";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", leftIcon, rightSlot, inputSize = "md", ...props }, ref) => {
    const sizeCls = inputSize === "sm" ? "h-9" : inputSize === "lg" ? "h-12 text-base" : "h-11";
    if (!leftIcon && !rightSlot) {
      return <input ref={ref} type={type} className={cn(inputBase, sizeCls, "px-3.5", className)} {...props} />;
    }
    return (
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400 [&_svg]:size-4">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          className={cn(inputBase, sizeCls, leftIcon ? "pl-10" : "pl-3.5", rightSlot ? "pr-11" : "pr-3.5", className)}
          {...props}
        />
        {rightSlot && <span className="absolute inset-y-0 right-1.5 flex items-center">{rightSlot}</span>}
      </div>
    );
  },
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(inputBase, "min-h-[88px] px-3.5 py-2.5 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";
