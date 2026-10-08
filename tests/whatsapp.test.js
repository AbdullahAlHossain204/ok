// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone } = require('../phone');
const { buildMessage, buildUrl } = require('../whatsapp');

test('phone normalization', async () => {
  assert.equal(normalizePhone('01712345678'), '8801712345678');
  assert.equal(normalizePhone('017 1234-5678'), '8801712345678');
  assert.equal(normalizePhone('+8801712345678'), '8801712345678');
  assert.equal(normalizePhone('008801712345678'), '8801712345678');
  assert.equal(normalizePhone('8801712345678'), '8801712345678');
  assert.equal(normalizePhone('+44 7911 123456'), '447911123456');
  for (const bad of ['', '123', 'abc', '0171234', '01012345678', '+880171234']) assert.equal(normalizePhone(bad), null, bad);
});

test('message contains every required detail', async () => {
  const m = buildMessage({ name: 'Md. Rahim', amount: 1000000, txnId: 'INC-2026-000125', date: '2026-10-06', purpose: 'Building Fund', org: 'Madrasa' });
  assert.equal(m, [
    'Assalamu Alaikum Md. Rahim,',
    'Your donation of ৳10,000 has been successfully added to the Madrasa Fund.',
    'Transaction ID: INC-2026-000125', 'Date: 06 October 2026', 'Purpose: Building Fund',
    'JazakAllahu Khairan for your valuable contribution.', '— Madrasa Fund Management'].join('\n'));
});

test('url is correct and message round-trips', async () => {
  const msg = 'Hello & welcome\nLine 2 ৳5,000';
  const url = buildUrl('01712345678', msg);
  assert.ok(url.startsWith('https://wa.me/8801712345678?text='));
  assert.equal(decodeURIComponent(url.split('?text=')[1]), msg);
  assert.equal(buildUrl('abc', msg), null);
});
