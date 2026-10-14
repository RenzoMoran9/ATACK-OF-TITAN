/**
 * Ciclo de día y noche continuo (lógica pura, testeable).
 *
 * La hora de juego va de 0 a 24. De día una hora de juego dura un minuto real; de noche el
 * tiempo corre al doble (los titanes se apagan y hay poco que hacer), así que un día entero
 * dura unos 19 minutos. El sol sale a las 6:00 por el este (+X), pasa por el sur (+Z) y se
 * pone a las 19:00 por el oeste; de noche la luz es la de la luna.
 */

export const AMANECER = 6;
export const ANOCHECER = 19;
/** Segundos reales que dura una hora de juego de día. */
export const SEGUNDOS_POR_HORA = 60;
/** De noche el reloj corre este número de veces más rápido. */
export const RAPIDEZ_NOCHE = 2;
/** Elevación máxima del sol a mediodía (grados). */
export const ELEVACION_MAXIMA = 68;
/** Hora a la que empieza una partida nueva. */
export const HORA_INICIAL = 7;

const LARGO_DIA = ANOCHECER - AMANECER;
const LARGO_NOCHE = 24 - LARGO_DIA;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Hora normalizada a [0, 24). */
export function normalizarHora(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** Fracción de la noche transcurrida (0 al ponerse el sol, 1 al salir), o null de día. */
function fraccionNoche(h: number): number | null {
  h = normalizarHora(h);
  if (h >= AMANECER && h < ANOCHECER) return null;
  const desde = h >= ANOCHECER ? h - ANOCHECER : h + 24 - ANOCHECER;
  return desde / LARGO_NOCHE;
}

/**
 * Elevación del sol en grados: positiva de 6:00 a 19:00 (máxima a las 12:30), negativa de
 * noche (hasta −40° a medianoche y media). Continua en el amanecer y el anochecer.
 */
export function elevacionSol(h: number): number {
  const n = fraccionNoche(h);
  if (n === null) return ELEVACION_MAXIMA * Math.sin((Math.PI * (normalizarHora(h) - AMANECER)) / LARGO_DIA);
  return -40 * Math.sin(Math.PI * n);
}

/** Azimut del sol (grados; 0 = este +X, 90 = sur +Z, 180 = oeste). */
export function azimutSol(h: number): number {
  const d = (normalizarHora(h) - AMANECER) / LARGO_DIA;
  return -5 + 190 * Math.min(1, Math.max(0, d));
}

/** Luna: cruza el cielo durante la noche, más baja que el sol. */
export function posicionLuna(h: number): { elevacion: number; azimut: number } {
  const n = fraccionNoche(h) ?? (normalizarHora(h) < 12.5 ? 1 : 0);
  return { elevacion: 22 + 24 * Math.sin(Math.PI * n), azimut: 10 + 160 * n };
}

/** 0 de día, 1 de noche cerrada (transición suave en el crepúsculo). */
export function factorNoche(h: number): number {
  return smooth(3, -7, elevacionSol(h));
}

/** 1 con el sol bajo (luz cálida de amanecer o atardecer), 0 a pleno día o de noche. */
export function calidez(h: number): number {
  const e = elevacionSol(h);
  if (e <= -6) return 0;
  return e < 0 ? smooth(-6, 0, e) : 1 - smooth(6, 24, e);
}

/** Es de noche a efectos de juego (titanes que se apagan, antorchas, ventanas). */
export function esDeNoche(h: number): boolean {
  return elevacionSol(h) < -4;
}

/** Horas de juego que pasan por segundo real a la hora `h`. */
export function velocidadHora(h: number): number {
  return (esDeNoche(h) ? RAPIDEZ_NOCHE : 1) / SEGUNDOS_POR_HORA;
}

/** «07:05». */
export function textoHora(h: number): string {
  const n = normalizarHora(h);
  const hh = Math.floor(n);
  const mm = Math.floor((n - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Momento del día para los textos del HUD. */
export function momentoDia(h: number): 'madrugada' | 'amanecer' | 'mañana' | 'mediodía' | 'tarde' | 'atardecer' | 'noche' {
  const n = normalizarHora(h);
  if (n < 5) return 'madrugada';
  if (n < 7.5) return 'amanecer';
  if (n < 11.5) return 'mañana';
  if (n < 14) return 'mediodía';
  if (n < 17.5) return 'tarde';
  if (n < 20) return 'atardecer';
  return 'noche';
}

/** Reloj del mundo abierto: hora y número de día. */
export class CicloDia {
  dia = 1;
  hora = HORA_INICIAL;
  /** Sin avanzar (capturas, menús). */
  congelado = false;
  /** Multiplicador temporal (descansar hasta el amanecer). */
  aceleracion = 1;

  /** Avanza `dt` segundos reales; devuelve true si ha empezado un día nuevo. */
  avanzar(dt: number): boolean {
    if (this.congelado || dt <= 0) return false;
    this.hora += velocidadHora(this.hora) * this.aceleracion * dt;
    if (this.hora < 24) return false;
    this.hora -= 24;
    this.dia++;
    return true;
  }

  get noche(): boolean {
    return esDeNoche(this.hora);
  }

  /** Horas de juego que faltan hasta `objetivo` (siempre hacia delante). */
  horasHasta(objetivo: number): number {
    return normalizarHora(objetivo - this.hora);
  }
}
