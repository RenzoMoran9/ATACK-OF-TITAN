import * as THREE from 'three';
import { Cuchillas } from '../combat/cuchillas';
import { calcularDanio, desgaste, umbralZona, zonaAlAlcance } from '../combat/corte';
import type { ContextoJuego } from '../core/contexto';
import type { Entrada } from '../core/entrada';
import type { EfectoCorte, Humano, PuntoDebil, TitanAPI } from '../core/tipos';

/**
 * Combate del jugador como en el anime:
 * - F: mantener prepara el tajo (brazos atrás), soltar lo lanza (0,25 s). Un toque es un tajo rápido.
 * - Al lanzarlo, un pequeño impulso te lleva hacia el punto débil activo más cercano delante de ti.
 * - El daño sale de la velocidad, del ángulo respecto a la columna y del filo (combat/corte.ts).
 * - Giro de Levi: F mientras recoges cable anclado a un titán a más de 25 m/s (tras 3 nucas).
 * - R: cambiar de par de cuchillas (0,6 s).
 * - Agarrado: pulsa F muchas veces para cortarle los dedos antes de que te lleve a la boca.
 */

const ALCANCE_TAJO = 1.6;
const ALCANCE_GIRO = 2.4;
const DURACION_TAJO = 0.25;
const DURACION_GIRO = 0.8;
const MUERTES_PARA_GIRO = 3;

interface Tajo {
  t: number;
  dur: number;
  giro: boolean;
  carga: number;
  golpes: number;
  golpeados: Set<string>;
}

export interface QTE {
  necesarias: number;
  hechas: number;
  restante: number;
  total: number;
}

export interface CuerpoCombatiente {
  readonly pos: THREE.Vector3;
  readonly posPrevia: THREE.Vector3;
  readonly vel: THREE.Vector3;
  /** El jugador visto como Humano (atacante en eventos y cortes). */
  readonly humano: Humano;
  agarradoPor: TitanAPI | null;
  brazoAgarre: 'brazoIzq' | 'brazoDer';
  /** ¿Algún gancho anclado en carne de titán y recogiendo? */
  ancladoATitanRecogiendo(): boolean;
  consumirGas(cantidad: number): boolean;
}

const TEXTOS: Partial<Record<EfectoCorte, string>> = {
  muerte: '¡Nuca!',
  herida: 'Corte poco profundo: necesitas más velocidad',
  cojera: 'Tendón cortado',
  derribo: '¡Derribado!',
  ceguera: 'Lo has cegado',
  brazo: 'Brazo inutilizado',
  liberacion: '¡Liberado!',
  rebote: 'Demasiado lento: la cuchilla rebota',
};

