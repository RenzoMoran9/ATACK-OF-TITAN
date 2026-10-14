import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ikDosHuesos } from '../player/poses';
import { texturaCaraTitan } from '../world/texturas';

/**
 * Modelo articulado de titán puro (guía visual: piel carne pálida, sin ropa ni detalles
 * anatómicos, cabeza grande, sonrisa fija exagerada, ojos abiertos sin expresión,
 * proporciones deformes). Mira a +Z, pies en el origen, todo en metros.
 *
 * Jerarquía: raíz → pelvis → [torso → (cuello → cabeza → boca), hombros → codos → manos]
 *                         → caderas → rodillas → tobillos
 */

export interface Proporciones {
  cadera: number;
  muslo: number;
  radioPierna: number;
  anchoCadera: number;
  /** Silueta del torso (radio, altura) en fracciones de H, para el torno. */
  perfil: [number, number][];
  profundidad: number;
  hombroY: number;
  hombroX: number;
  cuelloAlto: number;
  radioCabeza: number;
  brazo: number;
  radioBrazo: number;
}

/** Dos complexiones deformes (fracciones de la altura). */
export const COMPLEXIONES: Proporciones[] = [
  {
    // larguirucho: torso largo, piernas cortas, cabeza enorme
    cadera: 0.34, muslo: 0.17, radioPierna: 0.058, anchoCadera: 0.075,
    perfil: [[0, 0.3], [0.09, 0.305], [0.125, 0.33], [0.135, 0.37], [0.125, 0.43], [0.13, 0.48], [0.148, 0.54], [0.162, 0.6], [0.166, 0.64], [0.14, 0.672], [0.075, 0.69], [0, 0.692]],
    profundidad: 0.66,
    hombroY: 0.655, hombroX: 0.17, cuelloAlto: 0.05,
    radioCabeza: 0.13, brazo: 0.34, radioBrazo: 0.034,
  },
  {
    // barrigón: piernas muy cortas, tripa enorme, cabeza aún más grande
    cadera: 0.26, muslo: 0.13, radioPierna: 0.072, anchoCadera: 0.085,
    perfil: [[0, 0.22], [0.1, 0.225], [0.16, 0.25], [0.2, 0.29], [0.215, 0.35], [0.205, 0.41], [0.18, 0.47], [0.168, 0.52], [0.165, 0.56], [0.125, 0.592], [0.06, 0.606], [0, 0.608]],
    profundidad: 0.82,
    hombroY: 0.578, hombroX: 0.16, cuelloAlto: 0.032,
    radioCabeza: 0.165, brazo: 0.27, radioBrazo: 0.043,
  },
];

/**
 * Cambiantes (Acorazado, Hembra): proporciones humanas, piernas largas y cabeza pequeña,
 * nada que ver con los puros deformes.
 */
export const COMPLEXION_CAMBIANTE: Proporciones = {
  cadera: 0.5, muslo: 0.245, radioPierna: 0.05, anchoCadera: 0.06,
  perfil: [[0, 0.46], [0.07, 0.47], [0.085, 0.52], [0.08, 0.58], [0.095, 0.66], [0.115, 0.74], [0.12, 0.79], [0.1, 0.82], [0.05, 0.84], [0, 0.842]],
  profundidad: 0.6,
  hombroY: 0.81, hombroX: 0.13, cuelloAlto: 0.04,
  radioCabeza: 0.068, brazo: 0.42, radioBrazo: 0.03,
};

/** Varía una complexión con la semilla (±8 %) para que no haya dos iguales. */
export function variarProporciones(base: Proporciones, azar: () => number): Proporciones {
  const v = (x: number, f = 0.08) => x * (1 + (azar() - 0.5) * 2 * f);
  const ensanche = v(1, 0.1);
  return {
    ...base,
    radioCabeza: v(base.radioCabeza, 0.1),
    brazo: v(base.brazo, 0.1),
    radioBrazo: v(base.radioBrazo),
    radioPierna: v(base.radioPierna),
    perfil: base.perfil.map(([r, y]) => [r * ensanche, y] as [number, number]),
    profundidad: v(base.profundidad, 0.06),
  };
}

