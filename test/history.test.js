// src/history.js 的单元测试
const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/history.js');

function ts(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}

test('dayKey 返回本地时区的 YYYY-MM-DD', () => {
  assert.strictEqual(H.dayKey(ts(2026, 11, 6, 15, 30)), '2026-11-06');
  assert.strictEqual(H.dayKey(ts(2026, 1, 1, 0, 0)), '2026-01-01');
  assert.strictEqual(H.dayKey(NaN), '');
});

test('dayKey 与 keyToTs 互为逆运算', () => {
  for (const [y, m, d] of [[2026, 1, 1], [2026, 2, 28], [2026, 12, 31], [2027, 6, 15]]) {
    const key = H.dayKey(ts(y, m, d, 12));
    const back = H.keyToTs(key);
    assert.strictEqual(H.dayKey(back), key);
  }
});

test('keyToTs 对非法输入返回 NaN', () => {
  for (const bad of ['', 'x', '2026-1-1', '2026/01/01', null, undefined, 0, {}]) {
    assert.ok(isNaN(H.keyToTs(bad)), String(bad) + ' 应返回 NaN');
  }
});

test('upsert 写入新记录', () => {
  const s = {};
  const changed = H.upsert(s, ts(2026, 11, 6, 10), 123.456, 3600000);
  assert.strictEqual(changed, true);
  assert.strictEqual(s['2026-11-06'].earned, 123.46); // 四舍五入到分
  assert.strictEqual(s['2026-11-06'].paidMs, 3600000);
});

test('upsert 同日重复写入取较大值，不会被冲小', () => {
  const s = {};
  H.upsert(s, ts(2026, 11, 6, 10), 500, 7200000);
  H.upsert(s, ts(2026, 11, 6, 18), 100, 1800000); // 更小的中间态
  assert.strictEqual(s['2026-11-06'].earned, 500);
  assert.strictEqual(s['2026-11-06'].paidMs, 7200000);
});

test('upsert 对负数与非数字做兜底', () => {
  const s = {};
  H.upsert(s, ts(2026, 11, 6, 10), -50, -100);
  assert.strictEqual(s['2026-11-06'].earned, 0);
  assert.strictEqual(s['2026-11-06'].paidMs, 0);
  H.upsert(s, ts(2026, 11, 7, 10), 'abc', {});
  assert.strictEqual(s['2026-11-07'].earned, 0);
});

test('upsert 对空 store 或非法时间返回 false 且不抛异常', () => {
  assert.strictEqual(H.upsert(null, Date.now(), 1, 1), false);
  assert.strictEqual(H.upsert({}, NaN, 1, 1), false);
});

test('prune 丢掉超期与格式错误的键', () => {
  const now = ts(2026, 11, 6, 12);
  const s = {
    '2026-11-06': { earned: 100, paidMs: 1, at: now },
    '2026-01-01': { earned: 100, paidMs: 1, at: now },  // 太老
    'bad-key': { earned: 100, paidMs: 1, at: now },     // 格式错
    '2026-11-05': { earned: 0, paidMs: 0, at: now }     // 空记录
  };
  const out = H.prune(s, now, 30);
  assert.deepStrictEqual(Object.keys(out), ['2026-11-06']);
});

test('prune 不修改入参', () => {
  const now = ts(2026, 11, 6, 12);
  const s = { '2026-11-06': { earned: 100, paidMs: 1, at: now }, 'bad': {} };
  const before = JSON.stringify(s);
  H.prune(s, now, 30);
  assert.strictEqual(JSON.stringify(s), before);
});

test('summarize 只统计区间内、金额大于 0 的记录', () => {
  const s = {
    '2026-11-03': { earned: 620, paidMs: 100, at: 1 },
    '2026-11-05': { earned: 500, paidMs: 200, at: 1 },
    '2026-11-06': { earned: 0, paidMs: 0, at: 1 },
    '2026-10-30': { earned: 900, paidMs: 300, at: 1 }
  };
  const r = H.summarize(s, ts(2026, 11, 1), ts(2026, 11, 6, 23));
  assert.strictEqual(r.days, 2);
  assert.strictEqual(r.total, 1120);
  assert.strictEqual(r.totalPaidMs, 300);
  assert.deepStrictEqual(r.best, { key: '2026-11-03', earned: 620 });
});

test('summarize 空输入返回零值而不是抛异常', () => {
  for (const v of [null, undefined, {}, 'x']) {
    const r = H.summarize(v, ts(2026, 11, 1), ts(2026, 11, 30));
    assert.strictEqual(r.days, 0);
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.best, null);
  }
});

