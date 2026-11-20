// Seeds the fictional demo college once. Safe to run on every deploy: it exits if a term already exists.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { makeCore, bare } from '../lib/core.js';
import { createVersion } from '../lib/store.js';

const prisma = new PrismaClient();

const DEPTS = [['AU', 'ช่างยนต์', 'Automotive'], ['EL', 'ช่างไฟฟ้ากำลัง', 'Electrical Power'], ['WE', 'ช่างเชื่อมโลหะ', 'Welding'], ['BC', 'คอมพิวเตอร์ธุรกิจ', 'Business Computer'], ['AC', 'การบัญชี', 'Accounting'], ['GE', 'สามัญสัมพันธ์', 'General Education']];
const TEACHERS = [
  ['t1', 'AU', 'นายสมชาย ใจดี', 'หัวหน้าแผนกวิชาช่างยนต์', 'เครื่องยนต์ดีเซล, ระบบฉีดเชื้อเพลิง', 'ค.อ.บ. วิศวกรรมเครื่องกล', '0812345671', 1],
  ['t2', 'AU', 'นายวิชัย ทองมา', 'ครู', 'งานส่งกำลัง, ช่วงล่างรถยนต์', 'ค.อ.บ. เทคโนโลยีเครื่องกล', '0898765432', 1],
  ['t3', 'AU', 'นายประเสริฐ ศรีสุข', 'ครูผู้ช่วย', 'ไฟฟ้ารถยนต์, ยานยนต์ไฟฟ้า', 'วศ.บ. วิศวกรรมยานยนต์', '0861122334', 0],
  ['t4', 'EL', 'นายอนุชา แก้วกล้า', 'หัวหน้าแผนกวิชาช่างไฟฟ้ากำลัง', 'ระบบควบคุมมอเตอร์, PLC', 'ค.อ.ม. วิศวกรรมไฟฟ้า', '0823344556', 1],
  ['t5', 'EL', 'นางสาวพิมพ์ชนก บุญมี', 'ครู', 'การติดตั้งไฟฟ้า, พลังงานแสงอาทิตย์', 'วศ.บ. วิศวกรรมไฟฟ้า', '0934455667', 1],
  ['t6', 'EL', 'นายธนากร พรหมวงศ์', 'ครูผู้ช่วย', 'เครื่องมือวัด, วงจรไฟฟ้า', 'ค.อ.บ. วิศวกรรมไฟฟ้า', '0845566778', 1],
  ['t7', 'WE', 'นายสุริยา คำแสง', 'หัวหน้าแผนกวิชาช่างเชื่อมโลหะ', 'เชื่อม TIG/MIG, งานโครงสร้างเหล็ก', 'ค.อ.บ. วิศวกรรมการผลิต', '0856677889', 1],
  ['t8', 'WE', 'นายบุญเลิศ มีทรัพย์', 'ครู', 'งานโลหะแผ่น, เชื่อมแก๊ส', 'ปทส. เทคนิคการเชื่อม', '0817788990', 1],
  ['t9', 'BC', 'นางสาวกนกวรรณ ศรีวงศ์', 'หัวหน้าแผนกวิชาคอมพิวเตอร์ธุรกิจ', 'พัฒนาเว็บ, ฐานข้อมูล', 'วท.ม. เทคโนโลยีสารสนเทศ', '0928899001', 1],
  ['t10', 'BC', 'นายณัฐพล อินทร์แก้ว', 'ครู', 'ระบบเครือข่าย, ฮาร์ดแวร์', 'วท.บ. วิทยาการคอมพิวเตอร์', '0809900112', 1],
  ['t11', 'BC', 'นางวิไลวรรณ จันทร์หอม', 'ครู', 'กราฟิก, มัลติมีเดีย', 'ศศ.บ. คอมพิวเตอร์ธุรกิจ', '0871011121', 1],
  ['t12', 'AC', 'นางสุดารัตน์ พูลผล', 'หัวหน้าแผนกวิชาการบัญชี', 'บัญชีต้นทุน, ภาษีอากร', 'บช.ม. การบัญชี', '0882122232', 1],
  ['t13', 'AC', 'นางสาวอรุณี แสงทอง', 'ครู', 'โปรแกรมสำเร็จรูปทางการบัญชี', 'บช.บ. การบัญชี', '0833233343', 0],
  ['t14', 'AC', 'นางมาลัย ทองคำ', 'ครู', 'การขาย, การบัญชีห้างหุ้นส่วน', 'บธ.บ. การตลาด', '0894344454', 1],
  ['t15', 'GE', 'นางสาวปิยะนุช วงศ์ไทย', 'ครู (ภาษาไทย)', 'ภาษาไทยเพื่อการสื่อสาร', 'ศศ.บ. ภาษาไทย', '0815455565', 1],
  ['t16', 'GE', 'นายวิชัย สายบุญ', 'ครู (ภาษาอังกฤษ)', 'ภาษาอังกฤษเพื่อการสื่อสาร', 'ศศ.บ. ภาษาอังกฤษ', '0826566676', 1],
  ['t17', 'GE', 'นางรัตนา ดวงดี', 'หัวหน้าแผนกวิชาสามัญสัมพันธ์', 'คณิตศาสตร์', 'วท.บ. คณิตศาสตร์', '0837677787', 1],
  ['t18', 'GE', 'นายเกียรติศักดิ์ ภูผา', 'ครู (วิทยาศาสตร์)', 'ฟิสิกส์', 'วท.บ. ฟิสิกส์', '0848788898', 0],
  ['t19', 'GE', 'นางสาวจันทร์เพ็ญ ศรีโพธิ์', 'ครู (สังคมศึกษา)', 'สังคมศึกษา', 'ศศ.บ. สังคมศึกษา', '0859899909', 1],
  ['t20', 'GE', 'นายอดิศร มั่นคง', 'ครู (พลศึกษา)', 'พลศึกษา', 'ค.บ. พลศึกษา', '0860910010', 1],
  ['t21', 'GE', 'นางสาวสุนิสา คำดี', 'ครู (ภาษาอังกฤษ)', 'ภาษาอังกฤษเพื่องานอาชีพ', 'ศศ.บ. ภาษาอังกฤษธุรกิจ', '0871020304', 1],
  ['t22', 'GE', 'นายพงศกร ศรีทอง', 'ครูผู้ช่วย (คณิตศาสตร์)', 'คณิตศาสตร์ประยุกต์', 'ค.บ. คณิตศาสตร์', '0882030405', 0]];
