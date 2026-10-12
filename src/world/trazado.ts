import type { OpcionesBosque } from './bosque';
import type { PuntoXZ } from './formas';

/**
 * Trazado del territorio perdido al sur de Trost (datos puros): bosques, río, caminos y
 * lugares con nombre. Norte = −Z; el sur (+Z) es el territorio que se perdió con la
 * muralla María. Coordenadas en metros con Trost en el origen.
 *
 *            N (−Z)
 *   Bosque del Norte
 *              ·  TROST  ·            Pinar Negro
 *   Aldea de Pastores   Bosque de los          Aldea del Molino
 *   Bosque Gigante  ·   Árboles Gigantes
 *   del Oeste    Puesto Oeste
 *   ~~~~~~~~~~~~~~~~~~~~~~ río ~~~~ Puente de Piedra ~~~~~~~~~~~~~~~~
 *        Castillo de Utgard   Campamento   Puesto Sur        Puesto Este
 *   Hayedo de la Bruma                 Bosque Gigante del Sur
 *            S (+Z)
 */

/** Curva de Catmull-Rom uniforme por los puntos de control, `porTramo` muestras por tramo. */
export function curva(control: readonly PuntoXZ[], porTramo: number): PuntoXZ[] {
  const res: PuntoXZ[] = [];
  const n = control.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = control[Math.max(0, i - 1)];
    const p1 = control[i];
    const p2 = control[i + 1];
    const p3 = control[Math.min(n - 1, i + 2)];
    for (let k = 0; k < porTramo; k++) {
      const t = k / porTramo;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      res.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  res.push({ ...control[n - 1] });
  return res;
}

/** Río que cruza el territorio de oeste a este (franja de agua visual; el terreno es llano). */
export const RIO_CONTROL: PuntoXZ[] = [
  { x: -2450, z: 1300 },
  { x: -1900, z: 1200 },
  { x: -1450, z: 1270 },
  { x: -1050, z: 1160 },
  { x: -650, z: 1230 },
  { x: -300, z: 1140 },
  { x: 60, z: 1200 },
  { x: 420, z: 1120 },
  { x: 800, z: 1190 },
  { x: 1200, z: 1110 },
  { x: 1600, z: 1180 },
  { x: 2000, z: 1120 },
  { x: 2450, z: 1170 },
];
export const ANCHO_RIO = 34;

/** Caminos de tierra (puntos de control). El del sur cruza el río por el puente. */
export const CAMINOS_CONTROL: PuntoXZ[][] = [
  // del camino de la puerta sur, rodeando el bosque gigante por el este hasta el puente y el sur
  [
    { x: 0, z: 380 },
    { x: 180, z: 395 },
    { x: 340, z: 470 },
    { x: 370, z: 640 },
    { x: 320, z: 820 },
    { x: 220, z: 1000 },
    { x: 160, z: 1172 },
    { x: 110, z: 1350 },
    { x: -20, z: 1560 },
    { x: -80, z: 1745 },
    { x: 40, z: 1900 },
    { x: 180, z: 2010 },
  ],
  // al oeste: aldea de pastores y puesto del oeste
  [
    { x: -10, z: 330 },
    { x: -250, z: 345 },
    { x: -470, z: 370 },
    { x: -640, z: 380 },
    { x: -720, z: 560 },
    { x: -760, z: 940 },
  ],
  // al este: aldea del molino
  [
    { x: 340, z: 470 },
    { x: 560, z: 620 },
    { x: 700, z: 760 },
    { x: 820, z: 900 },
  ],
  // pasado el puente: campamento y castillo de Utgard
  [
    { x: 110, z: 1350 },
    { x: -180, z: 1410 },
    { x: -420, z: 1440 },
    { x: -760, z: 1560 },
    { x: -1080, z: 1650 },
  ],
  // pasado el puente: puesto del este
  [
    { x: 110, z: 1350 },
    { x: 420, z: 1380 },
    { x: 760, z: 1410 },
    { x: 1100, z: 1480 },
    { x: 1450, z: 1520 },
  ],
];

/** Lugares con nombre que no son bosques. */
export const LUGARES = {
  pastores: { nombre: 'Aldea de Pastores', x: -640, z: 380, radio: 70 },
  molino: { nombre: 'Aldea del Molino', x: 820, z: 900, radio: 70 },
  utgard: { nombre: 'Castillo de Utgard', x: -1080, z: 1650, radio: 60 },
  puente: { nombre: 'Puente de Piedra', x: 160, z: 1172, radio: 40 },
  puestoOeste: { nombre: 'Puesto de avanzada del Oeste', x: -760, z: 960, radio: 30 },
  puestoSur: { nombre: 'Puesto de avanzada del Sur', x: -80, z: 1770, radio: 30 },
  puestoEste: { nombre: 'Puesto de avanzada del Este', x: 1450, z: 1540, radio: 30 },
  campamento: { nombre: 'Campamento de la Legión', x: -420, z: 1470, radio: 45 },
} as const;

export type IdLugar = keyof typeof LUGARES;

/** Bosques del territorio (sin la función de exclusión, que depende del río y los caminos). */
export const BOSQUES: Omit<OpcionesBosque, 'excluir'>[] = [
  // el de siempre, al sur de la puerta: se conserva igual (forma rectangular, misma semilla)
  { nombre: 'Bosque de los Árboles Gigantes', tipo: 'gigante', forma: { tipo: 'rect', x0: -290, x1: 290, z0: 400, z1: 740 }, arboles: 120, alturas: [80, 90], peligro: 3 },
  { nombre: 'Bosque Gigante del Oeste', tipo: 'gigante', forma: { tipo: 'elipse', cx: -1250, cz: 640, rx: 360, rz: 260, giro: 0.2 }, arboles: 120, alturas: [80, 90], peligro: 3 },
  { nombre: 'Bosque Gigante del Sur', tipo: 'gigante', forma: { tipo: 'elipse', cx: 560, cz: 2280, rx: 470, rz: 300, giro: -0.25 }, arboles: 140, alturas: [82, 92], peligro: 3 },
  { nombre: 'Pinar Negro', tipo: 'normal', forma: { tipo: 'elipse', cx: 1180, cz: 380, rx: 380, rz: 270, giro: -0.35 }, arboles: 1300, alturas: [28, 45], separacion: 10, pinos: 0.85, peligro: 2.5 },
  {
    nombre: 'Hayedo de la Bruma',
    tipo: 'normal',
    forma: {
      tipo: 'poligono',
      puntos: [
        { x: -1650, z: 2050 },
        { x: -1350, z: 1930 },
        { x: -950, z: 2000 },
        { x: -820, z: 2250 },
        { x: -950, z: 2520 },
        { x: -1300, z: 2600 },
        { x: -1620, z: 2450 },
      ],
    },
    arboles: 1300,
    alturas: [25, 40],
    separacion: 10,
    pinos: 0.2,
    peligro: 2.5,
  },
  { nombre: 'Bosque del Norte', tipo: 'normal', forma: { tipo: 'elipse', cx: -950, cz: -650, rx: 380, rz: 240, giro: 0.15 }, arboles: 1100, alturas: [25, 42], separacion: 10, pinos: 0.55, peligro: 2.5 },
];
