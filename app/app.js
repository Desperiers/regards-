// Regards — inspection de bâtiments et vidéo par drone
// Application web installable (PWA), 100 % locale : les données restent sur l'appareil (IndexedDB).

/* ============================== Constantes ============================== */

const DEFECT_TYPES = [
  'Fissure', 'Infiltration / humidité', 'Tuile ou ardoise cassée / déplacée', 'Mousse / végétation',
  'Corrosion', 'Éclatement béton / armature apparente', 'Joint dégradé', 'Gouttière / descente EP',
  'Zinguerie / solin', 'Étanchéité toiture-terrasse', 'Menuiserie / vitrage', 'Panneau solaire',
  'Cheminée / souche', 'Équipement (antenne, VMC…)', 'Enduit / peinture dégradé', 'Salissure / graffiti', 'Autre',
];
const SEVERITIES = { 1: 'Mineur', 2: 'Modéré', 3: 'Important', 4: 'Critique' };
const SEV_COLORS = { 1: '#22c55e', 2: '#eab308', 3: '#f97316', 4: '#ef4444' };
const STATUSES = ['À vérifier', 'À traiter', 'En cours', 'Traité'];
const LOCATIONS = ['Toiture', 'Toiture-terrasse', 'Façade nord', 'Façade sud', 'Façade est', 'Façade ouest', 'Pignon', 'Cheminée', 'Gouttières', 'Balcon', 'Parking / abords', 'Structure', 'Ouvrage d\'art'];
const MISSION_TYPES = ['Inspection toiture', 'Inspection façades', 'Inspection complète bâtiment', 'Suivi de chantier', 'Thermographie', 'Ouvrage d\'art', 'Vidéo / prise de vue', 'Autre'];
const DEFAULT_MODEL = 'claude-opus-5-5';

/* ============================== Base de données ============================== */

const DB_NAME = 'regards';
let _db;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('media', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      db.createObjectStore('defects', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      db.createObjectStore('kv');
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const db = {
  get: (store, id) => tx(store, 'readonly', s => req(s.get(id))),
  put: (store, v) => tx(store, 'readwrite', s => { s.put(v); return v; }),
  del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
  all: store => tx(store, 'readonly', s => req(s.getAll())),
  byProject: (store, pid) => tx(store, 'readonly', s => req(s.index('projectId').getAll(pid))),
  kvGet: k => tx('kv', 'readonly', s => req(s.get(k))),
  kvSet: (k, v) => tx('kv', 'readwrite', s => { s.put(v, k); }),
};
async function getSettings() {
  return Object.assign({ inspector: '', company: '', logo: '', apiKey: '', model: DEFAULT_MODEL, frameStep: 1 / 30 }, await db.kvGet('settings'));
}

/* ============================== Utilitaires ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
const fmtTime = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };
const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' Go' : b > 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : Math.round(b / 1e3) + ' ko';
const sevBadge = s => `<span class="sev sev${s}">${esc(SEVERITIES[s] || s)}</span>`;
const defRef = d => 'D' + String(d.num || 0).padStart(2, '0');
const options = (list, sel) => list.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

let urls = [];
function objURL(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }
function revokeAll() { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; }

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible')); i.src = src; });
}
async function blobToImage(blob) {
  const u = URL.createObjectURL(blob);
  try { return await loadImage(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
function canvasBlob(c, type = 'image/jpeg', q = 0.9) { return new Promise(r => c.toBlob(r, type, q)); }
async function resizeBlob(blob, max, q = 0.85) {
  const img = await blobToImage(blob);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { blob: await canvasBlob(c, 'image/jpeg', q), width: img.naturalWidth, height: img.naturalHeight, canvas: c };
}
function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
function base64ToBlob(b64, type) {
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ============================== Métadonnées EXIF / XMP (drones DJI, Autel, Parrot…) ============================== */

async function readPhotoMeta(file) {
  const meta = {};
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return meta;
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off); const len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) { Object.assign(meta, parseExif(v, off + 10)); break; }
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
    // XMP DJI : altitude relative, cap, inclinaison nacelle
    const txt = new TextDecoder('latin1').decode(new Uint8Array(buf));
    const x = k => { const m = txt.match(new RegExp(k + '="?([+-]?[\\d.]+)')); return m ? parseFloat(m[1]) : undefined; };
    const rel = x('RelativeAltitude'); if (rel !== undefined) meta.relAlt = rel;
    const yaw = x('GimbalYawDegree') ?? x('FlightYawDegree'); if (yaw !== undefined) meta.yaw = yaw;
    const pitch = x('GimbalPitchDegree'); if (pitch !== undefined) meta.pitch = pitch;
  } catch (e) { /* métadonnées facultatives */ }
  return meta;
}
function parseExif(v, tiff) {
  const le = v.getUint16(tiff) === 0x4949;
  const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
  const out = {};
  const ifd = (start, cb) => { const n = u16(start); for (let i = 0; i < n; i++) { const e = start + 2 + i * 12; cb(u16(e), u16(e + 2), u32(e + 4), e + 8); } };
  const rat = o => u32(o) / (u32(o + 4) || 1);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(o + i)); return s.trim(); };
  let gpsPtr, exifPtr;
  ifd(tiff + u32(tiff + 4), (tag, type, count, valOff) => {
    const at = count > 4 ? tiff + u32(valOff) : valOff;
    if (tag === 0x8825) gpsPtr = u32(valOff);
    if (tag === 0x8769) exifPtr = u32(valOff);
    if (tag === 0x010F) out.make = str(at, count);
    if (tag === 0x0110) out.model = str(at, count);
  });
  if (exifPtr) ifd(tiff + exifPtr, (tag, type, count, valOff) => {
    if (tag === 0x9003) { const s = str(tiff + u32(valOff), count); const m = s.match(/(\d+):(\d+):(\d+) (\d+):(\d+):(\d+)/); if (m) out.date = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString(); }
  });
  if (gpsPtr) {
    const g = {};
    ifd(tiff + gpsPtr, (tag, type, count, valOff) => {
      const at = tiff + u32(valOff);
      if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(valOff));
      if (tag === 2 || tag === 4) g[tag] = rat(at) + rat(at + 8) / 60 + rat(at + 16) / 3600;
      if (tag === 5) g[5] = v.getUint8(valOff);
      if (tag === 6) g[6] = rat(at);
    });
    if (g[2] && g[4]) {
      out.lat = +(g[2] * (g[1] === 'S' ? -1 : 1)).toFixed(7);
      out.lon = +(g[4] * (g[3] === 'W' ? -1 : 1)).toFixed(7);
    }
    if (g[6] !== undefined) out.alt = +(g[6] * (g[5] === 1 ? -1 : 1)).toFixed(1);
  }
  return out;
}

/* ============================== Import de médias ============================== */

