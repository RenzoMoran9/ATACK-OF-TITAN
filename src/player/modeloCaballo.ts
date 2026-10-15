import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Caballo modelado en 3D: «Caballo» de Roberto Domínguez (https://sketchfab.com/vmmaniac),
 * licencia CC BY 4.0 — https://sketchfab.com/3d-models/caballo-aa979384c5c04f1281df5e4ab006f17d
 * (convertido a metal-rugosidad, texturas en WebP de 1k y simplificado a ~20 000 triángulos:
 * public/modelos/caballo.glb).
 *
 * El modelo es estático (sin huesos ni animaciones), así que las patas se doblan en el shader:
 * cada vértice por debajo del vientre pertenece a una pata según su cuadrante (delante/detrás,
 * izquierda/derecha) y gira alrededor del hombro o la cadera, y lo que queda por debajo de la
 * rodilla gira además alrededor de ella. Los ángulos de las cuatro patas llegan como uniforms.
 *
 * Hay muchos caballos (el del jugador y uno por soldado): la geometría se lee una vez y cada
 * caballo recibe su propio juego de materiales y uniforms de patas, para que cada uno galope
 * a su aire sin copiar los vértices.
 */

const URL_MODELO = './modelos/caballo.glb';
/** Altura de la cruz (lomo) a la que se escala el modelo, en metros. */
const ALTURA_LOMO = 1.6;

export interface ModeloCaballo {
  /** Mallas ya orientadas (+Z hacia delante), escaladas y con los pies en y = 0. */
  grupo: THREE.Group;
  /** Altura del lomo donde va la silla. */
  lomo: number;
  /** Altura de la articulación del hombro y la cadera (de ahí cuelga y gira cada pata). */
  pivote: number;
  /** Altura de la rodilla (y largo de la caña hasta el casco). */
  rodilla: number;
  /** Ángulos de muslo y caña por pata: [delantera izq, delantera der, trasera izq, trasera der]. */
  posar(muslo: readonly number[], cana: readonly number[]): void;
}

/** El modelo leído una vez: de aquí salen los caballos que hagan falta. */
export interface PlantillaCaballo {
  instanciar(): ModeloCaballo;
}

interface Patas {
  uMuslo: { value: THREE.Vector4 };
  uCana: { value: THREE.Vector4 };
}

let cargando: Promise<PlantillaCaballo> | null = null;

/** Carga el modelo una sola vez para todos los caballos del juego. */
export function cargarModeloCaballo(): Promise<PlantillaCaballo> {
  cargando ??= new GLTFLoader().loadAsync(URL_MODELO).then(prepararGLTF);
  return cargando;
}

function prepararGLTF(gltf: { scene: THREE.Object3D }): PlantillaCaballo {
  const escena = gltf.scene;
  escena.updateMatrixWorld(true);
  const mallas: THREE.Mesh[] = [];
  escena.traverse((o) => {
    if (o instanceof THREE.Mesh) mallas.push(o);
  });
  // geometría en espacio del modelo (metros); el original mira hacia −X
  const geos = mallas.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
  const giro = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  for (const g of geos) g.applyMatrix4(giro);
  // el cuerpo (no la crin ni la cola) es la malla con mapa de normales
  const iCuerpo = Math.max(0, mallas.findIndex((m) => !!(m.material as THREE.MeshStandardMaterial).normalMap));
  const pos = geos[iCuerpo].getAttribute('position') as THREE.BufferAttribute;
  // cascos: centran el caballo; lomo: lo más alto del tronco a media espalda
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.15) continue;
    cx += pos.getX(i);
    cz += pos.getZ(i);
    n++;
  }
  cx /= Math.max(1, n);
  cz /= Math.max(1, n);
  // centro de los cascos delanteros y traseros: el eje de giro de cada par de patas
  const pares = { del: { z: 0, n: 0 }, tras: { z: 0, n: 0 } };
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.15) continue;
    const par = pos.getZ(i) > cz ? pares.del : pares.tras;
    par.z += pos.getZ(i);
    par.n++;
  }
  let lomo = 0;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - cz) < 0.25) lomo = Math.max(lomo, pos.getY(i));
  const s = ALTURA_LOMO / Math.max(0.1, lomo);
  const ajuste = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));
  for (const g of geos) {
    g.applyMatrix4(ajuste);
    g.computeBoundingSphere();
  }
  // vientre: lo más bajo del tronco entre las patas (por encima de las rodillas)
  const p2 = geos[iCuerpo].getAttribute('position') as THREE.BufferAttribute;
  let vientre = Infinity;
  for (let i = 0; i < p2.count; i++) {
    const y = p2.getY(i);
    if (Math.abs(p2.getZ(i)) < 0.15 && Math.abs(p2.getX(i)) < 0.12 && y > 0.6) vientre = Math.min(vientre, y);
  }
  if (!Number.isFinite(vientre)) vientre = 0.75 * ALTURA_LOMO;
  const zDel = (pares.del.z / Math.max(1, pares.del.n) - cz) * s;
  const zTras = (pares.tras.z / Math.max(1, pares.tras.n) - cz) * s;

  // las patas giran desde la escápula y la cadera, bastante por encima del vientre
  const parametros = { vientre, pivote: vientre + 0.4, rodilla: vientre * 0.48, zDel, zTras };
  const instanciar = (): ModeloCaballo => {
    const grupo = new THREE.Group();
    const patas: Patas = { uMuslo: { value: new THREE.Vector4() }, uCana: { value: new THREE.Vector4() } };
    mallas.forEach((m, i) => {
      const original = m.material as THREE.MeshStandardMaterial;
      const cuerpo = i === iCuerpo;
      // Lambert: barato en el celular y con la misma lectura que el resto del mundo
      const mat = new THREE.MeshLambertMaterial({
        map: original.map,
        normalMap: original.normalMap,
        side: THREE.DoubleSide,
        // pelo de la crin y la cola: recorte en vez de transparencia (sin problemas de orden)
        alphaTest: cuerpo ? 0 : 0.45,
        transparent: false,
      });
      if (cuerpo) doblarPatas(mat, patas, parametros);
      const malla = new THREE.Mesh(geos[i], mat);
      malla.castShadow = true;
      malla.receiveShadow = true;
      if (cuerpo) {
        const profundidad = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        doblarPatas(profundidad, patas, parametros);
        malla.customDepthMaterial = profundidad;
      }
      grupo.add(malla);
    });
    return {
      grupo,
      lomo: ALTURA_LOMO,
      pivote: parametros.pivote,
      rodilla: parametros.rodilla,
      posar(muslo, cana) {
        patas.uMuslo.value.set(muslo[0], muslo[1], muslo[2], muslo[3]);
        patas.uCana.value.set(cana[0], cana[1], cana[2], cana[3]);
      },
    };
  };
  return { instanciar };
}

