import { describe, expect, it } from 'vitest';
import { Cuchillas } from './cuchillas';

describe('Cuchillas', () => {
  it('empieza con el par montado nuevo y 4 de repuesto', () => {
    const c = new Cuchillas();
    expect(c.filo).toBe(1);
    expect(c.repuesto).toBe(4);
    expect(c.puedeCortar).toBe(true);
  });

  it('se mella por debajo del 30 % y se rompe a 0', () => {
    const c = new Cuchillas();
    expect(c.desgastar(0.75)).toBe(false);
    expect(c.mellada).toBe(true);
    expect(c.desgastar(0.5)).toBe(true);
    expect(c.rota).toBe(true);
    expect(c.puedeCortar).toBe(false);
  });

  it('cambiar de par tarda 0,6 s, gasta un repuesto y deja el filo nuevo', () => {
    const c = new Cuchillas();
    c.desgastar(1);
    expect(c.empezarCambio()).toBe(true);
    expect(c.puedeCortar).toBe(false);
    expect(c.actualizar(0.3)).toBe(false);
    expect(c.actualizar(0.31)).toBe(true);
    expect(c.filo).toBe(1);
    expect(c.repuesto).toBe(3);
  });

  it('sin repuestos no se puede cambiar; el depósito lo rellena todo', () => {
    const c = new Cuchillas();
    c.repuesto = 0;
    expect(c.empezarCambio()).toBe(false);
    c.desgastar(1);
    c.rellenar();
    expect(c.repuesto).toBe(4);
    expect(c.filo).toBe(1);
  });
});
