import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../core/config';
import type { ContextoJuego } from '../core/contexto';
import { Fisica } from '../core/fisica';
import { Poblacion } from '../core/poblacion';
import type { Humano } from '../core/tipos';
import { Jugador } from './jugador';

// las texturas usan un canvas (no hay DOM en Node): basta una textura vacía, aquí solo importa la física
vi.mock('../world/texturas', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const vacia = () => new THREE.Texture();
  return Object.fromEntries(Object.keys(real).map((k) => [k, typeof real[k] === 'function' ? vacia : real[k]]));
});

/** Civil o soldado mínimo: lo que mira la población y el empuje del jugador. */
function persona(x: number, y: number, z: number, extra: Partial<Humano> = {}): Humano {
  return { id: 0, tipo: 'civil', posicion: new THREE.Vector3(x, y, z), vivo: true, agarradoPor: null, ...extra } as unknown as Humano;
}

async function jugadorEn(x: number, z: number) {
  const fisica = await Fisica.crear(14);
  const j = new Jugador(new THREE.Scene(), fisica, new THREE.Vector3(x, 0, z));
  const poblacion = new Poblacion();
  j.conectar({ poblacion, efectos: {}, eventos: { emit() {} } } as unknown as ContextoJuego);
  j.teletransportar(new THREE.Vector3(x, 0, z));
  // como en main.ts: el propio jugador está en la población de humanos
  poblacion.agregarHumano(j as unknown as Humano);
  const apartar = () => (j as unknown as { apartarDePersonas(): { dx: number; dz: number } }).apartarDePersonas();
  return { j, poblacion, apartar };
}

describe('el jugador y las personas son sólidos', () => {
  it('sin nadie cerca no se empuja a sí mismo (está en la población como humano)', async () => {
    const { apartar } = await jugadorEn(0, 0);
    expect(apartar()).toEqual({ dx: 0, dz: 0 });
  });

  it('un civil a su altura lo aparta: no se lo atraviesa', async () => {
    const { j, poblacion, apartar } = await jugadorEn(0, 0);
    const y = j.posicion.y;
    poblacion.agregarHumano(persona(0.2, y, 0));
    const e = apartar();
    // el civil está a 0,2 m en +x: el empuje lo lleva a la suma de radios (0,64 m), hacia -x
    expect(e.dx).toBeCloseTo(-(config.jugador.radio + 0.32 - 0.2), 6);
    expect(e.dz).toBeCloseTo(0, 9);
  });

  it('una persona muy por encima (en un tejado) no estorba', async () => {
    const { j, poblacion, apartar } = await jugadorEn(0, 0);
    poblacion.agregarHumano(persona(0.2, j.posicion.y + 3, 0));
    expect(apartar()).toEqual({ dx: 0, dz: 0 });
  });

  it('quien va en la mano de un titán no empuja al jugador', async () => {
    const { j, poblacion, apartar } = await jugadorEn(0, 0);
    poblacion.agregarHumano(persona(0.2, j.posicion.y, 0, { agarradoPor: {} as never }));
    expect(apartar()).toEqual({ dx: 0, dz: 0 });
  });

  it('quita la velocidad que iba hacia la persona, pero no la que se aleja', async () => {
    const { j, poblacion, apartar } = await jugadorEn(0, 0);
    poblacion.agregarHumano(persona(0.2, j.posicion.y, 0));
    const vel = (j as unknown as { vel: THREE.Vector3 }).vel;
    // el civil está en +x: avanzar hacia +x es ir contra él
    vel.set(6, 0, 2);
    apartar();
    expect(vel.x).toBeCloseTo(0, 6);
    expect(vel.z).toBeCloseTo(2, 6);
    // alejarse de él no se frena
    vel.set(-6, 0, 2);
    apartar();
    expect(vel.x).toBeCloseTo(-6, 6);
  });
});
