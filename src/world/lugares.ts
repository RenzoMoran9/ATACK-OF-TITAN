import * as THREE from 'three';
import type { Fisica } from '../core/fisica';
import { crearRng, type Rng } from '../core/rng';
import type { Antorchas } from './antorchas';
import { construirCasa, ZOCALO, PLANTA, type Casa, type LotesCasa } from './ciudad';
import { distanciaPolilinea, type PuntoXZ } from './formas';
import { Lote, cajaUV, escalarUV, matriz, tejadoDosAguas } from './geometria';
import type { Materiales } from './materiales';
import { texturaAgua, texturaEmblema } from './texturas';
import { ANCHO_RIO, CAMINOS_CONTROL, LUGARES, RIO_CONTROL, curva, type IdLugar } from './trazado';

/**
 * Lugares para explorar fuera de la muralla: aldeas abandonadas (casas de Trost, unas
 * enteras y otras sin tejado o derrumbadas, y un molino), las ruinas del Castillo de Utgard
 * (torre de piedra de ~38 m y muros rotos, todo enganchable), el río con su puente de piedra,
 * los puestos de avanzada de suministros (carro, cajas, barriles de gas, tienda y estandarte;
 * son depósitos de recarga) y el campamento de la Legión de Reconocimiento. Cada lugar va en
 * sus propios lotes para que el frustum culling lo descarte entero.
 */

export type TipoLugar = 'bosque' | 'aldea' | 'castillo' | 'puente' | 'puesto' | 'campamento';

export interface Lugar {
  id: string;
  nombre: string;
  tipo: TipoLugar;
  pos: THREE.Vector3;
  /** Radio aproximado del lugar (m). */
  radio: number;
  descubierto: boolean;
}

/** Huella rectangular en planta (casas, muros, tiendas, carros, puente). */
export interface Huella {
  x: number;
  z: number;
  ancho: number;
  fondo: number;
  rotY: number;
}

/** Lo que el mapa y la navegación necesitan saber del territorio construido. */
export interface Plano {
  rio: PuntoXZ[];
  anchoRio: number;
  caminos: PuntoXZ[][];
  edificios: Huella[];
  torres: { x: number; z: number; r: number }[];
}

export interface DatosLugares {
  lugares: Lugar[];
  depositos: { pos: THREE.Vector3; nombre: string }[];
  plano: Plano;
  /** Agua del río (su textura se desliza con la corriente). */
  agua: THREE.Texture;
  /** false cerca del río, de los caminos o de un lugar (ahí no crecen árboles sueltos). */
  despejado(x: number, z: number, margen: number): boolean;
}

const COLOR = {
  piedraCastillo: new THREE.Color('#b9b3a7'),
  lona: new THREE.Color('#d9cfb2'),
  lonaVerde: new THREE.Color('#5d6e4a'),
  maderaCarro: new THREE.Color('#7a5a3a'),
  rueda: new THREE.Color('#4a3524'),
  caja: new THREE.Color('#8a6a45'),
  barril: new THREE.Color('#5b6a52'),
  oscuro: new THREE.Color('#1d1a17'),
  bandera: new THREE.Color('#3f6a34'),
  poste: new THREE.Color('#4a3524'),
  carbon: new THREE.Color('#2a221c'),
};

/** Obra: los lotes de un lugar y su posición/giro en el mundo. */
class Obra implements LotesCasa {
  readonly piedra = new Lote();
  readonly fachadaA = new Lote();
  readonly fachadaB = new Lote();
  readonly tejas = new Lote();
  readonly madera = new Lote();
  private readonly c: number;
  private readonly s: number;

  constructor(
    readonly x: number,
    readonly z: number,
    readonly rot: number,
    readonly fisica: Fisica,
    readonly plano: Plano,
    readonly emblemas: Lote,
  ) {
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
  }

  /** Coordenadas de mundo de un punto local (giro alrededor de Y, como `matriz`). */
  mundo(lx: number, lz: number): PuntoXZ {
    return { x: this.x + lx * this.c + lz * this.s, z: this.z - lx * this.s + lz * this.c };
  }

  /** Inversa de `mundo`. */
  local(x: number, z: number): PuntoXZ {
    const dx = x - this.x;
    const dz = z - this.z;
    return { x: dx * this.c - dz * this.s, z: dx * this.s + dz * this.c };
  }

