import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Fisica } from './fisica';

// Rayo horizontal desde x = -40 hacia +X: el primer impacto es el borde de la silueta en x = -radio
// Como en el bucle del juego: un paso de simulación pone al día las consultas (sin gravedad, no mueve nada)
const impactoDesdeLaIzquierda = (f: Fisica, y: number) => {
  f.paso(1 / 60);
  return f.lanzarRayo(new THREE.Vector3(-40, y, 0), new THREE.Vector3(1, 0, 0), 100);
};

describe('Fisica.troncoConico', () => {
  it('la base de la raíz llega a su radio visible, no a un cilindro interior', async () => {
    const f = await Fisica.crear(0);
    // Raíz de un árbol gigante de radio 6: se ensancha de 10,5 m en el suelo a 6 m a 7 m de altura
    f.troncoConico(0, 0, 0, 7, 10.5, 6, 16, 0, 'arbol');
    const cerca = impactoDesdeLaIzquierda(f, 0.5);
    expect(cerca).not.toBeNull();
    expect(cerca!.punto.x).toBeCloseTo(-10.2, 1);
    const arriba = impactoDesdeLaIzquierda(f, 6.5);
    expect(arriba!.punto.x).toBeCloseTo(-(10.5 + (6 - 10.5) * (6.5 / 7)), 2);
  });

  it('el tronco sigue su conicidad (no un radio medio)', async () => {
    const f = await Fisica.crear(0);
    // Tronco de radio 6 en la base y 2,52 en el tope a 60 m: a 1 m, el radio es casi 6
    f.troncoConico(0, 0, 0, 60, 6, 2.52, 16, 0, 'arbol');
    const hit = impactoDesdeLaIzquierda(f, 1);
    expect(hit!.punto.x).toBeCloseTo(-(6 + (2.52 - 6) * (1 / 60)), 2);
  });

  it('aplica el giro de la malla a los lados del polígono', async () => {
    const f = await Fisica.crear(0);
    // Con 4 lados y giro 0 hay un vértice en +X: el radio en ese rayo es el del vértice
    f.troncoConico(0, 0, 0, 5, 3, 3, 4, 0, 'arbol');
    const sinGiro = impactoDesdeLaIzquierda(f, 2);
    expect(sinGiro!.punto.x).toBeCloseTo(-3, 2);
    // Con giro π/4 los vértices quedan en las diagonales y el borde en X es el apotema
    const g = await Fisica.crear(0);
    g.troncoConico(0, 0, 0, 5, 3, 3, 4, Math.PI / 4, 'arbol');
    const conGiro = impactoDesdeLaIzquierda(g, 2);
    expect(conGiro!.punto.x).toBeCloseTo(-3 * Math.SQRT1_2, 2);
  });
});
