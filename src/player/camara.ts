import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../core/config';
import type { Fisica } from '../core/fisica';

const ABAJO = new THREE.Vector3(0, -1, 0);
const IGNORAR_TITANES = ['titan', 'nuca'] as const;

/**
 * Cámara en tercera persona sobre el hombro derecho, con brazo de muelle: se aleja y abre
 * el FOV con la velocidad, colisiona con la geometría (barrido de esfera) y, al mirar hacia
 * arriba, se desliza sobre el suelo en lugar de chocar con él (el choque intermitente con el
 * suelo era lo que hacía temblar la imagen al levantar la vista).
 *
 * La orientación sale directamente de yaw/pitch, así que el centro de la pantalla coincide
 * siempre con la dirección de apuntado de los ganchos.
 *
 * También admite una pose fija (modo ?cam=...) que se mantiene hasta mover el ratón.
 */
export class CamaraTercera {
  yaw = 0;
  pitch = -0.12;
  private distanciaActual: number;
  private fov: number;
  private poseFija: { pos: THREE.Vector3; mirar: THREE.Vector3 } | null = null;
  readonly dir = new THREE.Vector3(0, 0, -1);
  /** Temblor de cámara (0–1): golpes, agarres, pisadas cercanas. */
  sacudida = 0;
  /** Con el jugador en la mano de un titán: se aleja y no choca con su cuerpo. */
  agarrado = false;
  /**
   * Plano cinematográfico (agarre y mordisco de un titán): la cámara viaja hasta `pos` y mira
   * a `mirar`. Lo calcula main.ts cada fotograma; null = cámara normal.
   */
  encuadre: { pos: THREE.Vector3; mirar: THREE.Vector3 } | null = null;
  private cineActivo = false;
  private readonly cinePos = new THREE.Vector3();
  private readonly cineMirar = new THREE.Vector3();
  private hombroActual = 0.5;
  private alejamiento = 0;
  private alabeo = 0;
  private t = 0;
  private readonly brazo = new THREE.Vector3(0, 0, 1);
  private readonly pivote = new THREE.Vector3();
  private readonly derecha = new THREE.Vector3();
  private readonly deseo = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(readonly camara: THREE.PerspectiveCamera, private readonly fisica: Fisica, private readonly excluir: () => RAPIER.Collider) {
    this.distanciaActual = config.camara.distancia;
    this.fov = config.camara.fovBase;
  }

  /** Distancia actual entre el pivote (hombro) y la cámara. */
  get distancia(): number {
    return this.poseFija ? Infinity : this.distanciaActual;
  }

  fijarPose(pos: THREE.Vector3, mirar: THREE.Vector3): void {
    this.poseFija = { pos: pos.clone(), mirar: mirar.clone() };
    const d = mirar.clone().sub(pos).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }

  /** Coloca la cámara detrás del jugador mirando hacia `rumbo` (inicio de capítulo, reaparición). */
  orientar(rumbo: number, pitch = -0.1): void {
    this.poseFija = null;
    this.yaw = rumbo + Math.PI;
    this.pitch = pitch;
  }

