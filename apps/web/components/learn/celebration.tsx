"use client";

import { cn } from "@praxis/ui";
import { motion, useReducedMotion } from "framer-motion";
import * as React from "react";

const COLORS = ["#6366f1", "#d946ef", "#f59e0b", "#10b981", "#0ea5e9", "#f43f5e", "#8b5cf6", "#14b8a6"];

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Decorative confetti burst (disabled under prefers-reduced-motion). Place inside a `relative` container. */
export function Confetti({ pieces = 60, className, loop = false }: { pieces?: number; className?: string; loop?: boolean }) {
  const reduce = useReducedMotion();
  const items = React.useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: rand(i + 1) * 100,
        delay: rand(i + 7) * 0.6,
        duration: 1.8 + rand(i + 13) * 1.6,
        rotate: rand(i + 21) * 720 - 360,
        drift: rand(i + 29) * 120 - 60,
        size: 6 + rand(i + 31) * 7,
        round: rand(i + 37) > 0.6,
        color: COLORS[i % COLORS.length]!,
      })),
    [pieces],
  );
  if (reduce) return null;
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {items.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? 999 : 2 }}
          initial={{ top: "-4%", x: 0, opacity: 0, rotate: 0 }}
          animate={{ top: ["-4%", "104%"], x: [0, p.drift], opacity: [0, 1, 1, 0], rotate: p.rotate }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn", repeat: loop ? Infinity : 0, repeatDelay: 0.4 }}
        />
      ))}
    </div>
  );
}
