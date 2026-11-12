const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const MAX_USERS_PER_ROOM = 100;
const MAX_BANDS = 180;
const MAX_MEMORIES = 120;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const rooms = new Map();

function createFreshRoomState() {
  return {
    bands: [],
    memories: [],
    counts: { Joy: 0, Peace: 0, Love: 0, Grief: 0, Passion: 0, Anxiety: 0, Hope: 0 }
  };
}

function getRoomState(roomCode) {
  if (!rooms.has(roomCode)) rooms.set(roomCode, createFreshRoomState());
  return rooms.get(roomCode);
}

function getRoomClientCount(roomCode) {
  const r = io.sockets.adapter.rooms.get(roomCode);
  return r ? r.size : 0;
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join_room', (raw) => {
    const roomCode = String(raw || 'MAIN').trim().toUpperCase().replace(/[^A-Z0-9-_]/g, '').slice(0, 20) || 'MAIN';

    if (currentRoom && currentRoom !== roomCode) {
      const prev = currentRoom;
      socket.leave(prev);
      io.to(prev).emit('online_count', { count: getRoomClientCount(prev), max: MAX_USERS_PER_ROOM });
    }

    const count = getRoomClientCount(roomCode);
    if (currentRoom !== roomCode && count >= MAX_USERS_PER_ROOM) {
      socket.emit('room_full', { message: 'Room "' + roomCode + '" is full (Max 100 people).' });
      return;
    }

    currentRoom = roomCode;
    socket.join(roomCode);

    const st = getRoomState(roomCode);
    const updated = getRoomClientCount(roomCode);

    socket.emit('init_state', {
      roomCode,
      bands: st.bands,
      memories: st.memories,
      counts: st.counts,
      onlineCount: updated,
      maxUsers: MAX_USERS_PER_ROOM
    });

    io.to(roomCode).emit('online_count', { count: updated, max: MAX_USERS_PER_ROOM });
  });

  socket.on('paint_emotion', (p) => {
    if (!currentRoom || !p || !p.emotion || !p.color) return;
    const st = getRoomState(currentRoom);
    const emotion = String(p.emotion).slice(0, 24);
    const color = String(p.color).slice(0, 16);
    if (Object.prototype.hasOwnProperty.call(st.counts, emotion)) st.counts[emotion] += 1;

    const band = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), emotion, color };
    st.bands.push(band);
    if (st.bands.length > MAX_BANDS) st.bands.shift();

    io.to(currentRoom).emit('emotion_painted', { band, counts: st.counts });
  });

  socket.on('add_memory', (p) => {
    if (!currentRoom || !p || typeof p.text !== 'string') return;
    const text = p.text.trim().slice(0, 240);
    if (!text) return;

    const st = getRoomState(currentRoom);
    const emotion = String(p.emotion || 'Hope').slice(0, 24);
    const color = String(p.color || '#38bdf8').slice(0, 16);
    if (Object.prototype.hasOwnProperty.call(st.counts, emotion)) st.counts[emotion] += 1;

    const memory = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      text,
      emotion,
      color,
      laneOffset: (Math.random() * 1.4) - 0.7,
      zPos: 0.15 + Math.random() * 0.72
    };
    const band = { id: memory.id + '-b', emotion, color };

    st.memories.push(memory);
    if (st.memories.length > MAX_MEMORIES) st.memories.shift();
    st.bands.push(band);
    if (st.bands.length > MAX_BANDS) st.bands.shift();

    io.to(currentRoom).emit('memory_added', { memory, band, counts: st.counts });
  });

  socket.on('reset_room', (p) => {
    if (!currentRoom) return;
    const pin = p && p.pin ? String(p.pin).trim() : '';
    if (pin !== ADMIN_PIN) {
      socket.emit('reset_error', 'Incorrect Reset PIN (Default is 1234).');
      return;
    }
    const fresh = createFreshRoomState();
    rooms.set(currentRoom, fresh);
    io.to(currentRoom).emit('room_reset', fresh);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const r = currentRoom;
      setTimeout(() => {
        io.to(r).emit('online_count', { count: getRoomClientCount(r), max: MAX_USERS_PER_ROOM });
      }, 50);
    }
  });
});

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<title>Journeys on the highway</title>
<script src="/socket.io/socket.io.js"></script>
<style>
  :root { --bg:#070b14; --panel:rgba(13,20,36,0.88); --border:rgba(255,255,255,0.15); --text:#f8fafc; }
  * { box-sizing:border-box; margin:0; padding:0; font-family:system-ui,-apple-system,sans-serif; }
  body, html { width:100%; height:100%; overflow:hidden; background:var(--bg); color:var(--text); }
  canvas#highway { position:fixed; inset:0; width:100%; height:100%; display:block; z-index:1; }
  .topbar { position:fixed; top:12px; left:12px; right:12px; z-index:10; display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; pointer-events:none; }
  .card { pointer-events:auto; background:var(--panel); backdrop-filter:blur(12px); border:1px solid var(--border); border-radius:14px; padding:8px 12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .title { font-weight:700; font-size:14px; }
  .pill { font-size:12px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.4); padding:3px 9px; border-radius:99px; cursor:pointer; }
  .live { font-size:12px; color:#34d399; background:rgba(16,185,129,0.15); padding:3px 9px; border-radius:99px; font-weight:600; }
  .btn { background:rgba(255,255,255,0.08); color:var(--text); border:1px solid var(--border); border-radius:10px; padding:7px 11px; font-size:12.5px; font-weight:600; cursor:pointer; }
  .btn-primary { background:#3b82f6; border-color:#60a5fa; color:#fff; }
  .btn-danger { background:rgba(239,68,68,0.2); border-color:rgba(239,68,68,0.5); color:#fca5a5; }
  .spectrum-wrap { position:fixed; top:66px; left:16px; right:16px; z-index:9; pointer-events:none; display:flex; justify-content:center; }
  .spectrum { width:100%; max-width:680px; height:8px; border-radius:99px; background:rgba(255,255,255,0.1); overflow:hidden; display:flex; }
  .seg { height:100%; transition:width 0.3s; }
  .dock { position:fixed; bottom:14px; left:50%; transform:translateX(-50%); z-index:10; width:calc(100% - 24px); max-width:760px; background:var(--panel); backdrop-filter:blur(14px); border:1px solid var(--border); border-radius:18px; padding:12px; display:flex; flex-direction:column; gap:10px; }
  .emos { display:flex; gap:8px; overflow-x:auto; scrollbar-width:none; }
  .emos::-webkit-scrollbar { display:none; }
  .chip { flex:0 0 auto; display:flex; align-items:center; gap:6px; padding:7px 12px; border-radius:99px; cursor:pointer; background:rgba(255,255,255,0.06); border:1px solid var(--border); color:#fff; font-size:13px; font-weight:600; }
  .chip.active { border-color:#fff; background:rgba(255,255,255,0.22); }
  .dot { width:11px; height:11px; border-radius:50%; display:inline-block; }
  .inputs { display:flex; gap:8px; }
  .inputs input { flex:1; background:rgba(0,0,0,0.4); border:1px solid var(--border); border-radius:10px; padding:10px 12px; color:#fff; font-size:14px; outline:none; }
  .modal { position:fixed; inset:0; background:rgba(3,7,18,0.82); backdrop-filter:blur(6px); z-index:30; display:none; align-items:center; justify-content:center; padding:16px; }
  .modal.open { display:flex; }
  .box { width:100%; max-width:390px; background:#0f172a; border:1px solid var(--border); border-radius:18px; padding:20px; text-align:center; }
  .box h2 { font-size:18px; margin-bottom:6px; }
  .box p { font-size:13px; color:#94a3b8; margin-bottom:12px; }
  .inp { width:100%; background:rgba(0,0,0,0.45); border:1px solid var(--border); color:#fff; padding:10px; border-radius:10px; font-size:14px; margin-bottom:12px; text-align:center; }
  .quote { font-size:17px; line-height:1.5; color:#fff; background:rgba(255,255,255,0.06); border-radius:12px; padding:16px; margin:12px 0 16px; word-break:break-word; }
  .actions { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
  #qrImg { background:#fff; padding:10px; border-radius:12px; width:220px; height:220px; margin:0 auto 12px; display:block; }
  #scanVid { width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:12px; background:#000; margin-bottom:10px; border:2px solid #38bdf8; }
</style>
</head>
<body>
<canvas id="highway"></canvas>

<div class="topbar">
  <div class="card">
    <span class="title">Journeys on the highway</span>
    <span class="pill" id="roomBadge">Room: MAIN</span>
    <span class="live" id="onlineCount">1 / 100</span>
  </div>
  <div class="card">
    <button class="btn" id="openRoomBtn">Join Room</button>
    <button class="btn" id="openScanBtn">Scan QR</button>
    <button class="btn btn-primary" id="openQrBtn">Share QR</button>
    <button class="btn btn-danger" id="openResetBtn">Reset</button>
  </div>
</div>

<div class="spectrum-wrap"><div class="spectrum" id="spectrum"></div></div>

<div class="dock">
  <div class="emos" id="emosRow"></div>
  <div class="inputs">
    <button class="btn" id="paintBtn">Paint Road</button>
    <input type="text" id="memInput" maxlength="240" placeholder="Write an anonymous memory and tap Add..." />
    <button class="btn btn-primary" id="addBtn">Add</button>
  </div>
</div>

<div class="modal" id="roomModal">
  <div class="box">
    <h2>Join or Create Room</h2>
    <p>Up to 100 people in the same room share the highway live.</p>
    <input class="inp" id="roomInp" maxlength="20" placeholder="ROOM CODE" style="text-transform:uppercase;font-weight:700;" />
    <p id="roomErr" style="color:#f87171;display:none;"></p>
    <div class="actions">
      <button class="btn btn-primary" id="joinRoomConfirm">Join Room</button>
      <button class="btn" onclick="closeM('roomModal')">Cancel</button>
    </div>
  </div>
</div>

<div class="modal" id="resetModal">
  <div class="box">
    <h2>Clear Highway Memories?</h2>
    <p>This wipes all colors and memories in this room.</p>
    <input type="password" class="inp" id="pinInp" placeholder="Host PIN (default: 1234)" />
    <p id="resetErr" style="color:#f87171;display:none;"></p>
    <div class="actions">
      <button class="btn btn-danger" id="resetConfirm">Reset Now</button>
      <button class="btn" onclick="closeM('resetModal')">Cancel</button>
    </div>
  </div>
</div>

<div class="modal" id="qrModal">
  <div class="box">
    <h2>Journeys on the highway</h2>
    <p>Scan to join Room <strong id="qrRoomLbl" style="color:#38bdf8;">MAIN</strong></p>
    <img id="qrImg" alt="Room QR Code" />
    <input class="inp" id="qrUrlInp" readonly style="font-size:12px;" />
    <div class="actions">
      <button class="btn btn-primary" id="copyBtn">Copy Link</button>
      <button class="btn" onclick="closeM('qrModal')">Close</button>
    </div>
  </div>
</div>

<div class="modal" id="scanModal">
  <div class="box">
    <h2>Scan Room QR</h2>
    <video id="scanVid" playsinline autoplay muted></video>
    <p id="scanStat" style="color:#38bdf8;">Starting camera...</p>
    <div class="actions"><button class="btn" id="closeScanBtn">Close</button></div>
  </div>
</div>

<div class="modal" id="memModal">
  <div class="box">
    <span id="memTag" style="display:inline-block;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700;color:#000;"></span>
    <div class="quote" id="memTxt"></div>
    <button class="btn btn-primary" onclick="closeM('memModal')">Close</button>
  </div>
</div>

<script>
const EMOTIONS = [
  { name:'Joy', color:'#facc15' },
  { name:'Peace', color:'#34d399' },
  { name:'Love', color:'#fb7185' },
  { name:'Hope', color:'#38bdf8' },
  { name:'Passion', color:'#f97316' },
  { name:'Grief', color:'#818cf8' },
  { name:'Anxiety', color:'#c084fc' }
];

let curEmo = EMOTIONS[0];
let activeRoom = (new URLSearchParams(location.search).get('room') || 'MAIN').toUpperCase();
let bands = [], memories = [], counts = {}, pins = [], scroll = 0;

function closeM(id) { document.getElementById(id).classList.remove('open'); }

const emosRow = document.getElementById('emosRow');
EMOTIONS.forEach((e, i) => {
  const b = document.createElement('button');
  b.className = 'chip' + (i === 0 ? ' active' : '');
  b.innerHTML = '<span class="dot" style="background:' + e.color + '"></span>' + e.name;
  b.onclick = () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    curEmo = e;
    socket.emit('paint_emotion', { emotion: e.name, color: e.color });
  };
  emosRow.appendChild(b);
});

const socket = io();
socket.on('connect', () => socket.emit('join_room', activeRoom));

socket.on('init_state', (s) => {
  activeRoom = s.roomCode || activeRoom;
  bands = s.bands || [];
  memories = s.memories || [];
  counts = s.counts || {};
  document.getElementById('roomBadge').textContent = 'Room: ' + activeRoom;
  document.getElementById('onlineCount').textContent = (s.onlineCount || 1) + ' / ' + (s.maxUsers || 100);
  closeM('roomModal');
  const u = new URL(location.href);
  u.searchParams.set('room', activeRoom);
  history.replaceState({}, '', u);
  drawSpectrum();
});

socket.on('online_count', (d) => {
  document.getElementById('onlineCount').textContent = d.count + ' / ' + (d.max || 100);
});

socket.on('room_full', (d) => {
  const el = document.getElementById('roomErr');
  el.textContent = d.message; el.style.display = 'block';
  document.getElementById('roomModal').classList.add('open');
});

socket.on('emotion_painted', (d) => {
  bands.push(d.band); if (bands.length > 180) bands.shift();
  counts = d.counts; drawSpectrum();
});

socket.on('memory_added', (d) => {
  memories.push(d.memory); if (memories.length > 120) memories.shift();
  bands.push(d.band); if (bands.length > 180) bands.shift();
  counts = d.counts; drawSpectrum();
});

socket.on('room_reset', (s) => {
  bands = []; memories = []; counts = s.counts || {};
  drawSpectrum(); closeM('resetModal'); closeM('memModal');
});

socket.on('reset_error', (m) => {
  const el = document.getElementById('resetErr');
  el.textContent = m; el.style.display = 'block';
});

document.getElementById('paintBtn').onclick = () => {
  socket.emit('paint_emotion', { emotion: curEmo.name, color: curEmo.color });
};

function sendMem() {
  const inp = document.getElementById('memInput');
  const txt = inp.value.trim();
  if (!txt) return;
  socket.emit('add_memory', { text: txt, emotion: curEmo.name, color: curEmo.color });
  inp.value = '';
}
document.getElementById('addBtn').onclick = sendMem;
document.getElementById('memInput').onkeydown = (e) => { if (e.key === 'Enter') sendMem(); };

document.getElementById('openRoomBtn').onclick = document.getElementById('roomBadge').onclick = () => {
  document.getElementById('roomInp').value = activeRoom;
  document.getElementById('roomErr').style.display = 'none';
  document.getElementById('roomModal').classList.add('open');
};
document.getElementById('joinRoomConfirm').onclick = () => {
  const c = document.getElementById('roomInp').value.trim();
  if (c) socket.emit('join_room', c);
};

document.getElementById('openResetBtn').onclick = () => {
  document.getElementById('pinInp').value = '';
  document.getElementById('resetErr').style.display = 'none';
  document.getElementById('resetModal').classList.add('open');
};
document.getElementById('resetConfirm').onclick = () => {
  socket.emit('reset_room', { pin: document.getElementById('pinInp').value });
};

document.getElementById('openQrBtn').onclick = () => {
  const u = new URL(location.href);
  u.searchParams.set('room', activeRoom);
  const link = u.toString();
  document.getElementById('qrRoomLbl').textContent = activeRoom;
  document.getElementById('qrUrlInp').value = link;
  document.getElementById('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(link);
  document.getElementById('qrModal').classList.add('open');
};
document.getElementById('copyBtn').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('qrUrlInp').value);
  document.getElementById('copyBtn').textContent = 'Copied!';
  setTimeout(() => document.getElementById('copyBtn').textContent = 'Copy Link', 1500);
};

function drawSpectrum() {
  const bar = document.getElementById('spectrum');
  bar.innerHTML = '';
  const tot = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!tot) return;
  EMOTIONS.forEach(e => {
    const v = counts[e.name] || 0;
    if (v > 0) {
      const d = document.createElement('div');
      d.className = 'seg';
      d.style.width = ((v / tot) * 100) + '%';
      d.style.background = e.color;
      bar.appendChild(d);
    }
  });
}

// Scanner
let stream = null, scanInt = null;
document.getElementById('openScanBtn').onclick = async () => {
  document.getElementById('scanModal').classList.add('open');
  const vid = document.getElementById('scanVid');
  const st = document.getElementById('scanStat');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    vid.srcObject = stream;
    st.textContent = 'Point camera at QR code...';
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      scanInt = setInterval(async () => {
        try {
          const codes = await det.detect(vid);
          if (codes.length && codes[0].rawValue) location.href = codes[0].rawValue;
        } catch (_) {}
      }, 350);
    }
  } catch (_) { st.textContent = 'Camera unavailable. Use your phone camera app.'; }
};
document.getElementById('closeScanBtn').onclick = () => {
  if (scanInt) clearInterval(scanInt);
  if (stream) stream.getTracks().forEach(t => t.stop());
  closeM('scanModal');
};

// Highway + Lush Greenery Canvas
const cvs = document.getElementById('highway');
const ctx = cvs.getContext('2d');
function resize() {
  cvs.width = innerWidth * devicePixelRatio;
  cvs.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener('resize', resize); resize();

const trees = Array.from({ length: 40 }, (_, i) => ({
  side: i % 2 === 0 ? -1 : 1,
  z: i / 40,
  offset: 1.2 + (i % 5) * 0.45,
  scale: 0.75 + (i % 4) * 0.22,
  shade: i % 3
}));

function drawTree(x, y, s, sh) {
  const g1 = ['#065f46', '#047857', '#15803d'][sh];
  const g2 = ['#10b981', '#22c55e', '#4ade80'][sh];
  ctx.fillStyle = '#3f2e21';
  ctx.fillRect(x - s * 0.08, y - s * 0.35, s * 0.16, s * 0.35);
  for (let t = 0; t < 3; t++) {
    const ty = y - s * (0.3 + t * 0.28), tw = s * (0.65 - t * 0.14), th = s * 0.45;
    ctx.beginPath(); ctx.moveTo(x, ty - th); ctx.lineTo(x - tw, ty); ctx.lineTo(x + tw, ty); ctx.closePath();
    ctx.fillStyle = t === 2 ? g2 : g1; ctx.fill();
  }
}

function loop() {
  const w = innerWidth, h = innerHeight, hy = h * 0.42, vx = w * 0.5;
  scroll = (scroll + 0.002) % 1;

  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#050814'); sky.addColorStop(1, '#1e3a5f');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hy);

  const grass = ctx.createLinearGradient(0, hy, 0, h);
  grass.addColorStop(0, '#064e3b'); grass.addColorStop(0.5, '#065f46'); grass.addColorStop(1, '#022c22');
  ctx.fillStyle = grass; ctx.fillRect(0, hy, w, h - hy);

  const rwTop = Math.max(26, w * 0.032), rwBot = Math.min(w * 0.88, 760);
  ctx.beginPath();
  ctx.moveTo(vx - rwTop / 2, hy); ctx.lineTo(vx + rwTop / 2, hy);
  ctx.lineTo(vx + rwBot / 2, h); ctx.lineTo(vx - rwBot / 2, h);
  ctx.closePath(); ctx.fillStyle = '#111827'; ctx.fill();

  if (bands.length) {
    const vis = bands.slice(-90), n = vis.length;
    for (let i = 0; i < n; i++) {
      const p0 = Math.pow(i / n, 1.55), p1 = Math.pow((i + 1) / n, 1.55);
      const y0 = hy + p0 * (h - hy), y1 = hy + p1 * (h - hy);
      const w0 = rwTop + p0 * (rwBot - rwTop), w1 = rwTop + p1 * (rwBot - rwTop);
      ctx.beginPath();
      ctx.moveTo(vx - w0 * 0.47, y0); ctx.lineTo(vx + w0 * 0.47, y0);
      ctx.lineTo(vx + w1 * 0.47, y1); ctx.lineTo(vx - w1 * 0.47, y1);
      ctx.closePath(); ctx.fillStyle = vis[i].color; ctx.globalAlpha = 0.72; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(vx - rwTop / 2, hy); ctx.lineTo(vx - rwBot / 2, h);
  ctx.moveTo(vx + rwTop / 2, hy); ctx.lineTo(vx + rwBot / 2, h);
  ctx.stroke();

  for (let d = 0; d < 14; d++) {
    const r0 = ((d / 14) + scroll) % 1, r1 = Math.min(1, r0 + 0.035);
    const p0 = Math.pow(r0, 1.7), p1 = Math.pow(r1, 1.7);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5 + p0 * 3;
    ctx.beginPath(); ctx.moveTo(vx, hy + p0 * (h - hy)); ctx.lineTo(vx, hy + p1 * (h - hy)); ctx.stroke();
  }

  trees.map(t => ({ ...t, cz: (t.z + scroll) % 1 })).sort((a, b) => a.cz - b.cz).forEach(t => {
    const p = Math.pow(t.cz, 1.65), y = hy + p * (h - hy), rw = rwTop + p * (rwBot - rwTop);
    const x = vx + t.side * (rw * 0.5 + (28 + p * 260) * t.offset);
    drawTree(x, y, (14 + p * 90) * t.scale, t.shade);
  });

  pins = [];
  memories.forEach((m, i) => {
    const bz = m.zPos || ((i * 0.17) % 0.85 + 0.1), p = Math.pow(bz, 1.45);
    const y = hy + p * (h - hy - 95), rw = rwTop + p * (rwBot - rwTop);
    const x = vx + (m.laneOffset || 0) * (rw * 0.36), r = 8 + p * 11;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r * 2.5);
    g.addColorStop(0, m.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    pins.push({ x, y, r: r * 2.2, m });
  });

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

cvs.addEventListener('click', (e) => {
  const rect = cvs.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i];
    if (Math.hypot(mx - p.x, my - p.y) <= p.r + 8) {
      const tag = document.getElementById('memTag');
      tag.textContent = p.m.emotion; tag.style.background = p.m.color;
      document.getElementById('memTxt').textContent = p.m.text;
      document.getElementById('memModal').classList.add('open');
      break;
    }
  }
});
</script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML_PAGE);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Journeys on the highway running on port ' + PORT);
});
// === END OF FILE ===
