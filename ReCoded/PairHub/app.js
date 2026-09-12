/* ============================================================
   PairHub — P2P sharing for GitHub Pages
   Uses PeerJS cloud for signaling, WebRTC for actual data.
   ============================================================ */
(() => {
'use strict';

/* ---------------- config ---------------- */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Public free TURN (openrelay). Replace with your own for production.
  { urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject', credential: 'openrelayproject' },
];

const SIGNALING_OPTS = {
  debug: 1,
  config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 },
};

const CHUNK_SIZE     = 16 * 1024;   // 16 KB — safe for every browser
const BUFFER_HIGH    = 1024 * 1024; // pause when buffered > 1 MB
const BUFFER_LOW     = 256  * 1024; // resume below 256 KB
const HEARTBEAT_MS   = 15000;
const HOST_TIMEOUT   = 3500;
const PEER_PREFIX    = 'pairhub-v1';
const MAX_HL         = 400_000;     // skip auto-highlight above ~400 KB

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
const EMOJI = ['⚡','🔥','🚀','🌟','🎯','🎨','🧠','🍀','🌊','🦊','🐼','🐙',
               '🦉','🐝','🎸','☕','🌵','🍄','🌙','⭐','🪐','🧊','🪁','🎲'];

/* ---------------- state ---------------- */
const state = {
  peer: null,
  myId: null,
  myCode: randomCode(),
  myName: '',
  room: loadRoom(),
  role: null,              // 'host' | 'guest'
  hostConn: null,          // guest → host control connection
  hostId: null,            // deterministic room host peer id
  conns: new Map(),        // peerId → DataConnection
  devices: new Map(),      // peerId → { id, name, code, avatar }
  target: null,            // peerId of current send target
  reconnecting: false,
  reconnectAttempts: 0,
  intentionallyClosed: false,
  heartbeats: new Map(),   // peerId → intervalId
};

/* ---------------- tiny DOM helpers ---------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function randomCode() {
  let s = '';
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  for (let i = 0; i < 6; i++) s += ROOM_CHARS[a[i] % ROOM_CHARS.length];
  return s;
}
function randomPeerId() {
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return `${PEER_PREFIX}-u-${[...a].map(n => n.toString(36)).join('')}`;
}
function loadRoom() {
  let r = localStorage.getItem('pairhub.room');
  if (!r || !/^[A-Z0-9]{4,8}$/.test(r)) {
    r = randomCode();
    localStorage.setItem('pairhub.room', r);
  }
  return r;
}
function saveRoom(r) { localStorage.setItem('pairhub.room', r); }

const fmtBytes = (n) => {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n/1048576).toFixed(2) + ' MB';
  return (n/1073741824).toFixed(2) + ' GB';
};
const timeStr = (ts = Date.now()/1000) =>
  new Date(ts*1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

let _toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function setStatus(kind, text) {
  const d = $('#status-dot');
  d.classList.toggle('online', kind === 'online');
  d.classList.toggle('warn',   kind === 'warn');
  $('#status-text').textContent = text;
}

/* ---------------- device name ---------------- */
function detectName() {
  const saved = localStorage.getItem('pairhub.name');
  if (saved) return saved;
  const ua = navigator.userAgent;
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Mac/.test(ua)     ? 'Mac' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS' :
    /Linux/.test(ua)   ? 'Linux' : 'Device';
  const br =
    /Edg\//.test(ua)    ? 'Edge' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua)? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const n = `${br} · ${os}`;
  localStorage.setItem('pairhub.name', n);
  return n;
}

function avatarFor(id) {
  const n = [...id].reduce((a,c) => a + c.charCodeAt(0), 0);
  return EMOJI[n % EMOJI.length];
}

/* ============================================================
   PEER / ROOM LOGIC
   ============================================================ */

function destroyPeer() {
  for (const [, iv] of state.heartbeats) clearInterval(iv);
  state.heartbeats.clear();
  state.conns.forEach(c => { try { c.close(); } catch {} });
  state.conns.clear();
  state.devices.clear();
  if (state.peer) {
    try { state.peer.destroy(); } catch {}
    state.peer = null;
  }
}

function makePeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, SIGNALING_OPTS);
    const onOpen  = () => { cleanup(); resolve(peer); };
    const onError = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      peer.off('open', onOpen);
      peer.off('error', onError);
    };
    peer.once('open',  onOpen);
    peer.once('error', onError);
  });
}

