import * as THREE from 'three';
import type { Bosque } from './bosque';

/**
 * Ambiente amenazante dentro de los bosques: al meterse bajo las copas la niebla se cierra
 * y oscurece (verde grisáceo de día, casi negra de noche) y bajan el sol y la luz del cielo.
 * Se mezcla con suavidad según lo profundo que esté la cámara y desaparece por encima de las
 * copas. Parte de los valores que deja el cielo para la hora actual (`tomarBase`).
 */

const COLOR_DIA = new THREE.Color('#47554b');
const COLOR_NOCHE = new THREE.Color('#070c16');

export class AmbienteBosque {
  /** Mezcla actual (0 fuera, 1 en lo hondo del bosque). */
  mezcla = 0;
  private readonly base = { color: new THREE.Color(), cerca: 300, lejos: 3000, sol: 1, hemi: 1 };
  private readonly colorBosque = new THREE.Color();

  constructor(
    private readonly escena: THREE.Scene,
    private readonly sol: THREE.Light,
    private readonly hemi: THREE.Light,
    private readonly bosques: readonly Bosque[],
  ) {}

  /** Guarda niebla y luces de la hora (llamar justo después de que el cielo las cambie). */
  tomarBase(noche: boolean): void {
    const f = this.escena.fog;
    if (f instanceof THREE.Fog) {
      this.base.color.copy(f.color);
      this.base.cerca = f.near;
      this.base.lejos = f.far;
    }
    this.base.sol = this.sol.intensity;
    this.base.hemi = this.hemi.intensity;
    this.colorBosque.copy(noche ? COLOR_NOCHE : COLOR_DIA);
    this.mezcla = -1; // fuerza la aplicación en el siguiente fotograma
  }

  /** Profundidad efectiva (0–1) de un punto dentro de algún bosque. */
  dentro(p: THREE.Vector3): number {
    let m = 0;
    for (const b of this.bosques) {
      const prof = b.profundidad(p.x, p.z);
      if (prof <= 0) continue;
      const gigante = b.tipo === 'gigante';
      const f = THREE.MathUtils.clamp(prof / (gigante ? 70 : 45), 0, 1) * (gigante ? 1 : 0.85);
      const bajoCopas = THREE.MathUtils.clamp((b.alturaCopa - p.y) / 25, 0, 1);
      m = Math.max(m, f * bajoCopas);
    }
    return m;
  }

  actualizar(dt: number, camara: THREE.Vector3): void {
    const objetivo = this.dentro(camara);
    const previa = this.mezcla;
    const f = previa < 0 ? objetivo : previa + (objetivo - previa) * Math.min(1, dt * 1.5);
    if (Math.abs(f - previa) < 1e-4) return;
    this.mezcla = f;
    const niebla = this.escena.fog;
    if (niebla instanceof THREE.Fog) {
      niebla.color.copy(this.base.color).lerp(this.colorBosque, 0.85 * f);
      niebla.near = THREE.MathUtils.lerp(this.base.cerca, 15, f);
      niebla.far = THREE.MathUtils.lerp(this.base.lejos, 420, f);
    }
    this.sol.intensity = this.base.sol * (1 - 0.45 * f);
    this.hemi.intensity = this.base.hemi * (1 - 0.5 * f);
  }
}
