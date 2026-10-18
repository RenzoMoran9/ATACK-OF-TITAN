import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Cuchillas } from '../combat/cuchillas';
import type { ContextoJuego } from '../core/contexto';
import type { Fisica } from '../core/fisica';
import type { AspectoSoldado, DestinoOrden, EscuadronAPI, Humano, InfoSoldado, MiembroEscuadron, OrdenEscuadron, RolSoldado, TitanAPI, ZonaTitan } from '../core/tipos';
import { Silueta } from '../missions/silueta';
import { Caballo } from '../player/caballo';
import { Particulas } from '../player/particulas';
import { CURACION_JUGADOR, CURACION_SIN_MEDICO, CURACION_SOLDADO, RADIO_CURA, RADIO_PELIGRO, encuentroPeligroso, estaHerido } from './logicaHeridos';
import { COLOR_AVISO, COLOR_BENGALA, fraseConfirmacion, necesitaRecarga, puedeRescatar, puesto, puntoPatrulla, siguienteSeleccion, textoAviso } from './logicaOrdenes';
import { Soldado, type OrdenAsignada } from './soldado';

/**
 * Coordinador del escuadrón. Cada soldado guarda la orden que le diste (a todos o a uno
 * elegido con Tab) y cada 0,4 s el escuadrón le reparte una misión:
 *
 * 1. Rescates: alguien en la mano de un titán (cortar la mano o la mandíbula).
 * 2. Reabastecerse: con poco gas o sin cuchillas y sin combate cerca, al depósito libre más cercano.
 * 3. Titanes: cada soldado propone uno según su orden (amenazas al jugador, el titán señalado,
 *    los que se acercan a su puesto...) y los que coinciden hacen la táctica del anime: el cebo
 *    lo distrae delante de la cara, el apoyo le corta tendones y corvas y el rematador va a la
 *    nuca cuando el titán no le mira.
 * 4. El resto cumple su orden: formación detrás del jugador, junto a los civiles, mantener un
 *    puesto (esperar, id allí) o patrullar alrededor de un punto. Solo quien sigue al jugador o
 *    se retira reaparece a su espalda si se queda muy atrás.
 *
 * Los que esperan o patrullan avisan de cada titán nuevo que ven, con una bengala roja.
 */

const ASPECTOS: Record<string, AspectoSoldado & { habilidad?: number }> = {
  Mikasa: { pelo: '#121214', peloLargo: true, bufanda: '#a8222b', habilidad: 1.6 },
  Levi: { pelo: '#0f0f10', escala: 0.9, capa: '#3f5a33', habilidad: 1.9 },
  Armin: { pelo: '#e3c873', escala: 0.95, habilidad: 0.8 },
  Jean: { pelo: '#9a7a52', escala: 1.04, habilidad: 1.15 },
  Connie: { pelo: '#3a3a3a', escala: 0.92, habilidad: 1.0 },
  Sasha: { pelo: '#6b4428', peloLargo: true, escala: 0.96, habilidad: 1.05 },
  Eren: { pelo: '#3b2a1e', habilidad: 1.0 },
  Thomas: { pelo: '#c9a56a', habilidad: 0.85 },
  Mina: { pelo: '#1e1a18', peloLargo: true, escala: 0.94, habilidad: 0.85 },
  Nac: { pelo: '#5a3b24', habilidad: 0.9 },
  Moblit: { pelo: '#6a4a2c', habilidad: 0.85, tanques: true },
  Reiner: { pelo: '#d9c27a', escala: 1.08, habilidad: 1.3 },
  Bertholdt: { pelo: '#2a1f18', escala: 1.1, habilidad: 1.1 },
  Ymir: { pelo: '#3b2a1e', peloLargo: true, habilidad: 1.1 },
};

/** Huecos de la formación detrás del jugador (x lateral, z hacia atrás). */
const HUECOS: [number, number][] = [
  [-3.5, 4.5],
  [3.5, 4.5],
  [-6.5, 8.5],
  [6.5, 8.5],
  [0, 11],
  [-9, 12],
  [9, 12],
  [0, 15],
];

const MANOS: ZonaTitan[] = ['manoIzq', 'manoDer', 'mandibula'];
const TENDONES: ZonaTitan[] = ['corvaIzq', 'corvaDer', 'tendonIzq', 'tendonDer'];
const ABAJO = new THREE.Vector3(0, -1, 0);
const CENTRO = 0.85;
/**
 * Quien espera o mantiene un puesto no se mueve de él: solo pelea con el titán que llega hasta
 * su sitio (a este radio) o que va a por él. «Esperad aquí» es quedarse, no salir de caza.
 */
const RADIO_DEFENSA = 22;
const RADIO_PATRULLA = 120;
/** Hasta dónde avisan los vigías de un titán. */
const RADIO_AVISO = 90;
/** Titanes en este radio impiden dar por terminada la huida. */
const RADIO_HUIDA = 60;
/** A cuánto de su caballo tiene que estar el jinete para subirse. */
const DISTANCIA_MONTAR = 5;
/** A cuánto del refugio tiene que llegar quien huye para dar la huida por terminada. */
const LLEGADA_REFUGIO = 12;
/** Pares de cuchillas de repuesto que reparte el médico a quien se queda sin ninguno. */
const PARES_MEDICO = 2;

/** Superficie bajo `p` (calle, tejado, rama, muralla), atravesando al jugador y a los titanes. */
export function puntoAlSuelo(fisica: Fisica, p: THREE.Vector3, max = 400): THREE.Vector3 {
  const origen = p.clone();
  let excluir: RAPIER.Collider | undefined;
  for (let k = 0; k < 10; k++) {
    const hit = fisica.lanzarRayo(origen, ABAJO, max, excluir);
    if (!hit) break;
    if (hit.etiqueta !== 'titan' && hit.etiqueta !== 'nuca' && hit.etiqueta !== 'jugador') return hit.punto.clone();
    origen.y = hit.punto.y;
    excluir = hit.collider;
  }
  return new THREE.Vector3(p.x, 0, p.z);
}

/** Las siluetas de madera del campo de instrucción no son una amenaza. */
const esAmenaza = (t: TitanAPI): boolean => t.vivo && !(t instanceof Silueta);

