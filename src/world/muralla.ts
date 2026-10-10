import * as THREE from 'three';
import type { Fisica } from '../core/fisica';
import type { Antorchas } from './antorchas';
import { Lote, cajaUV, colorear, matriz } from './geometria';
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
  /** Puerta exterior (sur), cara de fuera. */
  puerta: THREE.Vector3;
  /** Puerta interior (norte) por donde se evacúa a los civiles; punto en la cara de dentro. */
  puertaEvacuacion: THREE.Vector3;
  anchoPuerta: number;
  /** ¿La puerta sur está rota (brecha abierta)? */
  readonly rota: boolean;
  /** Destruye la hoja de la puerta sur: escombros y paso libre para los titanes. */
  romperPuerta(): void;
  /** Reconstruye la hoja (al reiniciar un capítulo). */
  repararPuerta(): void;
}

/** Hoja de una puerta: malla propia y colisionador, para poder romperla. */
interface Hoja {
  malla: THREE.Mesh;
  collider: import('@dimforge/rapier3d-compat').Collider | null;
  desc: { centro: THREE.Vector3; mitad: THREE.Vector3; theta: number };
}

const SEGMENTOS = 72;
const SEGMENTO_NORTE = SEGMENTOS / 2; // θ = π
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
  const hojas: Hoja[] = [];
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
    if (s === 0 || s === SEGMENTO_NORTE) {
      // Sur: puerta exterior enorme, levantada 7 m. Norte: puerta interior de evacuación, levantada 4 m.
      hojas.push(construirPuerta(theta, Rm, L, H, T, s === 0 ? ELEVACION_PUERTA : 4, piedra, hierro, fisica, colorMuro, escena, mats));
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
  );

  const pp = puntoAnillo(0, R + T + 2);
  antorchas.antorcha(pp.x - ANCHO_PUERTA / 2 - 3, 3, pp.z);
  antorchas.antorcha(pp.x + ANCHO_PUERTA / 2 + 3, 3, pp.z);
  const pi = puntoAnillo(0, R - 2);
  antorchas.antorcha(pi.x - ANCHO_PUERTA / 2 - 2, 3, pi.z);
  antorchas.antorcha(pi.x + ANCHO_PUERTA / 2 + 2, 3, pi.z);

  const pn = puntoAnillo(Math.PI, R - 2);
  antorchas.antorcha(pn.x - ANCHO_PUERTA / 2 - 2, 3, pn.z);
  antorchas.antorcha(pn.x + ANCHO_PUERTA / 2 + 2, 3, pn.z);

  const sur = hojas[0];
  const escombros = new THREE.Group();
  escena.add(escombros);
  const piedrasEscombro: import('@dimforge/rapier3d-compat').Collider[] = [];
  let rota = false;
  return {
    radioInterior: R,
    radioExterior: R + T,
    altura: H,
    canones,
    puerta: puntoAnillo(0, R + T),
    puertaEvacuacion: puntoAnillo(Math.PI, R - 1),
    anchoPuerta: ANCHO_PUERTA,
    get rota() {
      return rota;
    },
    romperPuerta() {
      if (rota) return;
      rota = true;
      sur.malla.visible = false;
      if (sur.collider) fisica.eliminarCollider(sur.collider);
      sur.collider = null;
      // Escombros de piedra y astillas de la hoja esparcidos hacia dentro
      const radial = new THREE.Vector3(0, 0, 1);
      const tangente = new THREE.Vector3(1, 0, 0);
      const matPiedra = mats.muralla;
      const matMadera = mats.puerta;
      let semilla = 7;
      const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 26; k++) {
        const madera = k % 3 === 0;
        const s3 = madera ? new THREE.Vector3(1.2 + azar() * 4, 0.6, 0.8 + azar()) : new THREE.Vector3(1 + azar() * 3, 0.8 + azar() * 2.2, 1 + azar() * 3);
        const m = new THREE.Mesh(cajaUV(s3.x, s3.y, s3.z, madera ? 4 : 24), madera ? matMadera : matPiedra);
        if (!madera) colorear(m.geometry, new THREE.Color(0.85, 0.83, 0.8));
        else colorear(m.geometry, new THREE.Color(1, 1, 1));
        const d = (R + T / 2) - 6 - azar() * 30;
        const lado = (azar() - 0.5) * (ANCHO_PUERTA + 10);
        const p = radial.clone().multiplyScalar(d).addScaledVector(tangente, lado);
        m.position.set(p.x, s3.y / 2, p.z);
        m.rotation.set((azar() - 0.5) * 0.4, azar() * 3, (azar() - 0.5) * 0.4);
        m.castShadow = true;
        m.receiveShadow = true;
        escombros.add(m);
        if (!madera && s3.y > 1.4) piedrasEscombro.push(fisica.caja({ x: p.x, y: s3.y / 2, z: p.z }, { x: s3.x / 2, y: s3.y / 2, z: s3.z / 2 }, 'otro', m.rotation.y));
      }
    },
    repararPuerta() {
      if (!rota) return;
      rota = false;
      sur.malla.visible = true;
      sur.collider = fisica.caja(sur.desc.centro, sur.desc.mitad, 'puerta', sur.desc.theta);
      for (const c of piedrasEscombro) fisica.eliminarCollider(c);
      piedrasEscombro.length = 0;
      for (const m of [...escombros.children]) escombros.remove(m);
    },
  };
}

function construirPuerta(
  theta: number, Rm: number, L: number, H: number, T: number, elevacion: number,
  piedra: Lote, hierro: Lote, fisica: Fisica,
  colorMuro: (g: THREE.BufferGeometry, alto: number) => THREE.BufferGeometry,
  escena: THREE.Scene, mats: Materiales,
): Hoja {
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
  const geoHoja = colorear(cajaUV(ANCHO_PUERTA + 1.2, altoHoja, 1.2, 4), new THREE.Color(1, 1, 1));
  const malla = new THREE.Mesh(geoHoja, mats.puerta);
  malla.position.set(hoja.x, elevacion + altoHoja / 2, hoja.z);
  malla.rotation.y = theta;
  malla.castShadow = true;
  malla.receiveShadow = true;
  escena.add(malla);
  const desc = { centro: malla.position.clone(), mitad: new THREE.Vector3((ANCHO_PUERTA + 1.2) / 2, altoHoja / 2, 0.6), theta };
  const collider = fisica.caja(desc.centro, desc.mitad, 'puerta', theta);
  // Guías verticales de hierro a ambos lados
  for (const lado of [-1, 1]) {
    const g = hoja.clone().addScaledVector(tangente, lado * (ANCHO_PUERTA / 2 + 1.0)).addScaledVector(radial, 0.3);
    hierro.añadir(cajaUV(0.6, H - 4, 0.6, 1), matriz(g.x, (H - 4) / 2, g.z, theta), new THREE.Color('#26272a'));
  }
  return { malla, collider, desc };
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
