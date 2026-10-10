import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { umbralNuca, umbralZona } from '../combat/corte';
import type { ContextoJuego } from '../core/contexto';
import { nuevoId } from '../core/poblacion';
import type { EstadoTitan, Humano, PuntoDebil, ResultadoCorte, TitanAPI, ZonaTitan } from '../core/tipos';

/**
 * Silueta de madera del campo de instrucción (capítulo 1): un muñeco de tablones con la
 * forma de un titán y la nuca pintada de rojo. No se mueve; enseña los ataques del anime:
 * nuca (muerte), tendones (derribo: se inclina y baja la nuca) y ojos (ceguera).
 */

interface PuntoMutable {
  zona: ZonaTitan;
  centro: THREE.Vector3;
  radio: number;
  normal: THREE.Vector3;
  eje: THREE.Vector3;
  activo: boolean;
  /** Posición local (en el grupo pivote) para recolocar el punto al inclinarse. */
  local: THREE.Vector3;
}

const MADERA = new THREE.MeshLambertMaterial({ color: '#9a7a52' });
const MADERA_OSCURA = new THREE.MeshLambertMaterial({ color: '#6e5233' });
const ROJO = new THREE.MeshLambertMaterial({ color: '#b3121b' });
const TRAPO = new THREE.MeshLambertMaterial({ color: '#e9e2cf' });

export class Silueta implements TitanAPI {
  readonly id = nuevoId();
  readonly anormal = false;
  readonly posicion: THREE.Vector3;
  readonly objetivo: Humano | null = null;
  estado: EstadoTitan = 'deambular';
  vivo = true;
  private readonly grupo = new THREE.Group();
  /** Pivote en los pies: se inclina al derribarla y cae al matarla. */
  private readonly pivote = new THREE.Group();
  private readonly puntos: PuntoMutable[] = [];
  private readonly colliders: RAPIER.Collider[] = [];
  private tendonesCortados = new Set<ZonaTitan>();
  private inclinacionObjetivo = 0;
  private caida = 0;