function wirePeer(peer) {
  peer.on('connection', onIncomingConnection);
  peer.on('disconnected', () => {
    if (state.intentionallyClosed) return;
    setStatus('warn', 'signaling lost');
    try { peer.reconnect(); } catch {}
  });
  peer.on('close', () => {
    if (state.intentionallyClosed) return;
    scheduleReconnect();
  });
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      // Attempted connection to a peer that left — normal during room churn
      return;
    }
    if (err.type === 'unavailable-id') {
      // Host ID taken → we'll handle via join flow
      return;
    }
    console.warn('[PeerHub] peer error', err);
  });
}

/* -------- join the room -------- */
async function joinRoom(roomCode) {
  state.intentionallyClosed = false;
  state.room = roomCode;
  state.hostId = `${PEER_PREFIX}-room-${roomCode}`;
  setStatus('warn', 'joining…');

  destroyPeer();

  /* ---- Attempt 1: try to be a guest ---- */
  try {
    state.peer = await makePeer(randomPeerId());
    wirePeer(state.peer);
    state.myId = state.peer.id;

    const host = await connectTo(state.hostId, HOST_TIMEOUT);
    state.role = 'guest';
    state.hostConn = host;
    wireHostConn(host);
    host.send({ t: 'join', name: state.myName, code: state.myCode, avatar: avatarFor(state.myId) });
    setStatus('online', 'connected');
    state.reconnectAttempts = 0;
    return;
  } catch (e) {
    // fall through
  }

  /* ---- Attempt 2: become the host ---- */
  destroyPeer();
  try {
    state.peer = await makePeer(state.hostId);
    wirePeer(state.peer);
    state.myId = state.hostId;
    state.role = 'host';
    state.hostConn = null;
    // Add ourselves to the devices list
    state.devices.set(state.myId, {
      id: state.myId, name: state.myName, code: state.myCode,
      avatar: avatarFor(state.myId), isSelf: true,
    });
    broadcastRoomList();
    setStatus('online', 'hosting');
    state.reconnectAttempts = 0;
    return;
  } catch (e) {
    // ID taken — someone else beat us. Fall through to retry as guest.
  }

  /* ---- Attempt 3: retry as guest with longer timeout ---- */
  destroyPeer();
  try {
    state.peer = await makePeer(randomPeerId());
    wirePeer(state.peer);
    state.myId = state.peer.id;
    const host = await connectTo(state.hostId, HOST_TIMEOUT * 2);
    state.role = 'guest';
    state.hostConn = host;
    wireHostConn(host);
    host.send({ t: 'join', name: state.myName, code: state.myCode, avatar: avatarFor(state.myId) });
    setStatus('online', 'connected');
    state.reconnectAttempts = 0;
  } catch (e) {
    setStatus('warn', 'retrying…');
    scheduleReconnect();
  }
}

function connectTo(peerId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = state.peer.connect(peerId, {
      reliable: true,
      serialization: 'binary',
      metadata: { name: state.myName, code: state.myCode },
    });
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      try { conn.close(); } catch {}
      reject(new Error('timeout'));
    }, timeoutMs);
    conn.once('open', () => {
      if (done) return;
      done = true;
      clearTimeout(to);
      resolve(conn);
    });
    conn.once('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      reject(e);
    });
    conn.once('close', () => {
      if (done) return;
      done = true;
      clearTimeout(to);
      reject(new Error('closed'));
    });
  });
}

/* -------- wire a data connection -------- */
function onIncomingConnection(conn) {
  // Hosts receive the room-join control channel + direct peer-to-peer channels.
  conn.on('open', () => {
    state.conns.set(conn.peer, conn);
    if (state.role === 'host' && conn.metadata?.name) {
      // This is likely a room member
      wireHostConn(conn);
      // Add to devices
      state.devices.set(conn.peer, {
        id: conn.peer, name: conn.metadata.name,
        code: conn.metadata.code || '------',
        avatar: avatarFor(conn.peer),
      });
      broadcastRoomList();
    }
    // Always listen for messages (text/file or room list)
    wireDataConn(conn);
    startHeartbeat(conn);
    renderDevices();
  });
}

