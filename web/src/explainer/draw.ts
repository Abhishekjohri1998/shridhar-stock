/**
 * Canvas helpers for the "Watch how it works" explainer. Everything is drawn on a 1280×720 stage:
 * a mock of the stock website (the real five places in the side menu), a tablet, buttons, inputs,
 * a moving cursor, typing, highlight rings, captions and title cards.
 *
 * Colours come from the app's own CSS tokens (the light theme), with the same values as constants
 * for when they cannot be read. Nothing here touches the DOM when the module loads, so the scene
 * data can be checked in Node.
 */

export const W = 1280;
export const H = 720;

export type Lang = 'en' | 'kn';
export interface Bi {
  en: string;
  kn: string;
}
export const bi = (en: string, kn: string): Bi => ({ en, kn });

export interface Palette {
  paper0: string;
  paper1: string;
  paper2: string;
  paper3: string;
  ink900: string;
  ink700: string;
  ink500: string;
  ink400: string;
  line: string;
  lineStrong: string;
  brand700: string;
  brand600: string;
  brand500: string;
  brandWash: string;
  brandEdge: string;
  onBrand: string;
  ok700: string;
  okWash: string;
  okEdge: string;
  gold600: string;
  goldWash: string;
  danger600: string;
  dangerWash: string;
  fontUi: string;
  fontDisplay: string;
}

/** The light theme's tokens, as in styles.css. */
const FALLBACK: Palette = {
  paper0: '#f5f1e8',
  paper1: '#fffdf8',
  paper2: '#efe9dc',
  paper3: '#e9e2d3',
  ink900: '#1f1e1b',
  ink700: '#3a3833',
  ink500: '#6b6760',
  ink400: '#8f8a80',
  line: '#e6dfd1',
  lineStrong: '#d6cdbb',
  brand700: '#a8502f',
  brand600: '#c96442',
  brand500: '#d47a5a',
  brandWash: '#f6e6dc',
  brandEdge: '#ebc6b2',
  onBrand: '#fffdf8',
  ok700: '#3f6b45',
  okWash: '#e8efe3',
  okEdge: '#c7d8c0',
  gold600: '#9a6a14',
  goldWash: '#f8ecd2',
  danger600: '#b03a26',
  dangerWash: '#f9e5e0',
  fontUi: "'Noto Sans Kannada', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontDisplay: "'Fraunces', Georgia, 'Times New Roman', serif",
};

const VARS: Record<keyof Palette, string> = {
  paper0: '--paper-0',
  paper1: '--paper-1',
  paper2: '--paper-2',
  paper3: '--paper-3',
  ink900: '--ink-900',
  ink700: '--ink-700',
  ink500: '--ink-500',
  ink400: '--ink-400',
  line: '--line',
  lineStrong: '--line-strong',
  brand700: '--brand-700',
  brand600: '--brand-600',
  brand500: '--brand-500',
  brandWash: '--brand-wash',
  brandEdge: '--brand-edge',
  onBrand: '--on-brand',
  ok700: '--ok-700',
  okWash: '--ok-wash',
  okEdge: '--ok-edge',
  gold600: '--gold-600',
  goldWash: '--gold-wash',
  danger600: '--danger-600',
  dangerWash: '--danger-wash',
  fontUi: '--font-ui',
  fontDisplay: '--font-display',
};

/**
 * The light tokens from the page's CSS. The video always uses the light look (it is also recorded
 * as a file), so in dark mode, where the same names hold dark values, the constants are used.
 */
