/**
 * Cuentas del mapa interactivo (lógica pura, testeable): la vista (centro y zoom) y el paso de
 * coordenadas del mundo al lienzo y al revés, el zoom alrededor de un punto, y los textos de
 * coordenadas, distancias y rumbos. Coordenadas del mundo: x hacia el este, z hacia el sur
 * (norte = −z, arriba en el mapa).
 */

export interface Vista {
  /** Centro de la vista en el mundo (m). */
  cx: number;
  cz: number;
  /** Píxeles del lienzo por metro. */
  k: number;
  /** Tamaño del lienzo (px). */
  ancho: number;
  alto: number;
}

export function aLienzo(v: Vista, x: number, z: number): { px: number; py: number } {
  return { px: (x - v.cx) * v.k + v.ancho / 2, py: (z - v.cz) * v.k + v.alto / 2 };
}

export function aMundo(v: Vista, px: number, py: number): { x: number; z: number } {
  return { x: (px - v.ancho / 2) / v.k + v.cx, z: (py - v.alto / 2) / v.k + v.cz };
}

/** Zoom por `factor` dejando quieto el punto del lienzo (px, py) (el de debajo del dedo o del ratón). */
export function zoomEn(v: Vista, factor: number, px: number, py: number, kMin: number, kMax: number): Vista {
  const k = Math.min(kMax, Math.max(kMin, v.k * factor));
  const fijo = aMundo(v, px, py);
  return { ...v, k, cx: fijo.x - (px - v.ancho / 2) / k, cz: fijo.z - (py - v.alto / 2) / k };
}

/** Desplaza la vista arrastrando (dx, dy) píxeles. */
export function arrastrar(v: Vista, dx: number, dy: number): Vista {
  return { ...v, cx: v.cx - dx / v.k, cz: v.cz - dy / v.k };
}

/** Mantiene el centro dentro de los límites del mundo (con margen). */
export function limitar(v: Vista, x0: number, x1: number, z0: number, z1: number): Vista {
  return { ...v, cx: Math.min(x1, Math.max(x0, v.cx)), cz: Math.min(z1, Math.max(z0, v.cz)) };
}

const RUMBOS = ['al norte', 'al noreste', 'al este', 'al sureste', 'al sur', 'al suroeste', 'al oeste', 'al noroeste'];

/** «al sureste»: hacia dónde queda (dx, dz) (norte = −z). */
export function rumbo(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz);
  return RUMBOS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** «850 m» o «1,3 km». */
export function distancia(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** «x 120 · z −340» (con el signo menos tipográfico). */
export function coordenadas(x: number, z: number): string {
  const f = (v: number) => String(Math.round(v)).replace('-', '−');
  return `x ${f(x)} · z ${f(z)}`;
}

/** Lee «120, -340», «120 -340» o «x 120 z −340». Null si no hay dos números. */
export function leerCoordenadas(texto: string): { x: number; z: number } | null {
  const nums = texto.replace(/−/g, '-').match(/-?\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const n = nums.slice(0, 2).map((s) => Number(s.replace(',', '.')));
  return n.every(Number.isFinite) ? { x: n[0], z: n[1] } : null;
}

/** Paso de la cuadrícula (m) para que las líneas queden a unos 60–150 px. */
export function pasoCuadricula(k: number): number {
  for (const paso of [50, 100, 250, 500, 1000]) if (paso * k >= 60) return paso;
  return 2000;
}
