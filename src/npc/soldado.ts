import * as THREE from 'three';
import { calcularDanio, desgaste, umbralZona } from '../combat/corte';
import { Cuchillas } from '../combat/cuchillas';
import { empujeFuera, RADIO_PERSONA } from '../core/colision';
import { config } from '../core/config';
import type { ContextoJuego } from '../core/contexto';
import { nuevoId } from '../core/poblacion';
import type { AspectoSoldado, Humano, OrdenEscuadron, PuntoDebil, RolSoldado, TitanAPI, ZonaTitan } from '../core/tipos';
import { Caballo } from '../player/caballo';
import { ModeloJugador } from '../player/modeloJugador';
import { aplicarRecogida, aplicarRestriccion } from '../player/cuerda';
import type { Particulas } from '../player/particulas';
import { DANIO_AGARRE } from './logicaHeridos';
import { DetectorAtasco, enLod } from './logicaOrdenes';

/**
 * Soldado del escuadrón con equipo ODM simplificado: dos ganchos que se clavan alternando
 * izquierda y derecha (a veces los dos a la vez, abiertos en V) en tejados, árboles, la
 * muralla o la carne de los titanes, recogida con la bobina, impulsos de gas con su bocanada,
 * carrera por el suelo (con ruta por las calles si hay casas en medio) y tajos con el mismo
 * modelo de daño que el jugador (velocidad relativa, ángulo y filo).
 *
 * Lo dirige el escuadrón con una misión; la orden que le dio el jugador se guarda aparte.
 * Si en 2 s no se acerca a su meta, salta con gas y busca otro ancla. Lejos del jugador y
 * sin titanes cerca pasa a una actualización simplificada (cada 0,2 s, en línea recta, sin
 * rayos, sin cables ni nombre y sin animar si no se ve).
 */

export type TipoMision = 'seguir' | 'atacar' | 'rescatar' | 'proteger' | 'retirada' | 'darGas' | 'mantener' | 'patrullar' | 'recargar' | 'huir' | 'curar';

export interface Mision {
  tipo: TipoMision;
  /** Punto al que ir (seguir, proteger, retirada, mantener, patrullar, recargar). */
  destino?: THREE.Vector3;
  titan?: TitanAPI;
  zona?: ZonaTitan;
  /** Cebo: distrae al titán delante de su cara. */
  cebo?: boolean;
  humano?: Humano;
  /** Recargar: tiempo de juego a partir del cual se abandona (depósito inalcanzable). */
  hasta?: number;
  /** Darle gas que has pedido tú (G): se cumple aunque tenga una orden. */
  pedido?: boolean;
}

/** La orden que le dio el jugador (la misión concreta la decide el escuadrón cada 0,4 s). */
export interface OrdenAsignada {
  tipo: OrdenEscuadron;
  /** Punto común de la orden, en la superficie (lleva el banderín): espera, destino o centro de patrulla. */
  punto?: THREE.Vector3;
  /** Su sitio junto al punto (esperar, id allí), a la altura del cuerpo. */
  puesto?: THREE.Vector3;
  /** Punto de patrulla actual y cuándo toca elegir otro (tiempo de juego). */
  patrulla?: THREE.Vector3;
  tPatrulla?: number;
  titan?: TitanAPI;
  /** Orden a la que vuelve cuando muere el titán señalado. */
  previa?: OrdenAsignada;
  /** Espera dentro del campamento fortificado: no sale a pelear salvo que le mandes atacar. */
  campamento?: boolean;
  /** Trabajando en el campamento: sin banderín y con su propia actividad en el panel. */
  trabajo?: boolean;
  /** En lo alto de la muralla, junto a un cañón (lo dispara cuando está cargado). */
  muralla?: boolean;
  /**
   * Una orden tuya: se cumple sin excepciones (nada de rescates, depósito, gas ni huida por su
   * cuenta). Sin ella, el soldado actúa por su cuenta.
   */
  dada?: boolean;
}

interface Ancla {
  punto: THREE.Vector3;
  objeto: THREE.Object3D | null;
  local: THREE.Vector3;
  longitud: number;
  /** Segundos clavado. */
  t: number;
  /** 1 = gancho izquierdo, −1 = derecho (como `salidaCable`). */
  lado: 1 | -1;
  /** El gancho anterior al cambiar de lado: se suelta al llegar a 0 (null = tira). */
  soltarEn: number | null;
}

interface CandidatoAncla {
  punto: THREE.Vector3;
  objeto: THREE.Object3D | null;
  puntuacion: number;
}

const ARRIBA = new THREE.Vector3(0, 1, 0);
const CENTRO = 0.85; // del centro del cuerpo a los pies
const VEL_CORRER = 6.8;
/** Llevando suministros, a menos de esto va derecho al compañero (corriendo o con gas, sin ganchos). */
const ALCANCE_DIRECTO = 45;
const VEL_RECOGIDA = 24;
const VEL_MAX = 38;
const GRAVEDAD = 14;
const ETIQUETAS_ANCLA = new Set(['edificio', 'tejado', 'arbol', 'rama', 'muralla', 'puerta', 'titan', 'nuca', 'otro']);
/** Velocidad del vuelo simplificado (LOD). */
const VEL_LOD = 20;
/** Radio para las rutas a pie por la rejilla de navegación. */
const RADIO_NAV = 0.7;

