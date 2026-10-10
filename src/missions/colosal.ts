import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';

/**
 * Escena guionizada del Titán Colosal (60 m) en la puerta sur: la cabeza sin piel asoma
 * por encima de la muralla entre vapor, los dedos se agarran a la coronación, la patada
 * revienta la puerta y desaparece en una explosión de vapor. No se le puede combatir.
 */

function texturaMusculo(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8e2a22';
  g.fillRect(0, 0, 256, 256);
  // fibras musculares verticales
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 256;
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(60,10,8,0.5)' : 'rgba(190,80,60,0.45)';
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + Math.random() * 20 - 10, 85, x + Math.random() * 20 - 10, 170, x + Math.random() * 10 - 5, 256);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Colosal {
  private readonly grupo = new THREE.Group();
  private readonly cabeza = new THREE.Group();
  private readonly manos: THREE.Group[] = [];
  private t = 0;
  private patadaHecha = false;
  terminado = false;

  /** `alPatear` se llama en el instante de la patada (romper la puerta, temblor…). */
  constructor(private readonly ctx: ContextoJuego, private readonly alPatear: () => void) {
    const musculo = new THREE.MeshLambertMaterial({ map: texturaMusculo(), color: '#ffffff' });
    const dientes = new THREE.MeshLambertMaterial({ color: '#efe6cf' });
    const negro = new THREE.MeshLambertMaterial({ color: '#120808' });
    const ojoMat = new THREE.MeshLambertMaterial({ color: '#f2eee4', emissive: new THREE.Color('#3a2a10'), emissiveIntensity: 0.4 });

    // Cabeza: cráneo alargado sin piel, mandíbula marcada, dientes al aire (sin labios)
    const craneo = new THREE.Mesh(new THREE.SphereGeometry(6.2, 32, 24), musculo);
    craneo.scale.set(1, 1.25, 1.05);
    this.cabeza.add(craneo);
    const mandibula = new THREE.Mesh(new THREE.SphereGeometry(5.2, 28, 18, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4), musculo);
    mandibula.position.set(0, -2.6, 0.6);
    mandibula.scale.set(1, 1.1, 1.15);
    this.cabeza.add(mandibula);
    const filaDientes = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.1, 1.7, 32, 1, true, -1.1, 2.2), dientes);
    filaDientes.position.set(0, -2.7, 1.6);
    filaDientes.rotation.y = Math.PI;
    this.cabeza.add(filaDientes);
    const boca = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.25, 0.4), negro);
    boca.position.set(0, -2.7, 5.9);
    this.cabeza.add(boca);
    for (const lado of [-1, 1]) {
      const cuenca = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), negro);
      cuenca.position.set(lado * 2.3, 1.6, 5.2);
      const ojo = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), ojoMat);
      ojo.position.set(lado * 2.3, 1.6, 5.75);
      this.cabeza.add(cuenca, ojo);
    }
    // Cuello y hombros
    const cuello = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.5, 10, 24), musculo);
    cuello.position.set(0, -9, -0.5);
    this.cabeza.add(cuello);
    const hombros = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), musculo);
    hombros.scale.set(17, 7, 7);
    hombros.position.set(0, -16, -1);
    this.cabeza.add(hombros);

    // Manos agarradas a la coronación
    for (const lado of [-1, 1]) {
      const mano = new THREE.Group();
      for (let d = 0; d < 4; d++) {
        const dedo = new THREE.Mesh(new THREE.CapsuleGeometry(0.65, 5, 6, 10), musculo);
        dedo.rotation.x = Math.PI / 2.2;
        dedo.position.set((d - 1.5) * 1.6, 0, 2.2);
        mano.add(dedo);
      }
      const palma = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), musculo);
      palma.scale.set(4, 2.2, 3);
      palma.position.set(0, -2, 1);
      mano.add(palma);
      mano.position.set(lado * 19, 0, 9);
      this.manos.push(mano);
      this.grupo.add(mano);
    }

    this.grupo.add(this.cabeza);
    const R = ctx.mundo.muralla.radioExterior;
    this.grupo.position.set(0, 0, R + 9);
    this.grupo.rotation.y = Math.PI; // mira hacia el distrito (−Z)
    this.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.cabeza.position.set(0, 38, 0);
    for (const m of this.manos) m.position.y = 40;
    ctx.escena.add(this.grupo);
  }

  /** Línea de tiempo: 0–4 s asoma, 4–6,5 s mira, 6,5 s patada, 6,5–10 s se esfuma en vapor. */
  actualizar(dt: number): void {
    if (this.terminado) return;
    this.t += dt;
    const H = this.ctx.mundo.muralla.altura;
    const subida = THREE.MathUtils.smoothstep(this.t, 0, 4);
    this.cabeza.position.y = 38 + subida * (H + 8 - 38);
    for (const m of this.manos) m.position.y = THREE.MathUtils.lerp(H - 6, H + 1.2, THREE.MathUtils.smoothstep(this.t, 1.5, 3.5));
    this.cabeza.rotation.y = Math.sin(this.t * 0.4) * 0.05;
    // vapor constante que le sale del cuerpo
    if (Math.random() < dt * 8) {
      const p = this.cabeza.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3((Math.random() - 0.5) * 18, -6 + Math.random() * 8, (Math.random() - 0.5) * 8));
      this.ctx.efectos.vapor(p, 3, 6, 4);
    }
    if (!this.patadaHecha && this.t > 6.5) {
      this.patadaHecha = true;
      const puerta = this.ctx.mundo.muralla.puerta.clone();
      this.ctx.efectos.vapor(puerta.clone().setY(10), 70, 9, 22);
      this.ctx.efectos.vapor(puerta.clone().setY(30), 50, 12, 16);
      this.alPatear();
    }
    if (this.t > 6.5) {
      // desaparece envuelto en vapor
      const f = THREE.MathUtils.clamp((this.t - 7) / 3, 0, 1);
      this.grupo.scale.setScalar(1 - 0.15 * f);
      this.grupo.visible = f < 0.95;
      if (Math.random() < dt * 30) {
        const p = this.cabeza.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 10));
        this.ctx.efectos.vapor(p, 4, 10, 8);
      }
    }
    if (this.t > 10.5) this.eliminar();
  }

  eliminar(): void {
    this.terminado = true;
    this.ctx.escena.remove(this.grupo);
  }
}
