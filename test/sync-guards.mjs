/**
 * test/sync-guards.mjs — checks who the client will sync with.
 *
 * Runs the real client modules (src/lib/relay.js, src/lib/crdt.js,
 * src/store/ydoc.ts) in Node, one copy per simulated user, against two local
 * relays:
 *
 *   Part 1 — a pass-through relay written in this file. It forwards every
 *            message to the handle it names and checks nothing, so these
 *            checks show what the client does by itself.
 *   Part 2 — relay/server.js. Two users connect the ordinary way and sync.
 *   Part 3 — relay/server.js. A connected peer goes away and a different
 *            socket registers the same handle. These checks depend on the
 *            relay in this checkout as much as on the client.
 *
 * Run from the repository root, after `npm ci` at the root and in relay/:
 *   node test/sync-guards.mjs
 * Optional argument: the path to another checkout to test instead.
 *
 * Nothing here touches a deployed relay. IndexedDB is replaced by a stub, so
 * persistence is not covered. The browser UI is not covered either: where the
 * UI would act (accepting a request), the test calls the same two functions
 * the UI calls, in the same order.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '..'));
const requireRoot = createRequire(path.join(root, 'x.js'));
const requireRelay = createRequire(path.join(root, 'relay', 'x.js'));
const esbuild = requireRoot('esbuild');
const WebSocket = requireRelay('ws');
const { WebSocketServer } = WebSocket;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return true; await sleep(20); }
  return false;
}
const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const note = (name, detail) => results.push(['NOTE', name, detail]);

// ─── Browser stand-ins ───────────────────────────────────────────────────────
globalThis.WebSocket = WebSocket;
globalThis.window = { addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const quiet = process.env.VERBOSE ? null : { log: console.log, warn: console.warn };
function hush(on) {
  if (!quiet) return;
  console.log = on ? () => {} : quiet.log;
  console.warn = on ? () => {} : quiet.warn;
}

// ─── Build one bundle of the client; import it once per simulated user ───────
const work = mkdtempSync(path.join(tmpdir(), 'sync-guards-'));
writeFileSync(path.join(work, 'idb-stub.mjs'),
  `export class IndexeddbPersistence { constructor() {} once(_e, cb) { queueMicrotask(cb); } on() {} destroy() {} }\n`);
writeFileSync(path.join(work, 'entry.mjs'), [
  `export * as relay from ${JSON.stringify(path.join(root, 'src/lib/relay.js'))};`,
  `export * as crdt from ${JSON.stringify(path.join(root, 'src/lib/crdt.js'))};`,
  `export * as store from ${JSON.stringify(path.join(root, 'src/store/ydoc.ts'))};`,
  `export * as Y from 'yjs';`,
].join('\n'));
const bundle = path.join(work, 'client.mjs');
await esbuild.build({
  entryPoints: [path.join(work, 'entry.mjs')], outfile: bundle, bundle: true, format: 'esm',
  platform: 'node', logLevel: 'silent', absWorkingDir: root, nodePaths: [path.join(root, 'node_modules')],
  alias: { 'y-indexeddb': path.join(work, 'idb-stub.mjs') },
  define: { 'import.meta.env.VITE_RELAY_URL': '__RELAY_URL__' },
});
let tabCount = 0;
async function openTab(handle, relayUrl) {
  globalThis.__RELAY_URL__ = relayUrl;
  const tab = { ...(await import(`${pathToFileURL(bundle).href}?tab=${++tabCount}`)) };
  tab.store.setIdentity({ displayName: handle, handle, handleRegisteredAt: null, avatarColor: '#000000', createdAt: new Date().toISOString() });
  tab.store.setPreferences({ ...tab.store.defaultPreferences(), guardianHandle: `guardian-of-${handle}` });
  tab.events = [];
  for (const e of ['connection_request', 'connection_accepted', 'connection_rejected', 'error']) {
    tab.relay.on(e, (data) => tab.events.push([e, data]));
  }
  tab.relay.connect();
  await until(() => tab.relay.getConnectionState() === 'registered');
  return tab;
}
const contacts = (tab) => [...tab.store.getContacts().keys()];
const snapshot = (tab) => JSON.stringify({ ...tab.store.exportLocalState(), exportedAt: null });

// A raw socket that speaks the wire protocol directly: the "other party" in Part 1.
function rawClient(url, handle) {
  return new Promise((res, rej) => {
    const s = new WebSocket(url); const q = [];
    s.on('message', (m) => { try { q.push(JSON.parse(m.toString())); } catch { /* ignore */ } });
    s.on('error', rej);
    s.on('open', async () => {
      const c = {
        s, q, send: (o) => s.send(JSON.stringify(o)),
        got: (type) => q.filter((m) => m.type === type),
        close: () => s.close(),
      };
      if (handle) { c.send({ type: 'REGISTER_HANDLE', handle }); await until(() => c.got('HANDLE_REGISTERED').length > 0); }
      res(c);
    });
  });
}

