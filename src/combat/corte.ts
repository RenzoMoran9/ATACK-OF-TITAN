import * as THREE from 'three';
import type { PuntoDebil, ZonaTitan } from '../core/tipos';

/**
 * Física del corte (lógica pura, testeable). El daño sale de la velocidad relativa
 * con la que pasan las cuchillas, del ángulo de entrada y del filo que les queda.
 * El titán decide el efecto con los umbrales de UMBRALES.
 */

/** Daño mínimo para que el corte tenga efecto en cada zona. */
export const UMBRALES: Record<ZonaTitan, number> = {
  nuca: 14, // corte profundo: muerte. Por debajo, herida que regenera.
  tendonIzq: 6, // derribo: cae de rodillas
  tendonDer: 6,
  ojos: 4, // ceguera temporal
  brazoIzq: 8, // brazo inutilizado: no puede agarrar con él
  brazoDer: 8,
  cuerpo: Infinity, // el torso no tiene efecto, solo mella la cuchilla
};

/** Cuánto mella la cuchilla cada zona (la nuca y el hueso desgastan más). */
const DUREZA: Record<ZonaTitan, number> = {
  nuca: 0.12,
  tendonIzq: 0.07,
  tendonDer: 0.07,
  ojos: 0.03,
  brazoIzq: 0.1,
  brazoDer: 0.1,
  cuerpo: 0.15,
};

export interface DatosCorte {
  /** Velocidad del atacante respecto al titán (m/s). */
  velocidadRelativa: THREE.Vector3;
  /** Normal hacia fuera de la zona golpeada. */
  normal: THREE.Vector3;
  /** Filo del par de cuchillas (0–1). */
  filo: number;
  zona: ZonaTitan;
  /** Multiplicador extra (ataque giratorio, rematador experto…). */
  bonificacion?: number;
}

/**
 * Daño = rapidez × factor de ángulo × filo × bonificación.
 * El ángulo ideal es entrar contra la superficie (de fuera hacia dentro): de frente
 * vale 1, rozando de lado 0,45 y saliendo de la superficie 0,25.
 */
export function calcularDanio(d: DatosCorte): { danio: number; factorAngulo: number } {
  const v = d.velocidadRelativa.length();
  if (v < 1e-3) return { danio: 0, factorAngulo: 0 };
  const entrada = -d.velocidadRelativa.dot(d.normal) / (v * Math.max(1e-6, d.normal.length()));
  const factorAngulo = entrada >= 0 ? 0.45 + 0.55 * entrada : Math.max(0.25, 0.45 + 0.2 * entrada);
  const filo = 0.35 + 0.65 * THREE.MathUtils.clamp(d.filo, 0, 1);
  return { danio: v * factorAngulo * filo * (d.bonificacion ?? 1), factorAngulo };
}

/** Filo que se pierde con un golpe (más daño y zonas duras mellan más). */
export function desgaste(zona: ZonaTitan, danio: number): number {
  return DUREZA[zona] * (0.5 + Math.min(1.5, danio / 20));
}

/**
 * Punto débil activo que alcanzan las cuchillas: la esfera de alcance del atacante
 * (radio `alcance`) toca la de la zona. Prioriza la nuca, luego la más cercana.
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
