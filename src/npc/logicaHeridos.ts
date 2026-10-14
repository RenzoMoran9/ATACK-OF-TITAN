/**
 * Heridos y encuentros peligrosos del escuadrón (lógica pura, sin escena).
 *
 * Un soldado pierde vida en la mano de un titán. Por debajo del 40 % se retira a curarse
 * (a caballo, hacia el médico o hacia ti) y te avisa; no vuelve a la línea hasta el 85 %.
 * Con tres o más titanes cerca, el escuadrón también sale del encuentro a caballo.
 */

/** Por debajo de esta fracción de vida, el soldado se retira a curarse. */
export const UMBRAL_HERIDO = 0.4;
/** Hasta esta fracción no vuelve a la línea (histéresis: no va y viene en el umbral). */
export const UMBRAL_CURADO = 0.85;
/** Vida por segundo que cura el médico a un soldado que tiene cerca. */
export const CURACION_SOLDADO = 14;
/** Vida por segundo que cura el médico al jugador que tiene cerca. */
export const CURACION_JUGADOR = 10;
/** Sin médico, un herido que descansa junto al jugador se recupera a este ritmo. */
export const CURACION_SIN_MEDICO = 4;
/** Vida por segundo que pierde quien está apretado en la mano de un titán. */
export const DANIO_AGARRE = 20;
/** Distancia a la que el médico alcanza a curar. */
export const RADIO_CURA = 7;
/** Titanes a menos de este radio que hacen peligroso el encuentro... */
export const RADIO_PELIGRO = 45;
/** ...y cuántos hacen falta para que el escuadrón salga huyendo. */
export const TITANES_PELIGRO = 3;

/** ¿Está herido? Entra por debajo de UMBRAL_HERIDO y sale por encima de UMBRAL_CURADO. */
export function estaHerido(fraccion: number, yaHerido: boolean): boolean {
  return yaHerido ? fraccion < UMBRAL_CURADO : fraccion < UMBRAL_HERIDO;
}

/** Con tantos titanes cerca, el encuentro es demasiado peligroso para pelear. */
export function encuentroPeligroso(titanesCerca: number): boolean {
  return titanesCerca >= TITANES_PELIGRO;
}
