'use strict';

/* ============================================================
   Gym Tracker — PWA local. Todos los datos viven en localStorage.
   ============================================================ */

const APP_VERSION = 7; // súbela junto con CACHE en sw.js
const STORE_KEY = 'gymtracker.v1';
const TIMER_KEY = 'gymtracker.timer';

const PRESET_EXERCISES = [
  'Sentadilla', 'Sentadilla búlgara', 'Prensa', 'Peso muerto', 'Peso muerto rumano', 'Hip thrust',
  'Zancadas', 'Extensión de cuádriceps', 'Curl femoral', 'Elevación de gemelos', 'Abductores', 'Aductores',
  'Press banca', 'Press inclinado con mancuernas', 'Aperturas', 'Fondos', 'Flexiones',
  'Press militar', 'Elevaciones laterales', 'Pájaros', 'Face pull',
  'Dominadas', 'Jalón al pecho', 'Remo con barra', 'Remo con mancuerna', 'Remo en polea baja',
  'Curl de bíceps', 'Curl martillo', 'Extensión de tríceps en polea', 'Press francés',
  'Plancha', 'Crunch', 'Elevación de piernas', 'Rueda abdominal',
];

const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
// Clave de un ejercicio: sin mayúsculas, tildes ni espacios de más ("Press Bánca " = "press banca")
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const REST_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtClock = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
const fmtDuration = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const fmtDate = (ts, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(ts).toLocaleDateString('es-ES', opts);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtTime =(ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const fmtSet = (s) => (s.w !== '' && s.w != null ? `${s.w} kg × ${s.r}` : `${s.r} reps`);

/* ---------- Datos ---------- */

function seed() {
  const gymId = uid();
  return {
    version: 1,
    settings: { defaultRest: 90, sound: true, vibrate: true, currentGym: gymId },
    // Gimnasios: cada entreno guarda en cuál se hizo; las rutinas pueden ser de uno o de todos (gymId null)
    gyms: [{ id: gymId, name: 'Habitual' }],
    routines: [{
      id: uid(),
      name: 'Ejemplo · Full body',
      exercises: [
        { name: 'Sentadilla', sets: 3, reps: 8, rest: 120 },
        { name: 'Press banca', sets: 3, reps: 8, rest: 120 },
        { name: 'Remo con barra', sets: 3, reps: 10, rest: 90 },
        { name: 'Press militar', sets: 3, reps: 10, rest: 90 },
      ],
    }],
    workouts: [],
    // Biblioteca de ejercicios (clave: norm(nombre)) → { name, notes: { gymId: texto }, rest, reps }
    // Es independiente de las rutinas: borrar una rutina no borra nada de aquí.
    library: {},
    active: null,
  };
}

function migrate(d) {
  const base = seed();
  const out = {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    gyms: Array.isArray(d.gyms) && d.gyms.length ? d.gyms : base.gyms,
    routines: Array.isArray(d.routines) ? d.routines : [],
    workouts: Array.isArray(d.workouts) ? d.workouts : [],
    library: {},
    active: d.active || null,
  };
  if (!out.gyms.some((g) => g.id === out.settings.currentGym)) out.settings.currentGym = out.gyms[0].id;
  const firstGym = out.gyms[0].id;
  // Lo anterior a tener gimnasios se hizo en el primero ("Habitual")
  out.workouts.forEach((w) => { if (!w.gymId) w.gymId = firstGym; });
  if (out.active && !out.active.gymId) out.active.gymId = out.settings.currentGym;

  if (d.library && typeof d.library === 'object') {
    Object.values(d.library).forEach((e) => { if (e && e.name) out.library[norm(e.name)] = { ...e }; });
  }
  // Versión anterior: las notas iban aparte, con la clave en minúsculas
  if (d.notes && typeof d.notes === 'object') {
    Object.entries(d.notes).forEach(([k, note]) => {
      const key = norm(k);
      out.library[key] = { name: out.library[key]?.name || cap(k), ...out.library[key], note };
    });
  }
  // Versión anterior: una sola nota por ejercicio → pasa a ser la del primer gimnasio
  Object.values(out.library).forEach((e) => {
    if (e.note) { e.notes = { [firstGym]: e.note, ...(e.notes || {}) }; }
    delete e.note;
  });
  return out;
}

function load() {
  let d;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) d = migrate(JSON.parse(raw));
  } catch (e) { console.error(e); }
  d = d || seed();
  syncLibrary(d);
  return d;
}

// Asegura que todo ejercicio usado en rutinas o entrenos tenga su ficha en la biblioteca
function syncLibrary(d = db) {
  const add = (name, extra) => { const k = norm(name); if (k && !d.library[k]) d.library[k] = { name: name.trim(), ...extra }; };
  d.routines.forEach((r) => r.exercises.forEach((e) => add(e.name, { rest: e.rest, reps: e.reps })));
  d.workouts.forEach((w) => w.exercises.forEach((e) => add(e.name)));
  if (d.active) d.active.exercises.forEach((e) => add(e.name));
}

let db = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('No se pudo guardar 😬'); console.error(e); }
}

// Pide al navegador que no borre los datos si falta espacio
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- Consultas ---------- */

const libEntry = (name) => db.library[norm(name)] || null;
function ensureLib(name) {
  const k = norm(name);
  if (!k) return null;
  return (db.library[k] ||= { name: String(name).trim() });
}

/* Gimnasios */
const currentGym = () => db.settings.currentGym;
const gymName = (id) => db.gyms.find((g) => g.id === id)?.name || '¿?';
const multiGym = () => db.gyms.length > 1;
const PIN = '<svg class="pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';

// Las notas (altura de polea, asiento…) dependen de la máquina, así que van por gimnasio
const getNote = (name, gymId = currentGym()) => libEntry(name)?.notes?.[gymId] || '';
function setNote(name, text, gymId = currentGym()) {
  const e = ensureLib(name);
  if (!e) return;
  e.notes ||= {};
  if (text.trim()) e.notes[gymId] = text; else delete e.notes[gymId];
}
const hasAnyNote = (e) => Object.values(e.notes || {}).some(Boolean);

const restFor = (name) => libEntry(name)?.rest || db.settings.defaultRest;
const repsFor = (name) => libEntry(name)?.reps || '';

function exerciseStats(name) {
  const k = norm(name);
  let sessions = 0, last = null;
  for (const w of db.workouts) {
    if (w.exercises.some((e) => norm(e.name) === k)) { sessions++; if (!last || w.start > last) last = w.start; }
  }
  return { sessions, last, best: bestWeightFor(name) };
}

// Cambia el nombre de un ejercicio en todas partes. Si el nombre nuevo ya existe, los fusiona.
function renameExercise(oldName, newName) {
  const kOld = norm(oldName), kNew = norm(newName);
  newName = newName.trim();
  if (!kNew) return;
  const fix = (e) => { if (norm(e.name) === kOld) e.name = newName; };
  db.workouts.forEach((w) => w.exercises.forEach(fix));
  db.routines.forEach((r) => r.exercises.forEach(fix));
  if (db.active) db.active.exercises.forEach(fix);

  const src = db.library[kOld] || { name: oldName };
  if (kNew !== kOld && db.library[kNew]) {
    const dst = db.library[kNew];
    dst.notes ||= {};
    Object.entries(src.notes || {}).forEach(([g, txt]) => {
      dst.notes[g] = [dst.notes[g], txt].filter(Boolean).join('\n');
    });
    dst.rest ||= src.rest;
    dst.reps ||= src.reps;
    delete db.library[kOld];
  } else {
    delete db.library[kOld];
    db.library[kNew] = { ...src, name: newName };
  }
  save();
  refreshDatalist();
}

