import { describe, expect, it } from 'vitest';
import { AMPLITUD_MAXIMA, DESFASES, cascoDe, ikPata, marcha, pata, velocidadCasco } from './marchaCaballo';

const L = 1.2;

describe('marcha del caballo', () => {
  it('el casco apoyado va justo a la velocidad del suelo: no patina', () => {
    for (const v of [0.8, 1.8, 4, 6, 9, 12, 16]) {
      const m = marcha(v, L);
      expect(velocidadCasco(m, L)).toBeCloseTo(v, 6);
      expect(m.amplitud).toBeLessThanOrEqual(AMPLITUD_MAXIMA + 1e-9);
    }
  });

  it('dentro del apoyo, el casco avanza en línea recta y a ritmo constante', () => {
    const m = marcha(6, L);
    const xs = [0, 0.25, 0.5, 0.75, 0.999].map((k) => L * Math.sin(pata(k * m.apoyo, m.apoyo, m.amplitud).muslo));
    const pasos = xs.slice(1).map((x, i) => x - xs[i]);
    for (const d of pasos) expect(d).toBeCloseTo(pasos[0], 2);
  });

  it('cambia de andar con la velocidad', () => {
    expect(marcha(1.5, L).desfases).toEqual(DESFASES.paso);
    expect(marcha(6, L).desfases.map((x) => +x.toFixed(6))).toEqual([...DESFASES.trote]);
    expect(marcha(15, L).galope).toBe(1);
    expect(marcha(15, L).apoyo).toBeLessThan(marcha(6, L).apoyo);
  });

  it('al galope da más zancadas por segundo que al paso, pero con cabeza', () => {
    expect(marcha(16, L).frecuencia).toBeGreaterThan(marcha(1.8, L).frecuencia);
    expect(marcha(16, L).frecuencia).toBeLessThan(3.2);
  });

  it('parado y girando, da pasitos', () => {
    expect(marcha(0, L, 2).amplitud).toBeGreaterThan(0.1);
    expect(marcha(0, L).amplitud).toBe(0);
  });

  it('la pata en el aire vuelve adelante con la rodilla recogida', () => {
    const m = marcha(6, L);
    const medio = pata(m.apoyo + (1 - m.apoyo) / 2, m.apoyo, m.amplitud);
    expect(medio.apoyada).toBe(false);
    expect(medio.flexion).toBeCloseTo(1, 5);
  });

  it('la IK de la pata deja el casco justo donde se le pide', () => {
    for (const signo of [1, -1] as const) {
      for (const [atras, abajo] of [[0, 1.1], [0.4, 1.1], [-0.5, 1.15], [0.2, 0.9]]) {
        const { cadera, rodilla } = ikPata(atras, abajo, 0.68, 0.64, signo);
        const c = cascoDe(cadera, rodilla, 0.68, 0.64);
        expect(c.atras).toBeCloseTo(atras, 6);
        expect(c.abajo).toBeCloseTo(abajo, 6);
        expect(Math.sign(rodilla) === signo || rodilla === 0).toBe(true);
      }
    }
  });

  it('si la pata no llega, el casco queda justo encima del punto (no resbala)', () => {
    const { cadera, rodilla } = ikPata(0.6, 1.3, 0.68, 0.64, 1);
    const c = cascoDe(cadera, rodilla, 0.68, 0.64);
    expect(c.atras).toBeCloseTo(0.6, 6);
    expect(c.abajo).toBeLessThan(1.3);
  });
});
