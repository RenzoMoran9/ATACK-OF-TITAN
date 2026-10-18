// Service worker de Atack of Titan: guarda el juego en el dispositivo para que se instale como
// app y se abra sin internet. Lo arma scripts/pwa.mjs al compilar: pone la versión y la lista
// de archivos del juego.
/* eslint-disable */

const VERSION = '6a6de122f8ce';
const ARCHIVOS = ["index.html","assets/index-BNciYsPU.js","assets/index-DWhVVVkO.css","iconos/apple-touch-icon.png","iconos/favicon-64.png","iconos/icono-192.png","iconos/icono-512.png","iconos/icono-maskable-512.png","manifest.webmanifest","modelos/caballo.glb","sonidos/acorazado.mp3","sonidos/agarre.mp3","sonidos/aldea.mp3","sonidos/aterrizaje.mp3","sonidos/bengala.mp3","sonidos/bengala_disparo.mp3","sonidos/bobina.mp3","sonidos/bosque.mp3","sonidos/brecha.mp3","sonidos/caballo_galope.mp3","sonidos/caballo_trote.mp3","sonidos/campana.mp3","sonidos/campana_alarma.mp3","sonidos/click.mp3","sonidos/coraza.mp3","sonidos/corte_carne.mp3","sonidos/cuchillas.mp3","sonidos/endurecer.mp3","sonidos/esquiva.mp3","sonidos/fogata.mp3","sonidos/galope.mp3","sonidos/gancho_clavar.mp3","sonidos/gancho_disparo.mp3","sonidos/gancho_volver.mp3","sonidos/gas.mp3","sonidos/gas_golpe.mp3","sonidos/golpe.mp3","sonidos/gritos_aldea.mp3","sonidos/hembra.mp3","sonidos/llanura.mp3","sonidos/martillos.mp3","sonidos/masticar.mp3","sonidos/mordisco.mp3","sonidos/noche.mp3","sonidos/nuca.mp3","sonidos/paso.mp3","sonidos/paso_titan.mp3","sonidos/recarga.mp3","sonidos/relincho.mp3","sonidos/respiracion.mp3","sonidos/rugido.mp3","sonidos/silbido.mp3","sonidos/tajo.mp3","sonidos/titan_cae.mp3","sonidos/vapor.mp3","sonidos/viento.mp3","sonidos/vitores.mp3"];
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
