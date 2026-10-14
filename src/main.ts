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
import { CapMundo } from './missions/capitulos/mundo';
import { ANCHO_ZONA } from './missions/logicaCampamento';
import { CicloDia } from './core/cicloDia';
import { Hud } from './ui/hud';
import { MandoEscuadron } from './ui/ordenes';
import { Brujula } from './ui/brujula';
import { Mapa } from './ui/mapa';
import { Pantallas } from './ui/pantallas';
import { crearPanel } from './ui/panel';
import { Cielo, HORA_DE } from './world/cielo';
import { ajustarNoche } from './world/materiales';
import { actualizarMundo, ajustarHoraMundo, construirMundo, depositoMasCercano } from './world/mundo';
import { AmbienteBosque } from './world/ambiente';
import { Linterna } from './player/linterna';
import { Calidad, PERFILES, guardarModo, modoGuardado } from './core/calidad';
import { Sonido } from './audio/sonido';
import { SonidosJuego } from './audio/sonidosJuego';
import { ControlesTactiles, esDispositivoTactil } from './ui/tactil';
import { alternarPantallaCompleta, esIOS, registrarServiceWorker } from './ui/pantallaCompleta';
import { aplicarLimite, puntoDentro } from './world/region';

declare global {
  interface Window {
    /** true cuando la escena está construida y se han dibujado varios fotogramas (lo usa scripts/capturas.ts). */
    __juegoListo?: boolean;
    __juego?: { hora: Hora; cam: string | null; puntos: string[]; estado: () => EstadoDepuracion; ctx?: unknown; campana?: unknown; rig?: unknown; mando?: unknown; renderer?: unknown; sonido?: unknown };
  }
}

