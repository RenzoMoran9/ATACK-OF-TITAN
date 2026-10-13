import * as THREE from 'three';
import type { Navegacion } from '../core/navegacion';
import type { Poblacion } from '../core/poblacion';
import { REGION } from '../world/region';
import { ikPata, marcha, pata, type Marcha } from './marchaCaballo';
import { cargarModeloCaballo, type ModeloCaballo } from './modeloCaballo';

/**
 * Caballo de la Legión: la forma de cruzar rápido la llanura (en el anime, las expediciones
 * van a caballo y solo usan el equipo donde hay árboles o casas).
 *
 * - C cerca de él: montar; montado, C desmonta. Lejos: silbas y viene al galope.
 * - Montado: WASD lo dirige hacia donde pulsas (relativo a la cámara); Shift, galope.
 *   Espacio salta de la silla; si clavas un gancho, sales volando del caballo.
 * - Suelto, se aparta de los titanes que se le acercan y pasta.
 * Choca con lo que bloquea la rejilla de navegación (casas, troncos, la muralla).
 *
 * Física: avanza siempre hacia donde mira (no derrapa), acelera y frena como un animal de
 * 500 kg, gira con inercia (velocidad angular que crece y decae) y cuanto más rápido va, más
 * abierto gira; si le pides dar media vuelta al galope, frena para girar. Las patas siguen la
 * marcha de src/player/marchaCaballo.ts (paso, trote, galope) con los cascos clavados en el suelo.
 *
 * Se ve con el modelo 3D de src/player/modeloCaballo.ts (Roberto Domínguez, CC BY 4.0) en cuanto
 * termina de cargar; mientras tanto, o si no carga, con uno hecho de primitivas.
 */

export const VELOCIDAD_PASO = 1.8;
export const VELOCIDAD_TROTE = 6;
export const VELOCIDAD_GALOPE = 16;
const ACELERACION = 4.5;
const FRENADA = 7;
/** Aceleración angular (rad/s²): el giro no es instantáneo. */
const ACEL_GIRO = 7;
/** Altura de la silla (centro del jinete) sobre el suelo. */
export const ALTURA_SILLA = 2.05;
const RADIO = 0.9;

/** Velocidad objetivo del caballo según lo que se pulsa (lógica pura). */
export function velocidadObjetivo(mueve: boolean, galope: boolean): number {
  if (!mueve) return 0;
  return galope ? VELOCIDAD_GALOPE : VELOCIDAD_TROTE;
}

/** Giro máximo (rad/s): ágil al paso, más abierto al galope (radio de unos 17 m). */
export function giroCaballo(v: number): number {
  return THREE.MathUtils.lerp(2.2, 0.95, THREE.MathUtils.clamp(v / VELOCIDAD_GALOPE, 0, 1));
}

/** Velocidad a la que conviene ir para girar `angulo` (rad): media vuelta, casi parado. */
export function velocidadParaGirar(v: number, angulo: number): number {
  const a = Math.abs(angulo);
  if (a < 0.9) return v;
  return Math.min(v, THREE.MathUtils.lerp(v, VELOCIDAD_PASO * 1.5, THREE.MathUtils.smoothstep(a, 0.9, 2.2)));
}

interface Pata {
  arriba: THREE.Group;
  abajo: THREE.Group;
  fase: number;
  delantera: boolean;
}

