import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PuntoDebil, TitanAPI, ZonaTitan } from '../core/tipos';
import { cegadosPorBengala, partesFijables, siguienteParte, zonaPasadaBaja } from './tacticas';

/** Titán de 15 m mirando a +Z con los puntos débiles donde los pone el modelo (aprox.). */
function titan(x = 0, z = 0, H = 15): TitanAPI {
  const p = (zona: ZonaTitan, cx: number, cy: number, cz: number, radio = 0.5): PuntoDebil => ({ zona, centro: new THREE.Vector3(x + cx, cy, z + cz), radio, normal: new THREE.Vector3(0, 0, -1), activo: true });
  const puntos = [
    p('nuca', 0, 0.75 * H, -0.06 * H),
    p('ojoIzq', 0.6, 0.85 * H, 1.8),
    p('ojoDer', -0.6, 0.85 * H, 1.8),
    p('brazoIzq', 2, 0.6 * H, -0.2),
    p('brazoDer', -2, 0.6 * H, -0.2),
    p('corvaIzq', 1, 0.17 * H, -0.9),
    p('corvaDer', -1, 0.17 * H, -0.9),
    p('tendonIzq', 1, 0.6, -0.8),
    p('tendonDer', -1, 0.6, -0.8),
    p('cuerpo', 0, 0.5 * H, 0, 2),
  ];
  return {
    id: 1,
    altura: H,
    anormal: false,
    posicion: new THREE.Vector3(x, 0, z),
    rumbo: 0,
    estado: 'deambular',
    vivo: true,
    puntosDebiles: puntos,
    objetivo: null,
    cabeza: () => new THREE.Vector3(x, 0.85 * H, z),
    recibirCorte: (zona) => ({ zona, efecto: 'nada', danio: 0 }),
    distraer: () => {},
  };
}

describe('bengala cegadora', () => {
  const t = titan();
  const ojo = t.puntosDebiles.find((p) => p.zona === 'ojoIzq')!.centro;
  it('estalla a 3 m de la cara: ciego', () => {
    expect(cegadosPorBengala(ojo.clone().add(new THREE.Vector3(0, 0, 3)), [t])).toEqual([t]);
  });
  it('a 6 m de la cara: nada', () => {
    expect(cegadosPorBengala(ojo.clone().add(new THREE.Vector3(0, 0, 6)), [t])).toEqual([]);
  });
});

describe('pasada baja a los tendones', () => {
  const t = titan();
  const tendon = t.puntosDebiles.find((p) => p.zona === 'tendonIzq')!.centro;
  it('a 0,15·H con el tendón a 2 m: lo encuentra', () => {
    const pos = new THREE.Vector3(tendon.x + 2, 0.15 * 15, tendon.z);
    const r = zonaPasadaBaja(new THREE.Vector3(pos.x, Math.min(pos.y, tendon.y + 1.5), pos.z), [t]);
    expect(r?.punto.zona.startsWith('tendon') || r?.punto.zona.startsWith('corva')).toBe(true);
  });
  it('a 0,5·H: no', () => {
    expect(zonaPasadaBaja(new THREE.Vector3(tendon.x + 2, 0.5 * 15, tendon.z), [t])).toBeNull();
  });
  it('a más de 3 m: no', () => {
    expect(zonaPasadaBaja(new THREE.Vector3(tendon.x + 6, 1, tendon.z - 3), [t])).toBeNull();
  });
});

describe('fijar parte', () => {
  it('empieza por la nuca y recorre de arriba abajo hasta soltar', () => {
    const t = titan();
    const orden: (ZonaTitan | null)[] = [];
    let z: ZonaTitan | null = null;
    for (let k = 0; k < partesFijables(t).length + 1; k++) {
      z = siguienteParte(t, z);
      orden.push(z);
    }
    expect(orden[0]).toBe('nuca');
    expect(orden[1]).toBe('ojoIzq');
    expect(orden.at(-1)).toBeNull();
    expect(orden).not.toContain('cuerpo');
  });
  it('salta las partes cortadas', () => {
    const t = titan();
    (t.puntosDebiles.find((p) => p.zona === 'nuca') as { activo: boolean }).activo = false;
    expect(siguienteParte(t, null)).toBe('ojoIzq');
  });
});