export function readPalette(): Palette {
  if (typeof document === 'undefined') return FALLBACK;
  try {
    const root = document.documentElement;
    const attr = root.getAttribute('data-theme');
    const dark = attr === 'dark' || (attr !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) return FALLBACK;
    const cs = getComputedStyle(root);
    const out = { ...FALLBACK };
    for (const k of Object.keys(VARS) as (keyof Palette)[]) {
      const v = cs.getPropertyValue(VARS[k]).trim();
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return FALLBACK;
  }
}

/**
 * Canvas text does not make the browser fetch a web font, so ask for every face the explainer
 * uses (both scripts) before drawing. Resolves even when fonts cannot load.
 */
export async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const c = readPalette();
  const faces = [400, 500, 600, 700].map((w) => w + ' 20px ' + c.fontUi).concat([500, 600].map((w) => w + ' 20px ' + c.fontDisplay));
  try {
    await Promise.all(faces.map((f) => document.fonts.load(f, 'Aa 1 ಕನ್ನಡ')));
  } catch {
    /* draw with what there is */
  }
}

// ---- time and easing -----------------------------------------------------------------------

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
/** Eased progress of `t` through [a, b]: 0 before, 1 after. */
export const prog = (t: number, a: number, b: number) => ease(clamp((t - a) / Math.max(0.0001, b - a)));
/** Fades in at `a` and, if given, out at `b`. */
export const vis = (t: number, a: number, b = Infinity, f = 0.35) => Math.min(prog(t, a, a + f), 1 - prog(t, b - f, b));
/** The first part of `s`, typed between `a` and `b`. */
export function typed(s: string, t: number, a: number, b: number): string {
  const chars = Array.from(s);
  return chars.slice(0, Math.round(clamp((t - a) / Math.max(0.0001, b - a)) * chars.length)).join('');
}

/** A cursor path: [time, x, y, click?]. It rests at a point, then glides to the next one. */
export type Key = [t: number, x: number, y: number, click?: boolean];
export function cursorAt(keys: Key[], t: number): { x: number; y: number; click: number } {
  let x = keys[0]![1];
  let y = keys[0]![2];
  let click = -1;
  for (let i = 1; i < keys.length; i++) {
    const [kt, kx, ky] = keys[i]!;
    const prev = keys[i - 1]!;
    const move = Math.min(0.85, kt - prev[0]);
    if (t >= kt - move) {
      const p = prog(t, kt - move, kt);
      x = lerp(prev[1], kx, p);
      y = lerp(prev[2], ky, p);
    }
  }
  for (const k of keys) if (k[3] && t >= k[0]) click = t - k[0];
  return { x, y, click };
}

// ---- the pen ---------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type IconName = 'home' | 'receipt' | 'box' | 'cart' | 'settings' | 'check' | 'truck' | 'user' | 'lock' | 'arrow' | 'pin';

/** The five places of the admin menu, as in App.tsx. */
export const PLACES: { icon: IconName; label: Bi }[] = [
  { icon: 'home', label: bi('Home', 'ಮುಖಪುಟ') },
  { icon: 'receipt', label: bi('Bills', 'ಬಿಲ್‌ಗಳು') },
  { icon: 'box', label: bi('Inventory', 'ಸಾಮಾನು') },
  { icon: 'cart', label: bi('Buy & move', 'ಖರೀದಿ ಮತ್ತು ಸಾಗಣೆ') },
  { icon: 'settings', label: bi('Setup', 'ಸೆಟಪ್') },
];

export interface TextOpts {
  size?: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  display?: boolean;
  maxW?: number;
}

export class Pen {
  constructor(
    public ctx: CanvasRenderingContext2D,
    public c: Palette,
    public lang: Lang,
  ) {}

  tx(s: Bi | string): string {
    return typeof s === 'string' ? s : this.lang === 'kn' ? s.kn : s.en;
  }

  font(size: number, weight = 500, display = false): string {
    return weight + ' ' + size + 'px ' + (display ? this.c.fontDisplay : this.c.fontUi);
  }

  alpha<T>(a: number, fn: () => T): T | undefined {
    if (a <= 0.001) return undefined;
    const g = this.ctx.globalAlpha;
    this.ctx.globalAlpha = g * clamp(a);
    try {
      return fn();
    } finally {
      this.ctx.globalAlpha = g;
    }
  }

