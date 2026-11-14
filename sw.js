const CACHE='patrimoni-test-iphone-shell-v2';const FILES=['./','./index.html','./styles.css','./app.js','./returns.js','./aggregate.js','./database.js','./backup.js','./movement-records.js','./diagnostics-ui.js','./manifest.webmanifest','./icon.svg','./apple-touch-icon.png'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('patrimoni-test-iphone-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.open(CACHE).then(cache=>cache.match(e.request).then(cached=>cached||fetch(e.request).then(response=>{const copy=response.clone();cache.put(e.request,copy);return response}).catch(()=>cache.match('./index.html')))))});





