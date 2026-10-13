import { describe, expect, it } from 'vitest';
import { Aguante } from './aguante';

describe('Aguante', () => {
  it('correr lo gasta y, al parar, se recupera tras una pausa', () => {
    const a = new Aguante();
    a.paso(1, true);
    expect(a.nivel).toBeCloseTo(100 - Aguante.GASTO_CARRERA, 6);
    a.paso(0.5, false); // aún en la pausa
    expect(a.nivel).toBeCloseTo(80, 6);
    a.paso(0.5, false);
    expect(a.nivel).toBeGreaterThan(80);
  });

  it('vaciarlo deja agotado hasta recuperar el umbral', () => {
    const a = new Aguante();
    for (let i = 0; i < 51; i++) a.paso(0.1, true);
    expect(a.nivel).toBe(0);
    expect(a.agotado).toBe(true);
    expect(a.puedeCorrer).toBe(false);
    // intentar correr agotado no gasta: se recupera igual
    for (let i = 0; i < 20; i++) a.paso(0.1, true);
    expect(a.nivel).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) a.paso(0.1, false);
    expect(a.agotado).toBe(false);
    expect(a.puedeCorrer).toBe(true);
  });

  it('saltar cuesta aguante y sin él el salto es más bajo', () => {
    const a = new Aguante();
    expect(a.saltar()).toBe(1);
    expect(a.nivel).toBe(100 - Aguante.COSTE_SALTO);
    a.nivel = 0;
    expect(a.saltar()).toBeCloseTo(0.65, 6);
  });
});
