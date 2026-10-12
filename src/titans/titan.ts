import type RAPIER from '@dimforge/rapier3d-compat';
import RAPIER_ from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { umbralNuca, umbralZona } from '../combat/corte';
import type { ContextoJuego } from '../core/contexto';
import { nuevoId } from '../core/poblacion';
import { crearRng } from '../core/rng';
import type { EstadoTitan, Humano, OpcionesTitan, PuntoDebil, ResultadoCorte, TitanAPI, ZonaTitan } from '../core/tipos';
import {
  alcanceAgarre,
  alcanceCercano,
  alcanceSalto,
  alcanceVista,
  alturaAlcance,
  alturaSalto,
  AVISO_SALTO,
  avisoAgarre,
  duracionSalto,
  enCono,
  galope,
  girarHacia,
  giroCuadrupedo,
  giroMaximo,
  prioridad,
  radioMordisco,
  velocidadAndar,
  velocidadAndarCuadrupedo,
  velocidadCuadrupedo,
  velocidadPersecucion,
} from './ia';
import { COMPLEXIONES, ModeloTitan, poseReposo, variarProporciones, type PoseTitan } from './modelo';

/**
 * Titán puro: modelo articulado, colisionadores cinemáticos por segmento (los ganchos se
 * quedan clavados en la carne aunque se mueva), puntos débiles del anime y una IA simple
 * pero agresiva: ve, huele multitudes, persigue por las calles, agarra, se lleva a la boca
 * y devora. Solo muere si le cortan la nuca; el resto se regenera echando vapor.
 */

interface Punto extends PuntoDebil {
  zona: ZonaTitan;
  centro: THREE.Vector3;
  radio: number;
  normal: THREE.Vector3;
  eje: THREE.Vector3;
  activo: boolean;
}

/** Bípedo: aviso → golpe → levantar → boca → masticar. Cuadrúpedo: agazapar → salto → zarandeo → masticar. */
type FaseAgarre = 'aviso' | 'golpe' | 'recuperar' | 'levantar' | 'boca' | 'masticar' | 'agazapar' | 'salto' | 'zarandeo';

interface Agarre {
  fase: FaseAgarre;
  t: number;
  brazo: 0 | 1;
  victima: Humano | null;
  /** Dónde intenta cerrar la mano. */
  blanco: THREE.Vector3;
  /** Posición de la mano al empezar cada fase (para interpolar); en el salto, de los pies. */
  desde: THREE.Vector3;
  /** Cuadrúpedo: atrapa con la boca. */
  conBoca?: boolean;
  /** Cuadrúpedo: dónde caen los pies al terminar el salto. */
  destino?: THREE.Vector3;
}

const PIELES = ['#f2d2bf', '#ebc6b0', '#e9c1a7', '#f0d6c6', '#e2b89e', '#efcdb6'];
const PELOS = ['#3b2a1e', '#5a3b24', '#1d1612', '#7a5a3a', '#2b241d'];
const ZONAS_TENDON: ZonaTitan[] = ['tendonIzq', 'tendonDer', 'corvaIzq', 'corvaDer'];
const BASE_REGEN: Partial<Record<ZonaTitan, number>> = {
  tendonIzq: 10, tendonDer: 10, corvaIzq: 12, corvaDer: 12, ojoIzq: 12, ojoDer: 12, brazoIzq: 20, brazoDer: 20, manoIzq: 6, manoDer: 6, mandibula: 8,
};

export class Titan implements TitanAPI {
  readonly id = nuevoId();
  readonly altura: number;
  readonly anormal: boolean;
  /** Anormal que corre a cuatro patas (bosques). */
  readonly cuadrupedo: boolean;
  readonly posicion: THREE.Vector3;
  rumbo: number;
  estado: EstadoTitan = 'deambular';
  vivo = true;
  objetivo: Humano | null = null;
  readonly modelo: ModeloTitan;
  /** true: sin IA (capturas y cinemáticas). Lo pone el gestor. */
  congelado = false;
  /** El gestor lo saca de la lista cuando acaba de evaporarse. */
  terminado = false;

  private readonly puntos: Punto[] = [];
  private readonly cuerpos: { cuerpo: RAPIER.RigidBody; marco: THREE.Object3D }[] = [];
  private readonly propios = new Set<number>();
  private readonly azar: () => number;
  private readonly factorRegen: number;
  private readonly radioNav: number;
  private readonly ignoraSueltos: boolean;

  // locomoción
  private velocidad = 0;
  private ruta: THREE.Vector3[] | null = null;
  private metaRuta = new THREE.Vector3(Infinity, 0, Infinity);
  private tRuta = 0;
  private destino: THREE.Vector3 | null = null;
  private tDestino = 0;
  private sprint = 0;
  private tSprint = 4;
  private desvio = 0;
  private tDesvio = 3;

  // percepción
  private tPercepcion: number;
  private ultimaPos: THREE.Vector3 | null = null;
  private tMemoria = 0;
  private distraccion: { h: Humano; t: number } | null = null;
  private tAlerta = 0;
  private asediando = false;

  // daño
  private danioNuca = 0;
  private tSinCorteNuca = 99;
  private readonly regen = new Map<ZonaTitan, number>();
  private tDerribo = 0;
  private tCeguera = 0;
  private tTambaleo = 0;
  private readonly brazoInutil: [number, number] = [0, 0];
  private readonly amputado: [boolean, boolean] = [false, false];

  // agarre y comida
  private agarre: Agarre | null = null;

  // noche
  private tNoche = 0;
  private readonly apagadoEn: number;

  // animación
  private fase = 0;
  private faseGalope = 0;
  /** Altura de la raíz sobre el suelo durante el salto del cuadrúpedo. */
  private alturaSaltoActual = 0;
  private t = 0;
  private readonly pose: PoseTitan = poseReposo();
  private tMuerte = 0;
  private sinColisiones = false;
  private lod = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(private readonly ctx: ContextoJuego, o: OpcionesTitan) {
    const semilla = o.semilla ?? Math.floor(Math.random() * 1e9);
    const rng = crearRng(semilla);
    this.azar = rng.siguiente;
    this.altura = o.altura;
    this.cuadrupedo = o.cuadrupedo ?? false;
    this.anormal = (o.anormal ?? false) || this.cuadrupedo;
    this.posicion = o.posicion.clone().setY(0);
    this.rumbo = o.rumbo ?? rng.rango(-Math.PI, Math.PI);
    this.factorRegen = rng.rango(0.7, 1.3) * (this.anormal ? 0.8 : 1);
    this.radioNav = Math.max(0.6, 0.17 * this.altura);
    this.ignoraSueltos = this.anormal && !this.cuadrupedo && rng.siguiente() < 0.7;
    this.tPercepcion = rng.rango(0, 0.25);
    this.apagadoEn = rng.rango(25, 80);

    // los cuadrúpedos, larguiruchos: patas largas y aspecto más inquietante
    const complexion = this.cuadrupedo ? 0 : this.altura <= 5 ? (rng.siguiente() < 0.6 ? 1 : 0) : rng.siguiente() < 0.65 ? 0 : 1;
    const prop = variarProporciones(COMPLEXIONES[complexion], this.azar);
    this.modelo = new ModeloTitan(this.altura, prop, {
      piel: rng.elegir(PIELES),
      pelo: rng.siguiente() < 0.55 ? rng.elegir(PELOS) : null,
      cara: rng.siguiente() < 0.5 ? 0 : 1,
    });
    ctx.escena.add(this.modelo.raiz);
    this.colocarRaiz();
    this.modelo.aplicar(this.pose);

    // Colisionadores cinemáticos, uno por segmento
    for (const s of this.modelo.segmentos) {
      const cuerpo = ctx.fisica.crearCinematico();
      const desc = s.forma === 'bola' ? RAPIER_.ColliderDesc.ball(s.radio) : RAPIER_.ColliderDesc.capsule(s.mitadAltura, s.radio);
      const c = ctx.fisica.registrar(desc, s.etiqueta, cuerpo);
      ctx.fisica.asociar(c, s.marco);
      this.propios.add(c.handle);
      this.cuerpos.push({ cuerpo, marco: s.marco });
    }
    this.sincronizarCuerpos(true);

    // Puntos débiles
    const H = this.altura;
    const s = Math.sqrt(H / 10);
    const v = () => new THREE.Vector3();
    const p = (zona: ZonaTitan, radio: number) => this.puntos.push({ zona, centro: v(), radio, normal: v(), eje: v(), activo: true });
    p('nuca', 0.4 * s + 0.2);
    p('tendonIzq', 0.05 * H + 0.15);
    p('tendonDer', 0.05 * H + 0.15);
    p('corvaIzq', 0.05 * H + 0.12);
    p('corvaDer', 0.05 * H + 0.12);
    p('ojoIzq', 0.2 * this.modelo.L.rc + 0.15);
    p('ojoDer', 0.2 * this.modelo.L.rc + 0.15);
    p('brazoIzq', 0.06 * H + 0.1);
    p('brazoDer', 0.06 * H + 0.1);
    p('manoIzq', 0.05 * H + 0.3);
    p('manoDer', 0.05 * H + 0.3);
    p('mandibula', 0.12 * this.modelo.L.rc + 0.3);
    p('cuerpo', 0.15 * H);
    this.punto('manoIzq').activo = false;
    this.punto('manoDer').activo = false;
    this.punto('mandibula').activo = false;
    this.actualizarPuntos();
  }

