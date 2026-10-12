import { describe, expect, it } from 'vitest';
import { aceptarSitio, clasificarZona, debeRetirar, elegirTitan, REGLAS } from './poblador';

const bosque = { contiene: (x: number, z: number) => Math.hypot(x - 1000, z - 1000) < 200 };

/** Generador determinista para los recuentos. */
function rng(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('poblador de titanes', () => {
  it('clasifica bosque, muralla y llanura', () => {
    expect(clasificarZona(1000, 1050, [bosque])).toBe('bosque');
    expect(clasificarZona(0, 300, [bosque])).toBe('muralla');
    expect(clasificarZona(-1200, 1800, [bosque])).toBe('llanura');
  });
  it('en los bosques salen sobre todo anormales y cuadrúpedos', () => {
    const azar = rng(7);
    let cuadrupedos = 0;
    let anormales = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const t = elegirTitan('bosque', azar);
      if (t.cuadrupedo) cuadrupedos++;
      if (t.anormal) anormales++;
      if (t.cuadrupedo) expect(t.anormal).toBe(true);
    }
    expect(cuadrupedos / n).toBeGreaterThan(0.35);
    expect(cuadrupedos / n).toBeLessThan(0.45);
    expect(anormales / n).toBeGreaterThan(0.65);
  });
  it('fuera de los bosques no hay cuadrúpedos', () => {
    const azar = rng(3);
    for (let i = 0; i < 500; i++) {
      expect(elegirTitan('llanura', azar).cuadrupedo).toBe(false);
      expect(elegirTitan('muralla', azar).cuadrupedo).toBe(false);
    }
  });
  it('el bosque es la zona más densa y respeta su tope', () => {
    expect(REGLAS.bosque.densidad).toBeGreaterThan(REGLAS.llanura.densidad * 2);
    expect(aceptarSitio('bosque', REGLAS.bosque.tope, () => 0)).toBe(false);
    expect(aceptarSitio('bosque', 0, () => 0.5)).toBe(true);
  });
  it('solo retira a los lejanos que no persiguen a nadie', () => {
    expect(debeRetirar(1500, false)).toBe(true);
    expect(debeRetirar(1500, true)).toBe(false);
    expect(debeRetirar(300, false)).toBe(false);
  });
});
