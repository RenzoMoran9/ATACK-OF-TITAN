import * as THREE from 'three';
import type { EstadoAnimacion } from '../core/tipos';
import { ModeloJugador } from './modeloJugador';

/**
 * Laboratorio de poses (?poses): una fila de soldados, cada uno animado con un estado
 * sintético, para revisar la animación procedural sin depender de la física.
 */
interface Caso {
  nombre: string;
  estado: (t: number, base: THREE.Vector3) => Partial<EstadoAnimacion>;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const CASOS: Caso[] = [
  { nombre: 'reposo', estado: () => ({}) },
  { nombre: 'carrera', estado: () => ({ vel: V(0, 0, 7) }) },
  { nombre: 'recogida', estado: (_t, b) => ({ enSuelo: false, vel: V(0, 4, 22), anclas: [b.clone().add(V(-4, 18, 30)), b.clone().add(V(4, 18, 30))], recogiendo: true }) },
  { nombre: 'péndulo', estado: (t, b) => ({ enSuelo: false, vel: V(0, 10 * Math.sin(t * 1.5), 14), anclas: [b.clone().add(V(0, 20, 0))] }) },
  { nombre: 'impulso', estado: () => ({ enSuelo: false, vel: V(0, 3, 12), impulsando: true, dirImpulso: V(0, 0.2, 1).normalize() }) },
  { nombre: 'caída', estado: () => ({ enSuelo: false, vel: V(0, -14, 6) }) },
  { nombre: 'aterrizaje', estado: (t) => ({ aterrizaje: (t % 1.2) * 0.5, impactoAterrizaje: 13 }) },
  { nombre: 'preparación', estado: () => ({ enSuelo: false, vel: V(0, 1, 15), preparandoCorte: true }) },
  { nombre: 'corte', estado: (t) => ({ enSuelo: false, vel: V(0, 1, 15), corte: (t % 0.9) / 0.6 < 1 ? (t % 0.9) / 0.6 : null }) },
  { nombre: 'giro Levi', estado: () => ({ enSuelo: false, vel: V(0, 2, 28), giro: true }) },
  { nombre: 'agarrado', estado: () => ({ agarrado: true }) },
  { nombre: 'rodada', estado: (t) => ({ rodando: t % 1.4 < 0.55, vel: V(0, 0, 6) }) },
];

export class LaboratorioPoses {
  private readonly modelos: { m: ModeloJugador; caso: Caso; base: THREE.Vector3 }[] = [];
  readonly camara: THREE.Vector3;
  readonly mirar: THREE.Vector3;

  constructor(escena: THREE.Scene, origen: THREE.Vector3) {
    CASOS.forEach((caso, i) => {
      const fila = Math.floor(i / 6);
      const col = i % 6;
      const m = new ModeloJugador(i % 3 === 1 ? { pelo: '#1a1414', peloLargo: true, bufanda: '#b3202a' } : {});
      const base = origen.clone().add(V((col - 2.5) * 2.2, fila === 0 ? 2.2 : 0, fila * 3.2));
      m.grupo.position.copy(base);
      m.grupo.rotation.y = -Math.PI / 2 + 0.5;
      escena.add(m.grupo);
      this.modelos.push({ m, caso, base });
    });
    this.camara = origen.clone().add(V(-1, 2.6, 13));
    this.mirar = origen.clone().add(V(0, 1.6, 0));
  }

  actualizar(dt: number, t: number): void {
    for (const { m, caso, base } of this.modelos) {
      const e: EstadoAnimacion = {
        dt,
        t,
        vel: V(0, 0, 0),
        acel: V(0, 0, 0),
        enSuelo: true,
        anclas: [],
        recogiendo: false,
        impulsando: false,
        corte: null,
        giro: false,
        agarrado: false,
        muerto: false,
        aterrizaje: null,
        impactoAterrizaje: 0,
        ...caso.estado(t, base),
      };
      // velocidades del caso en el marco del modelo (rotado)
      e.vel.applyAxisAngle(V(0, 1, 0), m.grupo.rotation.y);
      e.dirImpulso?.applyAxisAngle(V(0, 1, 0), m.grupo.rotation.y);
      e.anclas = e.anclas.map((a) => a.clone().sub(base).applyAxisAngle(V(0, 1, 0), m.grupo.rotation.y).add(base));
      m.grupo.updateMatrixWorld(true);
      m.animar(e);
    }
  }
}
