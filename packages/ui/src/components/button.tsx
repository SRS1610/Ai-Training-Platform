import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-200 ease-spring focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:translate-y-px",
        gradient:
          "bg-brand-gradient text-white shadow-glow hover:brightness-110 hover:shadow-lg active:translate-y-px",
        secondary:
          "border border-border bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50 active:translate-y-px",
        soft: "bg-brand-50 text-brand-700 hover:bg-brand-100",
        outline: "border border-brand-200 bg-transparent text-brand-700 hover:bg-brand-50",
        ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        destructive: "bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:translate-y-px",
        "destructive-soft": "bg-rose-50 text-rose-700 hover:bg-rose-100",
        success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
        link: "h-auto px-0 text-brand-700 underline-offset-4 hover:underline",
        white: "bg-white text-brand-700 shadow-lift hover:bg-brand-50",
      },
      size: {
        xs: "h-7 rounded-lg px-2.5 text-xs",
        sm: "h-9 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-8 rounded-lg",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, block, asChild = false, loading, leftIcon, rightIcon, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...(!asChild && !props.type ? { type: "button" as const } : {})}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : leftIcon}
        <Slottable>{children}</Slottable>
        {rightIcon}
      </Comp>
    );
  },
);
Button.displayName = "Button";
