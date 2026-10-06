# Rocket Sim (todo en la raiz, sin carpetas)

Simulador de cohetes de una sola pagina por mision (HTML + JS; three.js desde CDN). Subir TODOS estos archivos a la misma carpeta (Netlify Drop o GitHub Pages).
Archivos: `index.html` (indice) · `motor.js` (fisica, piloto automatico, render) · `iss.js`, `cw_solver.js`, `docking_autopilot.js` ·
misiones: `gagarin.html`, `apolo11.html`, `pro.html` (sandbox), `iss.html` (Soyuz), `iss_saturno.html`, `iss_shuttle.html`, `artemis2.html`.

## Correcciones de fisica con opt-in por mision (en `MISSION_CONFIG`)
Apagadas por defecto (sin ellas la fisica es la de siempre).
- `correctSoiVelocity` (velocidad al cruzar la esfera lunar) y `preciseOrbits` (velocity-Verlet): solo Artemis II.
- `dragCdA` / `dragFromStage`: Artemis II (23,5 m2) y la capsula de Apolo 11 en el regreso (15,5 m2).

## HUD
- **Combustible**: el de la ETAPA ACTIVA (antes sobre el total de la pila: salia 0 % con el OMS del Shuttle o el ESM de Orion llenos).
- **T+**: tiempo de mision; en Artemis II el piloto desplaza el reloj de simulacion para fijar la ventana de la TLI y T+ no cuenta ese salto.
- **Recorridos**: respecto al cuerpo dominante (antes incluia el movimiento de la Tierra alrededor del Sol).

## Apolo 11: regreso (`apolo11.html`)
Tras alunizar (o con el boton "Regreso automatico"): despegue de la etapa de ascenso (masas reales, 15x90 km, dv 1.891 m/s) -> encuentro y acoplamiento con el modulo de mando (111 km) ->
TEI del modulo de servicio en la cara oculta (dv 687 m/s; el real ~1.000) -> correccion de ~7 m/s -> entrada -> paracaidas -> amerizaje.
Simplificaciones: el encuentro NO se simula y el modulo de mando no existe como entidad separada; estancia de 20 s; misma fisica que la ida; entrada balistica (~23 g); paracaidas exponencial.

## Artemis II (`artemis2.html`)
SLS Bloque 1 + Orion: SLS -> ICPS -> orbita alta 192 x 70.174 km -> TLI (corte por energia) -> TCM a +5 d (solo si hace falta) -> sobrevuelo a 6.545 km -> entrada -> amerizaje; panel de trayectoria en "8".
Simplificaciones: **sitio de lanzamiento ecuatorial del simulador (5,1 N, 90 E; NO es Kennedy)**, ventana fijada por el piloto (salto de reloj), Luna circular, ~21 dias (no ~10), entrada balistica (~23 g, no ~4 g), paracaidas exponencial.

## Pruebas
Las pruebas de Node van aparte (`rocket-tests.zip`): descomprimirlas como carpeta `tests/` junto a estos archivos y ejecutar desde ella. No prueban la interfaz.
