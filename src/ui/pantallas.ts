import type { Campana, IdCapitulo } from '../missions/campana';

/**
 * Pantallas a pantalla completa: menú de capítulos, presentación del capítulo, pausa,
 * victoria y derrota. Todo con DOM (sin librerías) y textos en español.
 */

const CONTROLES = `
  <ul class="controles">
    <li><b>Clic izq</b> tajo (mantén para cargar) · <b>Clic der</b> los dos ganchos a la mira <i>(mantener = recoger cable)</i></li>
    <li><b>Q / E</b> solo el gancho izquierdo / derecho (para orbitar)</li>
    <li><b>Espacio</b> saltar · en el aire: solo, frena; con WASD o enganchado, impulso de gas</li>
    <li><b>Shift</b> (mantener) correr, gasta aguante · Shift o Espacio justo antes de tocar el suelo: rodada</li>
    <li><b>F</b> también da el tajo · <b>R</b> cambiar cuchillas · <b>WASD</b> mover · <b>Ratón/flechas</b> cámara</li>
    <li><b>1</b> seguidme · <b>2</b> atacad · <b>3</b> proteged a los civiles · <b>4</b> retirada · <b>5</b> esperad aquí · <b>6</b> id allí · <b>7</b> atacad a ese titán · <b>8</b> explorad</li>
    <li><b>Tab</b> a quién mandas (todos o uno) · <b>F1/P</b> ajustes · <b>Esc</b> pausa</li>
  </ul>`;

function escapar(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class Pantallas {
  private readonly raiz: HTMLDivElement;
  pausado = false;

  /**
   * `pedirCaptura` intenta capturar el ratón (devuelve si lo consiguió);
   * se llama desde un clic del usuario, como exige el navegador.
   */
  constructor(private readonly campana: Campana, private readonly pedirCaptura: () => Promise<boolean>) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'pantalla';
    document.body.appendChild(this.raiz);
    campana.alCambiar = () => this.mostrar();
    this.mostrar();
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
    await this.pedirCaptura();
    this.pausado = false;
    if (this.campana.estado === 'intro') this.campana.empezar();
    else this.mostrar();
  }

  mostrar(): void {
    const c = this.campana;
    const r = this.raiz;
    r.replaceChildren();
    r.hidden = false;
    r.onclick = null;

    if (c.estado === 'menu') {
      r.className = 'pantalla menu';
      r.innerHTML = `<h1>ATACK OF TITAN</h1><p class="sub">Elige capítulo</p>`;
      const lista = document.createElement('div');
      lista.className = 'capitulos';
      for (const cap of c.capitulos) {
        const tarjeta = document.createElement('button');
        tarjeta.className = 'capitulo';
        const hecho = c.completados.includes(cap.id) ? '<span class="hecho">Completado</span>' : '';
        tarjeta.innerHTML = `<span class="epoca">${escapar(cap.epoca)}</span><b>${escapar(cap.titulo)}</b>${hecho}`;
        tarjeta.addEventListener('click', () => c.cargar(cap.id as IdCapitulo));
        lista.appendChild(tarjeta);
      }
      r.appendChild(lista);
      r.insertAdjacentHTML('beforeend', CONTROLES + '<p class="tactil">Este juego necesita teclado y ratón; los controles táctiles llegarán más adelante.</p>');
      return;
    }

    if (c.estado === 'intro' && c.capitulo) {
      r.className = 'pantalla intro';
      r.innerHTML = `<p class="epoca">${escapar(c.capitulo.epoca)}</p><h2>${escapar(c.capitulo.titulo)}</h2><p class="texto">${escapar(c.capitulo.intro)}</p>`;
      const b = this.boton('Empezar', () => void this.jugar(), 'principal');
      r.appendChild(b);
      r.insertAdjacentHTML('beforeend', CONTROLES);
      return;
    }

    if (c.estado === 'jugando') {
      if (!this.pausado) {
        r.hidden = true;
        return;
      }
      r.className = 'pantalla pausa';
      r.innerHTML = `<h2>Pausa</h2><p class="texto">${escapar(c.objetivoTexto)}</p>`;
      const fila = document.createElement('div');
      fila.className = 'botones';
      fila.append(this.boton('Continuar', () => void this.jugar(), 'principal'), this.boton('Reiniciar capítulo', () => c.reintentar()), this.boton('Menú de capítulos', () => c.irAlMenu()));
      r.appendChild(fila);
      r.insertAdjacentHTML('beforeend', CONTROLES);
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
