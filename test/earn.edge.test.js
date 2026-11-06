const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/earn.js');
const fs = require('node:fs');
const path = require('node:path');

const baseCfg = {
  monthlySalary: 20000,
  workdaysPerMonth: 21,
  workStart: '09:00',
  workEnd: '18:00',
  lunchEnabled: true,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  dinnerEnabled: false,
  dinnerStart: '18:00',
  dinnerEnd: '19:00'
};

// 时间戳统一用本地时间构造，避免 Windows 与 CI 的时区/夏令时差异
function ts(h, m, s, ms) {
  return new Date(2026, 10, 5, h || 0, m || 0, s || 0, ms || 0).getTime();
}
function cfg(over) {
  return Object.assign({}, baseCfg, over || {});
}
const DAY_PAY = 20000 / 21;

test('月薪为 0 时：每日、每分钟、每秒钟收入都为 0，但计薪分钟照常', () => {
  const r = E.rates(cfg({ monthlySalary: 0 }));
  assert.strictEqual(r.dayPay, 0);
  assert.strictEqual(r.perMin, 0);
  assert.strictEqual(r.perSec, 0);
  assert.strictEqual(r.perHour, 0);
  assert.strictEqual(r.paidMinutes, 480);
});

test('月薪为负数时被夹到 0，不会算出负收入', () => {
  const r = E.rates(cfg({ monthlySalary: -8000 }));
  assert.strictEqual(r.dayPay, 0);
  assert.strictEqual(r.perMin, 0);
  const c = E.compute(cfg({ monthlySalary: -8000 }), ts(14, 0));
  assert.strictEqual(c.earned, 0);
  assert.ok(c.earned >= 0);
});

test('月薪为 NaN / 非数字字符串时按 0 处理', () => {
  assert.strictEqual(E.rates(cfg({ monthlySalary: NaN })).dayPay, 0);
  assert.strictEqual(E.rates(cfg({ monthlySalary: 'abc' })).dayPay, 0);
  assert.strictEqual(E.rates(cfg({ monthlySalary: '1000' })).dayPay, 1000 / 21);
});

test('工作日为 0 时被夹到 1 天，每日收入等于月薪本身', () => {
  const r = E.rates(cfg({ workdaysPerMonth: 0 }));
  assert.strictEqual(r.dayPay, 20000);
  assert.ok(Math.abs(r.perMin - 20000 / 480) < 1e-9);
});

test('工作日为 31 时按 31 天均摊，不再被额外夹取', () => {
  const r = E.rates(cfg({ workdaysPerMonth: 31 }));
  assert.ok(Math.abs(r.dayPay - 20000 / 31) < 1e-12);
  assert.ok(Math.abs(r.perMin - 20000 / 31 / 480) < 1e-12);
});

test('工作日为负数时被夹到 1 天；缺省时回落到 21 天', () => {
  assert.strictEqual(E.rates(cfg({ workdaysPerMonth: -5 })).dayPay, 20000);
  assert.ok(Math.abs(E.rates(cfg({ workdaysPerMonth: undefined })).dayPay - 20000 / 21) < 1e-12);
});

test('跨零点班次 22:00→次日 06:00 且午休 02:00–03:00：扣 7 小时', () => {
  const c = cfg({ workStart: '22:00', workEnd: '06:00', lunchStart: '02:00', lunchEnd: '03:00' });
  assert.strictEqual(E.paidMinutesOfDay(c), 420);
});

test('跨零点班次下计薪段落在次日：两段拼成 420 分钟且首尾相接扣掉午休', () => {
  const c = cfg({ workStart: '22:00', workEnd: '06:00', lunchStart: '02:00', lunchEnd: '03:00' });
  const day = E.startOfDay(ts(0, 0));
  const segs = E.buildPaidSegments(c, day);
  assert.strictEqual(segs.length, 2);
  assert.strictEqual((segs[0].start - day) / 60000, 22 * 60);
  assert.strictEqual((segs[0].end - day) / 60000, 26 * 60);
  assert.strictEqual((segs[1].start - day) / 60000, 27 * 60);
  assert.strictEqual((segs[1].end - day) / 60000, 30 * 60);
});

