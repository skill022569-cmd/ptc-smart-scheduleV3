import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  prisma, getSession, loadMaster, coreFor, loadVersion, loadVersions, saveSlots, createVersion, replaceSlots,
  audit, rateLimit, json, fail, HttpError,
} from '../../../lib/server.js';
import { importSpec, validateImport, pp, thDay } from '../../../lib/core.js';

export const maxDuration = 60;

const PUBLIC = new Set(['issueCreate', 'dsrCreate', 'consent']);
const ADMIN_ONLY = new Set(['pin', 'clone', 'publish', 'runScheduler', 'crDecide', 'issueMove', 'dsrDone', 'lockToggle', 'import']);
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const int = v => { const n = Number(v); if (!Number.isInteger(n)) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง'); return n };

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    const type = String(b.type || '');
    if (!H[type]) throw new HttpError(400, 'ไม่รู้จักคำสั่งนี้');
    const me = await getSession();
    if (!PUBLIC.has(type)) {
      if (!me) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
      if (me.mc) throw new HttpError(403, 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
      if (ADMIN_ONLY.has(type) && me.role !== 'ADMIN') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบ');
    } else rateLimit('public-write', 20, 60 * 60e3);
    return json(await H[type](b, me) || { ok: true });
  } catch (e) { return fail(e) }
}

/* ---------- helpers ---------- */
async function ctx(vid) {
  const [D, v] = await Promise.all([loadMaster(), vid ? loadVersion(vid) : null]);
  return { D, core: coreFor(D), v };
}
function slotIn(v, id) { const s = v.slots.find(x => x.id === String(id)); if (!s) throw new HttpError(404, 'ไม่พบคาบนี้'); return s }
// Admin edits any slot in a draft; a teacher edits only their own slots in a draft.
function mayEdit(me, D, v, s) {
  if (v.status !== 'DRAFT') throw new HttpError(403, 'แก้ได้เฉพาะฉบับร่าง');
  if (me.role === 'TEACHER' && !D.A[s.aid].teachers.includes(me.pid)) throw new HttpError(403, 'ย้ายได้เฉพาะคาบที่คุณสอน');
  if (s.locked && me.role !== 'ADMIN') throw new HttpError(403, 'คาบนี้ถูกปักหมุดไว้');
}
const label = (core, s) => `${core.subjOf(s).code} ${core.grpsOf(s)}`;
const where = (s) => `${thDay(s.day)} คาบ ${pp(s.start, s.len)}`;
const refit = (tx, core, v) => tx.scheduleVersion.update({ where: { id: v.id }, data: { fitnessScore: core.fitness(v.slots) } });
const tx = fn => prisma.$transaction(fn, { timeout: 30000 });

