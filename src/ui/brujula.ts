import type { ContextoJuego } from '../core/contexto';
import type { GestorPueblos } from '../missions/pueblos';
import { depositoMasCercano } from '../world/mundo';

/**
 * Brújula en la parte superior: los puntos cardinales giran con la cámara y encima se ven
 * Trost, el depósito más cercano, los lugares (los que faltan por descubrir, atenuados),
 * tu escuadrón (verde), los titanes cercanos (rojo), los equipos caídos, los pueblos atacados,
 * los cambiantes avistados y tu caballo. Norte = −Z.
 */

/** Campo de visión de la tira (rad): lo que cabe de un extremo a otro. */
const CAMPO = (150 * Math.PI) / 180;
const CARDINALES: [string, number][] = [
  ['N', 0],
  ['NE', Math.PI / 4],
  ['E', Math.PI / 2],
  ['SE', (3 * Math.PI) / 4],
  ['S', Math.PI],
  ['SO', (-3 * Math.PI) / 4],
  ['O', -Math.PI / 2],
  ['NO', -Math.PI / 4],
];

/** Rumbo de brújula (0 = norte, π/2 = este) de un desplazamiento horizontal. */
export function rumboBrujula(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** Ángulo relativo en (−π, π]. */
export function relativo(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

interface Marca {
  clase: string;
  x: number;
  z: number;
  texto?: string;
}

export class Brujula {
  private readonly raiz: HTMLDivElement;
  private readonly cardinales: HTMLSpanElement[] = [];
  private readonly pozo: HTMLDivElement[] = [];
  private readonly marcas: Marca[] = [];
  /** Pueblos del mundo abierto (para marcar los que están siendo atacados). */
  pueblos: (() => GestorPueblos | null) | null = null;

  constructor(contenedor: HTMLElement, visible: boolean) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'hud-brujula';
    this.raiz.hidden = !visible;
    for (const [nombre] of CARDINALES) {
      const s = document.createElement('span');
      s.className = nombre.length === 1 ? 'cardinal mayor' : 'cardinal';
      s.textContent = nombre;
      this.raiz.appendChild(s);
      this.cardinales.push(s);
    }
    contenedor.appendChild(this.raiz);
  }

  set visible(v: boolean) {
    this.raiz.hidden = !v;
  }

  /** `yaw` de la cámara: su frente es (−sin yaw, 0, −cos yaw). */
  actualizar(ctx: ContextoJuego, yaw: number): void {
    if (this.raiz.hidden) return;
    const rumbo = rumboBrujula(-Math.sin(yaw), -Math.cos(yaw));
    const pos = (a: number) => {
      const r = relativo(a, rumbo);
      return Math.abs(r) > CAMPO / 2 ? null : 50 + (r / (CAMPO / 2)) * 50;
    };
    CARDINALES.forEach(([, a], i) => {
      const x = pos(a);
      const el = this.cardinales[i];
      el.hidden = x === null;
      if (x !== null) el.style.left = `${x}%`;
    });

    // Marcas del mundo
    const j = ctx.jugador.posicion;
    const m = this.marcas;
    m.length = 0;
    m.push({ clase: 'trost', x: 0, z: 0, texto: 'Trost' });
    const dep = depositoMasCercano(ctx.mundo, j);
    m.push({ clase: 'deposito', x: dep.deposito.pos.x, z: dep.deposito.pos.z, texto: `${Math.round(dep.distancia)} m` });
    for (const l of ctx.mundo.lugares) {
      if (l.tipo === 'puesto' || Math.hypot(l.pos.x - j.x, l.pos.z - j.z) < 40) continue;
      m.push({ clase: l.descubierto ? 'lugar' : 'lugar oculto', x: l.pos.x, z: l.pos.z, texto: l.descubierto ? l.nombre : '?' });
    }
    for (const s of ctx.escuadron.soldados) if (s.vivo) m.push({ clase: 'soldado', x: s.posicion.x, z: s.posicion.z });
    // pueblos atacados (con su campana), cambiantes a la vista y tu caballo
    for (const p of this.pueblos?.()?.lista ?? []) if (p.enAlarma) m.push({ clase: 'alarma', x: p.centro.x, z: p.centro.z, texto: `¡${p.nombre}!` });
    for (const t of ctx.poblacion.titanesCerca(j, 1500)) if (t.vivo && t.especial) m.push({ clase: 'jefe', x: t.posicion.x, z: t.posicion.z, texto: t.especial === 'acorazado' ? 'Acorazado' : 'Hembra' });
    const caballo = (ctx.jugador as { caballo?: { pos: { x: number; z: number }; montado: boolean; grupo: { visible: boolean } } | null }).caballo;
    if (caballo && !caballo.montado && caballo.grupo.visible) m.push({ clase: 'caballo', x: caballo.pos.x, z: caballo.pos.z });
    for (const e of ctx.suministros.lista) m.push({ clase: 'equipo', x: e.pos.x, z: e.pos.z });
    for (const t of ctx.poblacion.titanesCerca(j, 150)) m.push({ clase: t.cuadrupedo ? 'titan cuadrupedo' : 'titan', x: t.posicion.x, z: t.posicion.z });

    let usadas = 0;
    for (const marca of m) {
      const dx = marca.x - j.x;
      const dz = marca.z - j.z;
      if (dx * dx + dz * dz < 4) continue;
      const x = pos(rumboBrujula(dx, dz));
      if (x === null) continue;
      let el = this.pozo[usadas];
      if (!el) {
        el = document.createElement('div');
        this.raiz.appendChild(el);
        this.pozo.push(el);
      }
      usadas++;
      el.hidden = false;
      const clase = `marca ${marca.clase}`;
      if (el.className !== clase) el.className = clase;
      el.style.left = `${x}%`;
      const texto = marca.texto ?? '';
      if (el.textContent !== texto) el.textContent = texto;
    }
    for (let i = usadas; i < this.pozo.length; i++) this.pozo[i].hidden = true;
  }
}
