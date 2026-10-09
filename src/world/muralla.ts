import * as THREE from 'three';
import type { Fisica } from '../core/fisica';
import type { Antorchas } from './antorchas';
import { Lote, cajaUV, matriz } from './geometria';
import type { Materiales } from './materiales';

/**
 * Muralla anular de 50 m: piedra lisa gris-beige casi sin juntas, coronación plana,
 * vías sobre la muralla con cañones negros sobre raíles y una puerta enorme de madera
 * y hierro al sur (+Z), levantada lo justo para pasar.
 */

export interface DatosMuralla {
  radioInterior: number;
  radioExterior: number;
  altura: number;
  /** Ángulo (rad) de cada cañón; 0 = sur (+Z). */
  canones: number[];
  puerta: THREE.Vector3;
}

const SEGMENTOS = 72;
const ANCHO_PUERTA = 18;
const ALTO_PASO = 26;
const ELEVACION_PUERTA = 7;

/** Posición sobre el anillo: θ = 0 → sur (+Z), creciendo hacia +X. */
export function puntoAnillo(theta: number, radio: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(theta) * radio, y, Math.cos(theta) * radio);
}

export function construirMuralla(escena: THREE.Scene, fisica: Fisica, mats: Materiales, R: number, H: number, T: number, antorchas: Antorchas): DatosMuralla {
  const piedra = new Lote();
  const hierro = new Lote();
  const madera = new Lote();
  const puerta = new Lote();
  const Rm = R + T / 2;
  const mitadAng = Math.PI / SEGMENTOS;
  const L = 2 * (R + T) * Math.tan(mitadAng) + 0.3;
  const canones: number[] = [];

  const colorMuro = (g: THREE.BufferGeometry, alto: number) => {
    // más sucia abajo, más clara arriba
    const pos = g.attributes.position;
    const c = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + alto / 2) / alto;
      const v = 0.78 + 0.22 * Math.min(1, t * 1.6);
      c[i * 3] = v;
      c[i * 3 + 1] = v * 0.99;
      c[i * 3 + 2] = v * 0.97;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };

  for (let s = 0; s < SEGMENTOS; s++) {
    const theta = (s / SEGMENTOS) * Math.PI * 2;
    const c = puntoAnillo(theta, Rm);
    if (s === 0) {
      construirPuerta(theta, Rm, L, H, T, piedra, puerta, hierro, fisica, colorMuro);
    } else {
      piedra.añadir(colorMuro(cajaUV(L, H, T, 24), H), matriz(c.x, H / 2, c.z, theta));
      fisica.caja({ x: c.x, y: H / 2, z: c.z }, { x: L / 2, y: H / 2, z: T / 2 }, 'muralla', theta);
    }
    // Cornisas (sin almenas)
    for (const lado of [-1, 1]) {
      const p = puntoAnillo(theta, Rm + lado * (T / 2 + 0.25));
      piedra.añadir(cajaUV(L + 0.1, 1.1, 0.8, 24), matriz(p.x, H - 0.4, p.z, theta), new THREE.Color(0.7, 0.68, 0.64));
    }
    // Vía longitudinal sobre la coronación
    for (const off of [1.6, 3.0]) {
      const p = puntoAnillo(theta, Rm + off, H + 0.06);
      hierro.añadir(cajaUV(L, 0.12, 0.12, 1), matriz(p.x, p.y, p.z, theta), new THREE.Color('#2b2b2e'));
    }
    if (s % 3 === 1) {
      canones.push(theta);
      construirCanon(theta, R, T, H, hierro, madera);
      const pa = puntoAnillo(theta + mitadAng * 0.6, R + 0.8);
      antorchas.antorcha(pa.x, H, pa.z);
    }
  }

  escena.add(
    piedra.crearMesh(mats.muralla),
    hierro.crearMesh(mats.hierro),
    madera.crearMesh(mats.madera),
    puerta.crearMesh(mats.puerta),
  );

  const pp = puntoAnillo(0, R + T + 2);
  antorchas.antorcha(pp.x - ANCHO_PUERTA / 2 - 3, 3, pp.z);
  antorchas.antorcha(pp.x + ANCHO_PUERTA / 2 + 3, 3, pp.z);
  const pi = puntoAnillo(0, R - 2);
  antorchas.antorcha(pi.x - ANCHO_PUERTA / 2 - 2, 3, pi.z);
  antorchas.antorcha(pi.x + ANCHO_PUERTA / 2 + 2, 3, pi.z);

  return { radioInterior: R, radioExterior: R + T, altura: H, canones, puerta: puntoAnillo(0, R + T) };
}