  m(lx: number, y: number, lz: number, rot = 0, q?: THREE.Quaternion): THREE.Matrix4 {
    const p = this.mundo(lx, lz);
    if (q) {
      const total = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rot).multiply(q);
      return matriz(p.x, y, p.z, 0, total);
    }
    return matriz(p.x, y, p.z, this.rot + rot);
  }

  /** Caja sólida: malla, colisionador ('edificio') y huella para el mapa y la navegación. */
  bloque(l: Lote, ancho: number, alto: number, fondo: number, lx: number, y0: number, lz: number, rot: number, color: THREE.Color, opciones: { colision?: boolean; huella?: boolean; mosaico?: number } = {}): void {
    const { colision = true, huella = true, mosaico = 2 } = opciones;
    l.añadir(cajaUV(ancho, alto, fondo, mosaico), this.m(lx, y0 + alto / 2, lz, rot), color);
    const p = this.mundo(lx, lz);
    if (colision) this.fisica.caja({ x: p.x, y: y0 + alto / 2, z: p.z }, { x: ancho / 2, y: alto / 2, z: fondo / 2 }, 'edificio', this.rot + rot);
    if (huella) this.plano.edificios.push({ x: p.x, z: p.z, ancho, fondo, rotY: this.rot + rot });
  }

  /** Torre o columna cilíndrica. */
  cilindro(l: Lote, r0: number, r1: number, alto: number, lx: number, y0: number, lz: number, color: THREE.Color, lados = 14): void {
    const g = new THREE.CylinderGeometry(r1, r0, alto, lados, 2);
    escalarUV(g, (2 * Math.PI * r0) / 2, alto / 2);
    l.añadir(g, this.m(lx, y0 + alto / 2, lz), color);
    const p = this.mundo(lx, lz);
    this.fisica.cilindro({ x: p.x, y: y0 + alto / 2, z: p.z }, alto / 2, Math.max(r0, r1), 'edificio');
    this.plano.torres.push({ x: p.x, z: p.z, r: Math.max(r0, r1) });
  }

  /** Escombros: bloques de piedra (y teja/vigas) tirados alrededor de un punto. */
  escombros(rng: Rng, lx: number, lz: number, radio: number, n: number, conTejas = false): void {
    for (let k = 0; k < n; k++) {
      const a = rng.rango(0, Math.PI * 2);
      const d = rng.rango(0, radio);
      const s = rng.rango(0.5, 1.7);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.rango(-0.5, 0.5), rng.rango(0, 6), rng.rango(-0.5, 0.5)));
      const l = conTejas && k % 3 === 0 ? this.tejas : this.piedra;
      const color = l === this.tejas ? new THREE.Color().setHSL(0.03, 0.45, 0.6) : COLOR.piedraCastillo.clone().multiplyScalar(rng.rango(0.75, 1));
      l.añadir(cajaUV(s * rng.rango(0.8, 1.6), s * 0.7, s, 2), this.m(lx + Math.cos(a) * d, s * 0.3, lz + Math.sin(a) * d, 0, q), color);
    }
    if (conTejas) {
      for (let k = 0; k < 3; k++) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.rango(0.3, 0.9), rng.rango(0, 6), 0));
        const largo = rng.rango(3, 6);
        this.madera.añadir(cajaUV(0.3, 0.3, largo, 1), this.m(lx + rng.rango(-radio, radio), largo * 0.3, lz + rng.rango(-radio, radio), 0, q), COLOR.carbon);
      }
    }
  }

  terminar(escena: THREE.Scene, mats: Materiales): void {
    const pares: [Lote, THREE.Material][] = [
      [this.piedra, mats.piedra],
      [this.fachadaA, mats.entramadoVentana],
      [this.fachadaB, mats.entramadoCruz],
      [this.tejas, mats.tejas],
      [this.madera, mats.madera],
    ];
    for (const [l, mat] of pares) if (!l.vacio) escena.add(l.crearMesh(mat));
  }
}

// ───────────────────────── Aldeas ─────────────────────────

