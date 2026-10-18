import { describe, expect, it } from 'vitest';
import { aguanteNuca } from '../titans/especiales';
import { umbralNuca } from './corte';
import { danioExplosion, danioLanzaNuca, parteMasCercana } from './logicaLanzas';

describe('lanzas relámpago', () => {
  it('matan a un titán normal de una lanza en la nuca', () => {
    for (const H of [3, 7, 15]) expect(danioLanzaNuca(H, null)).toBeGreaterThanOrEqual(umbralNuca(H));
  });

  it('a los cambiantes les hacen falta varias', () => {
    const lanzas = (H: number, e: 'acorazado' | 'colosal' | 'bestia') => Math.ceil((umbralNuca(H) * aguanteNuca(e)) / danioLanzaNuca(H, e));
    expect(lanzas(15, 'acorazado')).toBe(2);
    expect(lanzas(17, 'bestia')).toBe(2);
    expect(lanzas(60, 'colosal')).toBe(3);
  });

  it('la explosión hiere menos cuanto más lejos y nada a partir de 8 m', () => {
    expect(danioExplosion(0)).toBeCloseTo(45);
    expect(danioExplosion(4)).toBeCloseTo(22.5);
    expect(danioExplosion(8)).toBe(0);
  });

  it('se clava en la parte activa más cercana', () => {
    const p = (zona: 'nuca' | 'corvaIzq' | 'cuerpo', y: number, activo = true) => ({ zona, centro: { x: 0, y, z: 0 }, radio: 0.5, activo });
    const puntos = [p('nuca', 12), p('corvaIzq', 4), p('cuerpo', 8)];
    expect(parteMasCercana(puntos, { x: 0, y: 11, z: 0 }, 5)?.zona).toBe('nuca');
    expect(parteMasCercana(puntos, { x: 0, y: 5, z: 0 }, 5)?.zona).toBe('corvaIzq');
    expect(parteMasCercana(puntos, { x: 0, y: 8, z: 0 }, 2)).toBeNull();
    expect(parteMasCercana([p('nuca', 12, false)], { x: 0, y: 12, z: 0 }, 5)).toBeNull();
  });
});