async function importFiles(projectId, files) {
  const list = [...files].filter(f => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|heic|mp4|mov|m4v)$/i.test(f.name));
  if (!list.length) { toast('Aucun fichier photo ou vidéo reconnu'); return 0; }
  try { navigator.storage?.persist?.(); } catch (e) {}
  let n = 0;
  for (const f of list) {
    toast(`Import ${++n}/${list.length} : ${f.name}`, 60000);
    const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(f.name);
    const m = { id: uid(), projectId, name: f.name, type: isVideo ? 'video' : 'photo', mime: f.type || (isVideo ? 'video/mp4' : 'image/jpeg'), size: f.size, createdAt: Date.now(), blob: f, meta: {}, markers: [] };
    try {
      if (isVideo) {
        const info = await videoThumb(f);
        Object.assign(m, info);
      } else {
        m.meta = await readPhotoMeta(f);
        const r = await resizeBlob(f, 480, 0.8);
        m.thumb = r.blob; m.width = r.width; m.height = r.height;
      }
    } catch (e) { console.warn('Miniature impossible', f.name, e); }
    await db.put('media', m);
  }
  toast(`${list.length} fichier(s) importé(s)`);
  return list.length;
}
function videoThumb(blob) {
  return new Promise(res => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const u = URL.createObjectURL(blob);
    const done = out => { URL.revokeObjectURL(u); res(out); };
    const timer = setTimeout(() => done({}), 8000);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = async () => {
      clearTimeout(timer);
      const c = document.createElement('canvas');
      const s = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
      c.width = v.videoWidth * s; c.height = v.videoHeight * s;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      done({ thumb: await canvasBlob(c, 'image/jpeg', 0.8), duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => { clearTimeout(timer); done({}); };
    v.src = u;
  });
}
async function captureFrame(video, src) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  const blob = await canvasBlob(c, 'image/jpeg', 0.92);
  const t = video.currentTime;
  const thumb = (await resizeBlob(blob, 480, 0.8)).blob;
  const m = {
    id: uid(), projectId: src.projectId, name: `${src.name.replace(/\.[^.]+$/, '')} @ ${fmtTime(t)}`, type: 'photo', mime: 'image/jpeg',
    size: blob.size, createdAt: Date.now(), blob, thumb, width: c.width, height: c.height, meta: {}, source: { mediaId: src.id, time: t }, markers: [],
  };
  await db.put('media', m);
  return m;
}

/* ============================== Intelligence artificielle (API Claude) ============================== */

async function callClaude(settings, body) {
  if (!settings.apiKey) throw new Error('Ajoutez votre clé API Anthropic dans Réglages pour utiliser l\'analyse IA.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: settings.model || DEFAULT_MODEL, fallbacks: 'default', ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Erreur API (${r.status})`);
  if (data.stop_reason === 'refusal') throw new Error('L\'IA a refusé d\'analyser ce contenu.');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new Error('Réponse IA vide' + (data.stop_reason === 'max_tokens' ? ' (réponse tronquée)' : ''));
  return text;
}

const AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'defects'],
  properties: {
    summary: { type: 'string', description: 'Description courte de ce que montre la photo et de l\'état général.' },
    defects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'severity', 'location', 'description', 'recommendation', 'x', 'y', 'w', 'h'],
        properties: {
          type: { type: 'string', enum: DEFECT_TYPES },
          severity: { type: 'integer', description: '1 = mineur, 2 = modéré, 3 = important, 4 = critique' },
          location: { type: 'string', description: 'Élément d\'ouvrage concerné (ex. Toiture, Façade, Gouttière…)' },
          description: { type: 'string' },
          recommendation: { type: 'string' },
          x: { type: 'number', description: 'Bord gauche de la zone, fraction 0-1 de la largeur' },
          y: { type: 'number', description: 'Bord haut de la zone, fraction 0-1 de la hauteur' },
          w: { type: 'number', description: 'Largeur de la zone, fraction 0-1' },
          h: { type: 'number', description: 'Hauteur de la zone, fraction 0-1' },
        },
      },
    },
  },
};

async function aiAnalyzePhoto(media, project) {
  const settings = await getSettings();
  const { blob } = await resizeBlob(media.blob, 1568, 0.88);
  const b64 = await blobToBase64(blob);
  const ctx = [project.missionType && `Type de mission : ${project.missionType}`, project.address && `Adresse : ${project.address}`, media.meta?.relAlt !== undefined && `Altitude relative du drone : ${media.meta.relAlt} m`].filter(Boolean).join('\n');
  const text = await callClaude(settings, {
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: AI_SCHEMA } },
    system: 'Tu es un expert en pathologie du bâtiment qui analyse des photos prises par drone pour des rapports d\'inspection. Relève uniquement les désordres réellement visibles (fissures, tuiles déplacées, infiltrations, corrosion, mousses, éclatements de béton, défauts de zinguerie, etc.). Pour chaque désordre, indique une zone rectangulaire approximative qui l\'englobe, en fractions de l\'image. N\'invente rien : si la photo ne montre aucun désordre, renvoie une liste vide. Rédige en français, de façon factuelle et professionnelle, avec des recommandations concrètes.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: `Analyse cette photo d'inspection par drone et liste les désordres visibles.\n${ctx}` },
      ],
    }],
  });
  const out = JSON.parse(text);
  const existing = await db.byProject('defects', project.id);
  let num = existing.reduce((m, d) => Math.max(m, d.num || 0), 0);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
  const created = [];
  for (const d of out.defects || []) {
    const x = clamp(d.x, 0, 1), y = clamp(d.y, 0, 1);
    const def = {
      id: uid(), projectId: project.id, mediaId: media.id, num: ++num, createdAt: Date.now(), ai: true,
      type: DEFECT_TYPES.includes(d.type) ? d.type : 'Autre', severity: clamp(Math.round(d.severity), 1, 4),
      location: d.location || '', description: d.description || '', recommendation: d.recommendation || '', status: 'À vérifier',
      shape: { kind: 'rect', x, y, w: clamp(d.w, 0.02, 1 - x), h: clamp(d.h, 0.02, 1 - y) },
    };
    await db.put('defects', def); created.push(def);
  }
  media.aiSummary = out.summary || '';
  await db.put('media', media);
  return created;
}

async function aiReportSummary(project, defects) {
  const settings = await getSettings();
  const lines = defects.map(d => `${defRef(d)} | ${d.type} | gravité ${d.severity} (${SEVERITIES[d.severity]}) | ${d.location} | ${d.description} | reco : ${d.recommendation} | statut : ${d.status}`).join('\n');
  return callClaude(settings, {
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    system: 'Tu rédiges la synthèse d\'un rapport d\'inspection de bâtiment par drone, en français, pour un client (propriétaire, syndic, assureur ou maître d\'ouvrage). Ton professionnel, clair, sans jargon inutile. Texte brut sans Markdown : 3 à 5 paragraphes courts, état général, désordres prioritaires avec leurs références (D01…), puis plan d\'action hiérarchisé (urgent / à court terme / à surveiller). Environ 250 mots.',
    messages: [{ role: 'user', content: `Bâtiment : ${project.name}\nAdresse : ${project.address || '—'}\nMission : ${project.missionType || '—'}\nDate : ${fmtDate(project.date)}\n\nDésordres relevés :\n${lines || 'Aucun désordre relevé.'}` }],
  });
}

/* ============================== Rendu d'images annotées ============================== */

function drawShape(ctx, sh, W, H, color, label, lw) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  const x = sh.x * W, y = sh.y * H, w = sh.w * W, h = sh.h * H;
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = lw;
  if (sh.kind === 'rect') ctx.strokeRect(x, y, w, h);
  else if (sh.kind === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
  else if (sh.kind === 'arrow') {
    const x2 = x + w, y2 = y + h, a = Math.atan2(h, w), L = lw * 5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45)); ctx.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
  }
  if (label) {
    const lx = sh.kind === 'arrow' ? x : Math.min(x, x + w), ly = sh.kind === 'arrow' ? y : Math.min(y, y + h);
    ctx.shadowBlur = 0;
    ctx.font = `bold ${lw * 5}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + lw * 3, th = lw * 7;
    const bx = Math.max(0, Math.min(W - tw, lx)), by = Math.max(0, ly - th - lw);
    ctx.fillRect(bx, by, tw, th);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, bx + lw * 1.5, by + th / 2);
  }
  ctx.restore();
}
async function annotatedImage(media, defects, max = 1600, crop) {
  const img = await blobToImage(media.blob);
  const NW = img.naturalWidth, NH = img.naturalHeight;
  let sx = 0, sy = 0, sw = NW, sh = NH;
  if (crop) {
    const b = shapeBounds(crop.shape);
    const pad = 0.6, cw = Math.max(b.w * (1 + pad * 2), 0.25), chh = Math.max(b.h * (1 + pad * 2), 0.25);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    sx = Math.max(0, (cx - cw / 2)) * NW; sy = Math.max(0, (cy - chh / 2)) * NH;
    sw = Math.min(NW - sx, cw * NW); sh = Math.min(NH - sy, chh * NH);
  }
  const s = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas'); c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const lw = Math.max(2, Math.round(Math.max(c.width, c.height) / 400));
  ctx.save(); ctx.translate(-sx * s, -sy * s);
  for (const d of defects) if (d.shape) drawShape(ctx, d.shape, NW * s, NH * s, SEV_COLORS[d.severity], defRef(d), lw);
  ctx.restore();
  return c.toDataURL('image/jpeg', 0.85);
}
function shapeBounds(sh) {
  const x = Math.min(sh.x, sh.x + sh.w), y = Math.min(sh.y, sh.y + sh.h);
  return { x, y, w: Math.abs(sh.w), h: Math.abs(sh.h) };
}

