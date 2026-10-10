/**
 * Bucle de juego con paso fijo de física e interpolación de render.
 * `actualizar` se llama a frecuencia constante; `dibujar` una vez por fotograma
 * con `alfa` (0..1) = fracción del siguiente paso ya transcurrida.
 */
export class BuclePasoFijo {
  private acumulado = 0;
  private ultimo = 0;
  private activo = false;
  /** Escala del tiempo de juego (cámara lenta < 1). */
  escalaTiempo = 1;

  constructor(
    private readonly paso: number,
    private readonly actualizar: (dt: number) => void,
    private readonly dibujar: (alfa: number, dtReal: number) => void,
  ) {}

  iniciar(): void {
    this.activo = true;
    this.ultimo = performance.now();
    requestAnimationFrame(this.tick);
  }

  detener(): void {
    this.activo = false;
  }

  private tick = (ahora: number): void => {
    if (!this.activo) return;
    let dt = (ahora - this.ultimo) / 1000;
    this.ultimo = ahora;
    if (dt > 0.25) dt = 0.25;
    this.acumulado += dt * this.escalaTiempo;
    let pasos = 0;
    while (this.acumulado >= this.paso && pasos < 8) {
      this.actualizar(this.paso);
      this.acumulado -= this.paso;
      pasos++;
    }
    if (pasos === 8) this.acumulado = 0;
    this.dibujar(this.acumulado / this.paso, dt);
    requestAnimationFrame(this.tick);
  };
}