function wireHostConn(conn) {
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'room-list') {
      // Guest receives authoritative member list
      const meId = state.myId;
      state.devices.clear();
      for (const d of msg.peers) {
        state.devices.set(d.id, { ...d, isSelf: d.id === meId });
      }
      // Add host itself if not listed
      if (!state.devices.has(state.hostId) && state.role === 'guest') {
        state.devices.set(state.hostId, {
          id: state.hostId, name: msg.hostName || 'Host',
          code: msg.hostCode || '------', avatar: avatarFor(state.hostId),
        });
      }
      renderDevices();
      // Auto-select a target if none
      if (!state.target || !state.devices.has(state.target)) {
        const first = [...state.devices.values()].find(d => d.id !== meId);
        if (first) state.target = first.id;
        renderDevices();
      }
    }
  });

  conn.on('close', () => {
    state.conns.delete(conn.peer);
    if (state.role === 'guest' && conn === state.hostConn) {
      toast('Room host left — rejoining…');
      scheduleReconnect();
    }
  });
}

function wireDataConn(conn) {
  conn.on('data', (msg) => handleIncoming(conn, msg));
  conn.on('close', () => {
    stopHeartbeat(conn.peer);
    state.conns.delete(conn.peer);
    if (state.target === conn.peer) state.target = null;
    renderDevices();
  });
  conn.on('error', () => {});
}

/* -------- host broadcast -------- */
function broadcastRoomList() {
  if (state.role !== 'host') return;
  const peers = [...state.devices.values()].filter(d => !d.isSelf).map(d => ({
    id: d.id, name: d.name, code: d.code, avatar: d.avatar,
  }));
  const payload = {
    t: 'room-list',
    peers,
    hostName: state.myName,
    hostCode: state.myCode,
  };
  for (const [, c] of state.conns) {
    if (c.open) { try { c.send(payload); } catch {} }
  }
}

/* -------- reconnect -------- */
function scheduleReconnect() {
  if (state.reconnecting || state.intentionallyClosed) return;
  state.reconnecting = true;
  state.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.7, state.reconnectAttempts), 15000);
  setStatus('warn', `reconnecting in ${Math.round(delay/1000)}s…`);
  setTimeout(async () => {
    state.reconnecting = false;
    await joinRoom(state.room);
  }, delay);
}

/* -------- heartbeat -------- */
function startHeartbeat(conn) {
  if (state.heartbeats.has(conn.peer)) return;
  const iv = setInterval(() => {
    if (conn.open) {
      try { conn.send({ t: 'ping', ts: Date.now() }); } catch {}
    } else {
      stopHeartbeat(conn.peer);
    }
  }, HEARTBEAT_MS);
  state.heartbeats.set(conn.peer, iv);
}
function stopHeartbeat(peerId) {
  const iv = state.heartbeats.get(peerId);
  if (iv) { clearInterval(iv); state.heartbeats.delete(peerId); }
}

/* ============================================================
   MESSAGE HANDLING
   ============================================================ */

const inbound = new Map(); // transferId → { kind, chunks, meta, received, total }

function handleIncoming(conn, msg) {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.t) {

    /* ---- control ---- */
    case 'ping': try { conn.send({ t: 'pong', ts: msg.ts }); } catch {}; break;
    case 'pong': break;

    /* ---- room management (guest → host) ---- */
    case 'join':
      if (state.role === 'host') {
        state.devices.set(conn.peer, {
          id: conn.peer, name: msg.name || 'Device',
          code: msg.code || '------',
          avatar: msg.avatar || avatarFor(conn.peer),
        });
        wireHostConn(conn);
        broadcastRoomList();
        renderDevices();
      }
      break;

    /* ---- text ---- */
    case 'text':
      addTextCard({
        from: state.devices.get(conn.peer) || { name: conn.peer },
        text: msg.text, lang: msg.lang, outgoing: false,
      });
      break;

    case 'text-start':
      inbound.set(msg.id, {
        kind: 'text', total: msg.size, received: 0,
        chunks: [], lang: msg.lang,
        from: state.devices.get(conn.peer) || { name: conn.peer },
      });
      break;

    case 'text-chunk': {
      const t = inbound.get(msg.id);
      if (!t) return;
      t.chunks.push(msg.chunk);
      t.received += msg.chunk.length;
      break;
    }

    case 'text-end': {
      const t = inbound.get(msg.id);
      if (!t) return;
      const text = t.chunks.join('');
      inbound.delete(msg.id);
      addTextCard({
        from: t.from, text, lang: t.lang, outgoing: false,
      });
      break;
    }

    /* ---- file ---- */
    case 'file-start':
      inbound.set(msg.id, {
        kind: 'file', total: msg.size, received: 0,
        chunks: [],
        meta: { name: msg.name, size: msg.size, mime: msg.mime },
        from: state.devices.get(conn.peer) || { name: conn.peer },
        card: addFileProgressCard({
          from: state.devices.get(conn.peer) || { name: conn.peer },
          file: { name: msg.name, size: msg.size, mime: msg.mime },
          outgoing: false,
        }),
      });
      break;

    case 'file-chunk': {
      const t = inbound.get(msg.id);
      if (!t) return;
      const buf = msg.chunk instanceof ArrayBuffer
        ? msg.chunk
        : (msg.chunk.buffer || new Uint8Array(msg.chunk).buffer);
      t.chunks.push(buf);
      t.received += buf.byteLength;
      updateFileProgress(t.card, t.received / t.total);
      break;
    }

    case 'file-end': {
      const t = inbound.get(msg.id);
      if (!t) return;
      inbound.delete(msg.id);
      const blob = new Blob(t.chunks, { type: t.meta.mime || 'application/octet-stream' });
      finishFileCard(t.card, {
        name: t.meta.name, size: t.meta.size, mime: t.meta.mime, blob,
      });
      break;
    }
  }
}

