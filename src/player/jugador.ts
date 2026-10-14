import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Cuchillas } from '../combat/cuchillas';
import { config } from '../core/config';
import type { ContextoJuego } from '../core/contexto';
import type { Entrada } from '../core/entrada';
import type { Fisica } from '../core/fisica';
import { nuevoId } from '../core/poblacion';
import type { JugadorAPI, TitanAPI } from '../core/tipos';
import { Aguante } from './aguante';
import type { Caballo } from './caballo';
import { CombateJugador, MAX_BENGALAS } from './combate';
import { DepositoGas } from './gas';
import { ModeloJugador } from './modeloJugador';
import { EquipoODM, type Lado } from './odm';
import { Particulas } from './particulas';

/**
 * Controlador del jugador: cuerpo cinemático de Rapier + controlador de personaje
 * (colisiones, suelo, pendientes). La velocidad la integramos nosotros para combinar
 * andar, gravedad, cables, impulso de gas y control aéreo.
 */

export interface Mirada {
  /** Dirección de la cámara (normalizada). */
  dir: THREE.Vector3;
  /** Yaw de la cámara (rad). */
  yaw: number;
}

const MITAD_ALTURA_CENTRO = 0.85; // del suelo al centro de la cápsula
const ARRIBA = new THREE.Vector3(0, 1, 0);
const ABAJO_J = new THREE.Vector3(0, -1, 0);
/** Altura máxima que da el salto con gas (manteniendo Espacio sin dirección), en metros. */
export const ALTURA_SALTO_GAS = 10;

