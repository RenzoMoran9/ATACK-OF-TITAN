import type { OrdenEscuadron } from '../core/tipos';

/**
 * Lógica pura de las órdenes del escuadrón (sin escena ni física, para poder testearla):
 * teclas, nombres y frases de cada orden, color de la bengala de señales de la Legión,
 * palabras de brújula para los avisos, el titán que señala la mira, el ciclo de selección
 * con Tab, puestos de espera y puntos de patrulla, el detector de atascos y los criterios
 * de nivel de detalle, de reabastecimiento de los soldados y de obediencia (qué puede hacer un
 * soldado por su cuenta cuando ya le has dado una orden).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Teclas de órdenes (fila de números y teclado numérico). */
export const TECLAS_ORDEN: Readonly<Record<string, OrdenEscuadron>> = {
  Digit1: 'seguir',
  Digit2: 'atacar',
  Digit3: 'proteger',
  Digit4: 'retirada',
  Digit5: 'esperar',
  Digit6: 'irA',
  Digit7: 'atacarTitan',
  Digit8: 'explorar',
  Numpad1: 'seguir',
  Numpad2: 'atacar',
  Numpad3: 'proteger',
  Numpad4: 'retirada',
  Numpad5: 'esperar',
  Numpad6: 'irA',
  Numpad7: 'atacarTitan',
  Numpad8: 'explorar',
};

/** Cómo la grita el jugador. */
export const NOMBRE_ORDEN: Readonly<Record<OrdenEscuadron, string>> = {
  seguir: 'Seguidme',
  atacar: 'Atacad',
  proteger: 'Proteged a los civiles',
  retirada: 'Retirada',
  esperar: 'Esperad aquí',
  irA: 'Id allí',
  atacarTitan: 'Atacad a ese titán',
  explorar: 'Explorad',
};

/** Qué está haciendo un soldado con esa orden (panel del escuadrón). */
export const ESTADO_ORDEN: Readonly<Record<OrdenEscuadron, string>> = {
  seguir: 'Te sigue',
  atacar: 'Ataca',
  proteger: 'Protege civiles',
  retirada: 'En retirada',
  esperar: 'Espera',
  irA: 'Va allí',
  atacarTitan: 'Tras el titán',
  explorar: 'Explora',
};

/** Humo de señales: verde reagrupar, rojo atacar, amarillo esperar/ir, morado explorar, azul proteger, gris retirada. */
export const COLOR_BENGALA: Readonly<Record<OrdenEscuadron, string>> = {
  seguir: '#3fae49',
  atacar: '#d0281c',
  atacarTitan: '#d0281c',
  esperar: '#e8c42a',
  irA: '#e8c42a',
  explorar: '#8b3fc4',
  proteger: '#2f6fd8',
  retirada: '#3a3b3f',
};

/** Bengala de aviso: titán a la vista. */
export const COLOR_AVISO = '#d0281c';

/** Órdenes que llevan un punto en el mapa (con su banderín). */
export const ORDENES_CON_PUNTO: readonly OrdenEscuadron[] = ['esperar', 'irA', 'explorar'];

const FRASES: Readonly<Record<OrdenEscuadron, { todos: string[]; uno: string[] }>> = {
  seguir: { todos: ['¡Entendido, te seguimos!', '¡A la orden! ¡En formación!'], uno: ['¡Voy contigo!', '¡A la orden, te cubro la espalda!'] },
  atacar: { todos: ['¡A por ellos!', '¡Entendido, al ataque!'], uno: ['¡Al ataque!', '¡Entendido, a por ellos!'] },
  proteger: { todos: ['¡Entendido, cubrimos a los civiles!'], uno: ['¡A la orden, protejo a los civiles!'] },
  retirada: { todos: ['¡Retirada! ¡Replegaos!'], uno: ['¡Entendido, me repliego!'] },
  esperar: { todos: ['¡Entendido, esperamos aquí!', '¡A la orden! Mantenemos la posición'], uno: ['Espero aquí. ¡Ten cuidado!', '¡Entendido, mantengo la posición!'] },
  irA: { todos: ['¡A la orden, vamos hacia allí!', '¡Entendido, en marcha!'], uno: ['¡Entendido, voy hacia allí!', '¡A la orden!'] },
  atacarTitan: { todos: ['¡Ese es nuestro!', '¡Entendido, a por ese!'], uno: ['¡Voy a por él!', '¡A la orden, ese es mío!'] },
  explorar: { todos: ['¡Entendido, exploramos la zona!', '¡A la orden! Os aviso si veo algo'], uno: ['¡A la orden, echo un vistazo!', 'Exploro la zona y te aviso'] },
};

