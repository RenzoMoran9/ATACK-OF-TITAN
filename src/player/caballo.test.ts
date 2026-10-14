import { describe, expect, it } from 'vitest';
import { VELOCIDAD_GALOPE, VELOCIDAD_TROTE, giroCaballo, velocidadObjetivo } from './caballo';

describe('caballo', () => {
  it('trote con WASD, galope con Shift, parado sin pulsar', () => {
    expect(velocidadObjetivo(false, true)).toBe(0);
    expect(velocidadObjetivo(true, false)).toBe(VELOCIDAD_TROTE);
    expect(velocidadObjetivo(true, true)).toBe(VELOCIDAD_GALOPE);
  });
  it('gira peor al galope', () => {
    expect(giroCaballo(VELOCIDAD_GALOPE)).toBeLessThan(giroCaballo(0));
  });
});
