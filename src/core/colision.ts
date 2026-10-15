/**
 * Solidez horizontal de personas y titanes: cada cuerpo ocupa un cilindro vertical y dos
 * cuerpos no pueden ocupar el mismo sitio. Son empujones en el plano XZ; el muro y el suelo
 * siguen resolviéndose con la navegación o con la física, como antes.
 */

export interface Cilindro {
  x: number;
  z: number;
  radio: number;
}

/** Radio horizontal de un civil o un soldado (igual que `radio` de los civiles en config). */
export const RADIO_PERSONA = 0.32;

/**
 * Desplazamiento (dx, dz) que aparta el punto (x, z) de cada cilindro que lo ocupa. Se acumula
 * cilindro a cilindro, así que varios cuerpos a la vez empujan en conjunto.
 */
export function empujeFuera(x: number, z: number, radio: number, otros: readonly Cilindro[]): { dx: number; dz: number } {
  let dx = 0;
  let dz = 0;
  for (const o of otros) {
    const ex = x + dx - o.x;
    const ez = z + dz - o.z;
    const d = Math.hypot(ex, ez);
    const minimo = radio + o.radio;
    if (d >= minimo) continue;
    if (d < 1e-6) {
      dx += minimo;
      continue;
    }
    const k = (minimo - d) / d;
    dx += ex * k;
    dz += ez * k;
  }
  return { dx, dz };
}