export class Escuadron implements EscuadronAPI {
  readonly soldados: Soldado[] = [];
  seleccion: Soldado | null = null;
  /** La campaña dice si el depósito sirve (en Trost está tomado por titanes). */
  depositoDisponible: () => boolean = () => true;
  private tCoordinar = 0;
  private readonly rumboFormacion = new THREE.Vector3(0, 0, 1);
  /** Titanes de los que ya avisaron los vigías (por id). */
  private readonly avisados = new Set<number>();
  private tAviso = -99;
  private readonly chorros: Particulas;
  private readonly frustum = new THREE.Frustum();
  private readonly matriz = new THREE.Matrix4();

  constructor(private readonly ctx: ContextoJuego) {
    this.chorros = new Particulas(ctx.escena, 320, '#ffffff', 2.2);
  }

  get orden(): OrdenEscuadron {
    const s = this.seleccion ?? this.soldados.find((x) => x.vivo) ?? this.soldados[0];
    return s?.orden.tipo ?? 'seguir';
  }

  crear(miembros: MiembroEscuadron[], cerca: THREE.Vector3): void {
    const ctx = this.ctx;
    const n = miembros.length;
    miembros.forEach((m, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 2.5 + (i % 2) * 1.5;
      const x = cerca.x + Math.cos(a) * r;
      const z = cerca.z + Math.sin(a) * r;
      // suelo bajo el punto (calle, tejado o lo alto de la muralla)
      const hit = ctx.fisica.lanzarRayo(new THREE.Vector3(x, cerca.y + 3, z), ABAJO, 10);
      const pies = new THREE.Vector3(x, hit ? hit.punto.y : cerca.y, z);
      const base = ASPECTOS[m.nombre] ?? {};
      const s = new Soldado(ctx, m.nombre, m.rol, { ...base, ...m.aspecto }, pies, base.habilidad ?? 1, this.chorros);
      // cada soldado tiene su caballo, para salir de un encuentro peligroso; el médico va siempre montado
      const medico = m.rol === 'medico';
      const alLado = medico ? pies : pies.clone().add(new THREE.Vector3(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5));
      s.caballo = new Caballo(ctx.escena, ctx.nav, ctx.poblacion);
      s.caballo.colocar(alLado, Math.random() * Math.PI * 2);
      this.soldados.push(s);
      ctx.poblacion.agregarHumano(s);
      if (medico) s.montar();
    });
    this.tCoordinar = 0;
  }

  /** Da la orden a la selección (todo el escuadrón o el soldado elegido con Tab). */
  ordenar(o: OrdenEscuadron, destino: DestinoOrden = {}): void {
    const ctx = this.ctx;
    const j = ctx.jugador;
    const grupo = (this.seleccion ? [this.seleccion] : this.soldados).filter((s) => s.vivo);
    if (grupo.length === 0) return;
    const titan = o === 'atacarTitan' ? destino.titan : undefined;
    if (o === 'atacarTitan' && !titan?.vivo) return;
    const conPunto = o === 'esperar' || o === 'irA' || o === 'explorar';
    const punto = conPunto ? (destino.punto?.clone() ?? puntoAlSuelo(ctx.fisica, j.posicion)) : undefined;
    grupo.forEach((s, i) => {
      const nueva: OrdenAsignada = { tipo: o, punto, titan, dada: true };
      if (punto && o !== 'explorar') nueva.puesto = this.puestoJunto(punto, i, grupo.length);
      if (o === 'atacarTitan') nueva.previa = s.orden.tipo === 'atacarTitan' ? s.orden.previa : s.orden;
      this.anularReflejo(s);
      s.orden = nueva;
    });
    this.tCoordinar = 0;
    // Bengala de señales de la Legión sobre el jugador y un «¡Entendido!»
    ctx.efectos.bengala(j.posicion.clone().setY(j.posicion.y + 2.5), COLOR_BENGALA[o]);
    const habla = this.seleccion ?? grupo.reduce((a, b) => (a.posicion.distanceToSquared(j.posicion) <= b.posicion.distanceToSquared(j.posicion) ? a : b));
    habla.ultimaFrase = -99;
    habla.decir(fraseConfirmacion(o, !this.seleccion && grupo.length > 1, Math.random, titan?.altura));
  }

  /** Una orden nueva cancela lo que hacía por su cuenta (depósito, rescate, gas, huida, curación). */
  private anularReflejo(s: Soldado): void {
    const m = s.mision;
    if (m.tipo === 'recargar' || m.tipo === 'rescatar' || m.tipo === 'huir' || m.tipo === 'curar' || (m.tipo === 'darGas' && !m.pedido)) s.mision = { tipo: 'seguir' };
    s.huyendo = false;
  }

  trabajarEn(h: Humano, punto: THREE.Vector3 | null, descanso?: THREE.Vector3): void {
    const s = this.soldados.find((x) => x === h);
    if (!s || !s.vivo) return;
    this.anularReflejo(s);
    if (punto) {
      // a pie de obra, a la altura del cuerpo
      const p = punto.clone().setY(0);
      s.orden = { tipo: 'irA', punto: p, puesto: p.clone().setY(0.9), trabajo: true, dada: true };
    } else if (descanso) {
      const p = descanso.clone().setY(0);
      s.orden = { tipo: 'esperar', punto: p, puesto: this.puestoJunto(p, this.soldados.indexOf(s), this.soldados.length), dada: true, campamento: true };
    } else s.orden = { tipo: 'seguir' };
    this.tCoordinar = 0;
  }

  /** Tab: Todos → cada soldado vivo → Todos. */
  cambiarSeleccion(): Soldado | null {
    const i = this.seleccion ? this.soldados.indexOf(this.seleccion) : null;
    const sig = siguienteSeleccion(i, this.soldados.map((s) => s.vivo));
    this.seleccion = sig === null ? null : this.soldados[sig];
    for (const s of this.soldados) s.seleccionado = s === this.seleccion;
    return this.seleccion;
  }

