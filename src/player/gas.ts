/**
 * Depósito de gas compartido por los dos cilindros. Lógica pura para tests.
 * Costes puntuales (disparar un gancho, freno de emergencia) y continuos
 * (recoger cable, impulso) en unidades/segundo.
 */
export class DepositoGas {
  nivel: number;

  constructor(public capacidad: number) {
    this.nivel = capacidad;
  }

  get fraccion(): number {
    return this.capacidad > 0 ? this.nivel / this.capacidad : 0;
  }

  get vacio(): boolean {
    return this.nivel <= 0;
  }

  /** Coste puntual: solo se cobra si hay gas suficiente. */
  consumir(cantidad: number): boolean {
    if (this.nivel < cantidad) return false;
    this.nivel -= cantidad;
    return true;
  }

  /**
   * Coste continuo durante `dt` segundos. Devuelve la fracción del tiempo que hubo
   * gas (1 = todo el paso, 0 = nada), para escalar la fuerza aplicada.
   */
  consumirContinuo(tasa: number, dt: number): number {
    const pedido = tasa * dt;
    if (pedido <= 0) return 1;
    if (this.nivel <= 0) return 0;
    const servido = Math.min(pedido, this.nivel);
    this.nivel -= servido;
    return servido / pedido;
  }

  recargar(cantidad: number): void {
    this.nivel = Math.min(this.capacidad, this.nivel + cantidad);
  }
}