export interface AspectoTitan {
  piel: string;
  pelo: string | null;
  cara: 0 | 1;
}

/** Ángulos que aplica el modelo (radianes; desplazamientos en metros). */
export interface PoseTitan {
  pelvisY: number;
  pelvisX: number;
  pelvisZ: number;
  torsoX: number;
  torsoY: number;
  torsoZ: number;
  cabezaX: number;
  cabezaY: number;
  cabezaZ: number;
  boca: number;
  cadera: [number, number];
  caderaZ: [number, number];
  rodilla: [number, number];
  tobillo: [number, number];
  hombroX: [number, number];
  hombroZ: [number, number];
  codo: [number, number];
  /** Objetivo de IK para la mano (en mundo); si está, sustituye a hombro/codo. */
  ikMano: [THREE.Vector3 | null, THREE.Vector3 | null];
  /** Objetivo de IK para el pie (en mundo, a cuatro patas); si está, sustituye a cadera/rodilla/tobillo. */
  ikPie: [THREE.Vector3 | null, THREE.Vector3 | null];
  /** Caída al morir (rotación de la raíz hacia delante). */
  caida: number;
  /** Caída de lado (rotación de la raíz sobre su eje delantero; el cuadrúpedo muere así). */
  caidaLado: number;
}

export function poseReposo(): PoseTitan {
  return {
    pelvisY: 0, pelvisX: 0, pelvisZ: 0,
    torsoX: 0.07, torsoY: 0, torsoZ: 0,
    cabezaX: 0, cabezaY: 0, cabezaZ: 0.12,
    boca: 0,
    cadera: [-0.05, -0.05], caderaZ: [0.04, -0.04], rodilla: [0.1, 0.1], tobillo: [-0.05, -0.05],
    hombroX: [-0.1, -0.1], hombroZ: [0.12, -0.12], codo: [-0.15, -0.15],
    ikMano: [null, null],
    ikPie: [null, null],
    caida: 0,
    caidaLado: 0,
  };
}

export interface Segmento {
  /** Marco del colisionador: su eje Y local es el del hueso. */
  marco: THREE.Object3D;
  forma: 'capsula' | 'bola';
  radio: number;
  mitadAltura: number;
  etiqueta: 'titan' | 'nuca';
}

const ABAJO = new THREE.Vector3(0, -1, 0);

function elipsoide(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 20, 14).scale(rx, ry, rz);
}

/** Cápsula de longitud total `largo` colgando hacia −Y desde el origen. */
function capsulaColgante(largo: number, r: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, Math.max(0.01, largo - 2 * r), 6, 12).translate(0, -largo / 2, 0);
}