/** Casa en ruinas: paredes huecas (sin tejado) o derrumbadas hasta media altura, con escombros. */
function construirRuina(o: Obra, c: Casa, derrumbada: boolean, rng: Rng): void {
  const g = 0.6;
  const tintePiedra = new THREE.Color().setHSL(0.09, 0.05, rng.rango(0.62, 0.8));
  const tinteYeso = new THREE.Color().setHSL(rng.rango(0.09, 0.12), rng.rango(0.12, 0.3), rng.rango(0.66, 0.8));
  const fachada = rng.siguiente() < 0.6 ? o.fachadaA : o.fachadaB;
  const paredes = [
    { cx: 0, cz: c.fondo / 2 - g / 2, largo: c.ancho, rot: 0 },
    { cx: 0, cz: -c.fondo / 2 + g / 2, largo: c.ancho, rot: 0 },
    { cx: c.ancho / 2 - g / 2, cz: 0, largo: c.fondo - 2 * g, rot: Math.PI / 2 },
    { cx: -c.ancho / 2 + g / 2, cz: 0, largo: c.fondo - 2 * g, rot: Math.PI / 2 },
  ];
  const cr = Math.cos(c.rotY);
  const sr = Math.sin(c.rotY);
  for (const p of paredes) {
    const tramos = derrumbada || rng.siguiente() < 0.4 ? 2 : 1;
    for (let t = 0; t < tramos; t++) {
      const largo = p.largo / tramos;
      const desp = (t - (tramos - 1) / 2) * largo;
      const completa = c.alturaAlero;
      const alto = derrumbada ? completa * rng.rango(0.2, 0.6) : rng.siguiente() < 0.3 ? completa * rng.rango(0.4, 0.75) : completa;
      // centro del tramo: en la casa y luego en el mundo
      const hx = p.cx + desp * Math.cos(p.rot);
      const hz = p.cz - desp * Math.sin(p.rot);
      const x = c.x + hx * cr + hz * sr;
      const z = c.z - hx * sr + hz * cr;
      const rot = c.rotY + p.rot;
      const zocalo = Math.min(ZOCALO, alto);
      o.piedra.añadir(cajaUV(largo, zocalo, g, 2), matriz(x, zocalo / 2, z, rot), tintePiedra);
      o.fisica.caja({ x, y: zocalo / 2, z }, { x: largo / 2, y: zocalo / 2, z: g / 2 }, 'edificio', rot);
      if (alto > ZOCALO + 0.3) {
        fachada.añadir(cajaUV(largo, alto - ZOCALO, g, 4, PLANTA), matriz(x, ZOCALO + (alto - ZOCALO) / 2, z, rot), tinteYeso);
        o.fisica.caja({ x, y: ZOCALO + (alto - ZOCALO) / 2, z }, { x: largo / 2, y: (alto - ZOCALO) / 2, z: g / 2 }, 'edificio', rot);
      }
    }
  }
  o.plano.edificios.push({ x: c.x, z: c.z, ancho: c.ancho, fondo: c.fondo, rotY: c.rotY });
  const l = o.local(c.x, c.z);
  o.escombros(rng, l.x, l.z, Math.max(c.ancho, c.fondo) * 0.45, derrumbada ? 12 : 6, true);
}

/** Molino de viento de piedra con las aspas rotas: se ve desde lejos. */
function construirMolino(o: Obra, lx: number, lz: number, rng: Rng): void {
  const piedra = new THREE.Color('#cfc6b4');
  o.cilindro(o.piedra, 4.8, 3.4, 15, lx, 0, lz, piedra);
  const tejado = new THREE.ConeGeometry(4.4, 5, 12, 1);
  escalarUV(tejado, 6, 3);
  o.tejas.añadir(tejado, o.m(lx, 17.5, lz), new THREE.Color('#8a6a5a'));
  // aspas en la cara sur, una partida
  const eje = new THREE.Vector3(0, 0, 1);
  const giro0 = rng.rango(0, Math.PI / 2);
  for (let k = 0; k < 4; k++) {
    const largo = k === 2 ? 4.5 : 11;
    const q = new THREE.Quaternion().setFromAxisAngle(eje, giro0 + (k * Math.PI) / 2);
    const g = cajaUV(1.6, largo, 0.15, 1);
    g.translate(0, largo / 2 + 0.6, 0);
    o.madera.añadir(g, o.m(lx, 13, lz + 4.2, 0, q), new THREE.Color('#6b5236'));
  }
  o.madera.añadir(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 10).rotateX(Math.PI / 2), o.m(lx, 13, lz + 3.8), COLOR.rueda);
}