  get puntosDebiles(): readonly PuntoDebil[] {
    return this.puntos;
  }

  private punto(z: ZonaTitan): Punto {
    return this.puntos.find((p) => p.zona === z)!;
  }

  cabeza(): THREE.Vector3 {
    return this.modelo.cabeza.getWorldPosition(new THREE.Vector3());
  }

  distraer(h: Humano, segundos: number): void {
    if (!this.vivo) return;
    this.distraccion = { h, t: segundos };
    if (this.estado === 'deambular' || this.estado === 'alerta') this.objetivo = h;
  }

  // ─────────────────────────── Daño ───────────────────────────

  recibirCorte(zona: ZonaTitan, danio: number, atacante: Humano | null): ResultadoCorte {
    const p = this.puntos.find((x) => x.zona === zona);
    if (!this.vivo || !p || !p.activo) return { zona, efecto: 'nada', danio };
    if (danio <= 0) return { zona, efecto: 'rebote', danio };
    const U = umbralNuca(this.altura);
    const ef = this.ctx.efectos;

    if (zona === 'nuca') {
      this.danioNuca += danio;
      this.tSinCorteNuca = 0;
      if (this.danioNuca >= U) {
        this.morir(atacante);
        return { zona, efecto: 'muerte', danio };
      }
      ef.vapor(p.centro, 10, 0.8 + this.altura * 0.08, 3);
      this.tTambaleo = 0.6;
      return { zona, efecto: 'herida', danio };
    }
    if (zona === 'cuerpo') {
      ef.vapor(p.centro, 4, 0.5 + this.altura * 0.05, 2);
      return { zona, efecto: 'superficial', danio };
    }
    if (danio < umbralZona(zona, this.altura)) {
      ef.vapor(p.centro, 3, 0.4 + this.altura * 0.04, 2);
      return { zona, efecto: 'superficial', danio };
    }

    if (zona === 'manoIzq' || zona === 'manoDer' || zona === 'mandibula') {
      const brazo = zona === 'manoIzq' ? 0 : 1;
      if (this.agarre?.victima && (zona === 'mandibula' || this.agarre.brazo === brazo)) {
        this.soltarVictima();
        this.herir(zona, p);
        if (zona !== 'mandibula') this.brazoInutil[brazo] = Math.max(this.brazoInutil[brazo], (BASE_REGEN[zona] ?? 6) * this.factorRegen);
        return { zona, efecto: 'liberacion', danio };
      }
      return { zona, efecto: 'superficial', danio };
    }

    this.herir(zona, p);
    if (ZONAS_TENDON.includes(zona)) {
      const cortados = ZONAS_TENDON.filter((z) => !this.punto(z).activo);
      const corva = cortados.some((z) => z.startsWith('corva'));
      if (corva || cortados.filter((z) => z.startsWith('tendon')).length >= 2) {
        this.derribar(Math.min(...cortados.map((z) => this.regen.get(z) ?? 10)));
        return { zona, efecto: 'derribo', danio };
      }
      return { zona, efecto: 'cojera', danio };
    }
    if (zona === 'ojoIzq' || zona === 'ojoDer') {
      if (!this.punto('ojoIzq').activo && !this.punto('ojoDer').activo) {
        this.tCeguera = Math.max(this.regen.get('ojoIzq') ?? 12, this.regen.get('ojoDer') ?? 12);
        this.estado = 'cegado';
        this.objetivo = null;
        if (this.agarre && !this.agarre.victima) this.agarre = null;
      }
      return { zona, efecto: 'ceguera', danio };
    }
    if (zona === 'brazoIzq' || zona === 'brazoDer') {
      const i = zona === 'brazoIzq' ? 0 : 1;
      const amputa = danio >= 1.6 * U;
      const tiempo = (amputa ? 30 : 20) * this.factorRegen;
      this.regen.set(zona, tiempo);
      this.brazoInutil[i] = tiempo;
      this.amputado[i] = amputa;
      if (this.agarre?.victima && this.agarre.brazo === i && !this.agarre.conBoca) this.soltarVictima();
      // al cuadrúpedo le falta una pata delantera: se desploma hacia delante
      if (this.cuadrupedo) {
        this.derribar(tiempo * 0.6);
        return { zona, efecto: 'derribo', danio };
      }
      return { zona, efecto: 'brazo', danio };
    }
    return { zona, efecto: 'superficial', danio };
  }

  /** Marca la zona como cortada, con su regeneración y su vapor. */
  private herir(zona: ZonaTitan, p: Punto): void {
    const tiempo = (BASE_REGEN[zona] ?? 8) * this.factorRegen;
    p.activo = false;
    this.regen.set(zona, Math.max(this.regen.get(zona) ?? 0, tiempo));
    const tam = 0.6 + this.altura * 0.07;
    this.ctx.efectos.vaporContinuo(p.centro.clone(), tiempo, 6, tam, () => (this.vivo && this.regen.has(zona) ? p.centro : null));
  }

  private derribar(segundos: number): void {
    this.tDerribo = Math.max(this.tDerribo, segundos);
    this.estado = 'derribado';
    if (this.agarre && !this.agarre.victima) this.agarre = null;
    this.ctx.efectos.vapor(this.posicion.clone().setY(0.5), 8, this.altura * 0.15, 4);
  }

  private soltarVictima(): void {
    const a = this.agarre;
    if (!a?.victima) return;
    const v = a.victima;
    a.victima = null;
    if (v.agarradoPor === this) v.alSerSoltado();
    this.punto('manoIzq').activo = false;
    this.punto('manoDer').activo = false;
    this.punto('mandibula').activo = false;
    this.ctx.eventos.emit({ tipo: 'humanoLiberado', humano: v, titan: this });
    this.agarre = { ...a, fase: 'recuperar', t: 0 };
  }

  private morir(atacante: Humano | null): void {
    this.soltarVictima();
    this.vivo = false;
    this.estado = 'muriendo';
    this.objetivo = null;
    this.agarre = null;
    for (const p of this.puntos) p.activo = false;
    this.tMuerte = 0;
    this.ctx.eventos.emit({ tipo: 'titanMuerto', titan: this, por: atacante });
    const H = this.altura;
    // columna de vapor masiva que sale de todo el cuerpo durante unos 10 s
    this.ctx.efectos.vaporContinuo(this.posicion.clone().setY(H * 0.3), 11, 30, H * 0.22, () => (this.terminado ? null : this.modelo.torso.getWorldPosition(new THREE.Vector3())));
    this.ctx.efectos.vaporContinuo(this.posicion.clone().setY(H * 0.6), 9, 18, H * 0.18, () => (this.terminado ? null : this.modelo.cabeza.getWorldPosition(new THREE.Vector3())));
  }

  // ─────────────────────────── Paso fijo ───────────────────────────