export class CombateJugador {
  readonly cuchillas = new Cuchillas();
  tajo: Tajo | null = null;
  /** Punto débil al que va el tajo en curso (para el sentido del barrido en la animación). */
  objetivoTajo: THREE.Vector3 | null = null;
  preparando = false;
  private tPreparacion = 0;
  muertesNuca = 0;
  qte: QTE | null = null;
  /** Para la cámara: sube con los golpes y decae sola. */
  sacudida = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ctx: ContextoJuego, private readonly c: CuerpoCombatiente) {}

  get giroDesbloqueado(): boolean {
    return this.muertesNuca >= MUERTES_PARA_GIRO;
  }

  /** Progreso del tajo en curso (0–1) o null. */
  get progresoTajo(): number | null {
    return this.tajo ? Math.min(1, this.tajo.t / this.tajo.dur) : null;
  }

  private mensaje(texto: string, segundos = 1.6): void {
    this.ctx.eventos.emit({ tipo: 'mensaje', texto, segundos });
  }

  paso(dt: number, entrada: Entrada, mirada: THREE.Vector3): void {
    this.sacudida = Math.max(0, this.sacudida - dt * 2.5);
    if (this.c.agarradoPor) {
      this.manejarAgarre(dt, entrada);
      return;
    }
    this.qte = null;

    if (this.cuchillas.actualizar(dt)) this.mensaje(`Cuchillas nuevas (${this.cuchillas.repuesto} de repuesto)`, 1.2);
    if (entrada.consumir('KeyR')) {
      if (this.cuchillas.empezarCambio()) {
        this.preparando = false;
        this.tajo = null;
      } else if (this.cuchillas.repuesto <= 0) {
        this.mensaje('Sin cuchillas de repuesto: ve al depósito de suministros');
      }
    }

    const pulsado = entrada.consumir('KeyF');
    const mantenido = entrada.mantenida('KeyF');
    if (pulsado && !this.tajo) {
      if (!this.cuchillas.puedeCortar) {
        this.mensaje(this.cuchillas.cambiando > 0 ? 'Cambiando de cuchillas…' : 'Cuchillas rotas: cámbialas con R', 1.2);
      } else if (this.giroDesbloqueado && this.c.ancladoATitanRecogiendo() && this.c.vel.length() > 25 && this.c.consumirGas(6)) {
        this.iniciarTajo(true, 1, mirada);
      } else {
        this.preparando = true;
        this.tPreparacion = 0;
      }
    }
    if (this.preparando) {
      this.tPreparacion += dt;
      if (!mantenido || this.tPreparacion > 1.2) {
        this.preparando = false;
        if (this.cuchillas.puedeCortar) this.iniciarTajo(false, Math.min(1, this.tPreparacion / 0.5), mirada);
      }
    }

    if (this.tajo) {
      this.tajo.t += dt;
      this.resolverGolpes();
      if (this.tajo.t >= this.tajo.dur) this.tajo = null;
    }
  }

  private iniciarTajo(giro: boolean, carga: number, mirada: THREE.Vector3): void {
    this.tajo = { t: 0, dur: giro ? DURACION_GIRO : DURACION_TAJO, giro, carga, golpes: 0, golpeados: new Set() };
    // Impulso asistido hacia el punto débil más prometedor que tengas delante (prioriza la nuca)
    const objetivo = this.mejorPuntoCercano(8, mirada);
    this.objetivoTajo = objetivo ? objetivo.centro.clone() : null;
    if (objetivo && !giro) {
      const dir = this.tmp.copy(objetivo.centro).sub(this.c.pos);
      const d = dir.length();
      if (d > 0.5 && this.c.consumirGas(1)) {
        dir.divideScalar(d);
        const empuje = Math.min(9, 3 + d);
        this.c.vel.addScaledVector(dir, empuje);
      }
    }
  }

  private mejorPuntoCercano(radio: number, mirada: THREE.Vector3): PuntoDebil | null {
    let mejor: PuntoDebil | null = null;
    let mejorP = -Infinity;
    for (const t of this.ctx.poblacion.titanesCerca(this.c.pos, radio + 20)) {
      for (const p of t.puntosDebiles) {
        if (!p.activo || p.zona === 'cuerpo') continue;
        const hacia = this.tmp.copy(p.centro).sub(this.c.pos);
        const d = hacia.length();
        if (d > radio) continue;
        const alineado = d > 0 ? hacia.dot(mirada) / d : 1;
        if (alineado < 0.2 && d > 3) continue;
        const puntos = (p.zona === 'nuca' ? 3 : 1) + alineado - d / radio;
        if (puntos > mejorP) {
          mejorP = puntos;
          mejor = p;
        }
      }
    }
    return mejor;
  }

  private resolverGolpes(): void {
    const tajo = this.tajo!;
    const alcance = tajo.giro ? ALCANCE_GIRO : ALCANCE_TAJO;
    const muestras = [this.c.pos, this.tmp.copy(this.c.pos).lerp(this.c.posPrevia, 0.5).clone(), this.c.posPrevia];
    for (const titan of this.ctx.poblacion.titanesCerca(this.c.pos, 40)) {
      for (const m of muestras) {
        if (tajo.giro && tajo.golpes >= 6) return;
        const zona = zonaAlAlcance(m, alcance, titan.puntosDebiles);
        if (!zona) continue;
        const clave = `${titan.id}:${zona.zona}`;
        if (tajo.golpeados.has(clave)) continue;
        tajo.golpeados.add(clave);
        tajo.golpes++;
        this.golpear(titan, zona, tajo);
        if (!tajo.giro) return; // un tajo normal corta una sola zona
      }
    }
  }

  private golpear(titan: TitanAPI, zona: PuntoDebil, tajo: Tajo): void {
    const bonificacion = tajo.giro ? 0.6 : 1 + 0.15 * tajo.carga;
    const r = calcularDanio({ velocidadRelativa: this.c.vel, eje: zona.eje, filo: this.cuchillas.filo, bonificacion });
    const res = titan.recibirCorte(zona.zona, r.danio, this.c.humano);
    this.ctx.eventos.emit({ tipo: 'corte', titan, resultado: res, por: this.c.humano });
    const rota = this.cuchillas.desgastar(desgaste(r) * (tajo.giro ? 1.5 : 1));
    if (!r.rebota && res.efecto !== 'nada') this.ctx.efectos.sangre(zona.centro, this.c.vel.clone().normalize(), res.efecto === 'muerte' ? 30 : 16);
    if (res.efecto === 'muerte') {
      this.muertesNuca++;
      this.ctx.reloj.camaraLenta(0.25, 0.3);
      this.sacudida = 1;
      this.mensaje(tajo.giro ? '¡Giro mortal!' : '¡Nuca!', 1.4);
      if (this.muertesNuca === MUERTES_PARA_GIRO) this.mensaje('Has aprendido el giro de Levi: F mientras recoges cable anclado a un titán a toda velocidad', 4);
    } else {
      this.sacudida = Math.max(this.sacudida, 0.35);
      const texto = TEXTOS[res.efecto];
      if (texto) this.mensaje(texto, 1.4);
    }
    if (rota) this.mensaje('¡Cuchilla rota! Cambia de par con R', 2);
  }

  /** Atrapado en la mano de un titán: cada F es un corte a los dedos. */
  private manejarAgarre(dt: number, entrada: Entrada): void {
    const titan = this.c.agarradoPor!;
    if (!this.qte) {
      const total = 2.5 + 0.06 * titan.altura;
      this.qte = { necesarias: 5 + Math.round(titan.altura / 3), hechas: 0, restante: total, total };
      this.preparando = false;
      this.tajo = null;
      this.sacudida = 1;
      this.ctx.efectos.bengala(this.c.pos.clone(), '#7b3fe4'); // bengala morada: emergencia
      this.mensaje('¡Te ha atrapado! Pulsa F muchas veces para cortarle los dedos', 2.5);
    }
    const q = this.qte;
    q.restante = Math.max(0, q.restante - dt);
    if (entrada.consumir('KeyF') && q.restante > 0) {
      q.hechas++;
      this.cuchillas.desgastar(0.02);
      this.sacudida = Math.max(this.sacudida, 0.4);
      this.ctx.efectos.sangre(this.c.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, 1, 0), 6);
      if (q.hechas >= q.necesarias) {
        const mano = this.c.brazoAgarre === 'brazoIzq' ? 'manoIzq' : 'manoDer';
        const res = titan.recibirCorte(mano, umbralZona(mano, titan.altura) * 1.5, this.c.humano);
        this.ctx.eventos.emit({ tipo: 'corte', titan, resultado: res, por: this.c.humano });
        this.qte = null;
      }
    }
  }
}
