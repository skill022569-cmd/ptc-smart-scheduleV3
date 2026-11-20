import Anthropic from '@anthropic-ai/sdk';
import { loadMaster, loadVersions, coreFor, rateLimit, audit, json, fail, HttpError } from '../../../lib/server.js';
import { PER, RT, pp } from '../../../lib/core.js';

// Timetable Q&A with Claude over the PUBLISHED timetable only (read-only tools, no student data).
// Token economy: rules in the browser answer the easy questions first; here no thinking, effort "low",
// a cached system prompt (tools + compact directory), terse tool results, short answers, at most 4 calls.
export const maxDuration = 30;
const MODEL = 'claude-sonnet-4-6';
const MAX_CALLS = 4;
const D3 = ['', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.'], DAY = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
const hhmm = (s, len) => `${PER[s].s}-${PER[s + len - 1].e}`;

const TOOLS = [
  {
    name: 'schedule',
    description: 'ตารางฉบับเผยแพร่ของครู กลุ่มเรียน หรือห้อง คืนหนึ่งบรรทัดต่อคาบ',
    input_schema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['teacher', 'group', 'room'] },
      id: { type: 'string', description: 'id จากรายชื่อใน system' },
      day: { type: 'integer', minimum: 1, maximum: 5, description: '1=จันทร์..5=ศุกร์ ไม่ใส่=ทั้งสัปดาห์' } }, required: ['kind', 'id'] },
  },
  {
    name: 'free_rooms',
    description: 'ห้องที่ว่างในวันและคาบที่ระบุ',
    input_schema: { type: 'object', properties: {
      day: { type: 'integer', minimum: 1, maximum: 5 }, period: { type: 'integer', minimum: 1, maximum: 9 },
      type: { type: 'string', enum: Object.keys(RT) } }, required: ['day', 'period'] },
  },
  {
    name: 'subject',
    description: 'ข้อมูลวิชา: หน่วยกิต ท-ป-น คาบต่อสัปดาห์ และครู/กลุ่มที่เรียน',
    input_schema: { type: 'object', properties: { code: { type: 'string', description: 'รหัสวิชา เช่น 20000-1101' } }, required: ['code'] },
  },
];

// Stable for a given master-data state (sorted, no dates), so it stays in the prompt cache.
function systemPrompt(D) {
  const by = (o, f) => Object.values(o).sort((a, b) => a.id < b.id ? -1 : 1).map(f).join(', ');
  return `คุณตอบคำถามตารางเรียน-ตารางสอน วิทยาลัยการอาชีพโพนทอง ภาคเรียนที่ 2/2569 จากตารางฉบับเผยแพร่
กติกา: ใช้เฉพาะผลจากเครื่องมือ ห้ามเดา ถ้าไม่พบให้บอกว่าไม่พบ | ชื่อซ้ำหรือกำกวมให้ถามกลับพร้อมตัวเลือก | ไม่มีข้อมูลนักเรียนรายบุคคล | ไม่ตอบเรื่องอื่นนอกจากตาราง | ตอบภาษาเดียวกับคำถาม สั้น เป็นรายการ ไม่เกิน 8 บรรทัด ไม่ต้องเกริ่น
คาบ: 1 08-09, 2 09-10, 3 10-11, 4 11-12, พักเที่ยง 12-13, 5 13-14, 6 14-15, 7 15-16, 8-9 นอกเวลา 16-18 | วัน 1=จันทร์..5=ศุกร์
ครู: ${by(D.TCH, t => `${t.id}=${t.name.replace(/^(นางสาว|นาย|นาง)/, '')}(${t.dept})`)}
กลุ่ม: ${by(D.GRP, g => `${g.id}=${g.name}`)}
ห้อง: ${by(D.RM, r => `${r.id}(${r.type})`)}`;
}