  info(h: Humano): InfoSoldado | null {
    const s = this.soldados.find((x) => x === h);
    if (!s) return null;
    return {
      orden: s.orden.tipo,
      actividad: s.vivo ? s.actividad() : '',
      gas: (s.gas / s.gasMax) * 100,
      salud: (s.salud / s.saludMax) * 100,
      filo: s.cuchillas.filo,
      repuesto: s.cuchillas.repuesto,
      // el trabajo del campamento no lleva banderín
      punto: s.orden.trabajo ? undefined : s.orden.punto,
      titan: s.orden.titan,
    };
  }

  limpiar(): void {
    for (const s of this.soldados) {
      s.eliminar();
      s.caballo?.liberar();
      this.ctx.poblacion.quitarHumano(s);
    }
    this.soldados.length = 0;
    this.seleccion = null;
    this.avisados.clear();
  }

  /** El compañero más cercano con gas de sobra viene a pasártelo. */
  pedirGas(): Humano | null {
    const d = this.donanteGas();
    if (!d) return null;
    d.mision = { tipo: 'darGas', humano: this.ctx.jugador, pedido: true };
    d.decir('¡Aguanta, voy a pasarte gas!');
    return d;
  }

  /** Quién podría darte gas ahora mismo (para el HUD): el intendente primero, venga de donde venga. */
  donanteGas(): Soldado | null {
    const j = this.ctx.jugador;
    const intendente = this.soldados.find((s) => s.rol === 'intendente' && s.vivo && !s.agarradoPor && s.gas > s.gasMax * 0.15);
    if (intendente && intendente.posicion.distanceTo(j.posicion) < 700) return intendente;
    let mejor: Soldado | null = null;
    let dMejor = 180;
    for (const s of this.soldados) {
      if (!s.vivo || s.agarradoPor || s.gas < s.gasMax * 0.25) continue;
      const d = s.posicion.distanceTo(j.posicion);
      if (d < dMejor) {
        dMejor = d;
        mejor = s;
      }
    }
    return mejor;
  }

