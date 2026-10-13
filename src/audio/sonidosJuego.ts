import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { TitanAPI } from '../core/tipos';
import type { Jugador } from '../player/jugador';
import type { Sonido } from './sonido';

/**
 * Qué suena y cuándo, como en el anime: el «pssht» del gas y el silbido del cable al
 * disparar los ganchos, el golpe seco del ancla en la madera, la bobina al recoger, el viento
 * a toda velocidad, el «shing» de las hojas, el corte en la carne y el vapor de la nuca, el
 * estruendo de cada pisada de titán, su rugido al verte, el mordisco y el derrumbe.
 *
 * Mira el estado del jugador y de los titanes cada fotograma (flancos: un gancho que pasa a
 * «volando», un tajo que empieza…) y escucha los eventos del juego (cortes, muertes, agarres).
 */
export class SonidosJuego {
  private readonly ganchos: string[] = ['listo', 'listo'];
  private impulsaba = false;
  private tajoPrevio = false;
  private cambiaba = false;
  private enSueloPrevio = true;
  private vyPrevia = 0;
  private andado = 0;
  private saludPrevia = 100;
  private readonly titanes = new Map<number, { pisadas: number; estado: string; avisando: boolean; ultimoRugido: number }>();
  private t = 0;
  private readonly arriba = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly s: Sonido,
    private readonly ctx: ContextoJuego,
    private readonly jugador: Jugador,
  ) {
    const ev = ctx.eventos;
    ev.on('corte', (e) => {
      const pos = e.titan.posicion.clone().setY(e.titan.posicion.y + e.titan.altura * 0.75);
      const mio = e.por === jugador;
      const letal = e.resultado.efecto === 'muerte';
      this.s.tocar(letal ? 'nuca' : 'corte_carne', mio ? { volumen: letal ? 1.1 : 0.9 } : { pos, alcance: 18, volumen: 0.8 });
    });
    ev.on('titanMuerto', (e) => {
      const t = e.titan;
      const pos = t.posicion.clone();
      const grave = 1.25 - Math.min(0.5, t.altura / 30);
      this.s.tocar('titan_cae', { pos, alcance: 20 + t.altura * 3, volumen: 0.6 + t.altura / 25, tono: grave, retraso: 0.7 });
      this.s.tocar('vapor', { pos, alcance: 15 + t.altura * 2, volumen: 0.7, retraso: 1.6, variacion: 0.1 });
    });
    ev.on('humanoAgarrado', (e) => {
      if (e.humano === jugador) this.s.tocar('agarre', { volumen: 1 });
      else this.s.tocar('agarre', { pos: e.humano.posicion, alcance: 12, volumen: 0.8 });
      this.s.tocar('respiracion', { pos: this.cabeza(e.titan), alcance: 10 + e.titan.altura * 2, volumen: 0.9, tono: this.tonoTitan(e.titan), retraso: 0.4 });
    });
    ev.on('humanoLiberado', (e) => {
      this.s.tocar('golpe', e.humano === jugador ? { volumen: 0.7 } : { pos: e.humano.posicion, alcance: 10, volumen: 0.6 });
    });
    ev.on('humanoDevorado', (e) => {
      const mio = e.humano === jugador;
      const pos = this.cabeza(e.titan);
      this.s.tocar('mordisco', mio ? { volumen: 1.2 } : { pos, alcance: 14, volumen: 1 });
      this.s.tocar('masticar', mio ? { volumen: 0.9, retraso: 0.9 } : { pos, alcance: 10, volumen: 0.8, retraso: 0.9 });
    });
    ev.on('brecha', () => {
      this.s.tocar('brecha', { volumen: 1.3, tono: 0.85 });
      this.s.tocar('campana', { volumen: 0.6, retraso: 2.5 });
    });
    ev.on('recarga', (e) => {
      if (e.quien === jugador) this.s.tocar('recarga', { volumen: 0.8 });
    });
    ctx.efectos.alBengala = (pos) => this.s.tocar('bengala', { pos, alcance: 25, volumen: 0.8 });
  }

  private cabeza(t: TitanAPI): THREE.Vector3 {
    return t.posicion.clone().addScaledVector(this.arriba, t.altura * 0.9);
  }

  /** Los titanes grandes suenan más graves. */
  private tonoTitan(t: TitanAPI): number {
    return THREE.MathUtils.clamp(1.35 - t.altura / 22, 0.6, 1.25);
  }

  /**
   * `pausado`: menús y pausa (se callan los bucles). `bosque` (0–1) y `noche` eligen el ambiente.
   * `camara` y `derecha`: desde dónde se oye.
   */
  actualizar(dt: number, pausado: boolean, camara: THREE.Vector3, derecha: THREE.Vector3, bosque: number, noche: boolean): void {
    const s = this.s;
    s.oir(camara, derecha);
    if (!s.listo) return;
    if (pausado) {
      s.callarBucles();
      return;
    }
    this.t += dt;
    const j = this.jugador;
    const vivo = j.vivo;

    // ── Ambiente: bosque inquietante, llanura con viento o grillos de noche ──
    s.bucle('bosque', 0.55 * bosque);
    s.bucle('llanura', noche ? 0 : 0.28 * (1 - bosque));
    s.bucle('noche', noche ? 0.3 * (1 - bosque) : 0);

    // ── Equipo de maniobras ──
    j.odm.ganchos.forEach((g, i) => {
      const antes = this.ganchos[i];
      const ahora = g.estado;
      if (antes !== ahora) {
        const lado = i === 0 ? -0.5 : 0.5;
        if (ahora === 'volando') s.tocar('gancho_disparo', { volumen: 0.75, lado });
        else if (ahora === 'anclado') s.tocar('gancho_clavar', { pos: g.ancla, alcance: 14, volumen: 1 });
        else if (ahora === 'volviendo') s.tocar('gancho_volver', { volumen: 0.35, lado });
        this.ganchos[i] = ahora;
      }
    });
    const rapidez = j.vel.length();
    s.bucle('bobina', vivo && j.odm.recogiendo ? 0.45 : 0, 0.85 + Math.min(0.4, rapidez / 90));
    const impulsa = vivo && (j.odm.impulsando || j.frenando);
    if (impulsa && !this.impulsaba) s.tocar('gas_golpe', { volumen: 0.7 });
    this.impulsaba = impulsa;
    s.bucle('gas', impulsa ? 0.5 : 0);
    // viento: a partir de ~12 m/s, más fuerte cuanto más rápido
    const viento = vivo && !j.enSuelo ? THREE.MathUtils.clamp((rapidez - 12) / 28, 0, 1) : 0;
    s.bucle('viento', 0.75 * viento, 0.85 + 0.3 * viento);

    // ── Combate ──
    const tajo = !!j.combate?.tajo;
    if (tajo && !this.tajoPrevio) s.tocar('tajo', { volumen: j.combate?.tajo?.giro ? 1.1 : 0.8, tono: j.combate?.tajo?.giro ? 0.85 : 1 });
    this.tajoPrevio = tajo;
    const cambia = (j.combate?.cuchillas.cambiando ?? 0) > 0;
    if (cambia && !this.cambiaba) s.tocar('cuchillas', { volumen: 0.7 });
    this.cambiaba = cambia;

    // ── A pie: pasos, aterrizajes y golpes ──
    if (vivo && j.enSuelo && !this.enSueloPrevio && this.vyPrevia < -5) {
      s.tocar('aterrizaje', { volumen: THREE.MathUtils.clamp(-this.vyPrevia / 18, 0.3, 1.1) });
    }
    if (vivo && j.enSuelo && !j.agarradoPor) {
      const vh = Math.hypot(j.vel.x, j.vel.z);
      this.andado += vh * dt;
      const zancada = j.corriendo ? 1.9 : 1.35;
      if (vh > 1 && this.andado > zancada) {
        this.andado = 0;
        s.tocar('paso', { volumen: j.corriendo ? 0.35 : 0.22, variacion: 0.12 });
      }
    } else {
      this.andado = 0;
    }
    if (vivo && j.salud < this.saludPrevia - 8 && !j.agarradoPor) s.tocar('golpe', { volumen: 0.8 });
    this.saludPrevia = j.salud;
    this.enSueloPrevio = j.enSuelo;
    this.vyPrevia = j.vel.y;

    // ── Titanes: cada pisada retumba, rugen al verte y resoplan antes de atrapar ──
    const vistos = new Set<number>();
    for (const t of this.ctx.titanes.lista) {
      vistos.add(t.id);
      let r = this.titanes.get(t.id);
      if (!r) {
        r = { pisadas: t.pisadas ?? 0, estado: t.estado, avisando: false, ultimoRugido: -99 };
        this.titanes.set(t.id, r);
      }
      const d = s.distancia(t.posicion);
      const pisadas = t.pisadas ?? 0;
      if (pisadas !== r.pisadas && t.vivo && d < 60 + t.altura * 25) {
        const fuerza = THREE.MathUtils.clamp(t.altura / 13, 0.35, 1.3);
        s.tocar(t.cuadrupedo ? 'galope' : 'paso_titan', {
          pos: t.posicion,
          alcance: 6 + t.altura * 2.2,
          volumen: fuerza * (t.cuadrupedo ? 0.8 : 0.9),
          tono: this.tonoTitan(t),
          variacion: 0.08,
        });
      }
      r.pisadas = pisadas;
      // rugido al empezar a perseguir (no siempre, y no muy seguido)
      if (t.estado === 'perseguir' && r.estado !== 'perseguir' && r.estado !== 'agarrar' && this.t - r.ultimoRugido > 12 && Math.random() < 0.65) {
        r.ultimoRugido = this.t;
        s.tocar('rugido', { pos: this.cabeza(t), alcance: 15 + t.altura * 3, volumen: 0.6 + t.altura / 30, tono: this.tonoTitan(t), variacion: 0.1 });
      }
      r.estado = t.estado;
      const avisa = !!t.avisando;
      if (avisa && !r.avisando) s.tocar('respiracion', { pos: this.cabeza(t), alcance: 8 + t.altura * 2, volumen: 0.9, tono: this.tonoTitan(t) });
      r.avisando = avisa;
    }
    for (const id of this.titanes.keys()) if (!vistos.has(id)) this.titanes.delete(id);
  }
}
