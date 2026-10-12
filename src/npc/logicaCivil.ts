import type { Rng } from '../core/rng';

/**
 * Lógica pura de los civiles (sin Three.js): aspecto de época, velocidades y pánico
 * según la investigación (docs/investigacion/combate.json → civiles), y la cola de la
 * puerta de evacuación con caudal limitado.
 */

export type TipoCivil = 'hombre' | 'mujer' | 'anciano' | 'anciana' | 'nino' | 'nina';
export type Tocado = 'pelo' | 'panuelo' | 'gorro' | 'mono';

export interface AspectoCivil {
  tipo: TipoCivil;
  /** Altura total (m): adulto ~1,7, niño 1,0–1,3. */
  altura: number;
  piel: string;
  pelo: string;
  /** Camisa, blusa o túnica (torso y mangas). */
  camisa: string;
  /** Pantalón o medias (piernas). */
  pantalon: string;
  /** Falda larga, vestido o sayo (null = sin falda). */
  falda: string | null;
  delantal: string | null;
  tocado: Tocado;
  colorTocado: string;
  baston: boolean;
  /** Encorvamiento del torso (rad), ancianos. */
  encorvado: number;
  /** Cabeza relativamente más grande en los niños. */
  escalaCabeza: number;
}

// Paleta de época: tierras, ocres, lino crudo, verdes y azules apagados
export const TELAS = ['#6b4f3a', '#7a5c3e', '#8b6b4a', '#a8844f', '#6b6b3d', '#5d6b4a', '#4f5d6b', '#7d7a72', '#7a3b2e', '#a08a3c', '#5a4636', '#8a7a5c'];
export const TELAS_CLARAS = ['#d8cfbd', '#cbbf9f', '#e2d9c4', '#bfb49a'];
export const PANUELOS = ['#d8cfbd', '#b8a07a', '#9a5a44', '#6f7f8c', '#c9b98e', '#8c6d4f'];
export const PIELES = ['#e8c6a6', '#e0b994', '#d4a882', '#f0d2b6', '#c99a74'];
export const PELOS = ['#2b1d14', '#4a3222', '#6b4a2b', '#8a6a3e', '#b89a62', '#1d1612'];
export const CANAS = ['#cfcac2', '#b9b4ab', '#e2ded6'];

/** Reparto aproximado de la población de un distrito: adultos, ancianos y niños. */
export function elegirTipo(rng: Rng): TipoCivil {
  const r = rng.siguiente();
  if (r < 0.3) return 'hombre';
  if (r < 0.6) return 'mujer';
  if (r < 0.7) return 'anciano';
  if (r < 0.8) return 'anciana';
  if (r < 0.9) return 'nino';
  return 'nina';
}

export function esNino(t: TipoCivil): boolean {
  return t === 'nino' || t === 'nina';
}

export function esAnciano(t: TipoCivil): boolean {
  return t === 'anciano' || t === 'anciana';
}

export function esMujer(t: TipoCivil): boolean {
  return t === 'mujer' || t === 'anciana' || t === 'nina';
}

