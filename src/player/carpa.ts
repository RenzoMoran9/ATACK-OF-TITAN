import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { umbralNuca, umbralZona } from '../combat/corte';
import type { ContextoJuego } from '../core/contexto';
import type { TitanAPI, ZonaTitan } from '../core/tipos';
import { Silueta } from '../missions/silueta';
import type { Soldado } from '../npc/soldado';

/**
 * El campamento fortificado (T): un fortín redondo de piedra y madera que se arma delante del
 * jugador a cualquier hora, en suelo llano y sin titanes cerca.
 *
 * - Muros y techo macizos (colisionadores reales): ni tú, ni los soldados, ni los titanes lo
 *   atraviesan. Solo se entra por la puerta, que se abre sola (la hoja se hunde en el suelo)
 *   cuando un aliado se acerca y se cierra cuando se alejan; los titanes no la abren y ni siquiera pisan el interior.
 * - Nadie dentro puede ser agarrado por un titán (las manos no llegan a través del muro).
 * - Pinchos de madera al pie del muro: el titán que viene a atacarlo se hiere las piernas.
 * - Seis cañones tras troneras que apuntan solos (rodillas del titán en pie; nuca si está caído),
 *   pero los disparas tú con X desde dentro. Cada uno tarda unos segundos en recargarse.
 * - Dentro se recupera vida, gas, hojas y aguante (también los compañeros).
 *
 * T junto a él lo recoge; lejos, lo arma en el sitio nuevo (solo hay uno).
 */

/** Radio interior, grosor y altura del muro (m). */
export const RADIO = 8;
const GROSOR = 1;
const ALTO = 7;
const ALTO_PUERTA = 5;
const SEGMENTOS = 24;
const ANCHO_PUERTA = 4.1;
/** Un aliado a esta distancia de la puerta (m) la abre. */
const ALCANCE_PUERTA = 7;
const RADIO_SEGURO = 40;
const CURACION = 9;
const RECARGA_CANON = 5;
const ALCANCE_CANON = 150;
/** Los cañones solo cubren este arco (rad) a cada lado de su tronera. */
const ARCO_CANON = (40 * Math.PI) / 180;
/** Ángulos (grados desde la puerta) de las troneras. */
const TRONERAS = [50, 100, 150, 210, 260, 310];
const PIERNAS: ZonaTitan[] = ['corvaIzq', 'corvaDer', 'tendonIzq', 'tendonDer'];

/** ¿Está (x, z) dentro del recinto? (`margen` > 0 lo estrecha). */
export function dentroDelRecinto(cx: number, cz: number, x: number, z: number, margen = 0.15): boolean {
  return Math.hypot(x - cx, z - cz) < RADIO - margen;
}

/**
 * Punto intermedio para cruzar la puerta del recinto: quien está fuera y va dentro (o al revés)
 * primero se alinea ante la puerta y luego la cruza. null si no hay que cruzar nada.
 * `rumbo` es hacia donde mira la puerta (rad, 0 = +Z); devuelve {x, z}.
 */
export function desvioPorPuerta(cx: number, cz: number, rumbo: number, desde: { x: number; z: number }, meta: { x: number; z: number }): { x: number; z: number } | null {
  const dDentro = dentroDelRecinto(cx, cz, desde.x, desde.z);
  if (dDentro === dentroDelRecinto(cx, cz, meta.x, meta.z)) return null;
  const fx = Math.sin(rumbo);
  const fz = Math.cos(rumbo);
  const lx = fz;
  const lz = -fx;
  const px = cx + fx * (RADIO + GROSOR / 2);
  const pz = cz + fz * (RADIO + GROSOR / 2);
  const along = (desde.x - px) * fx + (desde.z - pz) * fz;
  const lat = (desde.x - px) * lx + (desde.z - pz) * lz;
  const punto = (a: number) => ({ x: px + fx * a, z: pz + fz * a });
  const alineado = Math.abs(lat) < ANCHO_PUERTA / 2 - 0.5;
  if (!dDentro) return alineado && along < 6.5 ? punto(-5.5) : punto(5.5);
  return alineado && along > -6 ? punto(6) : punto(-5);
}