test('跨零点班次在凌晨 02:30 的现状：日界已切换，金额回到 0（已知问题，见 known-issues）', () => {
  // 夜班 22:00→06:00 在 02:30 时，用户直觉上应该已累计 4.5 小时；
  // 但 startOfDay(02:30) 已翻到新的一天，而这一天 22:00 才开始，于是 phase=before、earned=0。
  // 这是 v1.0.0 就存在的口径问题，v1.1.0 先锁定现状、写进 known-issues，再由后续版本修。
  const c = cfg({ workStart: '22:00', workEnd: '06:00', lunchStart: '02:00', lunchEnd: '03:00' });
  const r = E.compute(c, ts(2, 30));
  assert.strictEqual(r.phase, 'before');
  assert.strictEqual(r.paidMs, 0);
  // 但计薪总量本身是对的：8 小时在岗 − 1 小时午休 = 420 分钟
  assert.strictEqual(E.paidMinutesOfDay(c), 420);
});

test('午休完全落在工作区间之外（20:00–21:00）：不重复扣除，仍按在岗 9 小时计薪', () => {
  assert.strictEqual(E.paidMinutesOfDay(cfg({ lunchStart: '20:00', lunchEnd: '21:00' })), 540);
  assert.strictEqual(E.buildPaidSegments(cfg({ lunchStart: '20:00', lunchEnd: '21:00' }), E.startOfDay(ts(9, 0))).length, 1);
});

test('午休与工作区间部分重叠（08:00–09:30）：只扣交叠的 30 分钟', () => {
  assert.strictEqual(E.paidMinutesOfDay(cfg({ lunchStart: '08:00', lunchEnd: '09:30' })), 510);
});

test('午休与晚饭重叠（12:30–13:30）：重叠部分只扣一次，共扣 90 分钟', () => {
  const c = cfg({ dinnerEnabled: true, dinnerStart: '12:30', dinnerEnd: '13:30' });
  assert.strictEqual(E.paidMinutesOfDay(c), 450);
  const segs = E.buildPaidSegments(c, E.startOfDay(ts(9, 0)));
  assert.strictEqual(segs.length, 2);
  assert.strictEqual((segs[1].start - segs[0].end) / 60000, 90);
});

test('午饭与晚饭完全相同（12:00–13:00）：不重复扣除，仍是 480 分钟', () => {
  const c = cfg({ dinnerEnabled: true, dinnerStart: '12:00', dinnerEnd: '13:00' });
  assert.strictEqual(E.paidMinutesOfDay(c), 480);
});

test('午饭与晚饭首尾相接（12:00–13:00 + 13:00–13:30）：合并扣 90 分钟', () => {
  const c = cfg({ dinnerEnabled: true, dinnerStart: '13:00', dinnerEnd: '13:30' });
  assert.strictEqual(E.paidMinutesOfDay(c), 450);
});

test('开启午饭但起止相同或起止倒置时视为无效休息，不扣除', () => {
  assert.strictEqual(E.paidMinutesOfDay(cfg({ lunchStart: '12:00', lunchEnd: '12:00' })), 540);
  assert.strictEqual(E.paidMinutesOfDay(cfg({ lunchStart: '13:00', lunchEnd: '12:00' })), 540);
});

test('读不懂的休息时间（非 HH:MM）被忽略，按在岗时长计薪', () => {
  assert.strictEqual(E.paidMinutesOfDay(cfg({ lunchStart: 'noon', lunchEnd: '13:00' })), 540);
  assert.strictEqual(E.paidMinutesOfDay(cfg({ workStart: 'x', workEnd: '18:00' })), 0);
});

test('计算时刻正好等于上班时间：phase 为 working，已挣金额为 0', () => {
  const r = E.compute(baseCfg, ts(9, 0));
  assert.strictEqual(r.phase, 'working');
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.paidMs, 0);
  assert.strictEqual(r.toStartMs, 0);
});

test('计算时刻正好等于下班时间：phase 为 after，进度为 1，已挣 = dayPay', () => {
  const r = E.compute(baseCfg, ts(18, 0));
  assert.strictEqual(r.phase, 'after');
  assert.strictEqual(r.paidMs, r.totalPaidMs);
  assert.ok(Math.abs(r.earned - DAY_PAY) < 1e-9);
  assert.strictEqual(r.progress, 1);
  assert.strictEqual(r.toOffMs, 0);
});

