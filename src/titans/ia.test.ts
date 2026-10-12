import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { alcanceVista, enCono, girarHacia, giroMaximo, prioridad, velocidadAndar, velocidadPersecucion } from './ia';

describe('números de los titanes', () => {
  it('velocidades de la investigación', () => {
    expect(velocidadAndar(15)).toBeCloseTo(3.5, 6);
    expect(velocidadPersecucion(3)).toBeCloseTo(4.15, 6);
    expect(velocidadPersecucion(15)).toBeCloseTo(10.75, 6);
  });
  it('los grandes giran peor', () => {
    expect(giroMaximo(15)).toBeLessThan(giroMaximo(3));
  });
  it('de noche ven la mitad', () => {
    expect(alcanceVista(10, true)).toBeCloseTo(alcanceVista(10, false) / 2, 6);
  });
});

describe('enCono', () => {
  const frente = new THREE.Vector3(0, 0, 1);
  it('ve de frente y a 60° de lado, no a 100°', () => {
    expect(enCono(frente, new THREE.Vector3(0, 0, 1))).toBe(true);
    expect(enCono(frente, new THREE.Vector3(Math.sin(1.05), 0, Math.cos(1.05)))).toBe(true);
    expect(enCono(frente, new THREE.Vector3(Math.sin(1.75), 0, Math.cos(1.75)))).toBe(false);
  });
  it('mira hacia arriba más que hacia abajo', () => {
    expect(enCono(frente, new THREE.Vector3(0, Math.sin(0.9), Math.cos(0.9)))).toBe(true); // 52° arriba
    expect(enCono(frente, new THREE.Vector3(0, -Math.sin(0.9), Math.cos(0.9)))).toBe(false); // 52° abajo
  });
});

describe('prioridad', () => {
  it('prefiere multitudes y lo cercano', () => {
    expect(prioridad(20, 4)).toBeGreaterThan(prioridad(20, 0));
    expect(prioridad(10, 0)).toBeGreaterThan(prioridad(40, 0));
  });
  it('el cebo atrae el doble', () => {
    expect(prioridad(20, 0, { cebo: true })).toBeCloseTo(2 * prioridad(20, 0), 6);
  });
});

describe('girarHacia', () => {
  it('limita el giro y toma el camino corto', () => {
    expect(girarHacia(0, 1, 0.2)).toBeCloseTo(0.2, 6);
    expect(girarHacia(3, -3, 0.5)).toBeGreaterThan(3); // cruzando ±π
  });
});
