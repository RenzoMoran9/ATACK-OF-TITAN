/**
 * Parámetros de URL para depuración y capturas (o el ancla equivalente #<cam>-<hora>):
 *   ?cam=tejado|calle|muralla|puerta|bosque|titan|jugador  coloca jugador y cámara
 *   ?hora=dia|atardecer|noche                               iluminación inicial
 *   ?debug=1                                                abre el panel F1 al cargar
 *   ?hud=0                                                  oculta el HUD
 *   ?poses                                                  laboratorio de poses del soldado
 *   ?tactil                                                 fuerza los controles táctiles
 */
export type Hora = 'dia' | 'atardecer' | 'noche';

const esHora = (s: string | null | undefined): s is Hora => s === 'dia' || s === 'atardecer' || s === 'noche';

const params = new URLSearchParams(window.location.search);
// También vale el ancla (#tejado, #muralla-noche, #noche): algunos visores, como los
// artefactos de claude.ai, solo pasan a la página un #ancla simple y nunca la query.
const [h1, h2] = window.location.hash.replace(/^#/, '').toLowerCase().split('-');
const horaUrl = params.get('hora');

export const urlDepuracion = {
  cam: params.get('cam') ?? (h1 && !esHora(h1) && h1 !== 'poses' && h1 !== 'tactil' ? h1 : null),
  hora: (esHora(horaUrl) ? horaUrl : esHora(h1) ? h1 : esHora(h2) ? h2 : 'dia') as Hora,
  debug: params.get('debug') === '1',
  hud: params.get('hud') !== '0',
  poses: params.has('poses') || h1 === 'poses',
  tactil: params.has('tactil') || h1 === 'tactil',
};
