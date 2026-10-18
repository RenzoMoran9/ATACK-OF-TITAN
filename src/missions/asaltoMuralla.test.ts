import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sitioDeSalida } from './asaltoMuralla';

describe('sitioDeSalida', () => {
  const puerta = new THREE.Vector3(0, 0, 242);
  // un bosque justo al sur de la puerta, como el de los Árboles Gigantes
  const bosque = (x: number, z: number) => Math.abs(x) < 290 && z > 400 && z < 740;

  it('sale a la distancia pedida, hacia fuera de la muralla', () => {
    const p = sitioDeSalida(puerta, 520, () => 0.5, () => true)!;
    expect(p.distanceTo(puerta)).toBeCloseTo(520, 3);
    expect(p.z).toBeGreaterThan(puerta.z);
  });

  it('nunca sale de dentro del bosque', () => {
    for (const azar of [0, 0.25, 0.5, 0.75, 0.999]) {
      const p = sitioDeSalida(puerta, 520, () => azar, (x, z) => !bosque(x, z))!;
      expect(bosque(p.x, p.z)).toBe(false);
    }
  });

  it('se acerca si lejos no vale nada, y si nada vale devuelve null', () => {
    const p = sitioDeSalida(puerta, 500, () => 0, (x, z) => Math.hypot(x - puerta.x, z - puerta.z) < 450)!;
    expect(p.distanceTo(puerta)).toBeCloseTo(400, 3);
    expect(sitioDeSalida(puerta, 500, () => 0, () => false)).toBeNull();
  });
});
