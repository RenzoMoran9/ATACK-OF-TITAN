import { describe, expect, it } from 'vitest';
import { ANCHO_ZONA, NUM_POSTES, RADIO_CERCO, aguja, anguloTramo, avanceGolpe, calidadGolpe, dentroEmpalizada, desvioPorPuerta, enAlambre, nuevaZona, puntosCerco, repartirObras, tramoDe } from './logicaCampamento';

const R = RADIO_CERCO;

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

describe('empalizada', () => {
  it('el tramo de un punto coincide con su ángulo central', () => {
    for (let i = 0; i < 12; i++) {
      const a = anguloTramo(i, 0.7);
      expect(tramoDe(Math.cos(a) * 10, Math.sin(a) * 10, 0, 0, 0.7)).toBe(i);
    }
  });

  it('dentro y fuera', () => {
    expect(dentroEmpalizada(0, 0, 0, 0)).toBe(true);
    expect(dentroEmpalizada(0, 0, R - 2, 0)).toBe(true);
    expect(dentroEmpalizada(0, 0, R + 1, 0)).toBe(false);
  });

  it('sin cruzar el muro no hay desvío', () => {
    expect(desvioPorPuerta(0, 0, 0, { x: 30, z: 30 }, { x: 40, z: 0 })).toBeNull();
    expect(desvioPorPuerta(0, 0, 0, { x: 1, z: 1 }, { x: -3, z: 2 })).toBeNull();
  });

  it('desde fuera se alinea ante la puerta y luego entra', () => {
    const a = anguloTramo(0, 0);
    const fuera = { x: -30, z: 5 };
    const p1 = desvioPorPuerta(0, 0, 0, fuera, { x: 0, z: 0 })!;
    expect(Math.hypot(p1.x, p1.z)).toBeGreaterThan(R);
    expect(Math.atan2(p1.z, p1.x)).toBeCloseTo(a, 3);
    const p2 = desvioPorPuerta(0, 0, 0, p1, { x: 0, z: 0 })!;
    expect(dentroEmpalizada(0, 0, p2.x, p2.z)).toBe(true);
  });

  it('desde dentro se alinea con la puerta y sale', () => {
    const p1 = desvioPorPuerta(0, 0, 0, { x: -5, z: -3 }, { x: 80, z: 80 })!;
    expect(dentroEmpalizada(0, 0, p1.x, p1.z)).toBe(true);
    const p2 = desvioPorPuerta(0, 0, 0, p1, { x: 80, z: 80 })!;
    expect(dentroEmpalizada(0, 0, p2.x, p2.z)).toBe(false);
  });
});