export class Jugador implements JugadorAPI {
  // ── Humano / JugadorAPI ──
  readonly id = nuevoId();
  readonly tipo = 'jugador' as const;
  readonly nombre = 'Tú';
  vivo = true;
  agarradoPor: TitanAPI | null = null;
  salud = 100;
  readonly saludMax = 100;
  get paresRepuesto(): number {
    return this.combate?.cuchillas.repuesto ?? 4;
  }
  get filo(): number {
    return this.combate?.cuchillas.filo ?? 1;
  }
  get cambiandoCuchillas(): boolean {
    return (this.combate?.cuchillas.cambiando ?? 0) > 0;
  }
  get posicion(): THREE.Vector3 {
    return this.pos;
  }
  get velocidad(): THREE.Vector3 {
    return this.vel;
  }
  /** Brazo del titán que lo sujeta (cortarlo lo libera). */
  brazoAgarre: 'brazoIzq' | 'brazoDer' = 'brazoDer';
  alSerAgarrado(titan: TitanAPI, brazo: 'brazoIzq' | 'brazoDer'): void {
    this.soltarCaballo();
    this.agarradoPor = titan;
    this.brazoAgarre = brazo;
    this.odm.liberarTodo();
    this.pegado = null;
    this.odm.pegado = false;
    this.vel.set(0, 0, 0);
  }
  alSerSoltado(): void {
    this.agarradoPor = null;
    // cae de la mano con un pequeño impulso
    this.vel.set((Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4);
  }
  /** Titán que lo devoró (la cámara se queda mirando cómo mastica). */
  devoradoPor: TitanAPI | null = null;
  alSerDevorado(): void {
    this.devoradoPor = this.agarradoPor;
    this.agarradoPor = null;
    this.morir();
  }
  /** Impulso de gas o cambio de ancla en los últimos `ventana` s, con gas en los cilindros. */
  esquivaReciente(ventana: number): boolean {
    return this.tiempo - this.ultimaManiobra <= ventana && (this.odm.gasInfinito || this.gas.nivel > 0);
  }
  fijarPosicion(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.cuerpo.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  }
  reabastecer(): void {
    this.gas.recargar(this.gas.capacidad);
    this.combate?.cuchillas.rellenar();
    this.combate?.rellenarBengalas();
    this.aguante.rellenar();
  }
  recogerEquipo(gas: number, pares: number): void {
    this.gas.recargar(gas);
    const c = this.combate?.cuchillas;
    if (c) c.repuesto = Math.min(Cuchillas.MAX_REPUESTO, c.repuesto + pares);
  }
  revivir(pies: THREE.Vector3, rumbo?: number): void {
    this.vivo = true;
    this.devoradoPor = null;
    this.salud = this.saludMax;
    this.agarradoPor = null;
    this.modelo.grupo.visible = true;
    this.reabastecer();
    this.teletransportar(pies, rumbo);
  }

  /** Combate (tajos, cuchillas, QTE). Se crea al conectar el contexto. */
  combate: CombateJugador | null = null;
  /** Tu caballo (lo pone el mundo abierto) y si vas montado. */
  caballo: Caballo | null = null;
  montado = false;

  private soltarCaballo(): void {
    if (!this.montado) return;
    this.montado = false;
    if (this.caballo) this.caballo.montado = false;
  }

  /** C: montar si está al lado, bajar si vas montado o silbarle si está lejos. */
  private usarCaballo(): void {
    const c = this.caballo;
    if (!c) return;
    if (this.montado) {
      this.bajarDelCaballo(false);
      return;
    }
    const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
    if (d < 3.5 && this.pos.y < 4) {
      this.montado = true;
      c.montado = true;
      this.odm.liberarTodo();
      this.pegado = null;
      this.odm.pegado = false;
      this.combate?.cancelar();
      this.ctx?.eventos.emit({ tipo: 'caballo', accion: 'montar', pos: c.pos.clone() });
    } else {
      c.llamar(this.pos, this.rumbo);
      this.ctx?.eventos.emit({ tipo: 'caballo', accion: 'llamar', pos: this.pos.clone() });
    }
  }

  /** Baja del caballo: a un lado, o saltando de la silla con su inercia. */
  private bajarDelCaballo(salto: boolean): void {
    const c = this.caballo;
    if (!c || !this.montado) return;
    const vel = c.vel.clone();
    this.soltarCaballo();
    if (salto) {
      this.vel.copy(vel).setY(8);
      this.enSuelo = false;
      this.tUltimoSuelo = -9;
    } else {
      const izq = new THREE.Vector3(Math.cos(c.rumbo), 0, -Math.sin(c.rumbo));
      const pies = c.pos.clone().addScaledVector(izq, 1.4);
      const libre = this.ctx?.nav.puntoLibreCercano(pies.x, pies.z, 0.5) ?? pies;
      this.teletransportar(new THREE.Vector3(libre.x, 0, libre.z));
      this.vel.copy(vel).multiplyScalar(0.3);
    }
    this.ctx?.eventos.emit({ tipo: 'caballo', accion: 'bajar', pos: c.pos.clone() });
  }

  /** Montado: el caballo manda; se puede cortar, tirar bengalas y clavar un gancho (te saca de la silla). */
  private pasoMontado(dt: number, entrada: Entrada, mirada: Mirada, deseo: THREE.Vector3): void {
    const c = this.caballo!;
    const galope = entrada.mantenida('ShiftLeft') || entrada.mantenida('ShiftRight');
    if (entrada.consumir('Space')) {
      this.bajarDelCaballo(true);
      return;
    }
    c.conducir(dt, deseo, galope);
    c.silla(this.pos);
    this.vel.copy(c.vel);
    this.rumbo = c.rumbo;
    this.enSuelo = false;
    this.odm.actualizar(dt, { pos: this.pos, vel: this.vel, gas: this.gas, entrada, dirImpulso: mirada.dir, impulso: false }, this.salida, mirada.dir);
    this.combate?.paso(dt, entrada, mirada.dir);
    this.cuerpo.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    // un gancho clavado te arranca de la silla, con la velocidad del galope
    if (this.odm.anclados.length > 0) {
      this.soltarCaballo();
      this.vel.y = Math.max(this.vel.y, 3);
      this.ultimaManiobra = this.tiempo;
    }
  }
  private ctx: ContextoJuego | null = null;
  /** Segundos desde el último daño (la vida se regenera fuera de combate). */
  private sinDanio = 99;
  private tiempo = 0;
  /** Última pulsación en el aire que prepara la rodada (Shift o Espacio). */
  private ultimoShiftAire = -9;
  /** Último instante en el suelo (margen para saltar al salir de un borde) y del último salto. */
  private tUltimoSuelo = -9;
  private tSalto = -9;
  /**
   * Dónde empezó la pulsación de Espacio en curso: en el suelo es un salto; en el aire sin
   * ganchos, freno o impulso; enganchado, impulso (que no se vuelve freno al soltar los cables).
   */
  private modoEspacio: 'ninguno' | 'salto' | 'aire' | 'anclado' = 'ninguno';
  /** Frenando en el aire con Espacio (sin ganchos ni dirección). */
  frenando = false;
  /** Subiendo con el salto con gas (Espacio mantenido desde el suelo, sin dirección). */
  elevando = false;
  private subiendoGas = false;
  private ySalto = 0;
  /** De pie en un tronco o una pared, sujeto por un cable (como en el anime). */
  pegado: { punto: THREE.Vector3; normal: THREE.Vector3; gancho: number } | null = null;
  /** Esprintando a pie con Shift. */
  corriendo = false;
  readonly aguante = new Aguante();
  private ultimoGolpeTitan = -9;
  private tAterrizaje: number | null = null;
  private impactoAterrizaje = 0;
  private rodando = 0;
  private enDeposito = 0;
  /** Última maniobra evasiva (impulso, freno, salto con gas o ancla nueva), en segundos de juego. */
  private ultimaManiobra = -9;
  private anclasPrevias = 0;
  private impulsoPrevio = false;

  conectar(ctx: ContextoJuego): void {
    this.ctx = ctx;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const jugador = this;
    this.combate = new CombateJugador(ctx, {
      pos: this.pos,
      posPrevia: this.posPrevia,
      vel: this.vel,
      humano: this,
      get agarradoPor() {
        return jugador.agarradoPor;
      },
      set agarradoPor(t: TitanAPI | null) {
        jugador.agarradoPor = t;
      },
      get brazoAgarre() {
        return jugador.brazoAgarre;
      },
      set brazoAgarre(b: 'brazoIzq' | 'brazoDer') {
        jugador.brazoAgarre = b;
      },
      ancladoATitanRecogiendo: () =>
        this.odm.recogiendo && this.odm.anclados.some((g) => g.etiquetaAncla === 'titan' || g.etiquetaAncla === 'nuca'),
      consumirGas: (c) => this.odm.gasInfinito || this.gas.consumir(c),
    });
  }

  /** Daño directo (golpes, caídas). */
  herir(cantidad: number, motivo: string): void {
    if (!this.vivo || cantidad <= 0) return;
    this.salud = Math.max(0, this.salud - cantidad);
    this.sinDanio = 0;
    if (this.combate) this.combate.sacudida = Math.max(this.combate.sacudida, Math.min(1, cantidad / 40));
    if (this.salud <= 0) {
      this.ctx?.eventos.emit({ tipo: 'mensaje', texto: motivo, segundos: 3 });
      this.morir();
    }
  }

  private morir(): void {
    if (!this.vivo) return;
    this.vivo = false;
    this.odm.liberarTodo();
    this.pegado = null;
    this.odm.pegado = false;
    this.modelo.grupo.visible = false;
    this.vel.set(0, 0, 0);
  }

  /** Junto al depósito: el gas sube y, tras 2 s, cuchillas nuevas. */
  recargarEnDeposito(dt: number, cerca: boolean): void {
    if (!cerca || !this.vivo) {
      this.enDeposito = 0;
      return;
    }
    this.gas.recargar(config.gas.recargaPorSegundo * dt);
    const antes = this.enDeposito;
    this.enDeposito += dt;
    const c = this.combate?.cuchillas;
    const faltanBengalas = (this.combate?.bengalas ?? MAX_BENGALAS) < MAX_BENGALAS;
    if (antes < 2 && this.enDeposito >= 2 && c && (c.repuesto < 4 || c.filo < 1 || faltanBengalas)) {
      c.rellenar();
      this.combate?.rellenarBengalas();
      this.ctx?.eventos.emit({ tipo: 'mensaje', texto: 'Equipo repuesto', segundos: 1 });
      this.ctx?.eventos.emit({ tipo: 'recarga', quien: this });
    }
  }

  readonly pos = new THREE.Vector3();
  readonly posPrevia = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly posRender = new THREE.Vector3();
  enSuelo = false;
  rumbo = 0;
  /** Si se fija (modo ?cam), el modelo no gira hasta que haya input. */
  rumboFijo: number | null = null;
  readonly gas = new DepositoGas(config.gas.capacidad);
  readonly odm: EquipoODM;
  readonly modelo = new ModeloJugador();
  private readonly cuerpo: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controlador: RAPIER.KinematicCharacterController;
  private readonly chorros: Particulas;
  private velPrevia = new THREE.Vector3();
  /** Aceleración suavizada (para la pose). */
  private readonly acel = new THREE.Vector3();
  private readonly dirImpulso = new THREE.Vector3(0, 1, 0);
  private readonly dirMirada = new THREE.Vector3(0, 0, 1);
  private readonly tmp = new THREE.Vector3();

  constructor(escena: THREE.Scene, private readonly fisica: Fisica, inicio: THREE.Vector3) {
    const j = config.jugador;
    const mitad = j.altura / 2 - j.radio;
    this.cuerpo = fisica.mundo.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = fisica.registrar(RAPIER.ColliderDesc.capsule(mitad, j.radio), 'jugador', this.cuerpo);
    this.controlador = fisica.mundo.createCharacterController(0.03);
    this.controlador.setSlideEnabled(true);
    this.controlador.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(62));
    this.controlador.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(66));
    this.controlador.enableAutostep(0.45, 0.25, false);
    this.controlador.enableSnapToGround(0.35);
    this.odm = new EquipoODM(escena, fisica, () => this.collider);
    this.chorros = new Particulas(escena, 260, '#ffffff', 2.4);
    escena.add(this.modelo.grupo);
    // los pies se apoyan en el terreno real (pendientes, escalones, tejados)
    const abajo = new THREE.Vector3(0, -1, 0);
    const origen = new THREE.Vector3();
    this.modelo.sueloEn = (p) => {
      const hit = fisica.lanzarRayo(origen.copy(p).setY(p.y + 0.7), abajo, 1.6, this.collider);
      return hit ? hit.punto.y : null;
    };
    this.teletransportar(inicio);
  }

  /** Coloca al jugador con los pies en `pies`. */
  teletransportar(pies: THREE.Vector3, rumbo?: number): void {
    // un pelín por encima: si la cápsula empieza metida en el suelo, el controlador no la frena
    this.soltarCaballo();
    this.pos.copy(pies).y += MITAD_ALTURA_CENTRO + 0.05;
    this.posPrevia.copy(this.pos);
    this.posRender.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.cuerpo.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.cuerpo.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.odm.liberarTodo();
    this.pegado = null;
    this.odm.pegado = false;
    // el controlador recalcula el suelo en el siguiente paso; sin margen de salto heredado
    this.enSuelo = false;
    this.tUltimoSuelo = -9;
    if (rumbo !== undefined) {
      this.rumbo = rumbo;
      this.rumboFijo = rumbo;
      this.alOrientar?.(rumbo);
    }
  }

  /** La cámara se coloca detrás al teletransportar con rumbo (inicio de capítulo). */
  alOrientar: ((rumbo: number) => void) | null = null;

  salida = (lado: Lado): THREE.Vector3 => {
    // En el paso fijo usamos la posición física; el dibujo usa la del modelo.
    const lateral = new THREE.Vector3(Math.cos(this.rumbo), 0, -Math.sin(this.rumbo));
    return new THREE.Vector3().copy(this.pos).addScaledVector(lateral, (lado === 'izq' ? -1 : 1) * -0.17).add(new THREE.Vector3(0, 0.1, 0));
  };

  private salidaModelo = (lado: Lado): THREE.Vector3 => this.modelo.salidaCable(lado === 'izq' ? 1 : -1, new THREE.Vector3());

  paso(dt: number, entrada: Entrada, mirada: Mirada): void {
    const j = config.jugador;
    this.posPrevia.copy(this.pos);
    this.velPrevia.copy(this.vel);

    // Dirección deseada (WASD relativo a la cámara, en horizontal)
    const adelante = new THREE.Vector3(-Math.sin(mirada.yaw), 0, -Math.cos(mirada.yaw));
    const derecha = new THREE.Vector3(-adelante.z, 0, adelante.x);
    const f = (entrada.mantenida('KeyW') ? 1 : 0) - (entrada.mantenida('KeyS') ? 1 : 0);
    const s = (entrada.mantenida('KeyD') ? 1 : 0) - (entrada.mantenida('KeyA') ? 1 : 0);
    const deseo = adelante.clone().multiplyScalar(f).addScaledVector(derecha, s);
    if (deseo.lengthSq() > 0) {
      deseo.normalize();
      this.rumboFijo = null;
    }

    this.tiempo += dt;
    // Reaparecer (depuración)
    if (entrada.consumir('Backspace')) {
      this.revivir(this.ctx?.puntoReaparicion ?? new THREE.Vector3(0, 0, 14));
      return;
    }
    if (!this.vivo) return;
    if (entrada.consumir('KeyC') && !this.agarradoPor) this.usarCaballo();
    if (this.montado && this.caballo) {
      this.pasoMontado(dt, entrada, mirada, deseo);
      return;
    }
    // Agarrado por un titán: él nos mueve; nosotros solo podemos cortar (QTE)
    if (this.agarradoPor) {
      this.combate?.paso(dt, entrada, mirada.dir);
      this.posPrevia.copy(this.pos);
      return;
    }
    // Vida: se regenera fuera de combate
    this.sinDanio += dt;
    if (this.sinDanio > 8) this.salud = Math.min(this.saludMax, this.salud + 5 * dt);

    this.vel.y -= config.fisica.gravedad * dt;

    // Espacio: salto en el suelo; en el aire sin ganchos, freno (solo) o impulso (con WASD);
    // anclado, impulso y órbita como siempre. Una pulsación que empezó en el suelo (el salto)
    // no se convierte en freno ni impulso aunque se mantenga.
    const pulsoEspacio = entrada.consumir('Space');
    const espacio = entrada.mantenida('Space') || pulsoEspacio;
    const anclado = this.odm.anclados.length > 0;
    if (this.enSuelo) this.tUltimoSuelo = this.tiempo;
    const enSueloOBorde = this.tiempo - this.tUltimoSuelo < 0.12;
    if (!espacio) this.modoEspacio = 'ninguno';
    else if (pulsoEspacio) this.modoEspacio = anclado ? 'anclado' : enSueloOBorde ? 'salto' : 'aire';
    const enAire = this.modoEspacio === 'aire';
    // salto mantenido: sin dirección, el gas te eleva (hasta ALTURA_SALTO_GAS) y luego planeas;
    // con dirección, el gas te lanza hacia delante
    const enSalto = this.modoEspacio === 'salto' && !this.enSuelo && !anclado;
    if (this.modoEspacio !== 'salto' || anclado || (this.enSuelo && this.tiempo - this.tSalto > 0.3)) this.subiendoGas = false;
    const sinDireccion = deseo.lengthSq() === 0;
    const frenar = (enAire || (enSalto && !this.subiendoGas)) && !this.enSuelo && !anclado && sinDireccion;
    const impulso = espacio && (anclado || ((enAire || enSalto) && !sinDireccion));

    // Impulso: hacia donde pulsas, o hacia donde miras si no pulsas nada
    const dirImpulso = deseo.lengthSq() > 0 ? deseo.clone().setY(Math.max(0.12, mirada.dir.y * 0.6)).normalize() : mirada.dir.clone();
    this.dirImpulso.copy(dirImpulso);
    this.dirMirada.copy(mirada.dir);
    this.odm.actualizar(dt, { pos: this.pos, vel: this.vel, gas: this.gas, entrada, dirImpulso, impulso }, this.salida, mirada.dir);
    const tirando = this.odm.recogiendo || this.odm.impulsando;
    // Maniobras que esquivan un agarre: empezar un impulso o clavar un gancho nuevo
    let anclas = 0;
    this.odm.ganchos.forEach((g, i) => {
      if (g.estado === 'anclado') anclas |= 1 << i;
    });
    if ((this.odm.impulsando && !this.impulsoPrevio) || (anclas & ~this.anclasPrevias) !== 0) this.ultimaManiobra = this.tiempo;
    this.anclasPrevias = anclas;
    this.impulsoPrevio = this.odm.impulsando;

    // Shift: correr a pie (gasta aguante); en el aire prepara la rodada
    const shiftPulsado = entrada.consumir('ShiftLeft') || entrada.consumir('ShiftRight');
    const shift = entrada.mantenida('ShiftLeft') || entrada.mantenida('ShiftRight');
    if ((shiftPulsado || pulsoEspacio) && !this.enSuelo) this.ultimoShiftAire = this.tiempo;
    const quiereCorrer = shift && this.enSuelo && !tirando && deseo.lengthSq() > 0 && this.rodando <= 0;
    this.corriendo = quiereCorrer && this.aguante.puedeCorrer;
    this.aguante.paso(dt, this.corriendo);

    if (this.enSuelo && !tirando) {
      // En el suelo: acelerar hacia la velocidad de andar o de carrera
      const v = this.corriendo ? j.velocidadCorrer : this.aguante.agotado ? j.velocidadAndar * 0.75 : j.velocidadAndar;
      const objetivo = deseo.clone().multiplyScalar(v);
      const dvx = objetivo.x - this.vel.x;
      const dvz = objetivo.z - this.vel.z;
      const dv = Math.hypot(dvx, dvz);
      const maxDv = j.aceleracionSuelo * dt;
      const k = dv > maxDv ? maxDv / dv : 1;
      this.vel.x += dvx * k;
      this.vel.z += dvz * k;
    } else {
      if (tirando) {
        this.vel.addScaledVector(deseo, j.controlAereo * dt);
      } else {
        // Control en el aire sin cables ni gas: la velocidad horizontal se dirige hacia donde
        // pulsas (girar sin perder impulso, frenar con la tecla contraria, quedarte encima de
        // una rama). Sin pulsar, conserva la inercia. No acelera más allá de la carrera.
        const vh = Math.hypot(this.vel.x, this.vel.z);
        if (deseo.lengthSq() > 0) {
          // hacia delante o de lado conserva la rapidez; hacia atrás frena (y apenas retrocede)
          const base = Math.max(vh, 4.5);
          const alineado = vh > 0.5 ? (this.vel.x * deseo.x + this.vel.z * deseo.z) / vh : 1;
          const rapidez = alineado >= 0 ? base : THREE.MathUtils.lerp(base, 3, -alineado);
          const ox = deseo.x * rapidez - this.vel.x;
          const oz = deseo.z * rapidez - this.vel.z;
          const d = Math.hypot(ox, oz);
          // más mano cuanto más despacio vas (al saltar entre ramas), menos a gran velocidad
          const acel = j.controlAereo * THREE.MathUtils.lerp(1.8, 0.8, THREE.MathUtils.clamp(vh / 30, 0, 1));
          const k = Math.min(1, (acel * dt) / Math.max(d, 1e-6));
          this.vel.x += ox * k;
          this.vel.z += oz * k;
        }
      }
      this.vel.multiplyScalar(1 - j.resistenciaAire * dt);
    }

    // Salto: en el suelo o justo al salir de un borde (un pelín de margen)
    if (pulsoEspacio && this.modoEspacio === 'salto' && this.tiempo - this.tSalto > 0.3 && this.rodando <= 0) {
      this.tSalto = this.tiempo;
      this.ySalto = this.pos.y;
      this.subiendoGas = true;
      this.vel.y = Math.max(this.vel.y, j.salto * this.aguante.saltar());
      // saltar corriendo conserva (y estira un poco) la zancada
      if (this.corriendo) {
        this.vel.x *= 1.08;
        this.vel.z *= 1.08;
      }
      this.enSuelo = false;
      this.tUltimoSuelo = -9;
    }

    // Salto con gas: manteniendo Espacio tras saltar (sin dirección), el gas sigue empujando
    // hacia arriba hasta ALTURA_SALTO_GAS sobre el despegue (para escapar de los que corren
    // a cuatro patas o caer sobre un titán desde arriba); al llegar, planea con el freno.
    const elevandoAntes = this.elevando;
    this.elevando = false;
    if (this.subiendoGas && espacio && sinDireccion && !this.enSuelo && this.tiempo - this.tSalto > 0.06) {
      const altura = this.pos.y - this.ySalto;
      const f = altura >= ALTURA_SALTO_GAS ? 0 : this.odm.gasInfinito ? 1 : this.gas.consumirContinuo(config.gas.costeImpulsoPorSegundo, dt);
      if (f > 0) {
        if (!elevandoAntes) this.ultimaManiobra = this.tiempo;
        this.elevando = true;
        // sube rápido y afloja al acercarse al tope, sin pasarse
        const objetivoVy = Math.min(15, 1.5 + (ALTURA_SALTO_GAS - altura) * 2.4);
        this.vel.y += config.fisica.gravedad * f * dt;
        this.vel.y += (objetivoVy - this.vel.y) * Math.min(1, 9 * f * dt);
        if (Math.random() < 0.7) this.emitirChorro(new THREE.Vector3(0, -1, 0), 12);
      } else {
        this.subiendoGas = false;
      }
    }

    // Freno en el aire (Espacio sin ganchos): un golpe de gas que corta la caída y, mientras
    // se mantiene, frena el avance y deja bajar despacio
    const empiezaFreno = frenar && !this.frenando;
    this.frenando = false;
    if (frenar) {
      const puedePagar = this.odm.gasInfinito || !empiezaFreno || this.gas.consumir(config.gas.costeFreno);
      const f = !puedePagar ? 0 : this.odm.gasInfinito ? 1 : this.gas.consumirContinuo(config.gas.costeFrenoPorSegundo, dt);
      if (f > 0) {
        if (empiezaFreno) this.ultimaManiobra = this.tiempo;
        this.frenando = true;
        if (empiezaFreno && this.vel.y < 0) this.vel.y *= config.odm.frenoEmergencia;
        const kh = Math.exp(-3.5 * f * dt);
        this.vel.x *= kh;
        this.vel.z *= kh;
        // casi compensa la gravedad y limita la velocidad de caída
        this.vel.y += config.fisica.gravedad * 0.85 * f * dt;
        if (this.vel.y < -2) this.vel.y += (-2 - this.vel.y) * Math.min(1, 8 * f * dt);
        if (this.vel.y > 1.5) this.vel.y = 1.5;
        if (empiezaFreno || Math.random() < 0.6) this.emitirChorro(new THREE.Vector3(0, -1, 0), empiezaFreno ? 14 : 8);
      }
    }

    // De pie en la pared: al llegar recogiendo cable a un tronco o un muro (superficie casi
    // vertical) y seguir sujetando el gancho, te quedas agachado de lado sobre ella
    this.pasoPegado(dt, pulsoEspacio, deseo, mirada.dir);

    // Tajos, cambio de cuchillas e impulso asistido hacia el punto débil
    this.combate?.paso(dt, entrada, mirada.dir);

    const rapidez = this.vel.length();
    if (rapidez > j.velocidadMaxima) this.vel.multiplyScalar(j.velocidadMaxima / rapidez);

    // Integración + restricción de los cables sobre la posición prevista
    const prevista = this.pos.clone().addScaledVector(this.vel, dt);
    this.odm.restringir(prevista, this.vel);
    const deseado = prevista.sub(this.pos);

    const estabaEnSuelo = this.enSuelo;
    const vyAntes = this.vel.y;
    this.controlador.computeColliderMovement(this.collider, deseado);
    const mov = this.controlador.computedMovement();
    for (let i = 0; i < this.controlador.numComputedCollisions(); i++) {
      const col = this.controlador.computedCollision(i);
      if (!col) continue;
      const n = this.tmp.set(col.normal1.x, col.normal1.y, col.normal1.z);
      const vn = this.vel.dot(n);
      if (vn < 0) {
        // estrellarse contra un titán a mucha velocidad duele
        const etiqueta = col.collider ? this.fisica.etiquetas.get(col.collider.handle) : undefined;
        // rozar o chocar con la carne no mata: solo un golpe muy fuerte duele, y poco
        if ((etiqueta === 'titan' || etiqueta === 'nuca') && -vn > 32 && this.tiempo - this.ultimoGolpeTitan > 0.8) {
          this.ultimoGolpeTitan = this.tiempo;
          this.herir(Math.min(20, (-vn - 32) * 1.5), 'Te has estrellado contra un titán');
        }
        this.vel.addScaledVector(n, -vn);
      }
    }
    this.enSuelo = this.controlador.computedGrounded();
    // Aterrizaje: impacto fuerte = daño, salvo rodada (Shift justo antes de tocar el suelo)
    if (this.enSuelo && !estabaEnSuelo) {
      const impacto = -vyAntes;
      this.tAterrizaje = 0;
      this.impactoAterrizaje = Math.max(0, impacto);
      if (impacto > 14 && this.tiempo - this.ultimoShiftAire < 0.35) {
        this.rodando = 0.55;
        this.ctx?.eventos.emit({ tipo: 'mensaje', texto: 'Rodada', segundos: 0.8 });
      } else if (impacto > 22) {
        this.herir((impacto - 22) * 4, 'La caída ha sido mortal');
      }
    }
    if (this.tAterrizaje !== null) {
      this.tAterrizaje += dt;
      if (this.tAterrizaje > 0.6) this.tAterrizaje = null;
    }
    if (this.rodando > 0) {
      this.rodando -= dt;
      // la rodada conserva parte del impulso horizontal
      if (this.enSuelo) {
        const vh = Math.hypot(this.vel.x, this.vel.z);
        if (vh < 6) {
          const f = new THREE.Vector3(Math.sin(this.rumbo), 0, Math.cos(this.rumbo));
          this.vel.x = f.x * 6;
          this.vel.z = f.z * 6;
        }
      }
    }
    if (this.enSuelo && this.vel.y < 0) this.vel.y = 0;
    this.pos.x += mov.x;
    this.pos.y += mov.y;
    this.pos.z += mov.z;
    this.desenterrar();
    this.cuerpo.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    // Red de seguridad si se sale del mundo
    if (this.pos.y < -50) this.teletransportar(this.ctx?.puntoReaparicion ?? new THREE.Vector3(0, 0, 14));

    // Orientación del modelo: hacia donde se mueve (o hacia la cámara si está quieto y apuntando)
    if (this.rumboFijo === null) {
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const objetivo = vh > 1.5 ? Math.atan2(this.vel.x, this.vel.z) : deseo.lengthSq() > 0 ? Math.atan2(deseo.x, deseo.z) : this.rumbo;
      let d = objetivo - this.rumbo;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.rumbo += d * Math.min(1, dt * 10);
    }
    // Inclinación por aceleración horizontal (hacia delante del modelo)
    const acel = this.vel.clone().sub(this.velPrevia).divideScalar(dt);
    this.acel.lerp(acel, Math.min(1, dt * 10));

    if (this.odm.impulsando) this.emitirChorro(dirImpulso.clone().negate(), 10);
    else if (this.odm.recogiendo && Math.random() < 0.5) this.emitirChorro(this.vel.clone().normalize().negate(), 5);
  }

  private pasoPegado(dt: number, pulsoEspacio: boolean, deseo: THREE.Vector3, mirada: THREE.Vector3): void {
    const ganchos = this.odm.ganchos;
    if (!this.pegado) {
      ganchos.forEach((g, i) => {
        if (this.pegado || g.estado !== 'anclado' || !g.normalAncla || Math.abs(g.normalAncla.y) > 0.55) return;
        if (this.pos.distanceTo(g.ancla) > 2.6) return;
        this.pegado = { punto: g.ancla.clone(), normal: g.normalAncla.clone().setY(0).normalize(), gancho: i };
      });
      if (!this.pegado) {
        this.odm.pegado = false;
        return;
      }
    }
    const p = this.pegado;
    const n = p.normal;
    const sigue = ganchos[p.gancho].estado === 'anclado';
    if (!sigue || pulsoEspacio) {
      // salto desde la pared: hacia fuera y arriba (con salto, el gas te lanza hacia donde miras)
      this.pegado = null;
      this.odm.pegado = false;
      this.vel.copy(n).multiplyScalar(7).add(new THREE.Vector3(0, 5, 0)).addScaledVector(deseo, 5);
      if (pulsoEspacio && (this.odm.gasInfinito || this.gas.consumir(config.gas.costeSaltoPared))) {
        this.odm.liberarTodo();
        this.vel.addScaledVector(mirada, 14);
        this.emitirChorro(mirada.clone().negate(), 14);
      }
      return;
    }
    this.odm.pegado = true;
    // quieto pegado a la superficie, sin gravedad
    const objetivo = p.punto.clone().addScaledVector(n, 0.8).add(new THREE.Vector3(0, -0.2, 0));
    this.vel.copy(objetivo).sub(this.pos).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 12);
  }

  /**
   * El controlador de Rapier ignora el suelo si la cápsula ya está algo metida en él (tras
   * aparecer o un aterrizaje muy fuerte) y entonces el jugador se hunde poco a poco. Cada paso
   * se mide el suelo justo debajo y, si los pies han quedado por debajo, se le saca encima.
   */
  private desenterrar(): void {
    if (this.agarradoPor || this.pegado || this.vel.y > 2) return;
    const origen = this.tmp.copy(this.pos);
    origen.y += 0.5;
    const hit = this.fisica.lanzarRayo(origen, ABAJO_J, 0.5 + MITAD_ALTURA_CENTRO + 0.6, this.collider);
    if (!hit || hit.normal.y < 0.5) return;
    const pies = this.pos.y - MITAD_ALTURA_CENTRO;
    if (pies < hit.punto.y - 0.005) {
      this.pos.y = hit.punto.y + MITAD_ALTURA_CENTRO + 0.01;
      if (this.vel.y < 0) this.vel.y = 0;
      this.enSuelo = true;
    }
  }

  private emitirChorro(dir: THREE.Vector3, rapidez: number): void {
    for (const lado of ['izq', 'der'] as const) {
      const o = this.salida(lado).add(new THREE.Vector3(0, -0.05, 0));
      this.chorros.emitir(o, dir.clone().multiplyScalar(rapidez).add(this.vel.clone().multiplyScalar(0.6)), 0.28, 0.16, 1.5);
    }
  }

  /** Interpolación de render y animación procedural. */
  dibujar(alfa: number, dt: number, t: number): void {
    this.posRender.lerpVectors(this.posPrevia, this.pos, alfa);
    const g = this.modelo.grupo;
    g.position.copy(this.posRender).y -= MITAD_ALTURA_CENTRO;
    g.rotation.y = this.rumbo;
    g.updateMatrixWorld(true);
    this.modelo.animar({
      dt,
      t,
      vel: this.vel,
      acel: this.acel,
      enSuelo: this.enSuelo || this.pegado !== null,
      pegado: this.pegado?.normal ?? null,
      anclas: this.odm.anclados.map((g) => g.ancla),
      recogiendo: this.odm.recogiendo,
      impulsando: this.odm.impulsando || this.frenando || this.elevando,
      corte: this.combate?.progresoTajo ?? null,
      giro: !!this.combate?.tajo?.giro,
      preparandoCorte: !!this.combate?.preparando,
      cambiandoCuchillas: (this.combate?.cuchillas.cambiando ?? 0) > 0,
      rodando: this.rodando > 0,
      agarrado: this.agarradoPor !== null,
      montado: this.montado,
      muerto: !this.vivo,
      // agachado sobre la pared: la misma flexión que al aterrizar
      aterrizaje: this.pegado ? 0.05 : this.tAterrizaje,
      impactoAterrizaje: this.pegado ? 9 : this.impactoAterrizaje,
      // frenando: piernas recogidas, como el impulso hacia arriba
      dirImpulso: this.frenando || this.elevando ? ARRIBA : this.dirImpulso,
      mirar: this.posRender.clone().addScaledVector(this.dirMirada, 40),
      filo: this.combate?.cuchillas.rota ? 0 : 1,
      objetivoCorte: this.combate?.objetivoTajo ?? null,
    });
    g.updateMatrixWorld(true);
    this.odm.dibujar(this.salidaModelo, this.pos);
    this.chorros.actualizar(dt);
  }
}