  /** Gira la cámara para mirar a `p` desde donde está. */
  mirarA(p: THREE.Vector3): void {
    this.poseFija = null;
    const d = p.clone().sub(this.camara.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), -1.35, 1.3);
  }

  get fija(): boolean {
    return this.poseFija !== null;
  }

  girar(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.poseFija = null;
    const s = config.camara.sensibilidad;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.35, 1.3);
  }

  actualizar(dt: number, centroJugador: THREE.Vector3, velocidad: THREE.Vector3): void {
    const c = config.camara;
    const cam = this.camara;
    this.t += dt;
    const rapidez = velocidad.length();
    const k = THREE.MathUtils.clamp((rapidez - 8) / 37, 0, 1);
    const fovObjetivo = c.fovBase + (c.fovMax - c.fovBase) * k;
    this.fov += (fovObjetivo - this.fov) * Math.min(1, dt * 3);

    if (this.poseFija) {
      cam.position.copy(this.poseFija.pos);
      cam.lookAt(this.poseFija.mirar);
      this.dir.copy(this.poseFija.mirar).sub(this.poseFija.pos).normalize();
      if (cam.fov !== c.fovBase) {
        cam.fov = c.fovBase;
        cam.updateProjectionMatrix();
      }
      return;
    }

    if (this.encuadre) {
      this.cinematica(dt);
      return;
    }
    this.cineActivo = false;

    const cp = Math.cos(this.pitch);
    this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.derecha.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const ignorar = this.agarrado ? IGNORAR_TITANES : undefined;
    const excluir = this.excluir();

    // Pivote sobre el hombro derecho (con su propia colisión para no meterlo en una pared)
    const base = this.tmp.copy(centroJugador);
    base.y += c.alturaPivote - 0.85 + 0.15;
    const libreLado = this.fisica.barrerEsfera(base, this.derecha, 0.7, 0.2, excluir, ignorar) - 0.1;
    const hombro = THREE.MathUtils.clamp(libreLado, 0, 0.5);
    this.hombroActual += (hombro - this.hombroActual) * Math.min(1, dt * (hombro < this.hombroActual ? 20 : 5));
    this.pivote.copy(base).addScaledVector(this.derecha, this.hombroActual);

    // Posición deseada al final del brazo
    this.alejamiento += ((this.agarrado ? 5 : 0) - this.alejamiento) * Math.min(1, dt * 3);
    const deseada = c.distancia * (1 + 0.45 * k) + this.alejamiento;
    this.deseo.copy(this.pivote).addScaledVector(this.dir, -deseada);
    // Mirando hacia arriba el brazo apunta al suelo: la cámara se queda encima y se desliza
    if (this.deseo.y < this.pivote.y) {
      const alto = this.pivote.y - this.deseo.y;
      const suelo = this.fisica.lanzarRayo(this.tmp.set(this.deseo.x, this.pivote.y, this.deseo.z), ABAJO, alto + 0.6, excluir);
      if (suelo) this.deseo.y = Math.max(this.deseo.y, suelo.punto.y + 0.45);
    }
    this.brazo.copy(this.deseo).sub(this.pivote);
    const largo = Math.max(0.01, this.brazo.length());
    this.brazo.divideScalar(largo);

    // Obstáculos entre el hombro y la cámara
    const libre = this.fisica.barrerEsfera(this.pivote, this.brazo, largo, c.radioColision, excluir, ignorar) - 0.05;
    const objetivo = THREE.MathUtils.clamp(Math.min(largo, libre), 0.2, largo);
    if (objetivo < this.distanciaActual) {
      // un obstáculo de verdad: entrar ya; un roce pequeño: entrar rápido pero sin saltos
      this.distanciaActual = this.distanciaActual - objetivo > 0.35 ? objetivo : this.distanciaActual + (objetivo - this.distanciaActual) * Math.min(1, dt * 25);
    } else {
      this.distanciaActual += (objetivo - this.distanciaActual) * Math.min(1, dt * c.suavizado * 0.3);
    }
    cam.position.copy(this.pivote).addScaledVector(this.brazo, this.distanciaActual);

    // Alabeo leve al trazar curvas rápidas con el equipo
    const lateral = velocidad.x * this.derecha.x + velocidad.z * this.derecha.z;
    const alabeoObj = THREE.MathUtils.clamp(-lateral * 0.0025, -0.07, 0.07) * k;
    this.alabeo += (alabeoObj - this.alabeo) * Math.min(1, dt * 3);

    // Temblor suave (ruido de senos, no saltos aleatorios por fotograma)
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (this.sacudida > 0.01) {
      const a = this.sacudida * this.sacudida * 0.045;
      const t = this.t;
      dx = a * (Math.sin(t * 47.3) + 0.5 * Math.sin(t * 91.7 + 1.3));
      dy = a * (Math.sin(t * 39.1 + 2.1) + 0.5 * Math.sin(t * 83.3 + 0.4));
      dz = a * 0.7 * Math.sin(t * 29.9 + 4.2);
    }
    cam.rotation.set(this.pitch + dx, this.yaw + dy, this.alabeo + dz, 'YXZ');

    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Viaja suave hasta el encuadre y lo mantiene; yaw/pitch lo siguen para volver sin salto. */
  private cinematica(dt: number): void {
    const cam = this.camara;
    const e = this.encuadre!;
    if (!this.cineActivo) {
      this.cineActivo = true;
      this.cinePos.copy(cam.position);
      this.cineMirar.copy(cam.position).addScaledVector(this.dir, 10);
    }
    this.cinePos.lerp(e.pos, 1 - Math.exp(-dt * 2.5));
    this.cineMirar.lerp(e.mirar, 1 - Math.exp(-dt * 6));
    cam.position.copy(this.cinePos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.cineMirar);
    this.dir.copy(this.cineMirar).sub(this.cinePos).normalize();
    this.yaw = Math.atan2(-this.dir.x, -this.dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1));
    this.distanciaActual = Math.max(this.distanciaActual, 3);
    if (this.sacudida > 0.01) {
      const a = this.sacudida * this.sacudida * 0.03;
      cam.rotation.z += a * Math.sin(this.t * 41);
      cam.rotation.x += a * Math.sin(this.t * 33 + 1.7);
    }
    const fov = config.camara.fovBase - 8;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
