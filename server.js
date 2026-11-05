'use strict';

// Node.js thuần: không cần npm install hoặc dịch vụ ngoài.
// Phòng nhiều người chơi đồng bộ qua Server-Sent Events (SSE).
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const MAX_PLAYERS = 16;
const rooms = new Map();

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function cleanText(input, max = 80) {
  return String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function roomId() {
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = Array.from(crypto.randomBytes(6), x => ABC[x % ABC.length]).join(''); } while (rooms.has(id));
  return id;
}
function visiblePlayer(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, color: p.color, joinedAt: p.joinedAt };
}
function snapshot(room) {
  return { roomId: room.id, players: [...room.players.values()].map(visiblePlayer), counters: room.counters, history: room.history };
}
function push(res, event, data) {
  if (!res.writableEnded && !res.destroyed) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* connection closed */ }
  }
}
function broadcast(room, event, data) {
  for (const p of room.players.values()) if (p.stream) push(p.stream, event, data);
}
function announce(room, text) {
  const message = { id: crypto.randomUUID(), type: 'system', text, time: Date.now() };
  room.history.push(message);
  if (room.history.length > 70) room.history.shift();
  broadcast(room, 'chat', message);
}
function presence(room) {
  broadcast(room, 'presence', { players: [...room.players.values()].map(visiblePlayer), counters: room.counters });
}
function getSession(body) {
  const id = cleanText(body.roomId, 8).toUpperCase();
  const room = rooms.get(id);
  const player = room?.players.get(body.playerId);
  if (!room || !player || player.token !== body.token) return null;
  room.lastActive = Date.now();
  return { room, player };
}
function invalid(res) { return json(res, 401, { error: 'Phiên chơi đã hết hạn. Hãy vào phòng lại.' }); }
function addPlayer(room, body) {
  const name = cleanText(body.name, 22) || 'Khách ghé chùa';
  const colors = ['#69c2ae', '#e9a66f', '#a3a0df', '#ef9db0', '#83b6e8', '#c7af69'];
  const color = colors.includes(body.color) ? body.color : colors[room.players.size % colors.length];
  const player = {
    id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), name, color,
    x: 430 + Math.floor(Math.random() * 260), y: 545 + Math.floor(Math.random() * 55),
    joinedAt: Date.now(), stream: null, expireTimer: null, lastMove: 0, lastChat: 0, lastRitual: 0
  };
  room.players.set(player.id, player);
  room.lastActive = Date.now();
  presence(room);
  announce(room, `${player.name} đã bước vào chùa.`);
  return { roomId: room.id, playerId: player.id, token: player.token, name, color, x: player.x, y: player.y };
}
function createRoom() {
  const id = roomId();
  const room = { id, players: new Map(), counters: { incense: 0, prayers: 0, bells: 0 }, history: [], lastActive: Date.now() };
  rooms.set(id, room);
  return room;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) { reject(new Error('Dữ liệu quá dài')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, rooms: rooms.size });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const roomId = url.searchParams.get('roomId') || '';
    const playerId = url.searchParams.get('playerId') || '';
    const token = url.searchParams.get('token') || '';
    const session = getSession({ roomId, playerId, token });
    if (!session) return invalid(res);
    const { room, player } = session;
    if (player.expireTimer) { clearTimeout(player.expireTimer); player.expireTimer = null; }
    if (player.stream && player.stream !== res) { try { player.stream.end(); } catch {} }
    player.stream = res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': ket noi thanh cong\n\n');
    push(res, 'snapshot', snapshot(room));
    req.on('close', () => {
      if (player.stream !== res) return;
      player.stream = null;
      // Cho phép tự kết nối lại nếu mạng chập chờn hoặc người chơi tải lại trang.
      player.expireTimer = setTimeout(() => {
        if (player.stream) return;
        room.players.delete(player.id);
        presence(room);
        announce(room, `${player.name} đã rời chùa.`);
        room.lastActive = Date.now();
      }, 20000);
      player.expireTimer.unref();
    });
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Phương thức không hỗ trợ.' });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'Dữ liệu gửi lên không hợp lệ.' }); }

  if (url.pathname === '/api/create') {
    if (rooms.size >= 500) return json(res, 503, { error: 'Máy chủ đang đầy, thử lại sau.' });
    return json(res, 200, addPlayer(createRoom(), body));
  }
  if (url.pathname === '/api/join') {
    const id = cleanText(body.roomId, 8).toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(id)) return json(res, 400, { error: 'Mã phòng gồm 6 ký tự chữ hoặc số.' });
    const room = rooms.get(id);
    if (!room) return json(res, 404, { error: 'Không tìm thấy phòng. Kiểm tra ID hoặc phòng đã hết hạn.' });
    if (room.players.size >= MAX_PLAYERS) return json(res, 409, { error: 'Phòng đã đủ 16 người.' });
    return json(res, 200, addPlayer(room, body));
  }
  if (url.pathname === '/api/resume') {
    const session = getSession(body);
    if (!session) return invalid(res);
    const { player, room } = session;
    if (player.expireTimer) { clearTimeout(player.expireTimer); player.expireTimer = null; }
    return json(res, 200, { roomId: room.id, playerId: player.id, token: player.token, name: player.name, color: player.color, x: player.x, y: player.y });
  }

  const session = getSession(body);
  if (!session) return invalid(res);
  const { room, player } = session;
  if (url.pathname === '/api/leave') {
    room.players.delete(player.id);
    const stream = player.stream;
    player.stream = null;
    if (stream) { try { stream.end(); } catch {} }
    if (player.expireTimer) clearTimeout(player.expireTimer);
    presence(room);
    announce(room, `${player.name} đã rời chùa.`);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/move') {
    const now = Date.now();
    if (now - player.lastMove < 60) return json(res, 200, { ok: true });
    player.lastMove = now;
    const x = Number(body.x), y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return json(res, 400, { error: 'Vị trí không hợp lệ.' });
    // Giữ nhân vật trong phần sân có thể di chuyển.
    player.x = Math.max(85, Math.min(1035, x));
    player.y = Math.max(465, Math.min(645, y));
    broadcast(room, 'movement', { id: player.id, x: player.x, y: player.y });
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/chat') {
    const now = Date.now();
    if (now - player.lastChat < 900) return json(res, 429, { error: 'Bạn gửi tin nhắn quá nhanh.' });
    const text = cleanText(body.text, 170);
    if (!text) return json(res, 400, { error: 'Vui lòng nhập lời nhắn.' });
    player.lastChat = now;
    const message = { id: crypto.randomUUID(), type: 'user', senderId: player.id, sender: player.name, color: player.color, text, time: now };
    room.history.push(message);
    if (room.history.length > 70) room.history.shift();
    broadcast(room, 'chat', message);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/ritual') {
    const ritual = cleanText(body.ritual, 16);
    const labels = { incense: 'thắp một nén hương', prayer: 'cầu bình an', bell: 'thỉnh một tiếng chuông' };
    if (!labels[ritual]) return json(res, 400, { error: 'Hoạt động không hợp lệ.' });
    if (Date.now() - player.lastRitual < 1700) return json(res, 429, { error: 'Hãy thực hiện chậm rãi một chút.' });
    player.lastRitual = Date.now();
    if (ritual === 'incense') room.counters.incense++;
    if (ritual === 'prayer') room.counters.prayers++;
    if (ritual === 'bell') room.counters.bells++;
    broadcast(room, 'ritual', { ritual, name: player.name, playerId: player.id, x: player.x, y: player.y, counters: room.counters, time: Date.now() });
    announce(room, `${player.name} đã ${labels[ritual]}.`);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Không tìm thấy chức năng.' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Không hỗ trợ.' });
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'Không cho phép.' });
    let content;
    try { content = await fs.readFile(file); } catch { return json(res, 404, { error: 'Không tìm thấy trang.' }); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Lỗi máy chủ.' });
    else res.end();
  }
});

const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    for (const player of room.players.values()) if (player.stream) {
      try { player.stream.write(': ping\n\n'); } catch {}
    }
    if (room.players.size === 0 && now - room.lastActive > 1000 * 60 * 10) rooms.delete(id);
  }
}, 25000);
heartbeat.unref();
server.listen(PORT, HOST, () => console.log(`Chùa Bình An đang chạy tại http://localhost:${PORT}`));
