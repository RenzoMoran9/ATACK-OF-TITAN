import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { EspecialTitan, Humano, TitanAPI } from '../core/tipos';
import type { DatosPueblo } from '../world/lugares';
import { LogicaPueblo, horasHastaAtaque, titanesAtaque, type EstadoGuardadoPueblo, type FasePueblo } from './logicaPueblo';

/**
 * Los pueblos del mundo abierto en marcha: titanes que los ocupan, vecinos que vuelven y
 * pasean, la reconstrucción por etapas (src/world/lugares.ts → VistaPueblo), la alarma de los
 * propios aldeanos cuando llegan titanes (campana, gritos y una bengala roja que se ve desde
 * lejos) y los ataques que van llegando con los días.
 */

const RADIO_ACTIVAR = 450;
const RADIO_RETIRAR = 900;
const RADIO_ALDEANOS = 380;
const RADIO_SIN_ALDEANOS = 500;
const MAX_ALDEANOS = 14;
/** Ocupantes de cada pueblo al empezar (los más lejanos, más). */
const OCUPANTES: Record<string, number> = { pastores: 3, molino: 4, dauper: 3, ragako: 5 };

export interface Ataque {
  titanes: TitanAPI[];
  jefe: EspecialTitan | null;
}

export class Pueblo {
  readonly logica: LogicaPueblo;
  /** Titanes vivos que ocupan el pueblo tomado (solo con el jugador cerca). */
  ocupantes: TitanAPI[] = [];
  aldeanos: Humano[] = [];
  ataque: Ataque | null = null;
  /** Titanes dentro del pueblo ahora mismo. */
  amenaza = 0;
  /** Suena la campana: hay titanes dentro y gente que avisar. */
  enAlarma = false;
  private tAlarma = 0;
  depositoPuesto = false;
  faseAnterior: FasePueblo = 'tomado';

  constructor(readonly datos: DatosPueblo) {
    this.logica = new LogicaPueblo(datos.id, datos.casas, OCUPANTES[datos.id] ?? 3);
  }

  get nombre(): string {
    return this.datos.nombre;
  }

  get centro(): THREE.Vector3 {
    return this.datos.centro;
  }

  /** Cuenta atrás de la campana (60 s entre avisos). */
  tocaAvisar(dt: number): boolean {
    this.tAlarma -= dt;
    if (!this.enAlarma || this.tAlarma > 0) return false;
    this.tAlarma = 60;
    return true;
  }
}

export class GestorPueblos {
  readonly lista: Pueblo[];
  /** Horas de juego hasta el próximo ataque. */
  private hastaAtaque = 10;
  private readonly tmp = new THREE.Vector3();
  private readonly quitar: (() => void)[] = [];

  constructor(private readonly ctx: ContextoJuego, private readonly azar: () => number = Math.random) {
    this.lista = ctx.mundo.pueblos.map((d) => new Pueblo(d));
    this.quitar.push(
      ctx.eventos.on('titanMuerto', (e) => this.alMorirTitan(e.titan)),
      ctx.eventos.on('humanoDevorado', (e) => {
        for (const p of this.lista) {
          const i = p.aldeanos.indexOf(e.humano);
          if (i < 0) continue;
          p.aldeanos.splice(i, 1);
          if (p.logica.vecinoPerdido(p.amenaza) === 'caido') this.caer(p);
        }
      }),
    );
  }

  get enPaz(): number {
    return this.lista.filter((p) => p.logica.fase === 'enPaz').length;
  }

  get poblacion(): number {
    return Math.floor(this.lista.reduce((n, p) => n + p.logica.habitantes, 0));
  }

  /** Pueblos en paz donde reaparecer o descansar. */
  refugios(): Pueblo[] {
    return this.lista.filter((p) => p.logica.fase === 'enPaz');
  }