export class Soldado implements Humano {
  readonly id = nuevoId();
  readonly tipo = 'soldado' as const;
  readonly posicion = new THREE.Vector3();
  readonly velocidad = new THREE.Vector3();
  vivo = true;
  agarradoPor: TitanAPI | null = null;
  /** Gas máximo: 120 (el intendente lleva 400 en bombonas de repuesto). */
  readonly gasMax: number;
  gas: number;
  readonly cuchillas = new Cuchillas();
  readonly modelo: ModeloJugador;
  mision: Mision = { tipo: 'seguir' };
  orden: OrdenAsignada = { tipo: 'seguir' };
  /** Recibe las órdenes él solo (Tab): nombre en dorado. */
  seleccionado = false;
  /** Actualización simplificada: lejos del jugador y sin titanes cerca. */
  lod = false;
  /** Para el HUD y los mensajes. */
  ultimaFrase = -99;
  /** A quién anunció el intendente su última entrega, y cuándo. */
  avisoGas: { humano: Humano | null; t: number } = { humano: null, t: -99 };
  /** No intentar recargar antes de este tiempo de juego (tras rendirse con un depósito). */
  vetoRecarga = 0;
  /** Vida 0–100: la pierde en la mano de un titán; a 0 cae. */
  salud = 100;
  readonly saludMax = 100;
  /** Herido: se retira a curarse hasta el 85 % (lo decide el escuadrón). */
  herido = false;
  /** Huyendo del encuentro: misión de escape, a caballo si puede. */
  huyendo = false;
  /** Su caballo (todos tienen uno) y si va montado en él. */
  caballo: Caballo | null = null;
  montado = false;

  private enSuelo = true;
  private rumbo = 0;
  /** [gancho izquierdo, gancho derecho]. */
  private readonly ganchos: (Ancla | null)[] = [null, null];
  private ladoSiguiente: 1 | -1 = 1;
  private tSinAncla = 0;
  private impulsando = false;
  private readonly dirImpulso = new THREE.Vector3(0, 1, 0);
  private tCorte = -1;
  private enfriamiento = 0;
  private tDistraer = 0;
  private tEsquiva = 0;
  private brazoAgarre: 'brazoIzq' | 'brazoDer' = 'brazoDer';
  private tAgarrado = 0;
  private tIntento = 0;
  private tAterrizaje: number | null = null;
  private impacto = 0;
  private tLod = 0;
  private tEvalLod = 0;
  private readonly atasco = new DetectorAtasco();
  private ruta: THREE.Vector3[] | null = null;
  private tRuta = 0;
  private readonly metaRuta = new THREE.Vector3(Infinity, 0, 0);
  private tBocanada = 0;
  private readonly esfera = new THREE.Sphere(new THREE.Vector3(), 2);
  private readonly velPrevia = new THREE.Vector3();
  private readonly acel = new THREE.Vector3();
  private readonly posPrevia = new THREE.Vector3();
  private readonly posRender = new THREE.Vector3();
  private readonly mirar = new THREE.Vector3();
  private readonly cables: THREE.Line[] = [];
  private readonly etiqueta: THREE.Sprite;
  private objetivoCorte: THREE.Vector3 | null = null;

