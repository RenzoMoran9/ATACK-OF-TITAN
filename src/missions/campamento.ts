import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { umbralNuca, umbralZona } from '../combat/corte';
import type { ContextoJuego } from '../core/contexto';
import type { FuerteAPI, Humano, JugadorAPI, TitanAPI, ZonaTitan } from '../core/tipos';
import { COLOR_AVISO, textoAviso } from '../npc/logicaOrdenes';
import { texturaParticula } from '../world/texturas';
import {
  ALTO_ADARVE,
  ALTO_MURO,
  ANCHO_PUERTA,
  DESGASTE_ALAMBRE,
  FRENO_ALAMBRE,
  NUM_POSTES,
  RADIO_CARPAS,
  RADIO_CERCO,
  VIDA_ALAMBRE,
  aguja,
  anguloTramo,
  avanceGolpe,
  calidadGolpe,
  dentroEmpalizada,
  desvioPorPuerta,
  nuevaZona,
  puntosCerco,
  tramoDe,
  type Golpe,
} from './logicaCampamento';
import { Silueta } from './silueta';

/**
 * Campamento fortificado de la Legión que montas donde quieras (K), a cualquier hora, y que se
 * levanta solo en unos 25 s (tramo a tramo desde la puerta, la atalaya y las carpas): una
 * empalizada redonda de troncos afilados con su adarve (pasarela interior a 2,2 m desde la que se
 * ve por encima del muro), dos escaleras, una atalaya junto a la puerta, cuatro cañones sobre el
 * adarve, una corona de estacas por fuera y, dentro, un corro de carpas alrededor de la hoguera.
 *
 * Mientras se levanta, el escuadrón espera dentro.
 *
 * Terminado:
 * - La empalizada es maciza (colisionadores reales): nadie la atraviesa. Se entra por la puerta,
 *   que se abre sola (la hoja se hunde en el suelo) cuando tú o un soldado os acercáis y se
 *   cierra cuando os alejáis. Los titanes no la abren, no pisan el recinto y no pueden agarrar a
 *   nadie dentro. Por arriba está abierta: ves todo alrededor desde el adarve o la atalaya.
 * - El titán que llega a la empalizada se clava las estacas: se enreda, se hiere las piernas y las
 *   latas de alarma suenan. Las estacas se van rompiendo con cada titán.
 * - Los vigías avisan de cada titán que se acerca (dirección y tamaño) con una bengala roja.
 * - Cañones con apuntado automático (rodillas del titán en pie, nuca del caído) que disparas tú
 *   con T desde dentro. Cada uno tarda 5 s en recargarse.
 * - Es un refugio: puedes dormir (H) y reaparecer allí. El escuadrón espera dentro y solo sale a
 *   pelear si le ordenas atacar.
 */

type TipoObra = 'tramo' | 'carpa' | 'torre';

interface Obra {
  pos: THREE.Vector3;
  rot: number;
  progreso: number;
  malla: THREE.Object3D;
  tipo: TipoObra;
  /** Índice del tramo de empalizada (solo tramos). */
  tramo?: number;
}

export interface EstadoGuardadoCampamento {
  x: number;
  z: number;
  /** Progreso de cada tramo de empalizada (antes, postes del cerco). */
  postes: number[];
  carpas: number[];
  /** Vida de las estacas (antes, del alambre). */
  alambre: number;
  /** Orientación del campamento (rad): hacia dónde mira la puerta. */
  giro?: number;
  torre?: number;
}

interface Canon {
  tramo: number;
  /** Gira hacia el blanco (guiñada y elevación limitadas por la tronera). */
  pivote: THREE.Group;
  /** El tubo con sus anillos: retrocede al disparar. */
  tubo: THREE.Group;
  /** Cureña: gira solo en horizontal, con el tubo. */
  base: THREE.Group;
  material: THREE.MeshLambertMaterial;
  boca: THREE.Object3D;
  fogonazo: THREE.Sprite;
  rumbo: number;
  recarga: number;
  /** Retroceso (0–1) tras el disparo. */
  retroceso: number;
  /** Vida del cañón: si los titanes lo destrozan, deja de disparar hasta que lo reparan. */
  vida: number;
  roto: boolean;
  tSinTitanes: number;
}

interface Bala {
  malla: THREE.Mesh;
  desde: THREE.Vector3;
  titan: TitanAPI;
  zona: ZonaTitan;
  /** Punto de impacto (se actualiza mientras vuela: sigue al titán). */
  hasta: THREE.Vector3;
  duracion: number;
  t: number;
}

/** Vida que le van quitando los cañonazos a un titán (0–1) y su barra sobre la cabeza. */
interface VidaTitan {
  vida: number;
  tGolpe: number;
  fondo: THREE.Sprite;
  barra: THREE.Sprite;
}

const MADERA = new THREE.MeshLambertMaterial({ color: '#6b4c30' });
const TRONCO = new THREE.MeshLambertMaterial({ color: '#5a4029' });
const PUNTA = new THREE.MeshLambertMaterial({ color: '#8a6a45' });
const TABLA = new THREE.MeshLambertMaterial({ color: '#80603f' });
const HIERRO = new THREE.MeshLambertMaterial({ color: '#2e3034' });
const LONA = new THREE.MeshLambertMaterial({ color: '#d9cfb2', side: THREE.DoubleSide });
const LONA_VERDE = new THREE.MeshLambertMaterial({ color: '#5d6e4a', side: THREE.DoubleSide });
const ESTANDARTE = new THREE.MeshLambertMaterial({ color: '#2f4a2a', side: THREE.DoubleSide });
const LATA = new THREE.MeshLambertMaterial({ color: '#9aa0a6' });
const PIEDRA = new THREE.MeshLambertMaterial({ color: '#8f8a80' });
const BALA = new THREE.MeshLambertMaterial({ color: '#202020' });
const BRONCE = new THREE.MeshLambertMaterial({ color: '#3a3326' });

const N = NUM_POSTES;
const PASO = (Math.PI * 2) / N;
const APOTEMA = RADIO_CERCO * Math.cos(PASO / 2);
const CUERDA = 2 * RADIO_CERCO * Math.sin(PASO / 2);
/** Adarve: centro y anchura de la pasarela (por dentro del muro). */
const ANCHO_ADARVE = 1.4;
const R_ADARVE = APOTEMA - 0.3 - ANCHO_ADARVE / 2;
const R_ESTACAS = RADIO_CERCO + 1.9;
const TRAMOS_ESCALERA = [4, 8];
const TRAMOS_CANON = [2, 5, 7, 10];
const TRAMO_TORRE = 11;
/** Radio de la atalaya (separada del adarve para que no se toquen). */
const R_TORRE = 8.8;
const ALTO_TORRE = 8.5;
const ALTO_PUERTA = 3.2;
/** Un aliado a esta distancia de la puerta la abre. */
const ALCANCE_PUERTA = 6.5;
/** Obra automática: cada pieza tarda DURACION_OBRA s y empieza PASO_OBRA s después de la anterior. */
const DURACION_OBRA = 3;
const PASO_OBRA = 1.15;
const RECARGA_CANON = 3;
/** Vida de cada tramo de empalizada y de cada cañón (los titanes que llegan los van rompiendo). */
const VIDA_TRAMO = 900;
const VIDA_CANON = 350;
/** Segundos sin titanes cerca para que un cañón destrozado vuelva a estar en servicio. */
const REPARA_CANON = 40;
/** Un tramo roto se rehace en este tiempo (más despacio que la obra nueva), si no hay titanes cerca. */
const DURACION_REPARACION = 14;
/** Primer ataque al campamento y tiempo entre ataques (s), mientras estés cerca de él. */
const PRIMER_ATAQUE = 150;
const ENTRE_ATAQUES: [number, number] = [300, 480];
/** Alcance de los cañones (m) y arco que cubre cada uno a cada lado de su tronera. */
const ALCANCE_CANON = 260;
const ARCO_CANON = (50 * Math.PI) / 180;
/** Velocidad de la bala (m/s): de lejos tarda en llegar. */
const VEL_BALA = 150;
/** Tronera: medio ancho del hueco en la empalizada y altura de los troncos rebajados. */
const MEDIA_TRONERA = 1.15;
const ALTO_TRONERA = 2.3;
/** Altura del eje del cañón sobre el suelo (adarve + plataforma + cureña). */
const ALTO_CANON = ALTO_ADARVE + 0.12 + 0.78;
/** Segundos sin cañonazos para que un titán empiece a regenerar la vida perdida. */
const REGEN_TITAN = 10;
const RADIO_AVISO = 260;
const PIERNAS: ZonaTitan[] = ['corvaIzq', 'corvaDer', 'tendonIzq', 'tendonDer'];

/** Giro en Y para que el eje X local de una pieza quede tangente al muro en el ángulo `a`. */
const giroTangente = (a: number) => -a - Math.PI / 2;

export class Campamento implements FuerteAPI {
  readonly centro: THREE.Vector3;
  readonly grupo = new THREE.Group();
  readonly obras: Obra[] = [];
  /** Vida de las estacas (0 = rotas). */
  alambre = VIDA_ALAMBRE;
  /** Martillo: zona verde actual y tiempo de la aguja. */
  zona = 0.5;
  tAguja = 0;
  /** Obra junto a la que está el jugador (o −1). */
  obraJugador = -1;
  /** Orientación: el tramo 0 (la puerta) está en `anguloTramo(0, giro)`. */
  readonly giro: number;

