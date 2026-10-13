import * as THREE from 'three';
import type { AspectoSoldado, EstadoAnimacion } from '../core/tipos';
import { texturaEmblema } from '../world/texturas';
import { baseCuerpo, easeOutCubic, ikDosHuesos, muelle, smootherstep, varianteImpulso, type Muelle } from './poses';

/**
 * Soldado de 1,7 m articulado: cadera → muslo → rodilla → tobillo, y lumbar → torso →
 * cuello/cabeza y hombro → codo → mano con su cuchilla. Chaqueta corta marrón, pantalón
 * blanco, botas altas, correas del arnés, capa verde en tres franjas que ondean, vainas
 * con los cilindros de gas en los muslos y la carcasa del equipo en la parte baja de la
 * espalda, de donde salen los cables. Mira hacia +Z; origen en los pies.
 *
 * Animación procedural por estados (reposo, carrera, recogida de cable, péndulo, impulso,
 * vuelo, aterrizaje, rodada, preparación y corte, giro de Levi, cambio de cuchillas,
 * agarrado). Cada articulación sigue su pose objetivo con un muelle de segundo orden, así
 * las transiciones tienen inercia y rebote; la orientación del cuerpo entero sigue al cable
 * o a la velocidad (el arnés tira de la cintura).
 *
 * Signos (izquierda del modelo = +X, lado = +1): flexión de cadera = x negativo; rodilla
 * flexionada = x positivo; tobillo en punta = x positivo; hombro adelante = x negativo;
 * abducción = z = lado·ángulo; codo flexionado = x negativo; torso.x positivo = encorvarse;
 * cabeza.x positivo = mirar abajo. La cuchilla apunta a +Z en la mano; muñeca.x = π/2 la
 * alinea con el antebrazo y π la pone hacia atrás.
 */

const COLORES_BASE = {
  piel: '#e8c6a6',
  pelo: '#2b1d14',
  chaqueta: '#b58c5c',
  pantalon: '#eeece6',
  botas: '#5b3a22',
  correa: '#2f1e13',
  capa: '#4a6438',
  metal: '#8f969d',
  metalClaro: '#c9ced4',
  carcasa: '#575c62',
};

const ARRIBA = new THREE.Vector3(0, 1, 0);
const MUSLO = 0.45;
const ESPINILLA = 0.4;
const ALTURA_CADERA = 0.95;
/** Del tobillo a la planta de la bota. */
const SUELA = 0.085;

const CANALES = [
  'pelvisY', 'torsoX', 'torsoY', 'torsoZ', 'cabezaX', 'cabezaY',
  'caderaX0', 'caderaZ0', 'rodilla0', 'tobillo0', 'caderaX1', 'caderaZ1', 'rodilla1', 'tobillo1',
  'hombroX0', 'hombroZ0', 'codo0', 'munecaX0', 'hombroX1', 'hombroZ1', 'codo1', 'munecaX1',
  'capaX0', 'capaZ0', 'capaX1', 'capaZ1', 'capaX2', 'capaZ2',
] as const;
type Canal = (typeof CANALES)[number];
type Pose = Record<Canal, number>;

/** Rigidez y amortiguación por grupo de articulaciones. */
function parametros(c: Canal): [number, number] {
  if (c === 'pelvisY') return [10, 0.8];
  if (c.startsWith('torso')) return [12, 0.6];
  if (c.startsWith('cabeza')) return [18, 0.9];
  if (c.startsWith('hombro') || c.startsWith('codo') || c.startsWith('muneca')) return [14, 0.5];
  if (c.startsWith('capa')) return [6, 0.3];
  return [12, 0.55];
}

const lado = (i: number): number => (i === 0 ? 1 : -1);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function segmento(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const o = mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, a.distanceTo(b) - 2 * r), 4, 10), m);
  o.position.copy(a).lerp(b, 0.5);
  o.quaternion.setFromUnitVectors(ARRIBA, b.clone().sub(a).normalize());
  return o;
}

export class ModeloJugador {
  readonly grupo = new THREE.Group();
  /** Pivote de la cadera: recibe la orientación completa del cuerpo. */
  private readonly cadera = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly cuello = new THREE.Group();
  private readonly piernas: THREE.Group[] = [];
  private readonly rodillas: THREE.Group[] = [];
  private readonly tobillos: THREE.Group[] = [];
  private readonly brazos: THREE.Group[] = [];
  private readonly codos: THREE.Group[] = [];
  private readonly manos: THREE.Group[] = [];
  private readonly hojas: THREE.Mesh[] = [];
  private readonly capa: THREE.Group[] = [];
  /** Estela de las cuchillas durante el barrido (en coordenadas de mundo). */
  readonly estela: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  private readonly m = {} as Record<Canal, Muelle>;
  private readonly qActual = new THREE.Quaternion();
  private readonly frenteAnterior = new THREE.Vector3(0, 0, 1);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private fase = 0;
  private tAire = 0;
  private anclasPrevias = 0;
  private impulsoPrevio = false;
  private cortePrevio: number | null = null;
  private ladoTajo = 1;
  private tVoltereta = -1;
  private ultimaVoltereta = -9;
  private tRodada = -1;
  private tGiro = -1;
  private tCambio = -1;
  private readonly muestrasEstela: THREE.Vector3[][] = [[], []];
  /**
   * Altura del suelo bajo un punto del mundo (raycast contra la escena), o null si no se sabe.
   * Sin ella se toma como suelo la base del modelo (suelo plano).
   */
  sueloEn: ((p: THREE.Vector3) => number | null) | null = null;
  /** Descenso suavizado de la cadera para apoyar el pie que pisa más bajo. */
  private bajadaPelvis = 0;

