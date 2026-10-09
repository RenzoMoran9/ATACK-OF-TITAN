import * as THREE from 'three';
import {
  texturaAdoquines,
  texturaCamino,
  texturaCorteza,
  texturaEntramado,
  texturaHierba,
  texturaMuralla,
  texturaPiedra,
  texturaPuerta,
  texturaSueloBosque,
  texturaTejas,
  texturaVentanasNoche,
} from './texturas';

/**
 * Materiales compartidos del mundo. Lambert: barato y con lectura plana, cercana al anime.
 * Los lotes fusionados llevan color por vértice (tinte de cada casa); los suelos no.
 */
export function crearMateriales() {
  const lambert = (opts: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  return {
    entramadoVentana: lambert({
      map: texturaEntramado('ventana'),
      emissiveMap: texturaVentanasNoche(),
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
    }),
    entramadoCruz: lambert({ map: texturaEntramado('cruz') }),
    piedra: lambert({ map: texturaPiedra() }),
    tejas: lambert({ map: texturaTejas(), side: THREE.DoubleSide }),
    pizarra: lambert({ map: texturaTejas(true), side: THREE.DoubleSide }),
    madera: lambert({}),
    puerta: lambert({ map: texturaPuerta() }),
    muralla: lambert({ map: texturaMuralla() }),
    hierro: new THREE.MeshPhongMaterial({ vertexColors: true, specular: '#5c6066', shininess: 45 }),
    corteza: lambert({ map: texturaCorteza() }),
    hojas: lambert({ flatShading: true }),
    adoquines: lambert({ vertexColors: false, map: texturaAdoquines(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    hierba: lambert({ vertexColors: false, map: texturaHierba() }),
    camino: lambert({ vertexColors: false, map: texturaCamino(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sueloBosque: lambert({ vertexColors: false, map: texturaSueloBosque(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
}

export type Materiales = ReturnType<typeof crearMateriales>;

export function ajustarNoche(m: Materiales, noche: boolean): void {
  m.entramadoVentana.emissiveIntensity = noche ? 1.2 : 0;
}