interface Canon {
  pivote: THREE.Group;
  boca: THREE.Object3D;
  tubo: THREE.Mesh;
  /** Hacia dónde mira la tronera (rad, 0 = +Z). */
  rumbo: number;
  recarga: number;
  /** Posición del cañón en el mundo (la boca). */
  pos: THREE.Vector3;
}

interface Bala {
  malla: THREE.Mesh;
  desde: THREE.Vector3;
  hasta: THREE.Vector3;
  t: number;
}

export class Carpa {
  private centro: THREE.Vector3 | null = null;
  private rumbo = 0;
  private grupo: THREE.Group | null = null;
  private colliders: RAPIER.Collider[] = [];
  private puerta: { malla: THREE.Mesh; collider: RAPIER.Collider | null; alza: number; base: THREE.Vector3 } | null = null;
  private canones: Canon[] = [];
  private readonly balas: Bala[] = [];
  private readonly heridas = new Map<number, number>();
  private tAviso = -99;
  private tReloj = 0;

  private readonly matPiedra = new THREE.MeshLambertMaterial({ color: '#8a8478' });
  private readonly matMadera = new THREE.MeshLambertMaterial({ color: '#5a3f27' });
  private readonly matHierro = new THREE.MeshLambertMaterial({ color: '#2f3135' });
  private readonly matTronera = new THREE.MeshBasicMaterial({ color: '#050505' });
  private readonly matSuelo = new THREE.MeshLambertMaterial({ color: '#6b5a40' });
  private readonly matLampara = new THREE.MeshBasicMaterial({ color: '#ffcf7a', fog: false });
  private readonly matBala = new THREE.MeshBasicMaterial({ color: '#222222' });
  private readonly geoBala = new THREE.SphereGeometry(0.28, 8, 6);

  constructor(private readonly ctx: ContextoJuego) {}

  get armada(): boolean {
    return this.centro !== null;
  }

  // ─────────────────────────── Consultas ───────────────────────────

  /** ¿Está este punto dentro del recinto (bajo el techo)? */
  dentro(p: THREE.Vector3): boolean {
    return !!this.centro && dentroDelRecinto(this.centro.x, this.centro.z, p.x, p.z) && p.y < this.centro.y + ALTO && p.y > this.centro.y - 1;
  }

  /** Los titanes no agarran a nadie dentro (las manos no llegan a través del muro). */
  protege(p: THREE.Vector3): boolean {
    return this.dentro(p);
  }

  /** Un titán de radio `r` no puede estar aquí: el fuerte es macizo para ellos. */
  bloquea(x: number, z: number, r: number): boolean {
    return !!this.centro && Math.hypot(x - this.centro.x, z - this.centro.z) < RADIO + GROSOR + r;
  }

  /** Alias de `dentro` para reponer a quien descansa. */
  cubre(p: THREE.Vector3): boolean {
    return this.dentro(p);
  }

  /** Puesto `i` de `n` dentro del recinto (a la altura del cuerpo de un soldado). */
  puesto(i: number, n: number): THREE.Vector3 {
    const c = this.centro ?? new THREE.Vector3();
    const a = (i / Math.max(1, n)) * Math.PI * 2 + this.rumbo;
    const r = n <= 1 ? 0 : 3.4;
    return new THREE.Vector3(c.x + Math.sin(a) * r, c.y + 0.85, c.z + Math.cos(a) * r);
  }

  /** Punto de paso para cruzar la puerta si `desde` y `meta` están a distinto lado del muro. */
  desvio(desde: THREE.Vector3, meta: THREE.Vector3): THREE.Vector3 | null {
    if (!this.centro) return null;
    const d = desvioPorPuerta(this.centro.x, this.centro.z, this.rumbo, desde, meta);
    return d ? new THREE.Vector3(d.x, desde.y, d.z) : null;
  }

  // ─────────────────────────── Acciones ───────────────────────────

