/**
 * Campo de flujo para la evacuación (lógica pura, testeable): Dijkstra inverso desde la
 * puerta de evacuación sobre una rejilla de celdas transitables. Las celdas cercanas a un
 * titán cuestan ×20, así que la multitud rodea a los titanes por otras calles.
 *
 * El cálculo se reparte entre pasos (`avanzar(maxNodos)`) con doble búfer: mientras se
 * calcula el nuevo campo, los civiles siguen usando el anterior.
 */

export interface Peligro {
  x: number;
  z: number;
  radio: number;
  /** Multiplicador del coste dentro del radio (20 por defecto). */
  factor?: number;
}

export interface PuntoXZ {
  x: number;
  z: number;
}

class Monticulo {
  private ids: number[] = [];
  private pr: number[] = [];

  get vacio(): boolean {
    return this.ids.length === 0;
  }

  vaciar(): void {
    this.ids.length = 0;
    this.pr.length = 0;
  }

  meter(id: number, p: number): void {
    const ids = this.ids;
    const pr = this.pr;
    ids.push(id);
    pr.push(p);
    let i = ids.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (pr[padre] <= pr[i]) break;
      [ids[i], ids[padre]] = [ids[padre], ids[i]];
      [pr[i], pr[padre]] = [pr[padre], pr[i]];
      i = padre;
    }
  }

  /** Saca el mínimo; devuelve [id, prioridad]. */
  sacar(): [number, number] {
    const ids = this.ids;
    const pr = this.pr;
    const tope: [number, number] = [ids[0], pr[0]];
    const ultId = ids.pop()!;
    const ultP = pr.pop()!;
    if (ids.length > 0) {
      ids[0] = ultId;
      pr[0] = ultP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < ids.length && pr[l] < pr[m]) m = l;
        if (r < ids.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [ids[i], ids[m]] = [ids[m], ids[i]];
        [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return tope;
  }
}

const VECINOS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class CampoHuida {
  readonly ancho: number;
  readonly alto: number;
  private readonly transitable: Uint8Array;
  /** Coste publicado (el que se consulta). */
  private coste: Float32Array;
  private trabajo: Float32Array;
  private readonly cerrado: Uint8Array;
  private readonly factor: Float32Array;
  private readonly monticulo = new Monticulo();
  private calculando = false;
  /** ¿Hay un campo publicado? */
  listo = false;
  /** Veces que se ha publicado un campo nuevo. */
  version = 0;

  /**
   * @param x0,z0 esquina de la rejilla (borde de la primera celda)
   * @param esLibre ¿es transitable el centro (x, z) de una celda?
   */
  constructor(
    readonly x0: number,
    readonly z0: number,
    ancho: number,
    alto: number,
    readonly celda: number,
    esLibre: (x: number, z: number) => boolean,
  ) {
    this.ancho = ancho;
    this.alto = alto;
    const n = ancho * alto;
    this.transitable = new Uint8Array(n);
    this.coste = new Float32Array(n).fill(Infinity);
    this.trabajo = new Float32Array(n).fill(Infinity);
    this.cerrado = new Uint8Array(n);
    this.factor = new Float32Array(n).fill(1);
    for (let j = 0; j < alto; j++) {
      for (let i = 0; i < ancho; i++) this.transitable[j * ancho + i] = esLibre(this.cx(i), this.cz(j)) ? 1 : 0;
    }
  }

  /**
   * Rejilla alineada con otra de origen (ox, oz) y tamaño `celda` (la de navegación),
   * que cubre el rectángulo dado.
   */
  static alineado(
    origen: PuntoXZ,
    celda: number,
    region: { x0: number; x1: number; z0: number; z1: number },
    esLibre: (x: number, z: number) => boolean,
  ): CampoHuida {
    const i0 = Math.floor((region.x0 - origen.x) / celda);
    const j0 = Math.floor((region.z0 - origen.z) / celda);
    const i1 = Math.ceil((region.x1 - origen.x) / celda);
    const j1 = Math.ceil((region.z1 - origen.z) / celda);
    return new CampoHuida(origen.x + i0 * celda, origen.z + j0 * celda, Math.max(1, i1 - i0), Math.max(1, j1 - j0), celda, esLibre);
  }

  cx(i: number): number {
    return this.x0 + (i + 0.5) * this.celda;
  }

  cz(j: number): number {
    return this.z0 + (j + 0.5) * this.celda;
  }

  private ix(x: number): number {
    return Math.floor((x - this.x0) / this.celda);
  }

  private iz(z: number): number {
    return Math.floor((z - this.z0) / this.celda);
  }

  dentro(x: number, z: number): boolean {
    const i = this.ix(x);
    const j = this.iz(z);
    return i >= 0 && j >= 0 && i < this.ancho && j < this.alto;
  }

  esTransitable(x: number, z: number): boolean {
    const i = this.ix(x);
    const j = this.iz(z);
    if (i < 0 || j < 0 || i >= this.ancho || j >= this.alto) return false;
    return this.transitable[j * this.ancho + i] === 1;
  }

  get ocupado(): boolean {
    return this.calculando;
  }

  /** Empieza un cálculo nuevo hacia `objetivos` (radio en m alrededor de cada uno) evitando `peligros`. */
  iniciar(objetivos: PuntoXZ[], radioObjetivo: number, peligros: Peligro[]): void {
    const w = this.ancho;
    this.trabajo.fill(Infinity);
    this.cerrado.fill(0);
    this.factor.fill(1);
    this.monticulo.vaciar();
    for (const p of peligros) {
      const f = p.factor ?? 20;
      const r = p.radio;
      for (let j = Math.max(0, this.iz(p.z - r)); j <= Math.min(this.alto - 1, this.iz(p.z + r)); j++) {
        for (let i = Math.max(0, this.ix(p.x - r)); i <= Math.min(w - 1, this.ix(p.x + r)); i++) {
          if (Math.hypot(this.cx(i) - p.x, this.cz(j) - p.z) <= r) {
            const k = j * w + i;
            this.factor[k] = Math.max(this.factor[k], f);
          }
        }
      }
    }
    let semillas = 0;
    for (const o of objetivos) {
      const r = Math.max(radioObjetivo, this.celda * 0.75);
      for (let j = Math.max(0, this.iz(o.z - r)); j <= Math.min(this.alto - 1, this.iz(o.z + r)); j++) {
        for (let i = Math.max(0, this.ix(o.x - r)); i <= Math.min(w - 1, this.ix(o.x + r)); i++) {
          const k = j * w + i;
          if (!this.transitable[k]) continue;
          if (Math.hypot(this.cx(i) - o.x, this.cz(j) - o.z) > r) continue;
          this.trabajo[k] = 0;
          this.monticulo.meter(k, 0);
          semillas++;
        }
      }
    }
    this.calculando = semillas > 0;
  }

  /** Expande hasta `maxNodos` celdas. Devuelve true si ha terminado (y publicado el campo). */
  avanzar(maxNodos = 4000): boolean {
    if (!this.calculando) return true;
    const w = this.ancho;
    const h = this.alto;
    const d = this.trabajo;
    let expandidos = 0;
    while (!this.monticulo.vacio && expandidos < maxNodos) {
      const [k, p] = this.monticulo.sacar();
      if (this.cerrado[k] || p > d[k]) continue;
      this.cerrado[k] = 1;
      expandidos++;
      const i = k % w;
      const j = (k - i) / w;
      for (const [di, dj] of VECINOS) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (!this.transitable[nk] || this.cerrado[nk]) continue;
        const diagonal = di !== 0 && dj !== 0;
        // sin cortar esquinas
        if (diagonal && (!this.transitable[j * w + ni] || !this.transitable[nj * w + i])) continue;
        const nd = p + (diagonal ? Math.SQRT2 : 1) * this.celda * this.factor[nk];
        if (nd < d[nk]) {
          d[nk] = nd;
          this.monticulo.meter(nk, nd);
        }
      }
    }
    if (!this.monticulo.vacio) return false;
    // publicar
    const viejo = this.coste;
    this.coste = this.trabajo;
    this.trabajo = viejo;
    this.calculando = false;
    this.listo = true;
    this.version++;
    return true;
  }

  /** Cálculo completo de una vez (tests y arranque). */
  calcular(objetivos: PuntoXZ[], radioObjetivo: number, peligros: Peligro[] = []): void {
    this.iniciar(objetivos, radioObjetivo, peligros);
    while (!this.avanzar(1e9));
  }

  /** Coste hasta la meta desde la celda de (x, z) (Infinity si no se llega). */
  costeEn(x: number, z: number): number {
    const i = this.ix(x);
    const j = this.iz(z);
    if (i < 0 || j < 0 || i >= this.ancho || j >= this.alto) return Infinity;
    return this.coste[j * this.ancho + i];
  }

  /** Índice de la celda vecina (o la propia) con menor coste, o -1. */
  private mejorVecina(k: number): number {
    const w = this.ancho;
    const i = k % w;
    const j = (k - i) / w;
    let mejor = -1;
    let mejorC = this.transitable[k] ? this.coste[k] : Infinity;
    for (const [di, dj] of VECINOS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= this.alto) continue;
      const nk = nj * w + ni;
      if (!this.transitable[nk]) continue;
      if (di !== 0 && dj !== 0 && (!this.transitable[j * w + ni] || !this.transitable[nj * w + i])) continue;
      if (this.coste[nk] < mejorC) {
        mejorC = this.coste[nk];
        mejor = nk;
      }
    }
    return mejor;
  }

  /**
   * Hasta `n` puntos sucesivos cuesta abajo desde (x, z) (centros de celda).
   * Vacío si ya está en la meta o no hay camino.
   */
  cadena(x: number, z: number, n: number): PuntoXZ[] {
    const res: PuntoXZ[] = [];
    if (!this.listo) return res;
    const i = this.ix(x);
    const j = this.iz(z);
    if (i < 0 || j < 0 || i >= this.ancho || j >= this.alto) return res;
    let k = j * this.ancho + i;
    for (let m = 0; m < n; m++) {
      if (this.coste[k] === 0 && this.transitable[k]) break;
      const s = this.mejorVecina(k);
      if (s < 0 || !Number.isFinite(this.coste[s])) break;
      k = s;
      const si = k % this.ancho;
      res.push({ x: this.cx(si), z: this.cz((k - si) / this.ancho) });
    }
    return res;
  }
}
