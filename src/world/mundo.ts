import * as THREE from 'three';
import type { Config } from '../core/config';
import type { Fisica } from '../core/fisica';
import { crearRng } from '../core/rng';
import { Titan } from '../titans/titan';
import { Antorchas } from './antorchas';
import { Bosque } from './bosque';
import { construirCiudad, type DatosCiudad } from './ciudad';
import { escalarUV } from './geometria';
import { crearMateriales, type Materiales } from './materiales';
import { construirMuralla, puntoAnillo, type DatosMuralla } from './muralla';

/**
 * Ensambla la zona de la fase 1 a escala real: distrito amurallado (muralla de 50 m),
 * llanura con camino, bosque de árboles de 80–90 m al sur y dos titanes de referencia.
 */

export interface PuntoCamara {
  /** Pies del jugador. */
  jugador: THREE.Vector3;
  /** Hacia dónde mira el modelo (rad). */
  rumbo: number;
  camara: THREE.Vector3;
  mirar: THREE.Vector3;
}

export interface Mundo {
  mats: Materiales;
  ciudad: DatosCiudad;
  muralla: DatosMuralla;
  bosque: Bosque;
  titanes: Titan[];
  antorchas: Antorchas;
  inicio: THREE.Vector3;
  puntos: Record<string, PuntoCamara>;
}

export function construirMundo(escena: THREE.Scene, fisica: Fisica, cfg: Config): Mundo {
  const rng = crearRng(cfg.mundo.semilla);
  const mats = crearMateriales();
  const antorchas = new Antorchas(cfg.render.maxAntorchasConLuz);
  const { radioMuralla: R, alturaMuralla: H, grosorMuralla: T } = cfg.mundo;

  // Suelo: llanura de hierba seca y tierra ocre
  const llanura = new THREE.PlaneGeometry(9000, 9000);
  escalarUV(llanura, 9000 / 24, 9000 / 24);
  llanura.rotateX(-Math.PI / 2);
  const suelo = new THREE.Mesh(llanura, mats.hierba);
  suelo.receiveShadow = true;
  escena.add(suelo);
  fisica.caja({ x: 0, y: -1, z: 0 }, { x: 4500, y: 1, z: 4500 }, 'suelo');

  // Camino de tierra de la puerta al bosque
  const largoCamino = 180;
  const camino = new THREE.PlaneGeometry(9, largoCamino);
  escalarUV(camino, 9 / 8, largoCamino / 8);
  camino.rotateX(-Math.PI / 2);
  const caminoM = new THREE.Mesh(camino, mats.camino);
  caminoM.position.set(0, 0.04, R + T + largoCamino / 2 - 2);
  caminoM.receiveShadow = true;
  escena.add(caminoM);

  const ciudad = construirCiudad(escena, fisica, mats, rng, R, antorchas);
  const muralla = construirMuralla(escena, fisica, mats, R, H, T, antorchas);
  const bosque = new Bosque(escena, fisica, mats, rng);
  antorchas.construir();
  escena.add(antorchas.grupo);

  // Titanes de referencia en la llanura (inmóviles en la fase 1)
  const titanes = [
    new Titan(escena, fisica, new THREE.Vector3(-38, 0, 330), -Math.PI / 2, { altura: 15, variante: 0, piel: '#f2d2bf', pelo: null }),
    new Titan(escena, fisica, new THREE.Vector3(34, 0, 296), -2.3, { altura: 7, variante: 1, piel: '#ebc6b0', pelo: '#3b2a1e' }),
  ];

  const inicio = new THREE.Vector3(0, 0, 14);
  const puntos = calcularPuntos(ciudad, bosque, titanes, R, H, T);
  return { mats, ciudad, muralla, bosque, titanes, antorchas, inicio, puntos };
}