const T_UNAV = [['t4', 2, [5, 6, 7], 'ประชุมหัวหน้าแผนก'], ['t17', 2, [5, 6, 7], 'ประชุมหัวหน้าแผนก'], ['t12', 5, [1, 2], 'งานการเงินวิทยาลัย']];
const ROOMS = [
  ...['A-201', 'A-202', 'A-203', 'A-204'].map(r => [r, 'ห้องเรียน ' + r, 'อาคาร 1', 40, 'CLASS']),
  ...['B-101', 'B-102', 'B-103', 'B-104'].map(r => [r, 'ห้องเรียน ' + r, 'อาคาร 2', 40, 'CLASS']),
  ...[1, 2, 3].map(i => ['C-30' + i, 'ห้องปฏิบัติการคอมพิวเตอร์ ' + i, 'อาคาร 3', 36, 'LAB']),
  ...[1, 2].map(i => ['W1-0' + i, 'โรงฝึกงานยานยนต์ ' + i, 'อาคารโรงฝึกงาน 1', 40, 'WS_AU']),
  ...[1, 2].map(i => ['W2-0' + i, 'โรงฝึกงานไฟฟ้า ' + i, 'อาคารโรงฝึกงาน 2', 40, 'WS_EL']),
  ['W3-01', 'โรงฝึกงานเชื่อมโลหะ', 'อาคารโรงฝึกงาน 3', 36, 'WS_WE']];
const GROUPS = [['AU', 'ปวช.', 1], ['AU', 'ปวช.', 2], ['AU', 'ปวส.', 1], ['EL', 'ปวช.', 1], ['EL', 'ปวช.', 2], ['EL', 'ปวส.', 1], ['WE', 'ปวช.', 1], ['WE', 'ปวช.', 2], ['BC', 'ปวช.', 1], ['BC', 'ปวช.', 2], ['BC', 'ปวส.', 1], ['AC', 'ปวช.', 1], ['AC', 'ปวช.', 2], ['AC', 'ปวส.', 1]];
const SIZES = [34, 31, 26, 35, 30, 24, 28, 25, 36, 33, 27, 32, 29, 23];
const GEN = {
  11: [['20000-1101', 'ภาษาไทยพื้นฐาน', 't15'], ['20000-1201', 'ภาษาอังกฤษในชีวิตจริง', 't16'], ['20000-1401', 'คณิตศาสตร์พื้นฐานอาชีพ', 't17'], ['20000-1601', 'ทักษะชีวิตและสุขภาพ', 't20']],
  12: [['20000-1301', 'วิทยาศาสตร์เพื่อพัฒนาทักษะชีวิต', 't18'], ['20000-1501', 'หน้าที่พลเมืองและศีลธรรม', 't19'], ['20000-1202', 'ภาษาอังกฤษสื่อสารในชีวิตประจำวัน', 't21'], ['20000-1402', 'คณิตศาสตร์งานอาชีพ', 't22']],
  21: [['30000-1101', 'ภาษาไทยเพื่อการสื่อสารในงานอาชีพ', 't15'], ['30000-1301', 'วิทยาศาสตร์เพื่องานอาชีพ', 't18'], ['30000-1501', 'ชีวิตกับสังคมไทย', 't19'], ['30000-1601', 'การพัฒนาสุขภาพและบุคลิกภาพ', 't20']]};