function notePlaceholder(gymId = currentGym()) {
  return multiGym() ? `Nota en ${gymName(gymId)}: polea, asiento, agarre…` : 'Nota: altura de polea, asiento, agarre…';
}

function noteBox(name) {
  return `<textarea class="ex-note" rows="1" data-note="${esc(name)}" placeholder="${esc(notePlaceholder())}">${esc(getNote(name))}</textarea>`;
}

// Ajusta la altura de las notas a su contenido
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
function autosizeAll(root = document) { root.querySelectorAll('textarea.ex-note').forEach(autosize); }

const sortedWorkouts = () => [...db.workouts].sort((a, b) => b.start - a.start);

// Última vez que se hizo el ejercicio: primero en ese gimnasio; si nunca, en cualquier otro (other: true)
function lastSetsFor(name, beforeTs = Infinity, gymId = currentGym()) {
  const n = norm(name);
  let fallback = null;
  for (const w of sortedWorkouts()) {
    if (w.start >= beforeTs) continue;
    const ex = w.exercises.find((e) => norm(e.name) === n);
    if (!ex || !ex.sets.length) continue;
    if (w.gymId === gymId) return { sets: ex.sets, date: w.start, gymId: w.gymId, other: false };
    fallback ||= { sets: ex.sets, date: w.start, gymId: w.gymId, other: true };
  }
  return fallback;
}

// gymId opcional: si se pasa, solo cuenta ese gimnasio (las máquinas de otro no son comparables)
function bestWeightFor(name, beforeTs = Infinity, gymId = null) {
  const n = norm(name);
  let best = null;
  for (const w of db.workouts) {
    if (w.start >= beforeTs) continue;
    if (gymId && w.gymId !== gymId) continue;
    for (const e of w.exercises) {
      if (norm(e.name) !== n) continue;
      for (const s of e.sets) { const v = num(s.w); if (v != null && (best == null || v > best)) best = v; }
    }
  }
  return best;
}

function allExerciseNames() {
  const map = new Map();
  const add = (n) => { if (n && !map.has(norm(n))) map.set(norm(n), n.trim()); };
  Object.values(db.library).forEach((e) => add(e.name));
  PRESET_EXERCISES.forEach(add);
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

function refreshDatalist() {
  $('#exercise-list').innerHTML = allExerciseNames().map((n) => `<option value="${esc(n)}">`).join('');
}

/* ---------- Navegación ---------- */

let tab = 'hoy';
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = $('#view');
  $('#topbar-extra').innerHTML = '';
  if (tab === 'hoy') view.innerHTML = db.active ? renderActive() : renderHoy();
  else if (tab === 'rutinas') view.innerHTML = renderRutinas();
  else if (tab === 'ejercicios') view.innerHTML = renderEjercicios();
  else if (tab === 'calendario') view.innerHTML = renderCalendario();
  else if (tab === 'ajustes') view.innerHTML = renderAjustes();
  updateElapsed();
  updateFab();
  autosizeAll(view);
}

/* ---------- Vista: Hoy (sin entreno activo) ---------- */

function renderHoy() {
  $('#title').textContent = 'Hoy';
  $('#topbar-extra').innerHTML = `<span class="sub">${esc(fmtDate(Date.now(), { weekday: 'short', day: 'numeric', month: 'short' }))}</span>`;

  const todays = db.workouts.filter((w) => dateKey(w.start) === dateKey(Date.now()));
  const last = sortedWorkouts()[0];

  let html = gymChip();
  if (todays.length) {
    html += `<div class="card" style="border-color:var(--ok);background:var(--ok-soft)">
      <h3>Hoy ya has entrenado ✓</h3>
      <div class="muted small">${todays.map((w) => esc(w.name)).join(' · ')}</div>
    </div>`;
  }

  const routines = routinesForGym();
  const hidden = db.routines.length - routines.length;
  html += `<div class="section-title">Empezar entreno</div>`;
  if (routines.length) {
    html += routines.map((r) => `
      <div class="card routine-card">
        <div class="info">
          <h3>${esc(r.name)}</h3>
          <p>${r.exercises.map((e) => esc(e.name)).join(' · ') || 'Sin ejercicios'}</p>
        </div>
        <button class="btn primary sm" data-action="start" data-id="${r.id}">Empezar</button>
      </div>`).join('');
  } else {
    html += `<div class="card muted small">${hidden
      ? `No hay rutinas para ${esc(gymName(currentGym()))}. En <b>Rutinas</b> puedes duplicar una y adaptarla a este gimnasio.`
      : 'Aún no tienes rutinas. Créalas en la pestaña <b>Rutinas</b>.'}</div>`;
  }
  if (hidden && routines.length) {
    html += `<div class="muted small" style="margin:-4px 4px 12px">${hidden} ${hidden === 1 ? 'rutina oculta' : 'rutinas ocultas'} de otros gimnasios</div>`;
  }
  html += `<button class="btn block" data-action="start-free">＋ Entreno libre</button>`;

  if (last) {
    html += `<div class="section-title">Último entreno</div>`;
    html += workoutCard(last);
  }
  return html;
}

/* ---------- Gimnasios ---------- */

const routinesForGym = (gymId = currentGym()) => db.routines.filter((r) => !r.gymId || r.gymId === gymId);

function gymChip() {
  return `<button class="gym-chip" data-action="gym-menu">${PIN}<span>${esc(gymName(currentGym()))}</span> <span class="muted">▾</span></button>`;
}

function openGymMenu() {
  const usedBy = (id) => db.workouts.some((w) => w.gymId === id) || db.routines.some((r) => r.gymId === id);
  openSheet(`<h2>¿Dónde entrenas hoy?</h2>
    <div class="muted small" style="margin-bottom:14px">Cada gimnasio guarda sus propios pesos y notas de máquinas, y puede tener sus rutinas.</div>
    ${db.gyms.map((g) => `
      <div class="card gym-row ${g.id === currentGym() ? 'selected' : ''}">
        <button class="grow gym-pick" data-action="gym-select" data-id="${g.id}">
          <span class="radio"></span><b>${esc(g.name)}</b>
        </button>
        <button class="icon-btn" data-action="gym-rename" data-id="${g.id}" aria-label="Renombrar">✏️</button>
        ${db.gyms.length > 1 && !usedBy(g.id) ? `<button class="icon-btn" data-action="gym-delete" data-id="${g.id}" aria-label="Borrar">🗑</button>` : ''}
      </div>`).join('')}
    <div class="add-ex" style="margin-top:6px">
      <input id="new-gym" placeholder="Nuevo gimnasio…" autocomplete="off" enterkeyhint="done">
      <button class="btn" data-action="gym-add">Añadir</button>
    </div>`, 'gyms');
}

function selectGym(id) {
  db.settings.currentGym = id;
  if (db.active) db.active.gymId = id;
  save();
  closeSheet();
  render();
  toast(`Entrenando en ${gymName(id)}`);
}