test('thisMonth 按自然月切分', () => {
  const s = {
    '2026-10-31': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-01': { earned: 200, paidMs: 1, at: 1 },
    '2026-11-30': { earned: 300, paidMs: 1, at: 1 },
    '2026-12-01': { earned: 400, paidMs: 1, at: 1 }
  };
  const r = H.thisMonth(s, ts(2026, 11, 15));
  assert.strictEqual(r.total, 500, '只算 11 月的 200 + 300');
  assert.strictEqual(r.totalDaysInMonth, 30);
  assert.strictEqual(r.passedDays, 15);
});

test('thisWeek 以周一为一周之始', () => {
  // 2026-11-06 是周五；本周应含 11-02(一) 到 11-06(五)
  const s = {
    '2026-11-01': { earned: 100, paidMs: 1, at: 1 }, // 上周日
    '2026-11-02': { earned: 200, paidMs: 1, at: 1 }, // 本周一
    '2026-11-06': { earned: 300, paidMs: 1, at: 1 }
  };
  const r = H.thisWeek(s, ts(2026, 11, 6, 18));
  assert.strictEqual(r.total, 500);
  assert.strictEqual(r.days, 2);
});

test('thisWeek 在周日时仍归属上一个周一', () => {
  // 2026-11-08 是周日，本周一是 11-02
  const s = { '2026-11-02': { earned: 200, paidMs: 1, at: 1 } };
  const r = H.thisWeek(s, ts(2026, 11, 8, 12));
  assert.strictEqual(r.total, 200);
});

test('allTime 覆盖全部记录', () => {
  const s = {
    '2025-06-01': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-06': { earned: 200, paidMs: 1, at: 1 }
  };
  const r = H.allTime(s, ts(2026, 11, 6, 20));
  assert.strictEqual(r.total, 300);
  assert.strictEqual(r.days, 2);
});

test('calendar 返回当月每一天，未来日期标记 future', () => {
  const s = { '2026-11-03': { earned: 620, paidMs: 1, at: 1 } };
  const rows = H.calendar(s, ts(2026, 11, 6, 12));
  assert.strictEqual(rows.length, 30);
  assert.strictEqual(rows[0].day, 1);
  assert.strictEqual(rows[29].day, 30);
  assert.strictEqual(rows[5].future, false);  // 11-06 今天
  assert.strictEqual(rows[6].future, true);   // 11-07 未来
  assert.strictEqual(rows[2].earned, 620);
});

test('calendar 按当期最大值分四档', () => {
  const s = {
    '2026-11-01': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-02': { earned: 500, paidMs: 1, at: 1 }
  };
  const rows = H.calendar(s, ts(2026, 11, 10, 12));
  assert.strictEqual(rows[1].level, 4, '最大值应为第 4 档');
  assert.strictEqual(rows[0].level, 1, '两成应为第 1 档');
  assert.strictEqual(rows[3].level, 0, '没有记录应为 0');
});

test('calendar 空数据时全部为 0 档且不抛异常', () => {
  for (const v of [null, {}, undefined]) {
    const rows = H.calendar(v, ts(2026, 11, 6));
    assert.strictEqual(rows.length, 30);
    assert.ok(rows.every((r) => r.level === 0 && r.earned === 0));
  }
});

test('streak 统计连续打卡天数', () => {
  const s = {
    '2026-11-06': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-05': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-04': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-02': { earned: 100, paidMs: 1, at: 1 } // 11-03 断了
  };
  assert.strictEqual(H.streak(s, ts(2026, 11, 6, 20)), 3);
});

test('streak 今天还没记录时从昨天往前数，不清零', () => {
  const s = {
    '2026-11-05': { earned: 100, paidMs: 1, at: 1 },
    '2026-11-04': { earned: 100, paidMs: 1, at: 1 }
  };
  assert.strictEqual(H.streak(s, ts(2026, 11, 6, 9)), 2);
});

test('streak 空数据为 0', () => {
  assert.strictEqual(H.streak({}, ts(2026, 11, 6)), 0);
  assert.strictEqual(H.streak(null, ts(2026, 11, 6)), 0);
});

test('cleanRecord 对各类脏数据收敛', () => {
  assert.strictEqual(H.cleanRecord(null), null);
  assert.strictEqual(H.cleanRecord('x'), null);
  assert.deepStrictEqual(H.cleanRecord({ earned: '12.345', paidMs: '1000', at: '5' }),
    { earned: 12.35, paidMs: 1000, at: 5 });
  assert.deepStrictEqual(H.cleanRecord({}), { earned: 0, paidMs: 0, at: 0 });
});

test('跨月跨年的 dayKey 计算稳定', () => {
  assert.strictEqual(H.dayKey(ts(2026, 12, 31, 23, 59)), '2026-12-31');
  assert.strictEqual(H.dayKey(ts(2027, 1, 1, 0, 0)), '2027-01-01');
});
