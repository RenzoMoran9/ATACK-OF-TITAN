import * as THREE from 'three';
import type { Fisica } from '../core/fisica';
import type { Rng } from '../core/rng';
import { colorear, escalarUV, fusionar } from './geometria';
import { muestrear, type Caja, type PuntoXZ } from './formas';
import type { Materiales } from './materiales';

/**
 * Árboles «normales» (pinos y frondosos de 12–45 m) de los bosques densos y de las
 * arboledas de la llanura, dibujados con InstancedMesh por trozos de 500 m: cada trozo
 * tiene tres mallas (troncos, copas de pino, copas frondosas), así el frustum culling
 * descarta lo que no se ve y los trozos más allá de la niebla se ocultan. Cada tronco
 * lleva un cilindro de colisión (etiqueta 'arbol') para engancharse.
 */

export type TipoArbol = 'pino' | 'frondoso';

export interface ArbolSimple {
  x: number;
  z: number;
  altura: number;
  /** Radio del tronco en la base (m). */
  radio: number;
  tipo: TipoArbol;
  giro: number;
  /** 0–1: variación de color de la copa. */
  tono: number;
}

const TAM_TROZO = 500;

/** Proporción de la altura que ocupa el tronco visible (y su colisionador). */
const TRONCO = { pino: 0.9, frondoso: 0.62 } as const;

interface Trozo {
  centro: THREE.Vector3;
  radio: number;
  mallas: THREE.InstancedMesh[];
}

function geometriaTronco(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 7, 1);
  g.translate(0, 0.5, 0);
  escalarUV(g, 1.3, 4);
  return colorear(g, new THREE.Color(1, 1, 1));
}

/** Pino: cuatro conos apilados (altura total 1). */
function geometriaPino(): THREE.BufferGeometry {
  const pisos = [
    { y: 0.24, alto: 0.34, r: 0.17, luz: 0.78 },
    { y: 0.42, alto: 0.3, r: 0.135, luz: 0.88 },
    { y: 0.58, alto: 0.26, r: 0.1, luz: 0.96 },
    { y: 0.74, alto: 0.26, r: 0.065, luz: 1.05 },
  ];
  const geoms = pisos.map((p) => {
    const c = new THREE.ConeGeometry(p.r, p.alto, 8, 1);
    c.translate(0, p.y + p.alto / 2, 0);
    return colorear(c, new THREE.Color(p.luz, p.luz, p.luz));
  });
  return fusionar(geoms);
}

/** Frondoso: cinco bolas de follaje irregulares alrededor de 0,7 de la altura. */
function geometriaFrondosa(rng: Rng): THREE.BufferGeometry {
  const bolas: THREE.BufferGeometry[] = [];
  const centros = [
    [0, 0.74, 0, 0.19],
    [0.11, 0.66, 0.05, 0.14],
    [-0.1, 0.67, -0.06, 0.14],
    [0.03, 0.66, -0.12, 0.13],
    [-0.04, 0.84, 0.06, 0.12],
  ];
  for (const [x, y, z, r] of centros) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position;
    const semilla = rng.rango(0, 100);
    for (let i = 0; i < pos.count; i++) {
      // deformación según la posición: los vértices repetidos se mueven igual y no se abren grietas
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const f = 1 + 0.15 * Math.sin(vx * 91.7 + vy * 47.3 + vz * 13.1 + semilla);
      pos.setXYZ(i, vx * f, vy * f * 0.8, vz * f);
    }
    g.scale(r, r, r);
    g.translate(x, y, z);
    const luz = 0.8 + (y - 0.6) * 1.2;
    bolas.push(colorear(g, new THREE.Color(luz, luz, luz)));
  }
  const f = fusionar(bolas);
  f.computeVertexNormals();
  return f;
}

export class Vegetacion {
  readonly arboles: readonly ArbolSimple[];
  private readonly trozos: Trozo[] = [];

