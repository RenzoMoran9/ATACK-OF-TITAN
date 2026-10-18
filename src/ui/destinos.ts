import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import { distancia } from './logicaMapa';

/**
 * Destino y marcas del mapa: el destino es el sitio al que quieres ir (uno, se elige tocando el
 * mapa); las marcas, sitios que guardas con nombre (hasta 12). Se recuerdan en el dispositivo.
 *
 * El destino se ve en el mundo como una columna de luz dorada (visible de lejos), en la brújula
 * con su distancia y en el mapa con una línea desde ti. Al llegar (a menos de 12 m) se quita solo.
 */

export interface Sitio {
  x: number;
  z: number;
  nombre: string;
}

const CLAVE = 'atack-of-titan-marcas';
export const MAX_MARCAS = 12;
const LLEGADA = 12;
const ALTO_BALIZA = 160;

export class Destinos {
  destino: Sitio | null = null;
  readonly marcas: Sitio[] = [];
  private readonly baliza: THREE.Group;
  private readonly materiales: THREE.Material[] = [];
  private contador = 0;

  constructor(escena: THREE.Scene) {
    this.cargar();
    // columna de luz: un cilindro abierto con degradado que se desvanece hacia arriba
    this.baliza = new THREE.Group();
    const tex = texturaColumna();
    for (const [r, op] of [
      [1.6, 0.55],
      [4, 0.18],
    ] as const) {
      const m = new THREE.MeshBasicMaterial({ map: tex, color: '#ffcf5a', transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      this.materiales.push(m);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ALTO_BALIZA, 20, 1, true), m);
      c.position.y = ALTO_BALIZA / 2;
      c.renderOrder = 3;
      this.baliza.add(c);
    }
    const aro = new THREE.Mesh(new THREE.RingGeometry(3, 4.2, 32), new THREE.MeshBasicMaterial({ color: '#ffd77a', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.materiales.push(aro.material as THREE.Material);
    aro.rotation.x = -Math.PI / 2;
    aro.position.y = 0.15;
    this.baliza.add(aro);
    this.baliza.visible = false;
    escena.add(this.baliza);
  }

  /** Pone el destino (y lo dice). */
  irA(s: Sitio, ctx?: ContextoJuego): void {
    this.destino = { ...s };
    this.guardar();
    if (ctx) {
      const j = ctx.jugador.posicion;
      ctx.eventos.emit({ tipo: 'mensaje', texto: `Destino: ${s.nombre} (${distancia(Math.hypot(s.x - j.x, s.z - j.z))}) · sigue la columna de luz`, segundos: 2.5 });
    }
  }

  quitarDestino(): void {
    this.destino = null;
    this.guardar();
  }

  /** Guarda un sitio como marca (con nombre propio si no trae uno). Devuelve la marca o null si no caben más. */
  marcar(x: number, z: number, nombre?: string): Sitio | null {
    if (this.marcas.length >= MAX_MARCAS) return null;
    const m = { x, z, nombre: nombre ?? `Marca ${++this.contador}` };
    this.marcas.push(m);
    this.guardar();
    return m;
  }

  quitarMarca(m: Sitio): void {
    const i = this.marcas.indexOf(m);
    if (i >= 0) this.marcas.splice(i, 1);
    this.guardar();
  }

  /** Cada fotograma: la baliza en su sitio y, al llegar, se quita el destino. */
  actualizar(ctx: ContextoJuego, t: number): void {
    const d = this.destino;
    this.baliza.visible = d !== null;
    if (!d) return;
    const j = ctx.jugador.posicion;
    const dist = Math.hypot(d.x - j.x, d.z - j.z);
    this.baliza.position.set(d.x, 0, d.z);
    // de cerca se ve menos (no tapa la vista) y late suave
    const cerca = THREE.MathUtils.clamp((dist - 15) / 80, 0.15, 1);
    this.baliza.scale.set(1, 1, 1);
    (this.materiales[0] as THREE.MeshBasicMaterial).opacity = 0.55 * cerca * (0.85 + 0.15 * Math.sin(t * 3));
    (this.materiales[1] as THREE.MeshBasicMaterial).opacity = 0.18 * cerca;
    if (dist < LLEGADA && ctx.jugador.vivo) {
      ctx.eventos.emit({ tipo: 'mensaje', texto: `Has llegado: ${d.nombre}`, segundos: 2.5 });
      this.quitarDestino();
    }
  }

  private cargar(): void {
    try {
      const d = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as { destino?: Sitio | null; marcas?: Sitio[]; contador?: number } | null;
      if (!d) return;
      const valido = (s: unknown): s is Sitio => !!s && Number.isFinite((s as Sitio).x) && Number.isFinite((s as Sitio).z) && typeof (s as Sitio).nombre === 'string';
      if (valido(d.destino)) this.destino = d.destino;
      for (const m of d.marcas ?? []) if (valido(m) && this.marcas.length < MAX_MARCAS) this.marcas.push(m);
      this.contador = Number.isFinite(d.contador) ? (d.contador as number) : this.marcas.length;
    } catch {
      /* sin almacenamiento o datos rotos: empezamos sin marcas */
    }
  }

  private guardar(): void {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ destino: this.destino, marcas: this.marcas, contador: this.contador }));
    } catch {
      /* sin almacenamiento: duran lo que la sesión */
    }
  }
}

/** Degradado vertical: brillante abajo, transparente arriba. */
function texturaColumna(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
