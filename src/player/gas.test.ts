import { describe, expect, it } from 'vitest';
import { DepositoGas } from './gas';

describe('DepositoGas', () => {
  it('empieza lleno', () => {
    const g = new DepositoGas(100);
    expect(g.nivel).toBe(100);
    expect(g.fraccion).toBe(1);
    expect(g.vacio).toBe(false);
  });

  it('cobra los costes puntuales solo si hay gas suficiente (sin gas no salen ganchos)', () => {
    const g = new DepositoGas(10);
    expect(g.consumir(4)).toBe(true);
    expect(g.nivel).toBe(6);
    expect(g.consumir(7)).toBe(false);
    expect(g.nivel).toBe(6);
  });

  it('el consumo continuo es proporcional al tiempo', () => {
    const g = new DepositoGas(100);
    expect(g.consumirContinuo(10, 0.5)).toBe(1);
    expect(g.nivel).toBeCloseTo(95, 6);
  });

  it('el consumo continuo devuelve la fracción servida al vaciarse y no baja de 0', () => {
    const g = new DepositoGas(100);
    g.nivel = 1;
    expect(g.consumirContinuo(4, 0.5)).toBeCloseTo(0.5, 6);
    expect(g.nivel).toBe(0);
    expect(g.vacio).toBe(true);
    expect(g.consumirContinuo(4, 0.5)).toBe(0);
  });

  it('recargar no supera la capacidad', () => {
    const g = new DepositoGas(100);
    g.nivel = 90;
    g.recargar(50);
    expect(g.nivel).toBe(100);
  });
});