  actualizar(dt: number): void {
    if (this.soldados.length === 0) return;
    if (this.seleccion && !this.seleccion.vivo) {
      this.seleccion.seleccionado = false;
      this.seleccion = null;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: 'Mando: todo el escuadrón', segundos: 2 });
    }
    this.tCoordinar -= dt;
    if (this.tCoordinar <= 0) {
      this.tCoordinar = 0.4;
      this.coordinar();
    }
    const j = this.ctx.jugador;
    for (const s of this.soldados) {
      s.paso(dt);
      if (!s.vivo) continue;
      const m = s.mision;
      // entrega de gas al llegar junto a quien lo necesita (tú u otro soldado)
      const receptor = m.tipo === 'darGas' ? (m.humano ?? j) : null;
      if (receptor && (!receptor.vivo || receptor.agarradoPor)) s.mision = { tipo: 'seguir' };
      else if (receptor && s.posicion.distanceTo(receptor.posicion) < 5.5) {
        const companero = receptor instanceof Soldado ? receptor : null;
        const falta = companero ? companero.gasMax - companero.gas : j.gas.capacidad - j.gas.nivel;
        const intendente = s.rol === 'intendente';
        const dado = s.darGas(intendente ? falta : Math.min(falta, 100));
        if (companero) companero.gas = Math.min(companero.gasMax, companero.gas + dado);
        else j.gas.nivel = Math.min(j.gas.capacidad, j.gas.nivel + dado);
        // el intendente además cambia las hojas y venda las heridas
        let extra = '';
        if (intendente) {
          if (companero) {
            if (companero.cuchillas.repuesto < 4 || companero.cuchillas.filo < 1) {
              companero.cuchillas.rellenar();
              extra += ', hojas nuevas';
            }
            if (companero.salud < companero.saludMax - 5) {
              companero.curar(60);
              extra += ' y un vendaje';
            }
          } else {
            if (j.paresRepuesto < 4 || j.filo < 1) {
              j.reabastecer();
              extra += ', hojas nuevas';
            }
            if (j.salud < j.saludMax - 5) {
              j.curar(60);
              extra += ' y un vendaje';
            }
          }
        }
        s.ultimaFrase = -99;
        const a = companero ? `${companero.nombre}, toma` : 'Toma';
        s.decir(dado > 0 || extra ? `${a}: gas${dado > 0 ? ` (+${Math.round(dado)})` : ''}${extra}` : 'Ya no me queda gas…');
        if ((dado > 0 || extra) && !companero) this.ctx.eventos.emit({ tipo: 'recarga', quien: j });
        s.mision = { tipo: 'seguir' };
      }
      // recarga en el depósito
      if (m.tipo === 'recargar' && m.destino && Math.hypot(m.destino.x - s.posicion.x, m.destino.z - s.posicion.z) < 3 && Math.abs(m.destino.y - s.posicion.y) < 3) {
        s.reabastecer();
        s.ultimaFrase = -99;
        s.decir('¡Equipo recargado! Vuelvo a mi puesto');
        this.ctx.eventos.emit({ tipo: 'recarga', quien: s });
        s.mision = { tipo: 'seguir' };
        this.tCoordinar = 0;
      }
    }
    // caballos sueltos: huyen de los titanes, vienen si los llamas y pastan
    for (const s of this.soldados) if (s.caballo && !s.montado) s.caballo.actualizar(dt);
    this.curar(dt);
  }

  dibujar(dt: number, t: number): void {
    const camara = this.ctx.camara;
    this.matriz.multiplyMatrices(camara.projectionMatrix, camara.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matriz);
    const paso = dt * this.ctx.reloj.escala;
    for (const s of this.soldados) {
      s.dibujar(1, paso, t, camara.position, this.frustum);
      // el caballo se ve con su jinete, o suelto si no está lejos; los de lejos (LOD) no se dibujan
      const c = s.caballo;
      if (!c) continue;
      c.grupo.visible = s.montado || !s.lod;
      if (c.grupo.visible) c.dibujar(1, paso);
    }
    this.chorros.actualizar(paso);
  }

  // ─────────────────────────── Coordinación ───────────────────────────

  private coordinar(): void {
    const ctx = this.ctx;
    const j = ctx.jugador;
    const libres = this.soldados.filter((s) => s.vivo && !s.agarradoPor);
    if (libres.length === 0) return;
    const asignados = new Set<Soldado>();

    // 0. Titán señalado abatido: cada uno vuelve a la orden que tenía
    const anunciados = new Set<TitanAPI>();
    for (const s of libres) {
      const o = s.orden;
      if (o.tipo !== 'atacarTitan' || o.titan?.vivo) continue;
      s.orden = o.previa ?? { tipo: 'seguir' };
      if (o.titan && !anunciados.has(o.titan)) {
        anunciados.add(o.titan);
        s.ultimaFrase = -99;
        s.decir('¡Ese ya no se levanta! Volvemos a lo de antes');
      }
    }

    // Quien lleva gas termina su entrega
    for (const s of libres) if (s.mision.tipo === 'darGas') asignados.add(s);

    // El intendente reparte gas sin que se lo pidan: a ti primero, luego al que vaya más justo
    for (const s of libres) {
      // si está huyendo de un titán, primero se pone a salvo (lo lleva la retirada)
      if (s.rol !== 'intendente' || asignados.has(s) || s.huyendo || (s.orden.dada && !s.orden.campamento)) continue;
      const quien = this.necesitaGas(s);
      if (!quien) continue;
      if (!(s.mision.tipo === 'darGas' && s.mision.humano === quien)) {
        s.mision = { tipo: 'darGas', humano: quien };
        // lo anuncia una vez por compañero (no cada vez que retoma la entrega)
        if (s.avisoGas.humano !== quien || ctx.reloj.t - s.avisoGas.t > 30) {
          s.avisoGas = { humano: quien, t: ctx.reloj.t };
          s.ultimaFrase = -99;
          s.decir(quien === j ? '¡Voy, te llevo gas, hojas y vendas!' : `¡${quien instanceof Soldado ? quien.nombre : 'Eh'}, aguanta, te llevo suministros!`);
        }
      }
      asignados.add(s);
    }

    // Heridos y encuentros peligrosos: a caballo, hacia el médico (o hacia ti); el médico va a por ti si estás herido
    this.retirar(libres, asignados);
    this.medicos(libres, asignados);

    // 1. Rescates: alguien en la mano de un titán (no quien está en retirada ni huye)
    for (const h of ctx.poblacion.humanos) {
      const titan = h.agarradoPor;
      if (!h.vivo || !titan || !titan.vivo) continue;
      const zona = titan.puntosDebiles.find((p) => p.activo && MANOS.includes(p.zona))?.zona;
      if (!zona) continue;
      const s = this.masCercano(libres, asignados, h.posicion, (x) => x.cuchillas.puedeCortar && x.orden.tipo !== 'retirada' && x.rol !== 'medico' && puedeRescatar(x.orden.tipo, !!x.orden.dada, h === j));
      if (!s || s.posicion.distanceTo(h.posicion) > 180) continue;
      if (!(s.mision.tipo === 'rescatar' && s.mision.titan === titan && s.mision.zona === zona)) s.mision = { tipo: 'rescatar', titan, zona, humano: h };
      if (h === j) s.decir('¡Aguanta, voy a por ti!');
      asignados.add(s);
    }

    // 2. Reabastecerse: poco gas o sin cuchillas, y sin combate cerca
    for (const s of libres) {
      if (asignados.has(s) || s.orden.tipo === 'retirada' || s.rol === 'medico' || s.orden.dada) continue;
      if (this.combateCerca(s.posicion)) {
        if (s.mision.tipo === 'recargar') s.mision = { tipo: 'seguir' };
        continue;
      }
      if (s.mision.tipo === 'recargar') {
        // un minuto sin llegar: el depósito no es alcanzable; vuelve a su orden y no insiste
        if (ctx.reloj.t > (s.mision.hasta ?? Infinity)) {
          s.mision = { tipo: 'seguir' };
          s.vetoRecarga = ctx.reloj.t + 45;
          continue;
        }
        asignados.add(s);
        continue;
      }
      const gasPct = (s.gas / s.gasMax) * 100;
      if (ctx.reloj.t < s.vetoRecarga || !necesitaRecarga(gasPct, s.cuchillas.filo, s.cuchillas.repuesto)) continue;
      const destino = this.puntoDeposito(s.posicion);
      if (!destino) continue;
      s.mision = { tipo: 'recargar', destino, hasta: ctx.reloj.t + 60 };
      s.decir(gasPct < 25 ? 'Me queda poco gas: voy al depósito' : 'Me he quedado sin cuchillas: voy al depósito');
      asignados.add(s);
    }

    // 3. Titanes: cada uno propone el suyo según su orden; los que coinciden atacan juntos
    const memo = new Map<unknown, TitanAPI | null>();
    const equipos = new Map<TitanAPI, Soldado[]>();
    for (const s of libres) {
      if (asignados.has(s)) continue;
      const t = this.titanPara(s, memo);
      if (!t) continue;
      const e = equipos.get(t);
      if (e) e.push(s);
      else equipos.set(t, [s]);
    }
    for (const [objetivo, equipo] of equipos) {
      this.tactica(objetivo, equipo);
      for (const s of equipo) asignados.add(s);
    }

    // 4. El resto cumple su orden. En el campamento terminado, quien espera allí (o te sigue
    // mientras tú estás dentro) se queda dentro, repartido alrededor de la hoguera
    const enFuerte = libres.filter((s) => !asignados.has(s) && this.enFuerte(s));
    enFuerte.forEach((s, i) => {
      s.mision = { tipo: 'mantener', destino: ctx.fuerte!.puesto(i, enFuerte.length) };
      asignados.add(s);
    });
    const v = j.velocidad;
    if (Math.hypot(v.x, v.z) > 2) this.rumboFormacion.set(v.x, 0, v.z).normalize();
    const f = this.rumboFormacion;
    const lado = new THREE.Vector3(f.z, 0, -f.x);
    let centroCiviles: THREE.Vector3 | null | undefined;
    let huecoJugador = 0;
    let huecoCiviles = 0;
    for (const s of libres) {
      if (asignados.has(s)) continue;
      const o = s.orden;
      if (o.tipo === 'esperar' || o.tipo === 'irA') {
        s.mision = { tipo: 'mantener', destino: o.puesto ?? (o.punto ?? s.posicion).clone().setY((o.punto ?? s.posicion).y + CENTRO) };
        continue;
      }
      if (o.tipo === 'explorar') {
        s.mision = { tipo: 'patrullar', destino: this.siguientePatrulla(s, o) };
        continue;
      }
      if (o.tipo === 'proteger' && centroCiviles === undefined) centroCiviles = this.centroCiviles();
      const civiles = o.tipo === 'proteger' ? (centroCiviles ?? null) : null;
      const [lx, lz] = HUECOS[(civiles ? huecoCiviles++ : huecoJugador++) % HUECOS.length];
      const destino = (civiles ?? j.posicion).clone().addScaledVector(lado, lx).addScaledVector(f, -lz);
      if (o.tipo === 'retirada') destino.addScaledVector(f, -6);
      // si el jugador está en el aire, la formación va algo más alta; a ras de suelo, en la calle
      if (!civiles && j.posicion.y > 3) destino.y = j.posicion.y + 1;
      else {
        const libre = ctx.nav.puntoLibreCercano(destino.x, destino.z, 1, 4);
        if (libre) destino.set(libre.x, destino.y, libre.z);
      }
      s.mision = { tipo: o.tipo === 'proteger' ? 'proteger' : o.tipo === 'retirada' ? 'retirada' : 'seguir', destino };
      // se quedó muy atrás: aparece detrás del jugador (solo quien le sigue o se retira)
      if ((o.tipo === 'seguir' || o.tipo === 'retirada') && s.posicion.distanceTo(j.posicion) > 170) {
        s.teletransportar(destino.clone().addScaledVector(f, -25).setY(Math.max(destino.y, 1) + 6), j.velocidad.clone().multiplyScalar(0.8));
      }
    }

    // a caballo solo para moverse: quien va a pelear baja; el médico vuelve a montar cuando no pelea
    for (const s of libres) {
      const combate = s.mision.tipo === 'atacar' || s.mision.tipo === 'rescatar';
      if (combate && s.montado) s.desmontar();
      else if (!combate && !s.montado && s.rol === 'medico' && !this.ctx.fuerte?.dentro(s.posicion) && !this.enFuerte(s)) this.subirAlCaballo(s);
    }

    // 5. Vigías
    this.avisar(libres);
    // caballos de quien va a pie: si se han quedado lejos, vienen a por su jinete
    for (const s of libres) {
      const c = s.caballo;
      if (!c || s.montado || c.pos.distanceTo(s.posicion) < 25) continue;
      c.llamar(s.posicion, c.rumbo);
    }
  }

  /**
   * Heridos y encuentros peligrosos: el soldado deja el combate y, si tiene caballo, huye a
   * galope hacia el médico (o hacia ti). Te avisa de cada herido y de quien vuelve a la línea.
   */
  private retirar(libres: Soldado[], asignados: Set<Soldado>): void {
    const ctx = this.ctx;
    const medico = this.medicoVivo();
    for (const s of libres) {
      const fraccion = s.salud / s.saludMax;
      const estabaHerido = s.herido;
      s.herido = estaHerido(fraccion, s.herido);
      if (s.herido && !estabaHerido) {
        s.huyendo = true;
        s.decir('¡Me han herido, me retiro!');
        const adonde = medico && medico !== s ? 'con el médico' : 'hacia ti';
        ctx.eventos.emit({ tipo: 'mensaje', texto: `${s.nombre} tiene heridas graves (${Math.round(fraccion * 100)} %): se retira ${adonde}`, segundos: 3 });
      } else if (estabaHerido && !s.herido) {
        ctx.eventos.emit({ tipo: 'mensaje', texto: `${s.nombre} se ha recuperado: vuelve a la línea`, segundos: 2.5 });
      }
      // con una orden tuya no huye por su cuenta: la retirada (4) lo manda a tu espalda, a caballo si está lejos
      if (s.orden.dada) {
        s.huyendo = false;
        // en el campamento la retirada es quedarse dentro (lo coloca el paso 4)
        if (this.enFuerte(s)) {
          if (s.montado && s.rol !== 'medico') s.desmontar();
          continue;
        }
        const espalda = this.traseraJugador();
        if (s.orden.tipo === 'retirada' && Math.hypot(espalda.x - s.posicion.x, espalda.z - s.posicion.z) > LLEGADA_REFUGIO + 3) {
          asignados.add(s);
          s.mision = { tipo: 'huir', destino: espalda };
          this.subirAlCaballo(s);
        } else if (s.montado && s.rol !== 'medico') s.desmontar();
        continue;
      }
      const refugio = this.refugioPara(s, medico);
      const dist = Math.hypot(refugio.x - s.posicion.x, refugio.z - s.posicion.z);
      const peligrosos = ctx.poblacion.titanesCerca(s.posicion, RADIO_PELIGRO).filter(esAmenaza).length;
      const amenazado = ctx.poblacion.titanesCerca(s.posicion, RADIO_HUIDA).some(esAmenaza);
      if (!s.huyendo && encuentroPeligroso(peligrosos)) s.huyendo = true;
      if (s.huyendo && !s.herido && !amenazado && dist < LLEGADA_REFUGIO) s.huyendo = false;
      if (!s.huyendo) {
        if (s.montado && s.rol !== 'medico') s.desmontar();
        continue;
      }
      asignados.add(s);
      s.mision = { tipo: 'huir', destino: refugio };
      this.subirAlCaballo(s);
    }
  }

  /** Su caballo viene a por él; cuando está a su lado, sube. */
  private subirAlCaballo(s: Soldado): void {
    const c = s.caballo;
    if (!c || s.montado || !s.vivo) return;
    const d = Math.hypot(c.pos.x - s.posicion.x, c.pos.z - s.posicion.z);
    if (d < DISTANCIA_MONTAR) s.montar();
    else c.llamar(s.posicion, c.rumbo);
  }

  /** Adónde se retira por sus heridas o por el peligro: junto al médico (si no es él) o a tu espalda. */
  private refugioPara(s: Soldado, medico: Soldado | null): THREE.Vector3 {
    // con el campamento terminado cerca, los heridos se juntan dentro de la empalizada
    const f = this.ctx.fuerte;
    if (f?.listo && f.centro.distanceTo(s.posicion) < 300) return f.puesto(this.soldados.indexOf(s), this.soldados.length);
    if (medico && medico !== s) return medico.posicion.clone();
    return this.traseraJugador();
  }

  /** A tu espalda, donde se juntan los que se retiran contigo. */
  private traseraJugador(): THREE.Vector3 {
    return this.ctx.jugador.posicion.clone().addScaledVector(this.rumboFormacion, -12);
  }

  /** El médico que cura: vivo, sin herir y sin que lo agarren. */
  private medicoVivo(): Soldado | null {
    return this.soldados.find((s) => s.rol === 'medico' && s.vivo && !s.agarradoPor && !s.herido) ?? null;
  }

  /** El médico va a por ti (sin orden tuya) cuando estás por debajo del 60 % o sin cuchillas de repuesto. */
  private medicos(libres: Soldado[], asignados: Set<Soldado>): void {
    const j = this.ctx.jugador;
    if (!j.vivo || j.agarradoPor) return;
    const herido = j.salud < j.saludMax * 0.6;
    if (!herido && j.paresRepuesto > 0) return;
    for (const s of libres) {
      if (s.rol !== 'medico' || asignados.has(s) || s.orden.dada) continue;
      if (s.mision.tipo !== 'curar') s.decir(herido ? '¡Aguanta, voy a curarte!' : '¡Te llevo cuchillas!');
      s.mision = { tipo: 'curar', humano: j };
      asignados.add(s);
    }
  }

  /**
   * Médicos: curan a los heridos y al jugador que tienen cerca, y reparten un par de cuchillas a
   * quien se haya quedado sin repuesto. Un herido sin médico al lado que descansa junto al
   * jugador se recupera despacio.
   */
  private curar(dt: number): void {
    const j = this.ctx.jugador;
    const medicos = this.soldados.filter((s) => s.rol === 'medico' && s.vivo && !s.agarradoPor);
    for (const s of this.soldados) {
      if (!s.vivo || s.salud >= s.saludMax) continue;
      if (medicos.some((m) => m !== s && m.posicion.distanceTo(s.posicion) < RADIO_CURA)) s.curar(CURACION_SOLDADO * dt);
      else if (s.posicion.distanceTo(j.posicion) < RADIO_CURA + 3) s.curar(CURACION_SIN_MEDICO * dt);
    }
    if (j.vivo && !j.agarradoPor && j.salud < j.saludMax && medicos.some((m) => m.posicion.distanceTo(j.posicion) < RADIO_CURA)) j.curar(CURACION_JUGADOR * dt);
    // cuchillas: quien se queda sin repuesto recibe un par del médico que tenga cerca
    for (const m of medicos) {
      if (j.vivo && !j.agarradoPor && j.paresRepuesto <= 0 && m.posicion.distanceTo(j.posicion) < RADIO_CURA) {
        j.recogerEquipo(0, PARES_MEDICO);
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: `${m.nombre}: ¡cuchillas de repuesto!`, segundos: 2 });
      }
      for (const s of this.soldados) {
        if (s === m || !s.vivo || s.cuchillas.repuesto > 0 || m.posicion.distanceTo(s.posicion) >= RADIO_CURA) continue;
        s.cuchillas.repuesto = Math.min(Cuchillas.MAX_REPUESTO, PARES_MEDICO);
        s.decir('¡Toma, cuchillas de repuesto!');
      }
    }
  }

  /** Cebo delante de la cara, apoyo a los tendones y rematadores a la nuca. */
  private tactica(objetivo: TitanAPI, equipo: Soldado[]): void {
    const H = objetivo.altura;
    const tumbado = objetivo.estado === 'derribado' || objetivo.estado === 'cegado';
    const tendon = TENDONES.find((z) => objetivo.puntosDebiles.some((p) => p.zona === z && p.activo));
    let cebo = false;
    const orden: Record<RolSoldado, number> = { cebo: 0, apoyo: 1, rematador: 2, intendente: 3, medico: 4 };
    for (const s of [...equipo].sort((a, b) => orden[a.rol] - orden[b.rol])) {
      let m: { cebo?: boolean; zona?: ZonaTitan };
      if (s.rol === 'cebo' && !cebo && equipo.length > 1 && !tumbado) {
        m = { cebo: true };
        cebo = true;
      } else if (s.rol === 'apoyo' && !tumbado && H >= 6 && tendon) m = { zona: tendon };
      else m = { zona: 'nuca' };
      const igual = s.mision.tipo === 'atacar' && s.mision.titan === objetivo && !!s.mision.cebo === !!m.cebo && s.mision.zona === m.zona;
      if (!igual) {
        s.mision = { tipo: 'atacar', titan: objetivo, ...m };
        if (m.cebo) s.decir('¡Eh, aquí! ¡Mírame a mí!');
      }
    }
  }

  /** El titán al que va un soldado según su orden (los que comparten criterio comparten cálculo). */
  /** A quién le hace falta gas (para el intendente): el jugador por debajo del 35 %, o el compañero más justo. */
  private necesitaGas(intendente: Soldado): Humano | null {
    const j = this.ctx.jugador;
    // nunca se mete bajo las manos de un titán para llegar a nadie (las de uno grande llegan lejos)
    const seguro = (h: Humano) => !this.ctx.poblacion.titanesCerca(h.posicion, 50).some((t) => esAmenaza(t) && t.posicion.distanceTo(h.posicion) < 14 + 0.5 * t.altura);
    if (j.vivo && !j.agarradoPor && seguro(j) && (j.gas.nivel < j.gas.capacidad * 0.35 || j.salud < j.saludMax * 0.6 || j.paresRepuesto < 2 || j.filo < 0.3)) return j;
    let peor: Soldado | null = null;
    let nota = 0;
    for (const s of this.soldados) {
      if (s === intendente || !s.vivo || s.agarradoPor || s.mision.tipo === 'recargar') continue;
      if (s.posicion.distanceTo(intendente.posicion) > 400 || !seguro(s)) continue;
      const gas = s.gas < s.gasMax * 0.3 ? 1 - s.gas / s.gasMax : 0;
      const vida = s.salud < s.saludMax * 0.7 ? 1 - s.salud / s.saludMax : 0;
      const hojas = s.cuchillas.repuesto === 0 && s.cuchillas.filo < 0.3 ? 0.5 : 0;
      const n = gas + vida + hojas;
      if (n > nota) {
        nota = n;
        peor = s;
      }
    }
    return peor;
  }

  /**
   * ¿Se queda dentro del campamento fortificado? Con la empalizada terminada: quien tiene la orden
   * de esperar allí y, mientras tú estás dentro, quien te sigue, protege o se retira. Solo sale si
   * le ordenas atacar (2), atacar a un titán (7), ir a otro sitio o explorar.
   */
  private enFuerte(s: Soldado): boolean {
    const f = this.ctx.fuerte;
    if (!f?.listo || !s.vivo) return false;
    const o = s.orden;
    if (o.tipo === 'esperar' && o.campamento) return true;
    // «esperad aquí» o «id allí» con el punto dentro del campamento: se quedan dentro
    if ((o.tipo === 'esperar' || o.tipo === 'irA') && o.punto && f.dentro(o.punto.clone().setY(1))) return true;
    return f.dentro(this.ctx.jugador.posicion) && (o.tipo === 'seguir' || o.tipo === 'proteger' || o.tipo === 'retirada');
  }

  private titanPara(s: Soldado, memo: Map<unknown, TitanAPI | null>): TitanAPI | null {
    // dentro del campamento nadie sale a pelear sin que se lo mandes; solo si un titán se cuela por
    // una brecha, los de dentro se le echan encima
    if (this.enFuerte(s)) {
      const f = this.ctx.fuerte!;
      return this.ctx.poblacion.titanesCerca(f.centro, 14).find((t) => esAmenaza(t) && f.dentro(t.posicion.clone().setY(1))) ?? null;
    }
    // el intendente nunca pelea, salvo que hayan caído todos los demás
    if (s.rol === 'intendente') {
      if (this.soldados.some((x) => x !== s && x.vivo)) return null;
      return this.elegirTitan('seguir') ?? this.amenazaDirecta(s, 35);
    }
    // el médico no pelea por su cuenta: solo si le mandas luchar (no seguirte ni retirarse)
    const luchan = s.orden.dada && s.orden.tipo !== 'seguir' && s.orden.tipo !== 'retirada';
    if (s.rol === 'medico' && !luchan) return null;
    const o = s.orden;
    const calcular = (clave: unknown, f: () => TitanAPI | null): TitanAPI | null => {
      if (!memo.has(clave)) memo.set(clave, f());
      return memo.get(clave) ?? null;
    };
    switch (o.tipo) {
      case 'retirada':
        return null;
      case 'atacarTitan':
        return o.titan?.vivo ? o.titan : null;
      case 'explorar':
        // los exploradores no buscan pelea: solo se defienden
        return this.amenazaDirecta(s, 35);
      case 'esperar':
      case 'irA': {
        const c = o.punto ?? s.posicion;
        return calcular(c, () => this.amenazaPunto(c, RADIO_DEFENSA)) ?? this.amenazaDirecta(s, 18);
      }
      default:
        return calcular(o.tipo, () => this.elegirTitan(o.tipo));
    }
  }

  private elegirTitan(orden: OrdenEscuadron): TitanAPI | null {
    const ctx = this.ctx;
    const j = ctx.jugador;
    const vivos = ctx.poblacion.titanes.filter((t) => t.vivo);
    if (vivos.length === 0) return null;
    const cerca = (p: THREE.Vector3, r: number) => vivos.filter((t) => t.posicion.distanceTo(p) < r);
    const masProximo = (lista: TitanAPI[], p: THREE.Vector3) => lista.sort((a, b) => a.posicion.distanceTo(p) - b.posicion.distanceTo(p))[0] ?? null;
    switch (orden) {
      case 'seguir': {
        // solo los que amenazan al jugador o al escuadrón
        const amenazas = cerca(j.posicion, 55).filter(
          (t) => t.objetivo === j || (t.objetivo && t.objetivo.tipo === 'soldado') || t.posicion.distanceTo(j.posicion) < 22 + t.altura,
        );
        return masProximo(amenazas, j.posicion);
      }
      case 'atacar': {
        const tumbados = cerca(j.posicion, 160).filter((t) => t.estado === 'derribado' || t.estado === 'cegado');
        return masProximo(tumbados, j.posicion) ?? masProximo(cerca(j.posicion, 160), j.posicion);
      }
      case 'proteger': {
        const c = this.centroCiviles() ?? j.posicion;
        const cazando = vivos.filter((t) => t.objetivo?.tipo === 'civil' && t.posicion.distanceTo(c) < 220);
        return masProximo(cazando, c) ?? masProximo(cerca(c, 70), c);
      }
      default:
        return null;
    }
  }

  /** Titán que defender alrededor de un puesto: primero los tumbados, luego el más cercano. */
  private amenazaPunto(c: THREE.Vector3, radio: number): TitanAPI | null {
    const lista = this.ctx.poblacion.titanesCerca(c, radio).filter(esAmenaza);
    return lista.find((t) => t.estado === 'derribado' || t.estado === 'cegado') ?? lista[0] ?? null;
  }

  /** Titán que va a por este soldado y ya está encima. */
  private amenazaDirecta(s: Soldado, radio: number): TitanAPI | null {
    return this.ctx.poblacion.titanesCerca(s.posicion, radio).find((t) => t.objetivo === s && esAmenaza(t)) ?? null;
  }

  private combateCerca(p: THREE.Vector3): boolean {
    return this.ctx.poblacion.titanesCerca(p, 70).some(esAmenaza);
  }

  /** Dónde ponerse para recargar: junto al depósito libre más cercano (sin titanes alrededor). */
  private puntoDeposito(p: THREE.Vector3): THREE.Vector3 | null {
    const ctx = this.ctx;
    if (!this.depositoDisponible() || ctx.mundo.depositos.length === 0) return null;
    const tomado = (pos: THREE.Vector3) => ctx.poblacion.titanesCerca(pos, 50).some(esAmenaza);
    // solo depósitos del mismo lado de la muralla (no tiene puertas a los lados) y cercanos:
    // nadie abandona su puesto para cruzar medio territorio
    const R = ctx.mundo.muralla.radioInterior;
    const dentro = (v: THREE.Vector3) => Math.hypot(v.x, v.z) < R;
    const dist = (v: THREE.Vector3) => Math.hypot(v.x - p.x, v.z - p.z);
    const validos = ctx.mundo.depositos.filter((d) => dentro(d.pos) === dentro(p) && dist(d.pos) < 700 && !tomado(d.pos));
    if (validos.length === 0) return null;
    const dep = validos.reduce((a, b) => (dist(a.pos) <= dist(b.pos) ? a : b));
    const lado = new THREE.Vector3(p.x - dep.pos.x, 0, p.z - dep.pos.z);
    if (lado.lengthSq() < 1) lado.set(1, 0, 0);
    const junto = dep.pos.clone().add(lado.setLength(4));
    const suelo = puntoAlSuelo(ctx.fisica, junto.setY(dep.pos.y + 3), 20);
    return suelo.setY(suelo.y + CENTRO);
  }

  /** Puesto `i` de `n` alrededor del punto de espera, en la misma superficie (o en el punto). */
  private puestoJunto(punto: THREE.Vector3, i: number, n: number): THREE.Vector3 {
    for (const radio of [3.5, 1.8]) {
      const d = puesto(i, n, radio);
      const hit = this.ctx.fisica.lanzarRayo(new THREE.Vector3(punto.x + d.x, punto.y + 4, punto.z + d.z), ABAJO, 10);
      if (hit && Math.abs(hit.punto.y - punto.y) < 1.5) return hit.punto.clone().setY(hit.punto.y + CENTRO);
    }
    return punto.clone().setY(punto.y + CENTRO);
  }

  /** Punto de patrulla actual; al llegar mira 4 s alrededor y elige otro (o a los 45 s). */
  private siguientePatrulla(s: Soldado, o: OrdenAsignada): THREE.Vector3 {
    const t = this.ctx.reloj.t;
    const p = o.patrulla;
    if (!p || t >= (o.tPatrulla ?? 0)) {
      o.patrulla = this.puntoPatrullaLibre(o.punto ?? this.ctx.jugador.posicion);
      o.tPatrulla = t + 45;
    } else if (Math.hypot(p.x - s.posicion.x, p.z - s.posicion.z) < 8 && Math.abs(p.y - s.posicion.y) < 6) {
      o.tPatrulla = Math.min(o.tPatrulla ?? t, t + 4);
    }
    return o.patrulla!;
  }

  private puntoPatrullaLibre(c: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx;
    for (let k = 0; k < 6; k++) {
      const q = puntoPatrulla(c.x, c.z, RADIO_PATRULLA, Math.random);
      const libre = ctx.nav.puntoLibreCercano(q.x, q.z, 1.5, 6) ?? new THREE.Vector3(q.x, 0, q.z);
      const hit = ctx.fisica.lanzarRayo(new THREE.Vector3(libre.x, 70, libre.z), ABAJO, 75);
      if (hit && hit.distancia > 0.5 && hit.etiqueta !== 'titan' && hit.etiqueta !== 'nuca') return hit.punto.clone().setY(hit.punto.y + CENTRO);
    }
    return c.clone().setY(c.y + CENTRO);
  }

  /** Quien espera o patrulla avisa de cada titán nuevo que ve (uno cada 3,5 s como mucho). */
  private avisar(libres: Soldado[]): void {
    const ctx = this.ctx;
    const t = ctx.reloj.t;
    if (t - this.tAviso < 3.5) return;
    const j = ctx.jugador.posicion;
    for (const s of libres) {
      const o = s.orden.tipo;
      if ((o !== 'esperar' && o !== 'irA' && o !== 'explorar') || s.lod) continue;
      for (const titan of ctx.poblacion.titanesCerca(s.posicion, RADIO_AVISO)) {
        if (this.avisados.has(titan.id) || !esAmenaza(titan) || !this.loVe(s, titan)) continue;
        this.avisados.add(titan.id);
        this.tAviso = t;
        s.ultimaFrase = t;
        ctx.eventos.emit({ tipo: 'mensaje', texto: textoAviso(s.nombre, titan, titan.posicion.x - j.x, titan.posicion.z - j.z), segundos: 2.5 });
        ctx.efectos.bengala(s.posicion.clone().setY(s.posicion.y + 2), COLOR_AVISO);
        return;
      }
    }
  }

  /** ¿Hay línea de visión a la cabeza o al torso del titán? */
  private loVe(s: Soldado, titan: TitanAPI): boolean {
    const ojo = s.posicion.clone().setY(s.posicion.y + 0.8);
    for (const p of [titan.cabeza(), titan.posicion.clone().setY(titan.posicion.y + titan.altura * 0.5)]) {
      const dir = p.sub(ojo);
      const d = dir.length();
      if (d < 1) return true;
      const hit = this.ctx.fisica.lanzarRayo(ojo, dir.divideScalar(d), d);
      if (!hit || hit.etiqueta === 'titan' || hit.etiqueta === 'nuca' || hit.distancia > d - 2) return true;
    }
    return false;
  }

  /** Centro de los civiles que aún no se han salvado (para protegerlos). */
  private centroCiviles(): THREE.Vector3 | null {
    const lista = this.ctx.civiles.lista.filter((c) => c.vivo);
    if (lista.length === 0) return null;
    const j = this.ctx.jugador.posicion;
    // el grupo más cercano al jugador: media de los 12 más próximos
    const cercanos = [...lista].sort((a, b) => a.posicion.distanceToSquared(j) - b.posicion.distanceToSquared(j)).slice(0, 12);
    const c = new THREE.Vector3();
    for (const h of cercanos) c.add(h.posicion);
    return c.divideScalar(cercanos.length).setY(0);
  }

  private masCercano(lista: Soldado[], excluidos: Set<Soldado>, p: THREE.Vector3, filtro: (s: Soldado) => boolean): Soldado | null {
    let mejor: Soldado | null = null;
    let d = Infinity;
    for (const s of lista) {
      if (excluidos.has(s) || !filtro(s)) continue;
      const x = s.posicion.distanceTo(p);
      if (x < d) {
        d = x;
        mejor = s;
      }
    }
    return mejor;
  }
}