function construirAldea(o: Obra, rng: Rng, radio: number, nCasas: number, molino: boolean): void {
  // parcelas en una rejilla con holgura alrededor de una plaza con pozo
  const parcelas: PuntoXZ[] = [];
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const x = i * 18 + rng.rango(-3, 3);
      const z = j * 18 + rng.rango(-3, 3);
      const r = Math.hypot(x, z);
      if (r < 17 || r > radio) continue;
      parcelas.push({ x, z });
    }
  }
  for (let k = parcelas.length - 1; k > 0; k--) {
    const m = Math.floor(rng.siguiente() * (k + 1));
    [parcelas[k], parcelas[m]] = [parcelas[m], parcelas[k]];
  }
  const sitioMolino = molino ? parcelas.pop()! : null;
  for (const p of parcelas.slice(0, nCasas)) {
    const ancho = rng.siguiente() < 0.55 ? 8 : 12;
    const fondo = rng.siguiente() < 0.6 ? 8 : 10;
    // de cara a la plaza, con algo de desorden
    const haciaPlaza = Math.atan2(-p.x, -p.z);
    const rotY = Math.round(haciaPlaza / (Math.PI / 2)) * (Math.PI / 2) + rng.rango(-0.12, 0.12);
    const pendiente = THREE.MathUtils.degToRad(rng.rango(50, 58));
    const subida = (fondo / 2) * Math.tan(pendiente);
    const plantas = rng.entero(1, 2);
    const casa: Casa = { x: o.x + p.x, z: o.z + p.z, ancho, fondo, rotY, alturaAlero: ZOCALO + plantas * PLANTA, alturaCumbrera: ZOCALO + plantas * PLANTA + subida };
    const estado = rng.siguiente();
    if (estado < 0.4) {
      construirCasa(casa, plantas, subida, rng, o, o.fisica);
      o.plano.edificios.push({ x: casa.x, z: casa.z, ancho, fondo, rotY });
    } else construirRuina(o, casa, estado > 0.72, rng);
  }
  // pozo en la plaza
  const pozo = new THREE.CylinderGeometry(1.8, 2, 1.1, 16);
  escalarUV(pozo, 5, 0.6);
  o.piedra.añadir(pozo, o.m(0, 0.55, 0), new THREE.Color('#bdb5a6'));
  o.fisica.cilindro({ x: o.x, y: 0.55, z: o.z }, 0.55, 2, 'otro');
  o.plano.torres.push({ x: o.x, z: o.z, r: 2 });
  if (sitioMolino) construirMolino(o, sitioMolino.x, sitioMolino.z, rng);
}

// ───────────────────────── Castillo de Utgard ─────────────────────────

