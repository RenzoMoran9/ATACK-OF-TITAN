import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { alcanceIK, baseCuerpo, ikDosHuesos, muelle, varianteImpulso } from './poses';

describe('muelle', () => {
  it('converge al objetivo y es estable con dt grande', () => {
    const m = { x: 0, v: 0 };
    for (let i = 0; i < 120; i++) muelle(m, 1, 14, 0.5, 1 / 30);
    expect(m.x).toBeCloseTo(1, 3);
    expect(Math.abs(m.v)).toBeLessThan(1e-2);
  });
  it('subamortiguado rebasa el objetivo (rebote)', () => {
    const m = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 60; i++) {
      muelle(m, 1, 12, 0.3, 1 / 60);
      max = Math.max(max, m.x);
    }
    expect(max).toBeGreaterThan(1.05);
  });
});

describe('ikDosHuesos', () => {
  it('la flexión resultante alcanza la distancia pedida', () => {
    for (const h of [0.5, 0.7, 0.84]) {
      const { medio } = ikDosHuesos(0.45, 0.4, h);
      expect(alcanceIK(0.45, 0.4, medio)).toBeCloseTo(h, 4);
    }
  });
  it('estirada del todo, la articulación media no se dobla', () => {
    expect(ikDosHuesos(0.45, 0.4, 2).medio).toBeLessThan(0.05);
  });
});

describe('baseCuerpo', () => {
  it('devuelve una base ortonormal con izq × eje = frente', () => {
    const b = baseCuerpo(new THREE.Vector3(0.3, 1, 0.2), new THREE.Vector3(5, 1, 8), new THREE.Vector3(0, 0, 1));
    expect(b.izq.length()).toBeCloseTo(1, 6);
    expect(b.eje.dot(b.frente)).toBeCloseTo(0, 6);
    expect(b.izq.dot(b.eje)).toBeCloseTo(0, 6);
    expect(new THREE.Vector3().crossVectors(b.izq, b.eje).distanceTo(b.frente)).toBeCloseTo(0, 6);
  });
  it('sin velocidad usa el frente anterior', () => {
    const b = baseCuerpo(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
    expect(b.frente.x).toBeCloseTo(1, 6);
  });
});

describe('varianteImpulso', () => {
  const frente = new THREE.Vector3(0, 0, 1);
  const izq = new THREE.Vector3(1, 0, 0);
  it('elige por el ángulo con el frente', () => {
    expect(varianteImpulso(new THREE.Vector3(0, 0.1, 1).normalize(), frente, izq)).toBe('delante');
    expect(varianteImpulso(new THREE.Vector3(0, 0, -1), frente, izq)).toBe('atras');
    expect(varianteImpulso(new THREE.Vector3(1, 0, 0), frente, izq)).toBe('izquierda');
    expect(varianteImpulso(new THREE.Vector3(-1, 0, 0), frente, izq)).toBe('derecha');
    expect(varianteImpulso(new THREE.Vector3(0, 1, 0), frente, izq)).toBe('arriba');
  });
});
