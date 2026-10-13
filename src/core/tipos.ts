import type * as THREE from 'three';

/**
 * Contratos compartidos de la fase 2 (combate, titanes, escuadrón, civiles, misiones).
 * Cada sistema implementa su parte contra estas interfaces para no depender de los demás.
 */

// ───────────────────────── Humanos ─────────────────────────

export type TipoHumano = 'jugador' | 'soldado' | 'civil';

/** Cualquier humano que un titán puede ver, perseguir, agarrar y devorar. */
export interface Humano {
  readonly id: number;
  readonly tipo: TipoHumano;
  readonly nombre: string;
  /** Centro del cuerpo (≈0,85 m sobre los pies), en coordenadas de mundo. */
  readonly posicion: THREE.Vector3;
  readonly velocidad: THREE.Vector3;
  readonly vivo: boolean;
  /** Titán que lo tiene en la mano (null si está libre). */
  readonly agarradoPor: TitanAPI | null;
  /**
   * Lo llama el titán al cerrar la mano sobre él (`brazo` = la zona del brazo que lo sujeta;
   * cortarla lo libera). Mientras dure, el titán fija su posición con `fijarPosicion`.
   */
  alSerAgarrado(titan: TitanAPI, brazo: 'brazoIzq' | 'brazoDer'): void;
  /** El titán lo suelta (le cortaron el brazo/dedos, murió o lo lanzó). */
  alSerSoltado(): void;
  /** El titán se lo come: muere. */
  alSerDevorado(): void;
  /** Mientras está agarrado, el titán lo coloca en su mano cada paso. */
  fijarPosicion(p: THREE.Vector3): void;
}

// ───────────────────────── Titanes ─────────────────────────

export type ZonaTitan =
  | 'nuca'
  | 'tendonIzq' // tendón de Aquiles
  | 'tendonDer'
  | 'corvaIzq' // detrás de la rodilla
  | 'corvaDer'
  | 'ojoIzq'
  | 'ojoDer'
  | 'brazoIzq' // hombro/deltoides y codo
  | 'brazoDer'
  | 'manoIzq' // muñeca y dedos: solo activa mientras sujeta a alguien
  | 'manoDer'
  | 'mandibula' // solo activa con la boca abierta para devorar
  | 'cuerpo';

export interface PuntoDebil {
  readonly zona: ZonaTitan;
  /** Centro en mundo (se actualiza cada paso con la animación). */
  readonly centro: THREE.Vector3;
  /** Radio de la esfera de impacto (m). */
  readonly radio: number;
  /** Normal hacia fuera de la superficie. */
  readonly normal: THREE.Vector3;
  /**
   * Eje de la columna o del miembro en esa zona (unitario). El tajo rinde más cuanto más
   * perpendicular a este eje pasa la cuchilla. Por defecto, la vertical del titán.
   */
  readonly eje?: THREE.Vector3;
  /** false mientras la zona está cortada y regenerándose (o el titán ha muerto). */
  readonly activo: boolean;
}

export type EstadoTitan =
  | 'deambular'
  | 'alerta'
  | 'perseguir'
  | 'agarrar'
  | 'comer'
  | 'derribado'
  | 'cegado'
  | 'apagado'
  | 'muriendo'
  | 'muerto';

export type EfectoCorte =
  | 'muerte' // nuca por encima del umbral
  | 'herida' // nuca por debajo: vapor, tambaleo, se regenera
  | 'cojera' // un tendón
  | 'derribo' // dos tendones o una corva: cae de rodillas
  | 'ceguera' // ojo(s)
  | 'brazo' // brazo inutilizado/amputado
  | 'liberacion' // soltó a quien tenía en la mano o en la boca
  | 'superficial' // por debajo del umbral de la zona
  | 'rebote' // demasiado lento (< 8 m/s): no corta y mella
  | 'nada';

export interface ResultadoCorte {
  zona: ZonaTitan;
  efecto: EfectoCorte;
  /** Daño efectivo aplicado tras el ángulo y la dureza. */
  danio: number;
}

export interface TitanAPI {
  readonly id: number;
  /** Altura en metros (3–15 para puros). */
  readonly altura: number;
  readonly anormal: boolean;
  /** Corre a cuatro patas (anormal rápido de los bosques). */
  readonly cuadrupedo?: boolean;
  /** Pies del titán en mundo. */
  readonly posicion: THREE.Vector3;
  /** Hacia dónde mira (rad, 0 = +Z). */
  readonly rumbo: number;
  readonly estado: EstadoTitan;
  readonly vivo: boolean;
  readonly puntosDebiles: readonly PuntoDebil[];
  /** Humano al que persigue ahora mismo (o null). */
  readonly objetivo: Humano | null;
  /** Está a punto de agarrar (brazo atrás o agazapado para saltar): el HUD avisa. */
  readonly avisando?: boolean;
  /** Pisadas dadas hasta ahora (para el sonido de cada paso). */
  readonly pisadas?: number;
  /** Centro de la cabeza en mundo. */
  cabeza(): THREE.Vector3;
  /** Aplica un corte a una zona. El titán decide el efecto (regenera, cae, muere…). */
  recibirCorte(zona: ZonaTitan, danio: number, atacante: Humano | null): ResultadoCorte;
  /** Cebo: se fija en `h` durante `segundos` aunque haya otros humanos más cerca. */
  distraer(h: Humano, segundos: number): void;
}

