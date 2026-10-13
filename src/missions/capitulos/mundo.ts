import * as THREE from 'three';
import { HORA_INICIAL, factorNoche, momentoDia, textoHora } from '../../core/cicloDia';
import type { EspecialTitan, MiembroEscuadron, TitanAPI } from '../../core/tipos';
import { Caballo } from '../../player/caballo';
import { Poblador } from '../../titans/poblador';
import type { Lugar } from '../../world/lugares';
import type { ApiCapitulo, Capitulo } from '../campana';
import { borrarPartida, guardarPartida, leerPartida, type PartidaGuardada } from '../guardado';
import { GestorPueblos } from '../pueblos';

/**
 * Mundo abierto: el territorio perdido al sur de Trost, sin capítulos ni final. El día y la
 * noche pasan (src/core/cicloDia.ts); de día los titanes cazan y de noche casi todos se apagan.
 * Se trata de ir por el mundo cazando titanes, liberar los pueblos que ocupan, defenderlos
 * cuando los atacan y ver cómo la gente vuelve, reconstruye sus casas y vive en paz.
 *
 * - Lugares por descubrir (bosques, pueblos, Utgard, puente, puestos, campamento).
 * - Caballo (C) para cruzar la llanura; escuadrón con órdenes (1–8).
 * - H en un refugio (Trost, un puesto, el campamento o un pueblo en paz), de noche: descansar
 *   hasta el amanecer.
 * - A partir del segundo día a veces se avista a un cambiante (Acorazado o Hembra).
 * - Se guarda solo (src/missions/guardado.ts).
 */

const ESCUADRON: MiembroEscuadron[] = [
  { nombre: 'Mikasa', rol: 'rematador' },
  { nombre: 'Armin', rol: 'cebo' },
  { nombre: 'Jean', rol: 'apoyo' },
  { nombre: 'Connie', rol: 'apoyo' },
  { nombre: 'Moblit', rol: 'intendente' },
];
const REFUERZOS: MiembroEscuadron[] = [
  { nombre: 'Sasha', rol: 'apoyo' },
  { nombre: 'Reiner', rol: 'rematador' },
  { nombre: 'Bertholdt', rol: 'apoyo' },
  { nombre: 'Ymir', rol: 'cebo' },
  { nombre: 'Moblit', rol: 'intendente' },
];

const PUNTOS_CARDINALES = ['norte', 'nordeste', 'este', 'sudeste', 'sur', 'suroeste', 'oeste', 'noroeste'];

/** Punto cardinal de un desplazamiento (norte = −Z). */
export function direccionCardinal(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return PUNTOS_CARDINALES[i];
}

export class CapMundo implements Capitulo {
  readonly id = 'mundo' as const;
  readonly titulo = 'El territorio perdido';
  readonly epoca = 'Año 850 · Más allá de la muralla';
  get intro(): string {
    const p = this.partida;
    if (p) return `Día ${p.dia}, ${textoHora(p.hora)}. ${this.resumenGuardado(p)}`;
    return 'Libera los pueblos, defiéndelos y deja que la gente vuelva a vivir en paz.';
  }

  /** Lo pone el menú: true = cargar la partida guardada. */
  continuar = false;
  pueblos: GestorPueblos | null = null;
  caballo: Caballo | null = null;
  private api!: ApiCapitulo;
  private partida: PartidaGuardada | null = null;
  private poblador: Poblador | null = null;
  private quitar: (() => void)[] = [];
  private tRevisar = 0;
  private tGuardar = 0;
  private refuerzos = 0;
  private prev = { dia: 1, hora: HORA_INICIAL };
  private base = { titanes: 0, nucas: 0, jefes: 0, defensas: 0 };
  private jefes = 0;
  private defensas = 0;
  /** Descanso hasta el amanecer (H): dónde empezó. */
  private descanso: THREE.Vector3 | null = null;
  private jefeSuelto: TitanAPI | null = null;
  private avistamientoHoy = -1;

  /** Hay partida guardada que continuar. */
  static hayPartida(): PartidaGuardada | null {
    return leerPartida();
  }