  actualizar(dt: number, distanciaJugador: number): void {
    this.t += dt;
    if (!this.vivo) {
      this.morirPaso(dt);
      return;
    }
    this.regenerar(dt);
    if (this.congelado) {
      this.animar(dt, 0);
      this.finPaso();
      return;
    }
    // IA con nivel de detalle por distancia al jugador
    this.lod += dt;
    const periodo = distanciaJugador < 150 ? 0 : distanciaJugador < 400 ? 0.1 : 0.5;
    if (this.lod >= periodo) {
      const dtIA = this.lod;
      this.lod = 0;
      this.pensar(dtIA);
      this.moverse(dtIA);
    }
    this.mantenerAgarre(dt);
    this.animar(dt, this.velocidad);
    this.finPaso();
  }

  private finPaso(): void {
    this.colocarRaiz();
    this.modelo.aplicar(this.pose);
    this.actualizarPuntos();
    this.sincronizarCuerpos(false);
    // con alguien en la mano, lo llevamos con nosotros
    const a = this.agarre;
    if (a?.victima) a.victima.fijarPosicion((a.conBoca ? this.modelo.posBoca(this.tmp) : this.modelo.posMano(a.brazo, this.tmp)).clone());
  }

  private regenerar(dt: number): void {
    // la herida de la nuca se cierra a U/6 por segundo, 1 s después del último corte
    this.tSinCorteNuca += dt;
    if (this.tSinCorteNuca > 1 && this.danioNuca > 0) this.danioNuca = Math.max(0, this.danioNuca - (umbralNuca(this.altura) / 6) * dt);
    for (const [zona, restante] of this.regen) {
      const r = restante - dt;
      if (r > 0) {
        this.regen.set(zona, r);
        continue;
      }
      this.regen.delete(zona);
      if (zona !== 'manoIzq' && zona !== 'manoDer' && zona !== 'mandibula') this.punto(zona).activo = true;
      if (zona === 'brazoIzq' || zona === 'brazoDer') this.amputado[zona === 'brazoIzq' ? 0 : 1] = false;
    }
    for (let i = 0; i < 2; i++) {
      if (this.brazoInutil[i] > 0) this.brazoInutil[i] = Math.max(0, this.brazoInutil[i] - dt);
      const r = this.regen.get(i === 0 ? 'brazoIzq' : 'brazoDer');
      // el brazo amputado vuelve a crecer en el último 40 % de la regeneración
      if (this.amputado[i] && r !== undefined) this.modelo.crecimientoAntebrazo(i, THREE.MathUtils.clamp(1 - r / (30 * this.factorRegen * 0.4), 0, 1));
      else this.modelo.crecimientoAntebrazo(i, 1);
    }
    if (this.tTambaleo > 0) this.tTambaleo -= dt;
    if (this.distraccion) {
      this.distraccion.t -= dt;
      if (this.distraccion.t <= 0 || !this.distraccion.h.vivo) this.distraccion = null;
    }
  }

  // ─────────────────────────── IA ───────────────────────────

  private pensar(dt: number): void {
    // Noche: se van apagando
    if (this.ctx.esDeNoche()) this.tNoche += dt;
    else this.tNoche = Math.max(0, this.tNoche - dt * 4);
    if (this.estado === 'apagado') {
      if (this.tNoche < this.apagadoEn * 0.5) this.estado = 'deambular';
      return;
    }
    if (this.tNoche > this.apagadoEn && !this.agarre?.victima) {
      this.estado = 'apagado';
      this.objetivo = null;
      this.agarre = null;
      return;
    }

    if (this.estado === 'derribado') {
      this.tDerribo -= dt;
      const tendonesOk = ZONAS_TENDON.every((z) => this.punto(z).activo || z.startsWith('tendon'));
      const dosTendones = ZONAS_TENDON.filter((z) => z.startsWith('tendon') && !this.punto(z).activo).length >= 2;
      if (this.tDerribo <= 0 && tendonesOk && !dosTendones) this.estado = this.objetivo ? 'perseguir' : 'deambular';
      return;
    }
    if (this.estado === 'cegado') {
      this.tCeguera -= dt;
      if (this.tCeguera <= 0 || this.punto('ojoIzq').activo || this.punto('ojoDer').activo) this.estado = 'deambular';
      return;
    }
    if (this.agarre) return; // la secuencia de agarre manda

    // Percepción cada 0,25 s
    this.tPercepcion -= dt;
    if (this.tPercepcion <= 0) {
      this.tPercepcion = 0.25;
      this.percibir();
    }
    if (this.estado === 'alerta') {
      this.tAlerta -= dt;
      if (this.tAlerta <= 0) this.estado = this.objetivo ? 'perseguir' : 'deambular';
      return;
    }

    if (this.objetivo && (!this.objetivo.vivo || (this.objetivo.agarradoPor && this.objetivo.agarradoPor !== this))) {
      this.objetivo = null;
      this.estado = 'deambular';
    }
    if (!this.objetivo && this.ultimaPos) {
      this.tMemoria -= dt;
      if (this.tMemoria <= 0) this.ultimaPos = null;
    }

    if (this.objetivo) {
      this.estado = 'perseguir';
      this.intentarAgarrar();
    } else if (this.estado === 'perseguir') {
      this.estado = 'deambular';
    }
  }

  private percibir(): void {
    const ctx = this.ctx;
    const H = this.altura;
    const cabeza = this.cabeza();
    const noche = ctx.esDeNoche();
    const vista = alcanceVista(H, noche);
    const cerca = alcanceCercano(H);
    const frente = new THREE.Vector3(Math.sin(this.rumbo + this.pose.cabezaY), 0, Math.cos(this.rumbo + this.pose.cabezaY));
    let mejor: Humano | null = null;
    let mejorP = 0;
    for (const h of ctx.poblacion.humanosCerca(cabeza, vista + H, (x) => !x.agarradoPor)) {
      const d = h.posicion.distanceTo(cabeza);
      const dir = this.tmp.copy(h.posicion).sub(cabeza).divideScalar(Math.max(1e-3, d));
      let visible = d < cerca;
      if (!visible && d < vista && enCono(frente, dir)) visible = this.lineaDeVision(cabeza, h, d);
      if (!visible) continue;
      const vecinos = ctx.poblacion.humanosCerca(h.posicion, 15).length - 1;
      if (this.ignoraSueltos && vecinos === 0 && d > 8) continue;
      let pr = prioridad(d, vecinos, { anormal: this.anormal, cebo: this.distraccion?.h === h });
      // el cuadrúpedo caza soldados (y al jugador) antes que a civiles
      if (this.cuadrupedo) pr *= h.tipo === 'civil' ? 0.5 : 2;
      if (pr > mejorP) {
        mejorP = pr;
        mejor = h;
      }
    }
    if (this.distraccion && this.distraccion.h.vivo && !this.distraccion.h.agarradoPor) mejor = this.distraccion.h;
    if (mejor) {
      if (!this.objetivo && this.estado === 'deambular') {
        this.estado = 'alerta';
        this.tAlerta = 0.4 + this.azar() * 0.6;
      }
      this.objetivo = mejor;
      this.ultimaPos = mejor.posicion.clone();
      this.tMemoria = 6;
    } else if (this.objetivo) {
      // lo ha perdido de vista: va a la última posición conocida
      this.objetivo = null;
    }
  }

  private lineaDeVision(cabeza: THREE.Vector3, h: Humano, d: number): boolean {
    const dir = this.tmp2.copy(h.posicion).sub(cabeza).normalize();
    const origen = cabeza.clone().addScaledVector(dir, this.modelo.L.rc * 1.3);
    const hit = this.ctx.fisica.lanzarRayo(origen, dir, Math.max(0.1, d - this.modelo.L.rc * 1.3 - 1));
    if (!hit) return true;
    if (this.propios.has(hit.collider.handle)) return true;
    return hit.etiqueta === 'titan' || hit.etiqueta === 'nuca' || hit.etiqueta === 'jugador';
  }

