import * as THREE from 'three';
import { Poblador } from '../../titans/poblador';
import type { Lugar } from '../../world/lugares';
import type { ApiCapitulo, Capitulo } from '../campana';

/**
 * Exploración del territorio perdido: mundo abierto al sur de Trost. Empiezas fuera de la
 * puerta sur con tu escuadrón; el poblador mantiene titanes alrededor (muchos más, y más
 * rápidos, dentro de los bosques) y hay lugares por descubrir: bosques, aldeas abandonadas,
 * el Castillo de Utgard, el puente, los puestos de avanzada y el campamento de la Legión.
 * Sin derrota: si te devoran, vuelves al último lugar seguro.
 */
export class CapLibre implements Capitulo {
  readonly id = 'libre' as const;
  readonly titulo = 'Exploración: territorio perdido';
  readonly epoca = 'Año 850 · Más allá de la muralla';
  readonly intro =
    'Al sur de Trost se extiende lo que la humanidad perdió: llanuras, aldeas vacías, las ruinas del Castillo de Utgard ' +
    'y bosques donde los titanes acechan entre los troncos — algunos corren a cuatro patas. Explora con tu escuadrón: ' +
    'M abre el mapa, 5 los deja esperando si quieres ir solo, 6 los manda a un punto, 8 los pone a explorar. ' +
    'Los puestos de avanzada recargan gas y cuchillas.';

  private api!: ApiCapitulo;
  private poblador: Poblador | null = null;
  private tRevisar = 0;
  private enBosque: string | null = null;
  private refuerzos = 0;

  iniciar(api: ApiCapitulo): void {
    this.api = api;
    const ctx = api.ctx;
    const m = ctx.mundo.muralla;
    for (const l of ctx.mundo.lugares) l.descubierto = false;
    // Fuera de la puerta sur, mirando al territorio
    const inicio = new THREE.Vector3(6, 0, m.radioExterior + 30);
    ctx.jugador.revivir(inicio, 0);
    api.puntoControl(inicio);
    ctx.escuadron.crear(
      [
        { nombre: 'Mikasa', rol: 'rematador' },
        { nombre: 'Armin', rol: 'cebo' },
        { nombre: 'Jean', rol: 'apoyo' },
        { nombre: 'Connie', rol: 'apoyo' },
      ],
      inicio.clone().add(new THREE.Vector3(-5, 0, -4)),
    );
    // La vida sigue dentro de la muralla
    ctx.civiles.generar(30, new THREE.Vector3(0, 0, 0), 150);
    this.poblador = new Poblador(ctx);
    this.enBosque = null;
    this.tRevisar = 0;
    this.refuerzos = 0;
    this.actualizarObjetivo();
  }

  actualizar(dt: number): void {
    this.poblador?.actualizar(dt);
    this.tRevisar -= dt;
    if (this.tRevisar > 0) return;
    this.tRevisar = 0.5;
    const ctx = this.api.ctx;
    const p = ctx.jugador.posicion;
    // Descubrir lugares al acercarse
    for (const l of ctx.mundo.lugares) {
      if (l.descubierto || !this.cerca(l, p)) continue;
      l.descubierto = true;
      this.api.mensaje(`Descubierto: ${l.nombre}`, 3.5);
      // los lugares descubiertos fuera de los bosques sirven para reaparecer
      if (l.tipo !== 'bosque') this.api.puntoControl(this.lugarSeguro(p));
      if (l.tipo === 'puesto') this.api.mensaje('Aquí puedes recargar gas y cuchillas', 3);
      this.actualizarObjetivo();
    }
    // Aviso al entrar en un bosque: es lo más peligroso del territorio
    const bosque = ctx.mundo.bosques.find((b) => b.contiene(p.x, p.z));
    const nombre = bosque?.nombre ?? null;
    if (nombre && nombre !== this.enBosque) {
      this.api.mensaje(`${nombre}: aquí acechan anormales y titanes que corren a cuatro patas`, 4);
      // reaparecer en un sitio seguro si te devoran ahí dentro
      this.api.puntoControl(this.lugarSeguro(p));
    }
    this.enBosque = nombre;
    this.reforzar(p);
  }

  /**
   * Si cae todo el escuadrón, en el siguiente puesto de avanzada, el campamento o la puerta
   * sur te espera otro de la Legión (así nunca te quedas sin nadie a quien dar órdenes).
   */
  private reforzar(p: THREE.Vector3): void {
    const esc = this.api.ctx.escuadron;
    if (!this.api.ctx.jugador.vivo || esc.soldados.some((s) => s.vivo)) return;
    const m = this.api.ctx.mundo.muralla;
    const enPuerta = Math.hypot(p.x - 6, p.z - (m.radioExterior + 30)) < 70;
    const enRefugio = this.api.ctx.mundo.lugares.some((l) => (l.tipo === 'puesto' || l.tipo === 'campamento') && Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < l.radio + 40);
    if (!enPuerta && !enRefugio) return;
    const tandas = [
      [
        { nombre: 'Sasha', rol: 'apoyo' as const },
        { nombre: 'Reiner', rol: 'rematador' as const },
        { nombre: 'Bertholdt', rol: 'apoyo' as const },
        { nombre: 'Ymir', rol: 'cebo' as const },
      ],
      [
        { nombre: 'Mikasa', rol: 'rematador' as const },
        { nombre: 'Armin', rol: 'cebo' as const },
        { nombre: 'Jean', rol: 'apoyo' as const },
        { nombre: 'Connie', rol: 'apoyo' as const },
      ],
    ];
    const tanda = tandas[this.refuerzos % tandas.length];
    this.refuerzos++;
    esc.limpiar();
    esc.crear(tanda, p.clone().add(new THREE.Vector3(-5, 0, -4)).setY(0));
    this.api.mensaje(`Refuerzos de la Legión: ${tanda.map((s) => s.nombre).join(', ')} se unen a ti`, 4);
  }

  terminar(): void {
    this.poblador?.limpiar();
    this.poblador = null;
  }

  private cerca(l: Lugar, p: THREE.Vector3): boolean {
    if (l.tipo === 'bosque') {
      const i = Number(l.id.replace('bosque', ''));
      const b = this.api.ctx.mundo.bosques[i];
      if (b) return b.contiene(p.x, p.z);
    }
    return Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < l.radio + 60;
  }

  /** El lugar descubierto más cercano fuera de los bosques (o la puerta sur). */
  private lugarSeguro(p: THREE.Vector3): THREE.Vector3 {
    const ctx = this.api.ctx;
    let mejor = new THREE.Vector3(6, 0, ctx.mundo.muralla.radioExterior + 30);
    let d = mejor.distanceTo(p);
    for (const l of ctx.mundo.lugares) {
      if (!l.descubierto || l.tipo === 'bosque') continue;
      const x = Math.hypot(l.pos.x - p.x, l.pos.z - p.z);
      if (x < d) {
        d = x;
        mejor = ctx.nav.puntoLibreCercano(l.pos.x, l.pos.z, 1.5) ?? l.pos.clone().setY(0);
      }
    }
    return mejor;
  }

  private actualizarObjetivo(): void {
    const lugares = this.api.ctx.mundo.lugares;
    const hechos = lugares.filter((l) => l.descubierto).length;
    const titulo = hechos === lugares.length ? 'Territorio explorado por completo' : 'Explora el territorio perdido';
    this.api.objetivo(titulo, `Descubiertos ${hechos}/${lugares.length} · M: mapa`);
    if (hechos === lugares.length && hechos > 0) this.api.mensaje('¡Has recorrido todo el territorio! Sigue cazando titanes si quieres.', 4);
  }
}
