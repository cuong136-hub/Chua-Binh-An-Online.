'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('templeCanvas');
const ctx = canvas.getContext('2d');
const WIDTH = 1120, HEIGHT = 700;
const TAU = Math.PI * 2;
let session = null;
let events = null;
let soundEnabled = false;
let audioContext = null;
let selectedColor = '#69c2ae';
let toastTimer = null;
let incenseBoost = 0;
let blessingBoost = 0;
let bellBoost = 0;
let lastMoveSend = 0;
let lastFrame = 0;
let moveInFlight = false;
let sentAt = 0;
const players = new Map();
const keys = new Set();
const specialEffects = [];
const bloomPoints = [];
const sparkPoints = [];

// Tọa độ hoa và đom đóm tạo bằng số giả ngẫu nhiên cố định để cảnh không nhấp nháy.
function rand(seed) { let n = Math.sin(seed * 127.1 + 38.3) * 43758.5453123; return n - Math.floor(n); }
for (let i = 0; i < 145; i++) {
  const side = i % 2;
  bloomPoints.push({ x: (side ? 947 : 173) + (rand(i + 6) - .5) * 290, y: 195 + (rand(i + 455) - .5) * 240, size: 2.8 + rand(i + 999) * 6, color: i % 3 });
}
for (let i = 0; i < 42; i++) sparkPoints.push({ x: rand(i + 77) * WIDTH, y: 90 + rand(i + 189) * 540, phase: rand(i + 28) * TAU, size: 1 + rand(i + 345) * 2 });