  iniciar(api: ApiCapitulo): void {
    this.api = api;
    const ctx = api.ctx;
    this.partida = this.continuar ? leerPartida() : null;
    if (!this.continuar) borrarPartida();
    const p = this.partida;
    ctx.ciclo.dia = p?.dia ?? 1;
    ctx.ciclo.hora = p?.hora ?? HORA_INICIAL;
    ctx.ciclo.aceleracion = 1;
    this.prev = { dia: ctx.ciclo.dia, hora: ctx.ciclo.hora };
    this.base = { ...(p?.stats ?? { titanes: 0, nucas: 0, jefes: 0, defensas: 0 }) };
    this.jefes = 0;
    this.defensas = 0;
    for (const l of ctx.mundo.lugares) l.descubierto = p?.descubiertos.includes(l.id) ?? false;
    const m = ctx.mundo.muralla;
    const puerta = new THREE.Vector3(6, 0, m.radioExterior + 30);
    const inicio = p ? new THREE.Vector3(p.reaparicion[0], 0, p.reaparicion[1]) : puerta;
    const libre = ctx.nav.puntoLibreCercano(inicio.x, inicio.z, 1.5) ?? inicio;
    inicio.set(libre.x, 0, libre.z);
    ctx.jugador.revivir(inicio, 0);
    api.puntoControl(inicio);
    ctx.escuadron.crear(ESCUADRON, inicio.clone().add(new THREE.Vector3(-5, 0, -4)));
    // la vida sigue dentro de la muralla
    ctx.civiles.generar(30, new THREE.Vector3(0, 0, 0), 150);
    this.poblador = new Poblador(ctx);
    this.pueblos = new GestorPueblos(ctx);
    if (p) this.pueblos.cargar(p.pueblos);
    // tu caballo espera a tu lado
    this.caballo ??= new Caballo(ctx.escena, ctx.nav, ctx.poblacion);
    this.caballo.grupo.visible = true;
    this.caballo.montado = false;
    this.caballo.colocar(inicio.clone().add(new THREE.Vector3(4, 0, 3)), Math.PI);
    (ctx.jugador as { caballo?: Caballo | null }).caballo = this.caballo;
    this.tRevisar = 0;
    this.tGuardar = 20;
    this.refuerzos = 0;
    this.descanso = null;
    this.jefeSuelto = null;
    this.avistamientoHoy = p ? p.dia : -1;
    this.quitar.push(
      ctx.eventos.on('puebloDefendido', () => this.defensas++),
      ctx.eventos.on('titanMuerto', (e) => {
        if (!e.titan.especial) return;
        this.jefes++;
        const nombre = e.titan.especial === 'acorazado' ? 'al Acorazado' : 'a la Hembra';
        api.mensaje(`¡Has abatido ${nombre}!`, 4);
        if (this.jefeSuelto === e.titan) this.jefeSuelto = null;
      }),
      ctx.eventos.on('puebloEnPaz', () => this.guardar()),
      ctx.eventos.on('puebloLiberado', () => this.guardar()),
    );
    this.actualizarObjetivo();
  }

  actualizar(dt: number): void {
    const ctx = this.api.ctx;
    const ciclo = ctx.ciclo;
    const horas = (ciclo.dia - this.prev.dia) * 24 + (ciclo.hora - this.prev.hora);
    this.prev = { dia: ciclo.dia, hora: ciclo.hora };
    this.poblador?.actualizar(dt);
    this.caballo?.actualizar(dt);
    this.pueblos?.actualizar(dt, Math.max(0, horas), !ciclo.noche, factorNoche(ciclo.hora), ciclo.dia);
    this.pasoDescanso();
    if (ctx.entrada.consumir('KeyH')) this.alternarDescanso();
    this.avistamientos();
    this.tGuardar -= dt;
    if (this.tGuardar <= 0) {
      this.tGuardar = 30;
      this.guardar();
    }
    this.tRevisar -= dt;
    if (this.tRevisar > 0) return;
    this.tRevisar = 0.5;
    const p = ctx.jugador.posicion;
    for (const l of ctx.mundo.lugares) {
      if (l.descubierto || !this.cerca(l, p)) continue;
      l.descubierto = true;
      this.api.mensaje(`Descubierto: ${l.nombre}`, 3);
    }
    // reaparecer en el refugio más cercano
    this.api.puntoControl(this.lugarSeguro(p));
    this.reforzar(p);
    this.actualizarObjetivo();
  }

