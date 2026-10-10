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

export type ZonaTitan = 'nuca' | 'tendonIzq' | 'tendonDer' | 'ojos' | 'brazoIzq' | 'brazoDer' | 'cuerpo';

export interface PuntoDebil {
  readonly zona: ZonaTitan;
  /** Centro en mundo (se actualiza cada paso con la animación). */
  readonly centro: THREE.Vector3;
  /** Radio de la esfera de impacto (m). */
  readonly radio: number;
  /** Normal hacia fuera de la superficie (para el factor de ángulo del corte). */
  readonly normal: THREE.Vector3;
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

export type EfectoCorte = 'muerte' | 'derribo' | 'ceguera' | 'brazo' | 'superficial' | 'nada';

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
  /** Pies del titán en mundo. */
  readonly posicion: THREE.Vector3;
  /** Hacia dónde mira (rad, 0 = +Z). */
  readonly rumbo: number;
  readonly estado: EstadoTitan;
  readonly vivo: boolean;
  readonly puntosDebiles: readonly PuntoDebil[];
  /** Humano al que persigue ahora mismo (o null). */
  readonly objetivo: Humano | null;
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
  agarrado: boolean;
  muerto: boolean;
  /** Recién aterrizado: segundos desde el aterrizaje (para flexionar/rodar), o null. */
  aterrizaje: number | null;
  /** Velocidad vertical al aterrizar (m/s, positiva hacia abajo), para graduar la flexión. */
  impactoAterrizaje: number;
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
export type OrdenEscuadron = 'seguir' | 'atacar' | 'proteger' | 'retirada';

export interface MiembroEscuadron {
  nombre: string;
  rol: RolSoldado;
  aspecto?: AspectoSoldado;
}

export interface EscuadronAPI {
  readonly soldados: readonly Humano[];
  readonly orden: OrdenEscuadron;
  crear(miembros: MiembroEscuadron[], cerca: THREE.Vector3): void;
  ordenar(o: OrdenEscuadron): void;
  limpiar(): void;
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
  teletransportar(pies: THREE.Vector3, rumbo?: number): void;
  /** Gas y cuchillas al máximo. */
  reabastecer(): void;
  /** Vuelve a la vida en `pies` con salud llena (tras ser devorado). */
  revivir(pies: THREE.Vector3, rumbo?: number): void;
}
