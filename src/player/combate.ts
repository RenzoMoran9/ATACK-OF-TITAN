import * as THREE from 'three';
import { Cuchillas } from '../combat/cuchillas';
import { asaltoFallido, cortaAhora, empiezaAsalto, empujeDeCorte } from '../combat/asalto';
import { calcularDanio, desgaste, umbralZona, zonaAlAlcance } from '../combat/corte';
import {
  ALCANCE_BENGALA,
  CEGUERA_BENGALA,
  DURACION_PASADA,
  ESPOLETA,
  NOMBRE_PARTE,
  VELOCIDAD_BENGALA,
  cegadosPorBengala,
  distanciaCara,
  siguienteParte,
  zonaPasadaBaja,
} from '../combat/tacticas';
import type { ContextoJuego } from '../core/contexto';
import type { Entrada } from '../core/entrada';
import type { EfectoCorte, Humano, PuntoDebil, TitanAPI, ZonaTitan } from '../core/tipos';

/**
 * Combate del jugador como en el anime:
 * - Clic izquierdo (o F): mantener prepara el tajo (brazos atrás), soltar lo lanza (0,25 s). Un toque es un tajo rápido.
 * - Al lanzarlo, un pequeño impulso te lleva hacia el punto débil activo más cercano delante de ti.
 * - El daño sale de la velocidad, del ángulo respecto a la columna y del filo (combat/corte.ts).
 * - Giro de Levi: clic izquierdo (o F) mientras recoges cable anclado a un titán a más de 25 m/s (tras 3 nucas).
 * - R: cambiar de par de cuchillas (0,6 s).
 * - Agarrado: haz clic (o F) muchas veces para cortarle los dedos antes de que te lleve a la boca.
 * - Pasada baja: volando por debajo de 0,2·H y a menos de 3 m de un tendón o una corva, el
 *   tajo sale corto (0,15 s, sin carga) directo a esa zona.
 * - B: bengala a 50 m/s hacia la mira; si estalla a 4 m o menos de la cara, ciega 3 s.
 * - X: fija una parte del titán más cercano (nuca → ojos → brazos → corvas → tendones → nada);
 *   el tajo y los ganchos van a ella aunque la mira esté en otro sitio.
 * - Ataque directo: con una parte fijada lejos, el tajo (clic izquierdo o F, un toque) engancha
 *   los ganchos a ese punto, los mantiene clavados sin tener el botón pulsado y corta solo al
 *   llegar a unos 3 m (src/combat/asalto.ts).
 */

export const MAX_BENGALAS = 4;

interface Proyectil {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  recorrido: number;
}

const ALCANCE_TAJO = 1.6;
const ALCANCE_GIRO = 2.4;
const DURACION_TAJO = 0.25;
const DURACION_GIRO = 0.8;
const MUERTES_PARA_GIRO = 3;

interface Tajo {
  /** Pasada baja: zona que corta directamente. */
  forzado?: { titan: TitanAPI; punto: PuntoDebil };
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
  /** Ataque directo: dispara los dos ganchos hacia la mira (ya apuntada a la parte fijada). */
  dispararGanchos(): void;
  /** Ataque directo: mantiene los ganchos clavados sin botón (o los deja de mantener). */
  sostenerGanchos(si: boolean): void;
  /** ¿Algún gancho está volando o clavado? */
  ganchosEnUso(): boolean;
}

