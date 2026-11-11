// Pure lookalike-domain detection. No browser APIs, so `node test.mjs` can run it.
import { DOMAINS } from './domains.js';

const SLD = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

// ponytail: naive suffix rule (last 2 labels, or 3 for things like co.uk).
// Swap for the Public Suffix List if odd TLDs give wrong results.
export function registrable(host) {
  const p = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '').split('.');
  const n = p.length >= 3 && p.at(-1).length === 2 && SLD.has(p.at(-2)) ? 3 : 2;
  return p.slice(-n).join('.');
}

// RFC 3492 decoder. Browsers hand us "xn--..." and have no built-in to decode it.
export function punyDecode(s) {
  const out = [];
  const d = s.lastIndexOf('-');
  for (let j = 0; j < d; j++) out.push(s.charCodeAt(j));
  let n = 128, i = 0, bias = 72;
  for (let p = d + 1; p < s.length;) {
    const oldi = i;
    for (let w = 1, k = 36; ; k += 36) {
      const c = s.charCodeAt(p++);
      const digit = c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : NaN;
      if (Number.isNaN(digit)) throw new Error('bad punycode');
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= 36 - t;
    }
    const len = out.length + 1;
    let delta = oldi === 0 ? Math.floor(i / 700) : (i - oldi) >> 1;
    delta += Math.floor(delta / len);
    let k = 0;
    for (; delta > 455; k += 36) delta = Math.floor(delta / 35);
    bias = k + Math.floor((36 * delta) / (delta + 38));
    n += Math.floor(i / len);
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

function toUnicode(host) {
  return host.toLowerCase().split('.').map((l) => {
    if (!l.startsWith('xn--')) return l;
    try { return punyDecode(l.slice(4)); } catch { return l; }
  }).join('.');
}

// Characters that look like a Latin letter -> that letter.
const CONFUSABLE = {
  0: 'o', 1: 'l', 3: 'e', 5: 's', '|': 'l',
  // Cyrillic
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l',
  // Greek
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  // Latin extras that NFKD does not split
  ı: 'i', ɡ: 'g', ɑ: 'a', ł: 'l', ø: 'o', đ: 'd',
};

export function skeleton(s) {
  const base = s.normalize('NFKD').replace(/\p{M}/gu, '');
  return [...base].map((c) => CONFUSABLE[c] ?? c).join('').replace(/rn/g, 'm').replace(/vv/g, 'w');
}

// True when a and b differ by exactly one insert, delete, substitute or adjacent swap.
function dist1(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const ra = a.slice(i), rb = b.slice(i);
  return ra.slice(1) === rb.slice(1) || ra.slice(1) === rb || ra === rb.slice(1)
    || (ra.length > 1 && ra[0] === rb[1] && ra[1] === rb[0] && ra.slice(2) === rb.slice(2));
}

const split = (d) => { const i = d.indexOf('.'); return [d.slice(0, i), d.slice(i + 1)]; };
const prepCache = new Map();
const prep = (d) => {
  if (!prepCache.has(d)) { const [name, suffix] = split(d); prepCache.set(d, { d, name, suffix, skel: skeleton(name) }); }
  return prepCache.get(d);
};

// false for localhost and IP addresses
export const isDomain = (host) => host.includes('.') && !host.includes(':') && !/^[\d.]+$/.test(host);

// "mybank0famerica.com" -> "mybankofamerica.com". null when nothing changes or result is not plain ASCII.
export function skeletonDomain(hostname) {
  const dom = registrable(toUnicode(hostname));
  const [name, suffix] = split(dom);
  const s = skeleton(name);
  return s !== name && /^[a-z0-9-]+$/.test(s) ? `${s}.${suffix}` : null;
}

const DAY = 864e5;
// Verdict from registration dates (ms, undefined = unknown). Pure, so test.mjs can check it.
// - registered under 30 days ago -> { newDays }
// - under a year old, and its de-confused spelling is an older registered domain -> { lookalikeOf }
export function judge(reg, skelDom, skelReg, now = Date.now()) {
  if (reg === undefined) return null;
  if (skelDom && skelReg < reg && now - reg < 365 * DAY) return { lookalikeOf: skelDom };
  if (now - reg < 30 * DAY) return { newDays: Math.max(0, Math.floor((now - reg) / DAY)) };
  return null;
}

// `learned` = extra real domains (from the user's own history), protected like the bundled ones.
// Returns { lookalikeOf: 'google.com' } or null.
export function check(hostname, allowlist = [], learned = []) {
  const host = toUnicode(hostname).replace(/\.$/, '');
  if (!isDomain(host)) return null;
  const dom = registrable(host);
  const known = [...DOMAINS, ...learned];
  if (known.includes(dom) || allowlist.includes(registrable(hostname))) return null;
  const PROTECTED = known.map(prep);

  const [name, suffix] = split(dom);
  const skel = skeleton(name);
  const sub = '.' + host.slice(0, -dom.length); // ".google.com." for google.com.evil.ru

  let typo = null;
  for (const p of PROTECTED) {
    if (sub.includes('.' + p.d + '.')) return { lookalikeOf: p.d };            // brand in subdomain
    if (skel === p.skel) {
      if (name !== p.name) return { lookalikeOf: p.d };                         // homoglyph
      if (name.length >= 5 && dist1(suffix, p.suffix)) return { lookalikeOf: p.d }; // paypal.co
    }
    // ponytail: typo check only for 6+ char names with the same first letter, else
    // real sites (apply.com, motion.com, switch.com) get flagged. Loosen if it misses too much.
    if (!typo && p.skel.length >= 6 && skel[0] === p.skel[0] && dist1(skel, p.skel)) typo = p.d;
  }
  return typo ? { lookalikeOf: typo } : null;
}
