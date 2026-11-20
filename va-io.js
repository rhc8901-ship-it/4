/* va-io.js - speech recognition (STT) and text-to-speech (TTS) services.
   Rules: one recognition session at a time, one utterance at a time, never listen while speaking. */
(function () {
  'use strict';
  const VA = window.VA = window.VA || {};

  /* tiny pub/sub so services never touch the UI directly */
  const subs = {};
  VA.on = function (ev, fn) { (subs[ev] = subs[ev] || []).push(fn); };
  VA.emit = function (ev, a, b) { (subs[ev] || []).forEach(function (f) { try { f(a, b); } catch (e) { console.error(e); } }); };

  /* preferences are persisted in their own key so trade data / backups are untouched */
  const PKEY = 'gj_voice';
  const DEF = { mode: 'voicetext', lang: 'auto', rate: 1, pitch: 1.1, volume: 1, voice: { hi: '', en: '' }, autoListen: true, aiFallback: false, fabY: null };
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch (e) { p = {}; }
    const o = Object.assign({}, DEF, p);
    o.voice = Object.assign({ hi: '', en: '' }, p.voice || {});
    return o;
  }
  VA.prefs = loadPrefs();
  VA.savePrefs = function () { try { localStorage.setItem(PKEY, JSON.stringify(VA.prefs)); } catch (e) { /* storage full: keep running */ } };

  const isNative = function () { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); };
  const BCP = { hi: 'hi-IN', en: 'en-IN' };

  /* ---------------- error messages (shown + spoken) ---------------- */
  const ERR = {
    unavailable: ['Speech recognition is not available on this phone. Install or enable the Google app / Speech Services.', 'इस फ़ोन में स्पीच रिकग्निशन उपलब्ध नहीं है। Google ऐप या Speech Services चालू करें।'],
    permission: ['Microphone permission was denied. Allow Microphone for this app in Android settings.', 'माइक्रोफ़ोन की अनुमति नहीं मिली। Android सेटिंग्स में इस ऐप को माइक्रोफ़ोन की अनुमति दें।'],
    network: ['Speech recognition needs internet right now and could not connect.', 'अभी स्पीच रिकग्निशन को इंटरनेट चाहिए और कनेक्शन नहीं मिला।'],
    nomatch: ['I did not catch that. Tap the mic and try again.', 'मैं सुन नहीं पाया। माइक दबाकर फिर बोलिए।'],
    timeout: ['No speech heard. Mic is off now.', 'कोई आवाज़ नहीं सुनी। माइक बंद है।'],
    busy: ['The microphone is busy. Try again in a moment.', 'माइक अभी व्यस्त है। थोड़ी देर बाद फिर कोशिश करें।'],
    unsupported: ['Voice input is not available here. Type your command instead.', 'यहाँ वॉइस इनपुट उपलब्ध नहीं है। कमांड टाइप करें।'],
    failed: ['Voice input failed. Try again or type your command.', 'वॉइस इनपुट नहीं चला। फिर कोशिश करें या कमांड टाइप करें।']
  };
  VA.errMsg = function (code, l) { const e = ERR[code] || ERR.failed; return l === 'en' ? e[0] : e[1]; };
  function mkErr(code) { const e = new Error(code); e.code = code; return e; }
  function mapErr(e) {
    if (e && e.code && ERR[e.code] || (e && e.code === 'cancelled')) return e;
    const m = String((e && (e.message || e)) || '').toLowerCase();
    if (/permission|denied|not granted/.test(m)) return mkErr('permission');
    if (/network|internet|connect/.test(m)) return mkErr('network');
    if (/no match|nomatch|no speech|not-allowed|7\b/.test(m) && /match|speech/.test(m)) return mkErr('nomatch');
    if (/timeout|timed out|6\b/.test(m)) return mkErr('timeout');
    if (/busy|client|already/.test(m)) return mkErr('busy');
    if (/unavailable|not available|not implemented|unimplemented/.test(m)) return mkErr('unavailable');
    return mkErr('failed');
  }

  /* ---------------- Speech recognition ---------------- */
  const SRp = function () { return window.RCSpeechRecognition || null; };
  let session = null;

  const stt = VA.stt = {
    active: function () { return !!session; },
    async status() {
      const s = { native: isNative(), available: null, permission: 'unknown' };
      try {
        if (s.native && SRp()) {
          const a = await SRp().available(); s.available = !!(a && a.available);
          const p = await SRp().checkPermissions(); s.permission = (p && p.speechRecognition) || 'unknown';
        } else s.available = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      } catch (e) { s.available = false; }
      return s;
    },
    async ensure() {
      if (isNative() && SRp()) {
        const a = await SRp().available();
        if (!a || !a.available) throw mkErr('unavailable');
        let p = await SRp().checkPermissions();
        if (!p || p.speechRecognition !== 'granted') p = await SRp().requestPermissions();
        if (!p || p.speechRecognition !== 'granted') throw mkErr('permission');
      } else if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) throw mkErr('unsupported');
    },
    async cancel() {
      if (session) { const s = session; session = null; try { s.cancel(); } catch (e) { /* ignore */ } }
      try { if (isNative() && SRp()) await SRp().stop(); } catch (e) { /* not listening */ }
    },
    /* resolves with the recognised text ('' if nothing); rejects with {code} */
    async listen(opts) {
      opts = opts || {};
      tts.stop();                       /* never listen while speaking (echo) */
      if (session) await stt.cancel();  /* never two sessions */
      await stt.ensure();
      const lang = BCP[opts.lang === 'en' ? 'en' : 'hi'];
      const maxMs = opts.maxMs || 20000;
      return new Promise(function (resolve, reject) {
        let done = false, last = '', timer = null, handles = [];
        const cleanup = function () {
          clearTimeout(timer); session = null;
          handles.forEach(function (h) { Promise.resolve(h).then(function (x) { x && x.remove && x.remove(); }).catch(function () {}); });
          handles = [];
          VA.emit('listening', false);
        };
        const finish = function (text, err) {
          if (done) return; done = true; cleanup();
          if (err) reject(err); else resolve((text || '').trim());
        };
        const onPartial = function (t) { last = t || last; if (opts.onPartial) opts.onPartial(last); };
        session = { cancel: function () { finish('', mkErr('cancelled')); } };
        VA.emit('listening', true);
        timer = setTimeout(function () {
          if (isNative() && SRp()) SRp().stop().catch(function () {});
          else if (session && session.web) session.web.stop();
          setTimeout(function () { finish(last, last ? null : mkErr('timeout')); }, 600);
        }, maxMs);

        if (isNative() && SRp()) {
          const P = SRp();
          handles.push(P.addListener('partialResults', function (d) { onPartial(d && d.matches && d.matches[0]); }));
          handles.push(P.addListener('listeningState', function (d) {
            if (d && d.status === 'stopped') setTimeout(function () { finish(last, last ? null : mkErr('nomatch')); }, 400);
          }));
          P.start({ language: lang, maxResults: 3, prompt: '', partialResults: true, popup: false })
            .then(function (r) { if (r && r.matches && r.matches.length) finish(r.matches[0]); })
            .catch(function (e) { finish('', mapErr(e)); });
        } else {
          const W = window.SpeechRecognition || window.webkitSpeechRecognition;
          const r = new W(); r.lang = lang; r.interimResults = true; r.maxAlternatives = 1;
          session.web = r;
          r.onresult = function (e) {
            let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
            onPartial(t); if (e.results[e.results.length - 1].isFinal) finish(t);
          };
          r.onerror = function (e) { finish('', mapErr({ message: e.error === 'no-speech' ? 'no speech' : e.error })); };
          r.onend = function () { finish(last, last ? null : mkErr('nomatch')); };
          try { r.start(); } catch (e) { finish('', mapErr(e)); }
        }
      });
    },
    /* used by the old mic buttons in index.html so only ONE speech path exists */
    async dictate() {
      const l = (typeof S !== 'undefined' && S.lang === 'en') ? 'en' : 'hi';
      try { return await stt.listen({ lang: l }); }
      catch (e) { if (e.code === 'cancelled') return ''; throw new Error(VA.errMsg(e.code, l)); }
    }
  };

  /* ---------------- Text to speech ---------------- */
  const TTSp = function () { return window.RCTextToSpeech || null; };
  let gen = 0, speaking = false, voiceCache = null, ttsStatus = { engine: 'none', ok: null, voice: '', note: '' };

  function normLang(l) { return String(l || '').replace('_', '-').toLowerCase(); }
  async function nativeVoices() {
    if (voiceCache) return voiceCache;
    try {
      const r = await TTSp().getSupportedVoices();
      voiceCache = (r && r.voices || []).map(function (v, i) { return { index: i, name: v.name || v.voiceURI || ('voice ' + i), lang: normLang(v.lang), local: !!v.localService }; });
    } catch (e) { voiceCache = []; }
    return voiceCache;
  }
  function webVoices() {
    try { return (window.speechSynthesis.getVoices() || []).map(function (v, i) { return { index: i, name: v.name, lang: normLang(v.lang), local: v.localService, v: v }; }); }
    catch (e) { return []; }
  }
  function femaleRank(v) { return /female|woman/i.test(v.name) ? 0 : 1; }

  const tts = VA.tts = {
    speaking: function () { return speaking; },
    status: function () { return ttsStatus; },
    engine: function () { return TTSp() && isNative() ? 'native' : (window.speechSynthesis ? 'web' : 'none'); },
    async voices(l) {
      const code = l === 'en' ? 'en' : 'hi';
      const all = tts.engine() === 'native' ? await nativeVoices() : webVoices();
      return all.filter(function (v) { return v.lang.indexOf(code) === 0; }).sort(function (a, b) { return femaleRank(a) - femaleRank(b) || (b.local - a.local); });
    },
    async pick(l) {
      const list = await tts.voices(l);
      const want = VA.prefs.voice[l];
      return (want && list.filter(function (v) { return v.name === want; })[0]) || list[0] || null;
    },
    /* Check that the phone has a voice for this language and remember the result */
    async check(l) {
      const code = l === 'en' ? 'en' : 'hi';
      const eng = tts.engine();
      if (eng === 'none') { ttsStatus = { engine: 'none', ok: false, voice: '', note: 'No speech engine' }; return ttsStatus; }
      let ok = null;
      try { if (eng === 'native') { const r = await TTSp().isLanguageSupported({ lang: BCP[code] }); ok = !!(r && r.supported); } } catch (e) { ok = null; }
      const v = await tts.pick(code);
      if (ok === null) ok = !!v;
      ttsStatus = { engine: eng, ok: ok, voice: v ? v.name : '', note: '' };
      return ttsStatus;
    },
    async openInstall() { try { if (TTSp() && TTSp().openInstall) await TTSp().openInstall(); } catch (e) { /* ignore */ } },
    stop: function () {
      gen++;
      speaking = false;
      try { if (TTSp() && isNative()) TTSp().stop().catch(function () {}); } catch (e) { /* ignore */ }
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      VA.emit('speaking', false);
    },
    /* resolves true when finished, false when interrupted/failed. New speech always interrupts old speech. */
    async speak(text, l) {
      text = String(text || '').trim(); if (!text) return false;
      const code = l === 'en' ? 'en' : 'hi';
      tts.stop();
      const my = ++gen;
      const p = VA.prefs, eng = tts.engine();
      if (eng === 'none') { ttsStatus = { engine: 'none', ok: false, voice: '', note: 'No speech engine' }; VA.emit('ttsmissing', code); return false; }
      speaking = true; VA.emit('speaking', true);
      try {
        const v = await tts.pick(code);
        if (my !== gen) return false;
        if (eng === 'native') {
          const o = { text: text, lang: BCP[code], rate: p.rate, pitch: p.pitch, volume: p.volume };
          if (v) o.voice = v.index;
          await TTSp().speak(o);
        } else {
          await new Promise(function (res, rej) {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = BCP[code]; u.rate = p.rate; u.pitch = p.pitch; u.volume = p.volume;
            if (v && v.v) u.voice = v.v;
            u.onend = res; u.onerror = function (e) { if (e && e.error === 'interrupted') res(); else rej(e); };
            window.speechSynthesis.speak(u);
          });
        }
        if (my === gen) { speaking = false; VA.emit('speaking', false); }
        ttsStatus.ok = true;
        return my === gen;
      } catch (e) {
        if (my === gen) { speaking = false; VA.emit('speaking', false); ttsStatus.ok = false; VA.emit('ttsmissing', code); }
        return false;
      }
    }
  };

  /* Android lifecycle: release the mic and the speaker when the app goes to background */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { tts.stop(); stt.cancel(); }
  });
  window.addEventListener('pagehide', function () { tts.stop(); stt.cancel(); });
})();
