import * as THREE from 'three';
import { puntoAnillo } from '../../world/muralla';
import type { ApiCapitulo, Capitulo } from '../campana';
import { Colosal } from '../colosal';

/**
 * Capítulo 2 · Defensa de Trost (año 850). Une las fases I y II de la batalla:
 *  1. Mantenimiento de cañones en la muralla sur → aparece el Colosal y revienta la puerta.
 *  2. Retaguardia: los titanes entran a oleadas; hay que cubrir la evacuación hacia la puerta norte.
 *  3. Campana de retirada con los cilindros casi vacíos: el depósito de la plaza está rodeado.
 *  4. Recuperar el depósito, recargar y escalar la muralla norte.
 */

type Fase = 'muralla' | 'brecha' | 'evacuacion' | 'deposito' | 'escapar';

const MEZCLA = [3, 4, 4, 7, 7, 7, 10, 10, 15];

export class CapTrost implements Capitulo {
  readonly id = 'trost' as const;
  readonly titulo = 'Capítulo 2: Defensa de Trost';
  readonly epoca = 'Año 850 · Batalla de Trost';
  readonly intro =
    'Cinco años de paz frágil. Tu escuadrón hace el mantenimiento de los cañones en lo alto de la muralla sur ' +
    'cuando el aire se llena de vapor. La orden llegará enseguida: nadie retrocede hasta que el último civil cruce la puerta norte.';

  private api!: ApiCapitulo;
  private fase: Fase = 'muralla';
  private t = 0;
  private colosal: Colosal | null = null;
  private generados = 0;
  private proximaOleada = 0;
  private totalCiviles = 0;
  private titanesDeposito = 0;
  private muertosDeposito = 0;
  private readonly enDeposito = new Set<number>();

  iniciar(api: ApiCapitulo): void {
    this.api = api;
    const ctx = api.ctx;
    this.fase = 'muralla';
    this.t = 0;
    this.colosal = null;
    this.generados = 0;
    this.proximaOleada = 0;
    this.enDeposito.clear();
    this.titanesDeposito = 0;
    this.muertosDeposito = 0;

    const m = ctx.mundo.muralla;
    // En lo alto de la muralla sur, junto a los cañones, mirando hacia fuera
    const pie = puntoAnillo(0.1, m.radioInterior + 5, m.altura);
    ctx.jugador.revivir(pie, 0.1);
    api.puntoControl(puntoAnillo(0, m.radioInterior - 30, 0));
    ctx.escuadron.crear(
      [
        { nombre: 'Armin', rol: 'cebo', aspecto: { pelo: '#e3c873', escala: 0.95 } },
        { nombre: 'Thomas', rol: 'apoyo', aspecto: { pelo: '#c9a56a' } },
        { nombre: 'Mina', rol: 'apoyo', aspecto: { pelo: '#1e1a18', peloLargo: true, escala: 0.94 } },
        { nombre: 'Nac', rol: 'rematador', aspecto: { pelo: '#5a3b24' } },
      ],
      puntoAnillo(0.14, m.radioInterior + 5, m.altura),
    );
    // Vecinos repartidos por la mitad sur del distrito
    this.totalCiviles = 60;
    ctx.civiles.generar(this.totalCiviles, new THREE.Vector3(0, 0, 110), 95);
    api.objetivo('Revisa los cañones de la muralla sur', 'Un día tranquilo… demasiado');

    api.on('titanMuerto', (e) => {
      if (this.enDeposito.has(e.titan.id)) {
        this.enDeposito.delete(e.titan.id);
        this.muertosDeposito++;
      }
    });
  }

  depositoDisponible(): boolean {
    // Durante la batalla, solo cuando la plaza está despejada
    return this.fase !== 'deposito';
  }

  private generarEnBrecha(n: number): void {
    const ctx = this.api.ctx;
    const R = ctx.mundo.muralla.radioExterior;
    for (let i = 0; i < n; i++) {
      const altura = MEZCLA[Math.floor(Math.random() * MEZCLA.length)];
      ctx.titanes.generar({
        posicion: new THREE.Vector3((Math.random() - 0.5) * 30, 0, R + 18 + Math.random() * 40),
        altura,
        anormal: Math.random() < 0.15,
        rumbo: Math.PI,
      });
      this.generados++;
    }
  }

