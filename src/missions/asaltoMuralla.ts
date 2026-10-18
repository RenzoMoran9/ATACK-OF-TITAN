import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { EspecialTitan, TitanAPI } from '../core/tipos';
import { alturaEspecial, nombreCon, nombreCorto, nombreEspecial } from '../titans/especiales';
import type { Titan } from '../titans/titan';

/**
 * Asaltos de los cambiantes a la muralla de Trost. Cada cierto tiempo uno de ellos (por turnos:
 * Colosal, Acorazado, Bestia) avanza hacia la puerta sur con una escolta de titanes, y hay que
 * pararlo antes de que la eche abajo. Sale de campo abierto con el camino despejado (nunca de
 * dentro de un bosque, donde un titán de 60 m no cabe entre los troncos):
 *
 * - Colosal (60 m): camina despacio hasta la puerta y la patea (cinco patadas la rompen). Cada
 *   pocos segundos suelta vapor: la nuca queda protegida y quien esté pegado a él se abrasa y sale
 *   despedido. Hay que cortarle la nuca entre nube y nube, y varias veces. Si la rompe,
 *   desaparece en una explosión de vapor, como en Trost.
 * - Acorazado (15 m): va a la puerta y la embiste una y otra vez; si te acercas, se vuelve contra ti.
 *   Si la rompe, entra en la ciudad a cazar.
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
const DANIO_EMBESTIDA = 6;
const DANIO_ROCA_PUERTA = 5;
const ESPERA_REPARAR = 120;
/** La campana de Trost avisa tantos segundos antes de cada asalto. */
export const AVISO_PREVIO = 60;
/** Segundos que tarda el Colosal en desvanecerse tras abrir la brecha. */
const DURACION_DESVANECER = 4;

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
  /** El Colosal, tras abrir la brecha, se desvanece en vapor (segundos que le quedan). */
  desvanecer: number | null;
  /** El Acorazado o la Bestia han entrado por la brecha a cazar. */
  caza: boolean;
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
  private avisoDado = false;
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

  /** El próximo asalto: quién y en cuántos segundos (`espera`: estás lejos y no empezará hasta que vuelvas). */
  get proximo(): { tipo: EspecialTitan; segundos: number; espera: boolean } | null {
    if (this.asalto) return null;
    return { tipo: TURNOS[this.turno % TURNOS.length], segundos: Math.max(0, this.tSiguiente), espera: !this.puedeEmpezar };
  }

  /** Solo hay asalto si andas a menos de 1,3 km de Trost y la puerta está en pie. */
  private get puedeEmpezar(): boolean {
    const j = this.ctx.jugador.posicion;
    return Math.hypot(j.x, j.z) <= RADIO_JUGADOR && !this.ctx.mundo.muralla.rota;
  }

  /** Un minuto antes: repica la campana de Trost y los vigías dicen quién viene y por dónde. */
  private avisar(): void {
    this.avisoDado = true;
    const tipo = TURNOS[this.turno % TURNOS.length];
    const p = this.puerta.p;
    this.ctx.eventos.emit({ tipo: 'alarmaPueblo', nombre: 'Trost', pos: p.clone().setY(40) });
    this.ctx.eventos.emit({
      tipo: 'mensaje',
      texto: `¡Campana en Trost! Los vigías avistan ${nombreCon(tipo, 'a')} al sur: llega en un minuto. Sube a la muralla (T: cañones · 9: el escuadrón a los cañones) o sal a su encuentro`,
      segundos: 7,
    });
  }

  actualizar(dt: number): void {
    this.t += dt;
    this.moverRocas(dt);
    this.reparar(dt);
    this.actualizarHud(dt);
    if (!this.asalto) {
      this.tSiguiente -= dt;
      if (this.tSiguiente <= AVISO_PREVIO && !this.avisoDado && this.puedeEmpezar) this.avisar();
      if (this.tSiguiente > 0) return;
      if (!this.puedeEmpezar) {
        // lejos de Trost (o con la puerta ya rota) espera; el aviso se repite cuando vuelva a tocar
        this.tSiguiente = 90;
        this.avisoDado = false;
        return;
      }
      this.lanzar(TURNOS[this.turno++ % TURNOS.length]);
      this.avisoDado = false;
      return;
    }
    const a = this.asalto;
    a.escolta = a.escolta.filter((t) => t.vivo);
    if (a.desvanecer !== null) {
      this.desvanecerse(a, dt);
      return;
    }
    if (!a.jefe.vivo) {
      const rota = this.ctx.mundo.muralla.rota;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: rota ? 'Asalto detenido, pero la puerta está rota: los ingenieros la repararán cuando se despeje' : '¡Asalto detenido! La puerta de Trost resiste', segundos: 4 });
      for (const t of a.escolta) if (!rota) t.dirigirA?.(null);
      this.ctx.eventos.emit({ tipo: 'asaltoDetenido', puertaIntacta: !rota && this.vidaPuerta >= VIDA_PUERTA * 0.5 });
      this.terminar();
      return;
    }
    if (a.tipo === 'colosal') this.colosal(a, dt);
    else if (a.tipo === 'acorazado') this.acorazado(a, dt);
    else this.bestia(a, dt);
  }

  /** Lanza ya un asalto (también para pruebas). */
  lanzar(tipo: EspecialTitan): void {
    const { p } = this.puerta;
    const lejos = tipo === 'colosal' ? 520 : tipo === 'acorazado' ? 380 : 360;
    const H = alturaEspecial(tipo);
    const meta = this.metaDe(tipo);
    const nav = this.ctx.nav;
    const r = Math.max(0.6, 0.17 * H);
    // sale de campo abierto con el camino despejado hasta su meta: nunca de dentro de un bosque
    const sitio =
      sitioDeSalida(p, lejos, Math.random, (x, z) => nav.libre(x, z, r) && nav.lineaLibre({ x, z }, meta, r)) ??
      sitioDeSalida(p, lejos, Math.random, (x, z) => nav.libre(x, z, r) && nav.ruta({ x, z }, meta, r, 40000) !== null) ??
      nav.puntoLibreCercano(p.x, p.z + lejos, r * 0.7, 14) ??
      new THREE.Vector3(p.x, 0, p.z + lejos);
    const jefe = this.ctx.titanes.generar({ posicion: sitio.clone(), altura: H, especial: tipo, rumbo: Math.atan2(p.x - sitio.x, p.z - sitio.z) }) as Titan;
    jefe.soloMarcha = true;
    jefe.dirigirA(meta);
    const dia = this.ctx.ciclo.dia;
    // la escolta va unos pasos por delante, entre él y la puerta
    const haciaPuerta = p.clone().sub(sitio).setY(0).normalize();
    const escolta = this.ctx.titanes.generarGrupo(Math.min(6, 2 + dia), sitio.clone().addScaledVector(haciaPuerta, 30), 40, [4, 5, 7, 8, 10, 12], 0.2);
    for (const t of escolta) t.dirigirA?.(p);
    this.asalto = { tipo, jefe, escolta, tGolpe: 3, tVapor: 10, golpeDado: false, desvanecer: null, caza: false };
    this.vidaPuerta = this.ctx.mundo.muralla.rota ? 0 : this.vidaPuerta;
    const j = this.ctx.jugador.posicion;
    const d = Math.round(Math.hypot(sitio.x - j.x, sitio.z - j.z));
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `¡${nombreEspecial(tipo).replace(/^./, (c) => c.toUpperCase())} avanza hacia la puerta sur de Trost! (${d} m) ¡Defiende la muralla!`, segundos: 5 });
    this.ctx.eventos.emit({ tipo: 'alarmaPueblo', nombre: 'Trost', pos: p.clone().setY(40) });
    this.ctx.efectos.bengala(p.clone().setY(55), '#d12a1f');
  }

  /** Adónde va cada uno: el Colosal y el Acorazado, a la puerta; la Bestia, a tiro de piedra. */
  metaDe(tipo: EspecialTitan): THREE.Vector3 {
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
    // como en Trost: con la brecha abierta desaparece en una explosión de vapor
    if (this.ctx.mundo.muralla.rota) {
      if (!a.jefe.accion) this.empezarDesvanecer(a);
      return;
    }
    if (!this.llega(a, 0.12 * H + 6)) {
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
    // con la brecha abierta entra en Trost a cazar (la orden, una vez: dirigirA borra su destino)
    if (a.caza || this.ctx.mundo.muralla.rota) {
      if (!a.caza && !a.jefe.accion) {
        a.caza = true;
        a.jefe.dirigirA(this.dentroDeTrost());
      }
      a.jefe.soloMarcha = false;
      a.jefe.plantado = null;
      return;
    }
    a.jefe.soloMarcha = true;
    if (!this.llega(a, 10)) {
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
    // ya dentro de Trost: caza como cualquier titán
    if (a.caza) return;
    a.jefe.soloMarcha = true;
    if (!this.llega(a, 14)) {
      a.jefe.plantado = null;
      return;
    }
    const blanco = this.blancoRoca(a.jefe);
    // con la brecha abierta y nadie a tiro, deja las rocas y entra en Trost a cazar
    if (blanco.puerta && this.ctx.mundo.muralla.rota) {
      if (!a.jefe.accion) {
        a.caza = true;
        a.jefe.soloMarcha = false;
        a.jefe.plantado = null;
        a.jefe.dirigirA(this.dentroDeTrost());
      }
      return;
    }
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
      this.lanzarRoca(mano, blanco.p, blanco.puerta, blanco.jugador);
    }
  }

  /**
   * A quién tira la Bestia: a ti si estás a tiro, si no a un soldado, y si no a la puerta. A quien
   * está a cubierto tras la muralla (dentro de Trost y por debajo del adarve) no lo ve.
   */
  private blancoRoca(b: Titan): { p: THREE.Vector3; puerta: boolean; jugador: boolean } {
    const j = this.ctx.jugador;
    const alcance = 260;
    const m = this.ctx.mundo.muralla;
    const aTiro = (p: THREE.Vector3) => p.distanceTo(b.posicion) < alcance && !(Math.hypot(p.x, p.z) < m.radioExterior + 2 && p.y < m.altura - 1);
    // apunta algo por delante de quien se mueve, pero no adivina el futuro
    if (j.vivo && aTiro(j.posicion)) return { p: j.posicion.clone().addScaledVector(j.velocidad, 0.6), puerta: false, jugador: true };
    const s = this.ctx.escuadron.soldados.find((x) => x.vivo && aTiro(x.posicion));
    if (s) return { p: s.posicion.clone(), puerta: false, jugador: false };
    return { p: this.puerta.p.clone().setY(12), puerta: true, jugador: false };
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
    const dentro = this.dentroDeTrost();
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

  /** Calles de Trost justo detrás de la puerta sur. */
  private dentroDeTrost(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, this.ctx.mundo.muralla.radioInterior - 60);
  }

  private terminar(): void {
    this.asalto = null;
    this.tSiguiente = ENTRE_ASALTOS[0] + Math.random() * (ENTRE_ASALTOS[1] - ENTRE_ASALTOS[0]);
  }

  /** El Colosal se queda quieto y desaparece entre vapor abrasador; la escolta entra por la brecha. */
  private empezarDesvanecer(a: Asalto): void {
    const j = a.jefe;
    const H = j.altura;
    a.desvanecer = DURACION_DESVANECER;
    j.plantado = j.posicion.clone().add(new THREE.Vector3(Math.sin(j.rumbo), 0, Math.cos(j.rumbo)));
    j.protegerNuca(DURACION_DESVANECER + 1);
    const sitio = j.posicion.clone();
    for (const y of [0.25, 0.55, 0.85]) this.ctx.efectos.vaporContinuo(sitio.clone().setY(H * y), DURACION_DESVANECER + 2.5, 35, H * 0.3);
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡El Colosal desaparece en una explosión de vapor! Los titanes entran por la brecha', segundos: 5 });
  }

  private desvanecerse(a: Asalto, dt: number): void {
    const j = a.jefe;
    a.desvanecer = (a.desvanecer ?? 0) - dt;
    // el vapor abrasa a quien siga pegado a él
    const h = this.ctx.jugador;
    if (j.vivo && h.vivo && Math.hypot(h.posicion.x - j.posicion.x, h.posicion.z - j.posicion.z) < 0.35 * j.altura) {
      (h as unknown as { herir?: (c: number, m: string) => void }).herir?.(12 * dt, 'El vapor del Colosal te ha abrasado');
    }
    if (a.desvanecer > 0 && j.vivo) return;
    if (j.vivo) j.terminado = true;
    this.terminar();
  }

  // ─────────────────────────── Rocas de la Bestia ───────────────────────────

  private lanzarRoca(desde: THREE.Vector3, hasta: THREE.Vector3, aPuerta: boolean, aTi: boolean): void {
    const malla = new THREE.Mesh(this.geoRoca, this.matRoca);
    malla.castShadow = true;
    malla.position.copy(desde);
    this.ctx.escena.add(malla);
    const d = desde.distanceTo(hasta);
    // no es un cañón: cuanto más lejos, más se desvía (a la puerta, que es enorme, casi siempre acierta)
    const desvio = aPuerta ? 2 : 3 + d * 0.035;
    const fin = hasta.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * desvio, 0, (Math.random() - 0.5) * 2 * desvio));
    fin.y = Math.max(0, fin.y);
    this.rocas.push({ malla, desde: desde.clone(), hasta: fin, t: 0, dur: THREE.MathUtils.clamp(d / 55, 1, 4), alto: Math.min(70, d * 0.22), aPuerta });
    // solo avisa cuando va a por ti (si no, llenaría la pantalla de avisos)
    if (aTi) this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Roca de la Bestia hacia ti!', segundos: 1.2 });
  }

  private moverRocas(dt: number): void {
    for (let i = this.rocas.length - 1; i >= 0; i--) {
      const r = this.rocas[i];
      r.t += dt / r.dur;
      const u = Math.min(1, r.t);
      r.malla.position.lerpVectors(r.desde, r.hasta, u).y += 4 * u * (1 - u) * r.alto;
      r.malla.rotation.x += dt * 4;
      r.malla.rotation.z += dt * 3;
      // la muralla para las rocas: revientan contra ella (y si es junto a la puerta, la dañan)
      if (u < 1 && this.contraMuralla(r.malla.position)) {
        r.hasta = r.malla.position.clone();
        r.aPuerta = Math.abs(r.hasta.x) < this.ctx.mundo.muralla.anchoPuerta && r.hasta.z > 0;
        r.t = 1;
      } else if (u < 1) continue;
      r.malla.removeFromParent();
      this.rocas.splice(i, 1);
      this.impactoRoca(r);
    }
  }

  /** ¿Ese punto está dentro del muro (entre sus dos caras y por debajo de lo alto)? */
  private contraMuralla(p: THREE.Vector3): boolean {
    const m = this.ctx.mundo.muralla;
    const r = Math.hypot(p.x, p.z);
    return r > m.radioInterior && r < m.radioExterior && p.y < m.altura;
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
    const prox = this.proximo;
    const cuentaAtras = !a && !rota && prox && !prox.espera && prox.segundos <= AVISO_PREVIO ? prox : null;
    if (!a && !rota && !cuentaAtras) {
      if (this.hud) this.hud.hidden = true;
      return;
    }
    if (!this.hud) {
      const el = document.createElement('div');
      el.className = 'hud-asalto';
      el.style.color = '#f6dccf';
      el.innerHTML = '<div class="t"></div><div style="width:200px;height:7px;margin:3px auto 0;background:rgba(0,0,0,.55);border:1px solid rgba(246,220,207,.5)"><div class="b" style="height:100%;width:100%;background:#c2412e"></div></div>';
      document.body.appendChild(el);
      this.hud = el;
    }
    this.hud.hidden = false;
    const j = this.ctx.jugador.posicion;
    const mayus = (t: EspecialTitan) => nombreCorto(t).toUpperCase();
    const quien = a
      ? `${mayus(a.tipo)} a ${Math.round(Math.hypot(a.jefe.posicion.x - j.x, a.jefe.posicion.z - j.z))} m`
      : cuentaAtras
        ? `${mayus(cuentaAtras.tipo)} LLEGA EN ${Math.ceil(cuentaAtras.segundos)} s`
        : 'BRECHA ABIERTA';
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

/**
 * Punto de salida de un asalto: a `lejos` m de la puerta (al sur, hasta 80° a cada lado), elegido
 * al azar entre los que cumplen `vale` (campo abierto y camino despejado). Null si ninguno vale.
 */
export function sitioDeSalida(puerta: THREE.Vector3, lejos: number, azar: () => number, vale: (x: number, z: number) => boolean): THREE.Vector3 | null {
  const buenos: THREE.Vector3[] = [];
  for (const d of [lejos, lejos * 0.8, lejos * 0.6]) {
    for (let g = -80; g <= 80; g += 5) {
      const a = (g * Math.PI) / 180;
      const x = puerta.x + Math.sin(a) * d;
      const z = puerta.z + Math.cos(a) * d;
      if (vale(x, z)) buenos.push(new THREE.Vector3(x, 0, z));
    }
    if (buenos.length > 0) break;
  }
  return buenos.length > 0 ? buenos[Math.floor(azar() * buenos.length)] : null;
}
