import { useId, type CSSProperties } from 'react';

/**
 * Illustrated pack shots. We have no store photography yet, so each product is drawn as the kind of package it
 * actually comes in (bag, jar, pouch, tin, bottle, box, frozen bag, fresh crate), labelled with its real name,
 * brand and size. They are illustrations, not photos, and are replaced automatically by a store's real photo.
 */
type Kind = 'bag' | 'jar' | 'pouch' | 'tin' | 'frozen' | 'snack' | 'bottle' | 'box' | 'fresh';

const RULES: [RegExp, Kind][] = [
  [/frozen/, 'frozen'], [/injera/, 'bag'], [/fresh|okra|plantains \(|yam|peppers|leaves|produce/, 'fresh'],
  [/sardine|tomato paste|tin\b|canned/, 'tin'], [/oil\b|drink|concentrate|bottle|juice/, 'bottle'], [/shea|butter|preserved|relish|harissa|sauce|paste|jar|jarred/, 'jar'],
  [/tea|porridge|cereal|mix\b|couscous|box/, 'box'], [/chips|chin chin|snack|biltong/, 'snack'],
  [/flour|rice|garri|gari|meal|beans|grain|ogi|pap\b|fufu|teff|maize/, 'bag'], [/spice|seasoning|blend|ras el|suya|yaji|egusi|ogbono|hibiscus|dried|stockfish|catfish/, 'pouch'],
];
export function packKind(name: string, category?: string | null): Kind {
  const hay = `${name} ${category ?? ''}`.toLowerCase();
  for (const [re, k] of RULES) if (re.test(hay)) return k;
  return 'pouch';
}

const PALETTES: [string, string][] = [
  ['#1b6b45', '#ffc933'], ['#b5472b', '#ffd98a'], ['#254e8f', '#ffc933'], ['#7a2e5d', '#ffd3a6'], ['#c26a0c', '#fff0c8'],
  ['#0f766e', '#ffd166'], ['#8c2f39', '#f9e0b4'], ['#3d5a40', '#f0c75e'], ['#5b3a8c', '#ffd98a'], ['#a3470f', '#ffe3a3'],
];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  return `#${[r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
};

function wrap(text: string, max: number): string[] {
  const out: string[] = []; let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}

function Label({ x, y, w, h, name, brand, size, ink, accent, light, dark }: { x: number; y: number; w: number; h: number; name: string; brand?: string | null; size?: string; ink: string; accent: string; light: string; dark: string }) {
  const main = name.replace(/\s*\(.*\)\s*/g, '').trim() || name;
  const sub = /\((.*)\)/.exec(name)?.[1];
  const lines = wrap(main, Math.max(6, Math.floor(w / 8.2)));
  const longest = Math.max(...lines.map((l) => l.length));
  const top = y + (brand ? 24 : 12), bottom = y + h - (size ? 24 : 10), avail = bottom - top;
  const fs = Math.max(8, Math.min(21, (w - 10) / (0.6 * Math.max(longest, 5)), avail / (lines.length * 1.08 + (sub ? 0.95 : 0))));
  const block = lines.length * fs * 1.08 + (sub ? fs * 0.95 : 0);
  const cx = x + w / 2;
  const y0 = top + (avail - block) / 2 + fs * 0.82;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={light} />
      <rect x={x} y={y} width={w} height={5} rx={2} fill={accent} />
      {brand && <text x={cx} y={y + 17} textAnchor="middle" fontSize={7.5} fontWeight={800} letterSpacing={1} fill={dark} style={{ textTransform: 'uppercase' }}>{brand.length > 14 ? brand.slice(0, 13) + '…' : brand}</text>}
      {lines.map((l, i) => <text key={i} x={cx} y={y0 + i * fs * 1.08} textAnchor="middle" fontSize={fs} fontWeight={800} fill={ink} style={{ letterSpacing: '-.01em' }}>{l}</text>)}
      {sub && <text x={cx} y={y0 + lines.length * fs * 1.08 - fs * 0.1} textAnchor="middle" fontSize={Math.min(9, fs * 0.8)} fontWeight={600} fill={ink} opacity={0.72}>{sub.length > 18 ? sub.slice(0, 17) + '…' : sub}</text>}
      {size && <g><rect x={cx - 22} y={y + h - 19} width={44} height={13} rx={6.5} fill={accent} /><text x={cx} y={y + h - 9.6} textAnchor="middle" fontSize={8} fontWeight={800} fill={ink}>{size}</text></g>}
    </g>
  );
}

const zig = (x: number, y: number, w: number, n: number, amp: number) => {
  const step = w / n; let d = `M${x} ${y}`;
  for (let i = 0; i < n; i++) d += ` l${step / 2} ${amp} l${step / 2} ${-amp}`;
  return d;
};

export function ProductArt({ name, brand, category, size, bare = false, className = '', style }: { name: string; brand?: string | null; category?: string | null; size?: string | null; bare?: boolean; className?: string; style?: CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const h = hash(name);
  const [body, accent] = PALETTES[h % PALETTES.length];
  const kind = packKind(name, category);
  const dark = mix(body, '#000000', 0.28), lite = mix(body, '#ffffff', 0.28);
  const paper = '#fffaf0', ink = '#1b2a21';
  const tint = mix(body, '#fbf6ec', 0.86);
  const L = (x: number, y: number, w: number, hh: number) => <Label x={x} y={y} w={w} h={hh} name={name} brand={brand} size={size ?? undefined} ink={ink} accent={accent} light={paper} dark={dark} />;
  let shape: JSX.Element;
  switch (kind) {
    case 'bag':
      shape = (<g>
        <path d="M62 66 Q57 134 62 206 Q120 216 178 206 Q183 134 178 66 Z" fill={`url(#g${uid})`} />
        <path d={zig(58, 42, 124, 12, 7) + ' L182 64 L58 64 Z'} fill={dark} />
        <rect x={58} y={60} width={124} height={8} fill={mix(body, '#000000', 0.12)} />
        <path d="M70 70 Q66 134 70 200" stroke="#fff" strokeOpacity=".22" strokeWidth={5} fill="none" strokeLinecap="round" />
        {L(76, 98, 88, 96)}
      </g>); break;
    case 'frozen':
      shape = (<g>
        <path d="M62 66 Q57 134 62 206 Q120 216 178 206 Q183 134 178 66 Z" fill="#2f6fb5" />
        <path d={zig(58, 42, 124, 12, 7) + ' L182 64 L58 64 Z'} fill="#1d4f86" />
        <g stroke="#fff" strokeWidth={2.2} strokeLinecap="round" opacity={0.9} transform="translate(120 79)"><path d="M0 -9V9M-8 -4.5L8 4.5M-8 4.5L8 -4.5" /></g>
        <path d="M70 90 Q66 140 70 200" stroke="#fff" strokeOpacity=".28" strokeWidth={5} fill="none" strokeLinecap="round" />
        {L(76, 100, 88, 94)}
      </g>); break;
    case 'snack':
      shape = (<g>
        <path d="M68 62 Q50 134 68 206 L172 206 Q190 134 172 62 Z" fill={`url(#g${uid})`} />
        <path d={zig(64, 46, 112, 14, 6) + ' L176 64 L64 64 Z'} fill={dark} />
        <path d={zig(64, 200, 112, 14, 6) + ' L176 214 L64 214 Z'} fill={dark} />
        <path d="M76 72 Q62 134 76 196" stroke="#fff" strokeOpacity=".25" strokeWidth={6} fill="none" strokeLinecap="round" />
        {L(80, 94, 80, 96)}
      </g>); break;
    case 'pouch':
      shape = (<g>
        <path d="M70 56 L170 56 L178 200 Q120 218 62 200 Z" fill={`url(#g${uid})`} />
        <path d={zig(70, 56, 100, 12, 5) + ' L170 70 L70 70 Z'} fill={dark} />
        <circle cx={120} cy={63} r={2.2} fill={accent} />
        <path d="M76 82 L70 196" stroke="#fff" strokeOpacity=".22" strokeWidth={5} fill="none" strokeLinecap="round" />
        {L(80, 90, 80, 100)}
      </g>); break;
    case 'jar':
      shape = (<g>
        <rect x={86} y={44} width={68} height={20} rx={5} fill={accent} /><rect x={86} y={44} width={68} height={6} rx={3} fill="#fff" opacity=".35" />
        <path d="M92 64 H148 V76 Q176 84 176 110 V190 Q176 208 158 208 H82 Q64 208 64 190 V110 Q64 84 92 76 Z" fill={mix(body, '#ffffff', 0.78)} stroke={mix(body, '#000000', 0.1)} strokeOpacity=".4" />
        <path d="M66 112 H174 V190 Q174 206 158 206 H82 Q66 206 66 190 Z" fill={`url(#g${uid})`} />
        <path d="M74 92 Q70 130 74 186" stroke="#fff" strokeOpacity=".5" strokeWidth={5} fill="none" strokeLinecap="round" />
        {L(76, 114, 88, 82)}
      </g>); break;
    case 'tin':
      shape = (<g>
        <path d="M66 74 V192 Q66 206 120 206 Q174 206 174 192 V74 Z" fill={`url(#g${uid})`} />
        <ellipse cx={120} cy={74} rx={54} ry={12} fill="#d9dee2" /><ellipse cx={120} cy={74} rx={44} ry={8} fill="#eef1f3" />
        <rect x={66} y={86} width={108} height={96} fill={mix(body, '#000000', 0.04)} /><path d="M66 192 Q120 214 174 192" stroke="#fff" strokeOpacity=".2" fill="none" />
        <path d="M76 90 V186" stroke="#fff" strokeOpacity=".25" strokeWidth={5} strokeLinecap="round" />
        {L(76, 96, 88, 80)}
      </g>); break;
    case 'bottle':
      shape = (<g>
        <rect x={108} y={34} width={24} height={16} rx={3} fill={accent} />
        <path d="M110 50 H130 V74 Q160 84 160 112 V192 Q160 208 144 208 H96 Q80 208 80 192 V112 Q80 84 110 74 Z" fill={`url(#g${uid})`} />
        <path d="M90 100 Q86 140 90 192" stroke="#fff" strokeOpacity=".35" strokeWidth={5} fill="none" strokeLinecap="round" />
        {L(86, 118, 68, 76)}
      </g>); break;
    case 'box':
      shape = (<g>
        <path d="M64 58 H170 V206 H64 Z" fill={`url(#g${uid})`} />
        <path d="M170 58 L186 68 V198 L170 206 Z" fill={dark} /><path d="M64 58 L80 48 H186 L170 58 Z" fill={lite} />
        {L(72, 80, 90, 108)}
      </g>); break;
    default:
      shape = (<g>
        {[[-52, 'M0 0 Q-10 -46 -34 -56 Q-24 -22 0 0Z'], [-26, 'M0 0 Q-6 -58 -14 -72 Q4 -44 0 0Z'], [0, 'M0 0 Q-12 -64 0 -80 Q12 -64 0 0Z'], [26, 'M0 0 Q6 -58 14 -72 Q-4 -44 0 0Z'], [52, 'M0 0 Q10 -46 34 -56 Q24 -22 0 0Z']].map(([r, d], i) => (
          <path key={i} d={d as string} transform={`translate(120 178) rotate(${r})`} fill={i % 2 ? '#2e9c5f' : '#1f7a47'} />))}
        <rect x={70} y={172} width={100} height={38} rx={4} fill="#a8733c" /><rect x={70} y={172} width={100} height={8} rx={3} fill="#c18d52" />
        <path d="M70 188 H170 M70 200 H170" stroke="#7c5428" strokeWidth={1.5} />
        <rect x={82} y={184} width={76} height={22} rx={3} fill={paper} />
        <text x={120} y={199} textAnchor="middle" fontSize={Math.min(11, 70 / (0.6 * Math.max(name.replace(/\s*\(.*\)/, '').length, 6)))} fontWeight={800} fill={ink}>{name.replace(/\s*\(.*\)/, '').slice(0, 18)}</text>
      </g>);
  }
  return (
    <svg viewBox="0 0 240 240" className={`art ${className}`} style={style} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`g${uid}`} x1="0" x2="1"><stop offset="0" stopColor={lite} /><stop offset=".45" stopColor={body} /><stop offset="1" stopColor={dark} /></linearGradient>
        <radialGradient id={`b${uid}`} cx=".5" cy=".38" r=".75"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor={tint} /></radialGradient>
      </defs>
      {!bare && <rect width={240} height={240} fill={`url(#b${uid})`} />}
      <ellipse cx={120} cy={212} rx={64} ry={8} fill="#000" opacity={bare ? 0.14 : 0.12} />
      {shape}
    </svg>
  );
}