/** Frase de confirmación de un soldado (`todos`: habla por el escuadrón). */
export function fraseConfirmacion(o: OrdenEscuadron, todos: boolean, azar: () => number, alturaTitan?: number): string {
  if (o === 'atacarTitan' && alturaTitan !== undefined && azar() < 0.5) return `¡Entendido! ¡El de ${Math.round(alturaTitan)} m es nuestro!`;
  const lista = todos ? FRASES[o].todos : FRASES[o].uno;
  return lista[Math.min(lista.length - 1, Math.floor(azar() * lista.length))];
}

const RUMBOS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'] as const;

/** Rumbo de brújula de un desplazamiento horizontal (norte = −Z, este = +X). */
export function palabraBrujula(dx: number, dz: number): (typeof RUMBOS)[number] {
  const ang = Math.atan2(dx, -dz); // 0 = norte, π/2 = este
  const i = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  return RUMBOS[i];
}

/**
 * Aviso de un vigía: «Mikasa: ¡Titán de 12 m al sureste! ¡Anormal!». La dirección es
 * respecto al jugador (`dx`, `dz`: del jugador al titán).
 */
export function textoAviso(nombre: string, titan: { altura: number; anormal: boolean; cuadrupedo?: boolean }, dx: number, dz: number): string {
  const donde = Math.hypot(dx, dz) < 20 ? 'junto a ti' : `al ${palabraBrujula(dx, dz)}`;
  let texto = `${nombre}: ¡Titán de ${Math.round(titan.altura)} m ${donde}!`;
  if (titan.anormal || titan.cuadrupedo) texto += ' ¡Anormal!';
  if (titan.cuadrupedo) texto += ' ¡Corre a cuatro patas!';
  return texto;
}

/** Flecha (8 rumbos) para un ángulo respecto a la vista: 0 = delante, positivo = a la derecha. */
export function flechaAngulo(ang: number): string {
  const FLECHAS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return FLECHAS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}

/** Lo que hace falta de un titán para saber si la mira lo señala. */
export interface SiluetaMira {
  pies: Vec3;
  cabeza: Vec3;
  /** Medio ancho del cuerpo (m): amplía la tolerancia de cerca. */
  radio: number;
}

/**
 * Ángulo (rad) entre el rayo de la mira y el cuerpo de un titán (segmento pies–cabeza),
 * descontando su anchura. Infinity si queda detrás de la cámara o a más de `max` m.
 */
export function anguloMira(origen: Vec3, dir: Vec3, t: SiluetaMira, max: number): number {
  const ld = Math.hypot(dir.x, dir.y, dir.z) || 1;
  let mejor = Infinity;
  const N = 8;
  for (let k = 0; k <= N; k++) {
    const f = k / N;
    const px = t.pies.x + (t.cabeza.x - t.pies.x) * f - origen.x;
    const py = t.pies.y + (t.cabeza.y - t.pies.y) * f - origen.y;
    const pz = t.pies.z + (t.cabeza.z - t.pies.z) * f - origen.z;
    const d = Math.hypot(px, py, pz);
    if (d < 1e-3) return 0;
    if (d > max + t.radio) continue;
    const coseno = (px * dir.x + py * dir.y + pz * dir.z) / (d * ld);
    if (coseno <= 0) continue;
    const ang = Math.acos(Math.min(1, coseno)) - Math.atan(t.radio / d);
    mejor = Math.min(mejor, Math.max(0, ang));
  }
  return mejor;
}

/**
 * El titán que señala la mira: el más cercano al rayo dentro de la tolerancia angular
 * (por defecto 6°) y a menos de `max` m. null si no hay ninguno.
 */