function addGym() {
  const input = $('#new-gym');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const g = { id: uid(), name };
  db.gyms.push(g);
  selectGym(g.id);
}

function workoutCard(w) {
  return `<div class="card" data-action="open-workout" data-id="${w.id}">
    <div class="row between">
      <h3>${esc(w.name)}</h3>
      <span class="muted small">${esc(fmtDate(w.start, { day: 'numeric', month: 'short' }))}</span>
    </div>
    <div class="muted small">${multiGym() ? `${PIN}${esc(gymName(w.gymId))} · ` : ''}${plural(w.exercises.length, 'ejercicio')} · ${plural(w.exercises.reduce((a, e) => a + e.sets.length, 0), 'serie')}${w.end ? ' · ' + fmtDuration(w.end - w.start) : ''}</div>
  </div>`;
}

/* ---------- Vista: entreno activo ---------- */

function renderActive() {
  const a = db.active;
  $('#title').textContent = a.name;
  $('#topbar-extra').innerHTML = `<span class="sub" id="elapsed"></span>`;

  let html = gymChip();
  if (!a.exercises.length) {
    html += `<div class="empty"><div class="big">🏋️</div>Añade tu primer ejercicio abajo</div>`;
  }

  a.exercises.forEach((ex, ei) => {
    const last = lastSetsFor(ex.name, a.start, a.gymId);
    const best = bestWeightFor(ex.name, a.start, a.gymId);
    const lastTxt = !last ? 'Primera vez con este ejercicio'
      : last.other ? `Aquí es la 1ª vez · en ${gymName(last.gymId)}: ${last.sets.map(fmtSet).join(', ')}`
      : `Última vez: ${last.sets.map(fmtSet).join(', ')}`;
    html += `<div class="card ex-card">
      <div class="ex-head">
        <div class="grow">
          <button class="ex-name" data-action="history" data-name="${esc(ex.name)}">${esc(ex.name)} ›</button>
          <div class="ex-last">${esc(lastTxt)}</div>
        </div>
        <button class="icon-btn" data-action="move-ex" data-ei="${ei}" data-dir="-1" aria-label="Subir">↑</button>
        <button class="icon-btn" data-action="remove-ex" data-ei="${ei}" aria-label="Quitar">✕</button>
      </div>
      ${noteBox(ex.name)}
      <div class="sets-head"><span>#</span><span>kg</span><span>reps</span><span></span></div>
      ${ex.sets.map((s, si) => {
        const prev = last ? (last.sets[si] || last.sets[last.sets.length - 1]) : null;
        const before = si > 0 ? ex.sets[si - 1] : null; // serie anterior de hoy
        const phW = prev && prev.w !== '' ? prev.w : (before && before.w) || '';
        const phR = prev ? prev.r : (ex.targetReps || (before && before.r) || '');
        const isPR = s.done && best != null && num(s.w) != null && num(s.w) > best;
        return `<div class="set-row ${s.done ? 'done' : ''}">
          <div class="num">${si + 1}</div>
          <input inputmode="decimal" data-field="w" data-ei="${ei}" data-si="${si}" value="${esc(s.w)}" placeholder="${esc(phW || '—')}">
          <input inputmode="numeric" data-field="r" data-ei="${ei}" data-si="${si}" value="${esc(s.r)}" placeholder="${esc(phR || '—')}">
          <button class="check" data-action="toggle-set" data-ei="${ei}" data-si="${si}" aria-label="Hecha">${isPR ? '🏆' : '✓'}</button>
        </div>`;
      }).join('')}
      <div class="ex-actions">
        <button class="btn sm" data-action="add-set" data-ei="${ei}">＋ Serie</button>
        <button class="btn sm ghost" data-action="remove-set" data-ei="${ei}" ${ex.sets.length ? '' : 'disabled'}>− Serie</button>
        <button class="btn sm ghost" data-action="timer-start" data-sec="${ex.rest || db.settings.defaultRest}">⏱ ${fmtClock(ex.rest || db.settings.defaultRest)}</button>
      </div>
    </div>`;
  });

  html += `<div class="add-ex">
      <input id="new-ex" list="exercise-list" placeholder="Añadir ejercicio…" enterkeyhint="done" autocomplete="off">
      <button class="btn" data-action="add-ex">Añadir</button>
    </div>
    <div class="stack" style="margin-top:22px">
      <button class="btn ok block" data-action="finish">✔ Terminar entreno</button>
      <button class="btn ghost block danger" data-action="discard">Descartar entreno</button>
    </div>`;
  return html;
}

function newSet() { return { w: '', r: '', done: false }; }

function startWorkout(routine) {
  db.active = {
    id: uid(),
    routineId: routine ? routine.id : null,
    name: routine ? routine.name : 'Entreno libre',
    gymId: currentGym(),
    start: Date.now(),
    exercises: routine
      ? routine.exercises.map((e) => ({
          name: e.name, rest: e.rest || restFor(e.name), targetReps: e.reps || repsFor(e.name),
          sets: Array.from({ length: Math.max(1, e.sets || 3) }, newSet),
        }))
      : [],
  };
  save();
  requestWakeLock();
  setTab('hoy');
}

function finishWorkout() {
  const a = db.active;
  const exercises = a.exercises
    .map((e) => ({ name: e.name, sets: e.sets.filter((s) => s.done).map((s) => ({ w: s.w, r: s.r })) }))
    .filter((e) => e.sets.length);
  if (!exercises.length) {
    if (confirm('No has marcado ninguna serie como hecha. ¿Descartar el entreno?')) { db.active = null; save(); render(); }
    return;
  }
  db.workouts.push({ id: a.id, routineId: a.routineId, gymId: a.gymId || currentGym(), name: a.name, start: a.start, end: Date.now(), exercises });
  db.active = null;
  syncLibrary();
  save();
  stopTimer();
  releaseWakeLock();
  refreshDatalist();
  render();
  toast('¡Entreno guardado! 💪');
}

/* ---------- Vista: rutinas ---------- */

function renderRutinas() {
  $('#title').textContent = 'Rutinas';
  let html = '';
  if (!db.routines.length) {
    html += `<div class="empty"><div class="big">📋</div>Crea tu primera rutina:<br>por ejemplo “Pierna” o “Empuje”.</div>`;
  }
  // Primero las del gimnasio actual
  const here = (r) => (!r.gymId || r.gymId === currentGym() ? 0 : 1);
  html += [...db.routines].sort((a, b) => here(a) - here(b)).map((r) => `
    <div class="card ${here(r) ? 'dim' : ''}">
      <div class="row between">
        <h3>${esc(r.name)}</h3>
        <button class="btn sm" data-action="edit-routine" data-id="${r.id}">Editar</button>
      </div>
      ${multiGym() ? `<div class="gym-tag">${PIN}${r.gymId ? esc(gymName(r.gymId)) : 'Todos los gimnasios'}</div>` : ''}
      <div class="muted small" style="margin:6px 0 12px">
        ${r.exercises.map((e) => `${esc(e.name)} <span style="opacity:.7">${e.sets}×${e.reps}</span>`).join('<br>') || 'Sin ejercicios'}
      </div>
      <button class="btn primary block sm" data-action="start" data-id="${r.id}">Empezar</button>
    </div>`).join('');
  html += `<button class="btn block" data-action="new-routine">＋ Nueva rutina</button>`;
  return html;
}