/* ============================================================
   SENDING
   ============================================================ */

function ensureConn(peerId) {
  return new Promise((resolve, reject) => {
    const existing = state.conns.get(peerId);
    if (existing && existing.open) return resolve(existing);

    const conn = state.peer.connect(peerId, {
      reliable: true, serialization: 'binary',
      metadata: { name: state.myName, code: state.myCode },
    });
    const to = setTimeout(() => { try { conn.close(); } catch {}; reject(new Error('timeout')); }, 8000);
    conn.once('open', () => {
      clearTimeout(to);
      state.conns.set(peerId, conn);
      wireDataConn(conn);
      startHeartbeat(conn);
      resolve(conn);
    });
    conn.once('error', (e) => { clearTimeout(to); reject(e); });
  });
}

async function sendText() {
  const text = $('#text-input').value;
  if (!text.length) return toast('Nothing to send');
  if (!state.target) return toast('Pick a device first');
  if (!state.peer) return toast('Not connected');

  const lang = $('#lang-select').value;
  const langVal = lang === 'auto' ? null : lang;

  let conn;
  try { conn = await ensureConn(state.target); }
  catch { return toast('Could not reach device'); }

  const target = state.devices.get(state.target);

  try {
    if (text.length <= 128 * 1024) {
      conn.send({ t: 'text', text, lang: langVal });
    } else {
      const id = crypto.randomUUID();
      conn.send({ t: 'text-start', id, size: text.length, lang: langVal });
      // chunk by characters (approx; UTF-8 handled transparently)
      const step = 64 * 1024;
      for (let i = 0; i < text.length; i += step) {
        conn.send({ t: 'text-chunk', id, chunk: text.slice(i, i + step) });
      }
      conn.send({ t: 'text-end', id });
    }
    addTextCard({
      from: { name: `You → ${target?.name || ''}` },
      text, lang: langVal, outgoing: true,
    });
    toast('Sent');
  } catch (e) {
    toast('Send failed');
  }
}

function waitForBuffer(conn) {
  return new Promise((resolve) => {
    const dc = conn.dataChannel || (conn._dc);
    const check = () => {
      const buffered = dc?.bufferedAmount ?? 0;
      if (buffered <= BUFFER_LOW) return resolve();
      setTimeout(check, 30);
    };
    check();
  });
}

