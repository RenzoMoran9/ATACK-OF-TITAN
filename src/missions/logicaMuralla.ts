/**
 * Cuentas de los cañones de la muralla (lógica pura, testeable).
 *
 * Cada cañón mira hacia fuera desde lo alto del muro (θ = 0 → sur, +Z). Llega hasta 320 m y 55° a
 * cada lado, y baja el tubo hasta 72° por debajo de la horizontal: lo que está pegado al pie del
 * muro queda debajo del cañón y no se le puede dar.
 */

export const ALCANCE_CANON_MURO = 320;
export const ARCO_CANON_MURO = (55 * Math.PI) / 180;
export const DEPRESION_MAX = (72 * Math.PI) / 180;

interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** ¿Está en la coronación de la muralla (encima, entre sus dos caras)? */
export function enLoAltoDeLaMuralla(p: XYZ, radioInterior: number, radioExterior: number, altura: number): boolean {
  const r = Math.hypot(p.x, p.z);
  return r > radioInterior - 1 && r < radioExterior + 1 && p.y > altura - 3;
}

/**
 * Si el cañón con muñones en `pivote` y ángulo `theta` puede tirar al punto `p` (fuera de la
 * muralla), la distancia horizontal hasta él; si no, null.
 */
export function blancoCanonMuro(pivote: XYZ, theta: number, p: XYZ, radioExterior: number): number | null {
  if (Math.hypot(p.x, p.z) < radioExterior + 1) return null;
  const dx = p.x - pivote.x;
  const dz = p.z - pivote.z;
  const d = Math.hypot(dx, dz);
  if (d > ALCANCE_CANON_MURO || d < 1) return null;
  const da = Math.atan2(Math.sin(Math.atan2(dx, dz) - theta), Math.cos(Math.atan2(dx, dz) - theta));
  if (Math.abs(da) > ARCO_CANON_MURO) return null;
  if (Math.atan2(pivote.y - p.y, d) > DEPRESION_MAX) return null;
  return d;
}