  constructor(escena: THREE.Scene, fisica: Fisica, mats: Materiales, arboles: ArbolSimple[], rng: Rng) {
    this.arboles = arboles;
    const geoTronco = geometriaTronco();
    const geoPino = geometriaPino();
    const geoFrondosa = geometriaFrondosa(rng);

    const porTrozo = new Map<string, ArbolSimple[]>();
    for (const a of arboles) {
      const clave = `${Math.floor(a.x / TAM_TROZO)},${Math.floor(a.z / TAM_TROZO)}`;
      const lista = porTrozo.get(clave);
      if (lista) lista.push(a);
      else porTrozo.set(clave, [a]);
      const alto = a.altura * TRONCO[a.tipo];
      fisica.cilindro({ x: a.x, y: alto / 2, z: a.z }, alto / 2, a.radio * 0.8 + 0.15, 'arbol');
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const eje = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    for (const lista of porTrozo.values()) {
      const pinos = lista.filter((a) => a.tipo === 'pino');
      const frondosos = lista.filter((a) => a.tipo === 'frondoso');
      const troncos = new THREE.InstancedMesh(geoTronco, mats.corteza, lista.length);
      const copasPino = pinos.length ? new THREE.InstancedMesh(geoPino, mats.hojas, pinos.length) : null;
      const copasFrond = frondosos.length ? new THREE.InstancedMesh(geoFrondosa, mats.hojas, frondosos.length) : null;
      let iP = 0;
      let iF = 0;
      let cx = 0;
      let cz = 0;
      lista.forEach((a, i) => {
        q.setFromAxisAngle(eje, a.giro);
        p.set(a.x, 0, a.z);
        m.compose(p, q, s.set(a.radio, a.altura * TRONCO[a.tipo], a.radio));
        troncos.setMatrixAt(i, m);
        troncos.setColorAt(i, color.setHSL(0.06, 0.25, 0.42 + a.tono * 0.2));
        const ancho = a.altura * (0.9 + a.tono * 0.3);
        m.compose(p, q, s.set(ancho, a.altura, ancho));
        if (a.tipo === 'pino') {
          copasPino!.setMatrixAt(iP, m);
          copasPino!.setColorAt(iP++, color.setHSL(0.3 + a.tono * 0.05, 0.38, 0.16 + a.tono * 0.06));
        } else {
          copasFrond!.setMatrixAt(iF, m);
          // algún frondoso amarillea: le da variedad al verde
          const otono = a.tono > 0.9;
          copasFrond!.setColorAt(iF++, color.setHSL(otono ? 0.13 : 0.23 + a.tono * 0.06, otono ? 0.5 : 0.42, 0.2 + a.tono * 0.07));
        }
        cx += a.x;
        cz += a.z;
      });
      const centro = new THREE.Vector3(cx / lista.length, 0, cz / lista.length);
      let radio = 0;
      for (const a of lista) radio = Math.max(radio, Math.hypot(a.x - centro.x, a.z - centro.z) + a.altura * 0.3);
      const mallas: THREE.InstancedMesh[] = [troncos];
      if (copasPino) mallas.push(copasPino);
      if (copasFrond) mallas.push(copasFrond);
      for (const malla of mallas) {
        malla.castShadow = true;
        malla.receiveShadow = true;
        malla.instanceMatrix.needsUpdate = true;
        if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
        malla.computeBoundingSphere();
        escena.add(malla);
      }
      this.trozos.push({ centro, radio, mallas });
    }
  }

  /** Oculta los trozos que quedan enteros más allá de `lejos` (la niebla ya los borra). */
  actualizar(cam: THREE.Vector3, lejos: number): void {
    for (const t of this.trozos) {
      const d = Math.hypot(t.centro.x - cam.x, t.centro.z - cam.z) - t.radio;
      const visible = d < lejos;
      for (const m of t.mallas) m.visible = visible;
    }
  }
}

/**
 * Árboles de un bosque denso dentro de una forma: separación mínima, mezcla de pinos y
 * frondosos según `pinos` (0–1) y alturas en `alturas`.
 */
export function arbolesDeBosque(
  rng: Rng,
  caja: Caja,
  admite: (x: number, z: number) => boolean,
  opciones: { maximo: number; separacion: number; alturas: [number, number]; pinos: number },
): ArbolSimple[] {
  return muestrear(rng, caja, opciones.separacion, admite, opciones.maximo).map((p) => nuevoArbol(rng, p, opciones.alturas, rng.siguiente() < opciones.pinos ? 'pino' : 'frondoso'));
}

function nuevoArbol(rng: Rng, p: PuntoXZ, alturas: [number, number], tipo: TipoArbol): ArbolSimple {
  const altura = rng.rango(alturas[0], alturas[1]);
  return { x: p.x, z: p.z, altura, radio: altura * rng.rango(0.02, 0.028) + 0.15, tipo, giro: rng.rango(0, Math.PI * 2), tono: rng.siguiente() };
}

/**
 * Arboledas y árboles sueltos por la llanura: `grupos` corros de 5–18 árboles y
 * `sueltos` árboles aislados, todos donde `admite` lo permita.
 */
export function arbolesDispersos(rng: Rng, caja: Caja, admite: (x: number, z: number) => boolean, grupos: number, sueltos: number): ArbolSimple[] {
  const res: ArbolSimple[] = [];
  const centros = muestrear(rng, caja, 160, admite, grupos);
  for (const c of centros) {
    const radio = rng.rango(18, 55);
    const pinos = rng.siguiente() < 0.4 ? 0.8 : 0.15;
    const n = rng.entero(5, 18);
    const cajaGrupo = { x0: c.x - radio, x1: c.x + radio, z0: c.z - radio, z1: c.z + radio };
    const dentro = (x: number, z: number) => Math.hypot(x - c.x, z - c.z) <= radio && admite(x, z);
    for (const p of muestrear(rng, cajaGrupo, 8, dentro, n, n * 20)) res.push(nuevoArbol(rng, p, [14, 32], rng.siguiente() < pinos ? 'pino' : 'frondoso'));
  }
  const lejosDeGrupos = (x: number, z: number) => admite(x, z) && centros.every((c) => Math.hypot(x - c.x, z - c.z) > 70);
  for (const p of muestrear(rng, caja, 45, lejosDeGrupos, sueltos)) res.push(nuevoArbol(rng, p, [12, 28], rng.siguiente() < 0.3 ? 'pino' : 'frondoso'));
  return res;
}
