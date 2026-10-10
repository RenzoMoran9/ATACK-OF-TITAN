import * as THREE from 'three';

/**
 * Navegación en rejilla para titanes y civiles.
 *
 * - Rejilla de ocupación (casas, iglesia, muralla, troncos...).
 * - Mapa de holgura: distancia (m) de cada celda al obstáculo más cercano, para que un
 *   titán de 15 m solo pase por donde cabe y un civil pueda meterse por un callejón.
 * - A* de 8 vecinos con poda por línea de visión para rutas suaves.
 */

export interface Limites {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const INF = 1e9;

class MonticuloMin {
  private readonly ids: number[] = [];
  private readonly prioridades: number[] = [];

  get vacio(): boolean {
    return this.ids.length === 0;
  }

  meter(id: number, p: number): void {
    const ids = this.ids;
    const pr = this.prioridades;
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

  sacar(): number {
    const ids = this.ids;
    const pr = this.prioridades;
    const tope = ids[0];
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

export class Navegacion {
  readonly ancho: number;
  readonly alto: number;
  private readonly ocupado: Uint8Array;
  private holgura: Float32Array;
  private sucio = true;

  constructor(readonly limites: Limites, readonly celda = 3) {
    this.ancho = Math.ceil((limites.x1 - limites.x0) / celda);
    this.alto = Math.ceil((limites.z1 - limites.z0) / celda);
    this.ocupado = new Uint8Array(this.ancho * this.alto);
    this.holgura = new Float32Array(this.ancho * this.alto);
  }

  // ── Coordenadas ──
  private ix(x: number): number {
    return Math.floor((x - this.limites.x0) / this.celda);
  }
  private iz(z: number): number {
    return Math.floor((z - this.limites.z0) / this.celda);
  }
  private cx(i: number): number {
    return this.limites.x0 + (i + 0.5) * this.celda;
  }
  private cz(j: number): number {
    return this.limites.z0 + (j + 0.5) * this.celda;
  }
  private dentro(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.ancho && j < this.alto;
  }

  // ── Construcción ──

  /** Bloquea (o libera con `valor = 0`) las celdas cuyo centro cae en el rectángulo rotado. */
  bloquearCaja(cx: number, cz: number, hx: number, hz: number, rotY = 0, valor = 1): void {
    const r = Math.hypot(hx, hz);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    for (let j = this.iz(cz - r); j <= this.iz(cz + r); j++) {
      for (let i = this.ix(cx - r); i <= this.ix(cx + r); i++) {
        if (!this.dentro(i, j)) continue;
        const dx = this.cx(i) - cx;
        const dz = this.cz(j) - cz;
        // al sistema local de la caja (rotación inversa alrededor de Y)
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) this.ocupado[j * this.ancho + i] = valor;
      }
    }
    this.sucio = true;
  }

  bloquearCirculo(cx: number, cz: number, radio: number, valor = 1): void {
    for (let j = this.iz(cz - radio); j <= this.iz(cz + radio); j++) {
      for (let i = this.ix(cx - radio); i <= this.ix(cx + radio); i++) {
        if (!this.dentro(i, j)) continue;
        if (Math.hypot(this.cx(i) - cx, this.cz(j) - cz) <= radio) this.ocupado[j * this.ancho + i] = valor;
      }
    }
    this.sucio = true;
  }

  /**
   * Anillo (muralla) entre los radios r0 y r1 centrado en el origen. `hueco` deja libre
   * un arco alrededor del ángulo dado (0 = +Z) con ese ancho en metros (la puerta).
   */
  bloquearAnillo(r0: number, r1: number, valor = 1, hueco?: { angulo: number; ancho: number }): void {
    for (let j = this.iz(-r1); j <= this.iz(r1); j++) {
      for (let i = this.ix(-r1); i <= this.ix(r1); i++) {
        if (!this.dentro(i, j)) continue;
        const x = this.cx(i);
        const z = this.cz(j);
        const r = Math.hypot(x, z);
        if (r < r0 - this.celda * 0.5 || r > r1 + this.celda * 0.5) continue;
        if (hueco) {
          const ang = Math.atan2(x, z);
          let d = ang - hueco.angulo;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d * r) < hueco.ancho / 2) continue;
        }
        this.ocupado[j * this.ancho + i] = valor;
      }
    }
    this.sucio = true;
  }