  private readonly troncos: THREE.InstancedMesh;
  private readonly puntas: THREE.InstancedMesh;
  private readonly datosTroncos: { x: number; z: number; tramo: number; alto: number; giro: number }[] = [];
  private readonly estacas: THREE.InstancedMesh;
  private readonly datosEstacas: { m: THREE.Matrix4; tramo: number }[] = [];
  private readonly latas: THREE.InstancedMesh;
  private readonly piezasTramo = new Map<number, THREE.Object3D[]>();
  private readonly collidersTramo = new Map<number, RAPIER.Collider[]>();
  private collidersTorre: RAPIER.Collider[] = [];
  private readonly fuego: THREE.Sprite;
  /** Orden en que se levantan las obras (índices de `obras`) y reloj de la obra. */
  private readonly ordenObras: number[] = [];
  private tObra = 0;
  /** Escala de la atalaya: 1 subiendo, −1 bajando, 0 nada; altura de los pies en la escala. */
  private subiendo = 0;
  private yEscala = 0;
  private esperaEscala = 0;
  private tMartillo = 0;
  private readonly heridas = new Map<number, number>();
  private readonly avisados = new Set<number>();
  private readonly canones: Canon[] = [];
  private readonly balas: Bala[] = [];
  private readonly geoBala = new THREE.SphereGeometry(0.3, 10, 8);
  private readonly vidas = new Map<TitanAPI, VidaTitan>();
  /** Vida de cada tramo de empalizada (los terminados empiezan llenos). */
  private readonly vidaTramo: number[] = Array.from({ length: N }, () => VIDA_TRAMO);
  private tAtaque = PRIMER_ATAQUE;
  private ataques = 0;
  private atacantes: TitanAPI[] = [];
  private hud: HTMLDivElement | null = null;
  private tHud = 0;
  private tAvisoBrecha = -99;
  private puerta: { hoja: THREE.Group; base: THREE.Vector3; alza: number; collider: RAPIER.Collider | null; navCerrada: boolean; tAbierta: number } | null = null;
  private tLatas = 0;
  private tAviso = -99;
  private tHerida = -99;
  private listoAvisado = false;
  private hechosPrevios = '';
  private t = 0;

