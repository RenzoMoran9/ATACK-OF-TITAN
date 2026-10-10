import * as THREE from 'three';
import { BuclePasoFijo } from './core/bucle';
import { config } from './core/config';
import { urlDepuracion, type Hora } from './core/depuracion';
import { CivilesNulos, EscuadronNulo, TitanesNulos, type ContextoJuego, type Reloj } from './core/contexto';
import { Entrada } from './core/entrada';
import { Eventos } from './core/eventos';
import { Fisica } from './core/fisica';
import { Poblacion } from './core/poblacion';
import { Efectos } from './combat/efectos';
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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

  // ── Contexto de juego compartido por todos los sistemas ──
  const poblacion = new Poblacion();
  poblacion.agregarHumano(jugador);
  let restanteLenta = 0;
  const bucleRef: { escalaTiempo: number } = { escalaTiempo: 1 };
  const reloj: Reloj = {
    t: 0,
    get escala() {
      return bucleRef.escalaTiempo;
    },
    camaraLenta(escala, segundosReales) {
      bucleRef.escalaTiempo = escala;
      restanteLenta = segundosReales;
    },
  };
  const ctx: ContextoJuego = {
    escena,
    camara,
    fisica,
    nav: mundo.nav,
    poblacion,
    eventos: new Eventos(),
    efectos: new Efectos(escena),
    mundo,
    entrada,
    reloj,
    jugador,
    titanes: new TitanesNulos(poblacion),
    escuadron: new EscuadronNulo(),
    civiles: new CivilesNulos(),
    puntoReaparicion: mundo.inicio.clone(),
    esDeNoche: () => cielo.esDeNoche,
  };
  // Modo libre: los titanes de referencia en la llanura
  for (const o of mundo.titanesReferencia) ctx.titanes.generar(o);
  if (urlDepuracion.cam) ctx.titanes.congelado = true;

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
  document.querySelector('.inicio')?.addEventListener('click', async () => {
    // Sin pointer lock (algunos visores lo bloquean) se juega igual: clics directos y cámara con cursor/flechas.
    if (!(await entrada.capturar())) hud.mostrarInicio(false);
  });
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
    reloj.t += dt;
    jugador.paso(dt, entrada, { dir: rig.dir, yaw: rig.yaw });
    ctx.titanes.actualizar(dt);
    ctx.escuadron.actualizar(dt);
    ctx.civiles.actualizar(dt);
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
    if (restanteLenta > 0) {
      restanteLenta -= dt;
      if (restanteLenta <= 0) bucleRef.escalaTiempo = 1;
    }
    const { dx, dy } = entrada.raton();
    // Flechas: giro de cámara alternativo (útil cuando el visor no permite capturar el ratón)
    const fx = (entrada.mantenida('ArrowRight') ? 1 : 0) - (entrada.mantenida('ArrowLeft') ? 1 : 0);
    const fy = (entrada.mantenida('ArrowDown') ? 1 : 0) - (entrada.mantenida('ArrowUp') ? 1 : 0);
    rig.girar(dx + fx * 900 * dt, dy + fy * 600 * dt);
    jugador.dibujar(alfa, dt, tiempo);
    rig.actualizar(dt, jugador.posRender, jugador.vel);
    jugador.odm.apuntar(camara.position, rig.dir, camara.up, jugador.pos);
    cielo.seguir(jugador.posRender, camara);
    mundo.antorchas.actualizar(dt, camara.position, tiempo);
    ctx.titanes.dibujar(dt, tiempo);
    ctx.escuadron.dibujar(dt, tiempo);
    ctx.civiles.dibujar(dt, tiempo);
    ctx.efectos.actualizar(dt * bucleRef.escalaTiempo);
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
  const bucle = new BuclePasoFijo(1 / config.fisica.hz, actualizar, dibujar);
  Object.defineProperty(bucleRef, 'escalaTiempo', {
    get: () => bucle.escalaTiempo,
    set: (v: number) => (bucle.escalaTiempo = v),
  });
  bucle.iniciar();
}

iniciar().catch((e) => {
  console.error(e);
  const texto = String(e);
  const aviso = /wasm|webassembly|compile/i.test(texto)
    ? 'Este navegador o visor no permite WebAssembly, que necesita el motor de física. Prueba en Chrome, Edge o Firefox de escritorio, o en local con npm run dev.'
    : 'Prueba a recargar la página. Si se repite, ejecútalo en local con npm run dev.';
  const caja = document.createElement('div');
  caja.className = 'error-inicio';
  const titulo = document.createElement('h2');
  titulo.textContent = 'No se pudo iniciar el juego';
  const p = document.createElement('p');
  p.textContent = aviso;
  const detalle = document.createElement('pre');
  detalle.textContent = texto;
  caja.append(titulo, p, detalle);
  document.body.replaceChildren(caja);
});
