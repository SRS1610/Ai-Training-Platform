import * as React from "react";
import { cn } from "../lib/cn";

/*
 * Dependency-free QR Code generator (ISO/IEC 18004), byte mode, versions 1–40, all four ECC levels.
 * The encoding follows the reference algorithm popularised by Project Nayuki's QR Code generator (MIT).
 * Mask selection uses the standard N1, N2 and N4 penalty rules (N3 omitted; every mask yields a valid code).
 */

export type QrEcc = "L" | "M" | "Q" | "H";

const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
// prettier-ignore
const NUM_ECC_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number, ecc: QrEcc): number {
  const e = ECC_INDEX[ecc];
  return Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e]![ver]! * NUM_ECC_BLOCKS[e]![ver]!;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = Array.from({ length: degree - 1 }, () => 0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i]! ^= gfMul(coef, factor);
    });
  }
  return result;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** Encode `text` (UTF-8, byte mode) and return the module matrix (`true` = dark), without quiet zone. */
export function encodeQr(text: string, ecc: QrEcc = "M"): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ; ver++) {
    if (ver > 40) throw new Error("QR payload too long");
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, ecc) * 8) break;
  }
  const e = ECC_INDEX[ecc];
  const size = ver * 4 + 17;

  // --- data bits
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0x4, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacity = dataCodewords(ver, ecc) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // --- error correction + interleave
  const numBlocks = NUM_ECC_BLOCKS[e]![ver]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e]![ver]!;
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - blockEccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++)
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEccLen || j >= numShort) codewords.push(block[i]!);
    });

  // --- function patterns
  const modules: boolean[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const isFn: boolean[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFn[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align: number[] = [];
  if (ver > 1) {
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < numAlign; pos -= step) align.splice(1, 0, pos);
  }
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mask: number) => {
    const d = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(fb, i));
    setFn(8, 7, bit(fb, 6));
    setFn(8, 8, bit(fb, 7));
    setFn(7, 8, bit(fb, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(fb, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(fb, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(fb, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit(vb, i));
      setFn(b, a, bit(vb, i));
    }
  }

  // --- codewords (zig-zag)
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y]![x] && idx < codewords.length * 8) {
          modules[y]![x] = bit(codewords[idx >>> 3]!, 7 - (idx & 7));
          idx++;
        }
      }
  }

  // --- masking
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!isFn[y]![x] && invert) modules[y]![x] = !modules[y]![x];
      }
  };
  const penalty = () => {
    let score = 0;
    let dark = 0;
    for (let y = 0; y < size; y++) {
      let runX = 1;
      let runY = 1;
      for (let x = 0; x < size; x++) {
        if (modules[y]![x]) dark++;
        if (x > 0) {
          if (modules[y]![x] === modules[y]![x - 1]) runX++;
          else runX = 1;
          if (runX === 5) score += 3;
          else if (runX > 5) score++;
          if (modules[x]![y] === modules[x - 1]![y]) runY++;
          else runY = 1;
          if (runY === 5) score += 3;
          else if (runY > 5) score++;
        }
        if (x > 0 && y > 0) {
          const c = modules[y]![x];
          if (c === modules[y]![x - 1] && c === modules[y - 1]![x] && c === modules[y - 1]![x - 1]) score += 3;
        }
      }
    }
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty();
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
    applyMask(m);
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

export interface QrCodeProps extends Omit<React.SVGAttributes<SVGSVGElement>, "children"> {
  /** Text or URL to encode. */
  value: string;
  /** Rendered width/height in px (the SVG scales crisply). */
  size?: number;
  ecc?: QrEcc;
  /** Quiet-zone width in modules (spec recommends 4; 2 is fine on a white card). */
  margin?: number;
  /** Accessible name, e.g. "QR code linking to the verification page". */
  title?: string;
  /** Dark module colour (keep high contrast for scanners). */
  color?: string;
  background?: string;
}

/** Scannable QR code as an inline SVG (no network, no canvas). */
export function QrCode({ value, size = 160, ecc = "M", margin = 2, title = "QR code", color = "#0f172a", background = "#ffffff", className, ...props }: QrCodeProps) {
  const path = React.useMemo(() => {
    try {
      const m = encodeQr(value, ecc);
      let d = "";
      m.forEach((row, y) =>
        row.forEach((on, x) => {
          if (on) d += `M${x + margin} ${y + margin}h1v1h-1z`;
        }),
      );
      return { d, n: m.length + margin * 2 };
    } catch {
      return null;
    }
  }, [value, ecc, margin]);
  if (!path) return null;
  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={size}
      viewBox={`0 0 ${path.n} ${path.n}`}
      shapeRendering="crispEdges"
      className={cn("block", className)}
      {...props}
    >
      <title>{title}</title>
      <rect width={path.n} height={path.n} fill={background} />
      <path d={path.d} fill={color} />
    </svg>
  );
}
