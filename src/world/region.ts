import type { Caja, PuntoXZ } from './formas';

/**
 * Límites del mundo abierto (4 km × 4 km): Trost en el origen y el territorio perdido al
 * sur (+Z). Fuera de la región la llanura sigue hasta el anillo de montes, pero no hay
 * nada que explorar: al cruzar el borde se avisa y, cuanto más te alejas, más te frena
 * un viento en contra; a 200 m del borde se te devuelve dentro. Lógica pura.
 */

export const REGION: Readonly<Caja> = { x0: -2000, x1: 2000, z0: -1200, z1: 2800 };

/**
 * Rejilla de navegación (celdas de 3 m): la región con el origen alineado con el de la
 * rejilla antigua (−420, −320), para que las calles de Trost caigan en las mismas celdas.
 */
export const LIMITES_NAV: Readonly<Caja> = { x0: -2001, x1: 2001, z0: -1202, z1: 2800 };

/** Metros más allá del borde en los que el empuje crece hasta devolverte. */
export const MARGEN_LIMITE = 200;

/** Distancia (m) a la que se está fuera de la región; 0 dentro. */
export function distanciaFuera(x: number, z: number, r: Caja = REGION): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** Punto de la región más cercano a (x, z). */
export function puntoDentro(x: number, z: number, r: Caja = REGION): PuntoXZ {
  return { x: Math.min(r.x1, Math.max(r.x0, x)), z: Math.min(r.z1, Math.max(r.z0, z)) };
}

/**
 * Aplica el viento en contra fuera de la región: frena la velocidad que se aleja y empuja
 * hacia dentro (10 + 60·f² m/s², con f = fuera / MARGEN_LIMITE). Modifica `vel` y devuelve f
 * (0 dentro; ≥ 1 significa que hay que devolver al jugador dentro).
 */
export function aplicarLimite(pos: PuntoXZ, vel: { x: number; z: number }, dt: number, r: Caja = REGION): number {
  const ox = pos.x - Math.min(r.x1, Math.max(r.x0, pos.x));
  const oz = pos.z - Math.min(r.z1, Math.max(r.z0, pos.z));
  const d = Math.hypot(ox, oz);
  if (d <= 0) return 0;
  const nx = ox / d;
  const nz = oz / d;
  const f = d / MARGEN_LIMITE;
  const saliente = vel.x * nx + vel.z * nz;
  if (saliente > 0) {
    const freno = saliente * (1 - Math.exp(-3 * Math.min(1, f) * dt));
    vel.x -= nx * freno;
    vel.z -= nz * freno;
  }
  const empuje = (10 + 60 * Math.min(1, f) ** 2) * dt;
  vel.x -= nx * empuje;
  vel.z -= nz * empuje;
  return f;
}
