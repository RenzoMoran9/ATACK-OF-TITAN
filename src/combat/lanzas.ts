import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { Humano, PuntoDebil, TitanAPI, ZonaTitan } from '../core/tipos';
import {
  ALCANCE_LANZA,
  CORAZA_REVENTADA,
  ESPOLETA_LANZA,
  MAX_LANZAS,
  RADIO_EXPLOSION,
  VELOCIDAD_LANZA,
  danioExplosion,
  danioLanzaNuca,
  danioLanzaZona,
  parteMasCercana,
} from './logicaLanzas';

/**
 * Lanzas relámpago del jugador (las cuentas, en logicaLanzas.ts): vuelan hacia la mira (o hacia la
 * parte fijada con X), se clavan en la parte del titán más cercana al impacto y estallan a los
 * 1,4 s. Si no dan a ningún titán, estallan donde caen.
 */

interface LanzaEnVuelo {
  malla: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  recorrido: number;
  /** La parte marcada con X a la que se tiró (si se tiró a una). */
  objetivo: { titan: TitanAPI; zona: ZonaTitan } | null;
}

interface LanzaClavada {
  malla: THREE.Group;
  titan: TitanAPI | null;
  zona: ZonaTitan | null;
  /** Dónde está clavada respecto al centro de la parte (o en el mundo, si no hay titán). */
  offset: THREE.Vector3;
  t: number;
}

const MATERIAL_ASTA = new THREE.MeshLambertMaterial({ color: '#3b3f45' });
const MATERIAL_PUNTA = new THREE.MeshLambertMaterial({ color: '#b9bec4', emissive: '#3a2a10' });

export class LanzasRelampago {
  municion: number;
  maximo = MAX_LANZAS;
  private readonly enVuelo: LanzaEnVuelo[] = [];
  private readonly clavadas: LanzaClavada[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: ContextoJuego,
    private readonly duenio: Humano,
  ) {
    this.municion = this.maximo;
  }

  rellenar(): void {
    this.municion = this.maximo;
  }

  /** Lanza una desde `desde` en la dirección `dir` (hacia `objetivo`, si hay). Devuelve false si no quedan. */
  disparar(desde: THREE.Vector3, dir: THREE.Vector3, objetivo: { titan: TitanAPI; zona: ZonaTitan } | null = null): boolean {
    if (this.municion <= 0) return false;
    this.municion--;
    const malla = this.crearMalla();
    malla.position.copy(desde);
    this.ctx.escena.add(malla);
    this.enVuelo.push({ malla, pos: desde.clone(), vel: dir.clone().normalize().multiplyScalar(VELOCIDAD_LANZA), recorrido: 0, objetivo });
    this.ctx.efectos.destello(desde.clone(), '#ffd27a', 2, 0.15);
    this.ctx.efectos.vapor(desde, 6, 0.4, 1);
    return true;
  }

  actualizar(dt: number): void {
    this.volar(dt);
    for (let i = this.clavadas.length - 1; i >= 0; i--) {
      const c = this.clavadas[i];
      c.t -= dt;
      const p = this.puntoDe(c);
      if (p) c.malla.position.copy(p.centro).add(c.offset);
      // chisporrotea antes de estallar
      if (Math.random() < dt * 20) this.ctx.efectos.estela(c.malla.position, '#ffb347');
      if (c.t > 0) continue;
      this.clavadas.splice(i, 1);
      this.estallar(c);
    }
  }

  private volar(dt: number): void {
    for (let i = this.enVuelo.length - 1; i >= 0; i--) {
      const l = this.enVuelo[i];
      const paso = l.vel.length() * dt;
      const dir = this.tmp.copy(l.vel).normalize();
      const hit = this.ctx.fisica.lanzarRayo(l.pos, dir, paso + 0.3);
      l.vel.y -= 6 * dt;
      let clavo: THREE.Vector3 | null = null;
      if (hit && hit.etiqueta !== 'jugador') clavo = hit.punto.clone();
      else {
        l.pos.addScaledVector(dir, paso);
        l.recorrido += paso;
        // pasa rozando una parte de un titán: se clava ahí
        for (const t of this.ctx.poblacion.titanesCerca(l.pos, 25)) {
          if (t.vivo && parteMasCercana(t.puntosDebiles, l.pos, 1.2)) clavo = l.pos.clone();
        }
        if (!clavo && l.recorrido > ALCANCE_LANZA) clavo = l.pos.clone();
      }
      l.malla.position.copy(l.pos);
      l.malla.lookAt(l.pos.clone().add(l.vel));
      this.ctx.efectos.estela(l.pos, '#8a8f96');
      if (!clavo) continue;
      this.enVuelo.splice(i, 1);
      this.clavar(l, clavo);
    }
  }

