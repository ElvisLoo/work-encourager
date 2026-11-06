// 黄历模块契约测试（F1）
// src/almanac.js 由另一人并行开发，可能尚未落地：模块不存在时整组跳过，不阻塞其它测试。
// 契约来源：docs/v1.1-spec.md「F1 黄历模块契约」。
const test = require('node:test');
const assert = require('node:assert');

let A = null;
try { A = require('../src/almanac.js'); } catch (e) { A = null; }

const SKIP = !A ? 'almanac.js 尚未实现' : false;

// 契约要求必须在输出前过滤掉的「演示不适词」
const FILTERED_TERMS = ['安葬', '破土', '入殓', '移柩', '成服', '除服', '启攒', '修坟', '立碑'];

// humanize 词表（docs/v1.1-spec.md「宜忌」通俗化词表）中的术语
const KNOWN_TERMS = [
  '嫁娶', '开市', '出行', '会亲友', '纳财', '求财', '交易', '动土', '安床', '移徙',
  '入宅', '立券', '订盟', '祭祀', '祈福', '求医', '栽种', '扫舍', '破土', '开光',
  '拆卸', '修造'
];

// 某天本地 0 点
function day(y, m, d) {
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

const SAMPLE = day(2026, 11, 6); // 星期五

const OF_KEYS = [
  'ymd', 'weekday', 'lunar', 'ganZhi', 'shengXiao', 'yi', 'ji',
  'tianShen', 'tianShenType', 'luck', 'zhiXing', 'xiu', 'chong', 'sha',
  'jieQi', 'festivals', 'tip'
];

const UPCOMING_KEYS = ['ymd', 'weekday', 'dayCn', 'luck', 'tianShen', 'yi', 'ji', 'jieQi', 'festivals'];

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}
function ymdOf(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

test('of() 返回契约列出的全部字段，且各字段类型正确', { skip: SKIP }, () => {
  const r = A.of(SAMPLE);
  assert.ok(r && typeof r === 'object', 'of() 应返回对象');
  for (const k of OF_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(r, k), '缺少字段：' + k);
  }
  assert.strictEqual(typeof r.ymd, 'string');
  assert.strictEqual(typeof r.weekday, 'string');
  assert.strictEqual(typeof r.shengXiao, 'string');
  assert.strictEqual(typeof r.tianShen, 'string');
  assert.strictEqual(typeof r.zhiXing, 'string');
  assert.strictEqual(typeof r.xiu, 'string');
  assert.strictEqual(typeof r.chong, 'string');
  assert.strictEqual(typeof r.sha, 'string');
  assert.strictEqual(typeof r.tip, 'string');
  assert.ok(['黄道', '黑道'].includes(r.tianShenType), 'tianShenType 只能是黄道/黑道');
  assert.ok(['吉', '凶'].includes(r.luck), 'luck 只能是吉/凶');
  assert.ok(r.jieQi === null || typeof r.jieQi === 'string', 'jieQi 应可为 null 或字符串');
  assert.ok(Array.isArray(r.yi) && r.yi.every((x) => typeof x === 'string'), 'yi 应为字符串数组');
  assert.ok(Array.isArray(r.ji) && r.ji.every((x) => typeof x === 'string'), 'ji 应为字符串数组');
  assert.ok(Array.isArray(r.festivals) && r.festivals.every((x) => typeof x === 'string'), 'festivals 应为字符串数组');
});

test('of() 的 lunar 子对象包含契约字段且类型正确', { skip: SKIP }, () => {
  const l = A.of(SAMPLE).lunar;
  assert.ok(l && typeof l === 'object', 'lunar 应为对象');
  for (const k of ['year', 'monthCn', 'dayCn', 'text']) {
    assert.strictEqual(typeof l[k], 'string', 'lunar.' + k + ' 应为字符串');
  }
  assert.strictEqual(typeof l.isLeap, 'boolean', 'lunar.isLeap 应为布尔值');
});

test('of() 的 ganZhi 子对象包含年/月/日三柱', { skip: SKIP }, () => {
  const g = A.of(SAMPLE).ganZhi;
  assert.ok(g && typeof g === 'object', 'ganZhi 应为对象');
  for (const k of ['year', 'month', 'day']) {
    assert.strictEqual(typeof g[k], 'string', 'ganZhi.' + k + ' 应为字符串');
  }
});

