import type { ContextoJuego } from '../core/contexto';
import type { EspecialTitan } from '../core/tipos';
import { nombreEspecial } from '../titans/especiales';

/**
 * Guía del primer encuentro: la primera vez que tienes cerca a cada cambiante sale una tarjeta con
 * cómo se le mata. Se cierra con «Entendido» (o sola a los 20 s) y no vuelve a salir en este
 * dispositivo.
 */

const CLAVE = 'atack-of-titan-guias';
const DISTANCIA = 260;
const DURACION = 20;

export const GUIAS: Readonly<Record<EspecialTitan, { titulo: string; puntos: string[] }>> = {
  acorazado: {
    titulo: 'Titán Acorazado (15 m)',
    puntos: [
      'Coraza en todo el cuerpo: las hojas rebotan y se mellan. Solo las <b>corvas</b> (detrás de las rodillas) y los codos se pueden cortar.',
      'Corta una corva: cae de rodillas y la coraza de la <b>nuca se agrieta</b> unos segundos. Ahí, a por ella.',
      'Las <b>lanzas relámpago</b> (Y / ⚡) le revientan la coraza: dos lo tumban. Los cañones casi no le hacen nada.',
    ],
  },
  colosal: {
    titulo: 'Titán Colosal (60 m)',
    puntos: [
      'Lento y enorme. Cada 14 s suelta <b>vapor abrasador</b> unos 4 s: la nuca no se puede cortar y quema a quien esté pegado.',
      'Ataca la nuca <b>entre nube y nube</b>, muchas veces seguidas: la herida aguanta 4 s entre pasada y pasada.',
      'Ayudan las lanzas (tres lo tumban) y los cañones de la muralla. Si rompe la puerta, desaparece en vapor.',
    ],
  },
  bestia: {
    titulo: 'Titán Bestia (17 m)',
    puntos: [
      'Lanza <b>rocas</b> desde unos 150 m: no te quedes quieto, muévete de lado. Detrás de la muralla estás a cubierto.',
      'De cerca pelea cuerpo a cuerpo con sus brazos larguísimos. Su nuca aguanta más del doble y se regenera rápido.',
      'Dos lanzas relámpago, o una lanza y un par de tajos seguidos.',
    ],
  },
  hembra: {
    titulo: 'Titana Hembra (14 m)',
    puntos: [
      'Rápida y lista. <b>Endurece la nuca</b> en cuanto te lanzas a por ella: el tajo rebota.',
      'Amaga, espera a que se le pase (tarda unos segundos en poder repetirlo) y entonces corta.',
      'Cegarla con una bengala o cortarle las corvas te da tiempo.',
    ],
  },
};

function vistos(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function marcarVisto(e: EspecialTitan): void {
  try {
    const v = vistos();
    v.add(e);
    localStorage.setItem(CLAVE, JSON.stringify([...v]));
  } catch {
    /* sin almacenamiento: se volverá a ver */
  }
}

export class GuiaCambiantes {
  private readonly raiz: HTMLDivElement;
  private readonly yaVistos = vistos();
  private restante = 0;
  private tRevisar = 0;

  constructor(contenedor: HTMLElement) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'hud-guia';
    this.raiz.hidden = true;
    contenedor.appendChild(this.raiz);
  }

  /** Cada fotograma: muestra la guía del primer cambiante cercano que no hayas visto. */
  actualizar(ctx: ContextoJuego, dt: number): void {
    if (!this.raiz.hidden) {
      this.restante -= dt;
      if (this.restante <= 0) this.cerrar();
      return;
    }
    this.tRevisar -= dt;
    if (this.tRevisar > 0) return;
    this.tRevisar = 0.5;
    const j = ctx.jugador.posicion;
    for (const t of ctx.poblacion.titanesCerca(j, DISTANCIA)) {
      const e = t.especial;
      if (!t.vivo || !e || this.yaVistos.has(e)) continue;
      this.mostrar(e);
      return;
    }
  }

  private mostrar(e: EspecialTitan): void {
    this.yaVistos.add(e);
    marcarVisto(e);
    const g = GUIAS[e];
    this.raiz.innerHTML = `<div class="tit">¡${nombreEspecial(e).replace(/^./, (c) => c.toUpperCase())} a la vista!</div><div class="sub">${g.titulo}</div><ul>${g.puntos.map((p) => `<li>${p}</li>`).join('')}</ul><button class="ok">Entendido</button>`;
    this.raiz.querySelector('.ok')?.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.cerrar();
    });
    this.raiz.hidden = false;
    this.restante = DURACION;
  }

  private cerrar(): void {
    this.raiz.hidden = true;
  }
}
