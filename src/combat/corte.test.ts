import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PuntoDebil } from '../core/tipos';
import { calcularDanio, desgaste, umbralNuca, umbralZona, zonaAlAlcance } from './corte';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const punto = (zona: PuntoDebil['zona'], centro: THREE.Vector3, radio = 0.5, activo = true): PuntoDebil => ({ zona, centro, radio, normal: v(0, 0, -1), activo });

describe('umbrales', () => {
  it('la nuca de un titán de 15 m pide 300 y la de uno de 3 m, 180', () => {
    expect(umbralNuca(15)).toBe(300);
    expect(umbralNuca(3)).toBe(180);
  });
  it('un tendón pide el 35 % y un ojo el 20 % del umbral de la nuca', () => {
    expect(umbralZona('tendonIzq', 10)).toBeCloseTo(0.35 * 250, 6);
    expect(umbralZona('ojoDer', 10)).toBeCloseTo(50, 6);
  });
});

describe('calcularDanio', () => {
  it('una pasada horizontal rápida (perpendicular a la columna) mata a uno de 7 m', () => {
    const r = calcularDanio({ velocidadRelativa: v(0, 0, 25), filo: 1 });
    expect(r.factorAngulo).toBeCloseTo(1, 6);
    expect(r.danio).toBeGreaterThanOrEqual(umbralNuca(7));
  });

  it('la misma pasada a 15 m/s se queda en herida', () => {
    expect(calcularDanio({ velocidadRelativa: v(0, 0, 15), filo: 1 }).danio).toBeLessThan(umbralNuca(7));
  });

  it('cortar a lo largo de la columna rinde mucho menos que de través', () => {
    const traves = calcularDanio({ velocidadRelativa: v(20, 0, 0), filo: 1 });
    const largo = calcularDanio({ velocidadRelativa: v(0, -20, 0), filo: 1 });
    expect(largo.factorAngulo).toBeCloseTo(0.35, 6);
    expect(largo.danio).toBeLessThan(traves.danio * 0.5);
  });

  it('por debajo de 8 m/s rebota', () => {
    const r = calcularDanio({ velocidadRelativa: v(5, 0, 0), filo: 1 });
    expect(r.rebota).toBe(true);
    expect(r.danio).toBe(0);
  });

  it('mellada (<30 %) corta al 60 % y rota no corta', () => {
    const nueva = calcularDanio({ velocidadRelativa: v(20, 0, 0), filo: 1 }).danio;
    expect(calcularDanio({ velocidadRelativa: v(20, 0, 0), filo: 0.2 }).danio).toBeCloseTo(nueva * 0.6, 6);
    expect(calcularDanio({ velocidadRelativa: v(20, 0, 0), filo: 0 }).danio).toBe(0);
  });
});

describe('desgaste', () => {
  it('3 + D/50 puntos, el doble con mal ángulo, 5 si rebota', () => {
    expect(desgaste({ danio: 250, factorAngulo: 1, rebota: false })).toBeCloseTo(0.08, 6);
    expect(desgaste({ danio: 250, factorAngulo: 0.4, rebota: false })).toBeCloseTo(0.16, 6);
    expect(desgaste({ danio: 0, factorAngulo: 0, rebota: true })).toBeCloseTo(0.05, 6);
  });
});

describe('zonaAlAlcance', () => {
  it('prioriza la nuca si está al alcance aunque otra zona esté más cerca', () => {
    const puntos = [punto('brazoIzq', v(0, 0, 0.5)), punto('nuca', v(0, 0, 1.6))];
    expect(zonaAlAlcance(v(0, 0, 0), 1.5, puntos)?.zona).toBe('nuca');
  });
  it('ignora zonas inactivas y las que están fuera de alcance', () => {
    const puntos = [punto('nuca', v(0, 0, 1), 0.5, false), punto('ojoIzq', v(0, 0, 10))];
    expect(zonaAlAlcance(v(0, 0, 0), 1.5, puntos)).toBeNull();
  });
});