test('2026-11-06 的农历为九月廿八（丙午年、生肖马）', { skip: SKIP }, () => {
  const r = A.of(SAMPLE);
  assert.strictEqual(r.ymd, '2026-11-06');
  assert.strictEqual(r.weekday, '星期五');
  assert.strictEqual(r.lunar.dayCn, '廿八');
  assert.strictEqual(r.lunar.monthCn, '九');
  assert.strictEqual(r.lunar.isLeap, false);
  assert.ok(/九月廿八/.test(r.lunar.text), 'lunar.text 应包含「九月廿八」，实际 ' + r.lunar.text);
  assert.strictEqual(r.ganZhi.year, '丙午');
  assert.strictEqual(r.shengXiao, '马');
});

test('2026-11-06 的值神、黄道/黑道与吉凶互相自洽', { skip: SKIP }, () => {
  const r = A.of(SAMPLE);
  assert.ok(r.tianShen.length > 0, '值神不应为空');
  // 黄道十二神 -> 吉，黑道十二神 -> 凶
  const HUANGDAO = ['青龙', '天德', '玉堂', '司命', '明堂', '金匮'];
  const isHuangDao = HUANGDAO.includes(r.tianShen);
  assert.strictEqual(r.tianShenType, isHuangDao ? '黄道' : '黑道', '值神 ' + r.tianShen + ' 的黄道判定不一致');
  assert.strictEqual(r.luck, isHuangDao ? '吉' : '凶', '值神 ' + r.tianShen + ' 的吉凶判定不一致');
});

test('2026-11-06 的宜忌中不含安葬、破土、入殓、移柩等演示不适词', { skip: SKIP }, () => {
  const r = A.of(SAMPLE);
  for (const term of FILTERED_TERMS) {
    assert.ok(!r.yi.includes(term), 'yi 中不应出现「' + term + '」');
    assert.ok(!r.ji.includes(term), 'ji 中不应出现「' + term + '」');
  }
});

test('of() 的宜忌列表已去重', { skip: SKIP }, () => {
  const r = A.of(SAMPLE);
  assert.strictEqual(new Set(r.yi).size, r.yi.length, 'yi 存在重复项');
  assert.strictEqual(new Set(r.ji).size, r.ji.length, 'ji 存在重复项');
});

test('of() 对一年内每一天都满足字段完整与过滤规则', { skip: SKIP }, () => {
  const start = day(2026, 1, 1);
  for (let i = 0; i < 365; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const r = A.of(d);
    assert.strictEqual(r.ymd, ymdOf(d), 'ymd 与输入日期不一致：' + r.ymd);
    assert.strictEqual(r.weekday, WEEKDAYS[d.getDay()], 'weekday 与输入日期不一致：' + r.ymd);
    assert.ok(Array.isArray(r.yi) && Array.isArray(r.ji), r.ymd + ' 宜忌不是数组');
    for (const term of FILTERED_TERMS) {
      assert.ok(!r.yi.includes(term) && !r.ji.includes(term), r.ymd + ' 中出现应过滤的「' + term + '」');
    }
  }
});

test('upcoming(date, 7) 返回 7 条，ymd 连续且字段完整', { skip: SKIP }, () => {
  const list = A.upcoming(SAMPLE, 7);
  assert.ok(Array.isArray(list), 'upcoming 应返回数组');
  assert.strictEqual(list.length, 7, '应返回 7 条（含今天）');
  list.forEach((it, i) => {
    for (const k of UPCOMING_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(it, k), '第 ' + i + ' 条缺少字段：' + k);
    }
    const d = new Date(SAMPLE.getFullYear(), SAMPLE.getMonth(), SAMPLE.getDate() + i);
    assert.strictEqual(it.ymd, ymdOf(d), '第 ' + i + ' 条日期不连续');
    assert.strictEqual(it.weekday, WEEKDAYS[d.getDay()], '第 ' + i + ' 条星期错误');
    assert.strictEqual(typeof it.dayCn, 'string');
    assert.ok(['吉', '凶'].includes(it.luck));
    assert.strictEqual(typeof it.tianShen, 'string');
    assert.ok(Array.isArray(it.yi) && it.yi.length <= 3, 'yi 应为数组且最多 3 项');
    assert.ok(Array.isArray(it.ji) && it.ji.length <= 3, 'ji 应为数组且最多 3 项');
    assert.ok(it.jieQi === null || typeof it.jieQi === 'string');
    assert.ok(Array.isArray(it.festivals));
    for (const term of FILTERED_TERMS) {
      assert.ok(!it.yi.includes(term) && !it.ji.includes(term), it.ymd + ' 的简表含应过滤的「' + term + '」');
    }
  });
});

