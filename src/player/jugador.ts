import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../core/config';
import type { Entrada } from '../core/entrada';
import type { Fisica } from '../core/fisica';
import { nuevoId } from '../core/poblacion';
import type { JugadorAPI, TitanAPI } from '../core/tipos';
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

export class Jugador implements JugadorAPI {
  // ── Humano / JugadorAPI ──
  readonly id = nuevoId();
  readonly tipo = 'jugador' as const;
  readonly nombre = 'Tú';
  vivo = true;
  agarradoPor: TitanAPI | null = null;
  salud = 100;
  readonly saludMax = 100;
  paresRepuesto = 4;
  filo = 1;
  get posicion(): THREE.Vector3 {
    return this.pos;
  }
  get velocidad(): THREE.Vector3 {
    return this.vel;
  }
  /** Brazo del titán que lo sujeta (cortarlo lo libera). */
  brazoAgarre: 'brazoIzq' | 'brazoDer' = 'brazoDer';
  alSerAgarrado(titan: TitanAPI, brazo: 'brazoIzq' | 'brazoDer'): void {
    this.agarradoPor = titan;
    this.brazoAgarre = brazo;
    this.odm.liberarTodo();
  }
  alSerSoltado(): void {
    this.agarradoPor = null;
  }
  alSerDevorado(): void {
    this.agarradoPor = null;
    this.vivo = false;
  }
  fijarPosicion(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.cuerpo.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  }
  reabastecer(): void {
    this.gas.recargar(this.gas.capacidad);
    this.paresRepuesto = 4;
    this.filo = 1;
  }
  revivir(pies: THREE.Vector3, rumbo?: number): void {
    this.vivo = true;
    this.salud = this.saludMax;
    this.agarradoPor = null;
    this.reabastecer();
    this.teletransportar(pies, rumbo);
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
  private readonly tmp = new THREE.Vector3();

  constructor(escena: THREE.Scene, fisica: Fisica, inicio: THREE.Vector3) {
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
    this.teletransportar(inicio);
  }

  /** Coloca al jugador con los pies en `pies`. */
  teletransportar(pies: THREE.Vector3, rumbo?: number): void {
    this.pos.copy(pies).y += MITAD_ALTURA_CENTRO;
    this.posPrevia.copy(this.pos);
    this.posRender.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.cuerpo.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.cuerpo.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.odm.liberarTodo();
    if (rumbo !== undefined) {
      this.rumbo = rumbo;
      this.rumboFijo = rumbo;
    }
  }

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

    // Reaparecer
    if (entrada.consumir('KeyR')) {
      this.teletransportar(new THREE.Vector3(0, 0, 14));
      this.gas.recargar(this.gas.capacidad);
      return;
    }

    this.vel.y -= config.fisica.gravedad * dt;

    // Impulso: hacia donde pulsas, o hacia donde miras si no pulsas nada
    const dirImpulso = deseo.lengthSq() > 0 ? deseo.clone().setY(Math.max(0.12, mirada.dir.y * 0.6)).normalize() : mirada.dir.clone();
    this.odm.actualizar(dt, { pos: this.pos, vel: this.vel, gas: this.gas, entrada, dirImpulso }, this.salida, mirada.dir);
    const tirando = this.odm.recogiendo || this.odm.impulsando;

    const shift = entrada.consumir('ShiftLeft') || entrada.consumir('ShiftRight');
    if (this.enSuelo && !tirando) {
      // En el suelo: acelerar hacia la velocidad de carrera deseada
      const objetivo = deseo.clone().multiplyScalar(j.velocidadAndar);
      const dvx = objetivo.x - this.vel.x;
      const dvz = objetivo.z - this.vel.z;
      const dv = Math.hypot(dvx, dvz);
      const maxDv = j.aceleracionSuelo * dt;
      const k = dv > maxDv ? maxDv / dv : 1;
      this.vel.x += dvx * k;
      this.vel.z += dvz * k;
      if (shift) this.vel.y = j.salto;
    } else {
      this.vel.addScaledVector(deseo, j.controlAereo * dt);
      this.vel.multiplyScalar(1 - j.resistenciaAire * dt);
      // Freno de emergencia: el gas frena una caída sin ganchos, a gran coste
      if (shift && this.vel.y < 0 && (this.odm.gasInfinito || this.gas.consumir(config.gas.costeFreno))) {
        this.vel.y *= config.odm.frenoEmergencia;
        this.vel.x *= 0.6;
        this.vel.z *= 0.6;
        this.emitirChorro(new THREE.Vector3(0, -1, 0), 14);
      }
    }

    const rapidez = this.vel.length();
    if (rapidez > j.velocidadMaxima) this.vel.multiplyScalar(j.velocidadMaxima / rapidez);

    // Integración + restricción de los cables sobre la posición prevista
    const prevista = this.pos.clone().addScaledVector(this.vel, dt);
    this.odm.restringir(prevista, this.vel);
    const deseado = prevista.sub(this.pos);

    this.controlador.computeColliderMovement(this.collider, deseado);
    const mov = this.controlador.computedMovement();
    for (let i = 0; i < this.controlador.numComputedCollisions(); i++) {
      const col = this.controlador.computedCollision(i);
      if (!col) continue;
      const n = this.tmp.set(col.normal1.x, col.normal1.y, col.normal1.z);
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
    }
    this.enSuelo = this.controlador.computedGrounded();
    if (this.enSuelo && this.vel.y < 0) this.vel.y = 0;
    this.pos.x += mov.x;
    this.pos.y += mov.y;
    this.pos.z += mov.z;
    this.cuerpo.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    // Red de seguridad si se sale del mundo
    if (this.pos.y < -50) this.teletransportar(new THREE.Vector3(0, 0, 14));

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
      enSuelo: this.enSuelo,
      anclas: this.odm.anclados.map((g) => g.ancla),
      recogiendo: this.odm.recogiendo,
      impulsando: this.odm.impulsando,
      corte: null,
      giro: false,
      agarrado: false,
      muerto: false,
      aterrizaje: null,
      impactoAterrizaje: 0,
    });
    g.updateMatrixWorld(true);
    this.odm.dibujar(this.salidaModelo, this.pos);
    this.chorros.actualizar(dt);
  }
}