const VOC = {
  AU: { 11: [['20101-2001', 'งานเครื่องยนต์เล็ก', 'WS_AU'], ['20101-2002', 'งานจักรยานยนต์', 'WS_AU'], ['20100-1001', 'เขียนแบบเทคนิคเบื้องต้น', 'CLASS']], 12: [['20101-2104', 'งานเครื่องยนต์ดีเซล', 'WS_AU'], ['20101-2105', 'งานส่งกำลังรถยนต์', 'WS_AU'], ['20101-2106', 'งานไฟฟ้ารถยนต์', 'WS_AU']], 21: [['30101-2001', 'เทคโนโลยียานยนต์ไฟฟ้า', 'WS_AU'], ['30101-2002', 'งานปรับอากาศรถยนต์', 'WS_AU'], ['30100-0101', 'กลศาสตร์วิศวกรรม', 'CLASS']] },
  EL: { 11: [['20104-2001', 'เครื่องมือวัดไฟฟ้า', 'WS_EL'], ['20104-2002', 'วงจรไฟฟ้ากระแสตรง', 'WS_EL'], ['20104-2003', 'การติดตั้งไฟฟ้าในอาคาร', 'WS_EL']], 12: [['20104-2104', 'เครื่องกลไฟฟ้ากระแสสลับ', 'WS_EL'], ['20104-2105', 'การควบคุมมอเตอร์ไฟฟ้า', 'WS_EL'], ['20104-2106', 'การติดตั้งไฟฟ้านอกอาคาร', 'WS_EL']], 21: [['30104-2001', 'การออกแบบระบบไฟฟ้า', 'CLASS'], ['30104-2002', 'โปรแกรมเมเบิลคอนโทรลเลอร์', 'WS_EL'], ['30104-2003', 'การประมาณการติดตั้งไฟฟ้า', 'CLASS']] },
  WE: { 11: [['20103-2001', 'งานเชื่อมแก๊ส', 'WS_WE'], ['20103-2002', 'งานเชื่อมไฟฟ้า', 'WS_WE'], ['20100-1002', 'วัสดุช่างอุตสาหกรรม', 'CLASS']], 12: [['20103-2104', 'งานเชื่อม MIG/MAG', 'WS_WE'], ['20103-2105', 'งานเชื่อม TIG', 'WS_WE'], ['20103-2106', 'งานโลหะแผ่น', 'WS_WE']] },
  BC: { 11: [['20204-2001', 'คอมพิวเตอร์และการบำรุงรักษา', 'LAB'], ['20204-2002', 'ระบบปฏิบัติการเบื้องต้น', 'LAB'], ['20204-2003', 'โปรแกรมตารางงาน', 'LAB']], 12: [['20204-2104', 'การเขียนโปรแกรมเว็บ', 'LAB'], ['20204-2105', 'กราฟิกและมัลติมีเดีย', 'LAB'], ['20204-2106', 'ฐานข้อมูลเบื้องต้น', 'LAB']], 21: [['30204-2001', 'การพัฒนาเว็บไซต์ด้วย CMS', 'LAB'], ['30204-2002', 'การวิเคราะห์และออกแบบระบบ', 'CLASS'], ['30204-2003', 'ระบบเครือข่ายคอมพิวเตอร์', 'LAB']] },
  AC: { 11: [['20201-2001', 'การบัญชีเบื้องต้น 1', 'CLASS'], ['20200-1002', 'การขายเบื้องต้น', 'CLASS'], ['20201-2003', 'โปรแกรมสำเร็จรูปทางการบัญชี', 'LAB']], 12: [['20201-2104', 'การบัญชีห้างหุ้นส่วน', 'CLASS'], ['20201-2105', 'การบัญชีต้นทุน', 'CLASS'], ['20201-2106', 'การบัญชีภาษีอากร', 'CLASS']], 21: [['30201-2001', 'การบัญชีชั้นกลาง 1', 'CLASS'], ['30201-2002', 'การบัญชีต้นทุน 2', 'CLASS'], ['30201-2003', 'ระบบสารสนเทศทางการบัญชี', 'LAB']] }};
