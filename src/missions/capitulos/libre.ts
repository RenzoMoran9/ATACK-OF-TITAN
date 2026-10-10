import * as THREE from 'three';
import type { ApiCapitulo, Capitulo } from '../campana';
import { Silueta } from '../silueta';

/**
 * Modo libre: el distrito en un día cualquiera. Vecinos en las calles, tu escuadrón
 * contigo y titanes rondando fuera de la muralla y por el bosque. Sin objetivos.
 */
export class CapLibre implements Capitulo {
  readonly id = 'libre' as const;
  readonly titulo = 'Modo libre';
  readonly epoca = 'Año 850 · Entre misiones';
  readonly intro =
    'Un día de calma tensa. Los vecinos hacen su vida dentro de la muralla y tu escuadrón espera órdenes. ' +
    'Fuera, en la llanura y entre los árboles gigantes, los titanes vagan buscando gente. Sal a cazarlos cuando quieras.';

  private api!: ApiCapitulo;
  private siluetas: Silueta[] = [];
  private reloj = 0;

  iniciar(api: ApiCapitulo): void {
    this.api = api;
    const ctx = api.ctx;
    const inicio = ctx.mundo.inicio.clone();
    ctx.jugador.revivir(inicio, Math.PI);
    api.puntoControl(inicio);
    ctx.escuadron.crear(
      [
        { nombre: 'Mikasa', rol: 'rematador', aspecto: { pelo: '#121214', peloLargo: false, escala: 0.98 } },
        { nombre: 'Armin', rol: 'cebo', aspecto: { pelo: '#e3c873', escala: 0.95 } },
        { nombre: 'Jean', rol: 'apoyo', aspecto: { pelo: '#9a7a52', escala: 1.04 } },
        { nombre: 'Connie', rol: 'apoyo', aspecto: { pelo: '#3a3a3a', escala: 0.92 } },
      ],
      inicio.clone().add(new THREE.Vector3(4, 0, 4)),
    );
    ctx.civiles.generar(40, new THREE.Vector3(0, 0, 0), 150);
    for (const o of ctx.mundo.titanesReferencia) ctx.titanes.generar(o);
    ctx.titanes.generarGrupo(5, new THREE.Vector3(0, 0, 360), 90, [3, 4, 7, 10, 15], 0.15);
    this.siluetas = [new Silueta(ctx, new THREE.Vector3(-60, 0, 300), 7, Math.PI), new Silueta(ctx, new THREE.Vector3(60, 0, 300), 10, Math.PI)];
    api.objetivo('Modo libre', 'Caza titanes fuera de la muralla. 1-4: órdenes al escuadrón');
  }

  actualizar(dt: number): void {
    for (const s of this.siluetas) s.actualizar(dt);
    // Mantener la llanura poblada: si quedan pocos, llegan más desde el sur
    this.reloj += dt;
    if (this.reloj > 20) {
      this.reloj = 0;
      const ctx = this.api.ctx;
      if (ctx.poblacion.titanesVivos - this.siluetas.filter((s) => s.vivo).length < 5) {
        ctx.titanes.generarGrupo(3, new THREE.Vector3((Math.random() - 0.5) * 300, 0, 700), 60, [3, 4, 7, 10, 15], 0.15);
      }
    }
  }

  terminar(): void {
    for (const s of this.siluetas) s.eliminar();
    this.siluetas = [];
  }
}
