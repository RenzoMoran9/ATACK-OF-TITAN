import * as THREE from 'three';
import type { Hora } from '../core/depuracion';
import { crearRng } from '../core/rng';
import { texturaNube } from './texturas';

/**
 * Cielo amplio con gradiente, sol, nubes grandes, estrellas de noche, luz solar con
 * sombras que siguen al jugador, luz hemisférica (cielo azul / tierra ocre) y niebla.
 */

interface Preset {
  cenit: string;
  horizonte: string;
  bajo: string;
  elevacionSol: number; // grados
  azimutSol: number; // grados (0 = este +X, 90 = sur +Z, 180 = oeste)
  colorSol: string;
  intensidadSol: number;
  brilloDisco: number;
  hemiCielo: string;
  hemiSuelo: string;
  intensidadHemi: number;
  niebla: string;
  nieblaCerca: number;
  nieblaLejos: number;
  tintaNubes: string;
  exposicion: number;
  noche: boolean;
}

export const PRESETS: Record<Hora, Preset> = {
  dia: {
    cenit: '#4f7fb8',
    horizonte: '#c9d8e4',
    bajo: '#a9b4a4',
    elevacionSol: 50,
    azimutSol: 115,
    colorSol: '#fff1db',
    intensidadSol: 2.9,
    brilloDisco: 1,
    hemiCielo: '#b9d0ea',
    hemiSuelo: '#8a7350',
    intensidadHemi: 1.35,
    niebla: '#c4d2de',
    nieblaCerca: 350,
    nieblaLejos: 3200,
    tintaNubes: '#ffffff',
    exposicion: 1.0,
    noche: false,
  },
  atardecer: {
    cenit: '#3d5384',
    horizonte: '#f2a865',
    bajo: '#8a6a55',
    elevacionSol: 6,
    azimutSol: 172,
    colorSol: '#ffb06a',
    intensidadSol: 3.8,
    brilloDisco: 1.6,
    hemiCielo: '#b4a6c8',
    hemiSuelo: '#8a6040',
    intensidadHemi: 2.1,
    niebla: '#d9a07a',
    nieblaCerca: 300,
    nieblaLejos: 2800,
    tintaNubes: '#ffc9a3',
    exposicion: 1.2,
    noche: false,
  },
  noche: {
    cenit: '#070d22',
    horizonte: '#1c2b4d',
    bajo: '#0e1424',
    elevacionSol: 38,
    azimutSol: 40,
    colorSol: '#8ea6d8',
    intensidadSol: 0.45,
    brilloDisco: 0.35,
    hemiCielo: '#2b3d6e',
    hemiSuelo: '#121621',
    intensidadHemi: 0.55,
    niebla: '#141f38',
    nieblaCerca: 120,
    nieblaLejos: 1600,
    tintaNubes: '#2f3b5a',
    exposicion: 1.1,
    noche: true,
  },
};

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}`;

const FRAG = /* glsl */ `
uniform vec3 cenit;
uniform vec3 horizonte;
uniform vec3 bajo;
uniform vec3 colorSol;
uniform vec3 dirSol;
uniform float brilloDisco;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(horizonte, cenit, pow(clamp(h, 0.0, 1.0), 0.5));
  c = mix(c, bajo, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, normalize(dirSol)), 0.0);
  c += colorSol * (pow(s, 1200.0) * 6.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.12) * brilloDisco;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Cielo {
  readonly grupo = new THREE.Group();
  readonly sol = new THREE.DirectionalLight();
  readonly hemi = new THREE.HemisphereLight();
  readonly dirSol = new THREE.Vector3();
  private readonly cupula: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly nubes: THREE.Sprite[] = [];
  private readonly estrellas: THREE.Points;
  private presetActual: Preset = PRESETS.dia;
  hora: Hora = 'dia';

  constructor(private readonly escena: THREE.Scene, radioSombra: number, tamanoSombra: number) {
    this.cupula = new THREE.Mesh(
      new THREE.SphereGeometry(4500, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        // Se dibuja la primera y sin prueba de profundidad: nada de forzar z = w, que dejaba
        // fragmentos justo en el plano lejano y hacía parpadear el cielo al mirar arriba.
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          cenit: { value: new THREE.Color() },
          horizonte: { value: new THREE.Color() },
          bajo: { value: new THREE.Color() },
          colorSol: { value: new THREE.Color() },
          dirSol: { value: new THREE.Vector3() },
          brilloDisco: { value: 1 },
        },
      }),
    );
    this.cupula.frustumCulled = false;
    this.cupula.renderOrder = -10;
    this.grupo.add(this.cupula);

    const rng = crearRng(99);
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texturaNube(i % 4),
        fog: false,
        depthWrite: false,
        transparent: true,
      });
      const nube = new THREE.Sprite(mat);
      const ang = rng.rango(0, Math.PI * 2);
      const dist = rng.rango(1700, 3600);
      const ancho = rng.rango(600, 1300);
      nube.scale.set(ancho, ancho * 0.5, 1);
      nube.position.set(Math.cos(ang) * dist, rng.rango(380, 950), Math.sin(ang) * dist);
      this.nubes.push(nube);
      this.grupo.add(nube);
    }
    // Orden de dibujo fijo, de la más lejana a la más cercana: las nubes viajan con la cámara,
    // así que su distancia relativa no cambia y no deben reordenarse (saltaban al girar).
    const porDistancia = [...this.nubes].sort((a, b) => b.position.length() - a.position.length());
    porDistancia.forEach((n, i) => (n.renderOrder = -8 + i * 0.01));

    const pos: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3(rng.rango(-1, 1), rng.rango(0.05, 1), rng.rango(-1, 1)).normalize().multiplyScalar(4300);
      pos.push(v.x, v.y, v.z);
    }
    const geoE = new THREE.BufferGeometry();
    geoE.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.estrellas = new THREE.Points(
      geoE,
      new THREE.PointsMaterial({ color: '#dfe8ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }),
    );
    this.estrellas.renderOrder = -9;
    this.grupo.add(this.estrellas);

    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(tamanoSombra, tamanoSombra);
    const cam = this.sol.shadow.camera;
    cam.left = -radioSombra;
    cam.right = radioSombra;
    cam.top = radioSombra;
    cam.bottom = -radioSombra;
    cam.near = 1;
    cam.far = 1600;
    this.sol.shadow.radius = 2;
    this.sol.shadow.bias = -0.0004;
    this.sol.shadow.normalBias = 0.6;
    escena.add(this.sol, this.sol.target, this.hemi, this.grupo);
  }

  aplicar(hora: Hora, renderer: THREE.WebGLRenderer): void {
    const p = PRESETS[hora];
    this.hora = hora;
    this.presetActual = p;
    const u = this.cupula.material.uniforms;
    (u.cenit.value as THREE.Color).set(p.cenit);
    (u.horizonte.value as THREE.Color).set(p.horizonte);
    (u.bajo.value as THREE.Color).set(p.bajo);
    (u.colorSol.value as THREE.Color).set(p.colorSol);
    u.brilloDisco.value = p.brilloDisco;
    const el = THREE.MathUtils.degToRad(p.elevacionSol);
    const az = THREE.MathUtils.degToRad(p.azimutSol);
    this.dirSol.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    (u.dirSol.value as THREE.Vector3).copy(this.dirSol);
    this.sol.color.set(p.colorSol);
    this.sol.intensity = p.intensidadSol;
    this.hemi.color.set(p.hemiCielo);
    this.hemi.groundColor.set(p.hemiSuelo);
    this.hemi.intensity = p.intensidadHemi;
    this.escena.fog = new THREE.Fog(p.niebla, p.nieblaCerca, p.nieblaLejos);
    this.escena.background = new THREE.Color(p.horizonte);
    for (const n of this.nubes) n.material.color.set(p.tintaNubes);
    this.estrellas.visible = p.noche;
    renderer.toneMappingExposure = p.exposicion;
  }

  get esDeNoche(): boolean {
    return this.presetActual.noche;
  }

  /** La sombra y la cúpula acompañan al punto de interés (el jugador). */
  seguir(centro: THREE.Vector3, camara: THREE.Camera): void {
    const objetivo = this.sol.target.position;
    // Ajuste a la rejilla de texeles para que la sombra no tiemble al moverse.
    const paso = (this.sol.shadow.camera.right * 2) / this.sol.shadow.mapSize.x;
    objetivo.set(Math.round(centro.x / paso) * paso, 0, Math.round(centro.z / paso) * paso);
    this.sol.position.copy(objetivo).addScaledVector(this.dirSol, 700);
    this.sol.target.updateMatrixWorld();
    this.grupo.position.copy(camara.position);
  }
}
