/**
 * relay/test/smoke.mjs — regression check on the relay's message handling.
 *
 * Starts relay/server.js on a spare local port and exercises every message
 * type it handles, plus /health, handle release on disconnect, and the
 * fromHandle check on connection requests.
 *
 * Run from the repository root, after `npm ci` in relay/:
 *   node relay/test/smoke.mjs
 * Optional argument: the path to a relay directory to test instead.
 *
 * What a pass means: the message protocol behaves as it did before a change.
 * What a pass does not mean: it is not security evidence. It passes the same
 * way on vulnerable and fixed versions of `ws`. It does not cover fragmented
 * frames, close codes, payloads near the size limit, SYNC_COMPLETE, the
 * browser client (src/lib/relay.js), the Docker image, or the Fly proxy.
 * It is not the S4-5 two-tab checklist and does not replace it.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(process.argv[2] || path.join(here, '..'));
const require = createRequire(path.join(relayDir, 'x.js'));
const WebSocket = require('ws');
const wsVersion = require('ws/package.json').version;
const PORT = 18080 + Math.floor(Math.random() * 500);
const srv = spawn('node', ['server.js'], { cwd: relayDir, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client() {
  return new Promise((res, rej) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}`); const q = [];
    s.on('message', m => q.push(JSON.parse(m.toString())));
    s.on('open', () => res({ s, q, send: o => s.send(typeof o === 'string' ? o : JSON.stringify(o)),
      async next(type, ms = 1500) { const t = Date.now(); while (Date.now() - t < ms) { const i = q.findIndex(m => m.type === type); if (i >= 0) return q.splice(i, 1)[0]; await sleep(20); } return null; } }));
    s.on('error', rej);
  });
}
try {
  for (let i = 0; i < 50 && !log.includes('listening'); i++) await sleep(100);
  ok('server starts', log.includes('listening'), log.trim().split('\n')[0]);
  const h = await fetch(`http://127.0.0.1:${PORT}/health`); const hj = await h.json();
  ok('GET /health 200 ok', h.status === 200 && hj.status === 'ok', JSON.stringify(hj));
  const nf = await fetch(`http://127.0.0.1:${PORT}/nope`); ok('unknown path 404', nf.status === 404);
  const a = await client(), b = await client(), c = await client();
  a.send({ type: 'PING' }); ok('PING -> PONG', !!(await a.next('PONG')));
  a.send('not json'); const pe = await a.next('ERROR'); ok('bad JSON -> PARSE_ERROR', pe?.code === 'PARSE_ERROR');
  a.send({ type: 'NOPE' }); const ut = await a.next('ERROR'); ok('unknown type -> UNKNOWN_TYPE', ut?.code === 'UNKNOWN_TYPE');
  a.send({ type: 'REGISTER_HANDLE', handle: 'alice' }); const ih = await a.next('ERROR'); ok('handle without @ rejected', ih?.code === 'INVALID_HANDLE');
  a.send({ type: 'REGISTER_HANDLE', handle: '@Alice' }); const ra = await a.next('HANDLE_REGISTERED'); ok('register @alice (normalized)', ra?.handle === '@alice');
  b.send({ type: 'REGISTER_HANDLE', handle: '@bob' }); ok('register @bob', !!(await b.next('HANDLE_REGISTERED')));
  c.send({ type: 'REGISTER_HANDLE', handle: '@alice' }); ok('duplicate handle -> HANDLE_TAKEN', !!(await c.next('HANDLE_TAKEN')));
  c.send({ type: 'CONNECTION_REQUEST', fromHandle: '@alice', toHandle: '@bob', requestId: 'x' }); const ae = await c.next('ERROR'); ok('spoofed fromHandle -> AUTH_ERROR', ae?.code === 'AUTH_ERROR');
  a.send({ type: 'CONNECTION_REQUEST', fromHandle: '@alice', toHandle: '@bob', requestId: 'r1' });
  const inc = await b.next('CONNECTION_REQUEST_INCOMING'); const rt = await a.next('CONNECTION_REQUEST_ROUTED');
  ok('request routed to target', inc?.fromHandle === '@alice' && rt?.requestId === 'r1');
  a.send({ type: 'CONNECTION_REQUEST', fromHandle: '@alice', toHandle: '@nobody', requestId: 'r2' }); const f = await a.next('CONNECTION_REQUEST_FAILED'); ok('missing target -> TARGET_NOT_FOUND', f?.reason === 'TARGET_NOT_FOUND');
  b.send({ type: 'CONNECTION_ACCEPT', requestId: 'r1', fromHandle: '@alice', toHandle: '@bob' }); const acc = await a.next('CONNECTION_ACCEPTED'); ok('accept reaches requester', acc?.byHandle === '@bob');
  b.send({ type: 'CONNECTION_REJECT', requestId: 'r3', fromHandle: '@alice', toHandle: '@bob' }); ok('reject reaches requester', !!(await a.next('CONNECTION_REJECTED')));
  a.send({ type: 'CRDT_UPDATE', toHandle: '@bob', payload: 'p'.repeat(200000) }); const cu = await b.next('CRDT_UPDATE', 3000); ok('CRDT_UPDATE relayed with fromHandle (200 KB)', cu?.fromHandle === '@alice' && cu?.payload?.length === 200000);
  a.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@bob' }); ok('CRDT_SYNC_OFFER relayed', !!(await b.next('CRDT_SYNC_OFFER')));
  b.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@alice' }); ok('CRDT_SYNC_ANSWER relayed', !!(await a.next('CRDT_SYNC_ANSWER')));
  a.send({ type: 'CHANNEL_JOIN', channelIds: ['ch1'] }); const p1 = await a.next('CHANNEL_PRESENCE'); ok('channel join -> presence 1', p1?.memberCount === 1);
  b.send({ type: 'CHANNEL_JOIN', channelIds: ['ch1'] }); const p2 = await a.next('CHANNEL_PRESENCE'); ok('second join -> presence 2', p2?.memberCount === 2);
  b.send({ type: 'CHANNEL_LEAVE', channelIds: ['ch1'] }); const p3 = await a.next('CHANNEL_PRESENCE'); ok('leave -> presence 1', p3?.memberCount === 1);
  b.s.close(); await sleep(300);
  const h2 = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(); ok('disconnect releases handle', h2.handles === 1, JSON.stringify(h2));
  c.send({ type: 'REGISTER_HANDLE', handle: '@bob' }); ok('released handle can be re-registered', !!(await c.next('HANDLE_REGISTERED')));
  a.s.close(); c.s.close();
} catch (e) { ok('no exception', false, String(e)); }
srv.kill(); await sleep(200);
const fail = results.filter(r => r[0] === 'FAIL').length;
console.log(`ws ${wsVersion} | node ${process.version} | ${results.length - fail} passed, ${fail} failed`);
for (const r of results) console.log(` ${r[0]}  ${r[1]}${r[0] === 'FAIL' && r[2] ? '  <- ' + r[2] : ''}`);
process.exit(fail ? 1 : 0);