  /** `dt` en segundos reales; `horas` de juego transcurridas; `noche` 0–1 para las ventanas. */
  actualizar(dt: number, horas: number, esDia: boolean, noche: number, dia: number): void {
    const j = this.ctx.jugador.posicion;
    for (const p of this.lista) {
      const d = Math.hypot(p.centro.x - j.x, p.centro.z - j.z);
      this.contarAmenaza(p);
      if (!p.logica.liberado) this.ocupar(p, d);
      const caido = p.logica.avanzar(horas, esDia, p.amenaza, p.aldeanos.length === 0);
      if (caido) this.caer(p);
      this.vecinos(p, d);
      // alarma de los aldeanos: campana, gritos y bengala roja sobre la plaza
      p.enAlarma = p.logica.liberado && p.logica.habitantes >= 1 && p.amenaza > 0;
      if (p.tocaAvisar(dt)) {
        this.ctx.efectos.bengala(p.datos.campana.clone().setY(8), '#d12a1f');
        this.ctx.eventos.emit({ tipo: 'alarmaPueblo', nombre: p.nombre, pos: p.datos.campana.clone() });
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: `¡Atacan ${p.nombre}! (${Math.round(d)} m)`, segundos: 3.5 });
      }
      this.finAtaque(p);
      this.avisarFase(p);
      // aspecto: etapas, andamios, faroles y ventanas encendidas si vive gente
      p.datos.vista.mostrar(p.logica.etapas, p.logica.enObras(esDia, p.amenaza), j);
      p.datos.estado.habitado = p.logica.habitantes >= 1;
      p.datos.ventanas.emissiveIntensity = p.datos.estado.habitado ? 1.2 * noche : 0;
      this.deposito(p);
    }
    this.programarAtaques(horas, esDia, dia);
  }

  private contarAmenaza(p: Pueblo): void {
    let n = 0;
    for (const t of this.ctx.poblacion.titanesCerca(p.centro, p.datos.radio + 15)) if (t.vivo && t.estado !== 'apagado') n++;
    p.amenaza = n;
  }

  /** Pueblo tomado: con el jugador cerca aparecen sus ocupantes; lejos, se retiran (siguen ahí). */
  private ocupar(p: Pueblo, d: number): void {
    p.ocupantes = p.ocupantes.filter((t) => t.vivo);
    if (d < RADIO_ACTIVAR && p.ocupantes.length === 0 && p.logica.ocupantes > 0) {
      for (let k = 0; k < p.logica.ocupantes; k++) {
        const a = this.azar() * Math.PI * 2;
        const r = 15 + this.azar() * 40;
        const t = this.ctx.titanes.generar({
          posicion: new THREE.Vector3(p.centro.x + Math.cos(a) * r, 0, p.centro.z + Math.sin(a) * r),
          altura: [4, 5, 7, 8, 10, 12, 15][Math.floor(this.azar() * 7)],
          anormal: this.azar() < 0.2,
        });
        t.dirigirA?.(p.centro);
        p.ocupantes.push(t);
      }
    } else if (d > RADIO_RETIRAR && p.ocupantes.length > 0) {
      for (const t of p.ocupantes) (t as TitanAPI & { eliminar?: () => void }).eliminar?.();
      p.ocupantes = [];
    }
  }

  private alMorirTitan(t: TitanAPI): void {
    for (const p of this.lista) {
      if (p.ocupantes.includes(t)) {
        p.ocupantes = p.ocupantes.filter((x) => x !== t);
        if (p.logica.ocupanteAbatido()) {
          this.ctx.eventos.emit({ tipo: 'puebloLiberado', nombre: p.nombre, pos: p.centro.clone() });
          this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${p.nombre} liberada`, segundos: 3 });
        } else this.ctx.eventos.emit({ tipo: 'mensaje', texto: `Quedan ${p.logica.ocupantes}`, segundos: 1.5 });
      }
      if (p.ataque) p.ataque.titanes = p.ataque.titanes.filter((x) => x !== t && x.vivo);
    }
  }

  /** Con el jugador cerca, los vecinos están de verdad en las calles; lejos, solo son un número. */
  private vecinos(p: Pueblo, d: number): void {
    p.aldeanos = p.aldeanos.filter((h) => h.vivo);
    const quiere = d < RADIO_ALDEANOS ? Math.min(MAX_ALDEANOS, Math.floor(p.logica.habitantes)) : 0;
    if (d > RADIO_SIN_ALDEANOS || p.aldeanos.length > quiere + (d < RADIO_ALDEANOS ? 0 : 99)) {
      const sobran = d > RADIO_SIN_ALDEANOS ? p.aldeanos : p.aldeanos.slice(quiere);
      if (sobran.length) {
        this.ctx.civiles.retirar(sobran);
        p.aldeanos = p.aldeanos.filter((h) => !sobran.includes(h));
      }
      return;
    }
    // aparecen poco a poco (de dos en dos), nunca con titanes dentro
    if (p.aldeanos.length < quiere && p.amenaza === 0) p.aldeanos.push(...this.ctx.civiles.generarAldeanos(Math.min(2, quiere - p.aldeanos.length), p.centro, 45));
  }

  private caer(p: Pueblo): void {
    if (p.aldeanos.length) this.ctx.civiles.retirar(p.aldeanos);
    p.aldeanos = [];
    // los titanes del ataque se quedan ocupándolo
    p.ocupantes = [...(p.ataque?.titanes.filter((t) => t.vivo) ?? [])];
    p.logica.ocupantes = Math.max(p.logica.ocupantes, p.ocupantes.length, 1);
    p.ataque = null;
    this.ctx.eventos.emit({ tipo: 'puebloCaido', nombre: p.nombre, pos: p.centro.clone() });
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${p.nombre} ha caído`, segundos: 3.5 });
  }

  private finAtaque(p: Pueblo): void {
    const a = p.ataque;
    if (!a) return;
    a.titanes = a.titanes.filter((t) => t.vivo);
    if (a.titanes.length > 0) return;
    p.ataque = null;
    p.logica.defendido();
    this.ctx.eventos.emit({ tipo: 'puebloDefendido', nombre: p.nombre, pos: p.centro.clone() });
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${p.nombre} defendida`, segundos: 3 });
  }

  private avisarFase(p: Pueblo): void {
    const f = p.logica.fase;
    if (f === p.faseAnterior) return;
    if (f === 'enPaz') {
      this.ctx.eventos.emit({ tipo: 'puebloEnPaz', nombre: p.nombre, pos: p.centro.clone() });
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${p.nombre} vive en paz`, segundos: 3 });
    }
    p.faseAnterior = f;
  }

  /** Pueblo en paz: sus cajas de la plaza son un punto de recarga. */
  private deposito(p: Pueblo): void {
    const quiere = p.logica.fase === 'enPaz';
    if (quiere === p.depositoPuesto) return;
    p.depositoPuesto = quiere;
    const deps = this.ctx.mundo.depositos;
    const nombre = `Plaza de ${p.nombre}`;
    if (quiere) deps.push({ pos: p.datos.deposito.clone(), nombre });
    else {
      const i = deps.findIndex((x) => x.nombre === nombre);
      if (i >= 0) deps.splice(i, 1);
    }
  }

  /** Los titanes acaban encontrando los pueblos habitados: ataques cada pocas horas, de día. */
  private programarAtaques(horas: number, esDia: boolean, dia: number): void {
    const habitados = this.lista.filter((p) => p.logica.liberado && p.logica.habitantes >= 4 && !p.ataque);
    if (habitados.length === 0) return;
    this.hastaAtaque -= horas;
    if (this.hastaAtaque > 0 || !esDia) return;
    this.hastaAtaque = horasHastaAtaque(habitados.length, this.azar);
    this.lanzarAtaque(habitados[Math.floor(this.azar() * habitados.length)], dia);
  }

  /** Grupo de titanes que sale a 260–320 m del pueblo y marcha hacia él. A partir del día 3, a veces con un cambiante al frente. */
  lanzarAtaque(p: Pueblo, dia: number, jefe: EspecialTitan | null = dia >= 3 && this.azar() < 0.25 ? (this.azar() < 0.5 ? 'acorazado' : 'hembra') : null): void {
    const n = titanesAtaque(dia);
    const ang = this.azar() * Math.PI * 2;
    const r = 260 + this.azar() * 60;
    const centro = this.tmp.set(p.centro.x + Math.cos(ang) * r, 0, p.centro.z + Math.sin(ang) * r).clone();
    const titanes: TitanAPI[] = [];
    if (jefe) titanes.push(this.ctx.titanes.generar({ posicion: centro.clone(), altura: jefe === 'acorazado' ? 15 : 14, especial: jefe }));
    for (const t of this.ctx.titanes.generarGrupo(n, centro, 40, [4, 5, 7, 8, 10, 12, 15], 0.2)) titanes.push(t);
    for (const t of titanes) t.dirigirA?.(p.centro);
    p.ataque = { titanes, jefe };
    const nombreJefe = jefe === 'acorazado' ? ' (con el Acorazado)' : jefe === 'hembra' ? ' (con la Hembra)' : '';
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${titanes.length} titanes van hacia ${p.nombre}${nombreJefe}`, segundos: 3.5 });
  }

  guardar(): EstadoGuardadoPueblo[] {
    return this.lista.map((p) => p.logica.guardar());
  }

  cargar(estados: readonly EstadoGuardadoPueblo[]): void {
    for (const e of estados) {
      const p = this.lista.find((x) => x.datos.id === e.id);
      if (!p) continue;
      p.logica.cargar(e);
      p.faseAnterior = p.logica.fase;
    }
  }

  /** Quita titanes y vecinos propios (al salir al menú). */
  limpiar(): void {
    for (const q of this.quitar) q();
    this.quitar.length = 0;
    for (const p of this.lista) {
      if (p.aldeanos.length) this.ctx.civiles.retirar(p.aldeanos);
      p.aldeanos = [];
      p.ocupantes = [];
      p.ataque = null;
      if (p.depositoPuesto) {
        const i = this.ctx.mundo.depositos.findIndex((x) => x.nombre === `Plaza de ${p.nombre}`);
        if (i >= 0) this.ctx.mundo.depositos.splice(i, 1);
        p.depositoPuesto = false;
      }
      p.datos.vista.mostrar(0, false, null);
      p.datos.estado.habitado = false;
      p.datos.ventanas.emissiveIntensity = 0;
    }
  }
}
