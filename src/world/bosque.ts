import * as THREE from 'three';
import type { Hora } from '../core/depuracion';
import type { Fisica } from '../core/fisica';
import type { Rng } from '../core/rng';
import { areaForma, cajaForma, centroForma, contiene, contorno, distanciaBorde, type Caja, type Forma } from './formas';
import { Lote, escalarUV, matriz } from './geometria';
import type { Materiales } from './materiales';
import { texturaParticula } from './texturas';
import { arbolesDeBosque, type ArbolSimple } from './vegetacion';

/**
 * Bosques del mundo abierto, la zona más peligrosa del juego. Dos clases:
 *  - 'gigante': árboles de 80–90 m (troncos rojizos muy gruesos, ramas horizontales anchas y
 *    transitables, copas altas). Un lote de corteza y otro de hojas por trozo de 200 m.
 *  - 'normal': pinos y frondosos de 25–45 m, mucho más juntos; se dibujan instanciados en
 *    Vegetacion (aquí solo se reparten y se devuelven en `normales`).
 * Todos con suelo oscuro, bancos de bruma baja (un InstancedMesh de carteles por bosque) y,
 * los gigantes, haces de luz entre las copas. La forma (rectángulo, elipse o polígono) decide
 * qué está dentro: lo usan el poblador de titanes, el ambiente oscuro y el mapa.
 */

export interface Arbol {
  x: number;
  z: number;
  altura: number;
  radio: number;
  ramas: { inicio: THREE.Vector3; fin: THREE.Vector3; radio: number }[];
}

export interface DatosBosque {
  /** Árboles gigantes (vacío en los bosques normales). */
  arboles: Arbol[];
  centro: THREE.Vector3;
  limites: Caja;
}

export type TipoBosque = 'gigante' | 'normal';

export interface OpcionesBosque {
  nombre: string;
  forma: Forma;
  tipo: TipoBosque;
  /** Máximo de árboles. */
  arboles: number;
  /** Alturas mínima y máxima (m). */
  alturas: [number, number];
  /** Separación mínima entre troncos de los bosques normales (m). */
  separacion?: number;
  /** Fracción de pinos (bosques normales). */
  pinos?: number;
  /** Peligro de 1 (llanura) a 3; los bosques van de 2,5 a 3. */
  peligro: number;
  /** Zonas sin árboles dentro de la forma (entrada del camino, orilla del río…). */
  excluir?: (x: number, z: number) => boolean;
}

const TAM_TROZO = 200;

const HAZ_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vVistaV;
varying vec2 vUv;
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
  #else
  mat4 m = modelMatrix;
  #endif
  vec4 mv = viewMatrix * m * vec4(position, 1.0);
  // normales con escala no uniforme: dividir por la escala al cuadrado de cada eje equivale
  // a la inversa transpuesta (rotación por escala) y mantiene la normal perpendicular
  vec3 s2 = vec3(dot(m[0].xyz, m[0].xyz), dot(m[1].xyz, m[1].xyz), dot(m[2].xyz, m[2].xyz));
  vNormalV = normalize(mat3(viewMatrix) * (mat3(m) * (normal / s2)));
  vVistaV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const HAZ_FRAG = /* glsl */ `
uniform vec3 color;
uniform float intensidad;
varying vec3 vNormalV;
varying vec3 vVistaV;
varying vec2 vUv;
void main() {
  float borde = abs(dot(normalize(vNormalV), normalize(vVistaV)));
  float a = pow(borde, 2.5) * intensidad;
  a *= smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
  gl_FragColor = vec4(color, a);
}`;

/** Cartel siempre de cara a la cámara, instanciado (como un Sprite, pero una llamada por bosque). */
const NIEBLA_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 escala = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  mvPosition.xy += position.xy * escala;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const NIEBLA_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D map;
uniform vec3 color;
uniform float opacidad;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(color, opacidad) * texture2D(map, vUv);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

let matHaz: THREE.ShaderMaterial | null = null;
let matNiebla: THREE.ShaderMaterial | null = null;

