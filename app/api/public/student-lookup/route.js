import { prisma, rateLimit, json, fail, HttpError } from '../../../../lib/server.js';

// Student ID plus group code; never search by name. Returns only a shortened name.
export async function POST(req) {
  try {
    rateLimit('lookup', 10, 15 * 60e3);
    const b = await req.json().catch(() => ({}));
    const code = String(b.code || '').trim().slice(0, 16), grp = String(b.grp || '').trim().toUpperCase().slice(0, 16);
    const st = code && grp ? await prisma.student.findUnique({ where: { studentCode: code } }) : null;
    if (!st || st.groupCode !== grp) throw new HttpError(404, 'ไม่พบข้อมูลที่ตรงกัน ตรวจรหัสนักศึกษาและรหัสกลุ่มเรียนอีกครั้ง');
    const [first, last = ''] = st.fullName.split(' ');
    return json({ code: st.studentCode, name: `${first} ${last.slice(0, 1)}.`, group: st.groupCode });
  } catch (e) { return fail(e) }
}
