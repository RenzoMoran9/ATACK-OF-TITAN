import * as THREE from 'three';
import type { Fisica } from '../core/fisica';
import type { Rng } from '../core/rng';
import type { Antorchas } from './antorchas';
import { Lote, cajaUV, escalarUV, matriz, tejadoDosAguas } from './geometria';
import type { Materiales } from './materiales';

/**
 * Distrito amurallado: casas de entramado (zócalo de piedra gris, fachada de yeso crema con
 * vigas oscuras, tejado de teja muy inclinado, chimeneas), calles empedradas estrechas,
 * plaza con depósito de suministros e iglesia con torre como punto alto.
 */

export interface Casa {
  x: number;
  z: number;
  ancho: number;
  fondo: number;
  rotY: number;
  alturaAlero: number;
  alturaCumbrera: number;
}

export interface DatosCiudad {
  casas: Casa[];
  plaza: THREE.Vector3;
  deposito: THREE.Vector3;
  torre: THREE.Vector3;
}

const PASO = 16; // separación de parcelas: casa de 8–12 m + calle de 4–8 m
export const ZOCALO = 2.4;
export const PLANTA = 3.2;
const VANO = 4;

export function construirCiudad(escena: THREE.Scene, fisica: Fisica, mats: Materiales, rng: Rng, radioMuralla: number, antorchas: Antorchas): DatosCiudad {
  const piedra = new Lote();
  const fachadaA = new Lote();
  const fachadaB = new Lote();
  const tejas = new Lote();
  const pizarra = new Lote();
  const madera = new Lote();
  const casas: Casa[] = [];

  const radioCasas = radioMuralla - 22;
  const n = Math.ceil(radioCasas / PASO);
  const iglesia = { x: 0, z: -62, ancho: 18, fondo: 34 };

  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i * PASO;
      const z = j * PASO;
      if (Math.hypot(x, z) > radioCasas) continue;
      if (Math.hypot(x, z) < 36) continue; // plaza
      if (i === 0 || j === 0) continue; // avenidas norte-sur y este-oeste
      if (Math.abs(x - iglesia.x) < 24 && Math.abs(z - iglesia.z) < 30) continue;

      const rotY = rng.siguiente() < 0.5 ? 0 : Math.PI / 2;
      const ancho = rng.siguiente() < 0.55 ? 8 : 12;
      const fondo = rng.siguiente() < 0.6 ? 8 : 10;
      const holgura = (PASO - Math.max(ancho, fondo) - 4) / 2;
      const cx = x + rng.rango(-holgura, holgura);
      const cz = z + rng.rango(-holgura, holgura);
      const pendiente = THREE.MathUtils.degToRad(rng.rango(50, 58));
      const subida = (fondo / 2) * Math.tan(pendiente);
      // Más altas cerca del centro; nunca más de 20 m en total.
      const centralidad = 1 - Math.hypot(x, z) / radioCasas;
      let plantas = rng.entero(1, 3) + (centralidad > 0.45 && rng.siguiente() < 0.6 ? 1 : 0);
      while (plantas > 1 && ZOCALO + plantas * PLANTA + subida > 20) plantas--;
      const casa: Casa = {
        x: cx,
        z: cz,
        ancho,
        fondo,
        rotY,
        alturaAlero: ZOCALO + plantas * PLANTA,
        alturaCumbrera: ZOCALO + plantas * PLANTA + subida,
      };
      casas.push(casa);
      construirCasa(casa, plantas, subida, rng, { piedra, fachadaA, fachadaB, tejas, madera }, fisica);
    }
  }

  const torre = construirIglesia(iglesia, { piedra, tejas, pizarra, madera }, fisica);

  // Plaza: pozo, depósito de suministros (cajas + barriles de gas) y faroles.
  const plaza = new THREE.Vector3(0, 0, 0);
  const pozo = new THREE.CylinderGeometry(2.2, 2.4, 1.1, 20);
  escalarUV(pozo, 7, 0.6);
  piedra.añadir(pozo, matriz(0, 0.55, 0));
  fisica.cilindro({ x: 0, y: 0.55, z: 0 }, 0.55, 2.4, 'otro');
  const deposito = new THREE.Vector3(14, 0, 12);
  const colorCaja = new THREE.Color('#8a6a45');
  for (let k = 0; k < 7; k++) {
    const s = rng.rango(1.0, 1.4);
    const px = deposito.x + rng.rango(-2.5, 2.5);
    const pz = deposito.z + rng.rango(-2, 2);
    const apilada = k > 4 ? s : 0;
    madera.añadir(cajaUV(s, s, s, 1), matriz(px, s / 2 + apilada, pz, rng.rango(0, 1)), colorCaja.clone().multiplyScalar(rng.rango(0.8, 1.1)));
  }
  for (let k = 0; k < 4; k++) {
    const barril = new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12);
    madera.añadir(barril, matriz(deposito.x - 4 + k * 1.05, 0.6, deposito.z + 3), new THREE.Color('#5b6a52'));
  }
  // Mástil con banderín verde: marca el punto de recarga de gas
  madera.añadir(cajaUV(0.2, 7, 0.2, 1), matriz(deposito.x + 3.5, 3.5, deposito.z - 2.5), new THREE.Color('#4a3524'));
  madera.añadir(cajaUV(0.05, 1.4, 2.2, 1), matriz(deposito.x + 3.5, 6.2, deposito.z - 1.35), new THREE.Color('#3f7a3a'));
  fisica.caja({ x: deposito.x, y: 0.7, z: deposito.z }, { x: 3, y: 0.7, z: 2.4 }, 'otro');

  // Faroles: alrededor de la plaza y a lo largo de las avenidas
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + 0.2;
    antorchas.farol(Math.cos(ang) * 26, 0, Math.sin(ang) * 26);
  }
  for (let d = 50; d < radioCasas; d += 34) {
    antorchas.farol(6.5, 0, d);
    antorchas.farol(-6.5, 0, d + 17);
    antorchas.farol(d, 0, 6.5);
    antorchas.farol(-d, 0, -6.5);
  }

  escena.add(
    piedra.crearMesh(mats.piedra),
    fachadaA.crearMesh(mats.entramadoVentana),
    fachadaB.crearMesh(mats.entramadoCruz),
    tejas.crearMesh(mats.tejas),
    pizarra.crearMesh(mats.pizarra),
    madera.crearMesh(mats.madera),
  );

  // Empedrado dentro de la muralla
  const empedrado = new THREE.CircleGeometry(radioMuralla + 2, 96);
  escalarUV(empedrado, (radioMuralla * 2) / 2.2, (radioMuralla * 2) / 2.2);
  empedrado.rotateX(-Math.PI / 2);
  const suelo = new THREE.Mesh(empedrado, mats.adoquines);
  suelo.position.y = 0.02;
  suelo.receiveShadow = true;
  escena.add(suelo);

  return { casas, plaza, deposito, torre };
}

