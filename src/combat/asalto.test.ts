import { describe, expect, it } from 'vitest';
import { ATASCO_ASALTO, DISTANCIA_GOLPE_ASALTO, DURACION_ASALTO, MARGEN_CANCELAR, VELOCIDAD_CORTE_ASALTO, asaltoCancelado, asaltoFallido, cortaAhora, empiezaAsalto, empujeDeCorte } from './asalto';
import { VELOCIDAD_MINIMA } from './corte';

describe('ataque directo', () => {
  it('empieza con la parte marcada lejos y cuchillas útiles; de cerca, el tajo normal', () => {
    expect(empiezaAsalto(DISTANCIA_GOLPE_ASALTO + 5, true)).toBe(true);
    expect(empiezaAsalto(DISTANCIA_GOLPE_ASALTO - 1, true)).toBe(false);
    expect(empiezaAsalto(20, false)).toBe(false);
  });

  it('corta solo al llegar a la distancia de golpe, con cuchillas útiles', () => {
    expect(cortaAhora(DISTANCIA_GOLPE_ASALTO, true)).toBe(true);
    expect(cortaAhora(DISTANCIA_GOLPE_ASALTO + 0.1, true)).toBe(false);
    expect(cortaAhora(1, false)).toBe(false);
  });

  it('se cancela si no hay gancho clavado pasado un instante, pero no al principio', () => {
    expect(asaltoFallido(0.3, false)).toBe(false);
    expect(asaltoFallido(1, false)).toBe(true);
    expect(asaltoFallido(1, true)).toBe(false);
  });

  it('se acaba a los DURACION_ASALTO segundos aunque el gancho siga clavado', () => {
    expect(asaltoFallido(DURACION_ASALTO - 0.1, true)).toBe(false);
    expect(asaltoFallido(DURACION_ASALTO + 0.1, true)).toBe(true);
  });

  it('el corte llega al punto a la velocidad mínima aunque el jugador venga casi parado', () => {
    for (const hacia of [-4, 0, 3, 8, 15]) {
      const salida = hacia + empujeDeCorte(5.9, hacia);
      expect(salida).toBeGreaterThanOrEqual(VELOCIDAD_CORTE_ASALTO);
      expect(salida).toBeGreaterThan(VELOCIDAD_MINIMA);
    }
    // ya viene rápido: el empuje normal basta, no se añade más
    expect(empujeDeCorte(5.9, 15)).toBe(5.9);
  });
});

describe('salir del ataque directo', () => {
  it('Espacio, los ganchos o Q/E lo cancelan (pasado un instante)', () => {
    expect(asaltoCancelado(MARGEN_CANCELAR / 2, true)).toBe(false);
    expect(asaltoCancelado(MARGEN_CANCELAR + 0.05, true)).toBe(true);
    expect(asaltoCancelado(2, false)).toBe(false);
  });

  it('atascado sin acercarse (algo en medio), se suelta', () => {
    expect(asaltoFallido(1.5, true, ATASCO_ASALTO / 2)).toBe(false);
    expect(asaltoFallido(1.5, true, ATASCO_ASALTO + 0.1)).toBe(true);
  });

  it('nunca dura más de DURACION_ASALTO', () => {
    expect(asaltoFallido(DURACION_ASALTO + 0.1, true, 0)).toBe(true);
  });
});
