import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  prisma, getSession, loadMaster, coreFor, loadVersion, loadVersions, saveSlots, createVersion, replaceSlots,
  audit, rateLimit, json, fail, HttpError,
} from '../../../lib/server.js';
import { importSpec, validateImport, pp, thDay, crossesLunch } from '../../../lib/core.js';

export const maxDuration = 60;

const PUBLIC = new Set(['issueCreate', 'dsrCreate', 'consent']);
const ADMIN_ONLY = new Set(['resize', 'deleteVersion', 'setPassword', 'pin', 'clone', 'publish', 'runScheduler', 'crDecide', 'issueMove', 'dsrDone', 'lockToggle', 'import']);
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
      if (me.imp) throw new HttpError(403, 'โหมดดูในมุมของผู้ใช้อื่นแก้ไขข้อมูลไม่ได้ กรุณากลับเป็นผู้ดูแลระบบก่อน');
      if (me.role === 'PUBLIC') throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
      if (me.role === 'EXEC' && type !== 'profileSave') throw new HttpError(403, 'ผู้บริหารดูข้อมูลได้อย่างเดียว');
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
const H0 = {
  // Admin sets a new password for a staff account; also clears any lockout.
  async setPassword(b, me) {
    const pid = str(b.pid, 40), pw = String(b.password || '');
    if (pw.length < 8 || pw.length > 200) throw new HttpError(400, 'รหัสผ่านต้องยาว 8 ตัวอักษรขึ้นไป');
    const u = await prisma.user.findFirst({ where: { personnelId: pid } });
    if (!u) throw new HttpError(404, 'บุคลากรนี้ยังไม่มีบัญชีผู้ใช้');
    if (u.role === 'ADMIN') throw new HttpError(403, 'เปลี่ยนรหัสบัญชีผู้ดูแลระบบจากหน้านี้ไม่ได้');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: !!b.force, failedLogins: 0, lockedUntil: null } });
    await audit(me.name, 'PASSWORD_RESET', `${u.username}${b.force ? ' (ต้องเปลี่ยนเมื่อเข้าครั้งถัดไป)' : ''}`);
  },
};
const MAX_DRAFTS = 5, KEEP_ARCHIVED = 2;
async function dropVersion(t, vid, why) {
  await t.changeRequest.updateMany({ where: { versionId: vid, status: 'PENDING' }, data: { status: 'REJECTED', error: why } });
  await t.slotOccupancy.deleteMany({ where: { versionId: vid } });
  await t.scheduleSlot.deleteMany({ where: { versionId: vid } });
  await t.scheduleVersion.delete({ where: { id: vid } });
}
async function roomForDraft(termId) {
  const n = await prisma.scheduleVersion.count({ where: { termId, status: 'DRAFT' } });
  if (n >= MAX_DRAFTS) throw new HttpError(409, `มีฉบับร่างครบ ${MAX_DRAFTS} ฉบับแล้ว กรุณาลบฉบับร่างที่ไม่ใช้ในหน้าเวอร์ชันก่อน`);
}
// The assignment (input for future scheduler runs) follows the block lengths edited in this draft.
async function syncAssignment(t, v, aid) {
  const parts = v.slots.filter(o => o.aid === aid).sort((x, y) => x.split - y.split).map(o => o.len);
  await t.teachingAssignment.update({ where: { id: aid }, data: { requiredPeriods: parts.reduce((n, l) => n + l, 0), blockPattern: parts } });
}
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const H = {
  ...H0,
  // Own profile for everyone with a staff record; any profile for admins (who may also change name, position, department).
  async profileSave(b, me) {
    const pid = str(b.pid, 40), admin = me.role === 'ADMIN';
    if (!admin && me.pid !== pid) throw new HttpError(403, 'แก้ได้เฉพาะข้อมูลของตนเอง');
    const p = await prisma.personnel.findUnique({ where: { id: pid } });
    if (!p) throw new HttpError(404, 'ไม่พบบุคลากร');
    const email = str(b.email, 120), phone = str(b.phone, 20);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
    if (phone && !/^[0-9+\-\s]{9,20}$/.test(phone)) throw new HttpError(400, 'เบอร์โทรต้องเป็นตัวเลข 9–20 หลัก');
    const data = { expertise: str(b.exp, 190), education: str(b.edu, 190), phone, email, lineId: str(b.line, 60), workHistory: str(b.hist, 3000) || null, isPublicProfile: !!b.consent };
    if (admin) {
      const name = str(b.name, 120), pos = str(b.pos, 120), dept = str(b.dept, 8);
      if (!name || !pos) throw new HttpError(400, 'กรอกชื่อและตำแหน่งให้ครบ');
      if (!await prisma.department.findUnique({ where: { code: dept } })) throw new HttpError(400, 'ไม่พบแผนกนี้');
      Object.assign(data, { fullName: name, position: pos, departmentCode: dept });
    }
    let photo; // undefined = unchanged, '' = remove, otherwise new data URL
    if (typeof b.photo === 'string') {
      photo = b.photo;
      if (photo && (photo.length > 400000 || !PHOTO.test(photo))) throw new HttpError(400, 'รูปไม่ถูกต้องหรือใหญ่เกินไป');
      data.photoVersion = { increment: 1 };
    }
    await tx(async t => {
      if (photo === '') await t.personnelPhoto.deleteMany({ where: { personnelId: pid } });
      else if (photo) await t.personnelPhoto.upsert({ where: { personnelId: pid }, update: { data: photo }, create: { personnelId: pid, data: photo } });
      await t.personnel.update({ where: { id: pid }, data });
      if (p.isPublicProfile !== data.isPublicProfile) await t.consentRecord.create({ data: { subjectType: 'PERSONNEL', subjectId: pid, purpose: 'DIRECTORY_PROFILE', policyVersion: '1.0', granted: data.isPublicProfile, withdrawnAt: data.isPublicProfile ? null : new Date() } });
    });
    await audit(me.name, 'PROFILE_UPDATE', `${p.empCode} ${data.fullName || p.fullName}${photo !== undefined ? (photo ? ' (เปลี่ยนรูป)' : ' (ลบรูป)') : ''}${p.isPublicProfile !== data.isPublicProfile ? (data.isPublicProfile ? ' ยินยอมเผยแพร่' : ' ถอนความยินยอม') : ''}`);
  },
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
  // Swap two blocks' places (any subjects, any lengths) when both fit and nothing clashes afterwards.
  async swap(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid), x = slotIn(v, b.xid);
    mayEdit(me, D, v, s); mayEdit(me, D, v, x);
    if (s.id === x.id) throw new HttpError(400, 'เลือกคาบอื่นเพื่อสลับ');
    const plan = core.planSwap(v.slots, s, x);
    if (!plan.ok) throw new HttpError(409, 'สลับไม่ได้: ' + plan.why);
    [s.day, s.start, s.room, x.day, x.start, x.room] = [x.day, x.start, plan.rooms[0], s.day, s.start, plan.rooms[1]];
    await tx(async t => { await saveSlots(t, D, v.id, [s, x]); await refit(t, core, v) });
    await audit(me.name, 'SWAP_SLOT', `${label(core, s)} ⇄ ${label(core, x)}`);
  },
  // +1 / -1 period on a block (admin): the subject's weekly periods and block pattern follow the draft.
  async resize(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid);
    mayEdit(me, D, v, s);
    const delta = int(b.delta), parts = v.slots.filter(o => o.aid === s.aid);
    if (delta !== 1 && delta !== -1) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง');
    let removed = null;
    if (delta === 1) {
      const start = b.at === 'start' ? s.start - 1 : s.start;
      const r = core.check(core.idx(v.slots, s.id), D.A[s.aid], s.day, start, s.len + 1, s.room);
      if (r.status === 'red' || r.status === 'none') throw new HttpError(409, 'เพิ่มคาบไม่ได้: ' + r.hard.join('; '));
      Object.assign(s, { start, len: s.len + 1 });
    } else if (s.len > 1) s.len -= 1;
    else if (parts.length > 1) removed = s;
    else throw new HttpError(400, 'วิชานี้เหลือ 1 คาบแล้ว ลดอีกไม่ได้');
    if (removed) v.slots = v.slots.filter(o => o.id !== s.id);
    await tx(async t => {
      if (removed) { await t.slotOccupancy.deleteMany({ where: { slotId: s.id } }); await t.scheduleSlot.delete({ where: { id: s.id } }) }
      else await saveSlots(t, D, v.id, [s]);
      await syncAssignment(t, v, s.aid); await refit(t, core, v);
    });
    const total = v.slots.filter(o => o.aid === s.aid).reduce((n, o) => n + o.len, 0);
    await audit(me.name, delta > 0 ? 'ADD_PERIOD' : 'REMOVE_PERIOD', `${label(core, s)}: รวม ${total} คาบ/สัปดาห์`);
  },
  async deleteVersion(b, me) {
    const { v } = await ctx(b.vid);
    if (v.status === 'PUBLISHED') throw new HttpError(400, 'ลบฉบับที่เผยแพร่อยู่ไม่ได้ ให้เผยแพร่ฉบับอื่นก่อน');
    await tx(t => dropVersion(t, v.id, 'ฉบับตารางถูกลบ'));
    await audit(me.name, 'DELETE_VERSION', v.name);
  },
  // Join two parts of the same teaching assignment back into one block, at either part's position.
  async merge(b, me) {
    const { D, core, v } = await ctx(b.vid), s = slotIn(v, b.sid), x = slotIn(v, b.xid);
    mayEdit(me, D, v, s); mayEdit(me, D, v, x);
    if (s.id === x.id || s.aid !== x.aid) throw new HttpError(400, 'รวมได้เฉพาะคาบของวิชาและกลุ่มเรียนเดียวกัน');
    const at = b.at === 'other' ? x : s, len = s.len + x.len, room = str(b.room, 16) || s.room;
    const r = core.check(core.idx(v.slots, s.id, x.id), D.A[s.aid], at.day, at.start, len, room);
    if (r.status === 'red' || r.status === 'none') throw new HttpError(409, 'รวมคาบไม่ได้: ' + r.hard.join('; '));
    Object.assign(s, { day: at.day, start: at.start, len, room, split: Math.min(s.split, x.split) });
    v.slots = v.slots.filter(o => o.id !== x.id);
    await tx(async t => {
      await t.slotOccupancy.deleteMany({ where: { slotId: x.id } });
      await t.scheduleSlot.delete({ where: { id: x.id } });
      await saveSlots(t, D, v.id, [s]); await refit(t, core, v);
    });
    await audit(me.name, 'MERGE_SLOT', `${label(core, s)}: ${where(s)}`);
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
    // Teachers may only move periods; admins may also undo a +/- period change.
    if (me.role !== 'ADMIN' && sum(slots) !== sum(v.slots)) throw new HttpError(400, 'จำนวนคาบไม่ตรงกับฉบับปัจจุบัน');
    // Re-check only slots that differ from now, so drafts made under older rules can still be undone.
    if (slots.some(s => !D.A[s.aid])) throw new HttpError(400, 'มีรายการสอนที่ไม่รู้จัก');
    if (core.conflicts(slots)) throw new HttpError(409, 'ย้อนกลับไม่ได้: ตารางจะมีคาบชนกัน');
    const now = new Map(v.slots.map(s => [s.id, s]));
    for (const s of slots) {
      const c = now.get(s.id); if (c && c.day === s.day && c.start === s.start && c.len === s.len && c.room === s.room) continue;
      const r = core.check(core.idx(slots, s.id), D.A[s.aid], s.day, s.start, s.len, s.room);
      if (r.status === 'red' || r.status === 'none') throw new HttpError(409, 'ย้อนกลับไม่ได้: ' + r.hard[0]);
    }
    if (me.role === 'TEACHER') {
      const cur = new Map(v.slots.map(s => [s.id, s]));
      const touched = [...slots.filter(s => { const c = cur.get(s.id); return !c || c.day !== s.day || c.start !== s.start || c.len !== s.len || c.room !== s.room }), ...v.slots.filter(c => !slots.some(s => s.id === c.id))];
      if (touched.some(s => !D.A[s.aid].teachers.includes(me.pid))) throw new HttpError(403, 'ย้อนกลับได้เฉพาะคาบที่คุณสอน');
    }
    const changed = [...new Set([...slots, ...v.slots].map(s => s.aid))].filter(aid => {
      const tot = list => list.filter(s => s.aid === aid).reduce((n, s) => n + s.len, 0); return tot(slots) !== tot(v.slots) });
    if (changed.some(aid => !slots.some(s => s.aid === aid))) throw new HttpError(400, 'วิชาต้องเหลืออย่างน้อย 1 คาบ');
    await tx(async t => {
      await replaceSlots(t, D, v.id, slots); await t.scheduleVersion.update({ where: { id: v.id }, data: { fitnessScore: core.fitness(slots) } });
      for (const aid of changed) await syncAssignment(t, { slots }, aid);
    });
    await audit(me.name, 'UNDO', v.name);
  },
  async clone(b, me) {
    const { D, core, v } = await ctx(b.vid); await roomForDraft(D.term.id);
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
      // Keep only the newest archived versions for rollback; older ones go.
      const old = await t.scheduleVersion.findMany({ where: { termId: D.term.id, status: 'ARCHIVED' }, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], skip: KEEP_ARCHIVED, select: { id: true } });
      for (const o of old) await dropVersion(t, o.id, 'ฉบับตารางเก่าถูกลบอัตโนมัติ');
      // shortcut: in-app notification only; email and LINE OA delivery come with the worker.
      await t.notification.create({ data: { recipientType: 'ALL', recipientId: '*', channel: 'IN_APP', message: `เผยแพร่ตาราง: ${v.name}` } });
    });
    await audit(me.name, 'PUBLISH', v.name);
  },
  async runScheduler(b, me) {
    const D = await loadMaster(), core = coreFor(D), seed = Math.max(1, Math.min(99999, int(b.seed)));
    await roomForDraft(D.term.id);
    const [draft] = (await loadVersions({ status: 'DRAFT' })).slice(-1);
    const t0 = Date.now(), r = core.solve(seed, draft ? draft.slots.filter(s => s.locked) : [], randomUUID), ms = Date.now() - t0;
    if (core.conflicts(r.slots)) throw new HttpError(500, 'ตัวจัดตารางให้ผลที่ชนกัน');
    if (r.slots.some(s => crossesLunch(s.start, s.len))) throw new HttpError(500, 'ตัวจัดตารางให้ผลที่คร่อมพักกลางวัน');
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
