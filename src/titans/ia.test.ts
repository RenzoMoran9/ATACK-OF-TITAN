import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { alcanceSalto, alcanceVista, distanciaCuerpos, enCono, galope, girarHacia, giroCuadrupedo, giroMaximo, prioridad, velocidadAndar, velocidadCuadrupedo, velocidadPersecucion } from './ia';

describe('separación entre titanes', () => {
  // medido con cuerpos reales (Rapier): dos titanes iguales se tocan a 2,3 / 4,6 / 6,8 m
  it('la distancia mínima de la IA supera el contacto medido de los cuerpos', () => {
    expect(distanciaCuerpos(5, 5)).toBeGreaterThan(2.3);
    expect(distanciaCuerpos(10, 10)).toBeGreaterThan(4.6);
    expect(distanciaCuerpos(15, 15)).toBeGreaterThan(6.8);
  });
});

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

describe('anormal a cuatro patas', () => {
  it('corre mucho más que un bípedo y tiene tope', () => {
    expect(velocidadCuadrupedo(4)).toBeCloseTo(13.6, 6);
    expect(velocidadCuadrupedo(10)).toBeCloseTo(25, 6);
    expect(velocidadCuadrupedo(15)).toBe(28);
    for (const H of [4, 7, 10, 12]) expect(velocidadCuadrupedo(H)).toBeGreaterThan(2 * velocidadPersecucion(H));
  });
  it('gira mejor y salta desde lejos', () => {
    expect(giroCuadrupedo(8)).toBeCloseTo(2 * giroMaximo(8), 6);
    expect(alcanceSalto(10)).toBeCloseTo(12, 6);
  });
  it('galope: la pata apoyada no patina', () => {
    for (const [v, H] of [[25, 10], [13, 4], [3, 8]] as const) {
      const { zancada, frecuencia } = galope(v, H);
      // lo que avanza el cuerpo durante el apoyo (0,45 del ciclo) = zancada
      expect((v * 0.45) / frecuencia).toBeLessThanOrEqual(zancada + 1e-9);
      expect(zancada).toBeLessThanOrEqual(0.5 * H + 1e-9);
    }
  });
  it('parado no hay zancada que valga más de un 2 % de H', () => {
    expect(galope(0, 10).zancada).toBeCloseTo(0.2, 6);
  });
});