async function sendFile(file) {
  if (!state.target) { toast('Pick a device first'); return; }

  const conn = await ensureConn(state.target).catch(() => null);
  if (!conn) { toast('Could not reach device'); return; }

  const target = state.devices.get(state.target);
  const id = crypto.randomUUID();

  const card = addFileProgressCard({
    from: { name: `You → ${target?.name || ''}` },
    file: { name: file.name, size: file.size, mime: file.type || 'application/octet-stream' },
    outgoing: true,
  });

  const queueItem = document.createElement('li');
  queueItem.innerHTML = `
    <span style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;
                 white-space:nowrap">${esc(file.name)}</span>
    <span class="muted small" style="white-space:nowrap">${fmtBytes(file.size)}</span>
    <span class="bar"><i></i></span>
    <span class="pct muted small" style="width:44px;text-align:right">0%</span>`;
  $('#queue').appendChild(queueItem);
  const qBar = queueItem.querySelector('.bar i');
  const qPct = queueItem.querySelector('.pct');

  try {
    conn.send({
      t: 'file-start', id,
      name: file.name, size: file.size,
      mime: file.type || 'application/octet-stream',
    });

    let sent = 0;
    const reader = file.stream().getReader();
    let carry = new Uint8Array(0);

    // read → chunk → send
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // combine carry + new value, then slice into CHUNK_SIZE
      let buf;
      if (carry.length) {
        buf = new Uint8Array(carry.length + value.length);
        buf.set(carry, 0);
        buf.set(value, carry.length);
      } else {
        buf = value;
      }
      let off = 0;
      while (off < buf.length) {
        const end = Math.min(off + CHUNK_SIZE, buf.length);
        const slice = buf.slice(off, end);
        conn.send({ t: 'file-chunk', id, chunk: slice.buffer });
        sent += slice.byteLength;
        off = end;

        // update UI
        const pct = sent / file.size;
        qBar.style.width = (pct * 100).toFixed(1) + '%';
        qPct.textContent = Math.round(pct * 100) + '%';
        updateFileProgress(card, pct);

        // flow control
        const dc = conn.dataChannel || conn._dc;
        if (dc && dc.bufferedAmount > BUFFER_HIGH) await waitForBuffer(conn);
      }
      carry = new Uint8Array(0); // all consumed
    }

    // flush small carry (should be empty in this scheme)
    conn.send({ t: 'file-end', id });
    finishFileCard(card, { name: file.name, size: file.size, outgoing: true });
    qBar.style.width = '100%';
    qPct.textContent = '✓';
    setTimeout(() => queueItem.remove(), 900);
    toast(`Sent ${file.name}`);
  } catch (e) {
    qPct.textContent = '✕';
    qPct.style.color = 'var(--err)';
    updateFileProgress(card, 0, 'failed');
    toast(`Failed: ${file.name}`);
  }
}

/* ============================================================
   RENDERING
   ============================================================ */

function renderDevices() {
  const list = $('#device-list');
  const all = [...state.devices.values()];
  const others = all.filter(d => d.id !== state.myId);
  $('#dev-count').textContent = others.length ? `(${others.length})` : '';

  list.innerHTML = '';

  // self row
  const selfLi = document.createElement('li');
  selfLi.className = 'self-item';
  selfLi.innerHTML = `
    <div class="avatar">${esc(avatarFor(state.myId || 'me'))}</div>
    <div class="meta">
      <div class="nm">${esc(state.myName)} <span class="muted small">(you)</span></div>
      <div class="sub">${state.role === 'host' ? 'host' : 'guest'} · ${esc(state.myCode)}</div>
    </div>`;
  list.appendChild(selfLi);

  if (!others.length) {
    const li = document.createElement('li');
    li.className = 'loading';
    li.textContent = 'Waiting for other devices…';
    list.appendChild(li);
    return;
  }

  for (const d of others) {
    const li = document.createElement('li');
    if (d.id === state.target) li.classList.add('active');
    li.innerHTML = `
      <div class="avatar">${esc(d.avatar || avatarFor(d.id))}</div>
      <div class="meta">
        <div class="nm">${esc(d.name)}</div>
        <div class="sub">code ${esc(d.code || '------')}</div>
      </div>`;
    li.onclick = () => {
      state.target = d.id;
      renderDevices();
      toast(`Target: ${d.name}`);
    };
    list.appendChild(li);
  }
}

