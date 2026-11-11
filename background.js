import { check, isDomain, judge, registrable, skeletonDomain } from './detect.js';
import { DOMAINS } from './domains.js';

const ONLINE = true;    // false = never look domains up on rdap.org
const MIN_VISITS = 10;  // history visits before a site counts as "one of yours"
const DAY = 864e5;

// Sites the user really uses, from browser history. Lookalikes of these get flagged too.
async function learnedDomains() {
  const { learned } = await chrome.storage.local.get('learned');
  if (learned && Date.now() - learned.at < DAY) return learned.list;
  const count = {};
  for (const { url, visitCount } of await chrome.history.search({ text: '', startTime: 0, maxResults: 10000 })) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || !isDomain(u.hostname)) continue;
      const d = registrable(u.hostname);
      count[d] = (count[d] ?? 0) + visitCount;
    } catch {}
  }
  // !check(d): a fake of a bundled domain never becomes trusted just by being visited a lot.
  // ponytail: a fake of a *learned* domain visited 10+ times before install does. Fix: compare domain ages.
  const list = Object.keys(count).filter((d) => count[d] >= MIN_VISITS && !check(d));
  await chrome.storage.local.set({ learned: { at: Date.now(), list } });
  return list;
}

// Registration date in ms, or undefined when unknown (no RDAP for that TLD, offline, rate limited).
// ponytail: rdap.org is a public redirector with rate limits; use the IANA bootstrap file if it throttles.
async function registered(dom) {
  try {
    const r = await fetch(`https://rdap.org/domain/${dom}`);
    if (!r.ok) return undefined;
    const e = (await r.json()).events?.find((x) => x.eventAction === 'registration');
    return e ? Date.parse(e.eventDate) : undefined;
  } catch { return undefined; }
}

// Online verdict for a domain nobody has vouched for. Looked up once, then cached.
// ponytail: cache grows forever (one small entry per new site). Prune by age if it matters.
async function lookup(hostname) {
  const dom = registrable(hostname);
  const { verdicts = {} } = await chrome.storage.local.get('verdicts');
  if (dom in verdicts) return verdicts[dom];
  const reg = await registered(dom);
  if (reg === undefined) return null; // unknown: fail open, retry next visit
  const skel = skeletonDomain(hostname);
  const verdict = judge(reg, skel, skel && await registered(skel));
  const fresh = (await chrome.storage.local.get('verdicts')).verdicts ?? {};
  await chrome.storage.local.set({ verdicts: { ...fresh, [dom]: verdict } });
  return verdict;
}

chrome.webNavigation.onBeforeNavigate.addListener(async ({ frameId, tabId, url }) => {
  if (frameId !== 0) return; // top-level page only
  const { hostname } = new URL(url);
  if (!isDomain(hostname)) return;
  const dom = registrable(hostname);
  const { allow = [] } = await chrome.storage.local.get('allow');
  if (DOMAINS.includes(dom) || allow.includes(dom)) return;
  const learned = await learnedDomains();
  if (learned.includes(dom)) return;

  // 1. instant, offline: lookalike of a bundled or learned domain
  let hit = check(hostname, allow, learned);
  // 2. unknown domain: ask the registry how old it is (network, so the page may show briefly first)
  if (!hit && ONLINE) {
    hit = await lookup(hostname);
    const frame = hit && await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
    if (hit && (!frame || new URL(frame.url).hostname !== hostname)) return; // user already left
  }
  if (!hit) return;
  const q = new URLSearchParams({ to: url, ...hit });
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL('warning.html') + '?' + q });
}, { url: [{ schemes: ['http', 'https'] }] });
