/* va-ui.js - floating microphone, assistant panel, transcript and voice settings.
   Uses the app's own CSS variables (--gold, --card, --line ...) so it matches both themes. */
(function () {
  'use strict';
  const VA = window.VA = window.VA || {};
  let fab, panel, log, part, statusEl, input, settings, stLines;
  let moved = false;

  const IC = {
    mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4"/>',
    stop: '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/>',
    rep: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>'
  };
  const svg = function (k) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + '</svg>'; };
  const lang = function () { return VA.A && VA.A.ready() ? VA.A.lang() : 'hi'; };
  const T = function (en, hi) { return lang() === 'en' ? en : hi; };
  const el = function (t, c, h) { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  const CSS = '' +
    '#va-fab{position:fixed;right:14px;bottom:calc(88px + env(safe-area-inset-bottom,0px));width:54px;height:54px;border-radius:50%;border:0;background:var(--gg);color:#1a1405;display:grid;place-items:center;box-shadow:var(--sh);z-index:40;touch-action:none;cursor:pointer}' +
    '#va-fab:focus-visible,#va-panel button:focus-visible,#va-panel input:focus-visible,#va-panel select:focus-visible{outline:2px solid var(--gold);outline-offset:2px}' +
    '#va-fab::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--gold);opacity:0;pointer-events:none}' +
    '#va-fab.l::after{animation:vaPulse 1.1s ease-out infinite}' +
    '#va-fab.p::after{opacity:.9;border-style:dashed;animation:vaSpin 1.2s linear infinite}' +
    '#va-fab.s::after{opacity:.85;animation:vaBeat .7s ease-in-out infinite alternate}' +
    '@keyframes vaPulse{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.35);opacity:0}}' +
    '@keyframes vaSpin{to{transform:rotate(360deg)}}@keyframes vaBeat{to{transform:scale(1.18);opacity:.35}}' +
    '#va-panel{position:fixed;left:10px;right:10px;bottom:calc(152px + env(safe-area-inset-bottom,0px));max-height:52vh;display:none;flex-direction:column;background:var(--bg2);border:1px solid var(--line);border-radius:16px;box-shadow:var(--sh);z-index:41;overflow:hidden;color:var(--ink)}' +
    '#va-panel.on{display:flex}' +
    '#va-panel .vh{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}' +
    '#va-panel .vs{flex:1;font-size:13px;font-weight:600}' +
    '#va-panel .vb{min-width:40px;height:40px;border-radius:12px;border:1px solid var(--line);background:var(--fld);color:var(--ink);display:grid;place-items:center;cursor:pointer;padding:0 8px;font-size:12px;gap:4px}' +
    '#va-panel .vb.on{border-color:var(--gold);color:var(--gold)}' +
    '#va-log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:60px}' +
    '#va-log .m{max-width:88%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.45;word-break:break-word}' +
    '#va-log .u{align-self:flex-end;background:var(--fld);border:1px solid var(--line)}' +
    '#va-log .a{align-self:flex-start;background:var(--glow);border:1px solid var(--line)}' +
    '#va-log .e{align-self:stretch;max-width:100%;border:1px solid var(--dn);color:var(--dn);background:transparent}' +
    '#va-part{padding:0 12px 6px;font-size:13px;color:var(--mut);min-height:18px;font-style:italic}' +
    '#va-panel .vr{display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--line)}' +
    '#va-panel .vr input{flex:1;min-width:0;margin:0}' +
    '#va-panel.wide{max-height:82vh}#va-panel.wide #va-log{flex:none;min-height:96px;max-height:24vh}#va-panel.wide #va-set{max-height:none;flex:1}' +
    '#va-panel.compact #va-log .m:not(:last-child){display:none}#va-panel.compact .vr{display:none}' +
    '#va-set{display:none;padding:10px 12px;border-top:1px solid var(--line);overflow:auto;max-height:30vh;font-size:13px}#va-set.on{display:block}' +
    '#va-set .g{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0}#va-set label{font-size:12px;color:var(--mut)}' +
    '#va-set select,#va-set input[type=range]{width:55%;margin:0}#va-set .n{font-size:11.5px;color:var(--mut);line-height:1.4;margin-top:6px}' +
    '#va-set .chips{display:flex;gap:6px;flex-wrap:wrap}' +
    '@media (prefers-reduced-motion:reduce){#va-fab::after{animation:none!important}}';

  function btn(k, label, fn, cls) {
    const b = el('button', 'vb' + (cls ? ' ' + cls : ''), svg(k)); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.onclick = fn; return b;
  }
  function chip(label, on, fn) { const b = el('button', 'vb' + (on ? ' on' : ''), esc(label)); b.type = 'button'; b.onclick = fn; return b; }

  function openPanel() { panel.classList.add('on'); refreshStatus(); }
  function closePanel() { panel.classList.remove('on'); }

  function applyMode() { panel.classList.toggle('compact', VA.prefs.mode === 'voicefirst'); }

  function renderSettings() {
    const p = VA.prefs;
    settings.innerHTML = '';
    const g = function (label, node) { const d = el('div', 'g', '<label>' + esc(label) + '</label>'); d.appendChild(node); settings.appendChild(d); return d; };

    const modes = el('div', 'chips');
    [['text', T('Text only', 'Sirf text')], ['voicetext', T('Voice + text', 'Voice + text')], ['voicefirst', T('Voice first', 'Voice first')]].forEach(function (m) {
      modes.appendChild(chip(m[1], p.mode === m[0], function () { p.mode = m[0]; VA.savePrefs(); VA.emit('prefs'); }));
    });
    g(T('Reply mode', 'Jawab ka mode'), modes);

    const langs = el('div', 'chips');
    [['auto', 'Auto'], ['hi', 'हिंदी'], ['en', 'English']].forEach(function (m) {
      langs.appendChild(chip(m[1], p.lang === m[0], function () { p.lang = m[0]; VA.savePrefs(); VA.emit('prefs'); refreshStatus(); }));
    });
    g(T('Voice language', 'Voice ki bhasha'), langs);

    const slider = function (key, lo, hi) {
      const r = el('input'); r.type = 'range'; r.min = lo; r.max = hi; r.step = '0.05'; r.value = p[key];
      r.onchange = function () { p[key] = parseFloat(r.value); VA.savePrefs(); };
      return r;
    };
    g(T('Speech speed', 'Bolne ki speed'), slider('rate', 0.5, 1.6));
    g(T('Voice pitch', 'Awaaz ki pitch'), slider('pitch', 0.7, 1.5));

    ['hi', 'en'].forEach(function (code) {
      const s = el('select'); s.setAttribute('aria-label', code);
      s.innerHTML = '<option value="">' + esc(T('Auto (female preferred)', 'Auto (female ko pehle)')) + '</option>';
      VA.tts.voices(code).then(function (list) {
        list.forEach(function (v) { const o = el('option'); o.value = v.name; o.textContent = v.name + (v.local ? '' : ' (online)'); if (p.voice[code] === v.name) o.selected = true; s.appendChild(o); });
        if (!list.length) s.innerHTML = '<option value="">' + esc(T('No voice found', 'Voice nahi mili')) + '</option>';
      });
      s.onchange = function () { p.voice[code] = s.value; VA.savePrefs(); };
      g((code === 'hi' ? 'हिंदी ' : 'English ') + T('voice', 'voice'), s);
    });

    const act = el('div', 'chips');
    act.appendChild(chip(T('Test voice', 'Voice test'), false, function () {
      const l = VA.rl();
      VA.tts.speak(l === 'en' ? 'Hello, I am your trading journal assistant.' : 'नमस्ते, मैं आपका ट्रेडिंग जर्नल असिस्टेंट हूँ।', l);
    }));
    act.appendChild(chip(T('Install voices', 'Voice install'), false, function () { VA.tts.openInstall(); }));
    settings.appendChild(act);

    const cb = function (key, label, note) {
      const w = el('div', 'g'); const l = el('label', '', esc(label)); const c = el('input'); c.type = 'checkbox'; c.checked = !!p[key]; c.style.width = 'auto'; c.style.margin = '0';
      c.onchange = function () { p[key] = c.checked; VA.savePrefs(); };
      w.appendChild(l); w.appendChild(c); settings.appendChild(w);
      if (note) settings.appendChild(el('div', 'n', esc(note)));
    };
    cb('autoListen', T('Listen again during a question', 'Sawal ke baad dobara suno'), T('Only while I am waiting for your answer. The mic icon shows when it is on.', 'Sirf jab main aapke jawab ka wait kar raha hoon. Mic icon dikhata hai ki chalu hai.'));
    cb('aiFallback', T('Send unknown questions to AI coach', 'Anjaan sawal AI coach ko bhejo'), T('Off by default. Your question goes to the AI provider whose key you saved in Tools; trade data is shared only as allowed there.', 'Default band hai. Aapka sawal us AI provider ko jata hai jiski key Tools mein hai; trade data sirf Tools ki setting ke hisaab se jata hai.'));

    stLines = el('div', 'n'); settings.appendChild(stLines);
    refreshStatus();
  }

  async function refreshStatus() {
    if (!stLines) return;
    try {
      const s = await VA.stt.status();
      const t = await VA.tts.check(VA.rl());
      const perm = { granted: T('allowed', 'allow hai'), denied: T('denied', 'deny hai'), prompt: T('not asked yet', 'abhi poocha nahi'), 'prompt-with-rationale': T('not asked yet', 'abhi poocha nahi') }[s.permission] || T('unknown', 'pata nahi');
      stLines.innerHTML =
        esc(T('Microphone: ', 'Microphone: ') + perm) + '<br>' +
        esc(T('Speech recognition: ', 'Speech recognition: ') + (s.available ? T('ready', 'ready') : T('unavailable', 'available nahi'))) + '<br>' +
        esc(T('Voice output (', 'Voice output (') + (VA.rl() === 'hi' ? 'hi-IN' : 'en-IN') + '): ' + (t.ok ? (t.voice || T('ready', 'ready')) : T('no voice installed', 'voice install nahi'))) + '<br>' +
        esc(T('Recognition may need internet, depending on your phone\'s Google speech pack.', 'Recognition ko internet chahiye ho sakta hai, aapke phone ke Google speech pack par depend karta hai.'));
    } catch (e) { stLines.textContent = ''; }
  }

  const STATE_TXT = { idle: ['Ready', 'Taiyaar'], listening: ['Listening…', 'Sun raha hoon…'], processing: ['Thinking…', 'Soch raha hoon…'], speaking: ['Speaking…', 'Bol raha hoon…'] };
  const UI = VA.ui = {
    init: function () {
      if (document.getElementById('va-fab')) return;
      const css = el('style'); css.textContent = CSS; document.head.appendChild(css);

      fab = el('button', '', svg('mic')); fab.id = 'va-fab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Voice assistant');
      panel = el('div'); panel.id = 'va-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Voice assistant');

      const head = el('div', 'vh'); statusEl = el('div', 'vs', ''); head.appendChild(statusEl);
      head.appendChild(btn('stop', T('Stop speaking', 'Bolna band'), function () { VA.stopSpeaking(); }));
      head.appendChild(btn('rep', T('Repeat answer', 'Dobara bolo'), function () { VA.repeat(); }));
      head.appendChild(btn('x', T('Cancel command', 'Command cancel'), function () { VA.cancelAll(); }));
      const gb = btn('gear', T('Voice settings', 'Voice settings'), function () { settings.classList.toggle('on'); gb.classList.toggle('on'); panel.classList.toggle('wide', settings.classList.contains('on')); if (settings.classList.contains('on')) renderSettings(); });
      head.appendChild(gb);
      const cl = btn('down', T('Close panel', 'Panel band'), closePanel); cl.style.opacity = '.7'; head.appendChild(cl);

      log = el('div'); log.id = 'va-log'; log.setAttribute('aria-live', 'polite');
      part = el('div'); part.id = 'va-part';
      const row = el('div', 'vr');
      input = el('input'); input.type = 'text'; input.id = 'va-text'; input.placeholder = T('Type a command…', 'Command likhiye…'); input.autocomplete = 'off';
      input.onkeydown = function (e) { if (e.key === 'Enter') send(); };
      row.appendChild(input); row.appendChild(btn('send', T('Send', 'Bhejo'), send));
      settings = el('div'); settings.id = 'va-set';

      panel.appendChild(head); panel.appendChild(log); panel.appendChild(part); panel.appendChild(row); panel.appendChild(settings);
      document.body.appendChild(panel); document.body.appendChild(fab);

      /* tap = talk, drag = move up/down so it never hides something important */
      let sy = 0, st0 = 0, dragging = false, lpTimer = null, longPress = false;
      fab.addEventListener('pointerdown', function (e) {
        dragging = true; moved = false; longPress = false; sy = e.clientY; st0 = fab.getBoundingClientRect().top;
        try { fab.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        /* long press = open the panel to type, without starting the microphone */
        clearTimeout(lpTimer);
        lpTimer = setTimeout(function () { if (!moved) { longPress = true; openPanel(); input.focus(); } }, 450);
      });
      fab.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        const dy = e.clientY - sy;
        if (Math.abs(dy) > 8) { moved = true; const top = Math.max(60, Math.min(window.innerHeight - 140, st0 + dy)); fab.style.top = top + 'px'; fab.style.bottom = 'auto'; }
      });
      fab.addEventListener('pointerup', function () { dragging = false; clearTimeout(lpTimer); if (moved) { VA.prefs.fabY = parseInt(fab.style.top, 10); VA.savePrefs(); } });
      fab.addEventListener('click', function () {
        if (moved) { moved = false; return; }
        if (longPress) { longPress = false; return; }
        openPanel();
        if (VA.state.listening) { VA.stt.cancel(); return; }
        if (VA.tts.speaking()) VA.tts.stop();
        VA.listenOnce();
      });
      if (VA.prefs.fabY) { fab.style.top = Math.max(60, Math.min(window.innerHeight - 140, VA.prefs.fabY)) + 'px'; fab.style.bottom = 'auto'; }

      VA.on('prefs', function () { applyMode(); if (settings.classList.contains('on')) renderSettings(); });
      UI.state('idle'); applyMode();
      UI.addAssistant(T('Tap the mic and speak. Long-press the mic to type a command. Say "help" for examples.', 'Mic dabakar bolo. Command likhne ke liye mic ko dabaye rakho. Udaharan ke liye "help" bolo.'), lang(), true);
    },
    open: function () { openPanel(); },
    close: function () { closePanel(); },
    addUser: function (t, src) { openPanel(); push('m u', (src === 'voice' ? '🎤 ' : '') + esc(t)); },
    addAssistant: function (t, l, quiet) { if (!quiet) openPanel(); const d = push('m a', esc(t)); if (l) d.lang = l === 'hi' ? 'hi-IN' : 'en-IN'; },
    error: function (msg, code) { openPanel(); push('m e', esc(msg)); if (code === 'permission' || code === 'unavailable') refreshStatus(); },
    partial: function (t) { part.textContent = t || ''; },
    state: function (s) {
      fab.classList.remove('l', 'p', 's');
      fab.classList.add({ listening: 'l', processing: 'p', speaking: 's' }[s] || 'i');
      statusEl.textContent = T(STATE_TXT[s][0], STATE_TXT[s][1]);
      fab.setAttribute('aria-label', 'Voice assistant: ' + STATE_TXT[s][0]);
    }
  };
  function push(cls, html) {
    const d = el('div', cls, html); log.appendChild(d);
    while (log.children.length > 14) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight; return d;
  }
  function send() { const v = input.value.trim(); if (!v) return; input.value = ''; VA.handle(v, 'text'); }

  function boot() { try { UI.init(); } catch (e) { console.error('Voice UI failed; touch app still works', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
