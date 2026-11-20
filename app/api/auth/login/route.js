import bcrypt from 'bcryptjs';
import { prisma, setSession, audit, rateLimit, json, fail, HttpError } from '../../../../lib/server.js';

export async function POST(req) {
  try {
    rateLimit('login', 20, 15 * 60e3);
    const b = await req.json().catch(() => ({}));
    const username = String(b.username || '').trim().slice(0, 64), password = String(b.password || '').slice(0, 200);
    if (!username || !password) throw new HttpError(400, 'กรอกชื่อผู้ใช้และรหัสผ่าน');
    const u = await prisma.user.findFirst({ where: { username: { equals: username } } });
    if (u && u.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(423, `บัญชีถูกล็อกชั่วคราว ลองใหม่หลัง ${u.lockedUntil.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} น.`);
    const ok = u && u.isActive && await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
      if (u) {
        const n = u.failedLogins + 1;
        await prisma.user.update({ where: { id: u.id }, data: n >= 5 ? { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60e3) } : { failedLogins: n } });
      }
      await audit(username, 'LOGIN_FAILED', '');
      throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    let name = 'ผู้ดูแลระบบ';
    if (u.personnelId) { const p = await prisma.personnel.findUnique({ where: { id: u.personnelId } }); name = p ? p.fullName : u.username }
    await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await setSession({ uid: u.id, role: u.role, pid: u.personnelId, name, mc: u.mustChangePassword });
    await audit(name, 'LOGIN', u.role);
    return json({ ok: true, mustChange: u.mustChangePassword });
  } catch (e) { return fail(e) }
}
