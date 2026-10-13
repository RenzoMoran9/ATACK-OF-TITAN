/**
 * Aguante (cansancio) para correr y saltar a pie. Correr con Shift lo gasta; al dejar de
 * correr se recupera tras una breve pausa. Si se vacía, el jugador queda agotado: no puede
 * correr hasta recuperar una parte, y anda algo más lento.
 */
export class Aguante {
  static readonly GASTO_CARRERA = 20; // por segundo
  static readonly COSTE_SALTO = 10;
  static readonly RECUPERACION = 18; // por segundo
  static readonly PAUSA = 0.8; // segundos sin gastar antes de recuperar
  static readonly UMBRAL_RECUPERADO = 35;

  nivel: number;
  agotado = false;
  private sinGastar = 99;

  constructor(readonly capacidad = 100) {
    this.nivel = capacidad;
  }

  get fraccion(): number {
    return this.nivel / this.capacidad;
  }

  get puedeCorrer(): boolean {
    return !this.agotado && this.nivel > 0;
  }

  /** Avanza `dt` segundos; `corriendo` = el jugador esprinta en este paso. Devuelve si sigue pudiendo correr. */
  paso(dt: number, corriendo: boolean): boolean {
    if (corriendo && this.puedeCorrer) {
      this.gastar(Aguante.GASTO_CARRERA * dt);
    } else {
      this.sinGastar += dt;
      if (this.sinGastar >= Aguante.PAUSA) this.nivel = Math.min(this.capacidad, this.nivel + Aguante.RECUPERACION * dt);
    }
    if (this.agotado && this.nivel >= Aguante.UMBRAL_RECUPERADO) this.agotado = false;
    return this.puedeCorrer;
  }

  /** Cobra un salto. Sin aguante suficiente el salto sale igual, pero más bajo (devuelve 0–1). */
  saltar(): number {
    const f = Math.min(1, this.nivel / Aguante.COSTE_SALTO);
    this.gastar(Aguante.COSTE_SALTO);
    return 0.65 + 0.35 * f;
  }

  rellenar(): void {
    this.nivel = this.capacidad;
    this.agotado = false;
    this.sinGastar = 99;
  }

  private gastar(c: number): void {
    this.nivel = Math.max(0, this.nivel - c);
    this.sinGastar = 0;
    if (this.nivel <= 0) this.agotado = true;
  }
}
