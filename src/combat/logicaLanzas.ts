import type { EspecialTitan, ZonaTitan } from '../core/tipos';
import { aguanteNuca } from '../titans/especiales';
import { umbralNuca, umbralZona } from './corte';

/**
 * Lanzas relámpago (lógica pura, testeable). Se disparan como un arpón, se clavan en la parte del
 * titán más cercana al impacto y estallan al poco:
 *
 * - En la nuca: a un titán normal lo mata; a un cambiante le quita una buena parte (la Bestia cae con
 *   dos, el Colosal con tres si no está soltando vapor). Al Acorazado le revienta la coraza: la
 *   nuca queda expuesta unos segundos y basta otra lanza o un buen tajo.
 * - En otra parte: la arranca (doble del umbral de esa zona). Al Acorazado, que no se deja herir
 *   por la coraza, le revienta una corva: cae de rodillas y se le agrieta la nuca.
 * - La explosión alcanza a quien esté a menos de 8 m (también a ti).
 */

export const MAX_LANZAS = 2;
export const VELOCIDAD_LANZA = 75;
export const ALCANCE_LANZA = 130;
/** Segundos entre que se clava y estalla. */
export const ESPOLETA_LANZA = 1.4;
export const RADIO_EXPLOSION = 8;
/** Daño máximo de la explosión a una persona en el centro. */
export const DANIO_EXPLOSION = 45;
/** Segundos con la coraza reventada. */
export const CORAZA_REVENTADA = 6;

/** Daño en la nuca de un titán de altura `H`. */
export function danioLanzaNuca(H: number, especial: EspecialTitan | null): number {
  const U = umbralNuca(H) * aguanteNuca(especial);
  return Math.max(umbralNuca(H) * 1.5, U * 0.36);
}

/** Daño en otra zona (la arranca). */
export function danioLanzaZona(zona: ZonaTitan, H: number): number {
  return umbralZona(zona, H) * 2;
}

/** Daño de la explosión a una persona a `d` m (0 fuera del radio). */
export function danioExplosion(d: number): number {
  return d >= RADIO_EXPLOSION ? 0 : DANIO_EXPLOSION * (1 - d / RADIO_EXPLOSION);
}

/** La parte del titán más cercana al punto donde se clava (entre las activas y a menos de `max` m). */
export function parteMasCercana<P extends { zona: ZonaTitan; centro: { x: number; y: number; z: number }; radio: number; activo: boolean }>(
  puntos: readonly P[],
  impacto: { x: number; y: number; z: number },
  max: number,
): P | null {
  let mejor: P | null = null;
  let dMejor = max;
  for (const p of puntos) {
    if (!p.activo || p.zona === 'cuerpo') continue;
    const d = Math.hypot(p.centro.x - impacto.x, p.centro.y - impacto.y, p.centro.z - impacto.z) - p.radio;
    if (d < dMejor) {
      dMejor = d;
      mejor = p;
    }
  }
  return mejor;
}
