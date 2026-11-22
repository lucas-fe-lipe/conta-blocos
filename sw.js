/* Service worker do Conta Blocos: guarda os arquivos para funcionar offline.
   Estratégia "rede primeiro": com internet, sempre busca a versão mais nova;
   sem internet, usa a cópia guardada. Ao publicar uma versão nova, troque o
   número em CACHE (ex.: v2 -> v3) para limpar o cache antigo. */
const CACHE = "conta-blocos-v1";
const ARQUIVOS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "jogo.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return resp;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});
