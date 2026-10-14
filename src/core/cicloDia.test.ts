import { describe, expect, it } from 'vitest';
import { CicloDia, calidez, elevacionSol, esDeNoche, factorNoche, textoHora, velocidadHora } from './cicloDia';

describe('ciclo de día y noche', () => {
  it('el sol sale a las 6, culmina a mediodía y se pone a las 19', () => {
    expect(elevacionSol(6)).toBeCloseTo(0, 5);
    expect(elevacionSol(19)).toBeCloseTo(0, 5);
    expect(elevacionSol(12.5)).toBeGreaterThan(60);
    expect(elevacionSol(0)).toBeLessThan(-30);
  });

  it('la elevación es continua alrededor del amanecer y del anochecer', () => {
    for (const h of [6, 19]) expect(Math.abs(elevacionSol(h + 0.01) - elevacionSol(h - 0.01))).toBeLessThan(0.5);
  });

  it('noche y día', () => {
    expect(esDeNoche(23)).toBe(true);
    expect(esDeNoche(3)).toBe(true);
    expect(esDeNoche(12)).toBe(false);
    expect(factorNoche(12)).toBe(0);
    expect(factorNoche(1)).toBe(1);
    expect(calidez(18.7)).toBeGreaterThan(0.6);
    expect(calidez(12)).toBe(0);
  });

  it('de noche el reloj corre al doble', () => {
    expect(velocidadHora(23)).toBeCloseTo(2 * velocidadHora(12));
  });

  it('el reloj pasa de día al llegar a medianoche', () => {
    const c = new CicloDia();
    c.hora = 23.99;
    expect(c.avanzar(5)).toBe(true);
    expect(c.dia).toBe(2);
    expect(c.hora).toBeLessThan(1);
  });

  it('texto de la hora', () => {
    expect(textoHora(7.5)).toBe('07:30');
    expect(textoHora(24.25)).toBe('00:15');
  });
});
