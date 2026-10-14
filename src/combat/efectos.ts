import * as THREE from 'three';
import { Particulas } from '../player/particulas';
import { texturaParticula } from '../world/texturas';

/**
 * Efectos de combate compartidos: vapor blanco denso (regeneración y muerte de titanes),
 * sangre roja estilizada y breve, y columnas de humo de bengala de colores.
 */
export class Efectos {
  private readonly vaporP: Particulas;
  private readonly sangreP: Particulas;
  private readonly humoP: Map<string, Particulas> = new Map();
  private readonly fuentes: { pos: THREE.Vector3; restante: number; ritmo: number; tam: number; acum: number; seguir?: () => THREE.Vector3 | null }[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly destellos: { s: THREE.Sprite; t: number; dur: number; tam: number }[] = [];
  /** Aviso para el sonido: se ha disparado una bengala. */
  alBengala: ((pos: THREE.Vector3) => void) | null = null;

  constructor(private readonly escena: THREE.Scene) {
    this.vaporP = new Particulas(escena, 1400, '#f4f6f8', 3.2, { gravedad: -1.2, alfaMax: 0.55, amortiguacion: 0.8 });
    this.sangreP = new Particulas(escena, 600, '#c0141c', 0.08, { gravedad: 14, alfaMax: 1, amortiguacion: 0.3 });
  }

  /** Bocanada de vapor en un punto (tam = tamaño inicial de cada nube en m). */
  vapor(pos: THREE.Vector3, cantidad = 12, tam = 2, velocidad = 3): void {
    for (let i = 0; i < cantidad; i++) {
      this.tmp.set(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).normalize().multiplyScalar(velocidad * (0.5 + Math.random()));
      this.vaporP.emitir(pos, this.tmp, 2.5 + Math.random() * 2.5, tam * (0.6 + Math.random() * 0.8), velocidad * 0.5);
    }
  }

  /**
   * Emisor continuo de vapor durante `segundos` (regeneración o cadáver evaporándose).
   * Si `seguir` devuelve una posición, el emisor la sigue; si devuelve null, se apaga.
   */
  vaporContinuo(pos: THREE.Vector3, segundos: number, porSegundo = 10, tam = 2, seguir?: () => THREE.Vector3 | null): void {
    this.fuentes.push({ pos: pos.clone(), restante: segundos, ritmo: porSegundo, tam, acum: 0, seguir });
  }

  /** Salpicadura de sangre roja, corta y estilizada, en la dirección del corte. */
  /** Salpicadura de sangre; `escala` agranda las gotas (el mordisco de un titán se ve de lejos). */
  sangre(pos: THREE.Vector3, dir: THREE.Vector3, cantidad = 18, escala = 1): void {
    for (let i = 0; i < cantidad; i++) {
      this.tmp.copy(dir).normalize().multiplyScalar(4 + Math.random() * 8).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4));
      this.sangreP.emitir(pos, this.tmp, 0.45 + Math.random() * 0.3 * escala, (0.08 + Math.random() * 0.12) * escala, 1);
    }
  }

  /** Columna vertical de humo de bengala (rojo, negro, verde, morado, azul, amarillo). */
  bengala(pos: THREE.Vector3, color: string): void {
    this.alBengala?.(pos);
    const p = this.humo(color);
    for (let i = 0; i < 40; i++) {
      p.emitir(new THREE.Vector3(pos.x, pos.y + i * 1.5, pos.z), new THREE.Vector3(0, 6 + Math.random() * 4, 0), 8 + Math.random() * 4, 2.5, 0.6);
    }
  }

  /** Estela de humo de un proyectil (la bengala en vuelo). */
  estela(pos: THREE.Vector3, color: string): void {
    const p = this.humo(color);
    this.tmp.set((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6);
    p.emitir(pos, this.tmp, 1.6 + Math.random(), 0.7, 0.3);
  }

  /** Fogonazo de luz breve (sin luz real: un sprite aditivo que crece y se apaga). */
  destello(pos: THREE.Vector3, color: string, tam = 8, dur = 0.7): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaParticula(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.position.copy(pos);
    s.scale.setScalar(tam * 0.4);
    this.escena.add(s);
    this.destellos.push({ s, t: 0, dur, tam });
  }

  private humo(color: string): Particulas {
    let p = this.humoP.get(color);
    if (!p) {
      p = new Particulas(this.escena, 400, color, 2.6, { gravedad: -2.5, alfaMax: 0.7, amortiguacion: 0.4 });
      this.humoP.set(color, p);
    }
    return p;
  }

  actualizar(dt: number): void {
    for (let i = this.destellos.length - 1; i >= 0; i--) {
      const d = this.destellos[i];
      d.t += dt;
      const k = d.t / d.dur;
      d.s.scale.setScalar(d.tam * (0.4 + 0.8 * Math.min(1, k * 3)));
      d.s.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.escena.remove(d.s);
        d.s.material.dispose();
        this.destellos.splice(i, 1);
      }
    }
    for (let i = this.fuentes.length - 1; i >= 0; i--) {
      const f = this.fuentes[i];
      if (f.seguir) {
        const p = f.seguir();
        if (!p) {
          this.fuentes.splice(i, 1);
          continue;
        }
        f.pos.copy(p);
      }
      f.restante -= dt;
      f.acum += f.ritmo * dt;
      while (f.acum >= 1) {
        f.acum -= 1;
        this.tmp.set((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2);
        this.vaporP.emitir(f.pos, this.tmp, 3 + Math.random() * 2, f.tam * (0.6 + Math.random() * 0.8), 1.5);
      }
      if (f.restante <= 0) this.fuentes.splice(i, 1);
    }
    this.vaporP.actualizar(dt);
    this.sangreP.actualizar(dt);
    for (const p of this.humoP.values()) p.actualizar(dt);
  }
}