  /** Draws inside a slide: moved by (dx, dy) and faded. */
  slide(a: number, dx: number, dy: number, fn: () => void) {
    if (a <= 0.001) return;
    this.ctx.save();
    this.ctx.translate(dx * (1 - a), dy * (1 - a));
    this.alpha(a, fn);
    this.ctx.restore();
  }

  rr(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  box(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; r?: number; shadow?: number; lw?: number } = {}) {
    const ctx = this.ctx;
    this.rr(x, y, w, h, o.r ?? 16);
    if (o.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(31, 30, 27, ' + 0.06 * o.shadow + ')';
      ctx.shadowBlur = 10 * o.shadow;
      ctx.shadowOffsetY = 3 * o.shadow;
      ctx.fillStyle = o.fill ?? this.c.paper1;
      ctx.fill();
      ctx.restore();
    } else if (o.fill !== 'none') {
      ctx.fillStyle = o.fill ?? this.c.paper1;
      ctx.fill();
    }
    if (o.stroke !== 'none') {
      ctx.strokeStyle = o.stroke ?? this.c.line;
      ctx.lineWidth = o.lw ?? 1.5;
      ctx.stroke();
    }
  }

  /** One line of text; shrinks to fit `maxW`. Returns its width. */
  text(s: Bi | string, x: number, y: number, o: TextOpts = {}): number {
    const ctx = this.ctx;
    const str = this.tx(s);
    let size = o.size ?? 18;
    ctx.font = this.font(size, o.weight ?? 500, o.display);
    if (o.maxW) {
      while (ctx.measureText(str).width > o.maxW && size > 10) {
        size -= 1;
        ctx.font = this.font(size, o.weight ?? 500, o.display);
      }
    }
    ctx.fillStyle = o.color ?? this.c.ink700;
    ctx.textAlign = o.align ?? 'left';
    // Kannada fonts sit high on 'middle'; the alphabetic line, moved down, centres both scripts.
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y + size * 0.36);
    return ctx.measureText(str).width;
  }

  measure(s: Bi | string, size: number, weight = 500): number {
    this.ctx.font = this.font(size, weight);
    return this.ctx.measureText(this.tx(s)).width;
  }

  /** Words broken into lines no wider than `w`. */
  wrap(s: string, w: number, size: number, weight = 500, display = false): string[] {
    this.ctx.font = this.font(size, weight, display);
    const out: string[] = [];
    let line = '';
    for (const word of s.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (this.ctx.measureText(next).width > w && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  button(x: number, y: number, w: number, label: Bi | string, o: { primary?: boolean; h?: number; size?: number; press?: number; ghost?: boolean } = {}) {
    const h = o.h ?? 44;
    const s = o.press != null && o.press >= 0 && o.press < 0.25 ? 0.96 : 1;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(s, s);
    ctx.translate(-(x + w / 2), -(y + h / 2));
    if (o.primary) this.box(x, y, w, h, { fill: this.c.brand600, stroke: this.c.brand600, r: 999, shadow: 1.5 });
    else if (o.ghost) this.box(x, y, w, h, { fill: this.c.brandWash, stroke: 'none', r: 999 });
    else this.box(x, y, w, h, { fill: this.c.paper1, stroke: this.c.lineStrong, r: 999 });
    this.text(label, x + w / 2, y + h / 2 + 1, { size: o.size ?? 17, weight: 600, align: 'center', color: o.primary ? this.c.onBrand : o.ghost ? this.c.brand700 : this.c.ink900, maxW: w - 20 });
    ctx.restore();
  }

  /** A labelled input. `caret` blinks at the end of the value while typing. */
  input(x: number, y: number, w: number, label: Bi | string | null, value: string, o: { focus?: boolean; caret?: boolean; placeholder?: Bi | string; t?: number; size?: number } = {}) {
    let top = y;
    if (label) {
      this.text(label, x + 2, y + 10, { size: 14, weight: 600, color: this.c.ink500 });
      top = y + 24;
    }
    this.box(x, top, w, 44, { fill: this.c.paper2, stroke: o.focus ? this.c.brand600 : this.c.line, r: 10, lw: o.focus ? 2 : 1.5 });
    const size = o.size ?? 18;
    if (value) {
      const tw = this.text(value, x + 14, top + 23, { size, color: this.c.ink900 });
      if (o.caret && Math.floor((o.t ?? 0) * 2.4) % 2 === 0) {
        this.ctx.fillStyle = this.c.brand600;
        this.ctx.fillRect(x + 16 + tw, top + 11, 2, 24);
      }
    } else {
      if (o.placeholder) this.text(o.placeholder, x + 14, top + 23, { size: 16, color: this.c.ink400 });
      if (o.caret && Math.floor((o.t ?? 0) * 2.4) % 2 === 0) {
        this.ctx.fillStyle = this.c.brand600;
        this.ctx.fillRect(x + 14, top + 11, 2, 24);
      }
    }
  }

  /** A select: its value, a chevron, and when open the options below with one lit. */
  select(x: number, y: number, w: number, label: Bi | string | null, value: Bi | string, o: { open?: number; options?: (Bi | string)[]; hi?: number; focus?: boolean } = {}) {
    let top = y;
    if (label) {
      this.text(label, x + 2, y + 10, { size: 14, weight: 600, color: this.c.ink500 });
      top = y + 24;
    }
    this.box(x, top, w, 44, { fill: this.c.paper2, stroke: o.focus || (o.open ?? 0) > 0 ? this.c.brand600 : this.c.line, r: 10, lw: o.focus ? 2 : 1.5 });
    this.text(value, x + 14, top + 23, { size: 18, color: this.c.ink900, maxW: w - 50 });
    const ctx = this.ctx;
    ctx.strokeStyle = this.c.ink500;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w - 28, top + 19);
    ctx.lineTo(x + w - 22, top + 25);
    ctx.lineTo(x + w - 16, top + 19);
    ctx.stroke();
    const opts = o.options ?? [];
    if ((o.open ?? 0) > 0 && opts.length) {
      this.slide(o.open!, 0, -8, () => {
        const oy = top + 50;
        this.box(x, oy, w, opts.length * 42 + 12, { fill: this.c.paper1, stroke: this.c.line, r: 12, shadow: 3 });
        opts.forEach((op, i) => {
          if (i === o.hi) this.box(x + 6, oy + 6 + i * 42, w - 12, 40, { fill: this.c.brandWash, stroke: 'none', r: 8 });
          this.text(op, x + 18, oy + 27 + i * 42, { size: 17, weight: i === o.hi ? 600 : 500, color: i === o.hi ? this.c.brand700 : this.c.ink700 });
        });
      });
    }
  }

  pill(x: number, y: number, label: Bi | string, tone: 'plain' | 'ok' | 'warn' | 'bad' | 'brand' = 'plain', size = 14): number {
    const w = this.measure(label, size, 600) + 22;
    const fill = { plain: this.c.paper2, ok: this.c.okWash, warn: this.c.goldWash, bad: this.c.dangerWash, brand: this.c.brandWash }[tone];
    const ink = { plain: this.c.ink500, ok: this.c.ok700, warn: this.c.gold600, bad: this.c.danger600, brand: this.c.brand700 }[tone];
    this.box(x, y - size * 0.9, w, size * 1.8, { fill, stroke: 'none', r: 999 });
    this.text(label, x + 11, y + 1, { size, weight: 600, color: ink });
    return w;
  }

  /** A soft card. */
  card(x: number, y: number, w: number, h: number) {
    this.box(x, y, w, h, { fill: this.c.paper1, stroke: this.c.line, r: 16, shadow: 1 });
  }

  /** A pulsing clay ring round something to look at. */
  ring(x: number, y: number, w: number, h: number, t: number, a = 1) {
    if (a <= 0) return;
    const ctx = this.ctx;
    const pulse = (Math.sin(t * 5) + 1) / 2;
    this.alpha(a, () => {
      ctx.save();
      ctx.strokeStyle = this.c.brand600;
      ctx.lineWidth = 3;
      this.rr(x - 6, y - 6, w + 12, h + 12, 14);
      ctx.stroke();
      ctx.globalAlpha *= 0.35 * (1 - pulse);
      ctx.lineWidth = 3;
      this.rr(x - 6 - pulse * 8, y - 6 - pulse * 8, w + 12 + pulse * 16, h + 12 + pulse * 16, 18);
      ctx.stroke();
      ctx.restore();
    });
  }

  /** The pointer, with a ripple for a moment after a click. */
  cursor(x: number, y: number, click = -1) {
    const ctx = this.ctx;
    if (click >= 0 && click < 0.6) {
      const p = click / 0.6;
      ctx.save();
      ctx.globalAlpha *= 1 - p;
      ctx.fillStyle = this.c.brand500;
      ctx.beginPath();
      ctx.arc(x, y, 8 + p * 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const s = click >= 0 && click < 0.18 ? 0.88 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * 1.25, s * 1.25);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 22);
    ctx.lineTo(6, 17);
    ctx.lineTo(10, 26);
    ctx.lineTo(14, 24);
    ctx.lineTo(10, 15);
    ctx.lineTo(17, 15);
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = this.c.ink900;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = this.c.paper1;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  icon(name: IconName, x: number, y: number, s = 22, color = this.c.ink500) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 24, s / 24);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (name) {
      case 'home':
        ctx.moveTo(3, 11);
        ctx.lineTo(12, 3);
        ctx.lineTo(21, 11);
        ctx.moveTo(5, 9.5);
        ctx.lineTo(5, 21);
        ctx.lineTo(19, 21);
        ctx.lineTo(19, 9.5);
        ctx.moveTo(10, 21);
        ctx.lineTo(10, 15);
        ctx.lineTo(14, 15);
        ctx.lineTo(14, 21);
        break;
      case 'receipt':
        ctx.moveTo(5, 3);
        ctx.lineTo(19, 3);
        ctx.lineTo(19, 21);
        ctx.lineTo(16, 19);
        ctx.lineTo(13, 21);
        ctx.lineTo(10, 19);
        ctx.lineTo(7, 21);
        ctx.lineTo(5, 19);
        ctx.closePath();
        ctx.moveTo(9, 8);
        ctx.lineTo(15, 8);
        ctx.moveTo(9, 12);
        ctx.lineTo(15, 12);
        break;
      case 'box':
        ctx.moveTo(12, 2.5);
        ctx.lineTo(21, 7);
        ctx.lineTo(21, 17);
        ctx.lineTo(12, 21.5);
        ctx.lineTo(3, 17);
        ctx.lineTo(3, 7);
        ctx.closePath();
        ctx.moveTo(3, 7);
        ctx.lineTo(12, 11.5);
        ctx.lineTo(21, 7);
        ctx.moveTo(12, 11.5);
        ctx.lineTo(12, 21.5);
        break;
      case 'cart':
        ctx.moveTo(2, 3);
        ctx.lineTo(5, 3);
        ctx.lineTo(7.5, 15);
        ctx.lineTo(19, 15);
        ctx.lineTo(21, 7);
        ctx.lineTo(6, 7);
        ctx.moveTo(10, 20);
        ctx.arc(9, 20, 1, 0, Math.PI * 2);
        ctx.moveTo(18, 20);
        ctx.arc(17, 20, 1, 0, Math.PI * 2);
        break;
      case 'settings':
        ctx.arc(12, 12, 3.2, 0, Math.PI * 2);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.moveTo(12 + Math.cos(a) * 6.5, 12 + Math.sin(a) * 6.5);
          ctx.lineTo(12 + Math.cos(a) * 9.5, 12 + Math.sin(a) * 9.5);
        }
        ctx.moveTo(18.5, 12);
        ctx.arc(12, 12, 6.5, 0, Math.PI * 2);
        break;
      case 'check':
        ctx.moveTo(4, 12.5);
        ctx.lineTo(9.5, 18);
        ctx.lineTo(20, 6.5);
        ctx.lineWidth = 3;
        break;
      case 'truck':
        ctx.rect(2, 6, 12, 10);
        ctx.moveTo(14, 9);
        ctx.lineTo(18.5, 9);
        ctx.lineTo(22, 12.5);
        ctx.lineTo(22, 16);
        ctx.lineTo(14, 16);
        ctx.moveTo(8.5, 19);
        ctx.arc(7, 19, 1.8, 0, Math.PI * 2);
        ctx.moveTo(19.3, 19);
        ctx.arc(17.5, 19, 1.8, 0, Math.PI * 2);
        break;
      case 'user':
        ctx.arc(12, 8, 4, 0, Math.PI * 2);
        ctx.moveTo(4, 21);
        ctx.quadraticCurveTo(12, 9, 20, 21);
        break;
      case 'lock':
        ctx.rect(5, 11, 14, 10);
        ctx.moveTo(8, 11);
        ctx.lineTo(8, 7.5);
        ctx.arc(12, 7.5, 4, Math.PI, 0);
        ctx.lineTo(16, 11);
        break;
      case 'arrow':
        ctx.moveTo(4, 12);
        ctx.lineTo(20, 12);
        ctx.moveTo(14, 6);
        ctx.lineTo(20, 12);
        ctx.lineTo(14, 18);
        break;
      case 'pin':
        ctx.moveTo(12, 22);
        ctx.bezierCurveTo(5, 14, 5, 9, 5, 9);
        ctx.arc(12, 9, 7, Math.PI, 0);
        ctx.bezierCurveTo(19, 9, 19, 14, 12, 22);
        ctx.moveTo(14.5, 9);
        ctx.arc(12, 9, 2.5, 0, Math.PI * 2);
        break;
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The stock website, as the admin sees it: the side menu with its five places, the top bar,
   * the place's tabs, and a page title. Returns where the page's content goes.
   */
  appFrame(active: number, tabs: { label: Bi; on?: boolean }[], title: Bi | null): Rect {
    const c = this.c;
    const x = 60;
    const y = 30;
    const w = 1160;
    const h = 568;
    this.box(x, y, w, h, { fill: c.paper0, stroke: c.lineStrong, r: 22, shadow: 4 });
    const ctx = this.ctx;
    ctx.save();
    this.rr(x, y, w, h, 22);
    ctx.clip();
    // side menu
    ctx.fillStyle = c.paper1;
    ctx.fillRect(x, y, 220, h);
    ctx.fillStyle = c.line;
    ctx.fillRect(x + 220, y, 1.5, h);
    this.text(bi('Shridhar Stock', 'ಶ್ರೀಧರ್ ಸ್ಟಾಕ್'), x + 24, y + 34, { size: 20, weight: 600, display: true, color: c.ink900, maxW: 180 });
    this.text(bi('Menu', 'ಮೆನು'), x + 24, y + 78, { size: 13, weight: 700, color: c.ink400 });
    PLACES.forEach((p, i) => {
      const py = y + 100 + i * 52;
      const on = i === active;
      if (on) this.box(x + 12, py, 196, 44, { fill: c.brandWash, stroke: 'none', r: 12 });
      this.icon(p.icon, x + 26, py + 11, 22, on ? c.brand700 : c.ink500);
      this.text(p.label, x + 60, py + 23, { size: 17, weight: on ? 700 : 500, color: on ? c.brand700 : c.ink700, maxW: 140 });
    });
    // top bar
    ctx.fillStyle = c.paper1;
    ctx.fillRect(x + 221, y, w - 221, 58);
    ctx.fillStyle = c.line;
    ctx.fillRect(x + 221, y + 58, w - 221, 1.5);
    this.box(x + w - 158, y + 12, 34, 34, { fill: c.paper2, stroke: 'none', r: 999 });
    this.text('?', x + w - 141, y + 30, { size: 18, weight: 700, align: 'center', color: c.ink700 });
    this.box(x + w - 112, y + 12, 34, 34, { fill: c.brandWash, stroke: 'none', r: 999 });
    this.text('S', x + w - 95, y + 30, { size: 16, weight: 700, align: 'center', color: c.brand700 });
    this.text(bi('Admin', 'ಆಡ್ಮಿನ್'), x + w - 70, y + 30, { size: 14, weight: 600, color: c.ink500 });
    // tabs
    let tx = x + 248;
    const ty = y + 82;
    for (const t of tabs) {
      const tw = this.measure(t.label, 16, 600) + 30;
      if (t.on) this.box(tx, ty - 17, tw, 34, { fill: c.ink900, stroke: 'none', r: 999 });
      else this.box(tx, ty - 17, tw, 34, { fill: c.paper2, stroke: 'none', r: 999 });
      this.text(t.label, tx + 15, ty + 1, { size: 16, weight: 600, color: t.on ? c.paper1 : c.ink500 });
      tx += tw + 8;
    }
    const top = tabs.length ? ty + 34 : y + 84;
    if (title) this.text(title, x + 248, top + 18, { size: 30, weight: 500, display: true, color: c.ink900 });
    ctx.restore();
    return { x: x + 248, y: top + (title ? 50 : 0), w: w - 276, h: h - (top - y) - (title ? 50 : 0) - 20 };
  }

  /** Where the side menu's place `i` is, for the cursor. */
  placeAt(i: number): [number, number] {
    return [60 + 110, 30 + 100 + i * 52 + 22];
  }

  /** Where the tab `i` of `tabs` is, for the cursor. */
  tabAt(tabs: { label: Bi }[], i: number): [number, number] {
    let tx = 60 + 248;
    for (let n = 0; n < i; n++) tx += this.measure(tabs[n]!.label, 16, 600) + 38;
    return [tx + (this.measure(tabs[i]!.label, 16, 600) + 30) / 2, 30 + 82];
  }

  /** A tablet (or phone, if tall): the bezel, then the screen to draw on. */
  tablet(x: number, y: number, w: number, h: number): Rect {
    this.box(x, y, w, h, { fill: this.c.ink900, stroke: 'none', r: 34, shadow: 4 });
    const s = { x: x + 16, y: y + 16, w: w - 32, h: h - 32 };
    this.box(s.x, s.y, s.w, s.h, { fill: this.c.paper0, stroke: 'none', r: 20 });
    return s;
  }

  /** The tablet app's top: "Billing | Stock", with the side that is on, and a name to the right. */
  tabletTop(s: Rect, on: 'billing' | 'stock' | null, who: Bi | string | null, p = 1) {
    const c = this.c;
    this.ctx.save();
    this.rr(s.x, s.y, s.w, s.h, 20);
    this.ctx.clip();
    this.ctx.fillStyle = c.paper1;
    this.ctx.fillRect(s.x, s.y, s.w, 56);
    this.ctx.fillStyle = c.line;
    this.ctx.fillRect(s.x, s.y + 56, s.w, 1.5);
    this.ctx.restore();
    if (on) {
      const bx = s.x + 14;
      const by = s.y + 11;
      const bw = 210;
      this.box(bx, by, bw, 34, { fill: c.paper2, stroke: 'none', r: 999 });
      const kx = on === 'stock' ? lerp(bx + 3, bx + bw / 2, p) : lerp(bx + bw / 2, bx + 3, p);
      this.box(kx, by + 3, bw / 2 - 3, 28, { fill: c.paper1, stroke: 'none', r: 999, shadow: 1 });
      const bOn = on === 'billing' ? p > 0.5 : p <= 0.5;
      this.text(bi('Billing', 'ಬಿಲ್ಲಿಂಗ್'), bx + bw / 4, by + 18, { size: 15, weight: bOn ? 800 : 600, align: 'center', color: bOn ? c.brand700 : c.ink500 });
      this.text(bi('Stock', 'ಸ್ಟಾಕ್'), bx + (bw * 3) / 4, by + 18, { size: 15, weight: bOn ? 600 : 800, align: 'center', color: bOn ? c.ink500 : c.brand700 });
    }
    if (who) this.text(who, s.x + s.w - 16, s.y + 29, { size: 15, weight: 600, align: 'right', color: c.ink500 });
  }

  /** The line along the bottom that says what is happening. */
  caption(s: string, a: number) {
    if (!s || a <= 0) return;
    const size = this.lang === 'kn' ? 27 : 29;
    const lines = this.wrap(s, 1060, size, 600);
    const h = 26 + lines.length * (size + 12);
    const y = H - 14 - h;
    this.slide(a, 0, 12, () => {
      this.box(80, y, W - 160, h, { fill: this.c.ink900, stroke: 'none', r: 22, shadow: 2 });
      lines.forEach((l, i) => this.text(l, W / 2, y + 13 + (size + 12) / 2 + i * (size + 12), { size, weight: 600, align: 'center', color: this.c.paper1 }));
    });
  }

  /** A chapter's opening card. */
  titleCard(n: number, total: number, title: string, sub: string, a: number) {
    if (a <= 0) return;
    const c = this.c;
    this.alpha(a, () => {
      this.ctx.fillStyle = c.paper0;
      this.ctx.fillRect(0, 0, W, H);
      const rise = (1 - a) * 18;
      this.box(W / 2 - 46, 196 + rise, 92, 92, { fill: c.brandWash, stroke: c.brandEdge, r: 999 });
      this.text(String(n), W / 2, 244 + rise, { size: 46, weight: 600, display: true, align: 'center', color: c.brand700 });
      this.text(title, W / 2, 350 + rise, { size: 56, weight: 500, display: true, align: 'center', color: c.ink900, maxW: 1100 });
      this.wrap(sub, 900, 26).forEach((l, i) => this.text(l, W / 2, 420 + rise + i * 38, { size: 26, align: 'center', color: c.ink500 }));
      for (let i = 0; i < total; i++) {
        this.box(W / 2 - total * 14 + i * 28 + 4, 540, 20, 6, { fill: i < n ? c.brand600 : c.lineStrong, stroke: 'none', r: 3 });
      }
    });
  }

  /** A few loops of "handwriting", for a line written by hand. */
  scribble(x: number, y: number, w: number, p = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.c.ink900;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const n = Math.floor(60 * p);
    for (let i = 0; i <= n; i++) {
      const u = i / 60;
      const px = x + u * w;
      const py = y + Math.sin(u * 26) * 9 + Math.sin(u * 7) * 4;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** A number changing: "24 → 23 Pack", the new one in green or clay. */
  change(x: number, y: number, label: Bi | string, from: number, to: number, unit: Bi | string, p: number) {
    const c = this.c;
    const up = to > from;
    const v = Math.round(lerp(from, to, p));
    this.box(x, y, 420, 64, { fill: up ? c.okWash : c.brandWash, stroke: up ? c.okEdge : c.brandEdge, r: 16 });
    this.text(label, x + 20, y + 32, { size: 18, weight: 600, color: c.ink700, maxW: 200 });
    this.text(String(from) + '  →', x + 236, y + 32, { size: 20, weight: 600, color: c.ink400 });
    this.text(String(v) + ' ' + this.tx(unit), x + 318, y + 32, { size: 24, weight: 700, color: up ? c.ok700 : c.brand700 });
  }
}
