import * as THREE from 'three';
import { colorear, fusionar } from '../world/geometria';
import type { AspectoCivil } from './logicaCivil';

/**
 * Modelo low-poly de los aldeanos con InstancedMesh: cada pieza (piernas, túnica, falda,
 * delantal, brazos, manos, cabeza, pelo, pañuelo, gorro, moño, bastón) es una sola malla
 * instanciada para todos los civiles → ~12 llamadas de dibujo para 200 civiles.
 * Medidas de un adulto de 1,7 m (pies en y = 0, mirando a +Z); cada civil se escala.
 */

export interface PoseCivil {
  /** Pies en mundo. */
  pies: THREE.Vector3;
  rumbo: number;
  /** Bote vertical al andar/correr (m). */
  bote: number;
  /** Inclinación del torso hacia delante (rad). */
  inclinacion: number;
  /** Caída hacia delante girando sobre los pies (rad, π/2 = de bruces). */
  caida: number;
  /** Zancada (rad, + = hacia delante). */
  piernaIzq: number;
  piernaDer: number;
  /** Brazo hacia delante (rad, π/2 = horizontal). */
  brazoIzq: number;
  brazoDer: number;
  /** Separación lateral de los brazos (rad). */
  abrirIzq: number;
  abrirDer: number;
  cabezaGiro: number;
  /** + = mira hacia arriba. */
  cabezaAlzada: number;
}

export function poseNeutra(): PoseCivil {
  return {
    pies: new THREE.Vector3(),
    rumbo: 0,
    bote: 0,
    inclinacion: 0,
    caida: 0,
    piernaIzq: 0,
    piernaDer: 0,
    brazoIzq: 0,
    brazoDer: 0,
    abrirIzq: 0.06,
    abrirDer: 0.06,
    cabezaGiro: 0,
    cabezaAlzada: 0,
  };
}

const CADERA = 0.92;
const HOMBRO = 0.48; // sobre la cadera
const CUELLO = 0.53; // sobre la cadera
const LARGO_BRAZO = 0.6;

type NombrePieza = 'pierna' | 'torso' | 'falda' | 'delantal' | 'brazo' | 'mano' | 'cabeza' | 'pelo' | 'panuelo' | 'gorro' | 'mono' | 'baston';

function geoPierna(): THREE.BufferGeometry {
  const muslo = colorear(new THREE.CylinderGeometry(0.068, 0.056, 0.84, 6).translate(0, -0.42, 0), new THREE.Color(1, 1, 1));
  const zapato = colorear(new THREE.BoxGeometry(0.1, 0.08, 0.2).translate(0, -0.88, 0.04), new THREE.Color(0.32, 0.27, 0.24));
  return fusionar([muslo, zapato]);
}

function geoTorso(): THREE.BufferGeometry {
  const t = new THREE.CylinderGeometry(0.2, 0.165, 0.56, 7).translate(0, 0.27, 0);
  t.scale(1, 1, 0.66);
  // cinturón/faja más oscuro
  const faja = colorear(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 7).translate(0, 0.03, 0).scale(1, 1, 0.68), new THREE.Color(0.55, 0.5, 0.45));
  return fusionar([colorear(t, new THREE.Color(1, 1, 1)), faja]);
}

function geoFalda(): THREE.BufferGeometry {
  const f = new THREE.CylinderGeometry(0.18, 0.31, 0.82, 9, 1, false).translate(0, -0.41, 0);
  f.scale(1, 1, 0.82);
  return fusionar([colorear(f, new THREE.Color(1, 1, 1))]);
}

function geoDelantal(): THREE.BufferGeometry {
  const d = new THREE.BoxGeometry(0.3, 0.62, 0.02).translate(0, -0.36, 0.0);
  d.rotateX(-0.11);
  d.translate(0, 0, 0.2);
  return fusionar([colorear(d, new THREE.Color(1, 1, 1))]);
}

function geoBrazo(): THREE.BufferGeometry {
  return fusionar([colorear(new THREE.CylinderGeometry(0.052, 0.042, LARGO_BRAZO - 0.04, 5).translate(0, -(LARGO_BRAZO - 0.04) / 2, 0), new THREE.Color(1, 1, 1))]);
}

