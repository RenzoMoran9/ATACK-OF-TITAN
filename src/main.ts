import * as THREE from 'three';
import { BuclePasoFijo } from './core/bucle';
import { config } from './core/config';
import { urlDepuracion, type Hora } from './core/depuracion';
import { Entrada } from './core/entrada';
import { Fisica } from './core/fisica';
import { CamaraTercera } from './player/camara';
import { Jugador } from './player/jugador';
import { Hud } from './ui/hud';
import { crearPanel } from './ui/panel';
import { Cielo } from './world/cielo';
import { ajustarNoche } from './world/materiales';
import { construirMundo } from './world/mundo';

declare global {
  interface Window {
    /** true cuando la escena está construida y se han dibujado varios fotogramas (lo usa scripts/capturas.ts). */
    __juegoListo?: boolean;
    __juego?: { hora: Hora; cam: string | null; puntos: string[]; estado: () => EstadoDepuracion };
  }
}

/** Instantánea del jugador para pruebas automáticas desde Playwright. */
interface EstadoDepuracion {
  pos: number[];
  vel: number[];
  enSuelo: boolean;
  gas: number;
  ganchos: string[];
  apuntes: boolean[];
}

async function iniciar(): Promise<void> {
  const app = document.getElementById('app')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = config.render.sombras;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(config.camara.fovBase, window.innerWidth / window.innerHeight, 0.1, 7000);

  const fisica = await Fisica.crear(config.fisica.gravedad);
  const cielo = new Cielo(escena, config.render.radioSombra, config.render.tamanoSombra);
  const mundo = construirMundo(escena, fisica, config);
  fisica.paso(1 / config.fisica.hz); // construye la estructura de consultas antes del primer rayo

  const jugador = new Jugador(escena, fisica, mundo.inicio);
  const rig = new CamaraTercera(camara, fisica, () => jugador.collider);
  const entrada = new Entrada(renderer.domElement);
  const hud = new Hud(document.body, urlDepuracion.hud);

  const cambiarHora = (h: Hora) => {
    cielo.aplicar(h, renderer);
    ajustarNoche(mundo.mats, cielo.esDeNoche);
    mundo.antorchas.encender(cielo.esDeNoche);
    mundo.bosque.ajustarHora(h, cielo.dirSol);
  };
  const irA = (nombre: string) => {
    const p = mundo.puntos[nombre];
    if (!p) return;
    jugador.teletransportar(p.jugador, p.rumbo);
    rig.fijarPose(p.camara, p.mirar);
  };
  cambiarHora(urlDepuracion.hora);

  const panel = crearPanel(Object.keys(mundo.puntos), urlDepuracion.hora, {
    cambiarHora,
    irA,
    sombras: (si) => {
      renderer.shadowMap.enabled = si;
      cielo.sol.castShadow = si;
      escena.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true;
      });
    },
    gasInfinito: (si) => (jugador.odm.gasInfinito = si),
    mostrarFps: (si) => (hud.mostrarFps = si),
  }, urlDepuracion.debug);
  hud.mostrarFps = urlDepuracion.debug;
  entrada.onTeclaEspecial = (code) => {
    if (code === 'F1') panel._hidden ? panel.show() : panel.hide();
  };

  if (urlDepuracion.cam) {
    if (mundo.puntos[urlDepuracion.cam]) irA(urlDepuracion.cam);
    else console.warn(`?cam=${urlDepuracion.cam} no existe. Opciones: ${Object.keys(mundo.puntos).join(', ')}`);
  }
  const modoCaptura = urlDepuracion.cam !== null;
  hud.mostrarInicio(!modoCaptura);
  document.querySelector('.inicio')?.addEventListener('click', () => renderer.domElement.requestPointerLock());
  document.addEventListener('pointerlockchange', () => {
    hud.mostrarInicio(document.pointerLockElement !== renderer.domElement && !modoCaptura);
  });

  window.addEventListener('resize', () => {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let pasosEnFotograma = 0;
  let tiempo = 0;
  let fotogramas = 0;
  const actualizar = (dt: number) => {
    jugador.paso(dt, entrada, { dir: rig.dir, yaw: rig.yaw });
    fisica.paso(dt);
    // Recarga de gas junto al depósito de la plaza
    const dep = mundo.ciudad.deposito;
    if (Math.hypot(jugador.pos.x - dep.x, jugador.pos.z - dep.z) < config.gas.radioRecarga && jugador.pos.y < 3) {
      jugador.gas.recargar(config.gas.recargaPorSegundo * dt);
    }
    pasosEnFotograma++;
  };

  const dibujar = (alfa: number, dt: number) => {
    tiempo += dt;
    const { dx, dy } = entrada.raton();
    rig.girar(dx, dy);
    jugador.dibujar(alfa, dt, tiempo);
    rig.actualizar(dt, jugador.posRender, jugador.vel);
    jugador.odm.apuntar(camara.position, rig.dir, camara.up, jugador.pos);
    cielo.seguir(jugador.posRender, camara);
    mundo.antorchas.actualizar(dt, camara.position, tiempo);
    for (const t of mundo.titanes) t.actualizar(tiempo);
    hud.actualizar(dt, jugador, camara, window.innerWidth, window.innerHeight);
    renderer.render(escena, camara);
    if (pasosEnFotograma > 0) {
      entrada.finFotograma();
      pasosEnFotograma = 0;
    }
    if (++fotogramas === 8) {
      window.__juegoListo = true;
      console.info(
        `[juego] listo: ${mundo.ciudad.casas.length} casas, ${mundo.bosque.datos.arboles.length} árboles, ` +
          `${renderer.info.render.calls} llamadas de dibujo, ${renderer.info.render.triangles} triángulos`,
      );
    }
  };

  window.__juego = {
    hora: urlDepuracion.hora,
    cam: urlDepuracion.cam,
    puntos: Object.keys(mundo.puntos),
    estado: () => ({
      pos: jugador.pos.toArray(),
      vel: jugador.vel.toArray(),
      enSuelo: jugador.enSuelo,
      gas: jugador.gas.nivel,
      ganchos: jugador.odm.ganchos.map((g) => g.estado),
      apuntes: jugador.odm.apuntes.map((a) => a.valido),
    }),
  };
  new BuclePasoFijo(1 / config.fisica.hz, actualizar, dibujar).iniciar();
}

iniciar().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:20px">Error al iniciar: ${String(e)}</pre>`;
});
