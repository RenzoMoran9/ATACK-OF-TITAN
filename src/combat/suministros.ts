import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';

/**
 * Equipos que se pueden recoger del suelo: el ODM de un soldado caído (como en Trost, donde
 * se rebuscaba gas y cuchillas entre los muertos) o cajas de suministros que dejan las
 * misiones. Cada uno tiene un haz de luz para encontrarlo desde lejos. G para recoger.
 */

export interface Equipo {
  readonly pos: THREE.Vector3;
  readonly gas: number;
  readonly pares: number;
  readonly origen: string;
  readonly malla: THREE.Group;
}

const RADIO_RECOGER = 4;

export class Suministros {
  readonly lista: Equipo[] = [];
  private readonly matMetal = new THREE.MeshPhongMaterial({ color: '#9aa1a8', specular: '#ffffff', shininess: 80 });
  private readonly matCarcasa = new THREE.MeshLambertMaterial({ color: '#575c62' });
  private readonly matCorrea = new THREE.MeshLambertMaterial({ color: '#2f1e13' });
  private readonly matHaz = new THREE.MeshBasicMaterial({ color: '#cfe7a0', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  private readonly quitar: () => void;

  constructor(private readonly ctx: ContextoJuego) {
    // Cuando cae un compañero, su equipo queda en el suelo bajo el titán
    this.quitar = ctx.eventos.on('humanoDevorado', (e) => {
      if (e.humano.tipo !== 'soldado') return;
      const p = e.humano.posicion.clone();
      const dir = p.clone().sub(e.titan.posicion).setY(0);
      if (dir.lengthSq() < 1) dir.set(1, 0, 0);
      p.addScaledVector(dir.normalize(), 2 + e.titan.altura * 0.2);
      this.soltar(p, 55, 2, `equipo de ${e.humano.nombre}`);
    });
  }

  /** Deja un equipo en el suelo (o tejado) bajo `p`. */
  soltar(p: THREE.Vector3, gas: number, pares: number, origen: string): void {
    const hit = this.ctx.fisica.lanzarRayo(p.clone().setY(p.y + 2), new THREE.Vector3(0, -1, 0), p.y + 60);
    const pos = new THREE.Vector3(p.x, hit ? hit.punto.y : 0, p.z);
    const g = new THREE.Group();
    g.position.copy(pos);
    const caja = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.13), this.matCarcasa);
    caja.position.y = 0.07;
    g.add(caja);
    for (const s of [-1, 1]) {
      const cil = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.46, 12), this.matMetal);
      cil.rotation.x = Math.PI / 2;
      cil.position.set(s * 0.22, 0.06, 0.1);
      g.add(cil);
      const vaina = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.52), this.matMetal);
      vaina.position.set(s * 0.38, 0.07, 0.05);
      vaina.rotation.y = s * 0.3;
      g.add(vaina);
    }
    const correa = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 20), this.matCorrea);
    correa.rotation.x = Math.PI / 2;
    correa.position.y = 0.02;
    g.add(correa);
    g.rotation.y = Math.random() * Math.PI * 2;
    // haz de luz para verlo desde lejos
    const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 12, 1, true), this.matHaz);
    haz.position.y = 15;
    haz.renderOrder = 3;
    g.add(haz);
    for (const o of g.children) o.castShadow = o !== haz;
    this.ctx.escena.add(g);
    this.lista.push({ pos, gas, pares, origen, malla: g });
  }

  /** El equipo más cercano a `p` (y su distancia). */
  masCercano(p: THREE.Vector3): { equipo: Equipo; distancia: number } | null {
    let mejor: Equipo | null = null;
    let d = Infinity;
    for (const e of this.lista) {
      const x = e.pos.distanceTo(p);
      if (x < d) {
        d = x;
        mejor = e;
      }
    }
    return mejor ? { equipo: mejor, distancia: d } : null;
  }

  /** Recoge el equipo que tenga al lado; devuelve un texto para el mensaje o null. */
  recoger(): string | null {
    const j = this.ctx.jugador;
    const c = this.masCercano(j.posicion);
    if (!c || c.distancia > RADIO_RECOGER) return null;
    j.recogerEquipo(c.equipo.gas, c.equipo.pares);
    this.quitarEquipo(c.equipo);
    return `Recoges el ${c.equipo.origen}: +${c.equipo.gas} de gas${c.equipo.pares ? ` y ${c.equipo.pares} pares de cuchillas` : ''}`;
  }

  puedeRecoger(): boolean {
    const c = this.masCercano(this.ctx.jugador.posicion);
    return !!c && c.distancia <= RADIO_RECOGER;
  }

  private quitarEquipo(e: Equipo): void {
    e.malla.removeFromParent();
    e.malla.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.lista.splice(this.lista.indexOf(e), 1);
  }

  limpiar(): void {
    for (const e of [...this.lista]) this.quitarEquipo(e);
  }

  dibujar(t: number): void {
    this.matHaz.opacity = 0.22 + 0.08 * Math.sin(t * 3);
  }

  liberar(): void {
    this.quitar();
    this.limpiar();
  }
}
