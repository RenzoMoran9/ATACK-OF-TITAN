import type * as THREE from 'three';
import type { Humano, TitanAPI } from './tipos';

let siguienteId = 1;
/** Identificador único para humanos y titanes. */
export const nuevoId = (): number => siguienteId++;

/**
 * Registro de todos los humanos y titanes vivos del mundo, con consultas de cercanía.
 * Los gestores (titanes, escuadrón, civiles, jugador) se registran aquí.
 */
export class Poblacion {
  readonly humanos: Humano[] = [];
  readonly titanes: TitanAPI[] = [];

  agregarHumano(h: Humano): void {
    if (!this.humanos.includes(h)) this.humanos.push(h);
  }

  quitarHumano(h: Humano): void {
    const i = this.humanos.indexOf(h);
    if (i >= 0) this.humanos.splice(i, 1);
  }

  agregarTitan(t: TitanAPI): void {
    if (!this.titanes.includes(t)) this.titanes.push(t);
  }

  quitarTitan(t: TitanAPI): void {
    const i = this.titanes.indexOf(t);
    if (i >= 0) this.titanes.splice(i, 1);
  }

  /** Humanos vivos y libres a menos de `radio` (distancia 3D). */
  humanosCerca(p: THREE.Vector3, radio: number, filtro?: (h: Humano) => boolean): Humano[] {
    const r2 = radio * radio;
    return this.humanos.filter((h) => h.vivo && h.posicion.distanceToSquared(p) <= r2 && (!filtro || filtro(h)));
  }

  /** Titanes vivos a menos de `radio` en horizontal, del más cercano al más lejano. */
  titanesCerca(p: THREE.Vector3, radio: number): TitanAPI[] {
    const r2 = radio * radio;
    const d2 = (t: TitanAPI) => (t.posicion.x - p.x) ** 2 + (t.posicion.z - p.z) ** 2;
    return this.titanes.filter((t) => t.vivo && d2(t) <= r2).sort((a, b) => d2(a) - d2(b));
  }

  titanMasCercano(p: THREE.Vector3, radio: number): TitanAPI | null {
    return this.titanesCerca(p, radio)[0] ?? null;
  }

  get titanesVivos(): number {
    return this.titanes.filter((t) => t.vivo).length;
  }
}
