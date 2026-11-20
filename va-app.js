/* va-app.js - adapter between the voice assistant and the REAL journal app.
   It only calls functions / reads fields that exist in index.html. Nothing here invents data. */
(function () {
  'use strict';
  const VA = window.VA = window.VA || {};
  const q = function (s) { return document.querySelector(s); };

  /* ---- navigation history (for "go back") ---- */
  const hist = [];
  let navBack = false;
  const origGoto = window.gotoTab;
  if (typeof origGoto === 'function') {
    window.gotoTab = function (n) {
      try { if (!navBack && TAB && TAB !== n) { hist.push(TAB); if (hist.length > 20) hist.shift(); } } catch (e) { /* ignore */ }
      return origGoto.apply(this, arguments);
    };
  }

  const pad = function (n) { return String(n).padStart(2, '0'); };
  function nowLocal() { const d = new Date(); return ld(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function inPeriod(t, p) {
    const d = day(t);
    if (p === 'today') return d === today();
    if (p === 'yesterday') { const y = new Date(); y.setDate(y.getDate() - 1); return d === ld(y); }
    if (p === 'week') return d >= wkStart();
    if (p === 'lastweek') { const ws = wkStart(), w = new Date(ws + 'T00:00:00'); w.setDate(w.getDate() - 7); return d >= ld(w) && d < ws; }
    if (p === 'month') return d.slice(0, 7) === today().slice(0, 7);
    if (p === 'lastmonth') { const m = new Date(); m.setDate(1); m.setMonth(m.getMonth() - 1); return d.slice(0, 7) === ld(m).slice(0, 7); }
    return true;
  }

  function setField(id, v) {
    const el = q('#' + id);
    if (!el) return false;
    if (el.tagName === 'SELECT' && ![].some.call(el.options, function (o) { return o.value === String(v) || o.text === String(v); })) return false;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const num = function (id) { const el = q('#' + id); const n = el ? parseFloat(el.value) : NaN; return isNaN(n) ? null : n; };

  const A = VA.A = {
    ready: function () { return typeof T !== 'undefined' && typeof saveTrade === 'function'; },
    lang: function () { return typeof S !== 'undefined' && S.lang === 'en' ? 'en' : 'hi'; },

    /* ----- navigation ----- */
    goto: function (tab) { gotoTab(tab); },
    tab: function () { return TAB; },
    back: function () {
      const p = hist.pop(); if (!p) return false;
      navBack = true; try { origGoto(p); } finally { navBack = false; }
      return true;
    },

    /* ----- data (read only) ----- */
    real: function () { return T.filter(function (t) { return !t.sum; }); },
    period: function (p) { return T.filter(function (t) { return inPeriod(t, p); }); },
    stats: function (a) { return stats(a); },
    counts: function (a) {
      const rl = a.filter(function (t) { return !t.sum; }), sm = a.filter(function (t) { return t.sum; });
      const sv = function (k) { return sm.reduce(function (x, t) { return x + (t[k] || 0); }, 0); };
      const w = rl.filter(function (t) { return t.pnl > 0; }).length + sv('nw'), l = rl.filter(function (t) { return t.pnl < 0; }).length + sv('nl');
      return { n: rl.length + sv('nw') + sv('nl'), w: w, l: l, net: sumP(a) };
    },
    byPair: function (a) { return group(a.filter(function (t) { return !t.sum; }), function (t) { return t.sym; }); },
    last: function () { const r = A.real().sort(byDate); return r.length ? r[r.length - 1] : null; },
    find: function (id) { return T.find(function (x) { return x.id === id; }) || null; },
    money: function (v) { return money(v); },
    tags: function () { const s = q('#f-tag'); return s ? [].map.call(s.options, function (o) { return o.value; }) : []; },

    /* ----- trade form (the real form) ----- */
    editing: function () { return !!EDIT; },
    form: {
      open: function () { gotoTab('add'); },
      clear: function () {
        gotoTab('add');
        ['f-entry', 'f-exit', 'f-sl', 'f-tp', 'f-pl', 'f-cdate', 'f-note'].forEach(function (id) { const e = q('#' + id); if (e) e.value = ''; });
        setField('f-lots', '0.01'); setField('f-fee', '0');
      },
      fill: function (f) {
        gotoTab('add');
        const map = { sym: 'f-sym', dir: 'f-dir', entry: 'f-entry', exit: 'f-exit', sl: 'f-sl', tp: 'f-tp', lots: 'f-lots', fee: 'f-fee', pnl: 'f-pl', tag: 'f-tag', grade: 'f-grade', mood: 'f-mood' };
        const bad = [];
        Object.keys(f).forEach(function (k) {
          if (k === 'note') {
            const el = q('#f-note'); if (el) { el.value = el.value ? el.value + '; ' + f.note : f.note; }
            return;
          }
          if (map[k] && !setField(map[k], f[k])) bad.push(k);
        });
        if (!q('#f-date').value) setField('f-date', nowLocal());
        return bad;
      },
      read: function () {
        const v = function (id) { const e = q('#' + id); return e ? e.value : ''; };
        return { sym: v('f-sym'), dir: v('f-dir'), entry: num('f-entry'), exit: num('f-exit'), sl: num('f-sl'), tp: num('f-tp'), lots: num('f-lots'), fee: num('f-fee') || 0, pnl: num('f-pl') };
      },
      estimate: function () {
        const f = A.form.read();
        if (f.entry == null || f.exit == null || !(f.lots > 0)) return null;
        if (f.pnl != null) return f.pnl;
        const s = f.dir === 'buy' ? 1 : -1;
        return (f.exit - f.entry) * s * f.lots * pv(f.sym, f.exit) - Math.abs(f.fee || 0);
      },
      /* Calls the app's own saveTrade(). Success is verified against the data, not assumed. */
      save: async function () {
        if (!q('#f-date').value) setField('f-date', nowLocal());
        const before = T.length, wasEdit = !!EDIT;
        await saveTrade();
        const msg = (q('#msg') || {}).textContent || '';
        return { ok: wasEdit ? EDIT === null : T.length > before, msg: msg };
      },
      cancelEdit: function () { EDIT = null; buildUI(); render(); gotoTab('add'); }
    },
    guardWarnings: function () {
      try { const g = guard(); return { block: !!g.block, msgs: (g.r || []).filter(function (x) { return x[0] !== 't' && x[0] !== 'x'; }).map(function (x) { return x[1]; }) }; }
      catch (e) { return { block: false, msgs: [] }; }
    },

    /* ----- trade actions ----- */
    detail: function (id) { detail(id); },
    edit: function (id) { editTrade(id); },
    remove: function (id) { delTrade(id); return !T.some(function (x) { return x.id === id; }); },

    /* ----- search / filter ----- */
    filter: function (o) {
      if (o.lf !== undefined) LF = o.lf;
      if (o.q !== undefined) LQ = o.q;
      if (o.fs !== undefined) FS = o.fs;
      LP = 50;
      render(); gotoTab('list');
    },
    clearFilters: function () { LQ = ''; LF = ''; FS = ''; LP = 50; render(); gotoTab('list'); },

    /* ----- settings ----- */
    theme: function (t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('gj_th', t); } catch (e) { /* ignore */ } },
    appLang: function (l) { S.lang = l; save(); buildUI(); render(); },
    exportBackup: function () { gotoTab('tools'); return exportBk(); },
    exportCsv: function () { gotoTab('tools'); return csvOut(); },

    /* ----- optional AI (only used when the user switched it on) ----- */
    aiAnswer: async function (qt) {
      const a = realS(), mode = S.aictx || 'auto', use = a.length && (mode === 'yes' || (mode === 'auto' && TRX.test(qt)));
      const sys = 'You are a concise assistant for a gold (XAUUSD) and forex trader. Answer in at most 3 short sentences suitable for speaking. Never give buy/sell signals or personal financial advice. ' + (S.lang === 'en' ? 'Reply in English.' : 'Reply in Hindi written in Devanagari script.');
      return callAI(qt + (use ? '\n\nMY TRADE DATA (use only if relevant):\n' + brief(a.slice(-40)) : ''), { sys: sys, hist: [] });
    }
  };
})();
