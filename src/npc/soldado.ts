import * as THREE from 'three';
import { calcularDanio, desgaste } from '../combat/corte';
import { Cuchillas } from '../combat/cuchillas';
import type { ContextoJuego } from '../core/contexto';
import { nuevoId } from '../core/poblacion';
import type { AspectoSoldado, Humano, PuntoDebil, RolSoldado, TitanAPI, ZonaTitan } from '../core/tipos';
import { ModeloJugador } from '../player/modeloJugador';
import { aplicarRecogida, aplicarRestriccion } from '../player/cuerda';

/**
 * Soldado del escuadrón con equipo ODM simplificado: un cable (o dos) que se clava en
 * tejados, árboles, la muralla o la carne de los titanes, recogida con la bobina,
 * impulsos de gas, carrera por el suelo y tajos con el mismo modelo de daño que el
 * jugador (velocidad relativa, ángulo y filo). Lo dirige el escuadrón con una misión.
 */

export type TipoMision = 'seguir' | 'atacar' | 'rescatar' | 'proteger' | 'retirada' | 'darGas';

export interface Mision {
  tipo: TipoMision;
  /** Punto al que ir (seguir/proteger/retirada) o null. */
  destino?: THREE.Vector3;
  titan?: TitanAPI;
  zona?: ZonaTitan;
  /** Cebo: distrae al titán delante de su cara. */
  cebo?: boolean;
  humano?: Humano;
}

const ARRIBA = new THREE.Vector3(0, 1, 0);
const CENTRO = 0.85; // del centro del cuerpo a los pies
const VEL_CORRER = 6.8;
const VEL_RECOGIDA = 24;
const VEL_MAX = 38;
const GRAVEDAD = 14;
const ETIQUETAS_ANCLA = new Set(['edificio', 'tejado', 'arbol', 'rama', 'muralla', 'puerta', 'titan', 'nuca', 'otro']);

export class Soldado implements Humano {
  readonly id = nuevoId();
  readonly tipo = 'soldado' as const;
  readonly posicion = new THREE.Vector3();
  readonly velocidad = new THREE.Vector3();
  vivo = true;
  agarradoPor: TitanAPI | null = null;
  gas = 100;
  readonly cuchillas = new Cuchillas();
  readonly modelo: ModeloJugador;
  mision: Mision = { tipo: 'seguir' };
  /** Hueco en la formación (índice) al seguir al jugador. */
  hueco = 0;
  /** Para el HUD y los mensajes. */
  ultimaFrase = -99;

  private enSuelo = true;
  private rumbo = 0;
  private ancla: THREE.Vector3 | null = null;
  private anclaObjeto: THREE.Object3D | null = null;
  private readonly anclaLocal = new THREE.Vector3();
  private longitud = 0;
  private tAncla = 0;
  private tSinAncla = 0;
  private impulsando = false;
  private readonly dirImpulso = new THREE.Vector3(0, 1, 0);
  private tCorte = -1;
  private enfriamiento = 0;
  private tDistraer = 0;
  private tEsquiva = 0;
  private tAterrizaje: number | null = null;
  private impacto = 0;
  private readonly velPrevia = new THREE.Vector3();
  private readonly acel = new THREE.Vector3();
  private readonly posPrevia = new THREE.Vector3();
  private readonly posRender = new THREE.Vector3();
  private readonly mirar = new THREE.Vector3();
  private readonly cables: THREE.Line[] = [];
  private readonly etiqueta: THREE.Sprite;
  private objetivoCorte: THREE.Vector3 | null = null;