  /** T: recoge el fuerte si estás cerca de él; si no, lo arma delante de ti. Devuelve el mensaje. */
  alternar(dir: THREE.Vector3): string {
    const j = this.ctx.jugador;
    if (!j.vivo) return '';
    if (this.centro && Math.hypot(j.posicion.x - this.centro.x, j.posicion.z - this.centro.z) < RADIO + 7) {
      this.quitar();
      return 'Recoges el campamento';
    }
    if (j.agarradoPor) return 'No puedes armar el campamento ahora';
    const delante = new THREE.Vector3(dir.x, 0, dir.z);
    if (delante.lengthSq() < 1e-4) delante.set(0, 0, -1);
    delante.normalize();
    const sitio = j.posicion.clone().addScaledVector(delante, RADIO + GROSOR + 4);
    const abajo = new THREE.Vector3(0, -1, 0);
    const enCentro = this.ctx.fisica.lanzarRayo(sitio.clone().setY(j.posicion.y + 1.5), abajo, 6);
    const malo = (h: { etiqueta: string; punto: THREE.Vector3 } | null, y: number) => !h || h.etiqueta === 'titan' || h.etiqueta === 'nuca' || h.etiqueta === 'jugador' || Math.abs(h.punto.y - y) > 0.7;
    // el centro tiene que ser suelo (no la copa de un árbol ni un tejado a distinto nivel que tus pies)
    if (!enCentro || malo(enCentro, enCentro.punto.y) || Math.abs(enCentro.punto.y - (j.posicion.y - 0.85)) > 1.5) return 'Aquí no se puede armar el campamento: busca un suelo firme y llano';
    const y = enCentro.punto.y;
    let llano = true;
    for (let k = 0; k < 12 && llano; k++) {
      const a = (k / 12) * Math.PI * 2;
      const h = this.ctx.fisica.lanzarRayo(new THREE.Vector3(sitio.x + Math.sin(a) * (RADIO + 1.2), y + 2, sitio.z + Math.cos(a) * (RADIO + 1.2)), abajo, 4);
      llano = !malo(h, y);
    }
    if (!llano || !this.ctx.nav.libre(sitio.x, sitio.z, RADIO + 1.5)) return 'No hay sitio despejado para el campamento: apártate de árboles y casas';
    if (this.ctx.poblacion.titanesCerca(j.posicion, RADIO_SEGURO).some((t) => t.vivo)) return '¡Hay un titán demasiado cerca para armar el campamento!';
    this.quitar();
    this.armar(new THREE.Vector3(sitio.x, y, sitio.z), Math.atan2(-delante.x, -delante.z));
    return 'Campamento armado: entra por la puerta, X dispara los cañones, T lo recoge';
  }

  /** X: dispara los cañones cargados que tengan un titán en su arco (solo desde dentro). */
  disparar(): string {
    if (!this.centro) return '';
    if (!this.dentro(this.ctx.jugador.posicion)) return 'Los cañones se disparan desde dentro del campamento';
    let disparos = 0;
    let hayObjetivo = false;
    const usados = new Set<TitanAPI>();
    for (const c of this.canones) {
      const t = this.objetivoDe(c, usados);
      if (!t) continue;
      hayObjetivo = true;
      if (c.recarga > 0) continue;
      usados.add(t);
      this.dispararCanon(c, t);
      disparos++;
    }
    if (disparos > 0) return `¡Fuego! (${disparos} ${disparos === 1 ? 'cañón' : 'cañones'})`;
    return hayObjetivo ? 'Los cañones se están recargando' : 'Ningún titán al alcance de los cañones';
  }

  // ─────────────────────────── Paso de juego ───────────────────────────

