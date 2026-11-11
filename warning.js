import { registrable } from './detect.js';

// Query params are untrusted: validate before using, render with textContent only.
const q = new URLSearchParams(location.search);
const like = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(q.get('lookalikeOf') ?? '') ? q.get('lookalikeOf') : null;
const days = /^\d+$/.test(q.get('newDays') ?? '') ? q.get('newDays') : null;
let to = null;
try {
  const u = new URL(q.get('to'));
  if (/^https?:$/.test(u.protocol)) to = u;
} catch {}

const $ = (id) => document.getElementById(id);
const leave = async () => {
  if (history.length > 1) return history.back();
  chrome.tabs.remove((await chrome.tabs.getCurrent()).id);
};

if (!to || !(like || days)) {
  leave();
} else {
  $('host').textContent = to.hostname;
  if (like) {
    $('why-like').hidden = false;
    $('like').textContent = like;
    $('real').textContent = `Go to ${like}`;
    $('real').onclick = () => location.replace(`https://${like}/`);
  } else {
    $('why-new').hidden = false;
    $('days').textContent = days;
    $('real').hidden = true;
  }
  $('back').onclick = leave;
  $('trust').onclick = async () => {
    const { allow = [] } = await chrome.storage.local.get('allow');
    await chrome.storage.local.set({ allow: [...new Set([...allow, registrable(to.hostname)])] });
    location.replace(to.href);
  };
}