  terminar(): void {
    this.guardar();
    for (const q of this.quitar) q();
    this.quitar = [];
    this.poblador?.limpiar();
    this.poblador = null;
    this.pueblos?.limpiar();
    this.pueblos = null;
    const ctx = this.api?.ctx;
    if (ctx) {
      ctx.ciclo.aceleracion = 1;
      (ctx.jugador as { caballo?: Caballo | null }).caballo = null;
    }
    if (this.caballo) this.caballo.grupo.visible = false;
  }

  /** Estado para guardar (también lo usa el menú de pausa). */
  guardar(): void {
    if (!this.api || !this.pueblos) return;
    const ctx = this.api.ctx;
    const s = this.api.estadisticas;
    const r = ctx.puntoReaparicion;
    guardarPartida({
      version: 1,
      dia: ctx.ciclo.dia,
      hora: ctx.ciclo.hora,
      pueblos: this.pueblos.guardar(),
      descubiertos: ctx.mundo.lugares.filter((l) => l.descubierto).map((l) => l.id),
      stats: {
        titanes: this.base.titanes + s.titanesMuertos,
        nucas: this.base.nucas + s.nucasPropias,
        jefes: this.base.jefes + this.jefes,
        defensas: this.base.defensas + this.defensas,
      },
      reaparicion: [r.x, r.z],
    });
  }

  get titanesTotales(): number {
    return this.base.titanes + (this.api?.estadisticas.titanesMuertos ?? 0);
  }

  get descansando(): boolean {
    return this.descanso !== null;
  }

  private resumenGuardado(p: PartidaGuardada): string {
    const enPaz = p.pueblos.filter((x) => x.progreso >= 1 && x.liberado).length;
    const libres = p.pueblos.filter((x) => x.liberado).length;
    return `${libres} liberados, ${enPaz} en paz, ${p.stats.titanes} titanes abatidos.`;
  }

  // ───────────── Descanso ─────────────

  /** ¿Estás en un refugio? Dentro de Trost, junto a un puesto o el campamento, o en un pueblo en paz. */
  private enRefugio(p: THREE.Vector3): boolean {
    const ctx = this.api.ctx;
    if (Math.hypot(p.x, p.z) < ctx.mundo.muralla.radioInterior) return true;
    if (ctx.mundo.lugares.some((l) => (l.tipo === 'puesto' || l.tipo === 'campamento') && Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < l.radio + 25)) return true;
    return (this.pueblos?.refugios() ?? []).some((x) => Math.hypot(x.centro.x - p.x, x.centro.z - p.z) < x.datos.radio);
  }

  private amenazado(p: THREE.Vector3): boolean {
    return this.api.ctx.poblacion.titanesCerca(p, 140).some((t) => t.vivo && t.estado !== 'apagado');
  }

  private alternarDescanso(): void {
    const ctx = this.api.ctx;
    const p = ctx.jugador.posicion;
    if (this.descanso) {
      this.terminarDescanso('');
      return;
    }
    const h = ctx.ciclo.hora;
    if (!(h >= 19 || h < 5)) return this.api.mensaje('Solo de noche', 1.5);
    if (!this.enRefugio(p)) return this.api.mensaje('Aquí no es seguro', 1.5);
    if (this.amenazado(p)) return this.api.mensaje('Hay titanes cerca', 1.5);
    this.descanso = p.clone();
    ctx.ciclo.aceleracion = 45;

  }

  private pasoDescanso(): void {
    const d = this.descanso;
    if (!d) return;
    const ctx = this.api.ctx;
    const h = ctx.ciclo.hora;
    if (h >= 6 && h < 12) {
      ctx.jugador.reabastecer();
      this.terminarDescanso('');
    } else if (this.amenazado(ctx.jugador.posicion)) this.terminarDescanso('¡Titanes!');
    else if (ctx.jugador.posicion.distanceTo(d) > 6 || !ctx.jugador.vivo) this.terminarDescanso('');
  }

  private terminarDescanso(texto: string): void {
    this.descanso = null;
    this.api.ctx.ciclo.aceleracion = 1;
    if (texto) this.api.mensaje(texto, 1.5);
  }

  // ───────────── Cambiantes ─────────────

