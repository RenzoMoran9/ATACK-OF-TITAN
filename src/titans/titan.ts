import * as THREE from 'three';
import type { Fisica } from '../core/fisica';
import { texturaCaraTitan } from '../world/texturas';

/**
 * Titán puro con primitivas: piel carne pálida, sin ropa ni detalles anatómicos,
 * cabeza grande, sonrisa fija exagerada y ojos abiertos sin expresión.
 * En la fase 1 solo está de pie (balanceo en reposo) como referencia de escala y
 * como superficie para enganchar los cables. La IA llega en la fase 2.
 */

export interface OpcionesTitan {
  altura: number;
  variante: 0 | 1;
  piel: string;
  pelo: string | null;
}

interface Proporciones {
  cadera: number;
  muslo: number;
  pierna: number;
  radioPierna: number;
  anchoCadera: number;
  /** Silueta del torso (radio, altura) para el torno; se aplana en Z con `profundidad`. */
  perfil: [number, number][];
  profundidad: number;
  hombroY: number;
  hombroX: number;
  cuelloAlto: number;
  radioCabeza: number;
  brazo: number;
  radioBrazo: number;
}

// Dos complexiones deformes distintas (en fracciones de la altura)
const PROPORCIONES: Proporciones[] = [
  {
    // larguirucho: torso largo, piernas cortas, cabeza enorme
    cadera: 0.34, muslo: 0.17, pierna: 0.15, radioPierna: 0.058, anchoCadera: 0.075,
    perfil: [[0, 0.3], [0.09, 0.305], [0.125, 0.33], [0.135, 0.37], [0.125, 0.43], [0.13, 0.48], [0.148, 0.54], [0.162, 0.6], [0.166, 0.64], [0.14, 0.672], [0.075, 0.69], [0, 0.692]],
    profundidad: 0.66,
    hombroY: 0.655, hombroX: 0.17, cuelloAlto: 0.05,
    radioCabeza: 0.13, brazo: 0.34, radioBrazo: 0.034,
  },
  {
    // barrigón: piernas muy cortas, tripa enorme, cabeza aún más grande
    cadera: 0.26, muslo: 0.13, pierna: 0.11, radioPierna: 0.072, anchoCadera: 0.085,
    perfil: [[0, 0.22], [0.1, 0.225], [0.16, 0.25], [0.2, 0.29], [0.215, 0.35], [0.205, 0.41], [0.18, 0.47], [0.168, 0.52], [0.165, 0.56], [0.125, 0.592], [0.06, 0.606], [0, 0.608]],
    profundidad: 0.82,
    hombroY: 0.578, hombroX: 0.16, cuelloAlto: 0.032,
    radioCabeza: 0.165, brazo: 0.27, radioBrazo: 0.043,
  },
];

const ARRIBA = new THREE.Vector3(0, 1, 0);

function elipsoide(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 24, 16);
  g.scale(rx, ry, rz);
  return g;
}

/** Cápsula de `a` a `b` (coordenadas locales del grupo). */
function extremidad(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const largo = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, largo - 2 * r), 6, 14), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(ARRIBA, b.clone().sub(a).normalize());
  return m;
}

export class Titan {
  readonly grupo = new THREE.Group();
  private readonly superior = new THREE.Group();
  private readonly cabeza = new THREE.Group();
  private readonly fase: number;

