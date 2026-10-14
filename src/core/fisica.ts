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
  /** Objeto 3D que se mueve con este colisionador (partes de titán), si lo hay. */
  objeto: THREE.Object3D | null;
}

type V3 = { x: number; y: number; z: number };

const quatY = (rotY: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);

/**
 * Envoltorio fino sobre Rapier: colisionadores estáticos etiquetados y consultas
 * (rayos para los ganchos, esferas para la cámara).
 */
export class Fisica {
  readonly etiquetas = new Map<number, Etiqueta>();
  /** Colisionadores que se mueven con un objeto 3D (los ganchos anclados lo siguen). */
  readonly objetos = new Map<number, THREE.Object3D>();
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

  /** Asocia un colisionador a un objeto 3D: un gancho anclado en él se moverá con el objeto. */
  asociar(collider: RAPIER.Collider, objeto: THREE.Object3D): void {
    this.objetos.set(collider.handle, objeto);
  }

  /** Cuerpo cinemático (por posición) para colisionadores que se mueven (titanes). */
  crearCinematico(): RAPIER.RigidBody {
    return this.mundo.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  }

  eliminarCuerpo(cuerpo: RAPIER.RigidBody): void {
    for (let i = 0; i < cuerpo.numColliders(); i++) {
      const c = cuerpo.collider(i);
      this.etiquetas.delete(c.handle);
      this.objetos.delete(c.handle);
    }
    this.mundo.removeRigidBody(cuerpo);
  }

  eliminarCollider(c: RAPIER.Collider): void {
    this.etiquetas.delete(c.handle);
    this.objetos.delete(c.handle);
    this.mundo.removeCollider(c, false);
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

  /**
   * Tronco cónico que empieza en (x, y0, z) y sube `alto`, con la misma silueta que una malla
   * CylinderGeometry de `lados` caras girada `giro` alrededor de Y. Es convexo: para un tronco
   * con raíces, usar un colisionador por parte.
   */
  troncoConico(x: number, z: number, y0: number, alto: number, radioBase: number, radioTope: number, lados: number, giro: number, etiqueta: Etiqueta): RAPIER.Collider | null {
    const puntos: number[] = [];
    for (const [y, r] of [[y0, radioBase], [y0 + alto, radioTope]]) {
      for (let i = 0; i < lados; i++) {
        const t = giro + (i / lados) * Math.PI * 2;
        puntos.push(x + r * Math.sin(t), y, z + r * Math.cos(t));
      }
    }
    return this.casco(puntos, etiqueta);
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
      objeto: this.objetos.get(hit.collider.handle) ?? null,
    };
  }

  /** Distancia libre al barrer una esfera de `radio` desde `origen` en `dir` (normalizada). */
  barrerEsfera(origen: THREE.Vector3, dir: THREE.Vector3, max: number, radio: number, excluir?: RAPIER.Collider, ignorarEtiquetas?: readonly string[]): number {
    const filtro = ignorarEtiquetas?.length ? (c: RAPIER.Collider) => !ignorarEtiquetas.includes(this.etiquetas.get(c.handle) ?? '') : undefined;
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
      undefined,
      filtro,
    );
    return hit ? hit.time_of_impact : max;
  }

  paso(dt: number): void {
    this.mundo.timestep = dt;
    this.mundo.step();
  }
}
