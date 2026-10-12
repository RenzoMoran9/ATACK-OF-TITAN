import * as THREE from 'three';
import { BuclePasoFijo } from './core/bucle';
import { config } from './core/config';
import { urlDepuracion, type Hora } from './core/depuracion';
import { CivilesNulos, EscuadronNulo, TitanesNulos, type ContextoJuego, type Reloj } from './core/contexto';
import { GestorTitanes } from './titans/gestor';
import { Escuadron } from './npc/escuadron';
import { Suministros } from './combat/suministros';
import { LaboratorioPoses } from './player/laboratorio';
import { Entrada } from './core/entrada';
import { Eventos } from './core/eventos';
import { Fisica } from './core/fisica';
import { Poblacion } from './core/poblacion';
import { Efectos } from './combat/efectos';
import { CamaraTercera } from './player/camara';
import { Jugador } from './player/jugador';
import { Campana } from './missions/campana';
import { GestorCiviles } from './npc/civiles';
import { CapEntrenamiento } from './missions/capitulos/entrenamiento';
import { CapLibre } from './missions/capitulos/libre';
import { CapTrost } from './missions/capitulos/trost';
import { Hud } from './ui/hud';
import { Pantallas } from './ui/pantallas';
import { crearPanel } from './ui/panel';
import { Cielo } from './world/cielo';
import { ajustarNoche } from './world/materiales';
import { construirMundo, depositoMasCercano } from './world/mundo';

