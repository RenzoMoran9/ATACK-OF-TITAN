import { describe, expect, it } from 'vitest';
import { ajustarResolucion, Calidad, PERFILES } from './calidad';

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

  it('un celular lento termina en «Fluida» (sin sombras)', () => {
    const aplicados: string[] = [];
    const c = new Calidad('media', 2.6, (perfil) => aplicados.push(perfil.etiqueta));
    // 20 fps durante un buen rato
    for (let i = 0; i < 2000; i++) c.medir(0.05, true);
    expect(c.nivel).toBe('baja');
    expect(c.perfil.sombras).toBe(false);
    expect(c.resolucion).toBeCloseTo(PERFILES.baja.resolucionMin, 6);
  });

  it('elegir un nivel a mano desactiva el cambio automático de nivel', () => {
    const c = new Calidad('media', 2, () => undefined);
    c.fijar('alta');
    for (let i = 0; i < 2000; i++) c.medir(0.05, true);
    expect(c.nivel).toBe('alta');
    expect(c.auto).toBe(false);
  });
});
