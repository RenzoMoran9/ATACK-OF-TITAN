import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { TitanAPI } from '../core/tipos';
import { cajaForma } from '../world/formas';

/**
 * Poblador de titanes del mundo abierto: mantiene vivo el territorio alrededor del jugador.
 *
 * - Cada ~1,5 s, si hay menos de TOPE_TOTAL titanes vivos, busca dónde generar uno (o un
 *   grupo) a 250–700 m del jugador, preferiblemente fuera de lo que enseña la cámara, en suelo
 *   libre de la rejilla de navegación y nunca dentro de la muralla.
 * - El sitio se acepta con probabilidad proporcional a la densidad de su zona: los bosques
 *   (peligro máximo) tienen 2,5 veces la densidad de la llanura y la franja junto a la
 *   muralla, un cuarto. Cada zona tiene además su propio tope.
 * - Qué titán sale depende de la zona: en los bosques ~40 % cuadrúpedos (anormales que corren
 *   a cuatro patas), ~30 % otros anormales y ~30 % normales; en la llanura, grupos errantes de
 *   3–15 m con algún anormal; junto a la muralla, pocos y pequeños.
 * - Retira los titanes a más de 1100 m que no persiguen a nadie (el gestor los saca de su lista
 *   al ver que han terminado).
 *
 * Las reglas son funciones puras (testeadas en poblador.test.ts); la clase solo las aplica.
 */

export type ZonaPoblador = 'muralla' | 'llanura' | 'bosque';

export interface ReglasZona {
  /** Densidad relativa: probabilidad de aceptar un sitio de esta zona (1 = bosque). */
  densidad: number;
  /** Máximo de titanes vivos en esta zona alrededor del jugador. */
  tope: number;
}

export const REGLAS: Record<ZonaPoblador, ReglasZona> = {
  bosque: { densidad: 1, tope: 9 },
  llanura: { densidad: 0.4, tope: 8 },
  muralla: { densidad: 0.1, tope: 2 },
};

export const TOPE_TOTAL = 16;
export const RADIO_MIN = 250;
/** En los bosques se ve poco (niebla bajo las copas): pueden salir mucho más cerca. */
export const RADIO_MIN_BOSQUE = 110;
export const RADIO_MAX = 700;
export const RADIO_RETIRADA = 1100;
/** Hasta aquí desde el centro de Trost cuenta como «junto a la muralla». */
export const RADIO_MURALLA = 520;

export interface TipoTitan {
  altura: number;
  anormal: boolean;
  cuadrupedo: boolean;
}

const ALTURAS_LLANURA = [3, 4, 5, 7, 7, 8, 10, 12, 15];
const ALTURAS_BOSQUE = [4, 5, 7, 8, 10, 12, 13, 15];
const ALTURAS_CUADRUPEDO = [5, 6, 7, 8, 10, 12];
const ALTURAS_MURALLA = [3, 4, 4, 5, 7];

const elegir = <T>(lista: readonly T[], azar: () => number): T => lista[Math.floor(azar() * lista.length)];

/** Zona de un punto: dentro de un bosque, cerca de la muralla o en la llanura. */
export function clasificarZona(x: number, z: number, bosques: readonly { contiene(x: number, z: number): boolean }[]): ZonaPoblador {
  for (const b of bosques) if (b.contiene(x, z)) return 'bosque';
  return Math.hypot(x, z) < RADIO_MURALLA ? 'muralla' : 'llanura';
}

/** Qué titán nace en cada zona. */
export function elegirTitan(zona: ZonaPoblador, azar: () => number): TipoTitan {
  if (zona === 'bosque') {
    const r = azar();
    if (r < 0.4) return { altura: elegir(ALTURAS_CUADRUPEDO, azar), anormal: true, cuadrupedo: true };
    if (r < 0.7) return { altura: elegir(ALTURAS_BOSQUE, azar), anormal: true, cuadrupedo: false };
    return { altura: elegir(ALTURAS_BOSQUE, azar), anormal: false, cuadrupedo: false };
  }
  if (zona === 'llanura') return { altura: elegir(ALTURAS_LLANURA, azar), anormal: azar() < 0.15, cuadrupedo: false };
  return { altura: elegir(ALTURAS_MURALLA, azar), anormal: azar() < 0.08, cuadrupedo: false };
}

