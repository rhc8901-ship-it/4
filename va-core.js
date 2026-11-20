/* va-core.js - command registry, safety engine, conversation state, response generation, pipeline.
   Only actions listed in REG can run. Nothing here evaluates text as code. */
(function () {
  'use strict';
  const VA = window.VA = window.VA || {};
  const NLU = window.VANLU;

  const st = VA.state = { pending: null, confirm: null, lastResp: null, more: null, lastLang: null, lastN: '', lastT: 0, busy: false, queued: null, listening: false, empty: 0 };

  /* ---------------- language + response helpers ---------------- */
  function rl() {
    const p = VA.prefs.lang;
    if (p === 'hi' || p === 'en') return p;
    return st.lastLang || (VA.A && VA.A.ready() ? VA.A.lang() : 'hi');
  }
  VA.rl = rl;
  const R = function (en, hi, x) { return Object.assign({ en: en, hi: hi }, x || {}); };
  const BI = function (fn, x) { return R(fn('en'), fn('hi'), x); };
  const M = function (v, l) { return l === 'hi' ? (v < 0 ? '-' : '') + Math.abs(v).toFixed(2) + ' डॉलर' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2); };
  const P1 = function (v) { return (Math.round(v * 10) / 10).toString(); };

  const SPK = { XAUUSD: ['gold', 'गोल्ड'], XAGUSD: ['silver', 'सिल्वर'], BTCUSD: ['bitcoin', 'बिटकॉइन'], EURUSD: ['EURUSD', 'यूरो डॉलर'], GBPUSD: ['GBPUSD', 'पाउंड डॉलर'], USDJPY: ['USDJPY', 'डॉलर येन'], NAS100: ['Nasdaq 100', 'नैस्डैक'], US30: ['US30', 'डाओ जोन्स'] };
  const symName = function (s, l) { const x = SPK[s]; return x ? x[l === 'hi' ? 1 : 0] : s; };
  const dirName = function (d, l) { return d === 'buy' ? (l === 'hi' ? 'बाय' : 'Buy') : (l === 'hi' ? 'सेल' : 'Sell'); };
  const PL = { today: ['today', 'आज'], yesterday: ['yesterday', 'कल'], week: ['this week', 'इस हफ्ते'], lastweek: ['last week', 'पिछले हफ्ते'], month: ['this month', 'इस महीने'], lastmonth: ['last month', 'पिछले महीने'], all: ['overall', 'कुल मिलाकर'] };
  const cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  const NOTRADES = R('There are no trades recorded for that period.', 'उस अवधि में कोई ट्रेड दर्ज नहीं है।');

  const FN = { sym: ['Symbol', 'सिंबल'], dir: ['Direction', 'दिशा'], entry: ['Entry price', 'एंट्री प्राइस'], exit: ['Exit price', 'एग्जिट प्राइस'], sl: ['Stop loss', 'स्टॉप लॉस'], tp: ['Take profit', 'टेक प्रॉफिट'], lots: ['Lot size', 'लॉट साइज़'], fee: ['Fee', 'फीस'], pnl: ['P&L', 'P&L'], tag: ['Strategy', 'स्ट्रैटेजी'], grade: ['Grade', 'ग्रेड'], mood: ['Mood', 'मूड'], note: ['Note', 'नोट'] };
  const NUMERIC = ['entry', 'exit', 'sl', 'tp', 'lots', 'fee', 'pnl'];

  const A = function () { return VA.A; };

  /* ---------------- trade dialog ---------------- */
  const SLOTS = ['sym', 'dir', 'entry', 'exit'];
  const QUESTION = {
    sym: R('Which trading symbol? For example gold or euro dollar.', 'कौन सा सिंबल? जैसे गोल्ड या यूरो डॉलर।'),
    dir: R('Buy or Sell?', 'बाय या सेल?'),
    entry: R('What was your entry price?', 'एंट्री प्राइस क्या था?'),
    exit: R('What was your exit price?', 'एग्जिट प्राइस क्या था?')
  };
  function nextSlot() {
    const p = st.pending; if (!p || p.edit) return null;
    return SLOTS.filter(function (s) { return p.set[s] === undefined; })[0] || null;
  }
  function applyFields(f) {
    const bad = A().form.fill(f);
    Object.keys(f).forEach(function (k) {
      if (bad.indexOf(k) >= 0) return;
      if (k !== 'note') st.pending.set[k] = f[k];
      st.pending.last = k;
    });
    return bad;
  }
  function describeTrade(l) {
    const f = A().form.read(), est = A().form.estimate();
    const lot = f.lots;
    let s;
    if (l === 'hi') {
      s = symName(f.sym, 'hi') + ' ' + dirName(f.dir, 'hi') + ', ' + lot + ' लॉट, एंट्री ' + f.entry + ', एग्जिट ' + f.exit;
      if (f.sl != null) s += ', स्टॉप लॉस ' + f.sl;
      if (f.tp != null) s += ', टेक प्रॉफिट ' + f.tp;
      if (est != null) s += '। अनुमानित P&L ' + M(est, 'hi');
    } else {
      s = symName(f.sym, 'en') + ' ' + dirName(f.dir, 'en') + ', ' + lot + ' lot, entry ' + f.entry + ', exit ' + f.exit;
      if (f.sl != null) s += ', stop loss ' + f.sl;
      if (f.tp != null) s += ', take profit ' + f.tp;
      if (est != null) s += '. Estimated P&L ' + M(est, 'en');
    }
    return s;
  }
  function slWarn(l) {
    const f = A().form.read();
    if (f.sl == null || f.entry == null) return '';
    const bad = (f.dir === 'buy' && f.sl >= f.entry) || (f.dir === 'sell' && f.sl <= f.entry);
    if (!bad) return '';
    return l === 'hi' ? ' ध्यान दीजिए: स्टॉप लॉस गलत तरफ़ है।' : ' Warning: the stop loss is on the wrong side of entry.';
  }
  function guardWarn(l) {
    const g = A().guardWarnings();
    if (!g.block) return '';
    return l === 'hi' ? ' ध्यान दीजिए: आपके डेली रूल्स टूटे हैं, यह ट्रेड RULE BREAK मार्क होगा।' : ' Note: your daily rules are breached, so this trade will be marked RULE BREAK.';
  }
  function enterSaveConfirm() {
    const f = A().form.read();
    if (f.entry == null || f.exit == null || !(f.lots > 0)) {
      return R('Entry, exit and lot size are required before saving.', 'सेव करने से पहले एंट्री, एग्जिट और लॉट साइज़ ज़रूरी हैं।', { listen: true });
    }
    st.confirm = { id: 'trade.save', args: {}, stage: 1, level: 2, at: Date.now(), tries: 0 };
    const edit = st.pending && st.pending.edit;
    return BI(function (l) {
      return (edit ? (l === 'hi' ? 'बदलाव तैयार हैं। ' : 'Your changes are ready. ') : (l === 'hi' ? 'आपका ट्रेड तैयार है। ' : 'Your trade details are ready. ')) +
        describeTrade(l) + '.' + slWarn(l) + guardWarn(l) +
        (l === 'hi' ? (edit ? ' क्या बदलाव सेव कर दूँ?' : ' क्या इस ट्रेड को सेव कर दूँ?') : (edit ? ' Should I save the changes?' : ' Should I save this trade?'));
    }, { listen: true });
  }
  function advance(prefix) {
    const s = nextSlot();
    if (s) {
      st.pending.asked = s;
      const q = QUESTION[s];
      return R((prefix ? prefix.en + ' ' : '') + q.en, (prefix ? prefix.hi + ' ' : '') + q.hi, { listen: true });
    }
    st.pending.asked = null;
    if (st.pending.edit) {
      return R((prefix ? prefix.en + ' ' : '') + "Anything else to change? Say 'save' when done.", (prefix ? prefix.hi + ' ' : '') + "और कुछ बदलना है? हो जाए तो 'सेव' कहिए।", { listen: true });
    }
    return enterSaveConfirm();
  }
  function startTrade(fields) {
    if (A().editing()) A().form.cancelEdit();
    A().form.clear();
    st.confirm = null;
    st.pending = { set: {}, last: null, edit: false, fails: 0, asked: null };
    const bad = fields && Object.keys(fields).length ? applyFields(fields) : [];
    if (!fields || !Object.keys(fields).length) A().form.open();
    return advance(R('Sure.', 'ज़रूर।'));
  }

  function slotFlow(p) {
    const pe = st.pending, f = Object.assign({}, p.fields), asked = pe.asked;
    const hasNumeric = NUMERIC.some(function (k) { return f[k] !== undefined; });
    let corrected = null;
    if (NLU.isCorrection(p.norm) && p.number != null && !hasNumeric && pe.last && NUMERIC.indexOf(pe.last) >= 0) {
      f[pe.last] = p.number; corrected = pe.last; /* "sorry, change it to 2648" -> last field you set */
    } else if (asked && (asked === 'entry' || asked === 'exit') && f[asked] === undefined && p.number != null) {
      f[asked] = p.number;
    }
    if (p.note) f.note = p.note;
    if (!Object.keys(f).length) {
      pe.fails++;
      const q = asked ? QUESTION[asked] : null;
      return R("Sorry, I didn't catch that. " + (q ? q.en : "Tell me a trade detail, or say 'cancel'."), 'माफ़ कीजिए, समझ नहीं आया। ' + (q ? q.hi : "ट्रेड की कोई जानकारी बताइए, या 'कैंसिल' कहिए।"), { listen: true });
    }
    pe.fails = 0;
    st.confirm = null;
    const bad = applyFields(f);
    if (bad.length) {
      return BI(function (l) { return (l === 'hi' ? 'यह वैल्यू फॉर्म में नहीं डाल पाया: ' : 'I could not set: ') + bad.map(function (k) { return FN[k][l === 'hi' ? 1 : 0]; }).join(', ') + '.'; }, { listen: true });
    }
    const pre = corrected ? BI(function (l) { return FN[corrected][l === 'hi' ? 1 : 0] + (l === 'hi' ? ' अपडेट किया: ' : ' updated to ') + f[corrected] + '.'; }) : R('Got it.', 'ठीक है।');
    return advance(pre);
  }

  /* ---------------- registry (allowlist) ---------------- */
  const NAVN = { dash: ['Home', 'होम'], add: ['Add trade', 'ट्रेड जोड़ें'], list: ['Trades', 'ट्रेड्स'], goals: ['Goals', 'गोल्स'], diary: ['Diary', 'डायरी'], cal: ['Insights and calendar', 'इनसाइट्स और कैलेंडर'], tools: ['Tools and settings', 'टूल्स और सेटिंग्स'] };
  function nav(tab) {
    return { id: 'nav.' + tab, level: 1, confirm: false, params: [], run: function () { A().goto(tab); return BI(function (l) { return (l === 'hi' ? 'खोल दिया: ' : 'Opened ') + NAVN[tab][l === 'hi' ? 1 : 0] + (l === 'hi' ? '।' : '.'); }); } };
  }
  const REG = VA.REG = {};
  function reg(e) { REG[e.id] = e; }
  ['dash', 'add', 'list', 'goals', 'diary', 'cal', 'tools'].forEach(function (t) { reg(nav(t)); });

  reg({ id: 'nav.back', level: 1, run: function () { return A().back() ? R('Going back.', 'वापस जा रहा हूँ।') : R('There is no previous screen.', 'पिछली स्क्रीन नहीं है।'); } });
  reg({ id: 'help', level: 1, run: function () {
    return R("You can say: open dashboard; add a new trade; what is today's profit; win rate this month; best pair; show my last trade; delete last trade; compare this month with last month; switch to Hindi; mute voice replies; stop speaking.",
      "आप कह सकते हैं: डैशबोर्ड खोलो; नया ट्रेड जोड़ो; आज का प्रॉफिट बताओ; इस महीने का विन रेट; सबसे अच्छा पेयर; आखिरी ट्रेड दिखाओ; आखिरी ट्रेड डिलीट करो; अंग्रेज़ी में बात करो; आवाज़ बंद करो; रुको।");
  } });
  reg({ id: 'op.cancel', level: 1, run: function () {
    const had = st.confirm || st.pending;
    st.confirm = null;
    if (st.pending && st.pending.edit && A().editing()) A().form.cancelEdit();
    st.pending = null;
    return had ? R('Cancelled. Nothing was saved or deleted.', 'रद्द किया। कुछ सेव या डिलीट नहीं हुआ।') : R('There is nothing to cancel.', 'रद्द करने के लिए कुछ नहीं है।');
  } });

  /* --- voice / settings --- */
  function setMode(m, en, hi) { return function () { VA.prefs.mode = m; VA.savePrefs(); VA.emit('prefs'); return R(en, hi); }; }
  reg({ id: 'voice.stop', level: 1, run: function () { VA.tts.stop(); return null; } });
  reg({ id: 'voice.repeat', level: 1, run: function () { return st.lastResp ? Object.assign({}, st.lastResp, { noStore: true }) : R('There is nothing to repeat yet.', 'अभी दोहराने के लिए कुछ नहीं है।'); } });
  reg({ id: 'voice.more', level: 1, run: function () {
    if (!st.more) return R('There is nothing more to add.', 'और कुछ जोड़ने के लिए नहीं है।');
    const m = st.more; st.more = null; return Object.assign({ en: m.text, hi: m.text }, { onlyLang: m.l, noStore: true });
  } });
  reg({ id: 'voice.mute', level: 1, run: setMode('text', 'Voice replies are off. I will answer in text only.', 'आवाज़ वाले जवाब बंद। अब सिर्फ़ टेक्स्ट में जवाब दूँगा।') });
  reg({ id: 'voice.unmute', level: 1, run: function () { if (VA.prefs.mode === 'text') VA.prefs.mode = 'voicetext'; VA.savePrefs(); VA.emit('prefs'); return R('Voice replies are on.', 'आवाज़ वाले जवाब चालू हैं।'); } });
  reg({ id: 'set.mode.text', level: 1, run: setMode('text', 'Text only mode.', 'सिर्फ़ टेक्स्ट मोड।') });
  reg({ id: 'set.mode.voicetext', level: 1, run: setMode('voicetext', 'Voice and text mode.', 'वॉइस और टेक्स्ट मोड।') });
  reg({ id: 'set.mode.voicefirst', level: 1, run: setMode('voicefirst', 'Voice first mode.', 'वॉइस फ़र्स्ट मोड।') });
  function bump(key, d, lo, hi, en, hiMsg) {
    return function () {
      VA.prefs[key] = Math.round(Math.min(hi, Math.max(lo, VA.prefs[key] + d)) * 100) / 100; VA.savePrefs(); VA.emit('prefs');
      return R(en, hiMsg);
    };
  }
  reg({ id: 'voice.faster', level: 1, run: bump('rate', 0.15, 0.5, 1.6, 'Speaking faster now.', 'अब थोड़ा तेज़ बोलूँगा।') });
  reg({ id: 'voice.slower', level: 1, run: bump('rate', -0.15, 0.5, 1.6, 'Speaking more slowly now.', 'अब थोड़ा धीरे बोलूँगा।') });
  reg({ id: 'voice.pitch.up', level: 1, run: bump('pitch', 0.1, 0.7, 1.5, 'Voice pitch raised.', 'आवाज़ की पिच बढ़ा दी।') });
  reg({ id: 'voice.pitch.down', level: 1, run: bump('pitch', -0.1, 0.7, 1.5, 'Voice pitch lowered.', 'आवाज़ की पिच कम कर दी।') });
  reg({ id: 'voice.lang.hi', level: 1, run: function () { VA.prefs.lang = 'hi'; VA.savePrefs(); VA.emit('prefs'); return R('Okay, I will talk in Hindi.', 'ठीक है, अब मैं हिंदी में बात करूँगा।'); } });
  reg({ id: 'voice.lang.en', level: 1, run: function () { VA.prefs.lang = 'en'; VA.savePrefs(); VA.emit('prefs'); return R('Okay, I will talk in English.', 'ठीक है, अब मैं अंग्रेज़ी में बात करूँगा।'); } });
  reg({ id: 'set.theme.dark', level: 1, run: function () { A().theme('dark'); return R('Dark theme on.', 'डार्क थीम चालू।'); } });
  reg({ id: 'set.theme.light', level: 1, run: function () { A().theme('light'); return R('Light theme on.', 'लाइट थीम चालू।'); } });
  reg({ id: 'set.applang', level: 1, params: ['lang'], run: function (a) {
    if (A().editing()) return R('Please save or cancel the trade you are editing first.', 'पहले जो ट्रेड एडिट कर रहे हैं उसे सेव या कैंसिल कीजिए।');
    const keep = st.pending && !st.pending.edit ? Object.assign({}, st.pending.set) : null;
    A().appLang(a.lang);
    if (keep && Object.keys(keep).length) A().form.fill(keep);
    return a.lang === 'en' ? R('App language changed to English.', 'ऐप की भाषा अंग्रेज़ी कर दी।') : R('App language changed to Hinglish.', 'ऐप की भाषा हिंग्लिश कर दी।');
  } });

  /* --- statistics (always computed from the real stored trades) --- */
  function periodLabel(p, l) { return PL[p][l === 'hi' ? 1 : 0]; }
  reg({ id: 'stat.pnl', level: 1, params: ['period'], run: function (a) {
    const set = A().period(a.period), c = A().counts(set);
    if (!set.length) return NOTRADES;
    return BI(function (l) {
      const word = l === 'hi' ? (c.net >= 0 ? 'प्रॉफिट' : 'लॉस') : (c.net >= 0 ? 'profit' : 'loss');
      return l === 'hi'
        ? cap(periodLabel(a.period, l)) + ' आपका ' + word + ' ' + M(Math.abs(c.net), l) + ' है। ' + c.n + ' ट्रेड: ' + c.w + ' जीत, ' + c.l + ' हार।'
        : cap(periodLabel(a.period, l)) + ' you are at a ' + word + ' of ' + M(Math.abs(c.net), l) + '. ' + c.n + ' trades: ' + c.w + ' wins, ' + c.l + ' losses.';
    });
  } });
  reg({ id: 'stat.winrate', level: 1, params: ['period'], run: function (a) {
    const set = A().period(a.period), s = A().stats(set), c = A().counts(set);
    if (!c.n) return NOTRADES;
    return BI(function (l) { return l === 'hi'
      ? cap(periodLabel(a.period, l)) + ' आपका विन रेट ' + Math.round(s.wr) + ' प्रतिशत है, ' + c.n + ' ट्रेड में ' + c.w + ' जीत।'
      : cap(periodLabel(a.period, l)) + ' your win rate is ' + Math.round(s.wr) + '%, with ' + c.w + ' wins out of ' + c.n + ' trades.'; });
  } });
  reg({ id: 'stat.count.wins', level: 1, params: ['period'], run: function (a) {
    const c = A().counts(A().period(a.period)); if (!c.n) return NOTRADES;
    return BI(function (l) { return l === 'hi' ? cap(periodLabel(a.period, l)) + ' ' + c.w + ' जीतने वाले ट्रेड हैं।' : cap(periodLabel(a.period, l)) + ' you have ' + c.w + ' winning trades.'; });
  } });
  reg({ id: 'stat.count.losses', level: 1, params: ['period'], run: function (a) {
    const c = A().counts(A().period(a.period)); if (!c.n) return NOTRADES;
    return BI(function (l) { return l === 'hi' ? cap(periodLabel(a.period, l)) + ' ' + c.l + ' हारने वाले ट्रेड हैं।' : cap(periodLabel(a.period, l)) + ' you have ' + c.l + ' losing trades.'; });
  } });
  reg({ id: 'stat.count.trades', level: 1, params: ['period'], run: function (a) {
    const c = A().counts(A().period(a.period)); if (!c.n) return NOTRADES;
    return BI(function (l) { return l === 'hi' ? cap(periodLabel(a.period, l)) + ' कुल ' + c.n + ' ट्रेड हैं।' : cap(periodLabel(a.period, l)) + ' you have ' + c.n + ' trades in total.'; });
  } });
  function pairAnswer(best) {
    return function (a) {
      const rows = A().byPair(A().period(a.period));
      if (!rows.length) return NOTRADES;
      const r = best ? rows[0] : rows[rows.length - 1];
      const top3 = (best ? rows : rows.slice().reverse()).slice(0, 3);
      return BI(function (l) {
        const nm = symName(r.k, l);
        const main = l === 'hi'
          ? (best ? 'आपका सबसे अच्छा पेयर ' : 'आपका सबसे कमज़ोर पेयर ') + nm + ' है, नेट ' + M(r.net, l) + ', ' + r.n + ' ट्रेड, विन रेट ' + Math.round(r.wr) + ' प्रतिशत।'
          : 'Your ' + (best ? 'best' : 'weakest') + ' pair is ' + nm + ', net ' + M(r.net, l) + ' over ' + r.n + ' trades, win rate ' + Math.round(r.wr) + '%.';
        return top3.length > 1 ? main + ' ' + top3.slice(1).map(function (x) { return symName(x.k, l) + ' ' + M(x.net, l); }).join(', ') + '.' : main;
      });
    };
  }
  reg({ id: 'stat.best_pair', level: 1, params: ['period'], run: pairAnswer(true) });
  reg({ id: 'stat.worst_pair', level: 1, params: ['period'], run: pairAnswer(false) });
  function extreme(win) {
    return function (a) {
      const real = A().real().filter(function (t) { return NLUinPeriod(t, a.period); });
      const pool = real.filter(function (t) { return win ? t.pnl > 0 : t.pnl < 0; });
      if (!pool.length) return win ? R('You have no winning trades in that period.', 'उस अवधि में कोई जीतने वाला ट्रेड नहीं है।') : R('You have no losing trades in that period.', 'उस अवधि में कोई हारने वाला ट्रेड नहीं है।');
      const t = pool.reduce(function (b, x) { return (win ? x.pnl > b.pnl : x.pnl < b.pnl) ? x : b; });
      return BI(function (l) { return l === 'hi'
        ? (win ? 'आपका सबसे बड़ा प्रॉफिट ' : 'आपका सबसे बड़ा लॉस ') + M(Math.abs(t.pnl), l) + ' है, ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + ', ' + t.date.slice(0, 10) + ' को।'
        : 'Your biggest ' + (win ? 'win' : 'loss') + ' is ' + M(Math.abs(t.pnl), l) + ' on ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + ', ' + t.date.slice(0, 10) + '.'; });
    };
  }
  function NLUinPeriod(t, p) { return A().period(p).indexOf(t) >= 0; }
  reg({ id: 'stat.biggest_loss', level: 1, params: ['period'], run: extreme(false) });
  reg({ id: 'stat.biggest_win', level: 1, params: ['period'], run: extreme(true) });
  reg({ id: 'stat.compare', level: 1, run: function () {
    const a = A().period('month'), b = A().period('lastmonth');
    if (!a.length && !b.length) return NOTRADES;
    const ca = A().counts(a), cb = A().counts(b), sa = A().stats(a), sb = A().stats(b), d = ca.net - cb.net;
    return BI(function (l) { return l === 'hi'
      ? 'इस महीने ' + M(ca.net, l) + ' (' + ca.n + ' ट्रेड, विन रेट ' + Math.round(sa.wr) + ' प्रतिशत), पिछले महीने ' + M(cb.net, l) + ' (' + cb.n + ' ट्रेड, विन रेट ' + Math.round(sb.wr) + ' प्रतिशत)। फ़र्क ' + M(d, l) + '।'
      : 'This month ' + M(ca.net, l) + ' (' + ca.n + ' trades, ' + Math.round(sa.wr) + '% win rate) versus last month ' + M(cb.net, l) + ' (' + cb.n + ' trades, ' + Math.round(sb.wr) + '% win rate). Difference ' + M(d, l) + '.'; });
  } });
  reg({ id: 'stat.performance', level: 1, run: function () {
    const all = A().period('all'); if (!all.length) return NOTRADES;
    const s = A().stats(all), td = A().counts(A().period('today'));
    return BI(function (l) { return l === 'hi'
      ? 'कुल ' + s.n + ' ट्रेड, नेट ' + M(s.net, l) + ', विन रेट ' + Math.round(s.wr) + ' प्रतिशत, प्रॉफिट फैक्टर ' + (Math.round(s.pf * 100) / 100) + ', मैक्स ड्रॉडाउन ' + M(s.dd, l) + '। आज का P&L ' + M(td.net, l) + '।'
      : 'Overall ' + s.n + ' trades, net ' + M(s.net, l) + ', win rate ' + Math.round(s.wr) + '%, profit factor ' + (Math.round(s.pf * 100) / 100) + ', max drawdown ' + M(s.dd, l) + '. Today\'s P&L is ' + M(td.net, l) + '.'; });
  } });

  /* --- trades --- */
  reg({ id: 'trade.show_last', level: 1, run: function () {
    const t = A().last(); if (!t) return R('You have no trades yet.', 'अभी कोई ट्रेड नहीं है।');
    A().detail(t.id);
    return BI(function (l) { return l === 'hi'
      ? 'आखिरी ट्रेड: ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + ', ' + M(t.pnl, l) + ', ' + t.date.slice(0, 10) + '।'
      : 'Last trade: ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + ', P&L ' + M(t.pnl, l) + ', on ' + t.date.slice(0, 10) + '.'; });
  } });
  reg({ id: 'trade.new', level: 1, params: ['fields'], run: function (a) { return startTrade(a.fields); } });
  reg({ id: 'trade.edit_last', level: 1, run: function () {
    const t = A().last(); if (!t) return R('You have no trades to edit.', 'एडिट करने के लिए कोई ट्रेड नहीं है।');
    st.confirm = null;
    A().edit(t.id);
    st.pending = { set: {}, last: null, edit: true, fails: 0, asked: null };
    return BI(function (l) { return l === 'hi'
      ? 'आखिरी ट्रेड एडिट कर रहा हूँ: ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + '। क्या बदलना है? हो जाए तो "सेव" कहिए।'
      : 'Editing your last trade: ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + '. What should I change? Say "save" when done.'; }, { listen: true });
  } });
  reg({ id: 'trade.save', level: 2, confirm: true,
    preview: function () {
      if (!st.pending && A().editing()) st.pending = { set: {}, last: null, edit: true, fails: 0, asked: null };
      if (!st.pending) return R("There is no trade in progress. Say 'add a new trade' to start.", "कोई ट्रेड चल नहीं रहा। शुरू करने के लिए 'नया ट्रेड जोड़ो' कहिए।", { noConfirm: true });
      const s = nextSlot();
      if (s) return Object.assign({ noConfirm: true, listen: true }, QUESTION[s], { en: 'Not yet. ' + QUESTION[s].en, hi: 'अभी नहीं। ' + QUESTION[s].hi });
      return enterSaveConfirm();
    },
    run: async function () {
      const edit = !!(st.pending && st.pending.edit);
      const r = await A().form.save();
      if (!r.ok) return R('The app could not save it: ' + (r.msg || 'unknown reason') + '. The form is still open.', 'ऐप सेव नहीं कर पाया: ' + (r.msg || 'कारण पता नहीं') + '। फॉर्म खुला है।', { listen: false });
      st.pending = null;
      return edit ? R('Your trade has been updated successfully.', 'आपका ट्रेड सफलतापूर्वक अपडेट हो गया।') : R('Your trade has been saved successfully.', 'आपका ट्रेड सफलतापूर्वक सेव हो गया।');
    } });
  reg({ id: 'trade.delete_last', level: 3, confirm: true, double: true,
    preview: function () {
      const t = A().last(); if (!t) return R('You have no trades to delete.', 'डिलीट करने के लिए कोई ट्रेड नहीं है।', { noConfirm: true });
      return BI(function (l) { return l === 'hi'
        ? 'आखिरी ट्रेड: ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + ', ' + M(t.pnl, l) + ', ' + t.date.slice(0, 10) + '। क्या इसे डिलीट करना है?'
        : 'Your last trade: ' + symName(t.sym, l) + ' ' + dirName(t.dir, l) + ', P&L ' + M(t.pnl, l) + ', ' + t.date.slice(0, 10) + '. Do you want to delete it?'; }, { listen: true, target: t.id });
    },
    second: function () { return R('Are you sure? This cannot be undone. Say "delete" to confirm, or "no" to keep it.', 'क्या आप पक्के हैं? यह वापस नहीं आएगा। डिलीट के लिए "डिलीट" कहिए, रखने के लिए "नहीं"।', { listen: true }); },
    run: function (a) {
      const t = a.target ? A().find(a.target) : null;
      if (!t) return R('That trade no longer exists. Nothing was deleted.', 'वह ट्रेड अब नहीं है। कुछ डिलीट नहीं हुआ।');
      if (A().editing()) A().form.cancelEdit();
      st.pending = null;
      return A().remove(t.id) ? R('The trade has been deleted.', 'ट्रेड डिलीट कर दिया।') : R('I could not delete the trade.', 'मैं ट्रेड डिलीट नहीं कर पाया।');
    } });
  reg({ id: 'danger.reset', level: 3, run: function () {
    A().goto('tools');
    return R('For safety, restore, reset and delete-all can only be done by touch. I opened Tools for you.', 'सुरक्षा के लिए रिस्टोर, रीसेट और सारा डेटा डिलीट सिर्फ़ टच से हो सकता है। मैंने टूल्स खोल दिया है।');
  } });

  /* --- search / filter --- */
  reg({ id: 'filter.winners', level: 1, run: function () { A().filter({ lf: 'w', q: '' }); return R('Showing winning trades.', 'जीतने वाले ट्रेड दिखा रहा हूँ।'); } });
  reg({ id: 'filter.losers', level: 1, run: function () { A().filter({ lf: 'l', q: '' }); return R('Showing losing trades.', 'हारने वाले ट्रेड दिखा रहा हूँ।'); } });
  reg({ id: 'filter.symbol', level: 1, params: ['sym'], validate: function (a) { return a.sym ? null : R('Which symbol?', 'कौन सा सिंबल?', { listen: true }); },
    run: function (a) { A().filter({ fs: a.sym, lf: '', q: '' }); return BI(function (l) { return (l === 'hi' ? symName(a.sym, l) + ' के ट्रेड दिखा रहा हूँ। हटाने के लिए "फिल्टर हटाओ" कहिए।' : 'Showing ' + symName(a.sym, l) + ' trades. Say "clear filters" to reset.'); }); } });
  reg({ id: 'search.date', level: 1, params: ['date'], validate: function (a) { return a.date ? null : R("I couldn't read that date. Try 2026-11-10.", 'तारीख़ समझ नहीं आई। जैसे 2026-11-10 बोलिए।'); },
    run: function (a) { A().filter({ q: a.date, lf: '' }); return R('Showing trades for ' + a.date + '.', a.date + ' के ट्रेड दिखा रहा हूँ।'); } });
  reg({ id: 'search.text', level: 1, params: ['q'], validate: function (a) { return a.q ? null : R('What should I search for?', 'क्या खोजना है?', { listen: true }); },
    run: function (a) { A().filter({ q: a.q, lf: '' }); return R('Searching trades for "' + a.q + '".', '"' + a.q + '" के लिए ट्रेड खोज रहा हूँ।'); } });
  reg({ id: 'filter.clear', level: 1, run: function () { A().clearFilters(); return R('Filters cleared. Showing all trades.', 'फिल्टर हटा दिए। सारे ट्रेड दिख रहे हैं।'); } });

  /* --- export --- */
  reg({ id: 'backup.status', level: 1, run: function () {
    A().goto('tools');
    const n = A().real().length;
    return R('The app does not keep a backup history. It currently holds ' + n + ' trades. Use Export to create a backup.', 'ऐप बैकअप का इतिहास नहीं रखता। अभी इसमें ' + n + ' ट्रेड हैं। बैकअप बनाने के लिए एक्सपोर्ट इस्तेमाल कीजिए।');
  } });
  reg({ id: 'tools.export', level: 2, confirm: true, params: ['csv'],
    preview: function (a) { return R(a.csv ? 'Export your trades as a CSV file and open the share sheet?' : 'Export a backup of your journal and open the share sheet?', a.csv ? 'अपने ट्रेड CSV फ़ाइल में एक्सपोर्ट करके शेयर खोलूँ?' : 'जर्नल का बैकअप एक्सपोर्ट करके शेयर खोलूँ?', { listen: true }); },
    run: async function (a) { try { if (a.csv) await A().exportCsv(); else await A().exportBackup(); } catch (e) { return R('Export failed.', 'एक्सपोर्ट नहीं हुआ।'); } return R('Export started. Choose where to save or share it.', 'एक्सपोर्ट शुरू हो गया। कहाँ सेव या शेयर करना है चुनिए।'); } });

  /* ---------------- confirmation engine ---------------- */
  const CONTROL = /^(voice\.|op\.cancel|help|set\.)/;
  function noConf() { return R('I could not confirm, so nothing was done.', 'पुष्टि नहीं हो पाई, इसलिए कुछ नहीं किया।'); }
  async function onConfirm(p) {
    const c = st.confirm, e = REG[c.id];
    if (Date.now() - c.at > 90000) { st.confirm = null; return null; }
    if (c.id === 'trade.save' && st.pending && (Object.keys(p.fields).length || p.note || (NLU.isCorrection(p.norm) && p.number != null))) { st.confirm = null; return null; }
    if (c.stage === 2) {
      if (NLU.deleteWord(p.norm) || p.yn === 'yes') { st.confirm = null; return e.run(c.args); }
      if (p.yn === 'no') { st.confirm = null; return R('Okay, I kept the trade.', 'ठीक है, ट्रेड रख लिया।'); }
    } else if (p.yn === 'yes') {
      if (e.double) { c.stage = 2; c.at = Date.now(); c.tries = 0; return e.second(c.args); }
      st.confirm = null; return e.run(c.args);
    } else if (p.yn === 'no') {
      st.confirm = null;
      return c.id === 'trade.save' ? R('Okay, I did not save it. Tell me what to change, or say "cancel".', 'ठीक है, सेव नहीं किया। क्या बदलना है बताइए, या "कैंसिल" कहिए।', { listen: true }) : R('Okay, cancelled. Nothing was changed.', 'ठीक है, रद्द किया। कुछ नहीं बदला।');
    }
    if (p.intent && (CONTROL.test(p.intent.id) || p.intent.id.indexOf('nav.') === 0)) { st.confirm = null; return null; }
    c.tries = (c.tries || 0) + 1;
    if (c.tries >= 2) { st.confirm = null; return noConf(); }
    return R('Please answer yes or no.', 'कृपया हाँ या नहीं कहिए।', { listen: true });
  }

  /* ---------------- dispatcher ---------------- */
  async function execute(id, args) {
    const e = REG[id];
    if (!e) return unknown();
    if (e.validate) { const bad = e.validate(args); if (bad) return bad; }
    if (e.level >= 2 && e.confirm) {
      const pv = e.preview(args);
      if (pv.noConfirm || pv.error) return pv;
      if (!st.confirm || st.confirm.id !== id) st.confirm = { id: id, args: Object.assign({}, args, pv.target ? { target: pv.target } : {}), stage: 1, level: e.level, at: Date.now(), tries: 0 };
      return Object.assign(pv, { listen: true });
    }
    return e.run(args);
  }
  function unknown() {
    return R("Sorry, I didn't understand that. Try \"show today's profit\" or say \"help\".", "माफ़ कीजिए, समझ नहीं आया। कहिए \"आज का प्रॉफिट बताओ\" या \"help\"।");
  }

  async function route(raw) {
    const ctx = { tags: A().tags(), pending: !!st.pending, now: new Date() };
    const p = NLU.parse(raw, ctx);
    /* short answers like "2650" or "yes" must not flip the reply language mid-conversation */
    if (p.lang === 'hi' || /[a-z]{2,}\s+[a-z]{2,}/i.test(raw)) st.lastLang = p.lang;
    if (st.confirm) { const r = await onConfirm(p); if (r !== null) return r; }
    const it = p.intent;
    if (it && CONTROL.test(it.id)) return execute(it.id, it.args);
    if (st.pending && (Object.keys(p.fields).length || p.note || (NLU.isCorrection(p.norm) && p.number != null) || !it)) {
      if (!it || !/^(trade\.save|trade\.new|trade\.edit_last|trade\.delete_last)$/.test(it.id)) return slotFlow(p);
    }
    if (it) {
      const args = Object.assign({}, it.args);
      if (it.id === 'trade.new') args.fields = p.fields;
      if (it.id === 'tools.export') args.csv = /\bcsv\b/.test(p.norm);
      return execute(it.id, args);
    }
    if (!st.pending && Object.keys(p.fields).length && NUMERIC.some(function (k) { return p.fields[k] !== undefined; })) {
      return startTrade(p.fields); /* "entry 2650" with no trade open starts one */
    }
    if (VA.prefs.aiFallback && A().aiAnswer) {
      try { const t = await A().aiAnswer(raw); return { en: t, hi: t, ai: true }; } catch (e) { return R('The AI coach is not available: ' + ((e && e.message) || 'error'), 'AI कोच उपलब्ध नहीं है।'); }
    }
    return unknown();
  }

  /* ---------------- output ---------------- */
  function speakable(text, l) {
    if (text.length <= 220) return { s: text, rest: '' };
    const parts = text.match(/[^.!?।\n]+[.!?।]?/g) || [text];
    let s = '', i = 0;
    while (i < parts.length && (s + parts[i]).length <= 200) { s += parts[i]; i++; }
    if (!s) { s = parts[0].slice(0, 200); i = 1; }
    const rest = parts.slice(i).join('').trim();
    return { s: s.trim() + (rest ? (l === 'en' ? ' Say "more details" for the rest.' : ' बाकी सुनने के लिए "और डिटेल" कहिए।') : ''), rest: rest };
  }
  async function present(resp) {
    if (!resp) return;
    const l = resp.onlyLang || rl();
    const text = resp[l] || resp.en;
    if (!resp.noStore) st.lastResp = resp;
    if (VA.ui) VA.ui.addAssistant(text, l);
    if (VA.prefs.mode === 'text' || resp.silent) return;
    const sp = speakable(text, l);
    st.more = sp.rest ? { text: sp.rest, l: l } : null;
    await VA.tts.speak(sp.s, l);
  }
  VA.present = present;

  function autoListenOK(resp) {
    return resp && resp.listen && VA.prefs.autoListen && VA.prefs.mode !== 'text';
  }

  /* ---------------- public pipeline ---------------- */
  VA.handle = async function (raw, src) {
    raw = String(raw || '').trim();
    if (!raw) return;
    const n = NLU.norm(raw), now = Date.now();
    if (n === st.lastN && now - st.lastT < 1500) return; /* duplicate-command guard */
    st.lastN = n; st.lastT = now;
    if (st.busy) { st.queued = { raw: raw, src: src }; return; }
    st.busy = true;
    VA.tts.stop();
    if (VA.ui) { VA.ui.addUser(raw, src); VA.ui.state('processing'); }
    let resp = null;
    try { resp = await route(raw); }
    catch (e) { console.error(e); resp = R('Something went wrong, nothing was changed. Please try again.', 'कुछ गड़बड़ हुई, कुछ नहीं बदला। फिर कोशिश कीजिए।'); }
    st.busy = false;
    if (VA.ui) VA.ui.state('idle');
    await present(resp);
    if (st.queued) { const q = st.queued; st.queued = null; st.lastN = ''; return VA.handle(q.raw, q.src); }
    if (autoListenOK(resp) && src === 'voice') VA.listenOnce({ auto: true });
  };

  function listenLang() { return VA.prefs.lang !== 'auto' ? VA.prefs.lang : (st.lastLang || (A() && A().ready() ? A().lang() : 'hi')); }
  VA.listenOnce = async function (o) {
    o = o || {};
    if (st.listening) { await VA.stt.cancel(); return; }
    st.listening = true;
    if (VA.ui) { VA.ui.state('listening'); VA.ui.partial(''); }
    let text = '';
    try { text = await VA.stt.listen({ lang: listenLang(), onPartial: function (t) { if (VA.ui) VA.ui.partial(t); } }); }
    catch (e) {
      st.listening = false;
      if (VA.ui) { VA.ui.state('idle'); VA.ui.partial(''); }
      if (e && e.code === 'cancelled') return;
      if (VA.ui) VA.ui.error(VA.errMsg(e && e.code, rl()), e && e.code);
      return;
    }
    st.listening = false;
    if (VA.ui) { VA.ui.state('idle'); VA.ui.partial(''); }
    if (!text) {
      if (o.auto && ++st.empty < 2) return VA.listenOnce({ auto: true });
      st.empty = 0;
      if (VA.ui) VA.ui.error(VA.errMsg('nomatch', rl()), 'nomatch');
      return;
    }
    st.empty = 0;
    await VA.handle(text, 'voice');
  };
  VA.stopSpeaking = function () { VA.tts.stop(); };
  VA.cancelAll = function () {
    st.queued = null; st.confirm = null;
    VA.stt.cancel(); VA.tts.stop();
    if (VA.ui) { VA.ui.state('idle'); VA.ui.partial(''); }
  };
  VA.repeat = function () { return st.lastResp ? present(Object.assign({}, st.lastResp, { noStore: true })) : null; };

  VA.on('speaking', function (on) { if (VA.ui && !st.busy && !st.listening) VA.ui.state(on ? 'speaking' : 'idle'); });
  const warned = {};
  VA.on('ttsmissing', function (code) {
    if (warned[code]) return; warned[code] = 1;
    const l = rl();
    if (VA.ui) VA.ui.error(l === 'hi'
      ? 'इस फ़ोन में ' + (code === 'hi' ? 'हिंदी' : 'अंग्रेज़ी') + ' आवाज़ उपलब्ध नहीं है। जवाब टेक्स्ट में दिखेंगे। Android सेटिंग्स में Text-to-speech से आवाज़ डाउनलोड करें।'
      : 'No ' + (code === 'hi' ? 'Hindi' : 'English') + ' voice is available on this phone. Replies will show as text. Download the voice in Android Text-to-speech settings.', 'tts');
  });
})();
