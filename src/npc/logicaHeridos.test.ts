import { describe, expect, it } from 'vitest';
import { UMBRAL_CURADO, UMBRAL_HERIDO, encuentroPeligroso, estaHerido } from './logicaHeridos';

describe('heridos', () => {
  it('se retira por debajo del 40 % y no antes', () => {
    expect(estaHerido(0.39, false)).toBe(true);
    expect(estaHerido(0.5, false)).toBe(false);
  });

  it('no vuelve a la línea hasta el 85 % (histéresis: no oscila en el umbral)', () => {
    expect(estaHerido(0.5, true)).toBe(true);
    expect(estaHerido(UMBRAL_CURADO - 0.01, true)).toBe(true);
    expect(estaHerido(UMBRAL_CURADO, true)).toBe(false);
  });

  it('los umbrales dejan sitio para la histéresis', () => {
    expect(UMBRAL_HERIDO).toBeLessThan(UMBRAL_CURADO);
  });
});

describe('encuentro peligroso', () => {
  it('con tres o más titanes cerca salen huyendo; con menos, aguantan', () => {
    expect(encuentroPeligroso(2)).toBe(false);
    expect(encuentroPeligroso(3)).toBe(true);
  });
});
