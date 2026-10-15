import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { EspecialTitan, TitanAPI } from '../core/tipos';
import { alturaEspecial, nombreEspecial } from '../titans/especiales';
import type { Titan } from '../titans/titan';

/**
 * Asaltos de los cambiantes a la muralla de Trost. Cada cierto tiempo uno de ellos (por turnos:
 * Colosal, Acorazado, Bestia) avanza hacia la puerta sur con una escolta de titanes, y hay que
 * pararlo antes de que la eche abajo:
 *
 * - Colosal (60 m): camina despacio hasta la puerta y la patea (cinco patadas la rompen). Cada
 *   pocos segundos suelta vapor: la nuca queda protegida y quien esté pegado a él se abrasa y sale
 *   despedido. Hay que cortarle la nuca entre nube y nube, y varias veces.
 * - Acorazado (15 m): va a la puerta y la embiste una y otra vez; si te acercas, se vuelve contra ti.
 * - Bestia (17 m): se planta a unos 150 m y lanza rocas: a ti, a tus soldados o a la puerta.
 *   Si te le acercas, pelea cuerpo a cuerpo.
 *
 * La puerta tiene vida (barra arriba en pantalla durante el asalto). Si llega a cero se rompe:
 * brecha abierta y los titanes entran en Trost. Se repara cuando ya no queda ningún cambiante y
 * pasan un par de minutos.
 */

const TURNOS: EspecialTitan[] = ['colosal', 'acorazado', 'bestia'];
/** Primer asalto y tiempo entre asaltos (s reales). */
const PRIMER_ASALTO = 600;
const ENTRE_ASALTOS: [number, number] = [780, 1200];
/** Solo empieza si estás a menos de esto de Trost (si no, espera). */
const RADIO_JUGADOR = 1300;
const VIDA_PUERTA = 100;
const DANIO_PATADA = 20;
const DANIO_EMBESTIDA = 9;
const DANIO_ROCA_PUERTA = 5;
const ESPERA_REPARAR = 120;

interface Roca {
  malla: THREE.Mesh;
  desde: THREE.Vector3;
  hasta: THREE.Vector3;
  t: number;
  dur: number;
  alto: number;
  aPuerta: boolean;
}

interface Asalto {
  tipo: EspecialTitan;
  jefe: Titan;
  escolta: TitanAPI[];
  tGolpe: number;
  tVapor: number;
  /** Ya ha dado el golpe de la acción en curso. */
  golpeDado: boolean;
}

export class AsaltosMuralla {
  vidaPuerta = VIDA_PUERTA;
  private tSiguiente = PRIMER_ASALTO;
  private turno = 0;
  private asalto: Asalto | null = null;
  private readonly rocas: Roca[] = [];
  private readonly geoRoca = new THREE.DodecahedronGeometry(1.3, 0);
  private readonly matRoca = new THREE.MeshLambertMaterial({ color: '#7d756a', flatShading: true });
  private tReparar = 0;
  private hud: HTMLDivElement | null = null;
  private tHud = 0;
  private tAvisoVapor = -99;
  private t = 0;

  constructor(private readonly ctx: ContextoJuego) {}

  /** Punto de la puerta sur por fuera (a ras de suelo) y la dirección hacia fuera. */
  private get puerta(): { p: THREE.Vector3; fuera: THREE.Vector3 } {
    const m = this.ctx.mundo.muralla;
    return { p: m.puerta.clone().setY(0), fuera: new THREE.Vector3(0, 0, 1) };
  }

  get enCurso(): boolean {
    return this.asalto !== null;
  }