export class ModeloTitan {
  readonly raiz = new THREE.Group();
  readonly pelvis = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly cuello = new THREE.Group();
  readonly cabeza = new THREE.Group();
  private readonly boca = new THREE.Group();
  private readonly dientesAbajo: THREE.Mesh;
  readonly hombros: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  readonly codos: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  readonly manos: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  readonly antebrazos: THREE.Object3D[] = [];
  readonly caderas: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  readonly rodillas: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  readonly tobillos: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  readonly segmentos: Segmento[] = [];
  readonly piel: THREE.MeshLambertMaterial;
  private readonly pielSombra: THREE.MeshLambertMaterial;
  private readonly colorPiel: THREE.Color;
  /** Longitudes en metros. */
  readonly L: { muslo: number; espinilla: number; brazo: number; antebrazo: number; rc: number; cadera: number; hombroY: number };
  private readonly geometrias: THREE.BufferGeometry[] = [];
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  constructor(readonly H: number, readonly p: Proporciones, aspecto: AspectoTitan) {
    this.colorPiel = new THREE.Color(aspecto.piel);
    this.piel = new THREE.MeshLambertMaterial({ color: this.colorPiel.clone() });
    this.pielSombra = new THREE.MeshLambertMaterial({ color: this.colorPiel.clone().multiplyScalar(0.92) });
    const g = <T extends THREE.BufferGeometry>(x: T): T => {
      this.geometrias.push(x);
      return x;
    };
    const malla = (geo: THREE.BufferGeometry, mat: THREE.Material, padre: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(g(geo), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      padre.add(m);
      return m;
    };
    const marco = (padre: THREE.Object3D, y: number, forma: Segmento['forma'], radio: number, mitadAltura: number, etiqueta: Segmento['etiqueta'] = 'titan') => {
      const o = new THREE.Object3D();
      o.position.y = y;
      padre.add(o);
      this.segmentos.push({ marco: o, forma, radio, mitadAltura, etiqueta });
      return o;
    };

    const caderaY = p.cadera * H;
    const muslo = p.muslo * H;
    const espinilla = (p.cadera - p.muslo - 0.035) * H;
    const brazo = p.brazo * 0.5 * H;
    const antebrazo = p.brazo * 0.5 * H;
    const rc = p.radioCabeza * H;
    const hombroY = p.hombroY * H;
    this.L = { muslo, espinilla, brazo, antebrazo, rc, cadera: caderaY, hombroY };

    // guiñada primero: la caída es hacia delante del titán, no hacia el norte
    this.raiz.rotation.order = 'YXZ';
    this.raiz.add(this.pelvis);
    this.pelvis.position.y = caderaY;

    // ── Piernas cortas ──
    for (let i = 0; i < 2; i++) {
      const lado = i === 0 ? 1 : -1;
      const cad = this.caderas[i];
      cad.position.set(lado * p.anchoCadera * H, 0.01 * H, 0);
      this.pelvis.add(cad);
      malla(capsulaColgante(muslo + p.radioPierna * H * 0.5, p.radioPierna * H), this.piel, cad);
      marco(cad, -muslo / 2, 'capsula', p.radioPierna * H, Math.max(0.05, muslo / 2 - p.radioPierna * H * 0.5));
      const rod = this.rodillas[i];
      rod.position.y = -muslo;
      cad.add(rod);
      malla(capsulaColgante(espinilla + p.radioPierna * H * 0.4, p.radioPierna * 0.8 * H), this.piel, rod, 0, p.radioPierna * H * 0.3, 0);
      marco(rod, -espinilla / 2, 'capsula', p.radioPierna * 0.8 * H, Math.max(0.05, espinilla / 2 - p.radioPierna * 0.4 * H));
      const tob = this.tobillos[i];
      tob.position.y = -espinilla;
      rod.add(tob);
      malla(elipsoide(0.04 * H, 0.025 * H, 0.075 * H), this.pielSombra, tob, 0, -0.01 * H, 0.035 * H);
    }

    // ── Torso de torno, cuello y cabeza enorme ──
    this.pelvis.add(this.torso);
    const torsoMalla = malla(new THREE.LatheGeometry(p.perfil.map(([r, y]) => new THREE.Vector2(r * H, (y - p.cadera) * H)), 28), this.piel, this.torso);
    torsoMalla.scale.z = p.profundidad;
    const rTorso = Math.max(...p.perfil.map(([r]) => r)) * H * 0.85;
    const altoTorso = hombroY - caderaY;
    marco(this.torso, altoTorso / 2, 'capsula', rTorso, Math.max(0.05, altoTorso / 2 - rTorso * 0.5));

    this.cuello.position.set(0, hombroY - caderaY, -0.01 * H);
    this.torso.add(this.cuello);
    malla(new THREE.CylinderGeometry(0.048 * H, 0.06 * H, (p.cuelloAlto + 0.05) * H, 16), this.piel, this.cuello, 0, (p.cuelloAlto / 2 + 0.01) * H, 0);
    // la nuca: colisionador propio para engancharse a ella
    const escalaNuca = Math.sqrt(H / 10);
    const nuca = marco(this.cuello, p.cuelloAlto * 0.7 * H, 'bola', 0.3 * escalaNuca + 0.2, 0, 'nuca');
    nuca.position.z = -0.055 * H;

    this.cabeza.position.set(0, p.cuelloAlto * H + rc * 0.95, 0.02 * H);
    this.cuello.add(this.cabeza);
    const craneo = malla(new THREE.SphereGeometry(rc, 30, 22), this.piel, this.cabeza);
    craneo.scale.set(1, 1.12, 1.02);
    marco(this.cabeza, 0, 'bola', rc * 1.05, 0);
    const cara = malla(
      new THREE.SphereGeometry(rc * 1.012, 30, 22, Math.PI / 2 - 1.05, 2.1, 0.62, 1.95),
      new THREE.MeshLambertMaterial({ map: texturaCaraTitan(aspecto.cara), transparent: true, alphaTest: 0.08, depthWrite: false }),
      this.cabeza,
    );
    cara.scale.copy(craneo.scale);
    cara.renderOrder = 1;
    cara.castShadow = false;
    for (const lado of [-1, 1]) malla(elipsoide(0.018 * H, 0.032 * H, 0.014 * H), this.pielSombra, this.cabeza, lado * rc * 0.98, 0, -rc * 0.05);
    if (aspecto.pelo) {
      const pelo = malla(new THREE.SphereGeometry(rc * 1.04, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshLambertMaterial({ color: aspecto.pelo }), this.cabeza);
      pelo.scale.copy(craneo.scale);
      pelo.rotation.x = -0.35;
    }
    // Boca que se abre para morder: cavidad oscura y fila de dientes inferior
    this.boca.position.set(0, -0.36 * rc, 0.86 * rc);
    this.cabeza.add(this.boca);
    malla(elipsoide(0.55 * rc, 0.3 * rc, 0.18 * rc), new THREE.MeshLambertMaterial({ color: '#3a0c0a' }), this.boca);
    this.dientesAbajo = malla(new THREE.BoxGeometry(0.85 * rc, 0.09 * rc, 0.08 * rc), new THREE.MeshLambertMaterial({ color: '#efe6cf' }), this.boca, 0, -0.1 * rc, 0.12 * rc);
    malla(new THREE.BoxGeometry(0.85 * rc, 0.09 * rc, 0.08 * rc), new THREE.MeshLambertMaterial({ color: '#efe6cf' }), this.boca, 0, 0.1 * rc, 0.12 * rc);
    this.boca.scale.set(1, 0.01, 1);
    this.boca.visible = false;

    // ── Brazos largos y flacos ──
    for (let i = 0; i < 2; i++) {
      const lado = i === 0 ? 1 : -1;
      const hom = this.hombros[i];
      hom.position.set(lado * p.hombroX * H, hombroY - caderaY - 0.01 * H, -0.01 * H);
      this.torso.add(hom);
      malla(elipsoide(0.055 * H, 0.045 * H, 0.05 * H), this.piel, hom);
      malla(capsulaColgante(brazo + p.radioBrazo * H * 0.5, p.radioBrazo * H), this.piel, hom);
      marco(hom, -brazo / 2, 'capsula', p.radioBrazo * H * 1.2, Math.max(0.05, brazo / 2 - p.radioBrazo * H * 0.5));
      const codo = this.codos[i];
      codo.position.y = -brazo;
      hom.add(codo);
      const ante = new THREE.Group();
      codo.add(ante);
      this.antebrazos.push(ante);
      malla(capsulaColgante(antebrazo + p.radioBrazo * H * 0.4, p.radioBrazo * 0.88 * H), this.piel, ante, 0, p.radioBrazo * H * 0.3, 0);
      marco(codo, -antebrazo / 2, 'capsula', p.radioBrazo * H * 1.1, Math.max(0.05, antebrazo / 2 - p.radioBrazo * H * 0.4));
      const mano = this.manos[i];
      mano.position.y = -antebrazo;
      ante.add(mano);
      malla(elipsoide(0.03 * H, 0.05 * H, 0.025 * H), this.pielSombra, mano, 0, -0.035 * H, 0);
    }
    this.fundirPiel();
  }

  /**
   * Funde las piezas de piel que cuelgan del mismo hueso en una sola malla (mismo material, así
   * siguen grisándose al morir): muchos menos dibujos por titán, que importa en el celular.
   */
  private fundirPiel(): void {
    const huesos: THREE.Object3D[] = [];
    this.raiz.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) huesos.push(o);
    });
    for (const hueso of huesos) {
      for (const material of [this.piel, this.pielSombra]) {
        const lista = hueso.children.filter((h): h is THREE.Mesh => h instanceof THREE.Mesh && h.material === material && h.children.length === 0);
        if (lista.length < 2) continue;
        const geos = lista.map((h) => {
          h.updateMatrix();
          const g = h.geometry.index ? h.geometry.toNonIndexed() : h.geometry.clone();
          for (const nombre of Object.keys(g.attributes)) if (nombre !== 'position' && nombre !== 'normal') g.deleteAttribute(nombre);
          return g.applyMatrix4(h.matrix);
        });
        const fundida = mergeGeometries(geos);
        for (const g of geos) g.dispose();
        if (!fundida) continue;
        for (const h of lista) hueso.remove(h);
        const malla = new THREE.Mesh(fundida, material);
        malla.castShadow = true;
        malla.receiveShadow = true;
        this.geometrias.push(fundida);
        hueso.add(malla);
      }
    }
}

  /** Aplica la pose. `matrizMundoRaiz` ya debe estar al día (posición y rumbo). */
  aplicar(pose: PoseTitan): void {
    this.raiz.rotation.x = pose.caida;
    this.raiz.rotation.z = pose.caidaLado;
    this.pelvis.position.y = this.L.cadera + pose.pelvisY;
    this.pelvis.rotation.set(pose.pelvisX, 0, pose.pelvisZ);
    this.torso.rotation.set(pose.torsoX, pose.torsoY, pose.torsoZ);
    this.cabeza.rotation.set(pose.cabezaX, pose.cabezaY, pose.cabezaZ);
    this.boca.visible = pose.boca > 0.03;
    this.boca.scale.y = Math.max(0.01, pose.boca);
    this.dientesAbajo.position.y = -0.1 * this.L.rc - pose.boca * 0.25 * this.L.rc;
    for (let i = 0; i < 2; i++) {
      this.caderas[i].rotation.set(pose.cadera[i], 0, pose.caderaZ[i]);
      this.rodillas[i].rotation.set(pose.rodilla[i], 0, 0);
      this.tobillos[i].rotation.set(pose.tobillo[i], 0, 0);
      if (!pose.ikMano[i]) {
        this.hombros[i].rotation.set(pose.hombroX[i], 0, pose.hombroZ[i]);
        this.codos[i].rotation.set(pose.codo[i], 0, 0);
      }
    }
    // la IK necesita las matrices de pelvis y torso ya al día
    this.raiz.updateMatrixWorld(true);
    if (pose.ikMano[0] || pose.ikMano[1] || pose.ikPie[0] || pose.ikPie[1]) {
      for (let i = 0; i < 2; i++) {
        const mano = pose.ikMano[i];
        if (mano) this.resolverBrazo(i, mano);
        const pie = pose.ikPie[i];
        if (pie) this.resolverPierna(i, pie);
      }
      this.raiz.updateMatrixWorld(true);
    }
  }

  /**
   * IK de la pierna hacia un punto del suelo (rodilla hacia delante del titán) y pie plano:
   * las patas traseras del cuadrúpedo.
   */
  private resolverPierna(i: number, objetivo: THREE.Vector3): void {
    const cad = this.caderas[i];
    const t = this.pelvis.worldToLocal(objetivo.clone());
    const d = t.sub(cad.position);
    const h = d.length();
    if (h < 1e-4) return;
    const { raiz } = ikDosHuesos(this.L.muslo, this.L.espinilla, h);
    const dn = d.clone().divideScalar(h);
    // polo: hacia delante del titán (en mundo), pasado al marco de la pelvis
    const qPelvis = this.pelvis.getWorldQuaternion(this.tmpQ).invert();
    const polo = new THREE.Vector3(0, 0.2, 1).applyQuaternion(this.raiz.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(qPelvis).normalize();
    const eje = new THREE.Vector3().crossVectors(dn, polo);
    if (eje.lengthSq() < 1e-6) eje.set(1, 0, 0);
    eje.normalize();
    const u = dn.clone().applyAxisAngle(eje, raiz);
    cad.quaternion.setFromUnitVectors(ABAJO, u);
    const rodillaPos = cad.position.clone().addScaledVector(u, this.L.muslo);
    const w = d.clone().add(cad.position).sub(rodillaPos).normalize();
    const wLocal = w.applyQuaternion(new THREE.Quaternion().copy(cad.quaternion).invert());
    this.rodillas[i].quaternion.setFromUnitVectors(ABAJO, wLocal);
    // pie plano: deshace la rotación acumulada de pelvis, cadera y rodilla
    const acumulada = new THREE.Quaternion().setFromEuler(this.pelvis.rotation).multiply(cad.quaternion).multiply(this.rodillas[i].quaternion);
    this.tobillos[i].quaternion.copy(acumulada.invert());
  }

  /** IK de dos huesos del brazo hacia un punto del mundo (codo hacia fuera y abajo). */
  private resolverBrazo(i: number, objetivo: THREE.Vector3): void {
    const lado = i === 0 ? 1 : -1;
    const hom = this.hombros[i];
    this.torso.updateMatrixWorld(true);
    const t = this.torso.worldToLocal(objetivo.clone());
    const d = t.sub(hom.position);
    const h = d.length();
    if (h < 1e-4) return;
    const { raiz } = ikDosHuesos(this.L.brazo, this.L.antebrazo, h);
    const dn = d.clone().divideScalar(h);
    const polo = new THREE.Vector3(lado, -1, -0.6).normalize();
    const eje = new THREE.Vector3().crossVectors(dn, polo);
    if (eje.lengthSq() < 1e-6) eje.set(1, 0, 0);
    eje.normalize();
    const u = dn.clone().applyAxisAngle(eje, raiz); // el codo cae hacia el polo (fuera y abajo)
    hom.quaternion.setFromUnitVectors(ABAJO, u);
    const codoPos = hom.position.clone().addScaledVector(u, this.L.brazo);
    const w = d.clone().add(hom.position).sub(codoPos).normalize();
    // dirección del antebrazo en el marco del hombro
    const wLocal = w.applyQuaternion(this.tmpQ.copy(hom.quaternion).invert());
    this.codos[i].quaternion.setFromUnitVectors(ABAJO, wLocal);
  }

  /** Posición en mundo de la palma de la mano i. */
  posMano(i: number, destino = new THREE.Vector3()): THREE.Vector3 {
    return destino.set(0, -0.04 * this.H, 0.01 * this.H).applyMatrix4(this.manos[i].matrixWorld);
  }

  /** Punto de la boca en mundo. */
  posBoca(destino = new THREE.Vector3()): THREE.Vector3 {
    return destino.set(0, -0.36 * this.L.rc, 1.05 * this.L.rc).applyMatrix4(this.cabeza.matrixWorld);
  }

  /** Brazo amputado: el antebrazo desaparece (vuelve a crecer escalando). */
  crecimientoAntebrazo(i: number, f: number): void {
    const a = this.antebrazos[i];
    a.visible = f > 0.02;
    a.scale.setScalar(Math.max(0.02, f));
  }

  /** Al morir: la carne se desatura y oscurece mientras se evapora. */
  evaporacion(f: number): void {
    const gris = new THREE.Color('#8a7f78');
    this.piel.color.copy(this.colorPiel).lerp(gris, f);
    this.pielSombra.color.copy(this.colorPiel).multiplyScalar(0.92).lerp(gris, f);
    const s = 1 - 0.25 * f;
    this.raiz.scale.set(s, 1 - 0.45 * f, s);
  }

  liberar(): void {
    for (const g of this.geometrias) g.dispose();
    this.piel.dispose();
    this.pielSombra.dispose();
    this.raiz.removeFromParent();
  }

  get centroCabeza(): THREE.Vector3 {
    return this.cabeza.getWorldPosition(this.tmpV);
  }
}
