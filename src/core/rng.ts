/** Generador pseudoaleatorio con semilla (mulberry32): el mundo sale igual en cada carga. */
export function crearRng(semilla: number) {
  let s = semilla >>> 0;
  const siguiente = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    siguiente,
    rango: (a: number, b: number) => a + (b - a) * siguiente(),
    entero: (a: number, b: number) => Math.floor(a + (b - a + 1) * siguiente()),
    elegir: <T>(lista: readonly T[]): T => lista[Math.floor(siguiente() * lista.length)],
  };
}

export type Rng = ReturnType<typeof crearRng>;