export function titanApuntado<T>(origen: Vec3, dir: Vec3, candidatos: readonly T[], silueta: (t: T) => SiluetaMira, max = 400, toleranciaGrados = 6): T | null {
  const tol = (toleranciaGrados * Math.PI) / 180;
  let mejor: T | null = null;
  let mejorAng = Infinity;
  for (const c of candidatos) {
    const ang = anguloMira(origen, dir, silueta(c), max);
    if (ang <= tol && ang < mejorAng) {
      mejorAng = ang;
      mejor = c;
    }
  }
  return mejor;
}

/** Tab: Todos (null) → cada soldado vivo en orden → Todos. */
export function siguienteSeleccion(actual: number | null, vivos: readonly boolean[]): number | null {
  for (let i = actual === null ? 0 : actual + 1; i < vivos.length; i++) if (vivos[i]) return i;
  return null;
}

/** Desplazamiento del puesto `i` de `n` alrededor de un punto de espera (corro de ~4 m). */
export function puesto(i: number, n: number, radio = 3.5): { x: number; z: number } {
  if (n <= 1) return { x: 0, z: 0 };
  const a = (i / n) * Math.PI * 2;
  return { x: Math.cos(a) * radio, z: Math.sin(a) * radio };
}

/** Punto de patrulla al azar en el anillo [25 %, 100 %] del radio, repartido por área. */
export function puntoPatrulla(cx: number, cz: number, radio: number, azar: () => number): { x: number; z: number } {
  const a = azar() * Math.PI * 2;
  const r = radio * Math.sqrt(0.0625 + azar() * (1 - 0.0625));
  return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
}

/**
 * Actualización simplificada (LOD): lejos del jugador y sin titanes cerca. Con histéresis
 * para no alternar en el borde.
 */
export function enLod(actual: boolean, distJugador: number, distTitan: number): boolean {
  return actual ? distJugador > 320 && distTitan > 110 : distJugador > 350 && distTitan > 120;
}

/** Poco gas o sin cuchillas útiles: hay que ir al depósito. */
export function necesitaRecarga(gas: number, filo: number, repuesto: number): boolean {
  return gas < 25 || (repuesto === 0 && filo < 0.3);
}

/**
 * Detector de atascos: en cada ventana de `ventana` s comprueba si el soldado se ha
 * acercado a su meta al menos `progresoMin` m. Si la meta se mueve, empieza de nuevo
 * (seguir a alguien que corre no es estar atascado).
 */
/**
 * Obediencia: lo que mandas se cumple siempre. Sin una orden tuya, el soldado rescata a quien
 * tenga un titán en la mano; con una orden, solo rescata si le mandas atacar, o seguirte cuando
 * el que está agarrado eres tú.
 */
export function puedeRescatar(orden: OrdenEscuadron, dada: boolean, alJugador: boolean): boolean {
  if (!dada) return true;
  return orden === 'atacar' || (orden === 'seguir' && alJugador);
}

export class DetectorAtasco {
  private t = 0;
  private dInicio = 0;
  private dMin = 0;
  private readonly meta: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    readonly ventana = 2,
    readonly progresoMin = 1.5,
    /** Más cerca de esto ya ha llegado: no cuenta. */
    readonly distanciaMin = 5,
  ) {}

  /** Devuelve true al cerrar una ventana sin progreso. */
  muestra(dt: number, distancia: number, meta: Vec3): boolean {
    if (this.t === 0 || Math.hypot(meta.x - this.meta.x, meta.y - this.meta.y, meta.z - this.meta.z) > 3) {
      this.t = 1e-6;
      this.dInicio = distancia;
      this.dMin = distancia;
      this.meta.x = meta.x;
      this.meta.y = meta.y;
      this.meta.z = meta.z;
      return false;
    }
    this.t += dt;
    this.dMin = Math.min(this.dMin, distancia);
    if (this.t < this.ventana) return false;
    const atascado = distancia > this.distanciaMin && this.dInicio - this.dMin < this.progresoMin;
    this.t = 0;
    return atascado;
  }

  reiniciar(): void {
    this.t = 0;
  }
}
