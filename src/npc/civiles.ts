import * as THREE from 'three';
import { type Cilindro } from '../core/colision';
import { config } from '../core/config';
import type { ContextoJuego } from '../core/contexto';
import type { Navegacion } from '../core/navegacion';
import { crearRng, type Rng } from '../core/rng';
import type { CivilesAPI } from '../core/tipos';
import { CampoHuida, type Peligro } from './campoHuida';
import { Civil, type EntornoCivil } from './civil';
import { EstimadorAlfa } from './interpolacion';
import { CIVILES, ColaPuerta, crearAspectoCivil } from './logicaCivil';
import { ModeloCiviles, poseNeutra } from './modeloCivil';

/** Del centro del cuerpo de un civil a los pies (como `Humano.posicion`). */
const CENTRO_CIVIL = 0.85;

/**
 * Gestor de los aldeanos: los genera, les da navegación (rutas A* repartidas entre pasos y un
 * campo de flujo hacia la puerta norte que evita a los titanes), separación entre ellos,
 * percepción de titanes, la cola de la puerta (3 personas/s) y los contadores.
 *
 * `lista` contiene los civiles que siguen en el mundo (incluidos los agarrados); los salvados y
 * los devorados salen de ella, de la población y del dibujo.
 */

export interface OpcionesCiviles {
  /** Máximo de civiles a la vez (huecos del modelo instanciado). */
  capacidad?: number;
  semilla?: number;
}

const RUTAS_POR_PASO = 2;
const NODOS_CAMPO_POR_PASO = 5000;

export class GestorCiviles implements CivilesAPI, EntornoCivil {
  readonly lista: Civil[] = [];
  salvados = 0;
  muertos = 0;
  evacuando = false;
  t = 0;
  readonly nav: Navegacion;
  readonly puerta: THREE.Vector3;
  readonly salidaPuerta: THREE.Vector3;
  readonly rng: Rng;
  readonly modelo: ModeloCiviles;

  private readonly libres: number[] = [];
  private siguienteSlot = 0;
  private campo: CampoHuida | null = null;
  private recalcCampo = 0;
  private readonly cola = new ColaPuerta();
  private readonly pedidas: { c: Civil; destino: THREE.Vector3; token: number }[] = [];
  private readonly rejilla = new Map<number, Civil[]>();
  private indicePercepcion = 0;
  private readonly alfa = new EstimadorAlfa();
  private readonly pose = poseNeutra();
  private readonly tmp = new THREE.Vector3();
  private fotograma = 0;

  constructor(private readonly ctx: ContextoJuego, opciones: OpcionesCiviles = {}) {
    this.nav = ctx.nav;
    this.rng = crearRng(opciones.semilla ?? 9071);
    this.modelo = new ModeloCiviles(ctx.escena, opciones.capacidad ?? 220);
    this.puerta = ctx.mundo.muralla.puertaEvacuacion.clone().setY(0);
    this.salidaPuerta = this.puerta.clone().setY(0);
    if (this.salidaPuerta.lengthSq() < 1e-6) this.salidaPuerta.set(0, 0, -1);
    this.salidaPuerta.normalize();
  }

  get gravedad(): number {
    return config.fisica.gravedad;
  }

  /** Vivos y aún sin evacuar. */
  get restantes(): number {
    let n = 0;
    for (const c of this.lista) if (c.vivo && c.activo) n++;
    return n;
  }

  // ───────────── CivilesAPI ─────────────

  generar(n: number, centro: THREE.Vector3, radio: number): void {
    const R = this.ctx.mundo.muralla.radioInterior;
    const dentroMuralla = Math.hypot(centro.x, centro.z) < R;
    let creados = 0;
    while (creados < n) {
      const p = this.puntoAleatorio(centro, radio, dentroMuralla ? R - 4 : Infinity);
      if (!p) break;
      const c = this.crearCivil(p, this.rng.rango(-Math.PI, Math.PI));
      if (!c) break;
      creados++;
      // algunos charlan en parejas, frente a frente
      if (creados < n && this.rng.siguiente() < 0.25) {
        const a = this.rng.rango(-Math.PI, Math.PI);
        const q = p.clone().add(new THREE.Vector3(Math.sin(a) * 1.1, 0, Math.cos(a) * 1.1));
        if (this.nav.libre(q.x, q.z, CIVILES.radio)) {
          const c2 = this.crearCivil(q, a + Math.PI);
          if (c2) {
            c.rumbo = a;
            creados++;
          }
        }
      }
    }
    if (creados < n) console.warn(`[civiles] solo se han podido generar ${creados} de ${n}`);
  }

  evacuar(si: boolean): void {
    this.evacuando = si;
    if (si) {
      for (const c of this.lista) c.oirCampana(this.rng);
      this.recalcCampo = 0;
    }
  }