// ─── Part 1: the client by itself, behind a relay that checks nothing ────────
async function part1() {
  const port = 18600 + Math.floor(Math.random() * 300);
  const url = `ws://127.0.0.1:${port}`;
  const handles = new Map(); const names = new Map();
  const wss = new WebSocketServer({ port });
  wss.on('connection', (sock) => {
    sock.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const out = (to, data) => { const t = handles.get(String(to || '').toLowerCase()); if (t?.readyState === WebSocket.OPEN) t.send(JSON.stringify(data)); };
      if (m.type === 'REGISTER_HANDLE') { handles.set(m.handle.toLowerCase(), sock); names.set(sock, m.handle.toLowerCase()); sock.send(JSON.stringify({ type: 'HANDLE_REGISTERED', handle: m.handle })); }
      else if (m.type === 'PING') sock.send(JSON.stringify({ type: 'PONG' }));
      else if (m.type === 'CONNECTION_REQUEST') { out(m.toHandle, { type: 'CONNECTION_REQUEST_INCOMING', requestId: m.requestId, fromHandle: m.fromHandle }); sock.send(JSON.stringify({ type: 'CONNECTION_REQUEST_ROUTED', requestId: m.requestId, toHandle: m.toHandle })); }
      else if (m.type === 'CONNECTION_ACCEPT') out(m.fromHandle, { type: 'CONNECTION_ACCEPTED', requestId: m.requestId, byHandle: m.toHandle, syncSignal: true });
      else if (m.type === 'CONNECTION_REJECT') out(m.fromHandle, { type: 'CONNECTION_REJECTED', requestId: m.requestId, byHandle: m.toHandle });
      else if (m.toHandle) out(m.toHandle, { ...m, fromHandle: names.get(sock) });
    });
  });

  hush(true);
  const user = await openTab('casey', url);
  user.store.addContact('friend', 'close');
  user.store.sendMessage('friend', 'casey', 'a private note');
  user.store.addAsset('asset-1', { type: 'link', url: 'https://example.org/private', sharedInThread: 'friend', sharedAt: new Date().toISOString() });
  const other = await rawClient(url, '@stranger');
  const anon = await rawClient(url, null);
  hush(false);
  const before = snapshot(user);
  const settle = () => sleep(250);

  // A1 — a sync offer from a handle with no accepted request
  hush(true);
  other.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@casey', offer: { stateVector: [0] } });
  await settle(); hush(false);
  ok('A1 unsolicited sync offer: no answer sent', other.got('CRDT_SYNC_ANSWER').length === 0);
  ok('A1 unsolicited sync offer: no trust entry created', !contacts(user).includes('stranger'), contacts(user).join(','));
  hush(true);
  anon.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@casey', offer: { stateVector: [0] } });
  await settle(); hush(false);
  ok('A1 sync offer with no sender handle: no trust entry for own handle', !contacts(user).includes('casey'), contacts(user).join(','));

  // A2 — a connection accept for a request that was never sent
  hush(true);
  other.send({ type: 'CONNECTION_ACCEPT', requestId: 'never-requested', fromHandle: '@casey', toHandle: '@stranger' });
  await settle(); hush(false);
  ok('A2 unrequested accept: no trust entry created', !contacts(user).includes('stranger'), contacts(user).join(','));
  ok('A2 unrequested accept: no sync offer sent', other.got('CRDT_SYNC_OFFER').length === 0);
  ok('A2 unrequested accept: not announced to the UI', !user.events.some(([e]) => e === 'connection_accepted'));
  hush(true);
  other.send({ type: 'CONNECTION_REJECT', requestId: 'never-requested', fromHandle: '@casey', toHandle: '@stranger' });
  await settle(); hush(false);
  ok('A2 unrequested reject: connection state unchanged', user.relay.getConnectionState() === 'registered', user.relay.getConnectionState());

  // A3 — a sync answer that answers no offer (from a stranger, and from a real contact)
  const forged = () => {
    const d = new user.Y.Doc();
    d.getMap('profile').set('identity', { handle: 'overwritten' });
    d.getMap('assets').set('planted', { type: 'link', url: 'https://example.org/planted', sharedInThread: 'x', sharedAt: '' });
    return Array.from(user.Y.encodeStateAsUpdate(d));
  };
  hush(true);
  other.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@casey', answer: { update: forged() } });
  const friendRaw = await rawClient(url, '@friend');
  friendRaw.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@casey', answer: { update: forged() } });
  await settle(); hush(false);
  ok('A3 unsolicited sync answer: not applied', snapshot(user) === before);

  // A4 — a doc update from a handle that is not the established peer
  hush(true);
  other.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: forged() });
  anon.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: forged() });
  friendRaw.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: forged() });
  await settle(); hush(false);
  ok('A4 doc update from a non-peer: not applied', snapshot(user) === before);

  // A6 — malformed updates do not throw out of the handler, and the client keeps working
  const errors = []; const onErr = (e) => errors.push(e);
  process.on('uncaughtException', onErr);
  hush(true);
  for (const bad of [[255, 255, 255, 255], [1, 2, 3], 'not-an-array', null, { length: 5 }, 4e9]) {
    other.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: bad });
    friendRaw.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: bad });
    other.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@casey', answer: { update: bad } });
    other.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@casey', offer: { stateVector: bad } });
  }
  other.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@casey' });
  other.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@casey' });
  await settle(); hush(false);
  process.off('uncaughtException', onErr);
  ok('A6 malformed sync messages: nothing thrown', errors.length === 0, errors.map((e) => e.message).join(' | '));
  ok('A6 malformed sync messages: document unchanged', snapshot(user) === before);
  ok('A6 malformed sync messages: client still connected', user.relay.isRelayConnected());

  // A6, continued — the same kinds of payload from senders the client does act on:
  // a peer whose request was accepted, the established peer, and a peer this
  // client sent an offer to. Some of these payloads decode; what is checked is
  // that none throws, none changes the document, and the client carries on.
  const errors2 = []; const onErr2 = (e) => errors2.push(e);
  process.on('uncaughtException', onErr2);
  const payloads = [[255, 255, 255, 255], [1, 2, 3], [300, -1], ['x'], []];
  const pat = await rawClient(url, '@pat');
  const acceptPat = async (id) => {
    pat.send({ type: 'CONNECTION_REQUEST', fromHandle: '@pat', toHandle: '@casey', requestId: id });
    await until(() => user.events.some(([e, d]) => e === 'connection_request' && d.requestId === id));
    user.store.addContact('pat', 'contact');
    user.relay.acceptConnectionRequest(id, '@pat');
    await until(() => pat.got('CONNECTION_ACCEPTED').some((m) => m.requestId === id));
  };
  hush(true);
  for (const [i, bad] of payloads.entries()) {
    await acceptPat(`bad-offer-${i}`);
    pat.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@casey', offer: { stateVector: bad } });
    await settle();
  }
  await acceptPat('good-offer'); pat.q.length = 0;
  pat.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@casey', offer: { stateVector: [0] } });
  const answered = await until(() => pat.got('CRDT_SYNC_ANSWER').length > 0);
  hush(false);
  ok('A6 malformed offers from an accepted peer: nothing thrown', errors2.length === 0, errors2.map((e) => e.message).join(' | '));
  ok('A6 …and a well-formed offer from an accepted peer is still answered', answered);

  const beforePeer = snapshot(user);
  hush(true);
  for (const bad of [...payloads, 'not-an-array', null, { length: 5 }]) pat.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: bad });
  await settle(); hush(false);
  ok('A6 malformed updates from the established peer: nothing thrown', errors2.length === 0, errors2.map((e) => e.message).join(' | '));
  ok('A6 malformed updates from the established peer: document unchanged', snapshot(user) === beforePeer);
  hush(true);
  pat.send({ type: 'CRDT_UPDATE', toHandle: '@casey', update: forged() });
  const applied = await until(() => snapshot(user).includes('https://example.org/planted'));
  hush(false);
  ok('A6 …and a well-formed update from the established peer is still applied', applied);
  ok('A6 …without replacing the local identity', user.store.getIdentity()?.handle === 'casey', String(user.store.getIdentity()?.handle));

  const quinn = await rawClient(url, '@quinn');
  const offerToQuinn = async () => {
    quinn.q.length = 0;
    user.relay.sendConnectionRequest('@quinn').catch(() => {});
    await until(() => quinn.got('CONNECTION_REQUEST_INCOMING').length > 0);
    const id = quinn.got('CONNECTION_REQUEST_INCOMING').pop().requestId;
    quinn.send({ type: 'CONNECTION_ACCEPT', requestId: id, fromHandle: '@casey', toHandle: '@quinn' });
    return until(() => quinn.got('CRDT_SYNC_OFFER').length > 0);
  };
  const assetsOf = (tab) => JSON.stringify(JSON.parse(snapshot(tab)).assets);
  const beforeAnswer = assetsOf(user);
  hush(true);
  for (const bad of [...payloads, 'not-an-array', null]) {
    await offerToQuinn();
    quinn.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@casey', answer: { update: bad } });
    await settle();
  }
  hush(false);
  ok('A6 malformed answers to an outstanding offer: nothing thrown', errors2.length === 0, errors2.map((e) => e.message).join(' | '));
  ok('A6 malformed answers to an outstanding offer: nothing merged', assetsOf(user) === beforeAnswer);
  hush(true);
  const offered = await offerToQuinn();
  const late = new user.Y.Doc();
  late.getMap('assets').set('from-quinn', { type: 'link', url: 'https://example.org/from-quinn', sharedInThread: 'x', sharedAt: '' });
  quinn.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@casey', answer: { update: Array.from(user.Y.encodeStateAsUpdate(late)) } });
  const merged = await until(() => snapshot(user).includes('https://example.org/from-quinn'));
  hush(false);
  process.off('uncaughtException', onErr2);
  ok('A6 …and a well-formed answer to an outstanding offer is still applied', offered && merged);
  ok('A6 client still connected after all of the above', user.relay.isRelayConnected());

  hush(true);
  pat.close(); quinn.close();
  user.relay.disconnect(); other.close(); anon.close(); friendRaw.close();
  await new Promise((r) => wss.close(r)); hush(false);
}

