/**
 * Teclado y ratón. Las teclas se identifican por `KeyboardEvent.code`
 * (independiente de la distribución) y los botones del ratón como 'Mouse0'/'Mouse2'.
 */
export class Entrada {
  private abajo = new Set<string>();
  private pulsadas = new Set<string>();
  private dx = 0;
  private dy = 0;
  bloqueado = false;
  onTeclaEspecial: ((code: string) => void) | null = null;

  constructor(private readonly lienzo: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.onTeclaEspecial?.('F1');
        return;
      }
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.abajo.has(e.code)) this.pulsadas.add(e.code);
      this.abajo.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.abajo.delete(e.code));
    window.addEventListener('blur', () => this.abajo.clear());
    lienzo.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (!this.bloqueado) {
        lienzo.requestPointerLock?.();
        return;
      }
      if (!this.abajo.has(code)) this.pulsadas.add(code);
      this.abajo.add(code);
    });
    window.addEventListener('mouseup', (e) => this.abajo.delete(`Mouse${e.button}`));
    lienzo.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.bloqueado = document.pointerLockElement === lienzo;
      if (!this.bloqueado) this.abajo.clear();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.bloqueado) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
  }

  mantenida(code: string): boolean {
    return this.abajo.has(code);
  }

  /** true una sola vez por pulsación (aunque haya varios pasos de física por fotograma). */
  consumir(code: string): boolean {
    if (!this.pulsadas.has(code)) return false;
    this.pulsadas.delete(code);
    return true;
  }

  /** Movimiento del ratón acumulado desde la última llamada. */
  raton(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  /** Descarta pulsaciones que nadie consumió en este fotograma. */
  finFotograma(): void {
    this.pulsadas.clear();
  }

  get elemento(): HTMLElement {
    return this.lienzo;
  }
}
