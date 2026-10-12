import { describe, expect, it } from 'vitest';
import {
  COLOR_BENGALA,
  DetectorAtasco,
  NOMBRE_ORDEN,
  TECLAS_ORDEN,
  anguloMira,
  enLod,
  flechaAngulo,
  fraseConfirmacion,
  necesitaRecarga,
  palabraBrujula,
  puesto,
  puntoPatrulla,
  siguienteSeleccion,
  textoAviso,
  titanApuntado,
} from './logicaOrdenes';

describe('palabras de brújula (norte = −Z, este = +X)', () => {
  it('los ocho rumbos', () => {
    expect(palabraBrujula(0, -10)).toBe('norte');
    expect(palabraBrujula(10, -10)).toBe('noreste');
    expect(palabraBrujula(10, 0)).toBe('este');
    expect(palabraBrujula(10, 10)).toBe('sureste');
    expect(palabraBrujula(0, 10)).toBe('sur');
    expect(palabraBrujula(-10, 10)).toBe('suroeste');
    expect(palabraBrujula(-10, 0)).toBe('oeste');
    expect(palabraBrujula(-10, -10)).toBe('noroeste');
  });
  it('redondea al rumbo más cercano', () => {
    expect(palabraBrujula(1, -10)).toBe('norte');
    expect(palabraBrujula(10, 3)).toBe('este');
    expect(palabraBrujula(-3, 10)).toBe('sur');
  });
});

describe('aviso de los vigías', () => {
  it('altura y dirección respecto al jugador', () => {
    expect(textoAviso('Mikasa', { altura: 12.3, anormal: false }, 60, 60)).toBe('Mikasa: ¡Titán de 12 m al sureste!');
  });
  it('anormal y cuadrúpedo', () => {
    expect(textoAviso('Armin', { altura: 7, anormal: true }, -80, 0)).toBe('Armin: ¡Titán de 7 m al oeste! ¡Anormal!');
    expect(textoAviso('Jean', { altura: 6, anormal: true, cuadrupedo: true }, 0, -50)).toBe('Jean: ¡Titán de 6 m al norte! ¡Anormal! ¡Corre a cuatro patas!');
  });
  it('muy cerca del jugador', () => {
    expect(textoAviso('Connie', { altura: 4, anormal: false }, 5, 5)).toBe('Connie: ¡Titán de 4 m junto a ti!');
  });
});

describe('titán apuntado con la mira', () => {
  const origen = { x: 0, y: 2, z: 0 };
  const alNorte = { x: 0, y: 0, z: -1 };
  const titan = (x: number, z: number, altura: number) => ({ pies: { x, y: 0, z }, cabeza: { x, y: altura * 0.85, z }, radio: altura * 0.12, altura });
  const silueta = (t: ReturnType<typeof titan>) => t;

  it('elige el más cercano al rayo, no el más cercano al jugador', () => {
    const lejosCentrado = titan(2, -200, 15);
    const cercaDeLado = titan(30, -40, 10);
    expect(titanApuntado(origen, alNorte, [cercaDeLado, lejosCentrado], silueta)).toBe(lejosCentrado);
  });
  it('fuera de la tolerancia de 6° o de 400 m no hay titán', () => {
    expect(titanApuntado(origen, alNorte, [titan(40, -100, 8)], silueta)).toBeNull();
    expect(titanApuntado(origen, alNorte, [titan(0, -450, 15)], silueta)).toBeNull();
    expect(titanApuntado(origen, { x: 0, y: 0, z: 1 }, [titan(0, -50, 15)], silueta)).toBeNull();
  });
  it('mirando a la cabeza de uno alto también cuenta', () => {
    const t = titan(0, -60, 15);
    const dir = { x: 0, y: (15 * 0.85 - 2) / 60, z: -1 };
    expect(titanApuntado(origen, dir, [t], silueta)).toBe(t);
  });
  it('de cerca, la anchura del cuerpo amplía la tolerancia', () => {
    // a 20 m y 3 m de lado son 8,5° al eje, pero el cuerpo mide casi 2 m de ancho
    const t = titan(3, -20, 15);
    expect(anguloMira(origen, alNorte, { ...t, radio: 0 }, 400)).toBeGreaterThan((6 * Math.PI) / 180);
    expect(anguloMira(origen, alNorte, t, 400)).toBeLessThan((6 * Math.PI) / 180);
  });
});