const api = async (endpoint, payload) => {
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let data = {};
  try { data = await res.json(); } catch { /* server unavailable */ }
  if (!res.ok) throw new Error(data.error || 'Không thể kết nối máy chủ. Hãy kiểm tra lại.');
  return data;
};
function notify(text) {
  const el = $('actionToast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
function formError(text) { $('modalError').textContent = text || ''; }
function sessionBody(extra = {}) { return { roomId: session.roomId, playerId: session.playerId, token: session.token, ...extra }; }
function updateCounters(counters) {
  $('incenseCount').textContent = counters.incense || 0;
  $('prayerCount').textContent = counters.prayers || 0;
  $('bellCount').textContent = counters.bells || 0;
}
function setPlayers(next) {
  const received = new Set();
  for (const p of next) {
    received.add(p.id);
    const previous = players.get(p.id);
    players.set(p.id, { ...p, rx: previous?.rx ?? p.x, ry: previous?.ry ?? p.y });
  }
  for (const id of players.keys()) if (!received.has(id)) players.delete(id);
  $('onlineCount').textContent = next.length;
  $('chatOnline').textContent = `${next.length} người`;
  const visitorsRow = $('visitorsRow'); visitorsRow.replaceChildren();
  if (!next.length) { const span = document.createElement('span'); span.className = 'waiting-visitors'; span.textContent = 'Chưa có ai trong phòng.'; visitorsRow.append(span); }
  for (const p of next) {
    const bubble = document.createElement('span');
    bubble.className = 'visitor'; bubble.textContent = p.name[0]?.toLocaleUpperCase('vi') || '?';
    bubble.title = p.name + (p.id === session?.playerId ? ' (bạn)' : '');
    bubble.style.backgroundColor = p.color;
    bubble.style.color = '#102b25';
    visitorsRow.append(bubble);
  }
}
function formatTime(ms) { return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function appendMessage(message) {
  const list = $('chatList');
  list.querySelector('.chat-empty')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'message' + (message.type === 'system' ? ' system' : '');
  if (message.type === 'system') {
    wrap.textContent = '✦ ' + message.text;
  } else {
    const top = document.createElement('div'); top.className = 'message-top';
    const sender = document.createElement('span'); sender.className = 'message-name'; sender.textContent = message.sender; sender.style.color = message.color || '#e5c481';
    const time = document.createElement('span'); time.className = 'message-time'; time.textContent = formatTime(message.time);
    const content = document.createElement('p'); content.className = 'message-text'; content.textContent = message.text;
    top.append(sender, time); wrap.append(top, content);
  }
  list.append(wrap);
  while (list.children.length > 75) list.firstElementChild.remove();
  list.scrollTop = list.scrollHeight;
}
function connectEvents() {
  events?.close();
  const params = new URLSearchParams({ roomId: session.roomId, playerId: session.playerId, token: session.token });
  events = new EventSource('/api/events?' + params);
  events.addEventListener('snapshot', ({ data }) => {
    const s = JSON.parse(data);
    setPlayers(s.players); updateCounters(s.counters);
    $('chatList').replaceChildren();
    for (const m of s.history) appendMessage(m);
    $('gameStatus').textContent = 'Đã kết nối · mọi người đang ở cùng một sân chùa';
  });
  events.addEventListener('presence', ({ data }) => { const s = JSON.parse(data); setPlayers(s.players); updateCounters(s.counters); });
  events.addEventListener('movement', ({ data }) => {
    const p = JSON.parse(data); const target = players.get(p.id);
    if (target) { target.x = p.x; target.y = p.y; }
  });
  events.addEventListener('chat', ({ data }) => appendMessage(JSON.parse(data)));
  events.addEventListener('ritual', ({ data }) => {
    const r = JSON.parse(data); updateCounters(r.counters);
    const now = performance.now();
    if (r.ritual === 'incense') {
      incenseBoost = now + 4500;
      for (let i = 0; i < 18; i++) specialEffects.push({ type: 'incense', x: 545 + rand(now + i) * 30, y: 410, start: now - i * 65, duration: 2300, seed: i });
    }
    if (r.ritual === 'prayer') {
      blessingBoost = now + 2500;
      for (let i = 0; i < 28; i++) specialEffects.push({ type: 'blessing', x: r.x, y: r.y - 24, start: now - i * 28, duration: 1450, seed: i });
    }
    if (r.ritual === 'bell') { bellBoost = now + 2200; if (soundEnabled) playBell(); }
  });
  events.onerror = () => { $('gameStatus').textContent = 'Đang nối lại kết nối…'; };
}
function enterRoom(data) {
  session = data;
  sessionStorage.setItem('chua-session', JSON.stringify(data));
  $('welcomeModal').hidden = true;
  $('gameActions').hidden = false;
  $('touchControls').hidden = false;
  $('roomChip').hidden = false;
  $('roomIdTop').textContent = data.roomId;
  $('roomIdSide').textContent = data.roomId;
  $('inviteButton').disabled = false;
  $('leaveButton').disabled = false;
  $('chatInput').disabled = false;
  $('sendButton').disabled = false;
  $('gameStatus').textContent = 'Đang kết nối với bạn bè…';
  connectEvents();
  notify('Chào mừng đến Chùa Bình An, ' + data.name + '!');
}
async function joinOrCreate(mode) {
  const name = $('nameInput').value.trim() || 'Khách ghé chùa';
  const id = $('joinInput').value.trim().toUpperCase();
  if (mode === 'join' && !/^[A-HJ-NP-Z2-9]{6}$/.test(id)) return formError('Mã phòng cần có đúng 6 chữ hoặc số.');
  const createButton = $('createButton'), joinButton = $('joinButton');
  createButton.disabled = joinButton.disabled = true;
  formError('');
  try {
    const data = await api(mode === 'create' ? '/api/create' : '/api/join', { roomId: id, name, color: selectedColor });
    enterRoom(data);
  } catch (e) { formError(e.message); }
  finally { createButton.disabled = joinButton.disabled = false; }
}
$('createButton').addEventListener('click', () => joinOrCreate('create'));
$('joinButton').addEventListener('click', () => joinOrCreate('join'));
$('joinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinOrCreate('join'); });
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinOrCreate('create'); });
$('joinInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('colors').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-color]');
  if (!button) return;
  selectedColor = button.dataset.color;
  $('colors').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b === button));
});
async function copyText(text, success) {
  try {
    await navigator.clipboard.writeText(text);
    notify(success);
  } catch {
    const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
    try { document.execCommand('copy'); notify(success); } catch { notify('Mã phòng: ' + text); }
    input.remove();
  }
}
$('copyRoomButton').addEventListener('click', () => session && copyText(session.roomId, 'Đã sao chép ID phòng ' + session.roomId));
$('inviteButton').addEventListener('click', () => {
  if (!session) return;
  const url = new URL(location.href); url.searchParams.set('room', session.roomId);
  copyText(url.toString(), 'Đã sao chép đường dẫn mời bạn bè!');
});
$('leaveButton').addEventListener('click', async () => {
  if (!session) return;
  const previous = session;
  events?.close(); events = null; session = null;
  sessionStorage.removeItem('chua-session');
  players.clear(); keys.clear();
  $('welcomeModal').hidden = false;
  $('gameActions').hidden = true;
  $('touchControls').hidden = true;
  $('roomChip').hidden = true;
  $('inviteButton').disabled = $('leaveButton').disabled = true;
  $('chatInput').disabled = $('sendButton').disabled = true;
  $('roomIdSide').textContent = 'CHƯA VÀO PHÒNG';
  $('onlineCount').textContent = '0'; $('chatOnline').textContent = '0 người';
  updateCounters({}); $('chatList').replaceChildren();
  const empty = document.createElement('div'); empty.className = 'chat-empty'; empty.textContent = '✦ Hãy vào phòng để trò chuyện.'; $('chatList').append(empty);
  $('visitorsRow').replaceChildren();
  $('joinInput').value = previous.roomId;
  formError('');
  api('/api/leave', { roomId: previous.roomId, playerId: previous.playerId, token: previous.token }).catch(() => {});
});
$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!session) return;
  const input = $('chatInput'); const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try { await api('/api/chat', sessionBody({ text })); }
  catch (e) { notify(e.message); input.value = text; }
});
async function doRitual(ritual) {
  if (!session) return;
  try {
    await api('/api/ritual', sessionBody({ ritual }));
    const messages = { incense: 'Đã dâng một nén hương thơm ♨', prayer: 'Nguyện mọi người luôn bình an ✧', bell: 'Một tiếng chuông ngân vang ♫' };
    notify(messages[ritual]);
  } catch (e) { notify(e.message); }
}
$('incenseButton').addEventListener('click', () => doRitual('incense'));
$('prayButton').addEventListener('click', () => doRitual('prayer'));
$('bellButton').addEventListener('click', () => doRitual('bell'));
$('soundButton').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('soundStatus').textContent = soundEnabled ? 'Bật âm' : 'Tắt nhạc';
  $('soundButton').style.borderColor = soundEnabled ? '#c6ab75' : '';
  if (soundEnabled) playBell();
});
function playBell() {
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    [392, 587.33, 784, 1176.66].forEach((frequency, i) => {
      const osc = audioContext.createOscillator(); const gain = audioContext.createGain();
      osc.type = 'sine'; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(.055 / (i + 1), now + .045); gain.gain.exponentialRampToValueAtTime(.0001, now + 3.9);
      osc.connect(gain).connect(audioContext.destination); osc.start(now); osc.stop(now + 4);
    });
  } catch { /* thiết bị không hỗ trợ âm thanh */ }
}
const params = new URLSearchParams(location.search);
const inviteRoom = params.get('room');
if (inviteRoom) $('joinInput').value = inviteRoom.toUpperCase().slice(0, 6);
try {
  const previous = JSON.parse(sessionStorage.getItem('chua-session') || 'null');
  if (previous && (!inviteRoom || previous.roomId === inviteRoom.toUpperCase())) {
    api('/api/resume', previous).then(enterRoom).catch(() => sessionStorage.removeItem('chua-session'));
  }
} catch { sessionStorage.removeItem('chua-session'); }

