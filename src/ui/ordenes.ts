import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { DestinoOrden, OrdenEscuadron, TitanAPI } from '../core/tipos';
import { puntoAlSuelo } from '../npc/escuadron';
import { ESTADO_ORDEN, NOMBRE_ORDEN, ORDENES_CON_PUNTO, TECLAS_ORDEN, flechaAngulo, titanApuntado } from '../npc/logicaOrdenes';

/**
 * Mando del escuadrón: las teclas 1–8 dan órdenes a la selección (todo el escuadrón o el
 * soldado elegido con Tab) y las que necesitan un sitio lo toman de la mira (rayo desde la
 * cámara: el punto para «Id allí» y «Explorad», el titán para «Atacad a ese titán»). En el
 * mundo, un mástil con banderín marca cada punto de espera, destino o patrulla; en el HUD,
 * el panel del escuadrón muestra a quién mandas y qué hace cada uno.
 */

/** Rayo de la mira: desde la cámara en la dirección de apuntado. */
export interface Mira {
  origen: THREE.Vector3;
  dir: THREE.Vector3;
  /** Colisionador a ignorar (el del jugador). */
  excluir?: RAPIER.Collider;
}

const ALCANCE_MIRA = 500;
const ALCANCE_TITAN = 400;

export class MandoEscuadron {
  private readonly banderines = new Map<THREE.Vector3, Banderin>();

  constructor(
    private readonly ctx: ContextoJuego,
    private readonly mira: () => Mira,
  ) {}

  /** Paso fijo: teclas de órdenes y de selección. */
  actualizar(): void {
    const ctx = this.ctx;
    const e = ctx.entrada;
    const esc = ctx.escuadron;
    const hayVivos = esc.soldados.some((s) => s.vivo);
    let pedida = false;
    if (e.consumir('Tab')) {
      pedida = true;
      if (hayVivos) {
        const s = esc.cambiarSeleccion();
        this.mensaje(`Mando: ${s ? s.nombre : 'todo el escuadrón'}`, 1.4);
      }
    }
    for (const tecla in TECLAS_ORDEN) {
      if (!e.consumir(tecla)) continue;
      pedida = true;
      if (hayVivos) this.dar(TECLAS_ORDEN[tecla]);
    }
    // antes no pasaba nada y parecía que nadie obedecía: decir por qué
    if (pedida && !hayVivos) {
      this.mensaje(esc.soldados.length === 0 ? 'Aquí no tienes escuadrón a tu mando' : 'Todo tu escuadrón ha caído: vendrán refuerzos al puesto de avanzada más cercano', 3);
    }
  }

  private dar(o: OrdenEscuadron): void {
    const destino: DestinoOrden = {};
    if (o === 'irA') destino.punto = this.puntoMira(true) ?? undefined;
    else if (o === 'explorar') destino.punto = this.puntoMira(false) ?? undefined;
    else if (o === 'atacarTitan') {
      const t = this.titanMira();
      if (!t) {
        this.mensaje('No hay ningún titán en la mira', 1.8);
        return;
      }
      destino.titan = t;
    }
    const esc = this.ctx.escuadron;
    esc.ordenar(o, destino);
    const quien = esc.seleccion ? ` a ${esc.seleccion.nombre}` : '';
    const extra = destino.titan ? ` (${Math.round(destino.titan.altura)} m)` : destino.punto ? ` (${Math.round(destino.punto.distanceTo(this.ctx.jugador.posicion))} m)` : '';
    this.mensaje(`Orden${quien}: ${NOMBRE_ORDEN[o]}${extra}`, 1.8);
  }

  /**
   * Punto del mundo bajo la mira, en una superficie: el impacto del rayo (si da en una pared,
   * un poco por delante y llevado al suelo). Sin impacto, el punto a 150 m llevado al suelo
   * (o null si `respaldo` es false).
   */
  puntoMira(respaldo: boolean): THREE.Vector3 | null {
    const { origen, dir, excluir } = this.mira();
    const fisica = this.ctx.fisica;
    const hit = fisica.lanzarRayo(origen, dir, ALCANCE_MIRA, excluir);
    if (hit) {
      const carne = hit.etiqueta === 'titan' || hit.etiqueta === 'nuca';
      if (!carne && hit.normal.y > 0.6) return hit.punto.clone();
      // en una pared, un poco por delante; en un titán, el suelo bajo él
      return puntoAlSuelo(fisica, carne ? hit.punto.clone() : hit.punto.clone().addScaledVector(hit.normal, 2.5));
    }
    if (!respaldo) return null;
    return puntoAlSuelo(fisica, origen.clone().addScaledVector(dir, 150));
  }

