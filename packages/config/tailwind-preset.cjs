/**
 * Praxis Tailwind preset: design tokens, typography, shadows, motion.
 * Light theme only (no dark mode by product decision).
 * @type {import('tailwindcss').Config}
 */
const plugin = require("tailwindcss/plugin");
const animate = require("tailwindcss-animate");
const { brand, semantic } = require("./tokens.cjs");

const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const brandScale = Object.fromEntries(Object.keys(brand).map((k) => [k, v(`brand-${k}`)]));
brandScale.DEFAULT = v("brand-600");

module.exports = {
  darkMode: "class", // never toggled: the product is light-theme only
  theme: {
    container: { center: true, padding: { DEFAULT: "1rem", sm: "1.5rem", lg: "2rem" }, screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        brand: brandScale,
        background: v("background"),
        foreground: v("foreground"),
        card: { DEFAULT: v("card"), foreground: v("card-foreground") },
        popover: { DEFAULT: v("popover"), foreground: v("popover-foreground") },
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        subtle: v("subtle"),
        border: v("border"),
        input: v("input"),
        ring: v("ring"),
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground") },
        secondary: { DEFAULT: v("secondary"), foreground: v("secondary-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        destructive: { DEFAULT: v("destructive"), foreground: v("destructive-foreground") },
        success: v("success"),
        warning: v("warning"),
        info: v("info"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)",
        lift: "0 2px 4px rgb(15 23 42 / 0.04), 0 12px 32px -8px rgb(15 23 42 / 0.14)",
        glow: "0 8px 24px -6px rgb(var(--brand-600) / 0.45)",
        "inner-line": "inset 0 0 0 1px rgb(var(--border))",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, rgb(var(--brand-600)) 0%, #7c3aed 55%, #c026d3 100%)",
        "brand-gradient-soft":
          "linear-gradient(135deg, rgb(var(--brand-50)) 0%, #f5f3ff 50%, #fdf4ff 100%)",
        "aurora":
          "radial-gradient(60% 60% at 15% 10%, rgb(var(--brand-200) / .55) 0%, transparent 60%), radial-gradient(50% 50% at 85% 0%, rgb(244 114 182 / .35) 0%, transparent 60%), radial-gradient(50% 60% at 60% 100%, rgb(56 189 248 / .30) 0%, transparent 60%)",
        "grid-faint":
          "linear-gradient(rgb(15 23 42 / .04) 1px, transparent 1px), linear-gradient(90deg, rgb(15 23 42 / .04) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        flicker: {
          "0%,100%": { transform: "scale(1) rotate(-2deg)" },
          "50%": { transform: "scale(1.08) rotate(2deg)" },
        },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "fade-in": "fade-in .3s ease-out both",
        "fade-up": "fade-up .45s cubic-bezier(.2,.7,.2,1) both",
        shimmer: "shimmer 1.6s infinite",
        float: "float 6s ease-in-out infinite",
        flicker: "flicker 1.6s ease-in-out infinite",
        "spin-slow": "spin-slow 24s linear infinite",
        "accordion-down": "accordion-down .2s ease-out",
        "accordion-up": "accordion-up .2s ease-out",
      },
      transitionTimingFunction: { spring: "cubic-bezier(.2,.7,.2,1)" },
    },
  },
  plugins: [
    animate,
    plugin(({ addBase, addUtilities }) => {
      const root = {};
      for (const [k, val] of Object.entries(brand)) root[`--brand-${k}`] = val;
      for (const [k, val] of Object.entries(semantic)) root[`--${k}`] = val;
      root["--radius"] = "1.125rem";
      root["color-scheme"] = "light";
      addBase({
        ":root": root,
        "*, ::before, ::after": { borderColor: "rgb(var(--border))" },
        html: { "-webkit-tap-highlight-color": "transparent" },
        body: {
          backgroundColor: "rgb(var(--background))",
          color: "rgb(var(--foreground))",
          fontFeatureSettings: '"cv02", "cv03", "cv04", "cv11"',
          "-webkit-font-smoothing": "antialiased",
          "-moz-osx-font-smoothing": "grayscale",
        },
        ":focus-visible": { outline: "none" },
        "@media (prefers-reduced-motion: reduce)": {
          "*, ::before, ::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
      });
      addUtilities({
        ".focus-ring": {
          outline: "2px solid transparent",
          outlineOffset: "2px",
          boxShadow: "0 0 0 2px rgb(var(--card)), 0 0 0 4px rgb(var(--ring))",
        },
        ".text-gradient": {
          backgroundImage: "linear-gradient(120deg, rgb(var(--brand-600)) 0%, #7c3aed 45%, #db2777 100%)",
          "-webkit-background-clip": "text",
          backgroundClip: "text",
          color: "transparent",
        },
        ".scrollbar-thin": { scrollbarWidth: "thin" },
        ".no-scrollbar": { scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } },
      });
    }),
  ],
};
