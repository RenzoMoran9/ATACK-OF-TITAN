import type { EstadoGuardadoCampamento } from './campamento';
import type { EstadoGuardadoPueblo } from './logicaPueblo';

/**
 * Partida guardada del mundo abierto en el navegador (localStorage). Se guarda sola cada
 * poco y al pausar; si el almacenamiento no está disponible, el juego sigue sin guardar.
 */

const CLAVE = 'atack-of-titan:mundo-v1';

export interface PartidaGuardada {
  version: 1;
  dia: number;
  hora: number;
  pueblos: EstadoGuardadoPueblo[];
  descubiertos: string[];
  stats: { titanes: number; nucas: number; jefes: number; defensas: number };
  /** Último sitio seguro (x, z). */
  reaparicion: [number, number];
  /** Dónde estabas exactamente y con qué equipo (para seguir justo ahí). */
  jugador?: { x: number; y: number; z: number; rumbo: number; gas: number; cuchillas: number; bengalas: number };
  /** Dónde estaba tu caballo (x, z). */
  caballo?: [number, number];
  campamento?: EstadoGuardadoCampamento;
  /** Momento del guardado (ms desde 1970), para el menú. */
  fecha?: number;
}

export function leerPartida(): PartidaGuardada | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const p = JSON.parse(crudo) as Partial<PartidaGuardada>;
    if (p.version !== 1 || typeof p.dia !== 'number' || typeof p.hora !== 'number') return null;
    return {
      version: 1,
      dia: Math.max(1, Math.floor(p.dia)),
      hora: ((p.hora % 24) + 24) % 24,
      pueblos: Array.isArray(p.pueblos) ? p.pueblos : [],
      descubiertos: Array.isArray(p.descubiertos) ? p.descubiertos.filter((x) => typeof x === 'string') : [],
      stats: { titanes: 0, nucas: 0, jefes: 0, defensas: 0, ...(p.stats ?? {}) },
      reaparicion: Array.isArray(p.reaparicion) && p.reaparicion.length === 2 ? [Number(p.reaparicion[0]) || 0, Number(p.reaparicion[1]) || 0] : [6, 300],
      jugador: p.jugador && [p.jugador.x, p.jugador.y, p.jugador.z].every(Number.isFinite) ? p.jugador : undefined,
      caballo: Array.isArray(p.caballo) && p.caballo.length === 2 && p.caballo.every(Number.isFinite) ? p.caballo : undefined,
      campamento: p.campamento && Number.isFinite(p.campamento.x) && Array.isArray(p.campamento.postes) ? p.campamento : undefined,
      fecha: typeof p.fecha === 'number' ? p.fecha : undefined,
    };
  } catch {
    return null;
  }
}

export function guardarPartida(p: PartidaGuardada): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: no se guarda, el juego sigue */
  }
}

export function borrarPartida(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* nada que borrar */
  }
}
