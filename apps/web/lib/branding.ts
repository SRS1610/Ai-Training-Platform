/** Apply an organisation's primary colour as the brand accent (CSS variables used by the Tailwind preset). */

const VARS = ["--brand-50", "--brand-100", "--brand-200", "--brand-500", "--brand-600", "--brand-700"] as const;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (c: [number, number, number], target: number, t: number) =>
  c.map((v) => Math.round(v + (target - v) * t)).join(" ");

function luminance([r, g, b]: [number, number, number]) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Returns a cleanup function. Ignores invalid colours and colours too light for white text (contrast < 4.5). */
export function applyBranding(primary: string | null | undefined): () => void {
  if (typeof document === "undefined" || !primary) return () => undefined;
  const rgb = hexToRgb(primary);
  if (!rgb) return () => undefined;
  // Darken until white text passes 4.5:1 on the 600 shade.
  let base = rgb;
  for (let i = 0; i < 10 && (1.05 / (luminance(base) + 0.05)) < 4.5; i++) {
    base = base.map((v) => Math.round(v * 0.88)) as [number, number, number];
  }
  const root = document.documentElement;
  root.style.setProperty("--brand-50", mix(base, 255, 0.94));
  root.style.setProperty("--brand-100", mix(base, 255, 0.86));
  root.style.setProperty("--brand-200", mix(base, 255, 0.7));
  root.style.setProperty("--brand-500", mix(base, 255, 0.15));
  root.style.setProperty("--brand-600", base.join(" "));
  root.style.setProperty("--brand-700", mix(base, 0, 0.18));
  return () => VARS.forEach((v) => root.style.removeProperty(v));
}
