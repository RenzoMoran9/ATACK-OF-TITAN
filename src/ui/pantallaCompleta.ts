/**
 * Pantalla completa y modo app. En Android y en escritorio usa la Fullscreen API (y en el
 * móvil intenta fijar la orientación horizontal). En iPhone el navegador no deja poner una
 * página a pantalla completa: hay que añadirla a la pantalla de inicio (Compartir → Añadir a
 * pantalla de inicio), y entonces se abre sin barras, como una app.
 */

type DocumentoFS = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type ElementoFS = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function enModoApp(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function enPantallaCompleta(): boolean {
  const d = document as DocumentoFS;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function pantallaCompletaDisponible(): boolean {
  const e = document.documentElement as ElementoFS;
  return typeof e.requestFullscreen === 'function' || typeof e.webkitRequestFullscreen === 'function';
}

/** Entra en pantalla completa (debe llamarse desde un toque o clic). Devuelve si lo consiguió. */
export async function entrarPantallaCompleta(): Promise<boolean> {
  if (enPantallaCompleta() || enModoApp()) return true;
  const e = document.documentElement as ElementoFS;
  try {
    if (e.requestFullscreen) await e.requestFullscreen({ navigationUI: 'hide' });
    else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen();
    else return false;
  } catch {
    return false;
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    // no todos los navegadores dejan fijar la orientación
  }
  return true;
}

export async function alternarPantallaCompleta(): Promise<boolean> {
  if (!enPantallaCompleta()) return entrarPantallaCompleta();
  const d = document as DocumentoFS;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // ya estaba fuera
  }
  return false;
}

// ── Instalar como app (Chrome/Edge/Android): el navegador avisa con beforeinstallprompt ──
interface EventoInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let eventoInstalar: EventoInstalar | null = null;
const oyentes = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalar = e as EventoInstalar;
  for (const f of oyentes) f();
});
window.addEventListener('appinstalled', () => {
  eventoInstalar = null;
  for (const f of oyentes) f();
});

export function puedeInstalarse(): boolean {
  return eventoInstalar !== null;
}

export function alCambiarInstalable(f: () => void): void {
  oyentes.add(f);
}

export async function instalarApp(): Promise<boolean> {
  if (!eventoInstalar) return false;
  const e = eventoInstalar;
  await e.prompt();
  const r = await e.userChoice;
  eventoInstalar = null;
  for (const f of oyentes) f();
  return r.outcome === 'accepted';
}

/**
 * Registra el service worker: el juego queda instalado en el dispositivo y se abre sin
 * internet. Cuando se publica una versión nueva, aparece «Nueva versión · Actualizar»; al
 * tocarlo se recarga con la nueva (nunca a mitad de partida sin que lo pidas).
 */
export function registrarServiceWorker(): void {
  // solo en el build (en `vite dev` cachearía módulos a medio editar)
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let pedido = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pedido) location.reload();
  });
  const avisar = (sw: ServiceWorker) => {
    if (!navigator.serviceWorker.controller || document.querySelector('.aviso-version')) return;
    const aviso = document.createElement('div');
    aviso.className = 'aviso-version';
    aviso.innerHTML = '<span>Nueva versión del juego</span>';
    const b = document.createElement('button');
    b.textContent = 'Actualizar';
    b.addEventListener('click', () => {
      pedido = true;
      b.disabled = true;
      b.textContent = 'Actualizando…';
      sw.postMessage('actualizar');
    });
    const cerrar = document.createElement('button');
    cerrar.className = 'cerrar';
    cerrar.textContent = 'Luego';
    cerrar.addEventListener('click', () => aviso.remove());
    aviso.append(b, cerrar);
    document.body.appendChild(aviso);
  };
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (reg.waiting) avisar(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing;
          nuevo?.addEventListener('statechange', () => {
            if (nuevo.state === 'installed') avisar(nuevo);
          });
        });
        // buscar versiones nuevas al volver al juego y cada media hora
        const revisar = () => void reg.update().catch(() => undefined);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') revisar();
        });
        setInterval(revisar, 30 * 60 * 1000);
      })
      .catch(() => {
        // sin service worker (p. ej. dentro de un visor): el juego funciona igual, solo con conexión
      });
  });
}

/** iPhone/iPad: Safari no tiene pantalla completa para páginas. */
export function esIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
