import { describe, expect, it } from 'vitest';
import { VELOCIDAD_ACELERADA, VELOCIDAD_GALOPE, VELOCIDAD_TROTE, alientoTras, giroCaballo, velocidadObjetivo } from './caballo';

describe('caballo', () => {
  it('trote con WASD, galope con Shift, parado sin pulsar', () => {
    expect(velocidadObjetivo(false, true)).toBe(0);
    expect(velocidadObjetivo(true, false)).toBe(VELOCIDAD_TROTE);
    expect(velocidadObjetivo(true, true)).toBe(VELOCIDAD_GALOPE);
  });
  it('acelerar con V va más rápido que el galope, pero no sin movimiento', () => {
    expect(velocidadObjetivo(true, true, true)).toBe(VELOCIDAD_ACELERADA);
    expect(VELOCIDAD_ACELERADA).toBeGreaterThan(VELOCIDAD_GALOPE);
    expect(velocidadObjetivo(false, false, true)).toBe(0);
  });
  it('el aliento se gasta acelerando, vuelve parado y nunca sale de 0–1', () => {
    expect(alientoTras(1, true, 1)).toBeLessThan(1);
    expect(alientoTras(1, false, 1)).toBe(1);
    expect(alientoTras(0.05, true, 10)).toBe(0);
    expect(alientoTras(0.5, false, 100)).toBe(1);
  });
  it('gira peor al galope', () => {
    expect(giroCaballo(VELOCIDAD_GALOPE)).toBeLessThan(giroCaballo(0));
  });
});