test('upcoming() 首条与 of() 当天数据一致', { skip: SKIP }, () => {
  const today = A.of(SAMPLE);
  const first = A.upcoming(SAMPLE, 3)[0];
  assert.strictEqual(first.ymd, today.ymd);
  assert.strictEqual(first.luck, today.luck);
  assert.strictEqual(first.tianShen, today.tianShen);
  assert.strictEqual(first.dayCn, today.lunar.dayCn);
});

test('humanize() 对词表中的已知术语返回通俗说法', { skip: SKIP }, () => {
  for (const term of KNOWN_TERMS) {
    const out = A.humanize(term);
    assert.strictEqual(typeof out, 'string', term + ' 的通俗说法应为字符串');
    assert.ok(out.length > 0, term + ' 的通俗说法不应为空');
    if (term !== '安葬') assert.notStrictEqual(out, term, term + ' 应被翻译成通俗说法');
  }
  assert.strictEqual(A.humanize('嫁娶'), '结婚');
  assert.strictEqual(A.humanize('出行'), '出差/出门');
  assert.strictEqual(A.humanize('交易'), '签合同');
});

test('humanize() 对未知术语原样返回', { skip: SKIP }, () => {
  assert.strictEqual(A.humanize('进厂打螺丝'), '进厂打螺丝');
  assert.strictEqual(A.humanize('量子纠缠'), '量子纠缠');
});

test('score() 返回 0-100 的整数，且对相同输入结果确定', { skip: SKIP }, () => {
  const r = A.of(SAMPLE);
  const s1 = A.score(r);
  const s2 = A.score(A.of(SAMPLE));
  assert.ok(Number.isInteger(s1), 'score 应为整数，实际 ' + s1);
  assert.ok(s1 >= 0 && s1 <= 100, 'score 应在 0-100 之间，实际 ' + s1);
  assert.strictEqual(s1, s2, '相同输入应得到相同分数');
});

test('score() 对一周内每一天都返回合法整数', { skip: SKIP }, () => {
  for (let i = 0; i < 7; i++) {
    const d = new Date(SAMPLE.getFullYear(), SAMPLE.getMonth(), SAMPLE.getDate() + i);
    const s = A.score(A.of(d));
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 100, ymdOf(d) + ' 的分数非法：' + s);
  }
});

test('of() 传入 null、Invalid Date、字符串等非法日期不抛异常', { skip: SKIP }, () => {
  const bad = [null, undefined, new Date('not a date'), '2026-11-06', '', 0, {}, NaN, true];
  for (const v of bad) {
    assert.doesNotThrow(() => A.of(v), 'of(' + String(v) + ') 不应抛异常');
  }
});

test('upcoming() 传入非法日期或缺省天数不抛异常', { skip: SKIP }, () => {
  for (const v of [null, undefined, new Date('bad'), '2026-11-06', 0]) {
    assert.doesNotThrow(() => A.upcoming(v, 7), 'upcoming(' + String(v) + ', 7) 不应抛异常');
  }
  assert.doesNotThrow(() => A.upcoming(SAMPLE));
  assert.doesNotThrow(() => A.upcoming(SAMPLE, 0));
  assert.doesNotThrow(() => A.upcoming(SAMPLE, -3));
  assert.ok(Array.isArray(A.upcoming(SAMPLE, 1)), 'upcoming(date, 1) 应返回数组');
});

test('score() / humanize() 对空值或垃圾输入不抛异常', { skip: SKIP }, () => {
  for (const v of [null, undefined, {}, 'x', 0]) {
    assert.doesNotThrow(() => A.score(v), 'score(' + String(v) + ') 不应抛异常');
    const s = A.score(v);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 100, 'score(' + String(v) + ') 应为 0-100 整数，实际 ' + s);
  }
  // 约定：非字符串一律返回空串，避免把 null/对象塞进界面
  assert.strictEqual(A.humanize(null), '');
  assert.strictEqual(A.humanize(undefined), '');
  assert.strictEqual(A.humanize(123), '123'); // 数字按字符串处理，避免界面出现 [object Object]
  assert.strictEqual(A.humanize({}), '');
  // 字符串原样返回（未知词）
  assert.strictEqual(A.humanize('航空'), '航空');
});