/* ============================== Dialogue ============================== */

function dialog(html, onSubmit) {
  const d = $('#dlg'), f = $('#dlgForm');
  f.innerHTML = html;
  return new Promise(res => {
    const close = v => { d.close(); res(v); };
    f.onsubmit = async e => {
      e.preventDefault();
      const action = e.submitter?.value || 'ok';
      if (action === 'cancel') return close(null);
      const data = Object.fromEntries(new FormData(f));
      const r = onSubmit ? await onSubmit(action, data, f) : { action, data };
      if (r !== false) close(r ?? { action, data });
    };
    d.onclose = () => res(null);
    d.showModal();
    const first = f.querySelector('input:not([type=hidden]),select,textarea'); first?.focus();
  });
}
function confirmDlg(msg, okLabel = 'Supprimer') {
  return dialog(`<h2>Confirmation</h2><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn" value="cancel" formnovalidate>Annuler</button><button class="btn danger" value="ok">${esc(okLabel)}</button></div>`).then(Boolean);
}

function projectForm(p = {}) {
  return `
  <label class="f"><span>Nom du bâtiment / site *</span><input name="name" required value="${esc(p.name)}" placeholder="Résidence Les Tilleuls"></label>
  <label class="f"><span>Adresse</span><input name="address" value="${esc(p.address)}" placeholder="12 rue des Lilas, 69000 Lyon"></label>
  <div class="cols2">
    <label class="f"><span>Client / donneur d'ordre</span><input name="client" value="${esc(p.client)}"></label>
    <label class="f"><span>Date d'intervention</span><input type="date" name="date" value="${esc(p.date || new Date().toISOString().slice(0, 10))}"></label>
    <label class="f"><span>Type de mission</span><select name="missionType">${options(MISSION_TYPES, p.missionType || MISSION_TYPES[0])}</select></label>
    <label class="f"><span>Drone utilisé</span><input name="drone" value="${esc(p.drone)}" placeholder="DJI Mavic 3 Enterprise"></label>
    <label class="f"><span>Télépilote</span><input name="pilot" value="${esc(p.pilot)}"></label>
    <label class="f"><span>Météo / conditions</span><input name="weather" value="${esc(p.weather)}" placeholder="Ciel dégagé, vent 15 km/h"></label>
  </div>
  <label class="f"><span>Cadre réglementaire du vol</span><input name="regulation" value="${esc(p.regulation)}" placeholder="Catégorie Ouverte A3 / Spécifique STS-01…"></label>
  <label class="f"><span>Objet de la mission / notes</span><textarea name="notes">${esc(p.notes)}</textarea></label>`;
}

async function defectDialog(def, isNew) {
  const r = await dialog(`
    <h2>${isNew ? 'Nouveau désordre' : 'Désordre ' + esc(defRef(def))}${def.ai ? ' <span class="small muted">(suggestion IA)</span>' : ''}</h2>
    <div class="cols2">
      <label class="f"><span>Type</span><select name="type">${options(DEFECT_TYPES, def.type)}</select></label>
      <label class="f"><span>Gravité</span><select name="severity">${Object.entries(SEVERITIES).map(([k, v]) => `<option value="${k}" ${+k === +def.severity ? 'selected' : ''}>${k} — ${v}</option>`).join('')}</select></label>
      <label class="f"><span>Localisation</span><input name="location" list="locs" value="${esc(def.location)}"><datalist id="locs">${LOCATIONS.map(l => `<option value="${esc(l)}">`).join('')}</datalist></label>
      <label class="f"><span>Statut</span><select name="status">${options(STATUSES, def.status)}</select></label>
    </div>
    <label class="f"><span>Description</span><textarea name="description">${esc(def.description)}</textarea></label>
    <label class="f"><span>Recommandation</span><textarea name="recommendation">${esc(def.recommendation)}</textarea></label>
    <div class="row" style="justify-content:space-between">
      <div>${isNew ? '' : '<button class="btn danger" value="delete" formnovalidate>Supprimer</button>'}</div>
      <div class="row"><button class="btn" value="cancel" formnovalidate>Annuler</button><button class="btn primary" value="ok">Enregistrer</button></div>
    </div>`);
  if (!r) return null;
  if (r.action === 'delete') { await db.del('defects', def.id); return 'deleted'; }
  Object.assign(def, r.data, { severity: +r.data.severity, updatedAt: Date.now() });
  if (def.ai && def.status !== 'À vérifier') def.ai = false;
  await db.put('defects', def);
  return def;
}

/* ============================== Routeur ============================== */

let cleanup = null;
async function render() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  revokeAll();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = $('#view');
  view.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    if (!parts.length) await viewHome(view);
    else if (parts[0] === 'p') await viewProject(view, parts[1], parts[2] || 'medias');
    else if (parts[0] === 'm') await viewMedia(view, parts[1]);
    else if (parts[0] === 'settings') await viewSettings(view);
    else location.hash = '#/';
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h2>Erreur</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Retour</a></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

/* ============================== Vue : projets ============================== */

async function viewHome(view) {
  const [projects, media, defects] = await Promise.all([db.all('projects'), db.all('media'), db.all('defects')]);
  projects.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  view.innerHTML = `
    <div class="spread">
      <div><h1>Projets d'inspection</h1><div class="muted">Bâtiments, chantiers et prises de vue drone</div></div>
      <div class="row">
        <label class="btn">Importer une sauvegarde<input type="file" accept=".json,application/json" hidden id="impBk"></label>
        <button class="btn primary" id="newP">+ Nouveau projet</button>
      </div>
    </div>
    ${projects.length ? `<div class="grid">${projects.map(p => {
      const pm = media.filter(m => m.projectId === p.id), pd = defects.filter(d => d.projectId === p.id);
      const crit = pd.filter(d => d.severity >= 3 && d.status !== 'Traité').length;
      const cover = pm.find(m => m.thumb);
      return `<a class="card pcard" href="#/p/${p.id}">
        ${cover ? `<div class="thumb" style="margin-bottom:10px"><img src="${objURL(cover.thumb)}" alt=""></div>` : ''}
        <h3>${esc(p.name)}</h3>
        <div class="muted small">${esc(p.address || '')}${p.address ? ' · ' : ''}${fmtDate(p.date)}</div>
        <div class="stats"><span>${pm.filter(m => m.type === 'photo').length} photos</span><span>${pm.filter(m => m.type === 'video').length} vidéos</span><span>${pd.length} désordres</span>${crit ? `<span class="sev sev4">${crit} prioritaires</span>` : ''}</div>
      </a>`;
    }).join('')}</div>` : `<div class="card empty"><h2>Bienvenue dans Regards</h2><p>Créez un projet, importez les photos et vidéos de votre drone, annotez les désordres (ou laissez l'IA les détecter) puis générez un rapport PDF.</p><button class="btn primary" onclick="document.getElementById('newP').click()">Créer mon premier projet</button></div>`}`;
  $('#newP').onclick = async () => {
    const r = await dialog(`<h2>Nouveau projet</h2>${projectForm()}<div class="row" style="justify-content:flex-end"><button class="btn" value="cancel" formnovalidate>Annuler</button><button class="btn primary" value="ok">Créer</button></div>`);
    if (!r) return;
    const p = { id: uid(), ...r.data, createdAt: Date.now(), updatedAt: Date.now() };
    await db.put('projects', p);
    location.hash = `#/p/${p.id}`;
  };
  $('#impBk').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const id = await importBackup(f); toast('Sauvegarde importée'); location.hash = `#/p/${id}`; }
    catch (err) { toast('Import impossible : ' + err.message, 5000); }
  };
}

