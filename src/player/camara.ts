import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../core/config';
import type { Fisica } from '../core/fisica';

/**
 * Cámara en tercera persona con brazo de muelle: detrás y algo por encima del jugador,
 * se aleja y abre el FOV con la velocidad, y colisiona con la geometría (barrido de
 * esfera) para no atravesar paredes ni perder al jugador en las esquinas.
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

  constructor(readonly camara: THREE.PerspectiveCamera, private readonly fisica: Fisica, private readonly excluir: () => RAPIER.Collider) {
    this.distanciaActual = config.camara.distancia;
    this.fov = config.camara.fovBase;
  }

  fijarPose(pos: THREE.Vector3, mirar: THREE.Vector3): void {
    this.poseFija = { pos: pos.clone(), mirar: mirar.clone() };
    const d = mirar.clone().sub(pos).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }

  get fija(): boolean {
    return this.poseFija !== null;
  }

  girar(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.poseFija = null;
    const s = config.camara.sensibilidad;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.35, 1.25);
  }

  actualizar(dt: number, centroJugador: THREE.Vector3, velocidad: THREE.Vector3): void {
    const c = config.camara;
    const cam = this.camara;
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

    this.dir.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const pivote = centroJugador.clone();
    pivote.y += c.alturaPivote - 0.85;
    const deseada = c.distancia * (1 + 0.45 * k);
    const atras = this.dir.clone().negate();
    const libre = this.fisica.barrerEsfera(pivote, atras, deseada, c.radioColision, this.excluir()) - 0.05;
    const objetivo = Math.max(0.6, Math.min(deseada, libre));
    // acercarse al instante si hay obstáculo, alejarse con suavidad
    if (objetivo < this.distanciaActual) this.distanciaActual = objetivo;
    else this.distanciaActual += (objetivo - this.distanciaActual) * Math.min(1, dt * c.suavizado * 0.3);

    cam.position.copy(pivote).addScaledVector(atras, this.distanciaActual);
    cam.lookAt(pivote.clone().addScaledVector(this.dir, 10));
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
