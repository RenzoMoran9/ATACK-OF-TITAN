import * as THREE from 'three';

/**
 * Reglas de comportamiento de los titanes puros (lógica pura, testeable), con los números
 * de docs/investigacion/combate.json.
 */

/** Paseo: 0,8 + 0,18·H m/s (1,3 con 3 m; 3,5 con 15 m). */
export const velocidadAndar = (H: number): number => 0.8 + 0.18 * H;

/** Persecución: 2,5 + 0,55·H m/s (4,2 con 3 m; 10,8 con 15 m). */
export const velocidadPersecucion = (H: number): number => 2.5 + 0.55 * H;

/** Giro máximo: 240/√H grados por segundo (giran mal: por eso orbitarlos funciona). */
export const giroMaximo = (H: number): number => THREE.MathUtils.degToRad(240 / Math.sqrt(H));

/** Alcance de la vista: 35 + 5·H m, la mitad de noche. */
export const alcanceVista = (H: number, noche: boolean): number => (35 + 5 * H) * (noche ? 0.5 : 1);

/** Tacto/olfato en 360°: 6 + 0,8·H m. */
export const alcanceCercano = (H: number): number => 6 + 0.8 * H;

/** Alcance del agarre desde el hombro: 0,45·H. */
export const alcanceAgarre = (H: number): number => 0.45 * H;

/** Hasta dónde llega la mano estirada (no trepan): 1,45·H. */
export const alturaAlcance = (H: number): number => 1.45 * H;

/** Tiempo de aviso antes de cerrar la mano: 0,5 + 0,03·H s. */
export const avisoAgarre = (H: number): number => 0.5 + 0.03 * H;

/**
 * ¿Está `dir` (unitario, de la cabeza al humano) dentro del cono de visión?
 * ±70° en horizontal respecto a `frente`, de −40° a +60° en vertical (miran hacia arriba).
 */
export function enCono(frente: THREE.Vector3, dir: THREE.Vector3): boolean {
  const fh = new THREE.Vector3(frente.x, 0, frente.z);
  const dh = new THREE.Vector3(dir.x, 0, dir.z);
  const lh = dh.length();
  const elev = Math.atan2(dir.y, lh);
  if (elev > THREE.MathUtils.degToRad(60) || elev < THREE.MathUtils.degToRad(-40)) return false;
  if (lh < 1e-4) return true;
  return fh.normalize().dot(dh.divideScalar(lh)) >= Math.cos(THREE.MathUtils.degToRad(70));
}

/**
 * Prioridad de un objetivo: (1 + 0,5·vecinos a menos de 15 m) / (d/10 + 1).
 * El cebo cuenta el doble; los anormales pesan ×3 las multitudes.
 */
export function prioridad(distancia: number, vecinos: number, opciones: { cebo?: boolean; anormal?: boolean } = {}): number {
  const multitud = 1 + 0.5 * vecinos * (opciones.anormal ? 3 : 1);
  return (multitud / (distancia / 10 + 1)) * (opciones.cebo ? 2 : 1);
}

/** Gira `actual` hacia `objetivo` sin pasar de `maximo` radianes (por el camino corto). */
export function girarHacia(actual: number, objetivo: number, maximo: number): number {
  let d = objetivo - actual;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return actual + THREE.MathUtils.clamp(d, -maximo, maximo);
}