function construirCastillo(o: Obra, rng: Rng): void {
  const piedra = COLOR.piedraCastillo;
  const A = 38; // medio largo del recinto (x local)
  const B = 30; // medio fondo (z local)
  const G = 2.6; // grosor de muro
  const H = 10;
  // Muros del recinto por tramos: [desde, hasta, altura] a lo largo de cada lado (−1..1)
  const lados: { eje: 'x' | 'z'; fijo: number; tramos: [number, number, number][] }[] = [
    { eje: 'x', fijo: -B, tramos: [[-1, -0.35, H], [-0.35, -0.05, 3.2], [0.15, 1, H]] }, // norte, con brecha
    { eje: 'x', fijo: B, tramos: [[-1, -0.16, H], [0.16, 1, H]] }, // sur, con la puerta
    { eje: 'z', fijo: A, tramos: [[-1, 0.2, H * 0.9], [0.2, 0.55, 2.4], [0.55, 1, H]] }, // este, medio caído
    { eje: 'z', fijo: -A, tramos: [[-1, 1, H]] }, // oeste
  ];
  for (const lado of lados) {
    const mitad = lado.eje === 'x' ? A : B;
    for (const [a, b, alto] of lado.tramos) {
      const largo = (b - a) * mitad;
      const centro = ((a + b) / 2) * mitad;
      const lx = lado.eje === 'x' ? centro : lado.fijo;
      const lz = lado.eje === 'x' ? lado.fijo : centro;
      const rot = lado.eje === 'x' ? 0 : Math.PI / 2;
      o.bloque(o.piedra, largo, alto, G, lx, 0, lz, rot, piedra.clone().multiplyScalar(rng.rango(0.9, 1)));
      // almenas sobre los tramos enteros
      if (alto >= H * 0.9) {
        for (let s = -largo / 2 + 1; s < largo / 2 - 0.5; s += 2.4) {
          const mx = lado.eje === 'x' ? centro + s : lado.fijo;
          const mz = lado.eje === 'x' ? lado.fijo : centro + s;
          o.bloque(o.piedra, 1.2, 1.3, G * 0.6, mx, alto, mz, rot, piedra, { huella: false, colision: false });
        }
      }
      if (alto < H * 0.5) o.escombros(rng, lx, lz + (lado.eje === 'x' ? Math.sign(lado.fijo) * 4 : 0), largo * 0.4, 10);
    }
  }
  // Torreones en las esquinas (uno derrumbado)
  const esquinas: [number, number, number][] = [
    [-A, -B, 16],
    [A, -B, 16],
    [A, B, 6.5],
    [-A, B, 16],
  ];
  for (const [x, z, alto] of esquinas) {
    o.cilindro(o.piedra, 4.6, 4.2, alto, x, 0, z, piedra.clone().multiplyScalar(0.95));
    if (alto < 10) o.escombros(rng, x + 3, z + 3, 7, 12);
  }
  // Torre del homenaje (~38 m): cuerpo, cornisa, almenas y un piso alto medio derruido
  const tx = -14;
  const tz = -8;
  const L = 13;
  const altoTorre = 32;
  o.bloque(o.piedra, L, altoTorre, L, tx, 0, tz, 0, piedra.clone().multiplyScalar(0.97));
  o.bloque(o.piedra, L + 1, 0.8, L + 1, tx, altoTorre, tz, 0, piedra.clone().multiplyScalar(0.8), { huella: false });
  for (let k = 0; k < 4; k++) {
    // parapeto de cada lado; el del este, caído
    if (k === 1) continue;
    const ang = (k * Math.PI) / 2;
    const dx = Math.sin(ang) * (L / 2);
    const dz = Math.cos(ang) * (L / 2);
    for (let s = -L / 2 + 0.8; s <= L / 2 - 0.8; s += 2.2) {
      o.bloque(o.piedra, 1.3, 1.6, 0.9, tx + dx + Math.cos(ang) * s, altoTorre + 0.8, tz + dz - Math.sin(ang) * s, ang, piedra, { huella: false, colision: s === -L / 2 + 0.8 });
    }
  }
  // piso alto en ruinas: dos muros en L, uno más bajo
  o.bloque(o.piedra, L, 6, 1.4, tx, altoTorre + 0.8, tz - L / 2 + 0.7, 0, piedra.clone().multiplyScalar(0.92), { huella: false });
  o.bloque(o.piedra, 1.4, 3.6, L * 0.6, tx - L / 2 + 0.7, altoTorre + 0.8, tz - L * 0.2, 0, piedra.clone().multiplyScalar(0.92), { huella: false });
  // saeteras y puerta
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const dx = Math.sin(ang) * (L / 2 + 0.03);
    const dz = Math.cos(ang) * (L / 2 + 0.03);
    for (const y of [8, 15, 22, 28]) o.madera.añadir(cajaUV(0.7, 2.2, 0.08, 1), o.m(tx + dx, y, tz + dz, ang), COLOR.oscuro);
  }
  o.madera.añadir(cajaUV(2.4, 3.8, 0.1, 1), o.m(tx, 1.9, tz + L / 2 + 0.06), new THREE.Color('#2a1d14'));
  // nave arruinada dentro del recinto
  const nave: Casa = { x: o.mundo(14, 6).x, z: o.mundo(14, 6).z, ancho: 12, fondo: 10, rotY: o.rot, alturaAlero: ZOCALO + 2 * PLANTA, alturaCumbrera: 12 };
  construirRuina(o, nave, true, rng);
  o.escombros(rng, 0, B + 4, 6, 8);
}

// ───────────────────────── Puestos y campamento ─────────────────────────

function construirCarro(o: Obra, lx: number, lz: number, rot: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const p = (ax: number, az: number) => ({ x: lx + ax * c + az * s, z: lz - ax * s + az * c });
  o.bloque(o.madera, 2.2, 0.9, 4.4, lx, 0.9, lz, rot, COLOR.maderaCarro);
  for (const [ax, az] of [[-1.2, -1.4], [1.2, -1.4], [-1.2, 1.4], [1.2, 1.4]]) {
    const q = p(ax, az);
    o.madera.añadir(new THREE.CylinderGeometry(0.7, 0.7, 0.16, 12).rotateZ(Math.PI / 2), o.m(q.x, 0.7, q.z, rot), COLOR.rueda);
  }
  const lona = new THREE.CylinderGeometry(1.25, 1.25, 4, 10, 1, true, -Math.PI / 2, Math.PI);
  lona.rotateX(-Math.PI / 2);
  o.madera.añadir(lona, o.m(lx, 1.8, lz, rot), COLOR.lona);
  const vara = p(0, 3.6);
  o.madera.añadir(cajaUV(0.15, 0.15, 3, 1), o.m(vara.x, 0.8, vara.z, rot), COLOR.rueda);
}