/* ---------- text card ---------- */
function addTextCard({ from, text, lang, outgoing }) {
  removeEmpty();
  const card = document.createElement('div');
  card.className = 'card' + (outgoing ? ' out' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <span class="who ${outgoing ? 'out' : ''}">${esc(from?.name || '?')}</span>
    <span class="time">${timeStr()}</span>
    <span class="spacer"></span>
    <button data-act="copy">Copy</button>
    <button data-act="save">Save</button>
    <button data-act="close">✕</button>`;
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'card-body';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.appendChild(code);
  body.appendChild(pre);
  card.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const size = new Blob([text]).size;
  foot.innerHTML = `
    <span>${text.length.toLocaleString()} chars</span>
    <span>·</span><span>${fmtBytes(size)}</span>
    <span class="spacer" style="flex:1"></span>
    <span class="lang-label"></span>`;
  card.appendChild(foot);

  $('#inbox').prepend(card);

  // async highlight
  const langLabel = foot.querySelector('.lang-label');
  setTimeout(() => {
    const detected = applyHighlight(code, text, lang);
    if (detected === false) {
      pre.outerHTML = `<div class="plain">${esc(text)}</div>`;
      langLabel.innerHTML = '<span class="badge warn">plain</span>';
    } else if (detected === 'skipped') {
      pre.outerHTML = `<div class="plain">${esc(text)}</div>`;
      langLabel.innerHTML =
        `<button class="link small" data-act="hl">highlight ${fmtBytes(size)}?</button>`;
      langLabel.querySelector('[data-act="hl"]').onclick = () => {
        langLabel.textContent = 'highlighting…';
        setTimeout(() => {
          const c2 = document.createElement('code');
          const p2 = document.createElement('pre');
          p2.appendChild(c2);
          const plainEl = card.querySelector('.plain');
          plainEl.replaceWith(p2);
          applyHighlight(c2, text, lang);
          langLabel.textContent = lang || 'auto';
        }, 30);
      };
    } else {
      langLabel.textContent = detected || '';
    }
  }, 0);

  // actions
  head.querySelector('[data-act="copy"]').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      toast('Copied');
    }
  };
  head.querySelector('[data-act="save"]').onclick = () => {
    const ext = langToExt(lang);
    downloadBlob(new Blob([text], { type: 'text/plain' }), `snippet.${ext}`);
  };
  head.querySelector('[data-act="close"]').onclick = () => card.remove();
}

/* ---------- file card ---------- */
function addFileProgressCard({ from, file, outgoing }) {
  removeEmpty();
  const card = document.createElement('div');
  card.className = 'card' + (outgoing ? ' out' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <span class="who ${outgoing ? 'out' : ''}">${esc(from?.name || '?')}</span>
    <span class="time">${timeStr()}</span>
    <span class="spacer"></span>
    <button data-act="close">✕</button>`;
  card.appendChild(head);

  const row = document.createElement('div');
  row.className = 'file-row';
  row.innerHTML = `
    <div class="ico">${fileIcon(file.name, file.mime)}</div>
    <div class="meta">
      <div class="nm">${esc(file.name)}</div>
      <div class="muted small">${fmtBytes(file.size)} · ${esc(file.mime)}</div>
      <div class="progress-mini"><i></i></div>
    </div>
    <div class="muted small" style="min-width:52px;text-align:right" data-role="pct">0%</div>`;
  card.appendChild(row);

  head.querySelector('[data-act="close"]').onclick = () => card.remove();
  $('#inbox').prepend(card);
  return card;
}

function updateFileProgress(card, pct, state_ = '') {
  if (!card) return;
  const bar = card.querySelector('.progress-mini i');
  const p = card.querySelector('[data-role="pct"]');
  if (bar) bar.style.width = (pct * 100).toFixed(1) + '%';
  if (p) p.textContent = state_ === 'failed'
    ? '✕'
    : Math.round(pct * 100) + '%';
}

function finishFileCard(card, { name, size, mime, blob, outgoing }) {
  if (!card) return;
  const row = card.querySelector('.file-row');
  if (!row) return;
  const pctEl = row.querySelector('[data-role="pct"]');
  if (pctEl) pctEl.remove();
  const prog = row.querySelector('.progress-mini');
  if (prog) prog.remove();

  if (!outgoing && blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.className = 'dl';
    a.href = url;
    a.download = name;
    a.textContent = 'Download';
    row.appendChild(a);
  } else {
    const s = document.createElement('span');
    s.className = 'muted small';
    s.style.marginLeft = 'auto';
    s.textContent = 'sent';
    row.appendChild(s);
  }
}

function fileIcon(name, mime) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png','jpg','jpeg','gif','webp','svg','bmp','ico','avif'].includes(ext)) return '🖼️';
  if (['mp4','mkv','mov','webm','avi','m4v'].includes(ext)) return '🎬';
  if (['mp3','wav','ogg','flac','m4a','aac'].includes(ext)) return '🎵';
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return '🗜️';
  if (['pdf'].includes(ext)) return '📕';
  if (['js','mjs','cjs','ts','tsx','jsx'].includes(ext)) return '🟨';
  if (['py','pyw'].includes(ext)) return '🐍';
  if (['html','htm','xml','vue','svelte'].includes(ext)) return '🌐';
  if (['css','scss','less','sass'].includes(ext)) return '🎨';
  if (['json','yaml','yml','toml','ini','env'].includes(ext)) return '⚙️';
  if (['md','txt','rst','log'].includes(ext)) return '📄';
  if (['sh','bash','zsh','ps1','bat'].includes(ext)) return '⌨️';
  if ((mime || '').startsWith('text/')) return '📄';
  return '📦';
}