/** Inyecta en el shader el giro de cada pata (también en la normal, para que la luz acompañe). */
function doblarPatas(mat: THREE.Material, patas: Patas, p: { vientre: number; pivote: number; rodilla: number; zDel: number; zTras: number }): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMuslo = patas.uMuslo;
    sh.uniforms.uCana = patas.uCana;
    const f = (x: number) => x.toFixed(4);
    const comun = /* glsl */ `
uniform vec4 uMuslo;
uniform vec4 uCana;
// gira (y, z) alrededor del eje lateral X por encima de un pivote
vec3 girarX(vec3 v, float a, float py, float pz) {
  float c = cos(a), s = sin(a);
  vec2 q = vec2(v.y - py, v.z - pz);
  q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  return vec3(v.x, q.x + py, q.y + pz);
}
// ángulos (muslo, caña) de la pata a la que pertenece el punto y cuánto le afecta
vec3 pataDe(vec3 p) {
  bool delantera = p.z > 0.0;
  int i = (delantera ? 0 : 2) + (p.x > 0.0 ? 0 : 1);
  float muslo = i == 0 ? uMuslo.x : i == 1 ? uMuslo.y : i == 2 ? uMuslo.z : uMuslo.w;
  float cana = i == 0 ? uCana.x : i == 1 ? uCana.y : i == 2 ? uCana.z : uCana.w;
  float peso = 1.0 - smoothstep(${f(p.vientre - 0.3)}, ${f(p.vientre + 0.05)}, p.y);
  return vec3(muslo * peso, cana * (1.0 - smoothstep(${f(p.rodilla - 0.08)}, ${f(p.rodilla + 0.08)}, p.y)) * peso, delantera ? ${f(p.zDel)} : ${f(p.zTras)});
}
vec3 doblar(vec3 p) {
  vec3 a = pataDe(p);
  if (a.x == 0.0 && a.y == 0.0) return p;
  p = girarX(p, a.y, ${f(p.rodilla)}, a.z);
  return girarX(p, a.x, ${f(p.pivote)}, a.z);
}
`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + comun)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ vec3 a = pataDe(position); objectNormal = girarX(objectNormal, a.x + a.y, 0.0, 0.0); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = doblar(transformed);');
  };
}
