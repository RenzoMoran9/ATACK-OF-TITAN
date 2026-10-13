import { describe, expect, it } from 'vitest';
import { ANCHO_ZONA, NUM_POSTES, RADIO_CERCO, aguja, avanceGolpe, calidadGolpe, enAlambre, nuevaZona, puntosCerco, repartirObras } from './logicaCampamento';

describe('martillo', () => {
  it('la aguja va y viene entre 0 y 1', () => {
    for (let t = 0; t < 3; t += 0.01) {
      expect(aguja(t)).toBeGreaterThanOrEqual(0);
      expect(aguja(t)).toBeLessThanOrEqual(1);
    }
  });
  it('en el centro de la zona es perfecto, en el borde bueno y fuera fallo', () => {
    expect(calidadGolpe(0.5, 0.5)).toBe('perfecto');
    expect(calidadGolpe(0.5 + ANCHO_ZONA * 0.45, 0.5)).toBe('bueno');
    expect(calidadGolpe(0.5 + ANCHO_ZONA, 0.5)).toBe('fallo');
  });
  it('perfecto clava el poste de una vez; bueno en tres; fallar casi no avanza', () => {
    expect(avanceGolpe('perfecto')).toBe(1);
    expect(3 * avanceGolpe('bueno')).toBeGreaterThanOrEqual(1);
    expect(avanceGolpe('fallo')).toBeLessThan(0.1);
  });
  it('la zona verde siempre cabe en la barra', () => {
    let k = 0;
    const azar = () => [0, 0.999, 0.5][k++ % 3];
    for (let i = 0; i < 3; i++) {
      const z = nuevaZona(azar);
      expect(z - ANCHO_ZONA / 2).toBeGreaterThanOrEqual(0);
      expect(z + ANCHO_ZONA / 2).toBeLessThanOrEqual(1);
    }
  });
});

describe('cerco de alambre', () => {
  const todos = Array(NUM_POSTES).fill(true);
  it('los postes forman un anillo', () => {
    const p = puntosCerco(10, 20);
    expect(p).toHaveLength(NUM_POSTES);
    for (const q of p) expect(Math.hypot(q.x - 10, q.z - 20)).toBeCloseTo(RADIO_CERCO);
  });
  it('un titán sobre el alambre se enreda; dentro o lejos, no', () => {
    expect(enAlambre(RADIO_CERCO + 0.5, 0.3, 0, 0, todos)).toBe(true);
    expect(enAlambre(2, 0, 0, 0, todos)).toBe(false);
    expect(enAlambre(RADIO_CERCO + 10, 0, 0, 0, todos)).toBe(false);
  });
  it('sin los dos postes del tramo no hay alambre', () => {
    const hechos = [...todos];
    hechos[0] = false;
    expect(enAlambre(RADIO_CERCO, 0.5, 0, 0, hechos)).toBe(false);
  });
});

describe('reparto del trabajo', () => {
  const obras = [
    { x: 0, z: 0, hecha: false },
    { x: 10, z: 0, hecha: false },
    { x: 20, z: 0, hecha: true },
  ];
  it('cada uno a la obra libre más cercana, sin repetir ni tocar la del jugador', () => {
    expect(repartirObras([{ x: 1, z: 0 }, { x: 2, z: 0 }], obras)).toEqual([0, 1]);
    expect(repartirObras([{ x: 1, z: 0 }], obras, 0)).toEqual([1]);
    expect(repartirObras([{ x: 1, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 0 }], obras)).toEqual([0, 1, -1]);
  });
});
