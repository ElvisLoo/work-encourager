/**
 * history.js — 每日打卡记录与统计（纯函数，无 DOM / 无 Electron 依赖）
 *
 * 职责：
 *   1. 把「今天赚了多少」按日期存下来（同一天多次写入取最大值，避免刷新后变少）；
 *   2. 汇总本月 / 本周 / 累计三个口径的战报；
 *   3. 输出日历热力数据，供界面画一个月的小格子。
 *
 * 数据结构（dayMs 以本地时区的 YYYY-MM-DD 为键）：
 *   {
 *     "2026-11-06": { earned: 571.43, paidMs: 28800000, at: 1762...  },
 *     ...
 *   }
 *
 * 设计取舍：
 *   - 只存「当天最终金额」，不存每秒快照：体积可控，400 天也就几十 KB；
 *   - earned 用四舍五入到分保存，避免浮点尾数把存储撑大；
 *   - 所有函数对脏数据（字符串、null、负数）都做兜底，绝不抛异常。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HistoryCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_DAYS = 400; // 只保留最近 400 天，约一年多
  var MIN = 60 * 1000;

  /* ---------------- 日期工具 ---------------- */

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 本地时区的 YYYY-MM-DD */
  function dayKey(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** "YYYY-MM-DD" -> 当天 0 点时间戳；非法返回 NaN */
  function keyToTs(key) {
    if (typeof key !== 'string') return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return NaN;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    return isNaN(d.getTime()) ? NaN : d.getTime();
  }

  /** 记录是否合法 */
  function cleanRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    var earned = Number(rec.earned);
    var paidMs = Number(rec.paidMs);
    var at = Number(rec.at);
    if (!isFinite(earned) || earned < 0) earned = 0;
    if (!isFinite(paidMs) || paidMs < 0) paidMs = 0;
    if (!isFinite(at) || at <= 0) at = 0;
    return {
      earned: Math.round(earned * 100) / 100,
      paidMs: Math.round(paidMs),
      at: Math.round(at)
    };
  }

  /**
   * 写入一天的记录（就地修改并返回是否变化）
   * 同一天重复写入时取 earned / paidMs 的较大值，
   * 这样即使某次读到的是「还没干完」的中间态，也不会把已有记录冲小。
   */
  function upsert(store, ts, earned, paidMs) {
    if (!store || typeof store !== 'object') return false;
    var key = dayKey(ts);
    if (!key) return false;

    var incoming = cleanRecord({ earned: earned, paidMs: paidMs, at: ts });
    var prev = cleanRecord(store[key]);

    if (!prev) {
      store[key] = incoming;
      return incoming.earned > 0 || incoming.paidMs > 0;
    }

    var next = {
      earned: Math.max(prev.earned, incoming.earned),
      paidMs: Math.max(prev.paidMs, incoming.paidMs),
      at: incoming.at > prev.at ? incoming.at : prev.at
    };
    var changed = next.earned !== prev.earned || next.paidMs !== prev.paidMs;
    store[key] = next;
    return changed;
  }

  /** 裁掉过老的记录，返回新对象（不修改入参） */
  function prune(store, nowMs, maxDays) {
    var limit = maxDays == null ? MAX_DAYS : maxDays;
    var out = {};
    if (!store || typeof store !== 'object') return out;

    var cutoff = dayKey((nowMs || Date.now()) - limit * 24 * 60 * MIN);
    var cutoffTs = keyToTs(cutoff);

    Object.keys(store).forEach(function (k) {
      var t = keyToTs(k);
      if (isNaN(t)) return;                    // 丢掉格式不对的键
      if (!isNaN(cutoffTs) && t < cutoffTs) return;
      var rec = cleanRecord(store[k]);
      if (rec && (rec.earned > 0 || rec.paidMs > 0)) out[k] = rec;
    });
    return out;
  }

  /* ---------------- 统计 ---------------- */

  /**
   * 汇总一段时间内的战报
   * @param {object} store 记录表
   * @param {number} fromTs 起点（含）
   * @param {number} toTs   终点（含当天）
   * @returns {{days:number, total:number, best:object|null, avgPerDay:number,
   *            avgPerWorkday:number, totalPaidMs:number, records:Array}}
   */
  function summarize(store, fromTs, toTs) {
    var from = dayKey(fromTs);
    var to = dayKey(toTs);
    var out = {
      days: 0, total: 0, best: null,
      avgPerDay: 0, avgPerWorkday: 0, totalPaidMs: 0, records: []
    };
    if (!from || !to || !store || typeof store !== 'object') return out;

    var keys = Object.keys(store).filter(function (k) {
      return k >= from && k <= to;
    }).sort();

    keys.forEach(function (k) {
      var rec = cleanRecord(store[k]);
      if (!rec || rec.earned <= 0) return;
      out.days += 1;
      out.total += rec.earned;
      out.totalPaidMs += rec.paidMs;
      out.records.push({ key: k, earned: rec.earned, paidMs: rec.paidMs });
      if (!out.best || rec.earned > out.best.earned) {
        out.best = { key: k, earned: rec.earned };
      }
    });

    out.total = Math.round(out.total * 100) / 100;
    if (out.days > 0) {
      out.avgPerDay = out.total / out.days;
      out.avgPerWorkday = out.avgPerDay;
    }
    return out;
  }

  /** 本月口径 */
  function thisMonth(store, nowMs) {
    var d = new Date(nowMs);
    var first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
    var s = summarize(store, first, last);
    s.totalDaysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    s.passedDays = d.getDate();
    return s;
  }

  /** 本周口径（周一为一周之始） */
  function thisWeek(store, nowMs) {
    var d = new Date(nowMs);
    var wd = d.getDay();          // 0=周日
    var back = wd === 0 ? 6 : wd - 1;
    var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
    return summarize(store, monday, nowMs);
  }

  /** 累计口径（全部记录） */
  function allTime(store, nowMs) {
    var from = 0, to = nowMs || Date.now();
    Object.keys(store || {}).forEach(function (k) {
      var t = keyToTs(k);
      if (!isNaN(t) && t < from) from = t;
    });
    return summarize(store, from, to);
  }

  /**
   * 画一个月日历格子用的数据
   * @returns {Array<{key:string, day:number, earned:number, level:0|1|2|3|4, future:boolean}>}
   */
  function calendar(store, nowMs) {
    var d = new Date(nowMs);
    var year = d.getFullYear(), month = d.getMonth();
    var total = new Date(year, month + 1, 0).getDate();
    var today = d.getDate();

    var rows = [];
    var max = 0;
    for (var day = 1; day <= total; day++) {
      var k = year + '-' + pad2(month + 1) + '-' + pad2(day);
      var rec = cleanRecord(store && store[k]);
      var earned = rec ? rec.earned : 0;
      if (earned > max) max = earned;
      rows.push({ key: k, day: day, earned: earned, level: 0, future: day > today });
    }

    // 按当期最大值分四档，便于一眼看出哪几天最猛
    rows.forEach(function (r) {
      if (r.earned <= 0) { r.level = 0; return; }
      if (max <= 0) { r.level = 1; return; }
      var ratio = r.earned / max;
      r.level = ratio >= 0.95 ? 4 : ratio >= 0.7 ? 3 : ratio >= 0.4 ? 2 : 1;
    });
    return rows;
  }

  /** 连续打卡天数（从今天或昨天往前数，今天还没记录也算连上） */
  function streak(store, nowMs) {
    var cur = new Date(nowMs);
    var count = 0;
    // 今天没记录时不清零，从昨天开始数即可
    var rec0 = cleanRecord(store && store[dayKey(cur.getTime())]);
    if (!rec0 || rec0.earned <= 0) {
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1);
    }
    for (var i = 0; i < MAX_DAYS; i++) {
      var k = dayKey(cur.getTime());
      var rec = cleanRecord(store && store[k]);
      if (!rec || rec.earned <= 0) break;
      count++;
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1);
    }
    return count;
  }

  return {
    MAX_DAYS: MAX_DAYS,
    dayKey: dayKey,
    keyToTs: keyToTs,
    cleanRecord: cleanRecord,
    upsert: upsert,
    prune: prune,
    summarize: summarize,
    thisMonth: thisMonth,
    thisWeek: thisWeek,
    allTime: allTime,
    calendar: calendar,
    streak: streak
  };
});
