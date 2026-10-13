import * as THREE from 'three';
import type { ApiCapitulo, Capitulo } from '../campana';
import { Silueta } from '../silueta';

/**
 * Capítulo 1 · Cadetes del 104.º (847-850). Campo de siluetas de madera en el borde del
 * bosque gigante: los cuatro ataques del anime antes de la primera batalla.
 */
export class CapEntrenamiento implements Capitulo {
  readonly id = 'entrenamiento' as const;
  readonly titulo = 'Capítulo 1: Cadetes del 104.º';
  readonly epoca = 'Años 847-850 · Campo de instrucción';
  readonly intro =
    'Los refugiados de Maria labran campos ajenos o se alistan, y tú has elegido los cables y el acero. ' +
    'Antes de graduarte, el instructor quiere verte cortar madera como si fuera carne: la nuca, los tobillos y los ojos.';

  private api!: ApiCapitulo;
  private siluetas: Silueta[] = [];
  private paso = 0;
  private derribada7 = false;
  private cegada15 = false;
  private espera = 0;

  iniciar(api: ApiCapitulo): void {
    this.api = api;
    const ctx = api.ctx;
    this.paso = 0;
    this.derribada7 = false;
    this.cegada15 = false;
    this.espera = 0;
    const inicio = new THREE.Vector3(0, 0, 330);
    ctx.jugador.revivir(inicio, 0);
    api.puntoControl(inicio);
    // tus compañeros del 104.º entrenan contigo: practica las órdenes (1–8, Tab)
    ctx.escuadron.crear(
      [
        { nombre: 'Mikasa', rol: 'rematador' },
        { nombre: 'Armin', rol: 'cebo' },
        { nombre: 'Jean', rol: 'apoyo' },
        { nombre: 'Sasha', rol: 'apoyo' },
        { nombre: 'Moblit', rol: 'intendente' },
      ],
      inicio.clone().add(new THREE.Vector3(-5, 0, -4)),
    );
    // Siluetas de 3, 7 y 15 m mirando hacia el camino, delante de los primeros troncos
    this.siluetas = [
      new Silueta(ctx, new THREE.Vector3(-34, 0, 392), 3, Math.PI),
      new Silueta(ctx, new THREE.Vector3(0, 0, 398), 7, Math.PI),
      new Silueta(ctx, new THREE.Vector3(38, 0, 404), 15, Math.PI),
    ];
    api.on('corte', (e) => {
      const r = e.resultado;
      if (e.por !== ctx.jugador) return;
      if (r.efecto === 'herida') api.mensaje('Instructor: «¡Más rápido! Engánchate a la silueta, recoge cable y suelta el tajo al pasar.»', 3.5);
      if (r.efecto === 'rebote') api.mensaje('Instructor: «Así no cortas ni pan. Velocidad, cadete.»', 3);
      if (e.titan === this.siluetas[1] && r.efecto === 'derribo') this.derribada7 = true;
      if (e.titan === this.siluetas[2] && r.efecto === 'ceguera') this.cegada15 = true;
    });
    this.actualizarObjetivo();
  }

  private actualizarObjetivo(): void {
    const a = this.api;
    switch (this.paso) {
      case 0:
        a.objetivo('Ve al campo de siluetas en el borde del bosque', 'Corre con Shift, salta con Espacio; engánchate a los troncos con clic derecho');
        break;
      case 1:
        a.objetivo('Silueta de 3 m: córtale la nuca (franja roja)', 'Engánchate a ella, recoge cable y haz clic izquierdo al pasar por detrás');
        break;
      case 2:
        a.objetivo('Silueta de 7 m: corta los dos tobillos (vendas blancas) y remata la nuca', this.derribada7 ? 'Derribada: ¡a la nuca!' : 'Pasa en vuelo bajo por detrás de cada tobillo con F');
        break;
      case 3:
        a.objetivo('Silueta de 15 m: ciégala (ojos) y córtale la nuca', this.cegada15 ? 'Ciega: ¡ahora la nuca!' : 'Cruza por delante de la cara con F, luego rodéala');
        break;
      case 4:
        a.objetivo('Cambia de cuchillas con R', 'En combate, una cuchilla mellada corta al 60 %');
        break;
    }
  }

  actualizar(dt: number): void {
    const ctx = this.api.ctx;
    for (const s of this.siluetas) s.actualizar(dt);
    const p = ctx.jugador.posicion;
    if (this.paso === 0 && p.z > 360) {
      this.paso = 1;
      this.api.mensaje('Instructor Shadis: «La nuca. Un metro de alto, diez centímetros de ancho. Si fallas, estás muerto.»', 4.5);
    } else if (this.paso === 1 && !this.siluetas[0].vivo) {
      this.paso = 2;
      this.api.mensaje('«Bien. Ahora los tobillos: un titán en el suelo enseña la nuca.»', 3.5);
    } else if (this.paso === 2 && !this.siluetas[1].vivo) {
      this.paso = 3;
      if (!this.derribada7) this.api.mensaje('«La has matado sin derribarla. Con uno de verdad no tendrás tanta suerte.»', 3.5);
      this.api.mensaje('«El grande. Ciego, no puede agarrarte.»', 3);
    } else if (this.paso === 3 && !this.siluetas[2].vivo) {
      this.paso = 4;
    } else if (this.paso === 4) {
      if (ctx.jugador.paresRepuesto < 4 && !ctx.jugador.cambiandoCuchillas) {
        this.espera += dt;
        if (this.espera > 0.8) this.api.victoria();
      }
    }
    this.actualizarObjetivo();
  }

  terminar(): void {
    for (const s of this.siluetas) s.eliminar();
    this.siluetas = [];
  }
}
