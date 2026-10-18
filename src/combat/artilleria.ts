import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { TitanAPI, ZonaTitan } from '../core/tipos';
import { Silueta } from '../missions/silueta';
import { umbralNuca, umbralZona } from './corte';

/**
 * Artillería compartida por los cañones del campamento y los de la muralla: balas en vuelo, lo que
 * hace cada impacto, la vida que los cañonazos le quitan a cada titán (con su barra sobre la
 * cabeza) y el remate cuando se queda sin ella.
 *
 * - Titán en pie: se apunta a las rodillas (cojea o cae); caído, a la nuca.
 * - Cada cañonazo quita vida: un titán normal cae con 2 (los pequeños) o 3 (los de 15 m); la
 *   Hembra aguanta unos 6, la Bestia unos 8, el Acorazado (coraza) unos 25 y el Colosal unos 50.
 *   La metralla alcanza a los que van al lado (la mitad).
 * - Si dejan de darle 10 s, el titán se va recuperando.
 */

const VEL_BALA = 150;
const REGEN_TITAN = 10;
const PIERNAS: ZonaTitan[] = ['corvaIzq', 'corvaDer', 'tendonIzq', 'tendonDer'];
const MATERIAL_BALA = new THREE.MeshLambertMaterial({ color: '#202020' });

interface Bala {
  malla: THREE.Mesh;
  desde: THREE.Vector3;
  titan: TitanAPI;
  zona: ZonaTitan;
  /** Punto de impacto (se actualiza mientras vuela: sigue al titán). */
  hasta: THREE.Vector3;
  duracion: number;
  t: number;
  /** Altura máxima de la parábola sobre la recta (m). */
  arco: number;
}

/** Vida que le van quitando los cañonazos a un titán (0–1) y su barra sobre la cabeza. */
interface VidaTitan {
  vida: number;
  tGolpe: number;
  fondo: THREE.Sprite;
  barra: THREE.Sprite;
}

/** Nuca del titán caído; rodillas del que está en pie. */
export function zonaDeTiro(t: TitanAPI): ZonaTitan {
  const tumbado = t.estado === 'derribado' || t.estado === 'cegado';
  if (tumbado && t.puntosDebiles.some((p) => p.zona === 'nuca' && p.activo)) return 'nuca';
  return PIERNAS.find((z) => t.puntosDebiles.some((p) => p.zona === z && p.activo)) ?? 'cuerpo';
}

export function puntoDeTiro(t: TitanAPI): THREE.Vector3 {
  const z = zonaDeTiro(t);
  return t.puntosDebiles.find((p) => p.zona === z)?.centro.clone() ?? t.posicion.clone().setY(t.altura * 0.4);
}

/** Vida que quita un cañonazo (fracción de 1). */
export function danioCanon(t: Pick<TitanAPI, 'altura' | 'especial'>): number {
  const base = 1 / (1.4 + t.altura / 12);
  const especial = { acorazado: 0.1, hembra: 0.4, colosal: 0.12, bestia: 0.35 } as const;
  return base * (t.especial ? especial[t.especial] : 1);
}

export class Artilleria {
  private readonly balas: Bala[] = [];
  private readonly geoBala = new THREE.SphereGeometry(0.3, 10, 8);
  private readonly vidas = new Map<TitanAPI, VidaTitan>();
  private t = 0;

  constructor(private readonly ctx: ContextoJuego) {}

  /** ¿Se puede tirar a este titán? (vivo y de verdad, no una silueta de entrenamiento). */
  static blanco(t: TitanAPI): boolean {
    return t.vivo && !(t instanceof Silueta);
  }

  /** Fogonazo y bala en camino desde `boca`; el daño se aplica al llegar. */
  disparar(boca: THREE.Vector3, t: TitanAPI): void {
    const zona = zonaDeTiro(t);
    const blanco = puntoDeTiro(t);
    const bala = new THREE.Mesh(this.geoBala, MATERIAL_BALA);
    bala.position.copy(boca);
    bala.castShadow = true;
    this.ctx.escena.add(bala);
    const d = boca.distanceTo(blanco);
    // desde lo alto de la muralla el tiro va casi recto hacia abajo: menos parábola
    const bajada = THREE.MathUtils.clamp((boca.y - blanco.y) / Math.max(1, d), 0, 1);
    const arco = Math.min(25, d * 0.06) * (1 - bajada);
    this.balas.push({ malla: bala, desde: boca.clone(), titan: t, zona, hasta: blanco, duracion: Math.max(0.2, d / VEL_BALA), t: 0, arco });
    this.ctx.efectos.vapor(boca, 22, 1.4, 5);
    this.ctx.eventos.emit({ tipo: 'canon', pos: boca.clone() });
  }

  actualizar(dt: number): void {
    this.t += dt;
    for (let i = this.balas.length - 1; i >= 0; i--) {
      const b = this.balas[i];
      b.t += dt / b.duracion;
      if (b.titan.vivo) {
        const p = b.titan.puntosDebiles.find((x) => x.zona === b.zona);
        if (p) b.hasta.copy(p.centro);
      }
      const u = Math.min(1, b.t);
      b.malla.position.lerpVectors(b.desde, b.hasta, u).y += 4 * u * (1 - u) * b.arco;
      if (Math.random() < 0.5) this.ctx.efectos.vapor(b.malla.position, 1, 0.35, 0.3);
      if (b.t >= 1) {
        b.malla.removeFromParent();
        this.balas.splice(i, 1);
        this.impacto(b);
      }
    }
    for (const v of this.vidas.values()) if (this.t - v.tGolpe > REGEN_TITAN) v.vida = Math.min(1, v.vida + 0.04 * dt);
    this.dibujarVidas();
  }

