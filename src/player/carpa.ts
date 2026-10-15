import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { Soldado } from '../npc/soldado';

/**
 * La carpa de campaña (T): se arma delante del jugador a cualquier hora, de día, al atardecer
 * o de noche, y en cualquier suelo firme. Mientras estés a su lado recuperas vida, gas, hojas
 * y aguante, y los compañeros que descansen cerca también se reponen. No se puede armar con un
 * titán encima, ni en el aire. T junto a ella la recoge; T lejos de ella la arma en el sitio
 * nuevo (solo hay una).
 */

/** Radio de la carpa en el suelo (m). */
const RADIO = 2.4;
/** Hasta dónde llega el descanso. */
export const RADIO_DESCANSO = 7;
/** Sin titanes en este radio para poder armarla. */
const RADIO_SEGURO = 40;
/** Vida por segundo que se recupera a su lado. */
const CURACION = 9;

export class Carpa {
  private malla: THREE.Group | null = null;
  private lampara: THREE.Mesh | null = null;
  private pos: THREE.Vector3 | null = null;
  private brillo = 0;

  private readonly matLona = new THREE.MeshLambertMaterial({ color: '#d9cfb2', side: THREE.DoubleSide });
  private readonly matBorde = new THREE.MeshLambertMaterial({ color: '#5d6e4a' });
  private readonly matPoste = new THREE.MeshLambertMaterial({ color: '#4a3524' });
  private readonly matLampara = new THREE.MeshBasicMaterial({ color: '#ffcf7a', fog: false });
  private readonly matSuelo = new THREE.MeshLambertMaterial({ color: '#6b5a40' });

  constructor(private readonly ctx: ContextoJuego) {}

  get armada(): boolean {
    return this.pos !== null;
  }

  /** ¿Estás (o está ese punto) lo bastante cerca como para descansar? */
  cubre(p: THREE.Vector3): boolean {
    return !!this.pos && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < RADIO_DESCANSO && Math.abs(p.y - this.pos.y) < 4;
  }

  /** T: recoge la carpa si estás junto a ella; si no, la arma delante de ti. Devuelve el mensaje. */
  alternar(dir: THREE.Vector3): string {
    const j = this.ctx.jugador;
    if (!j.vivo) return '';
    if (this.pos && this.cubre(j.posicion)) {
      this.quitar();
      return 'Recoges la carpa';
    }
    if (j.agarradoPor) return 'No puedes armar la carpa ahora';
    const delante = new THREE.Vector3(dir.x, 0, dir.z);
    if (delante.lengthSq() < 1e-4) delante.set(0, 0, -1);
    delante.normalize();
    const sitio = j.posicion.clone().addScaledVector(delante, 4.5);
    const suelo = this.ctx.fisica.lanzarRayo(sitio.clone().setY(j.posicion.y + 1.5), new THREE.Vector3(0, -1, 0), 6);
    const aPies = this.ctx.fisica.lanzarRayo(j.posicion, new THREE.Vector3(0, -1, 0), 3);
    if (!suelo || !aPies || suelo.etiqueta === 'titan' || suelo.etiqueta === 'nuca' || Math.abs(suelo.punto.y - aPies.punto.y) > 1) {
      return 'Aquí no se puede armar la carpa: busca un suelo firme y llano';
    }
    if (this.ctx.poblacion.titanesCerca(j.posicion, RADIO_SEGURO).some((t) => t.vivo)) return '¡Hay un titán demasiado cerca para armar la carpa!';
    this.quitar();
    this.armar(suelo.punto.clone(), Math.atan2(delante.x, delante.z));
    return 'Carpa armada: descansa a su lado para recuperar vida, gas y hojas (T para recogerla)';
  }

  /** Reposición a quien esté al lado (jugador y soldados). */
  actualizar(dt: number): void {
    if (!this.pos) return;
    const j = this.ctx.jugador;
    if (j.vivo && this.cubre(j.posicion)) j.curar(CURACION * dt);
    for (const s of this.ctx.escuadron.soldados) {
      if (!s.vivo || !this.cubre(s.posicion)) continue;
      const sol = s as Soldado;
      sol.curar(CURACION * dt);
      sol.gas = Math.min(sol.gasMax, sol.gas + 30 * dt);
      if (sol.cuchillas.repuesto < 4 || sol.cuchillas.filo < 1) sol.cuchillas.rellenar();
    }
  }

  dibujar(dt: number): void {
    if (!this.malla || !this.lampara) return;
    // la lámpara de la entrada brilla más cuanto más oscuro está
    const oscuro = this.ctx.esDeNoche() ? 1 : 0.35;
    this.brillo += (oscuro - this.brillo) * Math.min(1, dt * 2);
    this.matLampara.color.setRGB(1, 0.62 + 0.1 * this.brillo, 0.3 + 0.1 * this.brillo).multiplyScalar(0.7 + 0.5 * this.brillo);
  }

  limpiar(): void {
    this.quitar();
  }

  liberar(): void {
    this.quitar();
    for (const m of [this.matLona, this.matBorde, this.matPoste, this.matLampara, this.matSuelo]) m.dispose();
  }

  // ─────────────────────────── Modelo ───────────────────────────

  private armar(punto: THREE.Vector3, rumbo: number): void {
    const g = new THREE.Group();
    g.position.copy(punto);
    g.rotation.y = rumbo;
    // lona en dos aguas (la entrada mira hacia el jugador, a −Z local)
    const alto = 2.3;
    const ancho = RADIO;
    const largo = 3.4;
    const forma = new THREE.Shape();
    forma.moveTo(-ancho, 0);
    forma.lineTo(0, alto);
    forma.lineTo(ancho, 0);
    forma.lineTo(-ancho, 0);
    const lona = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: largo, bevelEnabled: false }), this.matLona);
    lona.position.z = -largo / 2;
    g.add(lona);
    // borde verde a lo largo de la cumbrera y poste de la entrada
    const cumbrera = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, largo + 0.2), this.matBorde);
    cumbrera.position.y = alto;
    g.add(cumbrera);
    const suelo = new THREE.Mesh(new THREE.CylinderGeometry(ancho + 1.4, ancho + 1.4, 0.06, 20), this.matSuelo);
    suelo.position.y = 0.02;
    g.add(suelo);
    for (const x of [-0.9, 0.9]) {
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), this.matPoste);
      poste.position.set(x, 0.75, -largo / 2 - 0.5);
      g.add(poste);
    }
    const lampara = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.matLampara);
    lampara.position.set(0.9, 1.55, -largo / 2 - 0.5);
    g.add(lampara);
    for (const o of g.children) o.castShadow = o !== lampara;
    this.ctx.escena.add(g);
    this.malla = g;
    this.lampara = lampara;
    this.pos = punto;
  }

  private quitar(): void {
    if (this.malla) {
      this.malla.removeFromParent();
      this.malla.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.malla = null;
    this.lampara = null;
    this.pos = null;
  }
}