function construirTienda(o: Obra, lx: number, lz: number, rot: number, ancho: number, fondo: number, alto: number, color: THREE.Color): void {
  const t = tejadoDosAguas(fondo, ancho, alto, 0.15, { u: 2, v: 2, baseV: 0 });
  o.madera.añadir(t.faldones, o.m(lx, 0, lz, rot), color);
  o.madera.añadir(t.hastiales, o.m(lx, 0, lz, rot), color.clone().multiplyScalar(0.85));
  const p = o.mundo(lx, lz);
  o.fisica.caja({ x: p.x, y: alto / 3, z: p.z }, { x: fondo / 2, y: alto / 3, z: ancho / 2 }, 'edificio', o.rot + rot);
  o.plano.edificios.push({ x: p.x, z: p.z, ancho: fondo, fondo: ancho, rotY: o.rot + rot });
}

/** Estandarte con las alas de la libertad. */
function construirEstandarte(o: Obra, lx: number, lz: number): void {
  o.madera.añadir(cajaUV(0.22, 9, 0.22, 1), o.m(lx, 4.5, lz), COLOR.poste);
  o.madera.añadir(cajaUV(0.06, 1.9, 2.6, 1), o.m(lx, 7.7, lz + 1.4), COLOR.bandera);
  for (const lado of [-1, 1]) {
    const g = new THREE.PlaneGeometry(1.7, 1.7);
    g.rotateY((lado * Math.PI) / 2);
    o.emblemas.añadir(g, o.m(lx + lado * 0.05, 7.7, lz + 1.4), new THREE.Color(1, 1, 1));
  }
  const p = o.mundo(lx, lz);
  o.fisica.cilindro({ x: p.x, y: 4.5, z: p.z }, 4.5, 0.2, 'otro');
}

/** Cajas y barriles de gas: el punto de recarga. */
function construirSuministros(o: Obra, lx: number, lz: number, rng: Rng): void {
  for (let k = 0; k < 8; k++) {
    const s = rng.rango(1.0, 1.4);
    const apilada = k > 5 ? s : 0;
    o.madera.añadir(cajaUV(s, s, s, 1), o.m(lx + rng.rango(-2.4, 2.4), s / 2 + apilada, lz + rng.rango(-1.8, 1.8), rng.rango(0, 1)), COLOR.caja.clone().multiplyScalar(rng.rango(0.8, 1.1)));
  }
  for (let k = 0; k < 5; k++) {
    o.madera.añadir(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), o.m(lx - 3.4 + k * 1.05, 0.6, lz + 3), COLOR.barril);
  }
  const p = o.mundo(lx, lz);
  o.fisica.caja({ x: p.x, y: 0.7, z: p.z }, { x: 3, y: 0.7, z: 2.4 }, 'otro', o.rot);
  o.plano.edificios.push({ x: p.x, z: p.z, ancho: 6, fondo: 5, rotY: o.rot });
}

function construirPuesto(o: Obra, rng: Rng, antorchas: Antorchas): void {
  construirSuministros(o, 0, 0, rng);
  construirCarro(o, -7, 2, 0.3);
  construirTienda(o, 6, -5, 0.2, 4.5, 5.5, 3.2, COLOR.lonaVerde);
  construirEstandarte(o, 3, 5);
  const f = o.mundo(-3, -6);
  antorchas.farol(f.x, 0, f.z);
}