/* ============================== Vue : projet ============================== */

async function viewProject(view, id, tab) {
  const p = await db.get('projects', id);
  if (!p) { location.hash = '#/'; return; }
  const [media, defects] = await Promise.all([db.byProject('media', id), db.byProject('defects', id)]);
  media.sort((a, b) => a.createdAt - b.createdAt);
  defects.sort((a, b) => (a.num || 0) - (b.num || 0));
  const tabs = [['medias', `Médias (${media.length})`], ['defauts', `Désordres (${defects.length})`], ['rapport', 'Rapport'], ['infos', 'Infos projet']];
  view.innerHTML = `
    <div class="small"><a href="#/">← Projets</a></div>
    <h1 style="margin-top:6px">${esc(p.name)}</h1>
    <div class="muted">${esc([p.address, p.missionType, fmtDate(p.date)].filter(Boolean).join(' · '))}</div>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/p/${id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="tab"></div>`;
  const el = $('#tab');
  if (tab === 'medias') return tabMedia(el, p, media, defects);
  if (tab === 'defauts') return tabDefects(el, p, media, defects);
  if (tab === 'rapport') return tabReport(el, p, media, defects);
  if (tab === 'infos') return tabInfos(el, p, media, defects);
}

function tabMedia(el, p, media, defects) {
  const filters = { all: 'Tout', photo: 'Photos', video: 'Vidéos' };
  let filter = 'all';
  const paint = () => {
    const list = media.filter(m => filter === 'all' || m.type === filter);
    $('#mgrid').innerHTML = list.length ? list.map(m => {
      const n = defects.filter(d => d.mediaId === m.id).length;
      return `<a class="thumb" href="#/m/${m.id}">
        ${m.thumb ? `<img src="${objURL(m.thumb)}" alt="" loading="lazy">` : `<div class="empty">${m.type === 'video' ? '🎬' : '🖼️'}</div>`}
        <span class="tag">${m.type === 'video' ? '▶ ' + fmtTime(m.duration) : m.source ? 'Capture' : 'Photo'}</span>
        ${n ? `<span class="count">${n}</span>` : ''}
        <span class="name">${esc(m.name)}</span></a>`;
    }).join('') : '<div class="muted">Aucun média pour l\'instant.</div>';
    $$('[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
  };
  el.innerHTML = `
    <div class="drop" id="drop">
      <p><b>Glissez ici les photos et vidéos du drone</b><br><span class="small">JPEG, PNG, MP4, MOV — les coordonnées GPS et l'altitude sont lues automatiquement</span></p>
      <div class="row" style="justify-content:center">
        <label class="btn primary">Choisir des fichiers<input type="file" multiple accept="image/*,video/*" hidden id="fileIn"></label>
        <label class="btn">Prendre une photo<input type="file" accept="image/*" capture="environment" hidden id="camIn"></label>
      </div>
    </div>
    <div class="spread"><div class="row">${Object.entries(filters).map(([k, l]) => `<button class="btn sm" data-f="${k}">${l}</button>`).join('')}</div>
    ${media.some(m => m.type === 'photo') ? '<button class="btn sm warn" id="aiAll">✨ Analyser toutes les photos (IA)</button>' : ''}</div>
    <div class="grid media" id="mgrid"></div>`;
  paint();
  $$('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; paint(); });
  const handle = async files => { if (await importFiles(p.id, files)) { p.updatedAt = Date.now(); await db.put('projects', p); render(); } };
  $('#fileIn').onchange = e => handle(e.target.files);
  $('#camIn').onchange = e => handle(e.target.files);
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); };
  const aiAll = $('#aiAll');
  if (aiAll) aiAll.onclick = async () => {
    const todo = media.filter(m => m.type === 'photo' && !defects.some(d => d.mediaId === m.id) && m.aiSummary === undefined);
    if (!todo.length) return toast('Toutes les photos ont déjà été analysées ou annotées');
    if (!await confirmDlg(`Analyser ${todo.length} photo(s) non annotée(s) avec l'IA ? Chaque photo est envoyée à l'API Claude (facturée sur votre clé).`, 'Analyser')) return;
    aiAll.disabled = true;
    let found = 0, i = 0;
    for (const m of todo) {
      aiAll.innerHTML = `<span class="spin"></span> ${++i}/${todo.length}`;
      try { found += (await aiAnalyzePhoto(m, p)).length; }
      catch (e) { toast(e.message, 6000); break; }
    }
    toast(`${found} désordre(s) détecté(s) — à vérifier`, 5000);
    render();
  };
}

