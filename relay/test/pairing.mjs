/**
 * relay/test/pairing.mjs — checks which messages the relay will forward
 * between two handles.
 *
 * Starts relay/server.js on a spare local port and talks to it with raw
 * sockets. An accept or reject is forwarded only as the answer to a request
 * that was routed. Sync messages (CRDT_SYNC_OFFER, CRDT_SYNC_ANSWER,
 * CRDT_UPDATE) are forwarded only between two handles whose request was
 * accepted, and only while both still hold their handles.
 *
 * Run from the repository root, after `npm ci` in relay/:
 *   node relay/test/pairing.mjs
 * Optional argument: the path to a relay directory to test instead.
 *
 * This covers the relay only. What the client does with a message that does
 * reach it is covered by test/sync-guards.mjs.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(process.argv[2] || path.join(here, '..'));
const require = createRequire(path.join(relayDir, 'x.js'));
const WebSocket = require('ws');

const PORT = 18200 + Math.floor(Math.random() * 300);
let log = '';
const srv = spawn('node', ['server.js'], { cwd: relayDir, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50 && !log.includes('listening'); i++) await sleep(100);

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);

function client(handle) {
  return new Promise((res, rej) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const q = [];
    s.on('message', m => { try { q.push(JSON.parse(m.toString())); } catch { /* ignore */ } });
    s.on('error', rej);
    s.on('open', async () => {
      const c = {
        s, q, send: o => s.send(JSON.stringify(o)),
        got: type => q.filter(m => m.type === type),
        drain() { q.length = 0; },
        close: () => new Promise(r => { s.on('close', r); s.close(); }),
      };
      if (handle) { c.send({ type: 'REGISTER_HANDLE', handle }); for (let i = 0; i < 50 && !c.got('HANDLE_REGISTERED').length; i++) await sleep(20); }
      res(c);
    });
  });
}
const settle = () => sleep(200);
const SYNC = [
  { type: 'CRDT_SYNC_OFFER', offer: { stateVector: [0] } },
  { type: 'CRDT_SYNC_ANSWER', answer: { update: [0, 0] } },
  { type: 'CRDT_UPDATE', update: [0, 0] },
];
const syncSeen = c => SYNC.reduce((n, m) => n + c.got(m.type).length, 0);