function construirPuerta(
  theta: number, Rm: number, L: number, H: number, T: number,
  piedra: Lote, puerta: Lote, hierro: Lote, fisica: Fisica,
  colorMuro: (g: THREE.BufferGeometry, alto: number) => THREE.BufferGeometry,
): void {
  const tangente = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
  const radial = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
  const centro = puntoAnillo(theta, Rm);
  const ladoPilar = (L - ANCHO_PUERTA) / 2;
  for (const lado of [-1, 1]) {
    const p = centro.clone().addScaledVector(tangente, lado * (ANCHO_PUERTA / 2 + ladoPilar / 2));
    piedra.añadir(colorMuro(cajaUV(ladoPilar, H, T, 24), H), matriz(p.x, H / 2, p.z, theta));
    fisica.caja({ x: p.x, y: H / 2, z: p.z }, { x: ladoPilar / 2, y: H / 2, z: T / 2 }, 'muralla', theta);
    // Contrafuertes que enmarcan la puerta por fuera
    const c = centro.clone().addScaledVector(tangente, lado * (ANCHO_PUERTA / 2 + 3)).addScaledVector(radial, T / 2 + 1.5);
    piedra.añadir(colorMuro(cajaUV(4, H - 2, 3, 24), H - 2), matriz(c.x, (H - 2) / 2, c.z, theta));
    fisica.caja({ x: c.x, y: (H - 2) / 2, z: c.z }, { x: 2, y: (H - 2) / 2, z: 1.5 }, 'muralla', theta);
  }
  const altoDintel = H - ALTO_PASO;
  piedra.añadir(colorMuro(cajaUV(ANCHO_PUERTA + 0.2, altoDintel, T, 24, 24, ALTO_PASO), altoDintel), matriz(centro.x, ALTO_PASO + altoDintel / 2, centro.z, theta));
  fisica.caja({ x: centro.x, y: ALTO_PASO + altoDintel / 2, z: centro.z }, { x: ANCHO_PUERTA / 2, y: altoDintel / 2, z: T / 2 }, 'muralla', theta);

  // Hoja de la puerta: madera con flejes de hierro, levantada ELEVACION_PUERTA metros
  const altoHoja = ALTO_PASO + 2;
  const hoja = centro.clone().addScaledVector(radial, T / 2 + 0.9);
  puerta.añadir(cajaUV(ANCHO_PUERTA + 1.2, altoHoja, 1.2, 4), matriz(hoja.x, ELEVACION_PUERTA + altoHoja / 2, hoja.z, theta));
  fisica.caja({ x: hoja.x, y: ELEVACION_PUERTA + altoHoja / 2, z: hoja.z }, { x: (ANCHO_PUERTA + 1.2) / 2, y: altoHoja / 2, z: 0.6 }, 'puerta', theta);
  // Guías verticales de hierro a ambos lados
  for (const lado of [-1, 1]) {
    const g = hoja.clone().addScaledVector(tangente, lado * (ANCHO_PUERTA / 2 + 1.0)).addScaledVector(radial, 0.3);
    hierro.añadir(cajaUV(0.6, H - 4, 0.6, 1), matriz(g.x, (H - 4) / 2, g.z, theta), new THREE.Color('#26272a'));
  }
}

function construirCanon(theta: number, R: number, T: number, H: number, hierro: Lote, madera: Lote): void {
  const negro = new THREE.Color('#151517');
  const rail = new THREE.Color('#2b2b2e');
  const tangente = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
  // Raíles transversales para empujar el cañón hacia el borde
  for (const lado of [-0.6, 0.6]) {
    const p = puntoAnillo(theta, R + T / 2).addScaledVector(tangente, lado);
    hierro.añadir(cajaUV(0.12, 0.12, T - 1, 1), matriz(p.x, H + 0.06, p.z, theta), rail);
  }
  const base = puntoAnillo(theta, R + T - 2.6, H);
  // Cureña
  madera.añadir(cajaUV(1.5, 0.8, 2.8, 1), matriz(base.x, H + 0.75, base.z, theta), new THREE.Color('#3b2a1d'));
  for (const lt of [-0.85, 0.85]) {
    for (const lr of [-0.9, 0.9]) {
      const r = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 14);
      r.rotateZ(Math.PI / 2);
      const p = base.clone().addScaledVector(tangente, lt).add(puntoAnillo(theta, lr));
      hierro.añadir(r, matriz(p.x, H + 0.42, p.z, theta), negro);
    }
  }
  // Tubo negro apuntando hacia fuera, ligeramente elevado
  const q = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - 0.08));
  const tubo = new THREE.CylinderGeometry(0.26, 0.36, 3.8, 16);
  const centroTubo = base.clone().add(puntoAnillo(theta, 0.9));
  hierro.añadir(tubo, matriz(centroTubo.x, H + 1.45, centroTubo.z, 0, q), negro);
  const culata = new THREE.SphereGeometry(0.38, 12, 8);
  const pc = base.clone().add(puntoAnillo(theta, -1.0));
  hierro.añadir(culata, matriz(pc.x, H + 1.3, pc.z), negro);
  const boca = new THREE.TorusGeometry(0.3, 0.07, 6, 14);
  const pb = base.clone().add(puntoAnillo(theta, 2.8));
  hierro.añadir(boca, matriz(pb.x, H + 1.6, pb.z, theta), negro);
}
