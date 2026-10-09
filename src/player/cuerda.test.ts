import { describe, expect, it } from 'vitest';
import { acelerarBobina, aplicarRecogida, aplicarRestriccion, direccionOrbita, type Vec3 } from './cuerda';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('aplicarRestriccion', () => {
  it('no hace nada si el cable está flojo', () => {
    const pos = v(0, -5, 0);
    const vel = v(3, -2, 1);
    const tenso = aplicarRestriccion(pos, vel, v(0, 0, 0), 10);
    expect(tenso).toBe(false);
    expect(pos).toEqual(v(0, -5, 0));
    expect(vel).toEqual(v(3, -2, 1));
  });

  it('devuelve al jugador a la longitud del cable y anula la velocidad que se aleja', () => {
    const ancla = v(0, 10, 0);
    const pos = v(0, -2, 0); // a 12 m, cable de 10 m
    const vel = v(4, -6, 0); // cae (se aleja) y se mueve de lado
    expect(aplicarRestriccion(pos, vel, ancla, 10)).toBe(true);
    expect(dist(pos, ancla)).toBeCloseTo(10, 6);
    expect(vel.y).toBeCloseTo(0, 6); // la parte radial (hacia abajo) desaparece
    expect(vel.x).toBeCloseTo(4, 6); // la tangencial se conserva (péndulo)
  });

  it('solo tira, nunca empuja: conserva la velocidad hacia el ancla', () => {
    const ancla = v(0, 10, 0);
    const pos = v(0, -1, 0);
    const vel = v(0, 5, 0); // ya se acerca
    aplicarRestriccion(pos, vel, ancla, 10);
    expect(vel.y).toBeCloseTo(5, 6);
  });

  it('un péndulo simulado mantiene la longitud y no gana energía', () => {
    const g = 14;
    const dt = 1 / 60;
    const ancla = v(0, 20, 0);
    const L = 10;
    const pos = v(L, 20, 0); // horizontal, en reposo
    const vel = v(0, 0, 0);
    let yMin = Infinity;
    let yMaxTrasBajar = -Infinity;
    for (let i = 0; i < 600; i++) {
      vel.y -= g * dt;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;
      aplicarRestriccion(pos, vel, ancla, L);
      expect(dist(pos, ancla)).toBeLessThanOrEqual(L + 1e-6);
      yMin = Math.min(yMin, pos.y);
      if (i > 30) yMaxTrasBajar = Math.max(yMaxTrasBajar, pos.y);
    }
    expect(yMin).toBeCloseTo(20 - L, 0); // pasa por debajo del ancla
    expect(yMaxTrasBajar).toBeLessThanOrEqual(20 + 1e-6); // nunca sube por encima del punto de partida
    expect(Math.abs(pos.x)).toBeGreaterThan(0); // sigue oscilando
  });
});

describe('aplicarRecogida', () => {
  it('impone la velocidad de la bobina hacia el ancla y conserva la tangencial', () => {
    const ancla = v(0, 0, 0);
    const pos = v(20, 0, 0);
    const vel = v(0, 0, 7);
    const L = aplicarRecogida(pos, vel, ancla, 30, 25, 2);
    expect(vel.x).toBeCloseTo(-25, 6);
    expect(vel.z).toBeCloseTo(7, 6);
    expect(L).toBe(20); // la longitud baja hasta la distancia actual
  });

  it('no frena a quien ya se acerca más rápido que la bobina', () => {
    const vel = v(-40, 0, 0);
    aplicarRecogida(v(20, 0, 0), vel, v(0, 0, 0), 20, 25, 2);
    expect(vel.x).toBe(-40);
  });

  it('nunca acorta por debajo de la longitud mínima', () => {
    const vel = v(0, 0, 0);
    const L = aplicarRecogida(v(1, 0, 0), vel, v(0, 0, 0), 5, 25, 2);
    expect(L).toBe(2);
    expect(vel).toEqual(v(0, 0, 0));
  });

  it('recoger durante un tiempo acerca al jugador al ancla', () => {
    const ancla = v(0, 30, 0);
    const pos = v(0, 0, 0);
    const vel = v(0, 0, 0);
    let L = 30;
    let bobina = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      bobina = acelerarBobina(bobina, 25, 70, dt);
      vel.y -= 14 * dt;
      L = aplicarRecogida(pos, vel, ancla, L, bobina, 2);
      pos.y += vel.y * dt;
      aplicarRestriccion(pos, vel, ancla, L);
    }
    expect(dist(pos, ancla)).toBeLessThan(15);
    expect(L).toBeLessThan(16);
  });
});

describe('acelerarBobina', () => {
  it('sube con la aceleración y se limita a la máxima', () => {
    expect(acelerarBobina(0, 25, 70, 0.1)).toBeCloseTo(7, 6);
    expect(acelerarBobina(24, 25, 70, 0.1)).toBe(25);
  });
});

describe('direccionOrbita', () => {
  it('quita la componente radial de la dirección deseada', () => {
    const t = direccionOrbita(v(10, 0, 0), v(0, 0, 0), v(1, 0, 1))!;
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(1, 6);
  });

  it('devuelve null si la dirección deseada es puramente radial', () => {
    expect(direccionOrbita(v(10, 0, 0), v(0, 0, 0), v(-1, 0, 0))).toBeNull();
  });
});