const LOCKS = [['HR', 'โฮมรูม / พบครูที่ปรึกษา', 'Homeroom', 1, 1, 1, 'ALL'], ['VSO', 'กิจกรรมองค์การวิชาชีพ (อวช.)', 'Vocational organisation activity', 3, 6, 2, 'ALL'], ['SCOUT', 'ลูกเสือวิสามัญ / รด.', 'Scouts / Territorial Defence', 4, 6, 2, 'CERT_Y1']];
const FN = ['ธนวัฒน์', 'ศุภชัย', 'กิตติพงษ์', 'อนันดา', 'พรรณิภา', 'สุภาวดี', 'ชยพล', 'ปวีณา', 'ณัฐวุฒิ', 'กมลชนก', 'วีรภัทร', 'ธิดารัตน์'], LN = ['ศรีสุข', 'บุญมา', 'แก้วมณี', 'ทองดี', 'พลศักดิ์', 'จันทร์แก้ว', 'สมบูรณ์', 'ภูมิสุข'];

const EXECS = [
  ['x1', 'EX-001', 'นายวิทยา ศรีประเสริฐ', 'ผู้อำนวยการวิทยาลัยการอาชีพโพนทอง', 'การบริหารสถานศึกษา, ความร่วมมือกับสถานประกอบการ', 'ค.ด. การบริหารการศึกษา', '0810001001'],
  ['x2', 'EX-002', 'นางสาวนงลักษณ์ ทองสุข', 'รองผู้อำนวยการฝ่ายวิชาการ', 'หลักสูตรอาชีวศึกษา, การจัดตารางสอน', 'กศ.ม. การบริหารการศึกษา', '0810001002'],
  ['x3', 'EX-003', 'นายสมศักดิ์ พรมมา', 'รองผู้อำนวยการฝ่ายบริหารทรัพยากร', 'งบประมาณ, พัสดุ, บุคลากร', 'บธ.ม. การจัดการ', '0810001003'],
  ['x4', 'EX-004', 'นางพรทิพย์ แสงอรุณ', 'รองผู้อำนวยการฝ่ายแผนงานและความร่วมมือ', 'แผนพัฒนาสถานศึกษา, ระบบทวิภาคี', 'ศษ.ม. การบริหารการศึกษา', '0810001004'],
  ['x5', 'EX-005', 'นายชัยวัฒน์ บุญเรือง', 'รองผู้อำนวยการฝ่ายพัฒนากิจการนักเรียนนักศึกษา', 'กิจกรรมนักเรียน, องค์การวิชาชีพ (อวช.)', 'ค.ม. การบริหารการศึกษา', '0810001005']];

// Idempotent: also runs on databases seeded before executives existed.
async function ensureExecutives() {
  await prisma.department.createMany({ skipDuplicates: true, data: [{ code: 'EXE', nameTh: 'ผู้บริหาร', nameEn: 'Executives' }] });
  const pw = process.env.INITIAL_PASSWORD, hash = pw && pw.length >= 8 ? await bcrypt.hash(pw, 10) : null;
  // skipDuplicates: two deployments building at once must not fail on the same rows
  const added = (await prisma.personnel.createMany({ skipDuplicates: true, data: EXECS.map(([id, emp, name, pos, exp, edu, phone]) => ({ id, empCode: emp, fullName: name, position: pos, departmentCode: 'EXE', expertise: exp, education: edu, phone, isPublicProfile: true, maxHoursPerWeek: 0 })) })).count;
  const ps = await prisma.personnel.findMany({ where: { empCode: { in: EXECS.map(x => x[1]) } } });
  if (hash) await prisma.user.createMany({ skipDuplicates: true, data: ps.map(p => ({ username: p.empCode, passwordHash: hash, role: 'EXEC', personnelId: p.id })) });
  else console.warn('seed: INITIAL_PASSWORD not set, executive logins not created');
  if (added) console.log(`seed: added ${added} executives`);
}

async function main() {
  if (!await prisma.academicTerm.count()) await seedAll(); else console.log('seed: demo data already present');
  await ensureExecutives();
}