export function crearAspectoCivil(rng: Rng, tipo: TipoCivil = elegirTipo(rng)): AspectoCivil {
  const mujer = esMujer(tipo);
  const nino = esNino(tipo);
  const anciano = esAnciano(tipo);
  const altura = nino ? rng.rango(1.0, 1.32) : anciano ? rng.rango(1.52, 1.66) : mujer ? rng.rango(1.56, 1.7) : rng.rango(1.66, 1.82);
  const pelo = anciano ? rng.elegir(CANAS) : rng.elegir(PELOS);
  let tocado: Tocado;
  let colorTocado = pelo;
  if (mujer) {
    tocado = rng.siguiente() < (anciano ? 0.75 : 0.45) ? 'panuelo' : nino ? 'pelo' : 'mono';
    if (tocado === 'panuelo') colorTocado = rng.elegir(PANUELOS);
  } else {
    tocado = rng.siguiente() < (nino ? 0.15 : 0.4) ? 'gorro' : 'pelo';
    if (tocado === 'gorro') colorTocado = rng.elegir(['#4a3a2c', '#5a5040', '#3d3a34', '#6b5a44']);
  }
  const camisaClara = rng.siguiente() < 0.45;
  return {
    tipo,
    altura,
    piel: rng.elegir(PIELES),
    pelo,
    camisa: camisaClara ? rng.elegir(TELAS_CLARAS) : rng.elegir(TELAS),
    pantalon: mujer ? '#3d342b' : rng.elegir(['#4a3f33', '#5a4e3c', '#3d3a34', '#6b5a44', '#5d5a4a']),
    falda: mujer || (tipo === 'anciano' && rng.siguiente() < 0.3) ? rng.elegir(TELAS) : null,
    delantal: mujer && !nino && rng.siguiente() < 0.55 ? rng.elegir(TELAS_CLARAS) : null,
    tocado,
    colorTocado,
    baston: anciano && rng.siguiente() < 0.5,
    encorvado: anciano ? rng.rango(0.12, 0.3) : 0,
    escalaCabeza: nino ? 1.22 : 1,
  };
}

/** Velocidad al pasear (m/s): 1,3 los adultos; algo menos niños y ancianos. */
export function velocidadAndar(tipo: TipoCivil, rng: Rng): number {
  if (esAnciano(tipo)) return rng.rango(0.85, 1.05);
  if (esNino(tipo)) return rng.rango(1.05, 1.25);
  return rng.rango(1.18, 1.42);
}

/** Velocidad de huida (m/s): 3,5–5,5 los adultos; niños y ancianos ~3. */
export function velocidadCorrer(tipo: TipoCivil, rng: Rng): number {
  if (esAnciano(tipo) || esNino(tipo)) return rng.rango(2.8, 3.2);
  return rng.rango(3.5, 5.5);
}

export const CIVILES = {
  /** Distancia a la que un titán da la alarma. */
  radioAlarma: 120,
  /** Distancia a la que un titán que se acerca hace huir aunque no haya orden de evacuar. */
  radioHuida: 70,
  /** Grito (sin audio todavía: solo cambia la animación). */
  radioGrito: 40,
  radioParalisis: 25,
  probParalisis: 0.1,
  paralisis: [2, 4] as const,
  /** Probabilidad de tropezar por segundo de carrera. */
  tropiezoPorSegundo: 0.02,
  duracionTropiezo: 1.5,
  /** Caída que deja herido (m). */
  caidaHerido: 6,
  /** Personas por segundo que cruzan la puerta de evacuación. */
  caudalPuerta: 3,
  /** Alarma (mirar y señalar) antes de echar a correr. */
  alarma: [1.2, 2.6] as const,
  /** Reacción a la orden de evacuar. */
  reaccionEvacuar: [0.2, 1.4] as const,
  radio: 0.32,
} as const;

/** Probabilidad de un suceso con tasa `porSegundo` en un intervalo dt. */
export function probEnIntervalo(porSegundo: number, dt: number): number {
  return 1 - Math.pow(1 - porSegundo, dt);
}

/**
 * Cola de la puerta de evacuación: cada persona que llega recibe su turno de paso,
 * separado 1/caudal segundos del anterior (cuello de botella como en Trost).
 */
export class ColaPuerta {
  private ultimo = -Infinity;
  constructor(public caudal: number = CIVILES.caudalPuerta) {}

  /** Momento (s de juego) en que la persona que llega en `t` puede cruzar. */
  turno(t: number): number {
    const intervalo = 1 / Math.max(1e-3, this.caudal);
    this.ultimo = Math.max(t, this.ultimo + intervalo);
    return this.ultimo;
  }

  reiniciar(): void {
    this.ultimo = -Infinity;
  }
}