/** Round store badge: initials on a coloured disc. */
export function StoreMark({ name, size = 48 }: { name: string; size?: number }) {
  const [body, accent] = PALETTES[hash(name) % PALETTES.length];
  const initials = name.replace(/^Demo\s+/i, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return <span className="store-mark" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${body}, ${mix(body, '#000000', 0.3)})`, color: accent }} aria-hidden="true">{initials}</span>;
}

/** Abstract banner for stores without a cover photo: soft geometric shapes in the store's colours. */
export function StoreBanner({ name, className = '' }: { name: string; className?: string }) {
  const [body, accent] = PALETTES[hash(name) % PALETTES.length];
  const h = hash(name);
  return (
    <svg viewBox="0 0 600 160" className={`banner-art ${className}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="600" height="160" fill={body} />
      <circle cx={80 + (h % 120)} cy={150} r={110} fill={mix(body, '#000000', 0.18)} />
      <circle cx={480 - (h % 90)} cy={20} r={90} fill={mix(body, '#ffffff', 0.14)} />
      <circle cx={330} cy={170} r={70} fill={accent} opacity=".9" />
      <path d={`M0 ${110 + (h % 20)} Q150 60 300 ${110 + (h % 15)} T600 ${90 + (h % 25)} V160 H0Z`} fill={mix(body, '#000000', 0.3)} opacity=".55" />
    </svg>
  );
}

export function Stars({ value, count }: { value: number | null | undefined; count?: number }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="stars" role="img" aria-label={`${value} out of 5 stars${count ? `, ${count} reviews` : ''}`}>
      <span className="stars-bg" aria-hidden="true">★★★★★</span><span className="stars-fg" style={{ width: `${pct}%` }} aria-hidden="true">★★★★★</span>
      {count != null && <span className="stars-n">({count})</span>}
    </span>
  );
}
