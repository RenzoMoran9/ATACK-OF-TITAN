import type { ContextoJuego } from '../core/contexto';
import type { Jugador } from '../player/jugador';

/**
 * Consejos que salen una sola vez, justo cuando hacen falta (el primer bosque, el primer
 * titán cerca, el primer cable clavado, el gas bajo...). Así los controles se aprenden poco a
 * poco jugando, en vez de leer una lista. Se recuerdan entre partidas (en este dispositivo).
 */

interface Consejo {
  id: string;
  /** Se muestra cuando esto se cumple (se mira dos veces por segundo). */
  cuando: (c: ContextoJuego, j: Jugador) => boolean;
  pc: string;
  movil: string;
}

const CLAVE = 'atack-of-titan-consejos';

const CONSEJOS: Consejo[] = [
  {
    id: 'ganchos',
    cuando: (c, j) => j.vivo && c.mundo.bosques.some((b) => b.profundidad(j.posicion.x, j.posicion.z) > 5),
    pc: 'Consejo: clic derecho clava los dos ganchos donde miras; Q y E se enganchan solos a los troncos de tu izquierda y tu derecha para balancearte',
    movil: 'Consejo: GANCHOS clava los dos cables donde miras; ◀ y ▶ se enganchan solos a los troncos de cada lado para balancearte',
  },
  {
    id: 'gas',
    cuando: (_c, j) => j.odm.recogiendo,
    pc: 'Consejo: mientras recoges cable, mantén Espacio y W para ir mucho más rápido',
    movil: 'Consejo: mientras recoges cable, mantén SALTO/GAS con el joystick hacia delante para ir mucho más rápido',
  },
  {
    id: 'balanceo',
    cuando: (_c, j) => j.odm.ganchos.some((g) => g.estado === 'anclado' && g.balanceo),
    pc: 'Consejo: mantén Q o E para balancearte y suelta en lo alto para salir despedido; alterna Q y E para encadenar',
    movil: 'Consejo: mantén ◀ o ▶ para balancearte y suelta en lo alto para salir despedido; alterna para encadenar',
  },
  {
    id: 'pared',
    cuando: (_c, j) => j.pegado !== null,
    pc: 'Consejo: desde aquí puedes esperar a un titán; Espacio te lanza hacia donde miras',
    movil: 'Consejo: desde aquí puedes esperar a un titán; SALTO/GAS te lanza hacia donde miras',
  },
  {
    id: 'titan',
    cuando: (c, j) => c.titanes.lista.some((t) => t.vivo && t.posicion.distanceTo(j.posicion) < 45),
    pc: 'Consejo: la nuca es la franja de detrás del cuello. Engánchate al titán, rodéalo y suelta el tajo (clic izquierdo) al pasar por detrás',
    movil: 'Consejo: la nuca es la franja de detrás del cuello. Engánchate al titán, rodéalo y pulsa TAJO al pasar por detrás',
  },
  {
    id: 'saltoGas',
    cuando: (c, j) => c.titanes.lista.some((t) => t.vivo && t.cuadrupedo && t.posicion.distanceTo(j.posicion) < 70),
    pc: 'Consejo: ¡uno de cuatro patas! Mantén Espacio para subir 10 m con el gas y caerle encima',
    movil: 'Consejo: ¡uno de cuatro patas! Mantén SALTO/GAS para subir 10 m con el gas y caerle encima',
  },
  {
    id: 'pocoGas',
    cuando: (_c, j) => j.gas.nivel < j.gas.capacidad * 0.3,
    pc: 'Consejo: te queda poco gas. Moblit te lo lleva solo; con G se lo pides ya',
    movil: 'Consejo: te queda poco gas. Moblit te lo lleva solo; con ✚ se lo pides ya',
  },
  {
    id: 'ordenes',
    cuando: (c) => c.escuadron.soldados.length > 0 && c.reloj.t > 40,
    pc: 'Consejo: da órdenes con 1–8 (1 seguidme, 2 atacad, 5 esperad…) y Tab para mandar a uno solo',
    movil: 'Consejo: ⚑ Órdenes abre el panel para mandar a tu escuadrón (seguidme, atacad, esperad…)',
  },
];

export class Consejos {
  private vistos: Set<string>;
  private t = 0;
  private ultimo = -99;

  constructor(
    private readonly ctx: ContextoJuego,
    private readonly jugador: Jugador,
    private readonly tactil: boolean,
  ) {
    let v: string[] = [];
    try {
      v = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as string[];
    } catch {
      // sin almacenamiento: se muestran en cada partida
    }
    this.vistos = new Set(v);
  }

  actualizar(dt: number, activo: boolean): void {
    if (!activo) return;
    this.t += dt;
    // uno cada vez, con aire entre ellos
    if (this.t - this.ultimo < 12) return;
    if (Math.floor(this.t * 2) === Math.floor((this.t - dt) * 2)) return;
    for (const c of CONSEJOS) {
      if (this.vistos.has(c.id) || !c.cuando(this.ctx, this.jugador)) continue;
      this.vistos.add(c.id);
      this.ultimo = this.t;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: this.tactil ? c.movil : c.pc, segundos: 6 });
      try {
        localStorage.setItem(CLAVE, JSON.stringify([...this.vistos]));
      } catch {
        // sin almacenamiento
      }
      return;
    }
  }
}