  constructor(
    private readonly ctx: ContextoJuego,
    centro: THREE.Vector3,
    guardado?: EstadoGuardadoCampamento,
    giro = 0,
  ) {
    this.centro = centro.clone().setY(0);
    this.giro = guardado?.giro ?? giro;
    const c = this.centro;
    const postes = puntosCerco(c.x, c.z, N, RADIO_CERCO, this.giro);

    // ── Empalizada: troncos afilados (instanciados) en cada tramo; el tramo 0 lleva la puerta ──
    for (let i = 0; i < N; i++) {
      const a = postes[i];
      const b = postes[(i + 1) % N];
      const n = Math.floor(CUERDA / 0.36);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const lateral = (u - 0.5) * CUERDA;
        if (i === 0 && Math.abs(lateral) < ANCHO_PUERTA / 2 + 0.45) continue; // hueco de la puerta
        // tronera: los troncos delante de cada cañón, más bajos para que asome el tubo
        const tronera = TRAMOS_CANON.includes(i) && Math.abs(lateral) < MEDIA_TRONERA;
        const alto = tronera ? ALTO_TRONERA : ALTO_MURO + (Math.random() - 0.5) * 0.3;
        this.datosTroncos.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, tramo: i, alto, giro: Math.random() * Math.PI });
      }
      const ang = anguloTramo(i, this.giro);
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      // a pie de obra: por dentro del tramo
      const pos = c.clone().addScaledVector(dir, APOTEMA);
      const g = new THREE.Group();
      this.grupo.add(g);
      this.obras.push({ pos, rot: giroTangente(ang), progreso: guardado?.postes[i] ?? 0, malla: g, tipo: 'tramo', tramo: i });
      this.piezasTramo.set(i, []);
    }
    const geoTronco = new THREE.CylinderGeometry(0.18, 0.2, 1, 7).translate(0, 0.5, 0);
    const geoPunta = new THREE.ConeGeometry(0.18, 0.55, 7).translate(0, 0.27, 0);
    this.troncos = new THREE.InstancedMesh(geoTronco, TRONCO, this.datosTroncos.length);
    this.puntas = new THREE.InstancedMesh(geoPunta, PUNTA, this.datosTroncos.length);
    for (const m of [this.troncos, this.puntas]) {
      // sin recibir sombra: en mallas instanciadas tan juntas la sombra propia parpadea
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
      this.grupo.add(m);
    }

    // ── Adarve, escaleras, cañones y puerta: piezas de cada tramo (visibles al terminarlo) ──
    for (let i = 0; i < N; i++) this.construirTramo(i);

    // ── Corona de estacas cruzadas por fuera (instanciadas) y latas de alarma ──
    const geoEstaca = new THREE.ConeGeometry(0.12, 2.6, 5).translate(0, 1.3, 0);
    const nEstacas = 44;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let k = 0; k < nEstacas; k++) {
      const a = this.giro + (k / nEstacas) * Math.PI * 2;
      const tramo = tramoDe(c.x + Math.cos(a), c.z + Math.sin(a), c.x, c.z, this.giro);
      // nada delante de la puerta
      let dPuerta = a - anguloTramo(0, this.giro);
      dPuerta = Math.atan2(Math.sin(dPuerta), Math.cos(dPuerta));
      if (Math.abs(dPuerta) * R_ESTACAS < ANCHO_PUERTA / 2 + 1.5) continue;
      for (const lado of [-1, 1]) {
        // dos estacas en aspa, inclinadas hacia fuera
        e.set(0, giroTangente(a), 0, 'YXZ');
        q.setFromEuler(e);
        const inclina = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lado * 0.45);
        const fuera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.75);
        q.multiply(fuera).multiply(inclina);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(c.x + Math.cos(a) * R_ESTACAS, 0, c.z + Math.sin(a) * R_ESTACAS), q.clone(), new THREE.Vector3(1, 1, 1));
        this.datosEstacas.push({ m, tramo });
      }
    }
    this.estacas = new THREE.InstancedMesh(geoEstaca, PUNTA, this.datosEstacas.length);
    this.estacas.castShadow = true;
    this.estacas.frustumCulled = false;
    this.grupo.add(this.estacas);
    this.latas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 6), LATA, N);
    this.latas.count = 0;
    this.latas.frustumCulled = false;
    this.grupo.add(this.latas);

    // ── Carpas en corro (con la entrada hacia la hoguera), dejando libre el paso desde la puerta ──
    const nCarpas = 6;
    for (let i = 0; i < nCarpas; i++) {
      const a = anguloTramo(0, this.giro) + ((i + 1) / (nCarpas + 1)) * Math.PI * 2;
      const pos = new THREE.Vector3(c.x + Math.cos(a) * RADIO_CARPAS, 0, c.z + Math.sin(a) * RADIO_CARPAS);
      const g = new THREE.Group();
      const lona = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.8, 3, 1, true), i % 2 ? LONA : LONA_VERDE);
      lona.rotation.x = -Math.PI / 2;
      // la cara de abajo del prisma queda 3 cm sobre el suelo: pegada a él parpadeaba
      lona.position.y = 0.655;
      lona.castShadow = true;
      g.add(lona);
      const palo = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 5), MADERA);
      palo.position.set(0, 0.95, 1.35);
      g.add(palo);
      g.position.copy(pos);
      g.rotation.y = Math.atan2(c.x - pos.x, c.z - pos.z);
      this.grupo.add(g);
      this.obras.push({ pos, rot: g.rotation.y, progreso: guardado?.carpas[i] ?? 0, malla: g, tipo: 'carpa' });
    }

    // ── Atalaya junto a la puerta ──
    this.construirTorre(guardado?.torre ?? 0);

    // ── Hoguera: piedras en corro, troncos y una llama (sprite aditivo, sin luz real) ──
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const piedra = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.35), PIEDRA);
      piedra.position.set(c.x + Math.cos(a) * 0.9, 0.12, c.z + Math.sin(a) * 0.9);
      piedra.rotation.y = a;
      this.grupo.add(piedra);
    }
    for (let k = 0; k < 3; k++) {
      const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 6), MADERA);
      tronco.rotation.set(Math.PI / 2, (k * Math.PI) / 3, 0.25);
      tronco.position.set(c.x, 0.15, c.z);
      this.grupo.add(tronco);
    }
    this.fuego = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaParticula(), color: '#ffab4a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fuego.position.set(c.x, 0.7, c.z);
    this.grupo.add(this.fuego);

    // orden de obra: la puerta, luego los tramos de dos en dos hacia el fondo, la atalaya y las carpas
    this.ordenObras.push(0);
    for (let k = 1; k <= N / 2; k++) {
      this.ordenObras.push(k);
      if (N - k !== k) this.ordenObras.push(N - k);
    }
    this.obras.forEach((o, i) => {
      if (o.tipo === 'torre') this.ordenObras.push(i);
    });
    this.obras.forEach((o, i) => {
      if (o.tipo === 'carpa') this.ordenObras.push(i);
    });
    this.alambre = guardado?.alambre ?? VIDA_ALAMBRE;
    this.listoAvisado = this.completo;
    // mientras se levanta, el escuadrón espera dentro
    if (!this.completo) for (const s of ctx.escuadron.soldados) ctx.escuadron.trabajarEn(s, null, this.centro);
    ctx.escena.add(this.grupo);
    ctx.fuerte = this;
    this.zona = nuevaZona(Math.random);
    this.dibujarObras();
  }

  // ─────────────────────────── Estado ───────────────────────────

  /** Tramos de empalizada terminados (en orden). */
  get postesHechos(): boolean[] {
    return this.obras.filter((o) => o.tipo === 'tramo').map((o) => o.progreso >= 1);
  }

  /** Terminado alguna vez: sigue siendo un campamento en servicio aunque le abran brechas. */
  get listo(): boolean {
    return this.listoAvisado || this.completo;
  }

  /** Todas las obras en pie ahora mismo (sin brechas). */
  get completo(): boolean {
    return this.obras.every((o) => o.progreso >= 1);
  }

  /** Progreso total de la obra (0–1). */
  get progreso(): number {
    return this.obras.reduce((n, o) => n + Math.min(1, o.progreso), 0) / this.obras.length;
  }

  /** Aguja del martillo (0–1) ahora mismo. */
  get aguja(): number {
    return aguja(this.tAguja);
  }

  // ─────────────────────────── FuerteAPI ───────────────────────────

  dentro(p: THREE.Vector3): boolean {
    return dentroEmpalizada(this.centro.x, this.centro.z, p.x, p.z) && p.y < ALTO_TORRE + 5;
  }

  protege(p: THREE.Vector3): boolean {
    return this.empalizadaCerrada && this.dentro(p);
  }

  bloquea(x: number, z: number, r: number): boolean {
    const d = Math.hypot(x - this.centro.x, z - this.centro.z);
    // la empalizada y la corona de estacas: los titanes se quedan fuera
    if (d > R_ESTACAS + 0.6 + r) return false;
    if (this.empalizadaCerrada) return true;
    if (d < APOTEMA - 0.6 - r) return false;
    const i = tramoDe(x, z, this.centro.x, this.centro.z, this.giro);
    return i !== 0 && this.obras[i].progreso >= 1;
  }

  desvio(desde: THREE.Vector3, meta: THREE.Vector3): THREE.Vector3 | null {
    if (!this.tramoHecho(0)) return null;
    const d = desvioPorPuerta(this.centro.x, this.centro.z, this.giro, desde, meta);
    return d ? new THREE.Vector3(d.x, Math.max(desde.y, 0.9), d.z) : null;
  }

  puesto(i: number, n: number): THREE.Vector3 {
    const a = anguloTramo(0, this.giro) + Math.PI + ((i + 0.5) / Math.max(1, n)) * Math.PI * 2;
    return new THREE.Vector3(this.centro.x + Math.cos(a) * 3.6, 0.9, this.centro.z + Math.sin(a) * 3.6);
  }

  /** Todos los tramos de empalizada en pie (la puerta incluida). */
  private get empalizadaCerrada(): boolean {
    return this.postesHechos.every(Boolean);
  }

  private tramoHecho(i: number): boolean {
    return this.obras[i].progreso >= 1;
  }

  // ─────────────────────────── Acciones ───────────────────────────

  /** Martillazo del jugador sobre la obra que tiene al lado. Devuelve la calidad o null si no hay obra. */
  martillazo(): Golpe | null {
    const o = this.obras[this.obraJugador];
    if (!o || o.progreso >= 1) return null;
    const g = calidadGolpe(this.aguja, this.zona);
    o.progreso = Math.min(1, o.progreso + avanceGolpe(g));
    this.zona = nuevaZona(Math.random);
    this.ctx.efectos.vapor(o.pos.clone().setY(0.3), g === 'fallo' ? 2 : 5, 0.5, 1.5);
    this.ctx.eventos.emit({ tipo: 'martillazo', pos: o.pos.clone().setY(1), golpe: g });
    this.dibujarObras();
    return g;
  }

  /** T: dispara los cañones cargados que tengan un titán a tiro (solo desde dentro). Devuelve el mensaje. */
  disparar(): string {
    const j = this.ctx.jugador;
    if (!this.dentro(j.posicion)) return 'Los cañones se disparan desde dentro del campamento';
    const montados = this.canones.filter((k) => this.tramoHecho(k.tramo));
    if (montados.length === 0) return 'Aún no hay cañones montados';
    const listos = montados.filter((k) => !k.roto);
    if (listos.length === 0) return '¡Los cañones están destrozados! Se reparan cuando no haya titanes cerca';
    const usados = new Set<TitanAPI>();
    let disparos = 0;
    let hayObjetivo = false;
    for (const k of listos) {
      const t = this.objetivoDe(k, usados);
      if (!t) continue;
      hayObjetivo = true;
      if (k.recarga > 0) continue;
      usados.add(t);
      this.dispararCanon(k, t);
      disparos++;
    }
    if (disparos > 0) return `¡Fuego! (${disparos} ${disparos === 1 ? 'cañón' : 'cañones'})`;
    return hayObjetivo ? 'Los cañones se están recargando' : 'Ningún titán a tiro de los cañones';
  }

  // ─────────────────────────── Paso de juego ───────────────────────────

  actualizar(dt: number): void {
    this.t += dt;
    this.tAguja += dt;
    this.construir(dt);
    this.escala(dt);
    this.puertaAutomatica(dt);
    this.estacasAtacadas(dt);
    this.asedio(dt);
    this.repararCanones(dt);
    this.ataquesAlCampamento(dt);
    this.actualizarHud(dt);
    this.vigias();
    for (const k of this.canones) k.recarga = Math.max(0, k.recarga - dt);
    this.expulsarTitanes();
    this.regenerarVidas(dt);
    // la hoguera crepita
    const f = 1 + 0.18 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3);
    this.fuego.scale.set(1.3 * f, 1.8 * f, 1);
    this.fuego.visible = this.listo;
    if (this.completo && !this.listoAvisado) {
      this.listoAvisado = true;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: 'Campamento listo: sube al adarve o a la atalaya para vigilar; T dispara los cañones', segundos: 4 });
      this.liberarEscuadron();
    }
  }

  /** Cada fotograma: cañones hacia su blanco, balas en vuelo y barras de vida de los titanes tocados. */
  dibujar(dt: number): void {
    const usados = new Set<TitanAPI>();
    for (const k of this.canones) {
      if (!this.tramoHecho(k.tramo)) continue;
      if (k.roto) {
        // destrozado: el tubo cae de morro sobre la cureña, negro y humeante
        k.pivote.rotation.set(0.45, Math.PI / 2 - k.rumbo, 0, 'YXZ');
        k.material.color.setRGB(0.08, 0.08, 0.08);
        if (Math.random() < dt * 3) this.ctx.efectos.vapor(k.pivote.position.clone().setY(k.pivote.position.y + 0.4), 1, 0.6, 0.8);
        continue;
      }
      const t = this.objetivoDe(k, usados);
      if (t) usados.add(t);
      this.apuntar(k, t ? this.puntoDeTiro(t) : null);
      k.retroceso = Math.max(0, k.retroceso - dt * 1.6);
      k.tubo.position.z = -0.45 * Math.sin(Math.min(1, k.retroceso) * Math.PI * 0.5);
      k.fogonazo.visible = k.retroceso > 0.82;
      k.fogonazo.scale.setScalar(1.2 + 2.5 * (1 - k.retroceso));
      k.material.color.setRGB(0.16 + 0.4 * Math.min(1, k.recarga / RECARGA_CANON), 0.16, 0.17);
    }
    // balas: parábola hacia el punto del titán (que se mueve mientras vuelan)
    for (let i = this.balas.length - 1; i >= 0; i--) {
      const b = this.balas[i];
      b.t += dt / b.duracion;
      if (b.titan.vivo) {
        const p = b.titan.puntosDebiles.find((x) => x.zona === b.zona);
        if (p) b.hasta.copy(p.centro);
      }
      const u = Math.min(1, b.t);
      const arco = 4 * u * (1 - u) * Math.min(25, b.desde.distanceTo(b.hasta) * 0.06);
      b.malla.position.lerpVectors(b.desde, b.hasta, u).y += arco;
      if (Math.random() < 0.5) this.ctx.efectos.vapor(b.malla.position, 1, 0.35, 0.3);
      if (b.t >= 1) {
        b.malla.removeFromParent();
        this.balas.splice(i, 1);
        this.impacto(b);
      }
    }
    this.dibujarVidas();
  }

  /** Barra de vida (cañonazos) sobre la cabeza de cada titán tocado; se recupera si dejan de darle. */
  private dibujarVidas(): void {
    const camara = this.ctx.camara;
    const derecha = new THREE.Vector3().setFromMatrixColumn(camara.matrixWorld, 0);
    for (const [t, v] of this.vidas) {
      if (!t.vivo || v.vida >= 1) {
        v.fondo.removeFromParent();
        v.barra.removeFromParent();
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

  /**
   * Obra automática: los tramos de empalizada se levantan uno tras otro desde la puerta hacia el
   * fondo, luego la atalaya y las carpas (unos 25 s en total), con polvo y martillazos.
   */
  private construir(dt: number): void {
    if (this.completo) return;
    this.tObra += dt;
    this.tMartillo -= dt;
    let activa: Obra | null = null;
    this.ordenObras.forEach((i, k) => {
      const o = this.obras[i];
      if (o.progreso >= 1 || this.tObra < k * PASO_OBRA) return;
      // con titanes encima no se puede trabajar; lo roto se rehace más despacio que lo nuevo
      if (this.ctx.poblacion.titanesCerca(o.pos, 30).some((t) => t.vivo)) return;
      o.progreso = Math.min(1, o.progreso + dt / (this.listoAvisado ? DURACION_REPARACION : DURACION_OBRA));
      activa = o;
    });
    const o = activa as Obra | null;
    if (!o) return;
    if (this.tMartillo <= 0) {
      this.tMartillo = 0.35 + Math.random() * 0.2;
      this.ctx.efectos.vapor(o.pos.clone().setY(0.2), 3, 0.5, 1.2);
      this.ctx.eventos.emit({ tipo: 'martillazo', pos: o.pos.clone().setY(1), golpe: 'bueno' });
    }
    this.dibujarObras();
  }

  /**
   * Escala de la atalaya: al pie de ella, sube sola hasta la plataforma; arriba, junto a la
   * trampilla, baja sola al suelo. (Se puede subir también con los ganchos o el salto con gas.)
   */
  private escala(dt: number): void {
    const torre = this.obras.find((o) => o.tipo === 'torre');
    const j = this.ctx.jugador as JugadorAPI & { montado?: boolean };
    if (!torre || torre.progreso < 1 || !j.vivo || j.agarradoPor || j.montado) {
      this.subiendo = 0;
      return;
    }
    const g = torre.malla;
    g.updateMatrixWorld();
    const pie = g.localToWorld(new THREE.Vector3(0, 0, 1.4 + 0.55));
    const arriba = g.localToWorld(new THREE.Vector3(0, ALTO_TORRE + 0.1, 0.2));
    const trampilla = g.localToWorld(new THREE.Vector3(0, ALTO_TORRE, 1.1));
    const p = j.posicion;
    const yPies = p.y - 0.9;
    if (this.subiendo === 0) {
      const enPie = Math.hypot(p.x - pie.x, p.z - pie.z) < 0.9 && yPies < 1;
      const enTrampilla = Math.hypot(p.x - trampilla.x, p.z - trampilla.z) < 0.7 && Math.abs(yPies - ALTO_TORRE) < 0.6;
      if (this.esperaEscala > 0) {
        // no vuelve a engancharse hasta que se aparte de la escala
        if (!enPie && !enTrampilla) this.esperaEscala = 0;
        return;
      }
      if (enPie) {
        this.subiendo = 1;
        this.yEscala = Math.max(0, yPies);
      } else if (enTrampilla) {
        this.subiendo = -1;
        this.yEscala = ALTO_TORRE;
      } else return;
    }
    this.yEscala += this.subiendo * 3.2 * dt;
    if (this.subiendo > 0 && this.yEscala >= ALTO_TORRE + 0.15) {
      j.teletransportar(arriba);
      this.subiendo = 0;
      this.esperaEscala = 1;
      return;
    }
    if (this.subiendo < 0 && this.yEscala <= 0) {
      j.teletransportar(pie.clone().setY(0));
      this.subiendo = 0;
      this.esperaEscala = 1;
      return;
    }
    j.teletransportar(pie.clone().setY(this.yEscala));
  }

  /** Terminado: el escuadrón espera dentro del campamento (y solo sale si le mandas atacar). */
  private liberarEscuadron(): void {
    for (const s of this.ctx.escuadron.soldados) this.ctx.escuadron.trabajarEn(s, null, this.centro);
  }

  /** La puerta se abre sola con un aliado cerca y se cierra sin él. Los titanes no la abren. */
  private puertaAutomatica(dt: number): void {
    const p = this.puerta;
    if (!p || !this.tramoHecho(0)) return;
    // se abre con un aliado a 6,5 m; no empieza a cerrarse hasta que no quede nadie a 8 m durante 1,5 s
    // (así no sube y baja sin parar con alguien rondando el borde)
    const cerca = (r: number) => (h: Humano) => h.vivo && !h.agarradoPor && Math.hypot(h.posicion.x - p.base.x, h.posicion.z - p.base.z) < r && h.posicion.y < 6;
    const hay = (r: number) => cerca(r)(this.ctx.jugador) || this.ctx.escuadron.soldados.some(cerca(r));
    if (hay(ALCANCE_PUERTA) || (p.alza > 0 && hay(ALCANCE_PUERTA + 1.5))) p.tAbierta = this.t;
    const abrir = this.t - p.tAbierta < 1.5;
    const antes = p.alza;
    p.alza = THREE.MathUtils.clamp(p.alza + (abrir ? 1 : -1) * dt * 1.6, 0, 1);
    p.hoja.position.y = -p.alza * (ALTO_PUERTA - 0.08);
    if (p.alza > 0.5 && p.collider) {
      this.ctx.fisica.eliminarCollider(p.collider);
      p.collider = null;
    } else if (p.alza <= 0 && !p.collider) p.collider = this.colliderPuerta();
    // en la rejilla de navegación la puerta solo cuenta como paso mientras está abierta
    const cerrada = p.alza < 0.5;
    if (cerrada !== p.navCerrada) {
      p.navCerrada = cerrada;
      this.marcarNavTramo(0, cerrada ? 1 : 0);
    }
    if ((antes === 0) !== (p.alza === 0)) this.ctx.eventos.emit({ tipo: 'puertaFuerte', pos: p.base.clone().setY(1.5) });
  }

  /** El titán que llega a la empalizada se clava las estacas: se enreda, se hiere las piernas y las latas suenan. */
  private estacasAtacadas(dt: number): void {
    if (this.alambre <= 0) return;
    const c = this.centro;
    this.tLatas -= dt;
    for (const t of this.ctx.poblacion.titanesCerca(c, R_ESTACAS + 12)) {
      if (!t.vivo || t instanceof Silueta) continue;
      const d = Math.hypot(t.posicion.x - c.x, t.posicion.z - c.z);
      if (d > R_ESTACAS + 1.5 + t.altura * 0.12) continue;
      const tramo = tramoDe(t.posicion.x, t.posicion.z, c.x, c.z, this.giro);
      if (!this.tramoHecho(tramo)) continue;
      t.enredar?.(1.2, FRENO_ALAMBRE);
      this.alambre -= DESGASTE_ALAMBRE * 0.06 * dt;
      if (this.tLatas <= 0) {
        this.tLatas = 1.2;
        this.ctx.eventos.emit({ tipo: 'alambre', pos: t.posicion.clone().setY(1) });
      }
      // cada 1,6 s, una estaca le atraviesa una pierna (tendón o corva: cojea o cae de rodillas)
      // al Acorazado las estacas le rebotan en la coraza: solo lo frenan
      if (t.especial !== 'acorazado' && t.estado !== 'derribado' && this.t - (this.heridas.get(t.id) ?? -9) > 1.6) {
        const zonas = PIERNAS.filter((z) => t.puntosDebiles.some((p) => p.zona === z && p.activo));
        if (zonas.length) {
          this.heridas.set(t.id, this.t);
          const z = zonas[Math.floor(Math.random() * zonas.length)];
          t.recibirCorte(z, umbralZona(z, t.altura) * 1.15, null);
          const p = t.puntosDebiles.find((x) => x.zona === z);
          if (p) this.ctx.efectos.sangre(p.centro.clone(), new THREE.Vector3(0, 1, 0), 10);
          if (this.t - this.tHerida > 5) {
            this.tHerida = this.t;
            this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Un titán se clava las estacas de la empalizada!', segundos: 2.5 });
          }
        }
      }
      if (this.alambre <= 0) {
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Han roto las estacas! La empalizada aguanta', segundos: 2.5 });
        this.hechosPrevios = '';
        this.dibujarObras();
        return;
      }
    }
  }

  /** Los vigías avisan de cada titán que se acerca (dirección respecto a ti) con una bengala roja. */
  private vigias(): void {
    if (!this.listo || this.t - this.tAviso < 2.5) return;
    const j = this.ctx.jugador.posicion;
    if (Math.hypot(j.x - this.centro.x, j.z - this.centro.z) > 90) return;
    for (const t of this.ctx.poblacion.titanesCerca(this.centro, RADIO_AVISO)) {
      if (!t.vivo || t instanceof Silueta || this.avisados.has(t.id)) continue;
      this.avisados.add(t.id);
      this.tAviso = this.t;
      const aTiro = this.canones.some((k) => this.tramoHecho(k.tramo) && this.objetivoDe(k, new Set()) === t);
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: textoAviso('Vigía', t, t.posicion.x - j.x, t.posicion.z - j.z) + (aTiro ? ' A tiro de cañón: T' : ''), segundos: 3.5 });
      const ang = anguloTramo(TRAMO_TORRE, this.giro);
      this.ctx.efectos.bengala(this.centro.clone().add(new THREE.Vector3(Math.cos(ang) * R_TORRE, ALTO_TORRE + 2, Math.sin(ang) * R_TORRE)), COLOR_AVISO);
      return;
    }
  }

  // ─────────────────────────── Cañones ───────────────────────────

  /** Titán más cercano dentro del arco y el alcance de este cañón (sin repetir los ya elegidos). */
  private objetivoDe(k: Canon, evitar: Set<TitanAPI>): TitanAPI | null {
    let mejor: TitanAPI | null = null;
    let dMejor = ALCANCE_CANON;
    const p = k.pivote.position;
    for (const t of this.ctx.poblacion.titanesCerca(p, ALCANCE_CANON)) {
      if (!t.vivo || t instanceof Silueta || evitar.has(t)) continue;
      const dx = t.posicion.x - p.x;
      const dz = t.posicion.z - p.z;
      let da = Math.atan2(dz, dx) - k.rumbo;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > ARCO_CANON) continue;
      const d = Math.hypot(dx, dz);
      if (d < 6) continue;
      if (d < dMejor) {
        dMejor = d;
        mejor = t;
      }
    }
    return mejor;
  }

  /** Orienta el cañón hacia `p` sin salirse de la tronera (o en reposo, hacia fuera). */
  private apuntar(k: Canon, p: THREE.Vector3 | null): void {
    const o = k.pivote.position;
    let guiñada = 0;
    let elevacion = 0.02;
    if (p) {
      let da = Math.atan2(p.z - o.z, p.x - o.x) - k.rumbo;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      guiñada = THREE.MathUtils.clamp(da, -ARCO_CANON, ARCO_CANON);
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      // un poco por encima del blanco: la bala cae en parábola
      elevacion = THREE.MathUtils.clamp(Math.atan2(p.y - o.y, d) + Math.min(0.12, d * 0.0005), -0.12, 0.35);
    }
    const a = k.rumbo + guiñada;
    k.base.rotation.y = Math.PI / 2 - a;
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(elevacion), Math.sin(elevacion), Math.sin(a) * Math.cos(elevacion));
    k.pivote.lookAt(o.clone().add(dir));
  }

  /** Nuca del titán caído; rodillas del que está en pie. */
  private zonaDeTiro(t: TitanAPI): ZonaTitan {
    const tumbado = t.estado === 'derribado' || t.estado === 'cegado';
    if (tumbado && t.puntosDebiles.some((p) => p.zona === 'nuca' && p.activo)) return 'nuca';
    return PIERNAS.find((z) => t.puntosDebiles.some((p) => p.zona === z && p.activo)) ?? 'cuerpo';
  }

  private puntoDeTiro(t: TitanAPI): THREE.Vector3 {
    const z = this.zonaDeTiro(t);
    return t.puntosDebiles.find((p) => p.zona === z)?.centro.clone() ?? t.posicion.clone().setY(t.altura * 0.4);
  }

  /** Fogonazo, retroceso y la bala en camino; el daño se aplica cuando llega. */
  private dispararCanon(k: Canon, t: TitanAPI): void {
    k.recarga = RECARGA_CANON;
    k.retroceso = 1;
    const zona = this.zonaDeTiro(t);
    const blanco = this.puntoDeTiro(t);
    this.apuntar(k, blanco);
    k.pivote.updateMatrixWorld(true);
    const boca = k.boca.getWorldPosition(new THREE.Vector3());
    const bala = new THREE.Mesh(this.geoBala, BALA);
    bala.position.copy(boca);
    bala.castShadow = true;
    this.ctx.escena.add(bala);
    const d = boca.distanceTo(blanco);
    this.balas.push({ malla: bala, desde: boca, titan: t, zona, hasta: blanco, duracion: Math.max(0.2, d / VEL_BALA), t: 0 });
    this.ctx.efectos.vapor(boca, 22, 1.4, 5);
    this.ctx.eventos.emit({ tipo: 'canon', pos: boca });
  }

  /**
   * La bala llega: rodillas del titán en pie (cojea o cae), nuca del caído, y siempre le quita vida.
   * Cuanto más grande el titán, más cañonazos aguanta (3 uno de 3 m, 6 uno de 15 m). Sin vida, muere.
   */
  private impacto(b: Bala): void {
    const t = b.titan;
    this.ctx.efectos.vapor(b.hasta, 12, 1 + t.altura * 0.06, 4);
    if (!t.vivo) return;
    const zona = t.puntosDebiles.some((p) => p.zona === b.zona && p.activo) ? b.zona : 'cuerpo';
    // los cambiantes encajan mucho mejor la bala: el Acorazado casi ni se inmuta
    const aguante = t.especial === 'acorazado' ? 0.08 : t.especial === 'hembra' ? 0.3 : 1;
    const danio = (zona === 'nuca' ? umbralNuca(t.altura) * 0.55 : zona === 'cuerpo' ? 1 : umbralZona(zona, t.altura) * 1.3) * aguante;
    const res = t.recibirCorte(zona, danio, this.ctx.jugador);
    if (res.efecto !== 'nada') this.ctx.efectos.sangre(b.hasta.clone(), b.hasta.clone().sub(b.desde).normalize(), 14);
    if (!t.vivo) return;
    this.quitarVida(t, this.danioCanon(t));
    // la metralla y la onda alcanzan a los que van al lado (la mitad)
    for (const otro of this.ctx.poblacion.titanesCerca(b.hasta, 8)) {
      if (otro !== t && otro.vivo && !(otro instanceof Silueta)) this.quitarVida(otro, this.danioCanon(otro) * 0.5);
    }
  }

  /**
   * Vida que quita un cañonazo: un titán normal cae con 2 (los pequeños) o 3 (los de 15 m). Los
   * cambiantes aguantan mucho más: la Hembra unos 6 y el Acorazado, con su coraza, unos 25.
   */
  private danioCanon(t: TitanAPI): number {
    const base = 1 / (1.4 + t.altura / 12);
    return t.especial === 'acorazado' ? base * 0.1 : t.especial === 'hembra' ? base * 0.4 : base;
  }

  private quitarVida(t: TitanAPI, cuanto: number): void {
    const v = this.vidaDe(t);
    v.vida = Math.max(0, v.vida - cuanto);
    v.tGolpe = this.t;
    if (v.vida > 0) return;
    this.rematar(t);
    if (!t.vivo) {
      const nombre = t.especial === 'acorazado' ? '¡El Acorazado' : t.especial === 'hembra' ? '¡La Hembra' : `¡Titán de ${Math.round(t.altura)} m`;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${nombre} abatido a cañonazos!`, segundos: 3 });
    }
  }

  /** Sin vida: nuca. Si la coraza la protege, primero una corva (cae y se le agrieta) y luego la nuca. */
  private rematar(t: TitanAPI): void {
    const U = umbralNuca(t.altura) * 3;
    if (t.recibirCorte('nuca', U, this.ctx.jugador).efecto === 'muerte' || !t.vivo) return;
    const corva = (['corvaIzq', 'corvaDer'] as ZonaTitan[]).find((z) => t.puntosDebiles.some((p) => p.zona === z && p.activo));
    if (corva) t.recibirCorte(corva, umbralZona(corva, t.altura) * 3, this.ctx.jugador);
    t.recibirCorte('nuca', U, this.ctx.jugador);
  }

  // ─────────────────────────── Asedio ───────────────────────────

  /**
   * Los titanes pegados a la empalizada la golpean: cada tramo pierde vida (y el cañón de ese
   * tramo también). Un tramo sin vida se derrumba y abre brecha; se rehace solo cuando no hay
   * titanes cerca. El Acorazado golpea cuatro veces más fuerte.
   */
  private asedio(dt: number): void {
    const c = this.centro;
    for (const t of this.ctx.poblacion.titanesCerca(c, R_ESTACAS + 14)) {
      if (!t.vivo || t instanceof Silueta || t.estado === 'derribado' || t.estado === 'cegado' || t.estado === 'apagado') continue;
      const d = Math.hypot(t.posicion.x - c.x, t.posicion.z - c.z);
      if (d > R_ESTACAS + 2 + t.altura * 0.15) continue;
      const i = tramoDe(t.posicion.x, t.posicion.z, c.x, c.z, this.giro);
      if (!this.tramoHecho(i)) continue;
      const fuerza = (3 + t.altura * 1.6) * (t.especial === 'acorazado' ? 4 : t.especial === 'hembra' ? 2 : 1);
      this.vidaTramo[i] -= fuerza * dt;
      for (const k of this.canones) {
        if (k.roto || k.tramo !== i) continue;
        k.vida -= fuerza * 0.6 * dt;
        if (k.vida <= 0) {
          k.roto = true;
          k.tSinTitanes = 0;
          this.ctx.efectos.vapor(k.pivote.position.clone(), 20, 1.5, 4);
          this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Han destrozado un cañón!', segundos: 2.5 });
        }
      }
      if (this.vidaTramo[i] <= 0) this.romperTramo(i);
    }
  }

  /** El tramo se viene abajo: sin colisión ni bloqueo, los troncos por el suelo y brecha abierta. */
  private romperTramo(i: number): void {
    const o = this.obras[i];
    o.progreso = 0;
    const lista = this.collidersTramo.get(i);
    if (lista) for (const col of lista) this.ctx.fisica.eliminarCollider(col);
    this.collidersTramo.delete(i);
    this.marcarNavTramo(i, 0);
    if (i === 0 && this.puerta) {
      if (this.puerta.collider) this.ctx.fisica.eliminarCollider(this.puerta.collider);
      this.puerta.collider = null;
      this.puerta.navCerrada = false;
    }
    this.vidaTramo[i] = 0;
    this.ctx.efectos.vapor(o.pos.clone().setY(1.5), 30, 2.5, 5);
    this.ctx.eventos.emit({ tipo: 'canon', pos: o.pos.clone().setY(1.5) });
    if (this.t - this.tAvisoBrecha > 3) {
      this.tAvisoBrecha = this.t;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Han abierto una brecha en la empalizada!', segundos: 3 });
    }
    this.dibujarObras();
  }

  /** Un cañón destrozado vuelve a estar en servicio tras un rato sin titanes cerca. */
  private repararCanones(dt: number): void {
    for (const k of this.canones) {
      if (!k.roto) {
        if (k.vida < VIDA_CANON && !this.ctx.poblacion.titanesCerca(k.pivote.position, 40).some((t) => t.vivo)) k.vida = Math.min(VIDA_CANON, k.vida + 8 * dt);
        continue;
      }
      if (!this.tramoHecho(k.tramo)) continue;
      if (this.ctx.poblacion.titanesCerca(k.pivote.position, 50).some((t) => t.vivo)) {
        k.tSinTitanes = 0;
        continue;
      }
      k.tSinTitanes += dt;
      if (k.tSinTitanes >= REPARA_CANON) {
        k.roto = false;
        k.vida = VIDA_CANON;
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: 'Cañón reparado', segundos: 2 });
      }
    }
  }

  /**
   * Mientras estés cerca del campamento terminado, cada 5–8 min llega una oleada de titanes hacia
   * él (más grande cada vez). Desde la segunda, a veces la encabeza el Acorazado; la cuarta siempre.
   */
  private ataquesAlCampamento(dt: number): void {
    if (!this.listoAvisado) return;
    const j = this.ctx.jugador.posicion;
    if (Math.hypot(j.x - this.centro.x, j.z - this.centro.z) > 450) return;
    this.atacantes = this.atacantes.filter((t) => t.vivo);
    if (this.atacantes.length > 0) return;
    this.tAtaque -= dt;
    if (this.tAtaque > 0) return;
    this.tAtaque = ENTRE_ATAQUES[0] + Math.random() * (ENTRE_ATAQUES[1] - ENTRE_ATAQUES[0]);
    this.ataques++;
    const acorazado = this.ataques % 4 === 0 || (this.ataques >= 2 && Math.random() < 0.35);
    const n = Math.min(8, 2 + this.ataques);
    const ang = Math.random() * Math.PI * 2;
    const r = 240 + Math.random() * 40;
    const sitio = new THREE.Vector3(this.centro.x + Math.cos(ang) * r, 0, this.centro.z + Math.sin(ang) * r);
    const libre = this.ctx.nav.puntoLibreCercano(sitio.x, sitio.z, 3, 10) ?? sitio;
    const titanes: TitanAPI[] = [];
    if (acorazado) titanes.push(this.ctx.titanes.generar({ posicion: libre.clone(), altura: 15, especial: 'acorazado' }));
    titanes.push(...this.ctx.titanes.generarGrupo(n, libre, 35, [4, 5, 7, 8, 10, 12, 15], 0.2));
    for (const t of titanes) t.dirigirA?.(this.centro);
    this.atacantes = titanes;
    this.ctx.eventos.emit({ tipo: 'mensaje', texto: `¡${titanes.length} titanes vienen hacia el campamento${acorazado ? ', con el Acorazado al frente' : ''}!`, segundos: 4 });
    this.ctx.efectos.bengala(this.centro.clone().setY(12), COLOR_AVISO);
  }

  /** Vida de la base y cañones en servicio, arriba en pantalla mientras estés cerca. */
  private actualizarHud(dt: number): void {
    this.tHud -= dt;
    if (this.tHud > 0) return;
    this.tHud = 0.25;
    const j = this.ctx.jugador.posicion;
    const cerca = this.listoAvisado && Math.hypot(j.x - this.centro.x, j.z - this.centro.z) < 160;
    if (!cerca) {
      if (this.hud) this.hud.hidden = true;
      return;
    }
    if (!this.hud) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:50%;top:max(118px,calc(env(safe-area-inset-top) + 104px));transform:translateX(-50%);z-index:5;pointer-events:none;' +
        'font:600 12px/1.3 Georgia,serif;color:#f1e7d0;text-shadow:0 1px 2px #000;text-align:center;letter-spacing:.06em';
      el.innerHTML = '<div class="t"></div><div style="width:180px;height:7px;margin:3px auto 0;background:rgba(0,0,0,.55);border:1px solid rgba(241,231,208,.5)"><div class="b" style="height:100%;width:100%;background:#7fae4f"></div></div>';
      document.body.appendChild(el);
      this.hud = el;
    }
    const total = this.vidaTramo.reduce((n, v, i) => n + (this.tramoHecho(i) ? Math.max(0, v) : 0), 0) / (VIDA_TRAMO * N);
    const enServicio = this.canones.filter((k) => !k.roto && this.tramoHecho(k.tramo)).length;
    const brechas = this.obras.filter((o) => o.tipo === 'tramo' && o.progreso < 1).length;
    this.hud.hidden = false;
    (this.hud.querySelector('.t') as HTMLElement).textContent = `CAMPAMENTO ${Math.round(total * 100)} % · CAÑONES ${enServicio}/${this.canones.length}${brechas ? ` · BRECHAS ${brechas}` : ''}`;
    const b = this.hud.querySelector('.b') as HTMLElement;
    b.style.width = `${Math.round(total * 100)}%`;
    b.style.background = total > 0.6 ? '#7fae4f' : total > 0.3 ? '#d9a33b' : '#c2412e';
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

  /** Los titanes heridos por los cañones se regeneran si pasan un rato sin recibir. */
  private regenerarVidas(dt: number): void {
    for (const v of this.vidas.values()) if (this.t - v.tGolpe > REGEN_TITAN) v.vida = Math.min(1, v.vida + 0.04 * dt);
  }

  /** Con la empalizada cerrada, ningún titán puede estar dentro ni encima del muro: sale empujado. */
  private expulsarTitanes(): void {
    if (!this.empalizadaCerrada) return;
    const c = this.centro;
    for (const t of this.ctx.poblacion.titanesCerca(c, R_ESTACAS + 8)) {
      if (!t.vivo) continue;
      const r = Math.max(0.6, 0.17 * t.altura) * 0.7;
      const limite = R_ESTACAS + 0.6 + r + 0.05;
      const dx = t.posicion.x - c.x;
      const dz = t.posicion.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d >= limite) continue;
      const ux = d > 1e-3 ? dx / d : Math.cos(this.giro);
      const uz = d > 1e-3 ? dz / d : Math.sin(this.giro);
      t.posicion.x = c.x + ux * limite;
      t.posicion.z = c.z + uz * limite;
    }
  }

  // ─────────────────────────── Construcción ───────────────────────────

  /** Adarve, escalera, cañón y puerta del tramo `i` (invisibles hasta terminarlo). */
  private construirTramo(i: number): void {
    const c = this.centro;
    const a = anguloTramo(i, this.giro);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const rot = giroTangente(a);
    const piezas = this.piezasTramo.get(i)!;
    const pieza = (m: THREE.Object3D) => {
      m.visible = false;
      this.grupo.add(m);
      piezas.push(m);
      return m;
    };
    const en = (r: number, y: number, lat = 0) => c.clone().addScaledVector(dir, r).add(new THREE.Vector3(-Math.sin(a) * lat, y, Math.cos(a) * lat));
    // largueros que atan los troncos por dentro
    for (const y of [0.8, ALTO_MURO - 0.6]) {
      if (i === 0) continue;
      // un pelo más cortos y a alturas alternas: los de tramos vecinos no se solapan (parpadeo)
      const rL = APOTEMA - 0.34;
      const larguero = new THREE.Mesh(new THREE.BoxGeometry(CUERDA * (rL / APOTEMA) - 0.06, 0.16, 0.12), MADERA);
      larguero.position.copy(en(rL, y + (i % 2) * 0.03));
      larguero.rotation.y = rot;
      pieza(larguero);
    }
    if (i === 0) {
      this.construirPuerta(a, dir, rot);
      return;
    }
    // adarve: tablas sobre pies derechos, con barandilla por dentro
    const largo = CUERDA * (R_ADARVE / APOTEMA) + 0.05;
    // tramos alternos 1 cm más altos: donde se cruzan dos tablas en la esquina no parpadean
    const tablas = new THREE.Mesh(new THREE.BoxGeometry(largo, 0.16, ANCHO_ADARVE), TABLA);
    tablas.position.copy(en(R_ADARVE, ALTO_ADARVE - 0.08 + (i % 2) * 0.012));
    tablas.rotation.y = rot;
    tablas.receiveShadow = true;
    pieza(tablas);
    for (const lat of [-largo / 2 + 0.2, largo / 2 - 0.2]) {
      const pie = new THREE.Mesh(new THREE.BoxGeometry(0.18, ALTO_ADARVE, 0.18), MADERA);
      pie.position.copy(en(R_ADARVE - ANCHO_ADARVE / 2 + 0.1, ALTO_ADARVE / 2, lat));
      pieza(pie);
      const poste = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), MADERA);
      poste.position.copy(en(R_ADARVE - ANCHO_ADARVE / 2 + 0.05, ALTO_ADARVE + 0.5, lat));
      pieza(poste);
    }
    const baranda = new THREE.Mesh(new THREE.BoxGeometry(largo, 0.08, 0.08), MADERA);
    baranda.position.copy(en(R_ADARVE - ANCHO_ADARVE / 2 + 0.05, ALTO_ADARVE + 0.95 + (i % 2) * 0.02, 0));
    baranda.rotation.y = rot;
    pieza(baranda);
    // escalera de bloques hasta el adarve
    if (TRAMOS_ESCALERA.includes(i)) {
      const rIn = R_ADARVE - ANCHO_ADARVE / 2;
      for (let k = 0; k < 5; k++) {
        const r0 = rIn - (5 - k) * 0.68;
        const alto = (k + 1) * (ALTO_ADARVE / 5);
        const peldaño = new THREE.Mesh(new THREE.BoxGeometry(1.3, alto, rIn - r0), TABLA);
        peldaño.position.copy(en((r0 + rIn) / 2, alto / 2));
        peldaño.rotation.y = rot;
        pieza(peldaño);
      }
    }
    // cañón de campaña sobre su plataforma, asomando por la tronera
    if (TRAMOS_CANON.includes(i)) this.construirCanon(i, a, en);
  }

  /**
   * Cañón: plataforma de tablones sobre el adarve, cureña de dos gualderas con cuatro ruedas (gira
   * con la puntería) y el tubo de hierro con muñones, anillos de refuerzo, culata y su fogonazo.
   */
  private construirCanon(i: number, a: number, en: (r: number, y: number, lat?: number) => THREE.Vector3): void {
    const piezas = this.piezasTramo.get(i)!;
    const pieza = (m: THREE.Object3D) => {
      m.visible = false;
      this.grupo.add(m);
      piezas.push(m);
    };
    const haciaFuera = Math.PI / 2 - a; // giro en Y que lleva el +Z local hacia fuera del muro
    // plataforma ancha y maciza, con dos vigas de apoyo que bajan al suelo
    const plataforma = new THREE.Group();
    plataforma.position.copy(en(R_ADARVE + 0.05, ALTO_ADARVE));
    plataforma.rotation.y = haciaFuera;
    const tablon = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.0), TABLA);
    tablon.position.y = 0.06;
    tablon.receiveShadow = true;
    plataforma.add(tablon);
    for (const x of [-1.15, 1.15]) {
      const viga = new THREE.Mesh(new THREE.BoxGeometry(0.22, ALTO_ADARVE, 0.22), TRONCO);
      viga.position.set(x, -ALTO_ADARVE / 2, -0.7);
      plataforma.add(viga);
    }
    pieza(plataforma);
    // cureña (gira solo en horizontal)
    const base = new THREE.Group();
    base.position.copy(en(R_ADARVE + 0.15, ALTO_ADARVE + 0.12));
    base.rotation.y = haciaFuera;
    for (const x of [-0.36, 0.36]) {
      const gualdera = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.6, 1.5), MADERA);
      gualdera.position.set(x, 0.42, -0.15);
      gualdera.castShadow = true;
      base.add(gualdera);
    }
    for (const z of [-0.75, 0.45]) {
      const eje = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.14, 0.16), HIERRO);
      eje.position.set(0, 0.2, z);
      base.add(eje);
      for (const x of [-0.52, 0.52]) {
        const rueda = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14), TRONCO);
        rueda.rotation.z = Math.PI / 2;
        rueda.position.set(x, 0.22, z);
        base.add(rueda);
      }
    }
    const travesaño = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 0.2), MADERA);
    travesaño.position.set(0, 0.3, -0.85);
    base.add(travesaño);
    pieza(base);
    // tubo: gira en horizontal y en elevación sobre los muñones
    const pivote = new THREE.Group();
    pivote.position.copy(en(R_ADARVE + 0.15, ALTO_CANON));
    const material = new THREE.MeshLambertMaterial({ color: '#29292c' });
    const tubo = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 2.3, 16), material);
    cuerpo.rotation.x = Math.PI / 2;
    cuerpo.position.z = 0.55;
    cuerpo.castShadow = true;
    tubo.add(cuerpo);
    for (const [z, r] of [[-0.45, 0.29], [0.15, 0.26], [0.95, 0.22], [1.62, 0.21]] as const) {
      const anillo = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 6, 16), material);
      anillo.position.z = z;
      tubo.add(anillo);
    }
    const culata = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), material);
    culata.position.z = -0.72;
    tubo.add(culata);
    const muñones = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.86, 8), BRONCE);
    muñones.rotation.z = Math.PI / 2;
    tubo.add(muñones);
    pivote.add(tubo);
    const boca = new THREE.Object3D();
    boca.position.z = 1.75;
    pivote.add(boca);
    const fogonazo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaParticula(), color: '#ffb347', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    fogonazo.position.z = 2.1;
    fogonazo.visible = false;
    pivote.add(fogonazo);
    pieza(pivote);
    const k: Canon = { tramo: i, pivote, base, tubo, material, boca, fogonazo, rumbo: a, recarga: 0, retroceso: 0, vida: VIDA_CANON, roto: false, tSinTitanes: 0 };
    this.apuntar(k, null);
    this.canones.push(k);
  }

  /** Marco de la puerta con su travesaño y el estandarte, y la hoja (madera con flejes y tranca). */
  private construirPuerta(a: number, dir: THREE.Vector3, rot: number): void {
    const c = this.centro;
    const piezas = this.piezasTramo.get(0)!;
    const lat = (l: number) => new THREE.Vector3(-Math.sin(a) * l, 0, Math.cos(a) * l);
    const base = c.clone().addScaledVector(dir, APOTEMA);
    for (const s of [-1, 1]) {
      const jamba = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.8, 0.5), TRONCO);
      jamba.position.copy(base).add(lat(s * (ANCHO_PUERTA / 2 + 0.25))).setY(2.4);
      jamba.rotation.y = rot;
      jamba.castShadow = true;
      piezas.push(jamba);
    }
    const dintel = new THREE.Mesh(new THREE.BoxGeometry(ANCHO_PUERTA + 1.2, 0.45, 0.5), TRONCO);
    dintel.position.copy(base).setY(4.45);
    dintel.rotation.y = rot;
    piezas.push(dintel);
    const estandarte = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), ESTANDARTE);
    estandarte.position.copy(base).addScaledVector(dir, 0.3).setY(3.75);
    estandarte.rotation.y = rot;
    piezas.push(estandarte);
    // hoja: un grupo para poder hundirla entera en el suelo
    const hoja = new THREE.Group();
    const tablero = new THREE.Mesh(new THREE.BoxGeometry(ANCHO_PUERTA, ALTO_PUERTA, 0.28), TABLA);
    tablero.position.y = ALTO_PUERTA / 2;
    tablero.castShadow = true;
    hoja.add(tablero);
    for (const y of [0.5, ALTO_PUERTA / 2, ALTO_PUERTA - 0.5]) {
      const fleje = new THREE.Mesh(new THREE.BoxGeometry(ANCHO_PUERTA + 0.04, 0.16, 0.32), HIERRO);
      fleje.position.y = y;
      hoja.add(fleje);
    }
    const tranca = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(ANCHO_PUERTA, ALTO_PUERTA) - 0.4, 0.2, 0.3), MADERA);
    tranca.position.y = ALTO_PUERTA / 2;
    tranca.rotation.z = Math.atan2(ALTO_PUERTA, ANCHO_PUERTA);
    hoja.add(tranca);
    const marco = new THREE.Group();
    marco.position.copy(base);
    marco.rotation.y = rot;
    marco.add(hoja);
    piezas.push(marco);
    for (const p of piezas) {
      p.visible = false;
      this.grupo.add(p);
    }
    this.puerta = { hoja, base, alza: 0, collider: null, navCerrada: false, tAbierta: -99 };
  }

  /** Atalaya de cuatro pies derechos con plataforma, barandilla, escala y tejadillo. */
  private construirTorre(progreso: number): void {
    const c = this.centro;
    const a = anguloTramo(TRAMO_TORRE, this.giro);
    const pos = new THREE.Vector3(c.x + Math.cos(a) * R_TORRE, 0, c.z + Math.sin(a) * R_TORRE);
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = giroTangente(a);
    const L = 1.4;
    for (const [x, z] of [[-L, -L], [L, -L], [-L, L], [L, L]]) {
      const pie = new THREE.Mesh(new THREE.BoxGeometry(0.24, ALTO_TORRE + 2.6, 0.24), TRONCO);
      pie.position.set(x, (ALTO_TORRE + 2.6) / 2, z);
      pie.castShadow = true;
      g.add(pie);
    }
    // aspas de refuerzo en dos alturas
    for (const y of [2.5, 5.8]) {
      for (const [x, z, ry] of [[0, -L, 0], [0, L, 0], [-L, 0, Math.PI / 2], [L, 0, Math.PI / 2]] as const) {
        for (const s of [-1, 1]) {
          const aspa = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(2 * L, 3), 0.1, 0.1), MADERA);
          aspa.position.set(x, y, z);
          aspa.rotation.set(0, ry, s * Math.atan2(3, 2 * L), 'YXZ');
          g.add(aspa);
        }
      }
    }
    const plataforma = new THREE.Mesh(new THREE.BoxGeometry(2 * L + 0.6, 0.2, 2 * L + 0.6), TABLA);
    plataforma.position.y = ALTO_TORRE;
    plataforma.castShadow = true;
    g.add(plataforma);
    for (const [x, z, ry] of [[0, -L - 0.3, 0], [0, L + 0.3, 0], [-L - 0.3, 0, Math.PI / 2], [L + 0.3, 0, Math.PI / 2]] as const) {
      const baranda = new THREE.Mesh(new THREE.BoxGeometry(2 * L + 0.6, 0.9, 0.06), TABLA);
      baranda.position.set(x, ALTO_TORRE + 0.55, z);
      baranda.rotation.y = ry;
      g.add(baranda);
    }
    const tejadillo = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), LONA_VERDE);
    tejadillo.position.y = ALTO_TORRE + 3.3;
    tejadillo.rotation.y = Math.PI / 4;
    tejadillo.castShadow = true;
    g.add(tejadillo);
    // escala por la cara de dentro
    for (const x of [-0.35, 0.35]) {
      const larguero = new THREE.Mesh(new THREE.BoxGeometry(0.07, ALTO_TORRE, 0.07), MADERA);
      larguero.position.set(x, ALTO_TORRE / 2, L + 0.15);
      g.add(larguero);
    }
    for (let y = 0.4; y < ALTO_TORRE; y += 0.45) {
      const peldaño = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), MADERA);
      peldaño.position.set(0, y, L + 0.15);
      g.add(peldaño);
    }
    this.grupo.add(g);
    this.obras.push({ pos: pos.clone(), rot: g.rotation.y, progreso, malla: g, tipo: 'torre' });
  }

  private colliderPuerta(): RAPIER.Collider {
    const a = anguloTramo(0, this.giro);
    const b = this.puerta!.base;
    return this.ctx.fisica.caja({ x: b.x, y: ALTO_PUERTA / 2, z: b.z }, { x: ANCHO_PUERTA / 2, y: ALTO_PUERTA / 2, z: 0.2 }, 'puerta', giroTangente(a));
  }

  /** Colisionadores del tramo terminado: muro, adarve, escalera (y jambas en la puerta). */
  private ponerColliders(i: number): void {
    if (this.collidersTramo.has(i)) return;
    const f = this.ctx.fisica;
    const c = this.centro;
    const a = anguloTramo(i, this.giro);
    const rot = giroTangente(a);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const en = (r: number, y: number, lat = 0) => c.clone().addScaledVector(dir, r).add(new THREE.Vector3(-Math.sin(a) * lat, y, Math.cos(a) * lat));
    const lista: RAPIER.Collider[] = [];
    if (i === 0) {
      const ladoLargo = (CUERDA - ANCHO_PUERTA) / 2;
      for (const s of [-1, 1]) {
        const p = en(APOTEMA, ALTO_MURO / 2, s * (ANCHO_PUERTA / 2 + ladoLargo / 2));
        lista.push(f.caja(p, { x: ladoLargo / 2 + 0.1, y: ALTO_MURO / 2, z: 0.24 }, 'edificio', rot));
        const j = en(APOTEMA, 2.4, s * (ANCHO_PUERTA / 2 + 0.25));
        lista.push(f.caja(j, { x: 0.25, y: 2.4, z: 0.25 }, 'edificio', rot));
      }
      const d = en(APOTEMA, 4.45);
      lista.push(f.caja(d, { x: ANCHO_PUERTA / 2 + 0.6, y: 0.22, z: 0.25 }, 'edificio', rot));
      if (this.puerta && !this.puerta.collider && this.puerta.alza <= 0) this.puerta.collider = this.colliderPuerta();
    } else {
      const p = en(APOTEMA, ALTO_MURO / 2);
      lista.push(f.caja(p, { x: CUERDA / 2 + 0.12, y: ALTO_MURO / 2, z: 0.24 }, 'edificio', rot));
      const largo = CUERDA * (R_ADARVE / APOTEMA) + 0.05;
      lista.push(f.caja(en(R_ADARVE, ALTO_ADARVE - 0.08), { x: largo / 2, y: 0.08, z: ANCHO_ADARVE / 2 }, 'tejado', rot));
      if (TRAMOS_ESCALERA.includes(i)) {
        // la escalera se pisa como una rampa lisa (los peldaños son solo de vista): el personaje
        // sube andando sin quedarse enganchado en el borde de cada escalón
        const rIn = R_ADARVE - ANCHO_ADARVE / 2;
        const largo = 5 * 0.68;
        const angulo = Math.atan2(ALTO_ADARVE, largo);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angulo));
        const medio = en(rIn - largo / 2, ALTO_ADARVE / 2 - 0.1 * Math.cos(angulo));
        lista.push(f.caja(medio, { x: 0.65, y: 0.1, z: Math.hypot(largo, ALTO_ADARVE) / 2 + 0.05 }, 'tejado', q));
      }
    }
    this.collidersTramo.set(i, lista);
    this.vidaTramo[i] = VIDA_TRAMO;
    this.marcarNavTramo(i, 1);
    if (i === 0 && this.puerta) this.puerta.navCerrada = true;
  }

  private ponerCollidersTorre(): void {
    if (this.collidersTorre.length) return;
    const o = this.obras.find((x) => x.tipo === 'torre')!;
    const f = this.ctx.fisica;
    const g = o.malla;
    const L = 1.4;
    for (const [x, z] of [[-L, -L], [L, -L], [-L, L], [L, L]]) {
      const p = g.localToWorld(new THREE.Vector3(x, (ALTO_TORRE + 2.6) / 2, z));
      this.collidersTorre.push(f.caja(p, { x: 0.12, y: (ALTO_TORRE + 2.6) / 2, z: 0.12 }, 'edificio', o.rot));
    }
    const p = g.localToWorld(new THREE.Vector3(0, ALTO_TORRE, 0));
    this.collidersTorre.push(f.caja(p, { x: L + 0.3, y: 0.1, z: L + 0.3 }, 'tejado', o.rot));
  }

  /** Bloquea (1) o libera (0) en la rejilla de navegación el sector de muro del tramo `i`. */
  private marcarNavTramo(i: number, valor: number): void {
    const a = anguloTramo(i, this.giro);
    this.ctx.nav.bloquearSectorEn(this.centro.x, this.centro.z, APOTEMA - 0.4, RADIO_CERCO + 0.4, a - PASO / 2, a + PASO / 2, valor);
  }

  /** Troncos que suben según avanza cada tramo, piezas y colisionadores al terminarlo, carpas que se despliegan. */
  private dibujarObras(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const esc = new THREE.Vector3();
    this.datosTroncos.forEach((d, k) => {
      const prog = this.obras[d.tramo].progreso;
      const h = d.alto * Math.max(0.06, Math.min(1, prog));
      q.setFromEuler(e.set(0, d.giro, 0));
      m.compose(pos.set(d.x, 0, d.z), q, esc.set(1, h, 1));
      this.troncos.setMatrixAt(k, m);
      m.compose(pos.set(d.x, h, d.z), q, esc.setScalar(prog >= 0.3 ? 1 : 0.001));
      this.puntas.setMatrixAt(k, m);
    });
    this.troncos.instanceMatrix.needsUpdate = true;
    this.puntas.instanceMatrix.needsUpdate = true;
    for (const o of this.obras) {
      const hecho = o.progreso >= 1;
      if (o.tipo === 'tramo') {
        for (const p of this.piezasTramo.get(o.tramo!) ?? []) p.visible = hecho;
        if (hecho) this.ponerColliders(o.tramo!);
      } else if (o.tipo === 'carpa') {
        const k = Math.max(0.04, Math.min(1, o.progreso));
        o.malla.scale.set(1, k, 0.4 + 0.6 * k);
        o.malla.visible = o.progreso > 0;
      } else {
        // la atalaya crece desde el suelo
        const k = Math.max(0.02, Math.min(1, o.progreso));
        o.malla.scale.set(1, k, 1);
        o.malla.visible = o.progreso > 0;
        if (hecho) this.ponerCollidersTorre();
      }
    }
    const hechos = this.postesHechos;
    const clave = hechos.map((h) => (h ? 1 : 0)).join('') + (this.alambre > 0 ? 'a' : 'r');
    if (clave === this.hechosPrevios) return;
    this.hechosPrevios = clave;
    // estacas de los tramos terminados (si no las han roto) y una lata de alarma por tramo
    let n = 0;
    for (const d of this.datosEstacas) if (hechos[d.tramo] && this.alambre > 0) this.estacas.setMatrixAt(n++, d.m);
    this.estacas.count = n;
    this.estacas.instanceMatrix.needsUpdate = true;
    let latas = 0;
    if (this.alambre > 0) {
      for (let i = 1; i < N; i++) {
        if (!hechos[i]) continue;
        const a = anguloTramo(i, this.giro);
        m.makeTranslation(this.centro.x + Math.cos(a) * (R_ESTACAS - 0.4), 1.2, this.centro.z + Math.sin(a) * (R_ESTACAS - 0.4));
        this.latas.setMatrixAt(latas++, m);
      }
    }
    this.latas.count = latas;
    this.latas.instanceMatrix.needsUpdate = true;
  }

  guardar(): EstadoGuardadoCampamento {
    return {
      x: this.centro.x,
      z: this.centro.z,
      postes: this.obras.filter((o) => o.tipo === 'tramo').map((o) => o.progreso),
      carpas: this.obras.filter((o) => o.tipo === 'carpa').map((o) => o.progreso),
      torre: this.obras.find((o) => o.tipo === 'torre')?.progreso ?? 0,
      alambre: this.alambre,
      giro: this.giro,
    };
  }

  /** Desmonta el campamento (al armar otro o al salir). */
  eliminar(): void {
    this.hud?.remove();
    this.hud = null;
    const f = this.ctx.fisica;
    for (const [i, lista] of this.collidersTramo) {
      for (const col of lista) f.eliminarCollider(col);
      this.marcarNavTramo(i, 0);
    }
    this.collidersTramo.clear();
    for (const col of this.collidersTorre) f.eliminarCollider(col);
    this.collidersTorre = [];
    if (this.puerta?.collider) f.eliminarCollider(this.puerta.collider);
    for (const b of this.balas) b.malla.removeFromParent();
    this.balas.length = 0;
    this.ctx.escena.remove(this.grupo);
    this.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    for (const k of this.canones) {
      k.material.dispose();
      (k.fogonazo.material as THREE.Material).dispose();
    }
    for (const v of this.vidas.values()) {
      for (const sp of [v.fondo, v.barra]) {
        sp.removeFromParent();
        (sp.material as THREE.Material).dispose();
      }
    }
    this.vidas.clear();
    this.geoBala.dispose();
    if (this.ctx.fuerte === this) this.ctx.fuerte = null;
    if (!this.listo) for (const s of this.ctx.escuadron.soldados) this.ctx.escuadron.trabajarEn(s, null);
  }
}
