/**
 * Ataque directo (lógica pura, sin escena). Con una parte del titán marcada (X), el botón de
 * tajo no corta al aire: dispara los ganchos hacia ese punto, los mantiene clavados sin tener el
 * botón pulsado y corta solo al llegar a unos 3 m. Así no hace falta soltar un botón para pulsar
 * otro, que es donde se perdía el gancho en el celular.
 */

/** A esta distancia (m, del centro del cuerpo al punto) corta solo. */
export const DISTANCIA_GOLPE_ASALTO = 3;
/** Tiempo máximo del ataque: pasado, se suelta todo. */
export const DURACION_ASALTO = 6;

/** ¿Empieza un ataque directo? Solo con la parte marcada lejos (de cerca, el tajo normal) y cuchillas útiles. */
export function empiezaAsalto(distancia: number, cuchillasUtiles: boolean): boolean {
  return cuchillasUtiles && distancia > DISTANCIA_GOLPE_ASALTO;
}

/** ¿Corta ya? Al llegar a la distancia de golpe, con cuchillas útiles. */
export function cortaAhora(distancia: number, cuchillasUtiles: boolean): boolean {
  return cuchillasUtiles && distancia <= DISTANCIA_GOLPE_ASALTO;
}

/**
 * ¿Se cancela? Si pasado un instante ningún gancho está en uso, no había dónde clavarse; y en
 * cualquier caso, a los DURACION_ASALTO segundos se acaba.
 */
export function asaltoFallido(t: number, ganchosEnUso: boolean): boolean {
  return (t > 0.6 && !ganchosEnUso) || t > DURACION_ASALTO;
}

/**
 * Velocidad (m/s) hacia el punto con la que sale el corte del ataque directo. Por debajo de la
 * mínima de corte.ts el filo rebota ("Muy lento"). Si el jugador llega casi parado (el cable ya
 * no tira), el corte empuja hasta esta velocidad.
 */
export const VELOCIDAD_CORTE_ASALTO = 12;

/** Empuje (m/s) hacia el punto para el corte: el normal, o lo que falte para VELOCIDAD_CORTE_ASALTO. */
export function empujeDeCorte(empujeBase: number, velocidadHaciaPunto: number): number {
  return Math.max(empujeBase, VELOCIDAD_CORTE_ASALTO - velocidadHaciaPunto);
}
