// All UI logic for the tier list renderer process
const COLORS = ['#c0392b','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#e91e63','#607d8b','#795548'];

let S = { tiers:[], queue:[], currentIdx:-1, nextTierId:10 };
let allImgs = [];
const imgCache = {}; // filename -> data URL

let debugPaths = {};

async function init() {
  debugPaths = await window.api.getPaths();
  const d = await window.api.getState();
  allImgs = d.images;
  S = d.state;
  // Preload thumbnails for queue
  await preloadVisible();
  render();

  // Listen for folder changes
  window.api.onImagesChanged(() => {
    document.getElementById('changed-bar').style.display = 'block';
  });
}

async function preloadVisible() {
  // Load current card + first few queue items
  const toLoad = [curFile(), ...S.queue.slice(S.currentIdx + 1, S.currentIdx + 6)].filter(Boolean);
  await Promise.all(toLoad.map(loadImg));
}

async function loadImg(fn) {
  if (!fn || imgCache[fn]) return;
  const src = await window.api.readImage(fn);
  if (src) imgCache[fn] = src;
}

async function reloadImages() {
  const d = await window.api.getState();
  allImgs = d.images;
  S = d.state;
  // Clear cache for removed files
  Object.keys(imgCache).forEach(k => { if (!allImgs.includes(k)) delete imgCache[k]; });
  await preloadVisible();
  document.getElementById('changed-bar').style.display = 'none';
  render();
  toast('Images reloaded');
}

async function save() {
  await window.api.saveState(S);
}

// ── State helpers ───────────────────────────────────────────────────────────
function curFile() {
  return (S.currentIdx >= 0 && S.currentIdx < S.queue.length) ? S.queue[S.currentIdx] : null;
}
function isPlaced(fn) { return S.tiers.some(t => t.images.includes(fn)); }
function placedCount() { return S.tiers.reduce((n, t) => n + t.images.length, 0); }
function stemName(fn) { return fn.replace(/\.[^.]+$/, ''); }
function textCol(hex) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return (0.299*r + 0.587*g + 0.114*b)/255 > 0.5 ? '#111' : '#fff';
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  renderCard();
  renderProgress();
  renderQueue();
  renderTiers();
  updateNxtBtn();
  document.getElementById('hinfo').textContent =
    allImgs.length ? `${placedCount()} of ${allImgs.length} placed` : '';
}

