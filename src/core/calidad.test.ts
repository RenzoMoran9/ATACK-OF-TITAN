import { describe, expect, it } from 'vitest';
import { ETIQUETA_MODO, MODOS_GRAFICOS, PERFILES, ajustarResolucion, Calidad, modoGuardado } from './calidad';

describe('calidad adaptable', () => {
  it('con pocas imágenes por segundo baja la resolución y, en el mínimo, pide bajar de nivel', () => {
    const p = PERFILES.media;
    const r1 = ajustarResolucion(25, 1, p);
    expect(r1.resolucion).toBeLessThan(1);
    expect(r1.bajarNivel).toBe(false);
    const r2 = ajustarResolucion(40, p.resolucionMin, p);
    expect(r2.bajarNivel).toBe(true);
  });

  it('con potencia de sobra sube la resolución hasta el tope del nivel', () => {
    const p = PERFILES.media;
    expect(ajustarResolucion(60, 0.8, p).resolucion).toBeCloseTo(0.85, 6);
    expect(ajustarResolucion(60, p.resolucionMax, p).resolucion).toBe(p.resolucionMax);
  });

  it('en automático, un celular lento termina en «Bajo» (sin sombras)', () => {
    const c = new Calidad('auto', 'media', 2.6, () => undefined);
    for (let i = 0; i < 2000; i++) c.medir(0.05, true);
    expect(c.nivel).toBe('baja');
    expect(c.perfil.sombras).toBe(false);
    expect(c.resolucion).toBeCloseTo(PERFILES.baja.resolucionMin, 6);
    expect(c.modo).toBe('auto');
  });

  it('un nivel fijo no cambia nada por su cuenta, aunque vaya a pocas imágenes', () => {
    const c = new Calidad('media', 'alta', 2.6, () => undefined);
    const resolucion = c.resolucion;
    for (let i = 0; i < 2000; i++) c.medir(0.05, true);
    expect(c.nivel).toBe('media');
    expect(c.resolucion).toBe(resolucion);
  });

  it('elegir un nivel desde automático lo deja fijo; volver a automático adapta desde ese nivel', () => {
    const c = new Calidad('auto', 'media', 2, () => undefined);
    c.fijar('alta');
    expect(c.modo).toBe('alta');
    expect(c.nivel).toBe('alta');
    const resolucion = c.resolucion;
    for (let i = 0; i < 2000; i++) c.medir(0.05, true);
    expect(c.resolucion).toBe(resolucion);
    c.fijar('auto');
    expect(c.modo).toBe('auto');
    expect(c.nivel).toBe('alta');
    for (let i = 0; i < 4000; i++) c.medir(0.05, true);
    expect(c.nivel).toBe('baja');
  });

  it('ofrece automático, alto, medio y bajo, con esos nombres', () => {
    expect(MODOS_GRAFICOS).toEqual(['auto', 'alta', 'media', 'baja']);
    expect(ETIQUETA_MODO).toEqual({ auto: 'Automático', alta: 'Alto', media: 'Medio', baja: 'Bajo' });
  });

  it('sin una elección guardada, no hay modo guardado', () => {
    expect(modoGuardado()).toBeNull();
  });
});