  constructor(
    private readonly ctx: ContextoJuego,
    readonly nombre: string,
    readonly rol: RolSoldado,
    aspecto: AspectoSoldado,
    pies: THREE.Vector3,
    /** Puntería y temple: multiplica el daño y la probabilidad de esquivar (Mikasa > 1). */
    readonly habilidad = 1,
  ) {
    this.modelo = new ModeloJugador(aspecto);
    ctx.escena.add(this.modelo.grupo);
    this.posicion.copy(pies).setY(pies.y + CENTRO);
    this.posPrevia.copy(this.posicion);
    this.posRender.copy(this.posicion);
    this.rumbo = Math.random() * Math.PI * 2;
    const mat = new THREE.LineBasicMaterial({ color: '#2a2a2a' });
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const l = new THREE.Line(geo, mat);
      l.frustumCulled = false;
      l.visible = false;
      ctx.escena.add(l);
      this.cables.push(l);
    }
    this.etiqueta = crearEtiqueta(nombre);
    ctx.escena.add(this.etiqueta);
  }

  // ─────────────────────────── Humano ───────────────────────────

  alSerAgarrado(titan: TitanAPI): void {
    this.agarradoPor = titan;
    this.soltarAncla();
    this.velocidad.set(0, 0, 0);
    this.decir(['¡Suéltame!', '¡Ayuda!', '¡No…!'][Math.floor(Math.random() * 3)]);
  }

  alSerSoltado(): void {
    this.agarradoPor = null;
    this.enSuelo = false;
    this.velocidad.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
  }

  alSerDevorado(): void {
    this.agarradoPor = null;
    this.vivo = false;
    this.modelo.grupo.visible = false;
    this.etiqueta.visible = false;
    for (const c of this.cables) c.visible = false;
  }

  fijarPosicion(p: THREE.Vector3): void {
    this.posicion.copy(p);
    this.posPrevia.copy(p);
  }

  // ─────────────────────────── Paso fijo ───────────────────────────

  paso(dt: number): void {
    this.posPrevia.copy(this.posicion);
    this.velPrevia.copy(this.velocidad);
    if (!this.vivo || this.agarradoPor) return;
    this.cuchillas.actualizar(dt);
    if (this.cuchillas.rota && this.cuchillas.repuesto > 0 && this.cuchillas.cambiando <= 0) this.cuchillas.empezarCambio();
    if (this.enfriamiento > 0) this.enfriamiento -= dt;
    if (this.tCorte >= 0) {
      this.tCorte += dt;
      if (this.tCorte > 0.25) this.tCorte = -1;
    }
    if (this.tAterrizaje !== null) {
      this.tAterrizaje += dt;
      if (this.tAterrizaje > 0.6) this.tAterrizaje = null;
    }

    const meta = this.metaActual();
    const titan = this.mision.titan && this.mision.titan.vivo ? this.mision.titan : null;
    this.esquivar(titan, dt);
    if (titan) this.combatir(titan, dt);
    this.moverHacia(meta, dt, titan);
    this.integrar(dt);
  }

  /** A dónde quiere ir ahora según la misión. */
  private metaActual(): THREE.Vector3 {
    const m = this.mision;
    const titan = m.titan && m.titan.vivo ? m.titan : null;
    if (titan && (m.tipo === 'atacar' || m.tipo === 'rescatar')) {
      const H = titan.altura;
      if (m.cebo) {
        // delante de la cara, fuera del alcance de las manos, dando vueltas
        const frente = new THREE.Vector3(Math.sin(titan.rumbo), 0, Math.cos(titan.rumbo));
        const lado = new THREE.Vector3(frente.z, 0, -frente.x);
        const t = this.ctx.reloj.t;
        return titan.cabeza().clone().addScaledVector(frente, 0.55 * H + 5).addScaledVector(lado, Math.sin(t * 0.7 + this.id) * (0.3 * H + 4)).setY(Math.max(3, 0.85 * H));
      }
      const p = this.punto(titan, m.zona ?? 'nuca');
      if (p) {
        this.objetivoCorte = p.centro;
        // el rematador espera detrás si el titán le está mirando
        if (m.zona === 'nuca' && titan.objetivo === this && titan.estado !== 'derribado' && titan.estado !== 'cegado') {
          const atras = new THREE.Vector3(-Math.sin(titan.rumbo), 0, -Math.cos(titan.rumbo));
          return p.centro.clone().addScaledVector(atras, 10 + H * 0.4).setY(p.centro.y + 4);
        }
        return p.centro.clone().addScaledVector(p.normal, 0.8);
      }
    }
    this.objetivoCorte = null;
    if (m.tipo === 'darGas' && m.humano) return m.humano.posicion.clone().add(new THREE.Vector3(1.2, 0, 1.2));
    return m.destino ?? this.posicion;
  }

  private punto(titan: TitanAPI, zona: ZonaTitan): PuntoDebil | null {
    return titan.puntosDebiles.find((x) => x.zona === zona && x.activo) ?? null;
  }

  /** Si el titán que tiene delante va a agarrarle, un impulso lateral (según su habilidad). */
  private esquivar(titan: TitanAPI | null, dt: number): void {
    if (this.tEsquiva > 0) {
      this.tEsquiva -= dt;
      return;
    }
    const amenaza = titan ?? this.ctx.poblacion.titanMasCercano(this.posicion, 30);
    if (!amenaza || amenaza.objetivo !== this || amenaza.estado !== 'agarrar') return;
    if (Math.random() > Math.min(0.92, 0.55 * this.habilidad)) {
      this.tEsquiva = 1.5;
      return;
    }
    const lejos = this.posicion.clone().sub(amenaza.posicion).setY(0).normalize();
    const lado = new THREE.Vector3(lejos.z, 0, -lejos.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    this.soltarAncla();
    this.velocidad.addScaledVector(lado, 12).addScaledVector(ARRIBA, 9).addScaledVector(lejos, 6);
    this.gas = Math.max(0, this.gas - 2);
    this.impulsar(lado);
    this.tEsquiva = 1.2;
  }

  /** Tajos, distracción del cebo y salida tras cortar. */
  private combatir(titan: TitanAPI, dt: number): void {
    const m = this.mision;
    if (m.cebo) {
      this.tDistraer -= dt;
      if (this.tDistraer <= 0 && titan.posicion.distanceTo(this.posicion) < 60) {
        titan.distraer(this, 3);
        this.tDistraer = 2;
      }
      return;
    }
    const p = this.punto(titan, m.zona ?? 'nuca');
    if (!p || this.enfriamiento > 0 || !this.cuchillas.puedeCortar) return;
    const d = this.posicion.distanceTo(p.centro);
    if (d > p.radio + 1.8) return;
    if (m.zona === 'nuca' && titan.objetivo === this && titan.estado !== 'derribado') return;
    const dir = p.centro.clone().sub(this.posicion).normalize();
    // acometida final para cortar con velocidad (como el jugador con el tajo asistido)
    if (this.velocidad.length() < 12 && this.gas > 2) {
      this.velocidad.addScaledVector(dir, 12);
      this.gas -= 1.5;
    }
    const r = calcularDanio({ velocidadRelativa: this.velocidad.clone(), eje: p.eje, filo: this.cuchillas.filo });
    const danio = r.danio * this.habilidad * (0.85 + Math.random() * 0.3);
    const res = titan.recibirCorte(p.zona, danio, this);
    this.ctx.eventos.emit({ tipo: 'corte', titan, resultado: res, por: this });
    this.cuchillas.desgastar(desgaste(r));
    if (res.efecto !== 'nada' && res.efecto !== 'rebote') this.ctx.efectos.sangre(p.centro.clone(), dir, 6);
    this.tCorte = 0;
    this.enfriamiento = 1.1 + Math.random() * 0.9;
    if (res.efecto === 'muerte' && Math.random() < 0.6) this.decir(['¡Uno menos!', '¡Abatido!', '¡Nuca!'][Math.floor(Math.random() * 3)]);
    if (res.efecto === 'liberacion') this.decir('¡Te tengo!');
    // salir disparado lejos de la carne tras el tajo
    this.soltarAncla();
    this.velocidad.addScaledVector(ARRIBA, 7).addScaledVector(p.normal, 6);
  }

  // ─────────────────────────── Locomoción ───────────────────────────

  private moverHacia(meta: THREE.Vector3, dt: number, titan: TitanAPI | null): void {
    const hacia = meta.clone().sub(this.posicion);
    const dist = hacia.length();
    const dh = Math.hypot(hacia.x, hacia.z);
    this.impulsando = false;

    // Cerca y en el suelo: andar o correr
    if (this.enSuelo && !this.ancla && (dist < 14 && Math.abs(hacia.y) < 2.5)) {
      const v = dh < 1.5 ? 0 : Math.min(VEL_CORRER, dh * 1.2);
      const dir = new THREE.Vector3(hacia.x, 0, hacia.z).normalize().multiplyScalar(v);
      const k = Math.min(1, dt * 8);
      this.velocidad.x += (dir.x - this.velocidad.x) * k;
      this.velocidad.z += (dir.z - this.velocidad.z) * k;
      // muro delante: salta con gas y engancha
      if (v > 1 && this.ctx.fisica.lanzarRayo(this.posicion, dir.clone().normalize(), 1.2)) this.despegar(meta);
      return;
    }
    if (dist < 2.5 && !titan) {
      this.soltarAncla();
      return;
    }

    // En el aire (o lejos): cable y bobina
    this.tAncla += dt;
    if (this.ancla) {
      this.actualizarAncla();
      const a = this.ancla;
      const haciaAncla = a.clone().sub(this.posicion);
      const dAncla = haciaAncla.length();
      const pasada = haciaAncla.dot(hacia) < 0 && dist > 6;
      if (dAncla < 3.5 || pasada || this.tAncla > 4 || (this.anclaObjeto && !this.anclaVivo())) {
        this.soltarAncla();
        // impulso de salida hacia la meta
        if (this.gas > 1 && dist > 4) {
          this.velocidad.addScaledVector(hacia.clone().normalize(), 6).addScaledVector(ARRIBA, 3);
          this.gas -= 0.5;
        }
      }
    } else {
      this.tSinAncla += dt;
      if (this.tSinAncla > 0.25 && dist > 6) this.elegirAncla(meta, titan);
      // sin dónde engancharse: impulso de gas hacia la meta
      if (!this.ancla && dist > 3 && this.gas > 0.5) {
        const dir = hacia.clone().normalize();
        this.velocidad.addScaledVector(dir, 16 * dt);
        if (this.velocidad.y < 2 && hacia.y > -2) this.velocidad.y += GRAVEDAD * 0.85 * dt;
        this.gas = Math.max(0, this.gas - 1.2 * dt);
        this.impulsar(dir);
      }
    }
    // cerca de la meta en el aire: frenar
    if (dist < 6) this.velocidad.multiplyScalar(1 - Math.min(0.9, dt * 3));
  }

  private despegar(meta: THREE.Vector3): void {
    if (this.gas < 1) return;
    this.enSuelo = false;
    this.velocidad.y = 6.5;
    this.gas -= 0.5;
    this.elegirAncla(meta, null);
  }

  private impulsar(dir: THREE.Vector3): void {
    this.impulsando = true;
    this.dirImpulso.copy(dir);
  }

  /** Busca dónde clavar el cable para avanzar hacia `meta` (o en la carne del titán objetivo). */
  private elegirAncla(meta: THREE.Vector3, titan: TitanAPI | null): void {
    this.tSinAncla = 0;
    if (this.gas < 0.5) return;
    const origen = this.posicion;
    const lateral = new THREE.Vector3(meta.z - origen.z, 0, origen.x - meta.x).normalize();
    let mejor: { punto: THREE.Vector3; objeto: THREE.Object3D | null; puntuacion: number } | null = null;
    const objetivoAlto = meta.clone().addScaledVector(ARRIBA, 6);
    for (let k = 0; k < 6; k++) {
      let destino: THREE.Vector3;
      if (titan && k < 2) destino = (k === 0 ? titan.cabeza() : titan.posicion.clone().setY(titan.altura * 0.6)).clone();
      else destino = meta.clone().addScaledVector(ARRIBA, 6 + Math.random() * 14).addScaledVector(lateral, (Math.random() - 0.5) * 18);
      const dir = destino.sub(origen).normalize();
      if (dir.y < -0.3) continue;
      const hit = this.ctx.fisica.lanzarRayo(origen, dir, 70);
      if (!hit || hit.distancia < 4 || !ETIQUETAS_ANCLA.has(hit.etiqueta)) continue;
      const puntuacion = hit.punto.distanceTo(objetivoAlto) + (hit.punto.y < origen.y - 1 ? 25 : 0);
      if (!mejor || puntuacion < mejor.puntuacion) mejor = { punto: hit.punto, objeto: hit.objeto, puntuacion };
    }
    if (!mejor) return;
    this.ancla = mejor.punto.clone();
    this.anclaObjeto = mejor.objeto;
    if (mejor.objeto) this.anclaLocal.copy(mejor.objeto.worldToLocal(mejor.punto.clone()));
    this.longitud = this.posicion.distanceTo(mejor.punto);
    this.tAncla = 0;
    this.enSuelo = false;
    this.gas = Math.max(0, this.gas - 0.6);
  }

  private actualizarAncla(): void {
    if (this.ancla && this.anclaObjeto) this.ancla.copy(this.anclaObjeto.localToWorld(this.anclaLocal.clone()));
  }

  private anclaVivo(): boolean {
    let o: THREE.Object3D | null = this.anclaObjeto;
    while (o) {
      if (!o.visible) return false;
      if (o.parent === null) return o.type === 'Scene';
      o = o.parent;
    }
    return false;
  }

  private soltarAncla(): void {
    this.ancla = null;
    this.anclaObjeto = null;
    this.tSinAncla = 0;
  }

  private integrar(dt: number): void {
    const fisica = this.ctx.fisica;
    if (!this.enSuelo || this.ancla) this.velocidad.y -= GRAVEDAD * dt;
    else this.velocidad.y = Math.min(0, this.velocidad.y - GRAVEDAD * dt);
    if (this.ancla) {
      this.longitud = aplicarRecogida(this.posicion, this.velocidad, this.ancla, this.longitud, VEL_RECOGIDA, 2);
      this.gas = Math.max(0, this.gas - 0.5 * dt);
    }
    if (this.velocidad.length() > VEL_MAX) this.velocidad.setLength(VEL_MAX);
    const desp = this.velocidad.clone().multiplyScalar(dt);
    const largo = desp.length();
    if (largo > 1e-5) {
      // choque con paredes, tejados, árboles y titanes a lo largo del movimiento
      const dir = desp.clone().divideScalar(largo);
      const hit = fisica.lanzarRayo(this.posicion, dir, largo + 0.35);
      if (hit && hit.etiqueta !== 'suelo' && hit.etiqueta !== 'jugador') {
        this.posicion.copy(hit.punto).addScaledVector(dir, -0.36);
        const vn = this.velocidad.dot(hit.normal);
        if (vn < 0) this.velocidad.addScaledVector(hit.normal, -vn * 1.1);
      } else this.posicion.add(desp);
    }
    if (this.ancla) aplicarRestriccion(this.posicion, this.velocidad, this.ancla, this.longitud);

    // Suelo bajo los pies (calle, tejado, rama)
    const suelo = fisica.lanzarRayo(this.posicion.clone().addScaledVector(ARRIBA, 0.3), new THREE.Vector3(0, -1, 0), CENTRO + 0.6);
    const ySuelo = suelo && suelo.etiqueta !== 'titan' && suelo.etiqueta !== 'nuca' ? suelo.punto.y : this.posicion.y < CENTRO ? 0 : null;
    if (ySuelo !== null && this.posicion.y - CENTRO <= ySuelo + 0.02 && this.velocidad.y <= 0.5) {
      if (!this.enSuelo) {
        this.impacto = -this.velocidad.y;
        this.tAterrizaje = 0;
      }
      this.posicion.y = ySuelo + CENTRO;
      this.velocidad.y = 0;
      this.enSuelo = true;
    } else if (!suelo || this.posicion.y - CENTRO > (ySuelo ?? 0) + 0.3) {
      this.enSuelo = false;
    }
    if (this.posicion.y < CENTRO) {
      this.posicion.y = CENTRO;
      this.velocidad.y = Math.max(0, this.velocidad.y);
      this.enSuelo = true;
    }
    const k = Math.min(1, dt * 12);
    this.acel.lerp(this.velocidad.clone().sub(this.velPrevia).divideScalar(Math.max(dt, 1e-3)), k);
  }

  /** Recoloca al soldado (reaparición, recuperar a uno que se quedó muy atrás). */
  teletransportar(centro: THREE.Vector3, velocidad?: THREE.Vector3): void {
    this.posicion.copy(centro);
    this.posPrevia.copy(centro);
    this.posRender.copy(centro);
    this.velocidad.copy(velocidad ?? new THREE.Vector3());
    this.soltarAncla();
  }

  /** Pasa gas al jugador (como Armin con Mikasa en Trost). Devuelve lo que ha dado. */
  darGas(cantidad: number): number {
    const dado = Math.max(0, Math.min(cantidad, this.gas - 15));
    this.gas -= dado;
    return dado;
  }

  decir(frase: string): void {
    const t = this.ctx.reloj.t;
    if (t - this.ultimaFrase < 4) return;
    this.ultimaFrase = t;
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${this.nombre}: ${frase}`, segundos: 2.2 });
  }

  // ─────────────────────────── Dibujo ───────────────────────────

  dibujar(alfa: number, dt: number, t: number, camara: THREE.Vector3): void {
    if (!this.vivo) return;
    this.posRender.lerpVectors(this.posPrevia, this.posicion, alfa);
    const g = this.modelo.grupo;
    g.position.copy(this.posRender).y -= CENTRO;
    const v = this.velocidad;
    const vh = Math.hypot(v.x, v.z);
    let rumboObj = this.rumbo;
    if (vh > 1.5) rumboObj = Math.atan2(v.x, v.z);
    else if (this.objetivoCorte || this.mision.titan) {
      const o = this.objetivoCorte ?? this.mision.titan!.posicion;
      rumboObj = Math.atan2(o.x - this.posicion.x, o.z - this.posicion.z);
    }
    let d = rumboObj - this.rumbo;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rumbo += d * Math.min(1, dt * 8);
    g.rotation.y = this.rumbo;
    g.updateMatrixWorld(true);
    if (this.mision.titan?.vivo) this.mirar.copy(this.mision.titan.cabeza());
    else this.mirar.copy(this.posRender).add(new THREE.Vector3(Math.sin(this.rumbo), 0.1, Math.cos(this.rumbo)).multiplyScalar(20));
    this.modelo.animar({
      dt,
      t,
      vel: v,
      acel: this.acel,
      enSuelo: this.enSuelo,
      anclas: this.ancla ? [this.ancla] : [],
      recogiendo: !!this.ancla,
      impulsando: this.impulsando,
      corte: this.tCorte >= 0 ? this.tCorte / 0.25 : null,
      giro: false,
      cambiandoCuchillas: this.cuchillas.cambiando > 0,
      agarrado: this.agarradoPor !== null,
      muerto: !this.vivo,
      aterrizaje: this.tAterrizaje,
      impactoAterrizaje: this.impacto,
      dirImpulso: this.dirImpulso,
      mirar: this.mirar,
      filo: this.cuchillas.rota ? 0 : 1,
      objetivoCorte: this.objetivoCorte,
    });
    // Cable desde la carcasa lumbar hasta el ancla
    const c = this.cables[0];
    c.visible = !!this.ancla;
    if (this.ancla) {
      const pos = c.geometry.getAttribute('position') as THREE.BufferAttribute;
      const o = this.modelo.salidaCable(1, new THREE.Vector3());
      pos.setXYZ(0, o.x, o.y, o.z);
      pos.setXYZ(1, this.ancla.x, this.ancla.y, this.ancla.z);
      pos.needsUpdate = true;
    }
    // Nombre encima de la cabeza, visible de cerca
    const dCam = camara.distanceTo(this.posRender);
    this.etiqueta.visible = dCam < 90;
    this.etiqueta.position.copy(this.posRender).y += 1.25;
    const esc = THREE.MathUtils.clamp(dCam * 0.028, 0.5, 2.2);
    this.etiqueta.scale.set(esc * 2, esc * 0.5, 1);
    (this.etiqueta.material as THREE.SpriteMaterial).color.set(this.agarradoPor ? '#ff8a7a' : '#ffffff');
  }

  eliminar(): void {
    this.modelo.grupo.removeFromParent();
    this.modelo.estela.removeFromParent();
    this.etiqueta.removeFromParent();
    for (const c of this.cables) {
      c.removeFromParent();
      c.geometry.dispose();
    }
  }
}

function crearEtiqueta(texto: string): THREE.Sprite {
  const lienzo = document.createElement('canvas');
  lienzo.width = 256;
  lienzo.height = 64;
  const g = lienzo.getContext('2d');
  if (g) {
    g.font = '600 34px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(texto, 128, 32);
    g.fillStyle = '#ffffff';
    g.fillText(texto, 128, 32);
  }
  const tex = new THREE.CanvasTexture(lienzo);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.renderOrder = 5;
  return s;
}