  actualizar(dt: number): void {
    const c = this.centro;
    if (!c) return;
    this.tReloj += dt;
    const j = this.ctx.jugador;
    if (j.vivo && this.dentro(j.posicion)) j.curar(CURACION * dt);
    for (const s of this.ctx.escuadron.soldados) {
      if (!s.vivo || !this.dentro(s.posicion)) continue;
      const sol = s as Soldado;
      sol.curar(CURACION * dt);
      sol.gas = Math.min(sol.gasMax, sol.gas + 30 * dt);
      if (sol.cuchillas.repuesto < 4 || sol.cuchillas.filo < 1) sol.cuchillas.rellenar();
    }
    this.actualizarPuerta(dt);
    this.herirAtacantes();
    for (const k of this.canones) k.recarga = Math.max(0, k.recarga - dt);
  }

  /** La puerta se abre sola con un aliado cerca y se cierra sin él. Los titanes no la abren. */
  private actualizarPuerta(dt: number): void {
    const p = this.puerta;
    if (!p) return;
    const fisica = this.ctx.fisica;
    const aliado = (pos: THREE.Vector3) => Math.hypot(pos.x - p.base.x, pos.z - p.base.z) < ALCANCE_PUERTA && Math.abs(pos.y - p.base.y) < 6;
    const j = this.ctx.jugador;
    const abrir = (j.vivo && aliado(j.posicion)) || this.ctx.escuadron.soldados.some((s) => s.vivo && !s.agarradoPor && aliado(s.posicion));
    const antes = p.alza;
    p.alza = THREE.MathUtils.clamp(p.alza + (abrir ? 1 : -1) * dt * 1.8, 0, 1);
    // la hoja se hunde en el suelo al abrir
    p.malla.position.y = p.base.y + ALTO_PUERTA / 2 - p.alza * (ALTO_PUERTA - 0.1);
    // el colisionador se retira cuando la hoja ya ha bajado lo bastante; vuelve al estar cerrada
    if (p.alza > 0.5 && p.collider) {
      fisica.eliminarCollider(p.collider);
      p.collider = null;
    } else if (p.alza <= 0 && !p.collider) {
      p.collider = this.colocarPuerta();
    }
    if ((antes === 0) !== (p.alza === 0) || (antes === 1) !== (p.alza === 1)) this.ctx.eventos.emit({ tipo: 'puertaFuerte', pos: p.base.clone() });
  }

  /** Los pinchos del muro hieren las piernas del titán que viene a atacarlo. */
  private herirAtacantes(): void {
    const c = this.centro!;
    const t = this.tReloj;
    for (const titan of this.ctx.poblacion.titanesCerca(c, RADIO + GROSOR + 30)) {
      if (!titan.vivo || titan instanceof Silueta || titan.estado === 'derribado' || titan.estado === 'cegado') continue;
      const d = Math.hypot(titan.posicion.x - c.x, titan.posicion.z - c.z);
      if (d > RADIO + GROSOR + 0.18 * titan.altura + 3.2) continue;
      if (t - (this.heridas.get(titan.id) ?? -9) < 1.6) continue;
      const zona = PIERNAS.filter((z) => titan.puntosDebiles.some((p) => p.zona === z && p.activo));
      if (zona.length === 0) continue;
      this.heridas.set(titan.id, t);
      const z = zona[Math.floor(Math.random() * zona.length)];
      titan.recibirCorte(z, umbralZona(z, titan.altura) * 1.15, null);
      const p = titan.puntosDebiles.find((x) => x.zona === z);
      if (p) this.ctx.efectos.sangre(p.centro.clone(), new THREE.Vector3(0, 1, 0), 10);
      if (t - this.tAviso > 4) {
        this.tAviso = t;
        this.ctx.eventos.emit({ tipo: 'mensaje', texto: '¡El titán se hiere con los pinchos del muro!', segundos: 2.5 });
      }
    }
  }

