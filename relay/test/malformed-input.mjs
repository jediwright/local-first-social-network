/**
 * relay/test/malformed-input.mjs — checks that malformed messages cannot
 * take the relay down.
 *
 * Starts relay/server.js on a spare local port. For each malformed message
 * it checks that the relay process keeps running, that a second connected
 * client stays connected and can still exchange messages, and that the
 * sender is told the message was refused where a refusal is expected.
 *
 * Run from the repository root, after `npm ci` in relay/:
 *   node relay/test/malformed-input.mjs
 * Optional argument: the path to a relay directory to test instead.
 *
 * This covers wrong field types and non-object JSON. It does not cover
 * WebSocket protocol errors (see payload-limit.mjs), stalled connections,
 * or how many connections the relay can hold.
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
let srv, log, exited;
function startRelay() {
  log = ''; exited = null;
  srv = spawn('node', ['server.js'], { cwd: relayDir, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  srv.on('exit', code => { exited = code; });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function relayReady() { for (let i = 0; i < 50 && !log.includes('listening'); i++) await sleep(100); return log.includes('listening'); }

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);

function client() {
  return new Promise((res, rej) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const q = []; let closeCode = null;
    s.on('message', m => { try { q.push(JSON.parse(m.toString())); } catch { /* ignore */ } });
    s.on('close', c => { closeCode = c; });
    s.on('error', () => {});
    s.on('open', () => res({
      s, q, send: o => s.send(typeof o === 'string' ? o : JSON.stringify(o)),
      closeCode: () => closeCode,
      drain() { q.length = 0; },
      async next(type, ms = 1500) { const t = Date.now(); while (Date.now() - t < ms) { const i = q.findIndex(m => m.type === type); if (i >= 0) return q.splice(i, 1)[0]; await sleep(20); } return null; },
    }));
    s.on('error', rej);
  });
}

// Each case: the raw text to send, and the ERROR code the sender should get
// (null where the relay is expected to ignore the message without replying).
const REFUSED = 'INVALID_PAYLOAD';
const cases = [
  ['null', REFUSED], ['5', REFUSED], ['"text"', REFUSED], ['[]', REFUSED], ['[{"type":"PING"}]', REFUSED],
  ['{"type":"CRDT_UPDATE","toHandle":5}', REFUSED],
  ['{"type":"CRDT_SYNC_OFFER","toHandle":{}}', REFUSED],
  ['{"type":"CRDT_SYNC_ANSWER","toHandle":[1]}', REFUSED],
  ['{"type":"CONNECTION_REQUEST","fromHandle":1,"toHandle":2,"requestId":3}', REFUSED],
  ['{"type":"CONNECTION_ACCEPT","requestId":1,"fromHandle":{},"toHandle":[]}', REFUSED],
  ['{"type":"CONNECTION_REJECT","requestId":1,"fromHandle":7,"toHandle":8}', REFUSED],
  ['{"type":"REGISTER_HANDLE","handle":5}', 'INVALID_HANDLE'],
  ['{"type":"REGISTER_HANDLE","handle":null}', 'INVALID_HANDLE'],
  ['{"type":"CHANNEL_JOIN","channelIds":"not-a-list"}', null],
  ['{"type":"CHANNEL_JOIN","channelIds":[null,5,{}]}', null],
  ['{"type":"CHANNEL_LEAVE","channelIds":7}', null],
  ['{"type":"SYNC_COMPLETE"}', null],
  ['{"type":{}}', 'UNKNOWN_TYPE'],
  ['{"type":null}', 'UNKNOWN_TYPE'],
  ['{}', 'UNKNOWN_TYPE'],
];

try {
  startRelay();
  ok('relay starts', await relayReady());
  let bystander = await client();
  bystander.send({ type: 'REGISTER_HANDLE', handle: '@bystander' }); await bystander.next('HANDLE_REGISTERED');

  for (const [text, expect] of cases) {
    if (exited !== null) {            // an earlier case crashed the relay: restart so every case is reported
      startRelay(); await relayReady();
      bystander = await client(); bystander.send({ type: 'REGISTER_HANDLE', handle: '@bystander' }); await bystander.next('HANDLE_REGISTERED');
    }
    const sender = await client(); sender.drain();
    sender.send(text);
    const err = await sender.next('ERROR', expect === null ? 400 : 1500);
    await sleep(150);
    const alive = exited === null;
    bystander.drain(); let pong = null;
    if (alive && bystander.closeCode() === null) { bystander.send({ type: 'PING' }); pong = await bystander.next('PONG', 1500); }
    const senderOpen = sender.closeCode() === null;
    const replyOk = expect === null ? true : err?.code === expect;
    ok(`${text.length > 60 ? text.slice(0, 57) + '...' : text}`,
      alive && !!pong && senderOpen && replyOk,
      !alive ? `relay exited with code ${exited}` : !pong ? 'bystander lost' : !senderOpen ? `sender closed ${sender.closeCode()}` : `expected ${expect}, got ${err?.code ?? 'no reply'}`);
    try { sender.s.close(); } catch { /* ignore */ }
  }

  // After all of that the relay still routes normally.
  if (exited === null) {
    const a = await client(); a.send({ type: 'REGISTER_HANDLE', handle: '@alice' }); await a.next('HANDLE_REGISTERED');
    a.send({ type: 'CRDT_UPDATE', toHandle: '@bystander', update: [1, 2, 3] });
    const got = await bystander.next('CRDT_UPDATE');
    ok('relay still routes a normal message afterwards', got?.fromHandle === '@alice');
    a.s.close(); bystander.s.close();
  } else ok('relay still routes a normal message afterwards', false, 'relay not running');
} catch (e) { ok('no exception in the test itself', false, String(e)); }

if (srv && exited === null) srv.kill();
await sleep(200);
const fail = results.filter(r => r[0] === 'FAIL').length;
console.log(`ws ${require('ws/package.json').version} | node ${process.version} | ${results.length - fail} passed, ${fail} failed`);
for (const r of results) console.log(` ${r[0]}  ${r[1]}${r[0] === 'FAIL' && r[2] ? '  <- ' + r[2] : ''}`);
process.exit(fail ? 1 : 0);