  constructor(escena: THREE.Scene, fisica: Fisica, posicion: THREE.Vector3, rumbo: number, readonly opts: OpcionesTitan) {
    this.fase = (posicion.x * 0.37 + posicion.z * 0.11) % 10;
    const H = opts.altura;
    const p = PROPORCIONES[opts.variante];
    const piel = new THREE.MeshLambertMaterial({ color: opts.piel });
    const pielSombra = new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.piel).multiplyScalar(0.92) });

    // Piernas cortas, algo separadas y flexionadas
    for (const lado of [-1, 1]) {
      const cadera = new THREE.Vector3(lado * p.anchoCadera * H, (p.cadera + 0.01) * H, 0);
      const rodilla = new THREE.Vector3(lado * (p.anchoCadera + 0.015) * H, (p.cadera - p.muslo) * H, 0.03 * H);
      const tobillo = new THREE.Vector3(lado * (p.anchoCadera + 0.02) * H, 0.035 * H, -0.01 * H);
      this.grupo.add(extremidad(cadera, rodilla, p.radioPierna * H, piel));
      // la espinilla arranca algo por encima de la rodilla para que no se vea la junta
      const sobreRodilla = rodilla.clone().lerp(cadera, 0.12);
      this.grupo.add(extremidad(sobreRodilla, tobillo, p.radioPierna * 0.8 * H, piel));
      const pie = new THREE.Mesh(elipsoide(0.04 * H, 0.025 * H, 0.075 * H), pielSombra);
      pie.position.set(tobillo.x, 0.025 * H, tobillo.z + 0.035 * H);
      this.grupo.add(pie);
    }

    // Parte superior articulada en la cadera (para el balanceo)
    this.superior.position.set(0, p.cadera * H, 0);
    this.grupo.add(this.superior);
    const local = (x: number, y: number, z: number) => new THREE.Vector3(x * H, y * H - p.cadera * H, z * H);
    const torso = new THREE.Mesh(
      new THREE.LatheGeometry(p.perfil.map(([r, y]) => new THREE.Vector2(r * H, (y - p.cadera) * H)), 28),
      piel,
    );
    torso.scale.z = p.profundidad;
    const cuello = new THREE.Mesh(new THREE.CylinderGeometry(0.048 * H, 0.06 * H, (p.cuelloAlto + 0.05) * H, 16), piel);
    cuello.position.copy(local(0, p.hombroY + p.cuelloAlto / 2 + 0.01, -0.01));
    this.superior.add(torso, cuello);

    // Brazos largos y flacos colgando, algo adelantados
    for (const lado of [-1, 1]) {
      const hombro = local(lado * p.hombroX, p.hombroY - 0.01, -0.01);
      const codo = local(lado * (p.hombroX + 0.05), p.hombroY - p.brazo * 0.5, 0.02);
      const muneca = local(lado * (p.hombroX + 0.06), p.hombroY - p.brazo, 0.06);
      const hombroM = new THREE.Mesh(elipsoide(0.055 * H, 0.045 * H, 0.05 * H), piel);
      hombroM.position.copy(hombro);
      this.superior.add(hombroM);
      this.superior.add(extremidad(hombro, codo, p.radioBrazo * H, piel));
      this.superior.add(extremidad(codo.clone().lerp(hombro, 0.1), muneca, p.radioBrazo * 0.88 * H, piel));
      const mano = new THREE.Mesh(elipsoide(0.03 * H, 0.05 * H, 0.025 * H), pielSombra);
      mano.position.copy(muneca).add(new THREE.Vector3(0, -0.035 * H, 0));
      this.superior.add(mano);
    }

    // Cabeza enorme con la cara pintada en un casquete
    const rc = p.radioCabeza * H;
    this.cabeza.position.copy(local(0, p.hombroY + p.cuelloAlto + p.radioCabeza * 0.95, 0.01));
    this.superior.add(this.cabeza);
    const craneo = new THREE.Mesh(new THREE.SphereGeometry(rc, 32, 24), piel);
    craneo.scale.set(1, 1.12, 1.02);
    this.cabeza.add(craneo);
    const cara = new THREE.Mesh(
      new THREE.SphereGeometry(rc * 1.012, 32, 24, Math.PI / 2 - 1.05, 2.1, 0.62, 1.95),
      new THREE.MeshLambertMaterial({ map: texturaCaraTitan(opts.variante), transparent: true, alphaTest: 0.08, depthWrite: false }),
    );
    cara.scale.copy(craneo.scale);
    cara.renderOrder = 1;
    this.cabeza.add(cara);
    for (const lado of [-1, 1]) {
      const oreja = new THREE.Mesh(elipsoide(0.018 * H, 0.032 * H, 0.014 * H), pielSombra);
      oreja.position.set(lado * rc * 0.98, 0, -rc * 0.05);
      this.cabeza.add(oreja);
    }
    if (opts.pelo) {
      const pelo = new THREE.Mesh(
        new THREE.SphereGeometry(rc * 1.04, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42),
        new THREE.MeshLambertMaterial({ color: opts.pelo }),
      );
      pelo.scale.copy(craneo.scale);
      pelo.rotation.x = -0.35;
      this.cabeza.add(pelo);
    }

    this.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.grupo.position.copy(posicion);
    this.grupo.rotation.y = rumbo;
    escena.add(this.grupo);
    this.grupo.updateMatrixWorld(true);
    this.crearColisiones(fisica, p);
  }

  /** Colisionadores aproximados (cápsulas y bola) en la pose de reposo. */
  private crearColisiones(fisica: Fisica, p: Proporciones): void {
    const H = this.opts.altura;
    const mundo = (v: THREE.Vector3) => v.applyMatrix4(this.grupo.matrixWorld);
    const q = this.grupo.quaternion;
    const torsoAbajo = mundo(new THREE.Vector3(0, p.cadera * H, 0));
    const torsoArriba = mundo(new THREE.Vector3(0, p.hombroY * H, 0));
    const rTorso = Math.max(...p.perfil.map(([r]) => r)) * H * 0.85;
    fisica.capsula(torsoAbajo.clone().lerp(torsoArriba, 0.5), torsoAbajo.distanceTo(torsoArriba) / 2, rTorso, 'titan', q);
    fisica.bola(this.cabeza.getWorldPosition(new THREE.Vector3()), p.radioCabeza * H * 1.05, 'titan');
    for (const lado of [-1, 1]) {
      const a = mundo(new THREE.Vector3(lado * p.anchoCadera * H, p.cadera * H, 0));
      const b = mundo(new THREE.Vector3(lado * (p.anchoCadera + 0.02) * H, 0.05 * H, 0));
      const qp = new THREE.Quaternion().setFromUnitVectors(ARRIBA, b.clone().sub(a).normalize());
      fisica.capsula(a.clone().lerp(b, 0.5), a.distanceTo(b) / 2, p.radioPierna * H, 'titan', qp);
      const h = mundo(new THREE.Vector3(lado * p.hombroX * H, p.hombroY * H, 0));
      const m = mundo(new THREE.Vector3(lado * (p.hombroX + 0.06) * H, (p.hombroY - p.brazo) * H, 0.06 * H));
      const qb = new THREE.Quaternion().setFromUnitVectors(ARRIBA, m.clone().sub(h).normalize());
      fisica.capsula(h.clone().lerp(m, 0.5), h.distanceTo(m) / 2, p.radioBrazo * H, 'titan', qb);
    }
    // Nuca: el punto débil (1 m × 10 cm a escala humana, escalado con la altura)
    const escala = H / 1.7;
    const nuca = mundo(new THREE.Vector3(0, (p.hombroY + p.cuelloAlto * 0.6) * H, -0.05 * H));
    fisica.caja(nuca, { x: 0.05 * escala * 0.5 + 0.2, y: 0.5 * escala * 0.25, z: 0.2 }, 'nuca', q);
  }

  /** Balanceo en reposo: inclinación, respiración y cabeza ladeada. */
  actualizar(t: number): void {
    const f = t + this.fase;
    this.superior.rotation.z = Math.sin(f * 0.6) * 0.03;
    this.superior.rotation.x = 0.07 + Math.sin(f * 0.9) * 0.015;
    this.cabeza.rotation.y = Math.sin(f * 0.37) * 0.18;
    this.cabeza.rotation.z = 0.14 + Math.sin(f * 0.5) * 0.03;
  }

  get posicion(): THREE.Vector3 {
    return this.grupo.position;
  }

  /** Punto aproximado de la cara en coordenadas de mundo (para encuadrar la cámara). */
  cara(): THREE.Vector3 {
    return this.cabeza.getWorldPosition(new THREE.Vector3());
  }
}