describe('selección con Tab', () => {
  it('Todos → cada soldado vivo → Todos', () => {
    const vivos = [true, false, true, true];
    expect(siguienteSeleccion(null, vivos)).toBe(0);
    expect(siguienteSeleccion(0, vivos)).toBe(2);
    expect(siguienteSeleccion(2, vivos)).toBe(3);
    expect(siguienteSeleccion(3, vivos)).toBeNull();
  });
  it('sin nadie vivo se queda en Todos', () => {
    expect(siguienteSeleccion(null, [false, false])).toBeNull();
  });
});

describe('órdenes', () => {
  it('ocho teclas, cada una con nombre y bengala', () => {
    const ordenes = new Set(Object.values(TECLAS_ORDEN));
    expect(ordenes.size).toBe(8);
    for (const o of ordenes) {
      expect(NOMBRE_ORDEN[o]).toBeTruthy();
      expect(COLOR_BENGALA[o]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(TECLAS_ORDEN.Digit5).toBe('esperar');
    expect(TECLAS_ORDEN.Digit7).toBe('atacarTitan');
  });
  it('frases de confirmación', () => {
    expect(fraseConfirmacion('esperar', true, () => 0)).toMatch(/esperamos|posición/i);
    expect(fraseConfirmacion('seguir', false, () => 0.99)).toBeTruthy();
    expect(fraseConfirmacion('atacarTitan', true, () => 0, 12.4)).toContain('12 m');
  });
});

describe('puestos y patrulla', () => {
  it('un solo soldado espera en el punto; varios, en corro', () => {
    expect(puesto(0, 1)).toEqual({ x: 0, z: 0 });
    const a = puesto(0, 4);
    const b = puesto(2, 4);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(3.5, 6);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(7, 6);
  });
  it('los puntos de patrulla caen dentro del radio y no en el centro', () => {
    let semilla = 1;
    const azar = () => {
      semilla = (semilla * 16807) % 2147483647;
      return semilla / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      const p = puntoPatrulla(100, -50, 120, azar);
      const r = Math.hypot(p.x - 100, p.z + 50);
      expect(r).toBeLessThanOrEqual(120 + 1e-9);
      expect(r).toBeGreaterThanOrEqual(30 - 1e-9);
    }
  });
});

describe('detector de atascos', () => {
  const meta = { x: 0, y: 0, z: 0 };
  it('sin acercarse en 2 s: atascado', () => {
    const d = new DetectorAtasco();
    let atascado = false;
    for (let t = 0; t < 2.2 && !atascado; t += 1 / 60) atascado = d.muestra(1 / 60, 20, meta);
    expect(atascado).toBe(true);
  });
  it('acercándose no lo está', () => {
    const d = new DetectorAtasco();
    let dist = 40;
    for (let t = 0; t < 5; t += 1 / 60) {
      dist -= 5 / 60;
      expect(d.muestra(1 / 60, dist, meta)).toBe(false);
    }
  });
  it('si la meta se mueve (seguir a alguien) empieza de nuevo', () => {
    const d = new DetectorAtasco();
    for (let t = 0, i = 0; t < 5; t += 1 / 60, i++) expect(d.muestra(1 / 60, 20, { x: i * 0.2, y: 0, z: 0 })).toBe(false);
  });
  it('ya en la meta no cuenta', () => {
    const d = new DetectorAtasco();
    for (let t = 0; t < 5; t += 1 / 60) expect(d.muestra(1 / 60, 2, meta)).toBe(false);
  });
});

describe('LOD, recarga y flechas', () => {
  it('LOD con histéresis', () => {
    expect(enLod(false, 360, 200)).toBe(true);
    expect(enLod(false, 360, 100)).toBe(false);
    expect(enLod(false, 340, 200)).toBe(false);
    expect(enLod(true, 340, 200)).toBe(true);
    expect(enLod(true, 300, 200)).toBe(false);
  });
  it('recarga con poco gas o sin cuchillas', () => {
    expect(necesitaRecarga(20, 1, 4)).toBe(true);
    expect(necesitaRecarga(60, 0, 0)).toBe(true);
    expect(necesitaRecarga(60, 0.2, 0)).toBe(true);
    expect(necesitaRecarga(60, 0, 2)).toBe(false);
    expect(necesitaRecarga(30, 0.8, 1)).toBe(false);
  });
  it('flechas por ángulo', () => {
    expect(flechaAngulo(0)).toBe('↑');
    expect(flechaAngulo(Math.PI / 2)).toBe('→');
    expect(flechaAngulo(-Math.PI / 2)).toBe('←');
    expect(flechaAngulo(Math.PI)).toBe('↓');
  });
});
