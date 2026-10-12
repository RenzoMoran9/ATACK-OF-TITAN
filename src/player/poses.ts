import * as THREE from 'three';

/**
 * Utilidades puras para la animación procedural del soldado (testeables sin DOM):
 * muelles de segundo orden, IK de dos huesos, base ortonormal del cuerpo y elección
 * de la variante de impulso.
 */

export interface Muelle {
  x: number;
  v: number;
}

/**
 * Muelle amortiguado hacia `objetivo`: a = ω²(obj − x) − 2ζω·v. Subpasos para que
 * ω·h ≤ 0,3 y sea estable con cualquier dt.
 */
export function muelle(m: Muelle, objetivo: number, omega: number, zeta: number, dt: number): void {
  if (dt <= 0) return;
  const n = Math.max(1, Math.ceil((omega * dt) / 0.3));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = omega * omega * (objetivo - m.x) - 2 * zeta * omega * m.v;
    m.v += a * h;
    m.x += m.v * h;
  }
}

/**
 * IK de dos huesos (longitudes L1, L2) para una distancia h entre la raíz y el extremo.
 * Devuelve la flexión de la articulación media y el ángulo del primer hueso respecto a
 * la línea raíz-extremo (ambos en radianes, ≥ 0).
 */
export function ikDosHuesos(L1: number, L2: number, h: number): { medio: number; raiz: number } {
  const d = THREE.MathUtils.clamp(h, Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  const medio = Math.PI - Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const raiz = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  return { medio, raiz };
}

/** Distancia entre raíz y extremo que produce esa IK (para tests). */
export function alcanceIK(L1: number, L2: number, medio: number): number {
  const angulo = Math.PI - medio;
  return Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos(angulo));
}

/**
 * Base del cuerpo: `eje` (pies → cabeza) y un frente perpendicular sacado de la
 * velocidad (o del frente anterior si la velocidad es casi paralela al eje).
 * Devuelve la izquierda, el eje y el frente ortonormales (izq × eje = frente).
 */
export function baseCuerpo(eje: THREE.Vector3, velocidad: THREE.Vector3, frenteAnterior: THREE.Vector3): { izq: THREE.Vector3; eje: THREE.Vector3; frente: THREE.Vector3 } {
  const e = eje.clone().normalize();
  let f = velocidad.clone().addScaledVector(e, -velocidad.dot(e));
  if (f.length() < 1.5) {
    f = frenteAnterior.clone().addScaledVector(e, -frenteAnterior.dot(e));
    if (f.lengthSq() < 1e-6) f = Math.abs(e.y) < 0.9 ? new THREE.Vector3(0, 1, 0).addScaledVector(e, -e.y) : new THREE.Vector3(0, 0, 1).addScaledVector(e, -e.z);
  }
  f.normalize();
  const izq = new THREE.Vector3().crossVectors(e, f).normalize();
  const frente = new THREE.Vector3().crossVectors(izq, e).normalize();
  return { izq, eje: e, frente };
}

export type VarianteImpulso = 'delante' | 'izquierda' | 'derecha' | 'atras' | 'arriba';

/** Como air2 / air2_left / air2_right / air2_backward de AoTTG, más «arriba». */
export function varianteImpulso(dirImpulso: THREE.Vector3, frente: THREE.Vector3, izquierda: THREE.Vector3): VarianteImpulso {
  if (dirImpulso.y > 0.7) return 'arriba';
  const h = new THREE.Vector3(dirImpulso.x, 0, dirImpulso.z);
  if (h.lengthSq() < 1e-6) return 'arriba';
  h.normalize();
  const fh = new THREE.Vector3(frente.x, 0, frente.z).normalize();
  const c = h.dot(fh);
  if (c > Math.cos(THREE.MathUtils.degToRad(45))) return 'delante';
  if (c < Math.cos(THREE.MathUtils.degToRad(135))) return 'atras';
  return h.dot(izquierda) > 0 ? 'izquierda' : 'derecha';
}

export const smootherstep = (t: number): number => {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), 3);