declare global {
  interface Window {
    /** true cuando la escena está construida y se han dibujado varios fotogramas (lo usa scripts/capturas.ts). */
    __juegoListo?: boolean;
    __juego?: { hora: Hora; cam: string | null; puntos: string[]; estado: () => EstadoDepuracion; ctx?: unknown; campana?: unknown; rig?: unknown };
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
  const camara = new THREE.PerspectiveCamera(config.camara.fovBase, window.innerWidth / window.innerHeight, 0.3, 5000);

  const fisica = await Fisica.crear(config.fisica.gravedad);
  const cielo = new Cielo(escena, config.render.radioSombra, config.render.tamanoSombra);
  const mundo = construirMundo(escena, fisica, config);
  fisica.paso(1 / config.fisica.hz); // construye la estructura de consultas antes del primer rayo

  const jugador = new Jugador(escena, fisica, mundo.inicio);
  const rig = new CamaraTercera(camara, fisica, () => jugador.collider);
  jugador.alOrientar = (rumbo) => rig.orientar(rumbo);
  const entrada = new Entrada(renderer.domElement);

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
    suministros: null as unknown as Suministros,
    puntoReaparicion: mundo.inicio.clone(),
    esDeNoche: () => cielo.esDeNoche,
    orientarCamara: (p) => rig.mirarA(p),
  };
  ctx.titanes = new GestorTitanes(ctx);
  ctx.civiles = new GestorCiviles(ctx);
  ctx.escuadron = new Escuadron(ctx);
  ctx.suministros = new Suministros(ctx);
  jugador.conectar(ctx);
  const hud = new Hud(document.body, urlDepuracion.hud, ctx);
  // Órdenes al escuadrón con 1-4
  const ORDENES = { Digit1: 'seguir', Digit2: 'atacar', Digit3: 'proteger', Digit4: 'retirada' } as const;
  const NOMBRES_ORDEN = { seguir: 'Seguidme', atacar: 'Atacad', proteger: 'Proteged a los civiles', retirada: 'Retirada' } as const;
  // Muerte del jugador: fundido y reaparición
  let muertoDesde = -1;

  // Capturas (?cam=...): escena fija con los titanes de referencia congelados, sin menús.
  // Si no, campaña por capítulos con su menú.
  const modoCaptura = urlDepuracion.cam !== null || urlDepuracion.poses;
  let campana: Campana | null = null;
  let pantallas: Pantallas | null = null;
  let laboratorio: LaboratorioPoses | null = null;
  if (urlDepuracion.poses) {
    laboratorio = new LaboratorioPoses(escena, mundo.inicio.clone().add(new THREE.Vector3(0, 0, 20)));
    jugador.teletransportar(mundo.inicio.clone().add(new THREE.Vector3(30, 0, 40)));
    rig.fijarPose(laboratorio.camara, laboratorio.mirar);
  } else if (modoCaptura) {
    for (const o of mundo.titanesReferencia) ctx.titanes.generar(o);
    ctx.titanes.congelado = true;
  } else {
    campana = new Campana(ctx, [new CapEntrenamiento(), new CapTrost(), new CapLibre()]);
    pantallas = new Pantallas(campana, () => entrada.capturar());
  }

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
  // Soltar el ratón (Esc) pausa la partida
  document.addEventListener('pointerlockchange', () => {
    const capturado = document.pointerLockElement === renderer.domElement;
    if (!capturado && !entrada.sinCaptura) pantallas?.ponerPausa(true);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && entrada.sinCaptura) pantallas?.ponerPausa(!pantallas.pausado);
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
    // En menús y en pausa el mundo se queda quieto (se sigue dibujando)
    if (pantallas?.bloqueaJuego) {
      pasosEnFotograma++;
      return;
    }
    reloj.t += dt;
    for (const [tecla, orden] of Object.entries(ORDENES)) {
      if (entrada.consumir(tecla) && ctx.escuadron.soldados.length > 0) {
        ctx.escuadron.ordenar(orden);
        ctx.eventos.emit({ tipo: 'mensaje', texto: `Orden: ${NOMBRES_ORDEN[orden]}`, segundos: 1.5 });
      }
    }
    // G: recoger el equipo de un caído o, si no hay ninguno al lado, pedir gas a un compañero
    if (entrada.consumir('KeyG') && jugador.vivo) {
      const recogido = ctx.suministros.recoger();
      if (recogido) ctx.eventos.emit({ tipo: 'mensaje', texto: recogido, segundos: 3 });
      else if (jugador.gas.nivel >= jugador.gas.capacidad * 0.9) ctx.eventos.emit({ tipo: 'mensaje', texto: 'Tienes el gas casi lleno', segundos: 1.5 });
      else if (!ctx.escuadron.pedirGas()) ctx.eventos.emit({ tipo: 'mensaje', texto: 'Nadie del escuadrón puede pasarte gas ahora', segundos: 2.5 });
    }
    jugador.paso(dt, entrada, { dir: rig.dir, yaw: rig.yaw });
    if (!jugador.vivo) {
      if (muertoDesde < 0) muertoDesde = reloj.t;
      else if (reloj.t - muertoDesde > 3.5) {
        muertoDesde = -1;
        jugador.revivir(ctx.puntoReaparicion);
      }
    }
    ctx.titanes.actualizar(dt);
    ctx.escuadron.actualizar(dt);
    ctx.civiles.actualizar(dt);
    campana?.actualizar(dt);
    fisica.paso(dt);
    // Recarga de gas y cuchillas junto a un depósito (plaza o puestos de avanzada)
    const dep = depositoMasCercano(mundo, jugador.pos);
    const enDeposito = dep.distancia < config.gas.radioRecarga && jugador.pos.y < dep.deposito.pos.y + 3;
    jugador.recargarEnDeposito(dt, enDeposito && (campana?.depositoDisponible() ?? true));
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
    jugador.dibujar(alfa, dt * bucleRef.escalaTiempo, tiempo);
    laboratorio?.actualizar(dt, tiempo);
    rig.sacudida = jugador.combate?.sacudida ?? 0;
    rig.agarrado = jugador.agarradoPor !== null;
    rig.actualizar(dt, jugador.posRender, jugador.vel);
    // con la cámara metida en el personaje (rincones), se oculta para no tapar la vista
    jugador.modelo.grupo.visible = jugador.vivo && rig.distancia > 0.8;
    jugador.odm.apuntar(camara.position, rig.dir, camara.up, jugador.pos);
    cielo.seguir(jugador.posRender, camara);
    mundo.antorchas.actualizar(dt, camara.position, tiempo);
    ctx.titanes.dibujar(dt, tiempo);
    ctx.escuadron.dibujar(dt, tiempo);
    ctx.civiles.dibujar(dt, tiempo);
    ctx.suministros.dibujar(tiempo);
    ctx.efectos.actualizar(dt * bucleRef.escalaTiempo);
    hud.actualizar(dt, ctx, jugador, campana, window.innerWidth, window.innerHeight);
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
    // Para pruebas automáticas (Playwright) y depuración en consola
    ctx,
    campana,
    rig,
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
