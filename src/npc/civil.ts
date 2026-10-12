import * as THREE from 'three';
import type { Navegacion } from '../core/navegacion';
import { nuevoId } from '../core/poblacion';
import type { Rng } from '../core/rng';
import type { Humano, TitanAPI } from '../core/tipos';
import { CIVILES, esAnciano, esNino, probEnIntervalo, velocidadAndar, velocidadCorrer, type AspectoCivil } from './logicaCivil';
import type { PoseCivil } from './modeloCivil';

/**
 * Aldeano: vida normal (pasea por las calles), alarma (mira y señala al titán), huida
 * hacia la puerta de evacuación con pánico (parálisis y tropiezos), cola en la puerta,
 * salvado, agarrado (pataleo), caída al ser soltado y devorado.
 */

export type EstadoCivil =
  | 'quieto'
  | 'paseo'
  | 'alarma'
  | 'huida'
  | 'paralizado'
  | 'tropiezo'
  | 'cola'
  | 'saliendo'
  | 'agarrado'
  | 'cayendo'
  | 'salvado'
  | 'devorado';

/** Lo que el gestor ofrece a cada civil (navegación, campo de huida, cola...). */
export interface EntornoCivil {
  readonly t: number;
  readonly evacuando: boolean;
  readonly nav: Navegacion;
  /** Punto de la puerta de evacuación (cara interior). */
  readonly puerta: THREE.Vector3;
  /** Dirección horizontal hacia fuera a través de la puerta. */
  readonly salidaPuerta: THREE.Vector3;
  readonly gravedad: number;
  readonly rng: Rng;
  /** Siguiente punto hacia la puerta por el campo de huida (null si no hay campo aquí). */
  pasoHuida(c: Civil): THREE.Vector3 | null;
  /** Pide (en diferido) una ruta A*; el resultado llega a `c.ruta`. */
  pedirRuta(c: Civil, destino: THREE.Vector3): void;
  /** Un destino de paseo cercano por las calles. */
  destinoPaseo(c: Civil): THREE.Vector3 | null;
  turnoPuerta(): number;
  /** Empuje de separación con los vecinos (m/s). */
  separacion(c: Civil, out: THREE.Vector3): THREE.Vector3;
}

const NOMBRES = [
  'Marta', 'Hans', 'Greta', 'Klaus', 'Lena', 'Otto', 'Frieda', 'Karl', 'Ilse', 'Franz', 'Anna', 'Jakob', 'Elsa', 'Paul',
  'Rosa', 'Emil', 'Clara', 'Bruno', 'Hilde', 'Moritz', 'Lotte', 'Albert', 'Berta', 'Felix', 'Ida', 'Georg', 'Martha', 'Leo',
];

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