export class Caballo {
  readonly grupo = new THREE.Group();
  /** Pies en el suelo. */
  readonly pos = new THREE.Vector3();
  readonly posPrevia = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly nombre = 'Tu caballo';
  rumbo = 0;
  velocidad = 0;
  montado = false;
  private llamado: THREE.Vector3 | null = null;
  private readonly patas: Pata[] = [];
  private readonly cuerpo = new THREE.Group();
  private readonly cuello = new THREE.Group();
  private readonly cola: THREE.Mesh;
  /** Silla y manta verde de la Legión (sirven para los dos modelos). */
  private readonly sillaG = new THREE.Group();
  private modelo: ModeloCaballo | null = null;
  private readonly muslos = [0, 0, 0, 0];
  private readonly canas = [0, 0, 0, 0];
  /** Centro del jinete sobre los pies del caballo. */
  private alturaSilla = ALTURA_SILLA;
  private fase = 0;
  /** Bote del lomo en el último fotograma (el jinete sube y baja con él). */
  private bote = 0;
  /** Velocidad angular actual (rad/s). */
  omega = 0;
  /** Cascos en el suelo ahora mismo (delantera izq, delantera der, trasera izq, trasera der). */
  readonly apoyadas = [true, true, true, true];
  /** Marcha actual (para el sonido de los cascos). */
  marchaActual: Marcha = marcha(0, 1.3);
  private tPasto = 0;
  private huyendo = 0;

  constructor(escena: THREE.Scene, private readonly nav: Navegacion, private readonly poblacion: Poblacion) {
    const pelaje = new THREE.MeshLambertMaterial({ color: '#6b4326' });
    const crin = new THREE.MeshLambertMaterial({ color: '#24170e' });
    const cuero = new THREE.MeshLambertMaterial({ color: '#3d2a1a' });
    const casco = new THREE.MeshLambertMaterial({ color: '#1e1a17' });
    const capa = new THREE.MeshLambertMaterial({ color: '#3f6a34' });
    const malla = (g: THREE.BufferGeometry, m: THREE.Material, padre: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      padre.add(o);
      return o;
    };
    this.grupo.add(this.cuerpo);
    this.cuerpo.position.y = 1.42;
    // tronco
    const tronco = malla(new THREE.CapsuleGeometry(0.42, 1.25, 6, 12), pelaje, this.cuerpo);
    tronco.rotation.x = Math.PI / 2;
    tronco.scale.set(1, 1, 1.15);
    // cuello y cabeza
    this.cuello.position.set(0, 0.25, 0.8);
    this.cuerpo.add(this.cuello);
    const cuelloM = malla(new THREE.CylinderGeometry(0.2, 0.32, 0.95, 10), pelaje, this.cuello, 0, 0.35, 0.15);
    cuelloM.rotation.x = 0.6;
    malla(new THREE.BoxGeometry(0.08, 0.7, 0.35), crin, this.cuello, 0, 0.45, -0.02).rotation.x = 0.6;
    // cabeza afilada hacia el hocico, inclinada hacia delante y abajo
    const cabeza = malla(new THREE.CylinderGeometry(0.085, 0.15, 0.66, 10), pelaje, this.cuello, 0, 0.8, 0.5);
    cabeza.rotation.x = 2.05;
    cabeza.scale.set(0.85, 1, 1.15);
    malla(new THREE.BoxGeometry(0.06, 0.16, 0.06), pelaje, this.cuello, 0.09, 0.98, 0.32);
    malla(new THREE.BoxGeometry(0.06, 0.16, 0.06), pelaje, this.cuello, -0.09, 0.98, 0.32);
    // cola
    this.cola = malla(new THREE.ConeGeometry(0.13, 0.85, 8), crin, this.cuerpo, 0, -0.05, -0.98);
    this.cola.rotation.x = -2.4;
    // silla y manta verde de la Legión
    this.grupo.add(this.sillaG);
    this.sillaG.position.y = 1.42;
    malla(new THREE.BoxGeometry(0.9, 0.06, 0.8), capa, this.sillaG, 0, 0.42, -0.05);
    malla(new THREE.BoxGeometry(0.5, 0.14, 0.62), cuero, this.sillaG, 0, 0.5, -0.05);
    malla(new THREE.BoxGeometry(0.42, 0.18, 0.08), cuero, this.sillaG, 0, 0.6, 0.24);
    // patas: muslo y caña, con el casco
    for (const [x, z, delantera, fase] of [
      [0.24, 0.62, true, 0],
      [-0.24, 0.62, true, 0.12],
      [0.24, -0.65, false, 0.5],
      [-0.24, -0.65, false, 0.62],
    ] as [number, number, boolean, number][]) {
      const arriba = new THREE.Group();
      arriba.position.set(x, -0.1, z);
      this.cuerpo.add(arriba);
      malla(new THREE.CylinderGeometry(0.11, 0.08, 0.68, 8), pelaje, arriba, 0, -0.34, 0);
      const abajo = new THREE.Group();
      abajo.position.y = -0.68;
      arriba.add(abajo);
      malla(new THREE.CylinderGeometry(0.065, 0.06, 0.58, 8), pelaje, abajo, 0, -0.29, 0);
      malla(new THREE.CylinderGeometry(0.085, 0.09, 0.08, 8), casco, abajo, 0, -0.6, 0.02);
      this.patas.push({ arriba, abajo, fase, delantera });
    }
    escena.add(this.grupo);
    // el modelo de verdad sustituye al de primitivas en cuanto carga
    cargarModeloCaballo()
      .then((m) => {
        this.modelo = m;
        this.cuerpo.visible = false;
        this.grupo.add(m.grupo);
        // silla en medio del lomo, por detrás de la cruz
        this.sillaG.position.set(0, m.lomo - 0.47, -0.15);
        this.alturaSilla = m.lomo + 0.12;
      })
      .catch((e) => console.warn('[caballo] no se pudo cargar el modelo 3D; se usa el de primitivas', e));
  }