// Juego instalable y disponible sin conexión (public/sw.js); fuera de un servidor no hace nada
registrarServiceWorker();

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
  // Celular o tableta: controles táctiles y gráficos ligeros (src/core/calidad.ts)
  const tactil = esDispositivoTactil(urlDepuracion.tactil);
  if (tactil) {
    // cada luz encarece cada píxel; menos antorchas con luz de verdad
    config.render.maxAntorchasConLuz = PERFILES.media.antorchasConLuz;
    config.render.tamanoSombra = PERFILES.media.tamanoSombra;
  }
  // sin antialias en el celular: con la resolución adaptable cuesta más de lo que luce
  const renderer = new THREE.WebGLRenderer({ antialias: !tactil, powerPreference: 'high-performance' });
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
  // Reloj del mundo: hora y día (src/core/cicloDia.ts); el cielo lo sigue cada fotograma
  const ciclo = new CicloDia();
  ciclo.hora = HORA_DE[urlDepuracion.hora];
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
    ciclo,
    orientarCamara: (p) => rig.mirarA(p),
  };
  ctx.titanes = new GestorTitanes(ctx);
  ctx.civiles = new GestorCiviles(ctx);
  const escuadron = new Escuadron(ctx);
  ctx.escuadron = escuadron;
  ctx.suministros = new Suministros(ctx);
  jugador.conectar(ctx);
  const hud = new Hud(document.body, urlDepuracion.hud, ctx);
  // Orientación en el mundo abierto: brújula arriba y mapa con M
  const brujula = new Brujula(document.body, urlDepuracion.hud);
  const mapa = new Mapa(document.body);
  // ── Órdenes al escuadrón: 1-8 a la selección, Tab elige a quién (src/ui/ordenes.ts) ──
  const mando = new MandoEscuadron(ctx, () => ({ origen: camara.position, dir: rig.dir, excluir: jugador.collider }));
  // Muerte del jugador: fundido y reaparición
  let muertoDesde = -1;
  let avisoBorde = false;
  /**
   * Plano del titán que te tiene en la mano (o que te está masticando): tres cuartos de
   * frente, a la altura de su cara, para ver la mano, la boca y el mordisco.
   */
  const encuadreTitan = (): { pos: THREE.Vector3; mirar: THREE.Vector3 } | null => {
    const titan = jugador.agarradoPor ?? (!jugador.vivo ? jugador.devoradoPor : null);
    if (!titan) return null;
    const H = titan.altura;
    const cabeza = titan.cabeza();
    const frente = new THREE.Vector3(Math.sin(titan.rumbo), 0, Math.cos(titan.rumbo));
    const derecha = new THREE.Vector3(Math.cos(titan.rumbo), 0, -Math.sin(titan.rumbo));
    const deseo = cabeza.clone().addScaledVector(frente, 0.35 * H + 2.5).addScaledVector(derecha, -(0.25 * H + 1.5)).add(new THREE.Vector3(0, 0.02 * H, 0));
    // que no se meta en una pared o un tejado entre la cara del titán y la cámara
    const hacia = deseo.clone().sub(cabeza);
    const largo = hacia.length();
    hacia.divideScalar(largo);
    // el rayo sale ya fuera de la cabeza del titán (si no, chocaría con ella)
    const choque = fisica.lanzarRayo(cabeza.clone().addScaledVector(hacia, 0.2 * H), hacia, largo - 0.2 * H, jugador.collider);
    const pos = choque && choque.etiqueta !== 'titan' && choque.etiqueta !== 'nuca' ? choque.punto.addScaledVector(hacia, -1) : deseo;
    pos.y = Math.max(pos.y, 1.5);
    const mirar = jugador.agarradoPor ? cabeza.clone().lerp(jugador.posRender, 0.4) : cabeza;
    return { pos, mirar };
  };

  // Capturas (?cam=...): escena fija con los titanes de referencia congelados, sin menús.
  // Si no, campaña por capítulos con su menú.
  const modoCaptura = urlDepuracion.cam !== null || urlDepuracion.poses;
  entrada.tactil = tactil;
  let campana: Campana | null = null;
  let calidad: Calidad | null = null;
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
    campana = new Campana(ctx, [new CapMundo()]);
    escuadron.depositoDisponible = () => campana?.depositoDisponible() ?? true;
    pantallas = new Pantallas(campana, () => entrada.capturar(), tactil, {
      modo: () => calidad?.modo ?? 'auto',
      nivelAhora: () => calidad?.perfil.etiqueta ?? '',
      elegir: (m) => {
        if (!calidad) return;
        calidad.fijar(m);
        guardarModo(m);
      },
    });
  }
  // Móvil y tableta: joystick, arrastre de cámara y botones (src/ui/tactil.ts)
  const controlesTactiles = tactil && !modoCaptura
    ? new ControlesTactiles(entrada, {
        pausa: () => pantallas?.ponerPausa(true),
        pantallaCompleta: () =>
          void alternarPantallaCompleta().then((ok) => {
            if (!ok && esIOS()) ctx.eventos.emit({ tipo: 'mensaje', texto: 'En iPhone: Compartir → Añadir a pantalla de inicio', segundos: 4 });
          }),
      })
    : null;
  if (controlesTactiles && pantallas) pantallas.editarBotones = (alTerminar) => controlesTactiles.editar(alTerminar);

  // Bajo las copas de los bosques la niebla se cierra y la luz baja (src/world/ambiente.ts)
  const ambiente = new AmbienteBosque(escena, cielo.sol, cielo.hemi, mundo.bosques);
  // Linterna (L): se enciende sola la primera vez que todo se queda a oscuras
  const linterna = new Linterna(escena);
  const puntoLinterna = new THREE.Vector3();
  // Sonido (src/audio): empieza a cargar con el primer toque o tecla
  const sonido = new Sonido();
  const sonidos = new SonidosJuego(sonido, ctx, jugador);
  /** El mundo abierto en marcha (o null en el menú y en las capturas). */
  const mundoAbierto = (): CapMundo | null => (campana?.capitulo instanceof CapMundo ? campana.capitulo : null);
  sonidos.pueblos = () => mundoAbierto()?.pueblos ?? null;
  brujula.pueblos = sonidos.pueblos;
  if (pantallas) pantallas.guardar = () => mundoAbierto()?.guardar() ?? false;
  sonidos.campamento = () => mundoAbierto()?.campamento ?? null;
  brujula.campamento = sonidos.campamento;
  hud.obraMartillo = () => {
    const c = mundoAbierto()?.campamento;
    const o = c && c.obraJugador >= 0 ? c.obras[c.obraJugador] : null;
    return c && o ? { aguja: c.aguja, zona: c.zona, ancho: ANCHO_ZONA, progreso: o.progreso } : null;
  };
  mapa.pueblos = sonidos.pueblos;
  const derechaCamara = new THREE.Vector3();
  const alternarSonido = () => {
    sonido.desbloquear();
    const mudo = sonido.alternarSilencio();
    ctx.eventos.emit({ tipo: 'mensaje', texto: mudo ? 'Sonido apagado (N)' : 'Sonido encendido', segundos: 1.2 });
  };
  const alternarLinterna = () => {
    sonido.tocar('click', { volumen: 0.5 });
    const on = linterna.alternar();
    ctx.eventos.emit({ tipo: 'mensaje', texto: on ? 'Linterna encendida' : 'Linterna apagada', segundos: 1.2 });
  };
  let factorDistancia = 1;
  /** Hora del ciclo aplicada al cielo por última vez (para no recalcularlo si no cambia). */
  let horaCielo = -1;
  let horaBosques = -1;
  let nocheAntes: boolean | null = null;
  const aplicarCielo = (forzar = false) => {
    const h = ciclo.hora;
    if (!forzar && Math.abs(h - horaCielo) < 0.004) return;
    horaCielo = h;
    cielo.factorDistancia = factorDistancia;
    cielo.aplicarHora(h, renderer);
    ajustarNoche(mundo.mats, cielo.noche);
    if (nocheAntes !== cielo.esDeNoche) {
      nocheAntes = cielo.esDeNoche;
      mundo.antorchas.encender(cielo.esDeNoche);
    }
    // los haces de los bosques se reorientan cada ~6 minutos de juego
    if (forzar || Math.abs(h - horaBosques) > 0.1) {
      horaBosques = h;
      ajustarHoraMundo(mundo, cielo.noche, cielo.calidez, cielo.dirSol);
    }
    ambiente.tomarBase(cielo.noche);
  };
  /** Menos calidad, menos distancia de dibujado: la niebla tapa el corte. */
  const ajustarLejania = () => {
    camara.far = factorDistancia < 1 ? Math.max(700, cielo.lejaniaDia * 1.1) : 5000;
    camara.updateProjectionMatrix();
    cielo.ajustarLejania(camara.far);
  };
  /** Hora fija (panel F1, capturas): salta el reloj a la hora típica de ese momento. */
  const cambiarHora = (h: Hora) => {
    ciclo.hora = HORA_DE[h];
    cielo.hora = h;
    aplicarCielo(true);
  };
  const irA = (nombre: string) => {
    const p = mundo.puntos[nombre];
    if (!p) return;
    jugador.teletransportar(p.jugador, p.rumbo);
    rig.fijarPose(p.camara, p.mirar);
  };
  ciclo.congelado = modoCaptura;
  aplicarCielo(true);

  // Calidad gráfica: Automático o un nivel fijo, lo elige el jugador en la pausa. Sin elección,
  // nivel fijo: Alto en el ordenador y Medio en el celular (src/core/calidad.ts)
  calidad = new Calidad(modoGuardado() ?? (tactil ? 'media' : 'alta'), tactil ? 'media' : 'alta', window.devicePixelRatio || 1, (perfil, resolucion, nivelCambiado) => {
    renderer.setPixelRatio(resolucion);
    if (!nivelCambiado) return;
    const sombras = perfil.sombras && config.render.sombras;
    const sombraCambia = renderer.shadowMap.enabled !== sombras || cielo.sol.shadow.mapSize.x !== perfil.tamanoSombra;
    renderer.shadowMap.enabled = sombras;
    cielo.sol.castShadow = sombras;
    if (cielo.sol.shadow.mapSize.x !== perfil.tamanoSombra) {
      cielo.sol.shadow.mapSize.set(perfil.tamanoSombra, perfil.tamanoSombra);
      cielo.sol.shadow.map?.dispose();
      cielo.sol.shadow.map = null;
    }
    if (sombraCambia) {
      escena.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true;
      });
    }
    factorDistancia = perfil.distancia;
    ajustarLejania();
    aplicarCielo(true);
  });

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
    if (!capturado && !entrada.sinCaptura) {
      pantallas?.ponerPausa(true);
      mundoAbierto()?.guardar();
    }
  });
  // al cambiar de pestaña o cerrar la app, se guarda la partida
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mundoAbierto()?.guardar();
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
      mapa.cerrar();
      pasosEnFotograma++;
      return;
    }
    reloj.t += dt;
    if (campana?.jugando && ciclo.avanzar(dt)) ctx.eventos.emit({ tipo: 'mensaje', texto: `Día ${ciclo.dia}`, segundos: 2 });
    mando.actualizar();
    if (entrada.consumir('KeyM')) mapa.alternar();
    if (entrada.consumir('KeyL')) alternarLinterna();
    if (entrada.consumir('KeyN')) alternarSonido();
    // G: recoger el equipo de un caído o, si no hay ninguno al lado, pedir gas a un compañero
    if (entrada.consumir('KeyG') && jugador.vivo && !mundoAbierto()?.martillazo()) {
      const recogido = ctx.suministros.recoger();
      if (recogido) ctx.eventos.emit({ tipo: 'mensaje', texto: recogido, segundos: 3 });
      else if (jugador.gas.nivel >= jugador.gas.capacidad * 0.9) ctx.eventos.emit({ tipo: 'mensaje', texto: 'Gas casi lleno', segundos: 1 });
      else if (!ctx.escuadron.pedirGas()) ctx.eventos.emit({ tipo: 'mensaje', texto: 'Nadie puede pasarte gas', segundos: 1.5 });
    }
    jugador.paso(dt, entrada, { dir: rig.dir, yaw: rig.yaw });
    // Borde de la región: viento en contra y, muy lejos, de vuelta dentro
    const fuera = aplicarLimite(jugador.pos, jugador.vel, dt);
    if (fuera > 0 && !avisoBorde) {
      avisoBorde = true;
      ctx.eventos.emit({ tipo: 'mensaje', texto: 'Viento en contra: vuelve', segundos: 2 });
    } else if (fuera === 0) avisoBorde = false;
    if (fuera >= 1) {
      const dentro = puntoDentro(jugador.pos.x, jugador.pos.z);
      jugador.teletransportar(new THREE.Vector3(dentro.x, 0, dentro.z));
    }
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
    jugador.caballo?.dibujar(alfa, dt * bucleRef.escalaTiempo);
    laboratorio?.actualizar(dt, tiempo);
    rig.sacudida = jugador.combate?.sacudida ?? 0;
    rig.agarrado = jugador.agarradoPor !== null;
    rig.encuadre = encuadreTitan();
    rig.actualizar(dt, jugador.posRender, jugador.vel);
    // con la cámara metida en el personaje (rincones), se oculta para no tapar la vista
    jugador.modelo.grupo.visible = jugador.vivo && rig.distancia > 0.8;
    // con una parte del titán fijada (X), los ganchos van a ella aunque la mira esté en otro sitio
    const fijado = jugador.combate?.puntoFijado;
    const dirGanchos = fijado && fijado.centro.distanceTo(jugador.pos) < config.odm.alcanceCable ? fijado.centro.clone().sub(camara.position).normalize() : rig.dir;
    jugador.odm.apuntar(camara.position, dirGanchos, camara.up, jugador.pos);
    aplicarCielo();
    if ((fotogramas & 31) === 0) mundo.antorchas.refrescar();
    cielo.seguir(jugador.posRender, camara);
    mundo.antorchas.actualizar(dt, camara.position, tiempo);
    ambiente.actualizar(dt, camara.position);
    if (!linterna.manual && !linterna.encendida && jugador.vivo && !modoCaptura && (ambiente.mezcla > 0.55 || cielo.esDeNoche)) {
      linterna.encendida = true;
    }
    linterna.actualizar(dt, jugador.posRender, rig.dir, jugador.modelo.puntoLinterna(puntoLinterna), jugador.vivo, tiempo);
    actualizarMundo(mundo, dt, camara.position, escena.fog instanceof THREE.Fog ? escena.fog.far : 3000);
    ctx.titanes.dibujar(dt, tiempo);
    ctx.escuadron.dibujar(dt, tiempo);
    mando.dibujar(tiempo);
    brujula.actualizar(ctx, rig.yaw);
    mapa.actualizar(ctx, rig.yaw);
    ctx.civiles.dibujar(dt, tiempo);
    ctx.suministros.dibujar(tiempo);
    ctx.efectos.actualizar(dt * bucleRef.escalaTiempo);
    hud.actualizar(dt, ctx, jugador, campana, window.innerWidth, window.innerHeight);
    if (controlesTactiles) {
      controlesTactiles.visible = !(pantallas?.bloqueaJuego ?? false) || controlesTactiles.editando;
      const c = jugador.caballo;
      const alLado = !!c && c.grupo.visible && jugador.vivo && !jugador.agarradoPor && Math.hypot(c.pos.x - jugador.pos.x, c.pos.z - jugador.pos.z) < 3.5 && jugador.pos.y < 4;
      const obra = !jugador.montado && (mundoAbierto()?.campamento?.obraJugador ?? -1) >= 0;
      controlesTactiles.contextual(
        obra ? { icono: '⚒', texto: 'MARTILLO', tecla: 'KeyG' } : jugador.montado ? { icono: '♞', texto: 'BAJAR', tecla: 'KeyC' } : alLado ? { icono: '♞', texto: 'MONTAR', tecla: 'KeyC' } : null,
      );
      controlesTactiles.acelerar(jugador.montado);
      controlesTactiles.marcado(!!jugador.combate?.puntoFijado);
    }
    derechaCamara.setFromMatrixColumn(camara.matrixWorld, 0);
    calidad?.medir(dt, !(pantallas?.bloqueaJuego ?? false) && !modoCaptura);
    sonidos.actualizar(dt, (pantallas?.bloqueaJuego ?? false) || modoCaptura, camara.position, derechaCamara, ambiente.mezcla, cielo.esDeNoche);
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
    mando,
    renderer,
    sonido,
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
