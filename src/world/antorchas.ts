import * as THREE from 'three';
import { Lote, cajaUV, matriz } from './geometria';
import { texturaParticula } from './texturas';

/**
 * Antorchas y faroles: de noche se encienden (llama + luz cálida). Solo las más
 * cercanas a la cámara llevan PointLight real para no disparar el coste del shader.
 */
export class Antorchas {
  readonly grupo = new THREE.Group();
  private readonly posiciones: THREE.Vector3[] = [];
  private readonly lote = new Lote();
  private llamas: THREE.Points | null = null;
  private readonly luces: THREE.PointLight[] = [];
  private encendidas = false;
  private reloj = 0;

  constructor(private readonly maxLuces: number) {}

  /** Poste de farol de calle. */
  farol(x: number, y: number, z: number): void {
    this.lote.añadir(cajaUV(0.18, 3.2, 0.18, 1), matriz(x, y + 1.6, z), new THREE.Color('#2a2420'));
    this.lote.añadir(cajaUV(0.45, 0.55, 0.45, 1), matriz(x, y + 3.4, z), new THREE.Color('#1c1a18'));
    this.posiciones.push(new THREE.Vector3(x, y + 3.4, z));
  }

  /** Antorcha en soporte de pared (sobre la muralla o la puerta). */
  antorcha(x: number, y: number, z: number): void {
    this.lote.añadir(cajaUV(0.14, 1.2, 0.14, 1), matriz(x, y + 0.6, z), new THREE.Color('#3a2a1c'));
    this.posiciones.push(new THREE.Vector3(x, y + 1.35, z));
  }

  construir(): void {
    if (!this.lote.vacio) {
      this.grupo.add(this.lote.crearMesh(new THREE.MeshLambertMaterial({ vertexColors: true }), false));
    }
    const pos = new Float32Array(this.posiciones.length * 3);
    this.posiciones.forEach((p, i) => p.toArray(pos, i * 3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.llamas = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: texturaParticula(),
        color: '#ffb35c',
        size: 2.4,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.llamas.visible = false;
    this.grupo.add(this.llamas);
    for (let i = 0; i < this.maxLuces; i++) {
      const luz = new THREE.PointLight('#ff9a48', 0, 38, 1.6);
      luz.visible = false;
      this.luces.push(luz);
      this.grupo.add(luz);
    }
  }

  encender(si: boolean): void {
    this.encendidas = si;
    if (this.llamas) this.llamas.visible = si;
    for (const l of this.luces) l.visible = si;
    this.reloj = 1;
  }

  actualizar(dt: number, camara: THREE.Vector3, t: number): void {
    if (!this.encendidas) return;
    this.reloj += dt;
    if (this.reloj > 0.3) {
      this.reloj = 0;
      const cercanas = [...this.posiciones]
        .sort((a, b) => a.distanceToSquared(camara) - b.distanceToSquared(camara))
        .slice(0, this.luces.length);
      cercanas.forEach((p, i) => this.luces[i].position.copy(p));
    }
    this.luces.forEach((l, i) => {
      l.intensity = 900 * (0.85 + 0.15 * Math.sin(t * 13 + i * 1.7) * Math.sin(t * 7.3 + i));
    });
  }
}