  limpiar(): void {
    for (const c of this.lista) {
      this.ctx.poblacion.quitarHumano(c);
      this.modelo.liberar(c.slot);
    }
    this.lista.length = 0;
    this.libres.length = 0;
    this.siguienteSlot = 0;
    this.modelo.limpiar();
    this.salvados = 0;
    this.muertos = 0;
    this.evacuando = false;
    this.cola.reiniciar();
    this.pedidas.length = 0;
  }

  actualizar(dt: number): void {
    this.alfa.pasoConsumido(dt);
    this.t += dt;
    if (this.lista.length === 0) return;
    this.actualizarCampo(dt);
    this.construirRejilla();
    this.percibir();
    for (const c of this.lista) c.paso(dt, this);
    this.atenderRutas();
    this.retirarFinalizados();
  }

  dibujar(dt: number, t: number): void {
    const alfa = this.alfa.alfa(dt, this.ctx.reloj.escala);
    this.fotograma++;
    const cam = this.ctx.camara.position;
    for (const c of this.lista) {
      if (!c.activo) continue;
      // los lejanos se animan a menos fotogramas
      const d2 = (c.pies.x - cam.x) ** 2 + (c.pies.z - cam.z) ** 2;
      if (d2 > 260 * 260 && (this.fotograma + c.slot) % 4 !== 0) continue;
      c.calcularPose(dt, t, alfa, this.pose);
      this.modelo.posar(c.slot, this.pose);
    }
    this.modelo.finalizar();
  }

  // ───────────── EntornoCivil ─────────────

  private readonly cilindroJugador: Cilindro = { x: 0, z: 0, radio: config.jugador.radio };
  private readonly listaJugador: Cilindro[] = [this.cilindroJugador];
  private readonly sinSolidos: Cilindro[] = [];

  /**
   * El jugador es sólido para los civiles cuando su cuerpo está a la altura de ellos (en la calle);
   * sobre un tejado no les estorba. Las listas se reutilizan: se pide una por civil y paso.
   */
  get solidos(): readonly Cilindro[] {
    const j = this.ctx.jugador.posicion;
    if (j.y >= CENTRO_CIVIL + config.jugador.altura) return this.sinSolidos;
    this.cilindroJugador.x = j.x;
    this.cilindroJugador.z = j.z;
    return this.listaJugador;
  }

  pasoHuida(c: Civil): THREE.Vector3 | null {
    const campo = this.campo;
    if (!campo || !campo.listo || !campo.dentro(c.pies.x, c.pies.z)) return null;
    const cadena = campo.cadena(c.pies.x, c.pies.z, 7);
    if (cadena.length === 0) return campo.costeEn(c.pies.x, c.pies.z) === 0 ? this.puerta : null;
    for (let k = cadena.length - 1; k >= 0; k--) {
      if (k === 0 || this.nav.lineaLibre(c.pies, cadena[k], CIVILES.radio)) return this.tmp.set(cadena[k].x, 0, cadena[k].z);
    }
    return null;
  }

  pedirRuta(c: Civil, destino: THREE.Vector3): void {
    this.pedidas.push({ c, destino: destino.clone(), token: c.tokenRuta });
  }

  destinoPaseo(c: Civil): THREE.Vector3 | null {
    const R = this.ctx.mundo.muralla.radioInterior - 24;
    const dentro = Math.hypot(c.pies.x, c.pies.z) < R + 20;
    for (let k = 0; k < 8; k++) {
      const a = this.rng.rango(-Math.PI, Math.PI);
      const d = this.rng.rango(12, 60);
      const x = c.pies.x + Math.sin(a) * d;
      const z = c.pies.z + Math.cos(a) * d;
      if (dentro && Math.hypot(x, z) > R) continue;
      if (this.nav.libre(x, z, 0.8)) return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  turnoPuerta(): number {
    return this.cola.turno(this.t);
  }

  separacion(c: Civil, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const ix = Math.floor(c.pies.x / 2);
    const iz = Math.floor(c.pies.z / 2);
    const r = 0.85;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const celda = this.rejilla.get(clave(ix + dx, iz + dz));
        if (!celda) continue;
        for (const o of celda) {
          if (o === c) continue;
          const ex = c.pies.x - o.pies.x;
          const ez = c.pies.z - o.pies.z;
          const d = Math.hypot(ex, ez);
          if (d >= r) continue;
          if (d < 1e-4) {
            out.x += (c.id % 2 ? 1 : -1) * 0.5;
            continue;
          }
          const f = ((r - d) / r) * 2.4;
          out.x += (ex / d) * f;
          out.z += (ez / d) * f;
        }
      }
    }
    const l = Math.hypot(out.x, out.z);
    if (l > 2) out.multiplyScalar(2 / l);
    return out;
  }

  // ───────────── Interno ─────────────

