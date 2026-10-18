import type { ContextoJuego } from '../core/contexto';
import type { GestorPueblos } from '../missions/pueblos';
import { nombreCorto } from '../titans/especiales';
import { distanciaPolilinea } from '../world/formas';
import { REGION } from '../world/region';
import { distancia } from './logicaMapa';

/**
 * «Qué hay allí»: describe un punto del mapa con lo que se sabe de él — Trost, la muralla, un
 * bosque (de qué clase y lo peligroso), un pueblo (y cómo está), el río, un lugar con nombre o
 * llanura abierta — más la recarga más cercana y los titanes que tienes a la vista por allí.
 */

export interface Zona {
  /** Nombre corto (para el cursor). */
  nombre: string;
  /** Líneas de detalle (para el panel del destino). */
  detalles: string[];
}

export function describirZona(ctx: ContextoJuego, x: number, z: number, pueblos: GestorPueblos | null): Zona {
  const mundo = ctx.mundo;
  const m = mundo.muralla;
  const r = Math.hypot(x, z);
  const detalles: string[] = [];
  let nombre = 'Llanura abierta';

  if (x < REGION.x0 || x > REGION.x1 || z < REGION.z0 || z > REGION.z1) {
    return { nombre: 'Montañas', detalles: ['Montañas: fuera del territorio, no se puede pasar'] };
  }
  const lugar = mundo.lugares.find((l) => l.tipo !== 'bosque' && Math.hypot(l.pos.x - x, l.pos.z - z) < l.radio + 35);
  const bosque = mundo.bosques.find((b) => b.profundidad(x, z) > -5);
  const rio = distanciaPolilinea(x, z, mundo.plano.rio) < mundo.plano.anchoRio / 2 + 8;
  const camino = mundo.plano.caminos.some((c) => distanciaPolilinea(x, z, c) < 8);

  if (r < m.radioInterior) {
    nombre = 'Trost';
    detalles.push('Dentro de Trost: calles y tejados para los ganchos, la plaza con su depósito de gas y la iglesia');
  } else if (r < m.radioExterior + 2) {
    nombre = 'Muralla de Trost';
    detalles.push(`Lo alto de la muralla (${m.altura} m): cañones que se disparan con T`);
  } else if (lugar) {
    const pueblo = pueblos?.lista.find((p) => p.datos.id === lugar.id);
    nombre = lugar.descubierto ? lugar.nombre : 'Lugar por descubrir';
    if (pueblo && lugar.descubierto) {
      const f = pueblo.logica.fase;
      const estado = pueblo.enAlarma
        ? '¡lo están atacando!'
        : f === 'enPaz'
          ? 'en paz: recarga de gas y cuchillas en la plaza, se puede descansar'
          : f === 'tomado'
            ? `tomado por ${pueblo.logica.ocupantes} titanes`
            : `reconstruyéndose: ${Math.floor(pueblo.logica.habitantes)} vecinos, obra al ${Math.round(pueblo.logica.progreso * 100)} %`;
      detalles.push(`${lugar.nombre}: ${estado}`);
    } else if (!lugar.descubierto) detalles.push('Sin descubrir: ve a ver qué hay');
    else {
      const que = {
        castillo: 'ruinas de un castillo: torres altas para los ganchos y refugio',
        puente: 'el único puente de piedra sobre el río',
        puesto: 'puesto de avanzada: depósito de gas y cuchillas, refugio para descansar',
        campamento: 'campamento de la Legión: refugio para descansar',
        aldea: 'aldea',
        bosque: '',
      }[lugar.tipo];
      detalles.push(`${lugar.nombre}: ${que}`);
    }
  }
  if (bosque && r >= m.radioExterior + 2) {
    if (!lugar) nombre = bosque.nombre;
    const clase = bosque.tipo === 'gigante' ? 'árboles gigantes de 80–90 m: lo mejor para los ganchos' : 'bosque denso de 25–45 m, se ve poco';
    const peligro = '★'.repeat(Math.max(1, Math.round(bosque.peligro)));
    detalles.push(`${bosque.nombre}: ${clase} · peligro ${peligro}${bosque.profundidad(x, z) < 0 ? ' (en el borde)' : ''}`);
  }
  if (rio) {
    if (!lugar && !bosque) nombre = 'Río';
    detalles.push('El río: hay que cruzarlo por el puente o volando con los ganchos');
  }
  if (!lugar && !bosque && !rio && r >= m.radioExterior + 2) {
    detalles.push(camino ? 'Camino en campo abierto: nada donde clavar los ganchos (mejor a caballo)' : 'Llanura abierta: nada donde clavar los ganchos (mejor a caballo)');
  }
  // recarga más cercana a ese punto
  let dep: { nombre: string; d: number } | null = null;
  for (const d of mundo.depositos) {
    const dist = Math.hypot(d.pos.x - x, d.pos.z - z);
    if (!dep || dist < dep.d) dep = { nombre: d.nombre, d: dist };
  }
  for (const p of pueblos?.lista ?? []) {
    if (p.logica.fase !== 'enPaz') continue;
    const dist = Math.hypot(p.datos.deposito.x - x, p.datos.deposito.z - z);
    if (!dep || dist < dep.d) dep = { nombre: p.nombre, d: dist };
  }
  if (dep) detalles.push(dep.d < 30 ? `Recarga aquí mismo (${dep.nombre})` : `Recarga más cercana: ${dep.nombre}, a ${distancia(dep.d)}`);
  // titanes a la vista por allí (los que el mapa enseña: a menos de 600 m de ti)
  const j = ctx.jugador.posicion;
  const cerca = ctx.poblacion.titanesCerca(j, 600).filter((t) => t.vivo && Math.hypot(t.posicion.x - x, t.posicion.z - z) < 120);
  const cambiante = ctx.poblacion.titanes.find((t) => t.vivo && t.especial && Math.hypot(t.posicion.x - x, t.posicion.z - z) < 200);
  if (cambiante?.especial) detalles.push(`¡Cuidado! ${nombreCorto(cambiante.especial)} por la zona`);
  if (cerca.length) {
    const mayor = Math.max(...cerca.map((t) => t.altura));
    detalles.push(`Titanes a la vista: ${cerca.length} (el mayor, de ${Math.round(mayor)} m)`);
  } else if (Math.hypot(x - j.x, z - j.z) > 600) detalles.push('Demasiado lejos para saber si hay titanes');
  return { nombre, detalles };
}
