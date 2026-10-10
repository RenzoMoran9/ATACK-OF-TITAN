import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PuntoDebil } from '../core/tipos';
import { UMBRALES, calcularDanio, desgaste, zonaAlAlcance } from './corte';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const punto = (zona: PuntoDebil['zona'], centro: THREE.Vector3, radio = 0.5, activo = true): PuntoDebil => ({ zona, centro, radio, normal: v(0, 0, -1), activo });

describe('calcularDanio', () => {
  it('un pase rápido de frente contra la nuca supera el umbral de muerte', () => {
    const { danio } = calcularDanio({ velocidadRelativa: v(0, 0, 25), normal: v(0, 0, -1), filo: 1, zona: 'nuca' });
    expect(danio).toBeGreaterThanOrEqual(UMBRALES.nuca);
  });

  it('el mismo pase lento solo hiere', () => {
    const { danio } = calcularDanio({ velocidadRelativa: v(0, 0, 8), normal: v(0, 0, -1), filo: 1, zona: 'nuca' });
    expect(danio).toBeLessThan(UMBRALES.nuca);
  });

  it('rozar de lado hace menos daño que entrar de frente', () => {
    const frente = calcularDanio({ velocidadRelativa: v(0, 0, 20), normal: v(0, 0, -1), filo: 1, zona: 'nuca' });
    const lado = calcularDanio({ velocidadRelativa: v(20, 0, 0), normal: v(0, 0, -1), filo: 1, zona: 'nuca' });
    expect(lado.danio).toBeLessThan(frente.danio);
    expect(lado.factorAngulo).toBeCloseTo(0.45, 5);
  });

  it('una cuchilla mellada corta menos', () => {
    const nueva = calcularDanio({ velocidadRelativa: v(0, 0, 20), normal: v(0, 0, -1), filo: 1, zona: 'nuca' });
    const mellada = calcularDanio({ velocidadRelativa: v(0, 0, 20), normal: v(0, 0, -1), filo: 0.1, zona: 'nuca' });
    expect(mellada.danio).toBeLessThan(nueva.danio * 0.5);
  });

  it('sin velocidad no hay daño', () => {
    expect(calcularDanio({ velocidadRelativa: v(0, 0, 0), normal: v(0, 0, -1), filo: 1, zona: 'nuca' }).danio).toBe(0);
  });
});

describe('desgaste', () => {
  it('la nuca mella más que los ojos y más daño mella más', () => {
    expect(desgaste('nuca', 20)).toBeGreaterThan(desgaste('ojos', 20));
    expect(desgaste('nuca', 30)).toBeGreaterThan(desgaste('nuca', 5));
  });
});

describe('zonaAlAlcance', () => {
  it('prioriza la nuca si está al alcance aunque otra zona esté más cerca', () => {
    const puntos = [punto('brazoIzq', v(0, 0, 0.5)), punto('nuca', v(0, 0, 1.6))];
    expect(zonaAlAlcance(v(0, 0, 0), 1.5, puntos)?.zona).toBe('nuca');
  });

  it('ignora zonas inactivas (regenerándose) y las que están fuera de alcance', () => {
    const puntos = [punto('nuca', v(0, 0, 1), 0.5, false), punto('ojos', v(0, 0, 10))];
    expect(zonaAlAlcance(v(0, 0, 0), 1.5, puntos)).toBeNull();
  });
});
