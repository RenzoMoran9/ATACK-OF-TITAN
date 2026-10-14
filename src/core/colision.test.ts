import { describe, expect, it } from 'vitest';
import { empujeFuera } from './colision';

const persona = (x: number, z: number) => ({ x, z, radio: 0.32 });

describe('empujeFuera', () => {
  it('no mueve nada si no hay solapes', () => {
    expect(empujeFuera(0, 0, 0.32, [persona(2, 0)])).toEqual({ dx: 0, dz: 0 });
  });

  it('aparta lo justo hasta tocarse, sin atravesar', () => {
    const e = empujeFuera(0, 0, 0.32, [persona(0.3, 0)]);
    // el centro del otro está a 0,3 m y deben quedar a 0,64 m: nos apartamos 0,34 m hacia -x
    expect(e.dx).toBeCloseTo(-0.34, 6);
    expect(Math.hypot(e.dx - 0.3, e.dz)).toBeCloseTo(0.64, 6);
  });

  it('empuja en la dirección opuesta al otro cuerpo', () => {
    const e = empujeFuera(0, 0, 0.32, [persona(0, 0.2)]);
    expect(e.dx).toBeCloseTo(0, 6);
    expect(e.dz).toBeLessThan(0);
  });

  it('si están exactamente encima, sale hacia +x y no se queda dentro', () => {
    const e = empujeFuera(0, 0, 0.32, [persona(0, 0)]);
    expect(e.dx).toBeCloseTo(0.64, 6);
    expect(e.dz).toBe(0);
  });

  it('con dos cuerpos a los lados, acaba fuera de ambos', () => {
    const e = empujeFuera(0, 0, 0.32, [persona(0.3, 0), persona(-0.3, 0)]);
    expect(Math.abs(e.dz)).toBeLessThan(1e-9);
    expect(Math.abs(e.dx - 0.3)).toBeGreaterThanOrEqual(0.64 - 1e-6);
    expect(Math.abs(e.dx + 0.3)).toBeGreaterThanOrEqual(0.64 - 1e-6);
  });

  it('un titán grande (radio 3,5 m) aparta a una persona a la distancia de su cuerpo', () => {
    const e = empujeFuera(1, 0, 0.32, [{ x: 0, z: 0, radio: 3.5 }]);
    expect(1 + e.dx).toBeCloseTo(3.82, 6);
  });
});