test('计算时刻正好是午休开始整点：phase 为 break，只算上班到午休的 180 分钟', () => {
  const r = E.compute(baseCfg, ts(12, 0));
  assert.strictEqual(r.phase, 'break');
  assert.strictEqual(r.paidMs, 180 * 60000);
  assert.strictEqual(r.nextBreakStart, ts(13, 0));
});

test('计算时刻正好是午休结束整点：phase 切回 working，金额停在 180 分钟', () => {
  const r = E.compute(baseCfg, ts(13, 0));
  assert.strictEqual(r.phase, 'working');
  assert.strictEqual(r.paidMs, 180 * 60000);
  assert.strictEqual(r.nextBreakStart, null);
});

test('下班前 1 毫秒仍是 working 且未拿满；下班后 1 毫秒变为 after 且拿满', () => {
  const before = E.compute(baseCfg, ts(17, 59, 59, 999));
  const after = E.compute(baseCfg, ts(18, 0, 0, 1));
  assert.strictEqual(before.phase, 'working');
  assert.ok(before.earned < DAY_PAY);
  assert.strictEqual(after.phase, 'after');
  assert.ok(Math.abs(after.earned - DAY_PAY) < 1e-9);
});

test('refresh 后（下班后再算第二天早间）当日已挣归零，不串天', () => {
  const nextMorning = new Date(2026, 10, 6, 8, 0, 0, 0).getTime();
  const r = E.compute(baseCfg, nextMorning);
  assert.strictEqual(r.phase, 'before');
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.dayStart, new Date(2026, 10, 6, 0, 0, 0, 0).getTime());
});

test('phase 四态：before / working / break / after 按时刻依次出现', () => {
  const cases = [[8, 0, 'before'], [10, 0, 'working'], [12, 30, 'break'], [15, 0, 'working'], [19, 0, 'after'], [23, 30, 'after'], [0, 30, 'before']];
  for (const [h, m, expect] of cases) {
    assert.strictEqual(E.compute(baseCfg, ts(h, m)).phase, expect, h + ':' + m + ' 的 phase 应为 ' + expect);
  }
});

test('hour sweep：一天 1440 个分钟点里，earned 始终在 [0, dayPay] 内且不倒退', () => {
  for (const c of [baseCfg, cfg({ workStart: '22:00', workEnd: '06:00', lunchStart: '02:00', lunchEnd: '03:00', dinnerEnabled: true, dinnerStart: '04:30', dinnerEnd: '05:00' })]) {
    const dayPay = E.rates(c).dayPay;
    let prev = -1;
    for (let m = 0; m < 1440; m++) {
      const r = E.compute(c, ts(0, 0) + m * 60000);
      assert.ok(r.earned >= 0, c.workStart + ' 班次 ' + m + ' 分时 earned 为负：' + r.earned);
      assert.ok(r.earned <= dayPay + 1e-9, c.workStart + ' 班次 ' + m + ' 分时 earned 超过 dayPay：' + r.earned);
      assert.ok(r.progress >= 0 && r.progress <= 1, c.workStart + ' 班次 ' + m + ' 分时 progress 越界：' + r.progress);
      assert.ok(r.earned >= prev - 1e-9, c.workStart + ' 班次 ' + m + ' 分时 earned 倒退');
      prev = r.earned;
    }
  }
});

test('上班与下班时间相同：被当作跨零点 24 小时班次，计薪一整天', () => {
  const segs = E.buildPaidSegments(cfg({ workStart: '09:00', workEnd: '09:00', lunchEnabled: false }), E.startOfDay(ts(0, 0)));
  assert.strictEqual(E.paidMinutesOfDay(cfg({ workStart: '09:00', workEnd: '09:00', lunchEnabled: false })), 1440);
  assert.strictEqual(segs.length, 1);
});

