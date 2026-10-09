import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Etiqueta =
  | 'suelo'
  | 'edificio'
  | 'tejado'
  | 'muralla'
  | 'puerta'
  | 'arbol'
  | 'rama'
  | 'titan'
  | 'nuca'
  | 'jugador'
  | 'otro';

export interface ImpactoRayo {
  punto: THREE.Vector3;
  normal: THREE.Vector3;
  distancia: number;
  etiqueta: Etiqueta;
  collider: RAPIER.Collider;
}

type V3 = { x: number; y: number; z: number };

const quatY = (rotY: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);

/**
 * Envoltorio fino sobre Rapier: colisionadores estáticos etiquetados y consultas
 * (rayos para los ganchos, esferas para la cámara).
 */
export class Fisica {
  readonly etiquetas = new Map<number, Etiqueta>();
  private readonly rayo = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  private constructor(readonly mundo: RAPIER.World) {}

  static async crear(gravedad: number): Promise<Fisica> {
    await RAPIER.init();
    return new Fisica(new RAPIER.World({ x: 0, y: -gravedad, z: 0 }));
  }

  registrar(desc: RAPIER.ColliderDesc, etiqueta: Etiqueta, cuerpo?: RAPIER.RigidBody): RAPIER.Collider {
    const c = this.mundo.createCollider(desc, cuerpo);
    this.etiquetas.set(c.handle, etiqueta);
    return c;
  }

  caja(centro: V3, mitad: V3, etiqueta: Etiqueta, rot: number | THREE.Quaternion = 0): RAPIER.Collider {
    const q = typeof rot === 'number' ? quatY(rot) : rot;
    const desc = RAPIER.ColliderDesc.cuboid(mitad.x, mitad.y, mitad.z)
      .setTranslation(centro.x, centro.y, centro.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.registrar(desc, etiqueta);
  }

  cilindro(centro: V3, mitadAltura: number, radio: number, etiqueta: Etiqueta, q?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(mitadAltura, radio).setTranslation(centro.x, centro.y, centro.z);
    if (q) desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.registrar(desc, etiqueta);
  }

  capsula(centro: V3, mitadAltura: number, radio: number, etiqueta: Etiqueta, q?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(mitadAltura, radio).setTranslation(centro.x, centro.y, centro.z);
    if (q) desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.registrar(desc, etiqueta);
  }

  bola(centro: V3, radio: number, etiqueta: Etiqueta): RAPIER.Collider {
    return this.registrar(RAPIER.ColliderDesc.ball(radio).setTranslation(centro.x, centro.y, centro.z), etiqueta);
  }

  /** Envolvente convexa a partir de puntos en coordenadas de mundo. */
  casco(puntos: number[], etiqueta: Etiqueta): RAPIER.Collider | null {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(puntos));
    return desc ? this.registrar(desc, etiqueta) : null;
  }

  lanzarRayo(origen: THREE.Vector3, dir: THREE.Vector3, max: number, excluir?: RAPIER.Collider): ImpactoRayo | null {
    this.rayo.origin = { x: origen.x, y: origen.y, z: origen.z };
    this.rayo.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.mundo.castRayAndGetNormal(this.rayo, max, true, undefined, undefined, excluir);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      punto: new THREE.Vector3(origen.x + dir.x * t, origen.y + dir.y * t, origen.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distancia: t,
      etiqueta: this.etiquetas.get(hit.collider.handle) ?? 'otro',
      collider: hit.collider,
    };
  }

  /** Distancia libre al barrer una esfera de `radio` desde `origen` en `dir` (normalizada). */
  barrerEsfera(origen: THREE.Vector3, dir: THREE.Vector3, max: number, radio: number, excluir?: RAPIER.Collider): number {
    const hit = this.mundo.castShape(
      { x: origen.x, y: origen.y, z: origen.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      new RAPIER.Ball(radio),
      0,
      max,
      true,
      undefined,
      undefined,
      excluir,
    );
    return hit ? hit.time_of_impact : max;
  }

  paso(dt: number): void {
    this.mundo.timestep = dt;
    this.mundo.step();
  }
}