function tabDefects(el, p, media, defects) {
  const f = { sev: '', status: '', type: '' };
  const counts = [4, 3, 2, 1].map(s => [s, defects.filter(d => d.severity === s).length]);
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="muted small">Total</span><b>${defects.length}</b></div>
      ${counts.map(([s, n]) => `<div class="kpi"><span class="sev sev${s}">${SEVERITIES[s]}</span><b>${n}</b></div>`).join('')}
      <div class="kpi"><span class="muted small">À vérifier (IA)</span><b>${defects.filter(d => d.status === 'À vérifier').length}</b></div>
    </div>
    <div class="row" style="margin-bottom:12px">
      <select id="fSev" style="width:auto"><option value="">Toutes gravités</option>${Object.entries(SEVERITIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="fStatus" style="width:auto"><option value="">Tous statuts</option>${options(STATUSES)}</select>
      <select id="fType" style="width:auto"><option value="">Tous types</option>${options([...new Set(defects.map(d => d.type))])}</select>
      <button class="btn sm" id="csv">Export CSV</button>
    </div>
    <div class="card tablewrap"><table class="list"><thead><tr><th></th><th>Réf.</th><th>Type</th><th>Gravité</th><th>Localisation</th><th>Description</th><th>Statut</th></tr></thead><tbody id="dt"></tbody></table></div>`;
  const thumbs = {};
  media.forEach(m => { if (m.thumb) thumbs[m.id] = objURL(m.thumb); });
  const paint = () => {
    const list = defects.filter(d => (!f.sev || d.severity === +f.sev) && (!f.status || d.status === f.status) && (!f.type || d.type === f.type));
    $('#dt').innerHTML = list.length ? list.map(d => `<tr class="click" data-m="${d.mediaId}">
      <td>${thumbs[d.mediaId] ? `<img class="dthumb" src="${thumbs[d.mediaId]}" alt="">` : ''}</td>
      <td><b>${defRef(d)}</b></td><td>${esc(d.type)}</td><td>${sevBadge(d.severity)}</td><td>${esc(d.location)}</td>
      <td class="small">${esc(d.description)}</td><td class="small">${esc(d.status)}${d.ai ? ' ✨' : ''}</td></tr>`).join('')
      : '<tr><td colspan="7" class="muted">Aucun désordre. Ouvrez une photo et dessinez une zone pour en ajouter un.</td></tr>';
    $$('#dt tr[data-m]').forEach(tr => tr.onclick = () => { location.hash = `#/m/${tr.dataset.m}`; });
  };
  paint();
  $('#fSev').onchange = e => { f.sev = e.target.value; paint(); };
  $('#fStatus').onchange = e => { f.status = e.target.value; paint(); };
  $('#fType').onchange = e => { f.type = e.target.value; paint(); };
  $('#csv').onclick = () => {
    const mName = Object.fromEntries(media.map(m => [m.id, m]));
    const rows = [['Réf', 'Type', 'Gravité', 'Localisation', 'Description', 'Recommandation', 'Statut', 'Média', 'Latitude', 'Longitude']]
      .concat(defects.map(d => { const m = mName[d.mediaId] || {}; return [defRef(d), d.type, `${d.severity} - ${SEVERITIES[d.severity]}`, d.location, d.description, d.recommendation, d.status, m.name, m.meta?.lat ?? '', m.meta?.lon ?? '']; }));
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(new Blob([csv], { type: 'text/csv' }), `${p.name} - desordres.csv`);
  };
}

async function tabInfos(el, p, media, defects) {
  const size = media.reduce((s, m) => s + (m.size || 0), 0);
  el.innerHTML = `
    <form class="card" id="pf">${projectForm(p)}<button class="btn primary">Enregistrer</button></form>
    <div class="card" style="margin-top:16px">
      <h3>Données</h3>
      <p class="muted small">${media.length} médias · ${fmtBytes(size)} · ${defects.length} désordres. Tout est stocké uniquement sur cet appareil.</p>
      <div class="row"><button class="btn" id="exp">Exporter la sauvegarde (.json)</button><button class="btn danger" id="delP">Supprimer le projet</button></div>
    </div>`;
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    Object.assign(p, Object.fromEntries(new FormData(e.target)), { updatedAt: Date.now() });
    await db.put('projects', p); toast('Projet enregistré'); render();
  };
  $('#exp').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Préparation…'; await exportBackup(p, media, defects); e.target.disabled = false; e.target.textContent = 'Exporter la sauvegarde (.json)'; };
  $('#delP').onclick = async () => {
    if (!await confirmDlg(`Supprimer définitivement « ${p.name} », ses ${media.length} médias et ${defects.length} désordres ?`)) return;
    for (const m of media) await db.del('media', m.id);
    for (const d of defects) await db.del('defects', d.id);
    await db.del('projects', p.id); location.hash = '#/';
  };
}

/* ============================== Vue : rapport ============================== */

async function tabReport(el, p, media, defects) {
  const settings = await getSettings();
  const mById = Object.fromEntries(media.map(m => [m.id, m]));
  const photos = media.filter(m => m.type === 'photo');
  const videos = media.filter(m => m.type === 'video');
  const sevCount = s => defects.filter(d => d.severity === s).length;
  el.innerHTML = `
    <div class="spread noprint">
      <div class="muted small">Vérifiez le rapport puis imprimez-le ou enregistrez-le en PDF (sur iPhone/iPad : Partager → Imprimer → pincer l'aperçu → Enregistrer).</div>
      <div class="row">
        <button class="btn warn" id="aiSum">✨ Rédiger la synthèse (IA)</button>
        <button class="btn primary" id="print">Imprimer / PDF</button>
      </div>
    </div>
    <div class="card noprint" style="margin-bottom:16px">
      <label class="f"><span>Synthèse du rapport (modifiable)</span><textarea id="sum" rows="7" placeholder="État général du bâtiment, désordres prioritaires, plan d'action…">${esc(p.summary)}</textarea></label>
      <label class="row small"><input type="checkbox" id="incGal" style="width:auto" ${p.reportGallery !== false ? 'checked' : ''}> Inclure la galerie photos en annexe</label>
    </div>
    <div class="report" id="rep"><div class="empty"><span class="spin"></span> Génération des visuels…</div></div>`;

  const build = async () => {
    const rep = $('#rep');
    const defBlocks = [];
    for (const d of defects) {
      const m = mById[d.mediaId];
      let full = '', zoom = '';
      if (m?.blob) {
        full = await annotatedImage(m, [d], 1200);
        if (d.shape) zoom = await annotatedImage(m, [d], 700, d);
      }
      defBlocks.push(`<div class="def">
        <div>${full ? `<img src="${full}" alt="">` : ''}</div>
        <div>
          <h3>${defRef(d)} — ${esc(d.type)}</h3>
          <p>${sevBadge(d.severity)} &nbsp; <span class="muted">${esc(d.status)}</span></p>
          <table>
            <tr><th>Localisation</th><td>${esc(d.location || '—')}</td></tr>
            <tr><th>Description</th><td>${esc(d.description || '—')}</td></tr>
            <tr><th>Recommandation</th><td>${esc(d.recommendation || '—')}</td></tr>
            <tr><th>Source</th><td class="small">${esc(m?.name || '')}${m?.meta?.lat ? `<br>GPS ${m.meta.lat}, ${m.meta.lon}` : ''}${m?.meta?.relAlt !== undefined ? `<br>Alt. ${m.meta.relAlt} m` : ''}</td></tr>
          </table>
          ${zoom ? `<img src="${zoom}" alt="Détail" style="margin-top:6px">` : ''}
        </div></div>`);
    }
    let gallery = '';
    if (p.reportGallery !== false && photos.length) {
      const imgs = [];
      for (const m of photos.slice(0, 60)) imgs.push(`<figure style="margin:0"><img src="${await annotatedImage(m, defects.filter(d => d.mediaId === m.id), 600)}" alt=""><figcaption class="small muted">${esc(m.name)}${m.meta?.lat ? ` · ${m.meta.lat}, ${m.meta.lon}` : ''}</figcaption></figure>`);
      gallery = `<h2>Annexe — Galerie photos</h2><div class="gallery">${imgs.join('')}</div>`;
    }
    const gps = photos.find(m => m.meta?.lat);
    rep.innerHTML = `
      <div class="cover">
        ${settings.logo ? `<img class="logo" src="${settings.logo}" alt="">` : ''}
        <div class="muted">${esc(settings.company || '')}</div>
        <h1>Rapport d'inspection par drone</h1>
        <h2 style="border:0;margin:0">${esc(p.name)}</h2>
        <div class="muted">${esc(p.address || '')}</div>
      </div>
      <table>
        <tr><th>Client</th><td>${esc(p.client || '—')}</td><th>Date d'intervention</th><td>${fmtDate(p.date) || '—'}</td></tr>
        <tr><th>Mission</th><td>${esc(p.missionType || '—')}</td><th>Drone</th><td>${esc(p.drone || '—')}</td></tr>
        <tr><th>Télépilote</th><td>${esc(p.pilot || settings.inspector || '—')}</td><th>Conditions</th><td>${esc(p.weather || '—')}</td></tr>
        <tr><th>Cadre réglementaire</th><td>${esc(p.regulation || '—')}</td><th>Position</th><td>${gps ? `${gps.meta.lat}, ${gps.meta.lon}` : '—'}</td></tr>
        <tr><th>Médias</th><td colspan="3">${photos.length} photo(s), ${videos.length} vidéo(s)${videos.length ? ` — ${fmtTime(videos.reduce((s, v) => s + (v.duration || 0), 0))} de vidéo` : ''}</td></tr>
      </table>
      ${p.notes ? `<h2>Objet de la mission</h2><p class="summary">${esc(p.notes)}</p>` : ''}
      <h2>Synthèse</h2>
      <table><tr>${[4, 3, 2, 1].map(s => `<th><span class="sev sev${s}">${SEVERITIES[s]}</span></th>`).join('')}<th>Total</th></tr>
        <tr>${[4, 3, 2, 1].map(s => `<td style="font-size:1.3em;font-weight:700">${sevCount(s)}</td>`).join('')}<td style="font-size:1.3em;font-weight:700">${defects.length}</td></tr></table>
      ${p.summary ? `<p class="summary">${esc(p.summary)}</p>` : ''}
      ${defects.length ? `<h2>Tableau récapitulatif</h2><table><tr><th>Réf.</th><th>Type</th><th>Gravité</th><th>Localisation</th><th>Recommandation</th></tr>
        ${[...defects].sort((a, b) => b.severity - a.severity || a.num - b.num).map(d => `<tr><td><b>${defRef(d)}</b></td><td>${esc(d.type)}</td><td>${sevBadge(d.severity)}</td><td>${esc(d.location)}</td><td>${esc(d.recommendation)}</td></tr>`).join('')}</table>
        <h2>Fiches désordres</h2>${defBlocks.join('')}` : '<p>Aucun désordre relevé lors de cette inspection.</p>'}
      ${gallery}
      <p class="small muted" style="margin-top:30px">Rapport établi le ${fmtDate(Date.now())}${settings.inspector ? ` par ${esc(settings.inspector)}` : ''}${settings.company ? ` — ${esc(settings.company)}` : ''}. Constat visuel réalisé par drone, sans sondage destructif ; les désordres signalés comme suggestions IA ont été vérifiés par l'opérateur avant diffusion.</p>`;
  };
  await build();

  const sum = $('#sum');
  let saveT;
  sum.oninput = () => { clearTimeout(saveT); saveT = setTimeout(async () => { p.summary = sum.value; await db.put('projects', p); }, 500); };
  sum.onchange = async () => { p.summary = sum.value; await db.put('projects', p); build(); };
  $('#incGal').onchange = async e => { p.reportGallery = e.target.checked; await db.put('projects', p); build(); };
  $('#print').onclick = () => window.print();
  $('#aiSum').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Rédaction…';
    try { p.summary = (await aiReportSummary(p, defects)).trim(); sum.value = p.summary; await db.put('projects', p); await build(); toast('Synthèse rédigée — relisez-la avant diffusion'); }
    catch (err) { toast(err.message, 6000); }
    b.disabled = false; b.textContent = '✨ Rédiger la synthèse (IA)';
  };
}

