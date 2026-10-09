import GUI from 'lil-gui';
import { config } from '../core/config';
import type { Hora } from '../core/depuracion';

/** Panel de ajustes (F1): todos los valores de src/data/config.json, en caliente. */
export interface AccionesPanel {
  cambiarHora: (h: Hora) => void;
  irA: (punto: string) => void;
  sombras: (si: boolean) => void;
  gasInfinito: (si: boolean) => void;
  mostrarFps: (si: boolean) => void;
}

export function crearPanel(puntos: string[], horaInicial: Hora, acciones: AccionesPanel, visible: boolean): GUI {
  const gui = new GUI({ title: 'Ajustes (F1)' });
  const j = gui.addFolder('Jugador');
  j.add(config.jugador, 'velocidadAndar', 1, 20, 0.1).name('velocidad andar');
  j.add(config.jugador, 'aceleracionSuelo', 5, 120, 1).name('aceleración suelo');
  j.add(config.jugador, 'controlAereo', 0, 30, 0.5).name('control aéreo');
  j.add(config.jugador, 'salto', 1, 15, 0.1);
  j.add(config.jugador, 'resistenciaAire', 0, 0.5, 0.005).name('resistencia aire');
  j.add(config.jugador, 'velocidadMaxima', 10, 90, 1).name('velocidad máx');

  const o = gui.addFolder('ODM');
  o.add(config.odm, 'alcanceCable', 10, 150, 1).name('alcance cable (m)');
  o.add(config.odm, 'velocidadGancho', 30, 400, 5).name('vel. gancho (m/s)');
  o.add(config.odm, 'velocidadRecogida', 5, 60, 0.5).name('vel. recogida (m/s)');
  o.add(config.odm, 'aceleracionRecogida', 10, 200, 1).name('acel. recogida');
  o.add(config.odm, 'longitudMinima', 0.5, 10, 0.1).name('longitud mínima');
  o.add(config.odm, 'asistenciaGrados', 0, 10, 0.5).name('asistencia (°)');
  o.add(config.odm, 'separacionGanchosGrados', 0, 6, 0.1).name('separación ganchos (°)');
  o.add(config.odm, 'fuerzaImpulso', 0, 80, 1).name('fuerza impulso');
  o.add(config.odm, 'fuerzaOrbita', 0, 60, 1).name('fuerza órbita');
  o.add(config.odm, 'frenoEmergencia', 0, 1, 0.05).name('freno emergencia');

  const g = gui.addFolder('Gas');
  g.add(config.gas, 'costeDisparo', 0, 10, 0.1).name('coste disparo');
  g.add(config.gas, 'costeRecogidaPorSegundo', 0, 20, 0.1).name('recoger /s');
  g.add(config.gas, 'costeImpulsoPorSegundo', 0, 40, 0.5).name('impulso /s');
  g.add(config.gas, 'costeFreno', 0, 50, 1).name('coste freno');
  g.add(config.gas, 'recargaPorSegundo', 1, 100, 1).name('recarga /s');
  const dep = { gasInfinito: false, fps: false, sombras: config.render.sombras, hora: horaInicial, ir: puntos[0] ?? '' };
  g.add(dep, 'gasInfinito').name('gas infinito').onChange(acciones.gasInfinito);

  const c = gui.addFolder('Cámara');
  c.add(config.camara, 'distancia', 1.5, 15, 0.1);
  c.add(config.camara, 'alturaPivote', 0.5, 3, 0.05).name('altura pivote');
  c.add(config.camara, 'fovBase', 40, 100, 1).name('FOV base');
  c.add(config.camara, 'fovMax', 40, 120, 1).name('FOV máx');
  c.add(config.camara, 'sensibilidad', 0.0005, 0.006, 0.0001);

  const f = gui.addFolder('Física');
  f.add(config.fisica, 'gravedad', 1, 40, 0.1);

  const e = gui.addFolder('Escena / depuración');
  e.add(dep, 'hora', ['dia', 'atardecer', 'noche']).onChange(acciones.cambiarHora);
  e.add(dep, 'sombras').onChange(acciones.sombras);
  e.add(dep, 'fps').name('mostrar FPS').onChange(acciones.mostrarFps);
  e.add(dep, 'ir', puntos).name('ir a punto').onChange(acciones.irA);

  gui.folders.forEach((fo) => fo.close());
  if (!visible) gui.hide();
  return gui;
}