// ─── Part 2: two users connect and sync through relay/server.js ──────────────
async function part2() {
  const port = 18900 + Math.floor(Math.random() * 300);
  const url = `ws://127.0.0.1:${port}`;
  let log = '';
  const srv = spawn('node', ['server.js'], { cwd: path.join(root, 'relay'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  await until(() => log.includes('listening'), 5000);

  hush(true);
  const ada = await openTab('ada', url);     // sends the request
  const bo = await openTab('bo', url);       // accepts it
  bo.store.addContact('someone-else', 'close');
  bo.store.sendMessage('someone-else', 'bo', 'earlier history');

  const request = ada.relay.sendConnectionRequest('@bo');
  await until(() => bo.events.some(([e]) => e === 'connection_request'));
  const incoming = bo.events.find(([e]) => e === 'connection_request')?.[1];
  if (incoming) {
    // What ConnectionRequest.tsx does on Accept: trust entry first, then the accept.
    bo.store.addContact(incoming.fromHandle.replace(/^@/, '').toLowerCase().trim(), 'contact');
    bo.relay.acceptConnectionRequest(incoming.requestId, incoming.fromHandle);
  }
  const outcome = await Promise.race([request, sleep(3000).then(() => null)]).catch(() => null);
  await until(() => ada.relay.getConnectionState() === 'established' && bo.relay.getConnectionState() === 'established', 3000);
  hush(false);

  ok('A5 request and accept complete', outcome?.accepted === true);
  ok('A5 both sides reach "established"', ada.relay.getConnectionState() === 'established' && bo.relay.getConnectionState() === 'established',
    `${ada.relay.getConnectionState()} / ${bo.relay.getConnectionState()}`);
  ok('A5 sync answer merged on the requester', snapshot(ada).includes('earlier history'));
  ok('A5 each side keeps its own identity after sync', ada.store.getIdentity()?.handle === 'ada' && bo.store.getIdentity()?.handle === 'bo',
    `${ada.store.getIdentity()?.handle} / ${bo.store.getIdentity()?.handle}`);

  // Live updates, both directions. Uses a top-level asset entry so the result
  // does not depend on how thread arrays merge.
  hush(true);
  bo.store.addAsset('from-bo', { type: 'link', url: 'https://example.org/bo', sharedInThread: 'ada', sharedAt: '' });
  const toRequester = await until(() => snapshot(ada).includes('https://example.org/bo'), 1500);
  ada.store.addAsset('from-ada', { type: 'link', url: 'https://example.org/ada', sharedInThread: 'bo', sharedAt: '' });
  const toAccepter = await until(() => snapshot(bo).includes('https://example.org/ada'), 1500);
  // A peer's profile write must not replace this device's profile.
  ada.store.setPreferences({ ...ada.store.defaultPreferences(), guardianHandle: 'changed-by-ada' });
  await sleep(400);
  hush(false);
  ok('A5 live update reaches the requester', toRequester);
  // Reported, not asserted: the handshake sends the accepter's document to the
  // requester but not the reverse, so the accepter cannot yet integrate the
  // requester's later updates. That is how the handshake behaved before these
  // checks existed; changing what a handshake replicates is a separate change.
  note('live update reaches the accepter', toAccepter ? 'yes' : `no (updates waiting on missing history: ${bo.store.doc.store.pendingStructs ? 'yes' : 'no'})`);
  note('contacts after sync', `requester: ${contacts(ada).join(',') || '-'} · accepter: ${contacts(bo).join(',') || '-'}`);
  ok('A5 a peer\'s preferences change does not replace the local preferences', bo.store.getPreferences()?.guardianHandle === 'guardian-of-bo',
    String(bo.store.getPreferences()?.guardianHandle));
  ok('A5 each side keeps its own identity after live updates', ada.store.getIdentity()?.handle === 'ada' && bo.store.getIdentity()?.handle === 'bo',
    `${ada.store.getIdentity()?.handle} / ${bo.store.getIdentity()?.handle}`);

  // Thread messages are reported, not asserted: delivery to the other user is a known open issue.
  hush(true);
  bo.store.sendMessage('ada', 'bo', 'hello from bo');
  const threadSeen = await until(() => snapshot(ada).includes('hello from bo'), 1500);
  hush(false);
  note('thread message from accepter visible to requester', threadSeen ? 'yes' : 'no (known open issue; not part of this check)');

  hush(true);
  ada.relay.disconnect(); bo.relay.disconnect(); srv.kill(); await sleep(100); hush(false);
}

// ─── Part 3: a peer goes away and another socket registers its handle ────────
async function part3() {
  const port = 19200 + Math.floor(Math.random() * 300);
  const url = `ws://127.0.0.1:${port}`;
  let log = '';
  const srv = spawn('node', ['server.js'], { cwd: path.join(root, 'relay'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  await until(() => log.includes('listening'), 5000);
  const settle = () => sleep(300);
  const gone = async (c) => { await new Promise((r) => { c.s.on('close', r); c.s.close(); }); await sleep(150); };
  const planted = (tab) => {
    const d = new tab.Y.Doc();
    d.getMap('assets').set('planted', { type: 'link', url: 'https://example.org/planted', sharedInThread: 'x', sharedAt: '' });
    return Array.from(tab.Y.encodeStateAsUpdate(d));
  };
  // The peer asks, and the user accepts the way ConnectionRequest.tsx does.
  const acceptFrom = async (tab, peer, id) => {
    peer.send({ type: 'CONNECTION_REQUEST', fromHandle: '@ben', toHandle: `@${tab.store.getIdentity().handle}`, requestId: id });
    await until(() => tab.events.some(([e, d]) => e === 'connection_request' && d.requestId === id));
    tab.store.addContact('ben', 'contact');
    tab.relay.acceptConnectionRequest(id, '@ben');
    await until(() => peer.got('CONNECTION_ACCEPTED').length > 0);
  };

  hush(true);
  // Accepted, then the peer leaves before offering.
  let user = await openTab('dana', url); let peer = await rawClient(url, '@ben');
  await acceptFrom(user, peer, 'r1'); await gone(peer);
  let next = await rawClient(url, '@ben');
  next.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@dana', offer: { stateVector: [0] } }); await settle();
  const r1 = next.got('CRDT_SYNC_ANSWER').length === 0;
  next.close(); user.relay.disconnect();

  // Established, then the peer leaves.
  user = await openTab('eli', url); peer = await rawClient(url, '@ben');
  await acceptFrom(user, peer, 'r2');
  peer.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@eli', offer: { stateVector: [0] } });
  const handshake = await until(() => peer.got('CRDT_SYNC_ANSWER').length > 0);
  await gone(peer);
  next = await rawClient(url, '@ben');
  let before = snapshot(user);
  next.send({ type: 'CRDT_UPDATE', toHandle: '@eli', update: planted(user) }); await settle();
  const r2 = snapshot(user) === before;
  user.store.addAsset('later', { type: 'link', url: 'https://example.org/later', sharedInThread: 'x', sharedAt: '' }); await settle();
  const r4 = next.got('CRDT_UPDATE').length === 0;
  const stateAfter = user.relay.getConnectionState();
  next.close(); user.relay.disconnect();

  // An offer is outstanding, then the peer leaves.
  user = await openTab('flo', url); peer = await rawClient(url, '@ben');
  user.relay.sendConnectionRequest('@ben').catch(() => {});
  await until(() => peer.got('CONNECTION_REQUEST_INCOMING').length > 0);
  const id = peer.got('CONNECTION_REQUEST_INCOMING')[0]?.requestId;
  peer.send({ type: 'CONNECTION_ACCEPT', requestId: id, fromHandle: '@flo', toHandle: '@ben' });
  await until(() => peer.got('CRDT_SYNC_OFFER').length > 0); await gone(peer);
  next = await rawClient(url, '@ben'); before = snapshot(user);
  next.send({ type: 'CRDT_SYNC_ANSWER', toHandle: '@flo', answer: { update: planted(user) }, requestId: id }); await settle();
  const r3 = snapshot(user) === before;
  next.close(); user.relay.disconnect();

  // The peer leaves before the user answers its request.
  user = await openTab('gus', url); peer = await rawClient(url, '@ben');
  peer.send({ type: 'CONNECTION_REQUEST', fromHandle: '@ben', toHandle: '@gus', requestId: 'r5' });
  await until(() => user.events.some(([e, d]) => e === 'connection_request' && d.requestId === 'r5')); await gone(peer);
  next = await rawClient(url, '@ben');
  user.store.addContact('ben', 'contact'); user.relay.acceptConnectionRequest('r5', '@ben'); await settle();
  const r5a = next.got('CONNECTION_ACCEPTED').length === 0;
  next.send({ type: 'CRDT_SYNC_OFFER', toHandle: '@gus', offer: { stateVector: [0] } }); await settle();
  const r5b = next.got('CRDT_SYNC_ANSWER').length === 0;
  next.close(); user.relay.disconnect(); srv.kill(); await sleep(100);
  hush(false);

  ok('R1 accepted peer leaves; another socket with its handle gets no sync answer', r1);
  ok('R2 ordinary handshake with the peer completes first', handshake);
  ok('R2 established peer leaves; another socket with its handle cannot write', r2);
  ok('R4 …and does not receive the user\'s later updates', r4);
  ok('R4 …and the client stops treating the peer as connected', stateAfter === 'registered', stateAfter);
  ok('R3 offer outstanding, peer leaves; another socket with its handle cannot answer it', r3);
  ok('R5 requester leaves before the accept; the accept is not delivered to another socket', r5a);
  ok('R5 …and that socket gets no sync answer', r5b);
}

let failed = false;
try { await part1(); await part2(); await part3(); }
catch (err) { hush(false); failed = true; console.error('test run aborted:', err); }
finally { rmSync(work, { recursive: true, force: true }); }

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  — ${d}` : ''}`);
const fails = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.filter(([s]) => s === 'PASS').length} passed, ${fails} failed`);
process.exit(failed || fails ? 1 : 0);
