import type { Campana } from '../missions/campana';
import { ETIQUETA_MODO, MODOS_GRAFICOS, type ModoGraficos } from '../core/calidad';
import { textoHora } from '../core/cicloDia';
import { leerPartida } from '../missions/guardado';
import { alCambiarInstalable, enModoApp, entrarPantallaCompleta, alternarPantallaCompleta, esIOS, instalarApp, pantallaCompletaDisponible, puedeInstalarse } from './pantallaCompleta';

/**
 * Pantallas a pantalla completa: menú (continuar o empezar una partida del mundo abierto),
 * presentación, pausa y el resumen. Todo con DOM (sin librerías) y textos en español.
 */

const CONTROLES = `
  <ul class="controles">
    <li><b>Clic izq</b> tajo (mantén para cargar) · <b>Clic der</b> los dos ganchos a la mira <i>(mantener = recoger cable)</i></li>
    <li><b>Q / E</b> gancho izquierdo / derecho <b>automático</b>: se clava solo en lo que tengas a ese lado; mantén para balancearte (tipo Spider-Man) y suelta para salir despedido</li>
    <li>Llega recogiendo cable a un tronco o pared y <b>sigue sujetando</b>: te quedas agachado de lado en él</li>
    <li><b>Espacio</b> saltar · mantenido: <b>salto con gas</b> hasta 10 m (con WASD, te lanza hacia delante) · en el aire: frena o planea</li>
    <li><b>Shift</b> (mantener) correr, gasta aguante · Shift o Espacio justo antes de tocar el suelo: rodada</li>
    <li><b>F</b> también da el tajo · <b>R</b> cambiar cuchillas · <b>WASD</b> mover · <b>Ratón/flechas</b> cámara</li>
    <li>Cuando un titán cierra la mano sobre ti, <b>impulso o gancho nuevo justo a tiempo</b>: lo esquivas · volando bajo junto a un tobillo, el tajo va al <b>tendón</b></li>
    <li><b>B</b> bengala (en la cara, lo ciega 3 s) · <b>X</b> fijar parte del titán (nuca, ojos, brazos, corvas…) · <b>C</b> caballo: montar / bajar / silbar · <b>V</b> acelerar a caballo (gasta el aliento)</li>
    <li><b>H</b> descansar hasta el amanecer (de noche, en un refugio)</li>
    <li><b>1</b> seguidme · <b>2</b> atacad · <b>3</b> proteged a los civiles · <b>4</b> retirada · <b>5</b> esperad aquí · <b>6</b> id allí · <b>7</b> atacad a ese titán · <b>8</b> explorad</li>
    <li><b>L</b> linterna · <b>M</b> mapa · <b>G</b> recoger equipo / pedir gas · <b>N</b> sonido sí/no</li>
    <li><b>Tab</b> a quién mandas (todos o uno) · <b>F1/P</b> ajustes · <b>Esc</b> pausa</li>
  </ul>`;

const CONTROLES_TACTILES = `
  <ul class="controles">
    <li><b>Dedo izquierdo</b> joystick para moverte · empújalo hasta el borde para <b>correr</b></li>
    <li><b>Dedo derecho</b> arrastra para mirar · <b>GANCHOS</b> mantener = recoger cable · <b>TAJO</b> mantener = cargar</li>
    <li><b>SALTO/GAS</b> toque = salto; mantenido = sube con gas hasta 10 m (con joystick, te lanza hacia delante); en el aire frena</li>
    <li><b>◀ GANCHO</b> (pulgar izquierdo) y <b>GANCHO ▶</b> (pulgar derecho): se clavan solos a ese lado; mantén para balancearte y suelta para salir despedido</li>
    <li>Mientras mantienes un botón de acción, arrástralo para apuntar · arriba: cuchillas, bengala, parte, caballo, descansar, luz, mapa, órdenes, pausa</li>
    <li>Cuando un titán cierra la mano sobre ti, <b>salto/gas o un gancho justo a tiempo</b>: lo esquivas</li>
  </ul>`;