  /** Centro del jinete en la silla. */
  silla(out = new THREE.Vector3()): THREE.Vector3 {
    const atras = this.modelo ? 0.15 : 0.1;
    return out.set(this.pos.x - Math.sin(this.rumbo) * atras, this.pos.y + this.alturaSilla + this.bote, this.pos.z - Math.cos(this.rumbo) * atras);
  }

  colocar(pies: THREE.Vector3, rumbo: number): void {
    const libre = this.nav.libre(pies.x, pies.z, RADIO) ? pies : (this.nav.puntoLibreCercano(pies.x, pies.z, RADIO) ?? pies);
    this.pos.set(libre.x, 0, libre.z);
    this.posPrevia.copy(this.pos);
    this.rumbo = rumbo;
    this.velocidad = 0;
    this.vel.set(0, 0, 0);
    this.llamado = null;
  }

  /** Silbido: viene al galope. Si está muy lejos, aparece a 60 m detrás de ti y llega corriendo. */
  llamar(a: THREE.Vector3, rumboJugador: number): void {
    if (this.pos.distanceTo(a) > 450) {
      const atras = new THREE.Vector3(a.x - Math.sin(rumboJugador) * 60, 0, a.z - Math.cos(rumboJugador) * 60);
      this.colocar(atras, rumboJugador);
    }
    this.llamado = a.clone().setY(0);
  }

  /** Montado: hacia dónde quiere ir el jinete (horizontal, o cero) y si galopa. */
  conducir(dt: number, deseo: THREE.Vector3, galope: boolean): void {
    this.llamado = null;
    const mueve = deseo.lengthSq() > 0.01;
    let objetivo = velocidadObjetivo(mueve, galope);
    if (mueve) {
      const angulo = this.virar(dt, Math.atan2(deseo.x, deseo.z));
      objetivo = velocidadParaGirar(objetivo, angulo);
    } else this.virar(dt, null);
    this.acelerar(dt, objetivo);
    this.mover(dt);
  }