/** Cuántos titanes forman el grupo que nace (la llanura tiene grupos errantes). */
export function tamanoGrupo(zona: ZonaPoblador, azar: () => number): number {
  if (zona === 'llanura') return 1 + Math.floor(azar() * 3);
  if (zona === 'bosque') return azar() < 0.35 ? 2 : 1;
  return 1;
}

/** ¿Se acepta un sitio de esta zona? (densidad relativa + tope por zona). */
export function aceptarSitio(zona: ZonaPoblador, vivosEnZona: number, azar: () => number): boolean {
  const r = REGLAS[zona];
  return vivosEnZona < r.tope && azar() < r.densidad;
}

/** Retirar: lejos del jugador y sin perseguir a nadie. */
export function debeRetirar(distancia: number, persiguiendo: boolean): boolean {
  return distancia > RADIO_RETIRADA && !persiguiendo;
}

/** El titán sigue en el mundo (vivo y sin retirar). */
const enJuego = (t: TitanAPI): boolean => t.vivo && !(t as TitanAPI & { terminado?: boolean }).terminado;

export class Poblador {
  activo = true;
  /** Titanes generados por el poblador (los de las misiones no se retiran). */
  readonly propios = new Set<TitanAPI>();
  /** Cuántos titanes ha generado y retirado (depuración). */
  generados = 0;
  retirados = 0;
  private espera = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly matriz = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly porZona: Record<ZonaPoblador, number> = { bosque: 0, llanura: 0, muralla: 0 };

  constructor(
    private readonly ctx: ContextoJuego,
    private readonly azar: () => number = Math.random,
  ) {}

  actualizar(dt: number): void {
    if (!this.activo) return;
    this.espera -= dt;
    if (this.espera > 0) return;
    // dentro de un bosque el poblador se da más prisa: es la zona más peligrosa
    const j = this.ctx.jugador.posicion;
    this.espera = this.ctx.mundo.bosques.some((b) => b.contiene(j.x, j.z)) ? 0.7 : 1.5;
    this.retirarLejanos();
    this.contar();
    const vivos = this.porZona.bosque + this.porZona.llanura + this.porZona.muralla;
    if (vivos >= TOPE_TOTAL) return;
    this.generarCerca(TOPE_TOTAL - vivos);
  }

  /** Quita todos los titanes del poblador (al terminar el capítulo). */
  limpiar(): void {
    for (const t of this.propios) retirar(t);
    this.propios.clear();
  }

  private retirarLejanos(): void {
    const p = this.ctx.jugador.posicion;
    for (const t of this.propios) {
      if (!enJuego(t)) {
        this.propios.delete(t);
        continue;
      }
      const d = Math.hypot(t.posicion.x - p.x, t.posicion.z - p.z);
      const persiguiendo = t.objetivo !== null || t.estado === 'perseguir' || t.estado === 'agarrar' || t.estado === 'comer';
      if (debeRetirar(d, persiguiendo)) {
        retirar(t);
        this.propios.delete(t);
        this.retirados++;
      }
    }
  }

  /** Titanes vivos por zona alrededor del jugador (todos, también los de las misiones). */
  private contar(): void {
    const c = this.porZona;
    c.bosque = c.llanura = c.muralla = 0;
    const p = this.ctx.jugador.posicion;
    for (const t of this.ctx.titanes.lista) {
      if (!enJuego(t)) continue;
      if (Math.hypot(t.posicion.x - p.x, t.posicion.z - p.z) > RADIO_RETIRADA) continue;
      c[clasificarZona(t.posicion.x, t.posicion.z, this.ctx.mundo.bosques)]++;
    }
  }