try {
  const ana = await client('@ana');
  const ben = await client('@ben');
  const eve = await client('@eve');
  const anon = await client(null);

  // 1. No request, no accept
  eve.send({ type: 'CONNECTION_ACCEPT', requestId: 'never-requested', fromHandle: '@ana', toHandle: '@eve' });
  await settle();
  ok('accept with no matching request is not forwarded', ana.got('CONNECTION_ACCEPTED').length === 0);
  ok('accept with no matching request is refused to the sender', eve.got('ERROR').some(m => m.code === 'NO_PENDING_REQUEST'));
  eve.send({ type: 'CONNECTION_REJECT', requestId: 'never-requested', fromHandle: '@ana', toHandle: '@eve' });
  await settle();
  ok('reject with no matching request is not forwarded', ana.got('CONNECTION_REJECTED').length === 0);

  // 2. No accepted pair, no sync messages
  for (const m of SYNC) { eve.send({ ...m, toHandle: '@ana' }); anon.send({ ...m, toHandle: '@ana' }); }
  await settle();
  ok('sync messages from a handle with no accepted connection are not forwarded', syncSeen(ana) === 0, `${syncSeen(ana)} forwarded`);
  ok('…and the sender is told', eve.got('ERROR').filter(m => m.code === 'NOT_CONNECTED').length === SYNC.length);
  ok('sync messages from a socket with no handle are not forwarded', anon.got('ERROR').filter(m => m.code === 'NOT_CONNECTED').length === SYNC.length);

  // 3. A request that is routed but not yet accepted does not make a pair
  ana.send({ type: 'CONNECTION_REQUEST', fromHandle: '@ana', toHandle: '@ben', requestId: 'r1' });
  await settle();
  ok('request is routed to the target', ben.got('CONNECTION_REQUEST_INCOMING').some(m => m.requestId === 'r1' && m.fromHandle === '@ana'));
  for (const m of SYNC) { ana.send({ ...m, toHandle: '@ben' }); ben.send({ ...m, toHandle: '@ana' }); }
  await settle();
  ok('sync messages before the accept are not forwarded', syncSeen(ana) === 0 && syncSeen(ben) === 0);
  eve.send({ type: 'CONNECTION_ACCEPT', requestId: 'r1', fromHandle: '@ana', toHandle: '@eve' });
  await settle();
  ok('a third handle cannot accept a request addressed to someone else', ana.got('CONNECTION_ACCEPTED').length === 0);
  ben.send({ type: 'CONNECTION_ACCEPT', requestId: 'wrong-id', fromHandle: '@ana', toHandle: '@ben' });
  await settle();
  ok('accept with the wrong request id is not forwarded', ana.got('CONNECTION_ACCEPTED').length === 0);

  // 4. The ordinary path
  ben.send({ type: 'CONNECTION_ACCEPT', requestId: 'r1', fromHandle: '@ana', toHandle: '@ben' });
  await settle();
  ok('accept of a routed request is forwarded', ana.got('CONNECTION_ACCEPTED').some(m => m.requestId === 'r1' && m.byHandle === '@ben' && m.syncSignal === true));
  ben.send({ type: 'CONNECTION_ACCEPT', requestId: 'r1', fromHandle: '@ana', toHandle: '@ben' });
  await settle();
  ok('the same accept is forwarded once only', ana.got('CONNECTION_ACCEPTED').length === 1);
  ana.drain(); ben.drain();
  for (const m of SYNC) { ana.send({ ...m, toHandle: '@ben', fromHandle: '@forged' }); ben.send({ ...m, toHandle: '@ANA ' }); }
  await settle();
  ok('sync messages are forwarded both ways inside an accepted pair', syncSeen(ana) === SYNC.length && syncSeen(ben) === SYNC.length, `${syncSeen(ana)} / ${syncSeen(ben)}`);
  ok('forwarded messages carry the sender\'s registered handle', ben.q.every(m => m.fromHandle === '@ana') && ana.q.every(m => m.fromHandle === '@ben'));

  // 5. A pair is between two handles only
  for (const m of SYNC) { eve.send({ ...m, toHandle: '@ana' }); eve.send({ ...m, toHandle: '@ben' }); }
  ana.drain(); ben.drain(); await settle();
  ok('a third handle still cannot send sync messages to either side', syncSeen(ana) === 0 && syncSeen(ben) === 0);

  // 6. A pair ends when either handle is released
  await ben.close(); await settle();
  const ben2 = await client('@ben');
  ana.drain();
  for (const m of SYNC) { ben2.send({ ...m, toHandle: '@ana' }); ana.send({ ...m, toHandle: '@ben' }); }
  await settle();
  ok('a new socket that takes a released handle does not inherit its connections', syncSeen(ana) === 0 && syncSeen(ben2) === 0);

  // 7. A request left unanswered ends when the requester goes away
  const cat = await client('@cat');
  cat.send({ type: 'CONNECTION_REQUEST', fromHandle: '@cat', toHandle: '@ana', requestId: 'r2' });
  await settle(); await cat.close(); await settle();
  const cat2 = await client('@cat');
  ana.send({ type: 'CONNECTION_ACCEPT', requestId: 'r2', fromHandle: '@cat', toHandle: '@ana' });
  await settle();
  ok('a request does not outlive the socket that sent it', cat2.got('CONNECTION_ACCEPTED').length === 0);

  // 8. Unanswered requests per handle are bounded
  eve.drain();
  for (let i = 0; i < 25; i++) eve.send({ type: 'CONNECTION_REQUEST', fromHandle: '@eve', toHandle: '@ana', requestId: `flood-${i}` });
  await settle();
  ok('unanswered requests from one handle are capped', eve.got('CONNECTION_REQUEST_ROUTED').length === 20 && eve.got('ERROR').filter(m => m.code === 'TOO_MANY_REQUESTS').length === 5,
    `${eve.got('CONNECTION_REQUEST_ROUTED').length} routed`);

  // 9. The relay is still healthy
  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then(r => r.json()).catch(() => null);
  ok('relay still answers /health', health?.status === 'ok');
} catch (err) {
  ok('test run completed', false, String(err));
} finally {
  srv.kill();
}

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  — ${d}` : ''}`);
const fails = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