/* ============================== Vue : média (photo ou vidéo) ============================== */

async function viewMedia(view, id) {
  const m = await db.get('media', id);
  if (!m) { location.hash = '#/'; return; }
  const p = await db.get('projects', m.projectId);
  const siblings = (await db.byProject('media', m.projectId)).sort((a, b) => a.createdAt - b.createdAt);
  const idx = siblings.findIndex(s => s.id === id);
  const prev = siblings[idx - 1], next = siblings[idx + 1];
  view.innerHTML = `
    <div class="spread">
      <div class="small"><a href="#/p/${p.id}">← ${esc(p.name)}</a></div>
      <div class="row">${prev ? `<a class="btn sm" href="#/m/${prev.id}">‹ Préc.</a>` : ''}<span class="muted small">${idx + 1}/${siblings.length}</span>${next ? `<a class="btn sm" href="#/m/${next.id}">Suiv. ›</a>` : ''}</div>
    </div>
    <h2 style="overflow-wrap:anywhere">${esc(m.name)}</h2>
    <div id="mv"></div>`;
  const onKey = e => {
    if (e.target.closest('input,textarea,select,dialog')) return;
    if (e.key === 'ArrowRight' && e.altKey && next) location.hash = `#/m/${next.id}`;
    if (e.key === 'ArrowLeft' && e.altKey && prev) location.hash = `#/m/${prev.id}`;
  };
  document.addEventListener('keydown', onKey);
  const sub = m.type === 'video' ? await videoViewer($('#mv'), m, p) : await photoViewer($('#mv'), m, p);
  cleanup = () => { document.removeEventListener('keydown', onKey); sub?.(); };
}