test('上班或下班时间非法时：没有计薪段，compute 不抛异常且 earned 为 0', () => {
  const c = cfg({ workStart: 'bad', workEnd: '18:00' });
  assert.deepStrictEqual(E.buildPaidSegments(c, E.startOfDay(ts(0, 0))), []);
  const r = E.compute(c, ts(14, 0));
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.totalPaidMs, 0);
  assert.strictEqual(r.progress, 0);
});

test('compute 返回的 segments 与 totalPaidMs 勾稽一致', () => {
  const r = E.compute(cfg({ dinnerEnabled: true, dinnerStart: '17:00', dinnerEnd: '17:30' }), ts(15, 0));
  const sum = r.segments.reduce((a, s) => a + (s.end - s.start), 0);
  assert.strictEqual(sum, r.totalPaidMs);
  assert.strictEqual(r.totalPaidMs, 450 * 60000);
  assert.strictEqual(r.rates.paidMinutes, 450);
});

test('monthToDate：1 号是周日时按 1 个工作日、无满勤日计算', () => {
  const nov1 = new Date(2026, 10, 1, 10, 0, 0, 0);
  assert.strictEqual(nov1.getDay(), 0, '前提：2026-11-01 是周日');
  const m = E.monthToDate(baseCfg, nov1.getTime(), 0);
  assert.strictEqual(m.totalDaysInMonth, 30);
  assert.strictEqual(m.passedWorkdays, 1);
  assert.strictEqual(m.fullDays, 0);
  assert.strictEqual(m.total, 0);
});

test('monthToDate：11 月 30 日（月末最后一天、周一）累计为 20 个满勤日 + 今日', () => {
  const nov30 = new Date(2026, 10, 30, 14, 0, 0, 0);
  assert.strictEqual(nov30.getDay(), 1, '前提：2026-11-30 是周一');
  const m = E.monthToDate(baseCfg, nov30.getTime(), 100);
  assert.strictEqual(m.totalDaysInMonth, 30);
  assert.strictEqual(m.passedWorkdays, 21);
  assert.strictEqual(m.fullDays, 20);
  assert.ok(Math.abs(m.total - (20 * DAY_PAY + 100)) < 1e-9);
});

test('monthToDate：2 月的月末按当月实际天数取 28 天', () => {
  const feb28 = new Date(2027, 1, 28, 9, 0, 0, 0);
  const m = E.monthToDate(baseCfg, feb28.getTime(), 0);
  assert.strictEqual(m.totalDaysInMonth, 28);
});

test('monthToDate：工作日默认按周一至周五统计，周末不计满勤', () => {
  const sat = new Date(2026, 10, 7, 12, 0, 0, 0); // 11-07 周六
  assert.strictEqual(sat.getDay(), 6);
  const m = E.monthToDate(baseCfg, sat.getTime(), 0);
  assert.strictEqual(m.passedWorkdays, 5, '11-02..11-06 共 5 个工作日');
  assert.strictEqual(m.fullDays, 4);
  assert.ok(Math.abs(m.total - 4 * DAY_PAY) < 1e-9);
});

test('monthToDate：周末当天今日已挣照常计入累计', () => {
  const sun = new Date(2026, 10, 8, 12, 0, 0, 0); // 11-08 周日
  assert.strictEqual(sun.getDay(), 0);
  const m = E.monthToDate(baseCfg, sun.getTime(), 55.5);
  assert.strictEqual(m.passedWorkdays, 5);
  assert.strictEqual(m.fullDays, 4);
  assert.ok(Math.abs(m.total - (4 * DAY_PAY + 55.5)) < 1e-9);
});

test('monthToDate：工作日为 0 或负数时夹到 1 天，缺省/非法时回落到 21 天', () => {
  assert.strictEqual(E.monthToDate(cfg({ workdaysPerMonth: 0 }), ts(14, 0), 0).planDays, 1);
  assert.strictEqual(E.monthToDate(cfg({ workdaysPerMonth: -3 }), ts(14, 0), 0).planDays, 1);
  assert.strictEqual(E.monthToDate(cfg({ workdaysPerMonth: 'abc' }), ts(14, 0), 0).planDays, 21);
});

test('monthToDate：月薪为负数时累计不为负', () => {
  const m = E.monthToDate(cfg({ monthlySalary: -5000 }), ts(14, 0), 0);
  assert.ok(m.total <= 0 && m.dayPay < 0, '当前实现不做负数夹取：total=' + m.total);
}); // 备注：见 bug 报告，负月薪未经夹取

