import { prisma, getSession, setSession, audit, json, fail, HttpError } from '../../../../lib/server.js';

// Admin "view as": a read-only session for another account (writes are refused while `imp` is set).
export async function POST(req) {
  try {
    const me = await getSession(), b = await req.json().catch(() => ({}));
    if (b.stop) {
      if (!me || !me.imp) throw new HttpError(400, 'ไม่ได้อยู่ในโหมดดูในมุมของผู้ใช้อื่น');
      const u = await prisma.user.findUnique({ where: { id: me.imp.uid } });
      if (!u || !u.isActive || u.role !== 'ADMIN') throw new HttpError(403, 'บัญชีผู้ดูแลระบบใช้งานไม่ได้');
      await setSession({ uid: u.id, role: 'ADMIN', pid: null, name: me.imp.name, mc: false });
      await audit(me.imp.name, 'VIEW_AS_END', me.name);
      return json({ ok: true });
    }
    if (!me || me.mc || me.imp || me.role !== 'ADMIN') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบ');
    const imp = { uid: me.uid, name: me.name };
    if (b.username === '__public__') {
      await setSession({ role: 'PUBLIC', pid: null, name: 'บุคคลทั่วไป', mc: false, imp });
      await audit(me.name, 'VIEW_AS', 'บุคคลทั่วไป');
      return json({ ok: true });
    }
    const u = await prisma.user.findUnique({ where: { username: String(b.username || '').slice(0, 64) } });
    if (!u || !u.isActive || u.role === 'ADMIN') throw new HttpError(404, 'ไม่พบบัญชีนี้');
    const p = u.personnelId ? await prisma.personnel.findUnique({ where: { id: u.personnelId } }) : null;
    const name = p ? p.fullName : u.username;
    await setSession({ uid: u.id, role: u.role, pid: u.personnelId, name, mc: false, imp });
    await audit(me.name, 'VIEW_AS', `${u.username} ${name}`);
    return json({ ok: true });
  } catch (e) { return fail(e) }
}