function construirCampamento(o: Obra, rng: Rng, antorchas: Antorchas): void {
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const lx = Math.sin(a) * 17;
    const lz = Math.cos(a) * 17;
    construirTienda(o, lx, lz, a + Math.PI / 2, 4.2, 6, 3.4, k % 2 ? COLOR.lona : COLOR.lonaVerde);
  }
  // hoguera con piedras en corro y troncos
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    o.piedra.añadir(cajaUV(0.6, 0.4, 0.5, 1), o.m(Math.cos(a) * 1.6, 0.2, Math.sin(a) * 1.6, a), new THREE.Color('#8f8a80'));
  }
  for (let k = 0; k < 3; k++) o.madera.añadir(cajaUV(0.25, 0.25, 2.2, 1), o.m(0, 0.25, 0, (k * Math.PI) / 3), COLOR.carbon);
  construirSuministros(o, 0, 8, rng);
  construirCarro(o, -9, -4, 1.2);
  construirCarro(o, 10, -6, -0.8);
  construirEstandarte(o, -4, 6);
  construirEstandarte(o, 5, -9);
  for (const [x, z] of [[3, 3], [-3, -3], [8, 10]]) {
    const p = o.mundo(x, z);
    antorchas.farol(p.x, 0, p.z);
  }
}

// ───────────────────────── Río, puente y caminos ─────────────────────────