function removeEmpty() {
  const e = $('#inbox .empty');
  if (e) e.remove();
}

/* ============================================================
   HIGHLIGHT
   ============================================================ */

const EXT_LANG = {
  js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript',
  ts:'typescript', tsx:'typescript', py:'python', pyw:'python',
  rb:'ruby', go:'go', rs:'rust', java:'java', kt:'kotlin', kts:'kotlin',
  c:'c', h:'c', cpp:'cpp', cc:'cpp', cxx:'cpp', hpp:'cpp', cs:'csharp',
  php:'php', swift:'swift', m:'objectivec', mm:'objectivec',
  sh:'bash', bash:'bash', zsh:'bash', fish:'bash', ps1:'powershell',
  html:'xml', htm:'xml', xml:'xml', svg:'xml', vue:'xml',
  css:'css', scss:'scss', sass:'scss', less:'less',
  json:'json', jsonc:'json', yaml:'yaml', yml:'yaml', toml:'ini', ini:'ini',
  md:'markdown', markdown:'markdown', rst:'markdown',
  sql:'sql', graphql:'graphql', gql:'graphql',
  dockerfile:'dockerfile', makefile:'makefile', cmake:'cmake',
  lua:'lua', pl:'perl', r:'r', dart:'dart', scala:'scala',
  hs:'haskell', clj:'clojure', ex:'elixir', exs:'elixir', erl:'erlang',
  txt:'plaintext', log:'plaintext', csv:'plaintext', env:'bash',
  lock:'plaintext', gitignore:'plaintext', diff:'diff', patch:'diff',
};

function applyHighlight(codeEl, text, lang) {
  codeEl.textContent = text;
  if (!window.hljs) return 'plain';

  if (lang && lang !== 'auto' && hljs.getLanguage(lang)) {
    try {
      codeEl.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      codeEl.classList.add('hljs');
      return lang;
    } catch { return false; }
  }
  if (text.length > MAX_HL) return 'skipped';
  try {
    const r = hljs.highlightAuto(text);
    codeEl.innerHTML = r.value;
    codeEl.classList.add('hljs');
    return r.language || 'auto';
  } catch { return false; }
}

