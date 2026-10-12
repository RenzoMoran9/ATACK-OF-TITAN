import type { Rng } from '../core/rng';

/**
 * Formas en planta (XZ) para las zonas del mundo abierto: rectángulos, elipses giradas y
 * polígonos. Sirven para repartir árboles, decidir si un punto está dentro de un bosque,
 * medir lo profundo que está (ambiente y peligro) y dibujar el contorno en el mapa.
 * Lógica pura, sin Three.js.
 */

export interface PuntoXZ {
  x: number;
  z: number;
}

export interface Caja {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export type Forma =
  | ({ tipo: 'rect' } & Caja)
  | { tipo: 'elipse'; cx: number; cz: number; rx: number; rz: number; /** Giro en rad alrededor de Y. */ giro?: number }
  | { tipo: 'poligono'; puntos: PuntoXZ[] };

/** Coordenadas locales de la elipse (sin giro). */
function local(f: Extract<Forma, { tipo: 'elipse' }>, x: number, z: number): PuntoXZ {
  const dx = x - f.cx;
  const dz = z - f.cz;
  const g = f.giro ?? 0;
  if (g === 0) return { x: dx, z: dz };
  const c = Math.cos(g);
  const s = Math.sin(g);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function dentroPoligono(p: PuntoXZ[], x: number, z: number): boolean {
  let dentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Distancia de (x, z) al segmento ab. */
export function distanciaSegmento(x: number, z: number, a: PuntoXZ, b: PuntoXZ): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2)) : 0;
  return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
}

/** Distancia a una polilínea abierta (ríos, caminos). */
export function distanciaPolilinea(x: number, z: number, p: readonly PuntoXZ[]): number {
  let d = Infinity;
  for (let i = 1; i < p.length; i++) d = Math.min(d, distanciaSegmento(x, z, p[i - 1], p[i]));
  return d;
}

export function contiene(f: Forma, x: number, z: number): boolean {
  switch (f.tipo) {
    case 'rect':
      return x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
    case 'elipse': {
      const l = local(f, x, z);
      return (l.x / f.rx) ** 2 + (l.z / f.rz) ** 2 <= 1;
    }
    case 'poligono':
      return dentroPoligono(f.puntos, x, z);
  }
}

/**
 * Distancia aproximada al borde: positiva dentro, negativa fuera (m). En la elipse se
 * mide a lo largo del radio que pasa por el punto (exacta en los ejes).
 */
export function distanciaBorde(f: Forma, x: number, z: number): number {
  switch (f.tipo) {
    case 'rect': {
      const dx = Math.min(x - f.x0, f.x1 - x);
      const dz = Math.min(z - f.z0, f.z1 - z);
      if (dx >= 0 && dz >= 0) return Math.min(dx, dz);
      return -Math.hypot(Math.min(0, dx), Math.min(0, dz));
    }
    case 'elipse': {
      const l = local(f, x, z);
      const rho = Math.hypot(l.x / f.rx, l.z / f.rz);
      if (rho < 1e-6) return Math.min(f.rx, f.rz);
      return (Math.hypot(l.x, l.z) / rho) * (1 - rho);
    }
    case 'poligono': {
      const p = f.puntos;
      let d = Infinity;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distanciaSegmento(x, z, p[j], p[i]));
      return dentroPoligono(p, x, z) ? d : -d;
    }
  }
}

export function cajaForma(f: Forma): Caja {
  switch (f.tipo) {
    case 'rect':
      return { x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 };
    case 'elipse': {
      const g = f.giro ?? 0;
      const c = Math.cos(g);
      const s = Math.sin(g);
      const hx = Math.hypot(f.rx * c, f.rz * s);
      const hz = Math.hypot(f.rx * s, f.rz * c);
      return { x0: f.cx - hx, x1: f.cx + hx, z0: f.cz - hz, z1: f.cz + hz };
    }
    case 'poligono': {
      const xs = f.puntos.map((p) => p.x);
      const zs = f.puntos.map((p) => p.z);
      return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    }
  }
}

export function centroForma(f: Forma): PuntoXZ {
  if (f.tipo === 'elipse') return { x: f.cx, z: f.cz };
  if (f.tipo === 'rect') return { x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2 };
  let x = 0;
  let z = 0;
  for (const p of f.puntos) {
    x += p.x;
    z += p.z;
  }
  return { x: x / f.puntos.length, z: z / f.puntos.length };
}

export function areaForma(f: Forma): number {
  switch (f.tipo) {
    case 'rect':
      return (f.x1 - f.x0) * (f.z1 - f.z0);
    case 'elipse':
      return Math.PI * f.rx * f.rz;
    case 'poligono': {
      let a = 0;
      const p = f.puntos;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].z - p[i].x * p[j].z;
      return Math.abs(a) / 2;
    }
  }
}

/** Contorno cerrado (para el mapa y el suelo del bosque). */
export function contorno(f: Forma, n = 48): PuntoXZ[] {
  switch (f.tipo) {
    case 'rect':
      return [
        { x: f.x0, z: f.z0 },
        { x: f.x1, z: f.z0 },
        { x: f.x1, z: f.z1 },
        { x: f.x0, z: f.z1 },
      ];
    case 'elipse': {
      const g = f.giro ?? 0;
      const c = Math.cos(g);
      const s = Math.sin(g);
      const res: PuntoXZ[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const lx = Math.cos(a) * f.rx;
        const lz = Math.sin(a) * f.rz;
        // inversa de `local`: girar −giro
        res.push({ x: f.cx + lx * c + lz * s, z: f.cz - lx * s + lz * c });
      }
      return res;
    }
    case 'poligono':
      return f.puntos.map((p) => ({ ...p }));
  }
}

/**
 * Reparte puntos al azar con una separación mínima (muestreo por rechazo con rejilla hash).
 * `separacion(x, z)` puede variar por punto (troncos gruesos más separados); `admite`
 * filtra (dentro de la forma, fuera del río...). Determinista con el mismo `rng`.
 */
export function muestrear(
  rng: Rng,
  caja: Caja,
  separacion: number,
  admite: (x: number, z: number) => boolean,
  maximo: number,
  intentos = maximo * 30,
): PuntoXZ[] {
  const celda = separacion;
  const ancho = Math.max(1, Math.ceil((caja.x1 - caja.x0) / celda));
  const alto = Math.max(1, Math.ceil((caja.z1 - caja.z0) / celda));
  const rejilla = new Map<number, PuntoXZ[]>();
  const puntos: PuntoXZ[] = [];
  const s2 = separacion * separacion;
  for (let k = 0; k < intentos && puntos.length < maximo; k++) {
    const x = rng.rango(caja.x0, caja.x1);
    const z = rng.rango(caja.z0, caja.z1);
    if (!admite(x, z)) continue;
    const i = Math.min(ancho - 1, Math.floor((x - caja.x0) / celda));
    const j = Math.min(alto - 1, Math.floor((z - caja.z0) / celda));
    let libre = true;
    for (let dj = -1; dj <= 1 && libre; dj++) {
      for (let di = -1; di <= 1 && libre; di++) {
        const vecinos = rejilla.get((j + dj) * ancho + (i + di));
        if (!vecinos) continue;
        for (const v of vecinos) {
          if ((v.x - x) ** 2 + (v.z - z) ** 2 < s2) {
            libre = false;
            break;
          }
        }
      }
    }
    if (!libre) continue;
    const p = { x, z };
    puntos.push(p);
    const clave = j * ancho + i;
    const lista = rejilla.get(clave);
    if (lista) lista.push(p);
    else rejilla.set(clave, [p]);
  }
  return puntos;
}