function materialHaz(): THREE.ShaderMaterial {
  matHaz ??= new THREE.ShaderMaterial({
    vertexShader: HAZ_VERT,
    fragmentShader: HAZ_FRAG,
    uniforms: { color: { value: new THREE.Color('#fff1c9') }, intensidad: { value: 0.28 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  return matHaz;
}

function materialNiebla(): THREE.ShaderMaterial {
  if (!matNiebla) {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.map = { value: texturaParticula() };
    uniforms.color = { value: new THREE.Color('#d5dde3') };
    uniforms.opacidad = { value: 0.2 };
    matNiebla = new THREE.ShaderMaterial({ vertexShader: NIEBLA_VERT, fragmentShader: NIEBLA_FRAG, uniforms, transparent: true, depthWrite: false, fog: true });
  }
  return matNiebla;
}

export class Bosque {
  readonly nombre: string;
  readonly tipo: TipoBosque;
  readonly forma: Forma;
  readonly peligro: number;
  readonly centro: THREE.Vector3;
  readonly datos: DatosBosque;
  /** Árboles normales del bosque (los dibuja Vegetacion). */
  readonly normales: ArbolSimple[];
  /** Altura aproximada de las copas: por encima ya no se está «dentro» del bosque. */
  readonly alturaCopa: number;
  private haces: THREE.InstancedMesh | null = null;
  private readonly basesHaz: { x: number; z: number; r: number }[] = [];

  constructor(escena: THREE.Scene, fisica: Fisica, mats: Materiales, rng: Rng, o: OpcionesBosque) {
    this.nombre = o.nombre;
    this.tipo = o.tipo;
    this.forma = o.forma;
    this.peligro = o.peligro;
    const limites = cajaForma(o.forma);
    const c = centroForma(o.forma);
    this.centro = new THREE.Vector3(c.x, 0, c.z);
    this.alturaCopa = o.alturas[1];
    const arboles: Arbol[] = [];

    if (o.tipo === 'gigante') {
      const lotes = new Map<string, { corteza: Lote; hojas: Lote }>();
      for (let intento = 0; intento < 8000 && arboles.length < o.arboles; intento++) {
        const x = rng.rango(limites.x0 + 15, limites.x1 - 15);
        const z = rng.rango(limites.z0 + 15, limites.z1 - 15);
        if (o.forma.tipo !== 'rect' && distanciaBorde(o.forma, x, z) < 12) continue;
        if (o.excluir?.(x, z)) continue;
        if (arboles.some((a) => Math.hypot(a.x - x, a.z - z) < 27 + (a.radio - 4))) continue;
        const clave = `${Math.floor((x - limites.x0) / TAM_TROZO)},${Math.floor((z - limites.z0) / TAM_TROZO)}`;
        let lote = lotes.get(clave);
        if (!lote) lotes.set(clave, (lote = { corteza: new Lote(), hojas: new Lote() }));
        arboles.push(this.construirArbol(x, z, o.alturas, rng, lote.corteza, lote.hojas, fisica));
      }
      for (const l of lotes.values()) escena.add(l.corteza.crearMesh(mats.corteza), l.hojas.crearMesh(mats.hojas));
      this.normales = [];
    } else {
      const admite = (x: number, z: number) => distanciaBorde(o.forma, x, z) > 4 && !o.excluir?.(x, z);
      this.normales = arbolesDeBosque(rng, limites, admite, { maximo: o.arboles, separacion: o.separacion ?? 10, alturas: o.alturas, pinos: o.pinos ?? 0.5 });
    }

    escena.add(this.crearSuelo(mats, limites));
    this.crearNiebla(escena, rng, limites);
    if (o.tipo === 'gigante') this.crearHaces(escena, rng, limites);
    this.datos = { arboles, centro: this.centro, limites };
  }

  get numArboles(): number {
    return this.datos.arboles.length + this.normales.length;
  }

  contiene(x: number, z: number): boolean {
    return contiene(this.forma, x, z);
  }

  /** Metros desde el borde hacia dentro (negativo fuera). */
  profundidad(x: number, z: number): number {
    return distanciaBorde(this.forma, x, z);
  }

  /** Suelo oscuro de hojarasca algo más ancho que el bosque. */
  private crearSuelo(mats: Materiales, limites: Caja): THREE.Mesh {
    let geo: THREE.BufferGeometry;
    if (this.forma.tipo === 'rect') {
      const ancho = limites.x1 - limites.x0 + 60;
      const fondo = limites.z1 - limites.z0 + 60;
      geo = new THREE.CircleGeometry(0.5, 40);
      geo.scale(ancho, fondo, 1);
      escalarUV(geo, ancho / 20, fondo / 20);
      geo.translate(this.centro.x, -this.centro.z, 0);
    } else {
      const c = this.centro;
      const forma = new THREE.Shape(contorno(this.forma, 56).map((p) => {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.hypot(dx, dz) || 1;
        return new THREE.Vector2(p.x + (dx / d) * 25, -(p.z + (dz / d) * 25));
      }));
      geo = new THREE.ShapeGeometry(forma, 4);
      escalarUV(geo, 1 / 20, 1 / 20);
    }
    geo.rotateX(-Math.PI / 2);
    const suelo = new THREE.Mesh(geo, mats.sueloBosque);
    suelo.position.y = 0.03;
    suelo.receiveShadow = true;
    return suelo;
  }

  /** Bancos de bruma pegados al suelo entre los troncos. */
  private crearNiebla(escena: THREE.Scene, rng: Rng, limites: Caja): void {
    const n = this.forma.tipo === 'rect' ? 110 : Math.min(220, Math.round(areaForma(this.forma) / 1800));
    const bancos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), materialNiebla(), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const ancho = rng.rango(30, 60);
      s.set(ancho, ancho * rng.rango(0.18, 0.28), 1);
      p.set(rng.rango(limites.x0, limites.x1), rng.rango(1.5, 4), rng.rango(limites.z0, limites.z1));
      for (let k = 0; k < 20 && !this.contiene(p.x, p.z); k++) p.set(rng.rango(limites.x0, limites.x1), p.y, rng.rango(limites.z0, limites.z1));
      bancos.setMatrixAt(i, m.compose(p, q, s));
    }
    bancos.computeBoundingSphere();
    bancos.renderOrder = 2;
    escena.add(bancos);
  }

  /** Haces de luz entre las copas (se orientan con el sol en `ajustarHora`). */
  private crearHaces(escena: THREE.Scene, rng: Rng, limites: Caja): void {
    const n = this.forma.tipo === 'rect' ? 34 : Math.min(50, Math.round(areaForma(this.forma) / 6000));
    for (let i = 0; i < n; i++) {
      rng.rango(1.5, 3.5); // radio superior: la geometría compartida usa una proporción fija
      const r = rng.rango(4, 8);
      let x = rng.rango(limites.x0 + 40, limites.x1 - 40);
      let z = rng.rango(limites.z0 + 30, limites.z1 - 30);
      for (let k = 0; k < 20 && this.profundidad(x, z) < 30; k++) {
        x = rng.rango(limites.x0 + 40, limites.x1 - 40);
        z = rng.rango(limites.z0 + 30, limites.z1 - 30);
      }
      this.basesHaz.push({ x, z, r });
    }
    this.haces = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 1, 1, 20, 1, true), materialHaz(), n);
    this.haces.renderOrder = 3;
    escena.add(this.haces);
  }

  private construirArbol(x: number, z: number, alturas: [number, number], rng: Rng, corteza: Lote, hojas: Lote, fisica: Fisica): Arbol {
    const altura = rng.rango(alturas[0], alturas[1]);
    const r0 = rng.rango(4, 7.5);
    const r1 = r0 * 0.42;
    const altoTronco = altura * 0.8;
    const tinte = new THREE.Color().setHSL(rng.rango(0.02, 0.05), rng.rango(0.3, 0.5), rng.rango(0.75, 0.95));
    const radioA = (h: number) => r0 + (r1 - r0) * (h / altoTronco);

    const tronco = new THREE.CylinderGeometry(r1, r0, altoTronco, 16, 8);
    escalarUV(tronco, (2 * Math.PI * r0) / 4, altoTronco / 8);
    const giroTronco = rng.rango(0, 6);
    corteza.añadir(tronco, matriz(x, altoTronco / 2, z, giroTronco), tinte);
    const raices = new THREE.CylinderGeometry(r0, r0 * 1.75, 7, 16, 1);
    escalarUV(raices, (2 * Math.PI * r0) / 4, 7 / 8);
    corteza.añadir(raices, matriz(x, 3.5, z), tinte.clone().multiplyScalar(0.85));
    // Colisionadores con la silueta de la malla: tronco y raíces por separado (la unión no es convexa)
    fisica.troncoConico(x, z, 0, altoTronco, r0, r1, 16, giroTronco, 'arbol');
    fisica.troncoConico(x, z, 0, 7, r0 * 1.75, r0, 16, 0, 'arbol');

    const ramas: Arbol['ramas'] = [];
    const nRamas = rng.entero(4, 6);
    const giro0 = rng.rango(0, Math.PI * 2);
    for (let k = 0; k < nRamas; k++) {
      const h = rng.rango(26, 64);
      const ang = giro0 + (k / nRamas) * Math.PI * 2 + rng.rango(-0.4, 0.4);
      const largo = rng.rango(14, 26);
      const rb = rng.rango(1.3, 2.0);
      const elev = THREE.MathUtils.degToRad(rng.rango(2, 9));
      const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(elev), Math.sin(elev), Math.sin(ang) * Math.cos(elev));
      const inicio = new THREE.Vector3(x, h, z).addScaledVector(dir, radioA(h) * 0.7);
      const fin = inicio.clone().addScaledVector(dir, largo);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const medio = inicio.clone().lerp(fin, 0.5);
      const geo = new THREE.CylinderGeometry(rb * 0.35, rb, largo, 10, 3);
      escalarUV(geo, (2 * Math.PI * rb) / 4, largo / 8);
      corteza.añadir(geo, matriz(medio.x, medio.y, medio.z, 0, q), tinte.clone().multiplyScalar(0.92));
      fisica.capsula(medio, largo / 2 - rb * 0.6, rb * 0.75, 'rama', q);
      ramas.push({ inicio, fin, radio: rb });
      // Almohadilla de hojas al final de la rama
      this.mata(hojas, fin.x, fin.y + 2.5, fin.z, rng.rango(6, 10), rng);
    }
    // Copa alta
    const nCopa = rng.entero(6, 8);
    for (let k = 0; k < nCopa; k++) {
      const ang = rng.rango(0, Math.PI * 2);
      const d = rng.rango(4, 16);
      this.mata(hojas, x + Math.cos(ang) * d, rng.rango(altura - 24, altura - 4), z + Math.sin(ang) * d, rng.rango(13, 20), rng);
    }
    return { x, z, altura, radio: r0, ramas };
  }

  private mata(hojas: Lote, x: number, y: number, z: number, r: number, rng: Rng): void {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const f = 1 + rng.rango(-0.12, 0.12);
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
    }
    g.scale(r, r * rng.rango(0.45, 0.6), r * rng.rango(0.85, 1.15));
    g.computeVertexNormals();
    const color = new THREE.Color().setHSL(rng.rango(0.25, 0.32), rng.rango(0.3, 0.45), rng.rango(0.16, 0.24));
    hojas.añadir(g, matriz(x, y, z, rng.rango(0, 6)), color);
  }

  /** Orienta los haces según el sol y ajusta niebla y luz a la hora. */
  ajustarHora(hora: Hora, dirSol: THREE.Vector3): void {
    const u = materialHaz().uniforms;
    u.intensidad.value = hora === 'dia' ? 0.28 : hora === 'atardecer' ? 0.2 : 0;
    (u.color.value as THREE.Color).set(hora === 'atardecer' ? '#ffb070' : '#fff1c9');
    const un = materialNiebla().uniforms;
    (un.color.value as THREE.Color).set(hora === 'dia' ? '#d5dde3' : hora === 'atardecer' ? '#d8b391' : '#26324d');
    un.opacidad.value = hora === 'noche' ? 0.12 : 0.2;
    const haces = this.haces;
    if (!haces) return;
    haces.visible = hora !== 'noche';
    const dir = dirSol.clone();
    if (dir.y < 0.35) dir.y = 0.35; // al atardecer, que no queden casi horizontales
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const largo = 66 / dir.y;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    this.basesHaz.forEach((b, i) => {
      p.set(b.x, 0, b.z).addScaledVector(dir, largo / 2);
      haces.setMatrixAt(i, m.compose(p, q, s.set(b.r, largo, b.r)));
    });
    haces.instanceMatrix.needsUpdate = true;
    haces.computeBoundingSphere();
  }
}
