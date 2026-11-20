import bcrypt from 'bcryptjs';
import { prisma, getSession, setSession, audit, json, fail, HttpError } from '../../../../lib/server.js';

export async function POST(req) {
  try {
    const me = await getSession();
    if (!me) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
    if (me.imp) throw new HttpError(403, 'โหมดดูในมุมของผู้ใช้อื่นเปลี่ยนรหัสผ่านไม่ได้');
    const b = await req.json().catch(() => ({}));
    const cur = String(b.current || ''), next = String(b.next || '');
    if (next.length < 8 || next.length > 200) throw new HttpError(400, 'รหัสผ่านใหม่ต้องยาว 8 ตัวอักษรขึ้นไป');
    if (next === cur) throw new HttpError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    const u = await prisma.user.findUnique({ where: { id: me.uid } });
    if (!u || !await bcrypt.compare(cur, u.passwordHash)) throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false } });
    await setSession({ ...me, mc: false, iat: undefined, exp: undefined });
    await audit(me.name, 'PASSWORD_CHANGED', '');
    return json({ ok: true });
  } catch (e) { return fail(e) }
}
