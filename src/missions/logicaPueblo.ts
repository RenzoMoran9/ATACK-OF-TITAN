/**
 * Vida de un pueblo del territorio perdido (lógica pura, testeable). Las horas son de juego
 * (src/core/cicloDia.ts).
 *
 *   tomado ──(matas a los titanes que lo ocupan)──▶ liberado ──(llegan refugiados)──▶
 *   reconstruyendo ──(de día, sin titanes; más rápido con más gente)──▶ en paz
 *
 * Con titanes dentro, la reconstrucción retrocede (pueden echar abajo una etapa entera) y,
 * si el jugador no está cerca para verlo, la gente huye o muere. Si no queda nadie, el pueblo
 * vuelve a estar tomado.
 */

export type FasePueblo = 'tomado' | 'liberado' | 'reconstruyendo' | 'enPaz';

/** Etapas de reconstrucción (cada una levanta un tercio de las casas en ruinas). */
export const ETAPAS = 3;
/** Refugiados que llegan por hora de juego a un pueblo liberado y tranquilo. */
export const LLEGADA_POR_HORA = 5;
/** Vecinos por casa. */
export const VECINOS_POR_CASA = 3;
/** Avance de la reconstrucción por hora de día con el pueblo lleno (≈17 h de día para terminar). */
export const OBRA_POR_HORA = 0.06;
/** Lo que destroza cada titán dentro del pueblo por hora. */
export const DESTROZO_POR_HORA = 0.1;
/** Vecinos que se pierden por hora y titán cuando el jugador no está (huyen o mueren). */
export const PERDIDA_POR_HORA = 3;

export interface EstadoGuardadoPueblo {
  id: string;
  liberado: boolean;
  habitantes: number;
  progreso: number;
  /** Titanes que aún ocupan el pueblo tomado. */
  ocupantes: number;
}

export class LogicaPueblo {
  liberado = false;
  habitantes = 0;
  /** Reconstrucción, 0–1. */
  progreso = 0;
  /** Titanes que ocupan el pueblo mientras está tomado. */
  ocupantes: number;

  constructor(readonly id: string, readonly casas: number, ocupantes: number) {
    this.ocupantes = ocupantes;
  }

  get maxHabitantes(): number {
    return this.casas * VECINOS_POR_CASA;
  }

  /** Etapas ya reconstruidas (0–3). */
  get etapas(): number {
    return Math.min(ETAPAS, Math.floor(this.progreso * ETAPAS + 1e-6));
  }

  get fase(): FasePueblo {
    if (!this.liberado) return 'tomado';
    if (this.progreso >= 1) return 'enPaz';
    return this.habitantes >= 1 ? 'reconstruyendo' : 'liberado';
  }

  /** Hay obras en marcha ahora mismo (andamios y martillos). */
  enObras(esDia: boolean, amenaza: number): boolean {
    return this.liberado && this.habitantes >= 1 && esDia && amenaza === 0 && this.progreso < 1;
  }

  /** Han matado a un ocupante; devuelve true si con eso queda liberado. */
  ocupanteAbatido(): boolean {
    if (this.liberado) return false;
    this.ocupantes = Math.max(0, this.ocupantes - 1);
    if (this.ocupantes > 0) return false;
    this.liberado = true;
    return true;
  }

  /**
   * Avanza `horas` de juego. `amenaza` = titanes dentro del pueblo; `abstracto` = no hay
   * aldeanos de verdad en el mundo (el jugador está lejos) y las pérdidas se calculan aquí.
   * Devuelve 'caido' si se ha quedado vacío por culpa de los titanes.
   */
  avanzar(horas: number, esDia: boolean, amenaza: number, abstracto: boolean): 'caido' | null {
    if (!this.liberado || horas <= 0) return null;
    if (amenaza > 0) {
      this.progreso = Math.max(0, this.progreso - DESTROZO_POR_HORA * amenaza * horas);
      if (abstracto && this.habitantes > 0) {
        this.habitantes = Math.max(0, this.habitantes - PERDIDA_POR_HORA * amenaza * horas);
        if (this.habitantes < 1) return this.caer(amenaza);
      }
      return null;
    }
    this.habitantes = Math.min(this.maxHabitantes, this.habitantes + LLEGADA_POR_HORA * horas);
    if (esDia && this.habitantes >= 1) this.progreso = Math.min(1, this.progreso + OBRA_POR_HORA * (this.habitantes / this.maxHabitantes) * horas);
    return null;
  }

  /** Un vecino devorado delante del jugador. Devuelve 'caido' si era el último. */
  vecinoPerdido(amenaza: number): 'caido' | null {
    if (!this.liberado) return null;
    this.habitantes = Math.max(0, this.habitantes - 1);
    return this.habitantes < 1 && amenaza > 0 ? this.caer(amenaza) : null;
  }

  /** Ataque rechazado: la gente se anima y vuelven algunos que habían huido. */
  defendido(): void {
    this.habitantes = Math.min(this.maxHabitantes, this.habitantes + 4);
  }

  private caer(amenaza: number): 'caido' {
    this.habitantes = 0;
    this.liberado = false;
    this.ocupantes = Math.max(1, amenaza);
    return 'caido';
  }

  guardar(): EstadoGuardadoPueblo {
    return { id: this.id, liberado: this.liberado, habitantes: this.habitantes, progreso: this.progreso, ocupantes: this.ocupantes };
  }

  cargar(e: EstadoGuardadoPueblo): void {
    this.liberado = !!e.liberado;
    this.habitantes = Math.max(0, Math.min(this.maxHabitantes, Number(e.habitantes) || 0));
    this.progreso = Math.max(0, Math.min(1, Number(e.progreso) || 0));
    this.ocupantes = Math.max(0, Math.round(Number(e.ocupantes) || 0));
    if (!this.liberado && this.ocupantes === 0) this.ocupantes = 2;
  }
}

/** Titanes de un ataque a un pueblo: más cuantos más días lleves. */
export function titanesAtaque(dia: number): number {
  return Math.min(7, 2 + Math.floor(dia / 2));
}

/** Horas de juego hasta el siguiente ataque (algo antes cuantos más pueblos haya habitados). */
export function horasHastaAtaque(habitados: number, azar: () => number): number {
  return (8 + azar() * 6) / Math.max(1, Math.sqrt(habitados));
}
