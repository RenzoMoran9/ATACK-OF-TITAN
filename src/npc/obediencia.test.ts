import { describe, expect, it } from 'vitest';
import { puedeRescatar } from './logicaOrdenes';

describe('obediencia: rescates', () => {
  it('sin orden tuya, el soldado rescata a quien esté agarrado', () => {
    expect(puedeRescatar('seguir', false, false)).toBe(true);
    expect(puedeRescatar('esperar', false, false)).toBe(true);
  });

  it('con una orden tuya, no deja su puesto para rescatar a nadie (ni a ti) salvo lo que incluye la orden', () => {
    expect(puedeRescatar('esperar', true, false)).toBe(false);
    expect(puedeRescatar('irA', true, false)).toBe(false);
    expect(puedeRescatar('proteger', true, false)).toBe(false);
    expect(puedeRescatar('explorar', true, false)).toBe(false);
    expect(puedeRescatar('retirada', true, false)).toBe(false);
    expect(puedeRescatar('atacarTitan', true, false)).toBe(false);
  });

  it('con «atacad» rescata: la mano del titán es su objetivo', () => {
    expect(puedeRescatar('atacar', true, false)).toBe(true);
    expect(puedeRescatar('atacar', true, true)).toBe(true);
  });

  it('con «seguidme» solo te rescata a ti', () => {
    expect(puedeRescatar('seguir', true, true)).toBe(true);
    expect(puedeRescatar('seguir', true, false)).toBe(false);
  });
});