  private generarCerca(hueco: number): void {
    const ctx = this.ctx;
    const p = ctx.jugador.posicion;
    const camara = ctx.camara;
    this.matriz.multiplyMatrices(camara.projectionMatrix, camara.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matriz);
    const muralla = ctx.mundo.muralla.radioExterior + 25;
    // primero se buscan sitios fuera de cámara; si no hay, vale cualquiera. La mitad de los
    // intentos van directos a los bosques cercanos (si no, desde dentro de un bosque casi
    // todos los sitios del anillo caerían fuera de él)
    for (let intento = 0; intento < 24; intento++) {
      const enBosque = intento % 2 === 0 ? this.sitioEnBosque(p) : null;
      const a = this.azar() * Math.PI * 2;
      const r = RADIO_MIN + (RADIO_MAX - RADIO_MIN) * Math.sqrt(this.azar());
      const x = enBosque ? enBosque.x : p.x + Math.cos(a) * r;
      const z = enBosque ? enBosque.z : p.z + Math.sin(a) * r;
      if (Math.hypot(x, z) < muralla) continue;
      const lim = ctx.nav.limites;
      if (x < lim.x0 + 20 || x > lim.x1 - 20 || z < lim.z0 + 20 || z > lim.z1 - 20) continue;
      if (intento < 16 && this.frustum.containsPoint(this.tmp.set(x, 6, z))) continue;
      const zona = clasificarZona(x, z, ctx.mundo.bosques);
      if (!aceptarSitio(zona, this.porZona[zona], this.azar)) continue;
      const n = Math.min(hueco, tamanoGrupo(zona, this.azar), REGLAS[zona].tope - this.porZona[zona]);
      let hechos = 0;
      for (let k = 0; k < n; k++) {
        const tipo = elegirTitan(zona, this.azar);
        const radio = Math.max(0.6, 0.17 * tipo.altura);
        const ox = x + (k === 0 ? 0 : (this.azar() - 0.5) * 50);
        const oz = z + (k === 0 ? 0 : (this.azar() - 0.5) * 50);
        const libre = ctx.nav.libre(ox, oz, radio + 0.5) ? this.tmp.set(ox, 0, oz).clone() : ctx.nav.puntoLibreCercano(ox, oz, radio + 0.5, 8);
        if (!libre) continue;
        const t = ctx.titanes.generar({
          posicion: libre,
          altura: tipo.altura,
          anormal: tipo.anormal,
          cuadrupedo: tipo.cuadrupedo,
          rumbo: Math.atan2(p.x - libre.x, p.z - libre.z) + (this.azar() - 0.5) * 1.5,
        });
        this.propios.add(t);
        this.generados++;
        hechos++;
      }
      this.porZona[zona] += hechos;
      if (hechos > 0) return;
    }
  }

  /** Un punto dentro de un bosque cercano, a RADIO_MIN_BOSQUE–RADIO_MAX del jugador (o null). */
  private sitioEnBosque(p: THREE.Vector3): { x: number; z: number } | null {
    const cerca = this.ctx.mundo.bosques.filter((b) => {
      const c = cajaForma(b.forma);
      const dx = Math.max(c.x0 - p.x, 0, p.x - c.x1);
      const dz = Math.max(c.z0 - p.z, 0, p.z - c.z1);
      return Math.hypot(dx, dz) < RADIO_MAX;
    });
    if (cerca.length === 0) return null;
    const b = cerca[Math.floor(this.azar() * cerca.length)];
    const c = cajaForma(b.forma);
    for (let k = 0; k < 10; k++) {
      const x = c.x0 + (c.x1 - c.x0) * this.azar();
      const z = c.z0 + (c.z1 - c.z0) * this.azar();
      if (!b.contiene(x, z)) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d >= RADIO_MIN_BOSQUE && d <= RADIO_MAX) return { x, z };
    }
    return null;
  }
}

/**
 * Retira un titán concreto. GestorTitanesAPI no tiene «quitar uno», así que se le pide al
 * titán que se elimine (Titan.eliminar: quita modelo y colisiones y lo marca como terminado) y
 * el gestor lo saca de su lista y de la población en su siguiente paso.
 */
function retirar(t: TitanAPI): void {
  (t as TitanAPI & { eliminar?: () => void }).eliminar?.();
}
