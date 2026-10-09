import * as THREE from 'three';
import { texturaEmblema } from '../world/texturas';

/**
 * Soldado de 1,7 m con primitivas: chaqueta corta marrón claro, pantalón blanco,
 * botas altas marrones, correas del arnés por todo el cuerpo, capa verde con capucha,
 * dos vainas metálicas grises en los muslos con los cilindros de gas encima y la
 * carcasa del equipo en la parte baja de la espalda. Mira hacia +Z; origen en los pies.
 */

const COLORES = {
  piel: '#e8c6a6',
  pelo: '#2b1d14',
  chaqueta: '#b58c5c',
  pantalon: '#eeece6',
  botas: '#5b3a22',
  correa: '#2f1e13',
  capa: '#4a6438',
  metal: '#8f969d',
  metalClaro: '#b9bec4',
  carcasa: '#575c62',
};

const ARRIBA = new THREE.Vector3(0, 1, 0);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function segmento(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const o = mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, a.distanceTo(b) - 2 * r), 4, 10), m);
  o.position.copy(a).lerp(b, 0.5);
  o.quaternion.setFromUnitVectors(ARRIBA, b.clone().sub(a).normalize());
  return o;
}

export class ModeloJugador {
  readonly grupo = new THREE.Group();
  /** Cuerpo inclinable (todo menos la raíz). */
  private readonly cuerpo = new THREE.Group();
  private readonly capa = new THREE.Group();
  private readonly piernas: THREE.Group[] = [];
  private readonly brazos: THREE.Group[] = [];
  private paso = 0;

  constructor() {
    const lam = (c: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
    const piel = lam(COLORES.piel);
    const chaqueta = lam(COLORES.chaqueta);
    const pantalon = lam(COLORES.pantalon);
    const botas = lam(COLORES.botas);
    const correa = lam(COLORES.correa);
    const capaMat = lam(COLORES.capa, { side: THREE.DoubleSide });
    // Phong: brillo especular sin depender de un mapa de entorno
    const metal = new THREE.MeshPhongMaterial({ color: COLORES.metal, specular: '#e8eef4', shininess: 70 });
    const metalClaro = new THREE.MeshPhongMaterial({ color: COLORES.metalClaro, specular: '#ffffff', shininess: 90 });
    const carcasa = new THREE.MeshPhongMaterial({ color: COLORES.carcasa, specular: '#9aa2aa', shininess: 40 });

    this.grupo.add(this.cuerpo);

    // Piernas (pivotan en la cadera)
    for (const lado of [-1, 1]) {
      const pierna = new THREE.Group();
      pierna.position.set(lado * 0.1, 0.93, 0);
      // muslo blanco
      pierna.add(mesh(new THREE.CylinderGeometry(0.085, 0.072, 0.45, 12), pantalon, 0, -0.22, 0));
      // bota alta hasta la rodilla
      pierna.add(mesh(new THREE.CylinderGeometry(0.072, 0.062, 0.5, 12), botas, 0, -0.66, 0));
      pierna.add(mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.05, 12), botas, 0, -0.42, 0));
      pierna.add(mesh(new THREE.BoxGeometry(0.11, 0.07, 0.25), botas, 0, -0.895, 0.045));
      // correas del arnés alrededor del muslo y bajando por la pierna
      for (const y of [-0.12, -0.3]) {
        const anillo = mesh(new THREE.TorusGeometry(0.083, 0.012, 6, 16), correa, 0, y, 0);
        anillo.rotation.x = Math.PI / 2;
        pierna.add(anillo);
      }
      pierna.add(mesh(new THREE.BoxGeometry(0.025, 0.42, 0.02), correa, lado * 0.075, -0.22, 0.03));
      pierna.add(mesh(new THREE.BoxGeometry(0.025, 0.22, 0.02), correa, 0, -0.52, 0.07));
      this.piernas.push(pierna);
      this.cuerpo.add(pierna);
    }

