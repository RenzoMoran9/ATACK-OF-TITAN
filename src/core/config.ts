import base from '../data/config.json';

export type Config = typeof base;

/**
 * Copia mutable de src/data/config.json. El panel de depuración (F1)
 * modifica este objeto en caliente; el JSON es el valor por defecto.
 */
export const config: Config = structuredClone(base);