  /** La bala llega: rodillas del titán en pie (cojea o cae), nuca del caído, y siempre le quita vida. */
  private impacto(b: Bala): void {
    const t = b.titan;
    this.ctx.efectos.vapor(b.hasta, 12, 1 + t.altura * 0.06, 4);
    if (!t.vivo) return;
    const zona = t.puntosDebiles.some((p) => p.zona === b.zona && p.activo) ? b.zona : 'cuerpo';
    // los cambiantes encajan mucho mejor la bala: el Acorazado casi ni se inmuta
    const aguante = t.especial === 'acorazado' ? 0.08 : t.especial === 'hembra' ? 0.3 : t.especial ? 0.5 : 1;
    const danio = (zona === 'nuca' ? umbralNuca(t.altura) * 0.55 : zona === 'cuerpo' ? 1 : umbralZona(zona, t.altura) * 1.3) * aguante;
    const res = t.recibirCorte(zona, danio, this.ctx.jugador);
    if (res.efecto !== 'nada') this.ctx.efectos.sangre(b.hasta.clone(), b.hasta.clone().sub(b.desde).normalize(), 14);
    if (!t.vivo) return;
    this.quitarVida(t, danioCanon(t));
    for (const otro of this.ctx.poblacion.titanesCerca(b.hasta, 8)) {
      if (otro !== t && Artilleria.blanco(otro)) this.quitarVida(otro, danioCanon(otro) * 0.5);
    }
  }

  /** Quita vida de cañonazo (0–1); sin vida, lo remata. */
  quitarVida(t: TitanAPI, cuanto: number): void {
    const v = this.vidaDe(t);
    v.vida = Math.max(0, v.vida - cuanto);
    v.tGolpe = this.t;
    if (v.vida > 0) return;
    this.rematar(t);
    if (!t.vivo) {
      const nombre = t.especial === 'acorazado' ? '¡El Acorazado' : t.especial === 'hembra' ? '¡La Hembra' : t.especial === 'bestia' ? '¡La Bestia' : t.especial === 'colosal' ? '¡El Colosal' : `¡Titán de ${Math.round(t.altura)} m`;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${nombre} abatido a cañonazos!`, segundos: 3 });
    }
  }

  /** Vida de cañonazo que le queda (1 si nadie le ha dado). */
  vida(t: TitanAPI): number {
    return this.vidas.get(t)?.vida ?? 1;
  }

  /** Sin vida: nuca. Si la coraza la protege, primero una corva (cae y se le agrieta) y luego la nuca. */
  private rematar(t: TitanAPI): void {
    const U = umbralNuca(t.altura) * 3;
    if (t.recibirCorte('nuca', U, this.ctx.jugador).efecto === 'muerte' || !t.vivo) return;
    const corva = (['corvaIzq', 'corvaDer'] as ZonaTitan[]).find((z) => t.puntosDebiles.some((p) => p.zona === z && p.activo));
    if (corva) t.recibirCorte(corva, umbralZona(corva, t.altura) * 3, this.ctx.jugador);
    t.recibirCorte('nuca', U, this.ctx.jugador);
  }

  private vidaDe(t: TitanAPI): VidaTitan {
    let v = this.vidas.get(t);
    if (!v) {
      const fondo = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#111111', transparent: true, opacity: 0.75, depthWrite: false }));
      const barra = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#3fae49', depthWrite: false }));
      for (const sp of [fondo, barra]) {
        sp.center.set(0, 0.5);
        sp.renderOrder = 5;
        this.ctx.escena.add(sp);
      }
      barra.renderOrder = 6;
      v = { vida: 1, tGolpe: this.t, fondo, barra };
      this.vidas.set(t, v);
    }
    return v;
  }

  /** Barra de vida (cañonazos) sobre la cabeza de cada titán tocado; se recupera si dejan de darle. */
  private dibujarVidas(): void {
    const camara = this.ctx.camara;
    const derecha = new THREE.Vector3().setFromMatrixColumn(camara.matrixWorld, 0);
    for (const [t, v] of this.vidas) {
      if (!t.vivo || v.vida >= 1) {
        this.quitarBarra(v);
        this.vidas.delete(t);
        continue;
      }
      const ancho = 1.5 + t.altura * 0.25;
      const cabeza = t.cabeza().add(new THREE.Vector3(0, 1.2 + t.altura * 0.12, 0)).addScaledVector(derecha, -ancho / 2);
      v.fondo.position.copy(cabeza);
      v.barra.position.copy(cabeza);
      v.fondo.scale.set(ancho, 0.22 + t.altura * 0.02, 1);
      v.barra.scale.set(Math.max(0.001, ancho * v.vida), 0.22 + t.altura * 0.02, 1);
      (v.barra.material as THREE.SpriteMaterial).color.setHSL(0.33 * v.vida, 0.85, 0.45);
    }
  }

  private quitarBarra(v: VidaTitan): void {
    for (const sp of [v.fondo, v.barra]) {
      sp.removeFromParent();
      (sp.material as THREE.Material).dispose();
    }
  }

  limpiar(): void {
    for (const b of this.balas) b.malla.removeFromParent();
    this.balas.length = 0;
    for (const v of this.vidas.values()) this.quitarBarra(v);
    this.vidas.clear();
  }
}