const angulo = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Civil implements Humano {
  readonly id = nuevoId();
  readonly tipo = 'civil' as const;
  readonly nombre: string;
  vivo = true;
  agarradoPor: TitanAPI | null = null;
  /** Centro del cuerpo (pies + media altura). */
  readonly posicion = new THREE.Vector3();
  readonly velocidad = new THREE.Vector3();

  readonly pies = new THREE.Vector3();
  readonly piesPrevios = new THREE.Vector3();
  estado: EstadoCivil = 'quieto';
  rumbo: number;
  /** Ruta A* en curso (puntos de paso, y = 0). */
  ruta: THREE.Vector3[] | null = null;
  rutaPedida = false;
  /** Cambia al cambiar de objetivo: invalida las rutas pedidas antes. */
  tokenRuta = 0;
  herido = false;
  /** Titán más cercano visto (lo actualiza el gestor ~4 veces por segundo). */
  titanCerca: TitanAPI | null = null;
  distTitan = Infinity;
  /** Brazo del titán que lo sujeta. */
  brazoAgarre: 'brazoIzq' | 'brazoDer' | null = null;

  private readonly vAndar: number;
  private readonly vCorrer: number;
  private temporizador: number;
  private turno = 0;
  private fase: number;
  private panicoUsado = false;
  private calmado = 0;
  private alturaCaida = 0;
  private readonly mirarA = new THREE.Vector3();
  private readonly paso1 = new THREE.Vector3();
  private tienePaso = false;
  private recalcPaso = 0;
  private bloqueado = 0;
  /** Para la animación de la caída (0 de pie … 1 en el suelo). */
  private suelo = 0;
  private tEstado = 0;
  /** La alarma viene de la campana (evacuación) y no de ver un titán. */
  private alarmaCampana = false;
  private readonly sep = new THREE.Vector3();

  constructor(
    readonly aspecto: AspectoCivil,
    pies: THREE.Vector3,
    rumbo: number,
    readonly slot: number,
    rng: Rng,
  ) {
    this.nombre = rng.elegir(NOMBRES);
    this.vAndar = velocidadAndar(aspecto.tipo, rng);
    this.vCorrer = velocidadCorrer(aspecto.tipo, rng);
    this.rumbo = rumbo;
    this.fase = rng.rango(0, Math.PI * 2);
    this.temporizador = rng.rango(0.5, 7);
    this.ponerPies(pies);
    this.piesPrevios.copy(this.pies);
  }

  get mitadAltura(): number {
    return this.aspecto.altura * 0.5;
  }

  /** ¿Sigue en el mundo (ni salvado ni devorado)? */
  get activo(): boolean {
    return this.estado !== 'salvado' && this.estado !== 'devorado';
  }

  get huyendo(): boolean {
    return this.estado === 'huida' || this.estado === 'paralizado' || this.estado === 'tropiezo' || this.estado === 'cola' || this.estado === 'saliendo' || this.estado === 'alarma';
  }

  private ponerPies(p: THREE.Vector3): void {
    this.pies.copy(p);
    this.posicion.copy(p).y += this.mitadAltura;
  }

  private cambiar(e: EstadoCivil): void {
    const antes = this.estado;
    this.estado = e;
    this.tEstado = 0;
    const deVida = antes === 'quieto' || antes === 'paseo';
    const aVida = e === 'quieto' || e === 'paseo';
    if (deVida !== aVida) {
      // las rutas de paseo no sirven para huir (ni al revés)
      this.ruta = null;
      this.rutaPedida = false;
      this.tokenRuta++;
    }
  }

  /** Resultado de una ruta pedida al gestor (null = no hay camino). */
  recibirRuta(ruta: THREE.Vector3[] | null, rng: Rng): void {
    this.rutaPedida = false;
    this.ruta = ruta && ruta.length > 0 ? ruta : null;
    if (!this.ruta && this.estado === 'quieto') this.temporizador = rng.rango(2, 5);
  }

  // ───────────── Humano ─────────────

  alSerAgarrado(titan: TitanAPI, brazo: 'brazoIzq' | 'brazoDer'): void {
    if (!this.activo) return;
    this.agarradoPor = titan;
    this.brazoAgarre = brazo;
    this.ruta = null;
    this.velocidad.set(0, 0, 0);
    this.cambiar('agarrado');
  }

  alSerSoltado(): void {
    if (this.estado !== 'agarrado') return;
    this.agarradoPor = null;
    this.brazoAgarre = null;
    this.alturaCaida = this.pies.y;
    this.cambiar('cayendo');
  }

  alSerDevorado(): void {
    this.agarradoPor = null;
    this.vivo = false;
    this.velocidad.set(0, 0, 0);
    this.cambiar('devorado');
  }

  fijarPosicion(p: THREE.Vector3): void {
    this.posicion.copy(p);
    this.pies.copy(p).y -= this.mitadAltura;
    this.piesPrevios.copy(this.pies);
    this.velocidad.set(0, 0, 0);
  }

  // ───────────── Comportamiento ─────────────

  /** La orden de evacuar (campana): reacción breve y a correr. */
  oirCampana(rng: Rng): void {
    if (this.estado === 'quieto' || this.estado === 'paseo') {
      this.cambiar('alarma');
      this.alarmaCampana = true;
      this.temporizador = rng.rango(CIVILES.reaccionEvacuar[0], CIVILES.reaccionEvacuar[1]);
    }
  }

  paso(dt: number, e: EntornoCivil): void {
    this.piesPrevios.copy(this.pies);
    this.tEstado += dt;
    switch (this.estado) {
      case 'salvado':
      case 'devorado':
        return;
      case 'agarrado':
        return; // el titán fija la posición
      case 'cayendo':
        this.caer(dt, e);
        return;
      default:
        break;
    }

    const titanVisto = this.titanCerca && this.titanCerca.vivo && this.distTitan < CIVILES.radioAlarma;
    const titanEncima = titanVisto && this.distTitan < CIVILES.radioHuida;
    if (titanVisto) {
      this.mirarA.copy(this.titanCerca!.cabeza());
      this.calmado = 0;
    } else {
      this.calmado += dt;
    }
    if (this.distTitan > CIVILES.radioParalisis * 1.8) this.panicoUsado = false;

    switch (this.estado) {
      case 'quieto':
      case 'paseo':
        if (titanEncima) {
          this.cambiar('huida');
        } else if (titanVisto) {
          this.cambiar('alarma');
          this.alarmaCampana = false;
          this.temporizador = e.rng.rango(CIVILES.alarma[0], CIVILES.alarma[1]);
        } else if (e.evacuando) {
          this.oirCampana(e.rng);
        } else {
          this.vidaNormal(dt, e);
        }
        break;
      case 'alarma':
        this.frenar(dt, 6);
        this.temporizador -= dt;
        if (titanVisto && !this.alarmaCampana) this.girarHacia(this.mirarA, dt, 6);
        if (titanEncima || this.temporizador <= 0) {
          if (titanVisto || e.evacuando) this.cambiar('huida');
          else this.cambiar('quieto');
        }
        break;
      case 'huida':
        this.huir(dt, e, titanVisto ?? false);
        break;
      case 'paralizado':
        this.frenar(dt, 10);
        this.girarHacia(this.mirarA, dt, 5);
        this.temporizador -= dt;
        if (this.temporizador <= 0) this.cambiar('huida');
        break;
      case 'tropiezo':
        this.frenar(dt, 8);
        this.temporizador -= dt;
        this.suelo = Math.min(1, this.suelo + dt / 0.3);
        if (this.temporizador <= 0) this.cambiar('huida');
        break;
      case 'cola':
        this.esperarCola(dt, e);
        break;
      case 'saliendo':
        this.cruzarPuerta(dt, e);
        break;
      default:
        break;
    }
    if (this.estado !== 'tropiezo') this.suelo = Math.max(0, this.suelo - dt / 0.45);
  }

  private vidaNormal(dt: number, e: EntornoCivil): void {
    if (this.estado === 'quieto') {
      this.frenar(dt, 5);
      this.temporizador -= dt;
      if (this.temporizador <= 0 && !this.rutaPedida && !this.ruta) {
        const d = e.destinoPaseo(this);
        if (d) {
          this.rutaPedida = true;
          e.pedirRuta(this, d);
        } else {
          this.temporizador = e.rng.rango(2, 6);
        }
      }
      if (this.ruta && this.ruta.length > 0) this.cambiar('paseo');
      return;
    }
    // paseo
    if (!this.ruta || this.ruta.length === 0) {
      this.ruta = null;
      this.temporizador = e.rng.rango(2.5, 10);
      this.cambiar('quieto');
      return;
    }
    const v = this.herido ? this.vAndar * 0.7 : this.vAndar;
    if (this.seguirRuta(dt, e, v, 0.9)) {
      this.ruta = null;
      this.temporizador = e.rng.rango(2.5, 10);
      this.cambiar('quieto');
    }
  }

  /** Sigue `ruta`; devuelve true al llegar al final. */
  private seguirRuta(dt: number, e: EntornoCivil, v: number, margen: number): boolean {
    const ruta = this.ruta!;
    while (ruta.length > 0 && Math.hypot(ruta[0].x - this.pies.x, ruta[0].z - this.pies.z) < margen) ruta.shift();
    if (ruta.length === 0) return true;
    this.moverHacia(dt, e, ruta[0], v);
    return false;
  }

  private huir(dt: number, e: EntornoCivil, titanVisto: boolean): void {
    // Pánico: parálisis con un titán muy cerca y tropiezos al correr
    if (titanVisto && this.distTitan < CIVILES.radioParalisis && !this.panicoUsado) {
      this.panicoUsado = true;
      if (e.rng.siguiente() < CIVILES.probParalisis) {
        this.cambiar('paralizado');
        this.temporizador = e.rng.rango(CIVILES.paralisis[0], CIVILES.paralisis[1]);
        return;
      }
    }
    if (this.velocidad.length() > 2 && e.rng.siguiente() < probEnIntervalo(CIVILES.tropiezoPorSegundo, dt)) {
      this.cambiar('tropiezo');
      this.temporizador = CIVILES.duracionTropiezo;
      return;
    }
    // Sin orden de evacuar y sin titanes a la vista durante un rato: se calman
    if (!e.evacuando && this.calmado > 10) {
      this.ruta = null;
      this.temporizador = e.rng.rango(1, 4);
      this.cambiar('quieto');
      return;
    }
    // ¿Ha llegado a la puerta?
    if (Math.hypot(this.pies.x - e.puerta.x, this.pies.z - e.puerta.z) < 7) {
      this.turno = e.turnoPuerta();
      this.cambiar('cola');
      return;
    }
    const v = this.herido ? Math.min(2.2, this.vCorrer * 0.55) : this.vCorrer;
    // Punto de paso: campo de huida (recalculado cada ~0,4 s) o ruta A* de reserva
    this.recalcPaso -= dt;
    if (this.recalcPaso <= 0 || !this.tienePaso || Math.hypot(this.paso1.x - this.pies.x, this.paso1.z - this.pies.z) < 1.2) {
      this.recalcPaso = 0.35 + e.rng.siguiente() * 0.2;
      const p = e.pasoHuida(this);
      if (p) {
        this.paso1.copy(p);
        this.tienePaso = true;
        this.ruta = null;
      } else {
        this.tienePaso = false;
      }
    }
    if (this.tienePaso) {
      this.moverHacia(dt, e, this.paso1, v, titanVisto);
    } else if (this.ruta && this.ruta.length > 0) {
      if (this.seguirRuta(dt, e, v, 1.2)) this.ruta = null;
    } else {
      if (!this.rutaPedida) {
        this.rutaPedida = true;
        e.pedirRuta(this, e.puerta);
      }
      // mientras tanto, alejarse del titán
      if (titanVisto && this.titanCerca) {
        tmp.copy(this.pies).sub(this.titanCerca.posicion).setY(0).normalize().multiplyScalar(10).add(this.pies);
        this.moverHacia(dt, e, tmp, v);
      } else {
        this.frenar(dt, 4);
      }
    }
  }

  private esperarCola(dt: number, e: EntornoCivil): void {
    // apretujados delante de la puerta hasta que les toca pasar
    if (e.t >= this.turno) {
      this.cambiar('saliendo');
      return;
    }
    const d = Math.hypot(this.pies.x - e.puerta.x, this.pies.z - e.puerta.z);
    if (d > 2) this.moverHacia(dt, e, e.puerta, Math.min(1.2, this.vAndar), false, true);
    else this.frenar(dt, 6);
  }

  private cruzarPuerta(dt: number, e: EntornoCivil): void {
    tmp2.copy(e.puerta).addScaledVector(e.salidaPuerta, 20);
    // por el túnel de la puerta: sin rejilla de navegación (la muralla está bloqueada en ella)
    tmp.copy(tmp2).sub(this.pies).setY(0);
    const d = tmp.length();
    if (d > 0.01) tmp.multiplyScalar(Math.min(this.vCorrer * 0.6, 2.6) / d);
    this.velocidad.lerp(tmp, Math.min(1, dt * 5));
    this.pies.addScaledVector(this.velocidad, dt);
    this.ponerPies(this.pies);
    this.girarHacia(tmp2, dt, 6);
    tmp.copy(this.pies).sub(e.puerta).setY(0);
    if (tmp.dot(e.salidaPuerta) > 4.5) this.cambiar('salvado');
  }

  private caer(dt: number, e: EntornoCivil): void {
    this.velocidad.y -= e.gravedad * dt;
    this.velocidad.x *= 1 - dt * 0.3;
    this.velocidad.z *= 1 - dt * 0.3;
    this.pies.addScaledVector(this.velocidad, dt);
    if (this.pies.y <= 0) {
      this.pies.y = 0;
      if (this.alturaCaida > CIVILES.caidaHerido) this.herido = true;
      this.velocidad.set(0, 0, 0);
      // si ha caído dentro de una casa, al hueco libre más cercano
      if (!e.nav.libre(this.pies.x, this.pies.z, CIVILES.radio)) {
        const p = e.nav.puntoLibreCercano(this.pies.x, this.pies.z, CIVILES.radio);
        if (p) this.pies.set(p.x, 0, p.z);
      }
      this.cambiar('tropiezo');
      this.suelo = 1;
      this.temporizador = this.herido ? 2.5 : 1.2;
      this.panicoUsado = true;
    }
    this.ponerPies(this.pies);
  }

  private frenar(dt: number, k: number): void {
    const f = Math.max(0, 1 - dt * k);
    this.velocidad.x *= f;
    this.velocidad.z *= f;
    this.velocidad.y = 0;
    this.moverLibre(dt, null);
  }

  /** Corre/anda hacia `meta` con separación, evitando titanes cercanos y obstáculos. */
  private moverHacia(dt: number, e: EntornoCivil, meta: THREE.Vector3, v: number, evitarTitan = false, suave = false): void {
    tmp.set(meta.x - this.pies.x, 0, meta.z - this.pies.z);
    const d = tmp.length();
    if (d > 1e-3) tmp.multiplyScalar(v / d);
    if (evitarTitan && this.titanCerca && this.distTitan < 30) {
      // empuje lateral para no pasar por debajo del titán
      tmp2.copy(this.pies).sub(this.titanCerca.posicion).setY(0);
      const dt2 = Math.max(1, tmp2.length());
      tmp.addScaledVector(tmp2.normalize(), v * 0.8 * (1 - dt2 / 30));
      if (tmp.length() > v) tmp.setLength(v);
    }
    e.separacion(this, this.sep);
    tmp.add(this.sep);
    const acel = suave ? 3 : esNino(this.aspecto.tipo) || esAnciano(this.aspecto.tipo) ? 5 : 7;
    tmp2.copy(tmp).sub(this.velocidad).setY(0);
    const dv = tmp2.length();
    if (dv > acel * dt) tmp2.multiplyScalar((acel * dt) / dv);
    this.velocidad.add(tmp2);
    this.velocidad.y = 0;
    this.moverLibre(dt, e.nav);
    if (this.velocidad.lengthSq() > 0.04) this.girarHacia(tmp.set(this.pies.x + this.velocidad.x, 0, this.pies.z + this.velocidad.z), dt, 7);
  }

  /** Integra la velocidad deslizando contra las casas (rejilla de navegación). */
  private moverLibre(dt: number, nav: Navegacion | null): void {
    const nx = this.pies.x + this.velocidad.x * dt;
    const nz = this.pies.z + this.velocidad.z * dt;
    const r = CIVILES.radio;
    if (!nav || nav.libre(nx, nz, r) || !nav.libre(this.pies.x, this.pies.z, r)) {
      this.pies.x = nx;
      this.pies.z = nz;
      this.bloqueado = 0;
    } else if (nav.libre(nx, this.pies.z, r)) {
      this.pies.x = nx;
      this.velocidad.z *= 0.5;
    } else if (nav.libre(this.pies.x, nz, r)) {
      this.pies.z = nz;
      this.velocidad.x *= 0.5;
    } else {
      this.velocidad.multiplyScalar(0.3);
      this.bloqueado += dt;
      if (this.bloqueado > 1.5) {
        this.ruta = null;
        this.tienePaso = false;
        this.bloqueado = 0;
      }
    }
    this.pies.y = 0;
    this.ponerPies(this.pies);
  }

  private girarHacia(p: THREE.Vector3, dt: number, rapidez: number): void {
    const objetivo = Math.atan2(p.x - this.pies.x, p.z - this.pies.z);
    const d = angulo(objetivo - this.rumbo);
    this.rumbo += THREE.MathUtils.clamp(d, -rapidez * dt, rapidez * dt);
  }

  // ───────────── Pose ─────────────

  /** Pose procedural a partir del estado (una vez por fotograma). */
  calcularPose(dt: number, t: number, alfa: number, out: PoseCivil): void {
    out.pies.lerpVectors(this.piesPrevios, this.pies, alfa);
    out.rumbo = this.rumbo;
    out.bote = 0;
    out.inclinacion = 0;
    out.caida = 0;
    out.cabezaGiro = 0;
    out.cabezaAlzada = 0;
    out.abrirIzq = 0.06;
    out.abrirDer = 0.06;
    const esc = this.aspecto.altura / 1.7;
    const vh = Math.hypot(this.velocidad.x, this.velocidad.z);
    const corriendo = THREE.MathUtils.clamp((vh - 1.5) / 2.2, 0, 1);
    this.fase += (dt * vh * THREE.MathUtils.lerp(4.4, 2.1, corriendo)) / esc;
    const s = Math.sin(this.fase);
    const c = Math.cos(this.fase);
    const ampP = Math.min(1, vh / 1.3) * THREE.MathUtils.lerp(0.42, 0.95, corriendo);
    const ampB = Math.min(1, vh / 1.3) * THREE.MathUtils.lerp(0.32, 1.0, corriendo);
    const cojera = this.herido ? 0.45 : 1;
    out.piernaIzq = s * ampP * cojera;
    out.piernaDer = -s * ampP;
    // al correr los brazos van algo doblados hacia delante
    out.brazoIzq = -s * ampB + corriendo * 0.35;
    out.brazoDer = s * ampB + corriendo * 0.35;
    out.bote = Math.abs(c) * THREE.MathUtils.lerp(0.02, 0.07, corriendo) * esc * Math.min(1, vh);
    out.inclinacion = THREE.MathUtils.lerp(0.03, 0.3, corriendo) * Math.min(1, vh / 1.2);

    const elevacion = () => {
      const dx = Math.hypot(this.mirarA.x - this.pies.x, this.mirarA.z - this.pies.z);
      return THREE.MathUtils.clamp(Math.atan2(this.mirarA.y - this.aspecto.altura, Math.max(1, dx)), 0, 1.1);
    };

    switch (this.estado) {
      case 'quieto':
      case 'cola': {
        const respira = Math.sin(t * 1.7 + this.id) * 0.02;
        out.brazoIzq = respira;
        out.brazoDer = -respira;
        out.cabezaGiro = Math.sin(t * 0.45 + this.id * 1.3) * 0.55;
        // de vez en cuando gesticula al hablar
        if (this.estado === 'quieto' && Math.sin(t * 0.7 + this.id * 2.1) > 0.75) out.brazoDer = 0.7 + Math.sin(t * 6 + this.id) * 0.15;
        if (this.estado === 'cola') out.cabezaAlzada = 0.15;
        break;
      }
      case 'alarma':
        if (this.alarmaCampana) {
          out.cabezaGiro = Math.sin(t * 2.2 + this.id) * 0.7;
          out.cabezaAlzada = 0.25;
          out.brazoIzq = 0.25;
          out.brazoDer = 0.25;
        } else {
          // mira y señala al titán
          const el = elevacion();
          out.cabezaAlzada = el;
          out.brazoDer = Math.PI / 2 + el;
          out.abrirDer = 0.12;
          out.brazoIzq = 0.9 + Math.sin(t * 9 + this.id) * 0.08;
          out.abrirIzq = -0.25;
          out.piernaIzq = 0.12;
          out.piernaDer = -0.18;
        }
        break;
      case 'paralizado': {
        const temblor = Math.sin(t * 31 + this.id) * 0.04;
        out.cabezaAlzada = elevacion() * 0.8;
        out.brazoIzq = 1.35 + temblor;
        out.brazoDer = 1.3 - temblor;
        out.abrirIzq = -0.3;
        out.abrirDer = -0.3;
        out.inclinacion = -0.12;
        out.rumbo = this.rumbo + temblor * 0.5;
        out.piernaIzq = 0.1;
        out.piernaDer = -0.1;
        break;
      }
      case 'agarrado': {
        // pataleo
        out.piernaIzq = Math.sin(t * 13 + this.id) * 0.75;
        out.piernaDer = Math.sin(t * 13 + this.id + Math.PI) * 0.75;
        out.brazoIzq = 2.4 + Math.sin(t * 11 + this.id) * 0.6;
        out.brazoDer = 2.4 + Math.sin(t * 11 + this.id + 2) * 0.6;
        out.abrirIzq = 0.5;
        out.abrirDer = 0.5;
        out.cabezaAlzada = Math.sin(t * 5 + this.id) * 0.3;
        out.bote = 0;
        out.inclinacion = 0;
        out.pies.copy(this.pies);
        break;
      }
      case 'cayendo':
        out.brazoIzq = 2.8;
        out.brazoDer = 2.7;
        out.abrirIzq = 0.6;
        out.abrirDer = 0.6;
        out.piernaIzq = 0.35;
        out.piernaDer = -0.3;
        out.inclinacion = 0;
        out.bote = 0;
        break;
      default:
        break;
    }
    if (this.suelo > 0) {
      // tropiezo: de bruces con los brazos por delante
      const k = this.suelo * this.suelo * (3 - 2 * this.suelo);
      out.caida = k * 1.45;
      out.brazoIzq = THREE.MathUtils.lerp(out.brazoIzq, 2.6, k);
      out.brazoDer = THREE.MathUtils.lerp(out.brazoDer, 2.5, k);
      out.piernaIzq *= 1 - k;
      out.piernaDer *= 1 - k;
      out.bote = 0;
      out.inclinacion *= 1 - k;
    }
  }
}
