import { describe, expect, it } from 'vitest';
import { RADIO, dentroDelRecinto, desvioPorPuerta } from './carpa';

describe('recinto del campamento', () => {
  it('distingue dentro y fuera', () => {
    expect(dentroDelRecinto(0, 0, 0, 0)).toBe(true);
    expect(dentroDelRecinto(0, 0, RADIO - 1, 0)).toBe(true);
    expect(dentroDelRecinto(0, 0, RADIO + 0.5, 0)).toBe(false);
  });

  it('sin cruzar el muro no hay desvío', () => {
    expect(desvioPorPuerta(0, 0, 0, { x: 20, z: 20 }, { x: 30, z: 0 })).toBeNull();
    expect(desvioPorPuerta(0, 0, 0, { x: 1, z: 1 }, { x: -2, z: 2 })).toBeNull();
  });

  it('desde fuera, primero se alinea ante la puerta y luego la cruza', () => {
    // puerta mirando a +Z (rumbo 0): fuera, a un lado
    const a = desvioPorPuerta(0, 0, 0, { x: 15, z: 15 }, { x: 0, z: 0 })!;
    expect(a.x).toBeCloseTo(0);
    expect(a.z).toBeGreaterThan(RADIO); // ante la puerta, por fuera
    // ya alineado ante la puerta: pasa al interior
    const b = desvioPorPuerta(0, 0, 0, { x: 0.5, z: RADIO + 5 }, { x: 0, z: 0 })!;
    expect(b.z).toBeLessThan(RADIO);
  });

  it('desde dentro, se alinea con la puerta y sale', () => {
    const a = desvioPorPuerta(0, 0, 0, { x: -3, z: -2 }, { x: 40, z: 40 })!;
    expect(a.z).toBeLessThan(RADIO);
    const b = desvioPorPuerta(0, 0, 0, { x: 0, z: RADIO - 4 }, { x: 40, z: 40 })!;
    expect(b.z).toBeGreaterThan(RADIO);
  });
});
