/**
 * Parámetros de URL para depuración y capturas:
 *   ?cam=tejado|calle|muralla|puerta|bosque|titan|jugador  coloca jugador y cámara
 *   ?hora=dia|atardecer|noche                               iluminación inicial
 *   ?debug=1                                                abre el panel F1 al cargar
 *   ?hud=0                                                  oculta el HUD
 */
export type Hora = 'dia' | 'atardecer' | 'noche';

const params = new URLSearchParams(window.location.search);
const hora = params.get('hora');

export const urlDepuracion = {
  cam: params.get('cam'),
  hora: (hora === 'atardecer' || hora === 'noche' ? hora : 'dia') as Hora,
  debug: params.get('debug') === '1',
  hud: params.get('hud') !== '0',
};