function runTool(name, input, D, v, core) {
  const A = D.A, line = s => {
    const a = A[s.aid], sb = D.SUB[a.subj];
    return `${D3[s.day]} ${pp(s.start, s.len)} ${hhmm(s.start, s.len)} ${sb.code} ${sb.name} | ${a.groups.map(g => D.GRP[g].name).join(',')} | ${a.teachers.map(t => D.TCH[t].short).join(',')} | ${s.room}`;
  };
  if (name === 'schedule') {
    const { kind, id } = input, day = Number.isInteger(input.day) ? input.day : null;
    const ok = kind === 'teacher' ? D.TCH[id] : kind === 'group' ? D.GRP[id] : kind === 'room' ? D.RM[id] : null;
    if (!ok) return `ไม่พบ ${kind} id=${id}`;
    const ss = v.slots.filter(s => (kind === 'teacher' ? A[s.aid].teachers.includes(id) : kind === 'group' ? A[s.aid].groups.includes(id) : s.room === id) && (!day || s.day === day))
      .sort((a, b) => a.day - b.day || a.start - b.start);
    const locks = kind === 'group' ? D.LOCKS.filter(l => l.on && (!day || l.day === day) && core.who(l, D.GRP[id])).map(l => `${D3[l.day]} ${pp(l.from, l.len)} ${l.th} (คาบล็อก)`) : [];
    const total = kind === 'teacher' ? `\nรวมทั้งสัปดาห์ ${v.slots.filter(s => A[s.aid].teachers.includes(id)).reduce((n, s) => n + s.len, 0)} คาบ` : '';
    return (ss.length || locks.length ? [...ss.map(line), ...locks].join('\n') : 'ไม่มีคาบ') + total;
  }
  if (name === 'free_rooms') {
    const { day, period, type } = input;
    if (!(day >= 1 && day <= 5 && period >= 1 && period <= 9)) return 'วันหรือคาบไม่ถูกต้อง';
    const m = core.idx(v.slots);
    const free = Object.values(D.RM).filter(r => (!type || r.type === type) && !m.has(core.key('R', r.id, day, period)) && !r.unav.some(u => u.day === day && u.p === period));
    return free.length ? `ว่าง ${DAY[day]} คาบ ${period}: ${free.map(r => `${r.id}(${r.type},${r.cap}ที่)`).join(', ')}` : 'ไม่มีห้องว่าง';
  }
  if (name === 'subject') {
    const sb = D.SUB[String(input.code || '').trim()];
    if (!sb) return `ไม่พบวิชา ${input.code}`;
    const rows = D.ASG.filter(a => a.subj === sb.code).map(a => `- ${a.groups.map(g => D.GRP[g].name).join(',')}: ${a.teachers.map(t => D.TCH[t].name).join(',')} (${a.periods} คาบ)`);
    return `${sb.code} ${sb.name} ท-ป-น ${sb.cred}\n${rows.join('\n') || 'ไม่มีกลุ่มที่เรียนภาคนี้'}`;
  }
  return `ไม่รู้จักเครื่องมือ ${name}`;
}

export async function POST(req) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY');
    rateLimit('ai', 20, 60 * 60e3);
    const b = await req.json().catch(() => ({}));
    const q = String(b.q || '').trim().slice(0, 200);
    if (!q) throw new HttpError(400, 'กรุณาพิมพ์คำถาม');
    // Up to the last 2 exchanges, text only and trimmed, so follow-ups like "แล้ววันศุกร์ล่ะ" work cheaply.
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-4)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 400) }));
    if (hist.length && hist[0].role !== 'user') hist.shift();

    const [D, [v]] = await Promise.all([loadMaster(), loadVersions({ status: 'PUBLISHED' })]);
    if (!v) throw new HttpError(404, 'ยังไม่มีตารางฉบับเผยแพร่');
    const core = coreFor(D);
    const now = new Date(), dow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getDay();
    const today = `วันนี้ ${['อาทิตย์', ...DAY.slice(1), 'เสาร์'][dow]} (${dow === 0 || dow === 6 ? 'วันหยุด' : dow}) ${now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' })}`;

    const client = new Anthropic();
    const system = [{ type: 'text', text: systemPrompt(D), cache_control: { type: 'ephemeral' } }];
    const messages = [...hist, { role: 'user', content: `${today}\nคำถาม: ${q}` }];
    const used = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, calls = [];
    let answer = null;

    for (let i = 0; i < MAX_CALLS && answer === null; i++) {
      const r = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages, output_config: { effort: 'low' } });
      used.input += r.usage.input_tokens; used.output += r.usage.output_tokens;
      used.cacheRead += r.usage.cache_read_input_tokens || 0; used.cacheWrite += r.usage.cache_creation_input_tokens || 0;
      if (r.stop_reason === 'refusal') { answer = 'ขออภัย ตอบคำถามนี้ไม่ได้'; break }
      const uses = r.content.filter(c => c.type === 'tool_use');
      if (r.stop_reason === 'tool_use' && uses.length) {
        messages.push({ role: 'assistant', content: r.content });
        messages.push({ role: 'user', content: uses.map(u => { calls.push(`${u.name}(${JSON.stringify(u.input)})`); return { type: 'tool_result', tool_use_id: u.id, content: runTool(u.name, u.input || {}, D, v, core) } }) });
        continue;
      }
      answer = r.content.filter(c => c.type === 'text').map(c => c.text).join('').trim() + (r.stop_reason === 'max_tokens' ? ' …' : '');
    }
    if (!answer) answer = 'คำถามนี้ซับซ้อนเกินไป ลองถามทีละเรื่อง เช่น ระบุชื่อครูหรือกลุ่มเรียนและวัน';
    // Question log without who asked (spec), plus token use for cost monitoring.
    await audit('AI', 'AI_ASK', `${q} | tools: ${calls.length} | in ${used.input} out ${used.output} cache ${used.cacheRead}/${used.cacheWrite}`);
    return json({ answer, calls, usage: used });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'มีผู้ถามจำนวนมาก กรุณาลองใหม่อีกสักครู่' }, 429);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return json({ error: 'คีย์ ANTHROPIC_API_KEY ไม่ถูกต้อง' }, 503);
    if (e instanceof Anthropic.APIConnectionError) return json({ error: 'เชื่อมต่อบริการ AI ไม่ได้' }, 502);
    if (e instanceof Anthropic.APIError) { console.error(e); return json({ error: 'บริการ AI ขัดข้องชั่วคราว' }, 502) }
    return fail(e);
  }
}