function renderCard() {
  const wrap = document.getElementById('curwrap');
  const hint = document.getElementById('shint');
  const fn   = curFile();

  if (!fn) {
    wrap.innerHTML = `<div class="empty-stage">${
      !allImgs.length
        ? `Drop images into:<br><b style="font-size:9px;word-break:break-all">${esc(debugPaths.images || 'images/')}</b><br><br>then click 🔄 Reload`
        : 'All images shown!<br>Click <b>Finish ✓</b>'
    }</div>`;
    hint.textContent = '';
    return;
  }

  const src  = imgCache[fn] || '';
  const name = stemName(fn);
  wrap.innerHTML = `<div class="cur-card" id="cc" draggable="true">
    ${src ? `<img src="${src}" alt="${esc(name)}">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:11px">${esc(name)}</div>`}
    <div class="cname">${esc(name)}</div>
  </div>`;

  const cc = document.getElementById('cc');
  cc.addEventListener('dragstart', e => onDragStart(e, fn));
  cc.addEventListener('dragend',   onDragEnd);
  hint.textContent = isPlaced(fn) ? 'Already placed · click Next' : 'Drag into a tier →';
}

function renderProgress() {
  const total = S.queue.length;
  const cur   = Math.max(0, S.currentIdx);
  const pct   = total ? Math.round(cur / total * 100) : 0;
  document.getElementById('ptxt').textContent  = `${cur} / ${total}`;
  document.getElementById('ppct').textContent  = pct + '%';
  document.getElementById('pfill').style.width = pct + '%';
}

function renderQueue() {
  const list     = document.getElementById('qlist');
  list.innerHTML = '';
  const upcoming = S.queue.slice(S.currentIdx + 1);

  if (!upcoming.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:8px 6px">Queue empty</div>';
    return;
  }

  upcoming.forEach((fn, i) => {
    const src  = imgCache[fn] || '';
    const name = stemName(fn);
    const el   = document.createElement('div');
    el.className = 'qi';
    el.innerHTML = `${src ? `<img class="qthumb" src="${src}" alt="">` : '<div class="qthumb" style="background:var(--surface2)"></div>'}
      <span class="qname">${esc(name)}</span>
      <span class="qnum">${i + 1}</span>`;
    list.appendChild(el);
  });
}

function renderTiers() {
  const wrap   = document.getElementById('twrap');
  const exist  = new Map([...wrap.querySelectorAll('.tier')].map(el => [el.dataset.id, el]));
  exist.forEach((el, id) => { if (!S.tiers.find(t => t.id === id)) el.remove(); });

  S.tiers.forEach((tier, idx) => {
    let el = exist.get(tier.id);
    if (!el) { el = makeTierEl(tier); wrap.appendChild(el); }
    else updateTierEl(el, tier);
    const ch = [...wrap.querySelectorAll('.tier')];
    if (ch[idx] !== el) wrap.insertBefore(el, ch[idx] || null);
  });
}

function makeTierEl(tier) {
  const el = document.createElement('div');
  el.className  = 'tier';
  el.dataset.id = tier.id;
  el.innerHTML  = `
    <div class="tlbl" ondblclick="openEdit('${tier.id}')" style="background:${tier.color};color:${textCol(tier.color)}">
      <span class="lt">${esc(tier.label)}</span><span class="ehint">EDIT</span>
    </div>
    <div class="timgs" data-tier="${tier.id}"></div>
    <div class="tside">
      <button onclick="mvTier('${tier.id}',-1)">↑</button>
      <button onclick="mvTier('${tier.id}',1)">↓</button>
      <button onclick="delTier('${tier.id}')" class="danger">✕</button>
    </div>`;
  setupDrop(el, tier.id);
  return el;
}

function updateTierEl(el, tier) {
  const lbl = el.querySelector('.tlbl');
  lbl.style.background = tier.color;
  lbl.style.color      = textCol(tier.color);
  lbl.querySelector('.lt').textContent = tier.label;
  lbl.ondblclick = () => openEdit(tier.id);

  const area  = el.querySelector('.timgs');
  const exist = new Map([...area.querySelectorAll('.icard')].map(c => [c.dataset.id, c]));
  const want  = new Set(tier.images);
  exist.forEach((c, id) => { if (!want.has(id)) c.remove(); });
  tier.images.forEach((fn, idx) => {
    let card = exist.get(fn);
    if (!card) { card = makePlacedCard(fn); area.appendChild(card); }
    const cards = [...area.querySelectorAll('.icard')];
    if (cards[idx] !== card) area.insertBefore(card, cards[idx] || null);
  });
}

function makePlacedCard(fn) {
  const src  = imgCache[fn] || '';
  const name = stemName(fn);
  const c    = document.createElement('div');
  c.className  = 'icard';
  c.dataset.id = fn;
  c.innerHTML  = `${src ? `<img src="${src}" alt="${esc(name)}">` : ''}
    <div class="pn">${esc(name)}</div>
    <button class="rm" title="Remove from tier">✕</button>`;
  c.querySelector('.rm').addEventListener('click', () => unplace(fn));
  return c;
}

function setupDrop(tierEl, tid) {
  ['timgs', 'tlbl'].forEach(cls => {
    const z = tierEl.querySelector('.' + cls);
    if (!z) return;
    z.addEventListener('dragover',  e => { e.preventDefault(); tierEl.classList.add('drag-over'); });
    z.addEventListener('dragleave', e => { if (!tierEl.contains(e.relatedTarget)) tierEl.classList.remove('drag-over'); });
    z.addEventListener('drop',      e => { e.preventDefault(); tierEl.classList.remove('drag-over'); placeImg(e.dataTransfer.getData('text/plain'), tid); });
  });
  tierEl.addEventListener('dragleave', e => { if (!tierEl.contains(e.relatedTarget)) tierEl.classList.remove('drag-over'); });
}

function updateNxtBtn() {
  const btn = document.getElementById('nxtbtn');
  const rem = S.queue.length - (S.currentIdx + 1);
  btn.textContent = rem <= 0 ? 'Finish ✓' : `Next →  (${rem} left)`;
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function placeImg(fn, tid) {
  S.tiers.forEach(t => { t.images = t.images.filter(id => id !== fn); });
  const tier = S.tiers.find(t => t.id === tid);
  if (tier) tier.images.push(fn);
  if (curFile() === fn) S.currentIdx = Math.min(S.currentIdx + 1, S.queue.length);
  await preloadVisible();
  render(); await save();
}

async function unplace(fn) {
  S.tiers.forEach(t => { t.images = t.images.filter(id => id !== fn); });
  const q = S.queue.indexOf(fn);
  if (q !== -1 && q < S.currentIdx) S.currentIdx = q;
  render(); await save();
}

async function nextImage() {
  if (S.currentIdx >= S.queue.length) { showCompletion(); return; }
  S.currentIdx = Math.min(S.currentIdx + 1, S.queue.length);
  if (S.currentIdx >= S.queue.length) { render(); showCompletion(); return; }
  await preloadVisible();
  render(); await save();
}

async function clearPlacements() {
  if (!confirm('Remove all tier placements?')) return;
  S.tiers.forEach(t => t.images = []);
  S.currentIdx = S.queue.length ? 0 : -1;
  render(); await save(); toast('Placements cleared');
}

async function resetSession() {
  if (!confirm('Start over? This will clear placements and reset the queue.')) return;
  S.tiers.forEach(t => t.images = []);
  S.currentIdx = S.queue.length ? 0 : -1;
  document.getElementById('comp').classList.remove('open');
  render(); await save();
}

async function addTier() {
  const used  = new Set(S.tiers.map(t => t.label));
  const label = 'SABCDEFGHIJ'.split('').find(l => !used.has(l)) || '?';
  S.tiers.push({ id: 't' + (S.nextTierId++), label, color: COLORS[S.tiers.length % COLORS.length], images: [] });
  render(); await save();
}

async function delTier(id) {
  const t = S.tiers.find(t => t.id === id); if (!t) return;
  if (t.images.length && !confirm('Delete tier? Images will be unplaced.')) return;
  S.tiers = S.tiers.filter(t => t.id !== id);
  render(); await save();
}

async function mvTier(id, dir) {
  const i = S.tiers.findIndex(t => t.id === id); if (i < 0) return;
  const j = i + dir; if (j < 0 || j >= S.tiers.length) return;
  [S.tiers[i], S.tiers[j]] = [S.tiers[j], S.tiers[i]];
  render(); await save();
}

// ── Completion ───────────────────────────────────────────────────────────────
async function showCompletion() {
  const placed = placedCount(), total = allImgs.length;
  const active = S.tiers.filter(t => t.images.length);
  document.getElementById('csub').textContent =
    `${placed} of ${total} image${total !== 1 ? 's' : ''} placed across ${active.length} tier${active.length !== 1 ? 's' : ''}.`;

  const ct = document.getElementById('ctiers'); ct.innerHTML = '';
  // Load all placed images
  const allPlaced = active.flatMap(t => t.images);
  await Promise.all(allPlaced.map(loadImg));

  active.forEach(tier => {
    const row = document.createElement('div'); row.className = 'ctier';
    row.innerHTML = `<div class="ctlbl" style="background:${tier.color};color:${textCol(tier.color)}">${esc(tier.label)}</div>
      <div class="ctimgs">${tier.images.map(fn => {
        const src = imgCache[fn] || '';
        return src ? `<img class="cimg" src="${src}" title="${esc(stemName(fn))}">` : '';
      }).join('')}</div>`;
    ct.appendChild(row);
  });
  document.getElementById('comp').classList.add('open');
}

// ── Drag ─────────────────────────────────────────────────────────────────────
function onDragStart(e, fn) {
  e.dataTransfer.setData('text/plain', fn);
  e.dataTransfer.effectAllowed = 'move';
  // Blank drag image
  const b = document.createElement('canvas'); b.width = b.height = 1;
  e.dataTransfer.setDragImage(b, 0, 0);
  // Custom ghost
  const src = imgCache[fn];
  if (src) {
    document.getElementById('gimg').src = src;
    document.getElementById('ghost').style.display = 'block';
    document.addEventListener('dragover', moveGhost, { passive: true });
  }
  e.currentTarget.classList.add('dragging');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.getElementById('ghost').style.display = 'none';
  document.removeEventListener('dragover', moveGhost);
  document.querySelectorAll('.tier').forEach(t => t.classList.remove('drag-over'));
}

function moveGhost(e) {
  const g = document.getElementById('ghost');
  g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
}

// ── Edit modal ────────────────────────────────────────────────────────────────
let editId = null, selCol = null;

function openEdit(id) {
  editId = id;
  const tier = S.tiers.find(t => t.id === id); if (!tier) return;
  document.getElementById('elbl').value = tier.label;
  selCol = tier.color;
  const row = document.getElementById('crow'); row.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw' + (c === selCol ? ' sel' : '');
    sw.style.background = c;
    sw.onclick = () => { selCol = c; row.querySelectorAll('.sw').forEach(s => s.classList.remove('sel')); sw.classList.add('sel'); };
    row.appendChild(sw);
  });
  document.getElementById('emodal').classList.add('open');
  setTimeout(() => document.getElementById('elbl').focus(), 50);
}

function closeModal() { document.getElementById('emodal').classList.remove('open'); editId = null; }

async function confirmEdit() {
  const tier = S.tiers.find(t => t.id === editId);
  if (tier) {
    tier.label = document.getElementById('elbl').value.trim() || tier.label;
    tier.color = selCol || tier.color;
  }
  closeModal(); render(); await save();
}

// ── Export PNG ────────────────────────────────────────────────────────────────
async function exportPNG() {
  const active = S.tiers.filter(t => t.images.length);
  if (!active.length) { toast('No images placed yet'); return; }
  toast('Generating PNG…');

  // Load all images needed
  await Promise.all(active.flatMap(t => t.images).map(loadImg));

  const canvas = document.getElementById('ec'), ctx = canvas.getContext('2d');
  const LW = 80, IS = 88, PAD = 8, RH = IS + PAD * 2;
  const maxR = Math.max(...active.map(t => t.images.length));
  canvas.width  = LW + maxR * (IS + PAD) + PAD;
  canvas.height = active.length * (RH + 4) + 20;
  ctx.fillStyle = '#0f0f0f'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  const loaded = {};
  const loadCanvasImg = src => new Promise(res => {
    if (loaded[src]) return res(loaded[src]);
    const img = new Image(); img.onload = () => { loaded[src] = img; res(img); }; img.onerror = () => res(null); img.src = src;
  });

  for (let ti = 0; ti < active.length; ti++) {
    const tier = active[ti], y = 10 + ti * (RH + 4);
    ctx.fillStyle = tier.color; ctx.beginPath(); ctx.roundRect(PAD, y, LW - PAD * 2, RH, 4); ctx.fill();
    ctx.fillStyle = textCol(tier.color); ctx.font = 'bold italic 26px Georgia,serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tier.label, LW / 2, y + RH / 2);
    for (let ii = 0; ii < tier.images.length; ii++) {
      const src = imgCache[tier.images[ii]]; if (!src) continue;
      const img = await loadCanvasImg(src); if (!img) continue;
      const x = LW + ii * (IS + PAD) + PAD;
      ctx.save(); ctx.beginPath(); ctx.roundRect(x, y + PAD, IS, IS, 4); ctx.clip();
      ctx.drawImage(img, x, y + PAD, IS, IS); ctx.restore();
    }
  }

  const dataUrl  = canvas.toDataURL('image/png');
  const savedTo  = await window.api.exportPng(dataUrl);
  if (savedTo) toast(`Saved to ${savedTo}`);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.getElementById('emodal').addEventListener('click', e => { if (e.target === document.getElementById('emodal')) closeModal(); });
document.getElementById('elbl').addEventListener('keydown', e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') closeModal(); });

init();