/** Lotes de material de una casa (los comparten las aldeas del mundo abierto). */
export interface LotesCasa {
  piedra: Lote;
  fachadaA: Lote;
  fachadaB: Lote;
  tejas: Lote;
  madera: Lote;
}

export function construirCasa(c: Casa, plantas: number, subida: number, rng: Rng, l: LotesCasa, fisica: Fisica): void {
  const m = (lx: number, ly: number, lz: number) => {
    const p = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.rotY);
    return matriz(c.x + p.x, p.y, c.z + p.z, c.rotY);
  };
  const altoFachada = plantas * PLANTA;
  const tintePiedra = new THREE.Color().setHSL(0.09, 0.05, rng.rango(0.72, 0.9));
  const tinteYeso = new THREE.Color().setHSL(rng.rango(0.09, 0.12), rng.rango(0.15, 0.4), rng.rango(0.82, 0.95));
  const tinteTeja = new THREE.Color().setHSL(rng.rango(0.015, 0.06), rng.rango(0.35, 0.6), rng.rango(0.62, 0.8));

  l.piedra.añadir(cajaUV(c.ancho, ZOCALO, c.fondo, 2), m(0, ZOCALO / 2, 0), tintePiedra);
  const fachada = rng.siguiente() < 0.62 ? l.fachadaA : l.fachadaB;
  fachada.añadir(cajaUV(c.ancho, altoFachada, c.fondo, VANO, PLANTA), m(0, ZOCALO + altoFachada / 2, 0), tinteYeso);

  const t = tejadoDosAguas(c.ancho, c.fondo, subida, 0.7, { u: VANO, v: PLANTA, baseV: altoFachada });
  l.tejas.añadir(t.faldones, m(0, c.alturaAlero, 0), tinteTeja);
  fachada.añadir(t.hastiales, m(0, c.alturaAlero, 0), tinteYeso.clone());

  // Chimeneas que asoman por el faldón
  const chimeneas = rng.siguiente() < 0.35 ? 2 : 1;
  for (let k = 0; k < chimeneas; k++) {
    const lx = (k === 0 ? -1 : 1) * c.ancho * rng.rango(0.15, 0.3);
    const lz = (rng.siguiente() < 0.5 ? -1 : 1) * (c.fondo / 2) * 0.35;
    const yTejado = c.alturaAlero + subida * (1 - Math.abs(lz) / (c.fondo / 2));
    const alto = rng.rango(1.6, 2.6) + 1;
    l.piedra.añadir(cajaUV(0.9, alto, 0.9, 2), m(lx, yTejado - 1 + alto / 2, lz), tintePiedra.clone().multiplyScalar(0.85));
    l.piedra.añadir(cajaUV(1.15, 0.25, 1.15, 2), m(lx, yTejado - 1 + alto, lz), tintePiedra.clone().multiplyScalar(0.7));
  }

  // Puerta de madera en la fachada larga (da escala humana)
  const lado = rng.siguiente() < 0.5 ? 1 : -1;
  l.madera.añadir(cajaUV(1.3, 2.3, 0.14, 1), m(rng.elegir([-2, 2]), 1.15, lado * (c.fondo / 2 + 0.05)), new THREE.Color('#4a3120'));

  // Colisión: cuerpo + tejado convexo
  fisica.caja({ x: c.x, y: c.alturaAlero / 2, z: c.z }, { x: c.ancho / 2, y: c.alturaAlero / 2, z: c.fondo / 2 }, 'edificio', c.rotY);
  const mt = m(0, c.alturaAlero, 0);
  const puntos: number[] = [];
  for (const p of t.casco) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(mt);
    puntos.push(v.x, v.y, v.z);
  }
  fisica.casco(puntos, 'tejado');
}

