// Service worker de Atack of Titan: guarda el juego en el dispositivo para que se instale como
// app y se abra sin internet. Lo arma scripts/pwa.mjs al compilar: pone la versión y la lista
// de archivos del juego.
/* eslint-disable */

const VERSION = '__VERSION__';
const ARCHIVOS = __ARCHIVOS__;
const CACHE_APP = `atack-of-titan-${VERSION}`;
const BASE = new URL('./', self.location.href).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((cache) => cache.addAll(ARCHIVOS.map((f) => new Request(BASE + f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const viejas = (await caches.keys()).filter((k) => k.startsWith('atack-of-titan-') && k !== CACHE_APP);
      await Promise.all(viejas.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// El juego avisa «Nueva versión · Actualizar»; al tocarlo, la nueva toma el control.
self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const pedido = e.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (!url.href.startsWith(BASE)) return;

  // Abrir el juego: siempre la versión guardada (la nueva llega con el aviso de actualizar)
  if (pedido.mode === 'navigate') {
    e.respondWith(caches.match(BASE + 'index.html', { cacheName: CACHE_APP, ignoreVary: true }).then((r) => r || fetch(pedido)));
    return;
  }

  // Archivos del juego: de la caché; lo demás, de la red (y se guarda por si falta internet).
  // ignoreVary: los scripts de módulo llevan cabecera Origin y algunos servidores responden con
  // «Vary: Origin»; sin esto la copia guardada no se encontraría sin conexión.
  e.respondWith(
    caches.match(pedido, { cacheName: CACHE_APP, ignoreVary: true }).then(
      (r) =>
        r ||
        fetch(pedido).then((resp) => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE_APP).then((c) => c.put(pedido, copia));
          }
          return resp;
        }),
    ),
  );
});
