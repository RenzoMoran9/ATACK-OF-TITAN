/**
 * Rangos y mejoras de equipo (lógica pura, testeable). Defender da méritos y los méritos dan rango;
 * cada rango mejora el equipo para siempre (se guarda con la partida):
 *
 * - Asalto a la muralla detenido: 5 (y 2 más si la puerta aguanta).
 * - Cambiante abatido: 3.
 * - Pueblo defendido de un ataque: 2.
 * - Cada 8 titanes abatidos: 1.
 */

export interface Mejoras {
  /** Multiplica la capacidad de los cilindros de gas. */
  gas: number;
  /** Multiplica el desgaste de las hojas (menos = más duras). */
  desgaste: number;
  /** Pares de hojas de repuesto. */
  repuesto: number;
  bengalas: number;
  lanzas: number;
}

export interface Rango {
  nombre: string;
  meritos: number;
  mejoras: Mejoras;
  /** Lo que gana al ascender (para el aviso). */
  novedad: string;
}

export const RANGOS: readonly Rango[] = [
  { nombre: 'Recluta', meritos: 0, mejoras: { gas: 1, desgaste: 1, repuesto: 4, bengalas: 4, lanzas: 2 }, novedad: '' },
  { nombre: 'Soldado', meritos: 5, mejoras: { gas: 1.25, desgaste: 1, repuesto: 4, bengalas: 4, lanzas: 2 }, novedad: 'cilindros de gas más grandes (+25 %)' },
  { nombre: 'Veterano', meritos: 12, mejoras: { gas: 1.25, desgaste: 0.75, repuesto: 4, bengalas: 4, lanzas: 3 }, novedad: 'hojas más duras y una lanza relámpago más' },
  { nombre: 'Sargento', meritos: 22, mejoras: { gas: 1.5, desgaste: 0.75, repuesto: 5, bengalas: 6, lanzas: 3 }, novedad: 'más gas (+50 %), un par de hojas y dos bengalas más' },
  { nombre: 'Capitán', meritos: 35, mejoras: { gas: 1.5, desgaste: 0.6, repuesto: 6, bengalas: 6, lanzas: 4 }, novedad: 'hojas de acero ultraduro, otro par de repuesto y cuatro lanzas' },
  { nombre: 'Comandante', meritos: 55, mejoras: { gas: 1.75, desgaste: 0.5, repuesto: 6, bengalas: 8, lanzas: 5 }, novedad: 'el mejor equipo de la Legión' },
];

export interface Hazanas {
  titanes: number;
  jefes: number;
  defensas: number;
  asaltos: number;
  /** Asaltos detenidos con la puerta entera. */
  asaltosLimpios?: number;
}

export function meritos(h: Hazanas): number {
  return Math.floor(h.titanes / 8) + 3 * h.jefes + 2 * h.defensas + 5 * h.asaltos + 2 * (h.asaltosLimpios ?? 0);
}

/** Índice del rango que dan esos méritos. */
export function indiceRango(m: number): number {
  let i = 0;
  while (i + 1 < RANGOS.length && m >= RANGOS[i + 1].meritos) i++;
  return i;
}

/** «Veterano (14/22 méritos)». */
export function textoRango(m: number): string {
  const i = indiceRango(m);
  const sig = RANGOS[i + 1];
  return sig ? `${RANGOS[i].nombre} (${m}/${sig.meritos} méritos)` : `${RANGOS[i].nombre} (${m} méritos)`;
}
