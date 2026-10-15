/**
 * Reglas del campamento (lógica pura, testeable): el minijuego del martillo, el reparto del
 * trabajo y el cerco de alambre.
 */

/** Radio del cerco (m) y postes que lo forman. */
export const RADIO_CERCO = 13;
export const NUM_POSTES = 12;
/** Radio del corro de carpas. */
export const RADIO_CARPAS = 6.5;
/** Segundos que tarda un soldado en clavar un poste o montar una carpa. */
export const OBRA_SOLDADO = 7;
/** Vida del alambre: cada titán enredado la gasta por segundo. */
export const VIDA_ALAMBRE = 100;
export const DESGASTE_ALAMBRE = 9;
/** Un titán dentro de la franja del alambre va a este porcentaje de su velocidad. */
export const FRENO_ALAMBRE = 0.25;

/** Ciclos por segundo de la aguja del martillo. */
export const RITMO_AGUJA = 0.85;
/** Ancho de la zona verde (fracción de la barra). */
export const ANCHO_ZONA = 0.22;

/** Posición de la aguja (0–1) en el instante `t`: va y viene como un péndulo. */
export function aguja(t: number, ritmo = RITMO_AGUJA): number {
  return 0.5 + 0.5 * Math.sin(Math.PI * 2 * ritmo * t);
}

export type Golpe = 'perfecto' | 'bueno' | 'fallo';

/** Calidad de un martillazo con la aguja en `pos` y la zona verde centrada en `zona`. */
export function calidadGolpe(pos: number, zona: number, ancho = ANCHO_ZONA): Golpe {
  const d = Math.abs(pos - zona);
  if (d <= ancho * 0.18) return 'perfecto';
  if (d <= ancho / 2) return 'bueno';
  return 'fallo';
}

/** Lo que avanza la obra (0–1) con cada martillazo: perfecto de una vez, bueno en tres, fallo casi nada. */
export function avanceGolpe(g: Golpe): number {
  return g === 'perfecto' ? 1 : g === 'bueno' ? 0.34 : 0.05;
}

/** Siguiente zona verde: en un sitio distinto de la barra para que haya que estar atento. */
export function nuevaZona(azar: () => number): number {
  return ANCHO_ZONA / 2 + azar() * (1 - ANCHO_ZONA);
}

/** Posiciones (x, z) de los postes alrededor de un centro. */
export function puntosCerco(cx: number, cz: number, n = NUM_POSTES, r = RADIO_CERCO): { x: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  });
}

/**
 * ¿Está un punto en la franja del alambre? Solo cuenta si los dos postes de ese tramo están
 * clavados (`hechos[i]`, en el orden de `puntosCerco`).
 */
export function enAlambre(x: number, z: number, cx: number, cz: number, hechos: readonly boolean[], margen = 2.2, r = RADIO_CERCO): boolean {
  const d = Math.hypot(x - cx, z - cz);
  if (Math.abs(d - r) > margen) return false;
  const n = hechos.length;
  const a = (Math.atan2(z - cz, x - cx) + Math.PI * 2) % (Math.PI * 2);
  const i = Math.floor(a / ((Math.PI * 2) / n)) % n;
  return hechos[i] && hechos[(i + 1) % n];
}

/**
 * Reparto del trabajo: a cada trabajador libre, la obra sin terminar más cercana que nadie
 * tenga (la del jugador queda reservada). Devuelve el índice de obra de cada trabajador (o −1).
 */
export function repartirObras(
  trabajadores: readonly { x: number; z: number }[],
  obras: readonly { x: number; z: number; hecha: boolean }[],
  reservada = -1,
): number[] {
  const tomadas = new Set<number>(reservada >= 0 ? [reservada] : []);
  return trabajadores.map((t) => {
    let mejor = -1;
    let dMejor = Infinity;
    obras.forEach((o, i) => {
      if (o.hecha || tomadas.has(i)) return;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d < dMejor) {
        dMejor = d;
        mejor = i;
      }
    });
    if (mejor >= 0) tomadas.add(mejor);
    return mejor;
  });
}