let draft = null; // copia de la rutina que se está editando

function openRoutineEditor(id) {
  const r = db.routines.find((x) => x.id === id);
  draft = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), name: '', gymId: null, exercises: [], isNew: true };
  loadDraftNotes();
  openSheet(renderRoutineEditor(), 'routine');
  if (!r) setTimeout(() => $('#r-name')?.focus(), 300);
}

// Las notas del editor son las del gimnasio de la rutina (o el actual si es para todos)
const draftNoteGym = () => draft.gymId || currentGym();
function loadDraftNotes() { draft.exercises.forEach((e) => { e.note = getNote(e.name, draftNoteGym()); }); }

function duplicateRoutine() {
  const copy = JSON.parse(JSON.stringify(draft));
  copy.id = uid();
  copy.name = `${draft.name} (${gymName(currentGym())})`;
  copy.gymId = currentGym();
  copy.isNew = true;
  draft = copy;
  loadDraftNotes();
  rerenderEditor();
  $('#sheet').scrollTop = 0;
  toast('Copia creada: cambia lo que sea distinto y guarda');
}

function renderRoutineEditor() {
  const d = draft;
  const gymOpts = `<option value="">Todos los gimnasios</option>` +
    db.gyms.map((g) => `<option value="${g.id}" ${g.id === d.gymId ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  return `<h2>${d.isNew ? 'Nueva rutina' : 'Editar rutina'}</h2>
    <label class="field-label">Nombre</label>
    <input id="r-name" data-rfield="name" value="${esc(d.name)}" placeholder="Ej: Pierna">
    ${multiGym() ? `<label class="field-label" style="margin-top:12px">Gimnasio</label>
      <select data-rfield="gymId">${gymOpts}</select>` : ''}
    <div class="section-title">Ejercicios</div>
    ${d.exercises.map((e, i) => `
      <div class="edit-ex">
        <div class="row">
          <input class="grow" list="exercise-list" data-efield="name" data-i="${i}" value="${esc(e.name)}" placeholder="Ejercicio" autocomplete="off">
          <button class="icon-btn" data-action="rex-move" data-i="${i}" data-dir="-1">↑</button>
          <button class="icon-btn" data-action="rex-del" data-i="${i}">✕</button>
        </div>
        <div class="grid3">
          <div><label>Series</label><input inputmode="numeric" data-efield="sets" data-i="${i}" value="${esc(e.sets)}"></div>
          <div><label>Reps</label><input inputmode="numeric" data-efield="reps" data-i="${i}" value="${esc(e.reps)}"></div>
          <div><label>Descanso s</label><input inputmode="numeric" data-efield="rest" data-i="${i}" value="${esc(e.rest)}"></div>
        </div>
        <textarea class="ex-note" rows="1" data-efield="note" data-i="${i}" placeholder="${esc(notePlaceholder(draftNoteGym()))}">${esc(e.note || '')}</textarea>
      </div>`).join('')}
    <button class="btn block" data-action="rex-add">＋ Añadir ejercicio</button>
    <div class="stack" style="margin-top:20px">
      <button class="btn primary block" data-action="routine-save">Guardar</button>
      ${d.isNew || !multiGym() ? '' : `<button class="btn block" data-action="routine-duplicate">⧉ Duplicar para ${esc(gymName(currentGym()))}</button>`}
      ${d.isNew ? '' : '<button class="btn ghost danger block" data-action="routine-delete">Eliminar rutina</button>'}
    </div>`;
}

function rerenderEditor() {
  $('#sheet-body').innerHTML = renderRoutineEditor();
  autosizeAll($('#sheet'));
}

function saveRoutine() {
  const d = draft;
  d.name = d.name.trim();
  if (!d.name) { toast('Ponle un nombre a la rutina'); return; }
  d.gymId = d.gymId || null;
  d.exercises.forEach((e) => { if (e.note != null) setNote(e.name, e.note, draftNoteGym()); });
  d.exercises = d.exercises
    .filter((e) => String(e.name).trim())
    .map((e) => ({
      name: String(e.name).trim(),
      sets: Math.max(1, parseInt(e.sets, 10) || 3),
      reps: parseInt(e.reps, 10) || 10,
      rest: parseInt(e.rest, 10) || db.settings.defaultRest,
    }));
  // El ejercicio recuerda su descanso y reps aunque luego se borre la rutina
  d.exercises.forEach((e) => { const lib = ensureLib(e.name); lib.rest = e.rest; lib.reps = e.reps; });
  delete d.isNew;
  const i = db.routines.findIndex((r) => r.id === d.id);
  if (i >= 0) db.routines[i] = d; else db.routines.push(d);
  save();
  refreshDatalist();
  closeSheet();
  render();
  toast('Rutina guardada');
}

/* ---------- Vista: calendario ---------- */

function renderCalendario() {
  $('#title').textContent = 'Calendario';
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const byDay = {};
  db.workouts.forEach((w) => { (byDay[dateKey(w.start)] ||= []).push(w); });
  const todayK = dateKey(Date.now());

  let cells = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) cells += `<div class="cal-day out"></div>`;
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const has = byDay[k];
    cells += `<button class="cal-day ${has ? 'has' : ''} ${k === todayK ? 'today' : ''}" data-action="open-day" data-date="${k}">
      ${d}${has ? '<span class="dot"></span>' : ''}
    </button>`;
  }

  const monthW = db.workouts.filter((w) => { const d = new Date(w.start); return d.getFullYear() === y && d.getMonth() === m; });
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const weekCount = new Set(db.workouts.filter((w) => w.start >= weekStart).map((w) => dateKey(w.start))).size;
  const monthDays = new Set(monthW.map((w) => dateKey(w.start))).size;

  let html = `<div class="cal-head">
      <button class="icon-btn" data-action="cal-move" data-dir="-1">‹</button>
      <h2>${esc(cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })))}</h2>
      <button class="icon-btn" data-action="cal-move" data-dir="1">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="stats">
      <div class="stat"><b>${weekCount}</b><span>Esta semana</span></div>
      <div class="stat"><b>${monthDays}</b><span>Este mes</span></div>
      <div class="stat"><b>${db.workouts.length}</b><span>Total</span></div>
    </div>`;

  if (monthW.length) {
    html += `<div class="section-title">Entrenos del mes</div>`;
    html += monthW.sort((a, b) => b.start - a.start).map(workoutCard).join('');
  }
  return html;
}

function workoutDetail(w) {
  return `<div class="card">
    <div class="row between">
      <h3>${esc(w.name)}</h3>
      <button class="icon-btn" data-action="delete-workout" data-id="${w.id}" aria-label="Borrar">🗑</button>
    </div>
    <div class="muted small" style="margin-bottom:8px">${fmtTime(w.start)}${w.end ? ' · ' + fmtDuration(w.end - w.start) : ''}</div>
    ${w.exercises.map((e) => {
      const best = bestWeightFor(e.name, w.start, w.gymId);
      const pr = best != null && e.sets.some((s) => num(s.w) != null && num(s.w) > best);
      return `<div class="log-ex">
        <div class="name">${esc(e.name)}${pr ? '<span class="pr-badge">RÉCORD</span>' : ''}</div>
        <div class="sets">${e.sets.map(fmtSet).map(esc).join(' · ')}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function openDay(k) {
  const list = db.workouts.filter((w) => dateKey(w.start) === k).sort((a, b) => a.start - b.start);
  const [y, m, d] = k.split('-').map(Number);
  const title = fmtDate(new Date(y, m - 1, d));
  openSheet(`<h2>${esc(cap(title))}</h2>
    ${list.length ? list.map(workoutDetail).join('') : '<div class="empty"><div class="big">😴</div>Día de descanso</div>'}`, 'day', k);
}

function openWorkout(id) {
  const w = db.workouts.find((x) => x.id === id);
  if (w) openDay(dateKey(w.start));
}

/* ---------- Vista: ejercicios ---------- */

let exSearch = '';

function libraryList() {
  return Object.values(db.library)
    .map((e) => ({ ...e, ...exerciseStats(e.name) }))
    .sort((a, b) => (b.last || 0) - (a.last || 0) || a.name.localeCompare(b.name, 'es'));
}

function renderEjercicios() {
  $('#title').textContent = 'Ejercicios';
  return `<div class="add-ex" style="margin-bottom:14px">
      <input id="ex-search" type="search" placeholder="🔍 Buscar…" value="${esc(exSearch)}" autocomplete="off">
      <button class="btn" data-action="new-exercise">＋ Nuevo</button>
    </div>
    <div id="ex-results">${renderExerciseResults()}</div>`;
}

function renderExerciseResults() {
  const q = norm(exSearch);
  const list = libraryList().filter((e) => !q || norm(e.name).includes(q));
  if (!list.length) {
    return `<div class="empty"><div class="big">💪</div>${q ? 'Ningún ejercicio coincide.' : 'Aquí aparecerán los ejercicios que hagáis o añadáis.'}</div>`;
  }
  return list.map((e) => `
    <div class="card ex-row" data-action="exercise" data-name="${esc(e.name)}">
      <div class="grow">
        <h3>${esc(e.name)}</h3>
        <div class="muted small">${e.sessions
          ? `${e.sessions} ${e.sessions === 1 ? 'vez' : 'veces'}${e.best != null ? ` · máx ${e.best} kg` : ''} · ${esc(fmtDate(e.last, { day: 'numeric', month: 'short' }))}`
          : 'Sin historial aún'}${hasAnyNote(e) ? ' · 📝' : ''}</div>
      </div>
      <span class="muted">›</span>
    </div>`).join('');
}

function openExercise(name) {
  const lib = ensureLib(name);
  name = lib.name;
  const n = norm(name);
  const items = sortedWorkouts()
    .map((w) => ({ w, ex: w.exercises.find((e) => norm(e.name) === n) }))
    .filter((x) => x.ex);
  // Máximo por gimnasio (las máquinas de cada uno no son comparables)
  const bests = db.gyms.map((g) => ({ g, best: bestWeightFor(name, Infinity, g.id) })).filter((x) => x.best != null);
  const otherNotes = db.gyms.filter((g) => g.id !== currentGym() && getNote(name, g.id));
  const inUse = db.routines.filter((r) => r.exercises.some((e) => norm(e.name) === n)).map((r) => r.name);
  const restOpts = `<option value="">Por defecto (${fmtClock(db.settings.defaultRest)})</option>` +
    REST_OPTIONS.map((v) => `<option value="${v}" ${v === lib.rest ? 'selected' : ''}>${fmtClock(v)}</option>`).join('');

  openSheet(`<h2>${esc(name)}</h2>
    ${noteBox(name)}
    ${otherNotes.map((g) => `<div class="other-note"><b>${esc(g.name)}:</b> ${esc(getNote(name, g.id))}</div>`).join('')}
    <div class="grid2">
      <div><label class="field-label">Descanso</label><select data-pref="rest" data-name="${esc(name)}">${restOpts}</select></div>
      <div><label class="field-label">Reps objetivo</label><input inputmode="numeric" data-pref="reps" data-name="${esc(name)}" value="${esc(lib.reps || '')}" placeholder="—"></div>
    </div>
    ${inUse.length ? `<div class="muted small" style="margin:10px 2px 0">En rutinas: ${inUse.map(esc).join(', ')}</div>` : ''}
    <div class="row" style="margin-top:14px">
      <button class="btn sm grow" data-action="ex-rename" data-name="${esc(name)}">✏️ Renombrar</button>
      <button class="btn sm grow" data-action="ex-merge" data-name="${esc(name)}">🔗 Fusionar</button>
      ${!items.length && !inUse.length ? `<button class="btn sm ghost danger" data-action="ex-delete" data-name="${esc(name)}">🗑</button>` : ''}
    </div>
    ${bests.length ? `<div class="card best-card" style="margin-top:14px">
      ${bests.map(({ g, best }) => `<div><div class="muted small">Peso máximo${multiGym() ? ` · ${esc(g.name)}` : ''}</div><div class="big-num">${best} kg</div></div>`).join('')}
    </div>` : ''}
    <div class="section-title">Historial</div>
    ${items.length ? `<div class="card">${items.slice(0, 50).map(({ w, ex }) => `
      <div class="history-item">
        <div class="row between"><b>${esc(fmtDate(w.start, { day: 'numeric', month: 'short', year: 'numeric' }))}</b><span class="muted small">${multiGym() ? `${PIN}${esc(gymName(w.gymId))} · ` : ''}${esc(w.name)}</span></div>
        <div class="muted small" style="margin-top:2px">${ex.sets.map(fmtSet).map(esc).join(' · ')}</div>
      </div>`).join('')}</div>` : '<div class="empty">Aún no hay historial de este ejercicio.</div>'}`, 'exercise', name);
}

function openMergePicker(name) {
  const others = libraryList().filter((e) => norm(e.name) !== norm(name));
  openSheet(`<h2>Fusionar “${esc(name)}” con…</h2>
    <div class="muted small" style="margin-bottom:14px">Elige el ejercicio que es el mismo. Todo el historial, las rutinas y las notas pasarán a ese nombre.</div>
    ${others.length ? others.map((e) => `
      <button class="card ex-row" style="width:100%;text-align:left" data-action="ex-merge-into" data-from="${esc(name)}" data-to="${esc(e.name)}">
        <div class="grow"><h3>${esc(e.name)}</h3><div class="muted small">${e.sessions ? `${e.sessions} ${e.sessions === 1 ? 'vez' : 'veces'}` : 'Sin historial'}</div></div>
      </button>`).join('') : '<div class="empty">No hay otros ejercicios.</div>'}
    <button class="btn ghost block" data-action="exercise" data-name="${esc(name)}">Cancelar</button>`, 'merge');
}

// Tras renombrar/fusionar, refresca lo que haya en pantalla
function afterExerciseChange(name) {
  render();
  openExercise(name);
}

/* ---------- Vista: ajustes ---------- */

function renderPushSettings() {
  const st = pushStatus();
  if (st === 'on') {
    return `<div class="row between"><span>🔔 Activados</span><span class="muted small">en este móvil</span></div>
      <div class="muted small">Cuando acabe el descanso te llegará una notificación aunque hayas salido de la app o bloqueado el móvil.</div>
      <button class="btn sm" data-action="push-test">Probar: aviso en 10 s</button>
      <button class="btn sm ghost" data-action="push-off">Desactivar</button>`;
  }
  const msg = {
    'needs-install': 'Para recibir avisos en iPhone, primero instala la app: en Safari → Compartir → “Añadir a pantalla de inicio”, y ábrela desde el icono.',
    unsupported: 'Este navegador no permite avisos. En Android usa Chrome; en iPhone, la app instalada (iOS 16.4 o superior).',
    denied: 'Has bloqueado las notificaciones. Actívalas en los ajustes del móvil (Notificaciones → Gym) y vuelve aquí.',
    off: 'Recibe una notificación al terminar el descanso aunque no estés en la app o tengas el móvil bloqueado.',
  }[st];
  return `<div class="muted small">${msg}</div>
    ${st === 'off' ? '<button class="btn primary block" data-action="push-on">🔔 Activar avisos</button>' : ''}`;
}

function renderAjustes() {
  $('#title').textContent = 'Ajustes';
  const s = db.settings;
  const opts = REST_OPTIONS
    .map((v) => `<option value="${v}" ${v === s.defaultRest ? 'selected' : ''}>${fmtClock(v)}</option>`).join('');
  return `
    <div class="section-title">Timer</div>
    <div class="card stack">
      <div class="row between"><span>Descanso por defecto</span><select data-setting="defaultRest" style="width:110px">${opts}</select></div>
      <div class="row between"><span>Sonido al terminar</span><select data-setting="sound" style="width:110px">
        <option value="true" ${s.sound ? 'selected' : ''}>Sí</option><option value="false" ${!s.sound ? 'selected' : ''}>No</option></select></div>
      <div class="row between"><span>Vibración <span class="muted small">(Android)</span></span><select data-setting="vibrate" style="width:110px">
        <option value="true" ${s.vibrate ? 'selected' : ''}>Sí</option><option value="false" ${!s.vibrate ? 'selected' : ''}>No</option></select></div>
      <button class="btn sm" data-action="test-sound">🔔 Probar sonido</button>
    </div>

    <div class="section-title">Avisos con la app cerrada</div>
    <div class="card stack">${renderPushSettings()}</div>

    <div class="section-title">Copia de seguridad</div>
    <div class="card stack">
      <div class="muted small">Los datos se guardan solo en este móvil. Haz una copia de vez en cuando, o úsala para pasar rutinas a otro móvil.</div>
      <button class="btn block" data-action="export">⬇️ Exportar copia</button>
      <button class="btn block" data-action="import">⬆️ Importar copia</button>
      <input type="file" id="import-file" accept="application/json,.json" class="hidden">
    </div>

    <div class="section-title">Instalar en el móvil</div>
    <div class="card muted small">
      <b style="color:var(--text)">iPhone:</b> en Safari → botón Compartir → “Añadir a pantalla de inicio”.<br><br>
      <b style="color:var(--text)">Android:</b> en Chrome → menú ⋮ → “Instalar aplicación”.
    </div>

    <div class="section-title">Zona peligrosa</div>
    <button class="btn ghost danger block" data-action="reset">Borrar todos los datos</button>
    <div class="muted small" style="text-align:center;margin-top:16px">${db.workouts.length} entrenos · ${db.routines.length} rutinas · versión ${APP_VERSION}</div>`;
}

async function exportData() {
  const json = JSON.stringify(db, null, 2);
  const name = `gym-backup-${dateKey(Date.now())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia Gym Tracker' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.workouts) || !Array.isArray(data.routines)) throw new Error('formato');
      const choice = confirm(
        `La copia tiene ${data.workouts.length} entrenos y ${data.routines.length} rutinas.\n\n` +
        'Aceptar = reemplazar todo lo de este móvil.\nCancelar = no hacer nada.'
      );
      if (!choice) return;
      db = migrate(data);
      syncLibrary();
      save();
      refreshDatalist();
      render();
      toast('Copia importada ✅');
    } catch (e) {
      toast('Ese archivo no es una copia válida');
    }
  };
  reader.readAsText(file);
}

/* ---------- Hoja modal ---------- */

let sheetKind = null, sheetArg = null;
function openSheet(html, kind, arg) {
  sheetKind = kind; sheetArg = arg;
  $('#sheet-body').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  $('#sheet-backdrop').classList.remove('hidden');
  $('#sheet').scrollTop = 0;
  autosizeAll($('#sheet'));
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  sheetKind = null; draft = null;
  $('#sheet').classList.add('hidden');
  $('#sheet-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- Timer de descanso ---------- */

let timer = (() => { try { return JSON.parse(localStorage.getItem(TIMER_KEY)); } catch { return null; } })();
let audioCtx = null;

function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}

function beep() {
  if (!db.settings.sound || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((d, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.22);
  });
}

function startTimer(sec, label) {
  unlockAudio();
  timer = { end: Date.now() + sec * 1000, dur: sec, fired: false, label: label || '' };
  timer.pushed = schedulePush(timer.end, timer.label);
  localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  tick();
}
function addTimer(sec) {
  if (!timer) return;
  if (timer.fired) { startTimer(Math.max(15, sec), timer.label); return; }
  timer.end += sec * 1000;
  timer.dur = Math.max(1, timer.dur + sec);
  timer.pushed = schedulePush(timer.end, timer.label);
  localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  tick();
}
function stopTimer() {
  if (timer && timer.pushed && !timer.fired) cancelPush();
  timer = null;
  localStorage.removeItem(TIMER_KEY);
  tick();
}

/* ---------- Avisos push (suenan con la app cerrada) ---------- */

const PUSH_URL = 'https://gym-tracker-push.juanrodes7.workers.dev';
const VAPID_PUBLIC_KEY = 'BKaCCZ984cWkVhCF_bTTnP-HHsCpvcDRK2w5Mgsd44FlRqNFJw8Aex58YgLERArBPeYzqLhZRS7lg-uZGz9wwf8';
const PUSH_KEY = 'gymtracker.push'; // { id, sub } — propio de cada móvil, no va en la copia de seguridad

let push = (() => { try { return JSON.parse(localStorage.getItem(PUSH_KEY)); } catch { return null; } })();
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function pushStatus() {
  if (push && pushSupported() && Notification.permission === 'granted') return 'on';
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'off';
}

function postPush(path, data) {
  return fetch(PUSH_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    keepalive: true,
  });
}

// Devuelve true si se ha programado el aviso en el servidor
function schedulePush(at, label, title) {
  if (pushStatus() !== 'on') return false;
  postPush('/schedule', {
    id: push.id,
    subscription: push.sub,
    at,
    title: title || '⏱ ¡Descanso terminado!',
    body: label ? `Siguiente serie: ${label}` : 'A por la siguiente serie 💪',
  }).catch(() => {});
  return true;
}

function cancelPush() {
  if (!push) return;
  postPush('/cancel', { id: push.id }).catch(() => {});
}

function vapidKeyBytes() {
  const s = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
}

async function enablePush() {
  const st = pushStatus();
  if (st === 'needs-install') { toast('Primero instálala: Compartir → Añadir a pantalla de inicio'); return; }
  if (st === 'unsupported') { toast('Este navegador no permite avisos'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Sin permiso no puedo avisarte'); render(); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() }));
    push = { id: push?.id || uid(), sub: sub.toJSON() };
    localStorage.setItem(PUSH_KEY, JSON.stringify(push));
    toast('Avisos activados 🔔');
  } catch (e) {
    console.error(e);
    toast('No se pudieron activar los avisos');
  }
  render();
}

async function disablePush() {
  cancelPush();
  try { const reg = await navigator.serviceWorker.ready; await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch {}
  push = null;
  localStorage.removeItem(PUSH_KEY);
  render();
  toast('Avisos desactivados');
}

// Si el navegador renovó la suscripción, la actualizamos
async function refreshPushSubscription() {
  if (!push || !pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { push = null; localStorage.removeItem(PUSH_KEY); return; }
    const json = sub.toJSON();
    if (json.endpoint !== push.sub.endpoint) { push.sub = json; localStorage.setItem(PUSH_KEY, JSON.stringify(push)); }
  } catch {}
}

function tick() {
  const bar = $('#timerbar');
  if (!timer) { bar.classList.add('hidden'); bar.classList.remove('finished'); updateFab(); return; }
  const remaining = (timer.end - Date.now()) / 1000;
  bar.classList.remove('hidden');
  // Con la app delante avisa ella misma: cancela el push justo antes para no duplicar
  if (timer.pushed && !timer.fired && remaining <= 1.5 && remaining > 0 && document.visibilityState === 'visible') {
    timer.pushed = false;
    localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    cancelPush();
  }
  if (remaining <= 0) {
    if (!timer.fired) {
      timer.fired = true;
      localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
      // Si el aviso push ya sonó (app en segundo plano), no volvemos a pitar al abrirla
      if (remaining > -30 && !timer.pushed) {
        beep();
        if (db.settings.vibrate && navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
      }
    }
    bar.classList.add('finished');
    $('#timer-time').textContent = '¡A darle!';
    $('#timer-fill').style.width = '100%';
    if (remaining < -8) stopTimer();
  } else {
    bar.classList.remove('finished');
    $('#timer-time').textContent = fmtClock(Math.ceil(remaining));
    $('#timer-fill').style.width = `${(1 - remaining / timer.dur) * 100}%`;
  }
  updateFab();
}

function updateFab() {
  $('#timer-fab').classList.toggle('hidden', !!timer);
}

function updateElapsed() {
  const el = $('#elapsed');
  if (el && db.active) el.textContent = fmtClock((Date.now() - db.active.start) / 1000);
}

function openTimerMenu() {
  const presets = [30, 45, 60, 90, 120, 150, 180, 240, 300];
  openSheet(`<h2>Timer de descanso</h2>
    <div class="preset-grid">${presets.map((s) => `<button class="btn" data-action="timer-start" data-sec="${s}">${fmtClock(s)}</button>`).join('')}</div>`, 'timer');
}

setInterval(() => { tick(); updateElapsed(); }, 250);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tick();
    if (db.active) requestWakeLock();
    // iOS deja la app "dormida" en memoria: al volver, mira si hay versión nueva
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
  }
});

/* Mantener la pantalla encendida durante el entreno (si el navegador lo permite) */
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
}
function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }

