/**
 * Cuchillas del equipo: un par montado (filo 0–1, 100 puntos de durabilidad) y
 * pares de repuesto en las vainas. Cambiar de par tarda 0,6 s y deja indefenso.
 * Lógica pura para tests.
 */
export class Cuchillas {
  static readonly TIEMPO_CAMBIO = 0.6;
  static readonly MAX_REPUESTO = 4;

  filo = 1;
  repuesto = Cuchillas.MAX_REPUESTO;
  /** Pares que caben en las vainas (mejora con el rango). */
  maxRepuesto = Cuchillas.MAX_REPUESTO;
  /** Multiplica el desgaste (menos = hojas más duras). */
  dureza = 1;
  /** Segundos que faltan para terminar el cambio de par (0 = no cambiando). */
  cambiando = 0;

  get rota(): boolean {
    return this.filo <= 0;
  }

  /** Por debajo del 30 % corta al 60 %. */
  get mellada(): boolean {
    return this.filo > 0 && this.filo < 0.3;
  }

  get puedeCortar(): boolean {
    return this.cambiando <= 0 && this.filo > 0;
  }

  /** Resta durabilidad; devuelve true si el par se acaba de romper. */
  desgastar(cantidad: number): boolean {
    const antes = this.filo;
    this.filo = Math.max(0, this.filo - cantidad * this.dureza);
    return antes > 0 && this.filo <= 0;
  }

  /** Empieza a cambiar de par si quedan repuestos y no está ya cambiando. */
  empezarCambio(): boolean {
    if (this.cambiando > 0 || this.repuesto <= 0) return false;
    this.cambiando = Cuchillas.TIEMPO_CAMBIO;
    return true;
  }

  /** Devuelve true en el paso en que termina el cambio. */
  actualizar(dt: number): boolean {
    if (this.cambiando <= 0) return false;
    this.cambiando -= dt;
    if (this.cambiando > 0) return false;
    this.cambiando = 0;
    this.repuesto--;
    this.filo = 1;
    return true;
  }

  /** Reabastecimiento en el depósito: vainas llenas y par nuevo. */
  rellenar(): void {
    this.repuesto = this.maxRepuesto;
    this.filo = 1;
    this.cambiando = 0;
  }
}
