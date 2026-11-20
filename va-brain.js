/* va-brain.js - persona, continuous conversation, live weather / calendar / news / AI market analysis.
   Sits on top of va-core.js. Never invents data: every live answer comes from a fetched source or says it failed. */
(function () {
  'use strict';
  const VA = window.VA = window.VA || {};
  const pr = VA.prefs;
  if (!pr.name) pr.name = 'वेदा';
  if (!pr.addr) pr.addr = 'रोहन जी';
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const L = function () { return VA.rl ? VA.rl() : 'hi'; };
  const R = function (en, hi) { return { en: en, hi: hi }; };
  let live = false, looping = false, fatal = false;

  /* ---------- network (CapacitorHttp makes fetch native, so no CORS problem) ---------- */
  function get(url, asText) {
    const c = new AbortController(), t = setTimeout(function () { c.abort(); }, 12000);
    return fetch(url, { signal: c.signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return asText ? r.text() : r.json();
    }).finally(function () { clearTimeout(t); });
  }
  const hhmm = function (d) { return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); };

  /* ---------- weather (Open-Meteo, no key) ---------- */
  const WX = function (c) {
    if (c === 0) return ['clear sky', 'आसमान साफ़ है'];
    if (c <= 3) return ['partly cloudy', 'हल्के बादल हैं'];
    if (c === 45 || c === 48) return ['foggy', 'कोहरा है'];
    if (c >= 51 && c <= 67) return ['rainy', 'बारिश है'];
    if (c >= 71 && c <= 77) return ['snowy', 'बर्फ़बारी है'];
    if (c >= 80 && c <= 82) return ['showers', 'बौछारें हैं'];
    if (c >= 95) return ['thunderstorm', 'आंधी-तूफ़ान है'];
    return ['changeable', 'मौसम बदल रहा है'];
  };
  async function weather() {
    if (!pr.city) return R('Please tell me your city first, for example "my city is Delhi".', pr.addr + ', पहले अपना शहर बताइए, जैसे "मेरा शहर दिल्ली है"।');
    const g = await get('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(pr.city));
    const p = g.results && g.results[0]; if (!p) return R('I could not find the city ' + pr.city + '.', 'शहर ' + pr.city + ' नहीं मिला।');
    const w = await get('https://api.open-meteo.com/v1/forecast?latitude=' + p.latitude + '&longitude=' + p.longitude + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1');
    const c = w.current, d = w.daily, k = WX(c.weather_code), t = Math.round(c.temperature_2m), f = Math.round(c.apparent_temperature);
    const mx = Math.round(d.temperature_2m_max[0]), mn = Math.round(d.temperature_2m_min[0]), rn = d.precipitation_probability_max[0];
    return R(pr.city + ' right now: ' + t + ' degrees, feels like ' + f + ', ' + k[0] + '. Today ' + mn + ' to ' + mx + ', rain chance ' + rn + ' percent.',
      pr.addr + ', ' + pr.city + ' में अभी ' + t + ' डिग्री है, महसूस ' + f + ' डिग्री, ' + k[1] + '। आज ' + mn + ' से ' + mx + ' डिग्री, बारिश की संभावना ' + rn + ' प्रतिशत।');
  }

  /* ---------- economic calendar (weekly feed) ---------- */
  let calC = { t: 0, v: [] };
  async function calendar() {
    if (Date.now() - calC.t < 20 * 60000 && calC.v.length) return calC.v;
    const j = await get('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    calC = { t: Date.now(), v: (j || []).filter(function (e) { return e.country === 'USD' && e.impact === 'High'; }).map(function (e) { return { title: e.title, at: new Date(e.date), fc: e.forecast, pv: e.previous }; }).filter(function (e) { return !isNaN(e.at); }) };
    return calC.v;
  }
  const sameDay = function (a, b) { return a.toDateString() === b.toDateString(); };
  async function calAnswer(wantSafety) {
    const ev = await calendar(), now = new Date();
    const today = ev.filter(function (e) { return sameDay(e.at, now); }).sort(function (a, b) { return a.at - b.at; });
    const near = ev.filter(function (e) { const m = (e.at - now) / 60000; return m > -30 && m < 60; });
    let en = '', hi = '';
    if (near.length) {
      const e = near[0], m = Math.round((e.at - now) / 60000);
      en = 'Caution: high impact US news "' + e.title + '" at ' + hhmm(e.at) + (m > 0 ? ' in ' + m + ' minutes' : ' just released') + '. Avoid fresh trades around it. ';
      hi = pr.addr + ', सावधान! अमेरिका की हाई इम्पैक्ट न्यूज़ "' + e.title + '" ' + hhmm(e.at) + ' बजे है' + (m > 0 ? ', ' + m + ' मिनट बाद' : ', अभी आई है') + '। इसके आसपास नया ट्रेड न लें। ';
    } else if (wantSafety) { en = 'No high impact US news within the next hour. '; hi = 'अगले एक घंटे में अमेरिका की कोई हाई इम्पैक्ट न्यूज़ नहीं है। '; }
    if (!wantSafety || near.length) {
      const list = today.length ? today : ev.filter(function (e) { return e.at > now; }).slice(0, 3);
      const lab = today.length ? '' : 'next ';
      en += list.length ? 'High impact US events ' + (today.length ? 'today' : 'coming up') + ': ' + list.map(function (e) { return e.title + ' at ' + hhmm(e.at); }).join('; ') + '.' : 'No more high impact US events this week.';
      hi += list.length ? (today.length ? 'आज' : 'आगे') + ' की हाई इम्पैक्ट खबरें: ' + list.map(function (e) { return e.title + ' ' + hhmm(e.at) + ' बजे'; }).join('; ') + '।' : 'इस हफ़्ते अब कोई हाई इम्पैक्ट खबर नहीं है।';
      void lab;
    }
    return R(en, hi);
  }

  /* ---------- headlines (RSS) ---------- */
  async function headlines(q, n) {
    const x = await get('https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q=' + encodeURIComponent(q), true);
    const d = new DOMParser().parseFromString(x, 'text/xml');
    return [].slice.call(d.querySelectorAll('item')).slice(0, n || 5).map(function (i) { return (i.querySelector('title') || {}).textContent || ''; }).filter(Boolean);
  }
  async function news() {
    const h = await headlines('gold price OR federal reserve OR dollar index OR forex', 4);
    if (!h.length) return R('No headlines came back right now.', 'अभी कोई हेडलाइन नहीं मिली।');
    return R('Top headlines: ' + h.join('. '), pr.addr + ', ताज़ा हेडलाइंस (अंग्रेज़ी में): ' + h.join('. '));
  }

  /* ---------- AI fundamental analysis (uses the key already set in Tools) ---------- */
  async function analysis() {
    if (typeof callAI !== 'function') return R('The AI engine is not ready.', 'AI तैयार नहीं है।');
    let h = [], c = [];
    try { h = await headlines('gold XAUUSD OR federal reserve OR US inflation OR geopolitics', 8); } catch (e) { /* continue without */ }
    try { c = (await calendar()).filter(function (e) { return e.at > new Date(); }).slice(0, 5); } catch (e) { /* continue without */ }
    if (!h.length && !c.length) return R('I could not fetch any market news right now, so I will not guess.', 'अभी बाज़ार की खबरें नहीं मिलीं, इसलिए मैं अंदाज़ा नहीं लगाऊँगा।');
    const hi = L() === 'hi';
    const sys = 'You are a careful market analyst for a gold (XAUUSD) trader. Use ONLY the headlines and events given. In at most 6 short sentences: key drivers, what could move gold and the dollar, and which events to watch. Say clearly that this is an opinion, not a signal. Never give buy/sell calls. ' + (hi ? 'Reply in Hindi, Devanagari script.' : 'Reply in English.');
    const t = await callAI('HEADLINES:\n' + h.join('\n') + '\n\nUPCOMING HIGH-IMPACT US EVENTS:\n' + c.map(function (e) { return e.title + ' ' + e.at.toISOString() + ' fc ' + (e.fc || '-') + ' prev ' + (e.pv || '-'); }).join('\n'), { sys: sys, hist: [] });
    return R(t, t);
  }

  /* ---------- intent routing (only what the core does not know) ---------- */
  const STOP = /(band karo|bandh karo|baat band|mic band|ruk jao|ruko|so jao|sleep|stop listening|go to sleep|bye|alvida|बंद करो|रुक जाओ|सो जाओ|बात बंद)/i;
  async function brain(raw) {
    const n = raw.toLowerCase(); let m;
    if (STOP.test(n) && live) { live = false; VA.cancelAll(); return R('Okay ' + pr.addr + ', going to sleep. Tap the mic to call me.', 'ठीक है ' + pr.addr + ', मैं बंद हो रही हूँ। बुलाने के लिए माइक दबाइए।'); }
    if ((m = n.match(/(?:tumhara|tera|aapka|your)\s+(?:naam|name)\s+(?:is\s+)?(.+?)\s*(?:rakho|rakh do|hai)?$/)) && m[1]) { pr.name = m[1].trim(); VA.savePrefs(); return R('Done. My name is ' + pr.name + '.', 'ठीक है, अब मेरा नाम ' + pr.name + ' है।'); }
    if ((m = n.match(/mujhe\s+(.+?)\s+(?:bolo|bulao|kaho)/)) || (m = n.match(/call me\s+(.+)/))) { pr.addr = m[1].trim(); VA.savePrefs(); return R('Sure, I will call you ' + pr.addr + '.', 'ठीक है, मैं आपको ' + pr.addr + ' कहूँगी।'); }
    if ((m = n.match(/(?:mera\s+(?:shehar|shahar|city)|my city(?: is)?)\s+(.+?)(?:\s+hai)?$/))) { pr.city = m[1].trim(); VA.savePrefs(); return R('Saved your city: ' + pr.city + '.', 'आपका शहर ' + pr.city + ' सेव कर लिया।'); }
    const job = /(analysis|fundamental|outlook|impact|vishleshan|विश्लेषण|market (kaisa|kaise|ka)|gold (ke liye|ki)|बाज़ार)/.test(n) ? analysis
      : /(news (kab|time|hai|kya hai)|calendar|kab hai|high impact|trade kar|खबर कब|न्यूज़ कब|कैलेंडर)/.test(n) ? function () { return calAnswer(/trade|abhi|अभी/.test(n)); }
      : /(weather|mausam|मौसम|temperature|तापमान)/.test(n) ? weather
      : /(news|khabar|headline|खबर|समाचार|न्यूज़)/.test(n) ? news : null;
    if (!job) return null;
    try { return await job(); } catch (e) { return R('I could not reach the internet source just now (' + ((e && e.message) || 'error') + '). Please try again.', 'अभी इंटरनेट से जानकारी नहीं मिल पाई। कृपया दोबारा कोशिश कीजिए।'); }
  }

  /* ---------- wrap the core pipeline ---------- */
  const coreHandle = VA.handle, coreListen = VA.listenOnce;
  VA.handle = async function (raw, src) {
    raw = String(raw || '').trim(); if (!raw) return;
    const r = await brain(raw);
    if (!r) return coreHandle(raw, src);
    const l = L(), text = r[l] || r.en;
    if (VA.ui) { VA.ui.addUser(raw, src); VA.ui.addAssistant(text, l); }
    if (pr.mode !== 'text') await VA.tts.speak(text.length > 600 ? text.slice(0, 600) : text, l);
  };

  /* ---------- continuous conversation ---------- */
  async function loop() {
    if (looping) return; looping = true; fatal = false;
    while (live) {
      if (VA.tts.speaking()) { await sleep(250); continue; }
      await coreListen({ live: true });
      if (fatal) { live = false; break; }
      await sleep(250);
    }
    looping = false;
  }
  VA.listenOnce = async function (o) {
    o = o || {};
    if (live && o.auto) return;                       /* the live loop already re-opens the mic */
    if (o.auto || o.live) return coreListen(o);
    if (live) { live = false; VA.cancelAll(); return; } /* tap while live = switch off */
    live = true;
    if (VA.ui && !VA.ui.__brain) {                    /* silence "nothing heard" toasts in live mode */
      const ue = VA.ui.error; VA.ui.__brain = true;
      VA.ui.error = function (m, c) { if (live && (c === 'nomatch' || c === 'timeout')) return; if (live) fatal = true; return ue.apply(VA.ui, arguments); };
    }
    const l = L(), g = l === 'hi' ? 'नमस्ते ' + pr.addr + ', मैं ' + pr.name + ' हूँ। बताइए, क्या करूँ?' : 'Hello ' + pr.addr + ', I am ' + pr.name + '. How can I help?';
    if (VA.ui) VA.ui.addAssistant(g, l);
    if (pr.mode !== 'text') await VA.tts.speak(g, l);
    loop();
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden) live = false; });

  /* ---------- proactive high-impact news alert (only while the app is open) ---------- */
  const told = {};
  setInterval(async function () {
    try {
      const now = new Date();
      (await calendar()).forEach(function (e) {
        const m = (e.at - now) / 60000, k = e.title + e.at.getTime();
        if (m > 0 && m <= 15 && !told[k]) {
          told[k] = 1;
          const l = L(), t = l === 'hi' ? pr.addr + ', ' + Math.round(m) + ' मिनट बाद हाई इम्पैक्ट खबर: ' + e.title + '। अभी ट्रेड न लें।' : pr.addr + ', high impact news in ' + Math.round(m) + ' minutes: ' + e.title + '. Avoid new trades.';
          if (VA.ui) VA.ui.addAssistant(t, l);
          if (live && pr.mode !== 'text') VA.tts.speak(t, l);
        }
      });
    } catch (e) { /* offline: stay silent */ }
  }, 60000);
  VA.brain = { calendar: calendar, weather: weather, analysis: analysis };
})();
