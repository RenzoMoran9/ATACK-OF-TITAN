import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { AspectoSoldado, EscuadronAPI, Humano, MiembroEscuadron, OrdenEscuadron, TitanAPI, ZonaTitan } from '../core/tipos';
import { Soldado } from './soldado';

/**
 * Coordinador del escuadrón: cada 0,4 s reparte misiones. Primero los rescates (alguien
 * en la mano de un titán: cortar la mano o la mandíbula), luego el titán objetivo según
 * la orden — el cebo lo distrae delante de la cara, el apoyo le corta tendones y corvas
 * para derribarlo y el rematador va a la nuca cuando el titán no le mira — y el resto
 * sigue al jugador en formación o protege a los civiles.
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

export class Escuadron implements EscuadronAPI {
  readonly soldados: Soldado[] = [];
  orden: OrdenEscuadron = 'seguir';
  private tCoordinar = 0;
  private readonly rumboFormacion = new THREE.Vector3(0, 0, 1);

  constructor(private readonly ctx: ContextoJuego) {}

  crear(miembros: MiembroEscuadron[], cerca: THREE.Vector3): void {
    const ctx = this.ctx;
    const n = miembros.length;
    miembros.forEach((m, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 2.5 + (i % 2) * 1.5;
      const x = cerca.x + Math.cos(a) * r;
      const z = cerca.z + Math.sin(a) * r;
      // suelo bajo el punto (calle, tejado o lo alto de la muralla)
      const hit = ctx.fisica.lanzarRayo(new THREE.Vector3(x, cerca.y + 3, z), new THREE.Vector3(0, -1, 0), 10);
      const pies = new THREE.Vector3(x, hit ? hit.punto.y : cerca.y, z);
      const base = ASPECTOS[m.nombre] ?? {};
      const s = new Soldado(ctx, m.nombre, m.rol, { ...base, ...m.aspecto }, pies, base.habilidad ?? 1);
      s.hueco = this.soldados.length;
      this.soldados.push(s);
      ctx.poblacion.agregarHumano(s);
    });
    this.tCoordinar = 0;
  }

  ordenar(o: OrdenEscuadron): void {
    this.orden = o;
    this.tCoordinar = 0;
  }

  limpiar(): void {
    for (const s of this.soldados) {
      s.eliminar();
      this.ctx.poblacion.quitarHumano(s);
    }
    this.soldados.length = 0;
  }

  /** El compañero más cercano con gas de sobra viene a pasártelo. */
  pedirGas(): Humano | null {
    const d = this.donanteGas();
    if (!d) return null;
    d.mision = { tipo: 'darGas', humano: this.ctx.jugador };
    d.decir('¡Aguanta, voy a pasarte gas!');
    return d;
  }

  /** Quién podría darte gas ahora mismo (para el HUD). */
  donanteGas(): Soldado | null {
    const j = this.ctx.jugador;
    let mejor: Soldado | null = null;
    let dMejor = 180;
    for (const s of this.soldados) {
      if (!s.vivo || s.agarradoPor || s.gas < 35) continue;
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
    this.tCoordinar -= dt;
    if (this.tCoordinar <= 0) {
      this.tCoordinar = 0.4;
      this.coordinar();
    }
    const j = this.ctx.jugador;
    for (const s of this.soldados) {
      s.paso(dt);
      // entrega de gas al llegar junto al jugador
      if (s.vivo && s.mision.tipo === 'darGas' && s.posicion.distanceTo(j.posicion) < 5.5) {
        const falta = j.gas.capacidad - j.gas.nivel;
        const dado = s.darGas(Math.min(falta, 50));
        j.gas.nivel = Math.min(j.gas.capacidad, j.gas.nivel + dado);
        s.ultimaFrase = -99;
        s.decir(dado > 0 ? `Toma, llévate mi gas (+${Math.round(dado)})` : 'Ya no me queda gas…');
        s.mision = { tipo: 'seguir' };
      }
    }
  }

  dibujar(dt: number, t: number): void {
    const cam = this.ctx.camara.position;
    for (const s of this.soldados) s.dibujar(1, dt * this.ctx.reloj.escala, t, cam);
  }

  // ─────────────────────────── Coordinación ───────────────────────────

  private coordinar(): void {
    const ctx = this.ctx;
    const j = ctx.jugador;
    const libres = this.soldados.filter((s) => s.vivo && !s.agarradoPor);
    if (libres.length === 0) return;
    const asignados = new Set<Soldado>();

    // Quien lleva gas al jugador termina su entrega
    for (const s of libres) if (s.mision.tipo === 'darGas') asignados.add(s);

    // 1. Rescates: alguien en la mano de un titán
    if (this.orden !== 'retirada') {
      for (const h of ctx.poblacion.humanos) {
        const titan = h.agarradoPor;
        if (!h.vivo || !titan || !titan.vivo) continue;
        if (h.posicion.distanceTo(j.posicion) > 200) continue;
        const zona = titan.puntosDebiles.find((p) => p.activo && MANOS.includes(p.zona))?.zona;
        if (!zona) continue;
        const s = this.masCercano(libres, asignados, h.posicion, (x) => x.cuchillas.puedeCortar);
        if (!s || s.posicion.distanceTo(h.posicion) > 180) continue;
        if (!(s.mision.tipo === 'rescatar' && s.mision.titan === titan && s.mision.zona === zona)) s.mision = { tipo: 'rescatar', titan, zona, humano: h };
        if (h === j) s.decir('¡Aguanta, voy a por ti!');
        asignados.add(s);
      }
    }

    // 2. Titán objetivo según la orden
    const objetivo = this.elegirTitan();
    const equipo = libres.filter((s) => !asignados.has(s));
    if (objetivo && equipo.length) {
      const H = objetivo.altura;
      const tumbado = objetivo.estado === 'derribado' || objetivo.estado === 'cegado';
      const tendon = TENDONES.find((z) => objetivo.puntosDebiles.some((p) => p.zona === z && p.activo));
      let cebo = false;
      // primero el cebo, luego el apoyo y por último los rematadores
      const orden = { cebo: 0, apoyo: 1, rematador: 2 } as const;
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
        asignados.add(s);
      }
    }

    // 3. El resto: formación junto al jugador o con los civiles
    const v = j.velocidad;
    if (Math.hypot(v.x, v.z) > 2) this.rumboFormacion.set(v.x, 0, v.z).normalize();
    const centroCiviles = this.orden === 'proteger' ? this.centroCiviles() : null;
    for (const s of libres) {
      if (asignados.has(s)) continue;
      const base = centroCiviles ?? j.posicion;
      const [lx, lz] = HUECOS[s.hueco % HUECOS.length];
      const f = this.rumboFormacion;
      const lado = new THREE.Vector3(f.z, 0, -f.x);
      const destino = base.clone().addScaledVector(lado, lx).addScaledVector(f, -lz);
      if (this.orden === 'retirada') destino.addScaledVector(f, -6);
      // si el jugador está en el aire, la formación va algo más alta
      if (!centroCiviles && j.posicion.y > 3) destino.y = j.posicion.y + 1;
      s.mision = { tipo: this.orden === 'proteger' ? 'proteger' : this.orden === 'retirada' ? 'retirada' : 'seguir', destino };
      // se quedó muy atrás: aparece detrás del jugador (fuera de cámara casi siempre)
      if (s.posicion.distanceTo(j.posicion) > 170) s.teletransportar(destino.clone().addScaledVector(f, -25).setY(Math.max(destino.y, 1) + 6), j.velocidad.clone().multiplyScalar(0.8));
    }
  }

  private elegirTitan(): TitanAPI | null {
    const ctx = this.ctx;
    const j = ctx.jugador;
    const vivos = ctx.poblacion.titanes.filter((t) => t.vivo);
    if (vivos.length === 0 || this.orden === 'retirada') return null;
    const cerca = (p: THREE.Vector3, r: number) => vivos.filter((t) => t.posicion.distanceTo(p) < r);
    const masProximo = (lista: TitanAPI[], p: THREE.Vector3) => lista.sort((a, b) => a.posicion.distanceTo(p) - b.posicion.distanceTo(p))[0] ?? null;
    switch (this.orden) {
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