  private intentarAgarrar(): void {
    if (this.cuadrupedo) {
      this.intentarSalto();
      return;
    }
    const obj = this.objetivo;
    if (!obj || this.tTambaleo > 0) return;
    const H = this.altura;
    // brazo del lado del objetivo, si está útil
    const local = this.modelo.raiz.worldToLocal(obj.posicion.clone());
    let brazo: 0 | 1 = local.x >= 0 ? 0 : 1;
    if (this.brazoInutil[brazo] > 0) brazo = brazo === 0 ? 1 : 0;
    if (this.brazoInutil[brazo] > 0) return; // sin brazos: solo persigue
    // se agacha para coger lo que está bajo: cuenta la distancia horizontal desde el hombro
    const hombro = this.modelo.hombros[brazo].getWorldPosition(this.tmp);
    const dh = Math.hypot(hombro.x - obj.posicion.x, hombro.z - obj.posicion.z);
    if (dh > alcanceAgarre(H) + 0.6 || obj.posicion.y > alturaAlcance(H)) return;
    this.agarre = {
      fase: 'aviso',
      t: 0,
      brazo,
      victima: null,
      blanco: obj.posicion.clone(),
      desde: this.modelo.posMano(brazo, new THREE.Vector3()),
    };
    this.estado = 'agarrar';
  }

  /** Cuadrúpedo: delante y a tiro, se agazapa (aviso) y salta a morder. */
  private intentarSalto(): void {
    const obj = this.objetivo;
    if (!obj || this.tTambaleo > 0) return;
    const H = this.altura;
    const cabeza = this.cabeza();
    const dx = obj.posicion.x - cabeza.x;
    const dz = obj.posicion.z - cabeza.z;
    if (Math.hypot(dx, dz) > alcanceSalto(H) || obj.posicion.y > 0.9 * H + 4) return;
    if (Math.cos(Math.atan2(dx, dz) - this.rumbo) < Math.cos(0.7)) return;
    this.agarre = { fase: 'agazapar', t: 0, brazo: 1, victima: null, blanco: obj.posicion.clone(), desde: this.posicion.clone(), conBoca: true };
    this.estado = 'agarrar';
  }

  /** Salto y mordisco del cuadrúpedo (el resto de fases las comparte con el bípedo). */
  private mantenerSalto(a: Agarre, dt: number): boolean {
    const H = this.altura;
    const obj = this.objetivo;
    switch (a.fase) {
      case 'agazapar':
        if (obj) {
          a.blanco.copy(obj.posicion).addScaledVector(obj.velocidad, 0.35);
          this.rumbo = girarHacia(this.rumbo, Math.atan2(a.blanco.x - this.posicion.x, a.blanco.z - this.posicion.z), giroCuadrupedo(H) * dt);
        }
        if (a.t >= AVISO_SALTO) {
          // los pies caen donde la boca alcance al blanco
          const cabeza = this.cabeza();
          const adelanto = Math.hypot(cabeza.x - this.posicion.x, cabeza.z - this.posicion.z);
          const dir = a.blanco.clone().sub(this.posicion).setY(0);
          const largo = dir.length();
          if (largo > 1e-3) dir.divideScalar(largo);
          const destino = this.posicion.clone().addScaledVector(dir, Math.max(0, largo - adelanto * 0.9)).setY(0);
          const libre = this.ctx.nav.libre(destino.x, destino.z, this.radioNav * 0.7) ? destino : (this.ctx.nav.puntoLibreCercano(destino.x, destino.z, this.radioNav * 0.7, 6) ?? this.posicion.clone());
          a.destino = libre.setY(0);
          a.desde.copy(this.posicion);
          a.fase = 'salto';
          a.t = 0;
        }
        return true;
      case 'salto': {
        const dur = duracionSalto(H);
        const k = Math.min(1, a.t / dur);
        this.posicion.lerpVectors(a.desde, a.destino ?? a.desde, k).setY(0);
        this.alturaSaltoActual = alturaSalto(H) * Math.sin(Math.PI * k);
        if (k < 1) return true;
        this.alturaSaltoActual = 0;
        this.ctx.efectos.vapor(this.posicion.clone().setY(0.5), 6, 0.15 * H, 3);
        const boca = this.modelo.posBoca(this.tmp);
        if (obj && obj.vivo && !obj.agarradoPor && boca.distanceTo(obj.posicion) < radioMordisco(H)) {
          a.victima = obj;
          obj.alSerAgarrado(this, 'brazoDer');
          this.punto('manoDer').activo = true;
          this.punto('mandibula').activo = true;
          this.ctx.eventos.emit({ tipo: 'humanoAgarrado', humano: obj, titan: this });
          this.estado = 'comer';
          this.cambiarFase(a, 'zarandeo');
        } else this.cambiarFase(a, 'recuperar'); // derrapa: ventana para cortarle
        return true;
      }
      case 'zarandeo':
        if (!this.victimaValida(a)) return true;
        if (a.t >= 1.3) {
          const v = a.victima!;
          a.victima = null;
          this.punto('manoDer').activo = false;
          this.punto('mandibula').activo = false;
          v.alSerDevorado();
          this.ctx.eventos.emit({ tipo: 'humanoDevorado', humano: v, titan: this });
          this.ctx.efectos.sangre(this.modelo.posBoca(this.tmp).clone(), new THREE.Vector3(0, -1, 0), 10);
          this.objetivo = null;
          this.cambiarFase(a, 'masticar');
        }
        return true;
      default:
        return false;
    }
  }

  /** Secuencia del agarre: aviso → golpe → (fallo) recuperar | levantar → boca → masticar. */
  private mantenerAgarre(dt: number): void {
    const a = this.agarre;
    if (!a) return;
    a.t += dt;
    if (this.cuadrupedo && this.mantenerSalto(a, dt)) return;
    const H = this.altura;
    const obj = this.objetivo;
    switch (a.fase) {
      case 'aviso':
        if (obj) a.blanco.copy(obj.posicion).addScaledVector(obj.velocidad, 0.35);
        if (a.t >= avisoAgarre(H)) this.cambiarFase(a, 'golpe');
        break;
      case 'golpe':
        if (obj) a.blanco.copy(obj.posicion).addScaledVector(obj.velocidad, Math.max(0, 0.35 - a.t));
        if (a.t >= 0.35) {
          const mano = this.modelo.posMano(a.brazo, this.tmp);
          const captura = 0.06 * H + 0.9;
          if (obj && obj.vivo && !obj.agarradoPor && mano.distanceTo(obj.posicion) < captura) {
            a.victima = obj;
            obj.alSerAgarrado(this, a.brazo === 0 ? 'brazoIzq' : 'brazoDer');
            this.punto(a.brazo === 0 ? 'manoIzq' : 'manoDer').activo = true;
            this.ctx.eventos.emit({ tipo: 'humanoAgarrado', humano: obj, titan: this });
            this.estado = 'comer';
            this.cambiarFase(a, 'levantar');
          } else this.cambiarFase(a, 'recuperar');
        }
        break;
      case 'recuperar':
        if (a.t >= (a.conBoca ? 1.2 : 1.5)) {
          this.agarre = null;
          this.estado = this.objetivo ? 'perseguir' : 'deambular';
        }
        break;
      case 'levantar':
        if (!this.victimaValida(a)) return;
        if (a.t >= 1 + 0.05 * H) {
          this.cambiarFase(a, 'boca');
          this.punto('mandibula').activo = true;
        }
        break;
      case 'boca':
        if (!this.victimaValida(a)) return;
        if (a.t >= 0.8) {
          const v = a.victima!;
          a.victima = null;
          this.punto('manoIzq').activo = false;
          this.punto('manoDer').activo = false;
          this.punto('mandibula').activo = false;
          v.alSerDevorado();
          this.ctx.eventos.emit({ tipo: 'humanoDevorado', humano: v, titan: this });
          this.ctx.efectos.sangre(this.modelo.posBoca(this.tmp).clone(), new THREE.Vector3(0, -1, 0), 10);
          this.objetivo = null;
          this.cambiarFase(a, 'masticar');
        }
        break;
      case 'masticar':
        if (a.t >= 1.6) {
          this.agarre = null;
          this.estado = 'deambular';
        }
        break;
    }
  }

  private victimaValida(a: Agarre): boolean {
    if (a.victima && a.victima.vivo && a.victima.agarradoPor === this) return true;
    a.victima = null;
    this.punto('manoIzq').activo = false;
    this.punto('manoDer').activo = false;
    this.punto('mandibula').activo = false;
    this.cambiarFase(a, 'recuperar');
    return false;
  }

