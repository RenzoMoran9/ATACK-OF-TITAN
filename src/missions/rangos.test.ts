import { describe, expect, it } from 'vitest';
import { RANGOS, indiceRango, meritos, textoRango } from './rangos';

describe('rangos', () => {
  it('cuenta los méritos de cada hazaña', () => {
    expect(meritos({ titanes: 0, jefes: 0, defensas: 0, asaltos: 0 })).toBe(0);
    expect(meritos({ titanes: 17, jefes: 1, defensas: 2, asaltos: 1, asaltosLimpios: 1 })).toBe(2 + 3 + 4 + 5 + 2);
  });

  it('sube de rango al llegar a los méritos de cada uno', () => {
    expect(RANGOS[indiceRango(0)].nombre).toBe('Recluta');
    expect(RANGOS[indiceRango(4)].nombre).toBe('Recluta');
    expect(RANGOS[indiceRango(5)].nombre).toBe('Soldado');
    expect(RANGOS[indiceRango(999)].nombre).toBe('Comandante');
  });

  it('cada rango mejora (o mantiene) el equipo del anterior', () => {
    for (let i = 1; i < RANGOS.length; i++) {
      const a = RANGOS[i - 1].mejoras;
      const b = RANGOS[i].mejoras;
      expect(b.gas).toBeGreaterThanOrEqual(a.gas);
      expect(b.desgaste).toBeLessThanOrEqual(a.desgaste);
      expect(b.repuesto).toBeGreaterThanOrEqual(a.repuesto);
      expect(b.bengalas).toBeGreaterThanOrEqual(a.bengalas);
      expect(b.lanzas).toBeGreaterThanOrEqual(a.lanzas);
      expect(RANGOS[i].meritos).toBeGreaterThan(RANGOS[i - 1].meritos);
    }
  });

  it('dice cuánto falta para el siguiente', () => {
    expect(textoRango(14)).toBe('Veterano (14/22 méritos)');
    expect(textoRango(60)).toBe('Comandante (60 méritos)');
  });
});