  actualizar(dt: number): void {
    const ctx = this.api.ctx;
    const api = this.api;
    this.t += dt;
    this.colosal?.actualizar(dt);
    const civ = ctx.civiles;
    const total = Math.max(1, this.totalCiviles);

    switch (this.fase) {
      case 'muralla':
        if (this.t > 3) {
          this.fase = 'brecha';
          api.objetivo('¿Qué es eso…?', 'Algo asoma por encima de la muralla');
          this.colosal = new Colosal(ctx, () => {
            const m = ctx.mundo.muralla;
            m.romperPuerta();
            ctx.nav.ponerArco(m.radioInterior, m.radioExterior + 1, 0, m.anchoPuerta, 0);
            ctx.eventos.emit({ tipo: 'brecha' });
            ctx.efectos.bengala(puntoAnillo(-0.15, m.radioInterior + 6, m.altura + 2), '#d12a1f');
            api.mensaje('¡El Titán Colosal ha reventado la puerta! ¡Titanes en la brecha!', 4);
            civ.evacuar(true);
            this.generarEnBrecha(4);
            this.proximaOleada = this.t + 40;
          });
        }
        break;

      case 'brecha':
        if (this.colosal?.terminado) {
          this.colosal = null;
          this.fase = 'evacuacion';
          api.mensaje('Orden de la Guarnición: retaguardia media. Que ningún titán llegue a la puerta norte.', 4);
        }
        break;

      case 'evacuacion': {
        if (this.t > this.proximaOleada && this.generados < 18 && ctx.poblacion.titanesVivos < 12) {
          this.generarEnBrecha(3 + Math.floor(Math.random() * 2));
          this.proximaOleada = this.t + 45 + Math.random() * 25;
          api.mensaje('Más titanes cruzan la brecha', 2.5);
        }
        api.objetivo('Cubre la evacuación hacia la puerta norte', `Civiles a salvo ${civ.salvados}/${total} · víctimas ${civ.muertos}`);
        if (civ.muertos > total * 0.4) {
          api.derrota('Los titanes han llegado a la multitud: demasiadas víctimas civiles.');
          return;
        }
        if (civ.restantes === 0 || civ.salvados >= total * 0.85) {
          this.fase = 'deposito';
          api.mensaje('Suena la campana de retirada… pero vuestros cilindros silban vacíos.', 4.5);
          ctx.jugador.gas.nivel = Math.min(ctx.jugador.gas.nivel, ctx.jugador.gas.capacidad * 0.25);
          // El depósito de la plaza está rodeado de titanes pequeños
          const dep = ctx.mundo.ciudad.deposito;
          const rodean = ctx.titanes.generarGrupo(6, dep.clone(), 16, [3, 4, 4, 5], 0);
          this.titanesDeposito = rodean.length;
          this.muertosDeposito = 0;
          for (const t of rodean) this.enDeposito.add(t.id);
          // Refuerzos: Mikasa, Jean, Connie y Sasha se unen
          const vivos = ctx.escuadron.soldados.filter((s) => s.vivo).map((s) => s.nombre);
          const nuevos = [
            { nombre: 'Mikasa', rol: 'rematador' as const, aspecto: { pelo: '#121214', escala: 0.98 } },
            { nombre: 'Jean', rol: 'apoyo' as const, aspecto: { pelo: '#9a7a52', escala: 1.04 } },
            { nombre: 'Connie', rol: 'apoyo' as const, aspecto: { pelo: '#3a3a3a', escala: 0.92 } },
            { nombre: 'Sasha', rol: 'cebo' as const, aspecto: { pelo: '#6b4428', peloLargo: true, escala: 0.96 } },
          ];
          const roles: Record<string, 'cebo' | 'apoyo' | 'rematador'> = { Armin: 'cebo', Thomas: 'apoyo', Mina: 'apoyo', Nac: 'rematador' };
          const cerca = ctx.jugador.posicion.clone().setY(0);
          ctx.escuadron.limpiar();
          ctx.escuadron.crear([...vivos.map((n) => ({ nombre: n, rol: roles[n] ?? 'apoyo' })), ...nuevos], cerca);
          api.puntoControl(new THREE.Vector3(0, 0, -40));
        }
        break;
      }

      case 'deposito': {
        const quedan = [...this.enDeposito].length;
        api.objetivo('Recupera el depósito de suministros de la plaza', `Titanes eliminados ${this.muertosDeposito}/${this.titanesDeposito} · el gas solo se recarga allí`);
        if (quedan === 0) {
          this.fase = 'escapar';
          api.mensaje('¡Depósito despejado! Recargad gas y salid por la muralla norte.', 4);
        }
        break;
      }

      case 'escapar': {
        api.objetivo('Recarga gas y escala la muralla norte', 'Arriba de la muralla, en el lado norte');
        const p = ctx.jugador.posicion;
        const r = Math.hypot(p.x, p.z);
        if (p.y > ctx.mundo.muralla.altura - 2 && p.z < 0 && r > ctx.mundo.muralla.radioInterior - 2) api.victoria();
        break;
      }
    }
  }

  terminar(): void {
    this.colosal?.eliminar();
    this.colosal = null;
  }
}