  private cambiarFase(a: Agarre, fase: FaseAgarre): void {
    a.fase = fase;
    a.t = 0;
    a.desde.copy(this.modelo.posMano(a.brazo, this.tmp));
  }

  // ─────────────────────────── Locomoción ───────────────────────────

  private moverse(dt: number): void {
    const H = this.altura;
    let velObjetivo = 0;
    let meta: THREE.Vector3 | null = null;
    this.asediando = false;

    const quieto = this.estado === 'derribado' || this.estado === 'cegado' || this.estado === 'apagado' || this.estado === 'alerta' || this.tTambaleo > 0 || (this.agarre && this.agarre.fase !== 'recuperar');
    if (!quieto) {
      if (this.estado === 'perseguir' && this.objetivo) {
        meta = this.objetivo.posicion.clone().setY(0);
        velObjetivo = this.cuadrupedo ? velocidadCuadrupedo(H) : velocidadPersecucion(H);
        // ya lo tiene delante: frena y se encara en vez de pisarlo (el cuadrúpedo salta)
        const dh = meta.distanceTo(this.posicion);
        if (dh < 0.3 * H + 1) velObjetivo *= THREE.MathUtils.clamp((dh - 0.15 * H) / (0.15 * H + 1), 0, 1);
        // fuera de su alcance (tejado alto, rama, muralla): asedio en la base
        if (this.objetivo.posicion.y > alturaAlcance(H) && meta.distanceTo(this.posicion) < 0.5 * H + 3) {
          this.asediando = true;
          velObjetivo = 0;
        }
      } else if (this.ultimaPos) {
        meta = this.ultimaPos.clone().setY(0);
        velObjetivo = (this.cuadrupedo ? velocidadCuadrupedo(H) : velocidadPersecucion(H)) * 0.7;
        if (meta.distanceTo(this.posicion) < 3) this.ultimaPos = null;
      } else {
        // deambular: hacia multitudes cercanas (las huelen) o a un punto al azar
        this.tDestino -= dt;
        if (!this.destino || this.tDestino <= 0 || this.destino.distanceTo(this.posicion) < 3) this.elegirDestino();
        meta = this.destino;
        velObjetivo = this.cuadrupedo ? velocidadAndarCuadrupedo(H) : velocidadAndar(H);
      }
    }

    // cojera con un tendón cortado
    if (ZONAS_TENDON.some((z) => z.startsWith('tendon') && !this.punto(z).activo)) velObjetivo *= 0.45;
    // anormales: esprints y giros bruscos (el cuadrúpedo ya va a tope)
    if (this.anormal && !this.cuadrupedo && velObjetivo > 0) {
      this.tSprint -= dt;
      if (this.tSprint <= 0) {
        this.sprint = this.sprint > 0 ? 0 : 3 + this.azar() * 2;
        this.tSprint = this.sprint > 0 ? this.sprint : 8 + this.azar() * 7;
      }
      if (this.sprint > 0) {
        this.sprint -= dt;
        velObjetivo *= 1.8;
      }
      this.tDesvio -= dt;
      if (this.tDesvio <= 0) {
        this.desvio = (this.azar() - 0.5) * 1.6;
        this.tDesvio = 2 + this.azar() * 3;
      }
      if (this.tDesvio < 1.5) this.desvio *= Math.max(0, 1 - dt * 3);
    }

    // aceleración en ~0,6 s (0,3 s a cuatro patas)
    this.velocidad += (velObjetivo - this.velocidad) * Math.min(1, dt / (this.cuadrupedo ? 0.3 : 0.6));
    if (!meta || this.velocidad < 0.05) {
      if (meta && (this.asediando || this.estado === 'perseguir')) this.encarar(meta, dt);
      return;
    }

    const siguiente = this.siguientePunto(meta, dt);
    const dir = this.tmp.copy(siguiente).sub(this.posicion).setY(0);
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    // separación con otros titanes
    for (const otro of this.ctx.poblacion.titanesCerca(this.posicion, H * 0.6 + 8)) {
      if (otro === this) continue;
      const lejos = this.tmp2.copy(this.posicion).sub(otro.posicion).setY(0);
      const d = lejos.length();
      const minimo = 0.17 * (H + otro.altura) + 0.5;
      if (d > 1e-3 && d < minimo) dir.addScaledVector(lejos.divideScalar(d), (minimo - d) / minimo);
    }
    const rumboObj = Math.atan2(dir.x, dir.z) + this.desvio;
    this.rumbo = girarHacia(this.rumbo, rumboObj, (this.cuadrupedo ? giroCuadrupedo(H) : giroMaximo(H)) * dt);
    // avanza en la dirección en que mira (gira mal: por eso orbitarlo funciona)
    const avance = new THREE.Vector3(Math.sin(this.rumbo), 0, Math.cos(this.rumbo)).multiplyScalar(this.velocidad * dt);
    const nueva = this.posicion.clone().add(avance);
    const nav = this.ctx.nav;
    if (nav.libre(nueva.x, nueva.z, this.radioNav * 0.7) || !nav.libre(this.posicion.x, this.posicion.z, this.radioNav * 0.7)) {
      this.posicion.copy(nueva);
    } else if (nav.libre(nueva.x, this.posicion.z, this.radioNav * 0.7)) {
      this.posicion.x = nueva.x;
    } else if (nav.libre(this.posicion.x, nueva.z, this.radioNav * 0.7)) {
      this.posicion.z = nueva.z;
    } else {
      this.ruta = null; // atascado: recalcular
    }
    this.posicion.y = 0;
  }

  private encarar(meta: THREE.Vector3, dt: number): void {
    const objetivo = Math.atan2(meta.x - this.posicion.x, meta.z - this.posicion.z);
    this.rumbo = girarHacia(this.rumbo, objetivo, (this.cuadrupedo ? giroCuadrupedo(this.altura) : giroMaximo(this.altura)) * dt);
  }

  /** Siguiente punto de la ruta A* (recalcula cada ~1 s o si la meta se mueve). */
  private siguientePunto(meta: THREE.Vector3, dt: number): THREE.Vector3 {
    this.tRuta -= dt;
    if (!this.ruta || this.tRuta <= 0 || meta.distanceTo(this.metaRuta) > 4 + this.altura * 0.3) {
      this.ruta = this.ctx.nav.ruta(this.posicion, meta, this.radioNav, 5000);
      this.metaRuta.copy(meta);
      this.tRuta = 0.8 + this.azar() * 0.5;
    }
    if (!this.ruta || this.ruta.length === 0) return meta;
    while (this.ruta.length > 1 && this.ruta[0].distanceTo(this.posicion) < Math.max(2, this.radioNav * 1.5)) this.ruta.shift();
    return this.ruta[0];
  }

  private elegirDestino(): void {
    this.tDestino = 8 + this.azar() * 12;
    // las multitudes atraen desde 150 m (a los anormales, más)
    const multitud = this.multitudCercana(this.anormal ? 220 : 150);
    if (multitud) {
      this.destino = multitud;
      return;
    }
    const ang = this.azar() * Math.PI * 2;
    const r = 20 + this.azar() * 40;
    const p = this.ctx.nav.puntoLibreCercano(this.posicion.x + Math.cos(ang) * r, this.posicion.z + Math.sin(ang) * r, this.radioNav);
    this.destino = p ?? this.posicion.clone();
  }

  private multitudCercana(radio: number): THREE.Vector3 | null {
    let mejor: THREE.Vector3 | null = null;
    let mejorN = 2;
    const humanos = this.ctx.poblacion.humanosCerca(this.posicion, radio, (h) => !h.agarradoPor);
    for (let i = 0; i < humanos.length; i += 3) {
      const h = humanos[i];
      const n = this.ctx.poblacion.humanosCerca(h.posicion, 15).length;
      if (n > mejorN) {
        mejorN = n;
        mejor = h.posicion.clone().setY(0);
      }
    }
    return mejor;
  }

  // ─────────────────────────── Animación ───────────────────────────