/* ---------- handlers ---------- */
const H = {
  async move(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid);
    mayEdit(me, D, v, s);
    const day = int(b.day), start = int(b.start), room = b.room ? str(b.room, 16) : s.room;
    const r = core.check(core.idx(v.slots, s.id), D.A[s.aid], day, start, s.len, room);
    if (r.status === 'red' || r.status === 'none') throw new HttpError(409, 'บันทึกไม่ได้: ' + r.hard.join('; '));
    const from = where(s); Object.assign(s, { day, start, room, rv: int(b.rv) });
    await tx(async t => { await saveSlots(t, D, v.id, [s]); await refit(t, core, v) });
    await audit(me.name, 'MOVE_SLOT', `${label(core, s)}: ${from} → ${where(s)} ${room}`);
  },
  async swap(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid), x = slotIn(v, b.xid);
    mayEdit(me, D, v, s); mayEdit(me, D, v, x);
    if (s.len !== x.len || !D.A[x.aid].teachers.some(t => D.A[s.aid].teachers.includes(t))) throw new HttpError(400, 'สลับได้เฉพาะคาบของครูคนเดียวกันที่ยาวเท่ากัน');
    const m = core.idx(v.slots, s.id, x.id);
    const r1 = core.check(m, D.A[s.aid], x.day, x.start, s.len, s.room), r2 = core.check(m, D.A[x.aid], s.day, s.start, x.len, x.room);
    if (r1.status === 'red' || r2.status === 'red') throw new HttpError(409, 'สลับไม่ได้: ' + [...r1.hard, ...r2.hard].join('; '));
    [s.day, s.start, x.day, x.start] = [x.day, x.start, s.day, s.start];
    await tx(async t => { await saveSlots(t, D, v.id, [s, x]); await refit(t, core, v) });
    await audit(me.name, 'SWAP_SLOT', `${label(core, s)} ⇄ ${label(core, x)}`);
  },
  async split(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid);
    mayEdit(me, D, v, s);
    const a = int(b.a), c = int(b.b);
    if (a < 1 || c < 1 || a + c !== s.len) throw new HttpError(400, 'ผลรวมคาบต้องเท่าเดิม');
    const ns = { ...s, id: randomUUID(), start: s.start + a, len: c, locked: false, split: Math.max(...v.slots.filter(o => o.aid === s.aid).map(o => o.split)) + 1 };
    s.len = a; v.slots.push(ns);
    await tx(async t => { await saveSlots(t, D, v.id, [s], [ns]); await refit(t, core, v) });
    await audit(me.name, 'SPLIT_SLOT', `${label(core, s)} [${a},${c}]`);
    return { ok: true, newId: ns.id };
  },
  async pin(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid);
    if (v.status !== 'DRAFT') throw new HttpError(403, 'แก้ได้เฉพาะฉบับร่าง');
    s.locked = !s.locked;
    await tx(t => saveSlots(t, D, v.id, [s]));
    await audit(me.name, s.locked ? 'PIN_SLOT' : 'UNPIN_SLOT', label(core, s));
  },
  // Undo: replace a draft's slots with an earlier snapshot, after a full re-check.
  async restore(b, me) {
    const { D, core, v } = await ctx(b.vid);
    if (v.status !== 'DRAFT') throw new HttpError(403, 'แก้ได้เฉพาะฉบับร่าง');
    if (!Array.isArray(b.slots) || b.slots.length > 2000) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง');
    const slots = b.slots.map(s => ({ id: str(s.id, 40), aid: str(s.aid, 40), day: int(s.day), start: int(s.start), len: int(s.len), room: str(s.room, 16), locked: !!s.locked, split: int(s.split) }));
    const sum = list => { const o = {}; list.forEach(s => o[s.aid] = (o[s.aid] || 0) + s.len); return JSON.stringify(Object.entries(o).sort()) };
    if (sum(slots) !== sum(v.slots)) throw new HttpError(400, 'จำนวนคาบไม่ตรงกับฉบับปัจจุบัน');
    const err = core.validateSlots(slots); if (err) throw new HttpError(409, 'ย้อนกลับไม่ได้: ' + err);
    if (me.role === 'TEACHER') {
      const cur = new Map(v.slots.map(s => [s.id, s]));
      const touched = [...slots.filter(s => { const c = cur.get(s.id); return !c || c.day !== s.day || c.start !== s.start || c.len !== s.len || c.room !== s.room }), ...v.slots.filter(c => !slots.some(s => s.id === c.id))];
      if (touched.some(s => !D.A[s.aid].teachers.includes(me.pid))) throw new HttpError(403, 'ย้อนกลับได้เฉพาะคาบที่คุณสอน');
    }
    await tx(async t => { await replaceSlots(t, D, v.id, slots); await t.scheduleVersion.update({ where: { id: v.id }, data: { fitnessScore: core.fitness(slots) } }) });
    await audit(me.name, 'UNDO', v.name);
  },
  async clone(b, me) {
    const { D, core, v } = await ctx(b.vid);
    const id = 'v-' + randomUUID().slice(0, 8), slots = v.slots.map(s => ({ ...s, id: randomUUID() }));
    await tx(t => createVersion(t, D, { id, name: `ฉบับร่าง (โคลนจาก ${v.name})`.slice(0, 180), status: 'DRAFT', source: 'CLONE', seed: v.seed, fitness: core.fitness(slots), unplaced: v.unplaced, createdBy: me.name }, slots));
    await audit(me.name, 'CLONE', `${v.id} → ${id}`);
    return { ok: true, vid: id };
  },
  async publish(b, me) {
    const { D, core, v } = await ctx(b.vid);
    if (v.status === 'PUBLISHED') throw new HttpError(400, 'ฉบับนี้เผยแพร่อยู่แล้ว');
    if (core.conflicts(v.slots)) throw new HttpError(409, 'ฉบับนี้มีคาบชนกัน ต้องแก้ก่อนเผยแพร่');
    await tx(async t => {
      await t.scheduleVersion.updateMany({ where: { termId: D.term.id, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
      await t.scheduleVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
      // shortcut: in-app notification only; email and LINE OA delivery come with the worker.
      await t.notification.create({ data: { recipientType: 'ALL', recipientId: '*', channel: 'IN_APP', message: `เผยแพร่ตาราง: ${v.name}` } });
    });
    await audit(me.name, 'PUBLISH', v.name);
  },
  async runScheduler(b, me) {
    const D = await loadMaster(), core = coreFor(D), seed = Math.max(1, Math.min(99999, int(b.seed)));
    const [draft] = (await loadVersions({ status: 'DRAFT' })).slice(-1);
    const t0 = Date.now(), r = core.solve(seed, draft ? draft.slots.filter(s => s.locked) : [], randomUUID), ms = Date.now() - t0;
    if (core.conflicts(r.slots)) throw new HttpError(500, 'ตัวจัดตารางให้ผลที่ชนกัน');
    const id = 'v-' + randomUUID().slice(0, 8);
    await tx(t => createVersion(t, D, { id, name: `ฉบับร่างจากตัวจัดตาราง (seed ${seed})`, status: 'DRAFT', source: 'SOLVER', seed, fitness: core.fitness(r.slots), unplaced: r.unplaced, createdBy: me.name }, r.slots));
    await audit(me.name, 'RUN_SCHEDULER', `seed ${seed} → ${id}, ${core.placed(r)}/${core.total()} คาบ, ${ms} ms`);
    return { ok: true, vid: id, ms };
  },
  async crCreate(b, me) {
    if (me.role !== 'TEACHER') throw new HttpError(403, 'เฉพาะครูผู้สอน');
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid);
    if (!D.A[s.aid].teachers.includes(me.pid)) throw new HttpError(403, 'ขอย้ายได้เฉพาะคาบที่คุณสอน');
    if (v.status === 'ARCHIVED') throw new HttpError(400, 'ฉบับนี้ถูกเก็บถาวรแล้ว');
    if (int(b.day) === s.day && int(b.start) === s.start) throw new HttpError(400, 'เวลาที่ขอเป็นเวลาเดิมของคาบนี้');
    const day = int(b.day), start = int(b.start), r = core.check(core.idx(v.slots, s.id), D.A[s.aid], day, start, s.len, s.room);
    if (r.status === 'red' || r.status === 'none') throw new HttpError(409, 'เวลาที่ขอชนกับ: ' + r.hard.join('; '));
    const c = await prisma.changeRequest.create({ data: { versionId: v.id, slotId: s.id, requestedBy: me.pid, fromDay: s.day, fromStart: s.start, toDay: day, toStart: start, note: str(b.note, 300) } });
    await audit(me.name, 'CHANGE_REQUEST', `CR-${String(c.id).padStart(3, '0')} ${label(core, s)}: ${where(s)} → ${thDay(day)} คาบ ${pp(start, s.len)}`);
    return { ok: true, id: c.id };
  },
  async crDecide(b, me) {
    const c = await prisma.changeRequest.findUnique({ where: { id: int(b.id) } });
    if (!c || c.status !== 'PENDING') throw new HttpError(404, 'ไม่พบคำขอที่รออนุมัติ');
    const ref = `CR-${String(c.id).padStart(3, '0')}`;
    if (!b.approve) { await prisma.changeRequest.update({ where: { id: c.id }, data: { status: 'REJECTED', reviewedBy: me.name } }); await audit(me.name, 'REJECT_CHANGE', ref); return }
    const { D, core, v } = await ctx(c.versionId), s = v.slots.find(x => x.id === c.slotId);
    if (!s || v.status === 'ARCHIVED') { await prisma.changeRequest.update({ where: { id: c.id }, data: { status: 'REJECTED', error: 'ฉบับที่ขอถูกเก็บถาวรหรือคาบถูกลบแล้ว', reviewedBy: me.name } }); return }
    const r = core.check(core.idx(v.slots, s.id), D.A[s.aid], c.toDay, c.toStart, s.len, s.room);
    if (r.status === 'red') {
      await prisma.changeRequest.update({ where: { id: c.id }, data: { error: 'ตรวจซ้ำแล้วชน: ' + r.hard.join('; ') } });
      throw new HttpError(409, 'อนุมัติไม่ได้ เพราะเวลาที่ขอชนกับคาบอื่นแล้ว');
    }
    const from = where(s); Object.assign(s, { day: c.toDay, start: c.toStart });
    await tx(async t => {
      await saveSlots(t, D, v.id, [s]); await refit(t, core, v);
      await t.changeRequest.update({ where: { id: c.id }, data: { status: 'APPROVED', error: null, reviewedBy: me.name } });
      const msg = `${ref} อนุมัติแล้ว: ${label(core, s)} ${from} → ${where(s)}`;
      await t.notification.createMany({ data: [{ recipientType: 'TEACHER', recipientId: c.requestedBy, channel: 'IN_APP', message: msg }, ...D.A[s.aid].groups.map(g => ({ recipientType: 'GROUP', recipientId: g, channel: 'IN_APP', message: msg }))] });
    });
    await audit(me.name, 'APPROVE_CHANGE', `${ref} ${label(core, s)}: ${from} → ${where(s)}`);
  },
  async issueCreate(b) {
    const desc = str(b.desc, 500); if (!desc) throw new HttpError(400, 'กรุณาเล่ารายละเอียดปัญหา');
    const x = await prisma.issueReport.create({ data: { description: desc, contact: str(b.contact, 80), relatedSlotId: b.sid ? str(b.sid, 40) : null } });
    return { ok: true, id: x.id };
  },
  async issueMove(b, me) {
    const status = str(b.status, 16); if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    await prisma.issueReport.update({ where: { id: int(b.id) }, data: { status } });
    await audit(me.name, 'ISSUE_STATUS', `ISS-${String(b.id).padStart(3, '0')} → ${status}`);
  },
  async dsrCreate(b) {
    const name = str(b.name, 80), detail = str(b.detail, 500), type = str(b.type, 8);
    if (!name || !detail || !['VIEW', 'EDIT', 'DEL'].includes(type)) throw new HttpError(400, 'กรอกข้อมูลให้ครบ');
    const x = await prisma.dataSubjectRequest.create({ data: { requester: name, type, detail } });
    return { ok: true, id: x.id };
  },
  async dsrDone(b, me) {
    await prisma.dataSubjectRequest.update({ where: { id: int(b.id) }, data: { status: 'DONE', handledBy: me.name } });
    await audit(me.name, 'PDPA_REQUEST', `DSR-${String(b.id).padStart(3, '0')} ดำเนินการแล้ว`);
  },
  async consent(b) {
    const choice = b.choice === 'all' ? 'all' : 'essential';
    await prisma.consentRecord.create({ data: { subjectType: 'VISITOR', subjectId: str(b.visitor, 64) || 'anonymous', purpose: 'COOKIE_' + choice.toUpperCase(), policyVersion: '1.0', granted: true } });
  },
  async lockToggle(b, me) {
    const id = str(b.id, 16);
    await prisma.lockedActivity.update({ where: { id }, data: { isActive: !!b.on } });
    await audit(me.name, 'LOCK_PERIOD', `${id} ${b.on ? 'ON' : 'OFF'}`);
  },
  async import(b, me) {
    const D = await loadMaster(), spec = importSpec(D), ent = str(b.entity, 16);
    if (!spec[ent] || !Array.isArray(b.rows) || b.rows.length > 500) throw new HttpError(400, 'ข้อมูลนำเข้าไม่ถูกต้อง');
    const good = validateImport(spec, ent, b.rows).filter(x => !x.e.length).map(x => x.r);
    if (ent === 'teachers') {
      const hash = process.env.INITIAL_PASSWORD ? await bcrypt.hash(process.env.INITIAL_PASSWORD, 10) : null;
      for (const r of good) {
        const p = await prisma.personnel.create({ data: { empCode: r.emp_code, fullName: r.full_name, position: r.position || 'ครู', departmentCode: r.department } });
        if (hash) await prisma.user.create({ data: { username: r.emp_code, passwordHash: hash, role: 'TEACHER', personnelId: p.id } });
      }
    }
    if (ent === 'rooms') await prisma.room.createMany({ data: good.map(r => ({ code: r.room_code, name: r.room_name || r.room_code, building: r.building || '-', capacity: +r.capacity, roomType: r.room_type })) });
    if (ent === 'subjects') await prisma.subject.createMany({ data: good.map(r => ({ code: r.subject_code, name: r.subject_name, credits: '-', periodsPerWeek: +r.periods_per_week, requiredRoomType: r.required_room_type, preferConsecutive: r.required_room_type !== 'CLASS', departmentCode: 'GE' })) });
    await audit(me.name, 'IMPORT', `${ent}: ${good.length} แถว`);
    return { ok: true, count: good.length };
  },
};
