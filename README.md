# Atack of Titan — juego de mundo abierto (proyecto fan, uso personal)

Juego 3D en el navegador inspirado en *Attack on Titan*, hecho con **Vite + TypeScript + Three.js + Rapier**.
Se construye por fases; cada fase termina jugable. Este repositorio está en la **fase 2 (combate, titanes, escuadrón y
campaña)**, con la **guía visual aplicada desde el principio** aunque todo sea geometría simple.

> Nota legal: proyecto personal. Publicarlo o monetizarlo con la marca, nombres o diseños de Attack on Titan
> exigiría licencia de Kodansha; si algún día se publica, hay que cambiar nombres y diseños.

**Probarlo en el navegador:** https://claude.ai/artifact/6DjD9aBs2qgzD8aMR3AsLM (escritorio, con teclado y ratón).
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
| Clic izquierdo / **Q** | Gancho izquierdo — mantener = recoger cable, soltar = desenganchar |
| Clic derecho / **E** | Gancho derecho — igual |
| **Espacio** | Impulso de gas (hacia donde pulsas o hacia donde miras; anclado, orbita el ancla) |
| **Shift** | Salto en el suelo / freno en el aire; justo antes de tocar el suelo, **rodada** (evita el daño por caída) |
| **WASD** | Mover en el suelo, ajustar la trayectoria en el aire |
| **F** | Tajo: un toque = tajo rápido; mantener = enroscarse y cargar; soltar = barrido. Agarrado por un titán: pulsa F muchas veces para cortarle los dedos |
| **R** | Cambiar de par de cuchillas (4 de repuesto) |
| **G** | Recoger el equipo de un soldado caído (gas + cuchillas) o, si no hay ninguno al lado, pedir gas a un compañero |
| **1 / 2 / 3 / 4** | Órdenes al escuadrón: seguidme · atacad · proteged a los civiles · retirada |
| **Retroceso** | Reaparecer en el punto de control |
| Ratón / **flechas** | Cámara (las flechas sirven si el navegador no deja capturar el ratón) |
| **F1** o **P** | Panel de ajustes (todos los valores de `src/data/config.json`, en caliente) |
| **Esc** | Pausa / soltar el ratón |

**La mira** `( · )`: cada arco es un gancho. Gris = no hay dónde clavarlo; blanco = al alcance; dorado = en carne de titán; verde = anclado.

**Gas**: se recarga en el depósito de la plaza (cajas con banderín verde). Con menos del 20 % aparece un panel con las
opciones y la distancia/flecha a cada una: pedir gas a un compañero (como Armin con Mikasa en Trost), recoger el equipo
de un caído (haz de luz verde) o ir al depósito. Sin gas puedes seguir a pie y saltar.

## Combate y titanes (como en el anime)

- Un titán solo muere si le cortas **la nuca**; el daño depende de tu velocidad relativa, del ángulo del tajo respecto a la
  columna y del filo. Una nuca de un titán de H metros aguanta 150 + 10·H; si no llegas, la herida se cierra en ~6 s.
- **Tendones y corvas**: un tendón = cojea; dos tendones o una corva = cae de rodillas y la nuca queda baja.
- **Ojos**: los dos = ciego unos 12 s (se tapa la cara y da manotazos). **Brazos**: inutilizados o amputados; vuelven a crecer.
- Todo lo que no es la nuca **se regenera echando vapor**. Los anormales (15 %) esprintan, cambian de rumbo y regeneran antes.
- Son **agresivos**: ven en un cono de ±70°, oyen/huelen a quien tienen cerca, huelen las multitudes desde 150 m, te
  persiguen por las calles, se agachan para agarrarte, te levantan a la boca y te devoran. Por la noche se van apagando.
- Si te agarran: QTE con F; o un compañero te rescata cortando la mano o la mandíbula.

## Escuadrón

Te acompañan soldados con su propio equipo ODM (cables, bobina, impulsos) que hacen las tácticas del anime: **el cebo** se
pone delante de la cara del titán para distraerlo, **el apoyo** le corta tendones y corvas para derribarlo y **el rematador**
va a la nuca cuando el titán no le mira. Rescatan a quien esté en la mano de un titán, esquivan agarres según su habilidad
(Mikasa y Levi mucho mejor que Armin), pueden morir (y dejan su equipo en el suelo) y te pasan gas si se lo pides.

## Historia (capítulos)

1. **Cadetes del 104.º** — entrenamiento con siluetas de madera en el linde del bosque: nuca, tendones, ojos y cambio de cuchillas.
2. **Defensa de Trost** — el Titán Colosal revienta la puerta sur; cubres la evacuación hacia la puerta norte, suena la
   campana de retirada con los cilindros vacíos, recuperáis el depósito de suministros y escapáis por la muralla norte.
3. **Modo libre** — llanura al sur con titanes de todos los tamaños.

Los siguientes arcos (la Titán Hembra en el bosque, el asalto a Stohess, la recuperación de Shiganshina) están en el plan
de la historia para las próximas fases.

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
  missions/  campaña por capítulos (entrenamiento, Trost, libre), Titán Colosal, siluetas de entrenamiento
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
- Aldeanos que huyen hacia la puerta norte, escuadrón con tácticas, opciones al quedarse sin gas, campaña con dos capítulos.

Pendiente:
- Arcos siguientes de la historia (Titán Hembra, Stohess, Shiganshina) y titanes cambiantes.
- Modelos 3D de verdad (los cuerpos son primitivas): se podrían sustituir por modelos GLB con licencia libre (habría que
  añadir la carga con GLTFLoader y adaptar las articulaciones).
