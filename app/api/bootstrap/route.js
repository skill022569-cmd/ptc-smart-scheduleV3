import { prisma, getSession, loadMaster, loadVersions, json, fail } from '../../../lib/server.js';
export const dynamic = 'force-dynamic';

const mask = p => p ? `${p.slice(0, 2)}x-xxx-${p.slice(-4)}` : '';

// Everything the browser needs, cut down to what this role may see.
export async function GET() {
  try {
    const me = await getSession(), role = me && !me.mc ? me.role : null;
    const [D, versions, cr, adm] = await Promise.all([
      loadMaster(),
      loadVersions(role === 'ADMIN' ? {} : role === 'TEACHER' ? { status: { not: 'ARCHIVED' } } : { status: 'PUBLISHED' }),
      role ? prisma.changeRequest.findMany({ where: role === 'TEACHER' ? { requestedBy: me.pid } : {}, orderBy: { id: 'desc' }, take: 200 }) : [],
      role === 'ADMIN' ? Promise.all([
        prisma.issueReport.findMany({ orderBy: { id: 'desc' }, take: 300 }), prisma.dataSubjectRequest.findMany({ orderBy: { id: 'desc' }, take: 300 }),
        prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 300 }), prisma.student.findMany({ select: { studentCode: true, groupCode: true } })]) : null]);
    const teachers = Object.values(D.TCH).map(t => role === 'ADMIN' ? t : {
      ...t, phone: t.consent ? mask(t.phone) : '', exp: t.consent ? t.exp : '', edu: t.consent ? t.edu : '',
      unav: role ? t.unav : [], // reasons are internal
    });
    const out = {
      me: me ? { role: me.role, pid: me.pid || null, name: me.name, mustChange: !!me.mc } : null,
      depts: Object.values(D.DEPT), teachers, rooms: Object.values(D.RM), groups: Object.values(D.GRP), subjects: Object.values(D.SUB),
      assignments: D.ASG, locks: D.LOCKS, versions, cr: [], iss: [], dsr: [], aud: [], students: [],
    };
    if (role) {
      out.cr = cr.map(c => ({ id: c.id, vid: c.versionId, sid: c.slotId, by: c.requestedBy, from: { day: c.fromDay, start: c.fromStart }, to: { day: c.toDay, start: c.toStart }, note: c.note, status: c.status, err: c.error, at: c.createdAt }));
    }
    if (role === 'ADMIN') {
      const [iss, dsr, aud, st] = adm;
      out.iss = iss.map(x => ({ id: x.id, sid: x.relatedSlotId, desc: x.description, contact: x.contact, status: x.status, at: x.createdAt }));
      out.dsr = dsr.map(x => ({ id: x.id, name: x.requester, type: x.type, detail: x.detail, status: x.status, at: x.createdAt }));
      out.aud = aud.map(x => ({ at: x.createdAt, who: x.actor, action: x.action, detail: x.detail }));
      out.students = st.map(s => ({ code: s.studentCode, group: s.groupCode }));
    }
    return json(out);
  } catch (e) { return fail(e) }
}