/** Posiciones fijas de jugador + cámara para depurar y sacar capturas (?cam=...). */
function calcularPuntos(ciudad: DatosCiudad, bosque: Bosque, titanes: Titan[], R: number, H: number, T: number): Record<string, PuntoCamara> {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const rumboHacia = (desde: THREE.Vector3, hacia: THREE.Vector3) => Math.atan2(hacia.x - desde.x, hacia.z - desde.z);
  const puntos: Record<string, PuntoCamara> = {};

  // Tejado: sobre la cumbrera de una casa alta, mirando a la torre de la iglesia
  const torre = ciudad.torre;
  const candidatas = ciudad.casas
    .filter((c) => c.alturaCumbrera > 13 && c.x > 20 && c.z > 10 && Math.hypot(c.x - torre.x, c.z - torre.z) > 80 && Math.hypot(c.x - torre.x, c.z - torre.z) < 120)
    .sort((a, b) => b.alturaCumbrera - a.alturaCumbrera);
  const casa = candidatas[0] ?? ciudad.casas[0];
  const pieTejado = v(casa.x, casa.alturaCumbrera, casa.z);
  const haciaTorre = v(torre.x - casa.x, 0, torre.z - casa.z).normalize();
  puntos.tejado = {
    jugador: pieTejado,
    rumbo: rumboHacia(pieTejado, torre),
    camara: pieTejado.clone().addScaledVector(haciaTorre, -6.5).add(v(1.2, 2.6, 0)),
    mirar: v(torre.x, 24, torre.z),
  };

  // Calle: callejón empedrado entre dos filas de casas, mirando al norte
  const pieCalle = v(40, 0, 44);
  puntos.calle = { jugador: pieCalle, rumbo: Math.PI, camara: v(40.6, 2.1, 51), mirar: v(40, 9, 0) };

  // Muralla: sobre la coronación, junto a los cañones, mirando a lo largo hacia la puerta
  const theta = 0.3;
  const pieMuro = puntoAnillo(theta, R + T / 2 - 1.5, H);
  const mirarMuro = puntoAnillo(theta - 0.22, R + T / 2 + 4, H - 4);
  puntos.muralla = {
    jugador: pieMuro,
    rumbo: rumboHacia(pieMuro, mirarMuro),
    camara: puntoAnillo(theta + 0.028, R + T / 2 - 4, H + 3.2),
    mirar: mirarMuro,
  };

  // Puerta: desde la llanura, el muro de 50 m y la puerta de madera y hierro
  const piePuerta = v(4, 0, R + T + 38);
  puntos.puerta = { jugador: piePuerta, rumbo: Math.PI, camara: v(10, 1.7, R + T + 52), mirar: v(0, 22, R + T) };

  // Bosque: a ras de suelo, entre troncos gigantes, mirando hacia el interior (+Z)
  const { limites, arboles } = bosque.datos;
  let mejor = v(0, 0, 520);
  let mejorPuntos = -Infinity;
  for (let x = -150; x <= 150; x += 5) {
    for (let z = limites.z0 + 50; z <= limites.z0 + 130; z += 5) {
      const hueco = Math.min(...arboles.map((a) => Math.hypot(a.x - x, a.z - z) - a.radio * 1.75));
      if (hueco < 6 || hueco > 14) continue;
      // muchos troncos delante, a media distancia, para que se lea la escala
      const delante = arboles.filter((a) => a.z > z + 15 && a.z < z + 140 && Math.abs(a.x - x) < (a.z - z) * 0.7).length;
      if (delante > mejorPuntos) {
        mejorPuntos = delante;
        mejor = v(x, 0, z);
      }
    }
  }
  puntos.bosque = { jugador: mejor, rumbo: 0, camara: mejor.clone().add(v(1.2, 2.0, -6.5)), mirar: mejor.clone().add(v(0, 24, 60)) };

  // Titán: el jugador a sus pies, la cámara detrás encuadrando la cara
  const t = titanes[0];
  const frente = v(Math.sin(t.grupo.rotation.y), 0, Math.cos(t.grupo.rotation.y));
  const lateralT = v(frente.z, 0, -frente.x);
  const pieTitan = t.posicion.clone().addScaledVector(frente, 8).addScaledVector(lateralT, 1.5);
  const cara = t.cara();
  puntos.titan = {
    jugador: pieTitan,
    rumbo: rumboHacia(pieTitan, t.posicion),
    camara: t.posicion.clone().addScaledVector(frente, 21).addScaledVector(lateralT, 5).add(v(0, 2.2, 0)),
    mirar: v(cara.x, cara.y * 0.72, cara.z),
  };

  // Jugador: primer plano en la plaza, tres cuartos de frente
  const pieJugador = v(-6, 0, 16);
  const rumbo = -0.5;
  const f = v(Math.sin(rumbo), 0, Math.cos(rumbo));
  const lado = v(f.z, 0, -f.x);
  puntos.jugador = {
    jugador: pieJugador,
    rumbo,
    camara: pieJugador.clone().addScaledVector(f, 1.9).addScaledVector(lado, 2.2).add(v(0, 1.3, 0)),
    mirar: pieJugador.clone().add(v(0, 0.95, 0)),
  };

  return puntos;
}