/* ---------- Eventos ---------- */

document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  const ei = +el.dataset.ei, si = +el.dataset.si, i = +el.dataset.i;
  const a = db.active;

  switch (act) {
    // Entreno
    case 'start': {
      if (db.active && !confirm('Ya tienes un entreno en curso. ¿Descartarlo y empezar otro?')) return;
      startWorkout(db.routines.find((r) => r.id === el.dataset.id));
      break;
    }
    case 'start-free':
      if (db.active && !confirm('Ya tienes un entreno en curso. ¿Descartarlo y empezar otro?')) return;
      startWorkout(null);
      setTimeout(() => $('#new-ex')?.focus(), 50);
      break;
    case 'toggle-set': {
      const ex = a.exercises[ei], s = ex.sets[si];
      if (!s.done) {
        const row = el.closest('.set-row');
        const [wIn, rIn] = row.querySelectorAll('input');
        if (s.w === '' && wIn.placeholder !== '—') s.w = wIn.placeholder;
        if (s.r === '' && rIn.placeholder !== '—') s.r = rIn.placeholder;
        if (s.r === '') { toast('Apunta las repeticiones'); rIn.focus(); return; }
        s.done = true;
        const nextSet = ex.sets.findIndex((x) => !x.done);
        startTimer(ex.rest || db.settings.defaultRest, nextSet >= 0 ? `${ex.name} (${nextSet + 1}ª)` : '');
      } else {
        s.done = false;
      }
      save(); render();
      break;
    }
    case 'add-set': {
      const ex = a.exercises[ei];
      const prev = ex.sets[ex.sets.length - 1];
      ex.sets.push({ w: prev ? prev.w : '', r: prev ? prev.r : '', done: false });
      save(); render();
      break;
    }
    case 'remove-set':
      a.exercises[ei].sets.pop(); save(); render(); break;
    case 'remove-ex':
      if (confirm(`¿Quitar ${a.exercises[ei].name} de este entreno?`)) { a.exercises.splice(ei, 1); save(); render(); }
      break;
    case 'move-ex': {
      const j = ei + +el.dataset.dir;
      if (j < 0 || j >= a.exercises.length) return;
      [a.exercises[ei], a.exercises[j]] = [a.exercises[j], a.exercises[ei]];
      save(); render();
      break;
    }
    case 'add-ex': addExerciseFromInput(); break;
    case 'finish': finishWorkout(); break;
    case 'discard':
      if (confirm('¿Seguro que quieres descartar este entreno? Se perderá lo apuntado.')) {
        db.active = null; save(); stopTimer(); releaseWakeLock(); render();
      }
      break;
    case 'history':
    case 'exercise': openExercise(el.dataset.name); break;

    // Ejercicios
    case 'new-exercise': {
      const name = (prompt('Nombre del ejercicio:') || '').trim();
      if (!name) return;
      const existing = libEntry(name);
      ensureLib(name); save(); refreshDatalist(); render();
      openExercise(existing ? existing.name : name);
      break;
    }
    case 'ex-rename': {
      const from = el.dataset.name;
      const to = (prompt('Nuevo nombre:', from) || '').trim();
      if (!to || to === from) return;
      const target = libEntry(to);
      if (target && norm(to) !== norm(from) &&
          !confirm(`Ya existe “${target.name}”. ¿Fusionar “${from}” con él? Todo el historial pasará a “${target.name}”.`)) return;
      const finalName = target && norm(to) !== norm(from) ? target.name : to;
      renameExercise(from, finalName);
      afterExerciseChange(finalName);
      toast('Ejercicio actualizado');
      break;
    }
    case 'ex-merge': openMergePicker(el.dataset.name); break;
    case 'ex-merge-into': {
      const { from, to } = el.dataset;
      if (!confirm(`¿Fusionar “${from}” con “${to}”?\n\nTodo pasará a llamarse “${to}”. No se puede deshacer.`)) return;
      renameExercise(from, to);
      afterExerciseChange(to);
      toast('Ejercicios fusionados');
      break;
    }
    case 'ex-delete':
      if (confirm(`¿Eliminar “${el.dataset.name}” de la lista?`)) {
        delete db.library[norm(el.dataset.name)];
        save(); refreshDatalist(); closeSheet(); render();
      }
      break;

    // Rutinas
    case 'new-routine': openRoutineEditor(null); break;
    case 'edit-routine': openRoutineEditor(el.dataset.id); break;
    case 'rex-add':
      draft.exercises.push({ name: '', sets: 3, reps: 10, rest: db.settings.defaultRest });
      rerenderEditor();
      setTimeout(() => { const ins = document.querySelectorAll('[data-efield="name"]'); ins[ins.length - 1]?.focus(); }, 30);
      break;
    case 'rex-del': draft.exercises.splice(i, 1); rerenderEditor(); break;
    case 'rex-move': {
      const j = i + +el.dataset.dir;
      if (j < 0) return;
      [draft.exercises[i], draft.exercises[j]] = [draft.exercises[j], draft.exercises[i]];
      rerenderEditor();
      break;
    }
    case 'routine-save': saveRoutine(); break;
    case 'routine-duplicate': duplicateRoutine(); break;

    // Gimnasios
    case 'gym-menu': openGymMenu(); break;
    case 'gym-select': selectGym(el.dataset.id); break;
    case 'gym-add': addGym(); break;
    case 'gym-rename': {
      const g = db.gyms.find((x) => x.id === el.dataset.id);
      const name = (prompt('Nombre del gimnasio:', g.name) || '').trim();
      if (!name) return;
      g.name = name; save(); render(); openGymMenu();
      break;
    }
    case 'gym-delete': {
      const g = db.gyms.find((x) => x.id === el.dataset.id);
      if (!confirm(`¿Borrar “${g.name}”?`)) return;
      db.gyms = db.gyms.filter((x) => x.id !== g.id);
      Object.values(db.library).forEach((e) => { if (e.notes) delete e.notes[g.id]; });
      if (currentGym() === g.id) db.settings.currentGym = db.gyms[0].id;
      save(); render(); openGymMenu();
      break;
    }
    case 'routine-delete':
      if (confirm(`¿Eliminar la rutina “${draft.name}”? El historial de entrenos no se borra.`)) {
        db.routines = db.routines.filter((r) => r.id !== draft.id);
        save(); closeSheet(); render();
      }
      break;

    // Calendario
    case 'cal-move': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +el.dataset.dir, 1); render(); break;
    case 'open-day': openDay(el.dataset.date); break;
    case 'open-workout': openWorkout(el.dataset.id); break;
    case 'delete-workout':
      if (confirm('¿Borrar este entreno del historial?')) {
        db.workouts = db.workouts.filter((w) => w.id !== el.dataset.id);
        save();
        if (sheetKind === 'day') openDay(sheetArg);
        render();
      }
      break;

    // Timer
    case 'timer-menu': openTimerMenu(); break;
    case 'timer-start': startTimer(+el.dataset.sec); if (sheetKind === 'timer') closeSheet(); break;
    case 'timer-add': addTimer(+el.dataset.sec); break;
    case 'timer-stop': stopTimer(); break;

    // Ajustes
    case 'test-sound': {
      unlockAudio();
      const prev = db.settings.sound;
      db.settings.sound = true; beep(); db.settings.sound = prev;
      if (navigator.vibrate) navigator.vibrate(200);
      break;
    }
    case 'push-on': enablePush(); break;
    case 'push-off': disablePush(); break;
    case 'push-test':
      if (schedulePush(Date.now() + 10000, '', '🔔 ¡Funciona!')) toast('Sal de la app o bloquea el móvil… llega en 10 s');
      break;
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'reset':
      if (confirm('Esto borra TODAS las rutinas y entrenos de este móvil. ¿Seguro?') && confirm('¿De verdad? No se puede deshacer.')) {
        db = seed(); syncLibrary(); save(); stopTimer(); refreshDatalist(); render(); toast('Datos borrados');
      }
      break;

    case 'close-sheet': closeSheet(); break;
  }
});

