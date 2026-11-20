// Browser app: the approved prototype UI, now reading /api/bootstrap and saving through /api/act.
import { PER, IN_MAX, P_MAX, DN, pp, bare, makeCore, importSpec, validateImport } from './core.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let LANG = 'th'; try { if (localStorage.getItem('ptc-lang') === 'en') LANG = 'en' } catch (e) { }
const L = (th, en) => LANG === 'en' ? en : th;
const DS = { th: ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.'], en: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'] };
const dayName = d => DN[LANG][d], dayShort = d => DS[LANG][d];
const pr = (s, len) => `${PER[s].s}–${PER[s + len - 1].e}`;
const fmtDate = d => d ? new Date(d).toLocaleDateString(LANG === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '–';
const fmtTime = d => new Date(d).toLocaleString(LANG === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const ref = (p, id) => `${p}-${String(id).padStart(3, '0')}`;

/* ===== data (replaced on every refresh) ===== */
let DEPTS = [], DEPT = {}, TCH = {}, RM = {}, GRP = {}, SUB = {}, A = {}, ASG = [], LOCKS = [], STU = [], VERS = [], CR = [], ISS = [], DSR = [], AUD = [], ME = null, C = null, IMP = null;
const deptName = c => DEPT[c] ? L(DEPT[c].th, DEPT[c].en) : c;
const rtName = k => C.rtName(k), gName = g => L(g.name, g.en);
function applyData(d) {
  ME = d.me; DEPTS = [...d.depts].sort((a, b) => (b.code === 'EXE') - (a.code === 'EXE')); DEPT = Object.fromEntries(DEPTS.map(x => [x.code, x]));
  TCH = Object.fromEntries(d.teachers.map(t => [t.id, { ...t, first: bare(t.name).split(' ')[0], short: 'ครู' + bare(t.name).split(' ')[0] }]));
  RM = Object.fromEntries(d.rooms.map(r => [r.id, r])); GRP = Object.fromEntries(d.groups.map(g => [g.id, g])); SUB = Object.fromEntries(d.subjects.map(s => [s.code, s]));
  ASG = d.assignments; A = Object.fromEntries(ASG.map(a => [a.id, a])); LOCKS = d.locks;
  VERS = d.versions.map(v => ({ ...v, created: v.created && new Date(v.created), published: v.published && new Date(v.published) }));
  CR = d.cr; ISS = d.iss; DSR = d.dsr; AUD = d.aud; STU = d.students;
  C = makeCore({ TCH, RM, GRP, SUB, A, ASG, LOCKS }, L, dayName);
  IMP = importSpec({ TCH, RM, SUB, DEPT }, L);
  S.role = ME && !ME.mustChange && ME.role !== 'PUBLIC' ? ME.role : null; S.user = ME ? ME.pid : null;
}
let inflight = 0;
const busy = p => { inflight++; document.body.classList.add('loading'); return p.finally(() => { if (!--inflight) document.body.classList.remove('loading') }) };
let lastData = '';
// Returns true only when the server data actually changed, so callers can skip needless re-renders.
async function refresh(pre, force) {
  return busy((async () => {
    const r = await (pre || fetch('/api/bootstrap', { cache: 'no-store' })), text = await r.text(); let j = {}; try { j = JSON.parse(text) } catch (e) { }
    if (!r.ok) throw new Error(j.error || 'โหลดข้อมูลไม่สำเร็จ');
    if (text === lastData && !force) return false; lastData = text; applyData(j); return true;
  })());
}
async function api(type, body = {}) {
  S.busy = true;
  try {
    const r = await busy(fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, ...body }) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || L('เกิดข้อผิดพลาด', 'Something went wrong')); if (r.status === 409 || r.status === 401) { await refresh(); clearSel(); render() } return null }
    return j;
  } catch (e) { toast(L('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'Cannot reach the server')); return null } finally { S.busy = false }
}
// Optimistic: `local` updates the screen at once; the server result then replaces it (and undoes it on failure).
async function act(type, body, okMsg, local) {
  if (local) { local(); render() }
  const j = await api(type, body);
  if (j && okMsg) toast(okMsg);
  if (j || local) { await refresh(null, !j).catch(() => { }); rerender() } // force: undo a rejected optimistic change
  return j
}
// Re-render after background data arrives, without wiping what the user is in the middle of.
function rerender() {
  if (NEED[S.route] && !NEED[S.route].includes(S.role)) { go('login'); return }
  const a = document.activeElement;
  if (S.modal || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'pub-sel')) return;
  if (S.ed.sel) { const [s] = findSlot(S.ed.sel); if (s) computeStatuses(s); else clearSel() }
  render()
}

// W: may change timetables and settings (admin). PRIV: sees everything (admin, executives). Never true in "view as" mode.
const W = () => S.role === 'ADMIN' && !(ME && ME.imp), PRIV = () => S.role === 'ADMIN' || S.role === 'EXEC';
const isExe = t => t.dept === 'EXE';
const photoUrl = t => t.photoV ? `/api/photo/${encodeURIComponent(t.id)}?v=${t.photoV}` : '';
function avatar(t, cls = '') {
  const u = photoUrl(t), shown = u || t.consent || PRIV() || t.id === S.user;
  return `<div class="av ${cls}${shown ? '' : ' hide'}" aria-hidden="true">${u ? `<img src="${u}" alt="" loading="lazy">` : shown ? esc(t.first[0]) : '?'}</div>`
}
const subjOf = s => SUB[A[s.aid].subj], grpsOf = s => A[s.aid].groups.map(g => gName(GRP[g])).join(', ');
const TOTAL = () => C.total(), placed = v => C.placed(v), conflicts = sl => C.conflicts(sl), load = (t, v) => C.load(t, v);
const pubVer = () => VERS.find(v => v.status === 'PUBLISHED');
const latestDraft = () => [...VERS].reverse().find(v => v.status === 'DRAFT');
const findSlot = id => { for (const v of VERS) { const s = v.slots.find(s => s.id === id); if (s) return [s, v] } return [null, null] };

/* ===== state ===== */
const S = {
  role: null, user: null, route: 'schedule', pub: { mode: 'group', id: 'AU-11' }, pdept: 'ALL', pq: '', chat: [], asked: 0, lk: null,
  ed: { ver: null, mode: 'group', id: 'AU-11', sel: null, st: null, pending: null, undo: [] }, reqTab: 'cr', dataTab: 'teachers', imp: null, impEnt: 'teachers', job: null, diff: null, modal: null, busy: false
};

/* ===== shared UI bits ===== */
const modeName = k => ({ group: L('กลุ่มเรียน', 'Class group'), teacher: L('ครูผู้สอน', 'Teacher'), room: L('ห้อง', 'Room') }[k]);
function optionsHTML(mode, cur) {
  if (mode === 'room') { const b = {}; Object.values(RM).forEach(r => (b[r.bld] = b[r.bld] || []).push(r)); return Object.entries(b).map(([k, rs]) => `<optgroup label="${esc(k)}">${rs.map(r => `<option value="${esc(r.id)}"${r.id === cur ? ' selected' : ''}>${esc(r.id)} · ${esc(r.name)}</option>`).join('')}</optgroup>`).join('') }
  const list = mode === 'group' ? Object.values(GRP) : Object.values(TCH).filter(t => mode === 'people' || !isExe(t));
  return DEPTS.map(d => { const xs = list.filter(x => x.dept === d.code); return xs.length ? `<optgroup label="${esc(deptName(d.code))}">${xs.map(x => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(mode === 'group' ? gName(x) : x.name)}</option>`).join('')}</optgroup>` : '' }).join('');
}
const firstOf = mode => mode === 'group' ? Object.keys(GRP)[0] : mode === 'teacher' ? Object.values(TCH).find(t => !isExe(t)).id : Object.keys(RM)[0];
const exists = (mode, id) => !!(mode === 'group' ? GRP[id] : mode === 'teacher' ? TCH[id] : RM[id]);
const viewSlots = (v, mode, id) => v ? v.slots.filter(s => mode === 'group' ? A[s.aid].groups.includes(id) : mode === 'teacher' ? A[s.aid].teachers.includes(id) : s.room === id) : [];
function viewTitle(mode, id) {
  if (mode === 'group') { const g = GRP[id], t = TCH[g.advisor]; return `<div class="titleline"><h2>${esc(gName(g))}</h2><span class="muted">${L('รหัสกลุ่ม', 'Group')} ${esc(g.id)} · ${g.size} ${L('คน', 'students')}${t ? ` · ${L('ครูที่ปรึกษา', 'Advisor')} ${esc(t.name)}` : ''}</span></div>` }
  if (mode === 'teacher') { const t = TCH[id]; return `<div class="titleline"><h2>${esc(t.name)}</h2><span class="muted">${esc(t.pos)} · ${L('แผนกวิชา', 'Dept.')} ${esc(deptName(t.dept))}</span></div>` }
  const r = RM[id]; return `<div class="titleline"><h2>${esc(r.id)} · ${esc(r.name)}</h2><span class="muted">${esc(r.bld)} · ${rtName(r.type)} · ${L('จุ', 'seats')} ${r.cap}</span></div>`;
}
const colOf = p => p <= 4 ? p + 1 : p + 2;
function slotHTML(s, mode, o) {
  const a = A[s.aid], sb = SUB[a.subj], g = GRP[a.groups[0]], t = TCH[a.teachers[0]], out = s.start + s.len - 1 > IN_MAX;
  const meta = mode === 'group' ? `${t.short} · ${s.room}` : mode === 'teacher' ? `${gName(g)} · ${s.room}` : `${gName(g)} · ${t.short}`;
  const can = o.ed && canEdit(s);
  return `<button type="button" class="slot${o.ed && S.ed.sel === s.id ? ' sel' : ''}${o.ed && !can ? ' ro' : ''}" style="grid-row:${s.day + 1};grid-column:${colOf(s.start)}/${colOf(s.start + s.len - 1) + 1};--tint:var(--c-${esc(sb.dept)})" data-act="${o.ed ? 'slot' : 'slotinfo'}" data-sid="${s.id}"${can ? ' draggable="true"' : ''} aria-label="${esc(`${sb.code} ${sb.name}, ${dayName(s.day)} ${L('คาบ', 'period')} ${pp(s.start, s.len)}, ${meta}`)}">
<span class="code">${esc(sb.code)}${s.locked ? `<span class="badge pin">${L('ปักหมุด', 'Pinned')}</span>` : ''}${out ? `<span class="badge out">${L('นอกเวลา', 'After hours')}</span>` : ''}</span><span class="nm">${esc(sb.name)}</span><span class="meta">${esc(meta)}</span></button>`;
}
function grid(v, mode, id, o = {}) {
  let h = `<div class="gridwrap"><div class="tt${o.ed && S.ed.sel ? ' picking' : ''}"${o.ed ? ' id="tt"' : ''}><div class="th" style="grid-column:1">${L('วัน / คาบ', 'Day / period')}</div>`;
  for (let p = 1; p <= P_MAX; p++)h += `<div class="th${PER[p].out ? ' out' : ''}" style="grid-column:${colOf(p)}"><b>${p}</b>${PER[p].s}–${PER[p].e}${PER[p].out ? `<em>${L('นอกเวลา', 'after hours')}</em>` : ''}</div>`;
  h += `<div class="th lh" style="grid-column:6"></div><div class="lunch">${L('พักกลางวัน 12.00–13.00', 'Lunch 12:00–13:00')}</div>`;
  for (let d = 1; d <= 5; d++) {
    h += `<div class="dl" style="grid-row:${d + 1}">${dayName(d)}</div>`;
    for (let p = 1; p <= P_MAX; p++)h += o.ed ? `<button type="button" class="cell${PER[p].out ? ' out' : ''}" style="grid-row:${d + 1};grid-column:${colOf(p)}" data-act="cell" data-day="${d}" data-p="${p}" aria-label="${dayName(d)} ${L('คาบ', 'period')} ${p}"></button>` : `<div class="cell${PER[p].out ? ' out' : ''}" style="grid-row:${d + 1};grid-column:${colOf(p)}"></div>`;
    if (mode === 'group') LOCKS.filter(l => l.on && l.day === d && C.who(l, GRP[id])).forEach(l => h += `<div class="lockblk" style="grid-row:${d + 1};grid-column:${colOf(l.from)}/${colOf(l.from + l.len - 1) + 1}"><b>${esc(L(l.th, l.en))}</b><span>${L('คาบล็อก', 'Locked period')}</span></div>`);
  }
  viewSlots(v, mode, id).forEach(s => h += slotHTML(s, mode, o));
  return h + '</div></div>';
}
function dayList(v, mode, id) {
  const ss = viewSlots(v, mode, id); let h = '<div class="daylist">';
  for (let d = 1; d <= 5; d++) {
    const items = ss.filter(s => s.day === d).map(s => {
      const a = A[s.aid], sb = SUB[a.subj], meta = mode === 'group' ? `${TCH[a.teachers[0]].short} · ${s.room}` : mode === 'teacher' ? `${gName(GRP[a.groups[0]])} · ${s.room}` : `${gName(GRP[a.groups[0]])} · ${TCH[a.teachers[0]].short}`;
      return { p: s.start, h: `<li><button type="button" class="ditem" data-act="slotinfo" data-sid="${s.id}"><span class="t"><b>${pr(s.start, s.len)}</b>${L('คาบ', 'P.')} ${pp(s.start, s.len)}</span><span class="s"><b>${esc(sb.name)}</b><span class="muted small">${esc(sb.code)} · ${esc(meta)}</span></span></button></li>` }
    });
    if (mode === 'group') LOCKS.filter(l => l.on && l.day === d && C.who(l, GRP[id])).forEach(l => items.push({ p: l.from, h: `<li><div class="ditem lock"><span class="t"><b>${pr(l.from, l.len)}</b>${L('คาบ', 'P.')} ${pp(l.from, l.len)}</span><span class="s"><b>${esc(L(l.th, l.en))}</b><span class="muted small">${L('คาบล็อก', 'Locked period')}</span></span></div></li>` }));
    items.sort((x, y) => x.p - y.p);
    h += `<section class="dcard"><h3>${dayName(d)}</h3>${items.length ? `<ul>${items.map(i => i.h).join('')}</ul>` : `<p class="muted">${L('ไม่มีคาบเรียน', 'No classes')}</p>`}</section>`;
  }
  return h + '</div>';
}
const legend = () => `<div class="legend">${DEPTS.filter(d => d.code !== 'EXE').map(d => `<span><i style="background:var(--c-${esc(d.code)})"></i>${esc(deptName(d.code))}</span>`).join('')}<span><i style="background:repeating-linear-gradient(45deg,var(--gold-soft) 0 4px,transparent 4px 7px);border:1px dashed var(--gold)"></i>${L('คาบล็อก', 'Locked')}</span></div>`;
function slotDetail(s) {
  const a = A[s.aid], sb = SUB[a.subj], r = RM[s.room], out = s.start + s.len - 1 > IN_MAX;
  return `<dl class="kv"><dt>${L('วิชา', 'Subject')}</dt><dd><b>${esc(sb.code)} ${esc(sb.name)}</b><br><span class="muted small">${L('ท-ป-น', 'Credits')} ${esc(sb.cred)} · ${sb.periods} ${L('คาบ/สัปดาห์', 'periods/week')}</span></dd>
<dt>${L('ครูผู้สอน', 'Teacher')}</dt><dd>${a.teachers.map(t => esc(TCH[t].name)).join(', ')}</dd><dt>${L('กลุ่มเรียน', 'Group')}</dt><dd>${esc(grpsOf(s))}</dd>
<dt>${L('ห้อง', 'Room')}</dt><dd>${esc(s.room)} · ${esc(r.name)} (${esc(r.bld)})</dd><dt>${L('วันเวลา', 'When')}</dt><dd>${dayName(s.day)} ${L('คาบ', 'period')} ${pp(s.start, s.len)} · ${pr(s.start, s.len)} <span class="badge ${out ? 'out' : 'in'}">${out ? L('คาบนอกเวลา', 'After hours') : L('คาบในเวลา', 'In hours')}</span></dd></dl>`
}
function wbar(tid, v) {
  const t = TCH[tid], w = load(tid, v), pct = w.tot / t.max * 100, c = pct > 100 ? 'bad' : pct >= 90 ? 'warn' : '';
  return `<div class="wl"><div class="wl-h"><span>${esc(t.short)}</span><b>${w.tot} / ${t.max} ${L('ชม.', 'h')}</b></div><div class="bar" role="img" aria-label="${Math.round(pct)}%"><i class="${c}" style="width:${Math.min(pct, 100)}%"></i></div>${w.outH ? `<small class="muted">${L('รวมคาบนอกเวลา', 'incl. after hours')} ${w.outH} ${L('ชม.', 'h')}</small>` : ''}</div>`
}
const statusName = s => ({ DRAFT: L('ฉบับร่าง', 'Draft'), PUBLISHED: L('เผยแพร่', 'Published'), ARCHIVED: L('เก็บถาวร', 'Archived'), PENDING: L('รออนุมัติ', 'Pending'), APPROVED: L('อนุมัติแล้ว', 'Approved'), REJECTED: L('ไม่อนุมัติ', 'Rejected'), OPEN: L('รับเรื่อง', 'Open'), IN_PROGRESS: L('กำลังดำเนินการ', 'In progress'), RESOLVED: L('แก้ไขแล้ว', 'Resolved'), DONE: L('ดำเนินการแล้ว', 'Done') }[s] || s);
const pill = s => `<span class="pill ${esc(s)}">${statusName(s)}</span>`;
const empty = t => `<section class="card"><p class="muted" style="margin:0">${t}</p></section>`;

/* ===== public views ===== */
function vSchedule() {
  const v = pubVer(), st = S.pub;
  if (!v) return empty(L('ยังไม่มีตารางฉบับเผยแพร่', 'No timetable has been published yet'));
  if (!exists(st.mode, st.id)) st.id = firstOf(st.mode);
  return `<section class="pagehead"><h1>${L('ตารางเรียน · ตารางสอน', 'Class & teaching timetables')}</h1><p class="sub">${L('ฉบับเผยแพร่', 'Published')}: <b>${esc(v.name)}</b> · ${L('ประกาศเมื่อ', 'published')} ${fmtDate(v.published)}</p></section>
<div class="controls"><div class="seg">${['group', 'teacher', 'room'].map(k => `<button type="button" data-act="pubmode" data-v="${k}" aria-pressed="${st.mode === k}">${modeName(k)}</button>`).join('')}</div>
<label class="fld"><span>${L('เลือก', 'Choose')} ${modeName(st.mode)}</span><select id="pub-sel" data-chg="pubsel">${optionsHTML(st.mode, st.id)}</select></label></div>
${viewTitle(st.mode, st.id)}<div class="only-wide">${grid(v, st.mode, st.id)}</div><div class="only-narrow">${dayList(v, st.mode, st.id)}</div>${legend()}
<p class="note">${L('แตะที่คาบเรียนเพื่อดูรายละเอียดหรือแจ้งปัญหา', 'Tap a period for details or to report a problem')}</p>`
}
const mask = p => p;
function peopleList() {
  const q = S.pq.trim();
  const xs = Object.values(TCH).filter(t => (S.pdept === 'ALL' || t.dept === S.pdept) && (!q || t.name.includes(q))).sort((a, b) => isExe(b) - isExe(a));
  if (!xs.length) return `<p class="muted">${L('ไม่พบบุคลากรที่ตรงกับคำค้น', 'No staff match your search')}</p>`;
  return xs.map(t => `<article class="pcard${isExe(t) ? ' exe' : ''}">${avatar(t)}<div><h3>${esc(t.name)}</h3><p class="pos">${esc(t.pos)}</p><p class="muted small">${L('แผนกวิชา', 'Dept.')} ${esc(deptName(t.dept))}</p>
${t.consent ? `<dl class="mini"><dt>${L('ความเชี่ยวชาญ', 'Expertise')}</dt><dd>${esc(t.exp)}</dd><dt>${L('วุฒิการศึกษา', 'Education')}</dt><dd>${esc(t.edu)}</dd><dt>${L('โทรศัพท์', 'Phone')}</dt><dd>${esc(mask(t.phone))}</dd></dl>` : `<p class="muted small" style="margin:8px 0">${L('ไม่เปิดเผยข้อมูลเพิ่มเติมตามความประสงค์ของเจ้าของข้อมูล', 'Further details withheld at the person’s request')}</p>`}
<div class="mrow"><button type="button" class="btn sm" data-act="profview" data-v="${esc(t.id)}">${L('ดูข้อมูลส่วนตัว', 'View profile')}</button>${isExe(t) ? '' : `<button type="button" class="link" data-act="seeteacher" data-v="${esc(t.id)}">${L('ดูตารางสอน', 'View timetable')} →</button>`}</div></div></article>`).join('')
}
function profileHTML(t) {
  const self = t.id === S.user, see = PRIV() || self, imp = ME && ME.imp, row = (k, v, pre) => v ? `<dt>${k}</dt><dd${pre ? ' style="white-space:pre-wrap"' : ''}>${esc(v)}</dd>` : '';
  const body = t.consent || see ? `<dl class="kv">${row(L('ความเชี่ยวชาญ', 'Expertise'), t.exp)}${row(L('วุฒิการศึกษา', 'Education'), t.edu)}${row(L('ประวัติการทำงาน / ผลงาน', 'Work history'), t.hist, 1)}${row(L('โทรศัพท์', 'Phone'), t.phone)}${see ? row(L('อีเมล', 'Email'), t.email) + row('LINE ID', t.line) : ''}</dl>${see && !t.consent ? `<p class="note">${L('ไม่ได้ยินยอมเผยแพร่: บุคคลทั่วไปจะเห็นเฉพาะชื่อ ตำแหน่ง และแผนก', 'Not published: the public sees only name, position and department')}</p>` : ''}`
    : `<p class="muted" style="margin:0">${L('ไม่เปิดเผยข้อมูลเพิ่มเติมตามความประสงค์ของเจ้าของข้อมูล', 'Further details withheld at the person’s request')}</p>`;
  return `<div class="profhead">${avatar(t, 'lg')}<div><h3 style="font-size:20px">${esc(t.name)}</h3><p class="pos" style="margin:0">${esc(t.pos)}</p><p class="muted small" style="margin:0">${isExe(t) ? L('ผู้บริหารสถานศึกษา', 'College executive') : `${L('แผนกวิชา', 'Dept.')} ${esc(deptName(t.dept))}`} · ${esc(t.emp)}</p></div></div>${body}
<div class="mrow">${isExe(t) ? '' : `<button type="button" class="btn sm" data-act="seeteacher" data-v="${esc(t.id)}">${L('ดูตารางสอน', 'View timetable')}</button>`}${!imp && (W() || self) ? `<button type="button" class="btn sm pri" data-act="profedit" data-v="${esc(t.id)}">${L('แก้ไขข้อมูล', 'Edit profile')}</button>` : ''}${W() ? `<button type="button" class="btn sm" data-act="doviewas" data-v="${esc(t.emp)}">${L('ดูในมุมของคนนี้', 'View as this person')}</button>` : ''}</div>`
}
function vProfile() {
  const admin = W();
  if (!S.prof || !TCH[S.prof] || (!admin && S.prof !== S.user)) S.prof = S.user || Object.keys(TCH)[0];
  const t = TCH[S.prof], imp = ME && ME.imp, ro = imp || (!admin && t.id !== S.user);
  const f = (name, label, val, attrs = '') => `<label class="fld"><span>${label}</span><input name="${name}" value="${esc(val)}" ${attrs}${ro ? ' disabled' : ''}></label>`;
  return `<section class="pagehead"><h1>${t.id === S.user ? L('ข้อมูลส่วนตัวของฉัน', 'My profile') : L('ข้อมูลบุคลากร', 'Staff profile')}</h1><p class="sub">${L('ข้อมูลที่กรอกจะแสดงในทำเนียบเมื่อยินยอมเผยแพร่เท่านั้น อีเมลและ LINE ไม่แสดงต่อสาธารณะ', 'Shown in the directory only with consent. Email and LINE are never public.')}</p></section>
${admin ? `<div class="controls"><label class="fld"><span>${L('เลือกบุคลากร', 'Choose a person')}</span><select data-chg="profsel">${optionsHTML('people', t.id)}</select></label></div>` : ''}
${imp ? `<div class="notice">${L('โหมดดูในมุมของผู้ใช้อื่น: ดูได้อย่างเดียว', 'View-as mode: read only')}</div>` : ''}
<form class="card form" data-form="profile" style="display:flex;flex-direction:column;max-width:760px"><input type="hidden" name="pid" value="${esc(t.id)}">
<div class="profhead"><div id="pf-av">${avatar(t, 'lg')}</div>${ro ? '' : `<div class="mrow" style="align-items:center"><label class="btn sm">${L('เลือกรูปใหม่', 'Choose photo')}<input type="file" accept="image/*" data-chg="profphoto" hidden></label>${t.photoV ? `<button type="button" class="btn sm" data-act="profphotodel">${L('ลบรูป', 'Remove photo')}</button>` : ''}<span class="note">${L('ระบบย่อรูปให้เล็กลงอัตโนมัติ', 'Photos are resized automatically')}</span></div>`}</div>
${admin && !imp ? `<div class="cols2">${f('name', L('ชื่อ-สกุล', 'Full name'), t.name, 'required maxlength="120"')}${f('pos', L('ตำแหน่ง', 'Position'), t.pos, 'required maxlength="120"')}</div><label class="fld"><span>${L('แผนก', 'Department')}</span><select name="dept">${DEPTS.map(d => `<option value="${esc(d.code)}"${d.code === t.dept ? ' selected' : ''}>${esc(deptName(d.code))}</option>`).join('')}</select></label>`
    : `<dl class="kv"><dt>${L('ชื่อ-สกุล', 'Name')}</dt><dd>${esc(t.name)}</dd><dt>${L('ตำแหน่ง', 'Position')}</dt><dd>${esc(t.pos)}</dd><dt>${L('แผนก', 'Department')}</dt><dd>${esc(deptName(t.dept))}</dd></dl><p class="note">${L('ชื่อ ตำแหน่ง และแผนก แก้ได้โดยฝ่ายวิชาการ', 'Name, position and department are changed by academic affairs')}</p>`}
<div class="cols2">${f('exp', L('ความเชี่ยวชาญ', 'Expertise'), t.exp, 'maxlength="190"')}${f('edu', L('วุฒิการศึกษา', 'Education'), t.edu, 'maxlength="190"')}</div>
<label class="fld"><span>${L('ประวัติการทำงาน / ผลงาน / รางวัล', 'Work history, achievements, awards')}</span><textarea name="hist" maxlength="3000" rows="5"${ro ? ' disabled' : ''}>${esc(t.hist)}</textarea></label>
<div class="cols2">${f('phone', L('โทรศัพท์', 'Phone'), t.phone, 'inputmode="tel" maxlength="20" autocomplete="tel"')}${f('email', L('อีเมล', 'Email'), t.email, 'type="email" maxlength="120" autocomplete="email"')}</div>
${f('line', 'LINE ID', t.line, 'maxlength="60"')}
<label class="switch"><input type="checkbox" name="consent"${t.consent ? ' checked' : ''}${ro ? ' disabled' : ''}><span><b>${L('ยินยอมให้เผยแพร่รูปและประวัติในทำเนียบบุคลากร', 'Publish my photo and profile in the staff directory')}</b><br><span class="muted small">${L('เบอร์โทรแสดงแบบปิดบางส่วน ถอนความยินยอมได้ทุกเมื่อ ระบบบันทึกการให้และถอนความยินยอมไว้', 'Phone is partly masked. You can withdraw any time; each change is recorded.')}</span></span></label>
<div class="mrow">${ro ? '' : `<button class="btn pri">${L('บันทึกข้อมูล', 'Save')}</button>`}<button type="button" class="btn" data-act="profview" data-v="${esc(t.id)}">${L('ดูตัวอย่างที่ผู้อื่นเห็น', 'Preview')}</button></div></form>`
}
function vPeople() {
  return `<section class="pagehead"><h1>${L('ทำเนียบบุคลากร', 'Staff directory')}</h1><p class="sub">${L('แสดงประวัติเฉพาะบุคลากรที่ให้ความยินยอมเผยแพร่ เบอร์โทรถูกปิดบางส่วนที่เซิร์ฟเวอร์', 'Profiles appear only for staff who consented; phone numbers are masked on the server')}</p></section>
<div class="controls"><div class="chips">${['ALL', ...DEPTS.map(d => d.code)].map(c => `<button type="button" class="chip" data-act="pdept" data-v="${esc(c)}" aria-pressed="${S.pdept === c}">${c === 'ALL' ? L('ทุกแผนก', 'All') : esc(deptName(c))}</button>`).join('')}</div>
<label class="fld grow"><span>${L('ค้นหาชื่อ', 'Search by name')}</span><input id="pq" value="${esc(S.pq)}" placeholder="${L('เช่น สมชาย', 'e.g. สมชาย')}" autocomplete="off"></label></div>
<div id="people-list" class="people">${peopleList()}</div>`
}

/* AI assistant: rule-based stand-in for function calling over the published timetable */
const EXQ = () => [L('วันพุธบ่าย ครูวิชัยสอนห้องไหน', 'วันพุธบ่าย ครูวิชัยสอนห้องไหน'), L('วันพฤหัสคาบ 3 ห้อง Lab ไหนว่าง', 'Which lab is free Thursday period 3?'), L('ปวช.1 คอมพิวเตอร์ธุรกิจ เรียนอะไรวันศุกร์', 'ปวช.1 คอมพิวเตอร์ธุรกิจ เรียนอะไรวันศุกร์'), L('วิชา 20204-2001 กี่หน่วยกิต ใครสอน', 'Who teaches 20204-2001 and how many credits?')];
function lineOf(s, mode) { const a = A[s.aid], sb = SUB[a.subj]; return `<li>${dayName(s.day)} ${L('คาบ', 'P.')} ${pp(s.start, s.len)} (${pr(s.start, s.len)}) <b>${esc(sb.code)}</b> ${esc(sb.name)} — ${mode === 'teacher' ? esc(grpsOf(s)) : esc(TCH[a.teachers[0]].short)} ${L('ห้อง', 'room')} ${esc(s.room)}</li>` }
const openBtn = (mode, id) => `<p style="margin:8px 0 0"><button type="button" class="btn sm" data-act="openpub" data-mode="${mode}" data-id="${esc(id)}">${L('เปิดตารางฉบับเต็ม', 'Open full timetable')}</button></p>`;
function aiAnswer(q) {
  const s = q.toLowerCase(), v = pubVer(), tr = []; let day = null;
  if (!v) return { tr, html: L('ยังไม่มีตารางฉบับเผยแพร่', 'No published timetable yet') };
  [['จันทร์', 1], ['อังคาร', 2], ['พุธ', 3], ['พฤหัส', 4], ['ศุกร์', 5], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['mon ', 1], ['tue ', 2], ['wed ', 3], ['thu ', 4], ['fri ', 5]].some(([k, d]) => s.includes(k) && (day = d));
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getDay(); if (/วันนี้|today/.test(s)) day = today; if (/พรุ่งนี้|tomorrow/.test(s)) day = (today + 1) % 7;
  if (day === 0 || day === 6) return { tr, html: L('วันเสาร์และวันอาทิตย์ไม่มีการเรียนการสอนในเวลาปกติครับ', 'There are no regular classes at the weekend.') };
  let range = null; if (/เช้า|morning/.test(s)) range = [1, 4]; if (/บ่าย|afternoon/.test(s)) range = [5, P_MAX];
  const pm = s.match(/(?:คาบ(?:ที่)?|period)\s*(\d)/), per = pm ? +pm[1] : null;
  const keep = x => (!day || x.day === day) && (!range || (x.start <= range[1] && x.start + x.len - 1 >= range[0])) && (!per || (per >= x.start && per < x.start + x.len));
  const cm = q.match(/\d{5}-\d{4}/);
  if (cm) {
    const sb = SUB[cm[0]]; tr.push(`getSubjectInfo("${cm[0]}")`); if (!sb) return { tr, html: L(`ไม่พบรหัสวิชา ${cm[0]} ในตารางฉบับเผยแพร่`, `Subject ${cm[0]} is not in the published timetable`) };
    const as = ASG.filter(a => a.subj === sb.code); return { tr, html: `<b>${esc(sb.code)} ${esc(sb.name)}</b><br>${L('หน่วยกิต (ท-ป-น)', 'Credits (T-P-C)')} ${esc(sb.cred)} · ${sb.periods} ${L('คาบ/สัปดาห์', 'periods/week')} · ${rtName(sb.room)}<ul>${as.map(a => `<li>${esc(a.groups.map(g => gName(GRP[g])).join(', '))}: ${esc(a.teachers.map(t => TCH[t].name).join(', '))}</li>`).join('')}</ul>` }
  }
  if (/ว่าง|free|available|empty/.test(s) && /ห้อง|room|lab|แล็บ|โรงฝึก|workshop/.test(s)) {
    if (!day || !per) return { tr, html: L('ช่วยระบุวันและคาบด้วยครับ เช่น “วันพฤหัสคาบ 3 ห้อง Lab ไหนว่าง”', 'Please give a day and a period, e.g. “Which lab is free Thursday period 3?”') };
    const type = /lab|แล็บ|คอม/.test(s) ? 'LAB' : /โรงฝึก|workshop/.test(s) ? 'WS' : /ห้องเรียน|classroom/.test(s) ? 'CLASS' : null;
    tr.push(`findFreeRooms(day=${day}, period=${per}${type ? `, type="${type}"` : ''})`);
    const m = C.idx(v.slots), free = Object.values(RM).filter(r => (!type || r.type.startsWith(type)) && !m.has(C.key('R', r.id, day, per)) && !(r.unav || []).some(u => u.day === day && u.p === per));
    return { tr, html: free.length ? `${L(`ห้องที่ว่างวัน${dayName(day)} คาบ ${per} (${pr(per, 1)}):`, `Free on ${dayName(day)}, period ${per} (${pr(per, 1)}):`)}<ul>${free.map(r => `<li><b>${esc(r.id)}</b> ${esc(r.name)} · ${esc(r.bld)} · ${L('จุ', 'seats')} ${r.cap}</li>`).join('')}</ul>` : L('ไม่มีห้องประเภทนี้ว่างในช่วงเวลานั้นครับ', 'No room of that type is free then.') }
  }
  if (/กี่ชั่วโมง|กี่คาบ|ภาระ|workload|how many hours/.test(s) && /ฉัน|ผม|my|\bi\b/.test(s)) {
    if (S.role !== 'TEACHER') return { tr, html: L('คำถามนี้ต้องเข้าสู่ระบบในฐานะครูก่อนครับ', 'Sign in as a teacher to ask about your own workload.') };
    const t = TCH[S.user], w = load(t.id, v); tr.push(`getTeacherWorkload(${t.id})`);
    return { tr, html: L(`สัปดาห์นี้คุณสอน ${w.tot} ชั่วโมง (ในเวลา ${w.inH}, นอกเวลา ${w.outH}) จากเกณฑ์ ${t.max} ชั่วโมง`, `You teach ${w.tot} hours this week (${w.inH} in hours, ${w.outH} after hours) against a ${t.max}-hour limit.`) }
  }
  const flat = s.replace(/\s/g, '');
  const g = Object.values(GRP).find(g => s.includes(g.id.toLowerCase()) || (DEPT[g.dept] && flat.includes(DEPT[g.dept].th) && flat.includes(`${g.level}${g.year}`)));
  if (g) {
    tr.push(`findGroup("${q.slice(0, 40)}") → ${g.id}`, `getGroupSchedule(${g.id}${day ? `, day=${day}` : ''})`);
    const xs = v.slots.filter(x => A[x.aid].groups.includes(g.id) && keep(x)).sort((a, b) => a.day - b.day || a.start - b.start);
    return { tr, html: `<b>${esc(gName(g))}</b>${day ? ` · ${dayName(day)}` : ''}${xs.length ? `<ul>${xs.map(x => lineOf(x, 'group')).join('')}</ul>` : `<br>${L('ไม่มีคาบเรียนในช่วงที่ถาม', 'No classes in that time')}`}${openBtn('group', g.id)}` }
  }
  let ts = Object.values(TCH).filter(t => s.includes(t.first));
  if (ts.length > 1) { const ts2 = ts.filter(t => s.includes(bare(t.name).split(' ')[1])); if (ts2.length) ts = ts2 }
  if (ts.length > 1) {
    tr.push(`findTeacher("${ts[0].first}") → ${ts.length} ${L('คน', 'matches')}`);
    return { tr, html: `${L(`มีครูชื่อ “${esc(ts[0].first)}” ${ts.length} ท่าน หมายถึงท่านไหนครับ`, `There are ${ts.length} teachers named “${esc(ts[0].first)}”. Which one?`)}<div class="chips" style="margin-top:8px">${ts.map(t => `<button type="button" class="chip" data-act="askex" data-q="${esc(q.replace(t.first, bare(t.name)))}">${esc(t.name)} · ${esc(deptName(t.dept))}</button>`).join('')}</div>` }
  }
  if (ts.length === 1) {
    const t = ts[0]; tr.push(`findTeacher("${t.first}") → ${t.id}`, `getTeacherSchedule(${t.id}${day ? `, day=${day}` : ''}${range ? `, timeRange=${range.join('-')}` : ''})`);
    const xs = v.slots.filter(x => A[x.aid].teachers.includes(t.id) && keep(x)).sort((a, b) => a.day - b.day || a.start - b.start);
    return { tr, html: `<b>${esc(t.name)}</b>${day ? ` · ${dayName(day)}${range ? (range[0] === 1 ? L(' ช่วงเช้า', ' morning') : L(' ช่วงบ่าย', ' afternoon')) : ''}` : ''}${xs.length ? `<ul>${xs.map(x => lineOf(x, 'teacher')).join('')}</ul>` : `<br>${L('ไม่มีคาบสอนในช่วงที่ถาม', 'No teaching in that time')}`}${openBtn('teacher', t.id)}` }
  }
  return { tr, html: L('ยังตอบคำถามนี้ไม่ได้ครับ ลองถามเรื่องตารางครู กลุ่มเรียน ห้องว่าง หรือรหัสวิชา เช่น:', 'I can’t answer that yet. Try a teacher, a class group, free rooms or a subject code, e.g.:') + `<div class="chips" style="margin-top:8px">${EXQ().map(x => `<button type="button" class="chip" data-act="askex" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>` };
}
const msgHTML = m => m.me ? `<div class="msg me">${esc(m.text)}</div>` : `<div class="msg">${m.tr && m.tr.length ? `<div class="trace">${m.tr.map(esc).join('<br>')}</div>` : ''}${m.html}</div>`;
function vAsk() {
  return `<section class="pagehead"><h1>${L('ถามตารางกับ AI', 'Ask the timetable assistant')}</h1><p class="sub">${L('ตอบจากตารางฉบับเผยแพร่เท่านั้น ไม่เข้าถึงข้อมูลส่วนบุคคลของนักเรียน ถ้าไม่พบจะบอกว่าไม่พบ', 'Answers come only from the published timetable, never student personal data. If nothing matches, it says so.')}</p></section>
<div class="card chat"><div class="msgs" id="msgs">${S.chat.length ? S.chat.map(msgHTML).join('') : `<div class="msg">${L('สวัสดีครับ ถามเรื่องตารางเรียน ตารางสอน หรือห้องว่างได้เลย ตัวอย่าง:', 'Hello. Ask about class or teaching timetables, or free rooms. For example:')}<div class="chips" style="margin-top:8px">${EXQ().map(x => `<button type="button" class="chip" data-act="askex" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`}</div>
<form class="ask" data-form="ask"><label class="sr" for="q">${L('คำถาม', 'Question')}</label><input id="q" name="q" maxlength="200" autocomplete="off" placeholder="${L('พิมพ์คำถาม (ไม่เกิน 200 ตัวอักษร)', 'Type a question (max 200 characters)')}"><button class="btn pri">${L('ถาม', 'Ask')}</button></form>
<p class="note">${L('ตอนนี้ตอบด้วยกฎในเครื่องผ่านชุดฟังก์ชันเดียวกับสเปก (บรรทัดสีทองคือฟังก์ชันที่ถูกเรียก) ขั้นถัดไปจะเรียก Google Gemini และค้น TiDB Vector ผ่านเซิร์ฟเวอร์', 'For now, local rules call the same functions as the spec (the gold line shows which). Next step: Google Gemini and TiDB Vector on the server.')}</p></div>`
}
function vLookup() {
  const r = S.lk; let res = '';
  if (r && r.err) res = `<div class="notice">${esc(r.err)}</div>`;
  else if (r) { const v = pubVer(), g = GRP[r.group]; res = `<div class="titleline"><h2>${esc(r.name)}</h2><span class="muted">${L('รหัส', 'ID')} ${esc(r.code)} · ${esc(gName(g))}</span></div>${v ? `<div class="only-wide">${grid(v, 'group', g.id)}</div><div class="only-narrow">${dayList(v, 'group', g.id)}</div>` : ''}` }
  return `<section class="pagehead"><h1>${L('ค้นตารางรายบุคคล', 'Student timetable lookup')}</h1><p class="sub">${L('ค้นด้วยรหัสนักศึกษาพร้อมข้อมูลยืนยันอีกชั้น ระบบไม่เปิดให้ค้นด้วยชื่อ', 'Search by student ID plus a second check. Searching by name is not allowed.')}</p></section>
<div class="split"><form class="card form" data-form="lookup"><h2>${L('ข้อมูลสำหรับค้นหา', 'Look up')}</h2>
<label class="fld"><span>${L('รหัสนักศึกษา', 'Student ID')}</span><input name="code" inputmode="numeric" required maxlength="10" autocomplete="off"></label>
<label class="fld"><span>${L('ข้อมูลยืนยัน: รหัสกลุ่มเรียน', 'Verification: class group code')}</span><input name="grp" required maxlength="8" placeholder="${L('เช่น AU-11', 'e.g. AU-11')}" autocomplete="off"></label>
<button class="btn pri">${L('ค้นหา', 'Search')}</button><p class="note">${L('ข้อมูลทดลอง: 6900101 กับ AU-11', 'Test data: 6900101 with AU-11')}</p></form><div style="display:flex;flex-direction:column;gap:12px;min-width:0">${res || `<div class="card"><p class="muted" style="margin:0">${L('ผลการค้นหาจะแสดงที่นี่ โดยแสดงชื่อแบบย่อเพื่อคุ้มครองข้อมูลส่วนบุคคล', 'Results appear here, with the name shortened to protect personal data.')}</p></div>`}</div></div>`
}
function issueForm(sid) {
  const [s] = sid ? findSlot(sid) : [null];
  return `<form class="form" data-form="issue" style="display:flex;flex-direction:column">${s ? `<input type="hidden" name="sid" value="${s.id}"><p class="note">${L('คาบที่เกี่ยวข้อง', 'Related period')}: <b>${esc(subjOf(s).code)}</b> · ${esc(grpsOf(s))} · ${dayName(s.day)} ${L('คาบ', 'P.')} ${pp(s.start, s.len)}</p>` : ''}
<label class="fld"><span>${L('รายละเอียดปัญหา', 'What is wrong?')}</span><textarea name="desc" required maxlength="500"></textarea></label>
<label class="fld"><span>${L('ช่องทางติดต่อกลับ (ไม่บังคับ)', 'Contact (optional)')}</span><input name="contact" maxlength="80" autocomplete="off"></label><div><button class="btn pri">${L('ส่งเรื่อง', 'Send report')}</button></div></form>`
}
function vPrivacy() {
  return `<section class="pagehead"><h1>${L('แจ้งปัญหาและสิทธิเจ้าของข้อมูล', 'Report a problem & privacy rights')}</h1><p class="sub">${L('ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562', 'Under Thailand’s Personal Data Protection Act B.E. 2562 (2019)')}</p></section>
<div class="cols2"><section class="card"><h2>${L('แจ้งปัญหาตารางเรียน', 'Report a timetable problem')}</h2>${issueForm(null)}</section>
<section class="card"><h2>${L('ยื่นคำร้องเกี่ยวกับข้อมูลส่วนบุคคล', 'Personal data request')}</h2><form class="form" data-form="dsr" style="display:flex;flex-direction:column">
<label class="fld"><span>${L('ชื่อผู้ยื่นคำร้อง', 'Your name')}</span><input name="name" required maxlength="80" autocomplete="name"></label>
<label class="fld"><span>${L('ประเภทคำร้อง', 'Request type')}</span><select name="type"><option value="VIEW">${L('ขอดูข้อมูลของฉัน', 'See my data')}</option><option value="EDIT">${L('ขอแก้ไขข้อมูล', 'Correct my data')}</option><option value="DEL">${L('ขอลบ / ถอนความยินยอม', 'Delete / withdraw consent')}</option></select></label>
<label class="fld"><span>${L('รายละเอียด', 'Details')}</span><textarea name="detail" required maxlength="500"></textarea></label><div><button class="btn pri">${L('ยื่นคำร้อง', 'Submit request')}</button></div></form></section>
<section class="card" style="grid-column:1/-1"><h2>${L('สรุปนโยบายความเป็นส่วนตัว (ฉบับ 1.0)', 'Privacy policy summary (v1.0)')}</h2><ul style="margin:0;padding-left:20px">
<li>${L('เก็บเฉพาะข้อมูลที่ใช้จัดตาราง: รหัสนักศึกษา ชื่อ กลุ่มเรียน และวิชาที่ลงทะเบียน', 'We keep only what timetabling needs: student ID, name, class group and enrolled subjects.')}</li>
<li>${L('ไม่เก็บเลขบัตรประชาชน วันเกิด หรือที่อยู่', 'We do not store national ID numbers, birth dates or addresses.')}</li>
<li>${L('การจัดตารางเป็นภารกิจของสถานศึกษา จึงไม่ต้องขอความยินยอม ส่วนรูปและประวัติในทำเนียบเผยแพร่เมื่อได้รับความยินยอมเท่านั้น', 'Timetabling is the college’s public task and needs no consent; directory photos and profiles are published only with consent.')}</li>
<li>${L('ข้อมูลนักศึกษาที่สำเร็จการศึกษาแล้วจะถูกลบตามระยะเวลาที่วิทยาลัยกำหนด', 'Data of graduated students is deleted on the college’s retention schedule.')}</li></ul></section></div>`
}
function vLogin() {
  if (ME && ME.mustChange) return `<div class="card login"><img class="logo" src="/logo.webp" alt="" width="84" height="84"><h2 style="justify-content:center">${L('ตั้งรหัสผ่านใหม่', 'Set a new password')}</h2><p class="note">${L('นี่คือการเข้าสู่ระบบครั้งแรก กรุณาเปลี่ยนรหัสผ่านเริ่มต้นก่อนใช้งาน', 'This is your first sign-in. Change the initial password to continue.')}</p>
<form class="form" data-form="password" style="display:flex;flex-direction:column"><input type="text" name="username" value="${esc(ME.name)}" autocomplete="username" hidden><label class="fld"><span>${L('รหัสผ่านปัจจุบัน', 'Current password')}</span><input name="current" type="password" required autocomplete="current-password"></label>
<label class="fld"><span>${L('รหัสผ่านใหม่ (8 ตัวอักษรขึ้นไป)', 'New password (8+ characters)')}</span><input name="next" type="password" required minlength="8" autocomplete="new-password"></label>
<label class="fld"><span>${L('ยืนยันรหัสผ่านใหม่', 'Repeat new password')}</span><input name="next2" type="password" required minlength="8" autocomplete="new-password"></label><p class="note" id="lerr" hidden></p><button class="btn pri">${L('บันทึกรหัสผ่าน', 'Save password')}</button></form><button type="button" class="btn" data-act="logout">${L('ออกจากระบบ', 'Sign out')}</button></div>`;
  return `<div class="card login"><img class="logo" src="/logo.webp" alt="" width="84" height="84"><h2 style="justify-content:center">${L('เข้าสู่ระบบสำหรับบุคลากร', 'Staff sign-in')}</h2>
<form class="form" data-form="login" style="display:flex;flex-direction:column"><label class="fld"><span>${L('ชื่อผู้ใช้ (admin หรือรหัสบุคลากร เช่น PT-001)', 'Username (admin or staff code, e.g. PT-001)')}</span><input name="u" required autocomplete="username"></label>
<label class="fld"><span>${L('รหัสผ่าน', 'Password')}</span><input name="p" type="password" required autocomplete="current-password"></label><p class="note" id="lerr" hidden></p><button class="btn pri">${L('เข้าสู่ระบบ', 'Sign in')}</button></form>
<p class="note">${L('ใส่รหัสผิด 5 ครั้งบัญชีจะถูกล็อก 15 นาที ลืมรหัสผ่านติดต่อฝ่ายวิชาการ', 'Five wrong attempts lock the account for 15 minutes. Forgot your password? Contact academic affairs.')}</p></div>`
}

/* ===== back office ===== */
const STEPS = [['สร้าง snapshot ของฉบับปัจจุบัน', 'Snapshot the current version'], ['โหลดภาคเรียน ครู ห้อง เงื่อนไข และคาบที่ปักหมุด', 'Load term, teachers, rooms, constraints and pinned periods'], ['CSP: วางคาบตามเงื่อนไขบังคับ (MRV)', 'CSP: place periods under hard constraints (MRV)'], ['คำนวณคะแนนความเหมาะสม', 'Score the result'], ['บันทึกเป็นฉบับร่างใหม่ลงฐานข้อมูล', 'Save as a new draft in the database']];
function jobHTML() {
  const j = S.job;
  let h = `<h2>${L('จัดตารางอัตโนมัติ', 'Auto-schedule')}</h2><p class="note">${L('ผลลัพธ์จะเป็นฉบับร่างเสมอ ตรวจแล้วจึงกดเผยแพร่ คาบที่ปักหมุดในฉบับร่างล่าสุดจะไม่ถูกย้าย', 'Results are always saved as a draft for review. Periods pinned in the latest draft stay where they are.')}</p>
<div class="row" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap"><label class="fld"><span>Seed</span><input id="seed" type="number" min="1" max="99999" value="${j ? j.seed : Math.floor(Math.random() * 900 + 100)}" style="width:120px"></label><button type="button" class="btn pri" data-act="runjob"${j && !j.done ? ' disabled' : ''}>${L('เริ่มจัดตาราง', 'Run scheduler')}</button></div>`;
  if (!W()) h = `<h2>${L('จัดตารางอัตโนมัติ', 'Auto-schedule')}</h2><p class="note">${L('ฝ่ายวิชาการเป็นผู้สั่งจัดตาราง ผู้บริหารดูผลได้ที่หน้าเวอร์ชัน', 'Academic affairs runs the scheduler; see results under Versions.')}</p>`;
  if (j) {
    h += `<ol class="steps">${STEPS.map((s, i) => `<li class="${i < j.step || j.done ? 'done' : i === j.step && !j.done ? 'now' : ''}">${L(s[0], s[1])}</li>`).join('')}</ol>`;
    const v = j.vid && VERS.find(x => x.id === j.vid);
    if (j.done && v) h += `<div class="notice info"><div><b>${esc(v.name)}</b><br>${L('วางได้', 'Placed')} ${placed(v)} / ${TOTAL()} ${L('คาบ', 'periods')} · ${L('คะแนน', 'score')} ${v.fitness}/1000 · ${L('คาบชนกัน', 'conflicts')} ${conflicts(v.slots)} · ${j.ms} ms</div><a class="btn sm" href="#editor" data-act="openver" data-v="${v.id}">${L('เปิดในหน้าแก้ตาราง', 'Open in editor')}</a></div>
${v.unplaced.length ? `<div><b>${L('วางไม่ได้', 'Could not place')}</b><ul class="reasons bad">${v.unplaced.map(u => `<li>${esc(SUB[A[u.aid].subj].code)} · ${esc(gName(GRP[A[u.aid].groups[0]]))}: ${esc(u.why)}</li>`).join('')}</ul></div>` : ''}`;
    if (j.done && !v) h += `<p class="note">${L('ไม่สำเร็จ ลองอีกครั้ง', 'Failed; try again')}</p>`;
  }
  return h;
}
const crText = c => { const [s] = findSlot(c.sid); return s ? `${subjOf(s).code} ${grpsOf(s)}: ${dayShort(c.from.day)} ${pp(c.from.start, s.len)} → ${dayShort(c.to.day)} ${pp(c.to.start, s.len)}` : ref('CR', c.id) };
function vDash() {
  const v = pubVer();
  if (!v) return empty(L('ยังไม่มีตารางฉบับเผยแพร่', 'No timetable has been published yet'));
  if (S.role === 'TEACHER') {
    const t = TCH[S.user], mine = CR.filter(c => c.by === t.id);
    return `<section class="pagehead"><h1>${L('ตารางสอนของฉัน', 'My timetable')}</h1><p class="sub">${esc(t.name)} · ${esc(t.pos)}</p></section>
<div class="cols2"><section class="card"><h2>${L('ภาระงานสอน (ฉบับเผยแพร่)', 'Teaching load (published)')}</h2>${wbar(t.id, v)}<p class="note">${L('1 คาบ = 1 ชั่วโมง · เขียว < 90% · ส้ม 90–100% · แดง > 100%', '1 period = 1 hour · green < 90% · orange 90–100% · red > 100%')}</p></section>
<section class="card"><h2>${L('คำขอย้ายคาบของฉัน', 'My move requests')}</h2>${mine.length ? mine.map(c => `<div>${pill(c.status)} ${ref('CR', c.id)} · ${esc(crText(c))}</div>`).join('') : `<p class="muted" style="margin:0">${L('ยังไม่มีคำขอ', 'No requests yet')}</p>`}<div><a class="btn sm" href="#editor">${L('ขอย้ายคาบ', 'Request a move')}</a></div></section></div>
${viewTitle('teacher', t.id)}<div class="only-wide">${grid(v, 'teacher', t.id)}</div><div class="only-narrow">${dayList(v, 'teacher', t.id)}</div>`
  }
  const d = latestDraft(), pend = CR.filter(c => c.status === 'PENDING').length, open = ISS.filter(i => i.status !== 'RESOLVED').length, c = conflicts(v.slots);
  const rooms = Object.values(RM).map(r => { let u = 0; v.slots.forEach(s => { if (s.room === r.id) for (let p = s.start; p < s.start + s.len; p++)if (!PER[p].out) u++ }); return { r, pct: Math.round(u / (5 * IN_MAX - (r.unav || []).length) * 100) } }).sort((a, b) => b.pct - a.pct);
  return `<section class="pagehead"><h1>${L('แดชบอร์ดฝ่ายวิชาการ', 'Academic affairs dashboard')}</h1><p class="sub">${L('ภาคเรียนที่ 2/2569', 'Semester 2/2026')} · ${Object.keys(GRP).length} ${L('กลุ่มเรียน', 'groups')} · ${Object.keys(TCH).length} ${L('ครู', 'teachers')} · ${Object.keys(RM).length} ${L('ห้อง', 'rooms')} · ${ASG.length} ${L('รายการสอน', 'teaching assignments')}</p></section>
<div class="kpis"><div class="kpi"><span>${L('คาบที่จัดแล้ว (ฉบับเผยแพร่)', 'Periods placed (published)')}</span><b>${placed(v)} / ${TOTAL()}</b><small>${Math.round(placed(v) / TOTAL() * 100)}%</small></div>
<div class="kpi ${c ? '' : 'good'}"><span>${L('คาบชนกัน', 'Conflicts')}</span><b>${c}</b><small>${L('ตรวจจากข้อมูลจริงทุกคาบ', 'checked on every period')}</small></div>
<div class="kpi"><span>${L('คะแนนความเหมาะสม', 'Fitness score')}</span><b>${v.fitness}</b><small>/ 1000${d ? ` · ${L('ร่างล่าสุด', 'latest draft')} ${d.fitness}` : ''}</small></div>
<div class="kpi"><span>${L('คำขอรออนุมัติ', 'Pending requests')}</span><b>${pend}</b><small><a href="#requests">${L('ไปที่คำขอ', 'Review')}</a></small></div>
<div class="kpi"><span>${L('ปัญหาที่ยังเปิด', 'Open issues')}</span><b>${open}</b><small><a href="#requests" data-act="reqtab" data-v="iss">${L('ดูกระดาน', 'View board')}</a></small></div></div>
<div class="cols2"><section class="card" id="jobcard">${jobHTML()}</section>
<section class="card"><h2>${L('การใช้ห้อง (% ของคาบในเวลา)', 'Room usage (% of in-hours periods)')}</h2><div class="wlist">${rooms.map(x => `<div class="wl"><div class="wl-h"><span>${esc(x.r.id)} <span class="muted small">${esc(rtName(x.r.type))}</span></span><b>${x.pct}%</b></div><div class="bar"><i class="gold" style="width:${x.pct}%"></i></div></div>`).join('')}</div></section></div>
<section class="card"><h2>${L('ภาระงานสอนรายคน (ฉบับเผยแพร่)', 'Teaching load per teacher (published)')}</h2><div class="wlist">${Object.keys(TCH).filter(id => !isExe(TCH[id])).sort((a, b) => load(b, v).tot / TCH[b].max - load(a, v).tot / TCH[a].max).map(t => wbar(t, v)).join('')}</div></section>
<section class="card"><h2>${L('รายการสอนที่ยังไม่ได้จัด', 'Unscheduled assignments')}</h2>${v.unplaced.length ? `<ul class="reasons bad">${v.unplaced.map(u => `<li>${esc(SUB[A[u.aid].subj].code)}: ${esc(u.why)}</li>`).join('')}</ul>` : `<p class="muted" style="margin:0">${L('จัดครบทุกรายการ', 'Every assignment is scheduled')}</p>`}</section>`
}

const ver = () => VERS.find(v => v.id === S.ed.ver) || pubVer();
const canEdit = s => { const v = ver(); if (ME && ME.imp) return false; if (s.locked && S.role !== 'ADMIN') return false; if (S.role === 'ADMIN') return v.status === 'DRAFT'; if (S.role === 'TEACHER') return A[s.aid].teachers.includes(S.user) && v.status !== 'ARCHIVED'; return false };
function computeStatuses(s) {
  const v = ver(), m = C.idx(v.slots, s.id), a = A[s.aid]; S.ed.st = {}; if (s.locked) return;
  for (let d = 1; d <= 5; d++)for (let p = 1; p <= P_MAX; p++) { if (d === s.day && p === s.start) continue; if (p + s.len - 1 <= P_MAX) S.ed.st[d + '|' + p] = C.check(m, a, d, p, s.len, s.room) }
}
function paint() {
  const tt = document.getElementById('tt'); if (!tt) return; tt.classList.toggle('picking', !!S.ed.sel);
  tt.querySelectorAll('.cell').forEach(c => {
    const r = S.ed.sel && S.ed.st && S.ed.st[c.dataset.day + '|' + c.dataset.p];
    if (r) { c.dataset.st = r.status; c.title = [...r.hard, ...r.soft].join('\n') || L('วางได้', 'Fits') } else { delete c.dataset.st; c.removeAttribute('title') }
  })
}
function select(s) { S.ed.sel = s.id; S.ed.pending = null; computeStatuses(s) }
const clearSel = () => { S.ed.sel = null; S.ed.st = null; S.ed.pending = null };
const snap = v => S.ed.undo.push({ vid: v.id, slots: v.slots.map(({ id, aid, day, start, len, room, locked, split }) => ({ id, aid, day, start, len, room, locked, split })) }) > 30 && S.ed.undo.shift();
function suggest(s, d, p, r) {
  const v = ver(), a = A[s.aid], out = { swaps: [], rooms: [] };
  if (r.roomOnly) { const m = C.idx(v.slots, s.id), cur = RM[s.room]; out.rooms = Object.values(RM).filter(x => x.id !== s.room && x.type === cur.type && x.cap >= C.gsize(a) && C.check(m, a, d, p, s.len, x.id).status !== 'red').sort((x, y) => (x.bld === cur.bld ? 0 : 1) - (y.bld === cur.bld ? 0 : 1)).slice(0, 3) }
  const hit = new Set(r.blockers.map(b => b.id));
  v.slots.forEach(x => {
    if (x.id === s.id || x.len !== s.len || x.locked || !A[x.aid].teachers.some(t => a.teachers.includes(t))) return;
    if (S.role === 'TEACHER' && !A[x.aid].teachers.includes(S.user)) return;
    const m2 = C.idx(v.slots, s.id, x.id); if (C.check(m2, a, x.day, x.start, s.len, s.room).status === 'red' || C.check(m2, A[x.aid], s.day, s.start, x.len, x.room).status === 'red') return;
    const tmp = v.slots.map(y => y.id === s.id ? { ...y, day: x.day, start: x.start } : y.id === x.id ? { ...y, day: s.day, start: s.start } : y);
    out.swaps.push({ x, fit: C.fitness(tmp), hit: hit.has(x.id) })
  });
  out.swaps.sort((u, w) => (w.hit - u.hit) || (w.fit - u.fit)); out.swaps = out.swaps.slice(0, 3); return out
}
function tryMove(d, p) {
  const [s] = findSlot(S.ed.sel), r = S.ed.st && S.ed.st[d + '|' + p]; if (!s || !r || S.busy) return;
  if (r.status === 'green' && ver().status === 'DRAFT') { doMove(s, d, p); return }
  S.ed.pending = { d, p, r, sug: r.status === 'red' ? suggest(s, d, p, r) : null }; render()
}
async function doMove(s, d, p, room) {
  const v = ver(); snap(v); clearSel();
  if (!await act('move', { vid: v.id, sid: s.id, day: d, start: p, room, rv: s.rv }, L('ย้ายคาบแล้ว', 'Period moved'), () => { s.day = d; s.start = p; if (room) s.room = room })) S.ed.undo.pop()
}
function edPanel(v) {
  const sel = S.ed.sel && findSlot(S.ed.sel)[0];
  if (!sel) {
    const t = S.ed.mode === 'teacher' ? S.ed.id : null;
    return `<section class="card panel"><h2>${L('ภาพรวมฉบับนี้', 'This version')}</h2><dl class="kv"><dt>${L('สถานะ', 'Status')}</dt><dd>${pill(v.status)}</dd><dt>${L('คะแนน', 'Score')}</dt><dd>${v.fitness} / 1000</dd><dt>${L('คาบที่จัด', 'Placed')}</dt><dd>${placed(v)} / ${TOTAL()}</dd><dt>${L('คาบชนกัน', 'Conflicts')}</dt><dd>${conflicts(v.slots)}</dd></dl>${t ? wbar(t, v) : ''}
<div class="legend" style="flex-direction:column;gap:4px"><span><i style="background:var(--ok-bg);box-shadow:inset 0 0 0 2px var(--ok)"></i>${L('เขียว: วางได้ทันที', 'Green: fits')}</span><span><i style="background:var(--warn-bg);box-shadow:inset 0 0 0 2px var(--warn)"></i>${L('เหลือง: วางได้แต่ผิดเงื่อนไขแนะนำ ต้องยืนยัน', 'Yellow: fits but breaks a preference; confirm')}</span><span><i style="background:var(--bad-bg);box-shadow:inset 0 0 0 1px var(--bad)"></i>${L('แดง: ชนเงื่อนไขบังคับ ดูสาเหตุและทางแก้', 'Red: hard clash; see why and fixes')}</span></div>
<p class="note">${L('ลากคาบไปวาง หรือคลิกคาบแล้วคลิกช่องปลายทาง กด Esc เพื่อยกเลิก ทุกการบันทึกถูกตรวจซ้ำที่เซิร์ฟเวอร์', 'Drag a period, or click it then click a target. Esc cancels. Every save is re-checked on the server.')}</p></section>`
  }
  const a = A[sel.aid], pd = S.ed.pending, isAdmin = S.role === 'ADMIN', draft = v.status === 'DRAFT';
  let h = `<section class="card panel"><h2>${L('คาบที่เลือก', 'Selected period')}</h2>${slotDetail(sel)}${a.teachers.map(t => wbar(t, v)).join('')}`;
  if (sel.locked) h += `<div class="notice">${L('คาบนี้ถูกปักหมุดไว้ ต้องปลดหมุดก่อนจึงย้ายได้', 'This period is pinned. Unpin it to move it.')}</div>`;
  if (pd) {
    const r = pd.r; h += `<div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line);padding-top:12px"><h3>${L('ย้ายไป', 'Move to')} ${dayName(pd.d)} ${L('คาบ', 'period')} ${pp(pd.p, sel.len)} <span class="stchip ${r.status}">${{ green: L('เขียว', 'Green'), yellow: L('เหลือง', 'Yellow'), red: L('แดง', 'Red') }[r.status]}</span></h3>
${r.hard.length ? `<ul class="reasons bad">${r.hard.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${r.soft.length ? `<ul class="reasons warn">${r.soft.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    if (r.status !== 'red') {
      h += draft ? `<div class="mrow"><button type="button" class="btn pri" data-act="confirmmove">${L('ยืนยันย้าย', 'Confirm move')}</button><button type="button" class="btn" data-act="cancelpend">${L('ยกเลิก', 'Cancel')}</button></div>`
        : `<label class="fld"><span>${L('เหตุผลที่ขอย้าย', 'Reason for the move')}</span><textarea id="crnote" maxlength="300"></textarea></label><div class="mrow"><button type="button" class="btn pri" data-act="sendcr">${L('ส่งคำขอย้ายคาบ', 'Send move request')}</button><button type="button" class="btn" data-act="cancelpend">${L('ยกเลิก', 'Cancel')}</button></div><p class="note">${L('ฉบับนี้เผยแพร่แล้ว คำขอจะส่งให้ฝ่ายวิชาการอนุมัติและตรวจชนซ้ำ', 'This version is published; the request goes to academic affairs, who re-check before applying.')}</p>`
    }
    else if (draft) { const sg = pd.sug; h += `<h3>${L('ทางแก้อัตโนมัติ', 'Suggested fixes')}</h3><div class="sug">${sg.rooms.map(x => `<button type="button" class="btn sm" data-act="doroom" data-v="${esc(x.id)}">${L('เปลี่ยนห้องเป็น', 'Change room to')} ${esc(x.id)} · ${esc(x.bld)} (${L('จุ', 'seats')} ${x.cap})</button>`).join('')}${sg.swaps.map(w => `<button type="button" class="btn sm" data-act="doswap" data-v="${w.x.id}">${L('สลับกับ', 'Swap with')} ${esc(subjOf(w.x).code)} · ${dayShort(w.x.day)} ${L('คาบ', 'P.')} ${pp(w.x.start, w.x.len)} · ${L('คะแนน', 'score')} ${w.fit}</button>`).join('')}${!sg.rooms.length && !sg.swaps.length ? `<p class="note">${L('ไม่พบทางแก้อัตโนมัติ ลองวางในช่องสีเขียว', 'No automatic fix found; try a green cell')}</p>` : ''}</div>` }
    h += '</div>'
  }
  if (draft && !sel.locked && sel.len >= 2 && !pd) {
    const opts = sel.len === 4 ? ['2,2', '3,1'] : sel.len === 3 ? ['2,1'] : ['1,1'];
    h += `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:12px"><h3>${L('แบ่งคาบ', 'Split block')}</h3><div class="mrow">${opts.map(o => `<button type="button" class="btn sm" data-act="split" data-v="${o}">[${o}]</button>`).join('')}</div><p class="note">${L('รวมคาบยังเท่าเดิม ส่วนที่แยกออกจะถูกเลือกไว้ให้ย้ายต่อได้ทันที', 'Total periods stay the same; the new part is selected so you can move it right away.')}</p></div>`
  }
  h += `<div class="mrow" style="border-top:1px solid var(--line);padding-top:12px">${isAdmin && draft ? `<button type="button" class="btn sm" data-act="pin">${sel.locked ? L('ปลดหมุด', 'Unpin') : L('ปักหมุดไม่ให้ตัวจัดตารางย้าย', 'Pin for the scheduler')}</button>` : ''}<button type="button" class="btn sm" data-act="cancelsel">${L('ยกเลิกการเลือก', 'Deselect')}</button></div></section>`;
  return h
}
function vEditor() {
  const vs = VERS.filter(v => v.status !== 'ARCHIVED'); if (!vs.length) return empty(L('ยังไม่มีฉบับตาราง', 'No timetable versions yet'));
  if (!vs.find(v => v.id === S.ed.ver)) S.ed.ver = (S.role === 'ADMIN' && latestDraft() || pubVer() || vs[0]).id;
  if (!exists(S.ed.mode, S.ed.id)) S.ed.id = firstOf(S.ed.mode);
  const v = ver(), T = S.role === 'TEACHER';
  const notice = !W() && !T ? `<div class="notice info">${L('ดูได้อย่างเดียว', 'Read only')}</div>` : v.status === 'PUBLISHED' ? (T ? `<div class="notice">${L('กำลังดูฉบับเผยแพร่: การย้ายคาบจะส่งเป็นคำขอให้ฝ่ายวิชาการอนุมัติ', 'Viewing the published version: moves are sent as requests for approval.')}</div>` : `<div class="notice">${L('ฉบับนี้เผยแพร่แล้ว แก้ได้เฉพาะฉบับร่าง', 'Published versions can’t be edited; edit a draft instead.')}<button type="button" class="btn sm" data-act="clone" data-v="${v.id}">${L('โคลนเป็นฉบับร่าง', 'Clone as draft')}</button></div>`) : T ? `<div class="notice info">${L('ฉบับร่าง: ครูย้ายได้เฉพาะคาบที่ตนสอน', 'Draft: teachers can move only their own periods.')}</div>` : '';
  return `<section class="pagehead"><h1>${L('แก้ไขตาราง', 'Edit timetable')}</h1></section>
<div class="controls"><label class="fld"><span>${L('ฉบับ', 'Version')}</span><select data-chg="edver">${vs.map(x => `<option value="${x.id}"${x.id === v.id ? ' selected' : ''}>${esc(x.name)} · ${statusName(x.status)}</option>`).join('')}</select></label>
<div class="seg">${['group', 'teacher', 'room'].map(k => `<button type="button" data-act="edmode" data-v="${k}" aria-pressed="${S.ed.mode === k}">${modeName(k)}</button>`).join('')}</div>
<label class="fld"><span>${modeName(S.ed.mode)}</span><select data-chg="edsel">${optionsHTML(S.ed.mode, S.ed.id)}</select></label>
<button type="button" class="btn" data-act="undo"${S.ed.undo.some(u => u.vid === v.id) ? '' : ' disabled'}>${L('ย้อนกลับ', 'Undo')} (${S.ed.undo.filter(u => u.vid === v.id).length})</button></div>
${notice}${viewTitle(S.ed.mode, S.ed.id)}<div class="ed"><div style="min-width:0;display:flex;flex-direction:column;gap:10px">${grid(v, S.ed.mode, S.ed.id, { ed: true })}${legend()}</div>${edPanel(v)}</div>`
}
function diffList(a, b) {
  const mb = new Map(b.slots.map(s => [s.aid + '|' + s.split, s])), out = [];
  a.slots.forEach(s => {
    const o = mb.get(s.aid + '|' + s.split); mb.delete(s.aid + '|' + s.split);
    if (!o) out.push(`${L('เพิ่ม', 'Added')} ${subjOf(s).code} ${grpsOf(s)} · ${dayShort(s.day)} ${pp(s.start, s.len)}`);
    else if (o.day !== s.day || o.start !== s.start || o.room !== s.room || o.len !== s.len) out.push(`${subjOf(s).code} ${grpsOf(s)}: ${dayShort(o.day)} ${L('คาบ', 'P.')} ${pp(o.start, o.len)} ${o.room} → ${dayShort(s.day)} ${L('คาบ', 'P.')} ${pp(s.start, s.len)} ${s.room}`)
  });
  mb.forEach(s => out.push(`${L('นำออก', 'Removed')} ${subjOf(s).code} ${grpsOf(s)}`)); return out
}
function vVersions() {
  const pv = pubVer();
  const rows = [...VERS].reverse().map(v => `<tr><td><b>${esc(v.name)}</b><br><span class="muted small">${esc(v.id)} · ${L('สร้าง', 'created')} ${fmtDate(v.created)}${v.published ? ` · ${L('เผยแพร่', 'published')} ${fmtDate(v.published)}` : ''}</span></td><td>${pill(v.status)}</td><td>${esc(v.source)}${v.seed ? ` · seed ${v.seed}` : ''}</td><td class="num">${v.fitness}</td><td class="num">${Math.round(placed(v) / TOTAL() * 100)}%</td><td class="num">${conflicts(v.slots)}</td>
<td><div class="mrow">${!W() ? '' : v.status === 'DRAFT' ? `<a class="btn sm" href="#editor" data-act="openver" data-v="${v.id}">${L('แก้ไข', 'Edit')}</a><button type="button" class="btn sm pri" data-act="askpublish" data-v="${v.id}">${L('เผยแพร่', 'Publish')}</button>` : ''}${W() && v.status === 'ARCHIVED' ? `<button type="button" class="btn sm" data-act="askpublish" data-v="${v.id}">${L('เผยแพร่ซ้ำ (Rollback)', 'Re-publish (rollback)')}</button>` : ''}${W() ? `<button type="button" class="btn sm" data-act="clone" data-v="${v.id}">${L('โคลน', 'Clone')}</button>` : ''}${v.status !== 'PUBLISHED' && pv ? `<button type="button" class="btn sm" data-act="diff" data-v="${v.id}">${L('เทียบกับฉบับเผยแพร่', 'Compare to published')}</button>` : ''}</div></td></tr>`).join('');
  let df = ''; if (S.diff && pv) { const v = VERS.find(x => x.id === S.diff); if (v) { const list = diffList(v, pv); df = `<section class="card"><h2>${L('เทียบ', 'Compare')} ${esc(v.name)} ${L('กับฉบับเผยแพร่', 'with published')}</h2>${list.length ? `<p class="note">${list.length} ${L('รายการที่ต่างกัน', 'differences')}</p><ul style="margin:0;padding-left:20px">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted" style="margin:0">${L('เหมือนฉบับเผยแพร่ทุกคาบ', 'Identical to the published version')}</p>`}</section>` } }
  return `<section class="pagehead"><h1>${L('เวอร์ชันตาราง', 'Timetable versions')}</h1><p class="sub">${L('นักเรียนเห็นเฉพาะฉบับเผยแพร่ การ Rollback คือการเผยแพร่ฉบับก่อนหน้าซ้ำ', 'Students only see the published version. Rollback re-publishes an earlier one.')}</p></section>
<div class="tblwrap"><table><thead><tr><th>${L('ชื่อฉบับ', 'Version')}</th><th>${L('สถานะ', 'Status')}</th><th>${L('ที่มา', 'Source')}</th><th>${L('คะแนน', 'Score')}</th><th>${L('จัดครบ', 'Placed')}</th><th>${L('ชน', 'Clashes')}</th><th>${L('จัดการ', 'Actions')}</th></tr></thead><tbody>${rows}</tbody></table></div>${df}`
}
function vRequests() {
  const T = S.role === 'TEACHER'; const tab = T ? 'cr' : S.reqTab;
  const tabs = T ? '' : `<div class="seg">${[['cr', L('คำขอย้ายคาบ', 'Move requests')], ['iss', L('แจ้งปัญหา', 'Issues')], ['dsr', L('คำร้อง PDPA', 'PDPA requests')], ['aud', L('บันทึกการใช้งาน', 'Audit log')]].map(([k, t]) => `<button type="button" data-act="reqtab" data-v="${k}" aria-pressed="${tab === k}">${t}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'cr') {
    body = CR.length ? `<div class="tblwrap"><table><thead><tr><th>${L('เลขที่', 'No.')}</th><th>${L('ผู้ขอ', 'By')}</th><th>${L('รายการ', 'Change')}</th><th>${L('เหตุผล', 'Reason')}</th><th>${L('สถานะ', 'Status')}</th>${T ? '' : `<th></th>`}</tr></thead><tbody>${CR.map(c => `<tr><td>${ref('CR', c.id)}<br><span class="muted small">${fmtTime(c.at)}</span></td><td>${esc(TCH[c.by] ? TCH[c.by].short : c.by)}</td><td>${esc(crText(c))}${c.err ? `<div class="err">${esc(c.err)}</div>` : ''}</td><td>${esc(c.note || '–')}</td><td>${pill(c.status)}</td>${T ? '' : `<td>${W() && c.status === 'PENDING' ? `<div class="mrow"><button type="button" class="btn sm pri" data-act="crok" data-v="${c.id}">${L('อนุมัติ', 'Approve')}</button><button type="button" class="btn sm" data-act="crno" data-v="${c.id}">${L('ไม่อนุมัติ', 'Reject')}</button></div>` : ''}</td>`}</tr>`).join('')}</tbody></table></div>` : `<p class="muted">${L('ยังไม่มีคำขอ', 'No requests yet')}</p>`
  }
  if (tab === 'iss') body = `<div class="board">${['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((st, i, arr) => `<div class="col"><h3>${statusName(st)} (${ISS.filter(x => x.status === st).length})</h3>${ISS.filter(x => x.status === st).map(x => { const [s] = x.sid ? findSlot(x.sid) : [null]; return `<div class="icard"><b>${ref('ISS', x.id)}</b><span>${esc(x.desc)}</span>${s ? `<span class="muted small">${esc(subjOf(s).code)} · ${esc(grpsOf(s))} · ${dayShort(s.day)} ${pp(s.start, s.len)}</span>` : ''}<span class="muted small">${fmtTime(x.at)}${x.contact ? ` · ${esc(x.contact)}` : ''}</span><div class="mrow">${!W() ? '' : i > 0 ? `<button type="button" class="btn sm" data-act="issmove" data-v="${x.id}" data-to="${arr[i - 1]}">← ${statusName(arr[i - 1])}</button>` : ''}${i < 2 ? `<button type="button" class="btn sm" data-act="issmove" data-v="${x.id}" data-to="${arr[i + 1]}">${statusName(arr[i + 1])} →</button>` : ''}</div></div>` }).join('')}</div>`).join('')}</div>`;
  if (tab === 'dsr') body = DSR.length ? `<div class="tblwrap"><table><thead><tr><th>${L('เลขที่', 'No.')}</th><th>${L('ผู้ยื่น', 'Requester')}</th><th>${L('ประเภท', 'Type')}</th><th>${L('รายละเอียด', 'Details')}</th><th>${L('สถานะ', 'Status')}</th><th></th></tr></thead><tbody>${DSR.map(x => `<tr><td>${ref('DSR', x.id)}<br><span class="muted small">${fmtTime(x.at)}</span></td><td>${esc(x.name)}</td><td>${{ VIEW: L('ขอดู', 'View'), EDIT: L('ขอแก้', 'Correct'), DEL: L('ขอลบ', 'Delete') }[x.type]}</td><td>${esc(x.detail)}</td><td>${pill(x.status)}</td><td>${W() && x.status === 'PENDING' ? `<button type="button" class="btn sm" data-act="dsrdone" data-v="${x.id}">${L('บันทึกว่าดำเนินการแล้ว', 'Mark done')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${L('ไม่มีคำร้อง', 'No requests')}</p>`;
  if (tab === 'aud') body = `<div class="tblwrap"><table><thead><tr><th>${L('เวลา', 'Time')}</th><th>${L('ผู้ทำ', 'Actor')}</th><th>${L('การกระทำ', 'Action')}</th><th>${L('รายละเอียด', 'Details')}</th></tr></thead><tbody>${AUD.map(x => `<tr><td>${fmtTime(x.at)}</td><td>${esc(x.who)}</td><td><code>${esc(x.action)}</code></td><td>${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<section class="pagehead"><h1>${T ? L('คำขอของฉัน', 'My requests') : L('คำขอและคำร้อง', 'Requests')}</h1></section>${tabs}${body}`
}
function vData() {
  const tab = S.dataTab; let tbl = '';
  const T = (head, rows) => `<div class="tblwrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const un = x => (x.unav || []).length ? `${dayShort(x.unav[0].day)} ${L('คาบ', 'P.')} ${x.unav.map(u => u.p).join(',')} · ${esc(x.unav[0].reason)}` : '–';
  if (tab === 'teachers') tbl = T([L('รหัส', 'Code'), L('ชื่อ-สกุล', 'Name'), L('แผนก', 'Dept.'), L('ตำแหน่ง', 'Position'), L('ชม./สัปดาห์สูงสุด', 'Max h/week'), L('ไม่ว่าง', 'Unavailable'), L('เผยแพร่ประวัติ', 'Public profile'), ''], Object.values(TCH).sort((a, b) => isExe(b) - isExe(a)).map(t => `<tr><td>${esc(t.emp)}</td><td>${esc(t.name)}</td><td>${esc(deptName(t.dept))}</td><td>${esc(t.pos)}</td><td class="num">${t.max}</td><td>${un(t)}</td><td>${t.consent ? L('ยินยอม', 'Consented') : L('ไม่ยินยอม', 'No')}</td><td><div class="mrow"><button type="button" class="btn sm" data-act="profview" data-v="${esc(t.id)}">${L('ดูข้อมูล', 'Profile')}</button>${W() ? `<button type="button" class="btn sm" data-act="doviewas" data-v="${esc(t.emp)}">${L('ดูในมุมนี้', 'View as')}</button>` : ''}</div></td></tr>`));
  if (tab === 'subjects') tbl = T([L('รหัสวิชา', 'Code'), L('ชื่อวิชา', 'Name'), L('ท-ป-น', 'T-P-C'), L('คาบ/สัปดาห์', 'Periods'), L('ห้องที่ต้องใช้', 'Room type'), L('เรียนต่อเนื่อง', 'Consecutive')], Object.values(SUB).map(s => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.cred)}</td><td class="num">${s.periods}</td><td>${rtName(s.room)}</td><td>${s.consec ? L('ใช่', 'Yes') : L('ไม่', 'No')}</td></tr>`));
  if (tab === 'rooms') tbl = T([L('รหัส', 'Code'), L('ชื่อห้อง', 'Name'), L('อาคาร', 'Building'), L('ความจุ', 'Seats'), L('ประเภท', 'Type'), L('งดใช้', 'Closed')], Object.values(RM).map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.bld)}</td><td class="num">${r.cap}</td><td>${rtName(r.type)}</td><td>${un(r)}</td></tr>`));
  if (tab === 'groups') tbl = T([L('รหัส', 'Code'), L('กลุ่มเรียน', 'Group'), L('จำนวน', 'Students'), L('ครูที่ปรึกษา', 'Advisor'), L('รหัสนักศึกษาในระบบ', 'Student IDs')], Object.values(GRP).map(g => `<tr><td>${esc(g.id)}</td><td>${esc(gName(g))}</td><td class="num">${g.size}</td><td>${TCH[g.advisor] ? esc(TCH[g.advisor].name) : '–'}</td><td>${STU.filter(s => s.group === g.id).map(s => esc(s.code)).join(', ')}</td></tr>`));
  if (tab === 'asg') tbl = T([L('รหัส', 'ID'), L('วิชา', 'Subject'), L('กลุ่ม', 'Group'), L('ครู', 'Teacher'), L('คาบ', 'Periods'), L('รูปแบบบล็อก', 'Blocks')], ASG.map(a => `<tr><td>${esc(a.id)}</td><td>${esc(a.subj)} ${esc(SUB[a.subj].name)}</td><td>${esc(a.groups.map(g => gName(GRP[g])).join(', '))}</td><td>${esc(a.teachers.map(t => TCH[t].short).join(', '))}</td><td class="num">${a.periods}</td><td>[${a.pattern.join(',')}]</td></tr>`));
  const im = S.imp, ent = S.impEnt, ok = im ? im.rows.filter(x => !x.e.length).length : 0;
  return `<section class="pagehead"><h1>${L('ข้อมูลหลัก', 'Master data')}</h1></section>
${!W() ? '' : `<section class="card"><h2>${L('นำเข้าจาก Excel', 'Import from Excel')}</h2><div class="controls"><label class="fld"><span>${L('ประเภทข้อมูล', 'Data type')}</span><select data-chg="impent">${Object.entries(IMP).map(([k, x]) => `<option value="${k}"${k === ent ? ' selected' : ''}>${L(x.th, x.en)}</option>`).join('')}</select></label>
<label class="fld"><span>${L('ไฟล์ .xlsx หรือ .csv', '.xlsx or .csv file')}</span><input type="file" accept=".xlsx,.xls,.csv" data-chg="impfile"></label><button type="button" class="btn" data-act="impsample">${L('ลองด้วยไฟล์ตัวอย่าง', 'Try a sample file')}</button></div>
<p class="note">${L('คอลัมน์แถวแรกต้องเป็น', 'First-row columns must be')}: <code>${IMP[ent].cols.join(', ')}</code>${ent === 'teachers' ? ` · ${L('ครูที่นำเข้าจะได้บัญชีผู้ใช้ด้วยรหัสบุคลากรและรหัสผ่านเริ่มต้น', 'Imported teachers get an account with their staff code and the initial password')}` : ''}</p>
${im ? `<p><b>${esc(im.file)}</b> · ${im.rows.length} ${L('แถว', 'rows')} · <span class="okk" style="color:var(--ok)">${ok} ${L('ถูกต้อง', 'valid')}</span> · <span style="color:var(--bad)">${im.rows.length - ok} ${L('มีปัญหา', 'with problems')}</span></p>
<div class="tblwrap"><table><thead><tr><th>#</th>${IMP[im.ent].cols.map(c => `<th>${c}</th>`).join('')}<th>${L('ผลตรวจ', 'Check')}</th></tr></thead><tbody>${im.rows.map((x, i) => `<tr><td class="num">${i + 2}</td>${IMP[im.ent].cols.map(c => `<td>${esc(x.r[c])}</td>`).join('')}<td>${x.e.length ? x.e.map(e => `<div class="err">${esc(e)}</div>`).join('') : `<span class="okk">${L('ผ่าน', 'OK')}</span>`}</td></tr>`).join('')}</tbody></table></div>
<div class="mrow"><button type="button" class="btn pri" data-act="impsave"${ok ? '' : ' disabled'}>${L(`บันทึก ${ok} แถวที่ถูกต้อง`, `Save ${ok} valid rows`)}</button><button type="button" class="btn" data-act="impcancel">${L('ยกเลิก', 'Cancel')}</button></div>` : ''}</section>`}
<div class="seg">${[['teachers', L('ครู', 'Teachers')], ['subjects', L('วิชา', 'Subjects')], ['rooms', L('ห้อง', 'Rooms')], ['groups', L('กลุ่มเรียน', 'Groups')], ['asg', L('รายการสอน', 'Assignments')]].map(([k, t]) => `<button type="button" data-act="datatab" data-v="${k}" aria-pressed="${tab === k}">${t}</button>`).join('')}</div>${tbl}`
}
function vPeriods() {
  const d = latestDraft();
  return `<section class="pagehead"><h1>${L('ตั้งค่าคาบเรียน', 'Period settings')}</h1><p class="sub">${L('คาบละ 60 นาที · ใช้เวลาเอเชีย/กรุงเทพฯ ทั้งระบบ', '60-minute periods · Asia/Bangkok time throughout')}</p></section>
<div class="cols2"><section class="card"><h2>${L('คาบล็อก (ห้ามจัดวิชาทับ)', 'Locked activities')}</h2>${LOCKS.map(l => {
    const n = d ? d.slots.filter(s => A[s.aid].groups.some(g => C.who(l, GRP[g])) && s.day === l.day && s.start < l.from + l.len && s.start + s.len > l.from).length : 0;
    return `<label class="switch"><input type="checkbox" data-chg="lock" data-v="${esc(l.id)}"${l.on ? ' checked' : ''}${W() ? '' : ' disabled'}><span><b>${esc(L(l.th, l.en))}</b><br><span class="muted small">${dayName(l.day)} ${L('คาบ', 'period')} ${pp(l.from, l.len)} (${pr(l.from, l.len)}) · ${l.applies === 'ALL' ? L('ทุกกลุ่ม', 'All groups') : L('ปวช.1 ทุกกลุ่ม', 'All Cert. Year 1 groups')}${l.on && n ? ` · <span style="color:var(--bad)">${L(`มี ${n} คาบในฉบับร่างทับอยู่`, `${n} draft periods overlap`)}</span>` : ''}</span></span></label>`
  }).join('')}<p class="note">${L('ปิดคาบล็อกแล้ว ตัวจัดตารางและหน้าแก้ตารางจะใช้ช่วงเวลานั้นได้ทันที', 'Switching a lock off frees that time for the scheduler and the editor immediately.')}</p></section>
<section class="card"><h2>${L('ช่วงเวลาเรียน', 'Period times')}</h2><div class="tblwrap"><table><thead><tr><th>${L('คาบ', 'Period')}</th><th>${L('เวลา', 'Time')}</th><th>${L('ประเภท', 'Kind')}</th></tr></thead><tbody>${PER.slice(1).map((p, i) => `${i === 4 ? `<tr><td>–</td><td>12:00–13:00</td><td>${L('พักกลางวัน (BREAK)', 'Lunch (BREAK)')}</td></tr>` : ''}<tr><td class="num">${i + 1}</td><td>${p.s}–${p.e}</td><td>${p.out ? `<span class="badge out">${L('นอกเวลา', 'After hours')}</span> OUT_HOURS` : `<span class="badge in">${L('ในเวลา', 'In hours')}</span> IN_HOURS`}</td></tr>`).join('')}</tbody></table></div></section></div>`
}

/* ===== shell ===== */
const ROUTES = { profile: vProfile, schedule: vSchedule, people: vPeople, ask: vAsk, lookup: vLookup, privacy: vPrivacy, login: vLogin, dash: vDash, editor: vEditor, versions: vVersions, requests: vRequests, data: vData, periods: vPeriods };
const ALL = ['ADMIN', 'EXEC', 'TEACHER'], ADM = ['ADMIN', 'EXEC'];
const NEED = { dash: ALL, editor: ALL, requests: ALL, profile: ALL, versions: ADM, data: ADM, periods: ADM };
const roleName = r => ({ ADMIN: L('ผู้ดูแลระบบ', 'Admin'), EXEC: L('ผู้บริหาร', 'Executive'), TEACHER: L('ครู', 'Teacher'), PUBLIC: L('บุคคลทั่วไป', 'Public') }[r] || r);
function header() {
  const who = ME ? (ME.role === 'ADMIN' ? L('ผู้ดูแลระบบ · ฝ่ายวิชาการ', 'Admin · Academic affairs') : `${ME.name} · ${roleName(ME.role)}`) : '';
  const imp = ME && ME.imp ? `<div class="impbar"><div class="wrap"><span>${L('กำลังดูในมุมของ', 'Viewing as')} <b>${esc(ME.name)}</b> (${roleName(ME.role)}) · ${L('ดูได้อย่างเดียว', 'read only')}</span><button type="button" class="btn sm" data-act="viewas">${L('เปลี่ยนบัญชี', 'Switch')}</button><button type="button" class="btn sm pri" data-act="stopviewas">${L('กลับเป็นผู้ดูแลระบบ', 'Back to admin')}</button></div></div>` : '';
  return `<div class="topbar"><div class="wrap">${L('สำนักงานคณะกรรมการการอาชีวศึกษา · กระทรวงศึกษาธิการ', 'Office of the Vocational Education Commission · Ministry of Education')}</div></div>
<header class="band"><div class="wrap band-in"><a href="#schedule" aria-label="${L('หน้าแรก', 'Home')}"><img class="logo" src="/logo.webp" alt="${L('ตราวิทยาลัยการอาชีพโพนทอง', 'Phonthong ICEC emblem')}" width="64" height="64"></a>
<div class="brand-tx"><div class="b1">${L('วิทยาลัยการอาชีพโพนทอง', 'Phonthong Industrial and Community Education College')}</div><div class="b2">${L('ระบบตารางเรียน-ตารางสอน', 'Class & teaching timetables')} · PTC Smart Schedule</div></div>
<div class="band-r"><span class="term">${L('ภาคเรียนที่ 2/2569', 'Semester 2/2026')}</span><div class="lang" role="group" aria-label="Language"><button type="button" data-act="lang" data-v="th" aria-pressed="${LANG === 'th'}">TH</button><button type="button" data-act="lang" data-v="en" aria-pressed="${LANG === 'en'}">EN</button></div>
${ME && ME.imp ? '' : ME ? `<span class="who">${esc(who)}</span>${S.role === 'ADMIN' ? `<button type="button" class="btn sm on-band" data-act="viewas">${L('ดูในมุมของ…', 'View as…')}</button>` : ''}<button type="button" class="btn sm on-band" data-act="logout">${L('ออกจากระบบ', 'Sign out')}</button>` : `<a class="btn sm on-band" href="#login">${L('เข้าสู่ระบบบุคลากร', 'Staff sign-in')}</a>`}</div></div></header><div class="kranok" aria-hidden="true"></div>${imp}`
}
function nav() {
  const pub = [['schedule', L('ตารางเรียน', 'Timetables')], ['people', L('ทำเนียบบุคลากร', 'Staff')], ['ask', L('ถาม AI', 'Ask AI')], ['lookup', L('ค้นรายบุคคล', 'Student lookup')], ['privacy', L('แจ้งปัญหา / PDPA', 'Report / Privacy')]];
  const back = S.role === 'ADMIN' ? [['dash', L('แดชบอร์ด', 'Dashboard')], ['editor', L('แก้ตาราง', 'Editor')], ['versions', L('เวอร์ชัน', 'Versions')], ['requests', L('คำขอ', 'Requests')], ['data', L('ข้อมูลหลัก', 'Master data')], ['periods', L('คาบเรียน', 'Periods')], ['profile', L('ข้อมูลบุคลากร', 'Staff profiles')]]
    : S.role === 'EXEC' ? [['dash', L('แดชบอร์ด', 'Dashboard')], ['editor', L('ดูตาราง', 'Timetables')], ['versions', L('เวอร์ชัน', 'Versions')], ['requests', L('คำขอ', 'Requests')], ['data', L('ข้อมูลหลัก', 'Master data')], ['periods', L('คาบเรียน', 'Periods')], ['profile', L('ข้อมูลของฉัน', 'My profile')]]
    : S.role === 'TEACHER' ? [['dash', L('ตารางของฉัน', 'My timetable')], ['editor', L('แก้ / ขอย้ายคาบ', 'Edit / request')], ['requests', L('คำขอของฉัน', 'My requests')], ['profile', L('ข้อมูลของฉัน', 'My profile')]] : [];
  const a = ([r, t]) => `<a class="tab" href="#${r}"${S.route === r ? ' aria-current="page"' : ''}>${t}</a>`;
  return `<nav class="tabs" aria-label="${L('เมนูหลัก', 'Main menu')}"><div class="wrap tabs-in">${back.map(a).join('')}${back.length ? '<span class="sep"></span>' : ''}${pub.map(a).join('')}</div></nav>`
}
const footer = () => `<footer class="foot"><div class="wrap foot-in"><div><b>${L('วิทยาลัยการอาชีพโพนทอง', 'Phonthong Industrial and Community Education College')}</b><br>${L('อำเภอโพนทอง จังหวัดร้อยเอ็ด · สังกัดสำนักงานคณะกรรมการการอาชีวศึกษา', 'Phon Thong, Roi Et · under the Office of the Vocational Education Commission')}</div><div class="muted">${L('ข้อมูลตัวอย่างเป็นข้อมูลจำลอง', 'Sample data is fictional')} · <a href="#privacy">${L('นโยบายความเป็นส่วนตัว', 'Privacy')}</a></div></div></footer>`;
function modalHTML() { return S.modal ? `<div class="ovl" data-act="ovl"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="mh"><h2 id="mt">${S.modal.title}</h2><button type="button" class="x" data-act="closemodal" aria-label="${L('ปิด', 'Close')}">×</button></div><div class="mb">${S.modal.body}</div></div></div>` : '' }
let app;
function render() {
  document.documentElement.lang = LANG; app.innerHTML = header() + nav() + `<main class="wrap${S.enter ? ' enter' : ''}">${ROUTES[S.route]()}</main>` + footer() + modalHTML(); S.enter = false; if (S.route === 'editor') paint();
  const ms = document.getElementById('msgs'); if (ms) ms.scrollTop = ms.scrollHeight
}
function route() {
  let r = location.hash.slice(1) || 'schedule'; if (!ROUTES[r]) r = 'schedule';
  if (ME && ME.mustChange) r = 'login';
  else if (NEED[r] && !NEED[r].includes(S.role)) r = 'login';
  else if (r === 'login' && S.role) r = 'dash';
  const moved = S.route !== r; if (moved) { clearSel(); S.diff = null } S.route = r; S.enter = moved; render(); if (moved) window.scrollTo(0, 0);
  // Show cached data instantly, then pick up changes others made since (back office only).
  if (ME && moved) refresh().then(ch => { if (ch) rerender() }).catch(() => { })
}
const go = r => { if (location.hash === '#' + r) route(); else location.hash = r };
let tt0; function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt0); tt0 = setTimeout(() => el.hidden = true, 4000) }
const openModal = (title, body) => { S.modal = { title, body }; render(); const f = document.querySelector('.modal input,.modal textarea,.modal button'); if (f) f.focus() };
const closeModal = () => { S.modal = null; render() };
function cookie() {
  let ok = null; try { ok = localStorage.getItem('ptc-consent') } catch (e) { } const el = document.getElementById('cookie'); if (ok) { el.hidden = true; return } el.hidden = false;
  el.innerHTML = `<div class="wrap"><p>${L('เว็บไซต์นี้ใช้คุกกี้ที่จำเป็นต่อการทำงานเท่านั้น และเก็บข้อมูลตามนโยบายความเป็นส่วนตัว ฉบับ 1.0', 'This site uses only essential cookies and handles data under privacy policy v1.0.')} <a href="#privacy">${L('อ่านนโยบาย', 'Read the policy')}</a></p><button type="button" class="btn pri" data-act="cookie" data-v="all">${L('ยอมรับ', 'Accept')}</button><button type="button" class="btn" data-act="cookie" data-v="essential">${L('เฉพาะที่จำเป็น', 'Essential only')}</button></div>`
}

/* ===== actions ===== */
async function viewAs(body) {
  const r = await busy(fetch('/api/auth/impersonate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const j = await r.json().catch(() => ({})); if (!r.ok) { toast(j.error || L('สลับบัญชีไม่สำเร็จ', 'Could not switch')); return }
  S.modal = null; await refresh(null, true); resetEd(); S.prof = null;
  toast(body.stop ? L('กลับเป็นผู้ดูแลระบบแล้ว', 'Back to admin') : L(`กำลังดูในมุมของ ${ME.name}`, `Viewing as ${ME.name}`)); go(S.role ? 'dash' : 'schedule')
}
function resetEd() { S.ed = { ver: null, mode: S.role === 'TEACHER' ? 'teacher' : 'group', id: S.role === 'TEACHER' ? S.user : firstOf('group'), sel: null, st: null, pending: null, undo: [] } }
function resizePhoto(file) {
  return new Promise((ok, no) => {
    const img = new Image(); img.onerror = no;
    img.onload = () => { const r = Math.min(1, 320 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.85)) };
    img.src = URL.createObjectURL(file)
  })
}
const ACT = {
  profview: el => { const t = TCH[el.dataset.v]; openModal(L('ข้อมูลส่วนตัว', 'Profile'), profileHTML(t)) },
  profedit: el => { S.prof = el.dataset.v; S.profPhoto = undefined; S.modal = null; if (S.route === 'profile') render(); else go('profile') },
  profphotodel: () => { S.profPhoto = ''; document.getElementById('pf-av').innerHTML = `<div class="av lg">–</div>`; toast(L('กดบันทึกเพื่อยืนยันการลบรูป', 'Save to confirm removing the photo')) },
  viewas: () => openModal(L('ดูในมุมของบัญชีอื่น', 'View as another account'), `<p class="note">${L('ใช้ตรวจว่าแต่ละคนเห็นอะไร โหมดนี้ดูได้อย่างเดียว แก้ไขอะไรไม่ได้ และระบบบันทึกการใช้งานไว้', 'See exactly what each person sees. Read only; every switch is logged.')}</p>
<label class="fld"><span>${L('บัญชี', 'Account')}</span><select id="va"><option value="__public__">${L('บุคคลทั่วไป (ไม่ได้เข้าสู่ระบบ)', 'Public visitor (not signed in)')}</option>${DEPTS.map(d => { const xs = Object.values(TCH).filter(t => t.dept === d.code); return xs.length ? `<optgroup label="${esc(deptName(d.code))}">${xs.map(t => `<option value="${esc(t.emp)}">${esc(t.emp)} · ${esc(t.name)}</option>`).join('')}</optgroup>` : '' }).join('')}</select></label>
<div class="mrow"><button type="button" class="btn pri" data-act="doviewas">${L('เริ่มดูในมุมนี้', 'Start')}</button><button type="button" class="btn" data-act="closemodal">${L('ยกเลิก', 'Cancel')}</button></div>`),
  doviewas: async el => { const u = el.dataset.v || document.getElementById('va').value; if (ME && ME.imp) await viewAs({ stop: true }); viewAs({ username: u }) },
  stopviewas: () => viewAs({ stop: true }),
  lang: el => { LANG = el.dataset.v; try { localStorage.setItem('ptc-lang', LANG) } catch (e) { } render(); cookie() },
  pubmode: el => { const m = el.dataset.v; S.pub = { mode: m, id: firstOf(m) }; render() },
  seeteacher: el => { S.pub = { mode: 'teacher', id: el.dataset.v }; go('schedule') },
  openpub: el => { S.pub = { mode: el.dataset.mode, id: el.dataset.id }; go('schedule') },
  slotinfo: el => { const [s] = findSlot(el.dataset.sid); openModal(L('รายละเอียดคาบเรียน', 'Period details'), slotDetail(s) + `<div class="mrow"><button type="button" class="btn" data-act="reportslot" data-sid="${s.id}">${L('แจ้งปัญหาเกี่ยวกับคาบนี้', 'Report a problem with this period')}</button></div>`) },
  reportslot: el => openModal(L('แจ้งปัญหา', 'Report a problem'), issueForm(el.dataset.sid)),
  ovl: (el, e) => { if (e.target === el) closeModal() },
  closemodal: closeModal,
  pdept: el => { S.pdept = el.dataset.v; render() },
  askex: el => ask(el.dataset.q),
  logout: async () => { await fetch('/api/auth/logout', { method: 'POST' }); S.ed.undo = []; clearSel(); await refresh(); toast(L('ออกจากระบบแล้ว', 'Signed out')); go('schedule') },
  cookie: el => {
    let vid = ''; try { vid = crypto.randomUUID(); localStorage.setItem('ptc-consent', JSON.stringify({ choice: el.dataset.v, policy: '1.0', at: Date.now() })) } catch (e) { }
    document.getElementById('cookie').hidden = true; api('consent', { choice: el.dataset.v, visitor: vid })
  },
  runjob: async () => {
    if (S.job && !S.job.done) return; const seed = Math.max(1, +(document.getElementById('seed').value) || 1);
    S.job = { seed, step: 0, done: false }; const paintJob = () => { const el = document.getElementById('jobcard'); if (el) el.innerHTML = jobHTML() };
    const tm = setInterval(() => { if (S.job.step < STEPS.length - 1) { S.job.step++; paintJob() } }, 400); paintJob();
    const j = await api('runScheduler', { seed }); clearInterval(tm);
    if (j) { await refresh(); S.job.vid = j.vid; S.job.ms = j.ms; toast(L('จัดตารางเสร็จ ได้ฉบับร่างใหม่', 'Done: new draft created')) }
    S.job.done = true; S.job.step = STEPS.length; render()
  },
  openver: el => { S.ed.ver = el.dataset.v; S.ed.mode = 'group'; clearSel() },
  edmode: el => { const m = el.dataset.v; S.ed.mode = m; S.ed.id = m === 'teacher' && S.role === 'TEACHER' ? S.user : firstOf(m); clearSel(); render() },
  slot: el => {
    const [s] = findSlot(el.dataset.sid); if (!canEdit(s)) { toast(s.locked ? L('คาบนี้ถูกปักหมุดไว้', 'This period is pinned') : S.role === 'TEACHER' ? L('ย้ายได้เฉพาะคาบที่คุณสอน', 'You can only move your own periods') : L('แก้ได้เฉพาะฉบับร่าง', 'Only drafts can be edited')); return }
    if (S.ed.sel === s.id) clearSel(); else select(s); render()
  },
  cell: el => { if (S.ed.sel) tryMove(+el.dataset.day, +el.dataset.p) },
  confirmmove: () => { const [s] = findSlot(S.ed.sel), pd = S.ed.pending; doMove(s, pd.d, pd.p) },
  cancelpend: () => { S.ed.pending = null; render() },
  cancelsel: () => { clearSel(); render() },
  doroom: el => { const [s] = findSlot(S.ed.sel), pd = S.ed.pending; doMove(s, pd.d, pd.p, el.dataset.v) },
  doswap: async el => {
    const v = ver(); snap(v); const [s] = findSlot(S.ed.sel), [x] = findSlot(el.dataset.v); clearSel();
    if (!await act('swap', { vid: v.id, sid: s.id, xid: x.id }, L('สลับคาบแล้ว', 'Periods swapped'), () => { [s.day, s.start, x.day, x.start] = [x.day, x.start, s.day, s.start] })) S.ed.undo.pop()
  },
  split: async el => {
    const v = ver(), sid = S.ed.sel, [a, b] = el.dataset.v.split(',').map(Number); snap(v); clearSel();
    const j = await act('split', { vid: v.id, sid, a, b }, L('แบ่งคาบแล้ว เลือกส่วนที่แยกไว้ให้', 'Split done; the new part is selected'));
    if (!j) { S.ed.undo.pop(); return } const [ns] = findSlot(j.newId); if (ns) { select(ns); render() }
  },
  pin: () => { const v = ver(), [s] = findSlot(S.ed.sel); clearSel(); act('pin', { vid: v.id, sid: s.id }, null, () => { s.locked = !s.locked }) },
  undo: async () => {
    const v = ver(); for (let i = S.ed.undo.length - 1; i >= 0; i--)if (S.ed.undo[i].vid === v.id) {
      const u = S.ed.undo.splice(i, 1)[0]; clearSel(); await act('restore', { vid: v.id, slots: u.slots }, L('ย้อนกลับแล้ว', 'Undone')); return
    }
  },
  sendcr: async () => {
    const v = ver(), [s] = findSlot(S.ed.sel), pd = S.ed.pending, note = (document.getElementById('crnote') || {}).value || ''; clearSel();
    const j = await act('crCreate', { vid: v.id, sid: s.id, day: pd.d, start: pd.p, note }); if (j) toast(L(`ส่งคำขอ ${ref('CR', j.id)} แล้ว รอฝ่ายวิชาการอนุมัติ`, `Request ${ref('CR', j.id)} sent for approval`))
  },
  clone: async el => { const j = await act('clone', { vid: el.dataset.v }, L('สร้างฉบับร่างแล้ว', 'Draft created')); if (j) { S.ed.ver = j.vid; clearSel(); render() } },
  askpublish: el => {
    const v = VERS.find(x => x.id === el.dataset.v), c = conflicts(v.slots); openModal(L('ยืนยันการเผยแพร่', 'Confirm publish'), `<p style="margin:0">${L(`เผยแพร่ “${esc(v.name)}” แทนฉบับปัจจุบัน นักเรียนและครูจะเห็นฉบับนี้ทันที`, `Publish “${esc(v.name)}” in place of the current version. Students and teachers see it immediately.`)}</p>${c ? `<div class="notice">${L(`ฉบับนี้มีคาบชนกัน ${c} จุด ต้องแก้ก่อนเผยแพร่`, `This version has ${c} clashes; fix them before publishing.`)}</div>` : ''}<div class="mrow"><button type="button" class="btn pri" data-act="dopublish" data-v="${v.id}"${c ? ' disabled' : ''}>${L('เผยแพร่', 'Publish')}</button><button type="button" class="btn" data-act="closemodal">${L('ยกเลิก', 'Cancel')}</button></div>`)
  },
  dopublish: el => { S.modal = null; S.diff = null; act('publish', { vid: el.dataset.v }, L('เผยแพร่แล้ว', 'Published')) },
  diff: el => { S.diff = el.dataset.v; render() },
  reqtab: el => { S.reqTab = el.dataset.v; if (S.route === 'requests') render() },
  crok: el => act('crDecide', { id: +el.dataset.v, approve: true }, L('อนุมัติและปรับตารางแล้ว แจ้งเตือนครูและกลุ่มเรียนแล้ว', 'Approved and applied; teacher and group notified')),
  crno: el => act('crDecide', { id: +el.dataset.v, approve: false }, L('ไม่อนุมัติคำขอแล้ว', 'Request rejected')),
  issmove: el => { const x = ISS.find(i => i.id === +el.dataset.v); act('issueMove', { id: x.id, status: el.dataset.to }, null, () => { x.status = el.dataset.to }) },
  dsrdone: el => act('dsrDone', { id: +el.dataset.v }),
  datatab: el => { S.dataTab = el.dataset.v; render() },
  impsample: () => { const e = S.impEnt, x = IMP[e]; S.imp = { ent: e, file: `template_${e}.xlsx (${L('ตัวอย่าง', 'sample')})`, raw: x.sample.map(r => Object.fromEntries(x.cols.map((c, i) => [c, r[i]]))) }; S.imp.rows = validateImport(IMP, e, S.imp.raw); render() },
  impsave: async () => {
    const im = S.imp, good = im.rows.filter(x => !x.e.length).map(x => x.r);
    const j = await act('import', { entity: im.ent, rows: good }); if (j) { toast(L(`นำเข้า ${j.count} รายการแล้ว`, `Imported ${j.count} rows`)); S.imp = null; S.dataTab = im.ent; render() }
  },
  impcancel: () => { S.imp = null; render() },
};
function ask(q) {
  q = String(q || '').trim().slice(0, 200); if (!q) return; S.chat.push({ me: 1, text: q });
  if (++S.asked > 30) S.chat.push({ html: L('ถามได้ไม่เกิน 30 คำถามต่อชั่วโมง กรุณาลองใหม่ภายหลัง', 'Limit reached: 30 questions per hour. Please try again later.'), tr: [] }); else S.chat.push(aiAnswer(q));
  if (S.route !== 'ask') go('ask'); else render(); const i = document.getElementById('q'); if (i) i.focus()
}
const showErr = t => { const e = document.getElementById('lerr'); if (e) { e.hidden = false; e.style.color = 'var(--bad)'; e.textContent = t } };
const FORM = {
  profile: async f => {
    const v = n => f.elements[n] ? f.elements[n].value : undefined, body = { pid: v('pid'), exp: v('exp'), edu: v('edu'), hist: v('hist'), phone: v('phone'), email: v('email'), line: v('line'), consent: f.elements.consent.checked, name: v('name'), pos: v('pos'), dept: v('dept') };
    if (S.profPhoto !== undefined) body.photo = S.profPhoto;
    if (await act('profileSave', body, L('บันทึกข้อมูลแล้ว', 'Profile saved'))) S.profPhoto = undefined
  },
  ask: f => ask(f.q.value),
  lookup: async f => {
    const r = await busy(fetch('/api/public/student-lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: f.code.value, grp: f.grp.value }) }));
    const j = await r.json().catch(() => ({})); S.lk = r.ok ? j : { err: j.error || L('ค้นหาไม่สำเร็จ', 'Lookup failed') }; render()
  },
  issue: async f => { const j = await api('issueCreate', { sid: f.sid ? f.sid.value : null, desc: f.desc.value, contact: f.contact.value }); if (j) { S.modal = null; toast(L(`รับเรื่องแล้ว เลขที่ ${ref('ISS', j.id)}`, `Report received: ${ref('ISS', j.id)}`)); if (S.role === 'ADMIN') await refresh(); render() } },
  dsr: async f => { const j = await api('dsrCreate', { name: f.name.value, type: f.type.value, detail: f.detail.value }); if (j) { f.reset(); toast(L(`ยื่นคำร้องแล้ว เลขที่ ${ref('DSR', j.id)} จะดำเนินการภายใน 30 วัน`, `Request ${ref('DSR', j.id)} received; handled within 30 days`)) } },
  login: async f => {
    const r = await busy(fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: f.u.value, password: f.p.value }) }));
    const j = await r.json().catch(() => ({})); if (!r.ok) { showErr(j.error || L('เข้าสู่ระบบไม่สำเร็จ', 'Sign-in failed')); return }
    await refresh(null, true); resetEd(); S.prof = null;
    toast(L('เข้าสู่ระบบแล้ว', 'Signed in')); go(j.mustChange ? 'login' : 'dash')
  },
  password: async f => {
    if (f.next.value !== f.next2.value) { showErr(L('รหัสผ่านใหม่สองช่องไม่ตรงกัน', 'The new passwords do not match')); return }
    const r = await busy(fetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current: f.current.value, next: f.next.value }) }));
    const j = await r.json().catch(() => ({})); if (!r.ok) { showErr(j.error || L('บันทึกไม่สำเร็จ', 'Could not save')); return }
    await refresh(); S.ed.id = S.role === 'TEACHER' ? S.user : firstOf('group'); S.ed.mode = S.role === 'TEACHER' ? 'teacher' : 'group'; toast(L('เปลี่ยนรหัสผ่านแล้ว', 'Password changed')); go('dash')
  },
};
const CHG = {
  profsel: el => { S.prof = el.value; S.profPhoto = undefined; render() },
  profphoto: el => {
    const file = el.files && el.files[0]; if (!file) return;
    if (!/^image\//.test(file.type)) { toast(L('กรุณาเลือกไฟล์รูปภาพ', 'Please choose an image')); return }
    resizePhoto(file).then(d => { S.profPhoto = d; document.getElementById('pf-av').innerHTML = `<div class="av lg"><img src="${d}" alt=""></div>`; toast(L('กดบันทึกเพื่อใช้รูปนี้', 'Save to use this photo')) }).catch(() => toast(L('อ่านรูปไม่สำเร็จ', 'Could not read the image')))
  },
  pubsel: el => { S.pub.id = el.value; render() },
  edver: el => { S.ed.ver = el.value; clearSel(); render() },
  edsel: el => { S.ed.id = el.value; clearSel(); render() },
  lock: el => { const l = LOCKS.find(x => x.id === el.dataset.v), on = el.checked; act('lockToggle', { id: l.id, on }, on ? L('เปิดคาบล็อกแล้ว', 'Lock on') : L('ปิดคาบล็อกแล้ว', 'Lock off'), () => { l.on = on }) },
  impent: el => { S.impEnt = el.value; S.imp = null; render() },
  impfile: el => {
    const file = el.files && el.files[0]; if (!file) return; const ent = S.impEnt;
    loadXLSX().then(X => file.arrayBuffer().then(buf => {
      const wb = X.read(buf, { type: 'array' }), rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).slice(0, 500);
      S.imp = { ent, file: file.name, rows: validateImport(IMP, ent, rows) }; render()
    })).catch(() => toast(L('อ่านไฟล์ไม่สำเร็จ ตรวจว่าเป็น .xlsx หรือ .csv', 'Could not read the file; use .xlsx or .csv')))
  },
};
let xlsxP = null;
const loadXLSX = () => window.XLSX ? Promise.resolve(window.XLSX) : (xlsxP = xlsxP || new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = no; document.head.appendChild(s) }));

