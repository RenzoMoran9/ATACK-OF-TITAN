import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { EventoJuego, TipoEvento } from '../core/tipos';

/**
 * Campaña por capítulos siguiendo la cronología de la historia (docs/investigacion/historia.json).
 * Cada capítulo es una pequeña máquina de estados que se dispara por lugar, tiempo y
 * eventos (titanes muertos, civiles salvados…). La campaña lleva la cuenta, los puntos
 * de control y las pantallas de victoria y derrota.
 */

export type IdCapitulo = 'entrenamiento' | 'trost' | 'libre';
export type EstadoCampana = 'menu' | 'intro' | 'jugando' | 'victoria' | 'derrota';

export interface Estadisticas {
  tiempo: number;
  titanesMuertos: number;
  nucasPropias: number;
  civilesSalvados: number;
  civilesMuertos: number;
  companerosCaidos: string[];
  muertesJugador: number;
}

export interface ApiCapitulo {
  readonly ctx: ContextoJuego;
  readonly estadisticas: Estadisticas;
  /** Texto del objetivo actual y un detalle (contador, pista). */
  objetivo(texto: string, detalle?: string): void;
  mensaje(texto: string, segundos?: number): void;
  /** Escucha un evento mientras dure el capítulo. */
  on<T extends TipoEvento>(tipo: T, fn: (e: Extract<EventoJuego, { tipo: T }>) => void): void;
  /** Dónde reaparece el jugador si muere. */
  puntoControl(pies: THREE.Vector3): void;
  victoria(): void;
  derrota(motivo: string): void;
}

export interface Capitulo {
  readonly id: IdCapitulo;
  /** «Capítulo 2: Defensa de Trost». */
  readonly titulo: string;
  /** «Año 850 · Batalla de Trost». */
  readonly epoca: string;
  readonly intro: string;
  /** Prepara el mundo (titanes, civiles, escuadrón, jugador). */
  iniciar(api: ApiCapitulo): void;
  actualizar(dt: number): void;
  /** Deja el mundo como estaba (se llama antes de cambiar de capítulo). */
  terminar(): void;
  /** El gas solo se recarga en el depósito si el capítulo lo permite. */
  depositoDisponible?(): boolean;
}

const CLAVE_PROGRESO = 'atack-of-titan:progreso';

function leerProgreso(): IdCapitulo[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_PROGRESO) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function guardarProgreso(ids: IdCapitulo[]): void {
  try {
    localStorage.setItem(CLAVE_PROGRESO, JSON.stringify(ids));
  } catch {
    /* sin almacenamiento: el progreso no se recuerda, el juego sigue */
  }
}

export class Campana {
  estado: EstadoCampana = 'menu';
  capitulo: Capitulo | null = null;
  objetivoTexto = '';
  objetivoDetalle = '';
  motivoDerrota = '';
  completados: IdCapitulo[] = leerProgreso();
  stats: Estadisticas = Campana.statsVacias();
  /** Lo avisa la UI cuando cambia el estado (para mostrar pantallas). */
  alCambiar: (() => void) | null = null;
  private oyentes: (() => void)[] = [];
  private readonly api: ApiCapitulo;

  constructor(private readonly ctx: ContextoJuego, readonly capitulos: Capitulo[]) {
    const self = this;
    this.api = {
      ctx,
      get estadisticas() {
        return self.stats;
      },
      objetivo: (texto, detalle = '') => {
        this.objetivoTexto = texto;
        this.objetivoDetalle = detalle;
      },
      mensaje: (texto, segundos = 3) => ctx.eventos.emit({ tipo: 'mensaje', texto, segundos }),
      on: (tipo, fn) => {
        this.oyentes.push(ctx.eventos.on(tipo, fn));
      },
      puntoControl: (pies) => ctx.puntoReaparicion.copy(pies),
      victoria: () => this.terminarCon('victoria'),
      derrota: (motivo) => {
        this.motivoDerrota = motivo;
        this.terminarCon('derrota');
      },
    };
  }

  static statsVacias(): Estadisticas {
    return { tiempo: 0, titanesMuertos: 0, nucasPropias: 0, civilesSalvados: 0, civilesMuertos: 0, companerosCaidos: [], muertesJugador: 0 };
  }

  get jugando(): boolean {
    return this.estado === 'jugando';
  }

  /** Prepara un capítulo y enseña su presentación (el juego espera a `empezar`). */
  cargar(id: IdCapitulo): void {
    this.limpiar();
    const c = this.capitulos.find((x) => x.id === id);
    if (!c) return;
    this.capitulo = c;
    this.stats = Campana.statsVacias();
    this.objetivoTexto = '';
    this.objetivoDetalle = '';
    this.motivoDerrota = '';
    this.escucharEstadisticas();
    c.iniciar(this.api);
    this.estado = 'intro';
    this.alCambiar?.();
  }

  empezar(): void {
    if (this.estado !== 'intro') return;
    this.estado = 'jugando';
    this.alCambiar?.();
  }

  reintentar(): void {
    if (this.capitulo) this.cargar(this.capitulo.id);
  }

  irAlMenu(): void {
    this.limpiar();
    this.capitulo = null;
    this.estado = 'menu';
    this.alCambiar?.();
  }

  /** Siguiente capítulo en orden (o null si no hay). */
  siguiente(): IdCapitulo | null {
    if (!this.capitulo) return null;
    const i = this.capitulos.findIndex((c) => c.id === this.capitulo!.id);
    const sig = this.capitulos[i + 1];
    return sig && sig.id !== 'libre' ? sig.id : null;
  }

  depositoDisponible(): boolean {
    return this.capitulo?.depositoDisponible?.() ?? true;
  }

  actualizar(dt: number): void {
    if (this.estado !== 'jugando' || !this.capitulo) return;
    this.stats.tiempo += dt;
    this.capitulo.actualizar(dt);
  }

  private terminarCon(estado: 'victoria' | 'derrota'): void {
    if (this.estado !== 'jugando') return;
    this.estado = estado;
    if (estado === 'victoria' && this.capitulo && !this.completados.includes(this.capitulo.id)) {
      this.completados.push(this.capitulo.id);
      guardarProgreso(this.completados);
    }
    this.alCambiar?.();
  }

  private escucharEstadisticas(): void {
    const ctx = this.ctx;
    this.oyentes.push(
      ctx.eventos.on('titanMuerto', (e) => {
        this.stats.titanesMuertos++;
        if (e.por === ctx.jugador) this.stats.nucasPropias++;
      }),
      ctx.eventos.on('civilSalvado', () => this.stats.civilesSalvados++),
      ctx.eventos.on('humanoDevorado', (e) => {
        if (e.humano.tipo === 'civil') this.stats.civilesMuertos++;
        else if (e.humano.tipo === 'soldado') {
          this.stats.companerosCaidos.push(e.humano.nombre);
          ctx.eventos.emit({ tipo: 'mensaje', texto: `${e.humano.nombre} ha caído`, segundos: 3.5 });
        } else this.stats.muertesJugador++;
      }),
    );
  }

  private limpiar(): void {
    for (const quitar of this.oyentes) quitar();
    this.oyentes = [];
    this.capitulo?.terminar();
    const ctx = this.ctx;
    ctx.titanes.limpiar();
    ctx.escuadron.limpiar();
    ctx.civiles.limpiar();
    const m = ctx.mundo.muralla;
    if (m.rota) {
      m.repararPuerta();
      ctx.nav.ponerArco(m.radioInterior, m.radioExterior + 1, 0, m.anchoPuerta, 1);
    }
  }
}
