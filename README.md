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
Estancia en la Luna: 21 h 30 min (real 21 h 36) acelerada a x3000; el plano de salida se recalcula al despegar porque la Luna se mueve ~12 grados.
Simplificaciones: el encuentro NO se simula y el modulo de mando no existe como entidad separada; estancia de 20 s; misma fisica que la ida; entrada balistica (~23 g); paracaidas exponencial.

## Artemis II (`artemis2.html`)
SLS Bloque 1 + Orion: SLS -> ICPS -> orbita alta 192 x 70.174 km -> TLI (corte por energia) -> TCM a +5 d (solo si hace falta) -> sobrevuelo a 6.545 km -> entrada -> amerizaje; panel de trayectoria en "8".
Simplificaciones: **sitio de lanzamiento ecuatorial del simulador (5,1 N, 90 E; NO es Kennedy)**, ventana fijada por el piloto (salto de reloj), Luna circular, ~21 dias (no ~10), entrada balistica (~23 g, no ~4 g), paracaidas exponencial.

## Misiones ISS (Soyuz, Saturno V, Shuttle): ascenso dirigido a 408 km
El motor se corta cuando el APOGEO llega a ~408 km (antes seguia hasta velocidad orbital y subia a 1.300-2.900 km antes de que el fasing
teletransportara la nave a 408 km). Despues: coast hasta el apogeo (apuntando en prograde) -> quema de circularizacion centrada en el apogeo,
solo con la nave alineada -> orbita ~400 km casi circular -> fasing (100 m de la ISS, unico salto de pocas decenas de km) -> acople automatico.
Tras terminar el piloto automatico ya no reaparecen los SRB/ET descartados (los "dos tubos laterales" del Shuttle).

## Pruebas
Las pruebas de Node van aparte (`rocket-tests.zip`): descomprimirlas como carpeta `tests/` junto a estos archivos y ejecutar desde ella. No prueban la interfaz.

## Apolo 11: transposicion y descarte del LM (guionizados)
Tras la TLI nueva fase `transposicion` (24 s a x1): el CSM se separa de la S-IVB, gira 180 grados, se acopla al LM y lo extrae; la S-IVB cae al terminar. Durante el regreso, la etapa de ascenso del LM aparece acoplada en `ret_orbit` y se descarta antes de la TEI. Solo visual (opt-in: `transposition` en la config). No verificado en navegador.

## Apolo 11: separacion Columbia/Eagle (fase 7, solo visual), crucero y alunizaje
- Crucero translunar a x3000 (`cruiseTimeScale`): ~4 min reales con la velocidad de mision en x1 (x8 lo divide por 8). La caida final a la Luna va a x150.
- Fase 7 visual: al empezar `descent` Columbia (modulo de mando y servicio) se queda en orbita lunar como objetivo pasivo y baja solo el LM (el modulo de mando desaparece del conjunto).
  La fisica sigue siendo un unico vehiculo con la misma masa y combustible: no hay recalibracion.
- Alunizaje: las patas del LM quedaban ~5,4 m sobre el suelo (el origen del modelo esta en la base de la S-IC); ahora el conjunto baja en los ultimos 50 m de altitud y las patas tocan el suelo.
- Durante el despegue lunar el modelo es la etapa de ascenso; en `ret_orbit` va acoplada al modulo de mando y se descarta al empezar la TEI.
- La Luna a menos de 30 km de altitud se oscurece (brillo x0,6) y sube el umbral del bloom: se veia blanca.

## Apolo 11: Columbia (CSM) como objetivo pasivo en orbita lunar
Al despegar el LM aparece el CSM en orbita circular de 111 km (8 grados por delante del sitio; unos 600 km por delante del LM al insertarse). El acople simplificado coloca la nave exactamente en su posicion y velocidad. Sigue sin haber encuentro real (fase 11) ni CSM como vehiculo separado en el descenso (fase 7 completa). El angulo de 8 grados (`returnTrip.csmPhaseDeg`) NO es una condicion calibrada: solo decide donde se ve Columbia y en que punto de la orbita queda la nave tras el acople simplificado (la TEI espera su angulo igualmente). Medido: con 0-270 grados la primera correccion del regreso varia 3-8 m/s. Render del CSM sin verificar en navegador.

## Apolo 11: orbita de aparcamiento + ventana de TLI
Ascenso con corte por apogeo (185 km) -> coast al apogeo -> circularizacion (173x188 km, T=5278 s) -> 1,75 vueltas (acelerado) -> espera de la ventana: se enciende en el punto de la orbita
opuesto a donde estara la Luna al cruzar su distancia en una elipse de 511.000 km de apogeo, adelantado -35 grados (`tliLeadDeg`) -> TLI -> transposicion -> crucero -> LOI.
El adelanto de -35 grados no es decorativo: con 0 grados la nave llegaba a la Luna casi en vertical (45 m/s en la SOI) y el LOI costaba el doble; con -35 llega con ~150 m/s,
el LOI cuesta lo de siempre y quedan ~1,1-1,3 % de combustible al alunizar (igual que antes del aparcamiento; estable con pasos de 1/30 a 1/120 s).
Probado en Node con 0,15 a 2,3 vueltas y arrancando la mision hasta 4,3 dias simulados despues de cargar. Limitacion: a partir de ~9 dias el crucero falla (igual que antes).

## Apolo 11 (LM real) — `apolo11_lm.html`
Misión nueva, aparte de `apolo11.html` (que no cambia). Se activa con `lmDescent` en `MISSION_CONFIG` (opt-in; sin él motor.js se comporta como antes).
- El LOI lo hace la pila grande (SPS); al terminar, la pila pasa a las dos etapas reales del LM (descenso 2.134 + 8.200 kg; ascenso 2.171 + 2.376 kg, Isp 311).
- Fases nuevas: `separation` (30 s, Eagle se separa de Columbia) → DOI (retrógrado, perilunio de 15 km por energía y momento angular) → coast hasta el perilunio → frenado guiado a empuje máximo (el cabeceo reparte empuje entre frenar y sostener el perfil vertical) → `final` (control por throttle de la versión antigua).
- Al alunizar se descarta la etapa de descenso (`jettison`) y despega la de ascenso. Si la etapa de descenso se agota antes de alunizar, la misión aborta (guarda `currentIndex>0`).
- Parámetros barridos en Node (`brakeRateCap` 20–80, `rateK`, `gain`, `brakeEndHs`): con 60 / 0,8 / 0,3 / 30 sobran ≈1.050 kg de propergol de descenso (≈13 %). `rateK` 0,4 falla (agota). El HUD muestra el combustible de la etapa actual, así que no salta.
- No verificado en navegador (solo Node); la misión antigua sigue dando el mismo resultado (1,3 % de margen).
