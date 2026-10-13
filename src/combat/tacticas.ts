import * as THREE from 'three';
import type { PuntoDebil, TitanAPI, ZonaTitan } from '../core/tipos';

/**
 * Reglas puras (testeables) de las técnicas del anime que van más allá del tajo:
 * bengala cegadora, pasada baja a los tendones y fijar una parte del titán.
 */

/** Velocidad de la bengala (m/s) y distancia máxima a la que estalla sola. */
export const VELOCIDAD_BENGALA = 50;
export const ALCANCE_BENGALA = 70;
/** Si estalla a esta distancia o menos de un ojo, ciega al titán… */
export const RADIO_CEGUERA = 4;
/** …durante estos segundos (no es una herida: no se regenera). */
export const CEGUERA_BENGALA = 3;
/** Espoleta de proximidad: estalla sola al pasar así de cerca de una cara. */
export const ESPOLETA = 2.5;

/** Pasada baja: por debajo de esta fracción de la altura del titán… */
export const ALTURA_PASADA = 0.2;
/** …y a menos de esta distancia de un tendón o una corva. */
export const DISTANCIA_PASADA = 3;
/** Duración del tajo corto de la pasada baja (sin carga). */
export const DURACION_PASADA = 0.15;

const ZONAS_PIERNA: ZonaTitan[] = ['tendonIzq', 'tendonDer', 'corvaIzq', 'corvaDer'];

/** Distancia de un punto a la cara del titán (al ojo más cercano). */
export function distanciaCara(p: THREE.Vector3, t: TitanAPI): number {
  let d = Infinity;
  for (const pd of t.puntosDebiles) {
    if (pd.zona !== 'ojoIzq' && pd.zona !== 'ojoDer') continue;
    d = Math.min(d, pd.centro.distanceTo(p));
  }
  return d === Infinity ? t.cabeza().distanceTo(p) : d;
}

/** Titanes vivos a los que ciega una bengala que estalla en `p`. */
export function cegadosPorBengala<T extends TitanAPI>(p: THREE.Vector3, titanes: readonly T[], radio = RADIO_CEGUERA): T[] {
  return titanes.filter((t) => t.vivo && distanciaCara(p, t) <= radio);
}

/**
 * Pasada baja: si vas por debajo de 0,2·H de un titán y a menos de 3 m de uno de sus tendones
 * o corvas activos, devuelve el más cercano (el tajo corto irá a él).
 */
export function zonaPasadaBaja<T extends TitanAPI>(pos: THREE.Vector3, titanes: readonly T[]): { titan: T; punto: PuntoDebil } | null {
  let mejor: { titan: T; punto: PuntoDebil } | null = null;
  let mejorD = Infinity;
  for (const t of titanes) {
    if (!t.vivo || pos.y > ALTURA_PASADA * t.altura) continue;
    for (const p of t.puntosDebiles) {
      if (!p.activo || !ZONAS_PIERNA.includes(p.zona)) continue;
      const d = p.centro.distanceTo(pos);
      if (d <= DISTANCIA_PASADA && d < mejorD) {
        mejorD = d;
        mejor = { titan: t, punto: p };
      }
    }
  }
  return mejor;
}

/** Orden en que la tecla de fijar recorre las partes: primero la nuca, luego de arriba abajo. */
const ORDEN_PARTES: ZonaTitan[] = ['nuca', 'ojoIzq', 'ojoDer', 'brazoIzq', 'brazoDer', 'corvaIzq', 'corvaDer', 'tendonIzq', 'tendonDer'];

export const NOMBRE_PARTE: Partial<Record<ZonaTitan, string>> = {
  nuca: 'Nuca',
  ojoIzq: 'Ojo izquierdo',
  ojoDer: 'Ojo derecho',
  brazoIzq: 'Brazo izquierdo',
  brazoDer: 'Brazo derecho',
  corvaIzq: 'Corva izquierda',
  corvaDer: 'Corva derecha',
  tendonIzq: 'Tendón izquierdo',
  tendonDer: 'Tendón derecho',
};

/** Partes fijables (activas) de un titán, en el orden de la tecla. */
export function partesFijables(t: TitanAPI): PuntoDebil[] {
  const res: PuntoDebil[] = [];
  for (const z of ORDEN_PARTES) {
    const p = t.puntosDebiles.find((x) => x.zona === z);
    if (p?.activo) res.push(p);
  }
  return res;
}

/**
 * Siguiente parte al pulsar la tecla: si no hay nada fijado (o el titán es otro), la primera
 * del titán; si no, la siguiente; tras la última, nada (se suelta).
 */
export function siguienteParte(t: TitanAPI, actual: ZonaTitan | null): ZonaTitan | null {
  const partes = partesFijables(t);
  if (partes.length === 0) return null;
  if (actual === null) return partes[0].zona;
  const i = partes.findIndex((p) => p.zona === actual);
  if (i < 0) return partes[0].zona;
  return i + 1 < partes.length ? partes[i + 1].zona : null;
}