  private crearCivil(pies: THREE.Vector3, rumbo: number): Civil | null {
    const slot = this.libres.pop() ?? (this.siguienteSlot < this.modelo.capacidad ? this.siguienteSlot++ : -1);
    if (slot < 0) return null;
    const aspecto = crearAspectoCivil(this.rng);
    const c = new Civil(aspecto, pies, rumbo, slot, this.rng);
    this.modelo.asignar(slot, aspecto);
    this.lista.push(c);
    this.ctx.poblacion.agregarHumano(c);
    if (this.evacuando) c.oirCampana(this.rng);
    return c;
  }

  private puntoAleatorio(centro: THREE.Vector3, radio: number, maxRadioMundo: number): THREE.Vector3 | null {
    for (let k = 0; k < 40; k++) {
      const a = this.rng.rango(-Math.PI, Math.PI);
      const d = Math.sqrt(this.rng.siguiente()) * radio;
      const x = centro.x + Math.sin(a) * d;
      const z = centro.z + Math.cos(a) * d;
      if (Math.hypot(x, z) > maxRadioMundo) continue;
      if (this.nav.libre(x, z, 0.7)) return new THREE.Vector3(x, 0, z);
    }
    return this.nav.puntoLibreCercano(centro.x, centro.z, 0.7);
  }

  private construirRejilla(): void {
    for (const l of this.rejilla.values()) l.length = 0;
    for (const c of this.lista) {
      if (!c.activo || c.estado === 'agarrado') continue;
      const k = clave(Math.floor(c.pies.x / 2), Math.floor(c.pies.z / 2));
      let l = this.rejilla.get(k);
      if (!l) {
        l = [];
        this.rejilla.set(k, l);
      }
      l.push(c);
    }
  }

  /** Cada civil mira a su alrededor ~4 veces por segundo (repartido entre pasos). */
  private percibir(): void {
    const n = this.lista.length;
    const porPaso = Math.max(1, Math.ceil(n / 15));
    for (let k = 0; k < porPaso; k++) {
      if (this.indicePercepcion >= n) this.indicePercepcion = 0;
      const c = this.lista[this.indicePercepcion++];
      if (!c || !c.activo) continue;
      const t = this.ctx.poblacion.titanMasCercano(c.pies, CIVILES.radioAlarma + 30);
      c.titanCerca = t;
      c.distTitan = t ? Math.hypot(t.posicion.x - c.pies.x, t.posicion.z - c.pies.z) : Infinity;
    }
  }

  /** Campo de flujo hacia la puerta: se crea al primer uso y se recalcula con los titanes cerca. */
  private actualizarCampo(dt: number): void {
    const alguienHuye = this.evacuando || this.lista.some((c) => c.huyendo);
    if (!alguienHuye) return;
    if (!this.campo) {
      const R = this.ctx.mundo.muralla.radioInterior + 3;
      const L = this.nav.limites;
      this.campo = CampoHuida.alineado({ x: L.x0, z: L.z0 }, this.nav.celda, { x0: -R, x1: R, z0: -R, z1: R }, (x, z) => this.nav.libre(x, z, CIVILES.radio + 0.05));
    }
    const campo = this.campo;
    if (campo.ocupado) {
      campo.avanzar(NODOS_CAMPO_POR_PASO);
      return;
    }
    this.recalcCampo -= dt;
    if (this.recalcCampo > 0 && campo.listo) return;
    const R = this.ctx.mundo.muralla.radioInterior + 20;
    const peligros: Peligro[] = [];
    for (const t of this.ctx.poblacion.titanes) {
      if (!t.vivo || Math.hypot(t.posicion.x, t.posicion.z) > R) continue;
      peligros.push({ x: t.posicion.x, z: t.posicion.z, radio: 20 + 0.5 * t.altura, factor: 20 });
    }
    campo.iniciar([this.puerta], 7, peligros);
    campo.avanzar(NODOS_CAMPO_POR_PASO);
    this.recalcCampo = peligros.length > 0 ? 1.5 : 20;
  }

  private atenderRutas(): void {
    for (let k = 0; k < RUTAS_POR_PASO && this.pedidas.length > 0; k++) {
      const { c, destino, token } = this.pedidas.shift()!;
      if (!c.activo || token !== c.tokenRuta) continue;
      const ruta = this.nav.ruta(c.pies, destino, CIVILES.radio + 0.1, 3000);
      c.recibirRuta(ruta, this.rng);
    }
  }

  private retirarFinalizados(): void {
    for (let i = this.lista.length - 1; i >= 0; i--) {
      const c = this.lista[i];
      if (c.activo) continue;
      if (c.estado === 'salvado') {
        this.salvados++;
        this.ctx.eventos.emit({ tipo: 'civilSalvado', humano: c });
      } else {
        this.muertos++;
      }
      this.ctx.poblacion.quitarHumano(c);
      this.modelo.liberar(c.slot);
      this.libres.push(c.slot);
      this.lista.splice(i, 1);
    }
  }
}

function clave(ix: number, iz: number): number {
  return (ix + 4096) * 8192 + (iz + 4096);
}