/** Cinta de ancho constante sobre el suelo a lo largo de una polilínea (UV en metros / mosaico). */
function cinta(puntos: PuntoXZ[], ancho: number, y: number, mosaico: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let largo = 0;
  for (let i = 0; i < puntos.length; i++) {
    const a = puntos[Math.max(0, i - 1)];
    const b = puntos[Math.min(puntos.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l;
    const nz = tx / l;
    if (i > 0) largo += Math.hypot(puntos[i].x - puntos[i - 1].x, puntos[i].z - puntos[i - 1].z);
    const p = puntos[i];
    pos.push(p.x + (nx * ancho) / 2, y, p.z + (nz * ancho) / 2, p.x - (nx * ancho) / 2, y, p.z - (nz * ancho) / 2);
    uv.push(0, largo / mosaico, ancho / mosaico, largo / mosaico);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // la cinta puede quedar del revés según el sentido del trazado: normales siempre hacia arriba
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function construirPuente(o: Obra, largoAgua: number): void {
  const piedra = new THREE.Color('#c2baa9');
  const alto = 5.2;
  const ancho = 7;
  const tablero = largoAgua + 8;
  const rampa = 16;
  // tablero y pretiles (local z = a lo largo del camino)
  o.bloque(o.piedra, ancho, 1.4, tablero, 0, alto - 1.4, 0, 0, piedra);
  for (const lado of [-1, 1]) o.bloque(o.piedra, 0.5, 1.1, tablero, (lado * (ancho - 0.5)) / 2, alto, 0, 0, piedra.clone().multiplyScalar(0.9), { huella: false });
  // pilas en el agua y estribos
  for (const z of [-tablero / 4, tablero / 4]) o.bloque(o.piedra, ancho + 1.2, alto - 1.4, 3, 0, 0, z, 0, piedra.clone().multiplyScalar(0.85), { huella: false });
  for (const lado of [-1, 1]) o.bloque(o.piedra, ancho + 1.6, alto - 1.4, 3, 0, 0, (lado * (tablero - 3)) / 2, 0, piedra.clone().multiplyScalar(0.85), { huella: false });
  // rampas de subida
  const incl = Math.atan2(alto, rampa);
  const largoRampa = Math.hypot(alto, rampa);
  for (const lado of [-1, 1]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lado * incl);
    const lz = lado * (tablero / 2 + rampa / 2);
    o.piedra.añadir(cajaUV(ancho, 0.8, largoRampa, 2), o.m(0, alto / 2 - 0.4, lz, 0, q), piedra);
    const p = o.mundo(0, lz);
    const qm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot).multiply(q);
    o.fisica.caja({ x: p.x, y: alto / 2 - 0.4, z: p.z }, { x: ancho / 2, y: 0.4, z: largoRampa / 2 }, 'edificio', qm);
  }
  o.plano.edificios.push({ x: o.x, z: o.z, ancho, fondo: tablero + 2 * rampa, rotY: o.rot });
}

// ───────────────────────── Ensamblado ─────────────────────────

export function construirLugares(escena: THREE.Scene, fisica: Fisica, mats: Materiales, antorchas: Antorchas, semilla: number): DatosLugares {
  const rio = curva(RIO_CONTROL, 10);
  const caminos = CAMINOS_CONTROL.map((c) => curva(c, 6));
  const plano: Plano = { rio, anchoRio: ANCHO_RIO, caminos, edificios: [], torres: [] };
  const emblemas = new Lote();
  const lugares: Lugar[] = [];
  const depositos: DatosLugares['depositos'] = [];
  const obra = (id: IdLugar, tipo: TipoLugar, rot: number, hacer: (o: Obra, rng: Rng) => void): Obra => {
    const def = LUGARES[id];
    const o = new Obra(def.x, def.z, rot, fisica, plano, emblemas);
    hacer(o, crearRng(semilla + id.length * 977 + Math.round(def.x)));
    o.terminar(escena, mats);
    lugares.push({ id, nombre: def.nombre, tipo, pos: new THREE.Vector3(def.x, 0, def.z), radio: def.radio, descubierto: false });
    return o;
  };

  obra('pastores', 'aldea', 0, (o, rng) => construirAldea(o, rng, 66, 11, false));
  obra('molino', 'aldea', 0, (o, rng) => construirAldea(o, rng, 66, 10, true));
  obra('utgard', 'castillo', 0.35, (o, rng) => construirCastillo(o, rng));
  for (const id of ['puestoOeste', 'puestoSur', 'puestoEste'] as const) {
    const o = obra(id, 'puesto', 0.4 + id.length, (o, rng) => construirPuesto(o, rng, antorchas));
    depositos.push({ pos: new THREE.Vector3(o.x, 0, o.z), nombre: LUGARES[id].nombre });
  }
  const camp = obra('campamento', 'campamento', 0.2, (o, rng) => construirCampamento(o, rng, antorchas));
  const dep = camp.mundo(0, 8);
  depositos.push({ pos: new THREE.Vector3(dep.x, 0, dep.z), nombre: LUGARES.campamento.nombre });

  // Puente: donde el camino del sur cruza el río (el punto del camino más cercano al agua)
  const pc = LUGARES.puente;
  const sur = CAMINOS_CONTROL[0];
  const i = sur.findIndex((p) => p.x === pc.x && p.z === pc.z);
  const a = sur[i - 1];
  const b = sur[i + 1];
  let mejor: { x: number; z: number; d: number } = { x: pc.x, z: pc.z, d: Infinity };
  for (let t = 0; t <= 1; t += 0.002) {
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const d = distanciaPolilinea(x, z, rio);
    if (d < mejor.d) mejor = { x, z, d };
  }
  const puente = new Obra(mejor.x, mejor.z, Math.atan2(b.x - a.x, b.z - a.z), fisica, plano, emblemas);
  construirPuente(puente, ANCHO_RIO + 6);
  puente.terminar(escena, mats);
  lugares.push({ id: 'puente', nombre: pc.nombre, tipo: 'puente', pos: new THREE.Vector3(mejor.x, 0, mejor.z), radio: pc.radio, descubierto: false });

  escena.add(emblemas.crearMesh(new THREE.MeshLambertMaterial({ map: texturaEmblema(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }), false));

  // Agua y orillas
  const agua = texturaAgua();
  const matAgua = new THREE.MeshPhongMaterial({ map: agua, color: '#9fb8bf', specular: '#a8c4d0', shininess: 70, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const aguaM = new THREE.Mesh(cinta(rio, ANCHO_RIO, 0.06, 16), matAgua);
  aguaM.receiveShadow = true;
  const orillas = new THREE.Mesh(cinta(rio, ANCHO_RIO + 12, 0.05, 8), mats.camino);
  orillas.receiveShadow = true;
  escena.add(aguaM, orillas);

  // Caminos de tierra (cortados donde cruzan el agua: ahí está el puente)
  const enRio = (p: PuntoXZ) => distanciaPolilinea(p.x, p.z, rio) < ANCHO_RIO / 2 + 4;
  for (const c of caminos) {
    let tramo: PuntoXZ[] = [];
    const cerrar = () => {
      if (tramo.length > 1) {
        const m = new THREE.Mesh(cinta(tramo, 7, 0.045, 8), mats.camino);
        m.receiveShadow = true;
        escena.add(m);
      }
      tramo = [];
    };
    for (const p of c) {
      if (enRio(p)) cerrar();
      else tramo.push(p);
    }
    cerrar();
  }

  const despejado = (x: number, z: number, margen: number) => {
    if (distanciaPolilinea(x, z, rio) < ANCHO_RIO / 2 + margen) return false;
    for (const c of caminos) if (distanciaPolilinea(x, z, c) < 4 + margen) return false;
    for (const l of lugares) if (Math.hypot(x - l.pos.x, z - l.pos.z) < l.radio + margen) return false;
    return true;
  };
  return { lugares, depositos, plano, agua, despejado };
}
