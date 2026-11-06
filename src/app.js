/**
 * app.js — 界面渲染、状态同步与本地持久化
 * 计薪全部交给 earn.js（纯函数），这里只负责「取数 → 画界面 → 存配置」。
 */
(function () {
  'use strict';

  var E = window.EarnCore;

  /* ---------------- 常量 ---------------- */
  var LS_KEY = 'niuniu-encourager:settings:v1';
  var MASK_KEY = 'niuniu-encourager:mask:v1';
  var HIST_KEY = 'niuniu-encourager:history:v1';

  var DEFAULT_GOALS = [
    { emoji: '☕', name: '一杯瑞幸', price: 13.9 },
    { emoji: '🍜', name: '一顿午饭', price: 28 },
    { emoji: '🎧', name: '无线耳机', price: 399 },
    { emoji: '📱', name: '换台新手机', price: 5999 },
    { emoji: '💻', name: 'MacBook Air', price: 8999 },
    { emoji: '🏖️', name: '一周旅行', price: 12000 }
  ];

  var DEFAULT_SETTINGS = {
    monthlySalary: 12000,
    workdaysPerMonth: 21,
    workStart: '09:00',
    workEnd: '18:00',
    lunchEnabled: true,
    lunchStart: '12:00',
    lunchEnd: '13:00',
    dinnerEnabled: false,
    dinnerStart: '18:00',
    dinnerEnd: '19:00',
    digits: 4,
    autoStart: false,
    goals: DEFAULT_GOALS.slice()
  };

  var ENCOURAGEMENTS = [
    '你不是在打工，你是在给自己的账户充值。',
    '时间在走，钱在长，人没动。',
    '每敲一下键盘，余额就往前挪一点点。',
    '今天的你，正在以每分钟几百块的速度生活。',
    '钱是慢慢长的，人是慢慢熬的，都不容易。',
    '先把这一小时赚完，剩下的交给下班。',
    '你今天的时薪，是你曾经熬过的夜换来的。',
    '别急，数字不会骗人，它在替你记着。',
    '摸鱼也是在计薪的，放心摸。',
    '再撑一会儿，晚饭就有底气点加鸡腿了。',
    '你不是牛马，你是有秒薪的牛马。',
    '坚持一下，这笔钱就要进你口袋了。'
  ];

  var TICKERS = [
    '积少成多', '涓涓细流', '币在增生', '到账中…', '每分每秒都在涨',
    '稳住，能赢', '钱正在路上', '余额 +1'
  ];

  /* ---------------- 运行时状态 ---------------- */
  var settings = loadSettings();
  var masked = localStorage.getItem(MASK_KEY) === '1';
  var goalIndex = 0;
  var lastTexts = {};
  var isElectron = !!(window.desktop && window.desktop.isElectron);

  var H = window.HistoryCore;
  var history = loadHistory();
  var lastHistWrite = 0;    // 上次落盘时间，用于节流
  var afterDayWritten = ''; // 已经写过收尾记录的日期
  var reportRenderedOn = '';

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    clock: $('clock'),
    statusDot: $('statusDot'),
    statusText: $('statusText'),
    statusPill: $('statusPill'),
    monthTotal: $('monthTotal'),
    monthPlan: $('monthPlan'),
    monthLeft: $('monthLeft'),
    heroNote: $('heroNote'),
    ratePerMin: $('ratePerMin'),
    earnedInt: $('earnedInt'),
    earnedFrac: $('earnedFrac'),
    earnedHint: $('earnedHint'),
    ticker: $('ticker'),
    progressFill: $('progressFill'),
    progressPct: $('progressPct'),
    progressTime: $('progressTime'),
    cdLabel: $('cdLabel'),
    cdValue: $('cdValue'),
    cdSub: $('cdSub'),
    cdFill: $('cdFill'),
    rSec: $('rSec'),
    rMin: $('rMin'),
    rHour: $('rHour'),
    rDay: $('rDay'),
    convertSum: $('convertSum'),
    convertList: $('convertList'),
    goalEmoji: $('goalEmoji'),
    goalName: $('goalName'),
    goalFill: $('goalFill'),
    goalPct: $('goalPct'),
    goalNote: $('goalNote'),
    alLunar: $('alLunar'),
    alGanzhi: $('alGanzhi'),
    alAnimal: $('alAnimal'),
    alLuckBadge: $('alLuckBadge'),
    alYi: $('alYi'),
    alJi: $('alJi'),
    alExtra: $('alExtra'),
    alTip: $('alTip'),
    alWeek: $('alWeek'),
    rpMonth: $('rpMonth'),
    rpDays: $('rpDays'),
    rpAvg: $('rpAvg'),
    rpBest: $('rpBest'),
    rpCal: $('rpCal'),
    rpNote: $('rpNote'),
    reportStreak: $('reportStreak'),
    encourageText: $('encourageText'),
    toast: $('toast'),
    settingsMask: $('settingsMask'),
    goalEditor: $('goalEditor'),
    appVersion: $('appVersion')
  };

  /* ---------------- 设置读写 ---------------- */
  function normalize(s) {
    var out = Object.assign({}, DEFAULT_SETTINGS, s || {});
    out.monthlySalary = Math.max(0, Number(out.monthlySalary) || 0);
    out.workdaysPerMonth = Math.min(31, Math.max(1, Math.round(Number(out.workdaysPerMonth) || 21)));
    out.digits = [2, 3, 4, 6].indexOf(Number(out.digits)) >= 0 ? Number(out.digits) : 4;
    out.autoStart = !!out.autoStart;
    out.lunchEnabled = out.lunchEnabled !== false;
    out.dinnerEnabled = !!out.dinnerEnabled;
    if (!Array.isArray(out.goals) || !out.goals.length) out.goals = DEFAULT_GOALS.slice();
    out.goals = out.goals
      .filter(function (g) { return g && g.name; })
      .map(function (g) {
        return { emoji: g.emoji || '🎯', name: String(g.name).slice(0, 12), price: Math.max(0.01, Number(g.price) || 1) };
      })
      .slice(0, 20);
    return out;
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return normalize(DEFAULT_SETTINGS);
      return normalize(JSON.parse(raw));
    } catch (e) {
      return normalize(DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ---------------- 每日打卡记录 ---------------- */

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function saveHistory() {
    if (!H) return;
    try {
      history = H.prune(history, Date.now());
      localStorage.setItem(HIST_KEY, JSON.stringify(history));
    } catch (e) { /* 存不下就算了，不能影响计薪 */ }
  }

  /**
   * 记录今天的进度。
   * 主循环 50ms 一次，绝不能每次都写 localStorage（会卡）。
   * 这里节流到最多每分钟落盘一次，下班时强制写一次收尾。
   */
  function recordProgress(c, now) {
    if (!H) return;
    if (c.earned <= 0) return;

    var isAfter = c.phase === 'after';
    // 下班后金额已经封顶，只需写一次；工作中按分钟节流
    if (isAfter) {
      if (afterDayWritten === H.dayKey(now)) return;
    } else if ((now - lastHistWrite) < 60000) {
      return;
    }

    lastHistWrite = now;
    if (isAfter) afterDayWritten = H.dayKey(now);
    if (H.upsert(history, now, c.earned, c.paidMs)) saveHistory();
  }

  /* ---------------- 工具 ---------------- */
  var textCache = {};
  function setText(node, key, text) {
    if (!node) return;
    if (textCache[key] === text) return;
    textCache[key] = text;
    node.textContent = text;
  }
  function setWidth(node, pct) {
    if (!node) return;
    node.style.width = Math.max(0, Math.min(100, pct * 100)).toFixed(2) + '%';
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('show');
      setTimeout(function () { el.toast.hidden = true; }, 260);
    }, 1800);
  }

  function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

  /* ---------------- 渲染 ---------------- */
  function render(now) {
    var d = new Date(now);
    var c = E.compute(settings, now);
    var r = c.rates;
    var digits = settings.digits;

    /* 时钟与状态 */
    setText(el.clock, 'clock', [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) { return (n < 10 ? '0' : '') + n; }).join(':'));

    var statusMap = {
      before: ['未开工', 'off'],
      working: ['上班中', ''],
      break: ['休息中', 'break'],
      after: ['已下班', 'off']
    };
    var st = statusMap[c.phase];
    setText(el.statusText, 'status', st[0]);
    var dotClass = 'dot' + (st[1] ? ' ' + st[1] : '');
    if (el.statusDot.className !== dotClass) el.statusDot.className = dotClass;

    /* 主金额：整数部分与小数部分分开排，数字跳动时不抖动 */
    var money = E.formatMoney(c.earned, digits);
    var parts = money.split('.');
    setText(el.earnedInt, 'earnedInt', parts[0]);
    setText(el.earnedFrac, 'earnedFrac', '.' + (parts[1] || ''));

    setText(el.ratePerMin, 'ratePerMin', '每分钟 +¥' + E.formatMoney(r.perMin, 4));

    var remain = Math.max(0, r.dayPay - c.earned);
    var hint = c.phase === 'after'
      ? '今日满勤到手，收工愉快 🎉'
      : c.phase === 'before'
        ? (c.toStartMs > 0 ? '还有 ' + E.formatDuration(c.toStartMs, true) + ' 开工' : '准备开工')
        : '还差 ¥' + E.formatMoney(remain, 2) + ' 到今日满勤';
    setText(el.earnedHint, 'earnedHint', hint);
    setText(el.heroNote, 'heroNote', c.phase === 'after' ? '· 已结算' : '· 估算');

    /* 进度 */
    setWidth(el.progressFill, c.progress);
    setText(el.progressPct, 'progressPct', (c.progress * 100).toFixed(1) + '%');
    setText(el.progressTime, 'progressTime',
      '已工作 ' + (c.paidMs / 3600000).toFixed(2) + ' / ' + (c.totalPaidMs / 3600000).toFixed(2) + ' 小时');

    /* 倒计时 */
    var cdLabel, cdValue, cdSub, cdProgress;
    if (c.phase === 'before') {
      cdLabel = '距离开工还有';
      cdValue = E.formatClock(c.toStartMs);
      cdSub = settings.workStart + ' 上班';
      cdProgress = 1 - (c.toStartMs / (6 * 3600000));
    } else if (c.phase === 'after') {
      cdLabel = '今日已收工';
      cdValue = '已下班';
      cdSub = '今天辛苦了，明天继续';
      cdProgress = 1;
    } else if (c.phase === 'break') {
      cdLabel = '休息中 · 距离下次计薪还有';
      cdValue = c.nextBreakStart ? E.formatClock(c.nextBreakStart - now) : '--:--:--';
      cdSub = '休息时间不计薪，好好歇';
      cdProgress = c.progress;
    } else {
      cdLabel = '距离下班还有';
      cdValue = E.formatClock(c.toOffMs);
      cdSub = settings.workEnd + ' 收工 · 时间进度 ' + (c.progress * 100).toFixed(0) + '%';
      cdProgress = c.progress;
    }
    setText(el.cdLabel, 'cdLabel', cdLabel);
    setText(el.cdValue, 'cdValue', cdValue);
    setText(el.cdSub, 'cdSub', cdSub);
    el.cdValue.classList.toggle('urgent', c.phase !== 'after' && c.toOffMs > 0 && c.toOffMs < 30 * 60000);
    setWidth(el.cdFill, Math.max(0, Math.min(1, cdProgress)));

    /* 速率 */
    setText(el.rSec, 'rSec', E.formatMoney(r.perSec, 4));
    setText(el.rMin, 'rMin', E.formatMoney(r.perMin, 4));
    setText(el.rHour, 'rHour', E.formatMoney(r.perHour, 2));
    setText(el.rDay, 'rDay', E.formatMoney(r.dayPay, 2));

    /* 本月 */
    var m = E.monthToDate(settings, now, c.earned);
    setText(el.monthTotal, 'monthTotal', '¥' + E.formatMoney(m.total, 2));
    setText(el.monthPlan, 'monthPlan', m.planDays + ' 天');
    var leftDays = Math.max(0, daysInMonth(d) - d.getDate());
    setText(el.monthLeft, 'monthLeft', leftDays + ' 个自然日');

    /* 换算清单 */
    renderConvert(c.earned);

    /* 小目标 */
    renderGoal(c, r);

    /* 黄历：内部自带「每天只渲染一次」的判断 */
    renderAlmanac(now);

    /* 打卡记录（内部按分钟节流）与战报 */
    recordProgress(c, now);
    renderReport(now);

    /* 打码 */
    document.body.classList.toggle('masked', masked);

    /* 迷你窗标题栏/系统托盘同步 */
    if (isElectron && window.desktop.updateTicker) {
      window.desktop.updateTicker(masked ? '¥***' : '¥' + E.formatMoney(c.earned, 2));
    }
  }

  function renderConvert(earned) {
    var items = E.affordable(earned, E.DEFAULT_ITEMS);
    setText(el.convertSum, 'convertSum', '¥' + E.formatMoney(earned, settings.digits));

    var html = items.map(function (it) {
      var n = Math.floor(it.count);
      var label, hit;
      if (n >= 1) {
        label = '×' + (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n);
        hit = true;
      } else if (it.count >= 0.1) {
        label = (it.count * 100).toFixed(0) + '%';
        hit = false;
      } else {
        label = '还需 ¥' + E.formatMoney(it.remainAmount, 0);
        hit = false;
      }
      return '<li><span class="ci-dot"></span>' +
        '<span class="ci-name">' + it.name + '</span>' +
        '<span class="ci-count' + (hit ? ' hit' : '') + '">' + label + '</span></li>';
    }).join('');
    if (lastTexts.convert !== html) {
      lastTexts.convert = html;
      el.convertList.innerHTML = html;
    }
  }

  function renderGoal(c, r) {
    var goals = settings.goals;
    if (goalIndex >= goals.length) goalIndex = 0;
    var g = goals[goalIndex];
    if (!g) return;

    setText(el.goalEmoji, 'goalEmoji', g.emoji);
    el.goalName.innerHTML = '<span>' + escapeHtml(g.name) + '</span>' +
      '<span class="goal-price">¥' + E.formatMoney(g.price, g.price % 1 === 0 ? 0 : 2) + '</span>';

    var pct = g.price > 0 ? c.earned / g.price : 0;
    setWidth(el.goalFill, Math.min(1, pct));
    setText(el.goalPct, 'goalPct', pct >= 1 ? '达成' : (pct * 100).toFixed(pct < 0.1 ? 1 : 0) + '%');

    var note;
    if (pct >= 1) {
      note = '今天已经赚回来了，去买吧 ✅';
    } else if (r.perSec > 0) {
      var needMs = ((g.price - c.earned) / r.perSec) * 1000;
      var workLeftMs = Math.max(0, c.toOffMs);
      if (c.phase === 'after') {
        note = '今天还差 ¥' + E.formatMoney(g.price - c.earned, 2) + '，明天继续';
      } else if (needMs <= workLeftMs) {
        note = '再干 ' + E.formatDuration(needMs, false) + '，下班前就能拿下';
      } else {
        note = '还要再干 ' + (needMs / 3600000).toFixed(1) + ' 小时，约 ' +
          (needMs / (8 * 3600000)).toFixed(1) + ' 个工作日';
      }
    } else {
      note = '先填一下月薪，才知道要干多久';
    }
    setText(el.goalNote, 'goalNote', note);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  /* ---------------- 本月战报 ----------------
   * 统计口径来自 history.js（纯函数），这里只负责画。
   * 战报一天只变一次，所以按「日期 + 当月记录数」做键，避免 50ms 重绘。
   */
  function renderReport(now) {
    if (!H || !el.rpCal) return;

    var month = H.thisMonth(history, now);
    var days = H.calendar(history, now);
    var streakDays = H.streak(history, now);
    var key = H.dayKey(now) + '|' + month.days;
    if (key === reportRenderedOn) return;
    reportRenderedOn = key;

    setText(el.rpMonth, 'rpMonth', '¥' + E.formatMoney(month.total, 2));
    el.rpDays.innerHTML = '<span class="rp-num">' + month.days +
      '</span><span class="rp-unit"> 天</span>';
    setText(el.rpAvg, 'rpAvg', month.days > 0
      ? '¥' + E.formatMoney(month.avgPerDay, 2) : '—');
    // 只有一天数据时，"最高"和"本月到手"必然相同，看起来像 bug
    var hasCompare = !!(month.best && month.days >= 2);
    setText(el.rpBest, 'rpBest',
      hasCompare ? '¥' + E.formatMoney(month.best.earned, 2) : '待累计');
    el.rpBest.classList.toggle('rp-empty', !hasCompare);
    if (streakDays > 0) {
      el.reportStreak.innerHTML = '连续 ' + streakDays + ' 天';
    } else {
      setText(el.reportStreak, 'reportStreak', '还没开始攒');
    }

    var todayKey = H.dayKey(now);

    // 按真实星期对齐：1 号前面补空格，周日排在一周的最后
    // 注意 now 是时间戳（number），不是 Date 对象
    var nd = new Date(now);
    var firstDow = new Date(nd.getFullYear(), nd.getMonth(), 1).getDay();
    var lead = firstDow === 0 ? 6 : firstDow - 1;   // 周一=0 … 周日=6
    var blanks = '';
    for (var b = 0; b < lead; b++) blanks += '<span class="rp-day rp-blank"></span>';

    // 星期表头（周一起，与格子列序一致）
    var head = ['一', '二', '三', '四', '五', '六', '日']
      .map(function (w) { return '<span class="rp-dow">' + w + '</span>'; })
      .join('');

    el.rpCal.innerHTML = head + blanks + days.map(function (d) {
      var cls = 'rp-day lv' + d.level;
      if (d.future) cls += ' future';
      else if (d.earned <= 0 && d.key !== todayKey) cls += ' missed';
      if (d.key === todayKey) cls += ' today';
      return '<span class="' + cls + '" title="' +
        escapeHtml(d.key + (d.earned > 0 ? ' · ¥' + E.formatMoney(d.earned, 2) : ' · 无记录')) +
        '">' + d.day + '</span>';
    }).join('');

    // 补满最后一行，保证网格整齐
    var totalCells = lead + days.length;
    var tail = (7 - (totalCells % 7)) % 7;
    for (var t = 0; t < tail; t++) {
      el.rpCal.insertAdjacentHTML('beforeend', '<span class="rp-day rp-blank"></span>');
    }

    /* 底部一句话：按当前进度给不同的说法 */
    var passed = month.passedDays || 1;
    var pace = month.days / passed;
    var note;
    if (month.days === 0) {
      note = '今天下班后会自动记第一笔，攒着看才有意思。';
    } else if (pace >= 0.9) {
      note = '这个月几乎天天在岗，' + month.days + ' 天里有 ' + month.days + ' 天到账。';
    } else if (month.days === 1 && month.best) {
      note = '目前只有 1 天记录，攒到第 2 天就能比出高低了。';
    } else if (month.best) {
      note = '目前最高的一天是 ' + month.best.key.slice(5).replace('-', '/') +
        '，那天进账 ¥' + E.formatMoney(month.best.earned, 2) + '。';
    } else {
      note = '已记录 ' + month.days + ' 天，继续攒。';
    }
    setText(el.rpNote, 'rpNote', note);
  }

  /* ---------------- 今日黄历 ----------------
   * 黄历一天只变一次，绝不能跟着 50ms 的主循环重绘：
   * 这里记下已渲染的日期，只有跨天或首次进入才重建 DOM。
   */
  var almanacDay = '';
  var almanacOpen = false;

  function renderAlmanac(now) {
    if (!window.Almanac) return;
    var d = new Date(now);
    var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    if (key === almanacDay) return;
    almanacDay = key;

    var a;
    try {
      a = window.Almanac.of(d);
    } catch (e) {
      return; // 黄历是锦上添花，算不出来就整块留空，不影响计薪
    }
    if (!a || !a.ymd) return;

    setText(el.alLunar, 'alLunar', a.lunar ? a.lunar.text : '');
    var gz = a.ganZhi || {};
    setText(el.alGanzhi, 'alGanzhi', [gz.year, gz.month, gz.day].filter(Boolean).join(' · '));
    setText(el.alAnimal, 'alAnimal', a.shengXiao ? '属' + a.shengXiao : '');

    /* 黄道 / 黑道 */
    var badge = el.alLuckBadge;
    if (badge) {
      var isLuck = a.luck === '吉';
      badge.textContent = (a.tianShen || '—') + (a.tianShenType ? ' · ' + a.tianShenType : '') +
        (isLuck ? ' · 吉' : ' · 凶');
      badge.classList.toggle('luck-ji', isLuck);
    }

    renderTags(el.alYi, a.yi, 'yi', '宜');
    renderTags(el.alJi, a.ji, 'ji', '忌');

    /* 节气 / 节日 */
    var extras = [];
    if (a.jieQi) extras.push('节气 · ' + a.jieQi);
    if (a.festivals && a.festivals.length) extras.push(a.festivals.join(' · '));
    if (extras.length) {
      el.alExtra.textContent = extras.join('　');
      el.alExtra.hidden = false;
    } else {
      el.alExtra.hidden = true;
    }

    setText(el.alTip, 'alTip', a.tip || '');

    if (almanacOpen) renderWeek(d);
  }

  function renderTags(node, list, cls, kind) {
    if (!node) return;
    var arr = (list || []).slice(0, 4);
    if (!arr.length) {
      node.innerHTML = '<span class="al-tag">' + (kind === '宜' ? '诸事不宜' : '百无禁忌') + '</span>';
      return;
    }
    node.innerHTML = arr.map(function (t) {
      return '<span class="al-tag ' + cls + '">' + escapeHtml(t) + '</span>';
    }).join('');
  }

  function renderWeek(d) {
    if (!el.alWeek) return;
    var days;
    try {
      days = window.Almanac.upcoming(d, 7);
    } catch (e) {
      return;
    }
    var todayYmd = days.length ? days[0].ymd : '';
    el.alWeek.innerHTML = days.map(function (x) {
      var isToday = x.ymd === todayYmd;
      var terms = (x.yi || []).slice(0, 2).join('、') || '诸事不宜';
      var md = x.ymd ? x.ymd.slice(5).replace('-', '/') : '';
      // 农历初一显示「十月初一」，其余只显示日，既简洁又不歧义
      var cn = x.dayCn === '初一' && x.monthCn ? x.monthCn + '月初一' : (x.dayCn || '');
      return '<div class="al-week-row' + (isToday ? ' today' : '') + '">' +
        '<span class="al-wd">' + escapeHtml(md) + '</span>' +
        '<span class="al-wd-cn">' + escapeHtml(cn) + '</span>' +
        '<span class="al-luck ' + (x.luck === '吉' ? 'ji' : 'xiong') + '">' +
          (x.luck === '吉' ? '吉' : '凶') + '</span>' +
        '<span class="al-week-terms"><i class="al-yi-k">宜</i>' + escapeHtml(terms) + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 鼓励语 / 小标语 ---------------- */
  function nextEncouragement() {
    var cur = el.encourageText.textContent;
    var pick = cur;
    for (var i = 0; i < 6 && pick === cur; i++) {
      pick = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
    }
    el.encourageText.style.opacity = '0';
    setTimeout(function () {
      el.encourageText.textContent = pick;
      el.encourageText.style.opacity = '1';
    }, 180);
  }

  var tickerIdx = 0;
  function rotateTicker() {
    tickerIdx = (tickerIdx + 1) % TICKERS.length;
    setText(el.ticker, 'ticker', TICKERS[tickerIdx]);
  }

  /* ---------------- 设置面板 ---------------- */
  function fillSettingsForm() {
    $('inSalary').value = settings.monthlySalary || '';
    $('inWorkdays').value = settings.workdaysPerMonth;
    $('inWorkStart').value = settings.workStart;
    $('inWorkEnd').value = settings.workEnd;
    $('inLunchOn').checked = settings.lunchEnabled;
    $('inLunchStart').value = settings.lunchStart;
    $('inLunchEnd').value = settings.lunchEnd;
    $('inDinnerOn').checked = settings.dinnerEnabled;
    $('inDinnerStart').value = settings.dinnerStart;
    $('inDinnerEnd').value = settings.dinnerEnd;
    $('inDigits').value = String(settings.digits);
    $('inStartup').checked = settings.autoStart;
    $('lunchRow').hidden = !settings.lunchEnabled;
    $('dinnerRow').hidden = !settings.dinnerEnabled;
    renderGoalEditor();
    if (isElectron) {
      window.desktop.getVersion().then(function (v) {
        if (v) setText(el.appVersion, 'ver', v);
      }).catch(function () {});
    }
  }

  function renderGoalEditor() {
    el.goalEditor.innerHTML = settings.goals.map(function (g, i) {
      return '<div class="ge-item" data-i="' + i + '">' +
        '<input class="ge-emoji" value="' + escapeHtml(g.emoji) + '" maxlength="3" title="表情">' +
        '<input class="ge-name" value="' + escapeHtml(g.name) + '" maxlength="12" title="目标名称">' +
        '<input class="ge-price" type="number" min="0.01" step="1" value="' + g.price + '" title="价格">' +
        '<button class="ge-del" title="删除">✕</button>' +
        '</div>';
    }).join('');
  }

  function openSettings() {
    fillSettingsForm();
    el.settingsMask.hidden = false;
  }
  function closeSettings() {
    el.settingsMask.hidden = true;
    commitGoalEditor();
    saveSettings();
    applyAutoStart();
    render(Date.now());
  }

  function commitGoalEditor() {
    var items = el.goalEditor.querySelectorAll('.ge-item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var name = it.querySelector('.ge-name').value.trim();
      if (!name) continue;
      out.push({
        emoji: it.querySelector('.ge-emoji').value.trim() || '🎯',
        name: name.slice(0, 12),
        price: Math.max(0.01, Number(it.querySelector('.ge-price').value) || 1)
      });
    }
    if (out.length) settings.goals = out.slice(0, 20);
  }

  function applyAutoStart() {
    if (!isElectron) return;
    window.desktop.setAutoStart(settings.autoStart).catch(function () {
      toast('开机自启设置失败，可能被系统策略拦截');
    });
  }

  function bindInput(id, key, transform) {
    var node = $(id);
    if (!node) return;
    node.addEventListener('input', function () {
      var v = node.value;
      settings[key] = transform ? transform(v) : v;
      saveSettings();
      render(Date.now());
    });
  }

  function bindCheckbox(id, key, after) {
    var node = $(id);
    if (!node) return;
    node.addEventListener('change', function () {
      settings[key] = node.checked;
      saveSettings();
      if (after) after();
      render(Date.now());
    });
  }

  /* ---------------- 交互绑定 ---------------- */
  function bind() {
    bindInput('inSalary', 'monthlySalary', function (v) { return Math.max(0, Number(v) || 0); });
    bindInput('inWorkdays', 'workdaysPerMonth', function (v) {
      return Math.min(31, Math.max(1, Math.round(Number(v) || 21)));
    });
    bindInput('inWorkStart', 'workStart');
    bindInput('inWorkEnd', 'workEnd');
    bindInput('inLunchStart', 'lunchStart');
    bindInput('inLunchEnd', 'lunchEnd');
    bindInput('inDinnerStart', 'dinnerStart');
    bindInput('inDinnerEnd', 'dinnerEnd');

    $('inDigits').addEventListener('change', function () {
      settings.digits = Number($('inDigits').value) || 4;
      saveSettings();
      render(Date.now());
    });

    bindCheckbox('inLunchOn', 'lunchEnabled', function () { $('lunchRow').hidden = !settings.lunchEnabled; });
    bindCheckbox('inDinnerOn', 'dinnerEnabled', function () { $('dinnerRow').hidden = !settings.dinnerEnabled; });
    bindCheckbox('inStartup', 'autoStart', applyAutoStart);

    $('btnSettings').addEventListener('click', openSettings);
    $('btnCloseSettings').addEventListener('click', closeSettings);
    el.settingsMask.addEventListener('click', function (e) {
      if (e.target === el.settingsMask) closeSettings();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.settingsMask.hidden) closeSettings();
    });

    /* 打码 */
    $('btnMask').addEventListener('click', function () {
      masked = !masked;
      localStorage.setItem(MASK_KEY, masked ? '1' : '0');
      $('btnMask').classList.toggle('active', masked);
      document.body.classList.toggle('masked', masked);
      toast(masked ? '金额已打码，工位安全' : '金额已显示');
    });
    $('btnMask').classList.toggle('active', masked);

    /* 主题 */
    $('btnTheme').addEventListener('click', function () {
      var night = document.body.classList.toggle('theme-night');
      document.body.classList.toggle('theme-paper', !night);
      localStorage.setItem('niuniu-encourager:theme', night ? 'night' : 'paper');
    });

    /* 置顶 / 迷你窗 */
    $('btnPin').addEventListener('click', function () {
      if (!isElectron) { toast('置顶仅在桌面应用中可用'); return; }
      window.desktop.toggleAlwaysOnTop().then(function (on) {
        $('btnPin').classList.toggle('active', on);
        toast(on ? '窗口已置顶' : '取消置顶');
      });
    });

    $('btnMini').addEventListener('click', function () {
      if (isElectron) {
        window.desktop.toggleMini().then(function (mini) {
          document.body.classList.toggle('mode-mini', mini);
        });
      } else {
        toast('迷你窗仅在桌面应用中可用');
      }
    });

    /* 小目标切换 */
    var goalsCard = document.querySelector('.goals');
    if (goalsCard) {
      goalsCard.addEventListener('click', function () {
        goalIndex = (goalIndex + 1) % settings.goals.length;
        render(Date.now());
      });
    }

    $('btnEncourage').addEventListener('click', nextEncouragement);

    /* 黄历：展开最近 7 天 */
    var btnMore = $('btnAlmanacMore');
    if (btnMore) {
      btnMore.addEventListener('click', function () {
        almanacOpen = !almanacOpen;
        btnMore.setAttribute('aria-expanded', almanacOpen ? 'true' : 'false');
        el.alWeek.hidden = !almanacOpen;
        if (almanacOpen) renderWeek(new Date());
      });
    }

    /* 目标编辑 */
    el.goalEditor.addEventListener('click', function (e) {
      var btn = e.target.closest('.ge-del');
      if (!btn) return;
      btn.closest('.ge-item').remove();
    });
    $('btnAddGoal').addEventListener('click', function () {
      commitGoalEditor();
      if (settings.goals.length >= 20) { toast('最多 20 个目标'); return; }
      settings.goals.push({ emoji: '🎯', name: '新目标', price: 100 });
      saveSettings();
      renderGoalEditor();
    });

    /* 导入导出 */
    $('btnExport').addEventListener('click', function () {
      commitGoalEditor();
      var data = JSON.stringify({
        app: 'work-encourager',
        version: 2,          // v2 起带上打卡记录
        exportedAt: new Date().toISOString(),
        settings: settings,
        history: history
      }, null, 2);
      if (isElectron) {
        window.desktop.exportConfig(data).then(function (file) {
          if (file) toast('已导出到 ' + file);
        });
      } else {
        var blob = new Blob([data], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'work-encourager-config.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('已导出配置文件');
      }
    });

    $('btnImport').addEventListener('click', function () { $('fileImport').click(); });
    $('fileImport').addEventListener('change', function () {
      var f = $('fileImport').files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(String(reader.result));
          var s = obj && obj.settings ? obj.settings : obj;
          settings = normalize(s);
          saveSettings();

          // 老版本配置没有 history 字段，有就一起恢复
          if (obj && obj.history && typeof obj.history === 'object') {
            history = H ? H.prune(obj.history, Date.now()) : obj.history;
            saveHistory();
            reportRenderedOn = '';
          }

          fillSettingsForm();
          render(Date.now());
          toast(obj && obj.history ? '配置与打卡记录已导入' : '配置已导入');
        } catch (err) {
          toast('文件格式不对，导入失败');
        }
      };
      reader.readAsText(f);
      $('fileImport').value = '';
    });

    /* 重置 */
    $('btnReset').addEventListener('click', function () {
      if (!window.confirm('确定恢复默认设置吗？薪资和作息会被清空。')) return;
      settings = normalize(DEFAULT_SETTINGS);
      goalIndex = 0;
      saveSettings();
      fillSettingsForm();
      render(Date.now());
      toast('已恢复默认设置');
    });

    /* 迷你窗：双击回到主面板；点 ✕ 收起 */
    var heroEl = document.querySelector('.hero');
    if (heroEl) {
      heroEl.addEventListener('dblclick', function (e) {
        if (!isElectron) return;
        if (e.target.closest('#btnMiniClose')) return;
        window.desktop.openMain();
      });
    }
    var btnCloseMini = $('btnMiniClose');
    if (btnCloseMini) {
      btnCloseMini.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isElectron) window.desktop.toggleMini().then(function () {
          document.body.classList.remove('mode-mini');
        });
      });
    }
  }

  /* ---------------- 首次引导 ---------------- */
  function showWelcome() {
    var w = $('welcome');
    if (!w) return;
    w.hidden = false;
    setTimeout(function () { $('wcSalary').focus(); }, 320);

    var go = function () {
      var salary = Math.max(0, Number($('wcSalary').value) || 0);
      if (!(salary > 0)) {
        toast('先把月薪填上，才知道每秒值多少钱');
        $('wcSalary').focus();
        return;
      }
      settings.monthlySalary = salary;
      settings.workStart = $('wcStart').value || '09:00';
      settings.workEnd = $('wcEnd').value || '18:00';
      settings.workdaysPerMonth = Math.min(31, Math.max(1, Math.round(Number($('wcDays').value) || 21)));
      saveSettings();
      w.hidden = true;
      render(Date.now());
      toast('开工，钱开始长了');
    };

    $('wcGo').addEventListener('click', go);
    $('wcSalary').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') go();
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    var theme = localStorage.getItem('niuniu-encourager:theme');
    if (theme === 'night') {
      document.body.classList.remove('theme-paper');
      document.body.classList.add('theme-night');
    }
    bind();

    // 迷你窗（?mini=1）一进来就切到紧凑布局
    if (/[?&]mini=1/.test(location.search)) {
      document.body.classList.add('mode-mini');
    }

    render(Date.now());

    setInterval(function () { render(Date.now()); }, 50);
    setInterval(rotateTicker, 4200);

    // 首次使用：走三步引导
    if (!localStorage.getItem(LS_KEY)) {
      showWelcome();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
