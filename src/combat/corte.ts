import * as THREE from 'three';
import type { PuntoDebil, ZonaTitan } from '../core/tipos';

/**
 * Física del corte (lógica pura, testeable).
 *
 *   D = v_rel × 10 × fÁngulo × fFilo × fTécnica
 *   fÁngulo = 0,35 + 0,65·|sen θ|   (θ = ángulo entre la pasada y el eje de la columna/miembro)
 *   Umbral de la nuca U = 150 + 10·H; el resto de zonas, una fracción de U.
 *
 * Por debajo de 8 m/s la cuchilla rebota. El titán decide el efecto con estos umbrales.
 */

export const DANIO_POR_VELOCIDAD = 10;
export const VELOCIDAD_MINIMA = 8;

/** Fracción del umbral de la nuca que hace falta en cada zona. */
export const FRACCION_UMBRAL: Record<ZonaTitan, number> = {
  nuca: 1,
  tendonIzq: 0.35,
  tendonDer: 0.35,
  corvaIzq: 0.35,
  corvaDer: 0.35,
  ojoIzq: 0.2,
  ojoDer: 0.2,
  brazoIzq: 0.5, // 1,6·U amputa
  brazoDer: 0.5,
  manoIzq: 0.3,
  manoDer: 0.3,
  mandibula: 0.4,
  cuerpo: Infinity,
};

/** Umbral de muerte de la nuca para un titán de altura H (m): 180 con 3 m … 300 con 15 m. */
export function umbralNuca(altura: number): number {
  return 150 + 10 * altura;
}

export function umbralZona(zona: ZonaTitan, altura: number): number {
  return FRACCION_UMBRAL[zona] * umbralNuca(altura);
}

export interface DatosCorte {
  /** Velocidad de las cuchillas respecto al titán (m/s). */
  velocidadRelativa: THREE.Vector3;
  /** Eje de la columna o del miembro (por defecto la vertical). */
  eje?: THREE.Vector3;
  /** Durabilidad del par montado (0–1). */
  filo: number;
  /** fTécnica: giro de Levi, esquiva in extremis, rematador experto… */
  bonificacion?: number;
}

export interface ResultadoDanio {
  danio: number;
  factorAngulo: number;
  /** Demasiado lento: no corta. */
  rebota: boolean;
}

const ARRIBA = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

export function calcularDanio(d: DatosCorte): ResultadoDanio {
  const v = d.velocidadRelativa.length();
  if (v < VELOCIDAD_MINIMA) return { danio: 0, factorAngulo: 0, rebota: true };
  const eje = d.eje ?? ARRIBA;
  const senTheta = tmp.crossVectors(d.velocidadRelativa, eje).length() / (v * Math.max(1e-6, eje.length()));
  const factorAngulo = 0.35 + 0.65 * Math.abs(senTheta);
  const filo = THREE.MathUtils.clamp(d.filo, 0, 1);
  const factorFilo = filo <= 0 ? 0 : filo < 0.3 ? 0.6 : 1;
  return { danio: v * DANIO_POR_VELOCIDAD * factorAngulo * factorFilo * (d.bonificacion ?? 1), factorAngulo, rebota: false };
}

/**
 * Durabilidad que se pierde (0–1, sobre 100 puntos por par): 3 + D/50 por golpe útil,
 * el doble si el ángulo es malo; 5 puntos si rebota.
 */
export function desgaste(r: ResultadoDanio): number {
  if (r.rebota) return 0.05;
  const puntos = (3 + r.danio / 50) * (r.factorAngulo < 0.5 ? 2 : 1);
  return puntos / 100;
}

/**
 * Punto débil activo que alcanzan las cuchillas: la esfera de alcance del atacante
 * (radio `alcance`) toca la de la zona. Prioriza la nuca, luego la más cercana; el
 * torso solo si no hay nada mejor.
 */
export function zonaAlAlcance(pos: THREE.Vector3, alcance: number, puntos: readonly PuntoDebil[]): PuntoDebil | null {
  let mejor: PuntoDebil | null = null;
  let mejorD = Infinity;
  for (const p of puntos) {
    if (!p.activo) continue;
    const d = p.centro.distanceTo(pos) - p.radio;
    if (d > alcance) continue;
    const prioridad = p.zona === 'nuca' ? d - 100 : p.zona === 'cuerpo' ? d + 100 : d;
    if (prioridad < mejorD) {
      mejorD = prioridad;
      mejor = p;
    }
  }
  return mejor;
}