// ───────────────────────── Eventos de juego ─────────────────────────

export type EventoJuego =
  | { tipo: 'corte'; titan: TitanAPI; resultado: ResultadoCorte; por: Humano | null }
  | { tipo: 'titanMuerto'; titan: TitanAPI; por: Humano | null }
  | { tipo: 'humanoAgarrado'; humano: Humano; titan: TitanAPI }
  | { tipo: 'humanoLiberado'; humano: Humano; titan: TitanAPI }
  | { tipo: 'humanoDevorado'; humano: Humano; titan: TitanAPI }
  | { tipo: 'civilSalvado'; humano: Humano }
  | { tipo: 'brecha' }
  | { tipo: 'mensaje'; texto: string; segundos?: number }
  | { tipo: 'recarga'; quien: Humano };

export type TipoEvento = EventoJuego['tipo'];

// ───────────────────────── Animación del soldado ─────────────────────────

/**
 * Lo que el controlador (jugador o soldado IA) le cuenta al modelo para posarlo.
 * El modelo decide la pose; quien lo controla no toca articulaciones.
 */
export interface EstadoAnimacion {
  dt: number;
  t: number;
  /** Velocidad en mundo (m/s). */
  vel: THREE.Vector3;
  /** Aceleración en mundo (m/s²), ya suavizada. */
  acel: THREE.Vector3;
  enSuelo: boolean;
  /** Puntos de anclaje de los cables que tiran ahora (0, 1 o 2). */
  anclas: THREE.Vector3[];
  recogiendo: boolean;
  impulsando: boolean;
  /** Progreso del corte en curso (0–1) o null si no está cortando. */
  corte: number | null;
  /** Corte giratorio estilo Levi en curso. */
  giro: boolean;
  /** Manteniendo el tajo (clic izq o F): brazos atrás, cuerpo enrollado, listo para el tajo. */
  preparandoCorte?: boolean;
  /** Cambiando de par de cuchillas. */
  cambiandoCuchillas?: boolean;
  /** Rodada al aterrizar (Shift o Espacio justo antes de tocar el suelo). */
  rodando?: boolean;
  agarrado: boolean;
  muerto: boolean;
  /** Recién aterrizado: segundos desde el aterrizaje (para flexionar/rodar), o null. */
  aterrizaje: number | null;
  /** Velocidad vertical al aterrizar (m/s, positiva hacia abajo), para graduar la flexión. */
  impactoAterrizaje: number;
  /** Dirección del empuje de gas (para elegir la variante de la pose de impulso). */
  dirImpulso?: THREE.Vector3;
  /** Punto que mira la cabeza (lo que apunta la cámara, un titán...). */
  mirar?: THREE.Vector3;
  /** Filo del par montado (0 = sin hojas). */
  filo?: number;
  /** Punto que se va a cortar: decide el sentido del barrido. */
  objetivoCorte?: THREE.Vector3 | null;
}

/** Aspecto de un soldado (jugador o aliado). Todo opcional: por defecto, el uniforme del jugador. */
export interface AspectoSoldado {
  pelo?: string;
  piel?: string;
  capa?: string;
  /** Pelo largo/recogido (Mikasa, Sasha) o corto. */
  peloLargo?: boolean;
  /** Escala de altura (1 = 1,7 m). */
  escala?: number;
  /** Color de bufanda (la roja de Mikasa). */
  bufanda?: string;
}

// ───────────────────────── Gestores (los implementa cada sistema) ─────────────────────────

export interface OpcionesTitan {
  /** Pies del titán. */
  posicion: THREE.Vector3;
  /** 3–15 m. */
  altura: number;
  anormal?: boolean;
  rumbo?: number;
  /** Semilla para variar proporciones y cara. */
  semilla?: number;
  /** Anormal que corre a cuatro patas, muy rápido (bosques). Implica `anormal`. */
  cuadrupedo?: boolean;
}