function geoMano(): THREE.BufferGeometry {
  return fusionar([colorear(new THREE.IcosahedronGeometry(0.046, 0).translate(0, -LARGO_BRAZO + 0.02, 0.005), new THREE.Color(1, 1, 1))]);
}

function geoCabeza(): THREE.BufferGeometry {
  const cuello = colorear(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6).translate(0, 0.03, 0), new THREE.Color(0.92, 0.9, 0.9));
  const craneo = new THREE.IcosahedronGeometry(0.108, 1).scale(0.92, 1.08, 1).translate(0, 0.15, 0.005);
  const oscuro = new THREE.Color(0.18, 0.14, 0.12);
  const ojos = [-1, 1].map((s) => colorear(new THREE.BoxGeometry(0.022, 0.014, 0.012).translate(s * 0.036, 0.165, 0.098), oscuro));
  const nariz = colorear(new THREE.BoxGeometry(0.02, 0.035, 0.03).translate(0, 0.135, 0.105), new THREE.Color(0.9, 0.85, 0.82));
  return fusionar([cuello, colorear(craneo, new THREE.Color(1, 1, 1)), ...ojos, nariz]);
}

function geoPelo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.116, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.46);
  g.scale(0.96, 1.06, 1.04);
  g.rotateX(-0.5);
  g.translate(0, 0.162, -0.006);
  return fusionar([colorear(g, new THREE.Color(1, 1, 1))]);
}

function geoPanuelo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.124, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
  g.scale(1, 1.06, 1.06);
  g.rotateX(-0.75);
  g.translate(0, 0.158, -0.012);
  // nudo/pico que cae sobre la nuca
  const pico = new THREE.ConeGeometry(0.06, 0.12, 4).rotateX(Math.PI).translate(0, 0.06, -0.1);
  return fusionar([colorear(g, new THREE.Color(1, 1, 1)), colorear(pico, new THREE.Color(0.92, 0.92, 0.92))]);
}

function geoGorro(): THREE.BufferGeometry {
  const copa = new THREE.CylinderGeometry(0.115, 0.122, 0.07, 9).translate(0, 0.255, -0.01);
  const visera = new THREE.CylinderGeometry(0.08, 0.08, 0.012, 8, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 0.9).translate(0, 0.225, 0.07);
  return fusionar([colorear(copa, new THREE.Color(1, 1, 1)), colorear(visera, new THREE.Color(0.8, 0.8, 0.8))]);
}

function geoMono(): THREE.BufferGeometry {
  return fusionar([colorear(new THREE.IcosahedronGeometry(0.052, 0).translate(0, 0.205, -0.1), new THREE.Color(1, 1, 1))]);
}

function geoBaston(): THREE.BufferGeometry {
  return fusionar([colorear(new THREE.CylinderGeometry(0.016, 0.014, 0.84, 5).translate(0, -LARGO_BRAZO - 0.4, 0.04), new THREE.Color(1, 1, 1))]);
}

const CERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class ModeloCiviles {
  readonly grupo = new THREE.Group();
  private readonly piezas: Record<NombrePieza, THREE.InstancedMesh>;
  private readonly aspectos: (AspectoCivil | null)[];
  private maxUsado = 0;
  // temporales
  private readonly mRaiz = new THREE.Matrix4();
  private readonly mCuerpo = new THREE.Matrix4();
  private readonly mFalda = new THREE.Matrix4();
  private readonly mCabeza = new THREE.Matrix4();
  private readonly mTmp = new THREE.Matrix4();
  private readonly mTmp2 = new THREE.Matrix4();
  private readonly mBrazo = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly ejeY = new THREE.Vector3(0, 1, 0);

  constructor(escena: THREE.Scene, readonly capacidad = 220) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const crear = (g: THREE.BufferGeometry, porCivil: number, sombra = true): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(g, mat, capacidad * porCivil);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = sombra;
      m.receiveShadow = false;
      // las instancias se mueven: la esfera envolvente calculada una vez quedaría vieja
      m.frustumCulled = false;
      m.count = 0;
      this.grupo.add(m);
      return m;
    };
    this.piezas = {
      pierna: crear(geoPierna(), 2),
      torso: crear(geoTorso(), 1),
      falda: crear(geoFalda(), 1),
      delantal: crear(geoDelantal(), 1, false),
      brazo: crear(geoBrazo(), 2),
      mano: crear(geoMano(), 2, false),
      cabeza: crear(geoCabeza(), 1),
      pelo: crear(geoPelo(), 1, false),
      panuelo: crear(geoPanuelo(), 1, false),
      gorro: crear(geoGorro(), 1, false),
      mono: crear(geoMono(), 1, false),
      baston: crear(geoBaston(), 1, false),
    };
    this.aspectos = new Array(capacidad).fill(null);
    this.grupo.name = 'civiles';
    escena.add(this.grupo);
  }

  /** Llamadas de dibujo (para el registro de rendimiento). */
  get mallas(): number {
    return Object.keys(this.piezas).length;
  }

  private ponerColor(pieza: NombrePieza, indice: number, c: string): void {
    this.piezas[pieza].setColorAt(indice, this.color.set(c));
  }

  /** Asigna el aspecto (colores) a un hueco. */
  asignar(slot: number, a: AspectoCivil): void {
    this.aspectos[slot] = a;
    this.maxUsado = Math.max(this.maxUsado, slot + 1);
    for (const p of Object.values(this.piezas)) p.count = this.maxUsado * (p.instanceMatrix.count / this.capacidad);
    for (const k of [0, 1]) {
      this.ponerColor('pierna', slot * 2 + k, a.pantalon);
      this.ponerColor('brazo', slot * 2 + k, a.camisa);
      this.ponerColor('mano', slot * 2 + k, a.piel);
    }
    this.ponerColor('torso', slot, a.camisa);
    this.ponerColor('falda', slot, a.falda ?? '#ffffff');
    this.ponerColor('delantal', slot, a.delantal ?? '#ffffff');
    this.ponerColor('cabeza', slot, a.piel);
    this.ponerColor('pelo', slot, a.pelo);
    this.ponerColor('panuelo', slot, a.colorTocado);
    this.ponerColor('gorro', slot, a.colorTocado);
    this.ponerColor('mono', slot, a.pelo);
    this.ponerColor('baston', slot, '#5a4330');
    for (const p of Object.values(this.piezas)) if (p.instanceColor) p.instanceColor.needsUpdate = true;
    this.ocultar(slot);
  }

  /** Oculta un hueco (salvado, devorado o libre). */
  ocultar(slot: number): void {
    for (const k of [0, 1]) {
      this.piezas.pierna.setMatrixAt(slot * 2 + k, CERO);
      this.piezas.brazo.setMatrixAt(slot * 2 + k, CERO);
      this.piezas.mano.setMatrixAt(slot * 2 + k, CERO);
    }
    for (const n of ['torso', 'falda', 'delantal', 'cabeza', 'pelo', 'panuelo', 'gorro', 'mono', 'baston'] as const) this.piezas[n].setMatrixAt(slot, CERO);
  }

  liberar(slot: number): void {
    this.ocultar(slot);
    this.aspectos[slot] = null;
  }

  /** Coloca todas las piezas de un civil según su pose. */
  posar(slot: number, p: PoseCivil): void {
    const a = this.aspectos[slot];
    if (!a) return;
    const esc = a.altura / 1.7;
    // Raíz: pies + giro + escala, y caída de bruces sobre los pies
    this.q.setFromAxisAngle(this.ejeY, p.rumbo);
    this.v.set(p.pies.x, p.pies.y + p.bote, p.pies.z);
    this.s.set(esc, esc, esc);
    this.mRaiz.compose(this.v, this.q, this.s);
    if (p.caida !== 0) this.mRaiz.multiply(this.mTmp.makeRotationX(p.caida));
    // Cuerpo por encima de la cadera (inclinación + encorvado de los ancianos)
    this.mCuerpo.copy(this.mRaiz).multiply(this.mTmp.makeTranslation(0, CADERA, 0)).multiply(this.mTmp2.makeRotationX(p.inclinacion + a.encorvado));
    this.mFalda.copy(this.mRaiz).multiply(this.mTmp.makeTranslation(0, CADERA + 0.03, 0)).multiply(this.mTmp2.makeRotationX((p.inclinacion + a.encorvado) * 0.3));

    // Piernas
    const amplitudFalda = a.falda ? 0.75 : 1;
    for (const [k, lado, ang] of [[0, -1, p.piernaIzq], [1, 1, p.piernaDer]] as const) {
      this.mTmp.copy(this.mRaiz).multiply(this.mTmp2.makeTranslation(lado * 0.1, CADERA, 0)).multiply(this.mBrazo.makeRotationX(-ang * amplitudFalda));
      this.piezas.pierna.setMatrixAt(slot * 2 + k, this.mTmp);
    }
    this.piezas.torso.setMatrixAt(slot, this.mCuerpo);
    this.piezas.falda.setMatrixAt(slot, a.falda ? this.mFalda : CERO);
    this.piezas.delantal.setMatrixAt(slot, a.delantal ? this.mFalda : CERO);

    // Brazos (hombro) y manos
    for (const [k, lado, ang, abrir] of [[0, -1, p.brazoIzq, p.abrirIzq], [1, 1, p.brazoDer, p.abrirDer]] as const) {
      this.mBrazo.copy(this.mCuerpo)
        .multiply(this.mTmp.makeTranslation(lado * 0.215, HOMBRO, 0))
        .multiply(this.mTmp2.makeRotationX(-ang))
        .multiply(this.mTmp.makeRotationZ(lado * abrir));
      this.piezas.brazo.setMatrixAt(slot * 2 + k, this.mBrazo);
      this.piezas.mano.setMatrixAt(slot * 2 + k, this.mBrazo);
      if (k === 1) this.piezas.baston.setMatrixAt(slot, a.baston ? this.mBrazo : CERO);
    }

    // Cabeza y tocado
    this.mCabeza.copy(this.mCuerpo)
      .multiply(this.mTmp.makeTranslation(0, CUELLO, 0))
      .multiply(this.mTmp2.makeRotationY(p.cabezaGiro))
      .multiply(this.mTmp.makeRotationX(-p.cabezaAlzada - a.encorvado * 0.6));
    if (a.escalaCabeza !== 1) this.mCabeza.multiply(this.mTmp.makeScale(a.escalaCabeza, a.escalaCabeza, a.escalaCabeza));
    this.piezas.cabeza.setMatrixAt(slot, this.mCabeza);
    const conPelo = a.tocado === 'pelo' || a.tocado === 'mono' || a.tocado === 'gorro';
    this.piezas.pelo.setMatrixAt(slot, conPelo ? this.mCabeza : CERO);
    this.piezas.panuelo.setMatrixAt(slot, a.tocado === 'panuelo' ? this.mCabeza : CERO);
    this.piezas.gorro.setMatrixAt(slot, a.tocado === 'gorro' ? this.mCabeza : CERO);
    this.piezas.mono.setMatrixAt(slot, a.tocado === 'mono' ? this.mCabeza : CERO);
  }

  /** Sube las matrices a la GPU (una vez por fotograma). */
  finalizar(): void {
    for (const p of Object.values(this.piezas)) p.instanceMatrix.needsUpdate = true;
  }

  limpiar(): void {
    for (let i = 0; i < this.capacidad; i++) this.aspectos[i] = null;
    this.maxUsado = 0;
    for (const p of Object.values(this.piezas)) p.count = 0;
  }

  destruir(): void {
    this.grupo.parent?.remove(this.grupo);
    const geos = new Set<THREE.BufferGeometry>();
    for (const p of Object.values(this.piezas)) {
      geos.add(p.geometry);
      p.dispose();
    }
    for (const g of geos) g.dispose();
    (Object.values(this.piezas)[0].material as THREE.Material).dispose();
  }
}