  /** El titán vivo más cercano al rayo de la mira (±6°, hasta 400 m). */
  titanMira(): TitanAPI | null {
    const { origen, dir } = this.mira();
    const vivos = this.ctx.poblacion.titanes.filter((t) => t.vivo);
    return titanApuntado(origen, dir, vivos, (t) => ({ pies: t.posicion, cabeza: t.cabeza(), radio: t.altura * 0.12 }), ALCANCE_TITAN, 6);
  }

  /** Banderines de los puntos de orden: uno por punto, se quitan al cambiar la orden. */
  dibujar(t: number): void {
    const ctx = this.ctx;
    const vistos = new Map<THREE.Vector3, OrdenEscuadron>();
    for (const s of ctx.escuadron.soldados) {
      if (!s.vivo) continue;
      const info = ctx.escuadron.info(s);
      if (info?.punto && ORDENES_CON_PUNTO.includes(info.orden)) vistos.set(info.punto, info.orden);
    }
    for (const [p, b] of this.banderines) {
      if (vistos.get(p) === b.orden) continue;
      b.eliminar();
      this.banderines.delete(p);
    }
    for (const [p, orden] of vistos) {
      let b = this.banderines.get(p);
      if (!b) {
        b = new Banderin(ctx.escena, p, orden);
        this.banderines.set(p, b);
      }
      b.actualizar(t, ctx.camara.position);
    }
  }

  private mensaje(texto: string, segundos: number): void {
    this.ctx.eventos.emit({ tipo: 'mensaje', texto, segundos });
  }
}

// ─────────────────────────── Banderín ───────────────────────────

const COLOR_BANDERIN: Partial<Record<OrdenEscuadron, string>> = { esperar: '#f2c230', irA: '#f2c230', explorar: '#9b4fe0' };
const ALTO_MASTIL = 9;
const LARGO_TELA = 3.4;

/**
 * Mástil de madera con un banderín de color que ondea (amarillo: esperar / id allí; morado:
 * patrulla) y un aro en el suelo. Crece con la distancia y, de lejos, un icono del mismo
 * color se ve por encima de todo (aunque lo tape la muralla).
 */
class Banderin {
  private readonly grupo = new THREE.Group();
  private readonly tela: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly base: Float32Array;
  private readonly icono: THREE.Sprite;
  private readonly recursos: { dispose(): void }[] = [];

  constructor(
    escena: THREE.Scene,
    private readonly punto: THREE.Vector3,
    readonly orden: OrdenEscuadron,
  ) {
    const color = COLOR_BANDERIN[orden] ?? '#f2c230';
    const madera = new THREE.MeshLambertMaterial({ color: '#4a3424' });
    const geoMastil = new THREE.CylinderGeometry(0.08, 0.12, ALTO_MASTIL, 6);
    geoMastil.translate(0, ALTO_MASTIL / 2, 0);
    const mastil = new THREE.Mesh(geoMastil, madera);
    mastil.castShadow = true;
    const geoRemate = new THREE.SphereGeometry(0.2, 10, 8);
    const remate = new THREE.Mesh(geoRemate, new THREE.MeshLambertMaterial({ color: '#d9b45a' }));
    remate.position.y = ALTO_MASTIL + 0.1;
    // banderín triangular: rejilla de 8×2 que se estrecha hacia la punta
    const geoTela = new THREE.PlaneGeometry(LARGO_TELA, 1.7, 8, 2);
    geoTela.translate(LARGO_TELA / 2, 0, 0);
    const pos = geoTela.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * (1 - (pos.getX(i) / LARGO_TELA) * 0.9));
    geoTela.translate(0.1, ALTO_MASTIL - 1.1, 0);
    this.base = Float32Array.from(pos.array as Float32Array);
    this.tela = new THREE.Mesh(geoTela, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false }));
    this.tela.frustumCulled = false;
    const geoAro = new THREE.RingGeometry(1.1, 1.5, 28);
    geoAro.rotateX(-Math.PI / 2);
    const aro = new THREE.Mesh(geoAro, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
    aro.position.y = 0.08;
    aro.renderOrder = 2;
    this.grupo.add(mastil, remate, this.tela, aro);
    this.grupo.position.copy(punto);
    escena.add(this.grupo);
    const tex = texturaIcono(color);
    const matIcono = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, transparent: true });
    this.icono = new THREE.Sprite(matIcono);
    this.icono.scale.set(0.06, 0.06, 1);
    this.icono.center.set(0.5, 0);
    this.icono.renderOrder = 6;
    escena.add(this.icono);
    this.recursos.push(madera, geoMastil, geoRemate, remate.material, geoTela, this.tela.material, geoAro, aro.material, tex, matIcono);
  }

  actualizar(t: number, camara: THREE.Vector3): void {
    const d = camara.distanceTo(this.punto);
    const escala = THREE.MathUtils.clamp(d / 110, 1, 7);
    this.grupo.scale.setScalar(escala);
    this.icono.visible = d > 45;
    this.icono.position.copy(this.punto).y += (ALTO_MASTIL + 0.6) * escala;
    // ondea (más cuanto más lejos del mástil) y gira despacio con el viento
    this.grupo.rotation.y = Math.sin(t * 0.3) * 0.6;
    const pos = this.tela.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3];
      pos.setZ(i, Math.sin(t * 5 - x * 1.8) * 0.16 * x);
    }
    pos.needsUpdate = true;
  }

  eliminar(): void {
    this.grupo.removeFromParent();
    this.icono.removeFromParent();
    for (const r of this.recursos) r.dispose();
  }
}

