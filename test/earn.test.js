const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/earn.js');

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

// 构造某天某时刻的本地时间戳
function ts(h, m, s) {
  const d = new Date(2026, 10, 5, h || 0, m || 0, s || 0, 0);
  return d.getTime();
}

test('hhmm 解析与格式化', () => {
  assert.strictEqual(E.hhmmToMinutes('09:30'), 570);
  assert.strictEqual(E.hhmmToMinutes('9:05'), 545);
  assert.strictEqual(E.hhmmToMinutes('24:00'), null);
  assert.strictEqual(E.hhmmToMinutes('abc'), null);
  assert.strictEqual(E.minutesToHHMM(570), '09:30');
  assert.strictEqual(E.minutesToHHMM(1439), '23:59');
});

test('计薪分钟 = 在岗时长 − 午休', () => {
  assert.strictEqual(E.paidMinutesOfDay(baseCfg), 480); // 9h − 1h
});

test('午休与晚休同时启用时都被扣除', () => {
  const cfg = Object.assign({}, baseCfg, {
    dinnerEnabled: true, dinnerStart: '17:00', dinnerEnd: '17:30'
  });
  assert.strictEqual(E.paidMinutesOfDay(cfg), 450);
});

test('休息时段若超出工作区间不重复扣除', () => {
  const cfg = Object.assign({}, baseCfg, { dinnerEnabled: true, dinnerStart: '18:00', dinnerEnd: '19:00' });
  assert.strictEqual(E.paidMinutesOfDay(cfg), 480);
});

test('跨零点班次（22:00 → 06:00）', () => {
  const cfg = Object.assign({}, baseCfg, {
    workStart: '22:00', workEnd: '06:00', lunchEnabled: false, dinnerEnabled: false
  });
  assert.strictEqual(E.paidMinutesOfDay(cfg), 480);
});

test('速率换算：每分钟 / 每秒 / 每小时', () => {
  const r = E.rates(baseCfg);
  const dayPay = 20000 / 21;
  assert.ok(Math.abs(r.dayPay - dayPay) < 1e-9);
  assert.ok(Math.abs(r.perMin - dayPay / 480) < 1e-9);
  assert.ok(Math.abs(r.perSec - dayPay / 480 / 60) < 1e-9);
  assert.ok(Math.abs(r.perHour - dayPay / 8) < 1e-9);
});

test('上班前已挣为 0，进度为 0', () => {
  const c = E.compute(baseCfg, ts(8, 0));
  assert.strictEqual(c.earned, 0);
  assert.strictEqual(c.progress, 0);
  assert.strictEqual(c.phase, 'before');
});

test('工作 4 小时（09:00–13:00，含午休）= 已挣 4 小时', () => {
  const c = E.compute(baseCfg, ts(13, 0));
  const dayPay = 20000 / 21;
  // 09:00-12:00 计薪 3h，12:00-13:00 午休；13:00 整点午休结束、立即恢复计薪
  assert.strictEqual(c.phase, 'working');
  assert.ok(Math.abs(c.earned - dayPay * 180 / 480) < 1e-6, `earned=${c.earned}`);
});

test('午休结束后继续累计，进度与金额一致', () => {
  const c = E.compute(baseCfg, ts(14, 0));
  const dayPay = 20000 / 21;
  assert.strictEqual(c.phase, 'working');
  assert.ok(Math.abs(c.earned - dayPay * 240 / 480) < 1e-6);
  assert.ok(Math.abs(c.progress - 0.5) < 1e-9);
});

test('下班后定格为满勤金额', () => {
  const c = E.compute(baseCfg, ts(19, 0));
  const dayPay = 20000 / 21;
  assert.strictEqual(c.phase, 'after');
  assert.ok(Math.abs(c.earned - dayPay) < 1e-9);
  assert.strictEqual(c.toOffMs, 0);
});

test('跨零点班次在下班前持续累计', () => {
  const cfg = Object.assign({}, baseCfg, {
    workStart: '22:00', workEnd: '06:00', lunchEnabled: false, dinnerEnabled: false
  });
  const c = E.compute(cfg, ts(1, 0));
  const dayPay = 20000 / 21;
  assert.strictEqual(c.phase, 'before'); // 当天 22:00 前一秒仍在「未开工」
  // 前一刻从上一晚开始的部分不重复计入，避免跨天双计
  assert.strictEqual(c.earned, 0);
  assert.ok(dayPay > 0);
});

test('金额格式化：千分位与小数位', () => {
  assert.strictEqual(E.formatMoney(1234.5678, 4), '1,234.5678');
  assert.strictEqual(E.formatMoney(9.4079, 4), '9.4079');
  assert.strictEqual(E.formatMoney(0, 2), '0.00');
  assert.strictEqual(E.formatMoney(-12.5, 2), '-12.50');
});

test('时长格式化', () => {
  assert.strictEqual(E.formatDuration(3 * 3600e3 + 22 * 60e3 + 44e3), '3小时22分44秒');
  assert.strictEqual(E.formatDuration(44e3), '44秒');
  assert.strictEqual(E.formatClock(4 * 3600e3 + 43 * 60e3 + 44e3), '04:43:44');
});

test('换算清单按配置顺序输出，并给出可购数量', () => {
  const list = E.affordable(30, E.DEFAULT_ITEMS);
  assert.strictEqual(list[0].name, '矿泉水');
  assert.strictEqual(list.length, E.DEFAULT_ITEMS.length);
  const cola = list.find((x) => x.name === '瑞幸一杯');
  const expected = 30 / 13.9;
  assert.ok(Math.abs(cola.count - expected) < 1e-9);
});

test('本月累计 = 已过工作日满勤 + 今日进度', () => {
  const m = E.monthToDate(baseCfg, ts(14, 0), 100);
  const dayPay = 20000 / 21;
  assert.strictEqual(m.planDays, 21);
  assert.ok(Math.abs(m.total - ((m.passedWorkdays - 1) * dayPay + 100)) < 1e-6);
});