  constructor(aspecto: AspectoSoldado = {}) {
    const COLORES = {
      ...COLORES_BASE,
      ...(aspecto.piel ? { piel: aspecto.piel } : {}),
      ...(aspecto.pelo ? { pelo: aspecto.pelo } : {}),
      ...(aspecto.capa ? { capa: aspecto.capa } : {}),
    };
    if (aspecto.escala) this.grupo.scale.setScalar(aspecto.escala);
    for (const c of CANALES) this.m[c] = { x: 0, v: 0 };
    const lam = (c: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
    const piel = lam(COLORES.piel);
    const chaqueta = lam(COLORES.chaqueta);
    const pantalon = lam(COLORES.pantalon);
    const botas = lam(COLORES.botas);
    const correa = lam(COLORES.correa);
    const peloMat = lam(COLORES.pelo);
    const capaMat = lam(COLORES.capa, { side: THREE.DoubleSide });
    // Phong: brillo especular sin depender de un mapa de entorno
    const metal = new THREE.MeshPhongMaterial({ color: COLORES.metal, specular: '#e8eef4', shininess: 70 });
    const metalClaro = new THREE.MeshPhongMaterial({ color: COLORES.metalClaro, specular: '#ffffff', shininess: 120 });
    const carcasa = new THREE.MeshPhongMaterial({ color: COLORES.carcasa, specular: '#9aa2aa', shininess: 40 });

    this.grupo.add(this.cadera);
    this.cadera.position.y = ALTURA_CADERA;

    // ── Pelvis: cadera, cinturón, carcasa del equipo, bobinas, vainas y gas ──
    const c = this.cadera;
    c.add(mesh(new THREE.BoxGeometry(0.32, 0.14, 0.2), pantalon, 0, -0.03, 0));
    c.add(mesh(new THREE.BoxGeometry(0.345, 0.06, 0.225), correa, 0, 0.035, 0));
    c.add(mesh(new THREE.BoxGeometry(0.24, 0.13, 0.11), carcasa, 0, 0, -0.16));
    for (const s of [-1, 1]) {
      const bobina = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.045, 14), metal, s * 0.14, 0, -0.16);
      bobina.rotation.z = Math.PI / 2;
      c.add(bobina);
      const vaina = mesh(new THREE.BoxGeometry(0.075, 0.15, 0.52), metal, s * 0.215, -0.21, -0.07);
      vaina.rotation.x = -0.12;
      c.add(vaina);
      const gas = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.44, 14), metalClaro, s * 0.215, -0.095, -0.09);
      gas.rotation.x = Math.PI / 2 - 0.12;
      c.add(gas);
      c.add(mesh(new THREE.SphereGeometry(0.046, 10, 8), metalClaro, s * 0.215, -0.12, -0.31));
      c.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), correa, s * 0.19, -0.09, 0.04));
    }

    // ── Piernas: muslo → rodilla (bota) → tobillo (pie) ──
    for (let i = 0; i < 2; i++) {
      const l = lado(i);
      const pierna = new THREE.Group();
      pierna.position.set(l * 0.1, -0.02, 0);
      pierna.add(mesh(new THREE.CylinderGeometry(0.085, 0.072, MUSLO, 12), pantalon, 0, -MUSLO / 2, 0));
      for (const y of [-0.12, -0.3]) {
        const anillo = mesh(new THREE.TorusGeometry(0.083, 0.012, 6, 16), correa, 0, y, 0);
        anillo.rotation.x = Math.PI / 2;
        pierna.add(anillo);
      }
      pierna.add(mesh(new THREE.BoxGeometry(0.025, 0.42, 0.02), correa, l * 0.075, -0.22, 0.03));
      const rodilla = new THREE.Group();
      rodilla.position.y = -MUSLO;
      rodilla.add(mesh(new THREE.CylinderGeometry(0.072, 0.062, ESPINILLA + 0.02, 12), botas, 0, -ESPINILLA / 2, 0));
      rodilla.add(mesh(new THREE.CylinderGeometry(0.079, 0.079, 0.05, 12), botas, 0, 0.02, 0));
      rodilla.add(mesh(new THREE.BoxGeometry(0.025, 0.22, 0.02), correa, 0, -0.07, 0.07));
      const tobillo = new THREE.Group();
      tobillo.position.y = -ESPINILLA;
      tobillo.add(mesh(new THREE.BoxGeometry(0.11, 0.07, 0.25), botas, 0, -0.045, 0.045));
      rodilla.add(tobillo);
      pierna.add(rodilla);
      c.add(pierna);
      this.piernas.push(pierna);
      this.rodillas.push(rodilla);
      this.tobillos.push(tobillo);
    }

    // ── Torso (pivote lumbar) con chaqueta corta y correas en X ──
    this.torso.position.y = 0.05;
    c.add(this.torso);
    const t = this.torso;
    const torsoMesh = mesh(new THREE.CylinderGeometry(0.28, 0.23, 0.44, 4, 1).rotateY(Math.PI / 4), chaqueta, 0, 0.22, 0);
    torsoMesh.scale.set(1, 1, 0.58);
    t.add(torsoMesh);
    t.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), pantalon, 0, 0.38, 0.085));
    for (const z of [0.095, -0.095]) {
      for (const s of [-1, 1]) {
        const cr = mesh(new THREE.BoxGeometry(0.03, 0.46, 0.02), correa, 0, 0.2, z);
        cr.rotation.z = s * 0.42;
        t.add(cr);
      }
      t.add(mesh(new THREE.BoxGeometry(0.33, 0.03, 0.02), correa, 0, 0.3, z));
    }
    for (const s of [-1, 1]) {
      t.add(mesh(new THREE.BoxGeometry(0.03, 0.02, 0.21), correa, s * 0.1, 0.44, 0));
      t.add(mesh(new THREE.BoxGeometry(0.02, 0.36, 0.03), correa, s * 0.17, 0.15, 0));
    }

    // ── Cuello y cabeza ──
    this.cuello.position.y = 0.42;
    t.add(this.cuello);
    const k = this.cuello;
    k.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), piel, 0, 0.05, 0));
    const cabeza = mesh(new THREE.SphereGeometry(0.105, 18, 14), piel, 0, 0.165, 0.005);
    cabeza.scale.set(0.92, 1.05, 1);
    k.add(cabeza);
    const pelo = mesh(new THREE.SphereGeometry(0.113, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.44), peloMat, 0, 0.175, -0.004);
    pelo.scale.set(0.96, 1.06, 1.03);
    pelo.rotation.x = -0.5;
    k.add(pelo);
    if (aspecto.peloLargo) {
      // melena hasta la nuca (Mikasa, Sasha)
      const melena = mesh(new THREE.SphereGeometry(0.112, 14, 10, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.45), peloMat, 0, 0.14, -0.02);
      melena.scale.set(1.04, 1.25, 1.02);
      k.add(melena);
    }
    if (aspecto.bufanda) {
      // la bufanda roja de Mikasa
      const bufanda = mesh(new THREE.TorusGeometry(0.075, 0.035, 8, 18), lam(aspecto.bufanda), 0, 0.03, 0.005);
      bufanda.rotation.x = Math.PI / 2;
      k.add(bufanda);
      const cola = mesh(new THREE.BoxGeometry(0.07, 0.2, 0.025), lam(aspecto.bufanda), 0.04, -0.07, -0.08);
      cola.rotation.x = 0.25;
      k.add(cola);
    }
    const ojos = lam('#1d1612');
    for (const s of [-1, 1]) {
      k.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), ojos, s * 0.035, 0.18, 0.095));
      const ceja = mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), peloMat, s * 0.036, 0.205, 0.096);
      ceja.rotation.z = s * -0.15;
      k.add(ceja);
    }

    // ── Brazos: hombro → codo → mano con empuñadura y cuchilla ──
    for (let i = 0; i < 2; i++) {
      const l = lado(i);
      const brazo = new THREE.Group();
      brazo.position.set(l * 0.215, 0.39, 0);
      brazo.add(segmento(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(l * 0.01, -0.27, 0), 0.046, chaqueta));
      const codo = new THREE.Group();
      codo.position.set(l * 0.01, -0.27, 0);
      codo.add(segmento(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.24, 0), 0.04, chaqueta));
      const mano = new THREE.Group();
      mano.position.set(0, -0.27, 0);
      mano.add(mesh(new THREE.SphereGeometry(0.042, 10, 8), piel, 0, 0, 0.005));
      mano.add(mesh(new THREE.BoxGeometry(0.036, 0.05, 0.17), carcasa, 0, -0.005, 0.05));
      const hoja = mesh(new THREE.BoxGeometry(0.01, 0.05, 0.92), metalClaro, 0, -0.005, 0.6);
      mano.add(hoja);
      this.hojas.push(hoja);
      codo.add(mano);
      brazo.add(codo);
      t.add(brazo);
      this.brazos.push(brazo);
      this.codos.push(codo);
      this.manos.push(mano);
    }

    // ── Capa en tres franjas encadenadas (cada una con su muelle) ──
    const radios = [0.225, 0.265, 0.3, 0.34];
    let padre: THREE.Object3D = t;
    for (let s = 0; s < 3; s++) {
      const g = new THREE.Group();
      g.position.set(0, s === 0 ? 0.45 : -0.27, s === 0 ? -0.17 : -(radios[s] - radios[s - 1]));
      const geo = new THREE.CylinderGeometry(radios[s], radios[s + 1], 0.27, 16, 1, true, Math.PI - 1.45, 2.9);
      geo.translate(0, -0.135, radios[s]);
      g.add(mesh(geo, capaMat));
      if (s === 1) {
        const emblema = new THREE.Mesh(
          new THREE.PlaneGeometry(0.24, 0.24),
          new THREE.MeshLambertMaterial({ map: texturaEmblema(), transparent: true, alphaTest: 0.1 }),
        );
        emblema.position.set(0, -0.12, -0.03);
        emblema.rotation.set(-0.12, Math.PI, 0);
        g.add(emblema);
      }
      padre.add(g);
      padre = g;
      this.capa.push(g);
    }
    const capucha = mesh(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), capaMat, 0, 0.43, -0.13);
    capucha.scale.set(1.1, 0.55, 0.75);
    capucha.rotation.x = -0.4;
    t.add(capucha);

    // Estela de las cuchillas: dos cintas de 8 muestras (base y punta de cada hoja)
    const geoEstela = new THREE.BufferGeometry();
    geoEstela.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(2 * 8 * 2 * 3), 3));
    const indices: number[] = [];
    for (let b = 0; b < 2; b++) {
      for (let s = 0; s < 8; s++) {
        if (s < 7) {
          const a0 = (b * 8 + s) * 2;
          indices.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
        }
      }
    }
    geoEstela.setIndex(indices);
    this.estela = new THREE.Mesh(
      geoEstela,
      new THREE.MeshBasicMaterial({ color: '#eef6ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.estela.frustumCulled = false;
    this.estela.visible = false;
    this.estela.matrixAutoUpdate = false;
  }

  /** Quita el modelo de la escena y libera geometrías y materiales (soldados que se van). */
  liberar(): void {
    const materiales = new Set<THREE.Material>();
    for (const raiz of [this.grupo, this.estela]) {
      raiz.removeFromParent();
      raiz.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materiales.add(m);
      });
    }
    for (const m of materiales) m.dispose();
  }

  /** Puntos de salida de los cables (costados de la carcasa lumbar) en coordenadas de mundo. */
  salidaCable(l: -1 | 1, destino: THREE.Vector3): THREE.Vector3 {
    return destino.set(l * 0.17, 0, -0.16).applyMatrix4(this.cadera.matrixWorld);
  }

  /** Punta de la cuchilla izquierda (+1) o derecha (−1) en coordenadas de mundo. */
  puntaCuchilla(l: -1 | 1, destino: THREE.Vector3): THREE.Vector3 {
    return destino.set(0, -0.005, 1.05).applyMatrix4(this.manos[l === 1 ? 0 : 1].matrixWorld);
  }

  animar(e: EstadoAnimacion): void {
    const dt = Math.min(e.dt, 0.1);
    if (dt <= 0) return;
    const t = e.t;
    const v = e.vel;
    const rapidez = v.length();
    const vh = Math.hypot(v.x, v.z);
    const yaw = this.grupo.rotation.y;
    const frente = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const izq = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const posCadera = this.grupo.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, ALTURA_CADERA, 0));

    // Histéresis de vuelo: los bordes de tejado no hacen saltar la pose
    this.tAire = e.enSuelo ? 0 : this.tAire + dt;
    const enAire = !e.enSuelo && (this.tAire > 0.12 || v.y > 2);
    const anclas = e.anclas.length;
    const dCable = anclas > 0 ? e.anclas.reduce((s, a) => s.add(a), new THREE.Vector3()).divideScalar(anclas).sub(posCadera).normalize() : null;

    // Disparadores de capas temporales
    if (anclas > this.anclasPrevias && enAire) {
      // tirón del cable: el torso se adelanta y las piernas llegan tarde
      this.m.torsoX.v -= 6;
      this.m.caderaX0.v += 8;
      this.m.caderaX1.v += 8;
    }
    if (anclas === 0 && this.anclasPrevias > 0 && enAire && rapidez > 14 && v.y > 4 && t - this.ultimaVoltereta > 1.2) {
      this.tVoltereta = 0; // media voltereta al soltar los cables con impulso hacia arriba
      this.ultimaVoltereta = t;
    }
    if (e.impulsando && !this.impulsoPrevio) {
      this.m.torsoX.v -= 4;
      this.m.caderaX0.v += 5;
      this.m.caderaX1.v += 5;
    }
    if (e.corte !== null && this.cortePrevio === null && !e.giro) this.ladoTajo = this.elegirLado(e, izq);
    if (e.giro && this.tGiro < 0) this.tGiro = 0;
    if (!e.giro) this.tGiro = -1;
    if (e.rodando && this.tRodada < 0) this.tRodada = 0;
    if (!e.rodando) this.tRodada = -1;
    if (e.cambiandoCuchillas && this.tCambio < 0) this.tCambio = 0;
    if (!e.cambiandoCuchillas) this.tCambio = -1;
    this.anclasPrevias = anclas;
    this.impulsoPrevio = e.impulsando;
    this.cortePrevio = e.corte;
    if (this.tVoltereta >= 0) this.tVoltereta += dt;
    if (this.tGiro >= 0) this.tGiro += dt;
    if (this.tRodada >= 0) this.tRodada += dt;
    if (this.tCambio >= 0) this.tCambio += dt;
    if (this.tVoltereta > 0.5 || !enAire) this.tVoltereta = -1;

    // ─────────────── Pose objetivo ───────────────
    const P = this.poseReposo(t);
    const acelFrente = e.acel.dot(frente);
    let rapidas = false; // articulaciones rápidas (corte, carrera)

    if (e.agarrado) {
      this.poseAgarrado(P, t);
    } else if (this.tRodada >= 0) {
      this.poseRodada(P);
    } else if (!enAire) {
      rapidas = this.poseSuelo(P, e, vh, dt, acelFrente);
    } else if (this.tGiro >= 0) {
      this.poseGiroLevi(P);
    } else if (e.impulsando && e.dirImpulso) {
      this.poseImpulso(P, e.dirImpulso, frente, izq);
    } else if (dCable && e.recogiendo) {
      this.poseRecogida(P, e, izq, posCadera);
    } else if (dCable) {
      this.posePendulo(P, v, rapidez);
    } else {
      this.poseBalistica(P, v);
    }
    if (this.tVoltereta >= 0) {
      // agrupado durante la voltereta
      const g = Math.sin(Math.PI * THREE.MathUtils.clamp(this.tVoltereta / 0.5, 0, 1));
      for (let i = 0; i < 2; i++) {
        P[`caderaX${i as 0 | 1}`] = THREE.MathUtils.lerp(P[`caderaX${i as 0 | 1}`], -1.7, g);
        P[`rodilla${i as 0 | 1}`] = THREE.MathUtils.lerp(P[`rodilla${i as 0 | 1}`], 2.0, g);
        P[`codo${i as 0 | 1}`] = THREE.MathUtils.lerp(P[`codo${i as 0 | 1}`], -1.5, g);
      }
      P.cabezaX = THREE.MathUtils.lerp(P.cabezaX, 0.6, g);
    }

    // Capas del tren superior: preparación/corte y cambio de cuchillas
    if (!e.agarrado && !e.giro) {
      if (e.corte !== null) {
        this.poseCorte(P, e.corte, enAire);
        rapidas = true;
      } else if (e.preparandoCorte) {
        this.posePreparacion(P, t, enAire);
        this.ladoTajo = this.elegirLado(e, izq);
      } else if (this.tCambio >= 0) {
        this.poseCambio(P);
      }
    }

    // Mirada: la cabeza sigue al punto apuntado (con límites), salvo en poses que la fijan
    if (e.mirar && !e.agarrado && this.tRodada < 0 && this.tVoltereta < 0 && e.corte === null) {
      const d = e.mirar.clone().sub(posCadera.clone().setY(posCadera.y + 0.6));
      const local = d.applyQuaternion(this.cadera.getWorldQuaternion(new THREE.Quaternion()).invert());
      const giro = THREE.MathUtils.clamp(Math.atan2(local.x, local.z) - P.torsoY, -1.2, 1.2);
      const incl = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)) - P.torsoX * 0.6, -0.78, 0.6);
      const peso = Math.abs(Math.atan2(local.x, local.z)) < 2.2 ? 1 : 0.3;
      P.cabezaY = THREE.MathUtils.lerp(P.cabezaY, giro, peso);
      P.cabezaX = THREE.MathUtils.lerp(P.cabezaX, incl, peso * 0.8);
    }

    this.poseCapa(P, e, t, rapidez);

    // ─────────────── Muelles ───────────────
    for (const c of CANALES) {
      let [w, z] = parametros(c);
      if (rapidas && (c.startsWith('hombro') || c.startsWith('codo') || c.startsWith('muneca') || c.startsWith('torso'))) {
        w = e.corte !== null ? 34 : 22;
        z = 0.7;
      }
      if (rapidas && e.corte === null && (c.startsWith('cadera') || c.startsWith('rodilla') || c.startsWith('tobillo'))) {
        w = 26;
        z = 0.7;
      }
      muelle(this.m[c], P[c], w, z, dt);
    }

    // ─────────────── Orientación del cuerpo entero ───────────────
    this.orientar(e, dt, enAire, dCable, v, rapidez);

    // ─────────────── Aplicar ───────────────
    const x = (c: Canal) => this.m[c].x;
    this.cadera.position.y = ALTURA_CADERA + x('pelvisY');
    this.torso.rotation.set(x('torsoX'), x('torsoY'), x('torsoZ'), 'YXZ');
    this.cuello.rotation.set(x('cabezaX'), x('cabezaY'), 0, 'YXZ');
    for (let i = 0; i < 2; i++) {
      const s = i as 0 | 1;
      this.piernas[i].rotation.set(x(`caderaX${s}`), 0, x(`caderaZ${s}`));
      this.rodillas[i].rotation.x = x(`rodilla${s}`);
      this.tobillos[i].rotation.x = x(`tobillo${s}`);
      this.brazos[i].rotation.set(x(`hombroX${s}`), 0, x(`hombroZ${s}`));
      this.codos[i].rotation.x = x(`codo${s}`);
      this.manos[i].rotation.x = x(`munecaX${s}`);
    }
    for (let s = 0; s < 3; s++) this.capa[s].rotation.set(x(`capaX${s as 0 | 1 | 2}`), 0, x(`capaZ${s as 0 | 1 | 2}`));

    // Cuchillas: sin filo o en mitad del cambio, sin hoja
    // Pies sobre el terreno (IK): ningún pie atraviesa el suelo al andar, correr o en pendiente
    const apoyado = !enAire && !e.agarrado && !e.muerto && this.tRodada < 0;
    this.ajustarPies(apoyado, dt);

    const filo = e.filo ?? 1;
    const sinHoja = filo <= 0 || (this.tCambio >= 0.22 && this.tCambio < 0.36);
    for (const h of this.hojas) h.visible = !sinHoja;

    this.grupo.updateMatrixWorld(true);
    this.actualizarEstela(e, sinHoja);
  }

  /**
   * IK de piernas contra el suelo. Primero baja la cadera si un pie pisa más bajo que la base
   * (pendiente, escalón); luego, si algún tobillo queda por debajo de la altura de la suela,
   * dobla cadera y rodilla para dejarlo justo encima y pone la planta paralela al suelo.
   */
  private ajustarPies(activo: boolean, dt: number): void {
    const escala = this.grupo.scale.y;
    this.grupo.updateMatrixWorld(true);
    const base = this.grupo.getWorldPosition(this.tmpA).y;
    const suelos = [base, base];
    if (activo) {
      for (let i = 0; i < 2; i++) suelos[i] = this.sueloBajoPie(i, base);
    }
    const objetivo = activo ? THREE.MathUtils.clamp((Math.min(suelos[0], suelos[1]) - base) / escala, -0.35, 0) : 0;
    this.bajadaPelvis += (objetivo - this.bajadaPelvis) * Math.min(1, dt * 14);
    if (Math.abs(this.bajadaPelvis) < 1e-4 && !activo) return;
    this.cadera.position.y += this.bajadaPelvis;
    this.grupo.updateMatrixWorld(true);
    if (!activo) return;

    for (let i = 0; i < 2; i++) {
      // dos pasadas: la segunda corrige la punta o el talón si aún rozan por la inclinación
      if (suelos[i] - this.plantaMasBaja(i) <= 0.002) continue;
      // primero la planta plana (la punta caída es lo que más se hunde), luego subir lo que falte
      this.tobillos[i].rotation.x = -(this.piernas[i].rotation.x + this.rodillas[i].rotation.x);
      this.piernas[i].updateMatrixWorld(true);
      for (let pasada = 0; pasada < 2; pasada++) {
        const hundido = suelos[i] - this.plantaMasBaja(i);
        if (hundido <= 0.002) break;
        this.subirTobillo(i, hundido);
      }
    }
  }

  /** Punto más bajo (mundo) de la suela del pie `i`. */
  private plantaMasBaja(i: number): number {
    const tob = this.tobillos[i];
    let y = Infinity;
    for (const x of [-0.055, 0.055]) for (const z of [-0.08, 0.17]) y = Math.min(y, tob.localToWorld(this.tmpB.set(x, -SUELA, z)).y);
    return y;
  }

  /** Sube el tobillo `i` la altura `dy` (mundo) doblando cadera y rodilla, con la planta plana. */
  private subirTobillo(i: number, dy: number): void {
    const tobillo = this.tobillos[i].getWorldPosition(this.tmpA);
    // objetivo del tobillo en el espacio de la cadera, relativo al arranque de la pierna
    const pierna = this.piernas[i];
    const t = this.cadera.worldToLocal(this.tmpB.copy(tobillo).setY(tobillo.y + dy)).sub(pierna.position);
    const d = THREE.MathUtils.clamp(Math.hypot(t.y, t.z), Math.abs(MUSLO - ESPINILLA) + 1e-3, MUSLO + ESPINILLA - 1e-3);
    const phi = Math.atan2(t.z, -t.y);
    const a1 = Math.acos(THREE.MathUtils.clamp((MUSLO * MUSLO + d * d - ESPINILLA * ESPINILLA) / (2 * MUSLO * d), -1, 1));
    const alfa = phi + a1;
    const beta = Math.PI - Math.acos(THREE.MathUtils.clamp((MUSLO * MUSLO + ESPINILLA * ESPINILLA - d * d) / (2 * MUSLO * ESPINILLA), -1, 1));
    pierna.rotation.x = -alfa;
    this.rodillas[i].rotation.x = beta;
    // planta plana: compensa el giro de muslo y espinilla
    this.tobillos[i].rotation.x = alfa - beta;
    pierna.updateMatrixWorld(true);
  }

  /** Suelo más alto bajo el talón y la punta del pie `i` (o la base del modelo). */
  private sueloBajoPie(i: number, base: number): number {
    if (!this.sueloEn) return base;
    const tob = this.tobillos[i];
    let alto = -Infinity;
    for (const z of [-0.05, 0.16]) {
      const p = tob.localToWorld(this.tmpB.set(0, 0, z));
      const g = this.sueloEn(p);
      if (g !== null) alto = Math.max(alto, g);
    }
    // sin suelo cerca (borde de un tejado): la base manda
    return alto === -Infinity || Math.abs(alto - base) > 0.6 ? base : alto;
  }

  /** Punto del cinturón (lado izquierdo) donde cuelga la linterna, en mundo. */
  puntoLinterna(out: THREE.Vector3): THREE.Vector3 {
    return this.cadera.localToWorld(out.set(0.2, -0.06, 0.08));
  }

  // ─────────────────────────── Poses ───────────────────────────

  private poseReposo(t: number): Pose {
    const P = {} as Pose;
    for (const c of CANALES) P[c] = 0;
    P.pelvisY = -0.02;
    P.torsoX = 0.09 + 0.02 * Math.sin(t * Math.PI * 0.5);
    for (let i = 0; i < 2; i++) {
      const s = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${s}`] = -0.09;
      P[`caderaZ${s}`] = l * (i === 0 ? 0.1 : 0.03);
      P[`rodilla${s}`] = 0.14;
      P[`hombroX${s}`] = 0.17;
      P[`hombroZ${s}`] = l * 0.21;
      P[`codo${s}`] = -0.26;
      P[`munecaX${s}`] = 2.2;
    }
    return P;
  }

  /** En el suelo: reposo, andar y correr, aterrizaje (suave o fuerte). Devuelve si las piernas van rápidas. */
  private poseSuelo(P: Pose, e: EstadoAnimacion, vh: number, dt: number, acelFrente: number): boolean {
    const w = THREE.MathUtils.clamp(vh / 0.8, 0, 1);
    const a = THREE.MathUtils.smoothstep(vh, 2, 7);
    const L = THREE.MathUtils.lerp(1.45, 4.4, THREE.MathUtils.smoothstep(vh, 1.4, 7));
    this.fase += ((Math.PI * 2 * vh) / L) * dt;
    const φ = this.fase;

    // Agachado por IK (pies en el suelo) al aterrizar
    let bajada = 0;
    let fuerte = 0;
    if (e.aterrizaje !== null && e.aterrizaje < 0.6) {
      const imp = e.impactoAterrizaje;
      fuerte = THREE.MathUtils.smoothstep(imp, 6, 14);
      const dur = THREE.MathUtils.lerp(0.25, 0.55, fuerte);
      const k = 1 - THREE.MathUtils.smoothstep(e.aterrizaje, dur * 0.5, dur);
      bajada = THREE.MathUtils.lerp(0.12, 0.4, fuerte) * k * THREE.MathUtils.smoothstep(imp, 1.5, 4);
      fuerte *= k;
    }
    if (bajada > 0.01) {
      P.pelvisY = -bajada;
      for (let i = 0; i < 2; i++) {
        const s = i as 0 | 1;
        const h = MUSLO + ESPINILLA - bajada - (i === 1 ? 0.05 * fuerte : 0) + 0.02;
        const ik = ikDosHuesos(MUSLO, ESPINILLA, h);
        // una pierna adelantada y la otra casi de rodillas en el aterrizaje fuerte
        const adelanto = (i === 0 ? -0.35 : 0.25) * fuerte;
        P[`caderaX${s}`] = -ik.raiz + adelanto;
        P[`rodilla${s}`] = ik.medio + (i === 1 ? 0.3 * fuerte : 0);
        P[`tobillo${s}`] = ik.raiz - ik.medio - adelanto * 0.5;
      }
      P.torsoX = 0.26 + 0.5 * fuerte;
      P.cabezaX = -0.5 * fuerte;
      // mano derecha al suelo y la izquierda atrás con la cuchilla alta
      P.hombroX1 = THREE.MathUtils.lerp(P.hombroX1, -0.87, fuerte);
      P.codo1 = THREE.MathUtils.lerp(P.codo1, -0.35, fuerte);
      P.munecaX1 = THREE.MathUtils.lerp(P.munecaX1, 1.9, fuerte);
      P.hombroX0 = THREE.MathUtils.lerp(P.hombroX0, 1.05, fuerte);
      P.hombroZ0 = THREE.MathUtils.lerp(P.hombroZ0, 0.87, fuerte);
      return false;
    }

    // Andar / correr con las cuchillas bajas y hacia atrás
    const A = THREE.MathUtils.lerp(0.44, 0.79, a);
    const K = THREE.MathUtils.lerp(0.96, 1.75, a);
    for (let i = 0; i < 2; i++) {
      const s = i as 0 | 1;
      const l = lado(i);
      const ph = φ + i * Math.PI;
      const sn = Math.sin(ph);
      P[`caderaX${s}`] = THREE.MathUtils.lerp(P[`caderaX${s}`], -A * sn, w);
      P[`caderaZ${s}`] = THREE.MathUtils.lerp(P[`caderaZ${s}`], l * 0.04, w);
      P[`rodilla${s}`] = THREE.MathUtils.lerp(P[`rodilla${s}`], 0.26 + K * Math.pow(Math.max(0, Math.cos(ph)), 1.5), w);
      P[`tobillo${s}`] = THREE.MathUtils.lerp(P[`tobillo${s}`], 0.35 * Math.max(0, Math.sin(ph + 0.6)) - 0.1, w);
      P[`hombroX${s}`] = THREE.MathUtils.lerp(P[`hombroX${s}`], THREE.MathUtils.lerp(0.25, 0.52, a) + 0.35 * sn, w);
      P[`hombroZ${s}`] = THREE.MathUtils.lerp(P[`hombroZ${s}`], l * (0.21 + 0.14 * a), w);
      P[`codo${s}`] = THREE.MathUtils.lerp(P[`codo${s}`], -(0.4 + 0.3 * a) - 0.26 * sn, w);
      P[`munecaX${s}`] = THREE.MathUtils.lerp(2.2, 2.5, a);
    }
    P.pelvisY = -0.02 - 0.05 * (0.5 + 0.5 * Math.cos(2 * φ)) * a * w;
    // esprintando (Shift) el cuerpo va más echado hacia delante
    P.torsoX += (0.14 + 0.16 * THREE.MathUtils.smoothstep(vh, 7.5, 11) + THREE.MathUtils.clamp(acelFrente * 0.015, -0.1, 0.2)) * w;
    P.torsoY = -0.16 * Math.sin(φ) * w;
    P.torsoZ = 0.05 * Math.sin(φ) * w * a;
    P.cabezaY = -P.torsoY;
    return w > 0.5;
  }

  private poseRecogida(P: Pose, e: EstadoAnimacion, izq: THREE.Vector3, posCadera: THREE.Vector3): void {
    for (let i = 0; i < 2; i++) {
      const s = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${s}`] = -0.3;
      P[`caderaZ${s}`] = 0;
      P[`rodilla${s}`] = 0.55;
      P[`tobillo${s}`] = 0.44;
      P[`hombroX${s}`] = 0.8;
      P[`hombroZ${s}`] = l * 0.42;
      P[`codo${s}`] = -0.26;
      P[`munecaX${s}`] = 1.57;
    }
    P.torsoX = -0.22;
    P.cabezaX = -0.6;
    // Con un solo gancho, el brazo de ese lado va adelantado hacia el cable
    if (e.anclas.length === 1) {
      const l = e.anclas[0].clone().sub(posCadera).dot(izq) >= 0 ? 1 : -1;
      const s = (l === 1 ? 0 : 1) as 0 | 1;
      P[`hombroX${s}`] = -0.52;
      P[`hombroZ${s}`] = l * 0.6;
      P[`rodilla${s}`] += 0.17;
    }
  }

  private posePendulo(P: Pose, v: THREE.Vector3, rapidez: number): void {
    const s = THREE.MathUtils.smoothstep(rapidez > 0.5 ? v.y / rapidez : 0, -0.4, 0.6);
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${c}`] = THREE.MathUtils.lerp(0.17, -1.15, s) + (i === 0 ? -0.08 : 0.08);
      P[`rodilla${c}`] = THREE.MathUtils.lerp(0.7, 1.05, s);
      P[`tobillo${c}`] = 0.3;
      P[`hombroX${c}`] = THREE.MathUtils.lerp(0.7, -0.35, s);
      P[`hombroZ${c}`] = l * THREE.MathUtils.lerp(0.3, 0.7, s);
      P[`codo${c}`] = -0.35;
      P[`munecaX${c}`] = 1.7;
    }
    P.torsoX = 0.17;
  }

  private poseImpulso(P: Pose, dir: THREE.Vector3, frente: THREE.Vector3, izq: THREE.Vector3): void {
    const variante = varianteImpulso(dir, frente, izq);
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`munecaX${c}`] = 1.7;
      switch (variante) {
        case 'delante':
          P[`caderaX${c}`] = 0.17;
          P[`rodilla${c}`] = 0.52;
          P[`hombroX${c}`] = 1.13;
          P[`hombroZ${c}`] = l * 0.35;
          P[`codo${c}`] = -0.2;
          break;
        case 'atras':
          P[`caderaX${c}`] = -1.05;
          P[`rodilla${c}`] = 0.44;
          P[`hombroX${c}`] = -0.7;
          P[`hombroZ${c}`] = l * 0.79;
          P[`codo${c}`] = -0.4;
          break;
        case 'arriba':
          P[`caderaX${c}`] = -0.79;
          P[`rodilla${c}`] = 1.22;
          P[`hombroX${c}`] = 0.52;
          P[`hombroZ${c}`] = l * 0.3;
          P[`codo${c}`] = -0.3;
          break;
        default: {
          // lateral: pierna interior recogida, exterior estirada, brazo exterior abierto
          const hacia = variante === 'izquierda' ? 1 : -1;
          const interior = l === hacia;
          P[`caderaX${c}`] = interior ? -0.79 : -0.1;
          P[`rodilla${c}`] = interior ? 1.4 : 0.26;
          P[`hombroX${c}`] = 0.5;
          P[`hombroZ${c}`] = l * (interior ? 0.3 : 1.05);
          P[`codo${c}`] = -0.3;
        }
      }
    }
    P.torsoX = variante === 'delante' ? -0.17 : variante === 'atras' ? 0.2 : 0.05;
    if (variante === 'izquierda' || variante === 'derecha') P.torsoZ = (variante === 'izquierda' ? 1 : -1) * 0.35;
  }

  private poseBalistica(P: Pose, v: THREE.Vector3): void {
    const subida = THREE.MathUtils.smoothstep(v.y, 0, 4);
    const caida = THREE.MathUtils.smoothstep(-v.y, 0, 5);
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${c}`] = -0.09 * subida - 0.44 * caida - 0.2 * (1 - subida - caida) + (i === 0 ? -0.1 : 0.1);
      P[`caderaZ${c}`] = l * 0.14 * (1 - subida - caida);
      P[`rodilla${c}`] = 0.44 * subida + 0.61 * caida + 0.5 * (1 - subida - caida);
      P[`tobillo${c}`] = 0.3;
      P[`hombroX${c}`] = 0.52 * subida - 0.35 * caida;
      P[`hombroZ${c}`] = l * (0.52 * subida + 1.2 * caida + 0.95 * (1 - subida - caida));
      P[`codo${c}`] = -0.3;
      P[`munecaX${c}`] = 1.9;
    }
    P.torsoX = 0.05;
    P.cabezaX = -0.2 * subida + 0.25 * caida;
  }

  private poseRodada(P: Pose): void {
    const k = THREE.MathUtils.clamp(this.tRodada / 0.55, 0, 1);
    const g = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
    P.pelvisY = -0.6 * Math.sin(Math.PI * Math.min(1, k / 0.9));
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${c}`] = -1.92 * g;
      P[`rodilla${c}`] = 2.27 * g;
      P[`hombroX${c}`] = -0.5 * g;
      P[`hombroZ${c}`] = -l * 0.3 * g;
      P[`codo${c}`] = -1.57 * g;
      P[`munecaX${c}`] = Math.PI;
    }
    P.cabezaX = 0.7 * g;
    P.torsoX = 0.6 * g;
  }

  private poseAgarrado(P: Pose, t: number): void {
    const f = Math.PI * 2 * 3.5 * t;
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${c}`] = 0.35 * Math.sin(f + i * Math.PI) - 0.2;
      P[`rodilla${c}`] = 0.85 + 0.35 * Math.sin(f + i * Math.PI + 1);
      P[`hombroX${c}`] = 0;
      P[`hombroZ${c}`] = -l * 0.09;
      P[`codo${c}`] = -0.4;
      P[`munecaX${c}`] = 2.3;
    }
    P.torsoX = 0.26;
    P.torsoZ = 0.17 * Math.sin(Math.PI * 4 * t);
    P.cabezaX = -0.5;
  }

  private poseGiroLevi(P: Pose): void {
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`caderaX${c}`] = -0.09;
      P[`caderaZ${c}`] = 0;
      P[`rodilla${c}`] = 0.17;
      P[`tobillo${c}`] = 0.52;
      P[`hombroX${c}`] = -0.1;
      P[`hombroZ${c}`] = l * 1.5;
      P[`codo${c}`] = -0.17;
      // la derecha en agarre invertido, como Levi
      P[`munecaX${c}`] = i === 1 ? Math.PI : 1.57;
    }
    P.torsoX = 0;
  }

  /** Enroscado: brazos cruzados, cuchillas atrás por encima de los hombros, piernas encogidas. */
  private posePreparacion(P: Pose, t: number, enAire: boolean): void {
    const L = this.ladoTajo;
    const temblor = 0.015 * Math.sin(t * 113);
    P.torsoY = -L * 1.15 + temblor;
    P.torsoX = 0.4;
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`hombroX${c}`] = -1.3 + temblor;
      P[`hombroZ${c}`] = -l * 0.6;
      P[`codo${c}`] = -1.9;
      P[`munecaX${c}`] = 0.3;
      if (enAire) {
        P[`caderaX${c}`] = -1.13;
        P[`rodilla${c}`] = 1.66;
      }
    }
    P.cabezaY = L * 0.9;
    P.cabezaX = -0.17;
  }

  /** Desenrosque explosivo: barrido de las dos cuchillas y sobregiro. */
  private poseCorte(P: Pose, p: number, enAire: boolean): void {
    const L = this.ladoTajo;
    if (p < 0.15) {
      this.posePreparacion(P, 0, enAire);
      return;
    }
    const k = easeOutCubic((p - 0.15) / 0.4);
    const sobre = THREE.MathUtils.smoothstep(p, 0.55, 1);
    P.torsoY = THREE.MathUtils.lerp(-L * 1.22, L * 1.05, k) + L * 0.25 * sobre;
    P.torsoX = THREE.MathUtils.lerp(0.4, 0.15, k);
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`hombroX${c}`] = THREE.MathUtils.lerp(-1.4, -0.35, k) + 0.15 * sobre;
      P[`hombroZ${c}`] = THREE.MathUtils.lerp(-l * 0.5, l * 1.5, k);
      P[`codo${c}`] = THREE.MathUtils.lerp(-1.92, -0.17, k);
      P[`munecaX${c}`] = 1.57 + 0.3 * sobre;
      if (enAire) {
        P[`caderaX${c}`] = THREE.MathUtils.lerp(-1.22, -0.17, k);
        P[`rodilla${c}`] = THREE.MathUtils.lerp(1.75, 0.35, k);
      }
    }
    P.cabezaY = L * 0.6 * (1 - k);
  }

  /** Manos a las vainas, se sueltan las hojas melladas y se sacan las nuevas. */
  private poseCambio(P: Pose): void {
    const t = this.tCambio;
    const fuera = THREE.MathUtils.smoothstep(t, 0.35, 0.6);
    for (let i = 0; i < 2; i++) {
      const c = i as 0 | 1;
      const l = lado(i);
      P[`hombroX${c}`] = THREE.MathUtils.lerp(0.35, -0.52, fuera) + (t > 0.25 && t < 0.35 ? 0.08 : 0);
      P[`hombroZ${c}`] = l * THREE.MathUtils.lerp(0.25, 0.6, fuera);
      P[`codo${c}`] = THREE.MathUtils.lerp(-0.52, -0.3, fuera);
      P[`munecaX${c}`] = THREE.MathUtils.lerp(1.9, 1.3, fuera);
    }
    P.torsoX += 0.3 * (1 - fuera);
  }

  private elegirLado(e: EstadoAnimacion, izq: THREE.Vector3): number {
    if (e.objetivoCorte) {
      const d = e.objetivoCorte.clone().sub(this.grupo.position);
      return d.dot(izq) >= 0 ? 1 : -1;
    }
    // sin objetivo: alterna el sentido del barrido en tajos seguidos
    return -this.ladoTajo || 1;
  }

  /** La capa cuelga con la gravedad y se levanta con el viento relativo, con aleteo. */
  private poseCapa(P: Pose, e: EstadoAnimacion, t: number, rapidez: number): void {
    const qTorso = this.torso.getWorldQuaternion(new THREE.Quaternion()).invert();
    const g = new THREE.Vector3(0, -1, 0).applyQuaternion(qTorso);
    const viento = e.vel.clone().negate().applyQuaternion(qTorso).multiplyScalar(0.08);
    const dir = g.add(viento).normalize();
    const totalX = THREE.MathUtils.clamp(Math.atan2(-dir.z, -dir.y), -0.35, 2.8);
    const totalZ = THREE.MathUtils.clamp(Math.atan2(dir.x, -dir.y), -0.8, 0.8);
    const fuerza = Math.min(1, rapidez / 30);
    const ω = THREE.MathUtils.lerp(8, 16, fuerza) * Math.PI * 2 * 0.15;
    for (let s = 0; s < 3; s++) {
      const c = s as 0 | 1 | 2;
      const aleteo = Math.sin(ω * t - 1.2 * s) * 0.18 * fuerza + (e.recogiendo ? 0.01 * Math.sin(t * 125) : 0);
      P[`capaX${c}`] = Math.max(0.03, totalX / 3 + aleteo);
      P[`capaZ${c}`] = totalZ / 3 + aleteo * 0.3;
    }
  }

  // ─────────────────────────── Orientación ───────────────────────────

  private orientar(e: EstadoAnimacion, dt: number, enAire: boolean, dCable: THREE.Vector3 | null, v: THREE.Vector3, rapidez: number): void {
    const qYawInv = this.grupo.quaternion.clone().invert();
    let qLocal = new THREE.Quaternion();
    let k = 14;
    if (enAire && !e.agarrado && this.tRodada < 0) {
      k = 8;
      const vhat = rapidez > 0.5 ? v.clone().divideScalar(rapidez) : new THREE.Vector3(0, 1, 0);
      let eje: THREE.Vector3;
      if (this.tGiro >= 0) eje = vhat.clone();
      else if (e.impulsando && e.dirImpulso) eje = ARRIBA.clone().addScaledVector(e.dirImpulso, 1.3).normalize();
      else if (dCable && e.recogiendo) eje = dCable.clone().multiplyScalar(0.6).addScaledVector(vhat, 0.4).normalize();
      else if (dCable) eje = dCable.clone();
      else {
        const kv = THREE.MathUtils.clamp((rapidez - 6) / 20, 0, 1);
        eje = ARRIBA.clone().lerp(vhat.clone().addScaledVector(ARRIBA, 0.6).normalize(), kv).normalize();
        if (eje.y < 0.2) eje.setY(0.2).normalize();
      }
      const base = baseCuerpo(eje, v, this.frenteAnterior);
      this.frenteAnterior.copy(base.frente);
      const m = new THREE.Matrix4().makeBasis(base.izq, base.eje, base.frente);
      qLocal = qYawInv.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(m));
    } else {
      this.frenteAnterior.set(Math.sin(this.grupo.rotation.y), 0, Math.cos(this.grupo.rotation.y));
    }
    this.qActual.slerp(qLocal, 1 - Math.exp(-k * dt));

    // Rotaciones extra: voltereta, rodada, giro de Levi
    const extra = new THREE.Quaternion();
    if (this.tVoltereta >= 0) extra.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 2 * smootherstep(this.tVoltereta / 0.5));
    else if (this.tRodada >= 0) extra.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 2 * THREE.MathUtils.smoothstep(this.tRodada / 0.55, 0, 0.85));
    else if (this.tGiro >= 0) extra.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 2 * 3 * smootherstep(this.tGiro / 0.8));
    this.cadera.quaternion.copy(this.qActual).multiply(extra);
  }

  // ─────────────────────────── Estela ───────────────────────────

  private actualizarEstela(e: EstadoAnimacion, sinHoja: boolean): void {
    if (!this.estela.parent && this.grupo.parent) this.grupo.parent.add(this.estela);
    const activa = !sinHoja && this.grupo.visible && ((e.corte !== null && e.corte > 0.12 && e.corte < 0.65) || this.tGiro >= 0);
    if (!activa) {
      this.estela.visible = false;
      this.muestrasEstela[0].length = 0;
      this.muestrasEstela[1].length = 0;
      return;
    }
    const pos = this.estela.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let b = 0; b < 2; b++) {
      const mano = this.manos[b];
      const base = new THREE.Vector3(0, -0.005, 0.25).applyMatrix4(mano.matrixWorld);
      const punta = new THREE.Vector3(0, -0.005, 1.05).applyMatrix4(mano.matrixWorld);
      const m = this.muestrasEstela[b];
      m.unshift(base, punta);
      if (m.length > 16) m.length = 16;
      for (let s = 0; s < 8; s++) {
        const a = m[Math.min(s, m.length / 2 - 1) * 2];
        const p = m[Math.min(s, m.length / 2 - 1) * 2 + 1];
        const i0 = (b * 8 + s) * 2;
        pos.setXYZ(i0, a.x, a.y, a.z);
        pos.setXYZ(i0 + 1, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    this.estela.visible = this.muestrasEstela[0].length >= 4;
  }
}