// Phím và nút cảm ứng: di chuyển nhân vật trong sân chùa.
window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName) || $('welcomeModal').hidden === false) return;
  const key = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) { keys.add(key); e.preventDefault(); }
  if (key === 'e' && !e.repeat) doRitual('incense');
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
$('touchControls').querySelectorAll('[data-dir]').forEach(button => {
  const mapped = { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' }[button.dataset.dir];
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(mapped); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => keys.delete(mapped));
});

function rect(x, y, w, h, fill, radius = 0) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); }
function ellipse(x, y, rx, ry, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); }
function path(points, color, stroke, width = 1) { ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); if (color) { ctx.fillStyle = color; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } }
function bezierRoof() {
  ctx.beginPath(); ctx.moveTo(213, 225); ctx.quadraticCurveTo(262, 226, 280, 199);
  ctx.quadraticCurveTo(391, 141, 546, 125); ctx.quadraticCurveTo(560, 119, 574, 125);
  ctx.quadraticCurveTo(729, 141, 840, 199); ctx.quadraticCurveTo(858, 226, 907, 225);
  ctx.quadraticCurveTo(870, 258, 800, 222); ctx.quadraticCurveTo(560, 189, 320, 222);
  ctx.quadraticCurveTo(249, 258, 213, 225); ctx.closePath();
}
function drawSky(t) {
  let sky = ctx.createLinearGradient(0,0,0,540);
  sky.addColorStop(0,'#162c3c'); sky.addColorStop(.45,'#66575b'); sky.addColorStop(.73,'#c78b6b'); sky.addColorStop(1,'#65766b');
  ctx.fillStyle = sky; ctx.fillRect(0,0,WIDTH,HEIGHT);
  let light = ctx.createRadialGradient(840,155,30,840,155,430);
  light.addColorStop(0,'rgba(255,205,141,.35)'); light.addColorStop(.45,'rgba(255,169,110,.14)'); light.addColorStop(1,'rgba(255,169,110,0)');
  ctx.fillStyle = light; ctx.fillRect(380,0,740,540);
  ellipse(833, 131, 44, 44, 'rgba(255,225,158,.55)');
  ellipse(833, 131, 29, 29, '#f6d5a0');
  for (let i=0;i<7;i++) {
    const x = (i*206 - (t*.004) % 1300 + 1500) % 1300 - 150;
    const y = 92 + (i % 3) * 53;
    ellipse(x,y,80,9,'rgba(244,214,184,.075)');ellipse(x+35,y-8,56,13,'rgba(247,222,195,.065)');
  }
  path([[0,288],[80,214],[165,260],[262,176],[350,264],[457,216],[538,284],[655,204],[770,284],[865,198],[980,256],[1090,214],[1120,249],[1120,430],[0,430]],'#586365');
  path([[0,320],[115,264],[222,310],[332,247],[435,321],[578,271],[710,327],[849,270],[970,327],[1120,274],[1120,435],[0,435]],'#3f5e5c');
  let mist = ctx.createLinearGradient(0,250,0,470);mist.addColorStop(0,'rgba(249,211,176,0)');mist.addColorStop(.5,'rgba(236,202,166,.22)');mist.addColorStop(1,'rgba(180,179,140,0)');
  ctx.fillStyle = mist;ctx.fillRect(0,220,1120,250);
}
function drawCourtyard() {
  let ground = ctx.createLinearGradient(0,370,0,700);
  ground.addColorStop(0,'#47655b'); ground.addColorStop(.4,'#5a7261'); ground.addColorStop(1,'#27463f');
  rect(0,369,WIDTH,331,ground);
  for(let i=0;i<14;i++){
    const x = i*91-15;
    path([[x,390],[x+53,398],[x+95,700],[x+6,700]],i%2?'rgba(215,202,160,.018)':'rgba(10,37,34,.06)');
  }
  path([[470,372],[650,372],[815,700],[305,700]],'#827e70');
  path([[483,372],[637,372],[770,700],[349,700]],'#a49c83');
  for (let i=0;i<8;i++) {
    const y = 394 + i*i*4.9;
    const ratio = (y - 360) / 340;
    const x1=490-145*ratio, x2=630+145*ratio;
    ctx.strokeStyle='rgba(63,77,70,.35)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();
  }
  for (let i=0;i<12;i++) {
    const y=405+i*25.8;
    const spread=(y-360)/340;
    for (let j=-2;j<=2;j++){
      const x=560+j*(30+spread*32)+(i%2?12:0);
      path([[x-16,y],[x+14,y+2],[x+22,y+12],[x-15,y+10]],'rgba(220,207,163,.045)');
    }
  }
  // Thảm cỏ và lối đi hai bên
  for (let i=0;i<70;i++) {
    const x=rand(i+19)*1120,y=405+rand(i+99)*310;
    if(x>380 && x<740 && y>460)continue;
    ctx.strokeStyle=i%4?'rgba(135,166,111,.37)':'rgba(231,209,136,.35)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-2,y-6);ctx.moveTo(x,y);ctx.lineTo(x+3,y-8);ctx.stroke();
  }
}
function drawTemple(t) {
  ellipse(560,397,382,33,'rgba(16,29,29,.40)');
  // Các bậc thềm đá
  rect(232,358,656,40,'#746858',5);rect(211,381,697,20,'#807568',3);
  rect(210,395,700,9,'#b5a27c',3);rect(240,356,640,5,'#c6aa75');
  // Khung nhà bằng gỗ sẫm
  let wall = ctx.createLinearGradient(0,195,0,374);wall.addColorStop(0,'#a66e4d');wall.addColorStop(.4,'#784c43');wall.addColorStop(1,'#5b3c35');
  rect(280,205,560,165,wall);rect(280,212,560,10,'#dcaa70');
  for(let i=0;i<17;i++){const x=287+i*32;ctx.strokeStyle='rgba(250,188,112,.11)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,220);ctx.lineTo(x,360);ctx.stroke();}
  // Cửa điện thờ với quầng sáng
  let inside=ctx.createRadialGradient(560,286,20,560,290,190);
  inside.addColorStop(0,'#836946');inside.addColorStop(.33,'#483c38');inside.addColorStop(1,'#211f25');
  rect(431,213,258,158,inside);
  let glow=ctx.createRadialGradient(560,283,4,560,283,140);
  glow.addColorStop(0,'rgba(251,207,115,.46)');glow.addColorStop(1,'rgba(250,185,100,0)');
  rect(432,214,256,156,glow);
  rect(426,216,10,158,'#d1a168');rect(684,216,10,158,'#a7744d');
  // Hai dãy cửa gỗ và chữ trang trí
  for (const x of [318,748]) {
    rect(x,239,53,116,'#6e3d36',3);rect(x+7,245,39,105,'#8b5941',2);
    for(let j=0;j<4;j++){rect(x+12,254+j*22,29,2,'rgba(231,176,100,.6)');}
  }
  for (const x of [377,710]) {rect(x,235,13,128,'#5b3d37');rect(x+5,237,3,125,'#d69b60');}
  // Bức phù điêu tròn hai bên
  for (const x of [401,720]) {
    ellipse(x,277,23,23,'#a87549');ellipse(x,277,19,19,'#674935');
    ctx.strokeStyle='#d7ac74';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,277,12,0,TAU);ctx.stroke();
    ellipse(x,277,4,4,'#e6b97f');
  }
  // Bốn cột chính
  for (const x of [286,373,734,821]){
    rect(x-12,218,24,150,'#5b3435',6);rect(x-6,219,9,148,'#a66b53',4);
    rect(x-18,217,36,11,'#d0a26d',3);rect(x-17,357,34,11,'#aa764d',3);
    rect(x-11,226,22,5,'#bc8d59');
  }
  // Mái chùa cong đỏ và những đường ngói
  ctx.save(); ctx.shadowColor='rgba(31,27,35,.55)';ctx.shadowBlur=18;ctx.shadowOffsetY=12;
  bezierRoof();ctx.fillStyle='#562f37';ctx.fill();ctx.restore();
  bezierRoof();
  let roof=ctx.createLinearGradient(0,125,0,240);roof.addColorStop(0,'#ad5950');roof.addColorStop(.45,'#87413e');roof.addColorStop(1,'#4b2b35');
  ctx.fillStyle=roof;ctx.fill();ctx.strokeStyle='#e8ba77';ctx.lineWidth=4;ctx.stroke();
  // Vân ngói có đường chạy xiên
  ctx.save();bezierRoof();ctx.clip();
  for(let i=-15;i<=15;i++) {
    const x=560+i*29;
    ctx.beginPath();ctx.moveTo(560+(x-560)*.47,117);ctx.lineTo(x,244);
    ctx.strokeStyle='rgba(252,192,122,.17)';ctx.lineWidth=3;ctx.stroke();
  }
  for(let y=164;y<230;y+=15){ctx.beginPath();ctx.moveTo(225,y);ctx.lineTo(900,y);ctx.strokeStyle='rgba(22,22,30,.20)';ctx.lineWidth=2;ctx.stroke();}
  ctx.restore();
  // Viền đao và chim/long tượng trưng trên nóc
  ctx.strokeStyle='#f5c988';ctx.lineWidth=5;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(213,225);ctx.quadraticCurveTo(234,217,243,188);ctx.moveTo(907,225);ctx.quadraticCurveTo(888,218,877,188);ctx.stroke();
  path([[539,121],[560,96],[581,121]],'#e6b66e','#ffdca2',2);
  ellipse(560,95,6,6,'#ffdfa1');
  // Bảng tên
  rect(466,202,188,35,'#452f2c',5);ctx.strokeStyle='#dfb67c';ctx.lineWidth=2;ctx.strokeRect(472,207,176,25);
  ctx.fillStyle='#ffdfa0';ctx.font='bold 17px Georgia,serif';ctx.textAlign='center';ctx.fillText('CHÙA BÌNH AN',560,226);
  // Lồng đèn dưới mái
  for (const x of [344,776]){
    ctx.strokeStyle='#d1ab74';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,219);ctx.lineTo(x,249);ctx.stroke();
    const pulse=0.8+Math.sin(t*.002+x)*.2;
    ellipse(x,271,16*pulse,20*pulse,'rgba(255,186,85,.13)');
    rect(x-10,250,20,37,'#c67d4b',7);rect(x-8,253,16,30,'#e6af63',5);rect(x-11,250,22,5,'#603d38',2);rect(x-11,282,22,5,'#603d38',2);
    ctx.beginPath();ctx.moveTo(x,286);ctx.lineTo(x,299);ctx.stroke();
  }
  drawBuddha(t);
}
function drawBuddha(t) {
  ctx.save();
  // Vòng hào quang nhẹ phía sau tượng
  let halo=ctx.createRadialGradient(560,279,8,560,283,95);
  halo.addColorStop(0,'rgba(255,231,159,.37)');halo.addColorStop(.55,'rgba(255,192,101,.11)');halo.addColorStop(1,'rgba(255,178,92,0)');
  rect(468,202,184,172,halo);
  ctx.strokeStyle='rgba(253,204,112,.6)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(560,283,57,0,TAU);ctx.stroke();
  ctx.strokeStyle='rgba(236,180,103,.28)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(560,283,68,0,TAU);ctx.stroke();
  // Đài sen
  ellipse(560,357,87,16,'#8b553d');
  for(let i=-4;i<=4;i++){
    const x=560+i*18;
    path([[x-13,357],[x,337-Math.abs(i)*2],[x+13,357],[x,365]],i%2?'#f0b467':'#d89a54','#f7d296',1);
  }
  // Tượng Phật ngồi thiền, trang nghiêm
  ellipse(560,325,59,42,'#d4a45f');
  path([[533,288],[517,307],[513,335],[542,351],[576,352],[609,335],[601,301],[584,286]],'#e7b86d','#ffdc98',2);
  path([[533,289],[520,315],[538,330],[548,347],[563,353],[550,312]],'#bf874e');
  // Áo choàng
  ctx.strokeStyle='#ffdf99';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(583,292);ctx.quadraticCurveTo(548,314,549,346);ctx.stroke();
  // Đầu và búi tóc
  ellipse(560,255,13,11,'#5b433c');
  ellipse(560,276,23,29,'#dfb071');
  ellipse(539,279,5,9,'#dfa66a');ellipse(581,279,5,9,'#dfa66a');
  ellipse(560,249,17,9,'#624a3a');
  // Đôi mắt khép nhẹ
  ctx.strokeStyle='#674a39';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(547,278);ctx.quadraticCurveTo(553,282,558,279);ctx.moveTo(563,279);ctx.quadraticCurveTo(570,282,575,278);ctx.stroke();
  ctx.beginPath();ctx.moveTo(559,289);ctx.quadraticCurveTo(564,293,568,288);ctx.stroke();
  // Bàn tay đặt trước bụng
  ellipse(555,328,11,6,'#f3cc85');ellipse(566,328,11,6,'#f3cc85');
  ellipse(560,352,45,5,'rgba(255,216,121,.25)');
  ctx.restore();
}
function drawGarden(t) {
  // Vườn cây cổ thụ hai bên chùa
  function tree(cx,cy,flip){
    ctx.save();ctx.translate(cx,cy);ctx.scale(flip,1);
    ctx.strokeStyle='#4d3935';ctx.lineCap='round';ctx.lineWidth=19;
    ctx.beginPath();ctx.moveTo(0,205);ctx.bezierCurveTo(-12,115,20,94,3,26);ctx.stroke();
    ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(3,100);ctx.bezierCurveTo(-40,44,-80,50,-125,15);ctx.moveTo(5,88);ctx.bezierCurveTo(42,44,66,27,94,4);ctx.moveTo(4,48);ctx.lineTo(-10,-26);ctx.stroke();
    const clusters=[[-100,13,58,40],[-40,-22,64,40],[24,-11,70,47],[93,15,55,34],[-18,57,65,40]];
    for (let i=0;i<clusters.length;i++) {
      const [x,y,rx,ry]=clusters[i];
      ellipse(x,y,rx,ry,'rgba(60,96,75,.87)');
      ellipse(x-10,y-10,rx*.7,ry*.6,'rgba(95,124,86,.52)');
    }
    ctx.restore();
  }
  tree(138,201,1);tree(982,201,-1);
  // Hoa sáng trên tán cây
  for(let i=0;i<bloomPoints.length;i++){
    const p=bloomPoints[i];
    const c=p.color===0?'rgba(253,191,157,.75)':p.color===1?'rgba(249,214,172,.67)':'rgba(236,154,143,.72)';
    const dy=Math.sin(t*.0014+i)*1.5;
    ellipse(p.x,p.y+dy,p.size,p.size*.83,c);
    if(i%5===0)ellipse(p.x+1,p.y+dy-1,1.2,1.2,'#fff0c6');
  }
  // Hai hồ sen hai bên lối vào
  for(const [cx,cy,scale] of [[160,539,1],[952,545,.9]]){
    ellipse(cx,cy,145*scale,56*scale,'#2a5554');
    ellipse(cx,cy,133*scale,47*scale,'#387476');
    ellipse(cx,cy+6,119*scale,35*scale,'rgba(47,111,110,.8)');
    for(let i=0;i<9;i++){
      const x=cx+(rand(i+cx)*2-1)*110*scale,y=cy+(rand(i+cy)*2-1)*33*scale;
      ellipse(x,y,12*scale,6*scale,'#739b72');
      ctx.strokeStyle='#315c53';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+10,y-3);ctx.stroke();
    }
    for(let i=0;i<4;i++){
      const x=cx+(i-1.5)*43*scale,y=cy+(i%2?8:-10)*scale;
      drawLotus(x,y,scale*.7);
    }
  }
  // Đèn đá sân chùa
  for(const x of [80,1040]){
    rect(x-8,384,16,83,'#a09b80',4);rect(x-17,393,34,8,'#d5c4a0',2);
    path([[x-30,391],[x,371],[x+30,391]],'#a9a08a','#e9ca90',2);
    rect(x-17,395,34,35,'#615c52',5);rect(x-10,400,20,25,'#f1c078',4);
    rect(x-23,429,46,9,'#b6a17d',2);
    ellipse(x,412,25,27,'rgba(249,202,102,.1)');
  }
}
function drawLotus(x,y,s){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);
  ellipse(0,4,19,7,'#648d69');
  for(let i=-2;i<=2;i++) path([[i*5,3],[i*7-8,-9-Math.abs(i)*2],[i*9,-18+Math.abs(i)*5],[i*7+8,-9-Math.abs(i)*2]],i%2?'#f8c6ab':'#f2b3a6','#ffe3b9',.7);
  ellipse(0,-1,4,3,'#f2db8c');ctx.restore();
}
function drawIncense(t){
  // Bàn hương
  ellipse(560,475,72,16,'rgba(35,37,31,.3)');
  path([[517,443],[603,443],[596,467],[524,467]],'#77564b','#dab17e',2);
  rect(532,463,56,11,'#ab8b63',2);rect(529,436,62,9,'#bd9b64',3);
  ellipse(560,437,34,10,'#cfb179');ellipse(560,440,26,7,'#605145');
  // Các que hương luôn cháy nhẹ trên lư
  for (let i=-2;i<=2;i++){
    const x=560+i*9;
    ctx.strokeStyle='#53382d';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x,438);ctx.lineTo(x+i*1.8,398-Math.abs(i)*6);ctx.stroke();
    ellipse(x+i*1.8,398-Math.abs(i)*6,2,3,'#eea971');
  }
  // Khói hương bay liên tục, chuyển động theo thời gian
  const boost=incenseBoost>t?1.85:1;
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let j=0;j<5;j++) {
    const originX=560+(j-2)*9;
    for(let i=0;i<11;i++){
      const z=(t*.017*boost + i*19+j*32)%230;
      const x=originX + Math.sin(z*.043+j*1.5)* (7+z*.14);
      const y=394-z*.77;
      const alpha=(1-z/230)*(.11+.07*Math.sin(i*1.6+j)**2)*boost;
      ellipse(x,y,4+z*.095,5+z*.12,`rgba(228,231,212,${Math.min(.28,alpha)})`);
    }
  }
  ctx.restore();
  // Nén hương sáng trong lư
  ellipse(560,419,3,6,'rgba(255,191,91,.24)');
}
function drawAvatar(p,t){
  const bob=Math.sin(t*.006+p.id.length*7)*1.6;
  const x=p.rx, y=p.ry+bob;
  const mine=p.id===session?.playerId;
  ctx.save();ctx.translate(x,y);
  ellipse(0,4,21,7,'rgba(19,33,33,.29)');
  // Giày
  ellipse(-9,0,9,5,'#3e3d35');ellipse(9,0,9,5,'#3e3d35');
  // Áo dài màu người chơi chọn
  path([[-20,-36],[20,-36],[24,-6],[12,2],[-12,2],[-24,-6]],p.color,'rgba(32,47,42,.55)',2);
  path([[-3,-34],[7,-34],[2,-9],[-5,-7]],'rgba(255,247,217,.22)');
  // Tay áo
  ellipse(-21,-25,9,17,p.color);ellipse(21,-25,9,17,p.color);
  ellipse(-25,-10,7,7,'#eac49a');ellipse(25,-10,7,7,'#eac49a');
  // Mặt
  ellipse(0,-50,18,21,'#f1cd9c');ellipse(0,-65,17,9,'#3d3333');
  path([[-17,-60],[-13,-72],[1,-75],[14,-70],[17,-59],[10,-65],[-4,-64]],'#3d3534');
  ellipse(-6,-49,1.8,2.2,'#40352e');ellipse(7,-49,1.8,2.2,'#40352e');
  ctx.strokeStyle='#86664c';ctx.lineWidth=1.1;ctx.beginPath();ctx.arc(1,-44,4,.1,Math.PI-.1);ctx.stroke();
  if(mine){ctx.strokeStyle='#f9df96';ctx.lineWidth=2;ctx.setLineDash([3,3]);ctx.beginPath();ctx.ellipse(0,2,26,10,0,0,TAU);ctx.stroke();ctx.setLineDash([]);}
  const name=p.name+(mine?' (bạn)':'');
  ctx.font='600 13px "Be Vietnam Pro",sans-serif';
  const labelWidth=Math.min(205,ctx.measureText(name).width+22);
  rect(-labelWidth/2,-103,labelWidth,25,mine?'rgba(63,84,65,.91)':'rgba(17,40,41,.86)',12);
  ctx.fillStyle=mine?'#ffe4a8':'#f9f1df';ctx.textAlign='center';ctx.fillText(name,0,-86);
  ctx.restore();
}
function drawEffects(t) {
  for(let i=specialEffects.length-1;i>=0;i--){
    const effect=specialEffects[i];const u=(t-effect.start)/effect.duration;
    if(u>1){specialEffects.splice(i,1);continue;} if(u<0)continue;
    ctx.save();ctx.globalAlpha=Math.max(0,(1-u)*.8);
    if(effect.type==='blessing'){
      const dx=Math.sin(effect.seed*2.4)*80*u, dy=-95*u-25*Math.sin(u*Math.PI);
      ellipse(effect.x+dx,effect.y+dy,3+(1-u)*5,3+(1-u)*5,effect.seed%2?'#ffe1a0':'#f4fbce');
    } else {
      const dx=Math.sin(u*9+effect.seed)*35*u;
      ellipse(effect.x+dx,effect.y-u*160,6+u*21,7+u*25,'rgba(230,242,222,.46)');
    }
    ctx.restore();
  }
  if(blessingBoost>t){
    ctx.strokeStyle=`rgba(250,224,153,${(blessingBoost-t)/6500})`;
    ctx.lineWidth=3;
    ctx.beginPath();ctx.ellipse(560,266,68+(blessingBoost-t)/170,91+(blessingBoost-t)/170,0,0,TAU);ctx.stroke();
  }
  if(bellBoost>t){
    const age=2200-(bellBoost-t);
    for(let j=0;j<3;j++){
      const r=(age-j*330)*.16;if(r<0)continue;
      ctx.strokeStyle=`rgba(246,214,151,${Math.max(0,1-r/400)*.34})`;
      ctx.lineWidth=2;ctx.beginPath();ctx.arc(856,270,r,0,TAU);ctx.stroke();
    }
  }
}
function drawParticles(t){
  for (let i=0;i<sparkPoints.length;i++) {
    const p=sparkPoints[i];let alpha=.28+Math.sin(t*.001+p.phase)*.23;
    ellipse(p.x+Math.sin(t*.0004+p.phase)*5,p.y+Math.cos(t*.0003+p.phase)*11,p.size,p.size,`rgba(251,222,157,${alpha})`);
  }
  // Cánh hoa rơi mềm nhẹ
  for(let i=0;i<18;i++){
    const x=(rand(i+61)*1120+Math.sin(t*.0009+i)*28+1120)%1120;
    const y=(rand(i+145)*700+t*.018*(i%3+1))%700;
    ctx.save();ctx.translate(x,y);ctx.rotate(t*.0004+i);
    ellipse(0,0,4,2.2,'rgba(247,189,161,.55)');ctx.restore();
  }
}
function drawScene(t) {
  ctx.clearRect(0,0,WIDTH,HEIGHT);
  drawSky(t);
  drawCourtyard();
  drawTemple(t);
  drawGarden(t);
  drawIncense(t);
  // Người chơi được vẽ theo chiều sâu (thấp hơn sẽ đứng phía trước)
  for(const p of [...players.values()].sort((a,b)=>a.ry-b.ry)) drawAvatar(p,t);
  drawEffects(t);
  drawParticles(t);
  // Khung phủ dịu ở bốn góc
  const vignette=ctx.createRadialGradient(560,325,210,560,350,750);
  vignette.addColorStop(0,'rgba(15,31,28,0)');vignette.addColorStop(1,'rgba(9,25,23,.35)');
  ctx.fillStyle=vignette;ctx.fillRect(0,0,1120,700);
}
function updateMotion(t,delta){
  for(const p of players.values()) {
    p.rx += (p.x-p.rx)*Math.min(1,delta*.015);
    p.ry += (p.y-p.ry)*Math.min(1,delta*.015);
  }
  if(!session)return;
  const p=players.get(session.playerId);
  if (!p) return;
  let dx=0,dy=0;
  if(keys.has('a')||keys.has('arrowleft'))dx--;
  if(keys.has('d')||keys.has('arrowright'))dx++;
  if(keys.has('w')||keys.has('arrowup'))dy--;
  if(keys.has('s')||keys.has('arrowdown'))dy++;
  if (!dx&&!dy) return;
  const dist=Math.sqrt(dx*dx+dy*dy);
  const speed=0.22*Math.min(delta,50);
  p.x=Math.max(85,Math.min(1035,p.x+dx/dist*speed));
  p.y=Math.max(465,Math.min(645,p.y+dy/dist*speed));
  if(t-lastMoveSend>=130 && !moveInFlight){
    lastMoveSend=t;
    moveInFlight=true;
    api('/api/move', sessionBody({ x: Math.round(p.x), y: Math.round(p.y) }))
      .catch(() => {})
      .finally(()=>{ moveInFlight=false; });
  }
}
function animationFrame(t) {
  const delta=Math.min(50,t-(lastFrame||t));lastFrame=t;
  updateMotion(t,delta);drawScene(t);
  requestAnimationFrame(animationFrame);
}
requestAnimationFrame(animationFrame);