  constructor(private readonly ctx: ContextoJuego, pies: THREE.Vector3, readonly altura: number, readonly rumbo: number) {
    this.posicion = pies.clone();
    const H = altura;
    const s = H / 15;
    const tabla = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.pivote.add(m);
      return m;
    };
    // Piernas (postes), cadera, torso, hombros, brazos, cuello y cabeza de tablones
    for (const lado of [-1, 1]) {
      tabla(0.9 * s, 0.36 * H, 0.9 * s, MADERA_OSCURA, lado * 0.09 * H, 0.18 * H, 0);
      // vendas blancas en los tendones de Aquiles
      tabla(1.0 * s, 0.05 * H, 1.0 * s, TRAPO, lado * 0.09 * H, 0.06 * H, -0.05 * s);
      tabla(0.7 * s, 0.32 * H, 0.7 * s, MADERA, lado * 0.2 * H, 0.5 * H, 0);
    }
    tabla(0.3 * H, 0.06 * H, 1.2 * s, MADERA_OSCURA, 0, 0.37 * H, 0);
    tabla(0.24 * H, 0.3 * H, 0.9 * s, MADERA, 0, 0.53 * H, 0);
    tabla(0.44 * H, 0.05 * H, 1.1 * s, MADERA_OSCURA, 0, 0.68 * H, 0);
    tabla(0.05 * H, 0.08 * H, 0.8 * s, MADERA_OSCURA, 0, 0.74 * H, 0);
    const cabeza = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * H, 0.11 * H, 1.0 * s, 20).rotateX(Math.PI / 2), MADERA);
    cabeza.position.set(0, 0.86 * H, 0);
    cabeza.castShadow = true;
    this.pivote.add(cabeza);
    // ojos pintados y la franja roja de la nuca (detrás, en la base del cráneo)
    for (const lado of [-1, 1]) tabla(0.04 * H, 0.03 * H, 0.1, TRAPO, lado * 0.04 * H, 0.88 * H, 0.52 * s);
    tabla(0.08 * H, 0.06 * H, 0.15, ROJO, 0, 0.77 * H, -0.48 * s);
    // poste de sujeción por detrás
    tabla(0.5 * s, 0.7 * H, 0.5 * s, MADERA_OSCURA, 0, 0.35 * H, -1.4 * s);

    this.grupo.add(this.pivote);
    this.grupo.position.copy(pies);
    this.grupo.rotation.y = rumbo;
    ctx.escena.add(this.grupo);
    this.grupo.updateMatrixWorld(true);

    const r = Math.sqrt(H / 10);
    const atras = new THREE.Vector3(0, 0, -1);
    const delante = new THREE.Vector3(0, 0, 1);
    const arriba = new THREE.Vector3(0, 1, 0);
    const lateral = new THREE.Vector3(1, 0, 0);
    this.agregarPunto('nuca', new THREE.Vector3(0, 0.77 * H, -0.5 * s), 0.35 * r + 0.25, atras, arriba);
    this.agregarPunto('tendonIzq', new THREE.Vector3(0.09 * H, 0.06 * H, -0.5 * s), 0.05 * H + 0.2, atras, arriba);
    this.agregarPunto('tendonDer', new THREE.Vector3(-0.09 * H, 0.06 * H, -0.5 * s), 0.05 * H + 0.2, atras, arriba);
    this.agregarPunto('ojoIzq', new THREE.Vector3(0.04 * H, 0.88 * H, 0.55 * s), 0.03 * H + 0.2, delante, lateral);
    this.agregarPunto('ojoDer', new THREE.Vector3(-0.04 * H, 0.88 * H, 0.55 * s), 0.03 * H + 0.2, delante, lateral);

    // Colisiones estáticas para engancharse a la silueta
    const q = new THREE.Quaternion().setFromAxisAngle(arriba, rumbo);
    const mundo = (v: THREE.Vector3) => v.clone().applyQuaternion(q).add(pies);
    this.colliders.push(
      ctx.fisica.caja(mundo(new THREE.Vector3(0, 0.55 * H, 0)), { x: 0.22 * H, y: 0.2 * H, z: 0.5 * s }, 'titan', q),
      ctx.fisica.caja(mundo(new THREE.Vector3(0, 0.86 * H, 0)), { x: 0.11 * H, y: 0.11 * H, z: 0.5 * s }, 'titan', q),
      ctx.fisica.caja(mundo(new THREE.Vector3(0, 0.18 * H, 0)), { x: 0.14 * H, y: 0.18 * H, z: 0.45 * s }, 'titan', q),
    );
    ctx.poblacion.agregarTitan(this);
  }

  private agregarPunto(zona: ZonaTitan, local: THREE.Vector3, radio: number, normal: THREE.Vector3, eje: THREE.Vector3): void {
    this.puntos.push({ zona, centro: new THREE.Vector3(), radio, normal: normal.clone(), eje: eje.clone(), activo: true, local });
    this.recolocarPuntos();
  }

  private recolocarPuntos(): void {
    this.pivote.updateMatrixWorld(true);
    for (const p of this.puntos) p.centro.copy(p.local).applyMatrix4(this.pivote.matrixWorld);
  }

  get puntosDebiles(): readonly PuntoDebil[] {
    return this.puntos;
  }

  cabeza(): THREE.Vector3 {
    return new THREE.Vector3(0, 0.86 * this.altura, 0).applyMatrix4(this.pivote.matrixWorld);
  }

  distraer(): void {}

  recibirCorte(zona: ZonaTitan, danio: number, atacante: Humano | null): ResultadoCorte {
    const p = this.puntos.find((x) => x.zona === zona);
    if (!this.vivo || !p || !p.activo) return { zona, efecto: 'nada', danio };
    if (danio <= 0) return { zona, efecto: 'rebote', danio };
    if (zona === 'nuca') {
      if (danio >= umbralNuca(this.altura)) {
        this.vivo = false;
        this.estado = 'muriendo';
        for (const x of this.puntos) x.activo = false;
        for (const c of this.colliders) this.ctx.fisica.eliminarCollider(c);
        this.colliders.length = 0;
        this.ctx.eventos.emit({ tipo: 'titanMuerto', titan: this, por: atacante });
        return { zona, efecto: 'muerte', danio };
      }
      return { zona, efecto: 'herida', danio };
    }
    if (danio < umbralZona(zona, this.altura)) return { zona, efecto: 'superficial', danio };
    p.activo = false;
    if (zona === 'tendonIzq' || zona === 'tendonDer') {
      this.tendonesCortados.add(zona);
      if (this.tendonesCortados.size >= 2) {
        this.estado = 'derribado';
        this.inclinacionObjetivo = 0.6; // se inclina hacia delante y la nuca queda más baja
        return { zona, efecto: 'derribo', danio };
      }
      this.inclinacionObjetivo = 0.18;
      return { zona, efecto: 'cojera', danio };
    }
    if (zona === 'ojoIzq' || zona === 'ojoDer') {
      if (!this.puntos.some((x) => (x.zona === 'ojoIzq' || x.zona === 'ojoDer') && x.activo)) this.estado = 'cegado';
      return { zona, efecto: 'ceguera', danio };
    }
    return { zona, efecto: 'superficial', danio };
  }

  /** Inclinación al derribarla y caída al matarla. */
  actualizar(dt: number): void {
    if (!this.vivo) {
      this.caida = Math.min(Math.PI / 2, this.caida + dt * (0.6 + this.caida * 2));
      this.pivote.rotation.x = this.caida;
      if (this.caida >= Math.PI / 2) this.estado = 'muerto';
    } else {
      this.pivote.rotation.x += (this.inclinacionObjetivo - this.pivote.rotation.x) * Math.min(1, dt * 3);
    }
    this.recolocarPuntos();
  }

  eliminar(): void {
    for (const c of this.colliders) this.ctx.fisica.eliminarCollider(c);
    this.colliders.length = 0;
    this.ctx.escena.remove(this.grupo);
    this.ctx.poblacion.quitarTitan(this);
  }
}