  private animar(dt: number, velocidad: number): void {
    if (this.cuadrupedo) {
      this.suavizar(this.poseCuadrupedo(dt, velocidad), dt);
      return;
    }
    const H = this.altura;
    const L = this.modelo.L;
    const p = poseReposo();
    const vPers = velocidadPersecucion(H);
    const a = THREE.MathUtils.clamp(velocidad / vPers, 0, 1.6);
    const zancada = Math.max(1, 2.4 * L.cadera);
    this.fase += (velocidad / zancada) * Math.PI * 2 * dt;
    const φ = this.fase;
    const andando = THREE.MathUtils.clamp(velocidad / 0.6, 0, 1);

    // Andar torpe pero rápido: balanceo lateral, brazos colgando con retraso, cabeza que bambolea
    const A = THREE.MathUtils.lerp(0.3, 0.65, Math.min(1, a)) * andando;
    const K = THREE.MathUtils.lerp(0.5, 1.15, Math.min(1, a)) * andando;
    for (let i = 0; i < 2; i++) {
      const lado = i === 0 ? 1 : -1;
      const s = Math.sin(φ + i * Math.PI);
      const c = Math.cos(φ + i * Math.PI);
      p.cadera[i] = -0.05 - A * s;
      p.rodilla[i] = 0.1 + K * Math.pow(Math.max(0, c), 1.5);
      p.tobillo[i] = -0.05 - 0.2 * s * andando;
      p.hombroX[i] = -0.1 + 0.25 * Math.min(1, a) * Math.sin(φ + i * Math.PI + Math.PI) * andando;
      p.hombroZ[i] = lado * (0.12 + 0.3 * Math.min(1, a) + 0.12 * Math.min(1, a) * Math.sin(2 * φ + i));
      p.codo[i] = -0.15 - 0.55 * Math.min(1, a);
    }
    p.pelvisY = -0.03 * L.cadera * (0.5 + 0.5 * Math.cos(2 * φ)) * andando;
    p.pelvisZ = -0.05 * Math.sin(φ) * andando;
    p.torsoZ = 0.08 * Math.sin(φ) * andando + Math.sin(this.t * 0.6) * 0.02;
    p.torsoX = 0.07 + 0.35 * Math.min(1, a) + Math.sin(this.t * 0.9) * 0.015;
    p.cabezaX = 0.06 * Math.sin(2 * φ) * andando;
    p.cabezaZ = 0.13 + Math.sin(this.t * 0.5 + this.id) * 0.04;
    p.cabezaY = Math.sin(this.t * 0.37 + this.id) * 0.15;
    p.boca = 0.35 * Math.min(1, a);

    // Mira a su objetivo
    if (this.objetivo && this.estado !== 'cegado') {
      const local = this.modelo.raiz.worldToLocal(this.objetivo.posicion.clone());
      p.cabezaY = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.9, 0.9);
      const alturaRel = this.objetivo.posicion.y - L.hombroY;
      p.cabezaX = THREE.MathUtils.clamp(-Math.atan2(alturaRel, Math.max(1, Math.hypot(local.x, local.z))), -0.8, 0.6);
      if (this.estado === 'alerta') p.boca = 0.2;
    }

    if (this.tTambaleo > 0) {
      p.torsoZ += Math.sin(this.t * 14) * 0.12;
      p.cabezaX += 0.2;
    }

    // Brazos inutilizados: cuelgan flácidos
    for (let i = 0; i < 2; i++) {
      if (this.brazoInutil[i] > 0) {
        p.hombroX[i] = 0.05;
        p.hombroZ[i] = (i === 0 ? 1 : -1) * 0.05;
        p.codo[i] = 0;
      }
    }

    // Asedio: estira los brazos hacia arriba y da saltitos
    if (this.asediando && this.objetivo) {
      const salto = Math.max(0, Math.sin(this.t * 3));
      p.pelvisY += salto * 0.08 * H - 0.04 * H;
      p.rodilla[0] = p.rodilla[1] = 0.4 * (1 - salto);
      p.cadera[0] = p.cadera[1] = -0.25 * (1 - salto);
      for (let i = 0; i < 2; i++) if (this.brazoInutil[i] <= 0) p.ikMano[i] = this.objetivo.posicion.clone();
      p.boca = 0.6;
    }

    // Agarre: brazo atrás en el aviso, golpe con IK, levantar a la boca, morder y masticar
    const ag = this.agarre;
    if (ag) {
      const i = ag.brazo;
      const lado = i === 0 ? 1 : -1;
      const boca = this.modelo.posBoca(new THREE.Vector3());
      const frente = new THREE.Vector3(Math.sin(this.rumbo), 0, Math.cos(this.rumbo));
      const delanteBoca = boca.clone().addScaledVector(frente, L.rc * 0.9);
      const localBlanco = this.modelo.raiz.worldToLocal(ag.blanco.clone());
      const bajo = THREE.MathUtils.clamp(1 - ag.blanco.y / L.hombroY, 0, 1);
      // Agacharse: cadera y rodillas flexionadas con el pie debajo; se recoge al levantar
      const agachado =
        ag.fase === 'aviso' ? THREE.MathUtils.smoothstep(ag.t, 0, avisoAgarre(H)) * bajo
        : ag.fase === 'golpe' ? bajo
        : ag.fase === 'levantar' ? bajo * (1 - THREE.MathUtils.smoothstep(ag.t, 0, 0.8 + 0.03 * H))
        : ag.fase === 'recuperar' ? bajo * (1 - THREE.MathUtils.smoothstep(ag.t, 0, 1.2))
        : 0;
      if (agachado > 0) {
        const α = 1.05 * agachado;
        p.pelvisY = -(L.muslo + L.espinilla) * (1 - Math.cos(α));
        for (let j = 0; j < 2; j++) {
          p.cadera[j] = -α;
          p.rodilla[j] = 2 * α;
          p.tobillo[j] = -α;
        }
        p.torsoX += 0.55 * agachado;
      }
      switch (ag.fase) {
        case 'aviso':
          p.hombroX[i] = 0.7;
          p.hombroZ[i] = lado * 0.5;
          p.codo[i] = -0.9;
          p.torsoY = THREE.MathUtils.clamp(Math.atan2(localBlanco.x, localBlanco.z), -0.6, 0.6) - lado * 0.25;
          p.torsoX += 0.25 * bajo;
          p.boca = 0.4;
          break;
        case 'golpe': {
          const k = THREE.MathUtils.smoothstep(ag.t, 0, 0.3);
          p.ikMano[i] = ag.desde.clone().lerp(ag.blanco, k);
          p.torsoY = THREE.MathUtils.clamp(Math.atan2(localBlanco.x, localBlanco.z), -0.6, 0.6) + lado * 0.2;
          p.torsoX += 0.45 * bajo;
          p.boca = 0.5;
          break;
        }
        case 'recuperar':
          p.torsoX += 0.15 * (1 - THREE.MathUtils.smoothstep(ag.t, 0, 1.5));
          break;
        case 'levantar': {
          const k = THREE.MathUtils.smoothstep(ag.t, 0, 1 + 0.05 * H);
          p.ikMano[i] = ag.desde.clone().lerp(delanteBoca, k);
          p.boca = 0.2 + 0.3 * k;
          p.cabezaX = 0.25 * k;
          p.cabezaY = 0;
          break;
        }
        case 'boca':
          p.ikMano[i] = delanteBoca.clone().lerp(boca, THREE.MathUtils.smoothstep(ag.t, 0.3, 0.8));
          p.boca = 1;
          p.cabezaX = 0.3;
          p.cabezaY = 0;
          break;
        case 'masticar':
          p.boca = 0.35 + 0.35 * Math.abs(Math.sin(ag.t * 9));
          p.cabezaX = 0.15 + 0.08 * Math.sin(ag.t * 9);
          break;
      }
    }

    // Derribado: de rodillas, inclinado hacia delante; la nuca queda baja
    if (this.estado === 'derribado') {
      p.pelvisY = L.muslo + 0.03 * H - L.cadera;
      p.cadera[0] = p.cadera[1] = 0;
      p.rodilla[0] = p.rodilla[1] = 1.57;
      p.tobillo[0] = p.tobillo[1] = -0.6;
      p.torsoX = 0.55 + Math.sin(this.t * 2) * 0.03;
      p.hombroX[0] = p.hombroX[1] = -0.7;
      p.codo[0] = p.codo[1] = -0.2;
      p.boca = 0.3;
    }

