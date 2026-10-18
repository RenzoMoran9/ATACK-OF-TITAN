import * as THREE from 'three';
import { Artilleria, puntoDeTiro } from '../combat/artilleria';
import type { ContextoJuego } from '../core/contexto';
import type { TitanAPI } from '../core/tipos';
import { texturaParticula } from '../world/texturas';
import { blancoCanonMuro, enLoAltoDeLaMuralla } from './logicaMuralla';

/**
 * Cañones de la muralla de Trost (los negros sobre raíles de la coronación). Apuntan solos al
 * titán más cercano que tengan delante (fuera de la muralla, hasta 320 m y 55° a cada lado; no
 * llegan a lo que está pegado al pie del muro) y:
 *
 * - T, estando en lo alto de la muralla: disparan los que tengas a menos de 200 m.
 * - Con un soldado al lado (orden «¡A la muralla!»), disparan solos cada vez que están cargados.
 *
 * Recargan en 4 s. Las balas, el daño y las barras de vida son los de la artillería compartida.
 */

const RECARGA = 4;
/** Desde lo alto de la muralla mandas los cañones a menos de esto (m). */
const RADIO_MANDO = 200;
/** Un soldado a menos de esto del cañón lo maneja. */
const RADIO_ARTILLERO = 7;
/** Solo se mueven (y gastan) los cañones a menos de esto del jugador. */
const RADIO_VISTA = 500;

interface CanonMuro {
  i: number;
  pivote: THREE.Vector3;
  recarga: number;
  retroceso: number;
  guinada: number;
  elevacion: number;
  fogonazo: THREE.Sprite;
  blanco: TitanAPI | null;
}

export class CanonesMuralla {
  private readonly canones: CanonMuro[];
  private readonly materialFogonazo: THREE.SpriteMaterial;
  private avisado = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: ContextoJuego,
    private readonly artilleria: Artilleria,
  ) {
    const m = ctx.mundo.muralla;
    this.materialFogonazo = new THREE.SpriteMaterial({ map: texturaParticula(), color: '#ffcf7a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.canones = m.canones.map((_, i) => {
      const fogonazo = new THREE.Sprite(this.materialFogonazo);
      fogonazo.visible = false;
      ctx.escena.add(fogonazo);
      return { i, pivote: m.tubos.pivotes[i], recarga: 0, retroceso: 0, guinada: 0, elevacion: 0.08, fogonazo, blanco: null };
    });
  }

  /** ¿Estás arriba, en la coronación? */
  get jugadorArriba(): boolean {
    const m = this.ctx.mundo.muralla;
    return enLoAltoDeLaMuralla(this.ctx.jugador.posicion, m.radioInterior, m.radioExterior, m.altura);
  }

  /** T en lo alto de la muralla: disparan los cañones cercanos que tengan blanco y estén cargados. */
  disparar(): string {
    const j = this.ctx.jugador.posicion;
    const cerca = this.canones.filter((k) => k.pivote.distanceTo(j) < RADIO_MANDO);
    let disparos = 0;
    let hayBlanco = false;
    for (const k of cerca) {
      if (!k.blanco) continue;
      hayBlanco = true;
      if (k.recarga > 0) continue;
      this.fuego(k, k.blanco);
      disparos++;
    }
    if (disparos > 0) return `¡Fuego desde la muralla! (${disparos} ${disparos === 1 ? 'cañón' : 'cañones'})`;
    return hayBlanco ? 'Los cañones se están recargando' : 'Ningún titán a tiro de los cañones de la muralla (no llegan al pie del muro)';
  }

  actualizar(dt: number): void {
    const j = this.ctx.jugador.posicion;
    const m = this.ctx.mundo.muralla;
    const soldados = this.ctx.escuadron.soldados.filter((s) => s.vivo && !s.agarradoPor && enLoAltoDeLaMuralla(s.posicion, m.radioInterior, m.radioExterior, m.altura));
    const usados = new Set<TitanAPI>();
    for (const k of this.canones) {
      k.recarga = Math.max(0, k.recarga - dt);
      k.retroceso = Math.max(0, k.retroceso - dt * 1.4);
      k.fogonazo.visible = k.retroceso > 0.8;
      if (k.fogonazo.visible) {
        m.tubos.boca(k.i, k.fogonazo.position);
        k.fogonazo.scale.setScalar(1.5 + 3 * (1 - k.retroceso));
      }
      if (k.pivote.distanceTo(j) > RADIO_VISTA && soldados.length === 0) {
        k.blanco = null;
        continue;
      }
      k.blanco = this.buscarBlanco(k, usados);
      if (k.blanco) usados.add(k.blanco);
      this.apuntar(k, dt);
      // con un artillero al lado dispara solo
      if (k.blanco && k.recarga === 0 && soldados.some((s) => s.posicion.distanceTo(k.pivote) < RADIO_ARTILLERO)) this.fuego(k, k.blanco);
    }
    // la primera vez que subes con titanes a tiro, te lo dice
    if (!this.avisado && this.jugadorArriba && this.canones.some((k) => k.blanco && k.pivote.distanceTo(j) < RADIO_MANDO)) {
      this.avisado = true;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: 'Cañones de la muralla a tiro: T (✹ Cañones) dispara los que tienes cerca', segundos: 4 });
    }
  }

  private buscarBlanco(k: CanonMuro, evitar: Set<TitanAPI>): TitanAPI | null {
    const m = this.ctx.mundo.muralla;
    const theta = m.canones[k.i];
    let mejor: TitanAPI | null = null;
    let dMejor = Infinity;
    for (const t of this.ctx.poblacion.titanesCerca(k.pivote, 340)) {
      if (!Artilleria.blanco(t) || evitar.has(t)) continue;
      const p = puntoDeTiro(t);
      const d = blancoCanonMuro(k.pivote, theta, p, m.radioExterior);
      if (d !== null && d < dMejor) {
        dMejor = d;
        mejor = t;
      }
    }
    return mejor;
  }

  /** Gira poco a poco hacia el blanco (o vuelve a reposo, mirando afuera). */
  private apuntar(k: CanonMuro, dt: number): void {
    const theta = this.ctx.mundo.muralla.canones[k.i];
    let guinada = 0;
    let elevacion = 0.08;
    if (k.blanco) {
      const p = puntoDeTiro(k.blanco);
      const dx = p.x - k.pivote.x;
      const dz = p.z - k.pivote.z;
      guinada = Math.atan2(Math.sin(Math.atan2(dx, dz) - theta), Math.cos(Math.atan2(dx, dz) - theta));
      elevacion = Math.atan2(p.y - k.pivote.y, Math.hypot(dx, dz));
    }
    const paso = 1.6 * dt;
    k.guinada += THREE.MathUtils.clamp(guinada - k.guinada, -paso, paso);
    k.elevacion += THREE.MathUtils.clamp(elevacion - k.elevacion, -paso, paso);
    this.ctx.mundo.muralla.tubos.colocar(k.i, k.guinada, k.elevacion, 0.6 * Math.sin(Math.min(1, k.retroceso) * Math.PI * 0.5));
  }

  private fuego(k: CanonMuro, t: TitanAPI): void {
    k.recarga = RECARGA;
    k.retroceso = 1;
    this.apuntar(k, 10); // apunta del todo antes de soltar la bala
    this.artilleria.disparar(this.ctx.mundo.muralla.tubos.boca(k.i, this.tmp).clone(), t);
  }

  limpiar(): void {
    for (const k of this.canones) k.fogonazo.removeFromParent();
    this.materialFogonazo.dispose();
  }
}
