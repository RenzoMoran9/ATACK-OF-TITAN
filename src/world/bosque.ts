import * as THREE from 'three';
import type { Hora } from '../core/depuracion';
import type { Fisica } from '../core/fisica';
import type { Rng } from '../core/rng';
import { Lote, escalarUV, matriz } from './geometria';
import type { Materiales } from './materiales';
import { texturaParticula } from './texturas';

/**
 * Bosque de árboles gigantes (80–90 m): troncos rojizos muy gruesos, ramas horizontales
 * anchas y transitables, copas altas, haces de luz filtrada y suelo oscuro con niebla baja.
 */

export interface Arbol {
  x: number;
  z: number;
  altura: number;
  radio: number;
  ramas: { inicio: THREE.Vector3; fin: THREE.Vector3; radio: number }[];
}

export interface DatosBosque {
  arboles: Arbol[];
  centro: THREE.Vector3;
  limites: { x0: number; x1: number; z0: number; z1: number };
}

const HAZ_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vVistaV;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
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

export class Bosque {
  readonly datos: DatosBosque;
  private readonly haces: THREE.Mesh[] = [];
  private readonly matHaz: THREE.ShaderMaterial;
  private matNiebla!: THREE.SpriteMaterial;

  constructor(escena: THREE.Scene, fisica: Fisica, mats: Materiales, rng: Rng) {
    const limites = { x0: -290, x1: 290, z0: 400, z1: 740 };
    const centro = new THREE.Vector3((limites.x0 + limites.x1) / 2, 0, (limites.z0 + limites.z1) / 2);
    const corteza = new Lote();
    const hojas = new Lote();
    const arboles: Arbol[] = [];

    for (let intento = 0; intento < 8000 && arboles.length < 120; intento++) {
      const x = rng.rango(limites.x0 + 15, limites.x1 - 15);
      const z = rng.rango(limites.z0 + 15, limites.z1 - 15);
      if (Math.abs(x) < 16 && z < limites.z0 + 60) continue; // entrada del camino
      if (arboles.some((a) => Math.hypot(a.x - x, a.z - z) < 27 + (a.radio - 4))) continue;
      arboles.push(this.construirArbol(x, z, rng, corteza, hojas, fisica));
    }

    escena.add(corteza.crearMesh(mats.corteza), hojas.crearMesh(mats.hojas));

    // Suelo oscuro del bosque
    const anchoS = limites.x1 - limites.x0 + 60;
    const fondoS = limites.z1 - limites.z0 + 60;
    const sueloGeo = new THREE.CircleGeometry(0.5, 40);
    sueloGeo.scale(anchoS, fondoS, 1);
    escalarUV(sueloGeo, anchoS / 20, fondoS / 20);
    sueloGeo.rotateX(-Math.PI / 2);
    const suelo = new THREE.Mesh(sueloGeo, mats.sueloBosque);
    suelo.position.set(centro.x, 0.03, centro.z);
    suelo.receiveShadow = true;
    escena.add(suelo);

    // Niebla baja: bancos de bruma (sprites) pegados al suelo entre los troncos
    const matNiebla = new THREE.SpriteMaterial({ map: texturaParticula(), color: '#d5dde3', transparent: true, opacity: 0.2, depthWrite: false });
    this.matNiebla = matNiebla;
    for (let i = 0; i < 110; i++) {
      const banco = new THREE.Sprite(matNiebla);
      const ancho = rng.rango(30, 60);
      banco.scale.set(ancho, ancho * rng.rango(0.18, 0.28), 1);
      banco.position.set(rng.rango(limites.x0, limites.x1), rng.rango(1.5, 4), rng.rango(limites.z0, limites.z1));
      banco.renderOrder = 2;
      escena.add(banco);
    }

    // Haces de luz entre las copas
    this.matHaz = new THREE.ShaderMaterial({
      vertexShader: HAZ_VERT,
      fragmentShader: HAZ_FRAG,
      uniforms: { color: { value: new THREE.Color('#fff1c9') }, intensidad: { value: 0.28 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 34; i++) {
      const haz = new THREE.Mesh(new THREE.CylinderGeometry(rng.rango(1.5, 3.5), rng.rango(4, 8), 1, 20, 1, true), this.matHaz);
      haz.userData.base = new THREE.Vector3(rng.rango(limites.x0 + 40, limites.x1 - 40), 0, rng.rango(limites.z0 + 30, limites.z1 - 30));
      haz.renderOrder = 3;
      this.haces.push(haz);
      escena.add(haz);
    }

    this.datos = { arboles, centro, limites };
  }

  private construirArbol(x: number, z: number, rng: Rng, corteza: Lote, hojas: Lote, fisica: Fisica): Arbol {
    const altura = rng.rango(80, 90);
    const r0 = rng.rango(4, 7.5);
    const r1 = r0 * 0.42;
    const altoTronco = altura * 0.8;
    const tinte = new THREE.Color().setHSL(rng.rango(0.02, 0.05), rng.rango(0.3, 0.5), rng.rango(0.75, 0.95));
    const radioA = (h: number) => r0 + (r1 - r0) * (h / altoTronco);

    const tronco = new THREE.CylinderGeometry(r1, r0, altoTronco, 16, 8);
    escalarUV(tronco, (2 * Math.PI * r0) / 4, altoTronco / 8);
    corteza.añadir(tronco, matriz(x, altoTronco / 2, z, rng.rango(0, 6)), tinte);
    const raices = new THREE.CylinderGeometry(r0, r0 * 1.75, 7, 16, 1);
    escalarUV(raices, (2 * Math.PI * r0) / 4, 7 / 8);
    corteza.añadir(raices, matriz(x, 3.5, z), tinte.clone().multiplyScalar(0.85));
    fisica.cilindro({ x, y: altoTronco / 2, z }, altoTronco / 2, (r0 + r1) / 2 + 0.6, 'arbol');
    fisica.cilindro({ x, y: 3.5, z }, 3.5, r0 * 1.35, 'arbol');

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
    const u = this.matHaz.uniforms;
    u.intensidad.value = hora === 'dia' ? 0.28 : hora === 'atardecer' ? 0.2 : 0;
    (u.color.value as THREE.Color).set(hora === 'atardecer' ? '#ffb070' : '#fff1c9');
    const colorNiebla = hora === 'dia' ? '#d5dde3' : hora === 'atardecer' ? '#d8b391' : '#26324d';
    this.matNiebla.color.set(colorNiebla);
    this.matNiebla.opacity = hora === 'noche' ? 0.12 : 0.2;
    const dir = dirSol.clone();
    if (dir.y < 0.35) dir.y = 0.35; // al atardecer, que no queden casi horizontales
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    for (const haz of this.haces) {
      const base = haz.userData.base as THREE.Vector3;
      const largo = 66 / dir.y;
      haz.scale.set(1, largo, 1);
      haz.quaternion.copy(q);
      haz.position.copy(base).addScaledVector(dir, largo / 2);
      haz.visible = hora !== 'noche';
    }
  }
}
