// Guarda o app no aparelho para abrir rápido e funcionar sem internet.
// Os dados não passam por aqui: as chamadas ao Supabase vão sempre direto para a rede.
const VERSION = "lc-v2";
const SHELL = ["./", "index.html", "config.js", "importer.js", "vault.js", "qrcode.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.includes("/rest/v1/")) return;
  if (url.origin === location.origin) {
    // arquivos do app: tenta a rede (para pegar atualizações) e cai no cache sem internet
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
  } else if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host)) {
    // fontes e bibliotecas: cache primeiro
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    })));
  }
});
