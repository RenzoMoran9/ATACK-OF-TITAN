import * as THREE from 'three';
import type { Config } from '../core/config';
import type { Fisica } from '../core/fisica';
import { crearRng } from '../core/rng';
import { Navegacion } from '../core/navegacion';
import type { OpcionesTitan } from '../core/tipos';
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

/** Punto de recarga de gas y cuchillas (el depósito de la plaza, puestos de avanzada…). */
export interface Deposito {
  pos: THREE.Vector3;
  nombre: string;
}

export interface Mundo {
  mats: Materiales;
  /** Todos los puntos de recarga; el primero es el depósito de la plaza de Trost. */
  depositos: Deposito[];
  ciudad: DatosCiudad;
  muralla: DatosMuralla;
  bosque: Bosque;
  /** Titanes de referencia del modo libre y de las capturas (?cam=titan). */
  titanesReferencia: OpcionesTitan[];
  /** Rejilla de navegación para titanes y civiles. */
  nav: Navegacion;
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

  // Titanes de referencia en la llanura (los crea el gestor de titanes)
  const titanesReferencia: OpcionesTitan[] = [
    { posicion: new THREE.Vector3(-38, 0, 330), rumbo: -Math.PI / 2, altura: 15, semilla: 1 },
    { posicion: new THREE.Vector3(34, 0, 296), rumbo: -2.3, altura: 7, semilla: 2 },
  ];

  const nav = construirNavegacion(ciudad, bosque, R, T);
  const inicio = new THREE.Vector3(0, 0, 14);
  const puntos = calcularPuntos(ciudad, bosque, titanesReferencia[0], R, H, T);
  const depositos: Deposito[] = [{ pos: ciudad.deposito.clone(), nombre: 'Depósito de la plaza' }];
  return { mats, depositos, ciudad, muralla, bosque, titanesReferencia, nav, antorchas, inicio, puntos };
}

/** El depósito más cercano a `p` (distancia horizontal). */
export function depositoMasCercano(mundo: Mundo, p: THREE.Vector3): { deposito: Deposito; distancia: number } {
  let mejor = mundo.depositos[0];
  let d = Infinity;
  for (const dep of mundo.depositos) {
    const x = Math.hypot(dep.pos.x - p.x, dep.pos.z - p.z);
    if (x < d) {
      d = x;
      mejor = dep;
    }
  }
  return { deposito: mejor, distancia: d };
}

/** Posiciones fijas de jugador + cámara para depurar y sacar capturas (?cam=...). */
/** Rejilla de 3 m: casas, iglesia, pozo, depósito, muralla (con las dos puertas cerradas) y troncos. */
function construirNavegacion(ciudad: DatosCiudad, bosque: Bosque, R: number, T: number): Navegacion {
  const nav = new Navegacion({ x0: -420, x1: 420, z0: -320, z1: 900 }, 3);
  for (const c of ciudad.casas) nav.bloquearCaja(c.x, c.z, c.ancho / 2, c.fondo / 2, c.rotY);
  nav.bloquearCaja(0, -62, 9, 17); // nave de la iglesia
  nav.bloquearCaja(0, -62 + 17 + 4, 4.5, 4.5); // torre
  nav.bloquearCirculo(0, 0, 2.6); // pozo
  nav.bloquearCaja(ciudad.deposito.x, ciudad.deposito.z, 3, 2.4);
  nav.bloquearAnillo(R, R + T + 1);
  for (const a of bosque.datos.arboles) nav.bloquearCirculo(a.x, a.z, a.radio * 1.4);
  return nav;
}

function calcularPuntos(ciudad: DatosCiudad, bosque: Bosque, titan: OpcionesTitan, R: number, H: number, T: number): Record<string, PuntoCamara> {
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
  const rumboT = titan.rumbo ?? 0;
  const frente = v(Math.sin(rumboT), 0, Math.cos(rumboT));
  const lateralT = v(frente.z, 0, -frente.x);
  const pieTitan = titan.posicion.clone().addScaledVector(frente, 8).addScaledVector(lateralT, 1.5);
  const alturaCara = titan.altura * 0.84;
  puntos.titan = {
    jugador: pieTitan,
    rumbo: rumboHacia(pieTitan, titan.posicion),
    camara: titan.posicion.clone().addScaledVector(frente, 21).addScaledVector(lateralT, 5).add(v(0, 2.2, 0)),
    mirar: titan.posicion.clone().add(v(0, alturaCara * 0.72, 0)),
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
