import { describe, expect, it } from 'vitest';
import { blancoCanonMuro, enLoAltoDeLaMuralla } from './logicaMuralla';

describe('cañones de la muralla', () => {
  // cañón del sur (θ = 0), muñones a 51,4 m de alto sobre la coronación
  const pivote = { x: 0, y: 51.4, z: 239.4 };
  const R = 230;
  const Rext = 242;

  it('tira a un titán de frente y a tiro', () => {
    expect(blancoCanonMuro(pivote, 0, { x: 0, y: 5, z: 400 }, Rext)).toBeCloseTo(160.6, 1);
  });

  it('no tira hacia dentro de la ciudad ni más allá de su alcance', () => {
    expect(blancoCanonMuro(pivote, 0, { x: 0, y: 5, z: 200 }, Rext)).toBeNull();
    expect(blancoCanonMuro(pivote, 0, { x: 0, y: 5, z: 600 }, Rext)).toBeNull();
  });

  it('no gira más de 55° a cada lado', () => {
    expect(blancoCanonMuro(pivote, 0, { x: 150, y: 5, z: 300 }, Rext)).toBeNull();
    expect(blancoCanonMuro(pivote, 0, { x: 60, y: 5, z: 330 }, Rext)).not.toBeNull();
  });

  it('no llega al pie del muro (queda debajo del cañón)', () => {
    expect(blancoCanonMuro(pivote, 0, { x: 0, y: 3, z: 250 }, Rext)).toBeNull();
    expect(blancoCanonMuro(pivote, 0, { x: 0, y: 3, z: 270 }, Rext)).not.toBeNull();
  });

  it('sabe si estás en lo alto de la muralla', () => {
    expect(enLoAltoDeLaMuralla({ x: 0, y: 50.9, z: 236 }, R, Rext, 50)).toBe(true);
    expect(enLoAltoDeLaMuralla({ x: 0, y: 1, z: 236 }, R, Rext, 50)).toBe(false);
    expect(enLoAltoDeLaMuralla({ x: 0, y: 51, z: 260 }, R, Rext, 50)).toBe(false);
  });
});