    // Cadera, cinturón y torso con chaqueta corta
    this.cuerpo.add(mesh(new THREE.BoxGeometry(0.32, 0.14, 0.2), pantalon, 0, 0.92, 0));
    this.cuerpo.add(mesh(new THREE.BoxGeometry(0.345, 0.06, 0.225), correa, 0, 0.985, 0));
    const torsoGeo = new THREE.CylinderGeometry(0.28, 0.23, 0.44, 4, 1).rotateY(Math.PI / 4);
    const torso = mesh(torsoGeo, chaqueta, 0, 1.22, 0);
    torso.scale.set(1, 1, 0.58);
    this.cuerpo.add(torso);
    // camisa blanca asomando en el cuello
    this.cuerpo.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), pantalon, 0, 1.38, 0.085));
    // Correas del pecho en X, delante y detrás, y banda horizontal
    for (const z of [0.095, -0.095]) {
      for (const s of [-1, 1]) {
        const c = mesh(new THREE.BoxGeometry(0.03, 0.46, 0.02), correa, 0, 1.2, z);
        c.rotation.z = s * 0.42;
        this.cuerpo.add(c);
      }
      this.cuerpo.add(mesh(new THREE.BoxGeometry(0.33, 0.03, 0.02), correa, 0, 1.3, z));
    }
    for (const s of [-1, 1]) {
      this.cuerpo.add(mesh(new THREE.BoxGeometry(0.03, 0.02, 0.21), correa, s * 0.1, 1.44, 0));
      // correas que bajan por el costado hasta el cinturón
      this.cuerpo.add(mesh(new THREE.BoxGeometry(0.02, 0.36, 0.03), correa, s * 0.17, 1.15, 0));
    }

    // Cabeza
    this.cuerpo.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), piel, 0, 1.47, 0));
    const cabeza = mesh(new THREE.SphereGeometry(0.105, 18, 14), piel, 0, 1.585, 0.005);
    cabeza.scale.set(0.92, 1.05, 1);
    this.cuerpo.add(cabeza);
    // Pelo: casquete inclinado hacia atrás (deja la cara al aire y cubre la nuca)
    const pelo = mesh(new THREE.SphereGeometry(0.113, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.44), lam(COLORES.pelo), 0, 1.595, -0.004);
    pelo.scale.set(0.96, 1.06, 1.03);
    pelo.rotation.x = -0.5;
    this.cuerpo.add(pelo);
    const ojos = lam('#1d1612');
    for (const s of [-1, 1]) {
      this.cuerpo.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), ojos, s * 0.035, 1.6, 0.095));
      const ceja = mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), lam(COLORES.pelo), s * 0.036, 1.625, 0.096);
      ceja.rotation.z = s * -0.15;
      this.cuerpo.add(ceja);
    }

    // Brazos con mangas de la chaqueta (pivotan en el hombro)
    for (const lado of [-1, 1]) {
      const brazo = new THREE.Group();
      brazo.position.set(lado * 0.215, 1.39, 0);
      brazo.add(segmento(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lado * 0.02, -0.27, 0), 0.046, chaqueta));
      brazo.add(segmento(new THREE.Vector3(lado * 0.02, -0.27, 0), new THREE.Vector3(lado * 0.025, -0.5, 0.05), 0.04, chaqueta));
      brazo.add(mesh(new THREE.SphereGeometry(0.04, 10, 8), piel, lado * 0.025, -0.55, 0.055));
      // empuñadura del equipo en la mano
      brazo.add(mesh(new THREE.BoxGeometry(0.035, 0.05, 0.16), carcasa, lado * 0.025, -0.56, 0.1));
      this.brazos.push(brazo);
      this.cuerpo.add(brazo);
    }

    // Equipo ODM: carcasa en la parte baja de la espalda con bobinas a los lados
    this.cuerpo.add(mesh(new THREE.BoxGeometry(0.24, 0.13, 0.11), carcasa, 0, 0.95, -0.16));
    for (const s of [-1, 1]) {
      const bobina = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.045, 14), metal, s * 0.14, 0.95, -0.16);
      bobina.rotation.z = Math.PI / 2;
      this.cuerpo.add(bobina);
      // Vaina gris en el muslo + cilindro de gas encima
      const vaina = mesh(new THREE.BoxGeometry(0.075, 0.15, 0.52), metal, s * 0.215, 0.74, -0.07);
      vaina.rotation.x = -0.12;
      this.cuerpo.add(vaina);
      const gas = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.44, 14), metalClaro, s * 0.215, 0.855, -0.09);
      gas.rotation.x = Math.PI / 2 - 0.12;
      this.cuerpo.add(gas);
      const tapa = mesh(new THREE.SphereGeometry(0.046, 10, 8), metalClaro, s * 0.215, 0.83, -0.31);
      this.cuerpo.add(tapa);
      // soporte de la vaina a la cadera
      this.cuerpo.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), correa, s * 0.19, 0.86, 0.04));
    }

    // Capa verde con capucha y emblema (pivota en los hombros)
    this.capa.position.set(0, 1.45, 0);
    const tela = mesh(new THREE.CylinderGeometry(0.225, 0.34, 0.8, 18, 3, true, Math.PI - 1.45, 2.9), capaMat, 0, -0.4, 0);
    tela.castShadow = true;
    this.capa.add(tela);
    const emblema = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.24),
      new THREE.MeshLambertMaterial({ map: texturaEmblema(), transparent: true, alphaTest: 0.1 }),
    );
    emblema.position.set(0, -0.36, -0.288);
    emblema.rotation.set(-0.15, Math.PI, 0);
    this.capa.add(emblema);
    this.cuerpo.add(this.capa);
    const capucha = mesh(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), capaMat, 0, 1.43, -0.13);
    capucha.scale.set(1.1, 0.55, 0.75);
    capucha.rotation.x = -0.4;
    this.cuerpo.add(capucha);
  }

  /** Puntos de salida de los cables (costados de la carcasa) en coordenadas de mundo. */
  salidaCable(lado: -1 | 1, destino: THREE.Vector3): THREE.Vector3 {
    return destino.set(lado * 0.17, 0.95, -0.1).applyMatrix4(this.grupo.matrixWorld);
  }

  /**
   * Animación procedural mínima: zancada en el suelo, piernas recogidas en el aire,
   * inclinación por aceleración y capa que ondea con la velocidad.
   */
  animar(dt: number, t: number, velocidad: THREE.Vector3, enSuelo: boolean, inclinacion: number): void {
    const vh = Math.hypot(velocidad.x, velocidad.z);
    if (enSuelo && vh > 0.3) {
      this.paso += dt * vh * 1.6;
      const a = Math.sin(this.paso) * Math.min(0.7, vh * 0.1);
      this.piernas[0].rotation.x = a;
      this.piernas[1].rotation.x = -a;
      this.brazos[0].rotation.x = -a * 0.8;
      this.brazos[1].rotation.x = a * 0.8;
    } else {
      const objetivo = enSuelo ? 0 : -0.45;
      for (const [i, p] of this.piernas.entries()) {
        p.rotation.x += ((i === 0 ? objetivo : objetivo * 0.4) - p.rotation.x) * Math.min(1, dt * 8);
      }
      for (const b of this.brazos) b.rotation.x += ((enSuelo ? 0 : -0.5) - b.rotation.x) * Math.min(1, dt * 8);
    }
    this.cuerpo.rotation.x += (inclinacion - this.cuerpo.rotation.x) * Math.min(1, dt * 6);
    const rapidez = velocidad.length();
    const ondear = Math.min(1.25, rapidez * 0.045) + Math.sin(t * (6 + rapidez * 0.3)) * Math.min(0.12, rapidez * 0.006);
    this.capa.rotation.x += (Math.max(0.05, ondear) - this.capa.rotation.x) * Math.min(1, dt * 5);
  }
}