  dibujar(dt: number): void {
    if (!this.centro) return;
    // orientación de los cañones hacia su objetivo (o reposo)
    const usados = new Set<TitanAPI>();
    for (const c of this.canones) {
      const t = this.objetivoDe(c, usados);
      if (t) usados.add(t);
      const destino = t ? this.puntoDeApuntado(t) : c.pos.clone().add(new THREE.Vector3(Math.sin(c.rumbo), 0, Math.cos(c.rumbo)).multiplyScalar(10));
      c.pivote.lookAt(destino);
      // en recarga el tubo se ve al rojo; listo, negro
      (c.tubo.material as THREE.MeshLambertMaterial).color.setRGB(0.18 + 0.5 * Math.min(1, c.recarga / RECARGA_CANON), 0.18, 0.19);
    }
    for (let i = this.balas.length - 1; i >= 0; i--) {
      const b = this.balas[i];
      b.t += dt / 0.22;
      b.malla.position.lerpVectors(b.desde, b.hasta, Math.min(1, b.t));
      if (b.t >= 1) {
        b.malla.removeFromParent();
        this.balas.splice(i, 1);
      }
    }
    this.matLampara.color.setRGB(1, 0.72 + 0.08 * Math.sin(this.tReloj * 6), 0.4).multiplyScalar(this.ctx.esDeNoche() ? 1.3 : 0.8);
  }

  limpiar(): void {
    this.quitar();
  }

  liberar(): void {
    this.quitar();
    for (const m of [this.matPiedra, this.matMadera, this.matHierro, this.matTronera, this.matSuelo, this.matLampara, this.matBala]) m.dispose();
    this.geoBala.dispose();
  }

  // ─────────────────────────── Cañones ───────────────────────────

