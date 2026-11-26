const prefixo = 'amendoas-pedidos-web-';
const nome = prefixo + '__REVISAO__';
const raiz = new URL(self.registration.scope);
const arquivos = ['index.html', 'mobile.css', 'acompanhamento.js', 'manifest.webmanifest', 'icone-192.png', 'icone-512.png'];
const permitidos = new Set(arquivos.map((arquivo) => new URL(arquivo, raiz).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(nome).then((cache) => cache.addAll(
    [...permitidos].map((url) => new Request(url, { cache: 'reload', credentials: 'omit', redirect: 'error' })),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((chave) => chave.startsWith(prefixo) && chave !== nome).map((chave) => caches.delete(chave)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url === raiz.href && event.request.mode === 'navigate'
    ? new URL('index.html', raiz).href : event.request.url;
  if (!permitidos.has(url)) return;
  event.respondWith((async () => (await (await caches.open(nome)).match(url)) ?? fetch(event.request))());
});
