import { describe, expect, it } from 'vitest';
import { Navegacion } from './navegacion';

const lim = { x0: -60, x1: 60, z0: -60, z1: 60 };

describe('Navegacion', () => {
  it('en campo abierto la ruta es la línea recta', () => {
    const nav = new Navegacion(lim, 2);
    const r = nav.ruta({ x: -40, z: 0 }, { x: 40, z: 0 }, 1)!;
    expect(r).toHaveLength(1);
    expect(r[0].x).toBe(40);
  });

  it('rodea un muro y no lo atraviesa', () => {
    const nav = new Navegacion(lim, 2);
    nav.bloquearCaja(0, 0, 2, 40); // muro norte-sur de 80 m
    const r = nav.ruta({ x: -20, z: 0 }, { x: 20, z: 0 }, 1)!;
    expect(r).not.toBeNull();
    expect(r.length).toBeGreaterThan(1);
    let prev = { x: -20, z: 0 };
    for (const p of r) {
      expect(nav.lineaLibre(prev, p, 1)).toBe(true);
      prev = p;
    }
    expect(r.some((p) => Math.abs(p.z) > 40)).toBe(true);
  });

  it('la holgura impide que un agente grande pase por un hueco estrecho', () => {
    const nav = new Navegacion(lim, 2);
    // dos muros con un hueco de 6 m en medio
    nav.bloquearCaja(0, 33, 2, 30);
    nav.bloquearCaja(0, -33, 2, 30);
    expect(nav.ruta({ x: -20, z: 0 }, { x: 20, z: 0 }, 1)).not.toBeNull(); // civil
    expect(nav.ruta({ x: -20, z: 0 }, { x: 20, z: 0 }, 6)).toBeNull(); // titán grande
  });

  it('el anillo con hueco deja pasar solo por la puerta', () => {
    const nav = new Navegacion({ x0: -80, x1: 80, z0: -80, z1: 80 }, 2);
    nav.bloquearAnillo(40, 48, 1, { angulo: 0, ancho: 12 });
    const r = nav.ruta({ x: 0, z: 70 }, { x: 0, z: 0 }, 2)!;
    expect(r).not.toBeNull();
    // cerrar la puerta: ya no hay ruta
    nav.ponerArco(40, 48, 0, 12, 1);
    expect(nav.ruta({ x: 0, z: 70 }, { x: 0, z: 0 }, 2)).toBeNull();
  });

  it('las cajas rotadas bloquean en su orientación', () => {
    const nav = new Navegacion(lim, 1);
    nav.bloquearCaja(0, 0, 10, 1, Math.PI / 2); // girada 90°: se extiende en Z
    expect(nav.libre(0, 8, 0.1)).toBe(false);
    expect(nav.libre(8, 0, 0.1)).toBe(true);
  });
});