  /** Suelto: viene si lo llamas, huye de los titanes y si no, pasta. */
  actualizar(dt: number): void {
    if (this.montado) return;
    let objetivo = 0;
    let rumbo: number | null = null;
    const titan = this.poblacion.titanMasCercano(this.pos, 45);
    if (titan && titan.vivo && titan.estado !== 'apagado') this.huyendo = 4;
    if (this.huyendo > 0 && titan) {
      this.huyendo -= dt;
      rumbo = Math.atan2(this.pos.x - titan.posicion.x, this.pos.z - titan.posicion.z);
      objetivo = VELOCIDAD_GALOPE * 0.85;
    } else if (this.llamado) {
      const d = Math.hypot(this.llamado.x - this.pos.x, this.llamado.z - this.pos.z);
      if (d < 3.5 && this.velocidad < 1) this.llamado = null;
      else {
        rumbo = Math.atan2(this.llamado.x - this.pos.x, this.llamado.z - this.pos.z);
        // llega frenando poco a poco (del galope al trote y al paso), sin pararse en seco
        objetivo = Math.min(VELOCIDAD_GALOPE, Math.sqrt(2 * FRENADA * 0.6 * Math.max(0, d - 3)));
      }
    } else {
      // pasea un poco y pasta
      this.tPasto -= dt;
      if (this.tPasto <= 0) this.tPasto = 4 + Math.random() * 6;
      objetivo = this.tPasto < 1.5 ? VELOCIDAD_PASO * 0.6 : 0;
      if (this.tPasto < 1.5) rumbo = this.rumbo + (Math.sin(this.tPasto * 3) * 0.4);
    }
    const angulo = this.virar(dt, rumbo);
    this.acelerar(dt, velocidadParaGirar(objetivo, angulo));
    this.mover(dt);
  }

  /**
   * Gira hacia `rumbo` con inercia: la velocidad angular sube y baja con ACEL_GIRO y no pasa
   * del máximo para la velocidad actual. Devuelve lo que falta por girar (rad).
   */
  private virar(dt: number, rumbo: number | null): number {
    let falta = 0;
    let objetivo = 0;
    if (rumbo !== null) {
      falta = Math.atan2(Math.sin(rumbo - this.rumbo), Math.cos(rumbo - this.rumbo));
      const max = giroCaballo(this.velocidad);
      // frena el giro al llegar al rumbo (sin pasarse)
      objetivo = THREE.MathUtils.clamp(falta * 3, -max, max);
    }
    this.omega += THREE.MathUtils.clamp(objetivo - this.omega, -ACEL_GIRO * dt, ACEL_GIRO * dt);
    this.rumbo += this.omega * dt;
    return falta;
  }

  private acelerar(dt: number, objetivo: number): void {
    const a = objetivo > this.velocidad ? ACELERACION : FRENADA;
    this.velocidad += THREE.MathUtils.clamp(objetivo - this.velocidad, -a * dt, a * dt);
  }

  private mover(dt: number): void {
    this.posPrevia.copy(this.pos);
    const dx = Math.sin(this.rumbo) * this.velocidad * dt;
    const dz = Math.cos(this.rumbo) * this.velocidad * dt;
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;
    const dentro = (x: number, z: number) => x > REGION.x0 && x < REGION.x1 && z > REGION.z0 && z < REGION.z1;
    if (this.nav.libre(nx, nz, RADIO) && dentro(nx, nz)) this.pos.set(nx, 0, nz);
    else if (this.nav.libre(nx, this.pos.z, RADIO) && dentro(nx, this.pos.z)) {
      this.pos.x = nx;
      this.velocidad *= 0.85;
    } else if (this.nav.libre(this.pos.x, nz, RADIO) && dentro(this.pos.x, nz)) {
      this.pos.z = nz;
      this.velocidad *= 0.85;
    } else this.velocidad *= 0.3; // contra un muro: se para en seco
    this.vel.set(this.pos.x - this.posPrevia.x, 0, this.pos.z - this.posPrevia.z).divideScalar(Math.max(dt, 1e-4));
  }

