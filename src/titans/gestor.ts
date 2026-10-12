import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { GestorTitanesAPI, OpcionesTitan, TitanAPI } from '../core/tipos';
import { Titan } from './titan';

/**
 * Crea, actualiza y retira los titanes. Cada titán se registra en la población para que
 * el jugador, el escuadrón y los civiles lo encuentren, y se retira cuando termina de
 * evaporarse o al limpiar el capítulo.
 */
export class GestorTitanes implements GestorTitanesAPI {
  readonly lista: Titan[] = [];
  private _congelado = false;

  constructor(private readonly ctx: ContextoJuego) {}

  get congelado(): boolean {
    return this._congelado;
  }

  set congelado(v: boolean) {
    this._congelado = v;
    for (const t of this.lista) t.congelado = v;
  }

  generar(o: OpcionesTitan): TitanAPI {
    const nav = this.ctx.nav;
    const radio = Math.max(0.6, 0.17 * o.altura);
    const libre = nav.libre(o.posicion.x, o.posicion.z, radio) ? null : nav.puntoLibreCercano(o.posicion.x, o.posicion.z, radio);
    const t = new Titan(this.ctx, { ...o, posicion: libre ?? o.posicion });
    t.congelado = this._congelado;
    this.lista.push(t);
    this.ctx.poblacion.agregarTitan(t);
    return t;
  }

  generarGrupo(n: number, centro: THREE.Vector3, radio: number, alturas: number[], probAnormal = 0.15): TitanAPI[] {
    const res: TitanAPI[] = [];
    const desfase = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = desfase + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const r = radio * (0.5 + Math.random() * 0.5);
      const pos = new THREE.Vector3(centro.x + Math.cos(a) * r, 0, centro.z + Math.sin(a) * r);
      res.push(
        this.generar({
          posicion: pos,
          altura: alturas[Math.floor(Math.random() * alturas.length)],
          anormal: Math.random() < probAnormal,
          rumbo: Math.atan2(centro.x - pos.x, centro.z - pos.z),
        }),
      );
    }
    return res;
  }

  limpiar(): void {
    for (const t of this.lista) {
      t.eliminar();
      this.ctx.poblacion.quitarTitan(t);
    }
    this.lista.length = 0;
  }

  actualizar(dt: number): void {
    const jugador = this.ctx.jugador.posicion;
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const t = this.lista[i];
      const dx = t.posicion.x - jugador.x;
      const dz = t.posicion.z - jugador.z;
      t.actualizar(dt, Math.sqrt(dx * dx + dz * dz));
      if (t.terminado) {
        t.eliminar();
        this.ctx.poblacion.quitarTitan(t);
        this.lista.splice(i, 1);
      }
    }
  }

  dibujar(): void {
    // La pose se aplica en el paso fijo (60 Hz): con la lentitud de los titanes no hace
    // falta interpolar entre pasos.
  }
}