/** Icono de banderín (mástil y paño triangular) para verlo de lejos. */
function texturaIcono(color: string): THREE.CanvasTexture {
  const lienzo = document.createElement('canvas');
  lienzo.width = 64;
  lienzo.height = 64;
  const g = lienzo.getContext('2d');
  if (g) {
    g.lineJoin = 'round';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    g.beginPath();
    g.moveTo(18, 60);
    g.lineTo(18, 6);
    g.lineTo(54, 18);
    g.lineTo(18, 30);
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(18, 6);
    g.lineTo(54, 18);
    g.lineTo(18, 30);
    g.closePath();
    g.fill();
    g.strokeStyle = '#f3efe6';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(18, 60);
    g.lineTo(18, 6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(lienzo);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─────────────────────────── Panel del HUD ───────────────────────────

const LEYENDA =
  '<div class="leyenda"><span><b>1</b> Seguid</span><span><b>2</b> Atacad</span><span><b>3</b> Civiles</span><span><b>4</b> Retirada</span>' +
  '<span><b>5</b> Esperad</span><span><b>6</b> Id allí</span><span><b>7</b> Ese titán</span><span><b>8</b> Explorad</span>' +
  '<span class="tab"><b>Tab</b> a quién mandas</span></div>';

/**
 * Panel del escuadrón (arriba a la derecha): a quién mandas, y por soldado su orden, lo que
 * hace, distancia y flecha respecto a la cámara, gas y cuchillas. Caídos tachados.
 */
export class PanelEscuadron {
  private readonly el: HTMLDivElement;
  private espera = 0;

  constructor(padre: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud-mando';
    this.el.hidden = true;
    padre.appendChild(this.el);
  }

  actualizar(dt: number, ctx: ContextoJuego): void {
    const esc = ctx.escuadron;
    const soldados = esc.soldados;
    this.el.hidden = soldados.length === 0;
    this.espera -= dt;
    if (soldados.length === 0 || this.espera > 0) return;
    this.espera = 0.15;
    const j = ctx.jugador.posicion;
    const sel = esc.seleccion;
    const filas = soldados
      .map((s) => {
        const info = esc.info(s);
        if (!s.vivo || !info) return `<div class="soldado caido"><div class="l1"><span class="nombre">${s.nombre}</span><span class="orden">caído</span></div></div>`;
        const d = Math.round(s.posicion.distanceTo(j));
        const flecha = d < 3 ? '·' : flechaHacia(ctx.camara, s.posicion);
        let orden = ESTADO_ORDEN[info.orden];
        if (info.orden === 'atacarTitan' && info.titan) orden += ` ${Math.round(info.titan.altura)} m`;
        const gas = THREE.MathUtils.clamp(info.gas, 0, 100);
        const hojas = info.filo <= 0 ? (info.repuesto > 0 ? 'cambiando' : 'sin hojas') : info.filo < 0.3 ? `melladas ×${info.repuesto}` : `hojas ×${info.repuesto}`;
        const malas = info.filo < 0.3 && info.repuesto === 0;
        const clases = ['soldado', s === sel ? 'sel' : '', s.agarradoPor ? 'agarrado' : ''].join(' ');
        const actividad = info.actividad ? `<span class="act">${info.actividad}</span>` : '';
        return (
          `<div class="${clases}"><div class="l1"><span class="nombre">${s.nombre}</span><span class="orden">${orden}</span><span class="dist">${d} m ${flecha}</span></div>` +
          `<div class="l2"><small>GAS</small><span class="gas${gas < 25 ? ' bajo' : ''}"><i style="width:${gas.toFixed(0)}%"></i></span><span class="hojas${malas ? ' malas' : ''}">${hojas}</span>${actividad}</div></div>`
        );
      })
      .join('');
    const html = `<div class="cabecera">Mando: <b>${sel ? sel.nombre : 'Todos'}</b></div>${filas}${LEYENDA}`;
    if (this.el.innerHTML !== html) this.el.innerHTML = html;
  }
}

/** Flecha hacia `p` respecto a hacia dónde mira la cámara. */
function flechaHacia(camara: THREE.Camera, p: THREE.Vector3): string {
  const local = p.clone().applyMatrix4(camara.matrixWorldInverse);
  return flechaAngulo(Math.atan2(local.x, -local.z));
}
