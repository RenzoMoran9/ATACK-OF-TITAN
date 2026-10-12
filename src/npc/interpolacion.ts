/**
 * Estimador de la fracción de interpolación (alfa) para los gestores que solo reciben
 * `dibujar(dt, t)`: replica el acumulador del bucle de paso fijo (main.ts / bucle.ts).
 *
 *   actualizar(dt) → pasoConsumido(dt)
 *   dibujar(dtReal) → alfa(dtReal, escalaTiempo)
 */
export class EstimadorAlfa {
  private acumulado = 0;
  private consumido = 0;
  private paso = 1 / 60;

  /** Llamar en cada paso fijo con su dt. */
  pasoConsumido(dt: number): void {
    this.consumido += dt;
    this.paso = dt;
  }

  /** Llamar una vez por fotograma; devuelve alfa en [0, 1]. */
  alfa(dtReal: number, escala = 1): number {
    this.acumulado += Math.min(dtReal, 0.25) * escala - this.consumido;
    this.consumido = 0;
    if (this.acumulado < 0 || this.acumulado > this.paso) this.acumulado = Math.min(Math.max(this.acumulado, 0), this.paso);
    return this.paso > 0 ? this.acumulado / this.paso : 1;
  }
}
