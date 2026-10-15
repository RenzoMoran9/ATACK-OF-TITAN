import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoJuego } from '../core/contexto';
import { Fisica } from '../core/fisica';
import { Navegacion } from '../core/navegacion';
import { Poblacion } from '../core/poblacion';
import { distanciaCuerpos } from './ia';
import { Titan } from './titan';

vi.mock('../world/texturas', () => ({ texturaCaraTitan: () => new THREE.Texture() }));

const DT = 1 / 60;

/** Mundo sin casas: suelo, rejilla de navegación y población vacía. */
async function mundoVacio() {
  const fisica = await Fisica.crear(14);
  fisica.caja({ x: 0, y: -1, z: 0 }, { x: 200, y: 1, z: 200 }, 'suelo');
  const nav = new Navegacion({ x0: -150, x1: 150, z0: -150, z1: 150 });
  const poblacion = new Poblacion();
  const ctx = {
    escena: new THREE.Scene(),
    fisica,
    nav,
    poblacion,
    eventos: { emit() {} },
    efectos: { vapor() {}, vaporContinuo() {}, sangre() {}, bengala() {}, actualizar() {} },
    esDeNoche: () => false,
  };
  return { fisica, poblacion, ctx: ctx as unknown as ContextoJuego };
}

/** ¿Algún colisionador de `a` ocupa el mismo sitio que algún colisionador de `b`? */
function seSolapan(fisica: Fisica, a: number[], b: Set<number>): boolean {
  for (const h of a) {
    const c = fisica.mundo.getCollider(h);
    if (!c) continue;
    let hallado = false;
    fisica.mundo.intersectionsWithShape(
      c.translation(),
      c.rotation(),
      c.shape,
      (otro) => {
        if (b.has(otro.handle)) hallado = true;
        return !hallado;
      },
      undefined,
      undefined,
      c,
    );
    if (hallado) return true;
  }
  return false;
}

describe('cuerpos de los titanes', () => {
  const crearPareja = async (x: number) => {
    const { fisica, poblacion, ctx } = await mundoVacio();
    const altura = 15;
    const crear = (px: number, rumbo: number, semilla: number) => {
      const antes = new Set(fisica.etiquetas.keys());
      const titan = new Titan(ctx, { altura, posicion: new THREE.Vector3(px, 0, 0), rumbo, semilla });
      poblacion.agregarTitan(titan);
      const piezas = [...fisica.etiquetas].filter(([h, e]) => !antes.has(h) && (e === 'titan' || e === 'nuca')).map(([h]) => h);
      return { titan, piezas };
    };
    return { fisica, a: crear(0, 0, 5), b: crear(x, Math.PI, 9) };
  };

  it('dos titanes solapados se apartan en 0,1 s, aunque aún estén quietos', async () => {
    // a 3 m el uno del otro: sus cuerpos de 15 m se meten el uno en el otro. Cada paso se
    // aparta la mitad del solape de cada uno, así que en unas décimas de segundo ya no se tocan.
    const { fisica, a, b } = await crearPareja(3);
    const piezasB = new Set(b.piezas);
    for (let i = 0; i < 6; i++) {
      a.titan.actualizar(DT, 50);
      b.titan.actualizar(DT, 50);
      fisica.paso(DT);
    }
    expect(a.titan.posicion.distanceTo(b.titan.posicion)).toBeGreaterThanOrEqual(distanciaCuerpos(15, 15) - 0.05);
    expect(seSolapan(fisica, a.piezas, piezasB)).toBe(false);
  }, 60_000);

  it('durante 5 s de paseo no vuelven a atravesarse', async () => {
    const { fisica, a, b } = await crearPareja(3);
    const piezasB = new Set(b.piezas);
    let pasosSolapados = 0;
    for (let i = 0; i < 300; i++) {
      a.titan.actualizar(DT, 50);
      b.titan.actualizar(DT, 50);
      fisica.paso(DT);
      // tras el primer segundo (margen para apartarse) no debe haber ni un solape
      if (i * DT > 1 && seSolapan(fisica, a.piezas, piezasB)) pasosSolapados++;
    }
    expect(pasosSolapados).toBe(0);
  }, 60_000);
});