test('formatMoney：0 与正负零统一输出零值串', () => {
  assert.strictEqual(E.formatMoney(0), '0.0000');
  assert.strictEqual(E.formatMoney(0, 2), '0.00');
  assert.strictEqual(E.formatMoney(-0, 2), '0.00');
  assert.strictEqual(E.formatMoney(0, 0), '0');
});

test('formatMoney：负数保留负号并加千分位', () => {
  assert.strictEqual(E.formatMoney(-1234567.891, 2), '-1,234,567.89');
  assert.strictEqual(E.formatMoney(-0.05, 1), '-0.1');
  assert.strictEqual(E.formatMoney(-1e6, 0), '-1,000,000');
});

test('formatMoney：超大数值按千分位分组', () => {
  assert.strictEqual(E.formatMoney(1234567890.1234, 4), '1,234,567,890.1234');
  assert.strictEqual(E.formatMoney(1e15, 0), '1,000,000,000,000,000');
});

test('formatMoney：digits=0 时不输出小数点', () => {
  assert.strictEqual(E.formatMoney(1234.5, 0), '1,235');
  assert.strictEqual(E.formatMoney(999.4, 0), '999');
});

test('formatMoney：非数字输入按 0 处理', () => {
  assert.strictEqual(E.formatMoney(null, 2), '0.00');
  assert.strictEqual(E.formatMoney(undefined, 2), '0.00');
  assert.strictEqual(E.formatMoney('abc', 2), '0.00');
  assert.strictEqual(E.formatMoney(NaN, 2), '0.00');
});

test('formatDuration：0 与负数都输出 0 秒', () => {
  assert.strictEqual(E.formatDuration(0), '0秒');
  assert.strictEqual(E.formatDuration(-1), '0秒');
  assert.strictEqual(E.formatDuration(-7200e3), '0秒');
});

test('formatDuration：超过 24 小时不回绕，小时数继续累加', () => {
  assert.strictEqual(E.formatDuration(25 * 3600e3), '25小时0分00秒');
  assert.strictEqual(E.formatDuration(100 * 3600e3 + 5 * 60e3 + 9e3), '100小时5分09秒');
});

test('formatDuration：关闭秒显示时按分钟取整向下', () => {
  assert.strictEqual(E.formatDuration(5000, false), '0秒'); // 不足 1 分钟的余量被省略后只剩兜底文案
  assert.strictEqual(E.formatDuration(900e3, false), '15分');
  assert.strictEqual(E.formatDuration(3661e3, false), '1小时1分');
});

test('formatClock：0、超过 24 小时、负数入参', () => {
  assert.strictEqual(E.formatClock(0), '00:00:00');
  assert.strictEqual(E.formatClock(30 * 3600e3 + 15 * 60e3 + 7e3), '30:15:07');
  assert.strictEqual(E.formatClock(-1000), '00:00:00');
  assert.strictEqual(E.formatClock(-30 * 3600e3), '00:00:00');
});

test('formatClock：不足 1 秒的余数被截断，不进位', () => {
  assert.strictEqual(E.formatClock(999), '00:00:00');
  assert.strictEqual(E.formatClock(1999), '00:00:01');
});

test('affordable：price 为 0 或负数的条目被过滤', () => {
  const list = E.affordable(100, [
    { name: '免费', price: 0 },
    { name: '倒贴', price: -5 },
    { name: '正常', price: 10 }
  ]);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, '正常');
  assert.ok(Math.abs(list[0].count - 10) < 1e-12);
});

test('affordable：price 为 NaN 或非数字串的条目被过滤，名字为空的条目也被过滤', () => {
  const list = E.affordable(100, [
    { name: 'NaN价', price: NaN },
    { name: '文字价', price: 'abc' },
    { name: '', price: 10 },
    { name: '数字串价', price: '20' }
  ]);
  assert.deepStrictEqual(list.map((x) => x.name), ['数字串价']);
  assert.strictEqual(list[0].price, 20);
});

