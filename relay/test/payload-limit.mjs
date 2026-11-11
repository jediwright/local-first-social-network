/**
 * relay/test/payload-limit.mjs — checks the relay's message size limit.
 *
 * Starts relay/server.js on a spare local port and checks that:
 *   - a well-formed sync message just under the limit is delivered intact;
 *   - a message over the limit closes that one connection (close code 1009
 *     or 1006, depending on timing), is delivered to nobody, and releases
 *     the sender's handle;
 *   - other connected clients are unaffected;
 *   - on a freshly started relay, a very large message adds little memory.
 *
 * Run from the repository root, after `npm ci` in relay/:
 *   node relay/test/payload-limit.mjs
 * Optional argument: the path to a relay directory to test instead.
 *
 * This test fails on a relay with no size limit. It does not cover many
 * connections sending large messages at once, the browser client's
 * behavior after a 1009 close, the Docker image, or the Fly proxy.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(process.argv[2] || path.join(here, '..'));
const require = createRequire(path.join(relayDir, 'x.js'));
const WebSocket = require('ws');

const LIMIT = 4 * 1024 * 1024;
let PORT = 18600 + Math.floor(Math.random() * 400);
let srv, log;
function startRelay() {
  log = '';
  srv = spawn('node', ['server.js'], { cwd: relayDir, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
}
async function relayReady() { for (let i = 0; i < 50 && !log.includes('listening'); i++) await sleep(100); return log.includes('listening'); }
const CLOSED_FOR_SIZE = [1009, 1006];

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const note = (name, detail) => results.push(['NOTE', name, detail]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rss = () => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8'))[1]) / 1024; } catch { return null; } };
const health = async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).json();

function client() {
  return new Promise((res, rej) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}`, { maxPayload: 256 * 1024 * 1024 });
    const q = []; let closeCode = null;
    s.on('message', m => q.push(JSON.parse(m.toString())));
    s.on('close', c => { closeCode = c; });
    s.on('error', () => {});
    s.on('open', () => res({
      s, q, send: o => s.send(typeof o === 'string' ? o : JSON.stringify(o)),
      closeCode: () => closeCode,
      async next(type, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { const i = q.findIndex(m => m.type === type); if (i >= 0) return q.splice(i, 1)[0]; await sleep(20); } return null; },
      async closed(ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (closeCode !== null) return closeCode; await sleep(20); } return null; },
    }));
    s.on('error', rej);
  });
}
// A sync update shaped like the browser client's: bytes as a JSON array of numbers.
function updateOfWireSize(bytes) {
  const n = Math.floor(bytes / 3.63); const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = (i * 31) & 255;
  return arr;
}

try {
  startRelay();
  ok('server starts', await relayReady());

  const alice = await client(), bob = await client(), carol = await client();
  alice.send({ type: 'REGISTER_HANDLE', handle: '@alice' }); await alice.next('HANDLE_REGISTERED');
  bob.send({ type: 'REGISTER_HANDLE', handle: '@bob' }); await bob.next('HANDLE_REGISTERED');
  carol.send({ type: 'REGISTER_HANDLE', handle: '@carol' }); await carol.next('HANDLE_REGISTERED');
  ok('three handles registered', (await health()).handles === 3);

  // Under the limit: delivered intact.
  const under = updateOfWireSize(3.9 * 1024 * 1024);
  const underMsg = JSON.stringify({ type: 'CRDT_UPDATE', toHandle: '@bob', update: under });
  ok('test message is under the limit', underMsg.length < LIMIT, `${underMsg.length} bytes`);
  alice.send(underMsg);
  const got = await bob.next('CRDT_UPDATE', 8000);
  ok('message under the limit is delivered intact', got?.fromHandle === '@alice' && got?.update?.length === under.length && got.update[12345] === under[12345]);

  // Over the limit: that connection is closed with 1009, nothing is delivered.
  const over = JSON.stringify({ type: 'CRDT_UPDATE', toHandle: '@bob', update: updateOfWireSize(5 * 1024 * 1024) });
  ok('test message is over the limit', over.length > LIMIT, `${over.length} bytes`);
  carol.send(over);
  const code = await carol.closed();
  ok('message over the limit closes the sender (1009 or 1006)', CLOSED_FOR_SIZE.includes(code), `close code ${code}`);
  ok('message over the limit is not delivered', (await bob.next('CRDT_UPDATE', 1500)) === null);
  await sleep(300);
  ok("closed sender's handle is released", (await health()).handles === 2, JSON.stringify(await health()));

  // Others unaffected.
  ok('other clients stay connected', alice.closeCode() === null && bob.closeCode() === null);
  alice.send({ type: 'CRDT_UPDATE', toHandle: '@bob', update: [1, 2, 3] });
  const small = await bob.next('CRDT_UPDATE');
  ok('other clients can still exchange messages', small?.fromHandle === '@alice' && small?.update?.length === 3);
  const again = await client();
  again.send({ type: 'REGISTER_HANDLE', handle: '@carol' });
  ok('released handle can be registered again', !!(await again.next('HANDLE_REGISTERED')));

  for (const c of [alice, bob, again]) c.s.close();

  // Memory under one very large message, on a freshly started relay so the
  // measurement is not flattered by an already-grown heap. Linux only.
  srv.kill(); await sleep(300); PORT += 1; startRelay();
  ok('fresh relay starts for the memory check', await relayReady());
  await sleep(500);
  const base = rss();
  const big = await client();
  let peak = base; const t = base === null ? null : setInterval(() => { peak = Math.max(peak, rss() ?? 0); }, 15);
  big.send('x'.repeat(90 * 1024 * 1024));
  const bigCode = await big.closed(15000);
  await sleep(1500); if (t) clearInterval(t);
  ok('90 MB message closes the sender (1009 or 1006)', CLOSED_FOR_SIZE.includes(bigCode), `close code ${bigCode}`);
  if (base === null) note('memory growth under a 90 MB message, fresh relay', 'not measured on this platform');
  else ok('memory growth under a 90 MB message stays below 40 MB (fresh relay)', peak - base < 40, `grew ${(peak - base).toFixed(0)} MB`);
  ok('relay still answers /health', (await health()).status === 'ok');
} catch (e) { ok('no exception', false, String(e)); }

srv.kill(); await sleep(200);
const fail = results.filter(r => r[0] === 'FAIL').length;
const pass = results.filter(r => r[0] === 'PASS').length;
console.log(`ws ${require('ws/package.json').version} | node ${process.version} | ${pass} passed, ${fail} failed`);
for (const r of results) console.log(` ${r[0]}  ${r[1]}${r[0] !== 'PASS' && r[2] ? '  <- ' + r[2] : ''}`);
process.exit(fail ? 1 : 0);