    // Ciego: se tapa la cara 1 s y luego da manotazos a ciegas
    if (this.estado === 'cegado') {
      const transcurrido = 12 * this.factorRegen - this.tCeguera;
      if (transcurrido < 1) {
        const cara = this.modelo.cabeza.getWorldPosition(new THREE.Vector3());
        const frente = new THREE.Vector3(Math.sin(this.rumbo), 0, Math.cos(this.rumbo)).multiplyScalar(L.rc * 1.1);
        const lado = new THREE.Vector3(Math.cos(this.rumbo), 0, -Math.sin(this.rumbo)).multiplyScalar(L.rc * 0.4);
        p.ikMano[0] = cara.clone().add(frente).add(lado);
        p.ikMano[1] = cara.clone().add(frente).sub(lado);
      } else {
        for (let i = 0; i < 2; i++) {
          p.hombroX[i] = -1.2 + Math.sin(this.t * 4 + i * 2) * 0.9;
          p.hombroZ[i] = (i === 0 ? 1 : -1) * (0.5 + 0.3 * Math.sin(this.t * 3 + i));
        }
      }
      p.boca = 0.5;
      p.cabezaY = Math.sin(this.t * 2.3) * 0.6;
    }

    // Apagado por la noche: sentado, cabeza caída
    if (this.estado === 'apagado') {
      p.pelvisY = -L.cadera * 0.75;
      p.cadera[0] = p.cadera[1] = -1.45;
      p.rodilla[0] = p.rodilla[1] = 0.35;
      p.torsoX = -0.15;
      p.cabezaX = 0.5;
      p.hombroX[0] = p.hombroX[1] = -0.4;
      p.boca = 0.1;
    }

