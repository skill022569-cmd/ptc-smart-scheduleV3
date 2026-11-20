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