function escapar(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class Pantallas {
  private readonly raiz: HTMLDivElement;
  pausado = false;
  /** Guarda la partida ahora (lo pone main.ts); devuelve si se ha podido. */
  guardar: (() => boolean) | null = null;
  /** En el celular: abre el modo de mover botones (se le pasa qué hacer al terminar). */
  editarBotones: ((alTerminar: () => void) => void) | null = null;

  /**
   * `pedirCaptura` intenta capturar el ratón (devuelve si lo consiguió);
   * se llama desde un clic del usuario, como exige el navegador.
   */
  constructor(
    private readonly campana: Campana,
    private readonly pedirCaptura: () => Promise<boolean>,
    private readonly tactil = false,
    /** Gráficos en la pausa: el modo elegido, cambiarlo y el nivel que se usa ahora (en automático). */
    private readonly graficos: { modo: () => ModoGraficos; elegir: (m: ModoGraficos) => void; nivelAhora: () => string } | null = null,
  ) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'pantalla';
    document.body.appendChild(this.raiz);
    campana.alCambiar = () => this.mostrar();
    alCambiarInstalable(() => {
      if (this.campana.estado === 'menu') this.mostrar();
    });
    this.mostrar();
  }

  private get controles(): string {
    return this.tactil ? CONTROLES_TACTILES : CONTROLES;
  }

  /** Botones de pantalla completa e instalación como app (y la pista para iPhone). */
  private filaApp(): HTMLDivElement {
    const fila = document.createElement('div');
    fila.className = 'botones app';
    if (!enModoApp()) {
      if (pantallaCompletaDisponible()) fila.appendChild(this.boton('⛶ Pantalla completa', () => void alternarPantallaCompleta()));
      if (puedeInstalarse()) fila.appendChild(this.boton('⤓ Instalar como app', () => void instalarApp()));
      if (esIOS()) fila.insertAdjacentHTML('beforeend', '<p class="pista">En iPhone/iPad: botón <b>Compartir</b> → <b>Añadir a pantalla de inicio</b> para jugar a pantalla completa, como una app.</p>');
    }
    return fila;
  }

  /** Pausa al soltar el ratón (Esc) mientras se juega. */
  ponerPausa(si: boolean): void {
    if (!this.campana.jugando) return;
    this.pausado = si;
    this.mostrar();
  }

  get bloqueaJuego(): boolean {
    return this.pausado || !this.campana.jugando;
  }

  /** Automático, Alto, Medio o Bajo: el elegido queda marcado. Con Automático, dice qué nivel usa ahora. */
  private selectorGraficos(g: { modo: () => ModoGraficos; elegir: (m: ModoGraficos) => void; nivelAhora: () => string }): HTMLDivElement {
    const caja = document.createElement('div');
    caja.className = 'graficos';
    const titulo = document.createElement('p');
    titulo.textContent = 'Gráficos';
    const fila = document.createElement('div');
    fila.className = 'botones';
    const botones = new Map<ModoGraficos, HTMLButtonElement>();
    const ahora = document.createElement('small');
    const pintar = () => {
      for (const [m, b] of botones) b.classList.toggle('activo', g.modo() === m);
      ahora.textContent = g.modo() === 'auto' ? `Ahora: ${g.nivelAhora()}` : '';
    };
    for (const m of MODOS_GRAFICOS) {
      const b = this.boton(ETIQUETA_MODO[m], () => {
        g.elegir(m);
        pintar();
      });
      botones.set(m, b);
      fila.appendChild(b);
    }
    caja.append(titulo, fila, ahora);
    pintar();
    return caja;
  }

  private boton(texto: string, accion: () => void, clase = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = texto;
    b.className = clase;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      accion();
    });
    return b;
  }

  private async jugar(): Promise<void> {
    // en el móvil, a pantalla completa al empezar (tiene que ser dentro del toque)
    if (this.tactil) void entrarPantallaCompleta();
    await this.pedirCaptura();
    this.pausado = false;
    if (this.campana.estado === 'intro') this.campana.empezar();
    else this.mostrar();
  }

  /** Del menú al juego directamente, sin pantalla de presentación. */
  private entrar(continuar: boolean): void {
    this.campana.cargar('mundo', continuar);
    void this.jugar();
  }

  mostrar(): void {
    const c = this.campana;
    const r = this.raiz;
    r.replaceChildren();
    r.hidden = false;
    r.onclick = null;

    if (c.estado === 'menu') {
      r.className = 'pantalla menu';
      r.innerHTML = `<h1>ATACK OF TITAN</h1><p class="sub">El territorio perdido · mundo abierto</p>`;
      const fila = document.createElement('div');
      fila.className = 'botones';
      const partida = leerPartida();
      if (partida) {
        const enPaz = partida.pueblos.filter((p) => p.liberado && p.progreso >= 1).length;
        fila.append(this.boton(`Continuar · Día ${partida.dia}, ${textoHora(partida.hora)} · ${enPaz} pueblos en paz`, () => this.entrar(true), 'principal'));
        const nueva = this.boton('Nueva partida', () => {
          // dos toques: la partida guardada se pierde
          if (nueva.dataset.confirmar) this.entrar(false);
          else {
            nueva.dataset.confirmar = '1';
            nueva.textContent = '¿Seguro? Se borra la partida guardada';
          }
        });
        fila.append(nueva);
      } else fila.append(this.boton('Empezar', () => this.entrar(false), 'principal'));
      r.appendChild(fila);
      r.appendChild(this.filaApp());
      r.insertAdjacentHTML('beforeend', this.controles);
      r.insertAdjacentHTML('beforeend', '<p class="creditos">Caballo: «Caballo» de <a href="https://sketchfab.com/vmmaniac" target="_blank" rel="noopener">Roberto Domínguez</a> (<a href="https://sketchfab.com/3d-models/caballo-aa979384c5c04f1281df5e4ab006f17d" target="_blank" rel="noopener">Sketchfab</a>), licencia <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, convertido y simplificado</p>');
      return;
    }

    if (c.estado === 'intro' && c.capitulo) {
      r.className = 'pantalla intro';
      r.innerHTML = `<p class="epoca">${escapar(c.capitulo.epoca)}</p><h2>${escapar(c.capitulo.titulo)}</h2><p class="texto">${escapar(c.capitulo.intro)}</p>`;
      const b = this.boton('Empezar', () => void this.jugar(), 'principal');
      r.appendChild(b);
      r.insertAdjacentHTML('beforeend', this.controles);
      return;
    }

    if (c.estado === 'jugando') {
      if (!this.pausado) {
        r.hidden = true;
        return;
      }
      r.className = 'pantalla pausa';
      r.innerHTML = `<h2>Pausa</h2><p class="texto">${escapar(c.objetivoTexto)}</p><p class="texto">${escapar(c.objetivoDetalle)}</p><p class="pista">También se guarda sola cada 30 s. Al continuar, sigues justo donde lo dejaste.</p>`;
      const fila = document.createElement('div');
      fila.className = 'botones';
      const guardar = this.boton('Guardar partida', () => {
        const ok = this.guardar?.() ?? false;
        const p = ok ? leerPartida() : null;
        guardar.textContent = p ? `✓ Guardada · Día ${p.dia}, ${textoHora(p.hora)}` : 'No se pudo guardar';
      });
      fila.append(this.boton('Continuar', () => void this.jugar(), 'principal'), guardar, this.boton('Guardar y salir al menú', () => c.irAlMenu()));
      r.appendChild(fila);
      const editar = this.editarBotones;
      if (editar) {
        fila.appendChild(
          this.boton('✥ Mover botones', () => {
            r.hidden = true;
            editar(() => this.mostrar());
          }),
        );
      }
      if (this.graficos) r.appendChild(this.selectorGraficos(this.graficos));
      r.insertAdjacentHTML('beforeend', this.controles);
      return;
    }

    const s = c.stats;
    const min = Math.floor(s.tiempo / 60);
    const seg = Math.floor(s.tiempo % 60).toString().padStart(2, '0');
    const filas = [
      `Tiempo: ${min}:${seg}`,
      `Titanes abatidos: ${s.titanesMuertos} (${s.nucasPropias} por ti)`,
      s.civilesSalvados + s.civilesMuertos > 0 ? `Civiles a salvo: ${s.civilesSalvados} · víctimas: ${s.civilesMuertos}` : '',
      s.companerosCaidos.length ? `Caídos: ${s.companerosCaidos.join(', ')}` : 'Ningún compañero caído',
      `Veces devorado: ${s.muertesJugador}`,
    ].filter(Boolean);
    const lista = `<ul class="resumen">${filas.map((f) => `<li>${escapar(f)}</li>`).join('')}</ul>`;
    const fila = document.createElement('div');
    fila.className = 'botones';
    if (c.estado === 'victoria') {
      r.className = 'pantalla victoria';
      r.innerHTML = `<p class="epoca">${escapar(c.capitulo?.titulo ?? '')}</p><h2>Capítulo completado</h2>${lista}`;
      const sig = c.siguiente();
      if (sig) fila.append(this.boton('Siguiente capítulo', () => c.cargar(sig), 'principal'));
      fila.append(this.boton('Repetir', () => c.reintentar()), this.boton('Menú de capítulos', () => c.irAlMenu()));
    } else {
      r.className = 'pantalla derrota';
      r.innerHTML = `<p class="epoca">${escapar(c.capitulo?.titulo ?? '')}</p><h2>Misión fallida</h2><p class="texto">${escapar(c.motivoDerrota)}</p>${lista}`;
      fila.append(this.boton('Reintentar', () => c.reintentar(), 'principal'), this.boton('Menú de capítulos', () => c.irAlMenu()));
    }
    r.appendChild(fila);
    document.exitPointerLock?.();
  }
}