  constructor(
    private readonly ctx: ContextoJuego,
    readonly nombre: string,
    readonly rol: RolSoldado,
    aspecto: AspectoSoldado,
    pies: THREE.Vector3,
    /** Puntería y temple: multiplica el daño y la probabilidad de esquivar (Mikasa > 1). */
    readonly habilidad = 1,
    /** Partículas compartidas del escuadrón para las bocanadas de gas. */
    private readonly chorros: Particulas | null = null,
  ) {
    this.gasMax = rol === 'intendente' ? 800 : 240;
    this.gas = this.gasMax;
    this.modelo = new ModeloJugador(aspecto);
    // como el jugador: los pies se apoyan en el terreno real, no en un suelo plano imaginario
    const abajo = new THREE.Vector3(0, -1, 0);
    const origen = new THREE.Vector3();
    this.modelo.sueloEn = (p) => ctx.fisica.lanzarRayo(origen.copy(p).setY(p.y + 0.7), abajo, 1.6)?.punto.y ?? null;
    ctx.escena.add(this.modelo.grupo);
    this.posicion.copy(pies).setY(pies.y + CENTRO);
    this.posPrevia.copy(this.posicion);
    this.posRender.copy(this.posicion);
    this.rumbo = Math.random() * Math.PI * 2;
    const mat = new THREE.LineBasicMaterial({ color: '#2a2a2a' });
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const l = new THREE.Line(geo, mat);
      l.frustumCulled = false;
      l.visible = false;
      ctx.escena.add(l);
      this.cables.push(l);
    }
    this.etiqueta = crearEtiqueta(nombre);
    ctx.escena.add(this.etiqueta);
  }

  // ─────────────────────────── Humano ───────────────────────────

  alSerAgarrado(titan: TitanAPI, brazo: 'brazoIzq' | 'brazoDer' = 'brazoDer'): void {
    this.desmontar();
    this.agarradoPor = titan;
    this.brazoAgarre = brazo;
    this.tAgarrado = 0;
    this.tIntento = 0;
    this.soltarAncla();
    this.velocidad.set(0, 0, 0);
    this.decir(['¡Suéltame!', '¡Ayuda!', '¡No…!'][Math.floor(Math.random() * 3)]);
  }

  alSerSoltado(): void {
    this.agarradoPor = null;
    this.enSuelo = false;
    this.lod = false;
    this.velocidad.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
  }

  alSerDevorado(): void {
    this.agarradoPor = null;
    this.caer();
  }

  /** Daño (la mano de un titán). A 0 de vida cae. */
  herir(cantidad: number): void {
    if (!this.vivo || cantidad <= 0) return;
    this.salud = Math.max(0, this.salud - cantidad);
    if (this.salud <= 0) {
      this.caer();
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${this.nombre} ha caído`, segundos: 3 });
    }
  }

  /** Lo cura el médico (sin pasarse de la salud máxima). */
  curar(cantidad: number): void {
    if (this.vivo) this.salud = Math.min(this.saludMax, this.salud + cantidad);
  }

  /** Deja de existir para el escuadrón; su caballo, si iba montado, queda suelto. */
  private caer(): void {
    this.vivo = false;
    if (this.montado && this.caballo) {
      this.caballo.montado = false;
      this.montado = false;
    }
    this.modelo.grupo.visible = false;
    this.etiqueta.visible = false;
    for (const c of this.cables) c.visible = false;
  }

  /** Monta en su caballo (que ya ha venido a su lado). */
  montar(): void {
    const c = this.caballo;
    if (!c || this.montado || !this.vivo || this.agarradoPor) return;
    this.montado = true;
    c.montado = true;
    this.soltarAncla();
    this.enSuelo = false;
    this.velocidad.set(0, 0, 0);
  }

  /** Baja del caballo: queda en el suelo donde está el caballo. */
  desmontar(): void {
    const c = this.caballo;
    if (!c || !this.montado) return;
    this.montado = false;
    c.montado = false;
    this.posicion.set(c.pos.x, c.pos.y + CENTRO, c.pos.z);
    this.posPrevia.copy(this.posicion);
    this.enSuelo = true;
    this.velocidad.set(0, 0, 0);
  }

  fijarPosicion(p: THREE.Vector3): void {
    this.posicion.copy(p);
    this.posPrevia.copy(p);
  }

  // ─────────────────────────── Paso fijo ───────────────────────────

  paso(dt: number): void {
    this.posPrevia.copy(this.posicion);
    this.velPrevia.copy(this.velocidad);
    if (!this.vivo) return;
    // en la mano de un titán se le va la vida apretando
    if (this.agarradoPor) {
      this.herir(DANIO_AGARRE * dt);
      this.cortarseLibre(dt);
      return;
    }
    // el intendente lleva bombonas de sobra: su gas no se acaba nunca
    if (this.rol === 'intendente') this.gas = this.gasMax;
    this.cuchillas.actualizar(dt);
    if (this.cuchillas.rota && this.cuchillas.repuesto > 0 && this.cuchillas.cambiando <= 0) this.cuchillas.empezarCambio();
    // a caballo: el caballo lo lleva, sin ODM ni cables
    if (this.montado && this.caballo) {
      this.pasoMontado(dt);
      return;
    }
    this.tEvalLod -= dt;
    if (this.tEvalLod <= 0) {
      this.tEvalLod = 0.5;
      const t = this.ctx.poblacion.titanMasCercano(this.posicion, 130);
      const dTitan = t ? Math.hypot(t.posicion.x - this.posicion.x, t.posicion.z - this.posicion.z) : Infinity;
      const antes = this.lod;
      this.lod = enLod(this.lod, this.posicion.distanceTo(this.ctx.jugador.posicion), dTitan);
      if (this.lod && !antes) {
        this.soltarAncla();
        this.tLod = 0;
      }
    }
    if (this.lod) {
      this.pasoLod(dt);
      return;
    }
    if (this.enfriamiento > 0) this.enfriamiento -= dt;
    if (this.tCorte >= 0) {
      this.tCorte += dt;
      if (this.tCorte > 0.25) this.tCorte = -1;
    }
    if (this.tAterrizaje !== null) {
      this.tAterrizaje += dt;
      if (this.tAterrizaje > 0.6) this.tAterrizaje = null;
    }

    const meta = this.metaActual();
    const titan = this.mision.titan && this.mision.titan.vivo ? this.mision.titan : null;
    this.actualizarGanchos(dt);
    this.esquivar(titan, dt);
    if (titan) this.combatir(titan, dt);
    this.moverHacia(meta, dt, titan);
    this.integrar(dt);
    if (titan) this.atasco.reiniciar();
    else if (this.atasco.muestra(dt, this.posicion.distanceTo(meta), meta)) this.desatascar(meta);
    this.tBocanada -= dt;
    if (this.impulsando && this.tBocanada <= 0) {
      this.tBocanada = 0.07;
      this.bocanada(1);
    }
  }

  /** A caballo: el caballo lleva al jinete hacia su meta; huyendo, galopa y acelera si le queda aliento. */
  private pasoMontado(dt: number): void {
    const c = this.caballo!;
    const meta = this.metaActual();
    const dx = meta.x - c.pos.x;
    const dz = meta.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    const huye = this.mision.tipo === 'huir';
    const dir = dist > 4 ? new THREE.Vector3(dx, 0, dz) : new THREE.Vector3();
    c.conducir(dt, dir, huye || dist > 25, huye && dist > 20);
    this.posicion.copy(c.silla());
    this.velocidad.copy(c.vel);
    this.rumbo = c.rumbo;
    this.enSuelo = false;
    this.impulsando = false;
    this.objetivoCorte = null;
  }

  /** Lejos de todo: cada 0,2 s, en línea recta hacia la meta, sin rayos ni cables. */
  private pasoLod(dt: number): void {
    this.tLod += dt;
    if (this.tLod < 0.2) return;
    const h = this.tLod;
    this.tLod = 0;
    this.objetivoCorte = null;
    const meta = this.metaActual();
    const hacia = meta.clone().sub(this.posicion);
    const dist = hacia.length();
    const vel = this.gas > 1 ? VEL_LOD : VEL_CORRER;
    if (dist > 1.5) {
      this.posicion.addScaledVector(hacia, Math.min(dist, vel * h) / dist);
      this.velocidad.copy(hacia).multiplyScalar(vel / dist);
      if (this.gas > 1) this.gas = Math.max(0, this.gas - 0.35 * h);
      this.enSuelo = false;
    } else {
      this.posicion.copy(meta);
      this.velocidad.set(0, 0, 0);
      this.enSuelo = true;
    }
  }

  /**
   * A dónde quiere ir ahora: la meta de la misión, pasando antes por la puerta del campamento si
   * la meta está al otro lado de la empalizada (a caballo no se cruza: baja ante la puerta).
   */
  private metaActual(): THREE.Vector3 {
    const meta = this.metaMision();
    const paso = this.ctx.fuerte?.desvio(this.posicion, meta);
    if (!paso) return meta;
    if (this.montado && Math.hypot(paso.x - this.posicion.x, paso.z - this.posicion.z) < 12) this.desmontar();
    return paso;
  }

  /** A dónde lleva la misión. */
  private metaMision(): THREE.Vector3 {
    const m = this.mision;
    const titan = m.titan && m.titan.vivo ? m.titan : null;
    if (titan && (m.tipo === 'atacar' || m.tipo === 'rescatar')) {
      const H = titan.altura;
      if (m.cebo) {
        // delante de la cara, fuera del alcance de las manos, dando vueltas
        const frente = new THREE.Vector3(Math.sin(titan.rumbo), 0, Math.cos(titan.rumbo));
        const lado = new THREE.Vector3(frente.z, 0, -frente.x);
        const t = this.ctx.reloj.t;
        return titan.cabeza().clone().addScaledVector(frente, 0.55 * H + 5).addScaledVector(lado, Math.sin(t * 0.7 + this.id) * (0.3 * H + 4)).setY(Math.max(3, 0.85 * H));
      }
      const p = this.punto(titan, m.zona ?? 'nuca');
      if (p) {
        this.objetivoCorte = p.centro;
        // el rematador espera detrás si el titán le está mirando
        if (m.zona === 'nuca' && titan.objetivo === this && titan.estado !== 'derribado' && titan.estado !== 'cegado') {
          const atras = new THREE.Vector3(-Math.sin(titan.rumbo), 0, -Math.cos(titan.rumbo));
          return p.centro.clone().addScaledVector(atras, 10 + H * 0.4).setY(p.centro.y + 4);
        }
        return p.centro.clone().addScaledVector(p.normal, 0.8);
      }
    }
    this.objetivoCorte = null;
    if (m.tipo === 'darGas' && m.humano) return m.humano.posicion.clone().add(new THREE.Vector3(1.2, 0, 1.2));
    if (m.tipo === 'curar' && m.humano) return m.humano.posicion.clone().add(new THREE.Vector3(2, 0, 2));
    return m.destino ?? this.posicion;
  }

  private punto(titan: TitanAPI, zona: ZonaTitan): PuntoDebil | null {
    return titan.puntosDebiles.find((x) => x.zona === zona && x.activo) ?? null;
  }

  /**
   * En la mano de un titán, si aún tiene hojas, intenta cortarle los dedos él mismo (cada 0,7 s,
   * más a menudo cuanto más hábil) antes de que se lo lleve a la boca.
   */
  private cortarseLibre(dt: number): void {
    const titan = this.agarradoPor;
    if (!titan || !this.vivo) return;
    this.tAgarrado += dt;
    this.cuchillas.actualizar(dt);
    if (this.tAgarrado < 1 || !this.cuchillas.puedeCortar) return;
    this.tIntento -= dt;
    if (this.tIntento > 0) return;
    this.tIntento = 0.7;
    if (Math.random() > Math.min(0.8, 0.35 * this.habilidad)) return;
    const zona: ZonaTitan = this.brazoAgarre === 'brazoIzq' ? 'manoIzq' : 'manoDer';
    const res = titan.recibirCorte(zona, umbralZona(zona, titan.altura) * 1.5, this);
    this.cuchillas.desgastar(0.12);
    this.ctx.eventos.emit({ tipo: 'corte', titan, resultado: res, por: this });
    if (res.efecto === 'liberacion') {
      this.ultimaFrase = -99;
      this.decir('¡Me he zafado de su mano!');
    }
  }

  /** Si el titán que tiene delante va a agarrarle, un impulso lateral (según su habilidad). */
  private esquivar(titan: TitanAPI | null, dt: number): void {
    if (this.tEsquiva > 0) {
      this.tEsquiva -= dt;
      return;
    }
    const amenaza = titan ?? this.ctx.poblacion.titanMasCercano(this.posicion, 30);
    if (!amenaza || amenaza.objetivo !== this || amenaza.estado !== 'agarrar') return;
    if (Math.random() > Math.min(0.95, 0.7 * this.habilidad)) {
      this.tEsquiva = 1.5;
      return;
    }
    const lejos = this.posicion.clone().sub(amenaza.posicion).setY(0).normalize();
    const lado = new THREE.Vector3(lejos.z, 0, -lejos.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    this.soltarAncla();
    this.velocidad.addScaledVector(lado, 12).addScaledVector(ARRIBA, 9).addScaledVector(lejos, 6);
    this.gas = Math.max(0, this.gas - 2);
    this.impulsar(lado);
    this.bocanada(4);
    this.tEsquiva = 1.2;
  }

  /** Tajos, distracción del cebo y salida tras cortar. */
  private combatir(titan: TitanAPI, dt: number): void {
    const m = this.mision;
    if (m.cebo) {
      this.tDistraer -= dt;
      if (this.tDistraer <= 0 && titan.posicion.distanceTo(this.posicion) < 60) {
        titan.distraer(this, 3);
        this.tDistraer = 2;
      }
      return;
    }
    const p = this.punto(titan, m.zona ?? 'nuca');
    if (!p || this.enfriamiento > 0 || !this.cuchillas.puedeCortar) return;
    const d = this.posicion.distanceTo(p.centro);
    if (d > p.radio + 1.8) return;
    if (m.zona === 'nuca' && titan.objetivo === this && titan.estado !== 'derribado') return;
    const dir = p.centro.clone().sub(this.posicion).normalize();
    // acometida final para cortar con velocidad (como el jugador con el tajo asistido)
    if (this.velocidad.length() < 12 && this.gas > 2) {
      this.velocidad.addScaledVector(dir, 12);
      this.gas -= 1.5;
    }
    const r = calcularDanio({ velocidadRelativa: this.velocidad.clone(), eje: p.eje, filo: this.cuchillas.filo });
    const danio = r.danio * this.habilidad * (0.85 + Math.random() * 0.3);
    const res = titan.recibirCorte(p.zona, danio, this);
    this.ctx.eventos.emit({ tipo: 'corte', titan, resultado: res, por: this });
    this.cuchillas.desgastar(desgaste(r));
    if (res.efecto !== 'nada' && res.efecto !== 'rebote') this.ctx.efectos.sangre(p.centro.clone(), dir, 6);
    this.tCorte = 0;
    this.enfriamiento = 1.1 + Math.random() * 0.9;
    if (res.efecto === 'muerte' && Math.random() < 0.6) this.decir(['¡Uno menos!', '¡Abatido!', '¡Nuca!'][Math.floor(Math.random() * 3)]);
    if (res.efecto === 'liberacion') this.decir('¡Te tengo!');
    // salir disparado lejos de la carne tras el tajo
    this.soltarAncla();
    this.velocidad.addScaledVector(ARRIBA, 7).addScaledVector(p.normal, 6);
  }

  // ─────────────────────────── Locomoción ───────────────────────────

  private moverHacia(meta: THREE.Vector3, dt: number, titan: TitanAPI | null): void {
    const hacia = meta.clone().sub(this.posicion);
    const dist = hacia.length();
    const dh = Math.hypot(hacia.x, hacia.z);
    this.impulsando = false;
    // llevando gas, hojas o vendas a alguien ya cercano: derecho a él, sin ganchos (con los ganchos
    // se balanceaba dando vueltas a su alrededor sin acabar de llegar)
    const directo = (this.mision.tipo === 'darGas' || this.mision.tipo === 'curar') && dist < ALCANCE_DIRECTO;
    if (directo && this.tirando().length) this.soltarAncla();
    const tiran = this.tirando();

    // En el suelo: andar o correr (con ruta por las calles); sin gas, siempre a pie
    if (this.enSuelo && tiran.length === 0 && ((dist < (directo ? ALCANCE_DIRECTO : 14) && Math.abs(hacia.y) < (directo ? 4 : 2.5)) || this.gas < 1)) {
      const paso = this.pasoRuta(meta, dt);
      const v = dh < 1.5 ? 0 : Math.min(directo ? VEL_CORRER * 1.5 : VEL_CORRER, dh * 1.2);
      const dir = new THREE.Vector3(paso.x - this.posicion.x, 0, paso.z - this.posicion.z);
      if (dir.lengthSq() > 1e-6) dir.normalize();
      const k = Math.min(1, dt * 8);
      this.velocidad.x += (dir.x * v - this.velocidad.x) * k;
      this.velocidad.z += (dir.z * v - this.velocidad.z) * k;
      const delante = v > 1 ? this.ctx.fisica.lanzarRayo(this.posicion, dir, 1.2) : null;
      if (delante?.etiqueta === 'otro') {
        // obstáculo bajo (pozo, cajas): lo rodea por el lado que le acerca
        const n = delante.normal.clone().setY(0).normalize();
        const tangente = new THREE.Vector3(-n.z, 0, n.x);
        if (tangente.dot(dir) < 0) tangente.negate();
        this.velocidad.x = tangente.x * v;
        this.velocidad.z = tangente.z * v;
      } else if (delante && this.gas >= 1) this.despegar(meta); // muro delante: salta con gas y engancha
      return;
    }
    this.ruta = null;
    if (dist < 2.5 && !titan) {
      this.soltarAncla();
      return;
    }
    // lejos y a ras de suelo: salto con gas para volar en vez de patinar por la llanura
    if (this.enSuelo && tiran.length === 0) {
      if (directo) {
        // salto con gas sin gancho: el resto, en línea recta con el impulso
        this.enSuelo = false;
        this.velocidad.y = Math.max(this.velocidad.y, 5);
        this.impulsar(ARRIBA);
        this.bocanada(3);
      } else this.despegar(meta);
    }

    // En el aire (o lejos): ganchos alternos y bobina
    const ahora = this.tirando();
    if (ahora.length) {
      this.tSinAncla = 0;
      const a = ahora[ahora.length - 1];
      const haciaAncla = a.punto.clone().sub(this.posicion);
      const pasada = haciaAncla.dot(hacia) < 0 && dist > 6;
      if (haciaAncla.length() < 3.5 || pasada || a.t > 4) {
        // como en el anime: clava el otro gancho más adelante antes de soltar este
        const encadenado = dist > 8 && this.gas > 1 && this.elegirAncla(meta, titan);
        if (!encadenado) {
          this.soltarAncla();
          // impulso de salida hacia la meta
          if (this.gas > 1 && dist > 4) {
            const dir = hacia.clone().normalize();
            this.velocidad.addScaledVector(dir, 6).addScaledVector(ARRIBA, 3);
            this.gas -= 0.5;
            this.impulsar(dir);
            this.bocanada(3);
          }
        }
      }
    } else {
      this.tSinAncla += dt;
      if (this.tSinAncla > 0.25 && dist > 6 && !directo) this.elegirAncla(meta, titan);
      // sin dónde engancharse: impulso de gas hacia la meta, frenando al acercarse
      if (this.tirando().length === 0 && dist > 3 && this.gas > 0.5) {
        const dir = hacia.clone().normalize();
        const acercamiento = this.velocidad.dot(dir);
        const maxima = Math.min(VEL_MAX * 0.8, Math.sqrt(2 * (directo ? 14 : 9) * Math.max(0, dist - 2)) + 3);
        if (acercamiento > maxima) {
          this.velocidad.addScaledVector(dir, -Math.min(acercamiento - maxima, 18 * dt));
          this.impulsar(dir.clone().negate());
        } else {
          this.velocidad.addScaledVector(dir, (directo ? 26 : 16) * dt);
          // derecho: se anula lo que le desvía de la línea hacia la meta (no orbita)
          if (directo) {
            const lateral = this.velocidad.clone().addScaledVector(dir, -this.velocidad.dot(dir));
            this.velocidad.addScaledVector(lateral, -Math.min(1, dt * 4));
          }
          this.impulsar(dir);
        }
        if (this.velocidad.y < 2 && hacia.y > -2) this.velocidad.y += GRAVEDAD * 0.85 * dt;
        this.gas = Math.max(0, this.gas - 1.2 * dt);
      }
    }
    // cerca de la meta en el aire: frenar
    if (dist < 6) this.velocidad.multiplyScalar(1 - Math.min(0.9, dt * 3));
  }

  /**
   * A ras de suelo con casas en medio: siguiente punto de una ruta A* por la rejilla de
   * navegación (se recalcula cada 1,2 s o si la meta se mueve).
   */
  private pasoRuta(meta: THREE.Vector3, dt: number): THREE.Vector3 {
    const p = this.posicion;
    if (meta.y - CENTRO > 3 || p.y - CENTRO > 1.5) {
      this.ruta = null;
      return meta;
    }
    this.tRuta -= dt;
    if (this.tRuta <= 0 || this.metaRuta.distanceToSquared(meta) > 16) {
      this.tRuta = 1.2;
      this.metaRuta.copy(meta);
      const nav = this.ctx.nav;
      this.ruta = nav.lineaLibre(p, meta, RADIO_NAV) ? null : nav.ruta(p, meta, RADIO_NAV, 2500);
    }
    const ruta = this.ruta;
    while (ruta && ruta.length > 1 && Math.hypot(ruta[0].x - p.x, ruta[0].z - p.z) < 1.5) ruta.shift();
    return ruta?.[0] ?? meta;
  }

  /** Atascado 2 s sin acercarse: salto con gas a un lado y otro ancla. */
  private desatascar(meta: THREE.Vector3): void {
    this.ruta = null;
    this.tRuta = 0;
    if (this.gas < 1) return;
    this.soltarAncla();
    const a = Math.random() * Math.PI * 2;
    const hacia = meta.clone().sub(this.posicion).setY(0).normalize();
    this.velocidad.add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4)).addScaledVector(hacia, 3);
    this.velocidad.y = Math.max(this.velocidad.y, 9);
    this.enSuelo = false;
    this.gas -= 1;
    this.impulsar(ARRIBA);
    this.bocanada(4);
    this.elegirAncla(meta, null);
  }

  private despegar(meta: THREE.Vector3): void {
    if (this.gas < 1) return;
    this.enSuelo = false;
    this.velocidad.y = 6.5;
    this.gas -= 0.5;
    this.impulsar(ARRIBA);
    this.bocanada(3);
    this.elegirAncla(meta, null);
  }

  private impulsar(dir: THREE.Vector3): void {
    this.impulsando = true;
    this.dirImpulso.copy(dir);
  }

  /** Bocanada de gas blanco por detrás del equipo (pocas partículas compartidas). */
  private bocanada(n: number): void {
    if (!this.chorros || this.lod) return;
    const o = this.posicion.clone().addScaledVector(ARRIBA, -0.1);
    const v = this.dirImpulso.clone().multiplyScalar(-8).addScaledVector(this.velocidad, 0.6);
    for (let i = 0; i < n; i++) this.chorros.emitir(o, v, 0.3, 0.16, 1.8);
  }

  /**
   * Busca dónde clavar un gancho para avanzar hacia `meta` (o en la carne del titán
   * objetivo). Alterna lados; si ya tiraba de uno, ese se suelta un instante después.
   * Desde cero, a veces clava los dos abiertos en V.
   */
  private elegirAncla(meta: THREE.Vector3, titan: TitanAPI | null): boolean {
    this.tSinAncla = 0;
    if (this.gas < 0.5) return false;
    const origen = this.posicion;
    const lateral = new THREE.Vector3(meta.z - origen.z, 0, origen.x - meta.x).normalize();
    const candidatos: CandidatoAncla[] = [];
    const objetivoAlto = meta.clone().addScaledVector(ARRIBA, 6);
    for (let k = 0; k < 6; k++) {
      let destino: THREE.Vector3;
      if (titan && k < 2) destino = (k === 0 ? titan.cabeza() : titan.posicion.clone().setY(titan.altura * 0.6)).clone();
      else destino = meta.clone().addScaledVector(ARRIBA, 6 + Math.random() * 14).addScaledVector(lateral, (Math.random() - 0.5) * 18);
      const dir = destino.sub(origen).normalize();
      if (dir.y < -0.3) continue;
      const hit = this.ctx.fisica.lanzarRayo(origen, dir, 70);
      if (!hit || hit.distancia < 4 || !ETIQUETAS_ANCLA.has(hit.etiqueta)) continue;
      candidatos.push({ punto: hit.punto, objeto: hit.objeto, puntuacion: hit.punto.distanceTo(objetivoAlto) + (hit.punto.y < origen.y - 1 ? 25 : 0) });
    }
    if (candidatos.length === 0) return false;
    candidatos.sort((a, b) => a.puntuacion - b.puntuacion);
    const mejor = candidatos[0];
    const actual = this.tirando();
    const lado: 1 | -1 = actual.length ? (actual[actual.length - 1].lado === 1 ? -1 : 1) : this.ladoSiguiente;
    this.ladoSiguiente = lado === 1 ? -1 : 1;
    for (const g of actual) g.soltarEn = 0.3;
    this.clavar(lado, mejor);
    if (actual.length === 0) {
      const segundo = candidatos.find((c) => c !== mejor && c.puntuacion < mejor.puntuacion + 12 && c.punto.distanceTo(mejor.punto) > 4 && c.punto.distanceTo(mejor.punto) < 18);
      if (segundo) this.clavar(lado === 1 ? -1 : 1, segundo);
    }
    this.enSuelo = false;
    this.gas = Math.max(0, this.gas - 0.6);
    return true;
  }

  private clavar(lado: 1 | -1, c: CandidatoAncla): void {
    this.ganchos[lado === 1 ? 0 : 1] = {
      punto: c.punto.clone(),
      objeto: c.objeto,
      local: c.objeto ? c.objeto.worldToLocal(c.punto.clone()) : new THREE.Vector3(),
      longitud: this.posicion.distanceTo(c.punto),
      t: 0,
      lado,
      soltarEn: null,
    };
  }

  /** Ganchos que tiran ahora (sin el que se está soltando). */
  private tirando(): Ancla[] {
    const r: Ancla[] = [];
    for (const g of this.ganchos) if (g && g.soltarEn === null) r.push(g);
    return r;
  }

  /** Siguen la carne del titán en la que se clavaron; se sueltan al cambiar de lado o si la parte desaparece. */
  private actualizarGanchos(dt: number): void {
    for (let i = 0; i < 2; i++) {
      const g = this.ganchos[i];
      if (!g) continue;
      g.t += dt;
      if (g.objeto) {
        if (!this.objetoVivo(g.objeto)) {
          this.ganchos[i] = null;
          continue;
        }
        g.punto.copy(g.objeto.localToWorld(g.local.clone()));
      }
      if (g.soltarEn !== null) {
        g.soltarEn -= dt;
        if (g.soltarEn <= 0) this.ganchos[i] = null;
      }
    }
  }

  private objetoVivo(objeto: THREE.Object3D): boolean {
    let o: THREE.Object3D | null = objeto;
    while (o) {
      if (!o.visible) return false;
      if (o.parent === null) return o.type === 'Scene';
      o = o.parent;
    }
    return false;
  }

  private soltarAncla(): void {
    this.ganchos[0] = null;
    this.ganchos[1] = null;
    this.tSinAncla = 0;
  }

  /** El jugador es sólido para su escuadrón: a su altura, el soldado no lo atraviesa. */
  private apartarDeJugador(): void {
    const j = this.ctx.jugador.posicion;
    if (Math.abs(this.posicion.y - j.y) >= config.jugador.altura) return;
    const e = empujeFuera(this.posicion.x, this.posicion.z, RADIO_PERSONA, [{ x: j.x, z: j.z, radio: config.jugador.radio }]);
    const n = Math.hypot(e.dx, e.dz);
    if (n < 1e-6) return;
    this.posicion.x += e.dx;
    this.posicion.z += e.dz;
    const vn = (this.velocidad.x * e.dx + this.velocidad.z * e.dz) / n;
    if (vn < 0) {
      this.velocidad.x -= (vn * e.dx) / n;
      this.velocidad.z -= (vn * e.dz) / n;
    }
  }

  private integrar(dt: number): void {
    const fisica = this.ctx.fisica;
    const tiran = this.tirando();
    if (!this.enSuelo || tiran.length) this.velocidad.y -= GRAVEDAD * dt;
    else this.velocidad.y = Math.min(0, this.velocidad.y - GRAVEDAD * dt);
    for (const a of tiran) a.longitud = aplicarRecogida(this.posicion, this.velocidad, a.punto, a.longitud, VEL_RECOGIDA, 2);
    if (tiran.length) this.gas = Math.max(0, this.gas - 0.5 * dt);
    if (this.velocidad.length() > VEL_MAX) this.velocidad.setLength(VEL_MAX);
    const desp = this.velocidad.clone().multiplyScalar(dt);
    const largo = desp.length();
    if (largo > 1e-5) {
      // choque con paredes, tejados, árboles y titanes a lo largo del movimiento
      const dir = desp.clone().divideScalar(largo);
      const hit = fisica.lanzarRayo(this.posicion, dir, largo + 0.35);
      if (hit && hit.etiqueta !== 'suelo' && hit.etiqueta !== 'jugador') {
        this.posicion.copy(hit.punto).addScaledVector(dir, -0.36);
        const vn = this.velocidad.dot(hit.normal);
        if (vn < 0) this.velocidad.addScaledVector(hit.normal, -vn * 1.1);
      } else this.posicion.add(desp);
    }
    for (const a of tiran) aplicarRestriccion(this.posicion, this.velocidad, a.punto, a.longitud);
    this.apartarDeJugador();

    // Suelo bajo los pies (calle, tejado, rama)
    const suelo = fisica.lanzarRayo(this.posicion.clone().addScaledVector(ARRIBA, 0.3), new THREE.Vector3(0, -1, 0), CENTRO + 0.6);
    const ySuelo = suelo && suelo.etiqueta !== 'titan' && suelo.etiqueta !== 'nuca' ? suelo.punto.y : this.posicion.y < CENTRO ? 0 : null;
    if (ySuelo !== null && this.posicion.y - CENTRO <= ySuelo + 0.02 && this.velocidad.y <= 0.5) {
      if (!this.enSuelo) {
        this.impacto = -this.velocidad.y;
        this.tAterrizaje = 0;
      }
      this.posicion.y = ySuelo + CENTRO;
      this.velocidad.y = 0;
      this.enSuelo = true;
    } else if (!suelo || this.posicion.y - CENTRO > (ySuelo ?? 0) + 0.3) {
      this.enSuelo = false;
    }
    if (this.posicion.y < CENTRO) {
      this.posicion.y = CENTRO;
      this.velocidad.y = Math.max(0, this.velocidad.y);
      this.enSuelo = true;
    }
    const k = Math.min(1, dt * 12);
    this.acel.lerp(this.velocidad.clone().sub(this.velPrevia).divideScalar(Math.max(dt, 1e-3)), k);
  }

  /** Recoloca al soldado (reaparición, recuperar a uno que se quedó muy atrás). */
  teletransportar(centro: THREE.Vector3, velocidad?: THREE.Vector3): void {
    this.posicion.copy(centro);
    this.posPrevia.copy(centro);
    this.posRender.copy(centro);
    this.velocidad.copy(velocidad ?? new THREE.Vector3());
    this.soltarAncla();
    this.atasco.reiniciar();
    this.ruta = null;
    this.lod = false;
    // a caballo, el caballo viene con él
    if (this.montado && this.caballo) this.caballo.colocar(new THREE.Vector3(centro.x, 0, centro.z), this.caballo.rumbo);
    this.tEvalLod = 0;
  }

  /** Gas al máximo y vainas llenas (depósito). */
  reabastecer(): void {
    this.gas = this.gasMax;
    this.cuchillas.rellenar();
  }

  /** Pasa gas a otro (como Armin con Mikasa en Trost). Devuelve lo que ha dado. */
  darGas(cantidad: number): number {
    if (this.rol === 'intendente') return Math.max(0, cantidad); // gas infinito
    const reserva = 15;
    const dado = Math.max(0, Math.min(cantidad, this.gas - reserva));
    this.gas -= dado;
    return dado;
  }

  decir(frase: string): void {
    const t = this.ctx.reloj.t;
    // pocas frases: que el escuadrón no llene la pantalla de texto
    if (t - this.ultimaFrase < 15) return;
    this.ultimaFrase = t;
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${this.nombre}: ${frase}`, segundos: 1.8 });
  }

  /** Lo que hace ahora, si no es solo cumplir la orden (panel del escuadrón). */
  actividad(): string {
    if (this.agarradoPor) return '¡agarrado!';
    if (this.herido) return this.montado ? 'herido: a caballo' : 'herido';
    const m = this.mision;
    switch (m.tipo) {
      case 'recargar':
        return 'recargando';
      case 'huir':
        return this.montado ? 'huyendo a caballo' : 'huyendo';
      case 'curar':
        return m.humano && this.posicion.distanceTo(m.humano.posicion) > 8 ? 'va a curarte' : 'te cura';
      case 'darGas':
        return 'te lleva gas';
      case 'rescatar':
        return 'rescatando';
      case 'atacar':
        if (m.cebo) return 'de cebo';
        return this.orden.tipo === 'atacar' || this.orden.tipo === 'atacarTitan' ? '' : 'en combate';
      case 'mantener':
        if (this.orden.trabajo) return m.destino && this.posicion.distanceTo(m.destino) > 4 ? 'va a la obra' : 'montando el campamento';
        if (m.destino && this.posicion.distanceTo(m.destino) > 8) return this.orden.muralla ? 'sube a la muralla' : 'en camino';
        if (this.orden.muralla) return 'al cañón';
        return this.orden.tipo === 'irA' ? 'en posición' : '';
      default:
        return '';
    }
  }

  // ─────────────────────────── Dibujo ───────────────────────────

  dibujar(alfa: number, dt: number, t: number, camara: THREE.Vector3, frustum?: THREE.Frustum): void {
    if (!this.vivo) return;
    this.posRender.lerpVectors(this.posPrevia, this.posicion, alfa);
    const g = this.modelo.grupo;
    g.position.copy(this.posRender).y -= CENTRO;
    if (this.lod) {
      this.etiqueta.visible = false;
      for (const c of this.cables) c.visible = false;
      this.esfera.center.copy(this.posRender);
      if (frustum && !frustum.intersectsSphere(this.esfera)) return;
    }
    const v = this.velocidad;
    const vh = Math.hypot(v.x, v.z);
    let rumboObj = this.rumbo;
    if (vh > 1.5) rumboObj = Math.atan2(v.x, v.z);
    else if (this.objetivoCorte || this.mision.titan) {
      const o = this.objetivoCorte ?? this.mision.titan!.posicion;
      rumboObj = Math.atan2(o.x - this.posicion.x, o.z - this.posicion.z);
    }
    let d = rumboObj - this.rumbo;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rumbo += d * Math.min(1, dt * 8);
    g.rotation.y = this.rumbo;
    g.updateMatrixWorld(true);
    if (this.mision.titan?.vivo) this.mirar.copy(this.mision.titan.cabeza());
    else this.mirar.copy(this.posRender).add(new THREE.Vector3(Math.sin(this.rumbo), 0.1, Math.cos(this.rumbo)).multiplyScalar(20));
    const tiran = this.tirando();
    this.modelo.animar({
      dt,
      t,
      vel: v,
      acel: this.acel,
      enSuelo: this.enSuelo,
      anclas: tiran.map((a) => a.punto),
      recogiendo: tiran.length > 0,
      impulsando: this.impulsando,
      corte: this.tCorte >= 0 ? this.tCorte / 0.25 : null,
      giro: false,
      cambiandoCuchillas: this.cuchillas.cambiando > 0,
      agarrado: this.agarradoPor !== null,
      muerto: !this.vivo,
      montado: this.montado,
      aterrizaje: this.tAterrizaje,
      impactoAterrizaje: this.impacto,
      dirImpulso: this.dirImpulso,
      mirar: this.mirar,
      filo: this.cuchillas.rota ? 0 : 1,
      objetivoCorte: this.objetivoCorte,
    });
    if (this.lod) return;
    // Un cable por gancho, desde cada costado de la carcasa lumbar
    for (let i = 0; i < 2; i++) {
      const a = this.ganchos[i];
      const c = this.cables[i];
      c.visible = !!a;
      if (!a) continue;
      const pos = c.geometry.getAttribute('position') as THREE.BufferAttribute;
      const o = this.modelo.salidaCable(a.lado, new THREE.Vector3());
      pos.setXYZ(0, o.x, o.y, o.z);
      pos.setXYZ(1, a.punto.x, a.punto.y, a.punto.z);
      pos.needsUpdate = true;
    }
    // Nombre encima de la cabeza, visible de cerca (el seleccionado, de lejos y en dorado)
    const dCam = camara.distanceTo(this.posRender);
    this.etiqueta.visible = dCam < (this.seleccionado ? 400 : 90);
    this.etiqueta.position.copy(this.posRender).y += 1.25;
    const esc = THREE.MathUtils.clamp(dCam * 0.028, 0.5, this.seleccionado ? 6 : 2.2);
    this.etiqueta.scale.set(esc * 2, esc * 0.5, 1);
    (this.etiqueta.material as THREE.SpriteMaterial).color.set(this.agarradoPor ? '#ff8a7a' : this.seleccionado ? '#ffd36a' : '#ffffff');
  }

  eliminar(): void {
    this.modelo.liberar();
    this.etiqueta.removeFromParent();
    const sprite = this.etiqueta.material as THREE.SpriteMaterial;
    sprite.map?.dispose();
    sprite.dispose();
    for (const c of this.cables) {
      c.removeFromParent();
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
  }
}

function crearEtiqueta(texto: string): THREE.Sprite {
  const lienzo = document.createElement('canvas');
  lienzo.width = 256;
  lienzo.height = 64;
  const g = lienzo.getContext('2d');
  if (g) {
    g.font = '600 34px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(texto, 128, 32);
    g.fillStyle = '#ffffff';
    g.fillText(texto, 128, 32);
  }
  const tex = new THREE.CanvasTexture(lienzo);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.renderOrder = 5;
  return s;
}
