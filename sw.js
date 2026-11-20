const C='rohan-journal-v7',F=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./voice-bridge.js','./va-nlu.js','./va-io.js','./va-app.js','./va-core.js','./va-ui.js','./va-brain.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(F.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||!/^https?:$/.test(u.protocol)||u.hostname.endsWith('openai.com')||u.hostname.endsWith('deepseek.com'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok&&r.type==='basic'){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('./index.html'))));
});
