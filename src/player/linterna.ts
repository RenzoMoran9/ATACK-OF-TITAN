import * as THREE from 'three';

/**
 * Linterna de aceite colgada del cinturón del equipo: un foco que alumbra hacia donde mira
 * la cámara y un halo cálido alrededor del soldado. Las luces existen siempre y se apagan con
 * intensidad 0 (añadir o quitar luces obligaría a recompilar todos los materiales).
 */
export class Linterna {
  encendida = false;
  /** El jugador la ha encendido o apagado a mano: no volver a encenderla sola. */
  manual = false;
  private brillo = 0;
  private readonly foco: THREE.SpotLight;
  private readonly halo: THREE.PointLight;
  private readonly llama: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;

  constructor(escena: THREE.Scene) {
    this.foco = new THREE.SpotLight('#ffe2b0', 0, 80, 0.72, 0.75, 1);
    this.foco.castShadow = false;
    this.halo = new THREE.PointLight('#ffc27a', 0, 16, 1.5);
    this.llama = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0 }));
    escena.add(this.foco, this.foco.target, this.halo, this.llama);
  }

  alternar(): boolean {
    this.encendida = !this.encendida;
    this.manual = true;
    return this.encendida;
  }

  /**
   * `pecho`: posición del jugador (centro); `dir`: dirección de la cámara; `cadera`: punto del
   * cinturón donde cuelga la lámpara (lado izquierdo); `t` para el parpadeo de la llama.
   */
  actualizar(dt: number, pecho: THREE.Vector3, dir: THREE.Vector3, cadera: THREE.Vector3, visible: boolean, t: number): void {
    const objetivo = this.encendida && visible ? 1 : 0;
    this.brillo += (objetivo - this.brillo) * Math.min(1, dt * 8);
    const parpadeo = 0.93 + 0.05 * Math.sin(t * 13.1) + 0.03 * Math.sin(t * 29.7 + 1.3);
    const k = this.brillo * parpadeo;
    this.foco.intensity = 120 * k;
    this.halo.intensity = 9 * k;
    this.llama.material.opacity = Math.min(1, this.brillo * 1.2);
    this.llama.visible = this.brillo > 0.02;
    this.foco.position.copy(pecho).addScaledVector(dir, 0.3).y += 0.9;
    // un poco hacia abajo: alumbra el suelo por delante además de lo que miras
    this.foco.target.position.copy(this.foco.position).addScaledVector(dir, 25).y -= 3.5;
    // el halo va entre la cámara y el soldado, por encima: lo ilumina por el lado que se ve
    this.halo.position.copy(cadera).addScaledVector(dir, -1.1).y += 1.1;
    this.llama.position.copy(cadera);
    this.foco.target.updateMatrixWorld();
  }
}
