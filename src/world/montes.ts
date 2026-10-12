import * as THREE from 'three';
import { crearRng } from '../core/rng';
import type { Caja } from './formas';

/**
 * Fondo lejano: un anillo de montes y colinas low-poly alrededor de la región jugable,
 * a partir de 450 m del borde, para que el horizonte no se vea vacío. Una sola malla con
 * color por vértice (hierba abajo, roca arriba) que la niebla de la escena va apagando.
 */

const SEGMENTOS = 200;
/** Distancia al borde de la región de cada anillo (m) y fracción de la altura del pico. */
const ANILLOS: [number, number][] = [
  [450, 0],
  [620, 0.3],
  [850, 0.7],
  [1150, 1],
  [1500, 0.85],
  [2000, 0.55],
];

/** Distancia del centro de la caja a su borde en la dirección (dx, dz) unitaria. */
function distanciaBorde(c: Caja, cx: number, cz: number, dx: number, dz: number): number {
  const tx = dx > 1e-9 ? (c.x1 - cx) / dx : dx < -1e-9 ? (c.x0 - cx) / dx : Infinity;
  const tz = dz > 1e-9 ? (c.z1 - cz) / dz : dz < -1e-9 ? (c.z0 - cz) / dz : Infinity;
  return Math.min(tx, tz);
}

export function construirMontes(escena: THREE.Scene, region: Caja, semilla: number): THREE.Mesh {
  const rng = crearRng(semilla);
  const cx = (region.x0 + region.x1) / 2;
  const cz = (region.z0 + region.z1) / 2;
  const fases = [rng.rango(0, 6), rng.rango(0, 6), rng.rango(0, 6)];
  const pos: number[] = [];
  const col: number[] = [];
  const hierba = new THREE.Color('#5f6d46');
  const roca = new THREE.Color('#7b7566');
  const cumbre = new THREE.Color('#a9a79f');
  const c = new THREE.Color();
  for (let k = 0; k < SEGMENTOS; k++) {
    const a = (k / SEGMENTOS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const borde = distanciaBorde(region, cx, cz, dx, dz);
    // perfil de cumbres: ondas lentas + rápidas, entre ~120 y ~480 m
    const onda = 0.5 + 0.25 * Math.sin(a * 3 + fases[0]) + 0.15 * Math.sin(a * 7 + fases[1]) + 0.1 * Math.sin(a * 17 + fases[2]);
    const pico = 120 + 360 * THREE.MathUtils.clamp(onda, 0, 1);
    for (const [dist, frac] of ANILLOS) {
      const r = borde + dist + rng.rango(-60, 60) * (frac > 0 ? 1 : 0);
      const h = frac === 0 ? -2 : pico * frac * rng.rango(0.75, 1.15);
      pos.push(cx + dx * r, h, cz + dz * r);
      const t = h / 480;
      c.copy(hierba).lerp(roca, THREE.MathUtils.clamp(t * 2.2, 0, 1));
      if (t > 0.6) c.lerp(cumbre, THREE.MathUtils.clamp((t - 0.6) * 3, 0, 1));
      col.push(c.r, c.g, c.b);
    }
  }
  const n = ANILLOS.length;
  const idx: number[] = [];
  for (let k = 0; k < SEGMENTOS; k++) {
    const k2 = (k + 1) % SEGMENTOS;
    for (let r = 0; r < n - 1; r++) {
      const a = k * n + r;
      const b = k2 * n + r;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const montes = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  escena.add(montes);
  return montes;
}