  /** Posición, inclinación y patas (interpolado). */
  dibujar(alfa: number, dt: number): void {
    this.grupo.position.lerpVectors(this.posPrevia, this.pos, alfa);
    this.grupo.rotation.y = this.rumbo;
    const v = this.velocidad;
    // patas desde el hombro y la cadera hasta el casco, y la caña bajo la rodilla
    const L = this.modelo ? this.modelo.pivote : 1.32;
    const cana = this.modelo ? this.modelo.rodilla : 0.64;
    const m = marcha(v, L, this.omega);
    this.marchaActual = m;
    this.fase = (this.fase + dt * m.frecuencia) % 1;
    // con las patas abiertas el cuerpo baja un poco (el 70 % de lo que haría falta con la pata
    // recta: en los extremos del apoyo el casco se despega un par de centímetros)
    const bajada = 0.7 * L * (1 - Math.cos(m.amplitud));
    // bote: dos por ciclo al trote, uno con suspensión al galope; cabeceo suave al galope
    const ciclo = Math.PI * 2 * this.fase;
    // el rebote solo baja desde la altura a la que las patas llegan al suelo, nunca sube de ella
    const rebote = -0.03 * m.trote * (1 - m.galope) * (0.5 + 0.5 * Math.cos(2 * ciclo)) - 0.06 * m.galope * (0.5 + 0.5 * Math.sin(ciclo - 1));
    const bote = -bajada + rebote;
    const cabeceo = 0.035 * m.galope * Math.sin(ciclo);
    const alturaPivote = L + bote;
    // cuánto recoge la pata en el aire: poco al paso, más al trote y al galope; nada parado
    const flexAire = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.55, 1.0, m.trote), 1.3, m.galope) * Math.min(1, m.amplitud / 0.15);
    this.patas.forEach((p, i) => {
      const r = pata(this.fase - m.desfases[i], m.apoyo, m.amplitud);
      this.apoyadas[i] = r.apoyada || v < 0.05;
      const signo = p.delantera ? 1 : -1;
      let cadera = r.muslo;
      let rodilla = signo * r.flexion * flexAire * (p.delantera ? 1 : 0.75);
      if (r.apoyada) {
        // casco clavado: va hacia atrás en línea recta por el suelo; cadera y rodilla se ajustan (IK)
        const ik = ikPata(L * Math.sin(r.muslo), alturaPivote, L - cana, cana, signo);
        // la pata cuelga del cuerpo: se descuenta su cabeceo para que el casco no se mueva
        cadera = ik.cadera - cabeceo;
        rodilla = ik.rodilla;
      }
      p.arriba.rotation.x = cadera;
      p.abajo.rotation.x = rodilla;
      this.muslos[i] = cadera;
      this.canas[i] = rodilla;
    });
    // se inclina hacia dentro en las curvas, más cuanto más rápido
    const inclinacion = THREE.MathUtils.clamp(-this.omega * v * 0.012, -0.14, 0.14);
    this.bote = bote;
    this.cuerpo.position.y = 1.42 + bote;
    this.cuerpo.rotation.x = cabeceo;
    this.cuerpo.rotation.order = 'YXZ';
    this.cuerpo.rotation.z = inclinacion;
    if (this.modelo) {
      // cabecea alrededor de los hombros y la cadera (no del suelo), como el de primitivas
      const hc = this.modelo.pivote;
      this.modelo.grupo.position.set(0, bote + hc * (1 - Math.cos(cabeceo)), -hc * Math.sin(cabeceo));
      this.modelo.grupo.rotation.set(cabeceo, 0, inclinacion);
      this.sillaG.position.y = this.modelo.lomo - 0.47 + bote;
      this.sillaG.rotation.z = inclinacion;
      this.modelo.posar(this.muslos, this.canas);
    } else this.sillaG.position.y = 1.42 + bote;
    // cabeza: baja a pastar parado, se estira al galope
    const pasta = v < 0.3 && !this.montado && Math.abs(this.omega) < 0.2 ? 1 : 0;
    this.cuello.rotation.x += ((pasta ? 1.0 : -0.25 * m.galope) - this.cuello.rotation.x) * Math.min(1, dt * 3);
    this.cola.rotation.x = -2.4 + 0.5 * m.galope + Math.sin(ciclo * 2) * 0.06 * (0.3 + m.trote);
  }
}