  /** Titán más cercano dentro del arco y el alcance de este cañón (sin repetir los ya elegidos). */
  private objetivoDe(c: Canon, evitar: Set<TitanAPI>): TitanAPI | null {
    let mejor: TitanAPI | null = null;
    let dMejor = ALCANCE_CANON;
    for (const t of this.ctx.poblacion.titanesCerca(c.pos, ALCANCE_CANON)) {
      if (!t.vivo || t instanceof Silueta || evitar.has(t)) continue;
      const dx = t.posicion.x - c.pos.x;
      const dz = t.posicion.z - c.pos.z;
      let da = Math.atan2(dx, dz) - c.rumbo;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > ARCO_CANON) continue;
      const d = Math.hypot(dx, dz);
      if (d < dMejor) {
        dMejor = d;
        mejor = t;
      }
    }
    return mejor;
  }

  private tumbado(t: TitanAPI): boolean {
    return t.estado === 'derribado' || t.estado === 'cegado';
  }

  /** Apuntan a la nuca del titán caído y a las rodillas del que está en pie. */
  private zonaDeTiro(t: TitanAPI): ZonaTitan {
    if (this.tumbado(t) && t.puntosDebiles.some((p) => p.zona === 'nuca' && p.activo)) return 'nuca';
    return PIERNAS.find((z) => t.puntosDebiles.some((p) => p.zona === z && p.activo)) ?? 'cuerpo';
  }

  private puntoDeApuntado(t: TitanAPI): THREE.Vector3 {
    const z = this.zonaDeTiro(t);
    return t.puntosDebiles.find((p) => p.zona === z)?.centro.clone() ?? t.posicion.clone().setY(t.posicion.y + t.altura * 0.4);
  }

  private dispararCanon(c: Canon, t: TitanAPI): void {
    c.recarga = RECARGA_CANON;
    const zona = this.zonaDeTiro(t);
    const blanco = this.puntoDeApuntado(t);
    c.pivote.lookAt(blanco);
    const boca = c.boca.getWorldPosition(new THREE.Vector3());
    const bala = new THREE.Mesh(this.geoBala, this.matBala);
    bala.position.copy(boca);
    this.ctx.escena.add(bala);
    this.balas.push({ malla: bala, desde: boca, hasta: blanco.clone(), t: 0 });
    this.ctx.efectos.vapor(boca, 14, 1.2, 4);
    this.ctx.eventos.emit({ tipo: 'canon', pos: boca });
    // la bala llega al instante en términos de juego: rodillas en pie, nuca en el suelo
    const danio = zona === 'nuca' ? umbralNuca(t.altura) * 0.55 : zona === 'cuerpo' ? 1 : umbralZona(zona, t.altura) * 1.3;
    const res = t.recibirCorte(zona, danio, this.ctx.jugador);
    this.ctx.efectos.vapor(blanco, 8, 0.8 + t.altura * 0.05, 3);
    if (res.efecto !== 'nada' && res.efecto !== 'superficial') this.ctx.efectos.sangre(blanco.clone(), blanco.clone().sub(boca).normalize(), 12);
  }

  // ─────────────────────────── Construcción ───────────────────────────

  private armar(centro: THREE.Vector3, rumbo: number): void {
    const ctx = this.ctx;
    const g = new THREE.Group();
    this.centro = centro;
    this.rumbo = rumbo;
    this.grupo = g;
    ctx.escena.add(g);
    const fisica = ctx.fisica;
    const paso = (Math.PI * 2) / SEGMENTOS;
    const cuerda = 2 * RADIO * Math.tan(paso / 2);
    const rc = RADIO + GROSOR / 2;
    const alVuelo = (a: number, r: number) => new THREE.Vector3(centro.x + Math.sin(a) * r, centro.y, centro.z + Math.cos(a) * r);

    // Muro en 24 tramos; los dos de la puerta se dejan libres
    for (let k = 0; k < SEGMENTOS; k++) {
      if (k === 0 || k === SEGMENTOS - 1) continue; // los dos tramos de la puerta (±7,5°)
      const a = rumbo + paso * (k + 0.5);
      const p = alVuelo(a, rc);
      const caja = new THREE.Mesh(new THREE.BoxGeometry(cuerda + 0.14, ALTO, GROSOR), this.matPiedra);
      caja.position.set(p.x, centro.y + ALTO / 2, p.z);
      caja.rotation.y = a;
      caja.castShadow = true;
      g.add(caja);
      this.colliders.push(fisica.caja({ x: p.x, y: centro.y + ALTO / 2, z: p.z }, { x: cuerda / 2 + 0.07, y: ALTO / 2, z: GROSOR / 2 }, 'edificio', a));
      // pincho de madera al pie, inclinado hacia fuera
      const pie = new THREE.Group();
      const pp = alVuelo(a, RADIO + GROSOR + 0.7);
      pie.position.set(pp.x, centro.y, pp.z);
      pie.rotation.y = a;
      const estaca = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.7, 5), this.matMadera);
      estaca.position.y = 0.75;
      estaca.rotation.x = Math.PI / 3;
      pie.add(estaca);
      g.add(pie);
    }
    // Dintel sobre la puerta (cierra el hueco por encima de la hoja)
    const pd = alVuelo(rumbo, rc);
    const dintel = new THREE.Mesh(new THREE.BoxGeometry(ANCHO_PUERTA + 0.4, ALTO - ALTO_PUERTA, GROSOR), this.matPiedra);
    dintel.position.set(pd.x, centro.y + (ALTO + ALTO_PUERTA) / 2, pd.z);
    dintel.rotation.y = rumbo;
    g.add(dintel);
    this.colliders.push(fisica.caja({ x: pd.x, y: centro.y + (ALTO + ALTO_PUERTA) / 2, z: pd.z }, { x: ANCHO_PUERTA / 2 + 0.2, y: (ALTO - ALTO_PUERTA) / 2, z: GROSOR / 2 }, 'edificio', rumbo));
    // Techo macizo (se puede aterrizar encima)
    const techo = new THREE.Mesh(new THREE.CylinderGeometry(RADIO + GROSOR + 0.15, RADIO + GROSOR + 0.15, 0.5, 28), this.matMadera);
    techo.position.set(centro.x, centro.y + ALTO + 0.25, centro.z);
    techo.castShadow = true;
    g.add(techo);
    this.colliders.push(fisica.cilindro({ x: centro.x, y: centro.y + ALTO + 0.25, z: centro.z }, 0.25, RADIO + GROSOR + 0.15, 'tejado'));
    // Suelo del recinto y lámpara central
    const suelo = new THREE.Mesh(new THREE.CylinderGeometry(RADIO - 0.1, RADIO - 0.1, 0.06, 28), this.matSuelo);
    suelo.position.set(centro.x, centro.y + 0.03, centro.z);
    g.add(suelo);
    const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), this.matMadera);
    poste.position.set(centro.x, centro.y + 1.2, centro.z);
    g.add(poste);
    const lampara = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.matLampara);
    lampara.position.set(centro.x, centro.y + 2.5, centro.z);
    g.add(lampara);

    // Puerta de madera y hierro
    const base = alVuelo(rumbo, rc);
    const hoja = new THREE.Mesh(new THREE.BoxGeometry(ANCHO_PUERTA, ALTO_PUERTA, 0.4), this.matMadera);
    hoja.rotation.y = rumbo;
    hoja.position.set(base.x, base.y + ALTO_PUERTA / 2, base.z);
    for (const y of [-1.7, 0, 1.7]) {
      const fleje = new THREE.Mesh(new THREE.BoxGeometry(ANCHO_PUERTA + 0.05, 0.22, 0.46), this.matHierro);
      fleje.position.y = y;
      hoja.add(fleje);
    }
    g.add(hoja);
    this.puerta = { malla: hoja, collider: null, alza: 0, base };
    this.puerta.collider = this.colocarPuerta();

    // Cañones tras las troneras
    this.canones = [];
    for (const grados of TRONERAS) {
      const a = rumbo + (grados * Math.PI) / 180;
      const tr = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.12), this.matTronera);
      const pt = alVuelo(a, RADIO + GROSOR + 0.02);
      tr.position.set(pt.x, centro.y + 2.3, pt.z);
      tr.rotation.y = a;
      g.add(tr);
      const pivote = new THREE.Group();
      const pc = alVuelo(a, RADIO - 1.25);
      pivote.position.set(pc.x, centro.y + 2.3, pc.z);
      const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.5, 10), new THREE.MeshLambertMaterial({ color: '#2d2e31' }));
      tubo.rotation.x = Math.PI / 2;
      tubo.position.z = 1.25;
      pivote.add(tubo);
      const boca = new THREE.Object3D();
      boca.position.z = 2.5;
      pivote.add(boca);
      const af = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.4), this.matMadera);
      af.position.set(0, -1.15, 0.1);
      pivote.add(af);
      pivote.rotation.y = a;
      g.add(pivote);
      this.canones.push({ pivote, boca, tubo, rumbo: a, recarga: 0, pos: pivote.position.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(2.2)) });
    }

    // La rejilla de navegación: el muro cuenta como obstáculo (la puerta, cuando está cerrada)
    ctx.nav.bloquearAnilloEn(centro.x, centro.z, RADIO - 0.5, RADIO + GROSOR + 0.5, 1);
    this.heridas.clear();
  }

  private colocarPuerta(): RAPIER.Collider {
    const p = this.puerta!;
    return this.ctx.fisica.caja({ x: p.base.x, y: p.base.y + ALTO_PUERTA / 2, z: p.base.z }, { x: ANCHO_PUERTA / 2, y: ALTO_PUERTA / 2, z: 0.3 }, 'puerta', this.rumbo);
  }

  private quitar(): void {
    const c = this.centro;
    if (this.puerta?.collider) this.ctx.fisica.eliminarCollider(this.puerta.collider);
    for (const col of this.colliders) this.ctx.fisica.eliminarCollider(col);
    this.colliders = [];
    this.puerta = null;
    if (c) this.ctx.nav.bloquearAnilloEn(c.x, c.z, RADIO - 0.5, RADIO + GROSOR + 0.5, 0);
    for (const b of this.balas) b.malla.removeFromParent();
    this.balas.length = 0;
    if (this.grupo) {
      this.grupo.removeFromParent();
      this.grupo.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry !== this.geoBala) o.geometry.dispose();
      });
    }
    for (const k of this.canones) (k.tubo.material as THREE.Material).dispose();
    this.canones = [];
    this.grupo = null;
    this.centro = null;
  }
}