  /** Marca o libera el arco de la puerta (para abrir la brecha). */
  ponerArco(r0: number, r1: number, angulo: number, ancho: number, valor: number): void {
    for (let j = this.iz(-r1); j <= this.iz(r1); j++) {
      for (let i = this.ix(-r1); i <= this.ix(r1); i++) {
        if (!this.dentro(i, j)) continue;
        const x = this.cx(i);
        const z = this.cz(j);
        const r = Math.hypot(x, z);
        if (r < r0 - this.celda * 0.5 || r > r1 + this.celda * 0.5) continue;
        let d = Math.atan2(x, z) - angulo;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d * r) < ancho / 2) this.ocupado[j * this.ancho + i] = valor;
      }
    }
    this.sucio = true;
  }

  /** Recalcula la holgura (transformada de distancia chaflán 3-4, en metros). */
  private recalcular(): void {
    const w = this.ancho;
    const h = this.alto;
    const d = this.holgura;
    for (let k = 0; k < d.length; k++) d[k] = this.ocupado[k] ? 0 : INF;
    const a = this.celda;
    const b = this.celda * Math.SQRT2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (d[k] === 0) continue;
        let m = d[k];
        if (i > 0) m = Math.min(m, d[k - 1] + a);
        if (j > 0) {
          m = Math.min(m, d[k - w] + a);
          if (i > 0) m = Math.min(m, d[k - w - 1] + b);
          if (i < w - 1) m = Math.min(m, d[k - w + 1] + b);
        }
        d[k] = m;
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        if (d[k] === 0) continue;
        let m = d[k];
        if (i < w - 1) m = Math.min(m, d[k + 1] + a);
        if (j < h - 1) {
          m = Math.min(m, d[k + w] + a);
          if (i < w - 1) m = Math.min(m, d[k + w + 1] + b);
          if (i > 0) m = Math.min(m, d[k + w - 1] + b);
        }
        d[k] = m;
      }
    }
    // la holgura se mide desde el borde de la celda bloqueada, no desde su centro
    for (let k = 0; k < d.length; k++) if (d[k] > 0) d[k] = Math.max(0.01, d[k] - this.celda * 0.5);
    this.sucio = false;
  }

  // ── Consultas ──

  /** Distancia libre (m) en el punto; fuera de la rejilla se considera campo abierto. */
  holguraEn(x: number, z: number): number {
    if (this.sucio) this.recalcular();
    const i = this.ix(x);
    const j = this.iz(z);
    if (!this.dentro(i, j)) return 50;
    return this.holgura[j * this.ancho + i];
  }

  libre(x: number, z: number, radio: number): boolean {
    return this.holguraEn(x, z) >= radio;
  }

  /** ¿Se puede ir en línea recta de a a b con ese radio? */
  lineaLibre(a: { x: number; z: number }, b: { x: number; z: number }, radio: number): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / (this.celda * 0.5)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (!this.libre(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radio)) return false;
    }
    return true;
  }

  /** Celda transitable más cercana a (x, z) para ese radio (búsqueda en anillos). */
  puntoLibreCercano(x: number, z: number, radio: number, maxAnillos = 12): THREE.Vector3 | null {
    if (this.libre(x, z, radio)) return new THREE.Vector3(x, 0, z);
    const i0 = this.ix(x);
    const j0 = this.iz(z);
    for (let r = 1; r <= maxAnillos; r++) {
      let mejor: THREE.Vector3 | null = null;
      let mejorD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di;
          const j = j0 + dj;
          const px = this.cx(i);
          const pz = this.cz(j);
          if (!this.libre(px, pz, radio)) continue;
          const dd = Math.hypot(px - x, pz - z);
          if (dd < mejorD) {
            mejorD = dd;
            mejor = new THREE.Vector3(px, 0, pz);
          }
        }
      }
      if (mejor) return mejor;
    }
    return null;
  }

  /**
   * Ruta A* de `desde` a `hasta` para un agente de radio `radio`. Devuelve puntos de paso
   * (y = 0) sin incluir el origen, o null si no hay ruta dentro del presupuesto de nodos.
   */
  ruta(desde: { x: number; z: number }, hasta: { x: number; z: number }, radio: number, maxNodos = 6000): THREE.Vector3[] | null {
    if (this.sucio) this.recalcular();
    if (this.lineaLibre(desde, hasta, radio)) return [new THREE.Vector3(hasta.x, 0, hasta.z)];
    const meta = this.puntoLibreCercano(hasta.x, hasta.z, radio);
    if (!meta) return null;
    const w = this.ancho;
    const si = THREE.MathUtils.clamp(this.ix(desde.x), 0, w - 1);
    const sj = THREE.MathUtils.clamp(this.iz(desde.z), 0, this.alto - 1);
    const gi = THREE.MathUtils.clamp(this.ix(meta.x), 0, w - 1);
    const gj = THREE.MathUtils.clamp(this.iz(meta.z), 0, this.alto - 1);
    const inicio = sj * w + si;
    const fin = gj * w + gi;
    const g = new Map<number, number>([[inicio, 0]]);
    const padre = new Map<number, number>();
    const cerrado = new Set<number>();
    const abiertos = new MonticuloMin();
    const hcost = (k: number) => {
      const di = Math.abs((k % w) - gi);
      const dj = Math.abs(Math.floor(k / w) - gj);
      return (Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj)) * this.celda;
    };
    abiertos.meter(inicio, hcost(inicio));
    let expandidos = 0;
    let encontrado = false;
    while (!abiertos.vacio && expandidos < maxNodos) {
      const k = abiertos.sacar();
      if (cerrado.has(k)) continue;
      if (k === fin) {
        encontrado = true;
        break;
      }
      cerrado.add(k);
      expandidos++;
      const i = k % w;
      const j = Math.floor(k / w);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!this.dentro(ni, nj)) continue;
          const nk = nj * w + ni;
          if (cerrado.has(nk)) continue;
          if (this.holgura[nk] < radio && nk !== fin) continue;
          // sin cortar esquinas en diagonal
          if (di !== 0 && dj !== 0 && (this.holgura[j * w + ni] < radio || this.holgura[nj * w + i] < radio)) continue;
          const coste = (di !== 0 && dj !== 0 ? Math.SQRT2 : 1) * this.celda;
          const ng = (g.get(k) ?? INF) + coste;
          if (ng < (g.get(nk) ?? INF)) {
            g.set(nk, ng);
            padre.set(nk, k);
            abiertos.meter(nk, ng + hcost(nk));
          }
        }
      }
    }
    if (!encontrado) return null;
    const celdas: THREE.Vector3[] = [];
    for (let k: number | undefined = fin; k !== undefined && k !== inicio; k = padre.get(k)) {
      celdas.push(new THREE.Vector3(this.cx(k % w), 0, this.cz(Math.floor(k / w))));
    }
    celdas.reverse();
    celdas[celdas.length - 1] = new THREE.Vector3(meta.x, 0, meta.z);
    // poda por línea de visión
    const ruta: THREE.Vector3[] = [];
    let ancla = { x: desde.x, z: desde.z };
    let k = 0;
    while (k < celdas.length) {
      let lejos = k;
      for (let m = celdas.length - 1; m > k; m--) {
        if (this.lineaLibre(ancla, celdas[m], radio)) {
          lejos = m;
          break;
        }
      }
      ruta.push(celdas[lejos]);
      ancla = celdas[lejos];
      k = lejos + 1;
    }
    return ruta;
  }
}