function langToExt(lang) {
  const m = {
    javascript:'js', typescript:'ts', python:'py', ruby:'rb', go:'go',
    rust:'rs', java:'java', kotlin:'kt', c:'c', cpp:'cpp', csharp:'cs',
    php:'php', swift:'swift', bash:'sh', powershell:'ps1', xml:'html',
    css:'css', scss:'scss', json:'json', yaml:'yml', ini:'ini',
    markdown:'md', sql:'sql', graphql:'gql', dockerfile:'Dockerfile',
    makefile:'Makefile', lua:'lua', perl:'pl', r:'r', dart:'dart',
    scala:'scala', haskell:'hs', elixir:'ex', plaintext:'txt',
  };
  return m[lang] || 'txt';
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================================================
   UI WIRING
   ============================================================ */

function populateLanguages() {
  const sel = $('#lang-select');
  if (window.hljs) {
    const langs = hljs.listLanguages().sort();
    const frag = document.createDocumentFragment();
    for (const l of langs) {
      const o = document.createElement('option');
      o.value = l; o.textContent = l;
      frag.appendChild(o);
    }
    sel.appendChild(frag);
  } else {
    for (const l of ['javascript','typescript','python','bash','json','yaml',
                     'html','css','sql','go','rust','java','cpp','markdown']) {
      const o = document.createElement('option');
      o.value = l; o.textContent = l;
      sel.appendChild(o);
    }
  }
}

function openRoomModal() {
  const modal = $('#modal');
  $('#modal-title').textContent = 'Change room';
  $('#modal-body').textContent =
    'Everyone who enters the same code sees each other. Share it with your other devices.';
  $('#modal-input').value = state.room;
  modal.classList.remove('hidden');
  setTimeout(() => $('#modal-input').focus(), 30);
}

function closeModal() { $('#modal').classList.add('hidden'); }

function wireUI() {
  // tabs
  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-text').classList.toggle('hidden', t.dataset.tab !== 'text');
    $('#tab-file').classList.toggle('hidden', t.dataset.tab !== 'file');
  });

  // send text
  $('#send-text').onclick = sendText;

  // editor shortcuts + tab insertion + live size
  const ta = $('#text-input');
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault(); sendText();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
  });
  ta.addEventListener('input', () => {
    $('#text-size').textContent =
      `${ta.value.length.toLocaleString()} chars · ${fmtBytes(new Blob([ta.value]).size)}`;
  });

  // file input / dropzone
  const dz = $('#dropzone'), fi = $('#file-input');
  $('#browse-btn').onclick = () => fi.click();
  fi.onchange = () => { if (fi.files.length) [...fi.files].forEach(sendFile); fi.value = ''; };
  ['dragenter','dragover'].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('hover'); }));
  ['dragleave','drop'].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('hover'); }));
  dz.addEventListener('drop', e => {
    if (e.dataTransfer?.files?.length) [...e.dataTransfer.files].forEach(sendFile);
  });

  // paste anywhere
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) if (it.kind === 'file') {
      const f = it.getAsFile(); if (f) files.push(f);
    }
    if (files.length) { e.preventDefault(); files.forEach(sendFile); }
  });

  // clear inbox
  $('#clear-inbox').onclick = () => {
    $('#inbox').innerHTML =
      '<p class="muted empty">Nothing yet. Pick a device and send something.</p>';
  };

  // name change
  const nameInput = $('#me-name');
  nameInput.value = state.myName;
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim().slice(0, 32) || detectName();
    state.myName = v;
    localStorage.setItem('pairhub.name', v);
    if (state.role === 'host') broadcastRoomList();
    if (state.hostConn?.open) {
      try {
        state.hostConn.send({ t: 'join', name: v, code: state.myCode,
                              avatar: avatarFor(state.myId) });
      } catch {}
    }
    toast('Name updated');
  });

  // copy my code
  $('#me-code').textContent = state.myCode;
  $('#me-code').onclick = async () => {
    try { await navigator.clipboard.writeText(state.myCode); toast('Code copied'); }
    catch { toast(state.myCode); }
  };

  // room badge & button
  $('#room-badge').textContent = state.room;
  $('#room-badge').onclick = async () => {
    try { await navigator.clipboard.writeText(state.room);
      toast(`Room "${state.room}" copied`); }
    catch { toast(state.room); }
  };
  $('#room-btn').onclick = openRoomModal;

  // modal
  $('#modal-cancel').onclick = closeModal;
  $('#modal-ok').onclick = async () => {
    const v = $('#modal-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (v.length < 4) { toast('Use at least 4 characters'); return; }
    closeModal();
    saveRoom(v);
    $('#room-badge').textContent = v;
    // clear devices except self
    state.devices.clear();
    state.target = null;
    renderDevices();
    state.reconnectAttempts = 0;
    await joinRoom(v);
    toast(`Joined room ${v}`);
  };
  $('#modal-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#modal-ok').click();
    if (e.key === 'Escape') closeModal();
  });

  // refresh
  $('#refresh-btn').onclick = () => {
    toast('Re-scanning…');
    state.intentionallyClosed = false;
    state.reconnectAttempts = 0;
    joinRoom(state.room);
  };

  // cleanup on unload
  window.addEventListener('beforeunload', () => {
    state.intentionallyClosed = true;
    destroyPeer();
  });

  // wake up when tab returns to foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.peer?.disconnected) {
      try { state.peer.reconnect(); } catch {}
    }
  });
}

/* ============================================================
   BOOT
   ============================================================ */

async function boot() {
  state.myName = detectName();
  populateLanguages();
  wireUI();
  renderDevices();

  if (!window.Peer) {
    setStatus('warn', 'PeerJS failed to load');
    toast('Could not load PeerJS — check network/adblock');
    return;
  }

  await joinRoom(state.room);

  // Final safety net: if for any reason we're offline after 10s, retry.
  setTimeout(() => {
    if (!state.peer || state.peer.destroyed || state.peer.disconnected) {
      scheduleReconnect();
    }
  }, 10000);
}

document.addEventListener('DOMContentLoaded', boot);
})();