let started = false;
export async function start(pre) {
  if (started) return; started = true;
  app = document.getElementById('app');
  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e) });
  document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); FORM[f.dataset.form](f) });
  document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) CHG[el.dataset.chg](el) });
  document.addEventListener('input', e => { if (e.target.id === 'pq') { S.pq = e.target.value; document.getElementById('people-list').innerHTML = peopleList() } });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (S.modal) closeModal(); else if (S.ed.sel) { clearSel(); render() } });
  document.addEventListener('dragstart', e => { const el = e.target.closest && e.target.closest('.slot[draggable="true"]'); if (!el) return; const [s] = findSlot(el.dataset.sid); select(s); e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(paint, 0) });
  document.addEventListener('dragover', e => { const c = e.target.closest && e.target.closest('#tt .cell'); if (c && c.dataset.st) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } });
  document.addEventListener('drop', e => { const c = e.target.closest && e.target.closest('#tt .cell'); if (!c) return; e.preventDefault(); tryMove(+c.dataset.day, +c.dataset.p) });
  document.addEventListener('dragend', () => { if (S.route === 'editor' && !S.busy) render() });
  window.addEventListener('hashchange', route);
  try { await refresh(pre) } catch (e) { app.innerHTML = `<main class="wrap" style="padding-block:40px"><div class="notice">${esc(e.message)}</div></main>`; return }
  if (S.role === 'TEACHER') { S.ed.mode = 'teacher'; S.ed.id = S.user }
  route(); cookie();
}