async function seedAll() {
  const pw = process.env.INITIAL_PASSWORD;
  if (!pw || pw.length < 8) throw new Error('Set INITIAL_PASSWORD (8+ characters) before the first deploy; every account must change it at first sign-in.');

  // Build the in-memory model first, then solve, then write everything in one go.
  const D = { DEPT: {}, TCH: {}, RM: {}, GRP: {}, SUB: {}, A: {}, ASG: [], LOCKS: [] };
  DEPTS.forEach(([code, th, en]) => D.DEPT[code] = { code, th, en });
  TEACHERS.forEach(([id, dept, name, pos, exp, edu, phone, consent], i) => D.TCH[id] = { id, emp: 'PT-' + String(i + 1).padStart(3, '0'), dept, name, pos, exp, edu, phone, consent: !!consent, max: dept === 'GE' ? 22 : 20, maxDay: 6, maxConsec: 4, unav: [], short: 'ครู' + bare(name).split(' ')[0] });
  T_UNAV.forEach(([t, d, ps, r]) => ps.forEach(p => D.TCH[t].unav.push({ day: d, p, reason: r })));
  ROOMS.forEach(([id, name, bld, cap, type]) => D.RM[id] = { id, name, bld, cap, type, unav: [] });
  [1, 2, 3, 4].forEach(p => D.RM['C-303'].unav.push({ day: 3, p, reason: 'สอบมาตรฐานวิชาชีพ' }));
  GROUPS.forEach(([d, lv, y], i) => { const id = `${d}-${(lv === 'ปวช.' ? 10 : 20) + y}`; D.GRP[id] = { id, dept: d, level: lv, year: y, key: (lv === 'ปวช.' ? 10 : 20) + y, size: SIZES[i], name: `${lv}${y} ${D.DEPT[d].th}`, en: `${lv === 'ปวช.' ? 'Cert.' : 'Dipl.'} Y${y} ${D.DEPT[d].en}` } });
  let an = 0;
  const addSub = (code, name, periods, room, dept) => D.SUB[code] = D.SUB[code] || { code, name, periods, room, dept, consec: room !== 'CLASS', cred: periods === 2 ? '2-0-2' : room === 'CLASS' ? '2-2-3' : '1-3-2' };
  const pushA = (subj, teachers, groups, pattern) => { const a = { id: 'a' + (++an), subj, teachers, groups, pattern, periods: pattern.reduce((x, y) => x + y, 0) }; D.ASG.push(a); D.A[a.id] = a };
  Object.values(D.GRP).forEach(g => {
    GEN[g.key].forEach(([c, n, t]) => { addSub(c, n, 2, 'CLASS', 'GE'); pushA(c, [t], [g.id], [2]) });
    const tl = Object.values(D.TCH).filter(t => t.dept === g.dept), di = Object.values(D.GRP).filter(x => x.dept === g.dept).indexOf(g);
    VOC[g.dept][g.key].forEach(([c, n, r], si) => { const s = addSub(c, n, 4, r, g.dept); pushA(c, [tl[(di + si) % tl.length].id], [g.id], s.consec ? [4] : [2, 2]) });
    g.advisor = tl[di % tl.length].id;
  });
  D.LOCKS = LOCKS.map(([id, th, en, day, from, len, applies]) => ({ id, th, en, day, from, len, applies, on: true }));
  const core = makeCore(D);
  const r = core.solve(7, [], randomUUID);
  if (core.conflicts(r.slots)) throw new Error('seed solver produced clashes');

  const term = await prisma.academicTerm.create({ data: { academicYear: 2569, term: 2, startDate: new Date('2026-11-02'), endDate: new Date('2027-03-12'), isCurrent: true } });
  D.term = term;
  await prisma.department.createMany({ data: DEPTS.map(([code, nameTh, nameEn]) => ({ code, nameTh, nameEn })) });
  await prisma.personnel.createMany({ data: Object.values(D.TCH).map(t => ({ id: t.id, empCode: t.emp, fullName: t.name, position: t.pos, departmentCode: t.dept, expertise: t.exp, education: t.edu, phone: t.phone, isPublicProfile: t.consent, maxHoursPerWeek: t.max })) });
  await prisma.teacherUnavailability.createMany({ data: Object.values(D.TCH).flatMap(t => t.unav.map(u => ({ personnelId: t.id, termId: term.id, dayOfWeek: u.day, periodNo: u.p, reason: u.reason }))) });
  await prisma.room.createMany({ data: Object.values(D.RM).map(x => ({ code: x.id, name: x.name, building: x.bld, capacity: x.cap, roomType: x.type })) });
  await prisma.roomUnavailability.createMany({ data: D.RM['C-303'].unav.map(u => ({ roomCode: 'C-303', termId: term.id, dayOfWeek: u.day, periodNo: u.p, reason: u.reason })) });
  await prisma.studentGroup.createMany({ data: Object.values(D.GRP).map(g => ({ code: g.id, departmentCode: g.dept, level: g.level, yearNo: g.year, studentCount: g.size, advisorId: g.advisor, nameTh: g.name, nameEn: g.en })) });
  await prisma.subject.createMany({ data: Object.values(D.SUB).map(s => ({ code: s.code, name: s.name, credits: s.cred, periodsPerWeek: s.periods, requiredRoomType: s.room, preferConsecutive: s.consec, departmentCode: s.dept })) });
  await prisma.teachingAssignment.createMany({ data: D.ASG.map(a => ({ id: a.id, termId: term.id, subjectCode: a.subj, requiredPeriods: a.periods, blockPattern: a.pattern })) });
  await prisma.assignmentTeacher.createMany({ data: D.ASG.flatMap(a => a.teachers.map(personnelId => ({ assignmentId: a.id, personnelId }))) });
  await prisma.assignmentGroup.createMany({ data: D.ASG.flatMap(a => a.groups.map(groupCode => ({ assignmentId: a.id, groupCode }))) });
  await prisma.lockedActivity.createMany({ data: D.LOCKS.map(l => ({ id: l.id, termId: term.id, nameTh: l.th, nameEn: l.en, dayOfWeek: l.day, fromPeriod: l.from, length: l.len, appliesTo: l.applies, isActive: true })) });
  await prisma.student.createMany({ data: Object.values(D.GRP).flatMap((g, gi) => [1, 2, 3].map(k => ({ studentCode: `${g.key === 12 ? 68 : 69}${String(gi + 1).padStart(3, '0')}${String(k).padStart(2, '0')}`, fullName: FN[(gi * 3 + k) % FN.length] + ' ' + LN[(gi + k) % LN.length], groupCode: g.id }))) });

  const v1 = 'v-' + randomUUID().slice(0, 8), v2 = 'v-' + randomUUID().slice(0, 8);
  const draft = r.slots.map(s => ({ ...s, id: randomUUID() }));
  await prisma.$transaction(async tx => {
    await createVersion(tx, D, { id: v1, name: 'ตารางเรียนภาคเรียนที่ 2/2569 (ฉบับประกาศ)', status: 'PUBLISHED', source: 'SOLVER', seed: 7, fitness: core.fitness(r.slots), unplaced: r.unplaced, publishedAt: new Date('2026-10-27T02:00:00Z'), createdBy: 'admin', createdAt: new Date('2026-10-24T07:10:00Z') }, r.slots);
    await createVersion(tx, D, { id: v2, name: 'ฉบับร่าง — ปรับคาบปฏิบัติแผนกช่างยนต์', status: 'DRAFT', source: 'CLONE', seed: 7, fitness: core.fitness(draft), unplaced: [], createdBy: 'admin' }, draft);
  }, { timeout: 60000 });

  const hash = await bcrypt.hash(pw, 10);
  await prisma.user.create({ data: { username: 'admin', passwordHash: hash, role: 'ADMIN' } });
  await prisma.user.createMany({ data: Object.values(D.TCH).map(t => ({ username: t.emp, passwordHash: hash, role: 'TEACHER', personnelId: t.id })) });

  const s2 = r.slots.find(s => s.room === 'A-203');
  await prisma.issueReport.createMany({ data: [{ relatedSlotId: s2 ? s2.id : null, description: 'โปรเจกเตอร์ห้อง A-203 เปิดไม่ติด สอนวิชานี้ไม่ได้', status: 'OPEN' }, { description: 'ตารางกลุ่ม ปวช.2 การบัญชี ในเว็บกับที่ประกาศหน้าอาคารไม่ตรงกัน', contact: 'ตัวแทนห้อง', status: 'IN_PROGRESS' }] });
  await prisma.auditLog.create({ data: { actor: 'seed', action: 'SEED', detail: `term 2/2569, ${r.slots.length} slots, versions ${v1} (published), ${v2} (draft)` } });
  console.log(`seed: done — ${D.ASG.length} assignments, ${r.slots.length} slots, ${r.unplaced.length} unplaced, fitness ${core.fitness(r.slots)}`);
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) });