    this.suavizar(p, dt);
  }

  /**
   * A cuatro patas: cuerpo horizontal colgado de los hombros, manos y pies plantados por IK
   * en un galope «bound» (pares delantero y trasero alternos) con la columna flexionando,
   * cabeza baja y boca abierta. Agazapado antes del salto, estirado en el aire, zarandeo con
   * la presa, tumbado sobre el vientre si cae.
   */
  private poseCuadrupedo(dt: number, v: number): PoseTitan {
    const H = this.altura;
    const m = this.modelo;
    const L = m.L;
    const p = poseReposo();
    const brazoTotal = L.brazo + L.antebrazo;
    const torsoLargo = L.hombroY - L.cadera;
    const piernaTotal = L.muslo + L.espinilla;
    const hCadera = 0.78 * piernaTotal;
    // inclinación del tronco para que las manos lleguen al suelo con el codo algo doblado
    const a = Math.acos(THREE.MathUtils.clamp((0.85 * brazoTotal - hCadera) / torsoLargo, 0.05, 0.6));
    const frente = new THREE.Vector3(Math.sin(this.rumbo), 0, Math.cos(this.rumbo));
    const lado = new THREE.Vector3(Math.cos(this.rumbo), 0, -Math.sin(this.rumbo));
    const ag = this.agarre;
    const tumbado = this.estado === 'derribado' || this.estado === 'apagado';

    p.pelvisX = a;
    p.pelvisY = hCadera - L.cadera;
    p.cabezaX = -(a - 0.2);
    p.cabezaZ = 0.08;
    p.boca = 0.55;

    if (tumbado) {
      // sobre el vientre, patas abiertas, la nuca a la vista
      p.pelvisX = Math.PI / 2;
      p.pelvisY = 0.12 * H - L.cadera;
      p.cabezaX = -(Math.PI / 2 - 0.35);
      p.boca = this.estado === 'apagado' ? 0.1 : 0.4 + 0.15 * Math.sin(this.t * 3);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const hom = m.hombros[i].getWorldPosition(new THREE.Vector3());
        const cad = m.caderas[i].getWorldPosition(new THREE.Vector3());
        p.ikMano[i] = hom.addScaledVector(frente, 0.22 * H).addScaledVector(lado, s * 0.12 * H).setY(0.04 * H);
        p.ikPie[i] = cad.addScaledVector(frente, -0.3 * H).addScaledVector(lado, s * 0.08 * H).setY(0.035 * H);
      }
      return p;
    }

    // Galope: fase del ciclo y zancada coherentes con la velocidad (sin patinar)
    const { zancada, frecuencia } = galope(v, H);
    this.faseGalope = (this.faseGalope + frecuencia * dt) % 1;
    const corre = THREE.MathUtils.clamp(v / (0.5 * velocidadCuadrupedo(H)), 0, 1);
    const φ = this.faseGalope * Math.PI * 2;
    p.pelvisX = a + 0.08 * Math.sin(φ) * corre;
    p.pelvisY -= 0.03 * H * Math.abs(Math.sin(φ)) * corre;
    p.torsoX = 0.1 * Math.sin(φ + 1) * corre;
    p.cabezaX += 0.08 * Math.sin(2 * φ) * corre;
    p.cabezaY = Math.sin(this.t * 0.8 + this.id) * 0.25 * (1 - corre);
    p.boca = 0.55 + 0.3 * corre;
    const apoyo = 0.45;
    const pisada = (u: number) => {
      // apoyada: la pata va de delante a atrás respecto al cuerpo; en el aire vuelve y se levanta
      if (u < apoyo) return { avance: zancada * (0.5 - u / apoyo), alto: 0 };
      const k = (u - apoyo) / (1 - apoyo);
      return { avance: zancada * (k - 0.5), alto: 0.12 * H * Math.sin(Math.PI * k) * Math.min(1, corre * 3) };
    };
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const desfase = i === 0 ? 0 : 0.08;
      const hom = m.hombros[i].getWorldPosition(new THREE.Vector3());
      const cad = m.caderas[i].getWorldPosition(new THREE.Vector3());
      const delante = pisada((this.faseGalope + desfase) % 1);
      const detras = pisada((this.faseGalope + 0.5 + desfase) % 1);
      p.ikMano[i] = hom.addScaledVector(frente, 0.05 * H + delante.avance).addScaledVector(lado, s * 0.04 * H).setY(0.045 * H + delante.alto);
      p.ikPie[i] = cad.addScaledVector(frente, 0.08 * H + detras.avance).addScaledVector(lado, s * 0.02 * H).setY(0.035 * H + detras.alto);
    }

    // Mira a su presa
    if (this.objetivo && this.estado !== 'cegado') {
      const local = this.modelo.raiz.worldToLocal(this.objetivo.posicion.clone());
      p.cabezaY = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.8, 0.8);
    }
    if (this.estado === 'cegado') {
      p.cabezaY = Math.sin(this.t * 2.6) * 0.7;
      p.boca = 0.8;
    }

    if (ag) {
      switch (ag.fase) {
        case 'agazapar': {
          // se encoge sobre las patas, cabeza al suelo: aviso de que va a saltar
          const k = THREE.MathUtils.smoothstep(ag.t, 0, AVISO_SALTO);
          p.pelvisY -= 0.12 * H * k;
          p.pelvisX = a + 0.12 * k;
          p.cabezaX -= 0.15 * k;
          p.boca = 0.9;
          break;
        }
        case 'salto':
          // estirado en el aire: brazos al frente, piernas atrás
          for (let i = 0; i < 2; i++) {
            const s = i === 0 ? 1 : -1;
            const hom = m.hombros[i].getWorldPosition(new THREE.Vector3());
            const cad = m.caderas[i].getWorldPosition(new THREE.Vector3());
            p.ikMano[i] = hom.addScaledVector(frente, 0.32 * H).addScaledVector(lado, s * 0.06 * H).add(new THREE.Vector3(0, -0.12 * H, 0));
            p.ikPie[i] = cad.addScaledVector(frente, -0.3 * H).addScaledVector(lado, s * 0.03 * H).add(new THREE.Vector3(0, -0.12 * H, 0));
          }
          p.pelvisX = a + 0.15;
          p.boca = 1;
          break;
        case 'zarandeo':
          p.cabezaY = 0.55 * Math.sin(ag.t * 15);
          p.cabezaX -= 0.25;
          p.boca = 0.35;
          p.torsoX += 0.08 * Math.sin(ag.t * 15);
          break;
        case 'recuperar':
          p.pelvisY -= 0.05 * H * (1 - THREE.MathUtils.smoothstep(ag.t, 0, 1.2));
          p.boca = 0.3;
          break;
        case 'masticar':
          p.boca = 0.35 + 0.35 * Math.abs(Math.sin(ag.t * 9));
          p.cabezaX += 0.1 + 0.08 * Math.sin(ag.t * 9);
          break;
      }
    }
    if (this.tTambaleo > 0) p.torsoZ += Math.sin(this.t * 14) * 0.1;
    return p;
  }

  /** Suavizado de la pose hacia `p` (exponencial, independiente de los FPS). */
  private suavizar(p: PoseTitan, dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    const cur = this.pose;
    const mezclar = (x: number, y: number) => x + (y - x) * k;
    cur.pelvisY = mezclar(cur.pelvisY, p.pelvisY);
    cur.pelvisX = mezclar(cur.pelvisX, p.pelvisX);
    cur.pelvisZ = mezclar(cur.pelvisZ, p.pelvisZ);
    cur.torsoX = mezclar(cur.torsoX, p.torsoX);
    cur.torsoY = mezclar(cur.torsoY, p.torsoY);
    cur.torsoZ = mezclar(cur.torsoZ, p.torsoZ);
    cur.cabezaX = mezclar(cur.cabezaX, p.cabezaX);
    cur.cabezaY = mezclar(cur.cabezaY, p.cabezaY);
    cur.cabezaZ = mezclar(cur.cabezaZ, p.cabezaZ);
    cur.boca = mezclar(cur.boca, p.boca);
    for (let i = 0; i < 2; i++) {
      cur.cadera[i] = mezclar(cur.cadera[i], p.cadera[i]);
      cur.caderaZ[i] = mezclar(cur.caderaZ[i], p.caderaZ[i]);
      cur.rodilla[i] = mezclar(cur.rodilla[i], p.rodilla[i]);
      cur.tobillo[i] = mezclar(cur.tobillo[i], p.tobillo[i]);
      cur.hombroX[i] = mezclar(cur.hombroX[i], p.hombroX[i]);
      cur.hombroZ[i] = mezclar(cur.hombroZ[i], p.hombroZ[i]);
      cur.codo[i] = mezclar(cur.codo[i], p.codo[i]);
      cur.ikMano[i] = p.ikMano[i];
      cur.ikPie[i] = p.ikPie[i];
    }
  }

  // ─────────────────────────── Muerte ───────────────────────────

  private morirPaso(dt: number): void {
    this.tMuerte += dt;
    const t = this.tMuerte;
    const caer = Math.pow(THREE.MathUtils.clamp(t / 1.6, 0, 1), 2);
    this.pose.boca = 0.6;
    this.pose.ikMano = [null, null];
    this.pose.ikPie = [null, null];
    this.alturaSaltoActual = 0;
    if (this.cuadrupedo) {
      // se desploma de lado con las patas encogidas
      this.pose.caidaLado = 1.4 * caer;
      this.pose.pelvisY = THREE.MathUtils.lerp(this.pose.pelvisY, 0.1 * this.altura - this.modelo.L.cadera, Math.min(1, dt * 3));
      this.pose.cadera = [-1.1, -0.9];
      this.pose.rodilla = [1.3, 1.1];
      this.pose.hombroX = [-1.3, -1.1];
      this.pose.codo = [-0.9, -0.7];
    } else {
      // cae hacia delante en ~1,6 s y se queda tendido mientras se evapora
      this.pose.caida = 1.45 * caer;
      this.pose.hombroX = [-0.6, -0.4];
      this.pose.rodilla = [0.3, 0.5];
    }
    if (t > 1.6 && t - dt <= 1.6) this.ctx.efectos.vapor(this.posicion.clone().setY(1), 20, this.altura * 0.2, 6);
    this.modelo.evaporacion(THREE.MathUtils.clamp((t - 2) / 10, 0, 1));
    if (t > 6 && !this.sinColisiones) this.quitarColisiones();
    if (t > 12) {
      this.terminado = true;
      this.estado = 'muerto';
      return;
    }
    this.colocarRaiz();
    this.modelo.aplicar(this.pose);
    if (!this.sinColisiones) this.sincronizarCuerpos(false);
  }

  private quitarColisiones(): void {
    this.sinColisiones = true;
    for (const c of this.cuerpos) this.ctx.fisica.eliminarCuerpo(c.cuerpo);
    this.cuerpos.length = 0;
  }

  /** Quita el titán del mundo por completo (fin de la evaporación o limpieza de capítulo). */
  eliminar(): void {
    this.soltarVictima();
    if (!this.sinColisiones) this.quitarColisiones();
    this.modelo.liberar();
    this.terminado = true;
  }

  // ─────────────────────────── Sincronización ───────────────────────────

  private colocarRaiz(): void {
    this.modelo.raiz.position.copy(this.posicion);
    this.modelo.raiz.position.y += this.alturaSaltoActual;
    this.modelo.raiz.rotation.y = this.rumbo;
  }

  private sincronizarCuerpos(inmediato: boolean): void {
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const esc = new THREE.Vector3();
    for (const c of this.cuerpos) {
      c.marco.matrixWorld.decompose(pos, q, esc);
      if (inmediato) {
        c.cuerpo.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        c.cuerpo.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
      c.cuerpo.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
      c.cuerpo.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  /** Recoloca los puntos débiles desde los huesos del modelo. */
  private actualizarPuntos(): void {
    const m = this.modelo;
    const L = m.L;
    const H = this.altura;
    const conMatriz = (pt: Punto, obj: THREE.Object3D, x: number, y: number, z: number, normal: THREE.Vector3, eje: THREE.Vector3) => {
      pt.centro.set(x, y, z).applyMatrix4(obj.matrixWorld);
      const q = obj.getWorldQuaternion(new THREE.Quaternion());
      pt.normal.copy(normal).applyQuaternion(q);
      pt.eje.copy(eje).applyQuaternion(q);
    };
    const atras = new THREE.Vector3(0, 0, -1);
    const delante = new THREE.Vector3(0, 0, 1);
    const arriba = new THREE.Vector3(0, 1, 0);
    const lateral = new THREE.Vector3(1, 0, 0);
    conMatriz(this.punto('nuca'), m.cuello, 0, m.p.cuelloAlto * 0.7 * H, -0.06 * H, atras, arriba);
    const rp = m.p.radioPierna * H;
    conMatriz(this.punto('tendonIzq'), m.tobillos[0], 0, 0.04 * H, -rp * 0.8, atras, arriba);
    conMatriz(this.punto('tendonDer'), m.tobillos[1], 0, 0.04 * H, -rp * 0.8, atras, arriba);
    conMatriz(this.punto('corvaIzq'), m.rodillas[0], 0, 0.02 * H, -rp * 0.9, atras, arriba);
    conMatriz(this.punto('corvaDer'), m.rodillas[1], 0, 0.02 * H, -rp * 0.9, atras, arriba);
    conMatriz(this.punto('ojoIzq'), m.cabeza, 0.35 * L.rc, 0.1 * L.rc, 0.92 * L.rc, delante, lateral);
    conMatriz(this.punto('ojoDer'), m.cabeza, -0.35 * L.rc, 0.1 * L.rc, 0.92 * L.rc, delante, lateral);
    conMatriz(this.punto('brazoIzq'), m.hombros[0], 0, -0.03 * H, -0.02 * H, atras, arriba);
    conMatriz(this.punto('brazoDer'), m.hombros[1], 0, -0.03 * H, -0.02 * H, atras, arriba);
    conMatriz(this.punto('manoIzq'), m.manos[0], 0, -0.03 * H, 0, delante, arriba);
    conMatriz(this.punto('manoDer'), m.manos[1], 0, -0.03 * H, 0, delante, arriba);
    conMatriz(this.punto('mandibula'), m.cabeza, 0, -0.4 * L.rc, 0.85 * L.rc, delante, lateral);
    conMatriz(this.punto('cuerpo'), m.torso, 0, (L.hombroY - L.cadera) * 0.5, 0, delante, arriba);
  }

  /** Mano útil con la que atrapa (para el HUD: destello antes del cierre). */
  get avisando(): boolean {
    return this.agarre?.fase === 'aviso' || this.agarre?.fase === 'agazapar';
  }
}
