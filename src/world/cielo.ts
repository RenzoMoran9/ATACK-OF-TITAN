import * as THREE from 'three';
import { azimutSol, calidez, elevacionSol, factorNoche, posicionLuna } from '../core/cicloDia';
import type { Hora } from '../core/depuracion';
import { crearRng } from '../core/rng';
import { texturaNube } from './texturas';

/**
 * Cielo amplio con gradiente, sol, nubes grandes, estrellas de noche, luz solar con
 * sombras que siguen al jugador, luz hemisférica (cielo azul / tierra ocre) y niebla.
 * `aplicarHora` mezcla los ajustes de amanecer, día, atardecer y noche según la hora del
 * ciclo (src/core/cicloDia.ts) y mueve el sol por el cielo; de noche la luz es la luna.
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

/** Amanecer: más fresco y rosado que el atardecer. */
const PRESET_AMANECER: Preset = {
  cenit: '#4a618f',
  horizonte: '#efb99a',
  bajo: '#86705f',
  elevacionSol: 6,
  azimutSol: 5,
  colorSol: '#ffc59a',
  intensidadSol: 3.2,
  brilloDisco: 1.4,
  hemiCielo: '#b6b4d0',
  hemiSuelo: '#7d6550',
  intensidadHemi: 1.9,
  niebla: '#d4b6a6',
  nieblaCerca: 300,
  nieblaLejos: 2800,
  tintaNubes: '#ffd3c0',
  exposicion: 1.15,
  noche: false,
};

/** Momentos clave del día: entre dos seguidos se interpola. */
const CLAVES: [number, Preset][] = [
  [0, PRESETS.noche],
  [4.8, PRESETS.noche],
  [6.2, PRESET_AMANECER],
  [8.2, PRESETS.dia],
  [16.8, PRESETS.dia],
  [18.6, PRESETS.atardecer],
  [19.9, PRESETS.noche],
  [24, PRESETS.noche],
];

/** Hora del ciclo que corresponde a cada ajuste fijo (capturas, panel de depuración). */
export const HORA_DE: Record<Hora, number> = { dia: 12.5, atardecer: 18.55, noche: 23 };

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
  private readonly niebla = new THREE.Fog('#c4d2de', 350, 3200);
  private readonly tmpColor = new THREE.Color();
  private readonly tmpColor2 = new THREE.Color();
  private esNoche = false;
  hora: Hora = 'dia';
  /** 0 de día … 1 de noche cerrada. */
  noche = 0;
  /** 1 con el sol bajo (amanecer, atardecer). */
  calidez = 0;
  /** Menos calidad, menos distancia de dibujado: la niebla se acerca. */
  factorDistancia = 1;

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

  /** Ajuste fijo (capturas y panel): la hora típica de ese momento. */
  aplicar(hora: Hora, renderer: THREE.WebGLRenderer): void {
    this.hora = hora;
    this.aplicarHora(HORA_DE[hora], renderer);
  }

  /** Cielo, luces y niebla para una hora del ciclo (0–24), mezclando los ajustes vecinos. */
  aplicarHora(h: number, renderer: THREE.WebGLRenderer): void {
    let i = 0;
    while (i < CLAVES.length - 2 && CLAVES[i + 1][0] <= h) i++;
    const [h0, a] = CLAVES[i];
    const [h1, b] = CLAVES[i + 1];
    const k = THREE.MathUtils.clamp((h - h0) / Math.max(1e-6, h1 - h0), 0, 1);
    const num = (x: number, y: number) => x + (y - x) * k;
    const col = (out: THREE.Color, x: string, y: string) => out.set(x).lerp(this.tmpColor.set(y), k);
    this.noche = factorNoche(h);
    this.calidez = calidez(h);
    this.esNoche = this.noche > 0.5;
    const u = this.cupula.material.uniforms;
    col(u.cenit.value as THREE.Color, a.cenit, b.cenit);
    col(u.horizonte.value as THREE.Color, a.horizonte, b.horizonte);
    col(u.bajo.value as THREE.Color, a.bajo, b.bajo);
    col(u.colorSol.value as THREE.Color, a.colorSol, b.colorSol);
    u.brilloDisco.value = num(a.brilloDisco, b.brilloDisco);
    // Sol de día; de noche, la luna. La luz se apaga junto al horizonte al cambiar de una a otra.
    const elev = elevacionSol(h);
    let el: number;
    let az: number;
    let f: number;
    if (elev > 0) {
      el = Math.max(elev, 1.5);
      az = azimutSol(h);
      f = THREE.MathUtils.smoothstep(elev, -0.5, 5);
    } else {
      const luna = posicionLuna(h);
      el = luna.elevacion;
      az = luna.azimut;
      f = THREE.MathUtils.smoothstep(-elev, 0, 10);
    }
    const elR = THREE.MathUtils.degToRad(el);
    const azR = THREE.MathUtils.degToRad(az);
    this.dirSol.set(Math.cos(elR) * Math.cos(azR), Math.sin(elR), Math.cos(elR) * Math.sin(azR)).normalize();
    (u.dirSol.value as THREE.Vector3).copy(this.dirSol);
    this.sol.color.copy(u.colorSol.value as THREE.Color);
    this.sol.intensity = num(a.intensidadSol, b.intensidadSol) * Math.max(0.04, f);
    col(this.hemi.color, a.hemiCielo, b.hemiCielo);
    col(this.hemi.groundColor, a.hemiSuelo, b.hemiSuelo);
    this.hemi.intensity = num(a.intensidadHemi, b.intensidadHemi);
    const niebla = this.niebla;
    col(niebla.color, a.niebla, b.niebla);
    niebla.near = num(a.nieblaCerca, b.nieblaCerca) * this.factorDistancia;
    niebla.far = num(a.nieblaLejos, b.nieblaLejos) * this.factorDistancia;
    this.escena.fog = niebla;
    if (!(this.escena.background instanceof THREE.Color)) this.escena.background = new THREE.Color();
    (this.escena.background as THREE.Color).copy(u.horizonte.value as THREE.Color);
    col(this.tmpColor2, a.tintaNubes, b.tintaNubes);
    for (const n of this.nubes) n.material.color.copy(this.tmpColor2);
    this.estrellas.visible = this.noche > 0.02;
    (this.estrellas.material as THREE.PointsMaterial).opacity = 0.85 * this.noche;
    renderer.toneMappingExposure = num(a.exposicion, b.exposicion);
  }

  get esDeNoche(): boolean {
    return this.esNoche;
  }

  /** Lejanía de la niebla de día con el factor de distancia actual (para el plano lejano). */
  get lejaniaDia(): number {
    return PRESETS.dia.nieblaLejos * this.factorDistancia;
  }

  /**
   * Con menos distancia de dibujado, la cúpula, las nubes y las estrellas se acercan a escala:
   * se ven igual (no les afecta la niebla) y no las corta el plano lejano de la cámara.
   */
  ajustarLejania(lejos: number): void {
    this.grupo.scale.setScalar(Math.min(1, (lejos * 0.92) / 4500));
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