const TEXTOS: Partial<Record<EfectoCorte, string>> = {
  muerte: '¡Nuca!',
  herida: 'Poco profundo',
  cojera: 'Tendón cortado',
  derribo: '¡Derribado!',
  ceguera: 'Lo has cegado',
  brazo: 'Brazo inutilizado',
  liberacion: '¡Liberado!',
  rebote: 'Muy lento: rebota',
  coraza: '¡Coraza!',
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
  /** Bengalas que quedan (se reponen en los depósitos). */
  bengalas = MAX_BENGALAS;
  private readonly proyectiles: Proyectil[] = [];
  /** Parte del titán fijada con X (null = nada). */
  parteFijada: { titan: TitanAPI; zona: ZonaTitan } | null = null;
  private readonly tmp = new THREE.Vector3();
  /** Ataque directo en curso: tiempo desde que empezó y si ya ha cortado. */
  private asalto: { t: number; cortado: boolean } | null = null;

  constructor(private readonly ctx: ContextoJuego, private readonly c: CuerpoCombatiente) {
    ctx.eventos.on('esquiva', (e) => {
      if (e.humano !== c.humano) return;
      this.sacudida = Math.max(this.sacudida, 0.6);
      this.mensaje('¡Esquivado!', 1.4);
    });
  }

  /** Deja de preparar o de cortar (al montar a caballo). */
  cancelar(): void {
    this.preparando = false;
    this.tajo = null;
    this.terminarAsalto();
  }

  /** ¿Hay un ataque directo en curso? */
  get asaltoActivo(): boolean {
    return this.asalto !== null;
  }

  rellenarBengalas(): void {
    this.bengalas = MAX_BENGALAS;
  }

  /** Punto débil fijado (si sigue activo y el titán vivo), o null. */
  get puntoFijado(): PuntoDebil | null {
    const f = this.parteFijada;
    if (!f) return null;
    if (!f.titan.vivo || f.titan.posicion.distanceTo(this.c.pos) > 120) {
      this.parteFijada = null;
      return null;
    }
    const p = f.titan.puntosDebiles.find((x) => x.zona === f.zona);
    return p && p.activo ? p : null;
  }

  /** ¿Una pasada baja disponible ahora mismo? (para el aviso del HUD) */
  get pasadaBajaLista(): boolean {
    return !this.tajo && !this.c.agarradoPor && this.cuchillas.puedeCortar && this.c.vel.length() > 8 && zonaPasadaBaja(this.c.pos, this.ctx.poblacion.titanesCerca(this.c.pos, 30)) !== null;
  }

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
    this.moverProyectiles(dt);
    if (entrada.consumir('KeyB')) this.dispararBengala(mirada);
    if (entrada.consumir('KeyX')) this.fijarParte(mirada);
    if (this.c.agarradoPor) {
      this.terminarAsalto();
      this.manejarAgarre(dt, entrada);
      return;
    }
    this.qte = null;

    this.cuchillas.actualizar(dt);
    if (entrada.consumir('KeyR')) {
      if (this.cuchillas.empezarCambio()) {
        this.preparando = false;
        this.tajo = null;
      } else if (this.cuchillas.repuesto <= 0) {
        this.mensaje('Sin repuesto', 1.2);
      }
    }

    // Tajo: clic izquierdo (o F). Con una parte fijada lejos, un toque es un ataque directo
    let pulsado = entrada.consumir('Mouse0') || entrada.consumir('KeyF');
    const mantenido = entrada.mantenida('Mouse0') || entrada.mantenida('KeyF');
    const fijado = this.puntoFijado;
    if (this.asalto) pulsado = false; // mientras ataca, otro toque no prepara un tajo
    else if (pulsado && !this.tajo && fijado && empiezaAsalto(fijado.centro.distanceTo(this.c.pos), this.cuchillas.puedeCortar)) {
      this.iniciarAsalto();
      pulsado = false;
    }
    if (this.asalto) this.seguirAsalto(dt, mirada);
    const pasada = pulsado && !this.tajo && this.cuchillas.puedeCortar ? zonaPasadaBaja(this.c.pos, this.ctx.poblacion.titanesCerca(this.c.pos, 30)) : null;
    if (pasada) {
      this.preparando = false;
      this.tajo = { t: 0, dur: DURACION_PASADA, giro: false, carga: 0, golpes: 1, golpeados: new Set([`${pasada.titan.id}:${pasada.punto.zona}`]), forzado: pasada };
      this.objetivoTajo = pasada.punto.centro.clone();
      this.golpear(pasada.titan, pasada.punto, this.tajo);
    } else if (pulsado && !this.tajo) {
      if (!this.cuchillas.puedeCortar) {
        if (this.cuchillas.cambiando <= 0) this.mensaje('Cuchillas rotas (R)', 1);
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
      if (!this.tajo.forzado) this.resolverGolpes();
      if (this.tajo.t >= this.tajo.dur) this.tajo = null;
    }
  }

  /** Ataque directo: los ganchos van al punto (la mira ya apunta allí) y se quedan clavados hasta el corte. */
  private iniciarAsalto(): void {
    this.preparando = false;
    this.asalto = { t: 0, cortado: false };
    this.c.dispararGanchos();
    this.c.sostenerGanchos(true);
    this.mensaje('¡Al punto!', 1);
  }

  /** Mientras dura el ataque: corta solo al llegar; si el punto cae, el gancho no engancha o se acaba el tiempo, se suelta todo. */
  private seguirAsalto(dt: number, mirada: THREE.Vector3): void {
    const a = this.asalto!;
    a.t += dt;
    if (a.cortado) {
      // el corte ya sale: al terminar, se sueltan los ganchos
      if (!this.tajo) this.terminarAsalto();
      return;
    }
    const p = this.puntoFijado;
    if (!p || this.c.agarradoPor) {
      this.terminarAsalto();
      return;
    }
    if (cortaAhora(p.centro.distanceTo(this.c.pos), this.cuchillas.puedeCortar)) {
      a.cortado = true;
      this.iniciarTajo(false, 1, mirada, true); // el impulso asistido lleva al punto
      return;
    }
    const enUso = this.c.ganchosEnUso();
    if (asaltoFallido(a.t, enUso)) {
      if (!enUso) this.mensaje('No llego al punto', 1.2);
      this.terminarAsalto();
    }
  }

  private terminarAsalto(): void {
    if (!this.asalto) return;
    this.asalto = null;
    this.c.sostenerGanchos(false);
  }

  /** `directo`: el corte del ataque directo, que sale a la velocidad mínima hacia el punto (asalto.ts). */
  private iniciarTajo(giro: boolean, carga: number, mirada: THREE.Vector3, directo = false): void {
    this.tajo = { t: 0, dur: giro ? DURACION_GIRO : DURACION_TAJO, giro, carga, golpes: 0, golpeados: new Set() };
    // Impulso asistido hacia el punto débil más prometedor que tengas delante (prioriza la nuca)
    const objetivo = this.mejorPuntoCercano(8, mirada);
    this.objetivoTajo = objetivo ? objetivo.centro.clone() : null;
    if (objetivo && !giro) {
      const dir = this.tmp.copy(objetivo.centro).sub(this.c.pos);
      const d = dir.length();
      if (d > 0.5 && this.c.consumirGas(1)) {
        dir.divideScalar(d);
        const empujeBase = Math.min(9, 3 + d);
        const empuje = directo ? empujeDeCorte(empujeBase, this.c.vel.dot(dir)) : empujeBase;
        this.c.vel.addScaledVector(dir, empuje);
      }
    }
  }

  private mejorPuntoCercano(radio: number, mirada: THREE.Vector3): PuntoDebil | null {
    // la parte fijada manda (con algo más de alcance)
    const fijado = this.puntoFijado;
    if (fijado && fijado.centro.distanceTo(this.c.pos) < radio * 1.5) return fijado;
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
    const rota = this.cuchillas.desgastar(desgaste(r) * (tajo.giro ? 1.5 : 1) + (res.efecto === 'coraza' ? 0.18 : 0));
    if (res.efecto === 'coraza') this.ctx.efectos.destello(zona.centro.clone(), '#dff4ff', 2.5, 0.3);
    else if (!r.rebota && res.efecto !== 'nada') this.ctx.efectos.sangre(zona.centro, this.c.vel.clone().normalize(), res.efecto === 'muerte' ? 30 : 16);
    if (res.efecto === 'muerte') {
      this.muertesNuca++;
      this.ctx.reloj.camaraLenta(0.25, 0.3);
      this.sacudida = 1;
      this.mensaje(tajo.giro ? '¡Giro mortal!' : '¡Nuca!', 1.4);
      if (this.muertesNuca === MUERTES_PARA_GIRO) this.mensaje('Giro de Levi aprendido', 2.5);
    } else {
      this.sacudida = Math.max(this.sacudida, 0.35);
      const texto = TEXTOS[res.efecto];
      if (texto) this.mensaje(texto, 1.4);
    }
    if (rota) this.mensaje('¡Cuchilla rota! (R)', 1.2);
  }

  /** B: bengala roja hacia la mira (desde la mano). */
  private dispararBengala(mirada: THREE.Vector3): void {
    if (this.c.agarradoPor) return;
    if (this.bengalas <= 0) {
      this.mensaje('Sin bengalas', 1);
      return;
    }
    this.bengalas--;
    const pos = this.c.pos.clone().add(new THREE.Vector3(0, 0.5, 0)).addScaledVector(mirada, 0.8);
    // si hay una parte fijada en la cabeza, apunta a la cara
    const f = this.parteFijada;
    const dir = f && f.titan.vivo && (f.zona === 'ojoIzq' || f.zona === 'ojoDer') ? f.titan.cabeza().sub(pos).normalize() : mirada.clone().normalize();
    this.proyectiles.push({ pos, vel: dir.multiplyScalar(VELOCIDAD_BENGALA), recorrido: 0 });
    this.ctx.efectos.destello(pos, '#ff6a3a', 1.5, 0.2);
  }

  private moverProyectiles(dt: number): void {
    for (let i = this.proyectiles.length - 1; i >= 0; i--) {
      const b = this.proyectiles[i];
      const paso = b.vel.length() * dt;
      const dir = this.tmp.copy(b.vel).normalize();
      const hit = this.ctx.fisica.lanzarRayo(b.pos, dir, paso + 0.2);
      b.vel.y -= 4 * dt; // las bengalas caen poco
      let estalla = false;
      if (hit && hit.etiqueta !== 'jugador') {
        b.pos.copy(hit.punto);
        estalla = true;
      } else {
        b.pos.addScaledVector(dir, paso);
        b.recorrido += paso;
        if (b.recorrido > ALCANCE_BENGALA) estalla = true;
        // espoleta de proximidad: pasa rozando una cara
        for (const t of this.ctx.poblacion.titanesCerca(b.pos, 40)) if (t.vivo && distanciaCara(b.pos, t) < ESPOLETA) estalla = true;
      }
      this.ctx.efectos.estela(b.pos, '#d12a1f');
      if (!estalla) continue;
      this.proyectiles.splice(i, 1);
      this.explotar(b.pos);
    }
  }

  private explotar(p: THREE.Vector3): void {
    this.ctx.efectos.destello(p.clone(), '#ff4a2a', 14, 0.9);
    this.ctx.efectos.vapor(p, 6, 1.2, 2);
    const cegados = cegadosPorBengala(p, this.ctx.poblacion.titanesCerca(p, 40));
    for (const t of cegados) t.deslumbrar?.(CEGUERA_BENGALA);
    if (cegados.length > 0) this.mensaje(cegados.length > 1 ? `¡${cegados.length} cegados!` : '¡Cegado!', 1);
  }

  /** X: nuca → ojos → brazos → corvas → tendones → nada, del titán más cercano delante de ti. */
  private fijarParte(mirada: THREE.Vector3): void {
    const actual = this.parteFijada;
    let titan = actual?.titan ?? null;
    if (!titan || !titan.vivo) {
      let mejor = -Infinity;
      titan = null;
      for (const t of this.ctx.poblacion.titanesCerca(this.c.pos, 90)) {
        if (!t.vivo) continue;
        const hacia = this.tmp.copy(t.posicion).setY(t.altura * 0.6).sub(this.c.pos);
        const d = hacia.length();
        const alineado = hacia.dot(mirada) / Math.max(d, 1e-3);
        const puntos = alineado * 2 - d / 45;
        if (alineado > 0.2 && puntos > mejor) {
          mejor = puntos;
          titan = t;
        }
      }
    }
    if (!titan) {
      this.parteFijada = null;
      return;
    }
    const zona = siguienteParte(titan, actual && actual.titan === titan ? actual.zona : null);
    this.parteFijada = zona ? { titan, zona } : null;
    if (zona) this.mensaje(NOMBRE_PARTE[zona] ?? zona, 0.8);
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
    }
    const q = this.qte;
    q.restante = Math.max(0, q.restante - dt);
    const corte = entrada.consumir('Mouse0') || entrada.consumir('KeyF');
    if (corte && q.restante > 0) {
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