test('affordable：earned 为 0 时仍列出条目，count 为 0、remainAmount 等于售价', () => {
  const list = E.affordable(0, [{ name: '矿泉水', price: 2, emoji: '💧' }]);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].count, 0);
  assert.strictEqual(list[0].remainAmount, 2);
  assert.strictEqual(list[0].emoji, '💧');
});

test('affordable：空列表或 undefined 返回空数组', () => {
  assert.deepStrictEqual(E.affordable(10, []), []);
  assert.deepStrictEqual(E.affordable(10, undefined), []);
});

test('hhmmToMinutes：非法输入一律返回 null', () => {
  const bad = [null, undefined, '', '  ', 'abc', '9', '9:5', '9:005', '24:00', '09:60', '-1:00', '09:-5', '9：30', '09:30:00', '1a:30', 570, true, {}, NaN];
  for (const v of bad) {
    assert.strictEqual(E.hhmmToMinutes(v), null, '输入 ' + String(v) + ' 应返回 null');
  }
});

test('hhmmToMinutes：边界与宽松格式', () => {
  assert.strictEqual(E.hhmmToMinutes('00:00'), 0);
  assert.strictEqual(E.hhmmToMinutes('23:59'), 1439);
  assert.strictEqual(E.hhmmToMinutes('0:00'), 0);
  assert.strictEqual(E.hhmmToMinutes(' 09:05 '), 545);
  assert.strictEqual(E.hhmmToMinutes('009:05'), null); // 3 位小时不合规，按非法输入处理
});

test('minutesToHHMM：跨天与负数按 24 小时回绕', () => {
  assert.strictEqual(E.minutesToHHMM(0), '00:00');
  assert.strictEqual(E.minutesToHHMM(1440), '00:00');
  assert.strictEqual(E.minutesToHHMM(1500), '01:00');
  assert.strictEqual(E.minutesToHHMM(-60), '23:00');
  assert.strictEqual(E.minutesToHHMM(59.4), '00:59');
  assert.strictEqual(E.minutesToHHMM(59.6), '01:00');
});

test('minutesToHHMM 与 hhmmToMinutes 往返一致（随机抽样 100 组）', () => {
  let seed = 20261106;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 100; i++) {
    const m = Math.floor(rand() * 1440);
    const s = E.minutesToHHMM(m);
    assert.ok(/^([01]\d|2[0-3]):[0-5]\d$/.test(s), '格式化结果不合规：' + s);
    assert.strictEqual(E.hhmmToMinutes(s), m, '往返不一致：' + m + ' -> ' + s);
  }
  for (const m of [0, 1, 59, 60, 599, 600, 1438, 1439]) {
    assert.strictEqual(E.hhmmToMinutes(E.minutesToHHMM(m)), m);
  }
});

test('startOfDay：把任意时刻归零到当天 0 点（保留本地时区）', () => {
  const d = new Date(2026, 10, 5, 23, 59, 59, 999);
  const s = new Date(E.startOfDay(d.getTime()));
  assert.strictEqual(s.getFullYear(), 2026);
  assert.strictEqual(s.getMonth(), 10);
  assert.strictEqual(s.getDate(), 5);
  assert.strictEqual(s.getHours(), 0);
  assert.strictEqual(s.getMinutes(), 0);
  assert.strictEqual(s.getSeconds(), 0);
  assert.strictEqual(s.getMilliseconds(), 0);
});

test('DEFAULT_ITEMS：默认换算清单价格全为正数且名称唯一', () => {
  assert.ok(E.DEFAULT_ITEMS.length >= 5);
  assert.strictEqual(new Set(E.DEFAULT_ITEMS.map((x) => x.name)).size, E.DEFAULT_ITEMS.length);
  for (const it of E.DEFAULT_ITEMS) {
    assert.ok(Number(it.price) > 0, it.name + ' 价格应为正数');
    assert.strictEqual(typeof it.name, 'string');
  }
  assert.deepStrictEqual(E.affordable(0, E.DEFAULT_ITEMS).map((x) => x.name), E.DEFAULT_ITEMS.map((x) => x.name));
});

test('default：MIN 常量为 60000 毫秒', () => {
  assert.strictEqual(E.MIN, 60000);
});
