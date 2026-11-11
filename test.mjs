// Run: node test.mjs
import assert from 'node:assert/strict';
import { domainToUnicode } from 'node:url';
import { check, judge, punyDecode, registrable, skeletonDomain } from './detect.js';

// learned domains (from history) are protected like bundled ones
assert.equal(check('myc0olbank.com'), null);
assert.deepEqual(check('myc0olbank.com', [], ['mycoolbank.com']), { lookalikeOf: 'mycoolbank.com' });
assert.deepEqual(check('mycoolbnak.com', [], ['mycoolbank.com']), { lookalikeOf: 'mycoolbank.com' });
assert.equal(check('mycoolbank.com', [], ['mycoolbank.com']), null);

// online verdict
assert.equal(skeletonDomain('www.myc0olbank.com'), 'mycoolbank.com');
assert.equal(skeletonDomain('mycoolbank.com'), null);
const NOW = Date.UTC(2026, 10, 10), D = 864e5;
assert.deepEqual(judge(NOW - 3 * D, null, undefined, NOW), { newDays: 3 });            // brand new
assert.deepEqual(judge(NOW - 90 * D, 'mycoolbank.com', NOW - 5000 * D, NOW), { lookalikeOf: 'mycoolbank.com' });
assert.equal(judge(NOW - 90 * D, 'mycoolbank.com', undefined, NOW), null);             // real one not registered
assert.equal(judge(NOW - 9000 * D, 'mpe.com', NOW - 9500 * D, NOW), null);             // old site like mp3.com
assert.equal(judge(NOW - 400 * D, null, undefined, NOW), null);                        // ordinary site
assert.equal(judge(undefined, null, undefined, NOW), null);                            // lookup failed

const puny = (h) => new URL(`http://${h}`).hostname; // unicode -> xn--

const fake = {
  'go0gle.com': 'google.com',
  'www.go0gle.com': 'google.com',
  'gooogle.com': 'google.com',
  'googel.com': 'google.com',
  'gogle.net': 'google.com',
  'rnicrosoft.com': 'microsoft.com',
  'paypa1.com': 'paypal.com',
  'paypal.co': 'paypal.com',
  'google.com.login-check.ru': 'google.com',
  'accounts.google.com.evil.co.uk': 'google.com',
  [puny('gооgle.com')]: 'google.com', // Cyrillic о
  [puny('аpple.com')]: 'apple.com',   // Cyrillic а
  [puny('paypál.com')]: 'paypal.com',
};
for (const [host, real] of Object.entries(fake)) {
  assert.deepEqual(check(host), { lookalikeOf: real }, host);
}

const safe = [
  'google.com', 'mail.google.com', 'www.google.com', 'google.co.uk', 'google.de',
  'example.org', 'apply.com', 'motion.com', 'switch.com', 'google.github.io',
  'localhost', '127.0.0.1', '192.168.1.1', 'barclays.co.uk',
];
for (const host of safe) assert.equal(check(host), null, host);

// allowlist wins
assert.equal(check('go0gle.com', ['go0gle.com']), null);
assert.equal(check('www.go0gle.com', ['go0gle.com']), null);

assert.equal(registrable('a.b.example.co.uk'), 'example.co.uk');
assert.equal(registrable('www.example.com'), 'example.com');

// our punycode decoder agrees with Node's
for (const h of ['gооgle', 'münchen', 'ąćę', '例え', 'paypál']) {
  const ascii = puny(`${h}.com`).split('.')[0];
  assert.equal(punyDecode(ascii.slice(4)), domainToUnicode(ascii), h);
}

console.log('ok');
