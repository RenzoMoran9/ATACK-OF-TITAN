import { describe, expect, it } from 'vitest';
import { aLienzo, aMundo, arrastrar, coordenadas, distancia, leerCoordenadas, pasoCuadricula, rumbo, zoomEn } from './logicaMapa';

describe('mapa interactivo', () => {
  const v = { cx: 100, cz: -200, k: 0.5, ancho: 800, alto: 600 };

  it('pasa del mundo al lienzo y vuelve', () => {
    expect(aLienzo(v, 100, -200)).toEqual({ px: 400, py: 300 });
    const p = aLienzo(v, 300, 0);
    expect(aMundo(v, p.px, p.py)).toEqual({ x: 300, z: 0 });
  });

  it('el zoom deja quieto el punto bajo el dedo', () => {
    const antes = aMundo(v, 650, 120);
    const w = zoomEn(v, 2, 650, 120, 0.1, 8);
    expect(w.k).toBe(1);
    const despues = aMundo(w, 650, 120);
    expect(despues.x).toBeCloseTo(antes.x);
    expect(despues.z).toBeCloseTo(antes.z);
    expect(zoomEn(v, 100, 0, 0, 0.1, 8).k).toBe(8);
  });

  it('arrastrar mueve el mapa con el dedo', () => {
    const w = arrastrar(v, 50, -20);
    expect(w.cx).toBe(0);
    expect(w.cz).toBe(-160);
  });

  it('escribe distancias, rumbos y coordenadas', () => {
    expect(distancia(850.4)).toBe('850 m');
    expect(distancia(1340)).toBe('1,3 km');
    expect(rumbo(0, -10)).toBe('al norte');
    expect(rumbo(10, 10)).toBe('al sureste');
    expect(coordenadas(120.4, -340)).toBe('x 120 · z −340');
  });

  it('lee coordenadas escritas de varias formas', () => {
    expect(leerCoordenadas('120, -340')).toEqual({ x: 120, z: -340 });
    expect(leerCoordenadas('x 120 · z −340')).toEqual({ x: 120, z: -340 });
    expect(leerCoordenadas('1200 450,5')).toEqual({ x: 1200, z: 450.5 });
    expect(leerCoordenadas('hola')).toBeNull();
  });

  it('la cuadrícula se adapta al zoom', () => {
    expect(pasoCuadricula(0.2)).toBe(500);
    expect(pasoCuadricula(2)).toBe(50);
  });
});
