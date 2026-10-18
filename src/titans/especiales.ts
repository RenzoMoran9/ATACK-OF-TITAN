import type { EspecialTitan } from '../core/tipos';

/**
 * Los cambiantes: nombres, consejos y lo que aguantan (lógica pura, sin escena).
 *
 * - Acorazado (15 m): coraza en todo el cuerpo salvo corvas y codos; al caer de rodillas con una
 *   corva cortada se le agrieta la de la nuca.
 * - Hembra (14 m): endurece la nuca cuando te lanzas a por ella.
 * - Colosal (60 m): lento y enorme; patea la puerta de la muralla y suelta vapor abrasador que
 *   protege la nuca y te empuja. Hacen falta varios tajos en la nuca.
 * - Bestia (17 m): simiesco, brazos larguísimos y pelo; lanza rocas desde lejos y se regenera rápido.
 */

/** «el Colosal», «la Bestia»... */
export function nombreEspecial(e: EspecialTitan, articulo = true): string {
  const n = { acorazado: 'Acorazado', hembra: 'Titana Hembra', colosal: 'Titán Colosal', bestia: 'Titán Bestia' }[e];
  if (!articulo) return n;
  return e === 'hembra' ? `la ${n}` : `el ${n}`;
}

/** Con preposición y la contracción que toque: «al Titán Colosal», «del Acorazado», «a la Titana Hembra». */
export function nombreCon(e: EspecialTitan, prep: 'a' | 'de'): string {
  const n = nombreEspecial(e);
  return n.startsWith('el ') ? `${prep}l ${n.slice(3)}` : `${prep} ${n}`;
}

/** Nombre corto para la brújula y el mapa. */
export function nombreCorto(e: EspecialTitan): string {
  return { acorazado: 'Acorazado', hembra: 'Hembra', colosal: 'Colosal', bestia: 'Bestia' }[e];
}

/** Aviso del HUD al tenerlo cerca: cómo se le mata. */
export function consejoEspecial(e: EspecialTitan): string {
  return {
    acorazado: '¡Titán Acorazado! Solo corvas y codos',
    hembra: '¡Titana Hembra! Endurece la nuca',
    colosal: '¡Titán Colosal! Ataca la nuca entre nubes de vapor',
    bestia: '¡Titán Bestia! Lanza rocas: acércate por los lados',
  }[e];
}

/** Altura de cada cambiante (m). */
export function alturaEspecial(e: EspecialTitan): number {
  return { acorazado: 15, hembra: 14, colosal: 60, bestia: 17 }[e];
}

/** Multiplica el umbral de la nuca: cuánto cuesta matarlo de un tajo. */
export function aguanteNuca(e: EspecialTitan | null): number {
  return e === 'acorazado' ? 2 : e === 'hembra' ? 1.4 : e === 'colosal' ? 4 : e === 'bestia' ? 2.2 : 1;
}

/** Multiplica su velocidad: el Colosal camina despacio, la Bestia algo menos que un puro. */
export function ritmoEspecial(e: EspecialTitan | null): number {
  return e === 'colosal' ? 0.32 : e === 'bestia' ? 0.85 : e === 'hembra' ? 1.35 : e === 'acorazado' ? 1.2 : 1;
}

/** Multiplica el tiempo de regeneración (menos = se cura antes). */
export function regenEspecial(e: EspecialTitan | null): number {
  return e === 'bestia' ? 0.5 : e === 'colosal' ? 0.7 : 1;
}
