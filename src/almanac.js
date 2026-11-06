/**
 * almanac.js — 黄历内核（F1 模块）
 * 不依赖 DOM / Electron，可在浏览器、Node（测试）中直接使用。
 *
 * 职责：
 *   1. 用 lunar-javascript 算出某一天的农历、干支、宜忌、值神（黄道/黑道）、建除、二十八宿、冲煞、节气、节日；
 *   2. 把黄历术语「通俗化」成打工人能看懂的话（humanize），并在输出前过滤掉安葬、破土这类观感不佳/与职场无关的条目；
 *   3. 给出 0-100 的今日运势评分（score）和一句 tip。
 *
 * 契约见 docs/v1.1-spec.md「F1 黄历模块契约」。
 * 任何边界日期（库返回 undefined / 抛错）都必须降级为安全空值，绝不抛异常。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Almanac = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 依赖加载：Node 用 require；浏览器用打包时内联的 window.LunarSolar
   * ------------------------------------------------------------------ */

  function getLib() {
    try {
      if (typeof require === 'function') return require('lunar-javascript');
    } catch (e) { /* 浏览器里没有 require，往下找全局 */ }
    // 浏览器：lunar.js 是 UMD，没有 module 时会把自己的导出挂到全局（Solar / Lunar ...）
    if (typeof self !== 'undefined' && self && self.Solar) {
      return { Solar: self.Solar, Lunar: self.Lunar };
    }
    if (typeof window !== 'undefined' && window && window.LunarSolar) return window.LunarSolar;
    return null;
  }

  var LIB = getLib();

  /* ------------------------------------------------------------------ *
   * 词表
   * ------------------------------------------------------------------ */

  // 术语 -> 通俗说法（规格表 + 少量常用补充）
  var HUMANIZE = {
    '嫁娶': '结婚',
    '开市': '开张/启动新项目',
    '出行': '出差/出门',
    '会亲友': '约饭/见朋友',
    '纳财': '收钱/报账',
    '求财': '谈钱/要预算',
    '交易': '签合同',
    '动土': '动工/搬家装修',
    '安床': '换床/换个地方睡',
    '移徙': '搬家',
    '入宅': '搬新家',
    '立券': '签单',
    '订盟': '定合作',
    '祭祀': '拜拜/求个心安',
    '祈福': '许愿',
    '求医': '看病/体检',
    '栽种': '种点绿植',
    '扫舍': '大扫除',
    '破土': '挖坑（别多想）',
    '开光': '开箱新东西',
    '拆卸': '拆旧东西',
    '修造': '修修补补',
    '安葬': '——',
    // 补充常用条目，尽量减少生僻原词
    '纳采': '提亲/送礼',
    '纳畜': '撸猫遛狗',
    '牧养': '撸猫遛狗',
    '开生坟': '挖坑（别多想）',
    '平治道涂': '修修路',
    '谢土': '谢土地公',
    '开仓': '开仓/盘库',
    '出货财': '花钱/出货',
    '解除': '了结旧事',
    '洗头': '洗头',
    '修门': '修门',
    '安门': '装门/添置家具',
    '开池': '挖鱼池',
    '栽种': '种点绿植',
    '置产': '买资产',
    '立券交易': '签合同',
    '求嗣': '求子',
    '上梁': '架横梁',
    '盖屋': '盖房子',
    '举架': '架横梁',
    '穿井': '打井',
    '掘井': '打井',
    '补垣': '补墙',
    '塞穴': '堵洞',
    '饰垣': '刷墙',
    '裁衣': '做新衣',
    '合帐': '换床品',
    '教牛马': '训练下属（误）',
    '结网': '织网',
    '造船': '造船，用不上',
    '整手足甲': '剪指甲',
    '沐浴': '洗个澡',
    '剃头': '理发/换个发型',
    '冠笄': '升职/加冠',
    '进人口': '招新人',
    '移柩': '——',
    '入殓': '——',
    '成服': '——',
    '除服': '——',
    '启攒': '——',
    '修坟': '——',
    '立碑': '——',
    '伐木': '——',
    '捕捉': '——',
    '畋猎': '——',
    '经络': '——',
    '行丧': '——',
    '破屋坏垣': '拆旧东西'
  };

  // 输出前必须过滤的条目：与职场无关或观感不佳
  var BLACKLIST = [
    '安葬', '破土', '入殓', '移柩', '成服', '除服', '启攒', '修坟', '立碑',
    '开生坟', '谢土', '平治道涂', '伐木', '捕捉', '畋猎', '经络', '行丧',
    '出火', '词讼'
  ];

  // 职场相关词：影响评分（注意：评分用原始术语判断）
  var CAREER_WORDS = ['开市', '交易', '纳财', '求财', '立券', '订盟', '会亲友'];

  // 泛指一切都不合适的条目，放在宜忌首位时没有信息量，展示时压到后面
  var FILLER_WORDS = ['馀事勿取', '诸事不宜'];

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */

  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }

  function strArr(v) {
    var out = [];
    if (!v) return out;
    if (typeof v === 'string') return v ? [v] : out;
    if (typeof v.length !== 'number') return out;
    for (var i = 0; i < v.length; i++) {
      var s = str(v[i]);
      if (s) out.push(s);
    }
    return out;
  }

  function inList(list, word) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] === word) return true;
    }
    return false;
  }

  function containsAny(list, words) {
    for (var i = 0; i < words.length; i++) {
      if (inList(list, words[i])) return true;
    }
    return false;
  }

  /**
   * 挑出最适合展示的前 n 条宜忌：
   *   1. 先剔掉「馀事勿取」「诸事不宜」这类泛词，压到末尾；
   *   2. 职场相关词优先，其次保留原顺序；
   *   3. 不足 n 条时才用泛词补齐。
   */
  function pickForDisplay(list, n) {
    var arr = strArr(list);
    var real = [], filler = [];
    for (var i = 0; i < arr.length; i++) {
      if (inList(FILLER_WORDS, arr[i])) filler.push(arr[i]);
      else real.push(arr[i]);
    }
    real.sort(function (a, b) {
      var ca = inList(CAREER_WORDS, a) ? 0 : 1;
      var cb = inList(CAREER_WORDS, b) ? 0 : 1;
      return ca - cb; // 稳定排序，同组内保持原顺序
    });
    return real.concat(filler).slice(0, n);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function fmtYmd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function safeWeekday(d) {
    var w = d.getDay();
    return WEEKDAYS[w] || '';
  }

  /** 任意输入 -> 本地零点 Date；非法输入返回 null */
  function toDate(input) {
    var d = null;
    try {
      if (input === null || input === undefined) d = new Date();
      else if (input instanceof Date) d = new Date(input.getTime());
      else if (typeof input === 'number') d = new Date(input);
      else if (typeof input === 'string') {
        var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(input.trim());
        if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
        else d = new Date(input);
      } else if (typeof input === 'object' && typeof input.getFullYear === 'function') {
        d = new Date(input.getFullYear(), input.getMonth(), input.getDate());
      }
    } catch (e) {
      d = null;
    }
    if (!d || isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /* ------------------------------------------------------------------ *
   * humanize / 过滤
   * ------------------------------------------------------------------ */

  function humanize(term) {
    var t = str(term).trim();
    if (!t) return '';
    if (Object.prototype.hasOwnProperty.call(HUMANIZE, t)) return HUMANIZE[t];
    return t;
  }

  function isBlacklisted(term) {
    return inList(BLACKLIST, str(term));
  }

  /** 原始条目数组 -> 过滤、通俗化、去重 */
  function normalizeTerms(arr) {
    var raw = strArr(arr);
    var out = [];
    var seen = {};
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i].trim();
      if (!t || isBlacklisted(t)) continue;
      var h = humanize(t);
      if (!h || h === '——' || isBlacklisted(h)) continue;
      if (Object.prototype.hasOwnProperty.call(seen, h)) continue;
      seen[h] = true;
      out.push(h);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 安全调用库方法（任何一层返回 undefined / 抛错都被吞掉）
   * ------------------------------------------------------------------ */

  function call(obj, method) {
    try {
      if (!obj || typeof obj[method] !== 'function') return undefined;
      return obj[method]();
    } catch (e) {
      return undefined;
    }
  }

  function callStr(obj, method) {
    return str(call(obj, method)).trim();
  }

  function callArr(obj, method) {
    return strArr(call(obj, method));
  }

  function safeSolar(y, m, d) {
    if (!LIB || typeof LIB.Solar !== 'object' || typeof LIB.Solar.fromYmd !== 'function') return null;
    try {
      return LIB.Solar.fromYmd(y, m, d);
    } catch (e) {
      return null;
    }
  }

  /** 冲煞格式化：getDayChongDesc 可能是「虎(戊寅)」，统一成「冲虎」 */
  function formatChong(lunar) {
    var desc = callStr(lunar, 'getDayChongDesc');
    var beast = callStr(lunar, 'getDayChongShengXiao');
    var head = '';
    if (desc) head = desc.split(/[（(]/)[0].split('煞')[0].trim();
    if (!head) head = beast;
    if (!head) return '';
    if (head.indexOf('冲') !== 0) head = '冲' + head;
    return head;
  }

  /* ------------------------------------------------------------------ *
   * 降级对象
   * ------------------------------------------------------------------ */

  function emptyData(date) {
    return {
      ymd: fmtYmd(date),
      weekday: safeWeekday(date),
      lunar: { year: '', monthCn: '', dayCn: '', isLeap: false, text: '' },
      ganZhi: { year: '', month: '', day: '' },
      shengXiao: '',
      yi: [],
      ji: [],
      tianShen: '',
      tianShenType: '',
      luck: '',
      zhiXing: '',
      xiu: '',
      chong: '',
      sha: '',
      jieQi: null,
      festivals: [],
      tip: ''
    };
  }

  /* ------------------------------------------------------------------ *
   * 核心：构建一天的数据
   * ------------------------------------------------------------------ */

  function buildData(date, solar, lunar) {
    var data = emptyData(date);

    // 农历：年 / 月 / 日，闰月用「闰四月」表示
    var lunarYear = call(lunar, 'getYear');
    var monthNum = call(lunar, 'getMonth');
    var monthCn = callStr(lunar, 'getMonthInChinese');
    var dayCn = callStr(lunar, 'getDayInChinese');
    var isLeap = false;
    try {
      isLeap = typeof monthNum === 'number' && monthNum < 0;
    } catch (e) { isLeap = false; }

    var yearCn = '';
    if (typeof lunarYear === 'number' && lunarYear) {
      yearCn = callStr(lunar, 'getYearInChinese') || String(lunarYear);
    }

    data.lunar.year = yearCn;
    data.lunar.monthCn = monthCn ? (isLeap ? '闰' + monthCn : monthCn) : '';
    data.lunar.dayCn = dayCn;
    data.lunar.isLeap = isLeap;
    // 显示用：「九月廿八」——月字不能丢，否则看起来像「九廿八」
    data.lunar.text = data.lunar.monthCn && dayCn ? data.lunar.monthCn + '月' + dayCn : '';

    // 干支
    data.ganZhi.year = callStr(lunar, 'getYearInGanZhi');
    data.ganZhi.month = callStr(lunar, 'getMonthInGanZhi');
    data.ganZhi.day = callStr(lunar, 'getDayInGanZhi');

    data.shengXiao = callStr(lunar, 'getYearShengXiao');

    // 宜忌：过滤 + 通俗化
    data.yi = normalizeTerms(callArr(lunar, 'getDayYi'));
    data.ji = normalizeTerms(callArr(lunar, 'getDayJi'));

    // 值神 / 黄道黑道 / 建除 / 二十八宿 / 冲煞
    data.tianShen = callStr(lunar, 'getDayTianShen');
    data.tianShenType = normalizeTianShenType(callStr(lunar, 'getDayTianShenType'));
    data.luck = callStr(lunar, 'getDayTianShenLuck');
    if (data.luck !== '吉' && data.luck !== '凶') data.luck = luckFromType(data.tianShenType);
    data.zhiXing = callStr(lunar, 'getZhiXing');
    data.xiu = callStr(lunar, 'getXiu');
    data.chong = formatChong(lunar);
    data.sha = callStr(lunar, 'getDaySha');

    // 节气（当天不是节气则为 null）
    var jieQi = callStr(lunar, 'getJieQi');
    data.jieQi = jieQi || null;

    // 节日：阳历 + 农历，去重
    data.festivals = mergeUnique(callArr(solar, 'getFestivals'), callArr(lunar, 'getFestivals'));

    data.tip = generateTip(data);
    return data;
  }

  function normalizeTianShenType(v) {
    if (v === '黄道' || v === '黑道') return v;
    if (v && v.indexOf('黄') >= 0) return '黄道';
    if (v && v.indexOf('黑') >= 0) return '黑道';
    return '';
  }

  function luckFromType(type) {
    if (type === '黄道') return '吉';
    if (type === '黑道') return '凶';
    return '';
  }

  function mergeUnique(a, b) {
    var out = [];
    var seen = {};
    var src = a.concat(b);
    for (var i = 0; i < src.length; i++) {
      var t = src[i];
      if (!t || Object.prototype.hasOwnProperty.call(seen, t)) continue;
      seen[t] = true;
      out.push(t);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * tip
   * ------------------------------------------------------------------ */

  function generateTip(data) {
    var d = data && typeof data === 'object' ? data : {};
    var yi = strArr(d.yi);
    var ji = strArr(d.ji);
    var firstYi = yi.length ? yi[0] : '';
    var firstJi = ji.length ? ji[0] : '';
    if (!firstYi && !firstJi) return '今日无忌，宜摸鱼';
    if (!firstYi) return '今日无忌，宜摸鱼';
    if (!firstJi) return '今日无忌，放心干';
    return '今日宜「' + firstYi + '」，不宜「' + firstJi + '」';
  }

  /* ------------------------------------------------------------------ *
   * 公开 API：of
   * ------------------------------------------------------------------ */

  function of(input) {
    var date = toDate(input);
    if (!date) date = toDate(new Date());
    if (!date) {
      // 极端情况：连当前日期都拿不到，仍然不抛错
      return {
        ymd: '',
        weekday: '',
        lunar: { year: '', monthCn: '', dayCn: '', isLeap: false, text: '' },
        ganZhi: { year: '', month: '', day: '' },
        shengXiao: '',
        yi: [],
        ji: [],
        tianShen: '',
        tianShenType: '',
        luck: '',
        zhiXing: '',
        xiu: '',
        chong: '',
        sha: '',
        jieQi: null,
        festivals: [],
        tip: '今日无忌，宜摸鱼'
      };
    }

    var fallback = emptyData(date);
    try {
      var solar = safeSolar(date.getFullYear(), date.getMonth() + 1, date.getDate());
      if (!solar) return fallback;
      var lunar = null;
      try {
        lunar = solar.getLunar();
      } catch (e) {
        lunar = null;
      }
      if (!lunar) return fallback;

      var data = buildData(date, solar, lunar);
      // ymd / weekday 必须正确，无论库返回什么
      data.ymd = fallback.ymd;
      data.weekday = fallback.weekday;
      if (!data.ymd) return fallback;
      if (!data.tip) data.tip = generateTip(data);
      return data;
    } catch (e) {
      return fallback;
    }
  }

  /* ------------------------------------------------------------------ *
   * 公开 API：upcoming
   * ------------------------------------------------------------------ */

  function upcoming(input, days) {
    var n = 7;
    if (typeof days === 'number' && isFinite(days)) n = Math.floor(days);
    if (!(n > 0)) n = 0;
    if (n > 366) n = 366;

    var base = toDate(input);
    if (!base) base = toDate(new Date());
    var out = [];
    if (!base) return out;

    for (var i = 0; i < n; i++) {
      var d;
      try {
        d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      } catch (e) {
        continue;
      }
      var full;
      try {
        full = of(d);
      } catch (e) {
        full = emptyData(d);
      }
      out.push({
        ymd: full.ymd,
        weekday: full.weekday,
        dayCn: full.lunar && full.lunar.dayCn ? full.lunar.dayCn : '',
        // 跨月时「初一」会歧义，带上月份：「十月初一」；同月内只说「廿八」
        monthCn: full.lunar && full.lunar.monthCn ? full.lunar.monthCn : '',
        lunarText: full.lunar && full.lunar.text ? full.lunar.text : '',
        luck: full.luck || '',
        tianShen: full.tianShen || '',
        yi: pickForDisplay(full.yi, 3),
        ji: pickForDisplay(full.ji, 3),
        jieQi: full.jieQi || null,
        festivals: (full.festivals || []).slice()
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 公开 API：score
   * ------------------------------------------------------------------ */

  function toRawTerms(list) {
    // 评分必须用原始术语判断，因此把通俗词尽量映射回原词；
    // data 上若带了 _rawYi/_rawJi 优先使用。
    var arr = strArr(list);
    var out = [];
    var i, k, hit;
    for (i = 0; i < arr.length; i++) {
      var t = arr[i];
      hit = false;
      for (k in HUMANIZE) {
        if (!Object.prototype.hasOwnProperty.call(HUMANIZE, k)) continue;
        if (HUMANIZE[k] === t) {
          out.push(k);
          hit = true;
        }
      }
      if (!hit) out.push(t);
    }
    return out;
  }

  function score(data) {
    var d = data && typeof data === 'object' ? data : {};
    var yiRaw = strArr(d._rawYi).length ? strArr(d._rawYi) : toRawTerms(d.yi);
    var jiRaw = strArr(d._rawJi).length ? strArr(d._rawJi) : toRawTerms(d.ji);

    var good = containsAny(yiRaw, CAREER_WORDS);
    var bad = containsAny(jiRaw, CAREER_WORDS);
    var type = normalizeTianShenType(str(d.tianShenType));
    var luck = str(d.luck);
    if (luck !== '吉' && luck !== '凶') luck = luckFromType(type);

    var s;
    if (type === '黑道' || luck === '凶') s = 40;
    else s = 80; // 黄道+吉；信息不足时按中性偏吉处理

    if (good) s += 10;
    if (bad) s -= 15;
    if (type === '黄道' && luck === '吉') s += 5;
    if (type === '黑道' && luck === '凶') s -= 5;
    if (!type && !luck) s -= 5;

    // 再按命中数量微调，保证单调且确定
    var hitYi = 0;
    var hitJi = 0;
    var i;
    for (i = 0; i < CAREER_WORDS.length; i++) {
      if (inList(yiRaw, CAREER_WORDS[i])) hitYi++;
      if (inList(jiRaw, CAREER_WORDS[i])) hitJi++;
    }
    s += Math.min(hitYi, 3) * 2;
    s -= Math.min(hitJi, 3) * 2;

    s = Math.round(s);
    if (s < 0) s = 0;
    if (s > 100) s = 100;
    return s;
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  return {
    of: of,
    upcoming: upcoming,
    humanize: humanize,
    score: score,
    generateTip: generateTip,
    HUMANIZE: HUMANIZE,
    BLACKLIST: BLACKLIST
  };
});
