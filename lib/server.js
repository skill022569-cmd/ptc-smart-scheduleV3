import { PrismaClient } from '@prisma/client';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { makeCore, bare } from './core.js';
import { HttpError } from './store.js';
export * from './store.js';

const g = globalThis;
export const prisma = g.__prisma || (g.__prisma = new PrismaClient());

/* ---------- session (JWT in an httpOnly cookie) ---------- */
const COOKIE = 'ptc_session';
const key = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)');
  return new TextEncoder().encode(s);
};
export async function setSession(p) {
  const jwt = await new SignJWT(p).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('8h').sign(key());
  cookies().set(COOKIE, jwt, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 3600 });
}
export const clearSession = () => cookies().delete(COOKIE);
export async function getSession() {
  const c = cookies().get(COOKIE);
  if (!c) return null;
  try { const { payload } = await jwtVerify(c.value, key()); return payload } catch { return null }
}
export const clientIp = () => (headers().get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);

export const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
export function fail(e) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e && e.code === 'P2002') return json({ error: 'ฐานข้อมูลปฏิเสธการบันทึก เพราะจะทำให้ครู ห้อง หรือกลุ่มเรียนชนกัน กรุณาโหลดข้อมูลใหม่' }, 409);
  console.error(e);
  return json({ error: 'เกิดข้อผิดพลาดในระบบ' }, 500);
}

// shortcut: in-memory limiter is per serverless instance; move to a DB/Redis counter when abuse shows up.
const hits = new Map();
export function rateLimit(name, limit, windowMs) {
  const k = name + '|' + clientIp(), now = Date.now(), h = (hits.get(k) || []).filter(t => now - t < windowMs);
  if (h.length >= limit) throw new HttpError(429, 'ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  h.push(now); hits.set(k, h);
}

/* ---------- load master data into the shape lib/core.js expects ---------- */
export async function loadMaster() {
  const term = await prisma.academicTerm.findFirst({ where: { isCurrent: true } });
  if (!term) throw new HttpError(503, 'ยังไม่มีข้อมูลภาคเรียน (ยังไม่ได้ seed ฐานข้อมูล)');
  const [depts, pers, tun, rooms, run, groups, subs, asg, at, ag, locks] = await Promise.all([
    prisma.department.findMany(), prisma.personnel.findMany({ orderBy: { empCode: 'asc' } }), prisma.teacherUnavailability.findMany({ where: { termId: term.id } }),
    prisma.room.findMany({ orderBy: { code: 'asc' } }), prisma.roomUnavailability.findMany({ where: { termId: term.id } }),
    prisma.studentGroup.findMany(), prisma.subject.findMany(), prisma.teachingAssignment.findMany({ where: { termId: term.id } }),
    prisma.assignmentTeacher.findMany(), prisma.assignmentGroup.findMany(), prisma.lockedActivity.findMany({ where: { termId: term.id } })]);
  const DEPT = Object.fromEntries(depts.map(d => [d.code, { code: d.code, th: d.nameTh, en: d.nameEn }]));
  const TCH = {}, RM = {}, GRP = {}, SUB = {}, A = {};
  pers.forEach(p => {
    TCH[p.id] = { id: p.id, emp: p.empCode, dept: p.departmentCode, name: p.fullName, pos: p.position, exp: p.expertise, edu: p.education, phone: p.phone, consent: p.isPublicProfile, max: p.maxHoursPerWeek, maxDay: p.maxPeriodsPerDay, maxConsec: p.maxConsecutive, unav: [] };
    TCH[p.id].first = bare(p.fullName).split(' ')[0]; TCH[p.id].short = 'ครู' + TCH[p.id].first;
  });
  tun.forEach(u => TCH[u.personnelId] && TCH[u.personnelId].unav.push({ day: u.dayOfWeek, p: u.periodNo, reason: u.reason }));
  rooms.forEach(r => RM[r.code] = { id: r.code, name: r.name, bld: r.building, cap: r.capacity, type: r.roomType, unav: [] });
  run.forEach(u => RM[u.roomCode] && RM[u.roomCode].unav.push({ day: u.dayOfWeek, p: u.periodNo, reason: u.reason }));
  groups.forEach(g => GRP[g.code] = { id: g.code, dept: g.departmentCode, level: g.level, year: g.yearNo, size: g.studentCount, name: g.nameTh, en: g.nameEn, advisor: g.advisorId });
  subs.forEach(s => SUB[s.code] = { code: s.code, name: s.name, periods: s.periodsPerWeek, room: s.requiredRoomType, dept: s.departmentCode, consec: s.preferConsecutive, cred: s.credits });
  const ASG = asg.map(a => ({ id: a.id, subj: a.subjectCode, periods: a.requiredPeriods, pattern: a.blockPattern, teachers: [], groups: [] }));
  ASG.forEach(a => A[a.id] = a);
  at.forEach(x => A[x.assignmentId] && A[x.assignmentId].teachers.push(x.personnelId));
  ag.forEach(x => A[x.assignmentId] && A[x.assignmentId].groups.push(x.groupCode));
  const LOCKS = locks.sort((a, b) => a.dayOfWeek - b.dayOfWeek).map(l => ({ id: l.id, th: l.nameTh, en: l.nameEn, day: l.dayOfWeek, from: l.fromPeriod, len: l.length, applies: l.appliesTo, on: l.isActive }));
  return { term, DEPT, TCH, RM, GRP, SUB, A, ASG, LOCKS };
}
export const coreFor = D => makeCore(D);

const toSlot = s => ({ id: s.id, aid: s.assignmentId, day: s.dayOfWeek, start: s.startPeriod, len: s.length, room: s.roomCode, locked: s.isLocked, split: s.splitIndex, rv: s.rowVersion });
export async function loadVersions(where) {
  const vs = await prisma.scheduleVersion.findMany({ where, orderBy: { createdAt: 'asc' } });
  const slots = vs.length ? await prisma.scheduleSlot.findMany({ where: { versionId: { in: vs.map(v => v.id) } } }) : [];
  return vs.map(v => ({ id: v.id, name: v.name, status: v.status, source: v.source, seed: v.seed, fitness: v.fitnessScore, unplaced: v.unplaced || [], created: v.createdAt, published: v.publishedAt, slots: slots.filter(s => s.versionId === v.id).map(toSlot) }));
}
export async function loadVersion(id) {
  const [v] = await loadVersions({ id: String(id) });
  if (!v) throw new HttpError(404, 'ไม่พบฉบับตารางนี้');
  return v;
}

export async function audit(actor, action, detail, db = prisma) {
  await db.auditLog.create({ data: { actor: String(actor).slice(0, 190), action, detail: String(detail).slice(0, 4000), ip: clientIp() } });
}
