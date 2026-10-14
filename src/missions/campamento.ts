import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { Humano } from '../core/tipos';
import { texturaParticula } from '../world/texturas';
import {
  DESGASTE_ALAMBRE,
  FRENO_ALAMBRE,
  NUM_POSTES,
  OBRA_SOLDADO,
  RADIO_CARPAS,
  RADIO_CERCO,
  VIDA_ALAMBRE,
  aguja,
  avanceGolpe,
  calidadGolpe,
  enAlambre,
  nuevaZona,
  puntosCerco,
  repartirObras,
  type Golpe,
} from './logicaCampamento';

/**
 * Campamento de la Legión que montas donde quieras (K): un cerco de alambre de espino con
 * latas colgando y un corro de carpas alrededor de una hoguera.
 *
 * Al armarlo, el escuadrón se reparte las obras (cada soldado va a su poste o a su carpa y la
 * monta en unos segundos) y tú ayudas con el martillo: G (o el botón MARTILLO) cuando la aguja
 * pasa por la zona verde. Entre cada dos postes clavados se tiende el alambre. Terminado, es un
 * refugio: puedes dormir en las carpas (H) y reaparecer allí. Un titán que se mete en el
 * alambre se enreda (va a un cuarto de su velocidad) y las latas suenan; cada uno lo va
 * rompiendo poco a poco.
 */

interface Obra {
  pos: THREE.Vector3;
  rot: number;
  progreso: number;
  malla: THREE.Object3D;
  tipo: 'poste' | 'carpa';
}

export interface EstadoGuardadoCampamento {
  x: number;
  z: number;
  postes: number[];
  carpas: number[];
  alambre: number;
}

const MADERA = new THREE.MeshLambertMaterial({ color: '#6b4c30' });
const LONA = new THREE.MeshLambertMaterial({ color: '#d9cfb2', side: THREE.DoubleSide });
const LONA_VERDE = new THREE.MeshLambertMaterial({ color: '#5d6e4a', side: THREE.DoubleSide });
const LATA = new THREE.MeshLambertMaterial({ color: '#9aa0a6' });
const PIEDRA = new THREE.MeshLambertMaterial({ color: '#8f8a80' });

export class Campamento {
  readonly centro: THREE.Vector3;
  readonly grupo = new THREE.Group();
  readonly obras: Obra[] = [];
  /** Vida del alambre (0 = roto). */
  alambre = VIDA_ALAMBRE;
  /** Martillo: zona verde actual y tiempo de la aguja. */
  zona = 0.5;
  tAguja = 0;
  /** Obra junto a la que está el jugador (o −1). */
  obraJugador = -1;
  private readonly lineas: THREE.LineSegments;
  private readonly latas: THREE.InstancedMesh;
  private readonly fuego: THREE.Sprite;
  private readonly asignadas = new Map<Humano, number>();
  private readonly tGolpes = new Map<Humano, number>();
  private tLatas = 0;
  private listoAvisado = false;
  private hechosPrevios = '';
  private t = 0;

