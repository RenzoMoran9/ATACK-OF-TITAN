import * as THREE from 'three';
import type { Navegacion } from '../core/navegacion';
import type { Poblacion } from '../core/poblacion';
import { girarHacia } from '../titans/ia';
import { REGION } from '../world/region';

/**
 * Caballo de la Legión: la forma de cruzar rápido la llanura (en el anime, las expediciones
 * van a caballo y solo usan el equipo donde hay árboles o casas).
 *
 * - C cerca de él: montar; montado, C desmonta. Lejos: silbas y viene al galope.
 * - Montado: WASD lo dirige hacia donde pulsas (relativo a la cámara); Shift, galope.
 *   Espacio salta de la silla; si clavas un gancho, sales volando del caballo.
 * - Suelto, se aparta de los titanes que se le acercan y pasta.
 * Choca con lo que bloquea la rejilla de navegación (casas, troncos, la muralla).
 */

export const VELOCIDAD_PASO = 3.2;
export const VELOCIDAD_TROTE = 9;
export const VELOCIDAD_GALOPE = 20;
const ACELERACION = 7;
const FRENADA = 11;
/** Altura de la silla (centro del jinete) sobre el suelo. */
export const ALTURA_SILLA = 2.05;
const RADIO = 0.9;

/** Velocidad objetivo del caballo según lo que se pulsa (lógica pura). */
export function velocidadObjetivo(mueve: boolean, galope: boolean): number {
  if (!mueve) return 0;
  return galope ? VELOCIDAD_GALOPE : VELOCIDAD_TROTE;
}

/** Giro máximo (rad/s): ágil al paso, más abierto al galope. */
export function giroCaballo(v: number): number {
  return THREE.MathUtils.lerp(3.2, 1.6, THREE.MathUtils.clamp(v / VELOCIDAD_GALOPE, 0, 1));
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
  private fase = 0;
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
    malla(new THREE.BoxGeometry(0.9, 0.06, 0.8), capa, this.cuerpo, 0, 0.42, -0.05);
    malla(new THREE.BoxGeometry(0.5, 0.14, 0.62), cuero, this.cuerpo, 0, 0.5, -0.05);
    malla(new THREE.BoxGeometry(0.42, 0.18, 0.08), cuero, this.cuerpo, 0, 0.6, 0.24);
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
  }

  /** Centro del jinete en la silla. */
  silla(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x - Math.sin(this.rumbo) * 0.1, this.pos.y + ALTURA_SILLA, this.pos.z - Math.cos(this.rumbo) * 0.1);
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
    if (mueve) this.rumbo = girarHacia(this.rumbo, Math.atan2(deseo.x, deseo.z), giroCaballo(this.velocidad) * dt);
    this.acelerar(dt, velocidadObjetivo(mueve, galope));
    this.mover(dt);
  }

  /** Suelto: viene si lo llamas, huye de los titanes y si no, pasta. */
  actualizar(dt: number): void {
    if (this.montado) return;
    let objetivo = 0;
    const titan = this.poblacion.titanMasCercano(this.pos, 45);
    if (titan && titan.vivo && titan.estado !== 'apagado') this.huyendo = 4;
    if (this.huyendo > 0 && titan) {
      this.huyendo -= dt;
      const lejos = Math.atan2(this.pos.x - titan.posicion.x, this.pos.z - titan.posicion.z);
      this.rumbo = girarHacia(this.rumbo, lejos, giroCaballo(this.velocidad) * dt);
      objetivo = VELOCIDAD_GALOPE * 0.8;
    } else if (this.llamado) {
      const d = Math.hypot(this.llamado.x - this.pos.x, this.llamado.z - this.pos.z);
      if (d < 4) this.llamado = null;
      else {
        this.rumbo = girarHacia(this.rumbo, Math.atan2(this.llamado.x - this.pos.x, this.llamado.z - this.pos.z), giroCaballo(this.velocidad) * dt);
        objetivo = d > 30 ? VELOCIDAD_GALOPE : d > 10 ? VELOCIDAD_TROTE : VELOCIDAD_PASO;
      }
    } else {
      // pasea un poco y pasta
      this.tPasto -= dt;
      if (this.tPasto <= 0) this.tPasto = 4 + Math.random() * 6;
      objetivo = this.tPasto < 1.5 ? VELOCIDAD_PASO * 0.6 : 0;
      if (this.tPasto < 1.5) this.rumbo += (Math.random() - 0.5) * dt;
    }
    this.acelerar(dt, objetivo);
    this.mover(dt);
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

  /** Posición y patas (interpolado). */
  dibujar(alfa: number, dt: number): void {
    this.grupo.position.lerpVectors(this.posPrevia, this.pos, alfa);
    this.grupo.rotation.y = this.rumbo;
    const v = this.velocidad;
    const galope = THREE.MathUtils.smoothstep(v, VELOCIDAD_TROTE, VELOCIDAD_GALOPE);
    // ciclos por segundo: 1 al paso, ~2 al trote, ~2,4 al galope
    this.fase += dt * (v < 0.2 ? 0 : THREE.MathUtils.lerp(0.9, 2.4, THREE.MathUtils.clamp(v / VELOCIDAD_GALOPE, 0, 1)));
    const amp = THREE.MathUtils.clamp(v / VELOCIDAD_TROTE, 0, 1) * THREE.MathUtils.lerp(0.55, 0.85, galope);
    for (const p of this.patas) {
      // al trote, diagonales; al galope, las delanteras juntas y luego las traseras
      const desfase = THREE.MathUtils.lerp(p.fase, p.delantera ? p.fase * 0.5 : 0.5 + p.fase * 0.3, galope);
      const a = Math.PI * 2 * (this.fase + desfase);
      p.arriba.rotation.x = Math.sin(a) * amp;
      p.abajo.rotation.x = (p.delantera ? -1 : 1) * Math.max(0, Math.sin(a + 1.2)) * amp * 1.3;
    }
    this.cuerpo.position.y = 1.42 + Math.abs(Math.sin(Math.PI * 2 * this.fase)) * 0.09 * amp;
    this.cuerpo.rotation.x = Math.sin(Math.PI * 2 * this.fase) * 0.05 * galope;
    // cabeza: baja a pastar parado, se estira al galope
    const pasta = v < 0.3 && !this.montado ? 1 : 0;
    this.cuello.rotation.x += ((pasta ? 1.0 : -0.25 * galope) - this.cuello.rotation.x) * Math.min(1, dt * 3);
    this.cola.rotation.x = -2.4 + 0.5 * galope + Math.sin(this.fase * 9) * 0.06;
  }
}
