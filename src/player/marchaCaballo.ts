/**
 * Marcha del caballo (lógica pura, testeable): qué hace cada pata según la velocidad para que
 * los cascos no patinen.
 *
 * Cada pata recorre un ciclo: una fase de **apoyo** (fracción `apoyo` del ciclo) en la que el
 * casco está en el suelo y la pata barre hacia atrás justo a la velocidad del cuerpo, y una fase
 * **en el aire** en la que se recoge (rodilla doblada) y vuelve adelante. La cadencia sale de la
 * velocidad y la amplitud se calcula para que lo que barre la pata apoyada sea lo que avanza el
 * cuerpo: v = 2·L·sen(A)·f / apoyo.
 *
 * Andares (desfase de cada pata = cuándo empieza a apoyar, en fracción de ciclo; orden de las
 * patas: delantera izquierda, delantera derecha, trasera izquierda, trasera derecha):
 *  - paso: cuatro tiempos laterales (TI, DI, TD, DD), apoyo 62 %;
 *  - trote: diagonales a la vez (DI+TD, DD+TI), apoyo 42 %;
 *  - galope: transverso con mano derecha (TI, TD, DI, DD) y fase de suspensión, apoyo 24 %.
 */

export const DESFASES = {
  paso: [0.25, 0.75, 0, 0.5],
  trote: [0, 0.5, 0.5, 0],
  galope: [0.42, 0.52, 0, 0.12],
} as const;

/** Velocidades a las que cambia de andar (m/s): del paso al trote y del trote al galope. */
export const CAMBIO_TROTE: [number, number] = [2.2, 3.4];
export const CAMBIO_GALOPE: [number, number] = [8, 10.5];
/** Ángulo máximo que barre una pata (rad); por encima, el ciclo se acelera. */
export const AMPLITUD_MAXIMA = 0.55;

export interface Marcha {
  /** Ciclos por segundo. */
  frecuencia: number;
  /** Fracción del ciclo con el casco en el suelo. */
  apoyo: number;
  /** Ángulo que barre la pata a cada lado de la vertical (rad). */
  amplitud: number;
  /** Desfase de cada pata (fracción de ciclo). */
  desfases: [number, number, number, number];
  /** Peso del trote y del galope (0–1) para el bote del cuerpo y la flexión. */
  trote: number;
  galope: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Mezcla de fases en el círculo (0,9 y 0,1 están a 0,2, no a 0,8). */
function mezclarFase(a: number, b: number, t: number): number {
  let d = b - a;
  d -= Math.round(d);
  return (((a + d * t) % 1) + 1) % 1;
}

/**
 * Marcha a la velocidad `v` (m/s) para patas que giran desde una altura `L` (m) sobre el
 * suelo. Con `giro` (rad/s) parado, da pasitos de paso en vez de girar sobre los cascos.
 */
export function marcha(v: number, L: number, giro = 0): Marcha {
  const u = Math.max(Math.abs(v), Math.abs(giro) * 0.9);
  const trote = smooth(CAMBIO_TROTE[0], CAMBIO_TROTE[1], u);
  const galope = smooth(CAMBIO_GALOPE[0], CAMBIO_GALOPE[1], u);
  const desfases = DESFASES.paso.map((p, i) => mezclarFase(mezclarFase(p, DESFASES.trote[i], trote), DESFASES.galope[i], galope)) as [number, number, number, number];
  const apoyo = lerp(lerp(0.62, 0.42, trote), 0.24, galope);
  // cadencia natural de cada andar, algo más rápida cuanto más rápido
  let frecuencia = lerp(lerp(0.85 + 0.12 * u, 1.3 + 0.06 * u, trote), 1.75 + 0.03 * u, galope);
  // lo que tiene que barrer la pata apoyada para no patinar
  let s = (u * apoyo) / (2 * L * frecuencia);
  const sMax = Math.sin(AMPLITUD_MAXIMA);
  if (s > sMax) {
    // la pata no da para más: más pasos por segundo
    frecuencia = (u * apoyo) / (2 * L * sMax);
    s = sMax;
  }
  return { frecuencia, apoyo, amplitud: Math.asin(s), desfases, trote, galope };
}

/**
 * Ángulo del muslo (positivo = casco hacia atrás) y flexión de la rodilla (0–1) de una pata en
 * la fase `f` de su ciclo (0–1, 0 = el casco toca el suelo delante).
 */
export function pata(f: number, apoyo: number, amplitud: number): { muslo: number; flexion: number; apoyada: boolean } {
  f = ((f % 1) + 1) % 1;
  if (f < apoyo) {
    // apoyada: el casco va de delante a detrás en línea recta y a ritmo constante (sen θ lineal),
    // así se queda clavado en el suelo mientras el cuerpo pasa por encima
    const k = f / apoyo;
    return { muslo: Math.asin((-1 + 2 * k) * Math.sin(amplitud)), flexion: 0, apoyada: true };
  }
  // en el aire: vuelve adelante con un arranque y una frenada suaves, rodilla recogida
  const k = (f - apoyo) / (1 - apoyo);
  const suave = k * k * (3 - 2 * k);
  return { muslo: amplitud - 2 * amplitud * suave, flexion: Math.sin(Math.PI * k), apoyada: false };
}

/** Velocidad del casco apoyado respecto al cuerpo (m/s): con sen θ lineal es constante. */
export function velocidadCasco(m: Marcha, L: number): number {
  return (2 * L * Math.sin(m.amplitud) * m.frecuencia) / m.apoyo;
}

/**
 * Cinemática inversa de una pata de dos huesos (muslo `l1`, caña `l2`) colgada de un pivote:
 * ángulos de la cadera (desde la vertical, positivo = hacia atrás) y de la rodilla (relativo al
 * muslo) para que el casco quede `atras` metros por detrás del pivote y `abajo` metros por
 * debajo. `signo` = +1 si la rodilla se dobla con el casco hacia atrás (delanteras), −1 al
 * revés (corvejón de las traseras). Si no llega, la pata se estira con el casco justo encima
 * del punto (se despega un poco del suelo antes que resbalar).
 */
export function ikPata(atras: number, abajo: number, l1: number, l2: number, signo: 1 | -1): { cadera: number; rodilla: number } {
  const D = Math.hypot(atras, abajo);
  const beta = Math.atan2(atras, abajo);
  if (D >= l1 + l2 - 1e-6) return { cadera: Math.asin(Math.max(-1, Math.min(1, atras / (l1 + l2)))), rodilla: 0 };
  const cosInterior = (l1 * l1 + l2 * l2 - D * D) / (2 * l1 * l2);
  const rodilla = signo * (Math.PI - Math.acos(Math.max(-1, Math.min(1, cosInterior))));
  const cadera = beta - Math.atan2(l2 * Math.sin(rodilla), l1 + l2 * Math.cos(rodilla));
  return { cadera, rodilla };
}

/** Dónde queda el casco (atrás, abajo) con esos ángulos (para comprobar la IK). */
export function cascoDe(cadera: number, rodilla: number, l1: number, l2: number): { atras: number; abajo: number } {
  return {
    atras: l1 * Math.sin(cadera) + l2 * Math.sin(cadera + rodilla),
    abajo: l1 * Math.cos(cadera) + l2 * Math.cos(cadera + rodilla),
  };
}