function construirIglesia(ig: { x: number; z: number; ancho: number; fondo: number }, l: { piedra: Lote; tejas: Lote; pizarra: Lote; madera: Lote }, fisica: Fisica): THREE.Vector3 {
  const altoNave = 15;
  const rot = Math.PI / 2; // cumbrera norte-sur
  const piedraIglesia = new THREE.Color('#d8d2c6');
  l.piedra.añadir(cajaUV(ig.ancho, altoNave, ig.fondo, 2), matriz(ig.x, altoNave / 2, ig.z), piedraIglesia);
  const subida = (ig.ancho / 2) * Math.tan(THREE.MathUtils.degToRad(56));
  const t = tejadoDosAguas(ig.fondo, ig.ancho, subida, 0.9, { u: 2, v: 2, baseV: 0 });
  l.tejas.añadir(t.faldones, matriz(ig.x, altoNave, ig.z, rot), new THREE.Color('#b9958a'));
  l.piedra.añadir(t.hastiales, matriz(ig.x, altoNave, ig.z, rot), piedraIglesia.clone());
  fisica.caja({ x: ig.x, y: altoNave / 2, z: ig.z }, { x: ig.ancho / 2, y: altoNave / 2, z: ig.fondo / 2 }, 'edificio');
  const mt = matriz(ig.x, altoNave, ig.z, rot);
  fisica.casco(t.casco.flatMap((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(mt).toArray()), 'tejado');

  // Torre en la fachada sur, frente a la plaza
  const tx = ig.x;
  const tz = ig.z + ig.fondo / 2 + 4;
  const ladoTorre = 9;
  const altoTorre = 38;
  l.piedra.añadir(cajaUV(ladoTorre, altoTorre, ladoTorre, 2), matriz(tx, altoTorre / 2, tz), new THREE.Color('#cfc8ba'));
  l.piedra.añadir(cajaUV(ladoTorre + 0.8, 0.8, ladoTorre + 0.8, 2), matriz(tx, altoTorre, tz), new THREE.Color('#a8a194'));
  fisica.caja({ x: tx, y: altoTorre / 2, z: tz }, { x: ladoTorre / 2, y: altoTorre / 2, z: ladoTorre / 2 }, 'edificio');
  // Vanos del campanario y reloj
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const dx = Math.sin(ang) * (ladoTorre / 2 + 0.02);
    const dz = Math.cos(ang) * (ladoTorre / 2 + 0.02);
    for (const off of [-1.8, 1.8]) {
      const ox = Math.cos(ang) * off;
      const oz = -Math.sin(ang) * off;
      l.madera.añadir(cajaUV(1.4, 4.2, 0.1, 1), matriz(tx + dx + ox, altoTorre - 4, tz + dz + oz, ang), new THREE.Color('#1d1a17'));
    }
    const reloj = new THREE.CircleGeometry(1.8, 24);
    l.madera.añadir(reloj, matriz(tx + dx * 1.003, altoTorre - 11, tz + dz * 1.003, ang), new THREE.Color('#ece6d6'));
    const aguja = cajaUV(0.18, 1.4, 0.04, 1);
    aguja.translate(0, 0.6, 0.02);
    l.madera.añadir(aguja, matriz(tx + dx * 1.004, altoTorre - 11, tz + dz * 1.004, ang), new THREE.Color('#1d1a17'));
  }
  // Chapitel de pizarra
  const chapitel = new THREE.ConeGeometry(ladoTorre * 0.72, 17, 4, 1, true);
  chapitel.rotateY(Math.PI / 4);
  escalarUV(chapitel, 12, 8);
  l.pizarra.añadir(chapitel, matriz(tx, altoTorre + 8.5, tz), new THREE.Color('#9aa6b4'));
  fisica.casco(
    [
      tx - ladoTorre / 2, altoTorre, tz - ladoTorre / 2,
      tx + ladoTorre / 2, altoTorre, tz - ladoTorre / 2,
      tx - ladoTorre / 2, altoTorre, tz + ladoTorre / 2,
      tx + ladoTorre / 2, altoTorre, tz + ladoTorre / 2,
      tx, altoTorre + 17, tz,
    ],
    'tejado',
  );
  // Cruz
  l.madera.añadir(cajaUV(0.25, 2.4, 0.25, 1), matriz(tx, altoTorre + 18, tz), new THREE.Color('#3a3530'));
  l.madera.añadir(cajaUV(1.2, 0.22, 0.22, 1), matriz(tx, altoTorre + 18.4, tz), new THREE.Color('#3a3530'));
  return new THREE.Vector3(tx, altoTorre + 17, tz);
}