function metaList(m) {
  const x = m.meta || {};
  const rows = [
    ['Taille', m.width ? `${m.width} × ${m.height} px` : ''], ['Fichier', fmtBytes(m.size || 0)],
    ['Prise de vue', x.date ? new Date(x.date).toLocaleString('fr-FR') : ''], ['Appareil', [x.make, x.model].filter(Boolean).join(' ')],
    ['GPS', x.lat ? `<a href="https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=19/${x.lat}/${x.lon}" target="_blank" rel="noopener">${x.lat}, ${x.lon}</a>` : ''],
    ['Altitude', x.alt !== undefined ? `${x.alt} m` : ''], ['Hauteur drone', x.relAlt !== undefined ? `${x.relAlt} m` : ''],
    ['Cap / nacelle', x.yaw !== undefined ? `${x.yaw}° / ${x.pitch ?? '—'}°` : ''],
    ['Durée', m.duration ? fmtTime(m.duration) : ''], ['Source', m.source ? `<a href="#/m/${m.source.mediaId}">Vidéo à ${fmtTime(m.source.time)}</a>` : ''],
  ].filter(r => r[1]);
  return `<dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

async function photoViewer(el, m, p) {
  let defects = (await db.byProject('defects', p.id)).filter(d => d.mediaId === m.id).sort((a, b) => a.num - b.num);
  let tool = 'rect', draft = null, selected = null;
  el.innerHTML = `
    <div class="viewer">
      <div>
        <div class="toolbar">
          <button class="btn sm" data-t="select">👆 Sélection</button>
          <button class="btn sm" data-t="rect">▭ Rectangle</button>
          <button class="btn sm" data-t="ellipse">◯ Cercle</button>
          <button class="btn sm" data-t="arrow">➚ Flèche</button>
          <button class="btn sm warn" id="ai">✨ Détecter (IA)</button>
        </div>
        <div class="stage" id="stage"><img id="img" src="${objURL(m.blob)}" alt=""><canvas id="cv"></canvas></div>
        <p class="small muted">Dessinez une zone sur la photo pour signaler un désordre. En mode Sélection, touchez une zone pour la modifier.</p>
      </div>
      <div class="side">
        <h3>Désordres sur cette photo</h3>
        <div id="dl"></div>
        <div id="aiSum"></div>
        <h3>Informations</h3>
        ${metaList(m)}
        <div class="row" style="margin-top:14px">
          <button class="btn sm" id="dlImg">Télécharger annotée</button>
          <button class="btn sm danger" id="delM">Supprimer</button>
        </div>
      </div>
    </div>`;
  const img = $('#img'), cv = $('#cv'), stage = $('#stage');
  await (img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; }));
  const ctx = cv.getContext('2d');
  const rectOf = () => {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const s = Math.min(r.width / nw, r.height / nh);
    const w = nw * s, h = nh * s;
    return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h, W: r.width, H: r.height, left: r.left, top: r.top };
  };
  const draw = () => {
    const R = rectOf(), dpr = window.devicePixelRatio || 1;
    cv.width = R.W * dpr; cv.height = R.H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, R.x * dpr, R.y * dpr);
    ctx.clearRect(-R.x, -R.y, R.W, R.H);
    for (const d of defects) if (d.shape) drawShape(ctx, d.shape, R.w, R.h, SEV_COLORS[d.severity], defRef(d), d === selected ? 4 : 2.5);
    if (draft) drawShape(ctx, draft, R.w, R.h, '#38bdf8', '', 2.5);
  };
  const pt = e => { const R = rectOf(); return { x: (e.clientX - R.left - R.x) / R.w, y: (e.clientY - R.top - R.y) / R.h }; };
  const hit = q => [...defects].reverse().find(d => {
    if (!d.shape) return false;
    const s = d.shape;
    if (s.kind === 'arrow') {
      const dx = s.w, dy = s.h, l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((q.x - s.x) * dx + (q.y - s.y) * dy) / l2));
      return Math.hypot(q.x - (s.x + t * dx), q.y - (s.y + t * dy)) < 0.03;
    }
    const b = shapeBounds(s); return q.x >= b.x - 0.01 && q.x <= b.x + b.w + 0.01 && q.y >= b.y - 0.01 && q.y <= b.y + b.h + 0.01;
  });
  const setTool = t => { tool = t; $$('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t)); stage.style.touchAction = t === 'select' ? 'auto' : 'none'; };
  $$('[data-t]').forEach(b => b.onclick = () => setTool(b.dataset.t));
  setTool('rect');

  const list = () => {
    $('#dl').innerHTML = defects.length ? defects.map(d => `<div class="ditem ${d === selected ? 'on' : ''}" data-id="${d.id}">
      <div class="row" style="justify-content:space-between"><b>${defRef(d)} · ${esc(d.type)}</b>${sevBadge(d.severity)}</div>
      <div class="small muted">${esc(d.location)}${d.location ? ' · ' : ''}${esc(d.status)}${d.ai ? ' · ✨ IA' : ''}</div>
      ${d.description ? `<div class="small">${esc(d.description)}</div>` : ''}</div>`).join('') : '<p class="muted small">Aucun désordre.</p>';
    $$('#dl .ditem').forEach(it => it.onclick = () => edit(defects.find(d => d.id === it.dataset.id)));
    $('#aiSum').innerHTML = m.aiSummary ? `<p class="small"><b>Analyse IA :</b> ${esc(m.aiSummary)}</p>` : '';
  };
  const edit = async d => {
    selected = d; draw(); list();
    const r = await defectDialog(d, false);
    if (r === 'deleted') defects = defects.filter(x => x !== d);
    selected = null; draw(); list();
  };

  let start = null;
  cv.onpointerdown = e => {
    const q = pt(e);
    if (tool === 'select') { const d = hit(q); if (d) edit(d); return; }
    cv.setPointerCapture(e.pointerId);
    start = q; draft = { kind: tool, x: q.x, y: q.y, w: 0, h: 0 };
  };
  cv.onpointermove = e => {
    if (!start) return;
    const q = pt(e);
    draft.w = Math.max(0, Math.min(1, q.x)) - start.x; draft.h = Math.max(0, Math.min(1, q.y)) - start.y; draw();
  };
  cv.onpointerup = async () => {
    if (!start) return;
    start = null;
    let sh = draft; draft = null;
    if (!sh || Math.hypot(sh.w, sh.h) < 0.015) {
      const d = hit({ x: sh.x, y: sh.y }); draw(); if (d) edit(d); return;
    }
    if (sh.kind !== 'arrow') sh = { kind: sh.kind, ...shapeBounds(sh) };
    const all = await db.byProject('defects', p.id);
    const d = { id: uid(), projectId: p.id, mediaId: m.id, num: all.reduce((a, x) => Math.max(a, x.num || 0), 0) + 1, createdAt: Date.now(), type: 'Fissure', severity: 2, location: '', description: '', recommendation: '', status: 'À traiter', shape: sh };
    defects.push(d); selected = d; draw();
    const r = await defectDialog(d, true);
    if (!r) defects = defects.filter(x => x !== d);
    selected = null; draw(); list();
  };
  const ro = new ResizeObserver(draw); ro.observe(img);
  draw(); list();

  $('#ai').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Analyse…';
    try {
      const created = await aiAnalyzePhoto(m, p);
      defects.push(...created); draw(); list();
      toast(created.length ? `${created.length} désordre(s) proposé(s) par l'IA — vérifiez-les` : 'Aucun désordre détecté', 5000);
    } catch (err) { toast(err.message, 6000); }
    b.disabled = false; b.textContent = '✨ Détecter (IA)';
  };
  $('#dlImg').onclick = async () => {
    const url = await annotatedImage(m, defects, 4000);
    download(await (await fetch(url)).blob(), m.name.replace(/\.[^.]+$/, '') + '-annote.jpg');
  };
  $('#delM').onclick = async () => {
    if (!await confirmDlg(`Supprimer cette photo et ses ${defects.length} désordre(s) ?`)) return;
    for (const d of defects) await db.del('defects', d.id);
    await db.del('media', m.id); location.hash = `#/p/${p.id}`;
  };
  return () => ro.disconnect();
}

