import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Utilidades de geometría: cajas con UV en metros (para que las texturas tengan
 * escala real), tejados a dos aguas, color por vértice y fusión en un solo mesh.
 */

/** Caja centrada en el origen con UV en metros / tamaño de mosaico. `baseV` alinea las plantas. */
export function cajaUV(ancho: number, alto: number, fondo: number, mosaicoU: number, mosaicoV = mosaicoU, baseV = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(ancho, alto, fondo);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.5) {
      uv.setXY(i, (x + ancho / 2) / mosaicoU, (z + fondo / 2) / mosaicoV);
    } else if (nx > 0.5) {
      uv.setXY(i, (z + fondo / 2) / mosaicoU, (y + alto / 2 + baseV) / mosaicoV);
    } else {
      uv.setXY(i, (x + ancho / 2) / mosaicoU, (y + alto / 2 + baseV) / mosaicoV);
    }
  }
  return g;
}

/**
 * Tejado a dos aguas con la cumbrera a lo largo de X. La base (alero) está en y=0.
 * Devuelve los faldones (material de teja) y los hastiales triangulares (material de fachada).
 */
export function tejadoDosAguas(ancho: number, fondo: number, alturaCumbrera: number, alero: number, mosaicoFachada: { u: number; v: number; baseV: number }) {
  const mx = ancho / 2 + alero;
  const mz = fondo / 2;
  const pendiente = alturaCumbrera / mz;
  const zAlero = mz + alero;
  const yAlero = -alero * pendiente;
  const largoFaldon = Math.hypot(zAlero, alturaCumbrera - yAlero);

  const p: number[] = [];
  const u: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], uvs: number[][]) => {
    p.push(...a, ...b, ...c, ...a, ...c, ...d);
    u.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
  };
  const m = 2; // mosaico de teja: 2 m
  // faldón +Z (orden antihorario visto desde fuera)
  quad([-mx, yAlero, zAlero], [mx, yAlero, zAlero], [mx, alturaCumbrera, 0], [-mx, alturaCumbrera, 0], [
    [0, 0], [(2 * mx) / m, 0], [(2 * mx) / m, largoFaldon / m], [0, largoFaldon / m],
  ]);
  // faldón -Z
  quad([mx, yAlero, -zAlero], [-mx, yAlero, -zAlero], [-mx, alturaCumbrera, 0], [mx, alturaCumbrera, 0], [
    [0, 0], [(2 * mx) / m, 0], [(2 * mx) / m, largoFaldon / m], [0, largoFaldon / m],
  ]);
  const faldones = new THREE.BufferGeometry();
  faldones.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  faldones.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  faldones.computeVertexNormals();

  // Hastiales (triángulos en x = ±ancho/2)
  const hp: number[] = [];
  const hu: number[] = [];
  const ax = ancho / 2;
  const tri = (x: number, sentido: number) => {
    const pts = sentido > 0
      ? [[x, 0, -mz], [x, alturaCumbrera, 0], [x, 0, mz]]
      : [[x, 0, mz], [x, alturaCumbrera, 0], [x, 0, -mz]];
    for (const q of pts) {
      hp.push(...q);
      hu.push((q[2] + mz) / mosaicoFachada.u, (q[1] + mosaicoFachada.baseV) / mosaicoFachada.v);
    }
  };
  tri(ax, 1);
  tri(-ax, -1);
  const hastiales = new THREE.BufferGeometry();
  hastiales.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  hastiales.setAttribute('uv', new THREE.Float32BufferAttribute(hu, 2));
  hastiales.computeVertexNormals();

  // Puntos para el colisionador convexo (incluye el alero)
  const casco = [
    [-mx, yAlero, zAlero], [mx, yAlero, zAlero], [-mx, yAlero, -zAlero], [mx, yAlero, -zAlero],
    [-mx, alturaCumbrera, 0], [mx, alturaCumbrera, 0],
  ];
  return { faldones, hastiales, casco };
}

/** Añade/llena el atributo `color` (necesario para fusionar con vertexColors). */
export function colorear(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Normaliza (sin índice, con uv y color) y fusiona en una sola geometría. */
export function fusionar(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const listas = geoms.map((g) => {
    let r = g.index ? g.toNonIndexed() : g;
    if (!r.attributes.uv) {
      r.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(r.attributes.position.count * 2), 2));
    }
    if (!r.attributes.color) r = colorear(r, new THREE.Color(1, 1, 1));
    if (!r.attributes.normal) r.computeVertexNormals();
    for (const nombre of Object.keys(r.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(nombre)) r.deleteAttribute(nombre);
    }
    r.clearGroups();
    return r;
  });
  const fusion = mergeGeometries(listas, false);
  if (!fusion) throw new Error('No se pudo fusionar la geometría');
  fusion.computeBoundingSphere();
  return fusion;
}

/** Escala las UV de una geometría (para cilindros de tamaño variable con textura en metros). */
export function escalarUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Acumulador de geometrías por material, que al final crea un mesh por material. */
export class Lote {
  private geoms: THREE.BufferGeometry[] = [];

  añadir(g: THREE.BufferGeometry, matriz?: THREE.Matrix4, color?: THREE.Color): void {
    if (color) colorear(g, color);
    if (matriz) g.applyMatrix4(matriz);
    this.geoms.push(g);
  }

  get vacio(): boolean {
    return this.geoms.length === 0;
  }

  crearMesh(material: THREE.Material, sombras = true): THREE.Mesh {
    const mesh = new THREE.Mesh(fusionar(this.geoms), material);
    mesh.castShadow = sombras;
    mesh.receiveShadow = true;
    this.geoms = [];
    return mesh;
  }
}

export const matriz = (x: number, y: number, z: number, rotY = 0, rot?: THREE.Quaternion): THREE.Matrix4 => {
  const q = rot ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
};