export interface GestorTitanesAPI {
  readonly lista: readonly TitanAPI[];
  generar(o: OpcionesTitan): TitanAPI;
  /** `n` titanes repartidos en un círculo; alturas elegidas de `alturas`. */
  generarGrupo(n: number, centro: THREE.Vector3, radio: number, alturas: number[], probAnormal?: number): TitanAPI[];
  /** Elimina todos los titanes (cambio de capítulo). */
  limpiar(): void;
  /** Con la IA congelada solo respiran (capturas, cinemáticas). */
  congelado: boolean;
  /** Paso fijo de física/IA. */
  actualizar(dt: number): void;
  /** Una vez por fotograma (animación interpolada, LOD...). */
  dibujar(dt: number, t: number): void;
}

export type RolSoldado = 'cebo' | 'apoyo' | 'rematador';

// ── Órdenes del escuadrón (teclas 1–8; Tab elige a quién) ──
export type OrdenEscuadron =
  | 'seguir'
  | 'atacar'
  | 'proteger'
  | 'retirada'
  | 'esperar' // mantener posición donde está el jugador y defenderla
  | 'irA' // volar al punto de la mira y mantener posición
  | 'atacarTitan' // el titán de la mira hasta que muera; luego, la orden anterior
  | 'explorar'; // patrullar alrededor de un punto y avisar de lo que vean

/** Lo que acompaña a una orden: el punto (esperar, id allí, explorar) o el titán señalado. */
export interface DestinoOrden {
  punto?: THREE.Vector3;
  titan?: TitanAPI;
}

/** Estado de un soldado para el panel del escuadrón. */
export interface InfoSoldado {
  orden: OrdenEscuadron;
  /** Lo que hace ahora si no es solo cumplir la orden ('recargando', 'rescatando'...), o ''. */
  actividad: string;
  /** Gas 0–100. */
  gas: number;
  /** Filo del par montado (0–1) y pares de repuesto. */
  filo: number;
  repuesto: number;
  /** Punto de la orden (lleva banderín en el mundo), si tiene. */
  punto?: THREE.Vector3;
  titan?: TitanAPI;
}

export interface MiembroEscuadron {
  nombre: string;
  rol: RolSoldado;
  aspecto?: AspectoSoldado;
}

export interface EscuadronAPI {
  readonly soldados: readonly Humano[];
  /** Orden de la selección (o la del primer soldado vivo si mandas a todos). */
  readonly orden: OrdenEscuadron;
  /** A quién van las órdenes: null = todo el escuadrón. */
  readonly seleccion: Humano | null;
  crear(miembros: MiembroEscuadron[], cerca: THREE.Vector3): void;
  /** Da la orden a la selección; los demás conservan la suya. */
  ordenar(o: OrdenEscuadron, destino?: DestinoOrden): void;
  /** Tab: Todos → cada soldado vivo → Todos. Devuelve la nueva selección. */
  cambiarSeleccion(): Humano | null;
  /** Orden, gas y cuchillas de un soldado (null si no es del escuadrón). */
  info(h: Humano): InfoSoldado | null;
  limpiar(): void;
  /** El compañero con gas más cercano viene a pasártelo (null si nadie puede). */
  pedirGas(): Humano | null;
  /** Quién podría darte gas ahora mismo (para el HUD). */
  donanteGas(): Humano | null;
  actualizar(dt: number): void;
  dibujar(dt: number, t: number): void;
}

export interface CivilesAPI {
  readonly lista: readonly Humano[];
  readonly salvados: number;
  readonly muertos: number;
  /** Vivos y aún sin evacuar. */
  readonly restantes: number;
  generar(n: number, centro: THREE.Vector3, radio: number): void;
  /** true: corren hacia la puerta de evacuación (y huyen de los titanes por el camino). */
  evacuar(si: boolean): void;
  limpiar(): void;
  actualizar(dt: number): void;
  dibujar(dt: number, t: number): void;
}

/** Lo que el resto del juego necesita del jugador. */
export interface JugadorAPI extends Humano {
  readonly salud: number;
  readonly saludMax: number;
  /** Pares de cuchillas de repuesto (sin contar el montado). */
  readonly paresRepuesto: number;
  /** Filo del par montado (0 = roto, 1 = nuevo). */
  readonly filo: number;
  readonly cambiandoCuchillas: boolean;
  /** Depósito de gas (las misiones pueden vaciarlo: «los cilindros silban vacíos»). */
  readonly gas: { nivel: number; readonly capacidad: number };
  teletransportar(pies: THREE.Vector3, rumbo?: number): void;
  /** Gas y cuchillas al máximo. */
  reabastecer(): void;
  /** Vuelve a la vida en `pies` con salud llena (tras ser devorado). */
  revivir(pies: THREE.Vector3, rumbo?: number): void;
  /** Recoge gas y pares de cuchillas del equipo de un soldado caído. */
  recogerEquipo(gas: number, pares: number): void;
}
