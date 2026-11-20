// Shared timetable logic: the one constraint checker used by the scheduler, the editor and every server-side save.
export const PER = [null, { s: '08:00', e: '09:00' }, { s: '09:00', e: '10:00' }, { s: '10:00', e: '11:00' }, { s: '11:00', e: '12:00' },
  { s: '13:00', e: '14:00' }, { s: '14:00', e: '15:00' }, { s: '15:00', e: '16:00' }, { s: '16:00', e: '17:00', out: 1 }, { s: '17:00', e: '18:00', out: 1 }];
export const IN_MAX = 7, P_MAX = 9;
export const RT = { CLASS: ['ห้องเรียนทฤษฎี', 'Classroom'], LAB: ['ห้องปฏิบัติการคอมพิวเตอร์', 'Computer lab'], WS_AU: ['โรงฝึกงานยานยนต์', 'Automotive workshop'], WS_EL: ['โรงฝึกงานไฟฟ้า', 'Electrical workshop'], WS_WE: ['โรงฝึกงานเชื่อม', 'Welding workshop'] };
export const DN = { th: ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'], en: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };
export const crossesLunch = (start, len) => start <= 4 && start + len - 1 >= 5;
export const pp = (s, len) => len > 1 ? `${s}–${s + len - 1}` : `${s}`;
export const bare = n => n.replace(/^(นางสาว|นาย|นาง)/, '');
export function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
export const TH = (th) => th;
export const thDay = d => DN.th[d];

// D = { TCH, RM, GRP, SUB, A, ASG, LOCKS }; L(th,en) and dayName(d) pick the message language.
export function makeCore(D, L = TH, dayName = thDay) {
  const { TCH, RM, GRP, SUB, A, ASG, LOCKS } = D;
  const rtName = k => RT[k] ? L(RT[k][0], RT[k][1]) : k;
  const gName = g => L(g.name, g.en);
  const who = (l, g) => l.applies === 'ALL' || (l.applies === 'CERT_Y1' && g.level === 'ปวช.' && g.year === 1);
  const lockAt = (g, d, p) => LOCKS.find(l => l.on && l.day === d && p >= l.from && p < l.from + l.len && who(l, g));
  const key = (r, id, d, p) => `${r}${id}|${d}|${p}`;
  function addIdx(m, s) {
    const a = A[s.aid];
    for (let p = s.start; p < s.start + s.len; p++) {
      a.teachers.forEach(t => m.set(key('T', t, s.day, p), s));
      a.groups.forEach(g => m.set(key('G', g, s.day, p), s));
      if (s.room) m.set(key('R', s.room, s.day, p), s);
    }
  }
  function idx(slots, ...ex) { const m = new Map(); slots.forEach(s => { if (!ex.includes(s.id)) addIdx(m, s) }); return m }
  const subjOf = s => SUB[A[s.aid].subj];
  const grpsOf = s => A[s.aid].groups.map(g => gName(GRP[g])).join(', ');
  const gsize = a => a.groups.reduce((n, g) => n + (GRP[g] ? GRP[g].size : 0), 0);
  function maxRun(occ) { let best = 0, run = 0; for (let p = 1; p <= P_MAX; p++) { if (p === 5) run = 0; run = occ[p] ? run + 1 : 0; if (run > best) best = run } return best }

  function check(m, a, day, start, len, room) {
    const hard = [], soft = [], bl = new Set(); let other = false;
    if (!(day >= 1 && day <= 5) || start < 1 || len < 1 || start + len - 1 > P_MAX) return { status: 'none', hard: [L('เกินช่วงเวลาของวัน', 'Runs past the end of the day')], soft, blockers: [], roomOnly: false };
    if (room && !RM[room]) return { status: 'red', hard: [L(`ไม่พบห้อง ${room}`, `Room ${room} not found`)], soft, blockers: [], roomOnly: false };
    if (crossesLunch(start, len)) { hard.push(L('คาบนี้จะคร่อมช่วงพักกลางวัน 12.00–13.00 ต้องจบภายในคาบ 4 หรือเริ่มตั้งแต่คาบ 5', 'This block would run through the 12:00–13:00 lunch break')); other = true }
    for (let p = start; p < start + len; p++) {
      for (const gid of a.groups) {
        const g = GRP[gid], lk = lockAt(g, day, p);
        if (lk) { hard.push(L(`${g.name} ติด${lk.th} (${dayName(day)} คาบ ${pp(lk.from, lk.len)})`, `${g.en} has ${lk.en} (${dayName(day)} period ${pp(lk.from, lk.len)})`)); other = true }
        const b = m.get(key('G', gid, day, p)); if (b) { bl.add(b); hard.push(L(`${g.name} มีเรียนวิชา ${subjOf(b).code} อยู่แล้ว`, `${g.en} already has ${subjOf(b).code}`)); other = true }
      }
      for (const tid of a.teachers) {
        const t = TCH[tid], b = m.get(key('T', tid, day, p));
        if (b) { bl.add(b); hard.push(L(`${t.short} ติดสอนวิชา ${subjOf(b).code} (${grpsOf(b)})`, `${t.short} is teaching ${subjOf(b).code} (${grpsOf(b)})`)); other = true }
        const u = (t.unav || []).find(u => u.day === day && u.p === p); if (u) { hard.push(L(`${t.short} ไม่ว่าง: ${u.reason}`, `${t.short} unavailable: ${u.reason}`)); other = true }
      }
      if (room) {
        const b = m.get(key('R', room, day, p)); if (b) { bl.add(b); hard.push(L(`ห้อง ${room} ไม่ว่าง (วิชา ${subjOf(b).code})`, `Room ${room} is taken (${subjOf(b).code})`)) }
        const ru = (RM[room].unav || []).find(u => u.day === day && u.p === p); if (ru) hard.push(L(`ห้อง ${room} งดใช้: ${ru.reason}`, `Room ${room} closed: ${ru.reason}`));
      }
      if (PER[p].out) soft.push(L('คาบนอกเวลา (16.00–18.00) ต้องได้รับอนุมัติ', 'After-hours period (16:00–18:00) needs approval'));
    }
    if (room && RM[room].type !== SUB[a.subj].room) { hard.push(L(`ห้อง ${room} เป็น${rtName(RM[room].type)} แต่วิชานี้ต้องใช้${rtName(SUB[a.subj].room)}`, `Room ${room} is a ${rtName(RM[room].type)}; this subject needs a ${rtName(SUB[a.subj].room)}`)); other = true }
    for (const tid of a.teachers) {
      const t = TCH[tid], occ = []; let n = 0;
      for (let p = 1; p <= P_MAX; p++) { occ[p] = (p >= start && p < start + len) || m.has(key('T', tid, day, p)); if (occ[p]) n++ }
      if (n > t.maxDay) soft.push(L(`${t.short} จะสอน ${n} คาบในวัน${dayName(day)} เกินเกณฑ์ ${t.maxDay} คาบ`, `${t.short} would teach ${n} periods on ${dayName(day)}, over the ${t.maxDay}-period limit`));
      const r = maxRun(occ); if (r > t.maxConsec) soft.push(L(`${t.short} สอนติดกัน ${r} คาบ เกินเกณฑ์ ${t.maxConsec} คาบ`, `${t.short} would teach ${r} periods in a row (limit ${t.maxConsec})`));
    }
    const h = [...new Set(hard)], s = [...new Set(soft)];
    return { status: h.length ? 'red' : s.length ? 'yellow' : 'green', hard: h, soft: s, blockers: [...bl], roomOnly: h.length > 0 && !other };
  }
  // Place a block, keeping a preferred room if it fits, else any free room of the right type (same building first).
  function placeWithRoom(m, a, day, start, len, prefer) {
    const type = SUB[a.subj].room, pref = [...new Set(prefer)].filter(id => RM[id] && RM[id].type === type), ok = r => r.status !== 'red' && r.status !== 'none';
    const first = check(m, a, day, start, len, pref[0] || prefer[0]);
    for (const room of pref) { const r = check(m, a, day, start, len, room); if (ok(r)) return { room, r }; if (!r.roomOnly) return { room: null, r } }
    const bld = pref[0] && RM[pref[0]].bld;
    for (const x of Object.values(RM).filter(x => x.type === type && x.cap >= gsize(a) && !pref.includes(x.id)).sort((x, y) => (x.bld === bld ? 0 : 1) - (y.bld === bld ? 0 : 1))) {
      const r = check(m, a, day, start, len, x.id); if (ok(r)) return { room: x.id, r }
    }
    return { room: null, r: first };
  }
  // Swap two blocks' places; rooms are re-picked when the old ones are taken at the new time.
  function planSwap(slots, s, x) {
    const m = idx(slots, s.id, x.id), p1 = placeWithRoom(m, A[s.aid], x.day, x.start, s.len, [s.room, x.room]), p2 = placeWithRoom(m, A[x.aid], s.day, s.start, x.len, [x.room, s.room]);
    if (!p1.room || !p2.room) return { ok: false, why: (!p1.room ? p1.r : p2.r).hard[0] };
    const after = slots.map(y => y.id === s.id ? { ...y, day: x.day, start: x.start, room: p1.room } : y.id === x.id ? { ...y, day: s.day, start: s.start, room: p2.room } : y);
    if (conflicts(after)) return { ok: false, why: L('สองคาบนี้จะซ้อนกันเอง', 'These two would overlap') };
    return { ok: true, rooms: [p1.room, p2.room], warn: [...p1.r.soft, ...p2.r.soft][0] || '' };
  }
  const roomFree = (m, r, d, st, len) => { for (let p = st; p < st + len; p++) { if (m.has(key('R', r.id, d, p)) || (r.unav || []).some(u => u.day === d && u.p === p)) return false } return true };
  function softCost(m, a, day, start, len) {
    let c = 0;
    const g = a.groups[0]; let has = false, adj = false;
    for (let p = 1; p <= IN_MAX; p++) { const s = m.get(key('G', g, day, p)); if (s) { has = true; if (s.aid === a.id) c += 8; if (p === start - 1 || p === start + len) adj = true } }
    if (has && !adj) c += 2;
    a.teachers.forEach(t => { for (let p = 1; p <= IN_MAX; p++) if (m.has(key('T', t, day, p))) c += .4 });
    return c;
  }
  function optionsFor(m, b) {
    const a = b.a, out = [], rooms = Object.values(RM).filter(r => r.type === SUB[a.subj].room && r.cap >= gsize(a));
    for (let d = 1; d <= 5; d++) for (let st = 1; st + b.len - 1 <= IN_MAX; st++) {
      const c = check(m, a, d, st, b.len, null); if (c.status === 'red') continue;
      const cost = softCost(m, a, d, st, b.len) + c.soft.length * 4;
      for (const r of rooms) if (roomFree(m, r, d, st, b.len)) out.push({ day: d, start: st, room: r.id, cost: cost + (r.cap - gsize(a)) / 100 });
    }
    return out;
  }
  function whyNot(m, b) {
    const a = b.a, t = TCH[a.teachers[0]], g = GRP[a.groups[0]]; let tf = 0;
    for (let d = 1; d <= 5; d++) for (let p = 1; p <= IN_MAX; p++) if (!m.has(key('T', t.id, d, p)) && !(t.unav || []).some(u => u.day === d && u.p === p)) tf++;
    return tf < b.len ? L(`${t.short} ว่างเหลือ ${tf} คาบ แต่ต้องสอน ${b.len} คาบ`, `${t.short} has ${tf} free periods but needs ${b.len}`)
      : L(`ไม่มีช่วง ${b.len} คาบติดกันที่ ${t.short}, ${g.name} และ${rtName(SUB[a.subj].room)}ว่างพร้อมกัน`, `No ${b.len}-period window where ${t.short}, ${g.en} and a ${rtName(SUB[a.subj].room)} are all free`);
  }
  // CSP: most-constrained block first (MRV), cheapest soft cost next, seeded so a run can be repeated.
  function solve(seed, locked, newId) {
    // Pinned blocks are kept only if they still satisfy the rules (an old pin may run through lunch).
    const R = rng(seed), slots = locked.filter(s => !crossesLunch(s.start, s.len)).map(s => ({ ...s, id: newId(), rv: 0 })), m = idx(slots), done = new Set(slots.map(s => s.aid + '|' + s.split)), blocks = [], unplaced = [];
    ASG.forEach(a => a.pattern.forEach((len, i) => { if (!done.has(a.id + '|' + i)) blocks.push({ a, len, split: i }) }));
    const nextSplit = {}; ASG.forEach(a => nextSplit[a.id] = Math.max(a.pattern.length, ...slots.filter(s => s.aid === a.id).map(s => s.split + 1)));
    while (blocks.length) {
      let bi = -1, bo = null;
      for (let i = 0; i < blocks.length; i++) { const o = optionsFor(m, blocks[i]); if (!bo || o.length < bo.length || (o.length === bo.length && R() < .5)) { bi = i; bo = o; if (!o.length) break } }
      const b = blocks.splice(bi, 1)[0];
      if (!bo.length) {
        // No window for the whole block (e.g. a 4-period practical with every morning taken): try it as two halves once.
        if (b.len >= 2 && !b.halved) { const h = Math.ceil(b.len / 2); blocks.push({ a: b.a, len: h, split: b.split, halved: true }, { a: b.a, len: b.len - h, split: nextSplit[b.a.id]++, halved: true }); continue }
        unplaced.push({ aid: b.a.id, len: b.len, why: whyNot(m, b) }); continue
      }
      bo.forEach(o => o.k = o.cost + R() * 1.5); bo.sort((x, y) => x.k - y.k);
      const o = bo[0], s = { id: newId(), aid: b.a.id, day: o.day, start: o.start, len: b.len, room: o.room, locked: false, split: b.split, rv: 0 };
      slots.push(s); addIdx(m, s);
    }
    return { slots, unplaced };
  }
  function fitness(slots) {
    let pen = 0; const m = idx(slots);
    Object.values(TCH).forEach(t => { let tot = 0; for (let d = 1; d <= 5; d++) { const occ = []; let n = 0; for (let p = 1; p <= P_MAX; p++) { occ[p] = m.has(key('T', t.id, d, p)); if (occ[p]) n++ } tot += n; if (n > t.maxDay) pen += 25 * (n - t.maxDay); if (maxRun(occ) > t.maxConsec) pen += 15 } if (tot > t.max) pen += 40 * (tot - t.max) });
    Object.values(GRP).forEach(g => { for (let d = 1; d <= 5; d++) { const ps = []; for (let p = 1; p <= IN_MAX; p++) if (m.has(key('G', g.id, d, p)) || lockAt(g, d, p)) ps.push(p); for (let p = ps[0]; ps.length > 1 && p <= ps[ps.length - 1]; p++) if (!ps.includes(p)) pen += 4 } });
    const byA = {}; slots.forEach(s => byA[s.aid] = (byA[s.aid] || 0) + 1); Object.entries(byA).forEach(([aid, n]) => { if (n > 1 && SUB[A[aid].subj].consec) pen += 15 });
    return Math.max(0, Math.round(1000 - pen));
  }
  function conflicts(slots) { const seen = new Set(); let n = 0; slots.forEach(s => { const a = A[s.aid]; for (let p = s.start; p < s.start + s.len; p++)[...a.teachers.map(t => 'T' + t), ...a.groups.map(g => 'G' + g), 'R' + s.room].forEach(k => { const kk = `${k}|${s.day}|${p}`; if (seen.has(kk)) n++; else seen.add(kk) }) }); return n }
  const total = () => ASG.reduce((n, a) => n + a.periods, 0);
  const placed = v => v.slots.reduce((n, s) => n + s.len, 0);
  const load = (tid, v) => { let inH = 0, outH = 0; v.slots.forEach(s => { if (A[s.aid].teachers.includes(tid)) for (let p = s.start; p < s.start + s.len; p++) PER[p].out ? outH++ : inH++ }); return { inH, outH, tot: inH + outH } };
  // Full check of a whole slot set (used before replacing a version's slots, e.g. undo).
  function validateSlots(slots) {
    for (const s of slots) if (!A[s.aid]) return L('มีรายการสอนที่ไม่รู้จัก', 'Unknown teaching assignment');
    if (conflicts(slots)) return L('ตารางนี้มีคาบชนกัน', 'This timetable has clashes');
    for (const s of slots) { const r = check(idx(slots, s.id), A[s.aid], s.day, s.start, s.len, s.room); if (r.status === 'red' || r.status === 'none') return r.hard[0] }
    return null;
  }
  return { rtName, gName, lockAt, who, key, addIdx, idx, subjOf, grpsOf, gsize, check, placeWithRoom, planSwap, solve, fitness, conflicts, total, placed, load, validateSlots };
}

// Excel import rules, shared by the preview in the browser and the save on the server.
export function importSpec(D, L = TH) {
  const { TCH, RM, SUB, DEPT } = D;
  return {
    teachers: {
      th: 'ครู', en: 'Teachers', cols: ['emp_code', 'full_name', 'department', 'position'],
      sample: [['PT-023', 'นายกฤษดา ภูมิใจ', 'EL', 'ครูผู้ช่วย'], ['PT-003', 'นางสาวทดสอบ ซ้ำรหัส', 'AU', 'ครู'], ['PT-024', '', 'BC', 'ครู'], ['PT-025', 'นางสาวศิริพร ใจงาม', 'ART', 'ครู']],
      val: (r, seen) => {
        const e = []; if (!r.emp_code) e.push(L('ไม่มีรหัสบุคลากร', 'Missing staff code')); else if (seen.has(r.emp_code) || Object.values(TCH).some(t => t.emp === r.emp_code)) e.push(L(`รหัส ${r.emp_code} ซ้ำ`, `Duplicate code ${r.emp_code}`));
        if (!r.full_name) e.push(L('ไม่มีชื่อ-สกุล', 'Missing name')); if (!DEPT[r.department]) e.push(L(`ไม่รู้จักแผนก “${r.department}” (ใช้ ${Object.keys(DEPT).join('/')})`, `Unknown department “${r.department}” (use ${Object.keys(DEPT).join('/')})`)); return e
      }
    },
    rooms: {
      th: 'ห้อง', en: 'Rooms', cols: ['room_code', 'room_name', 'building', 'capacity', 'room_type'],
      sample: [['B-105', 'ห้องเรียน B-105', 'อาคาร 2', '40', 'CLASS'], ['C-304', 'ห้องปฏิบัติการคอมพิวเตอร์ 4', 'อาคาร 3', 'สามสิบ', 'LAB'], ['A-201', 'ห้องซ้ำ', 'อาคาร 1', '40', 'CLASS']],
      val: (r, seen) => {
        const e = []; if (!r.room_code) e.push(L('ไม่มีรหัสห้อง', 'Missing room code')); else if (seen.has(r.room_code) || RM[r.room_code]) e.push(L(`รหัสห้อง ${r.room_code} ซ้ำ`, `Duplicate room ${r.room_code}`));
        if (!(+r.capacity > 0)) e.push(L('ความจุต้องเป็นตัวเลขมากกว่า 0', 'Capacity must be a number above 0')); if (!RT[r.room_type]) e.push(L(`ประเภทห้องต้องเป็น ${Object.keys(RT).join('/')}`, `Room type must be ${Object.keys(RT).join('/')}`)); return e
      }
    },
    subjects: {
      th: 'วิชา', en: 'Subjects', cols: ['subject_code', 'subject_name', 'periods_per_week', 'required_room_type'],
      sample: [['20204-2107', 'การพัฒนาแอปพลิเคชันมือถือ', '4', 'LAB'], ['2020421', 'รหัสผิดรูปแบบ', '4', 'LAB'], ['20101-2107', 'งานตัวถังรถยนต์', '12', 'WS_AU']],
      val: (r, seen) => {
        const e = []; if (!/^\d{5}-\d{4}$/.test(r.subject_code || '')) e.push(L('รหัสวิชาต้องเป็นรูปแบบ 00000-0000', 'Subject code must look like 00000-0000')); else if (seen.has(r.subject_code) || SUB[r.subject_code]) e.push(L('รหัสวิชาซ้ำ', 'Duplicate subject'));
        if (!r.subject_name) e.push(L('ไม่มีชื่อวิชา', 'Missing name')); if (!(+r.periods_per_week >= 1 && +r.periods_per_week <= 8)) e.push(L('คาบต่อสัปดาห์ต้องอยู่ระหว่าง 1–8', 'Periods per week must be 1–8')); if (!RT[r.required_room_type]) e.push(L('ประเภทห้องไม่ถูกต้อง', 'Invalid room type')); return e
      }
    },
  };
}
export function validateImport(spec, ent, rows) {
  const seen = new Set();
  return rows.map(raw => { const r = {}; spec[ent].cols.forEach(c => r[c] = String(raw[c] ?? '').trim().slice(0, 120)); const e = spec[ent].val(r, seen); const k = r[spec[ent].cols[0]]; if (k) seen.add(k); return { r, e } });
}