  actualizar(dt: number): void {
    this.t += dt;
    this.moverRocas(dt);
    this.reparar(dt);
    this.actualizarHud(dt);
    if (!this.asalto) {
      this.tSiguiente -= dt;
      if (this.tSiguiente > 0) return;
      const j = this.ctx.jugador.posicion;
      if (Math.hypot(j.x, j.z) > RADIO_JUGADOR || this.ctx.mundo.muralla.rota) {
        this.tSiguiente = 90;
        return;
      }
      this.lanzar(TURNOS[this.turno++ % TURNOS.length]);
      return;
    }
    const a = this.asalto;
    a.escolta = a.escolta.filter((t) => t.vivo);
    if (!a.jefe.vivo) {
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: `¡Has parado a ${nombreEspecial(a.tipo)}! La muralla resiste`, segundos: 4 });
      for (const t of a.escolta) t.dirigirA?.(null);
      this.asalto = null;
      this.tSiguiente = ENTRE_ASALTOS[0] + Math.random() * (ENTRE_ASALTOS[1] - ENTRE_ASALTOS[0]);
      return;
    }
    if (a.tipo === 'colosal') this.colosal(a, dt);
    else if (a.tipo === 'acorazado') this.acorazado(a, dt);
    else this.bestia(a, dt);
  }

  /** Lanza ya un asalto (también para pruebas). */
  lanzar(tipo: EspecialTitan): void {
    const { p, fuera } = this.puerta;
    const lejos = tipo === 'colosal' ? 520 : tipo === 'acorazado' ? 380 : 360;
    const lateral = new THREE.Vector3(1, 0, 0).multiplyScalar((Math.random() - 0.5) * 140);
    const sitio = p.clone().addScaledVector(fuera, lejos).add(lateral);
    const H = alturaEspecial(tipo);
    const libre = this.ctx.nav.puntoLibreCercano(sitio.x, sitio.z, Math.max(1, 0.17 * H * 0.7), 14) ?? sitio;
    const jefe = this.ctx.titanes.generar({ posicion: libre.clone(), altura: H, especial: tipo, rumbo: Math.atan2(p.x - libre.x, p.z - libre.z) }) as Titan;
    jefe.soloMarcha = true;
    jefe.dirigirA(this.metaDe(tipo));
    const dia = this.ctx.ciclo.dia;
    const escolta = this.ctx.titanes.generarGrupo(Math.min(6, 2 + dia), libre.clone().addScaledVector(fuera, -30), 40, [4, 5, 7, 8, 10, 12], 0.2);
    for (const t of escolta) t.dirigirA?.(p);
    this.asalto = { tipo, jefe, escolta, tGolpe: 3, tVapor: 10, golpeDado: false };
    this.vidaPuerta = this.ctx.mundo.muralla.rota ? 0 : this.vidaPuerta;
    const j = this.ctx.jugador.posicion;
    const d = Math.round(Math.hypot(libre.x - j.x, libre.z - j.z));
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `¡${nombreEspecial(tipo).replace(/^./, (c) => c.toUpperCase())} avanza hacia la puerta sur de Trost! (${d} m) ¡Defiende la muralla!`, segundos: 5 });
    this.ctx.eventos.emit({ tipo: 'alarmaPueblo', nombre: 'Trost', pos: p.clone().setY(40) });
    this.ctx.efectos.bengala(p.clone().setY(55), '#d12a1f');
  }

  /** Adónde va cada uno: el Colosal y el Acorazado, a la puerta; la Bestia, a tiro de piedra. */
  private metaDe(tipo: EspecialTitan): THREE.Vector3 {
    const { p, fuera } = this.puerta;
    const H = alturaEspecial(tipo);
    const separacion = tipo === 'colosal' ? 0.17 * H + 9 : tipo === 'acorazado' ? 6 : 150;
    return p.clone().addScaledVector(fuera, separacion);
  }

  private llega(a: Asalto, margen: number): boolean {
    const m = this.metaDe(a.tipo);
    return Math.hypot(a.jefe.posicion.x - m.x, a.jefe.posicion.z - m.z) < margen;
  }

  // ─────────────────────────── Cada cambiante ───────────────────────────

  private colosal(a: Asalto, dt: number): void {
    const j = this.ctx.jugador;
    const H = a.jefe.altura;
    // vapor abrasador cada 14 s: nuca protegida 4,5 s y quien esté pegado sale despedido
    a.tVapor -= dt;
    if (a.tVapor <= 0) {
      a.tVapor = 14;
      a.jefe.protegerNuca(4.5);
      if (this.t - this.tAvisoVapor > 20) {
        this.tAvisoVapor = this.t;
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡El Colosal suelta vapor! La nuca queda protegida unos segundos', segundos: 3 });
      }
    }
    if (a.tVapor > 14 - 4.5 && j.vivo && !j.agarradoPor) {
      const d = Math.hypot(j.posicion.x - a.jefe.posicion.x, j.posicion.z - a.jefe.posicion.z);
      if (d < 0.32 * H && j.posicion.y < H * 1.05) {
        (j as unknown as { herir?: (c: number, m: string) => void }).herir?.(9 * dt, 'El vapor del Colosal te ha abrasado');
        const fuera = new THREE.Vector3(j.posicion.x - a.jefe.posicion.x, 0.6, j.posicion.z - a.jefe.posicion.z).normalize();
        j.velocidad.addScaledVector(fuera, 22 * dt);
      }
    }
    if (!this.llega(a, 0.12 * H + 6) || this.ctx.mundo.muralla.rota) {
      a.jefe.plantado = null;
      return;
    }
    a.jefe.plantado = this.puerta.p;
    this.golpear(a, dt, 8.5, 'patada', 2.4, 0.62, DANIO_PATADA);
  }

  private acorazado(a: Asalto, dt: number): void {
    const j = this.ctx.jugador;
    // con el jugador cerca, se olvida de la puerta y va a por él
    const dj = Math.hypot(j.posicion.x - a.jefe.posicion.x, j.posicion.z - a.jefe.posicion.z);
    if (j.vivo && dj < 45) {
      a.jefe.soloMarcha = false;
      a.jefe.plantado = null;
      return;
    }
    a.jefe.soloMarcha = true;
    if (!this.llega(a, 10) || this.ctx.mundo.muralla.rota) {
      a.jefe.plantado = null;
      return;
    }
    a.jefe.plantado = this.puerta.p;
    this.golpear(a, dt, 3.2, 'embestida', 1.2, 0.5, DANIO_EMBESTIDA);
  }

  private bestia(a: Asalto, dt: number): void {
    const j = this.ctx.jugador;
    const dj = Math.hypot(j.posicion.x - a.jefe.posicion.x, j.posicion.z - a.jefe.posicion.z);
    // cuerpo a cuerpo si te le echas encima; si te alejas, vuelve a las rocas
    if (j.vivo && dj < 40) {
      a.jefe.soloMarcha = false;
      a.jefe.plantado = null;
      a.jefe.accion = null;
      return;
    }
    a.jefe.soloMarcha = true;
    if (!this.llega(a, 14)) {
      a.jefe.plantado = null;
      return;
    }
    const blanco = this.blancoRoca(a.jefe);
    a.jefe.plantado = blanco.p;
    a.tGolpe -= dt;
    if (!a.jefe.accion && a.tGolpe <= 0) {
      a.tGolpe = 4.5;
      a.golpeDado = false;
      a.jefe.accion = { tipo: 'lanzar', t: 0, dur: 1.7, blanco: blanco.p };
    }
    const acc = a.jefe.accion;
    if (acc?.tipo === 'lanzar' && !a.golpeDado && acc.t >= acc.dur * 0.78) {
      a.golpeDado = true;
      const mano = a.jefe.modelo.posMano(1, new THREE.Vector3());
      this.lanzarRoca(mano, blanco.p, blanco.puerta);
    }
  }

  /** A quién tira la Bestia: a ti si estás a tiro, si no a un soldado, y si no a la puerta. */
  private blancoRoca(b: Titan): { p: THREE.Vector3; puerta: boolean } {
    const j = this.ctx.jugador;
    const alcance = 260;
    if (j.vivo && j.posicion.distanceTo(b.posicion) < alcance) return { p: j.posicion.clone().addScaledVector(j.velocidad, 1.2), puerta: false };
    const s = this.ctx.escuadron.soldados.find((x) => x.vivo && x.posicion.distanceTo(b.posicion) < alcance);
    if (s) return { p: s.posicion.clone(), puerta: false };
    return { p: this.puerta.p.clone().setY(12), puerta: true };
  }

  /** Golpe periódico contra la puerta: la acción y, a mitad, el daño. */
  private golpear(a: Asalto, dt: number, cada: number, tipo: 'patada' | 'embestida', dur: number, momento: number, danio: number): void {
    a.tGolpe -= dt;
    if (!a.jefe.accion && a.tGolpe <= 0) {
      a.tGolpe = cada;
      a.golpeDado = false;
      a.jefe.accion = { tipo, t: 0, dur, blanco: this.puerta.p };
    }
    const acc = a.jefe.accion;
    if (acc && acc.tipo === tipo && !a.golpeDado && acc.t >= dur * momento) {
      a.golpeDado = true;
      this.danarPuerta(danio, tipo === 'patada' ? 'patada del Colosal' : 'embestida del Acorazado');
    }
  }

  private danarPuerta(cuanto: number, que: string): void {
    const m = this.ctx.mundo.muralla;
    if (m.rota) return;
    const p = this.puerta.p.clone().setY(8);
    this.vidaPuerta = Math.max(0, this.vidaPuerta - cuanto);
    this.ctx.efectos.vapor(p, 25, 4, 6);
    this.ctx.eventos.emit({ tipo: 'canon', pos: p });
    if (this.vidaPuerta > 0) {
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: `¡La ${que} hace temblar la puerta! (${Math.round(this.vidaPuerta)} %)`, segundos: 2 });
      return;
    }
    m.romperPuerta();
    this.ctx.nav.ponerArco(m.radioInterior, m.radioExterior + 1, 0, m.anchoPuerta, 0);
    this.ctx.eventos.emit({ tipo: 'brecha' });
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Han roto la puerta de Trost! Los titanes entran en la ciudad', segundos: 5 });
    // los titanes cruzan la brecha
    const dentro = new THREE.Vector3(0, 0, m.radioInterior - 60);
    for (const t of this.asalto?.escolta ?? []) t.dirigirA?.(dentro);
    this.tReparar = 0;
  }

  /** Puerta rota: se repara cuando no queda ningún cambiante y pasan un par de minutos. */
  private reparar(dt: number): void {
    const m = this.ctx.mundo.muralla;
    if (!m.rota) {
      if (!this.asalto && this.vidaPuerta < VIDA_PUERTA) this.vidaPuerta = Math.min(VIDA_PUERTA, this.vidaPuerta + 0.5 * dt);
      return;
    }
    if (this.asalto) return;
    this.tReparar += dt;
    if (this.tReparar < ESPERA_REPARAR) return;
    m.repararPuerta();
    this.ctx.nav.ponerArco(m.radioInterior, m.radioExterior + 1, 0, m.anchoPuerta, 1);
    this.vidaPuerta = VIDA_PUERTA;
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: 'Los ingenieros han reparado la puerta de Trost', segundos: 3 });
  }

  // ─────────────────────────── Rocas de la Bestia ───────────────────────────

  private lanzarRoca(desde: THREE.Vector3, hasta: THREE.Vector3, aPuerta: boolean): void {
    const malla = new THREE.Mesh(this.geoRoca, this.matRoca);
    malla.castShadow = true;
    malla.position.copy(desde);
    this.ctx.escena.add(malla);
    const d = desde.distanceTo(hasta);
    this.rocas.push({ malla, desde: desde.clone(), hasta: hasta.clone(), t: 0, dur: THREE.MathUtils.clamp(d / 55, 1, 4), alto: Math.min(70, d * 0.22), aPuerta });
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Roca de la Bestia!', segundos: 1.2 });
  }

  private moverRocas(dt: number): void {
    for (let i = this.rocas.length - 1; i >= 0; i--) {
      const r = this.rocas[i];
      r.t += dt / r.dur;
      const u = Math.min(1, r.t);
      r.malla.position.lerpVectors(r.desde, r.hasta, u).y += 4 * u * (1 - u) * r.alto;
      r.malla.rotation.x += dt * 4;
      r.malla.rotation.z += dt * 3;
      if (u < 1) continue;
      r.malla.removeFromParent();
      this.rocas.splice(i, 1);
      this.impactoRoca(r);
    }
  }

  /** La roca revienta: polvo y daño en 7 m (te puede matar si no esquivas). */
  private impactoRoca(r: Roca): void {
    const p = r.hasta;
    this.ctx.efectos.vapor(p.clone().setY(Math.max(1, p.y)), 22, 3, 6);
    this.ctx.eventos.emit({ tipo: 'canon', pos: p.clone() });
    const j = this.ctx.jugador;
    if (j.vivo && j.posicion.distanceTo(p) < 7) {
      const danio = 55 * (1 - j.posicion.distanceTo(p) / 9);
      (j as unknown as { herir?: (c: number, m: string) => void }).herir?.(danio, 'Te ha aplastado una roca de la Bestia');
    }
    for (const s of this.ctx.escuadron.soldados) {
      if (!s.vivo || s.posicion.distanceTo(p) > 7) continue;
      (s as unknown as { herir?: (c: number) => void }).herir?.(60);
    }
    if (r.aPuerta) this.danarPuerta(DANIO_ROCA_PUERTA, 'roca de la Bestia');
  }

  // ─────────────────────────── HUD ───────────────────────────

  /** Durante el asalto: vida de la puerta y a qué distancia está el cambiante. */
  private actualizarHud(dt: number): void {
    this.tHud -= dt;
    if (this.tHud > 0) return;
    this.tHud = 0.3;
    const a = this.asalto;
    const rota = this.ctx.mundo.muralla.rota;
    if (!a && !rota) {
      if (this.hud) this.hud.hidden = true;
      return;
    }
    if (!this.hud) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:50%;top:max(146px,calc(env(safe-area-inset-top) + 132px));transform:translateX(-50%);z-index:5;pointer-events:none;' +
        'font:600 12px/1.3 Georgia,serif;color:#f6dccf;text-shadow:0 1px 2px #000;text-align:center;letter-spacing:.06em';
      el.innerHTML = '<div class="t"></div><div style="width:200px;height:7px;margin:3px auto 0;background:rgba(0,0,0,.55);border:1px solid rgba(246,220,207,.5)"><div class="b" style="height:100%;width:100%;background:#c2412e"></div></div>';
      document.body.appendChild(el);
      this.hud = el;
    }
    this.hud.hidden = false;
    const j = this.ctx.jugador.posicion;
    const quien = a ? `${a.tipo === 'colosal' ? 'COLOSAL' : a.tipo === 'acorazado' ? 'ACORAZADO' : 'BESTIA'} a ${Math.round(Math.hypot(a.jefe.posicion.x - j.x, a.jefe.posicion.z - j.z))} m` : 'BRECHA ABIERTA';
    (this.hud.querySelector('.t') as HTMLElement).textContent = `PUERTA DE TROST ${Math.round(rota ? 0 : this.vidaPuerta)} % · ${quien}`;
    (this.hud.querySelector('.b') as HTMLElement).style.width = `${Math.round(rota ? 0 : this.vidaPuerta)}%`;
  }

  limpiar(): void {
    for (const r of this.rocas) r.malla.removeFromParent();
    this.rocas.length = 0;
    this.hud?.remove();
    this.hud = null;
    this.asalto = null;
    this.geoRoca.dispose();
    this.matRoca.dispose();
  }
}
