# Atack of Titan — juego de mundo abierto (proyecto fan, uso personal)

Juego 3D en el navegador inspirado en *Attack on Titan*, hecho con **Vite + TypeScript + Three.js + Rapier**.
Se construye por fases; cada fase termina jugable. Este repositorio está en la **fase 1 (prototipo de movimiento)**,
con la **guía visual aplicada desde el principio** aunque todo sea geometría simple.

> Nota legal: proyecto personal. Publicarlo o monetizarlo con la marca, nombres o diseños de Attack on Titan
> exigiría licencia de Kodansha; si algún día se publica, hay que cambiar nombres y diseños.

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
| **Shift** | Salto en el suelo / freno de emergencia en el aire (gasta mucho gas) |
| **WASD** | Mover en el suelo, ajustar la trayectoria en el aire |
| Ratón | Cámara |
| **R** | Reaparecer en la plaza (y rellenar gas) |
| **F1** | Panel de ajustes (todos los valores de `src/data/config.json`, en caliente) |

El gas se recarga junto a las cajas de suministro de la plaza (banderín verde).

## Modo de depuración por URL

| Parámetro | Valores | Efecto |
| --- | --- | --- |
| `?cam=` | `tejado`, `calle`, `muralla`, `puerta`, `bosque`, `titan`, `jugador` | Coloca al jugador y la cámara en un punto fijo. Al mover el ratón vuelve la cámara normal. |
| `?hora=` | `dia`, `atardecer`, `noche` | Iluminación inicial (también en el panel F1) |
| `?debug=1` | | Abre el panel F1 y muestra los FPS |
| `?hud=0` | | Oculta el HUD |

Ejemplo: `http://localhost:5173/?cam=muralla&hora=noche`

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
  player/    controlador, ODM (ganchos/cable/impulso), cuerda.ts y gas.ts (lógica pura + tests), cámara, modelo, partículas
  titans/    titán puro (modelo + colisiones, nuca incluida)
  world/     ciudad, muralla, bosque, cielo/iluminación, antorchas, texturas procedurales, materiales
  ui/        HUD y panel de ajustes (lil-gui)
scripts/     capturas.ts (Playwright)
referencias/ imágenes de referencia para comparar con las capturas
```

## Fase 1 — estado

Hecho:
- Movimiento ODM completo: dos ganchos independientes que vuelan a 150 m/s, alcance 60 m, apuntado asistido (cono de ~4° que prefiere superficies altas y titanes), restricción de cuerda (solo tira), recogida con bobina, péndulo emergente, impulso con componente orbital, freno de emergencia, gas compartido.
- Controlador con colisiones (Rapier, controlador cinemático): suelo, pendientes, tejados transitables.
- Cámara en tercera persona con muelle, FOV dinámico (70°→95°) y colisión con barrido de esfera.
- HUD: dos cilindros de gas, retícula con indicador de anclaje válido/fuera de alcance por gancho y marcador en el mundo, velocidad.
- Panel F1 con todos los valores, presets de hora, gas infinito, saltar a los puntos de cámara.
- Tests de la cuerda y del gas.

Pendiente / a decidir:
- Daño por aterrizaje y voltereta (definido en el diseño; lo dejo para cuando haya vida y combate en la fase 2).
- Animación del modelo mínima (zancada, inclinación, capa que ondea).

Valores que conviene probar en el panel F1: `gravedad`, `velocidadRecogida`, `aceleracionRecogida`, `fuerzaImpulso`, `fuerzaOrbita`, `alcanceCable` y el `controlAereo`.

Propuesta para la fase 2: titanes de 3 tamaños con hitboxes (nuca, tendones, brazos), IA simple (deambular, perseguir, agarrar), corte por velocidad y ángulo, cuchillas con durabilidad, vapor de regeneración/muerte y sangre breve.
