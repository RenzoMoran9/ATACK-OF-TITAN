import * as THREE from 'three';
import { texturaParticula } from '../world/texturas';

/**
 * Sistema de partículas sencillo (THREE.Points con tamaño y opacidad por partícula).
 * Se usa para los chorros cortos de gas blanco; servirá también para el vapor de titanes.
 */

const VERT = /* glsl */ `
attribute float tamano;
attribute float alfa;
varying float vAlfa;
void main() {
  vAlfa = alfa;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = tamano * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D mapa;
uniform vec3 color;
varying float vAlfa;
void main() {
  vec4 t = texture2D(mapa, gl_PointCoord);
  gl_FragColor = vec4(color, t.a * vAlfa);
  #include <colorspace_fragment>
}`;

export class Particulas {
  readonly puntos: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly vida: Float32Array;
  private readonly vidaMax: Float32Array;
  private readonly tam: Float32Array;
  private readonly alfa: Float32Array;
  private siguiente = 0;

  constructor(escena: THREE.Scene, private readonly capacidad: number, color = '#ffffff', private readonly crecimiento = 2.2) {
    this.pos = new Float32Array(capacidad * 3);
    this.vel = new Float32Array(capacidad * 3);
    this.vida = new Float32Array(capacidad);
    this.vidaMax = new Float32Array(capacidad).fill(1);
    this.tam = new Float32Array(capacidad);
    this.alfa = new Float32Array(capacidad);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('tamano', new THREE.BufferAttribute(this.tam, 1));
    geo.setAttribute('alfa', new THREE.BufferAttribute(this.alfa, 1));
    this.puntos = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { mapa: { value: texturaParticula() }, color: { value: new THREE.Color(color) } },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.puntos.frustumCulled = false;
    escena.add(this.puntos);
  }

  emitir(origen: THREE.Vector3, velocidad: THREE.Vector3, vida: number, tamano: number, dispersion = 1): void {
    const i = this.siguiente;
    this.siguiente = (this.siguiente + 1) % this.capacidad;
    this.pos.set([origen.x, origen.y, origen.z], i * 3);
    this.vel.set(
      [
        velocidad.x + (Math.random() - 0.5) * dispersion,
        velocidad.y + (Math.random() - 0.5) * dispersion,
        velocidad.z + (Math.random() - 0.5) * dispersion,
      ],
      i * 3,
    );
    this.vida[i] = vida;
    this.vidaMax[i] = vida;
    this.tam[i] = tamano;
  }

  actualizar(dt: number): void {
    for (let i = 0; i < this.capacidad; i++) {
      if (this.vida[i] <= 0) {
        this.alfa[i] = 0;
        continue;
      }
      this.vida[i] -= dt;
      const t = 1 - this.vida[i] / this.vidaMax[i];
      const amort = Math.max(0, 1 - dt * 4);
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= amort;
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      }
      this.tam[i] += this.crecimiento * dt;
      this.alfa[i] = Math.max(0, 0.75 * (1 - t));
    }
    const geo = this.puntos.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.tamano.needsUpdate = true;
    geo.attributes.alfa.needsUpdate = true;
  }
}
