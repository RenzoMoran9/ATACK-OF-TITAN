import * as THREE from 'three';
import { Lote, cajaUV, matriz } from './geometria';
import { texturaParticula } from './texturas';

/**
 * Antorchas y faroles: de noche se encienden (llama + luz cálida). Solo las más
 * cercanas a la cámara llevan PointLight real para no disparar el coste del shader.
 * Un farol puede depender de una condición (los de un pueblo, solo si vuelve a vivir gente).
 */
export class Antorchas {
  readonly grupo = new THREE.Group();
  private readonly posiciones: THREE.Vector3[] = [];
  /** Condición de cada punto de luz (null = siempre que sea de noche). */
  private readonly condiciones: ((() => boolean) | null)[] = [];
  private readonly activas: boolean[] = [];
  private readonly lote = new Lote();
  private llamas: THREE.Points | null = null;
  private readonly luces: THREE.PointLight[] = [];
  private encendidas = false;
  private reloj = 0;

  constructor(private readonly maxLuces: number) {}

  /** Poste de farol de calle. */
  farol(x: number, y: number, z: number, condicion: (() => boolean) | null = null): void {
    this.lote.añadir(cajaUV(0.18, 3.2, 0.18, 1), matriz(x, y + 1.6, z), new THREE.Color('#2a2420'));
    this.lote.añadir(cajaUV(0.45, 0.55, 0.45, 1), matriz(x, y + 3.4, z), new THREE.Color('#1c1a18'));
    this.posiciones.push(new THREE.Vector3(x, y + 3.4, z));
    this.condiciones.push(condicion);
  }

  /** Antorcha en soporte de pared (sobre la muralla o la puerta). */
  antorcha(x: number, y: number, z: number): void {
    this.lote.añadir(cajaUV(0.14, 1.2, 0.14, 1), matriz(x, y + 0.6, z), new THREE.Color('#3a2a1c'));
    this.posiciones.push(new THREE.Vector3(x, y + 1.35, z));
    this.condiciones.push(null);
  }

  /** Vuelve a mirar las condiciones de los faroles (llamas apagadas en negro: se suman a nada). */
  refrescar(): void {
    const llamas = this.llamas;
    let cambio = false;
    this.condiciones.forEach((c, i) => {
      const si = c ? c() : true;
      if (this.activas[i] === si) return;
      this.activas[i] = si;
      cambio = true;
      if (llamas) {
        const col = llamas.geometry.getAttribute('color') as THREE.BufferAttribute;
        const v = si ? 1 : 0;
        col.setXYZ(i, v, v, v);
        col.needsUpdate = true;
      }
    });
    if (cambio) this.reloj = 1;
  }

  construir(): void {
    if (!this.lote.vacio) {
      this.grupo.add(this.lote.crearMesh(new THREE.MeshLambertMaterial({ vertexColors: true }), false));
    }
    const pos = new Float32Array(this.posiciones.length * 3);
    this.posiciones.forEach((p, i) => p.toArray(pos, i * 3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.posiciones.length * 3).fill(1), 3));
    this.activas.length = 0;
    for (let i = 0; i < this.posiciones.length; i++) this.activas.push(true);
    this.llamas = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: texturaParticula(),
        color: '#ffb35c',
        vertexColors: true,
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
      const cercanas = this.posiciones
        .filter((_, i) => this.activas[i] !== false)
        .sort((a, b) => a.distanceToSquared(camara) - b.distanceToSquared(camara))
        .slice(0, this.luces.length);
      cercanas.forEach((p, i) => this.luces[i].position.copy(p));
      // sobran luces (faroles apagados): se esconden bajo el suelo
      for (let i = cercanas.length; i < this.luces.length; i++) this.luces[i].position.set(0, -500, 0);
    }
    this.luces.forEach((l, i) => {
      l.intensity = 900 * (0.85 + 0.15 * Math.sin(t * 13 + i * 1.7) * Math.sin(t * 7.3 + i));
    });
  }
}