  /** Desde el día 2, la mitad de los días (y a diario desde el 5) un explorador avista un cambiante a media mañana. */
  private avistamientos(): void {
    const ctx = this.api.ctx;
    const c = ctx.ciclo;
    if (c.dia < 2 || this.avistamientoHoy === c.dia || c.hora < 10 || c.hora > 16) return;
    this.avistamientoHoy = c.dia;
    if (this.jefeSuelto?.vivo) return;
    if (c.dia < 5 && Math.random() < 0.5) return;
    const p = ctx.jugador.posicion;
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 380 + Math.random() * 220;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (Math.hypot(x, z) < ctx.mundo.muralla.radioExterior + 80) continue;
      const lim = ctx.nav.limites;
      if (x < lim.x0 + 50 || x > lim.x1 - 50 || z < lim.z0 + 50 || z > lim.z1 - 50) continue;
      if (ctx.mundo.bosques.some((b) => b.contiene(x, z))) continue;
      const especial: EspecialTitan = Math.random() < 0.5 ? 'acorazado' : 'hembra';
      this.jefeSuelto = ctx.titanes.generar({ posicion: new THREE.Vector3(x, 0, z), altura: especial === 'acorazado' ? 15 : 14, especial, rumbo: Math.atan2(p.x - x, p.z - z) });
      this.api.mensaje(`${especial === 'acorazado' ? 'Acorazado' : 'Titana Hembra'} avistado al ${direccionCardinal(x - p.x, z - p.z)} (${Math.round(r)} m)`, 3.5);
      return;
    }
  }

  // ───────────── Mundo ─────────────

  /** Si cae todo el escuadrón, en un refugio te espera otro de la Legión. */
  private reforzar(p: THREE.Vector3): void {
    const esc = this.api.ctx.escuadron;
    if (!this.api.ctx.jugador.vivo || esc.soldados.some((s) => s.vivo) || !this.enRefugio(p)) return;
    const tanda = this.refuerzos % 2 === 0 ? REFUERZOS : ESCUADRON;
    this.refuerzos++;
    esc.limpiar();
    esc.crear(tanda, p.clone().add(new THREE.Vector3(-5, 0, -4)).setY(0));
    this.api.mensaje('Llegan refuerzos de la Legión', 3);
  }

  private cerca(l: Lugar, p: THREE.Vector3): boolean {
    if (l.tipo === 'bosque') {
      const i = Number(l.id.replace('bosque', ''));
      const b = this.api.ctx.mundo.bosques[i];
      if (b) return b.contiene(p.x, p.z);
    }
    return Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < l.radio + 60;
  }

  /** El refugio más cercano: la puerta sur, los puestos y el campamento descubiertos y los pueblos en paz. */
  private lugarSeguro(p: THREE.Vector3): THREE.Vector3 {
    const ctx = this.api.ctx;
    const candidatos: THREE.Vector3[] = [new THREE.Vector3(6, 0, ctx.mundo.muralla.radioExterior + 30)];
    for (const l of ctx.mundo.lugares) if (l.descubierto && (l.tipo === 'puesto' || l.tipo === 'campamento' || l.tipo === 'castillo' || l.tipo === 'puente')) candidatos.push(l.pos);
    for (const x of this.pueblos?.refugios() ?? []) candidatos.push(x.datos.deposito);
    let mejor = candidatos[0];
    let d = Infinity;
    for (const c of candidatos) {
      const x = Math.hypot(c.x - p.x, c.z - p.z);
      if (x < d) {
        d = x;
        mejor = c;
      }
    }
    return ctx.nav.puntoLibreCercano(mejor.x, mejor.z, 1.5) ?? mejor.clone().setY(0);
  }

  private actualizarObjetivo(): void {
    const ctx = this.api.ctx;
    const c = ctx.ciclo;
    const pueblos = this.pueblos;
    const momento = momentoDia(c.hora);
    let titulo = `Día ${c.dia} · ${textoHora(c.hora)} · ${momento[0].toUpperCase()}${momento.slice(1)}`;
    if (this.descanso) titulo += ' · Descansando…';
    const alarma = pueblos?.lista.find((x) => x.enAlarma);
    if (alarma) titulo = `¡Atacan ${alarma.nombre}! · ${textoHora(c.hora)}`;
    const n = pueblos?.lista.length ?? 0;
    const detalle = [
      `Pueblos en paz ${pueblos?.enPaz ?? 0}/${n}`,
      `Vecinos ${pueblos?.poblacion ?? 0}`,
      `Titanes abatidos ${this.titanesTotales}`,
    ].join(' · ');
    this.api.objetivo(titulo, detalle);
  }
}