async function videoViewer(el, m, p) {
  const settings = await getSettings();
  const captures = (await db.byProject('media', p.id)).filter(x => x.source?.mediaId === m.id);
  el.innerHTML = `
    <div class="viewer">
      <div>
        <div class="stage"><video id="vid" src="${objURL(m.blob)}" playsinline controls preload="auto"></video></div>
        <div class="timeline" id="tl"><div class="prog" id="prog"></div></div>
        <div class="toolbar">
          <button class="btn sm" id="back" title="Image précédente (,)">⏮ Image</button>
          <button class="btn sm" id="play">⏯ Lecture</button>
          <button class="btn sm" id="fwd" title="Image suivante (.)">Image ⏭</button>
          <select id="rate" style="width:auto"><option value="0.25">×0.25</option><option value="0.5">×0.5</option><option value="1" selected>×1</option><option value="2">×2</option><option value="4">×4</option></select>
          <span class="muted small" id="tc">00:00.0</span>
        </div>
        <div class="toolbar">
          <button class="btn sm primary" id="cap">📸 Capturer l'image (C)</button>
          <button class="btn sm" id="mark">📍 Repère (M)</button>
          <button class="btn sm" id="auto">🎞 Extraire des images…</button>
        </div>
        <p class="small muted">Capturez les images où un désordre est visible : elles deviennent des photos annotables, analysables par l'IA et intégrées au rapport.</p>
      </div>
      <div class="side">
        <h3>Repères</h3><div id="mk"></div>
        <h3>Images capturées (${captures.length})</h3>
        <div class="grid media" style="grid-template-columns:repeat(2,1fr);gap:8px">${captures.map(c => `<a class="thumb" href="#/m/${c.id}"><img src="${objURL(c.thumb || c.blob)}" alt=""><span class="name">${fmtTime(c.source.time)}</span></a>`).join('') || '<span class="muted small">Aucune.</span>'}</div>
        <h3>Informations</h3>${metaList(m)}
        <div class="row" style="margin-top:14px"><button class="btn sm danger" id="delM">Supprimer la vidéo</button></div>
      </div>
    </div>`;
  const v = $('#vid'), tl = $('#tl');
  const step = settings.frameStep || 1 / 30;
  const paintTl = () => {
    const D = v.duration || m.duration || 1;
    $('#prog').style.width = (v.currentTime / D * 100) + '%';
    $$('.mk', tl).forEach(n => n.remove());
    for (const k of m.markers || []) tl.insertAdjacentHTML('beforeend', `<div class="mk" style="left:${k.t / D * 100}%" title="${esc(k.note)}"></div>`);
    for (const c of captures) tl.insertAdjacentHTML('beforeend', `<div class="mk cap" style="left:${c.source.time / D * 100}%"></div>`);
    $('#tc').textContent = `${fmtTime(v.currentTime)} / ${fmtTime(D)}`;
  };
  const paintMk = () => {
    const list = [...(m.markers || [])].sort((a, b) => a.t - b.t);
    $('#mk').innerHTML = list.length ? list.map((k, i) => `<div class="ditem" data-t="${k.t}"><div class="row" style="justify-content:space-between"><b>${fmtTime(k.t)}</b><button class="btn sm danger" data-del="${i}" type="button">✕</button></div><div class="small">${esc(k.note)}</div></div>`).join('') : '<p class="muted small">Aucun repère.</p>';
    $$('#mk .ditem').forEach(it => it.onclick = e => {
      if (e.target.dataset.del !== undefined) { m.markers = list.filter((_, j) => j !== +e.target.dataset.del); db.put('media', m); paintMk(); paintTl(); return; }
      v.currentTime = +it.dataset.t;
    });
  };
  v.ontimeupdate = paintTl; v.onloadedmetadata = paintTl; v.onseeked = paintTl;
  tl.onclick = e => { const r = tl.getBoundingClientRect(); v.currentTime = (e.clientX - r.left) / r.width * (v.duration || 0); };
  $('#back').onclick = () => { v.pause(); v.currentTime = Math.max(0, v.currentTime - step); };
  $('#fwd').onclick = () => { v.pause(); v.currentTime = Math.min(v.duration, v.currentTime + step); };
  $('#play').onclick = () => v.paused ? v.play() : v.pause();
  $('#rate').onchange = e => { v.playbackRate = +e.target.value; };
  const capture = async () => {
    v.pause();
    const c = await captureFrame(v, m);
    captures.push(c); toast(`Image capturée à ${fmtTime(c.source.time)}`);
    paintTl();
    return c;
  };
  $('#cap').onclick = async () => { const c = await capture(); location.hash = `#/m/${c.id}`; };
  const addMark = async () => {
    v.pause();
    const t = v.currentTime;
    const r = await dialog(`<h2>Repère à ${fmtTime(t)}</h2><label class="f"><span>Note</span><input name="note" placeholder="Fissure visible sur le pignon"></label><div class="row" style="justify-content:flex-end"><button class="btn" value="cancel" formnovalidate>Annuler</button><button class="btn primary">Ajouter</button></div>`);
    if (!r) return;
    m.markers = [...(m.markers || []), { t, note: r.data.note }]; await db.put('media', m); paintMk(); paintTl();
  };
  $('#mark').onclick = addMark;
  $('#auto').onclick = async () => {
    const r = await dialog(`<h2>Extraire des images</h2><p class="muted small">Crée automatiquement des photos à intervalle régulier (utile pour une analyse IA complète d'un vol).</p>
      <label class="f"><span>Une image toutes les (secondes)</span><input type="number" name="every" min="0.5" step="0.5" value="5"></label>
      <div class="row" style="justify-content:flex-end"><button class="btn" value="cancel" formnovalidate>Annuler</button><button class="btn primary">Extraire</button></div>`);
    if (!r) return;
    const every = Math.max(0.5, +r.data.every || 5), D = v.duration;
    const times = []; for (let t = 0.2; t < D && times.length < 120; t += every) times.push(t);
    v.pause();
    for (let i = 0; i < times.length; i++) {
      toast(`Extraction ${i + 1}/${times.length}`, 60000);
      await new Promise(res => { v.onseeked = () => res(); v.currentTime = times[i]; });
      await capture();
    }
    v.onseeked = paintTl;
    toast(`${times.length} images extraites`); render();
  };
  const onKey = e => {
    if (e.target.closest('input,textarea,select,dialog')) return;
    if (e.key === ',') $('#back').click();
    else if (e.key === '.') $('#fwd').click();
    else if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    else if (e.key.toLowerCase() === 'c') $('#cap').click();
    else if (e.key.toLowerCase() === 'm') addMark();
  };
  document.addEventListener('keydown', onKey);
  $('#delM').onclick = async () => {
    if (!await confirmDlg('Supprimer cette vidéo ? Les images capturées sont conservées.')) return;
    await db.del('media', m.id); location.hash = `#/p/${p.id}`;
  };
  paintMk(); paintTl();
  return () => { document.removeEventListener('keydown', onKey); v.pause(); };
}

/* ============================== Vue : réglages ============================== */

async function viewSettings(view) {
  const s = await getSettings();
  let est = '';
  try { const e = await navigator.storage.estimate(); est = `${fmtBytes(e.usage || 0)} utilisés sur ${fmtBytes(e.quota || 0)} disponibles`; } catch (e) {}
  view.innerHTML = `
    <h1>Réglages</h1>
    <form class="card" id="sf">
      <h3>Identité (apparaît sur les rapports)</h3>
      <div class="cols2">
        <label class="f"><span>Inspecteur / télépilote</span><input name="inspector" value="${esc(s.inspector)}"></label>
        <label class="f"><span>Entreprise</span><input name="company" value="${esc(s.company)}"></label>
      </div>
      <label class="f"><span>Logo</span><input type="file" accept="image/*" id="logo"></label>
      ${s.logo ? `<div class="row"><img src="${s.logo}" alt="" style="max-height:50px;background:#fff;border-radius:6px;padding:4px"><button type="button" class="btn sm" id="rmLogo">Retirer</button></div>` : ''}
      <h3 style="margin-top:18px">Analyse IA (Claude)</h3>
      <p class="small muted">La détection automatique des désordres et la rédaction des synthèses utilisent l'API Claude d'Anthropic. Créez une clé sur console.anthropic.com. La clé reste sur cet appareil ; seules les photos que vous analysez sont envoyées à l'API.</p>
      <label class="f"><span>Clé API Anthropic</span><input name="apiKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…"></label>
      <label class="f"><span>Modèle</span><input name="model" value="${esc(s.model)}"></label>
      <h3 style="margin-top:18px">Vidéo</h3>
      <label class="f"><span>Pas image par image</span><select name="frameStep">${[[1 / 24, '24 i/s'], [1 / 25, '25 i/s'], [1 / 30, '30 i/s'], [1 / 50, '50 i/s'], [1 / 60, '60 i/s']].map(([v, l]) => `<option value="${v}" ${Math.abs(v - s.frameStep) < 1e-6 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn primary">Enregistrer</button>
    </form>
    <div class="card" style="margin-top:16px">
      <h3>Stockage</h3>
      <p class="small muted">${est || 'Inconnu'}. Les projets sont stockés dans le navigateur de cet appareil. Exportez régulièrement une sauvegarde (Projet → Infos) pour les transférer entre votre Mac et votre téléphone.</p>
    </div>`;
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await db.kvSet('settings', { ...s, ...d, frameStep: +d.frameStep, model: d.model.trim() || DEFAULT_MODEL, apiKey: d.apiKey.trim() });
    toast('Réglages enregistrés');
  };
  $('#logo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const r = await resizeBlob(f, 400, 0.9);
    s.logo = r.canvas.toDataURL('image/png'); await db.kvSet('settings', s); render();
  };
  const rm = $('#rmLogo'); if (rm) rm.onclick = async () => { s.logo = ''; await db.kvSet('settings', s); render(); };
}

/* ============================== Sauvegarde / transfert ============================== */

async function exportBackup(p, media, defects) {
  const out = { app: 'regards', version: 1, exportedAt: new Date().toISOString(), project: p, defects, media: [] };
  for (const m of media) {
    const { blob, thumb, ...rest } = m;
    out.media.push({ ...rest, data: blob ? await blobToBase64(blob) : null, thumbData: thumb ? await blobToBase64(thumb) : null });
  }
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), `${p.name.replace(/[^\w\- ]+/g, '_')} - regards.json`);
}
async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'regards' || !data.project) throw new Error('Fichier non reconnu');
  await db.put('projects', { ...data.project, updatedAt: Date.now() });
  for (const m of data.media || []) {
    const { data: b64, thumbData, ...rest } = m;
    await db.put('media', { ...rest, blob: b64 ? base64ToBlob(b64, m.mime) : null, thumb: thumbData ? base64ToBlob(thumbData, 'image/jpeg') : null });
  }
  for (const d of data.defects || []) await db.put('defects', d);
  return data.project.id;
}

/* ============================== Démarrage ============================== */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
