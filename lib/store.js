// Slot writes shared by API routes and the seed script (no Next.js imports here).
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }

/* ---------- writes: every slot change rewrites its occupancy rows in the same transaction ---------- */
function occRows(D, vid, s) {
  const a = D.A[s.aid], rows = [];
  for (let p = s.start; p < s.start + s.len; p++) {
    a.teachers.forEach(t => rows.push({ versionId: vid, dayOfWeek: s.day, periodNo: p, resourceType: 'TEACHER', resourceId: t, slotId: s.id }));
    a.groups.forEach(g => rows.push({ versionId: vid, dayOfWeek: s.day, periodNo: p, resourceType: 'GROUP', resourceId: g, slotId: s.id }));
    rows.push({ versionId: vid, dayOfWeek: s.day, periodNo: p, resourceType: 'ROOM', resourceId: s.room, slotId: s.id });
  }
  return rows;
}
const slotData = s => ({ dayOfWeek: s.day, startPeriod: s.start, length: s.len, roomCode: s.room, isLocked: !!s.locked, splitIndex: s.split });
// changed: slots with an `rv` they were read at (optimistic lock); created: brand-new slots.
export async function saveSlots(tx, D, vid, changed, created = []) {
  for (const s of changed) {
    const r = await tx.scheduleSlot.updateMany({ where: { id: s.id, versionId: vid, rowVersion: s.rv }, data: { ...slotData(s), rowVersion: { increment: 1 } } });
    if (!r.count) throw new HttpError(409, 'มีผู้อื่นแก้คาบนี้ก่อนแล้ว ระบบโหลดข้อมูลล่าสุดให้ กรุณาลองอีกครั้ง');
  }
  if (created.length) await tx.scheduleSlot.createMany({ data: created.map(s => ({ id: s.id, versionId: vid, assignmentId: s.aid, ...slotData(s) })) });
  const all = [...changed, ...created];
  await tx.slotOccupancy.deleteMany({ where: { slotId: { in: all.map(s => s.id) } } });
  await tx.slotOccupancy.createMany({ data: all.flatMap(s => occRows(D, vid, s)) });
}
export async function createVersion(tx, D, meta, slots) {
  await tx.scheduleVersion.create({ data: { id: meta.id, termId: D.term.id, name: meta.name, status: meta.status, source: meta.source, seed: meta.seed ?? null, fitnessScore: meta.fitness, unplaced: meta.unplaced || [], publishedAt: meta.publishedAt || null, createdBy: meta.createdBy || '', createdAt: meta.createdAt || undefined } });
  if (slots.length) {
    await tx.scheduleSlot.createMany({ data: slots.map(s => ({ id: s.id, versionId: meta.id, assignmentId: s.aid, ...slotData(s) })) });
    await tx.slotOccupancy.createMany({ data: slots.flatMap(s => occRows(D, meta.id, s)) });
  }
}
export async function replaceSlots(tx, D, vid, slots) {
  await tx.slotOccupancy.deleteMany({ where: { versionId: vid } });
  await tx.scheduleSlot.deleteMany({ where: { versionId: vid } });
  await tx.scheduleSlot.createMany({ data: slots.map(s => ({ id: s.id, versionId: vid, assignmentId: s.aid, ...slotData(s) })) });
  await tx.slotOccupancy.createMany({ data: slots.flatMap(s => occRows(D, vid, s)) });
}
