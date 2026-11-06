/**
 * earn.js — 纯函数计薪内核
 * 不依赖 DOM / Electron，可在浏览器、Node（测试）中直接使用。
 *
 * 计薪规则：
 *   每天计薪分钟 = (下班 − 上班) − 午休时长 − 晚饭时长
 *   每日预计收入 = 月薪 ÷ 每月工作日
 *   每分钟收入   = 每日预计收入 ÷ 每天计薪分钟
 *   今日已挣     = 每分钟收入 × 今日已计薪分钟（精确到毫秒）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EarnCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60 * 1000;
  var DAY = 24 * 60 * MIN;

  /** "09:30" | "9:30" -> 分钟数；非法返回 null */
  function hhmmToMinutes(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  function minutesToHHMM(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /** 把 "HH:MM" 转成当天毫秒时间戳（基于 base 日期） */
  function atMinutes(dayStartMs, minutes) {
    return dayStartMs + minutes * MIN;
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * 把一天的作息整理成「计薪段」列表 [ {start, end} ]（单位：当天毫秒时间戳）
   * 支持跨零点（下班 < 上班 时视为次日）。
   */
  function buildPaidSegments(cfg, dayStartMs) {
    var work = hhmmToMinutes(cfg.workStart);
    var off = hhmmToMinutes(cfg.workEnd);
    if (work == null || off == null) return [];
    if (off <= work) off += 1440; // 跨零点

    var breaks = [];
    if (cfg.lunchEnabled !== false) {
      var ls = hhmmToMinutes(cfg.lunchStart), le = hhmmToMinutes(cfg.lunchEnd);
      if (ls != null && le != null && le > ls) breaks.push([ls, le]);
    }
    if (cfg.dinnerEnabled) {
      var ds = hhmmToMinutes(cfg.dinnerStart), de = hhmmToMinutes(cfg.dinnerEnd);
      if (ds != null && de != null && de > ds) breaks.push([ds, de]);
    }

    // 跨零点班次：休息时间可能写在「次日」，
    // 例如 22:00→06:00、午休 02:00→03:00，此时 02:00 要按 1440+120 理解。
    // 判断依据：休息开始时间早于上班时间，就认为它落在次日。
    if (off > 1440) {
      breaks = breaks.map(function (b) {
        return b[0] < work ? [b[0] + 1440, b[1] + 1440] : b;
      });
    }

    // 只保留与工作区间有交集的部分，并按开始时间排序
    breaks = breaks
      .map(function (b) {
        return [Math.max(b[0], work), Math.min(b[1], off)];
      })
      .filter(function (b) { return b[1] > b[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });

    var segs = [];
    var cursor = work;
    for (var i = 0; i < breaks.length; i++) {
      var b = breaks[i];
      if (b[0] > cursor) segs.push([cursor, b[0]]);
      cursor = Math.max(cursor, b[1]);
    }
    if (off > cursor) segs.push([cursor, off]);

    return segs.map(function (s) {
      return { start: atMinutes(dayStartMs, s[0]), end: atMinutes(dayStartMs, s[1]) };
    });
  }

  /** 计薪总分钟（含休息扣除） */
  function paidMinutesOfDay(cfg) {
    var segs = buildPaidSegments(cfg, startOfDay(Date.now()));
    var total = 0;
    segs.forEach(function (s) { total += (s.end - s.start) / MIN; });
    return total;
  }

  /**
   * 每月工作日归一化：非法/缺省 -> 21；0 或负数 -> 1；上限 31。
   * 用 || 会踩到 0 的坑（0 || 21 得 21），所以显式判断。
   */
  function normWorkdays(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) {
      // undefined / null / '' / NaN / 'abc' 视为缺省；显式传 0 或负数则夹到 1
      if (v === 0 || (typeof v === 'number' && n < 0)) return 1;
      return 21;
    }
    return Math.min(31, n);
  }

  /**
   * 计算薪资速率
   * @returns {{dayPay:number, perMin:number, perSec:number, perHour:number, paidMinutes:number}}
   */
  function rates(cfg) {
    var monthly = Math.max(0, Number(cfg.monthlySalary) || 0);
    var workdays = normWorkdays(cfg.workdaysPerMonth);
    var dayPay = monthly / workdays;
    var paidMin = paidMinutesOfDay(cfg);
    var perMin = paidMin > 0 ? dayPay / paidMin : 0;
    return {
      dayPay: dayPay,
      perMin: perMin,
      perSec: perMin / 60,
      perHour: perMin * 60,
      paidMinutes: paidMin
    };
  }

  /**
   * 计算某一时刻的「今日已挣」进度
   * @param {object} cfg 薪资与班表配置
   * @param {number} nowMs 当前时间戳
   * @returns {{earned:number, paidMs:number, totalPaidMs:number, progress:number,
   *            phase:'before'|'working'|'break'|'after', toOffMs:number,
   *            nextBreakStart:number|null, segments:Array, dayStart:number, offMs:number}}
   */
  /**
   * 选出「当前时刻正在经历的班次」的基准日。
   *
   * 日班（下班晚于上班）永远以今天为基准；
   * 跨零点班次（如 22:00→06:00）在凌晨时段，此刻真正在上的其实是
   * 昨天 22:00 开始的那一班，所以基准日要退回一天。
   * 否则 startOfDay(02:30) 已翻到新的一天，而新班次要到 22:00 才开始，
   * 于是 phase 变成 before、金额归零（即 K-001）。
   *
   * @returns {number} 基准日的 0 点时间戳
   */
  function shiftBaseDay(cfg, nowMs) {
    var today = startOfDay(nowMs);
    var work = hhmmToMinutes(cfg.workStart);
    var off = hhmmToMinutes(cfg.workEnd);
    if (work == null || off == null) return today;
    if (off > work) return today; // 日班，不跨零点

    // 跨零点：今天 0 点起算的这一班要到今晚才开工；
    // 若此刻已经过了上班时刻、或还在昨班的下班时刻之前，就落在昨班尾巴上。
    var todaySegs = buildPaidSegments(cfg, today);
    if (!todaySegs.length) return today;
    var todayStart = todaySegs[0].start;
    var todayEnd = todaySegs[todaySegs.length - 1].end;

    // 此刻在「今天的班次」里，就用今天
    if (nowMs >= todayStart && nowMs < todayEnd) return today;

    // 否则看昨天那一班是否还罩着此刻
    var yStart = startOfDay(today - 1);
    var ySegs = buildPaidSegments(cfg, yStart);
    if (ySegs.length) {
      var yS = ySegs[0].start, yE = ySegs[ySegs.length - 1].end;
      if (nowMs >= yS && nowMs < yE) return yStart;
    }
    return today;
  }

  function compute(cfg, nowMs) {
    var dayStart = shiftBaseDay(cfg, nowMs);
    var segs = buildPaidSegments(cfg, dayStart);
    var r = rates(cfg);
    var totalPaidMs = 0;
    var paidMs = 0;
    var phase = 'before';
    var nextBreakStart = null;
    var workStartMs = segs.length ? segs[0].start : dayStart;
    var offMs = segs.length ? segs[segs.length - 1].end : dayStart;

    segs.forEach(function (s) {
      totalPaidMs += s.end - s.start;
      if (nowMs >= s.end) paidMs += s.end - s.start;
      else if (nowMs > s.start) paidMs += nowMs - s.start;
    });

    var inSeg = segs.some(function (s) { return nowMs >= s.start && nowMs < s.end; });
    if (nowMs < workStartMs) {
      phase = 'before';
    } else if (nowMs >= offMs) {
      phase = 'after';
    } else if (inSeg) {
      phase = 'working';
      for (var i = 0; i < segs.length; i++) {
        if (nowMs < segs[i].start) { nextBreakStart = segs[i].start; break; }
      }
    } else {
      phase = 'break';
      nextBreakStart = null;
      for (var j = 0; j < segs.length; j++) {
        if (nowMs < segs[j].start) { nextBreakStart = segs[j].start; break; }
      }
    }

    // 已挣金额按毫秒折算，保证数字平滑滚动、不受取整跳变影响
    var perMs = totalPaidMs > 0 ? r.dayPay / totalPaidMs : 0;
    var earned = perMs * paidMs;

    return {
      earned: earned,
      paidMs: paidMs,
      totalPaidMs: totalPaidMs,
      progress: totalPaidMs > 0 ? paidMs / totalPaidMs : 0,
      perMs: perMs,
      phase: phase,
      toOffMs: Math.max(0, offMs - nowMs),
      toStartMs: Math.max(0, workStartMs - nowMs),
      nextBreakStart: nextBreakStart,
      segments: segs,
      dayStart: dayStart,
      workStart: segs.length ? segs[0].start : dayStart,
      offMs: offMs,
      rates: r
    };
  }

  /** 毫秒 -> "1小时22分44秒"（用于倒计时） */
  function formatDuration(ms, withSeconds) {
    ms = Math.max(0, ms);
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var out = '';
    if (h > 0) out += h + '小时';
    if (h > 0 || m > 0) out += m + '分';
    if (withSeconds !== false) out += (h > 0 || m > 0 ? (s < 10 ? '0' : '') + s : s) + '秒';
    return out || '0秒';
  }

  /** 毫秒 -> "04:43:44" 形式 */
  function formatClock(ms) {
    ms = Math.max(0, ms);
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(h) + ':' + p(m) + ':' + p(s);
  }

  /** 金额格式化：千分位 + 固定小数位 */
  function formatMoney(v, digits) {
    digits = digits == null ? 4 : digits;
    var n = Number(v) || 0;
    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    var fixed = n.toFixed(digits);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + parts.join('.');
  }

  /**
   * 换算成「还能买什么」：按单价从高到低挑最接近的一项
   * @param {number} earned 已挣金额
   * @param {Array<{name:string, price:number, emoji?:string}>} items
   */
  function affordable(earned, items) {
    var out = [];
    (items || []).forEach(function (it) {
      var price = Number(it.price);
      if (!(price > 0) || !it.name) return;
      var count = earned / price;
      out.push({
        name: it.name,
        emoji: it.emoji || '',
        price: price,
        count: count,
        // 还需要多久能买到（用速率换算成秒，调用方再格式化为时长）
        remainAmount: Math.max(0, price - earned)
      });
    });
    return out;
  }

  /**
   * 本月累计：已过工作日按满勤 + 今日按进度
   * @param {object} cfg 含 monthlySalary / workdaysPerMonth
   * @param {number} nowMs
   * @param {number} earnedToday 今日已挣
   */
  function monthToDate(cfg, nowMs, earnedToday) {
    var d = new Date(nowMs);
    var totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    var passedWorkdays = 0;
    for (var day = 1; day <= d.getDate(); day++) {
      var dt = new Date(d.getFullYear(), d.getMonth(), day);
      var wd = dt.getDay();
      // 默认周一至周五为工作日；实际口径以 workdaysPerMonth 校准
      if (wd !== 0 && wd !== 6) passedWorkdays++;
    }
    if (passedWorkdays < 1) passedWorkdays = 1;
    var workdays = normWorkdays(cfg.workdaysPerMonth);
    var dayPay = (Number(cfg.monthlySalary) || 0) / workdays;
    var fullDays = passedWorkdays - 1;
    return {
      total: fullDays * dayPay + earnedToday,
      fullDays: fullDays,
      passedWorkdays: passedWorkdays,
      planDays: workdays,
      totalDaysInMonth: totalDays,
      dayPay: dayPay
    };
  }

  var DEFAULT_ITEMS = [
    { name: '矿泉水', price: 2 },
    { name: '地铁一趟', price: 6 },
    { name: '肉夹馍', price: 12 },
    { name: '瑞幸一杯', price: 13.9 },
    { name: '奶茶一杯', price: 18 },
    { name: '炸鸡一份', price: 39 },
    { name: '电影票', price: 45 },
    { name: '一天房租', price: 70 }
  ];

  return {
    MIN: MIN,
    hhmmToMinutes: hhmmToMinutes,
    minutesToHHMM: minutesToHHMM,
    startOfDay: startOfDay,
    buildPaidSegments: buildPaidSegments,
    paidMinutesOfDay: paidMinutesOfDay,
    rates: rates,
    compute: compute,
    shiftBaseDay: shiftBaseDay,
    formatDuration: formatDuration,
    formatClock: formatClock,
    formatMoney: formatMoney,
    affordable: affordable,
    monthToDate: monthToDate,
    DEFAULT_ITEMS: DEFAULT_ITEMS
  };
});
