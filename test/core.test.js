import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCore } from '../lib/core.js';

// Tiny college: one group, one teacher, one classroom, one locked homeroom period.
const D = {
  TCH: { t1: { id: 't1', short: 'ครูเอ', max: 20, maxDay: 6, maxConsec: 4, unav: [{ day: 2, p: 1, reason: 'ประชุม' }] } },
  RM: { R1: { id: 'R1', name: 'R1', bld: 'A', cap: 40, type: 'CLASS', unav: [] } },
  GRP: { G1: { id: 'G1', level: 'ปวช.', year: 1, size: 30, name: 'ปวช.1 ทดสอบ', en: 'G1' } },
  SUB: { S1: { code: 'S1', room: 'CLASS', consec: false }, S2: { code: 'S2', room: 'CLASS', consec: false } },
  LOCKS: [{ id: 'HR', th: 'โฮมรูม', en: 'Homeroom', day: 1, from: 1, len: 1, applies: 'ALL', on: true }],
};
D.ASG = [{ id: 'a1', subj: 'S1', teachers: ['t1'], groups: ['G1'], pattern: [2, 2], periods: 4 }, { id: 'a2', subj: 'S2', teachers: ['t1'], groups: ['G1'], pattern: [2], periods: 2 }];
D.A = Object.fromEntries(D.ASG.map(a => [a.id, a]));
let n = 0; const id = () => 'x' + (++n);

test('solver places everything without clashes or locked periods', () => {
  const c = makeCore(D), r = c.solve(1, [], id);
  assert.equal(r.unplaced.length, 0);
  assert.equal(c.conflicts(r.slots), 0);
  assert.equal(c.validateSlots(r.slots), null);
  assert.ok(!r.slots.some(s => s.day === 1 && s.start === 1), 'homeroom must stay free');
});
test('checker flags teacher clash, lock, unavailability, wrong room type; soft-flags after hours', () => {
  const c = makeCore(D), s = { id: 's1', aid: 'a1', day: 3, start: 2, len: 2, room: 'R1' }, m = c.idx([s]);
  assert.equal(c.check(m, D.A.a2, 3, 3, 2, 'R1').status, 'red');
  assert.equal(c.check(m, D.A.a2, 1, 1, 2, 'R1').status, 'red');
  assert.equal(c.check(m, D.A.a2, 2, 1, 2, 'R1').status, 'red');
  assert.equal(c.check(m, D.A.a2, 4, 2, 2, 'R1').status, 'green');
  assert.equal(c.check(m, D.A.a2, 4, 8, 2, 'R1').status, 'yellow');
  assert.equal(c.check(m, D.A.a2, 4, 9, 2, 'R1').status, 'none');
});

test('no block may run through lunch; solver halves a block that cannot fit whole', () => {
  const c = makeCore(D), m = c.idx([]);
  assert.equal(c.check(m, D.A.a2, 3, 4, 2, 'R1').status, 'red');
  assert.equal(c.check(m, D.A.a2, 3, 3, 2, 'R1').status, 'green');
  // 4-period practical, but every morning except Monday's (homeroom) is blocked for the teacher.
  const T = { ...D.TCH.t1, unav: [2, 3, 4, 5].flatMap(d => [1, 2, 3, 4].map(p => ({ day: d, p, reason: 'x' }))) };
  const D2 = { ...D, TCH: { t1: T }, ASG: [{ id: 'p', subj: 'S1', teachers: ['t1'], groups: ['G1'], pattern: [4], periods: 4 }] }; D2.A = { p: D2.ASG[0] };
  const r = makeCore(D2).solve(3, [], id);
  assert.equal(r.unplaced.length, 0);
  assert.deepEqual(r.slots.map(s => s.len).sort(), [2, 2]);
  assert.ok(r.slots.every(s => !(s.start <= 4 && s.start + s.len - 1 >= 5)));
  assert.equal(new Set(r.slots.map(s => s.split)).size, 2);
});

test('swap plans re-pick a room when the old one is taken at the new time', () => {
  const R = { ...D.RM, R2: { id: 'R2', name: 'R2', bld: 'A', cap: 40, type: 'CLASS', unav: [] } };
  const G2 = { id: 'G2', level: 'ปวส.', year: 1, size: 30, name: 'ปวส.1', en: 'G2' };
  const ASG = [...D.ASG, { id: 'a3', subj: 'S2', teachers: ['t2'], groups: ['G2'], pattern: [2], periods: 2 }];
  const D3 = { ...D, RM: R, GRP: { ...D.GRP, G2 }, TCH: { ...D.TCH, t2: { id: 't2', short: 'ครูบี', max: 20, maxDay: 6, maxConsec: 4, unav: [] } }, ASG, A: Object.fromEntries(ASG.map(a => [a.id, a])) };
  const c = makeCore(D3);
  const s = { id: 's', aid: 'a1', day: 3, start: 2, len: 2, room: 'R1', split: 0 }, x = { id: 'x', aid: 'a2', day: 4, start: 2, len: 2, room: 'R2', split: 0 };
  const other = { id: 'o', aid: 'a3', day: 4, start: 2, len: 2, room: 'R1', split: 0 }; // R1 busy on day 4 when s would move there
  const p = c.planSwap([s, x, other], s, x);
  assert.equal(p.ok, true);
  assert.notEqual(p.rooms[0], 'R1'); // R1 is taken on day 4
  const after = [{ ...s, day: 4, start: 2, room: p.rooms[0] }, { ...x, day: 3, start: 2, room: p.rooms[1] }, other];
  assert.equal(c.conflicts(after), 0);
  assert.equal(c.planSwap([s, { ...x, aid: 'a1' }], s, { ...x, aid: 'a1', start: 3, day: 3 }).ok, false); // same group overlapping itself
});