  /** Se clava en la parte del titán más cercana al impacto (o en el suelo, y estalla enseguida). */
  private clavar(l: LanzaEnVuelo, punto: THREE.Vector3): void {
    let mejor: { titan: TitanAPI; p: PuntoDebil } | null = null;
    let dMejor = Infinity;
    // tirada a una parte marcada: si cae cerca, se clava en ella (aunque una mano pase más cerca)
    const o = l.objetivo;
    const marcada = o?.titan.vivo ? o.titan.puntosDebiles.find((p) => p.zona === o.zona && p.activo) : undefined;
    if (o && marcada && marcada.centro.distanceTo(punto) - marcada.radio < 3 + o.titan.altura * 0.15) mejor = { titan: o.titan, p: marcada };
    for (const t of mejor ? [] : this.ctx.poblacion.titanesCerca(punto, 30)) {
      if (!t.vivo) continue;
      const p = parteMasCercana(t.puntosDebiles, punto, 4 + t.altura * 0.08);
      if (!p) continue;
      const d = p.centro.distanceTo(punto) - p.radio;
      if (d < dMejor) {
        dMejor = d;
        mejor = { titan: t, p };
      }
    }
    l.malla.position.copy(punto);
    if (mejor) {
      const offset = punto.clone().sub(mejor.p.centro).clampLength(0, mejor.p.radio);
      this.clavadas.push({ malla: l.malla, titan: mejor.titan, zona: mejor.p.zona, offset, t: ESPOLETA_LANZA });
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: mejor.p.zona === 'nuca' ? '¡Lanza clavada en la nuca!' : '¡Lanza clavada!', segundos: 1 });
    } else {
      this.clavadas.push({ malla: l.malla, titan: null, zona: null, offset: punto.clone(), t: 0.3 });
    }
  }

  private puntoDe(c: LanzaClavada): PuntoDebil | null {
    if (!c.titan || !c.zona) return null;
    return c.titan.puntosDebiles.find((x) => x.zona === c.zona) ?? null;
  }

  private estallar(c: LanzaClavada): void {
    const pos = c.malla.position.clone();
    quitar(c.malla);
    this.ctx.efectos.destello(pos.clone(), '#ffb347', 22, 0.9);
    this.ctx.efectos.vapor(pos, 30, 2.5, 6);
    this.ctx.eventos.emit({ tipo: 'canon', pos: pos.clone() });
    const t = c.titan;
    if (t?.vivo && c.zona) this.herirTitan(t, c.zona, pos);
    // la onda alcanza a quien esté cerca, también a ti
    for (const h of this.ctx.poblacion.humanosCerca(pos, RADIO_EXPLOSION)) {
      const danio = danioExplosion(h.posicion.distanceTo(pos));
      if (danio <= 0) continue;
      const herir = (h as unknown as { herir?: (c: number, m?: string) => void }).herir;
      herir?.call(h, danio, h === this.duenio ? 'Te ha alcanzado la explosión de tu propia lanza' : undefined);
    }
  }

  private herirTitan(t: TitanAPI, zona: ZonaTitan, pos: THREE.Vector3): void {
    if (zona === 'nuca') {
      t.romperCoraza?.(CORAZA_REVENTADA);
      const res = t.recibirCorte('nuca', danioLanzaNuca(t.altura, t.especial ?? null), this.duenio);
      this.ctx.eventos.emit({ tipo: 'corte', titan: t, resultado: res, por: this.duenio });
      if (res.efecto === 'coraza') this.ctx.eventos.emit({ tipo: 'mensaje', texto: t.especial === 'colosal' ? 'El vapor del Colosal ha parado la explosión' : 'La nuca endurecida ha parado la explosión', segundos: 2 });
      return;
    }
    // al Acorazado la coraza no le deja herir en otra parte: le revienta una corva y cae
    let z: ZonaTitan = zona;
    if (t.especial === 'acorazado') {
      t.romperCoraza?.(CORAZA_REVENTADA);
      const corva = (['corvaIzq', 'corvaDer'] as ZonaTitan[]).find((q) => t.puntosDebiles.some((p) => p.zona === q && p.activo));
      if (corva) z = corva;
    }
    const res = t.recibirCorte(z, danioLanzaZona(z, t.altura), this.duenio);
    this.ctx.eventos.emit({ tipo: 'corte', titan: t, resultado: res, por: this.duenio });
    this.ctx.efectos.sangre(pos.clone(), new THREE.Vector3(0, 1, 0), 18);
  }

  private crearMalla(): THREE.Group {
    const g = new THREE.Group();
    const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 6).rotateX(Math.PI / 2), MATERIAL_ASTA);
    const punta = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 8).rotateX(Math.PI / 2).translate(0, 0, 0.9), MATERIAL_PUNTA);
    const carga = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.35, 8).rotateX(Math.PI / 2).translate(0, 0, 0.45), MATERIAL_ASTA);
    g.add(asta, punta, carga);
    return g;
  }

  limpiar(): void {
    for (const l of this.enVuelo) quitar(l.malla);
    for (const c of this.clavadas) quitar(c.malla);
    this.enVuelo.length = 0;
    this.clavadas.length = 0;
  }
}

function quitar(g: THREE.Group): void {
  g.removeFromParent();
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