function addExerciseFromInput() {
  const input = $('#new-ex');
  const typed = input.value.trim();
  if (!typed) { input.focus(); return; }
  const name = libEntry(typed)?.name || typed; // usa el nombre ya guardado si existe
  ensureLib(name);
  const last = lastSetsFor(name);
  const n = last ? last.sets.length : 3;
  db.active.exercises.push({ name, rest: restFor(name), targetReps: repsFor(name), sets: Array.from({ length: n }, newSet) });
  refreshDatalist();
  save(); render();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'new-ex') { e.preventDefault(); addExerciseFromInput(); }
  if (e.key === 'Enter' && e.target.id === 'new-gym') { e.preventDefault(); addGym(); }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.classList.contains('ex-note')) autosize(t);
  if (t.dataset.note != null) {
    setNote(t.dataset.note, t.value);
    save();
  } else if (t.dataset.field && db.active) {
    db.active.exercises[+t.dataset.ei].sets[+t.dataset.si][t.dataset.field] = t.value.trim();
    save();
  } else if (t.dataset.rfield && draft) {
    draft[t.dataset.rfield] = t.value;
  } else if (t.dataset.efield && draft) {
    draft.exercises[+t.dataset.i][t.dataset.efield] = t.value;
  } else if (t.id === 'ex-search') {
    exSearch = t.value;
    $('#ex-results').innerHTML = renderExerciseResults();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.pref) {
    // Descanso / reps propios del ejercicio
    const lib = ensureLib(t.dataset.name);
    const v = parseInt(t.value, 10);
    if (v > 0) lib[t.dataset.pref] = v; else delete lib[t.dataset.pref];
    if (db.active) {
      db.active.exercises.forEach((ex) => {
        if (norm(ex.name) !== norm(lib.name)) return;
        if (t.dataset.pref === 'rest') ex.rest = restFor(lib.name);
        else ex.targetReps = repsFor(lib.name);
      });
    }
    save();
    render();
    toast('Guardado');
  } else if (t.dataset.rfield === 'gymId' && draft) {
    // Cambia de gimnasio la rutina: las notas que se ven pasan a ser las de ese gimnasio
    draft.gymId = t.value || null;
    loadDraftNotes();
    rerenderEditor();
  } else if (t.dataset.efield === 'name' && draft) {
    // En el editor de rutinas: si el ejercicio ya se conoce, trae sus valores
    const ex = draft.exercises[+t.dataset.i];
    const lib = libEntry(t.value);
    if (lib) {
      ex.name = lib.name;
      if (lib.rest) ex.rest = lib.rest;
      if (lib.reps) ex.reps = lib.reps;
      ex.note = getNote(lib.name, draftNoteGym()) || ex.note || '';
      rerenderEditor();
    }
  } else if (t.dataset.setting) {
    const v = t.value;
    db.settings[t.dataset.setting] = v === 'true' ? true : v === 'false' ? false : +v;
    save();
    toast('Guardado');
  } else if (t.id === 'import-file' && t.files[0]) {
    importData(t.files[0]);
    t.value = '';
  }
});

/* ---------- Arranque ---------- */

refreshDatalist();
render();
tick();
if (db.active) requestWakeLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(refreshPushSubscription).catch(() => {});
  // Cuando se instala una versión nueva, recarga para usarla (los datos están a salvo en localStorage)
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}
