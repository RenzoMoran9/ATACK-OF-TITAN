# Atack of Titan — juego de mundo abierto (proyecto fan, uso personal)

Juego 3D en el navegador inspirado en *Attack on Titan*, hecho con **Vite + TypeScript + Three.js + Rapier**.
Se construye por fases; cada fase termina jugable. Este repositorio está en la **fase 2 (combate, titanes, escuadrón y
campaña)**, con la **guía visual aplicada desde el principio** aunque todo sea geometría simple.

> Nota legal: proyecto personal. Publicarlo o monetizarlo con la marca, nombres o diseños de Attack on Titan
> exigiría licencia de Kodansha; si algún día se publica, hay que cambiar nombres y diseños.

**Jugar e instalar en el celular:** https://renzomoran9.github.io/ATACK-OF-TITAN/ (GitHub Pages; ver
[Instalar en el celular](#instalar-en-el-celular-y-actualizaciones)).
**Vista rápida en claude.ai:** https://claude.ai/artifact/6DjD9aBs2qgzD8aMR3AsLM
Vistas directas con ancla: `#tejado`, `#bosque`, `#titan`, `#muralla-noche`, `#tejado-atardecer`…

## Puesta en marcha

```bash
npm install
npx playwright install chromium   # solo para las capturas automáticas
npm run dev                       # http://localhost:5173
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo de Vite |
| `npm run build` | Comprobación de tipos + build de producción en `dist/` |
| `npm test` | Tests unitarios (lógica de cuerda y gas) con Vitest |
| `npm run capturas` | Saca capturas del juego desde cámaras fijas (ver abajo) |
| `npm run capturas:navegador` | Descarga el Chromium de Playwright (`playwright install chromium`) |

## Controles

| Entrada | Acción |
| --- | --- |
| **Clic izquierdo** (o **F**) | **Tajo**: un toque = tajo rápido; mantener = enroscarse y cargar; soltar = barrido. Agarrado por un titán: clics rápidos para cortarle los dedos |
| **Clic derecho** | Los **dos ganchos** a la vez hacia la mira — mantener = recoger cable, soltar = desenganchar |
| **Q** / **E** | Gancho izquierdo / derecho **automático, tipo Spider-Man**: busca solo dónde clavarse a ese lado (algo por delante y por encima; un titán cuenta más), sin apuntar. Mantenido, haces de péndulo (solo recoge cable para arrancar); al soltar en marcha, sales despedido hacia arriba y adelante. Alterna Q y E para encadenar balanceos |
| *(sujetar el gancho al llegar)* | Si llegas recogiendo cable a un tronco o una pared y sigues sujetando, te quedas **agachado de lado sobre ella**, como en el anime. Suelta para saltar hacia fuera; salto (Espacio) te lanza con gas hacia donde miras |
| **Espacio** | Toque: **salto**. **Mantenido: salto con gas** — el gas te sigue empujando hasta **10 m** sobre el despegue y luego planeas despacio (para escapar de los que corren a cuatro patas o caer sobre un titán desde arriba); con WASD, el gas te lanza hacia delante. En el aire sin ganchos: solo, **freno**; con WASD, impulso. Enganchado: impulso y órbita del ancla |
| **Shift** (mantener) | **Correr** a pie; gasta la barra de **aguante**, que se recupera al parar (vacía, te agotas y andas más lento). Shift o Espacio justo antes de tocar el suelo: **rodada** (evita el daño por caída) |
| **WASD** | Mover en el suelo. En el aire sin cables ni gas: dirige el salto hacia donde pulsas sin perder impulso, y la tecla contraria frena (para caer justo sobre una rama) |
| **R** | Cambiar de par de cuchillas (4 de repuesto) |
| **B** | **Bengala** roja hacia la mira (50 m/s). Si estalla a 4 m o menos de la cara de un titán, lo ciega 3 s. 4 bengalas; se reponen en los depósitos |
| **X** | **Fijar parte** del titán que tienes delante: nuca → ojos → brazos → corvas → tendones → nada. El tajo asistido y los ganchos (clic derecho) van a ella aunque la mira esté en otro sitio |
| **C** | **Caballo**: al lado, montar; montado, bajar; lejos, silbar (viene al galope). Montado: WASD lo dirige, Shift galope, Espacio salta de la silla, y si clavas un gancho sales volando de ella |
| **K** | **Armar un campamento** donde estés (en un claro): cerco de alambre con latas y seis carpas alrededor de una hoguera. El escuadrón se reparte las obras y tú ayudas con el martillo |
| **G** junto a una obra | **Martillazo**: pulsa cuando la aguja pase por la zona verde. En el centro, el poste entra de una vez; bien, en tres golpes; fuera, apenas avanza |
| **H** | Descansar hasta el amanecer (de noche, en un refugio: Trost, un puesto, el campamento de la Legión, tu campamento o un pueblo en paz) |
| **G** | Recoger el equipo de un soldado caído (gas + cuchillas) o, si no hay ninguno al lado, pedir gas a un compañero |
| **1 / 2 / 3 / 4** | Órdenes al escuadrón: seguidme · atacad · proteged a los civiles · retirada |
| **5 / 6 / 7 / 8** | Esperad aquí (mantienen la posición y la defienden) · id allí (al punto de la mira) · atacad a ese titán (el de la mira) · explorad (patrullan alrededor del punto de la mira y avisan de lo que ven) |
| **Tab** | A quién mandas: todo el escuadrón → cada soldado → todos. Los demás conservan su orden (Todos + 5 = te vas solo; Tab hasta Mikasa + 1 = te la llevas) |
| **M** | Mapa del territorio (bosques, río, lugares, escuadrón, titanes cercanos, puntos de recarga) |
| **N** | Sonido sí / no (se recuerda) |
| **L** | Linterna: foco hacia donde miras y un halo cálido alrededor del soldado. Se enciende sola la primera vez que todo se queda a oscuras (bosque o noche) |
| **Retroceso** | Reaparecer en el punto de control |
| Ratón / **flechas** | Cámara (las flechas sirven si el navegador no deja capturar el ratón) |
| **F1** o **P** | Panel de ajustes (todos los valores de `src/data/config.json`, en caliente) |
| **Esc** | Pausa / soltar el ratón |

**La mira** `( · )`: cada arco es un gancho. Gris = no hay dónde clavarlo; blanco = al alcance; dorado = en carne de titán; verde = anclado.

**Gas**: se recarga en el depósito de la plaza (cajas con banderín verde). Con menos del 20 % aparece un panel con las
opciones y la distancia/flecha a cada una: pedir gas a un compañero (como Armin con Mikasa en Trost), recoger el equipo
de un caído (haz de luz verde) o ir al depósito. Sin gas puedes seguir a pie y saltar.

Los avisos son pocos y discretos: los golpes («¡Nuca!», «¡Esquivado!») salen un instante junto a la mira y lo
importante (un pueblo atacado, liberado o en paz) en una lista pequeña a la izquierda.

### En el celular o la tableta

Se activan solos en pantallas táctiles (o con `?tactil` en la URL). Se juega en horizontal.

| Control | Acción |
| --- | --- |
| Dedo en la mitad izquierda | **Joystick** que aparece donde tocas; empujado hasta el borde, **corres** |
| Arrastrar en la mitad derecha | Mirar (cámara) |
| **GANCHOS** / **TAJO** | Clic derecho / clic izquierdo (mantener = recoger cable / cargar el tajo). Si arrastras sin soltarlos, apuntas a la vez |
| **SALTO/GAS** | Espacio: salto, freno en el aire, impulso si mueves el joystick |
| **◀ GANCHO** / **GANCHO ▶** | Q / E: el izquierdo junto al joystick (pulgar izquierdo), el derecho junto a GANCHOS (pulgar derecho) |
| **⚒ MARTILLO** | Sale en el mismo sitio que MONTAR cuando estás junto a un poste o una carpa sin terminar |
| **♞ MONTAR** / **BAJAR** | Aparece a la izquierda de GANCHOS cuando estás al lado de tu caballo, y montado pasa a BAJAR. A caballo: joystick para dirigirlo (al fondo, galope) y SALTO/GAS para saltar de la silla. Si el caballo está lejos, ♞ Caballo en la fila de arriba le silba y viene |
| Fila de arriba | Cuchillas (R), bengala (B), parte (X), caballo (C), acampar (K), dormir (H), luz (L), mapa (M), recoger (G), órdenes (1–8 y a quién), sonido, pantalla completa, pausa |

**Mover los botones:** en la pausa, **✥ Mover botones**: arrastra cada botón (y la fila de arriba) donde te quede cómodo, cambia su tamaño con − / + y pulsa **Listo**. Se guarda en el celular; **Restablecer** vuelve a la disposición original.

Al tocar **Empezar** el juego pasa a pantalla completa. El HUD se reparte arriba para dejar libres los pulgares.

### Gráficos en el celular

La calidad se adapta sola (`src/core/calidad.ts`): en el celular empieza en **Media** (sombras pequeñas, menos distancia
de dibujado, sin antialias, pocas antorchas con luz) y, si no llega a ~45 imágenes por segundo, baja la resolución
interna y luego pasa a **Fluida** (sin sombras, niebla más cerca). En la pausa, el botón **Gráficos** permite elegir
Auto, Alta, Media o Fluida. Cada soldado se dibuja con ~25 piezas fundidas (antes 63) y los titanes con ~20.

## Sonido

Efectos generados con ElevenLabs a partir de descripciones inspiradas en el anime (`public/sonidos/`, 47 archivos, ~1,4 MB):
gas y silbido del cable al disparar los ganchos, golpe del ancla, bobina al recoger, viento a toda velocidad, «shing»
de las hojas, corte en la carne y vapor de la nuca, cambio de cuchillas, pasos y aterrizajes, cada pisada de los titanes
(más grave cuanto más grandes; galope en los de cuatro patas), su rugido al verte y el resoplido antes de atraparte,
agarre, mordisco y masticar, derrumbe y vapor al morir, bengalas, la puerta de Trost y las campanas, y ambientes de
bosque, llanura y noche. En el mundo abierto, además: trote, galope y relincho del caballo y tu silbido; la campana de
alarma y los gritos de los vecinos cuando atacan su pueblo, los martillos de la reconstrucción, el ambiente de un pueblo
habitado, los vítores al liberarlo o defenderlo y las hogueras de noche; la esquiva, el disparo de la bengala, el
rebote en la coraza, el endurecimiento de la Hembra y el rugido de los cambiantes. `src/audio/sonido.ts` es el motor (Web Audio: volumen por distancia y lado) y
`src/audio/sonidosJuego.ts` decide qué suena y cuándo. **N** (o ♪ en el celular) lo silencia.

## Créditos

- **Caballo**: «Caballo» de [Roberto Domínguez](https://sketchfab.com/vmmaniac)
  ([Sketchfab](https://sketchfab.com/3d-models/caballo-aa979384c5c04f1281df5e4ab006f17d)), licencia
  [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Cambios: materiales convertidos a metal-rugosidad,
  texturas a WebP de 1024 px y malla simplificada (de ~35 000 a ~20 000 triángulos).
- **Sonidos**: generados con ElevenLabs.

## Instalar en el celular y actualizaciones

El juego es una **app web instalable** (PWA), como *Entre Hojas*:

- **Android (Chrome):** abre https://renzomoran9.github.io/ATACK-OF-TITAN/ → menú ⋮ → **Instalar app** (o el botón
  *Instalar como app* del menú del juego). Queda un icono en el celular y se abre a pantalla completa, sin barras.
- **iPhone/iPad (Safari):** abre el enlace → **Compartir** → **Añadir a pantalla de inicio**.
- **PC (Chrome/Edge):** icono de instalar en la barra de direcciones.

Una vez abierto, el juego queda guardado en el dispositivo y **funciona sin internet**.

**Actualizar:** cada `git push` a `main` o a una rama `claude/**` lanza `.github/workflows/publicar.yml`, que revisa los
tipos, pasa las pruebas, compila y publica en la rama `gh-pages`. El juego instalado lo detecta (al abrirlo, al
volver a él y cada media hora) y muestra **«Nueva versión del juego · Actualizar»**: al tocarlo se recarga con la
versión nueva; «Luego» sigue con la actual. La versión la calcula `scripts/pwa.mjs` al compilar (huella de todos los
archivos), así que cada cambio publicado es una versión nueva.

**Primera vez (una sola vez):** en GitHub, *Settings → Pages → Build and deployment → Source: Deploy from a branch →
`gh-pages` / `(root)` → Save*. A partir de ahí cada publicación se ve en el enlace en uno o dos minutos.

## Combate y titanes (como en el anime)

- Un titán solo muere si le cortas **la nuca**; el daño depende de tu velocidad relativa, del ángulo del tajo respecto a la
  columna y del filo. Una nuca de un titán de H metros aguanta 150 + 10·H; si no llegas, la herida se cierra en ~6 s.
- **Tendones y corvas**: un tendón = cojea; dos tendones o una corva = cae de rodillas y la nuca queda baja.
- **Ojos**: los dos = ciego unos 12 s (se tapa la cara y da manotazos). **Brazos**: inutilizados o amputados; vuelven a crecer.
- Todo lo que no es la nuca **se regenera echando vapor**. Los anormales (15 %) esprintan, cambian de rumbo y regeneran antes.
- Son **agresivos**: ven en un cono de ±70°, oyen/huelen a quien tienen cerca, huelen las multitudes desde 150 m, te
  persiguen por las calles, se agachan para agarrarte, te levantan a la boca y te devoran. Por la noche se van apagando.
- Si te agarran: QTE con F; o un compañero te rescata cortando la mano o la mandíbula.
- **Esquiva del agarre**: si en los 0,25 s antes de que cierre la mano das un impulso de gas o clavas un gancho nuevo
  (con gas en los cilindros), la mano se cierra en el aire: cámara lenta ×0,5 durante 0,4 s y el titán queda
  descolocado. El borde de la pantalla se vuelve dorado con «¡AHORA!» en ese momento.
- **Pasada baja**: volando por debajo de 0,2·H del titán y a menos de 3 m de un tendón o una corva, el tajo sale corto
  (0,15 s, sin carga) directo a esa zona. Funciona también al galope.
- **Bengala cegadora** (B): estalla al chocar, al pasar rozando una cara o a 70 m. A 4 m o menos de la cara, el titán
  queda ciego 3 s (no es una herida: no se regenera).
- **Cambiantes**: el **Titán Acorazado** (15 m) tiene coraza en todo el cuerpo salvo corvas y codos: la hoja rebota y se
  mella; al caer de rodillas con una corva cortada se le agrieta la coraza de la nuca unos segundos. La **Titana Hembra**
  (14 m), rápida, endurece la nuca cuando te ve lanzarte a ella (1,3 s, luego tarda 5 s en poder repetirlo): espera, o
  cégala (ojos o bengala) o inutilízale los brazos, y entonces no puede. Ninguno de los dos se apaga de noche.
- El giro de Levi sigue con su disparador (3 nucas y más de 25 m/s recogiendo cable anclado a un titán); los cuerpos de
  los titanes siguen pudiendo meterse un poco en las casas (pendiente de decidir, ver el análisis).

## Escuadrón

Te acompañan soldados con su propio equipo ODM (cables, bobina, impulsos) que hacen las tácticas del anime: **el cebo** se
pone delante de la cara del titán para distraerlo, **el apoyo** le corta tendones y corvas para derribarlo y **el rematador**
va a la nuca cuando el titán no le mira. Rescatan a quien esté en la mano de un titán, esquivan agarres según su habilidad
(Mikasa y Levi mucho mejor que Armin), pueden morir (y dejan su equipo en el suelo) y te pasan gas si se lo pides.

**Moblit, el intendente**, va en todos los escuadrones con una mochila de bombonas (400 de gas; los demás llevan 120 y tú
150). No pelea: cuando a ti te queda menos del 35 % o a un compañero menos del 30 %, vuela hasta él y le pasa gas. Con
**G** se lo pides a él primero, esté donde esté.

Si cae entero, en un refugio (Trost, un puesto de avanzada, el campamento o un pueblo en paz) se te unen
**refuerzos de la Legión**. Si das una orden y no
queda nadie, el juego te dice por qué.

## Mundo abierto

Ya no hay niveles ni capítulos: el juego es un **mundo abierto sin final** para partidas largas. No hay objetivo
obligatorio: vas por el territorio cazando titanes y defendiendo los pueblos para que la gente vuelva a vivir en paz.

- **Día y noche** (`src/core/cicloDia.ts`): una hora de juego dura un minuto real de día y medio de noche (un día
  ≈ 19 min). El sol sale por el este, pasa por el sur y se pone por el oeste; amanecer y atardecer tiñen el cielo, de
  noche hay luna y estrellas, se encienden ventanas y faroles, y casi todos los titanes se apagan (los cambiantes no).
- **Pueblos** (Pastores, Molino, Ragako y Dauper): empiezan **tomados** por titanes. Al acercarte aparecen; mátalos a
  todos y el pueblo queda **liberado**. Llegan refugiados de Trost, pasean por sus calles y, de día y sin titanes,
  **reconstruyen** por etapas (andamios y martillos, y las ruinas pasan a casas nuevas, campos de cultivo, faroles).
  Terminado, el pueblo **vive en paz**: sus cajas de la plaza recargan gas, cuchillas y bengalas, y puedes descansar y
  reaparecer allí.
- **Ataques**: cada pocas horas, de día, un grupo de titanes marcha hacia un pueblo habitado (más cuantos más días
  llevas; desde el día 3, a veces con un cambiante al frente). Cuando entran, **los propios aldeanos dan la alarma**:
  repica la campana, gritan, y una bengala roja sube sobre la plaza (se ve y se oye desde lejos; la brújula y el mapa lo
  marcan). Con titanes dentro se pierde obra y, si nadie los defiende, la gente huye o muere y el pueblo cae.
- **Cambiantes avistados**: desde el segundo día, a media mañana, a veces aparece el Acorazado o la Hembra en la llanura.
- **Caballo** (C): para cruzar la llanura rápido (paso 1,8 m/s, trote 6 m/s, galope 16 m/s ≈ 58 km/h). Huye de los
  titanes cuando está suelto. Es un modelo 3D (`public/modelos/caballo.glb`, ~1 MB) sin huesos: las patas se doblan en
  el shader por zonas (`src/player/modeloCaballo.ts`); si no carga, se ve uno hecho de primitivas.
  **Física de la marcha** (`src/player/marchaCaballo.ts`): paso a cuatro tiempos, trote en diagonal y galope con su
  orden de pisadas y suspensión, con cambio suave según la velocidad. Cada casco apoyado va hacia atrás justo a la
  velocidad del suelo (cinemática inversa de hombro y rodilla), así que no patina; la cadencia y la zancada salen de la
  velocidad. El cuerpo bota según el andar, cabecea al galope y se inclina en las curvas; gira con inercia (cuanto más
  rápido, más abierto), frena para dar media vuelta y, cuando lo llamas, llega frenando poco a poco. Parado y girando,
  da pasitos. Los cascos suenan al ritmo de la marcha.
- **Campamento** (K): donde quieras, en un claro fuera de Trost. Cada soldado va a su poste o a su carpa y la monta
  en unos segundos; tú clavas postes con el martillo. Entre cada dos postes clavados se tiende el alambre. Un titán
  que se mete en él se **enreda** (va a un cuarto de su velocidad), las latas suenan y lo va rompiendo poco a poco.
  Terminado, el escuadrón se queda dentro defendiéndolo, se enciende la hoguera y es un refugio: duermes en las carpas
  (H) y reapareces allí. Solo hay uno: armar otro desmonta el anterior.
- **Guardar partida**: botón en la pausa (y además se guarda sola cada 30 s, al pausar y al cambiar de pestaña).
  Se guarda **dónde estás exactamente** (aunque sea en un tejado), tu gas, cuchillas y bengalas, dónde está tu
  caballo, tu campamento, el día y la hora, los pueblos, los lugares descubiertos y las estadísticas. En el menú,
  **Continuar** te deja justo ahí.

El territorio, unos 4 × 4 km alrededor de Trost:

- **Seis bosques**, la zona más peligrosa del juego: tres de árboles gigantes de 80–90 m (el Bosque de los Árboles
  Gigantes junto a la puerta, el Gigante del Oeste y el Gigante del Sur) y tres densos de 25–45 m (Pinar Negro,
  Hayedo de la Bruma y Bosque del Norte). Bajo las copas la luz baja y la niebla se cierra. Allí el poblador de
  titanes genera el doble y pico que en la llanura, y casi todos son anormales: el 40 % son **titanes que corren a
  cuatro patas** (13–28 m/s), se agazapan un instante (aviso «¡Corre a cuatro patas!») y saltan a morder. Si fallan,
  derrapan: es el momento de cortarles la nuca o una pata delantera, que los tumba.
- **Lugares**: cuatro pueblos (Pastores, Molino, Ragako y Dauper), las ruinas del Castillo de Utgard, el río con el Puente
  de Piedra, tres puestos de avanzada (recargan gas y cuchillas) y el campamento de la Legión de Reconocimiento.
- Arboledas por toda la llanura, montes al fondo y viento en contra si te sales de la región.
- **Brújula** arriba (Trost, recarga más cercana, lugares, escuadrón, titanes cercanos, pueblos atacados, cambiantes y
  tu caballo) y **mapa** con M (con el estado de cada pueblo: tomado, reconstruyendo o en paz).

## Modo de depuración por URL

| Parámetro | Valores | Efecto |
| --- | --- | --- |
| `?cam=` | `tejado`, `calle`, `muralla`, `puerta`, `bosque`, `titan`, `jugador` | Coloca al jugador y la cámara en un punto fijo. Al mover el ratón vuelve la cámara normal. |
| `?hora=` | `dia`, `atardecer`, `noche` | Iluminación inicial (también en el panel F1) |
| `?debug=1` | | Abre el panel F1 y muestra los FPS |
| `?hud=0` | | Oculta el HUD |
| `?poses` | | Laboratorio de poses: una fila de soldados, cada uno en un estado de animación (carrera, recogida, corte, giro de Levi…) |

Ejemplo: `http://localhost:5173/?cam=muralla&hora=noche`

Lo mismo con un ancla, que es lo único que llega a la página dentro de un artefacto de claude.ai:
`#muralla-noche`, `#tejado-atardecer`, `#bosque`, `#noche` (formato `#<cam>-<hora>`).

## Capturas automáticas (`npm run capturas`)

`scripts/capturas.ts`:

1. Usa el servidor de Vite si ya está corriendo en `http://localhost:5173/` (o `URL_JUEGO`); si no, levanta uno y lo cierra al acabar.
2. Abre Chromium **headless con WebGL por software** (`--use-angle=swiftshader`), que funciona sin GPU.
3. Carga cada vista (`?cam=...`) y espera a `window.__juegoListo`, que el juego activa cuando ha construido la escena y dibujado varios fotogramas.
4. Guarda `capturas/<vista>_<AAAA-MM-DD_HH-mm-ss>.png` y avisa de cualquier error en la consola del navegador.
5. Si hay imágenes en `referencias/`, genera `capturas/comparativa_<fecha>.html` con cada captura al lado de las referencias con el mismo nombre de vista (`referencias/tejado-1.jpg` va con `tejado`).

Vistas: `tejado`, `calle`, `muralla`, `puerta`, `bosque`, `titan`, `jugador`, `tejado-atardecer`, `muralla-noche`.
Para sacar solo algunas: `npm run capturas -- tejado bosque`.

| Variable | Uso |
| --- | --- |
| `URL_JUEGO` / `PUERTO` | Servidor a usar / puerto del servidor propio |
| `CAPTURAS_GPU=1` | No fuerza SwiftShader (usa la GPU real) |
| `CAPTURAS_VISIBLE=1` | Abre el navegador visible en vez de headless |
| `CHROMIUM_PATH` | Chromium alternativo si el de Playwright no está descargado |
| `CAPTURAS_ANCHO` / `CAPTURAS_ALTO` | Resolución (por defecto 1280×720) |

Las capturas son artefactos generados: `capturas/` está en `.gitignore`.

## Guía visual (aplicada desde la fase 1)

| Elemento | Cómo está hecho ahora (primitivas) |
| --- | --- |
| **Escala** | Jugador 1,7 m; casas 10–20 m; muralla 50 m; árboles 80–90 m. Todo en metros reales. |
| **Ciudad** | ~460 casas de entramado: zócalo de piedra gris, yeso crema con vigas oscuras (ventanas con contraventanas o cruz de San Andrés), tejados de teja roja/naranja a 50–58°, chimeneas, puertas a escala humana. Calles empedradas de 4–8 m, avenidas en cruz, plaza con pozo y depósito de suministros, iglesia con torre y chapitel de pizarra (punto alto, ~55 m). |
| **Muralla** | Anillo de 230 m de radio, 50 m de alto y 12 m de grosor; piedra lisa gris-beige casi sin juntas; coronación plana sin almenas; vía longitudinal y raíles transversales con cañones negros; puerta enorme de madera con flejes de hierro, levantada 7 m. |
| **Bosque** | ~120 árboles de 80–90 m con troncos rojizos de 8–15 m de diámetro y raíces ensanchadas, ramas horizontales anchas (transitables y enganchables), copas altas, haces de luz entre las copas, suelo oscuro y bruma baja. |
| **Titanes puros** | Piel carne pálida, sin ropa ni detalles anatómicos, cabeza enorme, sonrisa fija exagerada con dientes, ojos abiertos sin expresión, torso deforme (dos complexiones). En la fase 1 están quietos (balanceo en reposo). |
| **Jugador** | Chaqueta corta marrón claro, pantalón blanco, botas altas marrones, correas del arnés, capa verde con capucha y emblema de alas, vainas grises en los muslos con cilindros de gas encima, carcasa del equipo en la parte baja de la espalda. |
| **Efectos** | Chorros cortos de gas blanco al impulsarse/frenar; cables de acero finos y claros, con holgura cuando no tiran. *(Vapor, sangre y bengalas llegan con el combate y las expediciones.)* |
| **Luz y color** | Cielo amplio azul desvaído con cúmulos grandes, tierra y ocres; atardecer con sombras largas; noche azul oscuro con estrellas, antorchas cálidas y ventanas encendidas. |
| **Render** | Lambert/Phong con tonemapping ACES. El cel-shading con contornos es de la fase 7. |

## Estructura

```
src/
  core/      bucle de paso fijo (60 Hz + interpolación), entrada, configuración, física (Rapier), parámetros de URL
  data/      config.json — todos los valores ajustables
  combat/    modelo de corte (corte.ts), cuchillas, efectos (vapor, sangre, bengalas), suministros recogibles
  missions/  mundo abierto (capitulos/mundo.ts), pueblos (pueblos.ts + logicaPueblo.ts), guardado, siluetas
  npc/       aldeanos (huida por campo de flujo, cola en la puerta) y escuadrón (soldado con ODM + coordinador)
  player/    controlador, ODM, combate, cuerda.ts y gas.ts (lógica pura + tests), cámara al hombro, modelo articulado y poses
  titans/    titán puro articulado (colisionadores por segmento, puntos débiles, IA, agarre) y gestor
  world/     ciudad, muralla, bosque, cielo/iluminación, antorchas, texturas procedurales, materiales
  ui/        HUD y panel de ajustes (lil-gui)
scripts/     capturas.ts (Playwright)
referencias/ imágenes de referencia para comparar con las capturas
```

## Fase 2 — estado

Hecho:
- Titanes articulados con IA agresiva, agarre y devorado, puntos débiles del anime con regeneración, muerte con evaporación.
- Combate del jugador (tajo cargado, tajo asistido, giro de Levi tras 3 nucas, cuchillas con desgaste, QTE al ser agarrado,
  daño por caída y rodada, cámara lenta al cortar una nuca).
- Animación procedural del soldado con articulaciones y muelles (carrera, vuelo tirado por el cable, péndulo, impulsos,
  aterrizaje agachado, voltereta, corte con estela, giro de Levi, cambio de cuchillas, pataleo al ser agarrado).
- Cámara sobre el hombro sin parpadeo al mirar hacia arriba (el brazo se desliza sobre el suelo), mira rediseñada.
- Aldeanos que huyen hacia la puerta norte, escuadrón con tácticas, opciones al quedarse sin gas.
- Mundo abierto sin niveles con día y noche, pueblos que se liberan, se repueblan, se reconstruyen y piden ayuda,
  caballo, cambiantes (Acorazado y Hembra), esquiva, bengala cegadora, pasada baja y fijar parte, partida guardada.

Pendiente:
- Decidir la solidez de los titanes contra las casas.
- Modelos 3D de verdad (los cuerpos son primitivas): se podrían sustituir por modelos GLB con licencia libre (habría que
  añadir la carga con GLTFLoader y adaptar las articulaciones).