  constructor(private readonly ctx: ContextoJuego, centro: THREE.Vector3, guardado?: EstadoGuardadoCampamento) {
    this.centro = centro.clone().setY(0);
    // postes en anillo
    puntosCerco(this.centro.x, this.centro.z).forEach((p, i) => {
      const g = new THREE.Group();
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.2, 7), MADERA);
      poste.position.y = 1.1;
      poste.castShadow = true;
      g.add(poste);
      g.position.set(p.x, 0, p.z);
      this.grupo.add(g);
      this.obras.push({ pos: new THREE.Vector3(p.x, 0, p.z), rot: 0, progreso: guardado?.postes[i] ?? 0, malla: g, tipo: 'poste' });
    });
    // carpas en corro, con la entrada hacia la hoguera
    const nCarpas = 6;
    for (let i = 0; i < nCarpas; i++) {
      const a = (i / nCarpas) * Math.PI * 2 + 0.3;
      const pos = new THREE.Vector3(this.centro.x + Math.cos(a) * RADIO_CARPAS, 0, this.centro.z + Math.sin(a) * RADIO_CARPAS);
      const g = new THREE.Group();
      // prisma de lona: cilindro de 3 lados tumbado
      const lona = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.8, 3, 1, true), i % 2 ? LONA : LONA_VERDE);
      // el vértice del prisma, arriba; el largo, de la entrada (hacia la hoguera) al fondo
      lona.rotation.x = -Math.PI / 2;
      lona.position.y = 0.625;
      lona.castShadow = true;
      g.add(lona);
      const palo = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 5), MADERA);
      palo.position.set(0, 0.95, 1.35);
      g.add(palo);
      g.position.copy(pos);
      g.rotation.y = Math.atan2(this.centro.x - pos.x, this.centro.z - pos.z);
      this.grupo.add(g);
      this.obras.push({ pos, rot: g.rotation.y, progreso: guardado?.carpas[i] ?? 0, malla: g, tipo: 'carpa' });
    }
    // hoguera: piedras en corro, troncos y una llama (sprite aditivo, sin luz real)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const piedra = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.35), PIEDRA);
      piedra.position.set(this.centro.x + Math.cos(a) * 0.9, 0.12, this.centro.z + Math.sin(a) * 0.9);
      piedra.rotation.y = a;
      this.grupo.add(piedra);
    }
    for (let k = 0; k < 3; k++) {
      const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 6), MADERA);
      tronco.rotation.set(Math.PI / 2, (k * Math.PI) / 3, 0.25);
      tronco.position.set(this.centro.x, 0.15, this.centro.z);
      this.grupo.add(tronco);
    }
    this.fuego = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaParticula(), color: '#ffab4a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fuego.position.set(this.centro.x, 0.7, this.centro.z);
    this.grupo.add(this.fuego);
    // alambre: tres hilos entre postes clavados (se rehace al clavar uno) y latas colgando
    this.lineas = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#5b5f63' }));
    this.grupo.add(this.lineas);
    this.latas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 6), LATA, NUM_POSTES);
    this.latas.count = 0;
    this.latas.frustumCulled = false;
    this.grupo.add(this.latas);
    this.alambre = guardado?.alambre ?? VIDA_ALAMBRE;
    this.listoAvisado = this.listo;
    ctx.escena.add(this.grupo);
    this.zona = nuevaZona(Math.random);
    this.dibujarObras();
  }

  get postesHechos(): boolean[] {
    return this.obras.filter((o) => o.tipo === 'poste').map((o) => o.progreso >= 1);
  }

  get listo(): boolean {
    return this.obras.every((o) => o.progreso >= 1);
  }

  /** Progreso total de la obra (0–1). */
  get progreso(): number {
    return this.obras.reduce((n, o) => n + Math.min(1, o.progreso), 0) / this.obras.length;
  }

  /** ¿Está `p` dentro del cerco? */
  dentro(p: THREE.Vector3, margen = 0): boolean {
    return Math.hypot(p.x - this.centro.x, p.z - this.centro.z) < RADIO_CERCO + margen;
  }

  /** Aguja del martillo (0–1) ahora mismo. */
  get aguja(): number {
    return aguja(this.tAguja);
  }

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

  actualizar(dt: number): void {
    this.t += dt;
    this.tAguja += dt;
    const j = this.ctx.jugador;
    // obra junto al jugador (a pie)
    this.obraJugador = -1;
    let dMin = 2.8;
    this.obras.forEach((o, i) => {
      if (o.progreso >= 1) return;
      const d = Math.hypot(o.pos.x - j.posicion.x, o.pos.z - j.posicion.z);
      if (d < dMin && j.posicion.y < 3) {
        dMin = d;
        this.obraJugador = i;
      }
    });
    this.trabajoEscuadron(dt);
    this.cerco(dt);
    // la hoguera crepita
    const f = 1 + 0.18 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3);
    this.fuego.scale.set(1.3 * f, 1.8 * f, 1);
    this.fuego.visible = this.listo;
    if (this.listo && !this.listoAvisado) {
      this.listoAvisado = true;
      this.ctx.eventos.emit({ tipo: 'mensaje', texto: 'Campamento listo', segundos: 2 });
      this.liberarEscuadron();
    }
  }

  /** Cada soldado vivo y cerca va a una obra sin terminar y la levanta en unos segundos. */
  private trabajoEscuadron(dt: number): void {
    const esc = this.ctx.escuadron;
    const vivos = esc.soldados.filter((s) => s.vivo && !s.agarradoPor && s.posicion.distanceTo(this.centro) < 150);
    if (this.listo || vivos.length === 0) return;
    // reparto cada vez que alguien termina (o al empezar)
    const libres = vivos.filter((s) => {
      const i = this.asignadas.get(s);
      return i === undefined || this.obras[i].progreso >= 1 || i === this.obraJugador;
    });
    if (libres.length) {
      // las obras de quien sigue trabajando no se reparten otra vez
      const ocupadas = new Set<number>();
      for (const [h, i] of this.asignadas) if (h.vivo && !libres.includes(h)) ocupadas.add(i);
      const obras = this.obras.map((o, i) => ({ x: o.pos.x, z: o.pos.z, hecha: o.progreso >= 1 || ocupadas.has(i) }));
      const reparto = repartirObras(libres.map((s) => ({ x: s.posicion.x, z: s.posicion.z })), obras, this.obraJugador);
      libres.forEach((s, k) => {
        const i = reparto[k];
        if (i < 0) {
          this.asignadas.delete(s);
          esc.trabajarEn(s, null, this.centro);
          return;
        }
        if (this.asignadas.get(s) === i) return;
        this.asignadas.set(s, i);
        // a pie de obra, por fuera del poste o delante de la carpa
        const o = this.obras[i];
        const fuera = o.pos.clone().sub(this.centro).setY(0).normalize().multiplyScalar(o.tipo === 'poste' ? -1.2 : -1.8);
        esc.trabajarEn(s, o.pos.clone().add(fuera), this.centro);
      });
    }
    let cambio = false;
    for (const s of vivos) {
      const i = this.asignadas.get(s);
      if (i === undefined) continue;
      const o = this.obras[i];
      if (o.progreso >= 1 || Math.hypot(o.pos.x - s.posicion.x, o.pos.z - s.posicion.z) > 3.2 || s.posicion.y > 2.5) continue;
      o.progreso = Math.min(1, o.progreso + dt / OBRA_SOLDADO);
      cambio = true;
      const tg = (this.tGolpes.get(s) ?? 0) - dt;
      if (tg <= 0) {
        this.tGolpes.set(s, 0.7 + Math.random() * 0.3);
        this.ctx.efectos.vapor(o.pos.clone().setY(0.2), 2, 0.4, 1);
      } else this.tGolpes.set(s, tg);
    }
    if (cambio) this.dibujarObras();
  }

  /** Terminado: el escuadrón espera dentro del campamento (y lo defiende). */
  private liberarEscuadron(): void {
    for (const s of this.ctx.escuadron.soldados) this.ctx.escuadron.trabajarEn(s, null, this.centro);
    this.asignadas.clear();
  }

  /** Titanes en el alambre: se enredan, las latas suenan y el alambre se va rompiendo. */
  private cerco(dt: number): void {
    if (this.alambre <= 0) return;
    const hechos = this.postesHechos;
    this.tLatas -= dt;
    for (const t of this.ctx.poblacion.titanesCerca(this.centro, RADIO_CERCO + 6)) {
      if (!t.vivo) continue;
      if (!enAlambre(t.posicion.x, t.posicion.z, this.centro.x, this.centro.z, hechos, 2.2 + t.altura * 0.08)) continue;
      t.enredar?.(1.2, FRENO_ALAMBRE);
      this.alambre -= DESGASTE_ALAMBRE * dt;
      if (this.tLatas <= 0) {
        this.tLatas = 1.2;
        this.ctx.eventos.emit({ tipo: 'alambre', pos: t.posicion.clone().setY(1) });
      }
      if (this.alambre <= 0) {
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡Han roto el alambre!', segundos: 1.5 });
        this.dibujarObras();
        return;
      }
    }
  }

  /** Postes que salen del suelo según avanzan, carpas que se despliegan y el alambre entre postes clavados. */
  private dibujarObras(): void {
    for (const o of this.obras) {
      // sin empezar, el poste es una estaca de 30 cm que marca dónde va
      const k = Math.max(o.tipo === 'poste' ? 0.15 : 0.04, Math.min(1, o.progreso));
      if (o.tipo === 'poste') {
        o.malla.scale.set(1, k, 1);
        o.malla.position.y = 0;
      } else {
        o.malla.scale.set(1, k, 0.4 + 0.6 * k);
      }
      o.malla.visible = o.progreso > 0 || o.tipo === 'poste';
    }
    const hechos = this.postesHechos;
    const clave = hechos.map((h) => (h ? 1 : 0)).join('') + (this.alambre > 0 ? 'a' : 'r');
    if (clave === this.hechosPrevios) return;
    this.hechosPrevios = clave;
    const pos: number[] = [];
    const postes = this.obras.filter((o) => o.tipo === 'poste');
    let latas = 0;
    const m = new THREE.Matrix4();
    if (this.alambre > 0) {
      for (let i = 0; i < postes.length; i++) {
        const a = postes[i];
        const b = postes[(i + 1) % postes.length];
        if (!hechos[i] || !hechos[(i + 1) % postes.length]) continue;
        for (const y of [0.55, 1.1, 1.65]) pos.push(a.pos.x, y, a.pos.z, b.pos.x, y - 0.06, b.pos.z);
        // una lata en medio de cada tramo: suenan al tocar el alambre
        m.makeTranslation((a.pos.x + b.pos.x) / 2, 1.0, (a.pos.z + b.pos.z) / 2);
        this.latas.setMatrixAt(latas++, m);
      }
    }
    this.lineas.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.lineas.geometry.computeBoundingSphere();
    this.latas.count = latas;
    this.latas.instanceMatrix.needsUpdate = true;
  }

  guardar(): EstadoGuardadoCampamento {
    return {
      x: this.centro.x,
      z: this.centro.z,
      postes: this.obras.filter((o) => o.tipo === 'poste').map((o) => o.progreso),
      carpas: this.obras.filter((o) => o.tipo === 'carpa').map((o) => o.progreso),
      alambre: this.alambre,
    };
  }

  /** Desmonta el campamento (al armar otro o al salir). */
  eliminar(): void {
    this.ctx.escena.remove(this.grupo);
    this.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    if (!this.listo) for (const s of this.ctx.escuadron.soldados) this.ctx.escuadron.trabajarEn(s, null);
  }
}
