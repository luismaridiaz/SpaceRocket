
(function checkDeps(){
  const missing = [];
  if (typeof THREE === 'undefined') missing.push('three.js core');
  else {
    ['OrbitControls','EffectComposer','RenderPass','ShaderPass','UnrealBloomPass','CopyShader']
      .forEach(k => { if (typeof THREE[k] === 'undefined') missing.push('THREE.'+k); });
  }
  if (missing.length) {
    const el = document.getElementById('statusMsg');
    el.style.display = 'block';
    el.textContent = '⚠️ Faltan librerías: ' + missing.join(', ');
    throw new Error('Dependencias de Three.js incompletas: ' + missing.join(', '));
  }
})();

/* ---------- FÍSICA ---------- */
/* ---------- SISTEMA SOLAR: datos reales y mecanica orbital ---------- */
const AU = 1.495978707e11;
const G = 6.67430e-11;
// Fecha de inicio de la mision: "hoy" (misma fecha de referencia usada para calcular la posicion de Halley,
// asi todo el calendario del juego es coherente entre si).
const MISSION_START_MS = new Date('2026-09-07T00:00:00Z').getTime();
function missionDate(simSeconds){ return new Date(MISSION_START_MS + simSeconds*1000); }
function formatMissionDate(d){
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return String(d.getUTCDate()).padStart(2,'0')+' '+meses[d.getUTCMonth()]+' '+d.getUTCFullYear();
}
function formatElapsed(s){
  if (s<60) return s.toFixed(0)+'s';
  if (s<3600) return (s/60).toFixed(1)+'min';
  if (s<86400) return (s/3600).toFixed(1)+'h';
  if (s<86400*365.25) return (s/86400).toFixed(1)+'d';
  return (s/(86400*365.25)).toFixed(2)+'años';
}
// Formato unico de distancia, usado en TODOS los lectores (telemetria, HUDs, mini-vistas) para
// que la unidad nunca se duplique (bug real encontrado: "400958095.2kmm") y los numeros grandes
// (interplanetarios) sean legibles en vez de una pared de digitos.
function formatDistance(m){
  const absM=Math.abs(m);
  if (absM<1000) return m.toFixed(0)+' m';
  if (absM<1e7) return (m/1000).toFixed(1)+' km';
  if (absM<1.5e11) return Math.round(m/1000).toLocaleString('es-ES')+' km';
  return (m/AU).toFixed(3)+' UA';
}
const DAY = 86400;

/* ---------- ROTACION REAL DE LA TIERRA Y COORDENADAS LAT/LON ---------- */
const EARTH_SIDEREAL_DAY = 86164.1; // segundos (dia sideral real, no las 24h del dia solar)
const LAUNCH_SITE = (typeof window!=='undefined' && window.CUSTOM_LAUNCH_SITE) || { name:'Kourou (Guayana Francesa, ESA)', latDeg:5.2, lonDeg:-52.8 };
// Elegido en vez de Cabo Cañaveral (28.5N, el real del Apolo 11) porque esa latitud es MAS
// inclinada que el plano orbital de la Luna en nuestro modelo (5.145 grados) -- lanzar alli
// exigiria un cambio de plano que no modelamos. Kourou (5.2N, base real de la ESA) coincide
// casi exacto con el plano lunar, y es la misma razon fisica por la que en la realidad se
// lanza cerca del ecuador cuando el destino lo permite (por eso Cabo Cañaveral tampoco esta
// en un polo: la latitud de lanzamiento fija que inclinaciones orbitales se pueden alcanzar).
function latLonToXYZ(latDeg, lonDeg, r){
  const lat=latDeg*Math.PI/180, lon=lonDeg*Math.PI/180;
  return { x:r*Math.cos(lat)*Math.cos(lon), y:r*Math.sin(lat), z:r*Math.cos(lat)*Math.sin(lon) };
}
function eastDirAt(lonDeg){
  const lon=lonDeg*Math.PI/180;
  return { x:-Math.sin(lon), y:0, z:Math.cos(lon) };
}
function earthRotationBoost(latDeg, R_earth){
  const lat=latDeg*Math.PI/180;
  return (2*Math.PI*R_earth*Math.cos(lat))/EARTH_SIDEREAL_DAY;
}

// ---- Rotacion de marco de referencia: 'arriba' (cabeceo 0) deja de ser siempre el eje Y global.
// Al lanzar desde un punto que no es el 'polo' de nuestro sistema de coordenadas, la vertical
// local de verdad es otra direccion -- esta rotacion fija (calculada una vez) hace que 'cabeceo 0'
// siga significando 'arriba de verdad' en el sitio de lanzamiento real, sin tocar como se pilotea.
function cross3(a,b){ return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
function dot3(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
function norm3(v){ const m=Math.sqrt(dot3(v,v))||1; return {x:v.x/m,y:v.y/m,z:v.z/m}; }
function rotateAroundAxis(v, axis, angle){
  const cosA=Math.cos(angle), sinA=Math.sin(angle);
  const d=dot3(axis,v), c=cross3(axis,v);
  return { x:v.x*cosA+c.x*sinA+axis.x*d*(1-cosA), y:v.y*cosA+c.y*sinA+axis.y*d*(1-cosA), z:v.z*cosA+c.z*sinA+axis.z*d*(1-cosA) };
}
function makeRotation(from, to){
  from=norm3(from); to=norm3(to);
  const d=dot3(from,to);
  if (d>0.999999) return v=>v;
  if (d<-0.999999){
    const axis = Math.abs(from.x)<0.9 ? norm3(cross3(from,{x:1,y:0,z:0})) : norm3(cross3(from,{x:0,y:1,z:0}));
    return v=>rotateAroundAxis(v,axis,Math.PI);
  }
  const axis=norm3(cross3(from,to));
  const angle=Math.acos(Math.max(-1,Math.min(1,d)));
  return v=>rotateAroundAxis(v,axis,angle);
}
const LAUNCH_UP = norm3(latLonToXYZ(LAUNCH_SITE.latDeg, LAUNCH_SITE.lonDeg, 1));
const FRAME_ROTATION = makeRotation({x:0,y:1,z:0}, LAUNCH_UP);
const FRAME_ROTATION_INV = makeRotation(LAUNCH_UP, {x:0,y:1,z:0});
// Yaw que apunta al ESTE real una vez tumbada la nave (el giro gravitatorio real: lanzar hacia
// el este es lo que da la inclinacion orbital mas baja alcanzable desde una latitud dada).
const EAST_LOCAL = FRAME_ROTATION_INV(eastDirAt(LAUNCH_SITE.lonDeg));
const LAUNCH_YAW_EAST = Math.atan2(EAST_LOCAL.x, EAST_LOCAL.z);

const SOLAR_BODIES = {
  sun:     { mass:1.989e30, radius:6.96e8, parent:null, color:0xffcc66 },
  earth:   { mass:5.972e24, radius:6.371e6, parent:'sun', a:1.000*AU, period:365.25*DAY, phase0:6.01299, incl:0 },
  moon:    { mass:7.342e22, radius:1.7374e6, parent:'earth', a:3.844e8, period:27.321661*DAY, phase0:0, incl:0.08980 },
  mars:    { mass:6.417e23, radius:3.3895e6, parent:'sun', a:1.524*AU, period:686.98*DAY, phase0:1.28055, incl:0.03228, color:0xc1440e },
  jupiter: { mass:1.898e27, radius:6.9911e7, parent:'sun', a:5.203*AU, period:4332.59*DAY, phase0:2.25632, incl:0.02277, color:0xd8ae6f },
  io:      { mass:8.93e22,  radius:1.8216e6, parent:'jupiter', a:4.217e8, period:1.769*DAY, phase0:0, incl:0, color:0xe8d060 },
  europa:  { mass:4.8e22,   radius:1.5608e6, parent:'jupiter', a:6.709e8, period:3.551*DAY, phase0:1.1, incl:0, color:0xd9c9a8 },
  ganymede:{ mass:1.4819e23,radius:2.6341e6, parent:'jupiter', a:1.0704e9, period:7.155*DAY, phase0:2.4, incl:0, color:0x9c8f7a },
  callisto:{ mass:1.0759e23,radius:2.4103e6, parent:'jupiter', a:1.8827e9, period:16.69*DAY, phase0:3.6, incl:0, color:0x7a6f60 },
  saturn:  { mass:5.683e26, radius:5.8232e7, parent:'sun', a:9.537*AU, period:10759.22*DAY, phase0:0.17604, incl:0.04339, color:0xead6a8 },
  titan:   { mass:1.3452e23,radius:2.5747e6, parent:'saturn', a:1.2218e9, period:15.945*DAY, phase0:0, incl:0, color:0xd6a85a },
  uranus:  { mass:8.681e25, radius:2.5362e7, parent:'sun', a:19.191*AU, period:30688.5*DAY, phase0:1.08882, incl:0.01349, color:0x9fd6e0 },
  neptune: { mass:1.024e26, radius:2.4622e7, parent:'sun', a:30.069*AU, period:60195*DAY, phase0:0.04382, incl:0.03089, color:0x4166f5 },
  pluto:   { mass:1.303e22, radius:1.1883e6, parent:'sun', a:39.482*AU, period:90560*DAY, phase0:5.31226, incl:0.29950, color:0xcbb69d }
};
const SOLAR_BODY_NAMES = Object.keys(SOLAR_BODIES).filter(n=>n!=='sun');

function soiOf(name){
  const b=SOLAR_BODIES[name];
  if (!b.parent) return 1e15;
  const parent=SOLAR_BODIES[b.parent];
  return b.a*Math.pow(b.mass/parent.mass,0.4);
}
function positionOf(name,t){
  const b=SOLAR_BODIES[name];
  if (!b.parent) return {x:0,y:0,z:0};
  const pp=positionOf(b.parent,t);
  const angle=b.phase0+(2*Math.PI/b.period)*t;
  // orbita inclinada: se calcula en el plano y luego se inclina alrededor del eje x
  // (simplificacion: se ignora la longitud del nodo ascendente real, el eje de inclinacion
  // se fija en x para todos los cuerpos - suficiente para romper la coplanaridad total)
  const xp=b.a*Math.cos(angle), zp=b.a*Math.sin(angle);
  const incl=b.incl||0;
  return {x:pp.x+xp, y:pp.y+zp*Math.sin(incl), z:pp.z+zp*Math.cos(incl)};
}

// Velocidad heliocentrica de un cuerpo en el instante t: derivada ANALITICA de positionOf
// (misma orbita circular inclinada), sumada a lo largo de la cadena de padres.
function velocityOf(name,t){
  const b=SOLAR_BODIES[name];
  if (!b.parent) return {x:0,y:0,z:0};
  const pv=velocityOf(b.parent,t);
  const w=2*Math.PI/b.period, angle=b.phase0+w*t, incl=b.incl||0;
  const vx=-b.a*w*Math.sin(angle), vz=b.a*w*Math.cos(angle);
  return {x:pv.x+vx, y:pv.y+vz*Math.sin(incl), z:pv.z+vz*Math.cos(incl)};
}

// Misiones que acoplan con la ISS REAL de iss.js (Soyuz, Saturno V o Shuttle). Bug real: el
// Shuttle comprobaba solo type==='iss', asi que el motor medía contra la ISS real pero
// dibujaba la ISS-fantasma del sandbox (a ~7.600 km) y nunca construia issGroup.
function usesRealIssMission(){
  const c = (typeof window!=='undefined') ? window.MISSION_CONFIG : null;
  return !!(c && (c.type==='iss' || c.type==='shuttle'));
}
/* ---------- ACOPLAMIENTO: sistema generico de objetivos ---------- */
// Cualquier escenario futuro (estacion, rescate) solo necesita añadir una entrada aqui:
// parent (que cuerpo orbita), altitude (altura sobre la superficie), y phase0 (angulo de partida).
// El resto (periodo, velocidad orbital, deteccion de acoplamiento) es generico.
const DOCKING_TARGETS = [
  { id:'iss', name:'Estación Espacial Internacional', parent:'earth', altitude:408000, phase0:1.0 }
];
const DOCK_MAX_DIST = 15; // metros
const DOCK_MAX_SPEED = 0.3; // m/s

// ---- Puertos de acoplamiento de la ISS (una unica fuente de verdad: los usa buildISS para
// dibujar los anillos y la fisica para colocar la nave acoplada) ----
const ISS_MODEL_U = 1;
const ISS_MODEL_ZC = 0.8; // factor de compresion de longitud del cluster de modulos
const ISS_PORTS_DEF = [
  {pos:{x:0,y:0,z:-28*ISS_MODEL_U*ISS_MODEL_ZC},type:'ruso',id:'Zvezda-aft'},
  {pos:{x:0,y:2.5*ISS_MODEL_U,z:-4*ISS_MODEL_U*ISS_MODEL_ZC},type:'ruso',id:'Poisk-zenith'},
  {pos:{x:4*ISS_MODEL_U,y:0,z:15*ISS_MODEL_U*ISS_MODEL_ZC},type:'americano',id:'Harmony-forward'},
  {pos:{x:0,y:4.5*ISS_MODEL_U,z:15*ISS_MODEL_U*ISS_MODEL_ZC},type:'americano',id:'Harmony-zenith'},
  {pos:{x:0,y:-4.5*ISS_MODEL_U,z:15*ISS_MODEL_U*ISS_MODEL_ZC},type:'americano',id:'Harmony-nadir'},
  {pos:{x:4*ISS_MODEL_U,y:0,z:-16*ISS_MODEL_U*ISS_MODEL_ZC},type:'americano',id:'Unity-nadir'}
];
// Direccion hacia fuera de un puerto (marco local de la ISS): radial respecto al eje
// longitudinal (z) del cluster de modulos; para el puerto del extremo, a lo largo del eje.
function issPortOutward(pos){
  const m=Math.hypot(pos.x,pos.y);
  if (m>1e-6) return {x:pos.x/m, y:pos.y/m, z:0};
  return {x:0, y:0, z:pos.z<0?-1:1};
}
// Punta del cono de la capsula en el eje local del cohete (capsuleTop: y=8.18, alto 0.75)
// y holgura entre la punta y el anillo del puerto.
const DOCK_CONTACT_Y = 8.555;
const DOCK_GAP = 0.3;
// Marco local de la ISS en el mundo: identico al que el render aplica a issGroup
// (arriba = radial saliente de la Tierra; ver RocketRenderer3D.update).
function issBasisAt(issGeoPos){
  const up=norm3(issGeoPos);
  let right=cross3(up,{x:0,y:0,z:1});
  right = dot3(right,right)<1e-12 ? {x:1,y:0,z:0} : norm3(right);
  const fwd=norm3(cross3(right,up));
  return {right, up, fwd};
}
function issLocalToWorld(b,v){
  return {
    x:b.right.x*v.x+b.up.x*v.y+b.fwd.x*v.z,
    y:b.right.y*v.x+b.up.y*v.y+b.fwd.y*v.z,
    z:b.right.z*v.x+b.up.z*v.y+b.fwd.z*v.z
  };
}
// Resolver de objetivo de acoplamiento para la mision ISS: la ISS REAL (con inclinacion),
// con su marco local y su radio orbital (la fisica los necesita estando acoplado).
function makeIssDockingResolver(){
  return (target, t) => {
    if (target.id !== 'iss') return dockingTargetState(target, t);
    const earthPos = positionOf('earth', t);
    const posHelio = orbitalObjectPosition(ISS, t);
    const pos = { x:posHelio.x-earthPos.x, y:posHelio.y-earthPos.y, z:posHelio.z-earthPos.z };
    return { pos, vel: orbitalObjectVelocity(ISS, t), r: Math.hypot(pos.x,pos.y,pos.z), basis: issBasisAt(pos) };
  };
}
function dockingTargetState(target, t){
  const parent = SOLAR_BODIES[target.parent];
  const r = parent.radius + target.altitude;
  const period = 2*Math.PI*Math.sqrt(Math.pow(r,3)/(6.67430e-11*parent.mass));
  const angVel = 2*Math.PI/period;
  const angle = target.phase0 + angVel*t;
  if (target.e1 && target.e2){   // orbita circular en un plano dado por dos ejes ortonormales (p.ej. el CSM lunar de Apolo)
    const c=Math.cos(angle), s=Math.sin(angle), e1=target.e1, e2=target.e2;
    return {
      pos:{x:r*(c*e1.x+s*e2.x), y:r*(c*e1.y+s*e2.y), z:r*(c*e1.z+s*e2.z)},
      vel:{x:r*angVel*(-s*e1.x+c*e2.x), y:r*angVel*(-s*e1.y+c*e2.y), z:r*angVel*(-s*e1.z+c*e2.z)},
      r, period
    };
  }
  return {
    pos:{x:r*Math.cos(angle), y:0, z:r*Math.sin(angle)},
    vel:{x:-r*angVel*Math.sin(angle), y:0, z:r*angVel*Math.cos(angle)},
    r, period
  };
}

// Cometa Halley: elementos orbitales reales, Kepler eliptico (e=0.967, no admite aproximacion circular)
const HALLEY = {
  a: 17.834*AU, e:0.96658, period:75.32*365.25*DAY,
  daysSincePerihelion: 14820, // dias desde el perihelio real del 9-feb-1986 hasta la fecha de referencia (7-sep-2026)
  inclinationTilt: 2.83
};
function solveKepler(M,e){
  let E=M;
  for (let i=0;i<50;i++){
    const dE=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
    E-=dE;
    if (Math.abs(dE)<1e-10) break;
  }
  return E;
}
function halleyPosition(t){
  const n=2*Math.PI/HALLEY.period;
  const M0=n*(HALLEY.daysSincePerihelion*DAY);
  const M=((M0+n*t)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
  const E=solveKepler(M,HALLEY.e);
  const r=HALLEY.a*(1-HALLEY.e*Math.cos(E));
  const nu=2*Math.atan2(Math.sqrt(1+HALLEY.e)*Math.sin(E/2),Math.sqrt(1-HALLEY.e)*Math.cos(E/2));
  const xOrb=r*Math.cos(nu), zOrb=r*Math.sin(nu);
  return {x:xOrb, y:zOrb*Math.sin(HALLEY.inclinationTilt), z:zOrb*Math.cos(HALLEY.inclinationTilt), r};
}

/* ---------- PILA DE ETAPAS REALES (por defecto: deposito unico, igual que siempre) ---------- */
// Cada etapa: masa seca, combustible, empuje e Isp propios. La separacion es automatica al
// agotar el combustible de la etapa activa (la siguiente entra con su deposito lleno, sin salto
// de "vuelta al 100%" en la telemetria porque fuelPercent se calcula sobre el TOTAL de toda la
// mision, no solo la etapa activa).
class StageStack {
  constructor(stages){
    // Cada etapa recuerda su empuje e Isp originales (thrust_base/isp_base): setEngine()
    // sobrescribe thrust/isp de la etapa actual, y 'Quimico' debe poder volver a ellos.
    this.stages = stages && stages.length
      ? stages.map(s=>({
          ...s,
          thrust_base: s.thrust_base!==undefined ? s.thrust_base : s.thrust,
          isp_base:    s.isp_base!==undefined    ? s.isp_base    : s.isp,
          // Toda etapa arranca apagada, incluso si declara fixedThrust (SRB): un solido
          // esta "listo para arder" pero no arde hasta que el jugador (o el piloto
          // automatico) pide throttle>0 -- ver _integrate() e effectiveThrustAt().
          ignited: false
        }))
      : [
          { id:'unica', dryMass:30000, fuelMass:270000, maxFuelMass:270000,
            thrust:6500000, isp:450, thrust_base:6500000, isp_base:450, ignited:false }
        ];
    this.currentIndex = 0;
    this._totalMaxFuel = this.stages.reduce((a,s)=>a+s.maxFuelMass,0);
    this.justSeparated = null;
  }
  current(){ return this.stages[this.currentIndex]; }
  // Descarta la etapa actual aunque le quede propelente (ICPS tras sus quemas, modulo de servicio
  // antes de la entrada). Solo la usa el piloto de Artemis II; las demas misiones no la llaman.
  jettison(){
    const cur=this.current(); if (!cur || this.currentIndex>=this.stages.length-1) return false;
    cur.fuelMass=0; this.justSeparated=cur.id; this.currentIndex++; return true;
  }
  get dryMass(){ let m=0; for (let i=this.currentIndex;i<this.stages.length;i++) m+=this.stages[i].dryMass; return m; }
  get fuelMass(){ let m=0; for (let i=this.currentIndex;i<this.stages.length;i++) m+=this.stages[i].fuelMass; return m; }
  set fuelMass(v){
    const burned=this.fuelMass-v;
    const cur=this.current();
    cur.fuelMass=Math.max(0,cur.fuelMass-burned);
    if (cur.fuelMass<=0 && this.currentIndex<this.stages.length-1){
      this.justSeparated=cur.id;
      this.currentIndex++;
    }
  }
  get maxFuelMass(){ return this._totalMaxFuel; }
  // Para una etapa hibrida (fixedThrust+throttlableThrust, sin thrust/isp planos), el
  // "empuje maximo" para mostrar (HUD, TWR) es la suma de ambos componentes a plena marcha.
  get maxThrust(){
    const c=this.current();
    if (c.fixedThrust!==undefined || c.throttlableThrust!==undefined) return (c.fixedThrust||0)+(c.throttlableThrust||0);
    return c.thrust;
  }
  set maxThrust(v){ this.current().thrust=v; }
  get isp(){ return this.current().isp; }
  set isp(v){ this.current().isp=v; }
  reset(){ this.currentIndex=0; for (const s of this.stages){ s.fuelMass=s.maxFuelMass; s.ignited=false; } this.justSeparated=null; }
  // Empuje efectivo y caudal masico de la etapa actual, dado el throttle del jugador y el
  // tiempo de mision. Dos tipos de etapa:
  //  - Simple: usa thrust/isp (comportamiento clasico). notThrottlable fuerza throttle=1
  //    mientras haya combustible (p.ej. un SRB modelado como etapa unica, sin componente liquido).
  //  - Hibrida: fixedThrust/fixedIsp (componente no regulable, p.ej. SRB) +
  //    throttlableThrust/throttlableIsp (componente regulable, p.ej. SSME), con ventana
  //    opcional de throttle-down (throttleDownStart/End/Factor) aplicada SOLO al componente
  //    regulable -- el fijo nunca se toca, es la generalizacion de notThrottlable.
  effectiveThrustAt(throttle, missionTime){
    const c=this.current();
    if (!c) return {thrust:0, massFlow:0};
    if (c.fixedThrust!==undefined || c.throttlableThrust!==undefined){
      // fixedT gateado por ignited: un SRB "listo" pero sin encender no produce empuje.
      // Se enciende la primera vez que _integrate() ve throttle>0 en esta etapa (y, una
      // vez encendido, ya no se apaga -- un solido no se puede apagar).
      const fixedT=c.ignited ? (c.fixedThrust||0) : 0, fixedIsp=c.fixedIsp||1;
      const throttT=c.throttlableThrust||0, throttIsp=c.throttlableIsp||1;
      let effThrottle=throttle;
      if (c.throttleDownStart!==undefined && c.throttleDownEnd!==undefined && missionTime>=c.throttleDownStart && missionTime<=c.throttleDownEnd){
        effThrottle*=(c.throttleDownFactor!==undefined ? c.throttleDownFactor : 1);
      }
      const throttTActual=throttT*effThrottle;
      const fixedFlow=fixedIsp>0 ? fixedT/(fixedIsp*9.81) : 0;
      const throttFlow=throttIsp>0 ? throttTActual/(throttIsp*9.81) : 0;
      return {thrust:fixedT+throttTActual, massFlow:fixedFlow+throttFlow};
    }
    // notThrottlable: siempre al 100% mientras haya combustible, SIN IMPORTAR el throttle
    // del jugador (ni siquiera 0) -- un SRB no se puede apagar una vez encendido. La decision
    // de si esta etapa deberia estar ardiendo en absoluto (fuelMass>0) la toma el llamador.
    // Gateado por ignited igual que el componente fijo de una etapa hibrida (ver arriba):
    // ninguna mision actual usa notThrottlable simple, pero sin este gateo una futura
    // reproduciria el mismo bug del Shuttle (arder desde el primer frame sin throttle>0).
    const effThrottle = c.notThrottlable ? (c.ignited ? 1 : 0) : throttle;
    const t=(c.thrust||0)*effThrottle;
    const mdot=(c.isp>0) ? t/(c.isp*9.81) : 0;
    return {thrust:t, massFlow:mdot};
  }
}

/* ---------- FISICA: motor multi-cuerpo (conicas remendadas) ---------- */
class RocketPhysics {
  constructor(){
    this.stack=new StageStack();
    const launchPos0 = latLonToXYZ(LAUNCH_SITE.latDeg, LAUNCH_SITE.lonDeg, SOLAR_BODIES.earth.radius);
    this.x=launchPos0.x; this.y=launchPos0.y; this.z=launchPos0.z; // Kourou real, no el 'polo' del sistema de coordenadas
    // Punto de lanzamiento (geocentrico), capturado una sola vez, para dibujar la plataforma.
    // NO se recalcula con el tiempo: la nave en tierra con motor apagado NO co-rota con la
    // Tierra de forma limpia (sigue integrando su velocidad tangencial inicial bajo el
    // timeScale por defecto -- medido: se desliza >160km en 9s reales de reloj sin despegar).
    // Anclar la plataforma a este punto fijo, en vez de recalcular una rotacion "ideal", hace
    // que siga fielmente a la nave sea cual sea su comportamiento real, en vez de divergir.
    this._launchPos0 = {x:launchPos0.x, y:launchPos0.y, z:launchPos0.z};
    this.pitch=0; this.roll=0; this.yaw=0;
    const boost0=earthRotationBoost(LAUNCH_SITE.latDeg, SOLAR_BODIES.earth.radius), east0=eastDirAt(LAUNCH_SITE.lonDeg);
    this.u=boost0*east0.x; this.v=boost0*east0.y; this.w=boost0*east0.z;
    this._launchVel0 = {u:this.u, v:this.v, w:this.w}; // co-rotacion de la plataforma, se restaura al despegar
    this._wasFrozen = false;
    this.pitchRate=0; this.rollRate=0; this.yawRate=0;
    this.throttle=0; this.time=0; this.hyperspace=false; this.warp=false; this.engineKind='chemical';
    this.dockedTo=null;
    this.particles=[]; this.trail=[]; this.shakeIntensity=0; this.rpm=0;
    this.G=6.67430e-11;
    this._lastState={altitude:0, bodyName:'earth', dist:SOLAR_BODIES.earth.radius, gMag:9.81, reentryFlag:false};
    this._dockingTargetResolver = null;
    this._dockPortIdx = null; this._dockOutward = null;
  }
  get dryMass(){ return this.stack.dryMass; }
  get fuelMass(){ return this.stack.fuelMass; }
  set fuelMass(v){ this.stack.fuelMass=v; }
  get maxFuelMass(){ return this.stack.maxFuelMass; }
  get maxThrust(){ return this.stack.maxThrust; }
  set maxThrust(v){ this.stack.maxThrust=v; }
  get Isp(){ return this.stack.isp; }
  set Isp(v){ this.stack.isp=v; }
  static rotateVec(vx,vy,vz,pitch,yaw,roll){
    let cz=Math.cos(roll), sz=Math.sin(roll);
    let x1=vx*cz-vy*sz, y1=vx*sz+vy*cz, z1=vz;
    let cx=Math.cos(pitch), sx=Math.sin(pitch);
    let x2=x1, y2=y1*cx-z1*sx, z2=y1*sx+z1*cx;
    let cy=Math.cos(yaw), sy=Math.sin(yaw);
    return {x:x2*cy+z2*sy, y:y2, z:-x2*sy+z2*cy};
  }
  computeAtmosphere(altitude){
    const h=Math.max(0,altitude); let T,p;
    if (h<11000){ T=288.15-0.0065*h; p=101325*Math.pow((288.15/T),5.2561); }
    else if (h<20000){ T=216.65; p=22632*Math.exp(-(h-11000)/6340); }
    else if (h<100000){ T=216.65+(h-20000)*0.001; p=5475*Math.pow((216.65/T),34.163); }
    else { T=216.65; p=0; }
    return { density: p>0?p/(287.05*T):0 };
  }
  refuel(){
    const cur=this.stack.current();
    // Una etapa de combustible solido (fixedThrust, p.ej. los SRB del Shuttle) no se puede
    // 'repostar': reponer sus 1.179.400 kg a mitad de ascenso seria un exploit.
    if (cur.fixedThrust) return false;
    cur.fuelMass=cur.maxFuelMass; return true;
  }
  // La app puede inyectar un resolver que decida como calcular la posicion/velocidad
  // de cada target de acoplamiento. Si no se inyecta, se usa `dockingTargetState`
  // (comportamiento original del sandbox). En iss.html se inyecta uno que usa la
  // ISS real de `iss.js`, para que el HUD mida contra la misma ISS que el jugador ve.
  setDockingTargetResolver(fn) {
    this._dockingTargetResolver = fn;
  }
  // Devuelve info del objetivo de acoplamiento mas cercano ALCANZABLE (mismo cuerpo dominante que la nave).
  // Generico: sirve para cualquier objetivo de DOCKING_TARGETS, no solo la plataforma de demostracion.
  nearestDockingInfo(){
    const bodyName=this._lastState.bodyName;
    let best=null;
    for (const target of DOCKING_TARGETS){
      if (target.parent!==bodyName) continue;
      const ts = this._dockingTargetResolver
        ? this._dockingTargetResolver(target, this.time)
        : dockingTargetState(target, this.time);
      const dx=this.x-ts.pos.x, dy=this.y-ts.pos.y, dz=this.z-ts.pos.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      const dvx=this.u-ts.vel.x, dvy=this.v-ts.vel.y, dvz=this.w-ts.vel.z;
      const relSpeed=Math.sqrt(dvx*dvx+dvy*dvy+dvz*dvz);
      if (!best || dist<best.dist) best={target, dist, relSpeed, canDock: dist<DOCK_MAX_DIST && relSpeed<DOCK_MAX_SPEED, ts};
    }
    return best;
  }
  tryDock(){
    const info=this.nearestDockingInfo();
    if (info && info.canDock){
      this.dockedTo=info.target.id;
      // Si el objetivo trae su marco local (la ISS de la mision ISS), se acopla al puerto
      // MAS CERCANO a donde esta la nave, no al centro de la estacion.
      this._dockPortIdx=null;
      const ts=info.ts;
      if (ts && ts.basis){
        const d={x:this.x-ts.pos.x, y:this.y-ts.pos.y, z:this.z-ts.pos.z};
        let bestD=Infinity;
        ISS_PORTS_DEF.forEach((port,i)=>{
          const w=issLocalToWorld(ts.basis, port.pos);
          const dd=Math.hypot(d.x-w.x, d.y-w.y, d.z-w.z);
          if (dd<bestD){ bestD=dd; this._dockPortIdx=i; }
        });
      }
      return true;
    }
    return false;
  }
  undock(){
    if (!this.dockedTo) return;
    if (this._dockOutward){
      // Acoplado a un puerto: el empujon de separacion va hacia FUERA del puerto
      // (el morro apunta al puerto, empujar hacia el morro seria meterse en la estacion).
      const o=this._dockOutward;
      this.u+=o.x*1.0; this.v+=o.y*1.0; this.w+=o.z*1.0;
    } else {
      const heading=FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,this.pitch,this.yaw,this.roll));
      this.u+=heading.x*1.0; this.v+=heading.y*1.0; this.w+=heading.z*1.0; // pequeño empujon de separacion
    }
    this._dockPortIdx=null; this._dockOutward=null;
    this.dockedTo=null;
  }
  setEngine(kind){
    // Nuclear (NTR): mas Isp, algo menos de empuje, solo tiene sentido en el espacio
    // (no se enciende en el lanzamiento, igual que en la vida real por seguridad/radiacion en la atmosfera).
    // RCS: empuje bajo (~0,5 m/s2 con la nave de la mision ISS) para la aproximacion final y el
    // acoplamiento manual; con este empuje la nave no puede despegar.
    // Quimico: el motor DE LA ETAPA, restaurado desde thrust_base/isp_base (antes fijaba siempre
    // 6,5 MN y degradaba de forma permanente el empuje de cada mision).
    if (kind==='nuclear'){
      this.engineKind='nuclear'; this.maxThrust=4200000; this.Isp=880;
    } else if (kind==='rcs'){
      this.engineKind='rcs'; this.maxThrust=55000; this.Isp=290;
    } else {
      this.engineKind='chemical';
      const s=this.stack.current();
      if (s){
        if (s.thrust_base!==undefined) this.maxThrust=s.thrust_base;
        if (s.isp_base!==undefined) this.Isp=s.isp_base;
      }
    }
  }
  static targetAngles(d){
    const dy=Math.max(-1,Math.min(1,d.y));
    const pitch=Math.acos(dy);
    const sinP=Math.sin(pitch);
    const yaw = Math.abs(sinP)<1e-6 ? 0 : Math.atan2(d.x/sinP, d.z/sinP);
    return {pitch,yaw};
  }
  static wrapAngle(a){ while(a>Math.PI)a-=2*Math.PI; while(a<-Math.PI)a+=2*Math.PI; return a; }
  // Piloto automatico de actitud (SAS): calcula ordenes de pitch/yaw/roll para apuntar hacia 'dir'.
  // Probado por separado: converge exactamente al objetivo (ver prueba previa a esta integracion).
  autopilotSteer(dir){
    const localDir=FRAME_ROTATION_INV(dir);
    const {pitch:pt,yaw:yt}=RocketPhysics.targetAngles(localDir);
    const Kp=3.0, Kd=2.0;
    const pitchErr=RocketPhysics.wrapAngle(pt-this.pitch), yawErr=RocketPhysics.wrapAngle(yt-this.yaw), rollErr=RocketPhysics.wrapAngle(0-this.roll);
    return {
      pitch:Math.max(-1,Math.min(1,Kp*pitchErr-Kd*this.pitchRate)),
      yaw:Math.max(-1,Math.min(1,Kp*yawErr-Kd*this.yawRate)),
      roll:Math.max(-1,Math.min(1,Kp*rollErr-Kd*this.rollRate))
    };
  }
  step(rawDt, controls){
    const frameDt=Math.min(rawDt,0.05);
    const timeScale=controls.timeScale||1;
    let remaining=frameDt*timeScale;
    // Misiones con trayectorias de precision (Artemis II: retorno libre): el paso adaptativo
    // normal (periodo/2000, Euler semi-implicito) pierde 1-11 % de la energia orbital en un solo
    // paso por el perigee de una orbita muy excentrica (medido: HEO 192x70.174 km, segun el
    // timeScale), lo que cambia el apogeo en decenas de miles de km. Con preciseOrbits el paso es
    // 10 veces menor y se permiten mas sub-pasos por fotograma. Opt-in: el resto de misiones
    // estan calibradas con el paso normal y no se tocan.
    const PRECISE = (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.preciseOrbits);
    const SUB_DIV = PRECISE ? 20000 : 2000;
    const MAX_SUBSTEPS = PRECISE ? 3000 : 500;
    let n=0;
    while (remaining>1e-6 && n<MAX_SUBSTEPS){
      const s=this._lastState;
      const bMass=SOLAR_BODIES[s.bodyName]?SOLAR_BODIES[s.bodyName].mass:this.G;
      const period=2*Math.PI*Math.sqrt(Math.pow(s.dist,3)/(this.G*bMass));
      const dynSub=Math.max(PRECISE?0.01:0.05, Math.min(3600, isFinite(period)?period/SUB_DIV:3600));
      // preciseOrbits: sub-pasos IGUALES (en vez de min(dynSub, remaining), que deja un sub-paso
      // sobrante mas corto al final de cada fotograma). Con Euler semi-implicito, ese dt que
      // alterna entre dos valores rompe la conservacion de energia (deriva medida: -0,1 % a -1 %
      // segun el timeScale, a igual dynSub); con dt uniforme y suave la deriva desaparece.
      const sub = PRECISE ? remaining/Math.max(1,Math.ceil(remaining/dynSub)) : Math.min(dynSub, remaining);
      this._integrate(sub, controls);
      remaining-=sub; n++;
    }
    return this.getState();
  }
  _integrate(dt, controls){
    const PRECISE_STEP = (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.preciseOrbits);
    this.time+=dt;
    this.throttle=Math.max(0,Math.min(1,controls.throttle||0));
    // Encendido de etapa: la primera vez que el jugador (o el piloto automatico) pide
    // throttle>0 en la etapa actual, la marcamos como encendida. A partir de ahi, el
    // componente fijo (SRB) arde y no se puede apagar (un solido no se apaga). Antes de
    // ese momento, ninguna etapa produce empuje aunque declare fixedThrust -- el SRB del
    // Shuttle esta "listo para arder" pero no esta ardiendo hasta que el jugador lanza.
    if (this.throttle>0){
      const cur=this.stack.current();
      if (cur && !cur.ignited) cur.ignited=true;
    }
    // En tierra, sin empuje: si solo corrigieramos DESPUES de integrar (anulando la velocidad
    // tangencial tras el hecho), el primer sub-paso ya se habria desplazado a la velocidad
    // inicial de rotacion terrestre durante todo ese dt -- con timeScale=100 son ~450m/s x
    // 1.67s = ~765m de deriva de golpe, incluso "congelada" despues. Evitando la integracion de
    // fuerzas por completo mientras ya esta asentada, ese margen desaparece. No afecta al
    // despegue (throttle>=0.05 nunca entra aqui) ni a otros cuerpos (solo 'earth').
    // Si la etapa actual va a arder de todas formas con throttle=0 (notThrottlable, o el
    // componente fijo de una etapa hibrida SRB+SSME), "congelarse en tierra" aqui la dejaria
    // sin empuje aunque este fisicamente encendida.
    const stageBurningRegardless = this.fuelMass>0 && this.stack.effectiveThrustAt(0, this.time).thrust>0;
    if (this._lastState.altitude<=0.01 && this.throttle<0.05 && !this.dockedTo && !stageBurningRegardless){
      this.u=0; this.v=0; this.w=0; this._wasFrozen=true;
      this.pitchRate*=Math.pow(0.15,dt); this.yawRate*=Math.pow(0.15,dt); this.rollRate*=Math.pow(0.15,dt);
      this.pitch+=this.pitchRate*dt; this.yaw+=this.yawRate*dt; this.roll+=this.rollRate*dt;
      this.shakeIntensity*=0.95; this.rpm=800;
      return this.getState();
    }
    // Despegue tras esperar en tierra: el congelado de arriba pone la velocidad a 0 en cada
    // fotograma, y con ella se perdia el impulso de la rotacion terrestre (~460 m/s hacia el
    // este en Kourou) que traia la nave al crearse. En el navegador la pagina corre el motor
    // desde que carga, asi que SIEMPRE se despegaba sin ese impulso, aunque todas las pruebas
    // en Node (que arrancan sin esperar) lo incluyeran. El Shuttle, calibrado con el impulso
    // y casi sin margen de combustible, ya no llegaba a la orbita (medido: 239 km de apogeo
    // en vez de la orbita correcta, sin combustible en la circularizacion). Se restaura al
    // soltarse del suelo, solo si sigue sobre el punto de lanzamiento.
    if (this._wasFrozen){
      this._wasFrozen=false;
      const L0=this._launchPos0, dx=this.x-L0.x, dy=this.y-L0.y, dz=this.z-L0.z;
      if (this._lastState.bodyName==='earth' && dx*dx+dy*dy+dz*dz<100){
        this.u=this._launchVel0.u; this.v=this._launchVel0.v; this.w=this._launchVel0.w;
      }
    }
    const pitchCmd=Math.max(-1,Math.min(1,controls.pitch||0));
    const yawCmd=Math.max(-1,Math.min(1,controls.yaw||0));
    const rollCmd=Math.max(-1,Math.min(1,controls.roll||0));
    if (controls.hyperspace!==undefined) this.hyperspace=controls.hyperspace;
    if (controls.warp!==undefined) this.warp=controls.warp;

    if (this.dockedTo){
      const target=DOCKING_TARGETS.find(t=>t.id===this.dockedTo);
      if (!target){ this.dockedTo=null; }
      else if (this.throttle>0.3){ this.undock(); }
      else {
        const ts = this._dockingTargetResolver
          ? this._dockingTargetResolver(target, this.time)
          : dockingTargetState(target, this.time);
        let px=ts.pos.x, py=ts.pos.y, pz=ts.pos.z;
        this._dockOutward=null;
        if (ts.basis && this._dockPortIdx!=null){
          // Nave pegada al puerto: fuera del anillo, a lo largo de su eje, con el morro
          // (+y local del cohete) apuntando al puerto. El render dibuja el cohete con
          // estos mismos angulos (orden YXZ), y con roll=0 la direccion del morro es
          // (sin p * sin y, cos p, sin p * cos y).
          const port=ISS_PORTS_DEF[this._dockPortIdx];
          const pw=issLocalToWorld(ts.basis, port.pos);
          const ow=issLocalToWorld(ts.basis, issPortOutward(port.pos));
          const off=DOCK_CONTACT_Y+DOCK_GAP;
          px+=pw.x+ow.x*off; py+=pw.y+ow.y*off; pz+=pw.z+ow.z*off;
          const hx=-ow.x, hy=-ow.y, hz=-ow.z;
          this.pitch=Math.acos(Math.max(-1,Math.min(1,hy)));
          this.yaw=Math.atan2(hx,hz);
          this.roll=0;
          this.pitchRate=0; this.yawRate=0; this.rollRate=0;
          this._dockOutward=ow;
        }
        this.x=px; this.y=py; this.z=pz;
        this.u=ts.vel.x; this.v=ts.vel.y; this.w=ts.vel.z;
        const parent=SOLAR_BODIES[target.parent];
        const rr = ts.r!==undefined ? ts.r : Math.hypot(ts.pos.x,ts.pos.y,ts.pos.z);
        this._lastState={altitude:rr-parent.radius, bodyName:target.parent, dist:rr, gMag:6.67430e-11*parent.mass/(rr*rr), reentryFlag:false};
        return this.getState();
      }
    }

    const prevBody=this._lastState.bodyName;
    const prevBodyPos=positionOf(prevBody,this.time);
    const absPos={x:prevBodyPos.x+this.x, y:prevBodyPos.y+this.y, z:prevBodyPos.z+this.z};

    let best=null, bestSoi=Infinity;
    for (const name of SOLAR_BODY_NAMES){
      const bp=positionOf(name,this.time);
      const dx=absPos.x-bp.x, dy=absPos.y-bp.y, dz=absPos.z-bp.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      const soi=soiOf(name);
      if (dist<soi && soi<bestSoi){ bestSoi=soi; best={name,dist,bp}; }
    }
    let bodyName,dist,bodyPos,bodyMass,bodyRadius;
    if (best){ bodyName=best.name; dist=best.dist; bodyPos=best.bp; }
    else { bodyName='sun'; bodyPos={x:0,y:0,z:0}; dist=Math.sqrt(absPos.x**2+absPos.y**2+absPos.z**2); }
    bodyMass=SOLAR_BODIES[bodyName].mass; bodyRadius=SOLAR_BODIES[bodyName].radius;

    this.x=absPos.x-bodyPos.x; this.y=absPos.y-bodyPos.y; this.z=absPos.z-bodyPos.z;
    // Conicas remendadas: al cambiar de cuerpo dominante hay que cambiar tambien el MARCO DE
    // VELOCIDAD (v_nuevo = v_viejo + v_cuerpoViejo - v_cuerpoNuevo, ambas heliocentricas). Antes
    // solo se re-referenciaba la posicion: al entrar en la SOI lunar la nave conservaba su
    // velocidad geocentrica como si fuera selenocentrica (error de ~1 km/s, la velocidad
    // orbital de la Luna), y al salir ocurria lo contrario. Detectado al preparar Artemis II.
    // OPT-IN por mision (MISSION_CONFIG.correctSoiVelocity=true): Apolo 11 y el sandbox se
    // calibraron con el comportamiento antiguo y NO se han podido regresionar (el arnes de
    // Node no llega a la Luna ni con el motor viejo), asi que siguen igual hasta recalibrarlos.
    if (bodyName!==prevBody && SOLAR_BODIES[prevBody] && typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.correctSoiVelocity){
      const vOld=velocityOf(prevBody,this.time), vNew=velocityOf(bodyName,this.time);
      this.u+=vOld.x-vNew.x; this.v+=vOld.y-vNew.y; this.w+=vOld.z-vNew.z;
    }

    const gMag=this.G*bodyMass/(dist*dist);
    const gDir={x:-this.x/dist, y:-this.y/dist, z:-this.z/dist};
    const mass=this.dryMass+this.fuelMass;
    const gravityForce={x:gDir.x*gMag*mass, y:gDir.y*gMag*mass, z:gDir.z*gMag*mass};

    const isEarth = bodyName==='earth';
    const atm = isEarth ? this.computeAtmosphere(dist-bodyRadius) : {density:0};
    const rho=atm.density;
    const velocity=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
    // dragCdA (m2, opcional en MISSION_CONFIG): Cd*A de la nave. Por defecto 5 (=0,5*10), el valor de siempre.
    // Artemis II lo sube a 23,5 (capsula Orion, 5 m de diametro, Cd~1,2) para una entrada realista.
    const CdA=(typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.dragCdA!==undefined && this.stack.currentIndex>=(window.MISSION_CONFIG.dragFromStage||0)) ? window.MISSION_CONFIG.dragCdA : 5;
    const drag=0.5*rho*velocity*velocity*CdA;
    let dragVec={x:0,y:0,z:0};
    if (velocity>0.1){ dragVec={x:-drag*(this.u/velocity),y:-drag*(this.v/velocity),z:-drag*(this.w/velocity)}; }

    let thrust=0;
    // effectiveThrustAt calcula el empuje y el caudal real de la etapa actual (simple o
    // hibrida SRB+SSME), respetando notThrottlable/fixedThrust y cualquier ventana de
    // throttle-down declarada. Se llama siempre que haya combustible: para una etapa que
    // arde sin importar el throttle (notThrottlable, o el componente fijo de una hibrida),
    // el empuje resultante es >0 incluso con throttle=0 -- por eso no se puede condicionar
    // la llamada a "throttle>0" como antes.
    if (this.fuelMass>0){
      const eff = this.stack.effectiveThrustAt(this.throttle, this.time);
      thrust = eff.thrust;
      if (thrust>0){
        this.fuelMass=Math.max(0,this.fuelMass-eff.massFlow*dt);
      }
    }
    const effPitch=this.pitch+pitchCmd*0.05;
    const heading=FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,effPitch,this.yaw,this.roll));
    const thrustVec={x:thrust*heading.x,y:thrust*heading.y,z:thrust*heading.z};

    const ax=(thrustVec.x+dragVec.x+gravityForce.x)/mass;
    const ay=(thrustVec.y+dragVec.y+gravityForce.y)/mass;
    const az=(thrustVec.z+dragVec.z+gravityForce.z)/mass;
    // preciseOrbits: velocity-Verlet (2o orden) en vez de Euler semi-implicito. Con paso adaptativo
    // proporcional a r^1.5, el Euler pierde ~1 % de energia por paso de perigee aun con paso
    // periodo/20000 (medido; 11 % con periodo/2000) -- error de 1er orden, no se arregla
    // solo con acortar el paso. Verlet lo deja en ~0.0001 %.
    const _u0=this.u, _v0=this.v, _w0=this.w;
    this.u+=ax*dt; this.v+=ay*dt; this.w+=az*dt;

    const rcsTorque=1000000*(1+this.throttle*0.5);
    this.pitchRate+=(pitchCmd*rcsTorque/2000000)*dt;
    this.yawRate+=(yawCmd*rcsTorque/2000000)*dt;
    this.rollRate+=(rollCmd*rcsTorque/1000000)*dt;
    // frenado por SEGUNDO real (no por sub-paso): antes, con sub-pasos adaptativos grandes cerca
    // de la Tierra, el mismo factor aplicado una vez por sub-paso apenas frenaba nada.
    const DAMP_PER_SEC=0.15;
    this.pitchRate*=Math.pow(DAMP_PER_SEC,dt); this.yawRate*=Math.pow(DAMP_PER_SEC,dt); this.rollRate*=Math.pow(DAMP_PER_SEC,dt);
    this.pitch+=this.pitchRate*dt; this.yaw+=this.yawRate*dt; this.roll+=this.rollRate*dt;

    if (PRECISE_STEP){
      this.x+=_u0*dt+0.5*ax*dt*dt; this.y+=_v0*dt+0.5*ay*dt*dt; this.z+=_w0*dt+0.5*az*dt*dt;
      // gravedad en la posicion NUEVA (mismo cuerpo, misma masa; empuje y arrastre constantes en el sub-paso)
      const r1=Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z);
      if (r1>1){
        const g1=this.G*bodyMass/(r1*r1);
        this.u+=0.5*dt*(-g1*this.x/r1 - gDir.x*gMag); this.v+=0.5*dt*(-g1*this.y/r1 - gDir.y*gMag); this.w+=0.5*dt*(-g1*this.z/r1 - gDir.z*gMag);
      }
    } else {
      this.x+=this.u*dt; this.y+=this.v*dt; this.z+=this.w*dt;
    }

    if (this.hyperspace){
      const maxHyperSpeed=2500;
      let speed=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
      let dirx,diry,dirz;
      if (speed<1){ dirx=heading.x;diry=heading.y;dirz=heading.z; speed=1; }
      else { dirx=this.u/speed; diry=this.v/speed; dirz=this.w/speed; }
      const newSpeed=Math.min(maxHyperSpeed, speed+800*dt);
      this.u=dirx*newSpeed; this.v=diry*newSpeed; this.w=dirz*newSpeed;
      for (let i=0;i<5;i++){
        this.particles.push({x:this.x+(Math.random()-0.5)*20,y:this.y+(Math.random()-0.5)*20,z:this.z+(Math.random()-0.5)*20,
          vx:(Math.random()-0.5)*200,vy:(Math.random()-0.5)*200,vz:(Math.random()-0.5)*200,
          life:0.2+Math.random()*0.3,maxLife:0.2+Math.random()*0.3,size:0.5+Math.random()*2,color:[1,0.2,1]});
      }
    }
    if (this.warp){
      const maxWarpSpeed=600;
      let speedW=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
      let wdx,wdy,wdz;
      if (speedW<1){ wdx=heading.x;wdy=heading.y;wdz=heading.z; speedW=1; }
      else { wdx=this.u/speedW; wdy=this.v/speedW; wdz=this.w/speedW; }
      const newSpeedW=Math.min(maxWarpSpeed, speedW+150*dt);
      this.u=wdx*newSpeedW; this.v=wdy*newSpeedW; this.w=wdz*newSpeedW;
      for (let i=0;i<3;i++){
        const angle=Math.random()*Math.PI*2, radius=5+Math.random()*15;
        this.particles.push({x:this.x+Math.cos(angle)*radius,y:this.y+Math.sin(angle)*radius+5,z:this.z+(Math.random()-0.5)*10,
          vx:-Math.cos(angle)*5,vy:-Math.sin(angle)*5,vz:(Math.random()-0.5)*2,
          life:0.3+Math.random()*0.5,maxLife:0.3+Math.random()*0.5,size:1+Math.random()*3,color:[0,0.8,1]});
      }
    }
    if (this.throttle>0.05 && this.fuelMass>0){
      const count=Math.floor(10+this.throttle*30), speed=5+this.throttle*20, spread=0.3+this.throttle*0.5;
      const flameDir=RocketPhysics.rotateVec(0,-1,0,effPitch,this.yaw,this.roll);
      for (let i=0;i<count;i++){
        const angle=Math.random()*Math.PI*2, radius=Math.random()*spread;
        this.particles.push({
          x:this.x+flameDir.x*8+Math.cos(angle)*radius, y:this.y+flameDir.y*8+Math.sin(angle)*radius, z:this.z+flameDir.z*8+(Math.random()-0.5)*spread,
          vx:flameDir.x*speed*(0.8+Math.random()*0.4)+(Math.random()-0.5)*3,
          vy:flameDir.y*speed*(0.8+Math.random()*0.4)+(Math.random()-0.5)*3,
          vz:flameDir.z*speed*(0.8+Math.random()*0.4)+(Math.random()-0.5)*3,
          life:0.3+Math.random()*0.8,maxLife:0.3+Math.random()*0.8,
          size:0.5+Math.random()*2,color:[1,0.5+Math.random()*0.3,0.1+Math.random()*0.2]});
      }
    }
    const reentryNow = isEarth && (dist-bodyRadius)<80000 && (dist-bodyRadius)>100 && velocity>2000 && this.v<0;
    if (reentryNow){
      const heat=Math.min(1,(velocity-2000)/4000);
      const count=Math.floor(6+heat*20);
      for (let i=0;i<count;i++){
        this.particles.push({x:this.x+(Math.random()-0.5)*1.2,y:this.y+(Math.random()-0.5)*1.2,z:this.z+(Math.random()-0.5)*1.2,
          vx:(Math.random()-0.5)*4-this.u*0.1, vy:(Math.random()-0.5)*4-this.v*0.05, vz:(Math.random()-0.5)*4,
          life:0.15+Math.random()*0.25, maxLife:0.15+Math.random()*0.25, size:0.8+Math.random()*2.5*heat,
          color: heat>0.6?[1,1,1]:[1,0.4+heat*0.3,0.1]});
      }
    }

    const d2=Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z);
    let finalDist=d2;
    if (d2<bodyRadius){
      const nx=this.x/d2, ny=this.y/d2, nz=this.z/d2;
      this.x=nx*bodyRadius; this.y=ny*bodyRadius; this.z=nz*bodyRadius;
      const vRad=this.u*nx+this.v*ny+this.w*nz;
      if (vRad<0){ this.u-=vRad*nx; this.v-=vRad*ny; this.w-=vRad*nz; }
      finalDist=bodyRadius; // ya corregido exactamente a la superficie: la altitud reportada debe ser 0, no la de antes de corregir
    }

    const MAX_SPEED=200000;
    const spd=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
    if (!isFinite(spd)){ this.u=0;this.v=0;this.w=0; }
    else if (spd>MAX_SPEED){ const s=MAX_SPEED/spd; this.u*=s; this.v*=s; this.w*=s; }

    if (this.throttle>0.1) this.shakeIntensity=this.throttle*0.3+Math.random()*0.1;
    else this.shakeIntensity*=0.95;
    this.rpm=this.throttle*6000+800;

    this.updateParticles(dt);
    if (this.trail.length===0 || this.time%2<0.1){
      this.trail.push({x:absPos.x,y:absPos.y,z:absPos.z});
      if (this.trail.length>400) this.trail.shift();
    }

    this._lastState={altitude:finalDist-bodyRadius, bodyName, dist:finalDist, gMag, reentryFlag:reentryNow};
  }
  updateParticles(dt){
    for (let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];
      p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt; p.life-=dt; p.size*=0.995;
      if (p.life<=0 || p.size<0.1) this.particles.splice(i,1);
    }
  }
  getState(){
    const velocity=Math.sqrt(this.u*this.u+this.v*this.v+this.w*this.w);
    const s=this._lastState;
    const bodyMass=SOLAR_BODIES[s.bodyName].mass;
    const vCirc=Math.sqrt(this.G*bodyMass/Math.max(1,s.dist));
    const vertRatio=velocity>1?Math.abs(this.v)/velocity:1;
    const orbitAltThresh = s.bodyName==='earth'?80000:(SOLAR_BODIES[s.bodyName].radius*0.05);
    const inOrbit = s.altitude>orbitAltThresh && velocity>vCirc*0.85 && velocity<vCirc*1.3 && vertRatio<0.2;
    const ascending = !inOrbit && s.altitude>orbitAltThresh*0.6 && velocity>vCirc*0.6;

    const bodyPos=positionOf(s.bodyName,this.time);
    const shipAbs={x:bodyPos.x+this.x, y:bodyPos.y+this.y, z:bodyPos.z+this.z};
    const worldBodies={};
    for (const name of SOLAR_BODY_NAMES) worldBodies[name]=positionOf(name,this.time);
    worldBodies.sun={x:0,y:0,z:0};
    worldBodies.halley=halleyPosition(this.time);

    // Eclipses: alineacion geometrica Sol-Tierra-Luna. Aviso: al ser orbitas coplanares simplificadas
    // (sin la inclinacion real de 5 grados de la Luna), esto se alinea cada mes en vez de ser raro como en la realidad.
    const vSun={x:-worldBodies.earth.x,y:-worldBodies.earth.y,z:-worldBodies.earth.z};
    const vMoon={x:worldBodies.moon.x-worldBodies.earth.x,y:worldBodies.moon.y-worldBodies.earth.y,z:worldBodies.moon.z-worldBodies.earth.z};
    const dot=vSun.x*vMoon.x+vSun.y*vMoon.y+vSun.z*vMoon.z;
    const magP=Math.sqrt(vSun.x**2+vSun.y**2+vSun.z**2)*Math.sqrt(vMoon.x**2+vMoon.y**2+vMoon.z**2);
    const angSunMoon=Math.acos(Math.max(-1,Math.min(1,dot/magP)));
    let eclipse=null;
    if (angSunMoon<0.03) eclipse='solar';
    else if (Math.abs(Math.PI-angSunMoon)<0.03) eclipse='lunar';

    // velocidad vertical/horizontal REALES: componente radial (hacia/desde el centro del cuerpo) vs tangencial.
    // OJO: esto no es simplemente 'v' (eje Y) salvo que el punto este justo "encima" del cuerpo en Y;
    // en cualquier otro punto de la superficie (o en otro planeta) 'arriba' es la direccion desde el centro, no el eje Y fijo.
    const rx=this.x/s.dist, ry=this.y/s.dist, rz=this.z/s.dist;
    const vertSpeed = this.u*rx+this.v*ry+this.w*rz;
    const horizSpeed = Math.sqrt(Math.max(0, velocity*velocity - vertSpeed*vertSpeed));

    const dockInfo=this.nearestDockingInfo();

    return {
      x:this.x,y:this.y,z:this.z,pitch:this.pitch,roll:this.roll,yaw:this.yaw,
      u:this.u,v:this.v,w:this.w,velocity,altitude:s.altitude,body:s.bodyName,
      fuelMass:this.fuelMass,fuelPercent:this.fuelMass/this.maxFuelMass*100,
      // porcentaje de la etapa ACTIVA: fuelPercent es sobre el TOTAL de toda la pila (SRB+ET+OMS...), asi que con solo el OMS/ESM encendido
      // salia 0 % aunque quedaran toneladas. La HUD muestra este; la logica de los pilotos sigue usando fuelPercent.
      stageFuelPercent:(()=>{ const c=this.stack.current(); return c && c.maxFuelMass>0 ? c.fuelMass/c.maxFuelMass*100 : 0; })(),
      mass:this.dryMass+this.fuelMass,throttle:this.throttle,thrust:this.maxThrust*this.throttle,
      time:this.time,gForce:s.gMag/9.81,hyperspace:this.hyperspace,warp:this.warp,
      particles:this.particles,trail:this.trail,shakeIntensity:this.shakeIntensity,rpm:this.rpm,
      vCirc,inOrbit,ascending,reentry:!!s.reentryFlag,engineKind:this.engineKind,eclipse,
      vertSpeed,horizSpeed,dockedTo:this.dockedTo,dockInfo,
      shipAbs, bodies:worldBodies,
      launchPadAbs: { x: bodyPos.x+this._launchPos0.x, y: bodyPos.y+this._launchPos0.y, z: bodyPos.z+this._launchPos0.z },
      stageIndex: this.stack.currentIndex
    };
  }
  reset(){
    const launchPosR = latLonToXYZ(LAUNCH_SITE.latDeg, LAUNCH_SITE.lonDeg, SOLAR_BODIES.earth.radius);
    this.x=launchPosR.x;this.y=launchPosR.y;this.z=launchPosR.z;this.pitch=0;this.roll=0;this.yaw=0;
    this._launchPos0 = {x:launchPosR.x, y:launchPosR.y, z:launchPosR.z}; // ver nota en el constructor
    const boost1=earthRotationBoost(LAUNCH_SITE.latDeg, SOLAR_BODIES.earth.radius), east1=eastDirAt(LAUNCH_SITE.lonDeg);
    this.u=boost1*east1.x;this.v=boost1*east1.y;this.w=boost1*east1.z;
    this._launchVel0 = {u:this.u, v:this.v, w:this.w}; this._wasFrozen = false;
    this.pitchRate=0;this.rollRate=0;this.yawRate=0;
    this.throttle=0;this.stack.reset();this.time=0;
    this.hyperspace=false;this.warp=false;this.particles=[];this.trail=[];
    this.shakeIntensity=0;this.rpm=0;this.dockedTo=null;this._dockPortIdx=null;this._dockOutward=null;
    this._lastState={altitude:0, bodyName:'earth', dist:SOLAR_BODIES.earth.radius, gMag:9.81, reentryFlag:false};
  }
}
class SoundSystem {
  constructor(){ this.enabled=false; this.ctx=null; this.oscillators=[]; this.gains=[]; this.filters=[]; this.lastThrottle=0; this.lastRPM=0; this.initialized=false; }
  init(){ try { this.ctx=new (window.AudioContext||window.webkitAudioContext)(); this.enabled=true; this.initialized=true; return true; } catch(e){ this.enabled=false; return false; } }
  toggle(){
    if (!this.initialized) return this.init();
    if (this.ctx.state==='suspended'){ this.ctx.resume(); this.enabled=true; }
    else if (this.ctx.state==='running'){ this.ctx.suspend(); this.enabled=false; }
  }
  update(throttle,rpm,gForce,velocity,altitude){
    if (!this.enabled || this.ctx.state!=='running') return;
    if (Math.abs(throttle-this.lastThrottle)>0.3) this.stopAll();
    if (throttle>0.02) this.playEngine(throttle,rpm,gForce,velocity,altitude);
    else this.playAmbient(velocity,altitude);
    this.lastThrottle=throttle; this.lastRPM=rpm;
  }
  playEngine(throttle,rpm,gForce,velocity,altitude){
    if (this.oscillators.length>10) this.stopAll();
    const baseFreq=40+rpm*0.08+throttle*60;
    const osc1=this.ctx.createOscillator(), gain1=this.ctx.createGain(), filter1=this.ctx.createBiquadFilter();
    osc1.type='sawtooth'; osc1.frequency.value=baseFreq*0.5;
    filter1.type='lowpass'; filter1.frequency.value=200+throttle*800+rpm*0.2; filter1.Q.value=1.5;
    gain1.gain.value=0.15*throttle*(1+gForce*0.1);
    osc1.connect(filter1); filter1.connect(gain1); gain1.connect(this.ctx.destination); osc1.start();
    this.oscillators.push(osc1); this.gains.push(gain1); this.filters.push(filter1);
    const osc2=this.ctx.createOscillator(), gain2=this.ctx.createGain();
    osc2.type='square'; osc2.frequency.value=baseFreq*1.5+throttle*120; gain2.gain.value=0.06*throttle;
    osc2.connect(gain2); gain2.connect(this.ctx.destination); osc2.start();
    this.oscillators.push(osc2); this.gains.push(gain2);
    const osc3=this.ctx.createOscillator(), gain3=this.ctx.createGain();
    osc3.type='sine'; osc3.frequency.value=200+throttle*300+rpm*0.05; gain3.gain.value=0.04*throttle;
    osc3.connect(gain3); gain3.connect(this.ctx.destination); osc3.start();
    this.oscillators.push(osc3); this.gains.push(gain3);
    if (velocity>50){
      const doppler=this.ctx.createOscillator(), dopplerGain=this.ctx.createGain();
      doppler.type='sine'; doppler.frequency.value=100+velocity*0.5;
      dopplerGain.gain.value=0.02*Math.min(1,velocity/200);
      doppler.connect(dopplerGain); dopplerGain.connect(this.ctx.destination); doppler.start();
      this.oscillators.push(doppler); this.gains.push(dopplerGain);
    }
    if (gForce>2){
      const vib=this.ctx.createOscillator(), vibGain=this.ctx.createGain();
      vib.type='sine'; vib.frequency.value=20+(gForce-2)*10;
      vibGain.gain.value=0.1*Math.min(1,(gForce-2)/5);
      vib.connect(vibGain); vibGain.connect(this.ctx.destination); vib.start();
      this.oscillators.push(vib); this.gains.push(vibGain);
    }
  }
  playAmbient(velocity,altitude){
    if (velocity>5){
      const bufferSize=this.ctx.sampleRate*0.1;
      const buffer=this.ctx.createBuffer(1,bufferSize,this.ctx.sampleRate);
      const data=buffer.getChannelData(0);
      for (let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*0.05;
      const source=this.ctx.createBufferSource(); source.buffer=buffer; source.loop=true;
      const gain=this.ctx.createGain(); gain.gain.value=0.03*Math.min(1,velocity/100)*(1-Math.min(1,altitude/50000));
      const filter=this.ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=100+velocity*2;
      source.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); source.start();
      this.oscillators.push(source); this.gains.push(gain); this.filters.push(filter);
    }
  }
  stopAll(){
    this.oscillators.forEach(o=>{ try{o.stop();}catch(e){} try{o.disconnect();}catch(e){} });
    this.oscillators=[]; this.gains=[]; this.filters=[];
  }
}

/* ---------- NOTIFICACIONES ---------- */
class ToastSystem {
  constructor(){ this.timeout=null; }
  show(msg, duration=3000){
    const el=document.getElementById('toastMsg');
    if (!el) return;
    el.textContent=msg;
    el.classList.add('show');
    clearTimeout(this.timeout);
    this.timeout=setTimeout(()=>el.classList.remove('show'), duration);
  }
}

/* ---------- TEXTURAS PROCEDURALES ---------- */
function makeEarthTexture(){
  const W=2048,H=1024;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  // Oceano: degradado azul mas profundo en polos, mas claro en el ecuador (como el real)
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#051428'); grad.addColorStop(0.5,'#0f4d85'); grad.addColorStop(1,'#051428');
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

  // Mapa de rugosidad EN PARALELO: oceano oscuro (bajo=brillante, como el agua real),
  // tierra clara (alto=mate). Mismos trazados que el mapa de color, para que coincidan.
  const rc=document.createElement('canvas'); rc.width=W; rc.height=H;
  const rctx=rc.getContext('2d');
  rctx.fillStyle='#1a1a1a'; rctx.fillRect(0,0,W,H); // oceano: rugosidad baja, brilla

  // lon/lat -> pixel (equirectangular)
  const px=(lon)=>(lon+180)/360*W, py=(lat)=>(90-lat)/180*H;
  function land(points,color){
    ctx.fillStyle=color; rctx.fillStyle='#dcdcdc'; // tierra: rugosidad alta, mate
    [ctx,rctx].forEach(c2=>{
      c2.beginPath();
      points.forEach(([lon,lat],i)=>{ const x=px(lon), y=py(lat); if(i===0) c2.moveTo(x,y); else c2.lineTo(x,y); });
      c2.closePath(); c2.fill();
    });
  }
  const green='#4a8c3f', greenDark='#2f5c2a', tan='#b89a5e', desert='#d4b06a';

  // Africa (silueta simplificada pero reconocible)
  land([[-17,15],[10,32],[33,31],[43,12],[51,10],[42,-2],[40,-16],[35,-25],[20,-35],[13,-18],[9,4],[-6,5],[-17,15]], green);
  land([[15,25],[33,29],[30,15],[20,18],[15,25]], desert); // Sahara
  // Eurasia (Europa+Asia como una gran masa continua)
  land([[-10,36],[2,44],[20,45],[40,45],[60,50],[75,52],[95,55],[130,60],[145,55],[140,45],[125,40],[110,25],[100,10],[80,10],[70,20],[60,25],[45,15],[35,30],[27,35],[15,38],[-10,36]], green);
  land([[60,55],[75,60],[95,65],[130,68],[150,65],[160,60],[140,55],[110,58],[80,58],[60,55]], greenDark); // Siberia
  land([[65,28],[80,30],[90,25],[85,18],[72,18],[65,28]], desert); // Oriente Medio/Arabia
  // India
  land([[68,24],[78,28],[88,22],[80,10],[73,15],[68,24]], green);
  // Sudeste asiatico / Indonesia (islas pequenas)
  land([[95,8],[105,10],[115,5],[110,-5],[98,0],[95,8]], greenDark);
  // Norteamerica
  land([[-165,68],[-150,70],[-120,72],[-95,68],[-80,62],[-70,50],[-60,45],[-75,35],[-82,25],[-97,26],[-105,32],[-115,32],[-124,42],[-124,55],[-140,60],[-165,68]], green);
  land([[-110,50],[-95,55],[-85,50],[-95,42],[-105,42],[-110,50]], tan); // llanuras centrales
  // Centroamerica
  land([[-105,20],[-95,18],[-88,15],[-83,9],[-77,8],[-83,12],[-92,15],[-105,20]], greenDark);
  // Sudamerica
  land([[-80,10],[-70,10],[-60,5],[-50,0],[-35,-8],[-38,-15],[-45,-23],[-58,-35],[-68,-45],[-73,-40],[-70,-20],[-78,-5],[-80,10]], green);
  land([[-60,-15],[-50,-18],[-58,-30],[-65,-25],[-60,-15]], tan); // interior arido
  // Australia
  land([[113,-22],[125,-14],[135,-12],[145,-16],[153,-25],[150,-35],[140,-38],[130,-32],[115,-33],[113,-22]], desert);
  land([[145,-38],[147,-42],[144,-43],[143,-39],[145,-38]], green); // Tasmania

  // Ruido de superficie sutil para que no se vea plano (variacion de tono, no forma)
  const noiseCanvas=document.createElement('canvas'); noiseCanvas.width=256; noiseCanvas.height=128;
  const nctx=noiseCanvas.getContext('2d');
  const imgData=nctx.createImageData(256,128);
  for (let i=0;i<imgData.data.length;i+=4){
    const v=Math.random()*255;
    imgData.data[i]=v; imgData.data[i+1]=v; imgData.data[i+2]=v; imgData.data[i+3]=14;
  }
  nctx.putImageData(imgData,0,0);
  ctx.globalCompositeOperation='overlay';
  ctx.drawImage(noiseCanvas,0,0,W,H);
  ctx.globalCompositeOperation='source-over';

  // Casquetes polares (tambien mate en el mapa de rugosidad, como el hielo real)
  ctx.fillStyle='#eef4f8';
  ctx.fillRect(0,0,W,H*0.045); ctx.fillRect(0,H*0.955,W,H*0.045);
  rctx.fillStyle='#cccccc';
  rctx.fillRect(0,0,W,H*0.045); rctx.fillRect(0,H*0.955,W,H*0.045);
  return { map:new THREE.CanvasTexture(c), roughnessMap:new THREE.CanvasTexture(rc) };
}
function makeCloudsTexture(){
  const c=document.createElement('canvas'); c.width=1024; c.height=512;
  const ctx=c.getContext('2d');
  // fondo transparente: las nubes son solo las manchas blancas -- cobertura reducida
  // para que la superficie de debajo (continentes, oceano) se vea de verdad, no un velo blanco
  for (let i=0;i<40;i++){
    const cx=Math.random()*1024, cy=Math.random()*512;
    const rx=15+Math.random()*45, ry=8+Math.random()*18;
    const alpha=0.06+Math.random()*0.12;
    ctx.fillStyle=`rgba(226,232,240,${alpha})`; // blanco roto azulado, no blanco puro
    ctx.beginPath();
    const pts=10;
    for(let j=0;j<=pts;j++){
      const a=(j/pts)*Math.PI*2;
      const jitter=0.7+Math.random()*0.6;
      const x=cx+Math.cos(a)*rx*jitter, y=cy+Math.sin(a)*ry*jitter;
      if(j===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}
function makeRockyTexture(baseColor, spotColor, features){
  features = features || {};
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  const hex=n=>'#'+n.toString(16).padStart(6,'0');
  ctx.fillStyle=hex(baseColor); ctx.fillRect(0,0,512,256);
  for (let i=0;i<120;i++){
    const x=Math.random()*512, y=Math.random()*256, r=3+Math.random()*18;
    ctx.fillStyle=hex(spotColor); ctx.globalAlpha=0.2+Math.random()*0.3;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  if (features.canyon){
    // un cañón largo tipo Valles Marineris: una franja oscura irregular cerca del ecuador
    ctx.globalAlpha=0.5; ctx.fillStyle=hex(spotColor);
    let y=128;
    for (let x=60;x<380;x+=8){
      y += (Math.random()-0.5)*6;
      ctx.fillRect(x,y,10,5+Math.random()*4);
    }
  }
  if (features.polarCaps){
    ctx.globalAlpha=0.9; ctx.fillStyle='#eef4f8';
    ctx.fillRect(0,0,512,16); ctx.fillRect(0,240,512,16);
  }
  ctx.globalAlpha=1;
  return new THREE.CanvasTexture(c);
}
function makeBandedTexture(colorA, colorB, greatSpot){
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  const hexA=colorA.toString(16).padStart(6,'0'), hexB=colorB.toString(16).padStart(6,'0');
  const bands=14;
  for (let i=0;i<bands;i++){
    ctx.fillStyle = i%2===0 ? '#'+hexA : '#'+hexB;
    ctx.fillRect(0, i*(256/bands), 512, 256/bands+1);
  }
  for (let i=0;i<40;i++){
    const y=Math.random()*256, x=Math.random()*512, w=30+Math.random()*100;
    ctx.fillStyle = Math.random()>0.5 ? '#'+hexA : '#'+hexB;
    ctx.globalAlpha=0.2;
    ctx.fillRect(x,y,w,4+Math.random()*8);
  }
  if (greatSpot){
    // la Gran Mancha Roja: ovalo caracteristico en el hemisferio sur de Jupiter
    ctx.globalAlpha=0.85; ctx.fillStyle='#c1440e';
    ctx.beginPath(); ctx.ellipse(340,175,55,28,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=0.4; ctx.fillStyle='#8a2f08';
    ctx.beginPath(); ctx.ellipse(340,175,55,28,0,0,Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha=1;
  return new THREE.CanvasTexture(c);
}
function makeIceTexture(baseColor){
  const c=document.createElement('canvas'); c.width=512; c.height=256;
  const ctx=c.getContext('2d');
  const hex=baseColor.toString(16).padStart(6,'0');
  ctx.fillStyle='#'+hex; ctx.fillRect(0,0,512,256);
  ctx.strokeStyle='rgba(120,140,160,0.5)'; ctx.lineWidth=1.5;
  for (let i=0;i<25;i++){
    ctx.beginPath();
    let x=Math.random()*512, y=Math.random()*256;
    ctx.moveTo(x,y);
    const segs=4+Math.floor(Math.random()*4);
    for (let j=0;j<segs;j++){
      x+=(Math.random()-0.5)*80; y+=(Math.random()-0.5)*40;
      ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
function makeMoonTexture(){
  const c=document.createElement('canvas'); c.width=1024; c.height=512;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#8f8b82'; ctx.fillRect(0,0,1024,512);
  // Mares (planicies basalticas oscuras) -- manchas grandes e irregulares, como las reales
  for (let i=0;i<9;i++){
    const x=Math.random()*1024, y=Math.random()*512, r=40+Math.random()*90;
    const grad=ctx.createRadialGradient(x,y,0,x,y,r);
    grad.addColorStop(0,'rgba(90,86,80,0.75)'); grad.addColorStop(1,'rgba(90,86,80,0)');
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.ellipse(x,y,r,r*(0.6+Math.random()*0.4),Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
  }
  // Crateres con borde claro y sombra oscura, dos tamaños (grandes escasos, pequenos abundantes)
  function crater(x,y,r){
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle='rgba(70,66,60,0.55)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x-r*0.15,y-r*0.15,r*0.85,0,Math.PI*2);
    ctx.fillStyle='rgba(180,175,165,0.5)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,r*1.15,0,Math.PI*2);
    ctx.strokeStyle='rgba(140,135,125,0.4)'; ctx.lineWidth=Math.max(1,r*0.08); ctx.stroke();
  }
  for (let i=0;i<10;i++) crater(Math.random()*1024,Math.random()*512,18+Math.random()*28);
  for (let i=0;i<140;i++) crater(Math.random()*1024,Math.random()*512,2+Math.random()*7);
  return new THREE.CanvasTexture(c);
}

/* ---------- RENDERER 3D ---------- */
class RocketRenderer3D {
  constructor(container){
    this.container=container;
    const width=container.clientWidth, height=container.clientHeight;
    this.R_earth=6371000;

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x03030a);

    this.camera=new THREE.PerspectiveCamera(55,width/height,0.5,9000000000000);
    this.camera.position.set(35,25,45); this.camera.lookAt(0,0,0);

    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance",logarithmicDepthBuffer:true});
    this.renderer.setSize(width,height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure=1.2;
    container.appendChild(this.renderer.domElement);

    this.composer=new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene,this.camera));
    this.bloomPass=new THREE.UnrealBloomPass(new THREE.Vector2(width,height),0.3,0.2,0.45);
    this.composer.addPass(this.bloomPass);

    this.controls=new THREE.OrbitControls(this.camera,this.renderer.domElement);
    this.controls.target.set(0,5,0); this.controls.enableDamping=true; this.controls.dampingFactor=0.08;
    this.controls.maxPolarAngle=Math.PI/2.1; this.controls.minDistance=5; this.controls.maxDistance=300;
    this.controls.update();

    this.setupLights(); this.setupScene(); this.setupSolarSystem();

    this.rocketGroup=new THREE.Group(); this.scene.add(this.rocketGroup); this.buildRocket();
    this.engineGlow=null; this.flameMeshes=[]; this.engineLight=null;

    this.particleSystem=new THREE.BufferGeometry();
    this.particleMaterial=new THREE.PointsMaterial({size:0.5,transparent:true,opacity:0.8,blending:THREE.AdditiveBlending,sizeAttenuation:true,vertexColors:true});
    this.particlePoints=new THREE.Points(this.particleSystem,this.particleMaterial);
    this.scene.add(this.particlePoints);

    this.trailLine=null; this.viewMode='external'; // 'external' | 'cockpit' | 'cinematic'
    this._cinematicCamPos=new THREE.Vector3(); this._cinematicLookAt=new THREE.Vector3(); this._cinematicInit=false;

    this.setupMiniViews();

    this.resizeHandler=this.resize.bind(this);
    window.addEventListener('resize',this.resizeHandler);
  }
  setupLights(){
    this.scene.add(new THREE.AmbientLight(0x223355,0.5));
    const sun=new THREE.DirectionalLight(0xffeedd,1.8);
    sun.position.set(6000,10000,4000); sun.castShadow=true;
    sun.shadow.mapSize.width=2048; sun.shadow.mapSize.height=2048;
    sun.shadow.camera.near=0.5; sun.shadow.camera.far=300;
    sun.shadow.camera.left=-80; sun.shadow.camera.right=80; sun.shadow.camera.top=80; sun.shadow.camera.bottom=-80;
    this.scene.add(sun); this.sun=sun;
    const fill=new THREE.DirectionalLight(0x4488ff,0.5); fill.position.set(-40,50,-30); this.scene.add(fill);
    const rim=new THREE.DirectionalLight(0x4466aa,0.3); rim.position.set(0,-20,-60); this.scene.add(rim);
    const pointLight=new THREE.PointLight(0xff4400,0,30); pointLight.position.set(0,-5,0);
    this.scene.add(pointLight); this.engineLight=pointLight;
  }
  setupScene(){
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400), new THREE.MeshStandardMaterial({color:0x0a0a15,roughness:0.9,metalness:0.1}));
    ground.rotation.x=-Math.PI/2; ground.position.y=-0.5; ground.receiveShadow=true; this.scene.add(ground); this.ground=ground;
    const gridHelper=new THREE.GridHelper(400,80,0x1a2a4a,0x0a1a2a); gridHelper.position.y=-0.45; this.scene.add(gridHelper); this.grid=gridHelper;

    const starCount=6000;
    const starGeo=new THREE.BufferGeometry();
    const positions=new Float32Array(starCount*3), colors=new Float32Array(starCount*3), sizes=new Float32Array(starCount);
    for (let i=0;i<starCount;i++){
      const theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1), r=20000000+Math.random()*40000000;
      positions[i*3]=r*Math.sin(phi)*Math.cos(theta);
      positions[i*3+1]=r*Math.cos(phi);
      positions[i*3+2]=r*Math.sin(phi)*Math.sin(theta);
      const temp=0.5+Math.random()*0.5;
      colors[i*3]=1.0; colors[i*3+1]=0.8+temp*0.2; colors[i*3+2]=0.6+temp*0.4;
      sizes[i]=0.3+Math.random()*1.5;
    }
    starGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    starGeo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    starGeo.setAttribute('size',new THREE.BufferAttribute(sizes,1));
    const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({size:9000,transparent:true,opacity:0.9,vertexColors:true,sizeAttenuation:true}));
    this.scene.add(stars); this.stars=stars; this.starClock=0;
  }
  setupSolarSystem(){
    this.bodyMeshes = {};

    // Sol: esfera emisiva (luz visual, no recalculamos sombras reales a esta escala)
    const sunMat=new THREE.MeshBasicMaterial({color:0xfff2cc});
    this.sun3d=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.sun.radius,32,32),sunMat);
    this.scene.add(this.sun3d); this.bodyMeshes.sun=this.sun3d;

    // Tierra: intenta una foto real (NASA/LRO vía CDN publico); si el navegador la bloquea
    // (politica CORS de algunos servidores), cae solas a la textura procedural sin romper nada.
    const earthTex = makeEarthTexture();
    const earthMat=new THREE.MeshStandardMaterial({map:earthTex.map,roughnessMap:earthTex.roughnessMap,roughness:1,metalness:0.05});
    const realEarthLoader=new THREE.TextureLoader();
    realEarthLoader.load(
      'https://s3-us-west-2.amazonaws.com/s.cdpn.io/122460/earth_map_2048x1024.jpg',
      (tex)=>{
        earthMat.map=tex;
        earthMat.roughnessMap=null; earthMat.roughness=0.85; // el mapa de rugosidad procedural no coincidiria con las costas de la foto real
        earthMat.needsUpdate=true;
      },
      undefined,
      ()=>{ console.warn('Textura real de la Tierra bloqueada, usando la procedural.'); }
    );
    this.earth=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.earth.radius,64,64),earthMat);
    this.scene.add(this.earth); this.bodyMeshes.earth=this.earth;

    // Plataforma de lanzamiento: una por mision (ver buildLaunchPad), a la misma escala
    // visual arbitraria que el cohete (nunca hubo un factor de escala real cohete<->metros
    // en este proyecto). Se posiciona en update() con rotacion terrestre + conversion de
    // marco (ver state.launchPadAbs y FRAME_ROTATION_INV) -- sin eso, se veria "al lado" del
    // cohete en vez de "debajo", y se alejaria mucho mas rapido de lo que sube el cohete.
    this.buildLaunchPad();
    // Suelo local: la esfera 'earth' se coloca en coordenadas BRUTAS (sin FRAME_ROTATION), asi
    // que cerca del suelo su superficie queda inclinada ~85 grados respecto al 'abajo' del
    // cohete: se veia como un muro blanco/verde pegado a la nave, tapaba la plataforma y al
    // aterrizar la capsula parecia flotar. Por debajo de 30 km se oculta la esfera en la vista
    // principal y se dibuja un disco plano en el marco del cohete (Y=altitud) a y=-altitud.
    this.localGround=new THREE.Group();
    // OJO colores: r128 sin gestion de color renderiza el hex 'en bruto' y el sol (1.8) los multiplica
    // por ~1.5; un marron medio (0x8a7c55) salia >0.8 y con el bloom quedaba BLANCO, igual que
    // la roca/cohete (blancos sobre blanco). Por eso el suelo es mucho mas oscuro de lo que parece.
    this.localGroundMat=new THREE.MeshStandardMaterial({color:0x403a28,roughness:1,metalness:0});
    const lgDisc=new THREE.Mesh(new THREE.CircleGeometry(600000,64),this.localGroundMat);
    lgDisc.rotation.x=-Math.PI/2; this.localGround.add(lgDisc);
    const lgHillMat=new THREE.MeshStandardMaterial({color:0x34301f,roughness:1,flatShading:true});
    for (let i=0;i<14;i++){
      const a=(i/14)*Math.PI*2+(i%3)*0.11, r=300+(i%4)*40, h=6+((i*7)%9);
      const hill=new THREE.Mesh(new THREE.ConeGeometry(24+(i%5)*5,h,7),lgHillMat);
      hill.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r); this.localGround.add(hill);
    }
    this.localGround.visible=false; this.scene.add(this.localGround);
    this._skyLow=new THREE.Color(0x3f78b8); this._skySpace=new THREE.Color(0x03030a);
    // Marcadores de Baikonur (despegue) y Smelovka (aterrizaje), solo en la mision Gagarin.
    // Se colocan en el MISMO marco fijo que usa la fisica de la nave (no giran con la textura
    // de la Tierra) para que coincidan siempre con el punto real de despegue/aterrizaje de la
    // simulacion, en vez de desplazarse con la rotacion terrestre a lo largo de la mision.
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin'){
      const pinMat=new THREE.MeshBasicMaterial({color:0xff3355});
      const landMat=new THREE.MeshBasicMaterial({color:0x33ff77});
      const markerR=SOLAR_BODIES.earth.radius*0.018;
      this.baikonurOffset=latLonToXYZ(45.92,63.34,SOLAR_BODIES.earth.radius*1.015);
      this.baikonurMarker=new THREE.Mesh(new THREE.SphereGeometry(markerR,10,10),pinMat);
      this.scene.add(this.baikonurMarker);
      this.smelovkaOffset=latLonToXYZ(51.27,45.99,SOLAR_BODIES.earth.radius*1.015);
      this.smelovkaMarker=new THREE.Mesh(new THREE.SphereGeometry(markerR,10,10),landMat);
      this.scene.add(this.smelovkaMarker);
    }

    const cloudsMat=new THREE.MeshStandardMaterial({map:makeCloudsTexture(),color:0xd8dde6,transparent:true,opacity:0.8,depthWrite:false,roughness:1,metalness:0});
    this.clouds=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.earth.radius*1.008,64,64),cloudsMat);
    this.scene.add(this.clouds);

    const atmoMat=new THREE.MeshBasicMaterial({color:0x66aaff,transparent:true,opacity:0.18,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false});
    this.atmosphere=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.earth.radius*1.025,48,48),atmoMat);
    this.scene.add(this.atmosphere);

    // Luna: igual que la Tierra, intenta la textura real (NASA LROC) y si el CORS la bloquea
    // cae sola a la procedural sin romper nada.
    const moonMat=new THREE.MeshStandardMaterial({map:makeMoonTexture(),roughness:0.95,metalness:0.02});
    const realMoonLoader=new THREE.TextureLoader();
    realMoonLoader.load(
      'https://s3-us-west-2.amazonaws.com/s.cdpn.io/17271/lroc_color_poles_1k.jpg',
      (tex)=>{ moonMat.map=tex; moonMat.needsUpdate=true; },
      undefined,
      ()=>{ console.warn('Textura real de la Luna bloqueada, usando la procedural.'); }
    );
    this.moon=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.moon.radius,48,48),moonMat);
    this.scene.add(this.moon); this.bodyMeshes.moon=this.moon;

    // Marte
    const marsMat=new THREE.MeshStandardMaterial({map:makeRockyTexture(0xc1440e,0x7a2a08,{polarCaps:true,canyon:true}),roughness:0.9});
    this.bodyMeshes.mars=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.mars.radius,48,48),marsMat);
    this.scene.add(this.bodyMeshes.mars);

    // Jupiter y sus lunas galileanas
    const jupMat=new THREE.MeshStandardMaterial({map:makeBandedTexture(0xd8ae6f,0xb08050,true),roughness:0.7});
    this.bodyMeshes.jupiter=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.jupiter.radius,48,48),jupMat);
    this.scene.add(this.bodyMeshes.jupiter);
    ['io','europa','ganymede','callisto'].forEach(name=>{
      const mat = name==='europa'
        ? new THREE.MeshStandardMaterial({map:makeIceTexture(SOLAR_BODIES.europa.color),roughness:0.6})
        : new THREE.MeshStandardMaterial({color:SOLAR_BODIES[name].color,roughness:0.9});
      this.bodyMeshes[name]=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES[name].radius,24,24),mat);
      this.scene.add(this.bodyMeshes[name]);
    });

    // Saturno con anillos, y Titan
    const satMat=new THREE.MeshStandardMaterial({map:makeBandedTexture(0xead6a8,0xc9a76a),roughness:0.7});
    this.bodyMeshes.saturn=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.saturn.radius,48,48),satMat);
    this.scene.add(this.bodyMeshes.saturn);
    const ringGeo=new THREE.RingGeometry(SOLAR_BODIES.saturn.radius*1.3,SOLAR_BODIES.saturn.radius*2.3,64);
    const ringMat=new THREE.MeshBasicMaterial({color:0xd8c9a0,transparent:true,opacity:0.6,side:THREE.DoubleSide});
    this.saturnRing=new THREE.Mesh(ringGeo,ringMat); this.saturnRing.rotation.x=Math.PI/2.3;
    this.scene.add(this.saturnRing);
    const titanMat=new THREE.MeshStandardMaterial({color:SOLAR_BODIES.titan.color,roughness:0.85});
    this.bodyMeshes.titan=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES.titan.radius,24,24),titanMat);
    this.scene.add(this.bodyMeshes.titan);

    // Urano, Neptuno, Pluton
    ['uranus','neptune','pluto'].forEach(name=>{
      const mat=new THREE.MeshStandardMaterial({color:SOLAR_BODIES[name].color,roughness:0.8});
      this.bodyMeshes[name]=new THREE.Mesh(new THREE.SphereGeometry(SOLAR_BODIES[name].radius,32,32),mat);
      this.scene.add(this.bodyMeshes[name]);
    });
    // Anillo de Urano: real, pero muy distinto al de Saturno - fino, oscuro/grisaceo,
    // y casi vertical porque el eje de Urano esta inclinado ~98 grados (gira "tumbado").
    const uranusRingGeo=new THREE.RingGeometry(SOLAR_BODIES.uranus.radius*1.6,SOLAR_BODIES.uranus.radius*2.0,64);
    const uranusRingMat=new THREE.MeshBasicMaterial({color:0x556570,transparent:true,opacity:0.35,side:THREE.DoubleSide});
    this.uranusRing=new THREE.Mesh(uranusRingGeo,uranusRingMat);
    this.uranusRing.rotation.z=Math.PI/2.15;
    this.scene.add(this.uranusRing);

    // Cometa Halley: nucleo brillante (a esta escala no se ve tamaño real, es un marcador)
    const halleyMat=new THREE.MeshBasicMaterial({color:0xddeeff});
    this.bodyMeshes.halley=new THREE.Mesh(new THREE.SphereGeometry(5000000,12,12),halleyMat);
    this.scene.add(this.bodyMeshes.halley);

    // Objetivo de acoplamiento del sandbox: la ISS real (mismo modelo que la misión dedicada).
    // Si esta pagina ya tiene su propia ISS (mision 'iss'), no se duplica aqui.
    const isDedicatedIssMission = usesRealIssMission();
    if (!isDedicatedIssMission){
      this.dockingTargetGroup=new THREE.Group();
      this.buildISS(this.dockingTargetGroup);
      this.scene.add(this.dockingTargetGroup);
    }

    // Apolo 11: el modulo de mando y servicio (Columbia) en orbita lunar como objetivo pasivo (ver DOCKING_TARGETS 'csm')
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.transposition){
      const g=new THREE.Group(); g.visible=false;
      const mW=new THREE.MeshStandardMaterial({color:0xd8d4c0,roughness:0.35,metalness:0.3}), mG=new THREE.MeshStandardMaterial({color:0x9a9aa2,roughness:0.3,metalness:0.7});
      const sm=new THREE.Mesh(new THREE.CylinderGeometry(1.9,1.9,5.0,20),mG); sm.rotation.z=Math.PI/2; g.add(sm);
      const cm=new THREE.Mesh(new THREE.ConeGeometry(1.9,3.2,20),mW); cm.rotation.z=-Math.PI/2; cm.position.x=4.1; g.add(cm);
      const noz=new THREE.Mesh(new THREE.ConeGeometry(1.0,1.8,16),new THREE.MeshStandardMaterial({color:0x2a2a30,metalness:0.9,roughness:0.2})); noz.rotation.z=Math.PI/2; noz.position.x=-3.4; g.add(noz);
      this.csmTargetGroup=g; this.scene.add(g);
    }

    // Cinturon de Kuiper: anillo de particulas decorativo entre ~35 y ~48 UA
    const kCount=3000;
    const kGeo=new THREE.BufferGeometry();
    const kPos=new Float32Array(kCount*3);
    for (let i=0;i<kCount;i++){
      const ang=Math.random()*Math.PI*2;
      const r=(35+Math.random()*13)*AU;
      const h=(Math.random()-0.5)*2*AU;
      kPos[i*3]=Math.cos(ang)*r; kPos[i*3+1]=h; kPos[i*3+2]=Math.sin(ang)*r;
    }
    kGeo.setAttribute('position',new THREE.BufferAttribute(kPos,3));
    this.kuiperBelt=new THREE.Points(kGeo,new THREE.PointsMaterial({color:0x8a7860,size:2500000,transparent:true,opacity:0.75}));
    this.scene.add(this.kuiperBelt);

    // ---- ISS: solo en la mision dedicada a visitarla, no en Apolo/sandbox/Gagarin ----
    if (usesRealIssMission()){
      this.issGroup=new THREE.Group();
      this.buildISS(this.issGroup);
      this.scene.add(this.issGroup);
    }
  }
  // Modelo detallado de la ISS: viga de 11 segmentos, 8 pares de paneles solares,
  // 12 modulos presurizados, 6 puertos de acoplamiento (2 rusos, 4 internacionales) y
  // el Canadarm2. Longitud del cluster de modulos comprimida a mano un 20% respecto al
  // primer calculo (192m) para acercarla a la real (~150-160m) -- el propio diseño ya
  // avisaba de que probablemente haria falta este ajuste.
  buildISS(group){
    const U=ISS_MODEL_U;
    const white=new THREE.MeshStandardMaterial({color:0xe8e8e0,roughness:0.6,metalness:0.3});
    const offWhite=new THREE.MeshStandardMaterial({color:0xd0d0c8,roughness:0.7,metalness:0.2});
    const gold=new THREE.MeshStandardMaterial({color:0xc9a15a,roughness:0.5,metalness:0.7});
    const silver=new THREE.MeshStandardMaterial({color:0xb0b0b8,roughness:0.35,metalness:0.85});
    const dark=new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:0.4,metalness:0.6});
    const panel=new THREE.MeshStandardMaterial({color:0x0f1a33,roughness:0.4,metalness:0.5,side:THREE.DoubleSide});
    const panelLine=new THREE.MeshBasicMaterial({color:0x2a4a80,side:THREE.DoubleSide});
    const glowRing=new THREE.MeshBasicMaterial({color:0x00ff88,transparent:true,opacity:0.85});
    const glowRus=new THREE.MeshBasicMaterial({color:0xff8800,transparent:true,opacity:0.85});
    const ZC=ISS_MODEL_ZC; // factor de compresion de longitud del cluster de modulos

    // ---- Viga (truss), 11 segmentos ----
    const trussGroup=new THREE.Group();
    for (let i=0;i<11;i++){
      const xPos=(i-5)*3.3*U;
      const seg=new THREE.Group();
      const corners=[{y:0.5,z:0.5},{y:0.5,z:-0.5},{y:-0.5,z:0.5},{y:-0.5,z:-0.5}];
      for (const c of corners){
        const beam=new THREE.Mesh(new THREE.BoxGeometry(3.3*U,0.08*U,0.08*U),silver);
        beam.position.set(0,c.y*U,c.z*U); seg.add(beam);
      }
      if (i%2===0){
        const diag=new THREE.Mesh(new THREE.BoxGeometry(0.06*U,1.4*U,0.06*U),silver);
        diag.rotation.z=Math.PI/4; diag.position.set(0,0,0.5*U); seg.add(diag);
      }
      seg.position.set(xPos,0,0); trussGroup.add(seg);
    }
    const s0=new THREE.Mesh(new THREE.BoxGeometry(2.5*U,1.2*U,1.2*U),silver);
    trussGroup.add(s0);
    group.add(trussGroup);

    // ---- Paneles solares: 8 pares, con reticula de celulas ----
    const panelPositions=[-15.5,-11.5,-7.5,-3.5,3.5,7.5,11.5,15.5];
    for (const xp of panelPositions){
      const xPos=xp*U;
      for (const sign of [1,-1]){
        for (let half=0; half<2; half++){
          const panelMesh=new THREE.Mesh(new THREE.BoxGeometry(5.5*U,0.04*U,3.8*U),panel);
          panelMesh.position.set(xPos, sign*(2.5+half*4.0)*U, 0);
          group.add(panelMesh);
          for (let l=0;l<5;l++){
            const line=new THREE.Mesh(new THREE.BoxGeometry(5.5*U,0.045*U,0.02*U),panelLine);
            line.position.set(xPos, sign*(2.5+half*4.0)*U, (l-2)*0.75*U);
            group.add(line);
          }
        }
      }
      const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.08*U,0.08*U,3.5*U,8),silver);
      mast.position.set(xPos,0,0); group.add(mast);
    }

    // ---- Radiadores: 3 principales + 3 secundarios ----
    for (let i=0;i<3;i++){
      const rad=new THREE.Mesh(new THREE.BoxGeometry(3.5*U,3*U,0.06*U),offWhite);
      rad.position.set(-3*U+i*3*U,-3.5*U,0); group.add(rad);
    }
    for (let i=0;i<3;i++){
      const rad=new THREE.Mesh(new THREE.BoxGeometry(2.5*U,2*U,0.06*U),offWhite);
      rad.position.set(0,3.5*U,(-7+i*1.5)*U*ZC); group.add(rad);
    }

    // ---- Modulos presurizados: 12, distancias Z comprimidas ----
    const modules=[
      {name:'Zarya',len:12.6,rad:4.1,z:-22,mat:gold,cyl:true},
      {name:'Unity',len:5.5,rad:4.6,z:-16,mat:silver,hex:true},
      {name:'Zvezda',len:13.1,rad:4.35,z:-10,mat:gold,cyl:true},
      {name:'Poisk',len:4.0,rad:2.5,z:-4,mat:gold,cyl:true,small:true},
      {name:'Rassvet',len:6.0,rad:2.5,z:-3,mat:gold,cyl:true,small:true},
      {name:'Nauka',len:13.0,rad:4.25,z:2,mat:gold,cyl:true},
      {name:'Destiny',len:8.5,rad:4.2,z:9,mat:white,cyl:true},
      {name:'Harmony',len:7.2,rad:4.4,z:15,mat:white,hex:true},
      {name:'Columbus',len:6.9,rad:4.5,z:21,mat:white,cyl:true},
      {name:'Kibo',len:11.2,rad:4.4,z:27,mat:white,cyl:true},
      {name:'Tranquility',len:7.0,rad:4.5,z:33,mat:white,cyl:true},
      {name:'Cupola',len:1.5,rad:2.0,z:36,mat:dark,cyl:true,small:true}
    ];
    const U_mod=1/3;
    this.issModuleMeshes={};
    for (const m of modules){
      const rad=m.rad*U_mod, len=m.len*U_mod;
      const geo = m.hex ? new THREE.CylinderGeometry(rad,rad,len,6) : new THREE.CylinderGeometry(rad,rad,len,16);
      const mesh=new THREE.Mesh(geo,m.mat);
      mesh.rotation.x=Math.PI/2;
      mesh.position.set(0,0,m.z*U*ZC);
      group.add(mesh);
      this.issModuleMeshes[m.name]=mesh;
      for (const zOff of [-len/2,len/2]){
        const ring=new THREE.Mesh(new THREE.TorusGeometry(rad*1.02,0.06*U,6,24),silver);
        ring.rotation.y=Math.PI/2; ring.rotation.x=Math.PI/2;
        ring.position.set(0,0,m.z*U*ZC+zOff*ZC);
        group.add(ring);
      }
    }

    // ---- Puertos de acoplamiento: 2 rusos (naranja), 4 internacionales (verde) ----
    const ports=ISS_PORTS_DEF;
    this.issPorts=[];
    for (const p of ports){
      const ringMat = p.type==='ruso' ? glowRus : glowRing;
      const ring=new THREE.Mesh(new THREE.TorusGeometry(0.55*U,0.07*U,8,20),ringMat);
      // el anillo mira a lo largo del eje de su puerto (el toro tiene su eje en z)
      const po=issPortOutward(p.pos);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), new THREE.Vector3(po.x,po.y,po.z));
      ring.position.set(p.pos.x,p.pos.y,p.pos.z);
      group.add(ring);
      this.issPorts.push({ id:p.id, type:p.type, localPos:new THREE.Vector3(p.pos.x,p.pos.y,p.pos.z), worldPos:new THREE.Vector3() });
    }

    // ---- Canadarm2 ----
    const armGroup=new THREE.Group();
    armGroup.position.set(0,0.8*U,0);
    const armBase=new THREE.Mesh(new THREE.CylinderGeometry(0.35*U,0.35*U,0.6*U,12),white);
    armGroup.add(armBase);
    const armSeg1=new THREE.Mesh(new THREE.CylinderGeometry(0.18*U,0.18*U,2.5*U,10),white);
    armSeg1.position.set(0,1.5*U,0); armGroup.add(armSeg1);
    const elbow=new THREE.Mesh(new THREE.SphereGeometry(0.25*U,12,12),silver);
    elbow.position.set(0,2.9*U,0); armGroup.add(elbow);
    const armSeg2=new THREE.Mesh(new THREE.CylinderGeometry(0.16*U,0.16*U,2.5*U,10),white);
    armSeg2.position.set(0.8*U,4.0*U,0); armSeg2.rotation.z=Math.PI/4; armGroup.add(armSeg2);
    const endEff=new THREE.Mesh(new THREE.CylinderGeometry(0.22*U,0.28*U,0.5*U,10),silver);
    endEff.position.set(1.7*U,4.9*U,0); armGroup.add(endEff);
    group.add(armGroup);

    // ---- BEAM (modulo inflable) ----
    const beam=new THREE.Mesh(new THREE.SphereGeometry(0.9*U,12,12),offWhite);
    beam.position.set(0,0,24*U*ZC);
    beam.scale.set(1,0.9,1.1);
    group.add(beam);
  }
  buildRocket(){
    while (this.rocketGroup.children.length) this.rocketGroup.remove(this.rocketGroup.children[0]);
    this.flameMeshes=[];
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin'){ this.buildVostok(); return; }
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='artemis'){ this.buildSLS(); return; }
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='iss' && window.MISSION_CONFIG.rocket!=='saturn'){ this.buildSoyuz(); return; }
    if (typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='shuttle'){ this.buildShuttleStack(); return; }
    // Modelo puramente visual (un solo cuerpo rigido, sin separacion de etapas real -- la fisica
    // sigue siendo la de un unico deposito/motor, ya validada). Tres segmentos diferenciados
    // imitan las proporciones del Saturno V real (S-IC ancho en la base, S-II y S-IVB mas
    // estrechos), con interetapas, franjas negras de seguimiento, CSM y patas del modulo lunar.
    const bodyMat=new THREE.MeshStandardMaterial({color:0xf2f0e6,roughness:0.4,metalness:0.15});
    const stripeMat=new THREE.MeshStandardMaterial({color:0x1a1a1a,roughness:0.5,metalness:0.1});
    const interstageMat=new THREE.MeshStandardMaterial({color:0x9a9aa2,roughness:0.3,metalness:0.7});
    const capsuleMat=new THREE.MeshStandardMaterial({color:0xd8d4c0,roughness:0.35,metalness:0.3});
    const windowMat=new THREE.MeshStandardMaterial({color:0x1a2a33,roughness:0.05,metalness:0.9,emissive:0x2288ff,emissiveIntensity:0.3,transparent:true,opacity:0.85});
    const legMat=new THREE.MeshStandardMaterial({color:0xc9a15a,roughness:0.5,metalness:0.6}); // dorado, aislante termico del modulo lunar
    const engineMat=new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:0.2,metalness:0.9});

    // ---- S-IC (1ª etapa, la mas ancha, en la base) ----
    this.sICGroup = new THREE.Group();
    const sIC=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.6,2.6,24),bodyMat);
    sIC.position.y=1.3; sIC.castShadow=true; this.sICGroup.add(sIC);
    const stripeIC=new THREE.Mesh(new THREE.CylinderGeometry(1.46,1.46,0.22,24),stripeMat);
    stripeIC.position.y=2.2; this.sICGroup.add(stripeIC);

    // ---- Interetapa S-IC/S-II (se va con la S-IC) ----
    const inter1=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.45,0.35,24),interstageMat);
    inter1.position.y=2.775; this.sICGroup.add(inter1);
    this.rocketGroup.add(this.sICGroup);

    // ---- S-II (2ª etapa, mas estrecha) ----
    this.sIIGroup = new THREE.Group();
    const sII=new THREE.Mesh(new THREE.CylinderGeometry(1.25,1.4,1.9,24),bodyMat);
    sII.position.y=3.9; sII.castShadow=true; this.sIIGroup.add(sII);
    const stripeII=new THREE.Mesh(new THREE.CylinderGeometry(1.26,1.26,0.2,24),stripeMat);
    stripeII.position.y=4.6; this.sIIGroup.add(stripeII);
    const inter2=new THREE.Mesh(new THREE.CylinderGeometry(0.95,1.25,0.3,24),interstageMat);
    inter2.position.y=5.0; this.sIIGroup.add(inter2);
    this.rocketGroup.add(this.sIIGroup);

    // ---- S-IVB (3ª etapa, la mas estrecha, la que hace la quema translunar) ----
    this.sIVBGroup = new THREE.Group();
    const sIVB=new THREE.Mesh(new THREE.CylinderGeometry(0.85,0.95,1.4,24),bodyMat);
    sIVB.position.y=5.85; sIVB.castShadow=true; this.sIVBGroup.add(sIVB);
    const stripeIVB=new THREE.Mesh(new THREE.CylinderGeometry(0.86,0.86,0.16,24),stripeMat);
    stripeIVB.position.y=6.35; this.sIVBGroup.add(stripeIVB);
    this.rocketGroup.add(this.sIVBGroup);

    // Apolo 11 con transposicion (config.transposition): el modulo de mando y la torre van en grupos propios con
    // pivote en y=7.15 para poder girarlos 180 grados y acoplarlos al LM (fase 4 de la mision). Resto: igual que siempre.
    const useCM = !!(typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.transposition);
    const CM_PIVOT = 7.15;
    this.csmGroup = null; this.towerGroup = null; this.lmAscGroup = null;
    const cmHost = useCM ? (()=>{ const g=new THREE.Group(); g.position.y=CM_PIVOT; this.rocketGroup.add(g); this.csmGroup=g; return g; })() : this.rocketGroup;
    const cmDy = useCM ? -CM_PIVOT : 0;

    // ---- Modulo de mando: capsula troncoconica roma ----
    const capsule=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.85,1.3,24),capsuleMat);
    capsule.position.y=7.15+cmDy; capsule.castShadow=true; cmHost.add(capsule);
    const capsuleTop=new THREE.Mesh(new THREE.ConeGeometry(0.5,0.75,24),capsuleMat);
    capsuleTop.position.y=8.18+cmDy; capsuleTop.castShadow=true; cmHost.add(capsuleTop);

    // ---- Torre de escape ----
    const towerMat=new THREE.MeshStandardMaterial({color:0x888888,roughness:0.4,metalness:0.7});
    const towerHost = useCM ? (()=>{ const g=new THREE.Group(); cmHost.add(g); this.towerGroup=g; return g; })() : cmHost;
    const tower=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.07,1.2,8),towerMat);
    tower.position.y=9.15+cmDy; towerHost.add(tower);
    const towerTip=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.35,8),towerMat);
    towerTip.position.y=9.9+cmDy; towerHost.add(towerTip);

    // ---- Ventanas pequeñas y redondas del modulo de mando ----
    for (let i=0;i<2;i++){
      const windowMesh=new THREE.Mesh(new THREE.CircleGeometry(0.14,16),windowMat);
      const angle=(i/2)*Math.PI*2+0.4;
      windowMesh.position.set(0.7*Math.cos(angle),6.95+cmDy,0.7*Math.sin(angle));
      windowMesh.lookAt(windowMesh.position.x*2,6.95,windowMesh.position.z*2);   // lookAt usa coordenadas de MUNDO: y=6.95, no el local
      cmHost.add(windowMesh);
    }
    if (useCM){
      // Etapa de ascenso del LM, acoplada a la nariz del modulo de mando durante el regreso (fase 12: se descarta antes de la TEI)
      const g=new THREE.Group(); g.visible=false;
      const asc=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.7,0.8,8),legMat); asc.position.y=9.1; asc.castShadow=true; g.add(asc);
      const ascNoz=new THREE.Mesh(new THREE.ConeGeometry(0.2,0.3,8),engineMat); ascNoz.position.y=8.55; g.add(ascNoz);
      this.rocketGroup.add(g); this.lmAscGroup=g;
    }

    // ---- Patas tipo modulo lunar: ocultas al principio (van dentro del SLA, entre la S-IVB
    // y el modulo de mando, como en el Apolo 11 real) -- se muestran al llegar a la Luna ----
    this.lmLegsGroup = new THREE.Group();
    this.lmLegsGroup.visible = false;
    // Cuerpo del modulo de descenso: octogonal (como el LM real), para que las patas
    // no queden sueltas en el aire sin nada que las conecte visualmente a la capsula.
    const lmBody=new THREE.Mesh(new THREE.CylinderGeometry(1.15,1.15,0.9,8), legMat);
    lmBody.position.y=-0.15;
    lmBody.castShadow=true;
    this.lmLegsGroup.add(lmBody);
    const lmNozzle=new THREE.Mesh(new THREE.ConeGeometry(0.35,0.6,8), engineMat);
    lmNozzle.position.y=-0.85;
    this.lmLegsGroup.add(lmNozzle);
    for (let i=0;i<4;i++){
      const angle=(i/4)*Math.PI*2+Math.PI/4;
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1.5,8),legMat);
      leg.position.set(1.55*Math.cos(angle),-0.25,1.55*Math.sin(angle));
      leg.rotation.z=Math.cos(angle)*0.5; leg.rotation.x=Math.sin(angle)*0.5;
      leg.castShadow=true; this.lmLegsGroup.add(leg);
      const footpad=new THREE.Mesh(new THREE.SphereGeometry(0.17,8,8),legMat);
      footpad.position.set(2.2*Math.cos(angle),-0.95,2.2*Math.sin(angle));
      this.lmLegsGroup.add(footpad);
    }
    this.rocketGroup.add(this.lmLegsGroup);

    // ---- 5 toberas F-1 en la base (solo visual, un unico motor fisico real) ----
    // Van dentro de sICGroup (no directamente en rocketGroup): son el motor de la
    // PRIMERA etapa, y deben ocultarse/caer junto con ella al separarse. Antes se
    // anadian sueltas a rocketGroup y nunca se ocultaban -- quedaban flotando para
    // siempre tras la separacion, desconectadas de la capsula (bug real, confirmado
    // por Luis: "se mueve con la nave, es por donde salen las llamas").
    for (let i=0;i<5;i++){
      const angle=(i/5)*Math.PI*2;
      const r=i===0?0:0.7;
      const f1=new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.38,0.55,16),engineMat);
      f1.position.set(r*Math.cos(angle),-0.15,r*Math.sin(angle)); this.sICGroup.add(f1);
    }
    const nozzleMat=new THREE.MeshStandardMaterial({color:0x222233,roughness:0.15,metalness:0.98,emissive:0x331100,emissiveIntensity:0.1});
    const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.1,0.4,24),nozzleMat);
    nozzle.position.y=-0.5; this.sICGroup.add(nozzle);

    const glowMat=new THREE.MeshBasicMaterial({color:0xff4400,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending});
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.7,12,12),glowMat);
    glow.position.y=-0.6; this.sICGroup.add(glow); this.engineGlow=glow;
  }

  // Modelo de la Vostok 1: esfera de descenso + modulo de instrumentos conico + paracaidas.
  // Forma real y distinta del Saturno V -- no reutiliza el modelo de Apolo.
  buildVostok(){
    const hullMat=new THREE.MeshStandardMaterial({color:0xd8d8d0,roughness:0.4,metalness:0.5});
    const darkMat=new THREE.MeshStandardMaterial({color:0x2a2a2a,roughness:0.5,metalness:0.3});
    const engineMat=new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:0.2,metalness:0.9});
    const chuteMat=new THREE.MeshStandardMaterial({color:0xffa040,roughness:0.8,metalness:0.0,side:THREE.DoubleSide});
    const lineMat=new THREE.LineBasicMaterial({color:0xcccccc});

    // ---- Modulo de instrumentos: tronco de cono, se desprende antes de la reentrada ----
    this.vostokEquipGroup = new THREE.Group();
    const equip=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.95,1.6,20),darkMat);
    equip.position.y=0.6; equip.castShadow=true; this.vostokEquipGroup.add(equip);
    this.rocketGroup.add(this.vostokEquipGroup);

    // 5 toberas del R-7 (solo visual, un unico motor fisico real)
    for (let i=0;i<4;i++){
      const angle=(i/4)*Math.PI*2;
      const eng=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.24,0.4,14),engineMat);
      eng.position.set(0.55*Math.cos(angle),-0.35,0.55*Math.sin(angle)); this.vostokEquipGroup.add(eng);
    }
    const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.5,0.35,20),engineMat);
    nozzle.position.y=-0.4; this.vostokEquipGroup.add(nozzle);
    const glowMat=new THREE.MeshBasicMaterial({color:0xff5500,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending});
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.4,12,12),glowMat);
    glow.position.y=-0.55; this.vostokEquipGroup.add(glow); this.engineGlow=glow;

    // ---- Esfera de descenso: la capsula real, siempre visible ----
    this.vostokSphere = new THREE.Mesh(new THREE.SphereGeometry(0.95,24,24),hullMat);
    this.vostokSphere.position.y=2.0; this.vostokSphere.castShadow=true; this.rocketGroup.add(this.vostokSphere);
    // 3 ventanillas pequeñas y redondas
    const windowMat=new THREE.MeshStandardMaterial({color:0x1a2a33,roughness:0.05,metalness:0.9,emissive:0x2288ff,emissiveIntensity:0.25,transparent:true,opacity:0.85});
    for (let i=0;i<3;i++){
      const angle=(i/3)*Math.PI*2;
      const w=new THREE.Mesh(new THREE.CircleGeometry(0.13,16),windowMat);
      w.position.set(0.9*Math.cos(angle),2.0,0.9*Math.sin(angle));
      w.lookAt(w.position.x*2,2.0,w.position.z*2); this.rocketGroup.add(w);
    }

    // ---- Paracaidas: oculto hasta la fase de descenso final ----
    this.parachuteGroup = new THREE.Group();
    this.parachuteGroup.visible=false;
    const canopy=new THREE.Mesh(new THREE.ConeGeometry(2.2,2.6,16,1,true),chuteMat);
    canopy.position.y=6.2; canopy.rotation.x=Math.PI; this.parachuteGroup.add(canopy);
    for (let i=0;i<8;i++){
      const angle=(i/8)*Math.PI*2;
      const pts=[new THREE.Vector3(2.1*Math.cos(angle),5.0,2.1*Math.sin(angle)), new THREE.Vector3(0,2.6,0)];
      const lineGeo=new THREE.BufferGeometry().setFromPoints(pts);
      this.parachuteGroup.add(new THREE.Line(lineGeo,lineMat));
    }
    this.rocketGroup.add(this.parachuteGroup);
  }
  buildSLS(){
    // SLS Bloque 1 + Orion (1 unidad = ~5 m): 2 SRB blancos, etapa central naranja, adaptador, ICPS, modulo de servicio
    // europeo con 4 paneles solares y capsula con escudo termico. Grupos con el contrato de updateStageVisibility:
    // sICGroup = SRB, sIIGroup = etapa central, sIVBGroup = adaptador + ICPS, esmGroup = modulo de servicio.
    const M=(c,r,m,extra)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:r,metalness:m},extra||{}));
    const coreMat=M(0xd9742b,0.55,0.15), srbMat=M(0xeeeeea,0.5,0.1), noseMat=M(0x2c2c30,0.5,0.3), icpsMat=M(0xe6e2d6,0.5,0.2),
          adapterMat=M(0xc9c4b8,0.55,0.25), esmMat=M(0x8f8f8c,0.4,0.55), goldMat=M(0xc9a23a,0.35,0.7), cmMat=M(0xe4e4e0,0.45,0.2),
          shieldMat=M(0x1c1612,0.9,0.05), solarMat=M(0x1b3b72,0.4,0.6,{side:THREE.DoubleSide,emissive:0x0a1a3a,emissiveIntensity:0.18}),
          nozzleMat=M(0x222233,0.15,0.98,{emissive:0x331100,emissiveIntensity:0.1});
    this.sICGroup=new THREE.Group(); this.sIIGroup=new THREE.Group(); this.sIVBGroup=new THREE.Group(); this.esmGroup=new THREE.Group();
    this.lmLegsGroup=new THREE.Group(); this.lmLegsGroup.visible=false;
    [this.sICGroup,this.sIIGroup,this.sIVBGroup,this.esmGroup,this.lmLegsGroup].forEach(g=>this.rocketGroup.add(g));
    const Y0=-0.5;                        // base de la etapa central
    // ---- etapa central: 8,4 m de diametro, ~65 m ----
    const coreH=13.0, core=new THREE.Mesh(new THREE.CylinderGeometry(0.84,0.84,coreH,28),coreMat);
    core.position.y=Y0+coreH/2; core.castShadow=true; this.sIIGroup.add(core);
    for (let i=0;i<4;i++){ const a=i*Math.PI/2+Math.PI/4, n=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.26,0.5,14),nozzleMat); n.position.set(Math.cos(a)*0.36,Y0-0.2,Math.sin(a)*0.36); this.sIIGroup.add(n); }
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.9,14,14),new THREE.MeshBasicMaterial({color:0xff5a1a,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending}));
    glow.position.y=Y0-0.6; this.sIIGroup.add(glow); this.engineGlow=glow;
    // ---- dos SRB de 5 segmentos (3,2 m, ~54 m) con ojiva ----
    for (const sx of [-1,1]){
      const b=new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,10.0,20),srbMat); b.position.set(sx*1.2,Y0+5.0,0); b.castShadow=true; this.sICGroup.add(b);
      const nose=new THREE.Mesh(new THREE.ConeGeometry(0.32,1.1,20),noseMat); nose.position.set(sx*1.2,Y0+10.55,0); this.sICGroup.add(nose);
      const nz=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.3,0.4,14),nozzleMat); nz.position.set(sx*1.2,Y0-0.2,0); this.sICGroup.add(nz);
      const g2=new THREE.Mesh(new THREE.SphereGeometry(0.55,12,12),new THREE.MeshBasicMaterial({color:0xff7a2a,transparent:true,opacity:0.35,blending:THREE.AdditiveBlending})); g2.position.set(sx*1.2,Y0-0.7,0); this.sICGroup.add(g2);
    }
    // ---- adaptador de la etapa (cono 8,4 -> 5 m) e ICPS (5 m, ~14 m) ----
    const yTop=Y0+coreH;                 // 12.5
    const lvsa=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.84,1.6,28),adapterMat); lvsa.position.y=yTop+0.8; this.sIVBGroup.add(lvsa);
    const icps=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,2.7,24),icpsMat); icps.position.y=yTop+1.6+1.35; icps.castShadow=true; this.sIVBGroup.add(icps);
    const icpsBand=new THREE.Mesh(new THREE.CylinderGeometry(0.505,0.505,0.18,24),goldMat); icpsBand.position.y=yTop+1.6+2.0; this.sIVBGroup.add(icpsBand);
    const osa=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.3,24),adapterMat); osa.position.y=yTop+1.6+2.7+0.15; this.sIVBGroup.add(osa);
    // ---- modulo de servicio europeo + 4 paneles solares ----
    const yE=yTop+1.6+2.7+0.3;           // base del ESM
    const esm=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.96,24),esmMat); esm.position.y=yE+0.48; esm.castShadow=true; this.esmGroup.add(esm);
    const esmBand=new THREE.Mesh(new THREE.CylinderGeometry(0.505,0.505,0.12,24),goldMat); esmBand.position.y=yE+0.2; this.esmGroup.add(esmBand);
    const eng=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.2,0.3,12),nozzleMat); eng.position.y=yE-0.12; this.esmGroup.add(eng);
    for (let i=0;i<4;i++){ const a=i*Math.PI/2+Math.PI/4;
      const wing=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.02,1.9),solarMat); wing.position.set(Math.cos(a)*1.0,yE+0.5,Math.sin(a)*1.0); wing.rotation.y=-a+Math.PI/2; this.esmGroup.add(wing); }
    // ---- capsula Orion (5 m): tronco de cono + escudo termico ----
    const yC=yE+0.96;
    const cm=new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.5,0.7,28),cmMat); cm.position.y=yC+0.35; cm.castShadow=true; this.rocketGroup.add(cm);
    const shield=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.06,28),shieldMat); shield.position.y=yC+0.03; this.rocketGroup.add(shield);
    // ---- torre de escape (LAS): se ve hasta la separacion de los SRB ----
    const las=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.12,1.9,10),adapterMat); las.position.y=yC+0.7+0.95; this.sICGroup.add(las);
    const lasTip=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.45,10),noseMat); lasTip.position.y=yC+0.7+1.9+0.22; this.sICGroup.add(lasTip);
  }
  buildSoyuz(){
    const hullMat=new THREE.MeshStandardMaterial({color:0xc8c8c0,roughness:0.45,metalness:0.35});
    const darkerMat=new THREE.MeshStandardMaterial({color:0x8a8a82,roughness:0.5,metalness:0.4});
    const engineMat=new THREE.MeshStandardMaterial({color:0x2a2a30,roughness:0.2,metalness:0.9});
    const solarMat=new THREE.MeshStandardMaterial({color:0x1a3a6a,roughness:0.4,metalness:0.6,side:THREE.DoubleSide,emissive:0x0a1a3a,emissiveIntensity:0.15});
    const solarFrameMat=new THREE.MeshStandardMaterial({color:0x555555,roughness:0.4,metalness:0.7});
    const windowMat=new THREE.MeshStandardMaterial({color:0x1a2a33,roughness:0.05,metalness:0.9,emissive:0x2288ff,emissiveIntensity:0.25,transparent:true,opacity:0.85});

    // updateStageVisibility() accede sin comprobar a this.sICGroup/sIIGroup/sIVBGroup/
    // lmLegsGroup (.visible, .position, .rotation) para CUALQUIER mision -- Saturno V no es
    // la unica nave que pasa por esa funcion. Sin estos grupos (vacios, no se ven), la
    // mision ISS con Soyuz rompe en el primer fotograma del ascenso (TypeError). Vacios y
    // sin geometria: no cuesta nada, updateFallingStages() solo mueve/oculta el grupo
    // entero, nunca asume que tenga contenido.
    this.sICGroup = new THREE.Group(); this.rocketGroup.add(this.sICGroup);
    this.sIIGroup = new THREE.Group(); this.rocketGroup.add(this.sIIGroup);
    this.sIVBGroup = new THREE.Group(); this.rocketGroup.add(this.sIVBGroup);
    this.lmLegsGroup = new THREE.Group(); this.lmLegsGroup.visible=false; this.rocketGroup.add(this.lmLegsGroup);

    // ---- Modulo de servicio (cilindro, base de la nave) ----
    // Es lo mas "abajo" y sostiene los paneles solares. En la Soyuz real tiene los
    // tanques de propergol y el motor principal SKD.
    const service=new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.9,2.0,24),darkerMat);
    service.position.y=1.0; service.castShadow=true; this.rocketGroup.add(service);

    // ---- Modulo de descenso (tronco de cono achatado) ----
    // Encima del servicio. Aqui van los cosmonautas durante el lanzamiento y la reentrada.
    const descent=new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.85,1.2,24),hullMat);
    descent.position.y=2.7; descent.castShadow=true; this.rocketGroup.add(descent);

    // ---- Modulo orbital (esfera, proa) ----
    // Donde vive la tripulacion en orbita y donde esta el puerto de acoplamiento (proa).
    const orbital=new THREE.Mesh(new THREE.SphereGeometry(0.75,24,24),hullMat);
    orbital.position.y=4.2; orbital.castShadow=true; this.rocketGroup.add(orbital);

    // Puerto de acoplamiento (proa del modulo orbital, sonda + cono visible como
    // un cilindro pequeno y claro -- recordatorio visual de que es una Soyuz)
    const portMat=new THREE.MeshStandardMaterial({color:0xaaaaaa,roughness:0.3,metalness:0.7});
    const port=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.4,0.25,16),portMat);
    port.position.y=4.95; this.rocketGroup.add(port);
    const probe=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.35,8),portMat);
    probe.position.y=5.2; this.rocketGroup.add(probe);

    // ---- Ventanas (dos en el modulo de descenso, una en el orbital) ----
    // Puntos de referencia visual: sin ellas, la nave se ve como un tubo liso.
    const win1=new THREE.Mesh(new THREE.CircleGeometry(0.13,16),windowMat);
    win1.position.set(0.82,2.75,0); win1.lookAt(1.6,2.75,0); this.rocketGroup.add(win1);
    const win2=new THREE.Mesh(new THREE.CircleGeometry(0.13,16),windowMat);
    win2.position.set(-0.82,2.75,0); win2.lookAt(-1.6,2.75,0); this.rocketGroup.add(win2);
    const win3=new THREE.Mesh(new THREE.CircleGeometry(0.10,16),windowMat);
    win3.position.set(0,4.55,0.68); win3.lookAt(0,4.55,1.6); this.rocketGroup.add(win3);

    // ---- Paneles solares (dos, desplegados del modulo de servicio) ----
    // Se despliegan a ambos lados, en el plano XZ (perpendiculares al eje de la nave).
    // Este es el rasgo visual mas distintivo de la Soyuz: sin paneles, no se reconoce.
    for (let side=-1; side<=1; side+=2){
      // Brazo de union
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.5,8),solarFrameMat);
      arm.rotation.z=Math.PI/2;
      arm.position.set(side*1.15,1.0,0); this.rocketGroup.add(arm);

      // Panel (rectangulo achatado, doble cara visible)
      const panel=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.05,1.1),solarMat);
      panel.position.set(side*2.35,1.0,0);
      panel.castShadow=true; this.rocketGroup.add(panel);

      // Rejilla de celulas (lineas visuales sobre el panel)
      const gridMat=new THREE.MeshBasicMaterial({color:0x0a1a3a,transparent:true,opacity:0.5});
      for (let i=-1;i<=1;i++){
        const line=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.06,1.1),gridMat);
        line.position.set(side*2.35+i*0.6,1.0,0); this.rocketGroup.add(line);
      }
    }

    // ---- Motor SKD (unico, central, en la base del modulo de servicio) ----
    // Tobera mas pequena que las del Saturno V -- corresponde a la escala de la nave.
    const nozzleMat=new THREE.MeshStandardMaterial({color:0x222233,roughness:0.15,metalness:0.98,emissive:0x331100,emissiveIntensity:0.1});
    const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.5,0.4,20),nozzleMat);
    nozzle.position.y=-0.15; this.rocketGroup.add(nozzle);

    // ---- 4 propulsores RCS de maniobra (uno por cuadrante, muy pequenos) ----
    // No son funcionales visualmente, solo dan escala y reconocimiento de "nave espacial".
    for (let i=0;i<4;i++){
      const angle=(i/4)*Math.PI*2+Math.PI/4;
      const rcs=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.10,0.15,8),engineMat);
      rcs.position.set(0.7*Math.cos(angle),0.3,0.7*Math.sin(angle));
      rcs.rotation.z=Math.cos(angle)*0.4; rcs.rotation.x=Math.sin(angle)*0.4;
      this.rocketGroup.add(rcs);
    }

    // ---- Glow del motor (mismo rol que en Saturno V y Vostok) ----
    // El renderer usa this.engineGlow para modular su opacidad con el throttle.
    const glowMat=new THREE.MeshBasicMaterial({color:0xff5500,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending});
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.45,12,12),glowMat);
    glow.position.y=-0.3; this.rocketGroup.add(glow); this.engineGlow=glow;
  }

  buildShuttleStack(){
    // Stack completo del Shuttle: 2 SRB + ET (naranja) + Orbiter.
    // Organizacion por grupos para que updateStageVisibility los oculte por separado
    // (SRB a los ~120s, ET a los ~510s):
    //   sICGroup -> par de SRB
    //   sIIGroup -> ET
    //   sIVBGroup -> Orbiter (siempre visible)
    //   lmLegsGroup -> vacio (interfaz)

    const whiteMat  = new THREE.MeshStandardMaterial({color:0xf0f0e8, roughness:0.4, metalness:0.15});
    const orangeMat = new THREE.MeshStandardMaterial({color:0xd97f30, roughness:0.55, metalness:0.1});
    const blackMat  = new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:0.5, metalness:0.2});
    const engineMat = new THREE.MeshStandardMaterial({color:0x2a2a30, roughness:0.2, metalness:0.9});
    const windowMat = new THREE.MeshStandardMaterial({color:0x1a2a33, roughness:0.05, metalness:0.9, emissive:0x2288ff, emissiveIntensity:0.25, transparent:true, opacity:0.85});

    // ---- sICGroup: par de SRB (cohetes solidos laterales) ----
    this.sICGroup = new THREE.Group();
    for (let side=-1; side<=1; side+=2){
      const x = side*1.7;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 5.0, 20), whiteMat);
      body.position.set(x, 2.0, 0); body.castShadow=true;
      this.sICGroup.add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.35, 20), whiteMat);
      cap.position.set(x, 4.67, 0);
      this.sICGroup.add(cap);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.30, 16), engineMat);
      nozzle.position.set(x, -0.65, 0);
      this.sICGroup.add(nozzle);
    }
    this.rocketGroup.add(this.sICGroup);

    // ---- sIIGroup: ET (External Tank, naranja) ----
    this.sIIGroup = new THREE.Group();
    const et = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.50, 5.8, 24), orangeMat);
    et.position.y = 2.6; et.castShadow=true;
    this.sIIGroup.add(et);
    const etTop = new THREE.Mesh(new THREE.ConeGeometry(0.50, 0.9, 24), orangeMat);
    etTop.position.y = 5.95;
    this.sIIGroup.add(etTop);
    this.rocketGroup.add(this.sIIGroup);

    // ---- sIVBGroup: Orbiter (transbordador) ----
    // Fuselaje en +X (lado opuesto al vientre, que mira al ET). Alas en +-Z. Timon
    // vertical en +X (dorso en vuelo).
    this.sIVBGroup = new THREE.Group();
    const fusX = 0.85;
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.4, 20), whiteMat);
    fuselage.position.set(fusX, 1.3, 0); fuselage.castShadow=true;
    this.sIVBGroup.add(fuselage);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 20), whiteMat);
    nose.position.set(fusX, 3.45, 0); nose.castShadow=true;
    this.sIVBGroup.add(nose);
    // Vientre negro (escudo termico, mira al ET)
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.4, 0.5), blackMat);
    belly.position.set(fusX - 0.24, 1.3, 0);
    this.sIVBGroup.add(belly);
    // Alas (extensiones perpendiculares al plano ET-Orbiter)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 2.6), whiteMat);
    wing.position.set(fusX, 0.2, 0); wing.castShadow=true;
    this.sIVBGroup.add(wing);
    // Timon vertical (desde el dorso hacia +X)
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.06), whiteMat);
    fin.position.set(fusX + 0.55, 3.0, 0);
    this.sIVBGroup.add(fin);
    // 3 SSME (motores principales)
    for (let i=0; i<3; i++){
      const a = (i/3)*Math.PI*2;
      const ssme = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.4, 12), engineMat);
      ssme.position.set(fusX + Math.cos(a)*0.15, -0.55, Math.sin(a)*0.15);
      this.sIVBGroup.add(ssme);
    }
    // Ventanas (dos circulitos cerca del morro)
    for (let i=0; i<2; i++){
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), windowMat);
      w.position.set(fusX + 0.28, 3.3 + i*0.15, -0.08 + i*0.16);
      w.lookAt(w.position.x + 1, w.position.y, w.position.z);
      this.sIVBGroup.add(w);
    }
    this.rocketGroup.add(this.sIVBGroup);

    // ---- lmLegsGroup vacio (interfaz con updateStageVisibility) ----
    this.lmLegsGroup = new THREE.Group();
    this.rocketGroup.add(this.lmLegsGroup);

    // ---- Glow del motor (el renderer lo modula con throttle) ----
    const glowMat = new THREE.MeshBasicMaterial({color:0xff5500, transparent:true, opacity:0.4, blending:THREE.AdditiveBlending});
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12), glowMat);
    glow.position.set(0.4, -0.3, 0);
    this.rocketGroup.add(glow);
    this.engineGlow = glow;
  }


  buildLaunchPad(){
    const cfg = (typeof window!=='undefined') ? window.MISSION_CONFIG : null;
    const type = cfg ? cfg.type : null;
    if (type==='gagarin') this.buildPadBaikonur();
    else if (type==='artemis') this.buildPadCanaveral();
    else if (type==='iss' && cfg.rocket==='saturn') this.buildPadCanaveral();
    else if (type==='iss') this.buildPadSoyuzPad();
    else if (cfg && cfg.title==='Apolo 11') this.buildPadCanaveral();
    else this.buildPadGeneric();
  }

  buildPadGeneric(){
    // Sandbox (pro.html): plataforma neutra, sin referencia historica concreta.
    const padMat=new THREE.MeshStandardMaterial({color:0x6a6a6a,roughness:0.6,metalness:0.5});
    const padDarkMat=new THREE.MeshStandardMaterial({color:0x3a3a3a,roughness:0.7,metalness:0.3});
    this.launchPadGroup=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.8,0.6,8),padDarkMat);
    base.position.y=-0.9; this.launchPadGroup.add(base);
    const tower=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.22,9,8),padMat);
    tower.position.set(1.8,3.9,0); this.launchPadGroup.add(tower);
    for (const h of [1.2,3.7,6.2]){
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,1.6,6),padMat);
      arm.rotation.z=Math.PI/2; arm.position.set(0.9,h,0); this.launchPadGroup.add(arm);
    }
    this.scene.add(this.launchPadGroup);
  }

  buildPadCanaveral(){
    // Apolo 11: Complejo 39, Cabo Canaveral. Saturno V (motor a y=-0.6), sin brazos que lo
    // sujeten -- descansaba sobre la Mobile Launcher Platform, junto a la Launch Umbilical
    // Tower (torre de celosia abierta, con varios brazos de servicio horizontales).
    const padMat=new THREE.MeshStandardMaterial({color:0xb5b5a8,roughness:0.6,metalness:0.4});
    const towerMat=new THREE.MeshStandardMaterial({color:0xcc5522,roughness:0.5,metalness:0.6});
    const braceMat=new THREE.MeshStandardMaterial({color:0x555550,roughness:0.6,metalness:0.5});
    this.launchPadGroup=new THREE.Group();

    const base=new THREE.Mesh(new THREE.BoxGeometry(5,0.5,5),padMat);
    base.position.y=-0.95; this.launchPadGroup.add(base); // superficie en y=-0.7, margen 0.1 con el motor (-0.6)

    const TOWER_X=3.0, TOWER_HALF=0.35, TOWER_TOP=9.0, TOWER_BASE=-0.7;
    const legH=TOWER_TOP-TOWER_BASE;
    for (const sx of [-1,1]) for (const sz of [-1,1]){
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,legH,6),towerMat);
      leg.position.set(TOWER_X+sx*TOWER_HALF, TOWER_BASE+legH/2, sz*TOWER_HALF);
      this.launchPadGroup.add(leg);
    }
    for (let h=TOWER_BASE+0.8; h<TOWER_TOP; h+=1.2){
      for (const sz of [-1,1]){
        const brace=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,TOWER_HALF*2,6),braceMat);
        brace.rotation.z=Math.PI/2; brace.position.set(TOWER_X,h,sz*TOWER_HALF);
        this.launchPadGroup.add(brace);
      }
      const braceXa=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,TOWER_HALF*2,6),braceMat);
      braceXa.rotation.x=Math.PI/2; braceXa.position.set(TOWER_X-TOWER_HALF,h,0);
      this.launchPadGroup.add(braceXa);
      const braceXb=braceXa.clone(); braceXb.position.x=TOWER_X+TOWER_HALF;
      this.launchPadGroup.add(braceXb);
    }

    for (const h of [1.0,3.5,6.0,8.2]){
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,TOWER_X-0.3,8),towerMat);
      arm.rotation.z=Math.PI/2; arm.position.set(TOWER_X/2-0.15,h,0);
      this.launchPadGroup.add(arm);
    }
    this.scene.add(this.launchPadGroup);
  }

  buildPadBaikonur(){
    // Gagarin/Vostok: sitio "Gagarin's Start", Baikonur. El R-7 no se apoya en una
    // plataforma plana ni tiene torre vertical -- 4 brazos articulados en forma de
    // "tulipan" sujetan el cuerpo del cohete desde abajo, y se abren solos por contrapeso
    // al aligerarse el cohete (sin motor propio en la realidad). Motor de la Vostok en
    // y=-0.55, colgando libre por debajo del punto de contacto de los brazos -- correcto,
    // en el R-7 real el motor tampoco se apoya en nada.
    // Primera version practicamente invisible (brazos de 0.06-0.1 de grosor, gris oscuro,
    // aislados en el espacio sin nada grande cerca que les diera referencia visual) --
    // agrandado y aclarado de forma sustancial, no un simple retoque.
    const armMat=new THREE.MeshStandardMaterial({color:0xaaaaa2,roughness:0.6,metalness:0.6});
    const trenchMat=new THREE.MeshStandardMaterial({color:0x55524c,roughness:0.8,metalness:0.2});
    this.launchPadGroup=new THREE.Group();

    const trench=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.3,0.6,16),trenchMat);
    trench.position.y=-0.9; this.launchPadGroup.add(trench);

    // Marcas de referencia en el suelo (camino de servicio + rejilla de losas) para que se
    // perciba la altura al subir: sin texturas, un plano liso no da sensacion de escala.
    const roadMat=new THREE.MeshStandardMaterial({color:0x4a4740,roughness:0.9});
    const road=new THREE.Mesh(new THREE.BoxGeometry(150,0.04,5),roadMat);
    road.position.set(75,-0.94,0); this.launchPadGroup.add(road);
    for (let i=1;i<=6;i++){
      const ring=new THREE.Mesh(new THREE.RingGeometry(i*12-0.12,i*12+0.12,48),new THREE.MeshBasicMaterial({color:0x6b6246,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2; ring.position.y=-0.93; this.launchPadGroup.add(ring);
    }

    const R_PIVOT=1.9, Y_PIVOT=-0.8, R_CONTACT=0.85, Y_CONTACT=0.15;
    const dx=R_CONTACT-R_PIVOT, dy=Y_CONTACT-Y_PIVOT;
    const armLen=Math.hypot(dx,dy), armAngle=Math.atan2(dx,dy);
    for (let i=0;i<4;i++){
      const group=new THREE.Group(); group.rotation.y=i*Math.PI/2;
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.24,armLen,8),armMat);
      arm.rotation.z=armAngle; arm.position.set(R_PIVOT+dx/2,Y_PIVOT+dy/2,0);
      group.add(arm);
      const pad=new THREE.Mesh(new THREE.SphereGeometry(0.28,10,10),armMat);
      pad.position.set(R_CONTACT,Y_CONTACT,0); group.add(pad);
      this.launchPadGroup.add(group);
    }
    this.scene.add(this.launchPadGroup);
  }

  buildPadSoyuzPad(){
    // ISS/Soyuz: misma herencia del R-7 (brazos tipo tulipan), mas un brazo erector unico
    // que la levanta de horizontal a vertical -- el rasgo real que la distingue de la
    // plataforma clasica de la Vostok. Acabado mas claro/moderno. Motor de la Soyuz en
    // y=-0.3, bastante mas alto que el de la Vostok, por eso el contacto tambien esta mas
    // arriba (y=0.4 en vez de 0.15).
    // Primera version practicamente invisible, igual que Baikonur -- agrandada y aclarada.
    const armMat=new THREE.MeshStandardMaterial({color:0xc4c4bc,roughness:0.5,metalness:0.6});
    const trenchMat=new THREE.MeshStandardMaterial({color:0x5a5852,roughness:0.8,metalness:0.2});
    const erectorMat=new THREE.MeshStandardMaterial({color:0x8a9aac,roughness:0.5,metalness:0.7});
    this.launchPadGroup=new THREE.Group();

    const trench=new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.1,0.5,16),trenchMat);
    trench.position.y=-0.75; this.launchPadGroup.add(trench);

    const R_PIVOT=1.7, Y_PIVOT=-0.6, R_CONTACT=0.95, Y_CONTACT=0.4;
    const dx=R_CONTACT-R_PIVOT, dy=Y_CONTACT-Y_PIVOT;
    const armLen=Math.hypot(dx,dy), armAngle=Math.atan2(dx,dy);
    for (let i=0;i<4;i++){
      const group=new THREE.Group(); group.rotation.y=i*Math.PI/2;
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.2,armLen,8),armMat);
      arm.rotation.z=armAngle; arm.position.set(R_PIVOT+dx/2,Y_PIVOT+dy/2,0);
      group.add(arm);
      const pad=new THREE.Mesh(new THREE.SphereGeometry(0.24,10,10),armMat);
      pad.position.set(R_CONTACT,Y_CONTACT,0); group.add(pad);
      this.launchPadGroup.add(group);
    }

    const eR_PIVOT=2.3, eY_PIVOT=-0.6, eR_CONTACT=0.9, eY_CONTACT=2.0;
    const edx=eR_CONTACT-eR_PIVOT, edy=eY_CONTACT-eY_PIVOT;
    const eLen=Math.hypot(edx,edy), eAngle=Math.atan2(edx,edy);
    const erector=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.28,eLen,8),erectorMat);
    erector.rotation.z=eAngle; erector.position.set(eR_PIVOT+edx/2,eY_PIVOT+edy/2,0);
    this.launchPadGroup.add(erector);

    this.scene.add(this.launchPadGroup);
  }


  // Visibilidad de las partes de la Vostok segun la fase: modulo de instrumentos visible
  // hasta el retrofrenado (se desprende antes de la reentrada, como en la mision real);
  // paracaidas visible solo en el tramo final del descenso.
  updateVostokVisibility(missionPhase){
    const hasEquip = !['gagarin_descent','gagarin_parachute','done'].includes(missionPhase);
    const hasChute = missionPhase==='gagarin_parachute';
    if (this.vostokEquipGroup) this.vostokEquipGroup.visible = hasEquip;
    if (this.parachuteGroup) this.parachuteGroup.visible = hasChute;
    // Bug real (reportado por Luis, confirmado visualmente): vostokSphere (la capsula, lo
    // unico visible tras separar vostokEquipGroup) esta fija en y=2.0 -- un offset pensado
    // para cuando el modulo de instrumentos (motor en y=-0.55, el punto de contacto real con
    // la plataforma) sigue presente. Durante el vuelo esto es imperceptible (la Tierra entera
    // se desplaza segun la altitud real, no este offset interno del modelo), pero al aterrizar
    // (altitude=0, la Tierra reposicionada para tocar y=0 exactamente) la capsula se queda
    // flotando 2 unidades por encima del suelo. Mismo patron ya usado para lmLegsGroup en
    // Apolo: reubicar solo en 'done', para que la base (radio 0.95) toque el suelo.
    if (this.vostokSphere) this.vostokSphere.position.y = (missionPhase==='done') ? -0.05 : 2.0; // base en y=-1.0 = suelo local (ver localGround)
  }

  // Separacion visual de etapas, atada a las FASES del piloto automatico (no al reloj real):
  // nuestra simulacion no tarda lo mismo que la mision real (el TLI dispara mucho antes que
  // las 2h44m reales), asi que usar los tiempos historicos (162s/522s/702s) haria que una
  // etapa "cayera" en mitad del crucero translunar. Puramente decorativo -- no toca la fisica.
  updateStageVisibility(missionPhase, stageIndex, simTime, alt){
    if (!missionPhase){ // sandbox sin piloto automatico: cohete completo, como siempre
      this.sICGroup.visible=true; this.sIIGroup.visible=true; this.sIVBGroup.visible=true; this.lmLegsGroup.visible=false;
      this.sICGroup.position.set(0,0,0); this.sICGroup.rotation.set(0,0,0);
      this.sIIGroup.position.set(0,0,0); this.sIIGroup.rotation.set(0,0,0);
      this.lmLegsGroup.position.y=0;
      this._fallingStages=[];
      return;
    }
    if (!this._fallingStages) this._fallingStages=[];
    const alreadyFalling=(g)=>this._fallingStages.some(fs=>fs.group===g);

    const isArtemis = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='artemis';
    if (isArtemis){
      // SLS: SRB (stage 0), etapa central (<=1), ICPS+adaptador (<=2), modulo de servicio (<=3); la capsula siempre.
      const idx=(typeof stageIndex==='number')?stageIndex:0, ph=String(missionPhase||'');
      const want=[ ['sICGroup',idx<=0], ['sIIGroup',idx<=1], ['sIVBGroup',idx<=2] ];
      for (const [k,w] of want){ const g=this[k];
        if (g.visible && !w && !alreadyFalling(g)) this._fallingStages.push({group:g, age:0});
        if (w) g.visible=true; }
      if (this.esmGroup){ if (idx>=4){ if (this.esmGroup.visible && !alreadyFalling(this.esmGroup)) this._fallingStages.push({group:this.esmGroup, age:0}); } else this.esmGroup.visible=true; }
      this.lmLegsGroup.visible=false; return;
    }
    const isShuttle = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='shuttle';
    if (isShuttle){
      // Shuttle: SRB (sICGroup), ET (sIIGroup), Orbiter (sIVBGroup) siguen la separacion
      // REAL por stageIndex, no la fase -- se separan durante 'ascent' (a los ~120s y
      // ~510s respectivamente), no al llegar a orbita. Sin esta rama, se quedarian
      // visibles todo el ascenso y caerian juntos en coast_leo, perdiendo el momento
      // visual de la separacion de los SRB. Misma clase de bifurcacion aislada por
      // type que en MissionAutopilot.ascent, con regresion verificada.
      const idx = (typeof stageIndex === 'number') ? stageIndex : 0;
      const wantSIC  = idx === 0;               // par de SRB: solo durante fase 1 (etapa fisica 0)
      const wantSII  = idx <= 1;                // ET: fases 1 y 2 (etapas fisicas 0-1)
      const wantSIVB = true;                    // Orbiter: siempre visible
      if (this.sICGroup.visible && !wantSIC && !alreadyFalling(this.sICGroup)) this._fallingStages.push({group:this.sICGroup, age:0});
      if (this.sIIGroup.visible && !wantSII && !alreadyFalling(this.sIIGroup)) this._fallingStages.push({group:this.sIIGroup, age:0});
      // sIVBGroup no cae nunca (el Orbiter es la nave que aterriza/regresa); la linea
      // queda por simetria y por si algun dia se quiere desprender.
      if (this.sIVBGroup.visible && !wantSIVB && !alreadyFalling(this.sIVBGroup)) this._fallingStages.push({group:this.sIVBGroup, age:0});
      if (wantSIC)  this.sICGroup.visible=true;
      if (wantSII)  this.sIIGroup.visible=true;
      if (wantSIVB) this.sIVBGroup.visible=true;
      // Orbiter solo (sin ET): su fuselaje pasa al eje de la nave (x=0), de forma suave
      const targetX = (idx>=2) ? -0.85 : 0;
      this.sIVBGroup.position.x += (targetX-this.sIVBGroup.position.x)*0.08;
      this.lmLegsGroup.visible = false;
      this.lmLegsGroup.position.y = 0;
      return;
    }

    // Resto (Apolo, ISS con Soyuz, Gagarin, sandbox): logica existente, byte a byte.
    const isAscent = missionPhase==='ascent' || missionPhase==='iss_ascent';
    // 'done' es un string de fase COMPARTIDO entre Apolo y la ISS (ambos terminan su
    // piloto automatico asi). Sin esta guarda, al llegar la ISS a 'done' el codigo
    // creia que era Apolo llegando a la Luna: ocultaba el motor y mostraba el modulo
    // lunar en una nave que nunca deberia tenerlo (bug real, confirmado por Luis).
    const isIssMissionPhase = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='iss';
    const arrivedAtMoon = !isIssMissionPhase && (['loi_burn','separation','descent','done'].includes(missionPhase) || String(missionPhase||'').startsWith('ret_'));
    let wantSIC = isAscent, wantSII = isAscent, wantSIVB = !arrivedAtMoon;
    // Saturno V -> ISS: la separacion visual sigue a la etapa fisica real (S-IC cae al pasar
    // a la etapa 1, S-II al pasar a la 2), no solo a la fase, que cambia mucho despues.
    const cfgNow = (typeof window!=='undefined') ? window.MISSION_CONFIG : null;
    if (cfgNow && cfgNow.type==='iss' && cfgNow.rocket==='saturn' && typeof stageIndex==='number'){
      wantSIC = isAscent && stageIndex<=0;
      wantSII = isAscent && stageIndex<=1;
    }
    // Guion de transposicion y acoplamiento (Apolo 11): la S-IVB se mantiene hasta que el CSM extrae el LM.
    const scriptOn = !!this.csmGroup;
    let tpU = 0;
    if (scriptOn){
      const ph=String(missionPhase||''), ret=ph.startsWith('ret_');
      const dur=(cfgNow.transposition&&cfgNow.transposition.durS)||24;
      if (ph==='transposicion'){ if (this._tpT0==null) this._tpT0=simTime; tpU=Math.max(0,Math.min(1,(simTime-this._tpT0)/dur)); }
      else if (['coast_tli','loi_burn','separation','descent','done'].includes(ph) || ret) tpU=1;
      else this._tpT0=null;
      this._tpU=tpU;
      wantSIVB = ['ascent','park_coast','park_circ','coast_leo','tli_burn'].includes(ph) || (ph==='transposicion' && tpU<0.75);
    }
    if (this.sICGroup.visible && !wantSIC && !alreadyFalling(this.sICGroup)) this._fallingStages.push({group:this.sICGroup, age:0});
    if (this.sIIGroup.visible && !wantSII && !alreadyFalling(this.sIIGroup)) this._fallingStages.push({group:this.sIIGroup, age:0});
    if (this.sIVBGroup.visible && !wantSIVB && !alreadyFalling(this.sIVBGroup)) this._fallingStages.push({group:this.sIVBGroup, age:0});
    if (wantSIC) this.sICGroup.visible=true;
    if (wantSII) this.sIIGroup.visible=true;
    if (wantSIVB) this.sIVBGroup.visible=true;
    this.lmLegsGroup.visible = arrivedAtMoon && !['ret_ascent','ret_rdv','ret_orbit','ret_tei','ret_coast_moon','ret_coast_earth','ret_entry','ret_chute','ret_done'].includes(missionPhase);
    // Sin S-IC/S-II/S-IVB debajo, las patas se quedaban colgando solas muy por debajo de la
    // capsula (su posicion original asumia todo el cuerpo del cohete encima). Se reubican
    // justo bajo la capsula para que no queden como dos trozos sueltos con un hueco enorme.
    this.lmLegsGroup.position.y = arrivedAtMoon ? 6.5 : 0;
    if (scriptOn){
      const ph=String(missionPhase||''), ret=ph.startsWith('ret_'), u=tpU;
      const ease=t=>t*t*(3-2*t);
      // Cronologia: 0-.25 el CSM se separa de la S-IVB; .25-.5 gira 180 grados; .5-.75 vuelve y se acopla al LM; .75-1 extraccion
      let pivot=7.15, rot=0;
      if (u>0){
        if (u<0.25) pivot=7.15+3.35*ease(u/0.25);
        else if (u<0.5){ pivot=10.5; rot=Math.PI*ease((u-0.25)/0.25); }
        else if (u<0.75){ pivot=10.5-2.15*ease((u-0.5)/0.25); rot=Math.PI; }
        else { pivot=8.35; rot=Math.PI; }
      }
      if (ret){ pivot=7.15; rot=0; }
      // Fase 7 (visual): en 'descent' el modulo de mando (Columbia) se queda en orbita (objetivo pasivo 'csm') y baja solo el LM (Eagle).
      const separated = ['separation','descent','done','ret_wait','ret_ascent','ret_rdv'].includes(ph);
      // El origen del modelo esta en la base de la S-IC; las patas del LM quedan ~5,4 por encima. Al llegar al suelo se baja todo
      // el conjunto para que las patas toquen el suelo (rampa en los ultimos 50 m).
      const landed = ['descent','done','ret_wait'].includes(ph);
      const dyLand = landed ? -5.43*(1-Math.max(0,Math.min(1,(alt||0)/50))) : 0;
      this.csmGroup.visible = !separated;
      this.csmGroup.position.y=pivot+dyLand; this.csmGroup.rotation.x=rot;
      if (this.towerGroup) this.towerGroup.visible = !(u>0);
      this.lmLegsGroup.visible = u>0 && !ret;
      this.lmLegsGroup.position.y = 6.5+dyLand;
      this.lmLegsGroup.scale.setScalar(Math.max(0.01,Math.min(1,u/0.15)));
      if (this.lmAscGroup){
        // etapa de ascenso: es la nave durante el despegue y el encuentro (ret_ascent, ret_rdv), luego va acoplada al modulo de mando (ret_orbit)
        const want = ph==='ret_ascent' || ph==='ret_rdv' || ph==='ret_orbit';
        if (this.lmAscGroup.visible && !want && !alreadyFalling(this.lmAscGroup)) this._fallingStages.push({group:this.lmAscGroup, age:0});
        if (want){ this.lmAscGroup.visible=true; this.lmAscGroup.position.y = (ph==='ret_orbit') ? 0 : -8.7; }
      }
    }
  }
  // Anima las etapas descartadas: se quedan atras (se alejan del morro de la nave) y giran
  // lentamente, durante 3s, antes de desaparecer del todo. Puramente decorativo.
  updateFallingStages(dt){
    if (!this._fallingStages || !this._fallingStages.length) return;
    const DURATION=3;
    for (let i=this._fallingStages.length-1;i>=0;i--){
      const fs=this._fallingStages[i];
      fs.age+=dt;
      fs.group.position.y -= dt*3.5;
      fs.group.position.z -= dt*1.5;
      fs.group.rotation.x += dt*1.8;
      fs.group.rotation.z += dt*0.9;
      if (fs.age>=DURATION){
        fs.group.visible=false;
        fs.group.position.set(0,0,0); fs.group.rotation.set(0,0,0);
        this._fallingStages.splice(i,1);
      }
    }
  }
  setupMiniViews(){
    this.frontCam=new THREE.PerspectiveCamera(60,150/110,0.5,9000000000000);
    this.backCam=new THREE.PerspectiveCamera(60,150/110,0.5,9000000000000);
    const fEl=document.getElementById('mvFront'), bEl=document.getElementById('mvBack');
    this.frontRenderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
    this.backRenderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
    this.frontRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.backRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    fEl.appendChild(this.frontRenderer.domElement);
    bEl.appendChild(this.backRenderer.domElement);
    this.resizeMiniViews();
  }
  resizeMiniViews(){
    const fEl=document.getElementById('mvFront'), bEl=document.getElementById('mvBack');
    const fw=fEl.clientWidth, fh=fEl.clientHeight;
    const bw=bEl.clientWidth, bh=bEl.clientHeight;
    this.frontRenderer.setSize(fw,fh); this.frontCam.aspect=fw/fh; this.frontCam.updateProjectionMatrix();
    this.backRenderer.setSize(bw,bh); this.backCam.aspect=bw/bh; this.backCam.updateProjectionMatrix();
  }
  updateFlame(throttle){
    const MAX_FLAMES=24;
    if (!this._flamePool){
      this._flamePool=[];
      const unitCone=new THREE.ConeGeometry(1,1,6);
      for (let i=0;i<MAX_FLAMES;i++){
        const mat=new THREE.MeshBasicMaterial({transparent:true,blending:THREE.AdditiveBlending});
        const mesh=new THREE.Mesh(unitCone,mat);
        mesh.visible=false;
        this.rocketGroup.add(mesh);
        this._flamePool.push(mesh);
      }
    }
    if (throttle<0.05){
      this._flamePool.forEach(m=>m.visible=false);
      return;
    }
    const count=Math.floor(3+throttle*8);
    let idx=0;
    for (let i=0;i<count && idx<MAX_FLAMES;i++){
      const len=1+throttle*6+Math.random()*2, width=0.2+throttle*0.8+Math.random()*0.3, angle=(Math.random()-0.5)*0.3;
      const color=new THREE.Color().setHSL(0.05+Math.random()*0.05,1,0.4+Math.random()*0.4);
      const opacity=0.6+Math.random()*0.3;

      const flame=this._flamePool[idx++];
      flame.visible=true; flame.scale.set(width,len,width);
      flame.position.set(Math.sin(angle)*0.3,-0.8-len/2,Math.cos(angle)*0.3);
      flame.rotation.x=angle*0.5; flame.rotation.z=angle*0.3;
      flame.material.color.copy(color); flame.material.opacity=opacity;

      if (Math.random()>0.5 && idx<MAX_FLAMES){
        const sub=this._flamePool[idx++];
        sub.visible=true; sub.scale.set(width*0.5,len*0.6,width*0.5);
        sub.position.set(Math.sin(angle+0.2)*0.5,-0.8-len*0.4,Math.cos(angle+0.2)*0.5);
        sub.rotation.x=0; sub.rotation.z=0;
        sub.material.color.copy(color); sub.material.opacity=opacity;
      }
    }
    for (let i=idx;i<MAX_FLAMES;i++) this._flamePool[i].visible=false;
  }
  update(state, frameDt, missionPhase){
    const isGagarin = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin';
    if (isGagarin) this.updateVostokVisibility(missionPhase);
    else { this.updateStageVisibility(missionPhase, state.stageIndex, state.time, state.altitude); this.updateFallingStages(Math.min(0.1,frameDt||0.016)); }
    const shipAbs = new THREE.Vector3(state.shipAbs.x, state.shipAbs.y, state.shipAbs.z);
    // origen flotante: cada cuerpo se coloca en su posicion real MENOS la posicion real de la nave,
    // asi la nave siempre esta cerca de (0,0,0) sin importar si estamos junto a la Tierra o cerca de Pluton.
    for (const name in this.bodyMeshes){
      const bp = state.bodies[name];
      if (!bp) continue;
      this.bodyMeshes[name].position.set(bp.x-shipAbs.x, bp.y-shipAbs.y, bp.z-shipAbs.z);
    }
    // ---- ISS: posicion orbital real, orientada con el nadir hacia la Tierra ----
    if (this.issGroup && typeof ISS!=='undefined' && typeof orbitalObjectPosition==='function' && state.bodies.earth){
      const issAbs = orbitalObjectPosition(ISS, state.time);
      this.issGroup.position.set(issAbs.x-shipAbs.x, issAbs.y-shipAbs.y, issAbs.z-shipAbs.z);
      const earthRel = new THREE.Vector3(state.bodies.earth.x-issAbs.x, state.bodies.earth.y-issAbs.y, state.bodies.earth.z-issAbs.z).normalize();
      const up = earthRel.clone().negate();
      let right = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0,0,1));
      if (right.lengthSq()<1e-6) right.set(1,0,0); else right.normalize();
      const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
      const m = new THREE.Matrix4().makeBasis(right, up, fwd);
      this.issGroup.quaternion.setFromRotationMatrix(m);
      if (this.issPorts){
        for (const p of this.issPorts) p.worldPos.copy(p.localPos).applyQuaternion(this.issGroup.quaternion).add(this.issGroup.position);
      }
    }
    if (this.clouds) this.clouds.position.copy(this.earth.position);
    if (this.atmosphere) this.atmosphere.position.copy(this.earth.position);
    if (this.launchPadGroup){
      // visible solo cerca del suelo: a 1000m de altitud ya estaria a bastante mas
      // distancia lateral que su propio tamano, por la deriva natural del ascenso.
      const cerca = state.body==='earth' && state.altitude<1000;
      this.launchPadGroup.visible = cerca;
      if (cerca){
        // state.launchPadAbs: posicion REAL de la nave en el instante del ultimo reset/lanzamiento,
        // capturada una vez en RocketPhysics (ver nota ahi) -- no se recalcula con el tiempo.
        const relBruto = { x: state.launchPadAbs.x-shipAbs.x, y: state.launchPadAbs.y-shipAbs.y, z: state.launchPadAbs.z-shipAbs.z };
        const rel = FRAME_ROTATION_INV(relBruto); // al marco del cohete: Y=altitud, X/Z=deriva lateral
        // Cada plataforma (buildPadGeneric/Canaveral/Baikonur/SoyuzPad) ya esta disenada con
        // su propia altura de superficie/contacto ajustada al motor de SU nave -- ya no hace
        // falta ningun offset generico aqui (el que habia antes era un parche para una unica
        // plataforma compartida por las 4 misiones).
        this.launchPadGroup.position.set(rel.x, rel.y, rel.z);
      }
    }
    if (this.baikonurMarker && state.bodies.earth){
      const ep=state.bodies.earth;
      this.baikonurMarker.position.set(ep.x+this.baikonurOffset.x-shipAbs.x, ep.y+this.baikonurOffset.y-shipAbs.y, ep.z+this.baikonurOffset.z-shipAbs.z);
    }
    if (this.smelovkaMarker && state.bodies.earth){
      const ep=state.bodies.earth;
      this.smelovkaMarker.position.set(ep.x+this.smelovkaOffset.x-shipAbs.x, ep.y+this.smelovkaOffset.y-shipAbs.y, ep.z+this.smelovkaOffset.z-shipAbs.z);
    }
    if (this.saturnRing) this.saturnRing.position.copy(this.bodyMeshes.saturn.position);
    if (this.uranusRing) this.uranusRing.position.copy(this.bodyMeshes.uranus.position);
    if (this.kuiperBelt) this.kuiperBelt.position.set(-shipAbs.x,-shipAbs.y,-shipAbs.z);

    if (this.dockingTargetGroup && DOCKING_TARGETS[0]){
      const dt=DOCKING_TARGETS[0];
      const ts=dockingTargetState(dt, state.time);
      const parentAbs=state.bodies[dt.parent];
      this.dockingTargetGroup.position.set(
        parentAbs.x+ts.pos.x-shipAbs.x, parentAbs.y+ts.pos.y-shipAbs.y, parentAbs.z+ts.pos.z-shipAbs.z
      );
    }

    if (this.csmTargetGroup){
      const ct=DOCKING_TARGETS.find(t=>t.id==='csm');
      this.csmTargetGroup.visible=!!ct;
      if (ct){
        const ts=dockingTargetState(ct, state.time), pa=state.bodies[ct.parent];
        this.csmTargetGroup.position.set(pa.x+ts.pos.x-shipAbs.x, pa.y+ts.pos.y-shipAbs.y, pa.z+ts.pos.z-shipAbs.z);
        const v=norm3(ts.vel); this.csmTargetGroup.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0), new THREE.Vector3(v.x,v.y,v.z));
      }
    }
    if (this.earth) this.earth.rotation.y = (state.time/EARTH_SIDEREAL_DAY)*Math.PI*2;
    if (this.clouds) this.clouds.rotation.y = (state.time/(EARTH_SIDEREAL_DAY*0.9))*Math.PI*2;
    if (this.moon) this.moon.rotation.y += frameDt*(Math.PI*2/300);
    if (this.bodyMeshes.jupiter) this.bodyMeshes.jupiter.rotation.y = (state.time/35730)*Math.PI*2; // 9h 55m 30s real
    if (this.bodyMeshes.saturn) this.bodyMeshes.saturn.rotation.y = (state.time/38018)*Math.PI*2; // 10h 33m 38s real
    if (this.atmosphere) this.atmosphere.visible = (state.body==='earth');
    // Las nubes estan a solo ~51km de la superficie -- por debajo de eso la camara pasa
    // literalmente dentro de la capa durante el despegue y el aterrizaje, viendola de canto
    // como un muro blanco. Se oculta mientras la nave este mas baja que la propia capa.
    if (this.clouds) this.clouds.visible = (state.body==='earth' && state.altitude>52000);

    // el suelo/rejilla local solo tienen sentido cerca de una superficie: ocultarlos si estamos lejos
    const nearAnySurface = state.altitude < 20000;
    // this.ground y this.grid (plano azul liso + rejilla) quedan siempre ocultos: eran un
    // resto de antes de tener texturas reales de Tierra/Luna, y tapaban el cuerpo real
    // -- la nave y la superficie de verdad se ven mucho mejor sin ellos por delante.
    if (this.ground) this.ground.visible = false;
    if (this.grid) this.grid.visible = false;

    // suelo local + cielo (ver nota en setupSolarSystem)
    {
      const low = state.body==='earth' && state.altitude<30000;
      const f = low ? Math.min(1,Math.max(0,(state.altitude-8000)/22000)) : 1; // 0 = suelo/cielo diurno, 1 = espacio
      this._lowAlt = low;
      if (this.localGround){
        this.localGround.visible = low;
        if (low){
          this.localGround.position.set(0,-state.altitude-1.0,0); // 1.0 bajo el origen del cohete: los motores llegan a y=-0.8
          this.localGroundMat.color.set(0x403a28).lerp(this._skySpace,f);
        }
      }
      if (this.earth) this.earth.visible = !low;
      const lowMoon = state.body==='moon' && state.altitude<30000;
      if (this.moon && this.moon.material && this.moon.material.color) this.moon.material.color.setScalar(lowMoon ? 0.6 : 1);   // la Luna iluminada de cerca saturaba a blanco
      if (this.bloomPass) this.bloomPass.threshold = (low||lowMoon) ? 0.85 : 0.45; // sin esto el suelo/pad claros inundan la imagen
      if (this.atmosphere && low) this.atmosphere.visible=false;
      if (low){
        const sky=this._skyLow.clone().lerp(this._skySpace,f);
        this.scene.background=sky;
        this.scene.fog = f<1 ? new THREE.Fog(sky.getHex(),400,60000+f*400000) : null;
      } else {
        this.scene.background=this._skySpace; this.scene.fog=null;
      }
    }

    if (this.stars){
      this.stars.position.set(0,0,0);
      this.starClock += frameDt;
      this.stars.material.opacity = 0.75 + Math.sin(this.starClock*2.3)*0.08 + Math.sin(this.starClock*5.1)*0.05;
    }

    // la nave SIEMPRE se dibuja en el origen local (con el pequeño temblor de la sacudida)
    this.rocketGroup.position.set(0,0,0);
    this.rocketGroup.rotation.order='YXZ';
    this.rocketGroup.rotation.y=state.yaw; this.rocketGroup.rotation.x=state.pitch; this.rocketGroup.rotation.z=state.roll;

    const shake=(state.shakeIntensity||0) + (state.reentry ? 0.4+Math.random()*0.3 : 0);
    this.rocketGroup.position.x+=(Math.random()-0.5)*shake*0.3;
    this.rocketGroup.position.y+=(Math.random()-0.5)*shake*0.3;
    this.rocketGroup.position.z+=(Math.random()-0.5)*shake*0.3;

    if (this.engineGlow){
      const intensity=state.throttle*0.8+0.2;
      this.engineGlow.material.opacity=intensity*0.6;
      this.engineGlow.scale.setScalar(1+state.throttle*0.8);
    }
    if (this.engineLight){
      this.engineLight.intensity=state.throttle*5;
      this.engineLight.position.set(Math.sin(state.pitch)*2,-3,0);
    }
    this.updateFlame(state.throttle);
    this.updateParticles(state);
    this.updateTrail(state, shipAbs);

    this.bloomPass.strength=(0.2+state.throttle*0.25+(state.hyperspace?0.5:0)+(state.warp?0.3:0)+(state.reentry?0.7:0))*(this._lowAlt?0.5:1);

    const cockpitOverlay=document.getElementById('cockpitOverlay');
    if (cockpitOverlay) cockpitOverlay.classList.toggle('active', !!state.reentry && this.viewMode==='cockpit');

    const shipPos=new THREE.Vector3(0,0,0);
    const heading=new THREE.Vector3(0,1,0).applyEuler(new THREE.Euler(state.pitch,state.yaw,state.roll,'YXZ'));

    if (this.viewMode==='cockpit'){
      this.rocketGroup.visible=false;
      const pos=shipPos.clone().addScaledVector(heading,4);
      const target=shipPos.clone().addScaledVector(heading,60);
      const camShake=shake*0.5;
      pos.x+=(Math.random()-0.5)*camShake; pos.y+=(Math.random()-0.5)*camShake*0.5;
      this.camera.position.lerp(pos,0.15);
      this.camera.lookAt(target);
      document.getElementById('shakeOverlay').className='shake-overlay'+(shake>0.1?' active':'');
      const vzorDisc=document.getElementById('vzorDisc');
      if (vzorDisc){
        const showVzor = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin';
        vzorDisc.classList.toggle('active', showVzor);
        if (showVzor){
          // Vzor real: proyectaba el horizonte para juzgar la orientacion. Aqui, nivel (horizonte
          // centrado) = morro apuntando a la horizontal local (pitch=90 grados en este motor,
          // porque pitch=0 significa "hacia el cenit" desde el lanzamiento); el alabeo inclina
          // la linea de horizonte, como el desplazamiento que Gagarin observaba de verdad.
          const angleFromLevel = state.pitch - Math.PI/2;
          const horizon=document.getElementById('vzorHorizon');
          if (horizon) horizon.style.transform = 'rotate('+(-state.roll)+'rad) translateY('+(angleFromLevel*90).toFixed(1)+'px)';
        }
      }
    } else if (this.viewMode==='cinematic'){
      this.rocketGroup.visible=true;
      this._updateCinematicCamera(state, frameDt, missionPhase);
      document.getElementById('shakeOverlay').className='shake-overlay';
      const vzorDiscCine=document.getElementById('vzorDisc');
      if (vzorDiscCine) vzorDiscCine.classList.remove('active');
    } else {
      this.rocketGroup.visible=true;
      let followTarget = shipPos.clone().addScaledVector(heading,4);
      if (this.focusTarget && this.bodyMeshes[this.focusTarget]){
        followTarget = this.bodyMeshes[this.focusTarget].position.clone();
      }
      // Al acoplar, la ISS se posiciona en el mismo punto que la nave (distancia
      // relativa 0), y es mucho mas grande que ella. Con minDistance=5 (pensado
      // para ver solo la nave), la camara queda demasiado cerca para distinguir
      // la ISS -- se ve una mezcla de geometrias superpuestas, no la estacion.
      // Al detectar la transicion a acoplado, se aleja la camara automaticamente
      // y se sube el minimo permitido; al desacoplar, se restauran los valores
      // normales de una nave sola.
      if (state.dockedTo && !this._wasDocked){
        this.controls.minDistance=35;
        const dir=this.camera.position.clone().sub(this.controls.target).normalize();
        if (dir.lengthSq()<0.01) dir.set(0.4,0.3,0.6).normalize();
        this.camera.position.copy(followTarget).addScaledVector(dir,45);
      } else if (!state.dockedTo && this._wasDocked){
        this.controls.minDistance=5;
      }
      this._wasDocked = !!state.dockedTo;
      this.controls.target.lerp(followTarget,0.3); this.controls.update();
      document.getElementById('shakeOverlay').className='shake-overlay';
      const vzorDiscExt=document.getElementById('vzorDisc');
      if (vzorDiscExt) vzorDiscExt.classList.remove('active');
    }
    this.composer.render();

    this.rocketGroup.visible=true;
    const earthPos = this.earth ? this.earth.position : new THREE.Vector3(0,-this.R_earth,0);
    const isIssMission = usesRealIssMission();
    const moonPos = isIssMission && this.issGroup ? this.issGroup.position : (this.moon ? this.moon.position : new THREE.Vector3(1800000,2600000,-1200000));
    const frontPos=shipPos.clone().addScaledVector(heading,6);
    const backPos=shipPos.clone().addScaledVector(heading,-6);
    // Bug real: a baja altitud (ascenso temprano, descenso en paracaidas) la nave queda
    // por debajo del radio de las capas de nubes (1.008x) y/o atmosfera (1.025x). Estas
    // camaras en miniatura, a solo 6m de la nave, terminan DENTRO de esas capas -- y como
    // son esferas completas, cualquier direccion que miren (Tierra o Luna) las atraviesa,
    // viendolas desde dentro con AdditiveBlending: esto satura la imagen (el "amarillo con
    // rayos" en la tarjeta de Tierra y el "rosa" en la de Luna son la MISMA causa). Se
    // ocultan solo para estas dos camaras -- composer.render() (la vista principal) ya se
    // ejecuto arriba, asi que no se ve afectada.
    const cloudsWasVisible = this.clouds && this.clouds.visible;
    const atmoWasVisible = this.atmosphere && this.atmosphere.visible;
    if (this.clouds) this.clouds.visible=false;
    if (this.atmosphere) this.atmosphere.visible=false;
    // las tarjetas siguen viendo la esfera real (no el suelo local ni el cielo diurno)
    const miniSaved={earth:this.earth&&this.earth.visible, lg:this.localGround&&this.localGround.visible, fog:this.scene.fog, bg:this.scene.background};
    if (this.earth) this.earth.visible=true;
    if (this.localGround) this.localGround.visible=false;
    this.scene.fog=null; this.scene.background=this._skySpace;
    this.frontCam.position.copy(frontPos); this.frontCam.lookAt(earthPos);
    this.frontRenderer.render(this.scene,this.frontCam);
    this.backCam.position.copy(backPos); this.backCam.lookAt(moonPos);
    this.backRenderer.render(this.scene,this.backCam);
    if (this.clouds) this.clouds.visible=cloudsWasVisible;
    if (this.atmosphere) this.atmosphere.visible=atmoWasVisible;
    if (this.earth) this.earth.visible=miniSaved.earth;
    if (this.localGround) this.localGround.visible=miniSaved.lg;
    this.scene.fog=miniSaved.fog; this.scene.background=miniSaved.bg;

    const fData=document.getElementById('mvFrontData'), bData=document.getElementById('mvBackData');
    const distToEarthSurface = shipPos.distanceTo(earthPos) - this.R_earth;
    const distToMoon = shipPos.distanceTo(moonPos);
    if (fData) fData.textContent = 'Dist: '+formatDistance(Math.max(0,distToEarthSurface));
    if (bData) bData.textContent = 'Dist: '+formatDistance(distToMoon);

    // Esquema de la travesia Tierra-Luna: posicion de la nave proyectada sobre la linea
    // Tierra-Luna (0=en la Tierra, 1=en la Luna), y km recorridos de verdad desde el
    // despegue (odometro real, sumando la distancia entre la posicion absoluta de cada
    // fotograma, no la distancia en linea recta al destino).
    // Odometro: integral de la velocidad respecto al cuerpo dominante por el tiempo de simulacion transcurrido. Antes sumaba la distancia
    // entre posiciones ABSOLUTAS (heliocentricas): contaba tambien los ~29,8 km/s de la Tierra alrededor del Sol (226.000 km en 2 h) y los saltos
    // de reloj de las ventanas. Se descartan saltos de reloj (dt<0 o >1 dia).
    const tNow=state.time, dtSim = (this._trajPrevT===undefined) ? 0 : tNow-this._trajPrevT;
    if (state.time < 1) this._traveledDist = 0;
    else if (dtSim>0 && dtSim<=86400) this._traveledDist = (this._traveledDist||0) + state.velocity*dtSim;
    this._trajPrevT = tNow;
    const pgShip=document.getElementById('pgShip'), pgInfo=document.getElementById('pgInfo');
    if (pgShip && pgInfo){
      const emVec=moonPos.clone().sub(earthPos);
      const emDist=emVec.length()||1;
      const shipVec=shipPos.clone().sub(earthPos);
      const rawProgress=shipVec.dot(emVec)/(emDist*emDist);
      const progress=Math.max(0,Math.min(1,rawProgress));
      pgShip.style.left=(6+progress*88)+'%';
      pgInfo.textContent='Recorridos: '+formatDistance(this._traveledDist);
    }
    this.updateTrajectoryPanel(state, shipPos, earthPos, moonPos);
  }
  // Panel "TRAYECTORIA" (Artemis II): dibuja el recorrido real de la nave en el marco que gira con la Luna (Tierra a la izquierda,
  // Luna a la derecha, el plano de la Luna como plano de dibujo). El retorno libre sale como un "8": un lazo pequeño en la Tierra y
  // uno grande alrededor de la Luna. Esquematico: la escala horizontal y la vertical son distintas para llenar el panel. En trazo
  // discontinuo, la trayectoria NOMINAL (MISSION_CONFIG.artemis.guide, en unidades de 100 km); en trazo naranja, la real.
  updateTrajectoryPanel(state, shipPos, earthPos, moonPos){
    const cv=document.getElementById('pgCanvas'); if (!cv) return;
    const ctx=cv.getContext('2d'); const W=cv.width, H=cv.height;
    const INC=SOLAR_BODIES.moon.incl, nz=new THREE.Vector3(0,-Math.cos(INC),Math.sin(INC));
    const xh=moonPos.clone().sub(earthPos); const emDist=xh.length()||1; xh.multiplyScalar(1/emDist);
    const yh=new THREE.Vector3().crossVectors(nz,xh);
    const rel=shipPos.clone().sub(earthPos);
    const X=rel.dot(xh)/1e3, Y=rel.dot(yh)/1e3;               // km en el marco rotante
    if (!this._trajTrail) this._trajTrail=[];
    const t=state.time;
    if (this._trajLastT===undefined || t<this._trajLastT-1 || t-this._trajLastT>=1800){
      if (this._trajLastT!==undefined && t<this._trajLastT-1) this._trajTrail=[];   // reinicio de la simulacion
      this._trajLastT=t; this._trajTrail.push([X,Y]); if (this._trajTrail.length>1500) this._trajTrail.shift();
    }
    const X0=-60000, X1=430000, Y0=-300000, Y1=300000, PX=10, PY=18;
    const sx=(x)=>PX+(x-X0)/(X1-X0)*(W-2*PX), sy=(y)=>H-PY-(y-Y0)/(Y1-Y0)*(H-2*PY);
    ctx.clearRect(0,0,W,H);
    const cfg=(window.MISSION_CONFIG&&window.MISSION_CONFIG.artemis)||{};
    if (cfg.guide && cfg.guide.length){
      ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(255,255,255,.30)'; ctx.lineWidth=1.2; ctx.beginPath();
      cfg.guide.forEach((q,i)=>{ const px=sx(q[0]*100), py=sy(q[1]*100); if(i) ctx.lineTo(px,py); else ctx.moveTo(px,py); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (this._trajTrail.length>1){
      ctx.strokeStyle='#ffb347'; ctx.lineWidth=2.2; ctx.lineJoin='round'; ctx.beginPath();
      this._trajTrail.forEach((q,i)=>{ const px=sx(q[0]), py=sy(q[1]); if(i) ctx.lineTo(px,py); else ctx.moveTo(px,py); });
      ctx.lineTo(sx(X),sy(Y)); ctx.stroke();
    }
    // Tierra y Luna
    let g=ctx.createRadialGradient(sx(0)-2,sy(0)-2,1,sx(0),sy(0),9); g.addColorStop(0,'#6fb4ff'); g.addColorStop(1,'#0d3d66');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx(0),sy(0),8,0,Math.PI*2); ctx.fill();
    g=ctx.createRadialGradient(sx(emDist/1e3)-2,sy(0)-2,1,sx(emDist/1e3),sy(0),7); g.addColorStop(0,'#e0dccf'); g.addColorStop(1,'#7e7a70');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx(emDist/1e3),sy(0),6,0,Math.PI*2); ctx.fill();
    // nave
    const shx=Math.max(2,Math.min(W-2,sx(X))), shy=Math.max(2,Math.min(H-2,sy(Y)));
    ctx.shadowColor='rgba(255,204,51,.95)'; ctx.shadowBlur=8; ctx.fillStyle='#ffcc33'; ctx.beginPath(); ctx.arc(shx,shy,4,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
    const pgInfo=document.getElementById('pgInfo'); if (pgInfo) pgInfo.textContent='Recorridos: '+formatDistance(this._traveledDist||0);
  }
  // Camara cinematica: durante el crucero, la Tierra queda a la izquierda del encuadre
  // (atras) y la Luna a la derecha (delante, creciendo). Durante la aproximacion/descenso
  // lunar, cambia a una vista desde detras-abajo con la Luna llenando la parte inferior.
  // Puramente decorativo -- usa missionPhase, que ya le paso a update(), en vez de una
  // variable global nueva.
  _updateCinematicCamera(state, frameDt, missionPhase){
    const shipPos=new THREE.Vector3(0,0,0);
    const earthPos = this.earth ? this.earth.position.clone() : new THREE.Vector3(0,-this.R_earth,0);
    const moonPos = this.moon ? this.moon.position.clone() : new THREE.Vector3(1.8e6,2.6e6,-1.2e6);
    const toEarth = earthPos.clone().normalize();
    const toMoon = moonPos.clone().normalize();
    const forward = toEarth.clone().negate();
    if (this._cinematicInit===false){
      // Primer fotograma en este modo: coloca la camara directamente, sin suavizado,
      // para no ver un salto largo desde donde estuviera antes.
      this._cinematicCamPos.copy(shipPos).addScaledVector(forward,-60).addScaledVector(new THREE.Vector3(0,1,0),8);
      this._cinematicLookAt.copy(shipPos);
      this._cinematicInit=true;
    }
    let camPos, lookAt, up;

    if (missionPhase==='descent' || missionPhase==='loi_burn' || missionPhase==='separation'){
      // ---- Descenso / aproximacion lunar: la Luna llena la parte de abajo del encuadre ----
      up = toMoon.clone();
      const distance=40, altura=25;
      camPos = shipPos.clone().addScaledVector(forward,-distance).addScaledVector(up,-altura);
      lookAt = shipPos.clone().addScaledVector(up,-80);
    } else {
      // ---- Resto de fases: Tierra a la izquierda, Luna a la derecha ----
      up = new THREE.Vector3().crossVectors(toEarth,toMoon);
      if (up.lengthSq()<1e-6) up.set(0,1,0); else up.normalize();
      let right = new THREE.Vector3().crossVectors(forward,up).normalize();
      if (right.lengthSq()<1e-6) right.set(1,0,0);
      if (right.dot(toMoon)<0) right.negate();
      const distance=60, lateralOffset=15;
      camPos = shipPos.clone().addScaledVector(forward,-distance).addScaledVector(right,-lateralOffset).addScaledVector(up,8);
      lookAt = shipPos.clone().addScaledVector(forward,30);
    }

    this._cinematicCamPos.lerp(camPos,0.08);
    this._cinematicLookAt.lerp(lookAt,0.08);
    this.camera.position.copy(this._cinematicCamPos);
    this.camera.up.copy(up);
    this.camera.lookAt(this._cinematicLookAt);
  }
  updateParticles(state){
    const particles=state.particles||[]; const count=particles.length;
    const MAX_P=2000;
    if (!this._pBuf){
      this._pBuf={
        pos:new Float32Array(MAX_P*3), col:new Float32Array(MAX_P*3), size:new Float32Array(MAX_P)
      };
      this.particleSystem.setAttribute('position',new THREE.BufferAttribute(this._pBuf.pos,3));
      this.particleSystem.setAttribute('color',new THREE.BufferAttribute(this._pBuf.col,3));
      this.particleSystem.setAttribute('size',new THREE.BufferAttribute(this._pBuf.size,1));
    }
    if (count===0){ this.particlePoints.visible=false; return; }
    this.particlePoints.visible=true;
    const n=Math.min(count,MAX_P);
    const {pos,col,size}=this._pBuf;
    for (let i=0;i<n;i++){
      const p=particles[i];
      pos[i*3]=p.x-state.x; pos[i*3+1]=p.y-state.y; pos[i*3+2]=p.z-state.z;
      const lifeRatio=p.life/p.maxLife; const color=p.color||[1,0.5,0.1];
      col[i*3]=color[0]*lifeRatio; col[i*3+1]=color[1]*lifeRatio*0.8; col[i*3+2]=color[2]*lifeRatio*0.5;
      size[i]=p.size*lifeRatio;
    }
    this.particleSystem.attributes.position.needsUpdate=true;
    this.particleSystem.attributes.color.needsUpdate=true;
    this.particleSystem.attributes.size.needsUpdate=true;
    this.particleSystem.setDrawRange(0,n);
  }
  updateTrail(state, shipAbs){
    const trail=state.trail||[];
    if (!this.trailLine){
      this.trailPositions=new Float32Array(400*3);
      this.trailGeometry=new THREE.BufferGeometry();
      this.trailGeometry.setAttribute('position',new THREE.BufferAttribute(this.trailPositions,3));
      this.trailMaterial=new THREE.LineBasicMaterial({color:0xff6633,transparent:true,opacity:0.2});
      this.trailLine=new THREE.Line(this.trailGeometry,this.trailMaterial);
      this.scene.add(this.trailLine);
    }
    if (trail.length<2){ this.trailLine.visible=false; return; }
    this.trailLine.visible=true;
    const n=Math.min(trail.length,400);
    for (let i=0;i<n;i++){
      this.trailPositions[i*3]=trail[i].x-shipAbs.x;
      this.trailPositions[i*3+1]=trail[i].y-shipAbs.y;
      this.trailPositions[i*3+2]=trail[i].z-shipAbs.z;
    }
    this.trailGeometry.attributes.position.needsUpdate=true;
    this.trailGeometry.setDrawRange(0,n);
    this.trailGeometry.computeBoundingSphere();
  }
  toggleView(){
    const isGagarin = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin';
    const order = isGagarin ? ['external','cockpit'] : ['external','cockpit','cinematic'];
    const i=order.indexOf(this.viewMode);
    this.viewMode=order[(i+1)%order.length];
    if (this.viewMode==='cockpit'){ this.controls.enabled=false; this.camera.fov=65; }
    else if (this.viewMode==='cinematic'){ this.controls.enabled=false; this.camera.fov=55; this._cinematicInit=false; }
    else { this.controls.enabled=true; this.camera.fov=55; }
    this.camera.updateProjectionMatrix();
    return this.viewMode;
  }
  setFocus(target){ this.focusTarget = target; }
  resize(){
    const width=this.container.clientWidth, height=this.container.clientHeight;
    this.camera.aspect=width/height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height); this.composer.setSize(width,height);
    this.resizeMiniViews();
  }
}

/* ---------- PILOTO AUTOMATICO DE MISION COMPLETA ---------- */
// Portado y adaptado del algoritmo probado de extremo a extremo por separado: despegue con giro
// gravitatorio real -> orbita -> inyeccion translunar (vis-viva) -> crucero con correcciones de
// rumbo -> caida controlada y insercion en orbita lunar baja -> descenso en dos fases (frenada
// horizontal con direccion FIJA + control fino final) -> alunizaje suave.
// Cada quema usa una direccion CALCULADA UNA VEZ (no recalculada cada fotograma): con un motor
// tan potente, perseguir un objetivo que cambia de instante a instante nunca converge a tiempo.
function cross3fix(radial){
  const arbitrary = Math.abs(radial.x)<0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
  return cross3(radial, arbitrary);
}
// =====================================================================================
// ARTEMIS II -- piloto automatico propio (MISSION_CONFIG.type==='artemis')
// Secuencia (arranca en la orbita alta, HEO 192 x 70.174 km): alinear -> TLI con corte por
// ENERGIA -> coast -> TCM unica a +5 d (una pasada, con prediccion en sombra y verificacion)
// -> sobrevuelo lunar -> retorno -> interfaz de entrada (121,9 km).
// IMPORTANTE (deuda de calibracion, ver tests/): targetEnergy (epsilon*) solo vale para ESTA
// configuracion: masa total al encender, empuje, Isp, anomalia de ignicion (-16 grados), mu
// terrestre y preciseOrbits. Cualquier cambio en esos valores obliga a recalcularla (se
// comprueba en 'art_init' contra cfg.signature y la mision se niega a arrancar si no cuadra).
// Un solo mu: ARTEMIS_MU_E = G * masa de la Tierra del motor, el mismo que usa la gravedad.
// =====================================================================================
const ARTEMIS_MU_E = G*SOLAR_BODIES.earth.mass;
const ARTEMIS_EI_ALT = 121900; // interfaz de entrada de Orion (SpaceNews / NASA)
function artemisEnergy(p){ const r=Math.hypot(p.x,p.y,p.z), v2=p.u*p.u+p.v*p.v+p.w*p.w; return v2/2-ARTEMIS_MU_E/r; }
function artemisAttErrDeg(p, dir){
  const hd=FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,p.pitch,p.yaw,p.roll));
  return Math.acos(Math.max(-1,Math.min(1,hd.x*dir.x+hd.y*dir.y+hd.z*dir.z)))*180/Math.PI;
}
// Elementos osculantes geocentricos -> tiempo hasta una anomalia verdadera dada (Kepler)
function artemisTimeToTrueAnomaly(p, nuTargetRad){
  const mu=ARTEMIS_MU_E, r=Math.hypot(p.x,p.y,p.z), v2=p.u*p.u+p.v*p.v+p.w*p.w, rv=p.x*p.u+p.y*p.v+p.z*p.w;
  const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
  const ex=(p.v*hz-p.w*hy)/mu-p.x/r, ey=(p.w*hx-p.u*hz)/mu-p.y/r, ez=(p.u*hy-p.v*hx)/mu-p.z/r;
  const e=Math.sqrt(ex*ex+ey*ey+ez*ez), a=1/(2/r-v2/mu);
  if (!(e<1) || !(a>0)) return null;
  let nu=Math.acos(Math.max(-1,Math.min(1,(ex*p.x+ey*p.y+ez*p.z)/(e*r)))); if (rv<0) nu=-nu;
  const M=(nuv)=>{ const E=2*Math.atan2(Math.sqrt(1-e)*Math.sin(nuv/2), Math.sqrt(1+e)*Math.cos(nuv/2)); return E-e*Math.sin(E); };
  let dM=M(nuTargetRad)-M(nu); const TWO=2*Math.PI; dM=((dM%TWO)+TWO)%TWO;
  return { dt: dM/Math.sqrt(mu/(a*a*a)), e, a, nuDeg: nu*180/Math.PI };
}
// Direccion del perigeo medida en la base del plano lunar (e1=eje x, e2=eje x inclinado), y angulo entre el plano orbital y el
// plano de la Luna. La fase lunar de la ignicion solo vale RELATIVA a la direccion del perigeo, no al eje x.
function artemisPlaneAndPerigee(p){
  const mu=ARTEMIS_MU_E, r=Math.hypot(p.x,p.y,p.z), INC=SOLAR_BODIES.moon.incl;
  const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u, hm=Math.hypot(hx,hy,hz);
  const ex=(p.v*hz-p.w*hy)/mu-p.x/r, ey=(p.w*hx-p.u*hz)/mu-p.y/r, ez=(p.u*hy-p.v*hx)/mu-p.z/r, em=Math.hypot(ex,ey,ez);
  const e2={x:0,y:Math.sin(INC),z:Math.cos(INC)}, nm={x:0,y:-Math.cos(INC),z:Math.sin(INC)};
  const thetaP=Math.atan2((ex*e2.x+ey*e2.y+ez*e2.z)/em,(ex)/em);
  const cosN=(hx*nm.x+hy*nm.y+hz*nm.z)/hm;
  return {thetaPDeg:thetaP*180/Math.PI, planeErrDeg:Math.acos(Math.max(-1,Math.min(1,cosN)))*180/Math.PI};
}
// Escala de tiempo del crucero: la MISMA para el piloto y para la prediccion en sombra, para que
// la prediccion reproduzca exactamente la trayectoria real (el paso depende del timeScale).
function artemisCruiseTimeScale(bodyName, dist){
  // dist = distancia al centro del cuerpo dominante. Fino (200-300) cerca de la Tierra/Luna, donde manda la curvatura;
  // grueso lejos. Piloto y prediccion en sombra usan ESTA funcion: misma trayectoria numerica en ambos.
  // Elegida midiendo (tests/schedtest.js): reproduce la referencia fina (perigeo 50,75 km) con la mitad de pasos.
  if (bodyName==='moon') return dist<20e6 ? 300 : 1000;
  return dist<40e6 ? 300 : (dist<90e6 ? 600 : 20000);
}
// Prediccion en sombra: copia del estado, sin empuje; avanza por tandas (no bloquea el fotograma).
class ArtemisShadow {
  constructor(p, dvInPlane){
    this.q=new RocketPhysics();
    this.q.stack=new StageStack([{id:'sombra',dryMass:26000,fuelMass:0,maxFuelMass:0,thrust:1,isp:316}]);
    this.q.x=p.x;this.q.y=p.y;this.q.z=p.z;this.q.u=p.u;this.q.v=p.v;this.q.w=p.w;this.q.time=p.time;
    const rr=Math.hypot(p.x,p.y,p.z);
    this.q._lastState={altitude:rr-SOLAR_BODIES.earth.radius,bodyName:'earth',dist:rr,gMag:0,reentryFlag:false};
    if (dvInPlane){ const d=artemisCorrectionBasis(this.q); const [dp,db]=dvInPlane;
      this.q.u+=dp*d.vh.x+db*d.b.x; this.q.v+=dp*d.vh.y+db*d.b.y; this.q.w+=dp*d.vh.z+db*d.b.z; }
    this.everMoon=false; this.minMoon=Infinity; this.done=false; this.res=null; this.steps=0; this.t0=p.time;
  }
  advance(maxSteps){
    const q=this.q, RE=SOLAR_BODIES.earth.radius, RM=SOLAR_BODIES.moon.radius, ctl={throttle:0,timeScale:20000};
    for (let i=0;i<maxSteps && !this.done;i++){
      const s0=q._lastState; ctl.timeScale=artemisCruiseTimeScale(s0.bodyName,s0.dist);
      q.step(1/60,ctl); this.steps++;
      const s=q._lastState;
      if (s.bodyName==='moon'){ this.everMoon=true; if (s.dist<this.minMoon) this.minMoon=s.dist; }
      else if (s.bodyName==='earth'){
        if (this.everMoon){
          const rr=s.dist, vr=(q.x*q.u+q.y*q.v+q.z*q.w)/rr;
          if (rr<90e6 && vr<0){
            const mu=ARTEMIS_MU_E, v2=q.u*q.u+q.v*q.v+q.w*q.w;
            const hx=q.y*q.w-q.z*q.v, hy=q.z*q.u-q.x*q.w, hz=q.x*q.v-q.y*q.u, h2=hx*hx+hy*hy+hz*hz;
            const eps=v2/2-mu/rr, e=Math.sqrt(Math.max(0,1+2*eps*h2/(mu*mu))), rp=(h2/mu)/(1+e);
            const rEI=RE+ARTEMIS_EI_ALT, v2EI=2*(eps+mu/rEI), vtEI=Math.sqrt(h2)/rEI, vrEI2=Math.max(0,v2EI-vtEI*vtEI);
            this.res={ok:true,periMoonKm:(this.minMoon-RM)/1000,retPerigeeKm:(rp-RE)/1000,
              gammaEI:(rp<rEI)?-Math.asin(Math.sqrt(vrEI2/v2EI))*180/Math.PI:null,vEI:Math.sqrt(v2EI)};
            this.done=true;
          }
          if (s.altitude<0 && !this.done){ this.res={ok:false,why:'impacto'}; this.done=true; }
        }
      } else { this.res={ok:false,why:'escapa de la esfera terrestre ('+s.bodyName+')'}; this.done=true; }
      if (!this.done && (q.time-this.t0)>16*86400){ this.res={ok:false,why:this.everMoon?'no regresa a tiempo':'no llega a la Luna'}; this.done=true; }
    }
    return this.done;
  }
}
// Base de la correccion: v^ (prograde) y b^ = n^ x v^ (en el plano orbital, perpendicular a v)
function artemisCorrectionBasis(p){
  const vv=Math.hypot(p.u,p.v,p.w), vh={x:p.u/vv,y:p.v/vv,z:p.w/vv};
  const rr=Math.hypot(p.x,p.y,p.z), rh={x:p.x/rr,y:p.y/rr,z:p.z/rr};
  let n={x:rh.y*vh.z-rh.z*vh.y,y:rh.z*vh.x-rh.x*vh.z,z:rh.x*vh.y-rh.y*vh.x}; const nm=Math.hypot(n.x,n.y,n.z); n={x:n.x/nm,y:n.y/nm,z:n.z/nm};
  const b={x:n.y*vh.z-n.z*vh.y,y:n.z*vh.x-n.x*vh.z,z:n.x*vh.y-n.y*vh.x};
  return {vh,b,n};
}

class MissionAutopilot {
  constructor(app){
    this.app = app;
    this.active = false;
    this.phase = null;
    this.phaseStart = 0;
    this.lastExplainPhase = null;
    this.lastCorrection = -1e9;
    this._targetedOnce = false;
    this._loiSub = undefined;
    this._descSub = undefined;
    this._fixedDeorbitDir = null;
    this._numBurns = 1;
    this.paused = false;
    this.speed = 1;
  }
  start(){
    this.active = true;
    this.paused = false;
    this.speed = 1;
    const isGagarin = this.app.mission && this.app.mission.type==='gagarin';
    const isIss = this.app.mission && this.app.mission.type==='iss';
    const isArtemis = this.app.mission && this.app.mission.type==='artemis';
    this.phase = isArtemis ? ((this.app.mission.artemis && this.app.mission.artemis.startInOrbit) ? 'art_init' : 'art_a_ascent') : isGagarin ? 'gagarin_ascent' : isIss ? 'iss_ascent' : 'ascent';
    this._art = null; this._ret = null; this.telemetry = []; this.failed = null;
    this.phaseStart = this.app.physics.time;
    this._targetedOnce = false; this._loiSub = undefined; this._descSub = undefined;
    this._fixedDeorbitDir = null; this._numBurns = 1; this.lastExplainPhase = null;
    this._shuttleRefueled = false;
    this.explain(this.phase);
  }
  stop(msg){
    this.active = false;
    this.phase = null;
    this._zeroControls();
    if (msg) this.app.toast.show(msg, 6000);
  }
  _zeroControls(){
    // Sin esto, al terminar el piloto automático el juego cae al modo manual heredando el
    // ULTIMO mando que el piloto hubiera dado (throttle, actitud) y la nave sigue moviendose
    // sola para siempre, incluso ya "aterrizada". Bug real, visto y confirmado en pantalla.
    if (this.app && this.app.controls){
      this.app.controls.throttle=0; this.app.controls.pitch=0; this.app.controls.yaw=0; this.app.controls.roll=0;
    }
  }
  explain(key){
    if (this.lastExplainPhase===key) return;
    this.lastExplainPhase = key;
    const isGagarin = this.app.mission && this.app.mission.type==='gagarin';
    const isIss = this.app.mission && this.app.mission.type==='iss';
    // El Shuttle (como Gagarin e ISS) nunca alunizo -- sin incluirlo aqui, mostraba
    // "Alunizaje automatico logrado" al terminar el fasing con la ISS (bug real,
    // encontrado al verificar la secuencia completa del Shuttle tras el fix de fase).
    const isShuttle = this.app.mission && this.app.mission.type==='shuttle';
    const MSG = {
      ascent: '🚀 Piloto automático: despegando con giro gravitatorio real hacia el este.',
      park_coast: '🛰️ Corte de motor: la nave sube en arco hasta el apogeo de la órbita de aparcamiento.',
      park_circ: '🔥 En el apogeo: quema prógrada para circularizar la órbita de aparcamiento.',
      coast_leo: '🛰️ En órbita de aparcamiento terrestre. Comprobación de sistemas antes de la inyección translunar.',
      transposicion: '🔄 Transposición y acoplamiento: el CSM se separa de la S-IVB, gira 180°, se acopla al módulo lunar y lo extrae.',
      tli_burn: '🔥 Quemando prógrado para alcanzar la velocidad exacta hacia la Luna (ecuación vis-viva).',
      coast_tli: '🌌 Crucero hacia la Luna, con correcciones de rumbo automáticas cada 6h simuladas.',
      loi_burn: '🌑 Aproximación lunar: cayendo con seguridad hacia una órbita baja real.',
      descent: '🛬 Descenso motorizado hacia la superficie.',
      ret_ascent: '🚀 Despegue lunar: la etapa de ascenso del módulo lunar sube a órbita para el encuentro con el módulo de mando.',
      ret_orbit: '🛰️ En órbita lunar de 111 km, unido al módulo de mando. Esperando el punto de la inyección trans-Tierra, en la cara oculta.',
      ret_tei: '🔥 Inyección trans-Tierra (TEI): el motor del módulo de servicio quema en prógrado en la cara oculta de la Luna.',
      ret_coast_moon: '🌑 Motor apagado: saliendo de la esfera de influencia de la Luna.',
      ret_coast_earth: '🌍 Camino a casa: una corrección ajusta el perigeo para la reentrada.',
      ret_entry: '🔥 Interfaz de entrada (121,9 km): módulo de servicio descartado, escudo térmico por delante. Entrada balística: pico de g alto, mayor que el real.',
      ret_chute: '🪂 Paracaídas desplegados.',
      ret_done: '🌊 Amerizaje.',
      art_a_ascent: '🚀 SLS: despegue. Dos propulsores sólidos y cuatro RS-25; giro gravitatorio hacia el este.',
      art_a_coast: '🛰️ Corte de la etapa central. Coast hasta el apogeo; la ICPS se orienta en prógrado.',
      art_a_icps1: '🔥 ICPS, primera quema: elevando el perigeo (194 km).',
      art_a_coast2: '🛰️ Coast hasta el perigeo para la segunda quema de la ICPS.',
      art_a_icps2: '🔥 ICPS, segunda quema: elevando el apogeo hasta 70.174 km (órbita alta).',
      art_align: '🛰️ Artemis II: orientando Orion en prógrado y esperando la ventana de la inyección translunar.',
      art_tli: '🔥 Inyección translunar: quemando prógrado; el corte llega por ENERGÍA, no por tiempo.',
      art_coast1: '🌌 Crucero hacia la Luna. A +5 días: una sola corrección de trayectoria.',
      art_predict: '🧮 Calculando la corrección a medio camino (predicción y verificación en sombra)…',
      art_coast2: '🌑 Corrección aplicada. Sobrevuelo lunar de retorno libre y regreso a la Tierra.',
      art_entry: '🔥 Interfaz de entrada (121,9 km): módulo de servicio descartado, escudo térmico por delante. Entrada BALÍSTICA (sin sustentación): la deceleración llegará a ~23 g, mucho más que los ~4 g del Orion real; no es un fallo de la simulación.',
      art_chute: '🪂 Paracaídas desplegados.',
      art_done: '🌊 Amerizaje.',
      done: (isGagarin || isIss || isShuttle || (this.app.mission && this.app.mission.type==='artemis')) ? null : '🎉 ¡Alunizaje automático logrado!'
    };
    if (MSG[key]) this.app.toast.show(MSG[key], 7000);
  }
  statusLabel(){
    const NAMES = {
      ret_wait:'En la Luna', ret_ascent:'Despegue lunar', ret_rdv:'Encuentro', ret_orbit:'Órbita lunar', ret_tei:'Inyección a la Tierra', ret_coast_moon:'Saliendo de la Luna', ret_coast_earth:'Regreso a la Tierra', ret_entry:'Entrada', ret_chute:'Paracaídas', ret_done:'Completado',
      art_a_ascent:'Ascenso SLS', art_a_coast:'Coast a apogeo', art_a_icps1:'ICPS: quema 1', art_a_coast2:'Coast a perigeo', art_a_icps2:'ICPS: quema 2', art_init:'Preparando', art_align:'Alineando', art_tli:'Inyección translunar', art_coast1:'Crucero translunar', art_predict:'Calculando corrección', art_coast2:'Sobrevuelo y retorno', art_entry:'Entrada', art_chute:'Paracaídas', art_done:'Completado',
      ascent:'Ascenso', park_coast:'Coast al apogeo', park_circ:'Circularizando', coast_leo:'Órbita terrestre', tli_burn:'Quema translunar', transposicion:'Transposición',
      coast_tli:'Crucero a la Luna', loi_burn:'Aproximación lunar', separation:'Separación Eagle', descent:'Descenso', done:'Completado'
    };
    return NAMES[this.phase] || this.phase;
  }

  _artTelemetry(tag, extra){
    const p=this.app.physics, ls=p._lastState; this.telemetry.push(Object.assign({fase:tag,t:+p.time.toFixed(1),cuerpo:ls.bodyName,altKm:+(ls.altitude/1000).toFixed(0)},extra||{}));
  }
  _artFail(msg){ this._artTelemetry('FALLO',{msg}); this.failed=msg; this.stop('⛔ Misión no viable: '+msg); return null; }
  _artemisStep(p, preState, speedNow, controls){
    const cfg=(this.app.mission && this.app.mission.artemis)||{}, A=this._art||(this._art={});
    const dirV = speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0});
    const steerTo=(dir)=>{ const st=p.autopilotSteer(dir); controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; };
    const idle=()=>{ controls.timeScale=1e-5; return controls; }; // no avanza la simulacion (calculo en sombra)

    // =============== ASCENSO DEL SLS (Bloque 1) E ICPS: del Cabo a la orbita alta ===============
    // El piloto de arriba (art_init...) arranca desde la orbita alta; esta parte la construye. Interfaz con
    // art_init: masa 26.300 kg (ICPS descartada), perigeo ~192 km, apogeo ~70.174 km, en el plano de la Luna.
    // Atencion: STAGE ESTILO MOTOR -- la etapa 0 es hibrida (SRB fijos + 4 RS-25 regulables), como el Shuttle.
    const AS=cfg.ascent||{};
    const RE_=SOLAR_BODIES.earth.radius;
    const osc=()=>{ // elementos osculantes geocentricos: perigeo y apogeo (radios)
      const mu=ARTEMIS_MU_E, r=Math.hypot(p.x,p.y,p.z), v2=speedNow*speedNow, eps=v2/2-mu/r;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u, h2=hx*hx+hy*hy+hz*hz;
      if (eps>=0) return {rp:Infinity,ra:Infinity,eps};
      const a=-mu/(2*eps), e=Math.sqrt(Math.max(0,1+2*eps*h2/(mu*mu))); return {rp:a*(1-e),ra:a*(1+e),a,e,eps};
    };
    if (this.phase==='art_a_ascent'){
      if (p.metZero===undefined) p.metZero=this.phaseStart;   // T+ de la HUD cuenta desde el despegue
      const tAsc=p.time-this.phaseStart;
      const rA=Math.hypot(p.x,p.y,p.z), vO=Math.sqrt(ARTEMIS_MU_E/rA), fracV=Math.min(1,speedNow/vO);
      let dir;
      if (tAsc<AS.tVertical) dir=FRAME_ROTATION({x:0,y:1,z:0});
      else { const ang=Math.min(1.45,AS.k*Math.pow(fracV,AS.n)); dir=FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,ang,LAUNCH_YAW_EAST,0)); }
      steerTo(dir); controls.throttle=1; controls.timeScale=1;
      if (p.stack.currentIndex>=2){ // etapa central agotada: la ICPS ya es la etapa activa -> corte
        const o=osc(); this._artTelemetry('MECO',{perigeoKm:+((o.rp-RE_)/1000).toFixed(0),apogeoKm:+((o.ra-RE_)/1000).toFixed(0),velMs:+speedNow.toFixed(0),propCentralKg:+(p.stack.stages[1].maxFuelMass-p.stack.stages[1].fuelMass).toFixed(0)});
        this.phase='art_a_coast'; this.phaseStart=p.time; A.coastDt=null; this.explain('art_a_coast'); controls.throttle=0; return controls;
      }
      if (tAsc>20 && preState.altitude<1000 && (p.x*p.u+p.y*p.v+p.z*p.w)<0) return this._artFail('el ascenso del SLS fracasó (la nave vuelve a tierra).');
      if (tAsc>900) return this._artFail('el ascenso del SLS no agotó la etapa central en 15 min.');
      return controls;
    }
    if (this.phase==='art_a_coast' || this.phase==='art_a_coast2'){
      const second=(this.phase==='art_a_coast2'), nuT=second ? AS.nuBurn2Deg*Math.PI/180 : Math.PI; // apogeo (180) o inicio de la quema 2
      if (A.coastDt==null){ const k=artemisTimeToTrueAnomaly(p,nuT); if(!k) return this._artFail('la órbita de coast no es elíptica.'); A.coastEnd=p.time+k.dt; A.coastDt=k.dt; }
      const rem=A.coastEnd-p.time, WIN=150;
      controls.throttle=0;
      if (rem>WIN+0.05){ controls.timeScale=Math.min(2000,Math.max(0.1,(rem-WIN)*60)); return controls; }
      steerTo(dirV);
      if (rem<=1e-6){ A.coastDt=null; this.phase=second?'art_a_icps2':'art_a_icps1'; this.phaseStart=p.time; this.explain(this.phase); return this._artemisStep(p,preState,speedNow,controls); }
      controls.timeScale=Math.min(1,rem*60); return controls;
    }
    if (this.phase==='art_a_icps1' || this.phase==='art_a_icps2'){
      const first=(this.phase==='art_a_icps1'); steerTo(dirV);
      const o=osc();
      const done = first ? (o.rp>=RE_+AS.perigeeAltKm*1000) : (o.ra>=RE_+AS.apogeeAltKm*1000);
      if (done){
        this._artTelemetry(first?'ICPS quema 1 fin':'ICPS quema 2 fin',{perigeoKm:+((o.rp-RE_)/1000).toFixed(1),apogeoKm:+((o.ra-RE_)/1000).toFixed(0),quemaS:+(p.time-this.phaseStart).toFixed(1),propICPSkg:+(p.stack.current().maxFuelMass-p.stack.current().fuelMass).toFixed(0)});
        if (first){ this.phase='art_a_coast2'; A.coastDt=null; this.explain('art_a_coast2'); controls.timeScale=1; return controls; }
        p.stack.jettison(); this._artTelemetry('separacion ICPS',{masaKg:+(p.dryMass+p.fuelMass).toFixed(0)});
        this.phase='art_init'; A.coastDt=null; return this._artemisStep(p,preState,0,controls);
      }
      controls.throttle=1; controls.timeScale=1;
      if (p.fuelMass<=0 || (p.time-this.phaseStart)>AS.maxBurnS) return this._artFail('la ICPS agotó el propelente sin alcanzar la órbita objetivo.');
      return controls;
    }

    if (this.phase==='art_init'){
      // 1) la configuracion debe ser LA calibrada (epsilon* depende de masa, empuje, Isp y punto de arranque)
      const sg=cfg.signature||{}, mass=p.dryMass+p.fuelMass, thr=p.stack.effectiveThrustAt(1,p.time).thrust, isp=p.stack.current().isp;
      const rel=(a,b)=>Math.abs(a-b)/Math.abs(b);
      if (rel(mass,sg.totalMassKg)>1e-6 || rel(thr,sg.thrustN)>1e-6 || rel(isp,sg.isp)>1e-6)
        return this._artFail('epsilon* calibrada para otra configuración (masa '+mass.toFixed(0)+' kg, empuje '+thr.toFixed(0)+' N, Isp '+isp+' s). Recalcular targetEnergy.');
      if (!SOLAR_BODIES.earth || !(this.app.mission.preciseOrbits && this.app.mission.correctSoiVelocity))
        return this._artFail('faltan preciseOrbits/correctSoiVelocity en la misión.');
      // 2) ventana fija de simulacion: el reloj se coloca para que la ignicion caiga en la fase lunar calibrada
      const k=artemisTimeToTrueAnomaly(p, cfg.nuIgnDeg*Math.PI/180);
      if (!k) return this._artFail('la órbita de partida no es una elíptica cerrada.');
      const pf=artemisPlaneAndPerigee(p);
      if (pf.planeErrDeg>(cfg.maxPlaneErrDeg||0.5)) return this._artFail('el plano de la órbita alta difiere '+pf.planeErrDeg.toFixed(2)+'° del plano lunar (límite '+(cfg.maxPlaneErrDeg||0.5)+'°).');
      // fase lunar RELATIVA al perigeo: Luna a (phiIgn + direccion del perigeo) grados desde el eje x
      const phiAbs=((cfg.phiIgnDeg+pf.thetaPDeg)%360+360)%360;
      A.tIgn=(phiAbs/360)*SOLAR_BODIES.moon.period; // instante de reloj de la ignicion (dia ~6,5 del calendario del simulador)
      A.planeErrDeg=pf.planeErrDeg; A.thetaPDeg=pf.thetaPDeg;
      const tBefore=p.time; p.time=A.tIgn-k.dt; A.clockShiftTo=p.time;
      if (p.metZero!==undefined) p.metZero+=(p.time-tBefore);   // el salto de reloj de la ventana no cuenta como tiempo de mision
      this._artTelemetry('init',{nuDeg:+k.nuDeg.toFixed(2),dtHastaIgnicionS:+k.dt.toFixed(1),tIgn:+A.tIgn.toFixed(1),perigeoDirDeg:+A.thetaPDeg.toFixed(2),errPlanoDeg:+A.planeErrDeg.toFixed(3)});
      this.phase='art_align'; this.phaseStart=p.time; this.explain('art_align');
      return idle();
    }

    if (this.phase==='art_align'){
      // Crucero rapido hasta 150 s antes de la ignicion SIN gobernar la actitud (con timeScale alto el
      // SAS integra pasos de cientos de segundos y puede divergir); los ultimos 150 s van a tiempo real
      // para alinear en prógrado y encender en el instante exacto.
      const rem=A.tIgn-p.time, err=artemisAttErrDeg(p,dirV), WIN=150;
      if (rem<-600) return this._artFail('la ignición de la TLI no se produjo: la nave no alineó en 10 min tras la hora prevista.');
      if (p.time-this.phaseStart>3*86400) return this._artFail('la espera hasta la ventana de la TLI superó 3 días.');
      if (rem>WIN+0.05){ controls.timeScale=Math.min(2000,Math.max(0.1,(rem-WIN)*60)); return controls; } // el margen evita un ultimo paso de tamano ~0 (se quedaba parado)
      steerTo(dirV);
      if (rem<=1e-6){
        if (err<0.5){ this.phase='art_tli'; this.phaseStart=p.time; A.tliStart=p.time;
          this._artTelemetry('ignicion',{attErrDeg:+err.toFixed(3),retrasoS:+(p.time-A.tIgn).toFixed(2)}); this.explain('art_tli');
          return this._artemisStep(p, preState, speedNow, controls); }
        controls.timeScale=1; return controls; // espera a alinear (retrasa la ignicion)
      }
      controls.timeScale=Math.min(1,rem*60); return controls;
    }

    if (this.phase==='art_tli'){
      steerTo(dirV);
      const eps=artemisEnergy(p);
      if (eps>=cfg.targetEnergy-0.05){
        A.tCut=p.time; this._artTelemetry('corte',{quemaS:+(p.time-A.tliStart).toFixed(4),epsMenosObjetivo:+(eps-cfg.targetEnergy).toFixed(3),propKg:+(8000-p.fuelMass).toFixed(1)});
        this.phase='art_coast1'; this.phaseStart=p.time; this.explain('art_coast1'); controls.timeScale=1; return controls;
      }
      const thr=p.stack.effectiveThrustAt(1,p.time).thrust, m=p.dryMass+p.fuelMass, rate=(thr/m)*speedNow;
      const need=(cfg.targetEnergy-eps)/rate;
      controls.throttle=1; controls.timeScale=Math.min(1,Math.max(need*60,1e-4));
      if (p.fuelMass<=0 || (p.time-A.tliStart)>cfg.maxBurnS) return this._artFail('la quema translunar no alcanza la energía objetivo (límite de quema o combustible).');
      return controls;
    }

    if (this.phase==='art_coast1'){
      const rem=(A.tCut+cfg.tcmDays*86400)-p.time;
      if (preState.body==='moon') return this._artFail('entra en la esfera lunar antes de la corrección programada.');
      if (rem<=1e-6){ this.phase='art_predict'; this.phaseStart=p.time; A.sh1=null; A.sh2=null; this.explain('art_predict'); return idle(); }
      controls.timeScale=Math.min(rem*60, artemisCruiseTimeScale(preState.body,Math.hypot(p.x,p.y,p.z)));
      return controls;
    }

    if (this.phase==='art_predict'){
      const BUDGET=2500;
      if (!A.sh1){ A.sh1=new ArtemisShadow(p,null); }
      if (!A.sh1.done){ A.sh1.advance(BUDGET); return idle(); }
      const r1=A.sh1.res;
      if (!r1.ok) return this._artFail('sin corrección la nave '+r1.why+'; la desviación excede lo corregible.');
      if (!A.dv){
        const e0=[r1.periMoonKm-cfg.targetPeriKm, r1.retPerigeeKm-cfg.targetRetKm];
        const gMin=(cfg.gammaMinDeg!==undefined?cfg.gammaMinDeg:-6.8), gMax=(cfg.gammaMaxDeg!==undefined?cfg.gammaMaxDeg:-5.6);
        if (Math.abs(e0[0])<=cfg.tolPeriKm && r1.gammaEI!=null && r1.gammaEI>=gMin && r1.gammaEI<=gMax){
          // la trayectoria ya cae dentro de tolerancia: no se gasta una TCM (la real solo corrige si hace falta)
          this._artTelemetry('TCM omitida',{periKm:+r1.periMoonKm.toFixed(0),retKm:+r1.retPerigeeKm.toFixed(1),gamma:+r1.gammaEI.toFixed(2)});
          this.app.toast.show('✅ La trayectoria ya está dentro de tolerancia: corrección a medio camino no necesaria.', 6000);
          this.phase='art_coast2'; this.phaseStart=p.time; this.explain('art_coast2'); return idle();
        }
        const J=cfg.J, e=[r1.periMoonKm-cfg.targetPeriKm, r1.retPerigeeKm-cfg.targetRetKm], det=J[0][0]*J[1][1]-J[0][1]*J[1][0];
        const dp=-( J[1][1]*e[0]-J[0][1]*e[1])/det, db=-(-J[1][0]*e[0]+J[0][0]*e[1])/det;
        A.dv=[dp,db]; A.err0=e; A.r1=r1;
        this._artTelemetry('prediccion1',{periKm:+r1.periMoonKm.toFixed(0),retKm:+r1.retPerigeeKm.toFixed(1),gamma:r1.gammaEI!=null?+r1.gammaEI.toFixed(2):null,dvPropuesto:+Math.hypot(dp,db).toFixed(3)});
        if (Math.hypot(dp,db)>cfg.maxTcmDv) return this._artFail('la corrección necesaria ('+Math.hypot(dp,db).toFixed(1)+' m/s) supera el límite de '+cfg.maxTcmDv+' m/s.');
      }
      if (!A.sh2){ A.sh2=new ArtemisShadow(p,A.dv); }
      if (!A.sh2.done){ A.sh2.advance(BUDGET); return idle(); }
      const r2=A.sh2.res;
      this._artTelemetry('prediccion2',r2.ok?{periKm:+r2.periMoonKm.toFixed(0),retKm:+r2.retPerigeeKm.toFixed(1),gamma:r2.gammaEI!=null?+r2.gammaEI.toFixed(2):null}:{why:r2.why});
      // Criterio de aceptacion en GAMMA de entrada (no en perigeo): ventana [-6,8; -5,6] grados. Limite somero: la entrada balistica
      // de este modelo "salta" (rebota hacia el espacio y reentra horas despues) alrededor de -5,4; limite profundo: se mantiene
      // el margen de <1 grado alrededor del nominal (-5,9 a -6,1) que cita NASA para Orion.
      const gMin=(cfg.gammaMinDeg!==undefined?cfg.gammaMinDeg:-6.8), gMax=(cfg.gammaMaxDeg!==undefined?cfg.gammaMaxDeg:-5.6);
      if (!r2.ok || Math.abs(r2.periMoonKm-cfg.targetPeriKm)>cfg.tolPeriKm || r2.gammaEI==null || r2.gammaEI<gMin || r2.gammaEI>gMax)
        return this._artFail('con la corrección calculada la entrada seguiría fuera de tolerancia'+(r2.ok?' (pericintio '+r2.periMoonKm.toFixed(0)+' km, γ de entrada '+(r2.gammaEI!=null?r2.gammaEI.toFixed(1)+'°':'sin entrada')+', ventana '+gMin+'° a '+gMax+'°)':' ('+r2.why+')')+'.');
      const d=artemisCorrectionBasis(p), [dp,db]=A.dv;
      p.u+=dp*d.vh.x+db*d.b.x; p.v+=dp*d.vh.y+db*d.b.y; p.w+=dp*d.vh.z+db*d.b.z;
      this._artTelemetry('TCM',{dvProgrado:+dp.toFixed(3),dvPerp:+db.toFixed(3),dvTotal:+Math.hypot(dp,db).toFixed(3)});
      this.phase='art_coast2'; this.phaseStart=p.time; this.explain('art_coast2'); return idle();
    }

    if (this.phase==='art_coast2'){
      if (preState.body==='earth' && A.sawMoon && preState.altitude<ARTEMIS_EI_ALT){
        // gamma EXACTO en la interfaz (121,9 km): el paso de integracion del crucero avanza ~55 km por fotograma y
        // el estado real ya ha pasado la interfaz; se calcula con elementos osculantes (dos cuerpos, exacto aqui)
        const RE=SOLAR_BODIES.earth.radius, rEI=RE+ARTEMIS_EI_ALT, mu=ARTEMIS_MU_E, rr=Math.hypot(p.x,p.y,p.z);
        const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u, h2=hx*hx+hy*hy+hz*hz, eps=artemisEnergy(p);
        const v2EI=2*(eps+mu/rEI), vtEI=Math.sqrt(h2)/rEI, gEI=-Math.asin(Math.sqrt(Math.max(0,v2EI-vtEI*vtEI)/v2EI))*180/Math.PI;
        this._artTelemetry('entrada',{altKm:+(preState.altitude/1000).toFixed(2),velEIKms:+(Math.sqrt(v2EI)/1000).toFixed(3),gammaEIDeg:+gEI.toFixed(2),periMoonKm:+((A.minMoonDist-SOLAR_BODIES.moon.radius)/1000).toFixed(0)});
        this.phase='art_entry'; this.phaseStart=p.time; A.maxG=0; A.vPrev=null; A.esmOff=false; this.explain('art_entry'); controls.timeScale=1; return controls;
      }
      if (preState.body==='moon'){ A.sawMoon=true; const dm=p._lastState.dist; if (!(A.minMoonDist<dm)) A.minMoonDist=dm; }
      controls.timeScale=artemisCruiseTimeScale(preState.body,Math.hypot(p.x,p.y,p.z));
      if ((p.time-A.tCut)>20*86400) return this._artFail('el retorno tardó más de 20 días.');
      return controls;
    }

    // ---- ENTRADA DIRECTA (sin rebote "skip", simplificacion declarada) ----
    // Se descarta el modulo de servicio, el escudo termico apunta hacia delante (capsula "de culo") y la
    // frenada sale de la resistencia del motor (dragCdA = 23,5 m2: Cd 1,2 x 19,6 m2 de la capsula de 5 m).
    if (this.phase==='art_entry'){
      if (!A.esmOff){ p.stack.jettison(); A.esmOff=true; this._artTelemetry('separacion ESM',{masaKg:+(p.dryMass+p.fuelMass).toFixed(0)}); }
      const dirR=norm3({x:-p.u,y:-p.v,z:-p.w}); const st=p.autopilotSteer(dirR); controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll;
      controls.timeScale = preState.altitude>125000 ? 200 : (preState.altitude>30000 ? 5 : 2); // >125 km: tramo fuera de la atmosfera (salto)
      // pico de deceleracion (g) a partir del cambio de velocidad entre fotogramas (dt = timeScale/60 s)
      const v=speedNow;
      if (A.vPrev!=null && A.lastTs){ const g=Math.abs(v-A.vPrev)/(A.lastTs/60)/9.81; if (g>A.maxG && g<40) A.maxG=g; }
      A.vPrev=v; A.lastTs=controls.timeScale;
      if (preState.altitude<=7600){
        this._artTelemetry('paracaidas',{altKm:+(preState.altitude/1000).toFixed(2),velMs:+v.toFixed(1),picoG:+A.maxG.toFixed(1)});
        this.phase='art_chute'; this.phaseStart=p.time; this.explain('art_chute'); return controls;
      }
      if (v<1 || (p.time-A.entryT0Guard||0)>1e9) return controls;
      return controls;
    }
    if (this.phase==='art_chute'){
      // Frenada de los paracaidas: decaimiento exponencial de la velocidad (igual de declarada que en Gagarin),
      // por segundo de SIMULACION; la velocidad terminal sale de g / lambda (~5 m/s).
      controls.throttle=0; controls.timeScale=30;
      const k=Math.pow(0.15, controls.timeScale/60); p.u*=k; p.v*=k; p.w*=k;
      if (preState.altitude<=0){
        p.u=0;p.v=0;p.w=0; this._artTelemetry('amerizaje',{velMs:0});
        this.phase='art_done'; this.explain('art_done'); this.active=false; this._zeroControls();
        this.app.toast.show('🌊 Amerizaje de Orion en el mar. Misión Artemis II completada (simulador).', 9000);
      }
      return controls;
    }
    return controls;
  }

  // ===================== APOLO 11: REGRESO A LA TIERRA =====================
  // Secuencia real de Apolo 11, simplificada solo donde se declara: estancia -> despegue del modulo lunar (etapa de ascenso, masas reales) a orbita
  // lunar -> encuentro y acoplamiento con el modulo de mando (CSM, que esperaba a 111 km) -> descarte del modulo lunar -> quema TEI del motor del
  // modulo de servicio (SPS) en la cara oculta -> salida de la Luna -> correccion que fija el perigeo -> entrada, paracaidas y amerizaje.
  // Fisica "vieja" de Apolo (sin correctSoiVelocity): al cruzar la esfera lunar la velocidad se conserva tal cual, como a la ida.
  // SIMPLIFICACIONES: (1) el encuentro (CSI/CDH/TPI, ~3,5 h reales) NO se simula: al terminar el ascenso el simulador coloca la nave en la orbita
  // circular del CSM, en el mismo plano, y las une; el CSM no existe como entidad separada. (2) La TEI se calcula con las formulas de la hiperbola
  // de escape (dos cuerpos) y la correccion final absorbe el resto.
  _returnStep(p, preState, speedNow, controls){
    const cfg=(this.app.mission && this.app.mission.returnTrip)||{}, R=this._ret||(this._ret={});
    const MU_M=G*SOLAR_BODIES.moon.mass, MU_E=ARTEMIS_MU_E, RE=SOLAR_BODIES.earth.radius, RM=SOLAR_BODIES.moon.radius;
    const steerTo=(dir)=>{ const st=p.autopilotSteer(dir); controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; };
    const rr=Math.hypot(p.x,p.y,p.z), up={x:p.x/rr,y:p.y/rr,z:p.z/rr};
    const dot3=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z, cr3=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
    const nrm=(a)=>{ const m=Math.hypot(a.x,a.y,a.z)||1; return {x:a.x/m,y:a.y/m,z:a.z/m}; };
    const moonEarthDir=()=>{ const mp=positionOf('moon',p.time), ep=positionOf('earth',p.time); return nrm({x:ep.x-mp.x,y:ep.y-mp.y,z:ep.z-mp.z}); };
    const epsT=0.5*cfg.exitSpeed*cfg.exitSpeed-MU_M/soiOf('moon');                 // energia selenocentrica para llegar a la SOI con exitSpeed
    const oscMoon=()=>{ const eps=speedNow*speedNow/2-MU_M/rr, hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u, h2=hx*hx+hy*hy+hz*hz;
      if (eps>=0) return {rp:Infinity}; const a=-MU_M/(2*eps), e=Math.sqrt(Math.max(0,1+2*eps*h2/(MU_M*MU_M))); return {rp:a*(1-e),ra:a*(1+e)}; };

    if (this.phase==='ret_wait'){
      if (!R.swapped){
        // Se deja la etapa de descenso en la superficie: despega SOLO la etapa de ascenso del modulo lunar (4.547 kg con la tripulacion)
        if (this.app.mission.lmDescent){ if (p.stack.currentIndex===0) p.stack.jettison(); R.swapped=true; R.t0=p.time; }
        else { p.stack=new StageStack(cfg.lmStack); R.swapped=true; R.t0=p.time; }
        // plano de la orbita: contiene el sitio de alunizaje y la direccion a la Tierra (asi la TEI puede salir hacia la Tierra)
        let n=cr3(up,moonEarthDir()); if (Math.hypot(n.x,n.y,n.z)<1e-3) n=cr3(up,nrm({x:0,y:0,z:1})); R.n=nrm(n);
        this._artTelemetry('despegue: etapa de ascenso',{masaKg:+(p.dryMass+p.fuelMass).toFixed(0),propKg:+p.fuelMass.toFixed(0)});
        this.app.toast.show('🚀 Se prepara el despegue: la etapa de ascenso del módulo lunar (el descenso se queda en el Mar de la Tranquilidad).', 7000);
      }
      steerTo(up); controls.throttle=0;
      // Estancia larga (Apolo 11 real: 21 h 36 min en la Luna): reloj acelerado y, en los ultimos 120 s, a x1.
      // El congelado en superficie (sin integrar fuerzas) evita que la nave rebote con el paso grande.
      const tLeft=cfg.waitS-(p.time-R.t0);
      controls.timeScale = (cfg.waitS>3600 && tLeft>300) ? Math.min(3000, tLeft/4) : 1;
      if (p.time-R.t0>=cfg.waitS){
        // La Luna se desplaza ~12 grados en su orbita durante 21,5 h: el plano de salida (sitio + direccion a la Tierra) se recalcula al despegar.
        { let n2=cr3(up,moonEarthDir()); if (Math.hypot(n2.x,n2.y,n2.z)>=1e-3) R.n=nrm(n2); }
        // El CSM (Columbia) espera en orbita circular de orbitAltKm en el plano de la salida, 8 grados por delante del sitio de despegue (~15 grados por delante del LM al insertarse en orbita).
        { const i=DOCKING_TARGETS.findIndex(t=>t.id==='csm'); if (i>=0) DOCKING_TARGETS.splice(i,1);
          const rC=RM+cfg.orbitAltKm*1000, nC=Math.sqrt(MU_M/(rC*rC*rC)), tH0=nrm(cr3(R.n,up));
          DOCKING_TARGETS.push({id:'csm', name:'Columbia (CSM)', parent:'moon', altitude:cfg.orbitAltKm*1000, phase0:(cfg.csmPhaseDeg!==undefined?cfg.csmPhaseDeg:8)*Math.PI/180-nC*p.time, e1:{x:up.x,y:up.y,z:up.z}, e2:tH0}); }
        this.phase='ret_ascent'; this.phaseStart=p.time; R.fuel0=p.fuelMass; R.m0=p.dryMass+p.fuelMass; this.explain('ret_ascent'); }
      return controls;
    }

    if (this.phase==='ret_ascent'){
      const o=oscMoon();
      if (o.rp>=RM+cfg.insertPeriKm*1000){
        R.dvAscent=p.stack.current().isp*9.80665*Math.log(R.m0/(p.dryMass+p.fuelMass));
        this._artTelemetry('insercion en orbita lunar',{perilunaKm:+((o.rp-RM)/1000).toFixed(1),apolunaKm:+((o.ra-RM)/1000).toFixed(1),dvAscensoMs:+R.dvAscent.toFixed(0),propRestanteKg:+p.fuelMass.toFixed(0),velMs:+speedNow.toFixed(0)});
        this.phase='ret_rdv'; this.phaseStart=p.time; controls.throttle=0; controls.timeScale=1; return controls;
      }
      const tAsc=p.time-this.phaseStart, vC=Math.sqrt(MU_M/rr), fracV=Math.min(1,speedNow/vC);
      const tH=nrm(cr3(R.n,up));                                                    // direccion de vuelo (horizontal, en el plano orbital)
      const beta=tAsc<cfg.ascent.tVertical ? 0 : Math.min(1.5,cfg.ascent.k*Math.pow(fracV,cfg.ascent.n));   // angulo desde la vertical
      const dir={x:up.x*Math.cos(beta)+tH.x*Math.sin(beta),y:up.y*Math.cos(beta)+tH.y*Math.sin(beta),z:up.z*Math.cos(beta)+tH.z*Math.sin(beta)};
      steerTo(dir); controls.throttle=1; controls.timeScale=1;
      if (p.fuelMass<=0) return this._artFail('la etapa de ascenso agotó su propelente antes de llegar a órbita lunar.');
      if (tAsc>900) return this._artFail('el ascenso lunar no alcanzó órbita en 15 min.');
      return controls;
    }

    if (this.phase==='ret_rdv'){
      // ENCUENTRO Y ACOPLAMIENTO (declarado: no simulado en detalle). Se coloca la nave en la orbita circular del CSM, en el mismo plano, y se unen.
      const rNew=RM+cfg.orbitAltKm*1000, vC=Math.sqrt(MU_M/rNew), vrad=(p.x*p.u+p.y*p.v+p.z*p.w)/rr;
      let t={x:p.u-vrad*up.x,y:p.v-vrad*up.y,z:p.w-vrad*up.z}; if (Math.hypot(t.x,t.y,t.z)<1) t=cr3(R.n,up); t=nrm(t);
      p.x=up.x*rNew; p.y=up.y*rNew; p.z=up.z*rNew; p.u=t.x*vC; p.v=t.y*vC; p.w=t.z*vC;
      { // el acople simplificado coloca la nave exactamente donde esta el CSM (posicion y velocidad), y el CSM deja de ser un objetivo aparte
        const ci=DOCKING_TARGETS.findIndex(t2=>t2.id==='csm');
        if (ci>=0){ const ts=dockingTargetState(DOCKING_TARGETS[ci], p.time); p.x=ts.pos.x; p.y=ts.pos.y; p.z=ts.pos.z; p.u=ts.vel.x; p.v=ts.vel.y; p.w=ts.vel.z; DOCKING_TARGETS.splice(ci,1); } }
      p.stack=new StageStack(cfg.csmStack);                                           // se descarta el modulo lunar; quedan SM + capsula
      this._artTelemetry('acoplamiento con el CSM y descarte del modulo lunar',{orbitaKm:cfg.orbitAltKm,velMs:+vC.toFixed(0),masaKg:+(p.dryMass+p.fuelMass).toFixed(0)});
      this.app.toast.show('🛰️ Encuentro y acoplamiento con el módulo de mando (simplificado). Se descarta el módulo lunar.', 7000);
      this.phase='ret_orbit'; this.phaseStart=p.time; controls.throttle=0; controls.timeScale=1; return controls;
    }

    if (this.phase==='ret_orbit'){
      // Espera en orbita lunar hasta el punto de la TEI: la quema es PROGRADA en la cara oculta, ~11 grados mas alla del punto opuesto a la Tierra
      const E=moonEarthDir(), Ep=nrm({x:E.x-R.n.x*dot3(R.n,E),y:E.y-R.n.y*dot3(R.n,E),z:E.z-R.n.z*dot3(R.n,E)}), eperp=cr3(R.n,Ep);
      let th=Math.atan2(dot3(up,eperp),dot3(up,Ep)); const TWO=2*Math.PI; th=((th%TWO)+TWO)%TWO;
      const vinf2=2*epsT, ecc=1+rr*vinf2/MU_M, thInf=Math.acos(-1/ecc);
      const thStart=(((TWO-thInf)-cfg.teiHalfArcDeg*Math.PI/180)%TWO+TWO)%TWO;
      const dTh=(((thStart-th)%TWO)+TWO)%TWO, omega=speedNow/rr, rem=dTh/omega;
      const WIN=150; controls.throttle=0;
      if (R.tIgn==null && rem>WIN+0.05){ controls.timeScale=Math.min(2000,Math.max(0.1,(rem-WIN)*60)); return controls; }
      // En la ventana final se fija el INSTANTE de ignicion en el reloj (como en Artemis II): comparar angulos fotograma a fotograma fallaba
      // por rozar el limite y esperaba una orbita entera (~1,8 h) de mas.
      if (R.tIgn==null) R.tIgn=p.time+rem;
      const remC=R.tIgn-p.time;
      steerTo(nrm({x:p.u,y:p.v,z:p.w}));
      if (remC<=1e-6){
        this._artTelemetry('ignicion TEI',{anguloDesdeTierraDeg:+(th*180/Math.PI).toFixed(2),excesoHiperbolicoMs:+Math.sqrt(vinf2).toFixed(0),excentricidad:+ecc.toFixed(4)});
        this.phase='ret_tei'; this.phaseStart=p.time; R.m1=p.dryMass+p.fuelMass; R.f1=p.fuelMass; this.explain('ret_tei'); return this._returnStep(p,preState,speedNow,controls);
      }
      controls.timeScale=Math.min(1,remC*60); return controls;
    }

    if (this.phase==='ret_tei'){
      steerTo(nrm({x:p.u,y:p.v,z:p.w}));
      const eps=speedNow*speedNow/2-MU_M/rr;
      if (eps>=epsT-0.05){
        R.dvTei=p.stack.current().isp*9.80665*Math.log(R.m1/(p.dryMass+p.fuelMass));
        this._artTelemetry('corte TEI',{quemaS:+(p.time-this.phaseStart).toFixed(1),dvTeiMs:+R.dvTei.toFixed(0),propUsadoKg:+(R.f1-p.fuelMass).toFixed(0),propRestanteKg:+p.fuelMass.toFixed(0)});
        this.phase='ret_coast_moon'; this.phaseStart=p.time; this.explain('ret_coast_moon'); controls.throttle=0; controls.timeScale=1; return controls;
      }
      const thr=p.stack.effectiveThrustAt(1,p.time).thrust, m=p.dryMass+p.fuelMass, need=(epsT-eps)/((thr/m)*speedNow);
      controls.throttle=1; controls.timeScale=Math.min(1,Math.max(need*60,1e-4));
      if (p.fuelMass<=0 || p.time-this.phaseStart>cfg.maxBurnS) return this._artFail('la quema de inyección trans-Tierra no alcanzó la energía de escape.');
      return controls;
    }

    if (this.phase==='ret_coast_moon'){
      controls.throttle=0;
      const alt=preState.altitude; controls.timeScale = alt<300e3 ? 60 : (alt<5e6 ? 600 : 3000);
      if (preState.body==='earth'){ this.phase='ret_coast_earth'; this.phaseStart=p.time; R.lastCorr=-1e18; R.corrN=0; this.explain('ret_coast_earth'); controls.timeScale=1; return controls; }
      if (p.time-this.phaseStart>20*86400) return this._artFail('la nave no sale de la esfera de la Luna.');
      return controls;
    }

    if (this.phase==='ret_coast_earth'){
      controls.throttle=0;
      const dist=rr;
      if (p.time-R.lastCorr>6*3600){
        R.lastCorr=p.time; R.corrN++;
        const rp=RE+cfg.targetPerigeeKm*1000, eps=speedNow*speedNow/2-MU_E/dist, vp2=2*(eps+MU_E/rp);
        if (vp2>0){
          const h=rp*Math.sqrt(vp2), vt=h/dist, vr2=2*(eps+MU_E/dist)-vt*vt;
          if (vr2>=0){
            const vrad=(p.x*p.u+p.y*p.v+p.z*p.w)/dist;
            let t={x:p.u-vrad*up.x,y:p.v-vrad*up.y,z:p.w-vrad*up.z}; let tm=Math.hypot(t.x,t.y,t.z);
            if (tm<1e-3){ t=nrm({x:up.y,y:-up.x,z:0}); tm=1; } else t={x:t.x/tm,y:t.y/tm,z:t.z/tm};
            const vin=-Math.sqrt(vr2), vd={x:vin*up.x+vt*t.x,y:vin*up.y+vt*t.y,z:vin*up.z+vt*t.z};
            let dv={x:vd.x-p.u,y:vd.y-p.v,z:vd.z-p.w}; const dm=Math.hypot(dv.x,dv.y,dv.z), cap=cfg.maxDv;
            if (dm>cap){ const k=cap/dm; dv={x:dv.x*k,y:dv.y*k,z:dv.z*k}; }
            p.u+=dv.x; p.v+=dv.y; p.w+=dv.z;
            const dvUsed=Math.min(dm,cap), m0=p.dryMass+p.fuelMass, isp=p.stack.current().isp||314;
            if (p.fuelMass>0){ const burned=m0*(1-Math.exp(-dvUsed/(isp*9.80665))); p.fuelMass=Math.max(0,p.fuelMass-burned); }
            this._artTelemetry('correccion '+R.corrN,{dvMs:+dvUsed.toFixed(1),propRestanteKg:+p.fuelMass.toFixed(0),perigeoObjetivoKm:cfg.targetPerigeeKm,distTierraKm:+(dist/1e3).toFixed(0)});
            if (dm>cap*1.0001 && R.corrN>12) return this._artFail('no se logra fijar el perigeo de reentrada con las correcciones disponibles.');
          }
        }
      }
      controls.timeScale=artemisCruiseTimeScale('earth',dist);
      if (preState.altitude<ARTEMIS_EI_ALT){ this.phase='ret_entry'; this.phaseStart=p.time; R.maxG=0; R.vPrev=null; R.esmOff=false; this.explain('ret_entry'); controls.timeScale=1; return controls; }
      if (p.time-this.phaseStart>20*86400) return this._artFail('el regreso tardó más de 20 días.');
      return controls;
    }

    if (this.phase==='ret_entry'){
      if (!R.esmOff){
        const rv=(p.x*p.u+p.y*p.v+p.z*p.w)/rr, g=Math.asin(rv/speedNow)*180/Math.PI;
        p.stack.jettison(); R.esmOff=true; this._artTelemetry('separacion SM',{masaKg:+(p.dryMass+p.fuelMass).toFixed(0),gammaDeg:+g.toFixed(2),velKms:+(speedNow/1000).toFixed(3)});
      }
      const dirR=nrm({x:-p.u,y:-p.v,z:-p.w}); steerTo(dirR);
      controls.timeScale = preState.altitude>125000 ? 200 : (preState.altitude>30000 ? 5 : 2);
      if (R.vPrev!=null && R.lastTs){ const g=Math.abs(speedNow-R.vPrev)/(R.lastTs/60)/9.81; if (g>R.maxG && g<40) R.maxG=g; }
      R.vPrev=speedNow; R.lastTs=controls.timeScale;
      if (preState.altitude<=7600){ this._artTelemetry('paracaidas',{altKm:+(preState.altitude/1000).toFixed(2),velMs:+speedNow.toFixed(1),picoG:+R.maxG.toFixed(1)}); this.phase='ret_chute'; this.phaseStart=p.time; this.explain('ret_chute'); }
      return controls;
    }
    if (this.phase==='ret_chute'){
      controls.throttle=0; controls.timeScale=30;
      const k=Math.pow(0.15, controls.timeScale/60); p.u*=k; p.v*=k; p.w*=k;
      if (preState.altitude<=0){
        p.u=0;p.v=0;p.w=0; this._artTelemetry('amerizaje',{velMs:0});
        this.phase='ret_done'; this.active=false; this._zeroControls(); this.explain('ret_done');
        this.app.toast.show('🌊 Apolo 11 amerizó en el Pacífico. ¡Misión cumplida: de la Tierra a la Luna y de vuelta!', 9000);
      }
      return controls;
    }
    return controls;
  }
  // Regreso manual: si alunizas a mano, este metodo lanza solo el regreso (estancia -> despegue -> ... -> amerizaje)
  startReturn(){
    this.active=true; this.paused=false; this.speed=1; this._ret=null; this.failed=null; this.telemetry=this.telemetry||[];
    this.phase='ret_wait'; this.phaseStart=this.app.physics.time; this.lastExplainPhase=null;
  }
  // Devuelve el objeto de controles a aplicar este fotograma, o null si el piloto no esta activo.
  step(){
    if (!this.active) return null;
    const p = this.app.physics;
    if (p.stack.justSeparated){
      this.app.toast.show('💥 Separación de etapa: '+p.stack.justSeparated+' descartada.', 4000);
      p.stack.justSeparated=null;
    }
    const preState = p.getState();
    const speedNow = Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w);
    const controls = {throttle:0,pitch:0,yaw:0,roll:0,hyperspace:false,warp:false,timeScale:1};

    if (this.phase && this.phase.startsWith('art_')) return this._artemisStep(p, preState, speedNow, controls);
    if (this.phase && this.phase.startsWith('ret_')) return this._returnStep(p, preState, speedNow, controls);

    // ---- MISION ISS: mismo ascenso probado de Gagarin, apuntando a la altitud real
    // de la ISS (408km) en vez de una orbita baja cualquiera. Sin acoplamiento --
    // la misión termina al alcanzar una órbita real cerca de la ISS.
    if (this.phase==='iss_ascent'){
      this.explain('iss_ascent');
      const tAsc = p.time - this.phaseStart;
      let dir;
      const prof = this.app.mission && this.app.mission.rocket==='saturn' ? this.app.mission.ascentProfile : null;
      if (prof){
        // Saturno V (3 etapas): el perfil por reloj de la Soyuz (0.02*(t-8), 83 grados a los
        // 80 s) lo deja volando casi horizontal a baja altura con las etapas 1-2 todavia
        // encendidas y nunca supera 80 km -> se queda sin combustible. Aqui el giro depende
        // de la fraccion de velocidad orbital alcanzada (mismo enfoque que el Shuttle), y
        // con el S-IVB (ultima etapa) la orientacion es PROGRADA, como la quema de
        // circularizacion real. Coeficientes buscados para ESTE physicsStack concreto.
        const rA=Math.hypot(p.x,p.y,p.z), vO=Math.sqrt(G*SOLAR_BODIES.earth.mass/rA);
        if (tAsc<prof.tVertical) dir = FRAME_ROTATION({x:0,y:1,z:0});
        else if (p.stack.currentIndex===p.stack.stages.length-1 && speedNow>0.5) dir = norm3({x:p.u,y:p.v,z:p.w});
        else { const fracV=Math.min(1,speedNow/vO); const angle=Math.min(1.45,prof.k*Math.pow(fracV,prof.n)); dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0)); }
      } else if (tAsc<8) dir = FRAME_ROTATION({x:0,y:1,z:0});
      else { const angle=Math.min(1.45,0.02*(tAsc-8)); dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0)); }
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=1; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), vCirc=Math.sqrt(G*SOLAR_BODIES.earth.mass/rMag);
      // Corte dirigido a la ISS: se apaga el motor cuando el APOGEO alcanza ~408 km (antes se
      // seguia hasta velocidad orbital y el apogeo acababa en 1300-2900 km; despues el fasing
      // teletransportaba la nave a 408 km, un salto visible). Luego coast al apogeo + circularizacion.
      {
        const muA=G*SOLAR_BODIES.earth.mass;
        const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
        const ex=(p.v*hz-p.w*hy)/muA-p.x/rMag, ey=(p.w*hx-p.u*hz)/muA-p.y/rMag, ez=(p.u*hy-p.v*hx)/muA-p.z/rMag;
        const eA=Math.sqrt(ex*ex+ey*ey+ez*ez), aA=1/(2/rMag-speedNow*speedNow/muA);
        const apoAlt=(isFinite(aA)&&aA>0) ? aA*(1+eA)-SOLAR_BODIES.earth.radius : 1e12;
        if (preState.altitude>80000 && (apoAlt>=408000 || speedNow>=vCirc*1.02)){
          this.phase='iss_coast_apo'; this.phaseStart=p.time; this.explain('iss_coast_apo'); controls.throttle=0;
          this.app.toast.show('🚀 Corte de motor — apogeo '+(Math.min(apoAlt,9e9)/1000).toFixed(0)+' km. Coast hasta el apogeo.', 5000);
          return controls;
        }
      }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible antes de alcanzar la órbita.'); return null; }
      return controls;
    }

    if (this.phase==='iss_coast_apo'){
      this.explain('iss_coast_apo');
      controls.throttle=0; controls.timeScale=20;
      if (speedNow>0.5){ const st=p.autopilotSteer(norm3({x:p.u,y:p.v,z:p.w})); controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; } // llegar al apogeo ya apuntando en prograde
      const rHat=norm3({x:p.x,y:p.y,z:p.z});
      const vRad=p.u*rHat.x+p.v*rHat.y+p.w*rHat.z;
      // Se empieza la quema ANTES del apogeo, centrandola en el: vRad <= aRad*tQuema/2 con
      // tQuema = dV/aceleracion. Asi la orbita final sale casi circular a ~408 km en cualquier cohete.
      let vRadStart = 0;
      {
        const rM=Math.hypot(p.x,p.y,p.z), sp=Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w), mu=G*SOLAR_BODIES.earth.mass;
        const thr=p.stack.effectiveThrustAt(1,p.time).thrust, mass=p.dryMass+p.fuelMass;
        const dV=Math.max(0,Math.sqrt(mu/rM)-sp), acc=thr>0 ? thr/mass : 0;
        const aRad=Math.max(0,mu/(rM*rM)-sp*sp/rM);
        if (acc>0) vRadStart=aRad*(dV/acc)/2;
      }
      if (vRad<=vRadStart){ this._circBurning=false; this.phase='iss_circularize'; this.phaseStart=p.time; this.explain('iss_circularize'); }
      return controls;
    }

    if (this.phase==='iss_circularize'){
      this.explain('iss_circularize');
      const dir = speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), vCirc=Math.sqrt(G*SOLAR_BODIES.earth.mass/rMag);
      // Solo se enciende con la nave ya apuntando en prograde (si no, el empuje sale en otra direccion
      // y la orbita queda excentrica: antes 351x729 km con la Soyuz).
      const aligned = Math.abs(steer.pitch)<0.15 && Math.abs(steer.yaw)<0.15 && Math.abs(p.pitchRate)<0.05 && Math.abs(p.yawRate)<0.05;
      controls.throttle = (speedNow<vCirc && (aligned || this._circBurning)) ? 1 : 0;
      if (controls.throttle>0) this._circBurning=true;
      const mu=G*SOLAR_BODIES.earth.mass;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
      const vxh_x=p.v*hz-p.w*hy, vxh_y=p.w*hx-p.u*hz, vxh_z=p.u*hy-p.v*hx;
      const ex=vxh_x/mu-p.x/rMag, ey=vxh_y/mu-p.y/rMag, ez=vxh_z/mu-p.z/rMag;
      const eMag=Math.sqrt(ex*ex+ey*ey+ez*ez);
      const a=1/(2/rMag-speedNow*speedNow/mu);
      const r_p = (isFinite(a)&&a>0) ? a*(1-eMag) : -1;
      // El Shuttle llega aqui con el OMS ya agotado dentro de 'ascent' (perigeo real
      // +90km, verificado estable 6h) -- muy por debajo de los 346.8km que exige la Soyuz
      // (que SI tiene combustible de sobra para casi alcanzar los 408km reales antes de
      // esta fase). iss_orbit hace un teletransporte instantaneo a 100m de la ISS real sin
      // importar la orbita previa (mismo patron ya aceptado para la Soyuz), asi que al
      // Shuttle le basta con una orbita estable propia, no con acercarse a 408km reales.
      // Bug real corregido: sin este umbral mas bajo, el Shuttle llegaba sin combustible y
      // nunca alcanzaba 346.8km, terminando en "Sin combustible durante la circularizacion".
      const isShuttleCirc = this.app.mission && this.app.mission.type === 'shuttle';
      const perigeeThreshold = isShuttleCirc ? 395000 : 346800; // 85% de 408km para el resto
      // Bug real corregido (afecta a cualquier mision, no solo al Shuttle): antes, al
      // transicionar a iss_orbit aqui, el codigo seguia evaluando las comprobaciones de
      // fallo de ABAJO en el MISMO fotograma -- con la Soyuz nunca se notaba porque su
      // combustible de sobra nunca llegaba a 0% justo al alcanzar el umbral de perigeo,
      // pero con el Shuttle (combustible agotado desde el principio de esta fase) ambas
      // condiciones se cumplian a la vez, y "sin combustible" cancelaba la transicion ya
      // hecha un instante antes. return inmediato evita que esto vuelva a pasar.
      if (r_p>0 && (r_p-SOLAR_BODIES.earth.radius)>perigeeThreshold){
        this.phase='iss_orbit'; this.phaseStart=p.time; this.explain('iss_orbit');
        this.app.toast.show('🛰️ Órbita real alcanzada cerca de la ISS — perigeo '+((r_p-SOLAR_BODIES.earth.radius)/1000).toFixed(0)+'km', 6000);
        return controls;
      }
      if (speedNow>=vCirc*1.06){ this.stop('⚠️ Circularización fallida — velocidad excesiva.'); return null; }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la circularización.'); return null; }
      return controls;
    }

    if (this.phase==='iss_orbit'){
      this.explain('iss_orbit');
      // Fasing simplificado (una unica vez, al entrar aqui): reposicionar la nave
      // junto a la posicion REAL de la ISS ahora mismo, con velocidad relativa
      // nula, en vez de solo esperar en una orbita del mismo tipo (altitud e
      // inclinacion coinciden, pero la fase orbital no -- sin esto la nave podia
      // quedar a cientos o miles de km de la ISS real, sin ningun mecanismo que
      // los acercara). Mismo patron ya aceptado en el proyecto (correcciones
      // instantaneas de rumbo en Apolo, sin gastar combustible). 100m de
      // distancia inicial y velocidad relativa 0 es exactamente el escenario ya
      // validado end-to-end del Asistente CW (docking_autopilot.js).
      const t = p.time;
      const earthPos = positionOf('earth', t);
      const issHelio = orbitalObjectPosition(ISS, t);
      const issPos = { x: issHelio.x-earthPos.x, y: issHelio.y-earthPos.y, z: issHelio.z-earthPos.z };
      const issVel = orbitalObjectVelocity(ISS, t);
      const rMag = Math.hypot(issPos.x, issPos.y, issPos.z);
      const radialDir = { x: issPos.x/rMag, y: issPos.y/rMag, z: issPos.z/rMag };
      p.x = issPos.x - radialDir.x*100; p.y = issPos.y - radialDir.y*100; p.z = issPos.z - radialDir.z*100;
      p.u = issVel.x; p.v = issVel.y; p.w = issVel.z;
      // Shuttle: llega aqui con el OMS casi vacio (lo gasta en el ascenso). Se repone el
      // propelente de reserva del Orbiter, una sola vez, para que el acople automatico
      // pueda frenar. Mismo tipo de simplificacion que el fasing instantaneo.
      let shuttleRefueled = false;
      if (this.app.mission && this.app.mission.type==='shuttle' && !this._shuttleRefueled){
        this._shuttleRefueled = true;
        shuttleRefueled = p.refuel();
      }
      this.phase='done'; this.explain('done'); this.active=false; this._zeroControls();
      this.app.toast.show(shuttleRefueled
        ? '🛰️ Fasing completado — la ISS está a 100 m. OMS repostado con el propelente de reserva. ¡Usa el Acople automático!'
        : '🛰️ Fasing completado — la ISS está a solo 100 m. ¡Usa el Acople automático para acercarte!', 8000);
      controls.throttle=0; controls.pitch=0; controls.yaw=0; controls.roll=0; controls.timeScale=1;
      return controls;
    }

    // ---- MISION GAGARIN (Vostok 1): ascenso -> coast a apoastro -> circularizacion real ----
    // -> una vuelta orbital -> retrofrenado -> reentrada (la resistencia atmosferica ya
    // existente hace de escudo termico) -> paracaidas -> aterrizaje. Probado de extremo a
    // extremo en Node antes de escribir esto (perigeo real positivo confirmado, no solo calculado).
    if (this.phase==='gagarin_ascent'){
      this.explain('gagarin_ascent');
      const tAsc = p.time - this.phaseStart;
      let dir;
      if (tAsc<8) dir = FRAME_ROTATION({x:0,y:1,z:0});
      else { const angle=Math.min(1.45,0.02*(tAsc-8)); dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0)); }
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=1; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), vCirc=Math.sqrt(G*SOLAR_BODIES.earth.mass/rMag);
      if (speedNow>=vCirc*1.02 && preState.altitude>80000){
        this.phase='gagarin_coast_apo'; this.phaseStart=p.time; this.explain('gagarin_coast_apo');
      }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible antes de alcanzar la órbita.'); return null; }
      return controls;
    }

    if (this.phase==='gagarin_coast_apo'){
      this.explain('gagarin_coast_apo');
      controls.throttle=0; controls.timeScale=20;
      const rHat=norm3({x:p.x,y:p.y,z:p.z});
      const vRad=p.u*rHat.x+p.v*rHat.y+p.w*rHat.z;
      if (vRad<=0){ this.phase='gagarin_circularize'; this.phaseStart=p.time; this.explain('gagarin_circularize'); }
      return controls;
    }

    if (this.phase==='gagarin_circularize'){
      this.explain('gagarin_circularize');
      const dir = speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), vCirc=Math.sqrt(G*SOLAR_BODIES.earth.mass/rMag);
      controls.throttle = speedNow<vCirc ? 1 : 0;
      // Perigeo real (no una foto instantanea de "inOrbit"): calculado con los elementos orbitales
      const mu=G*SOLAR_BODIES.earth.mass;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
      const vxh_x=p.v*hz-p.w*hy, vxh_y=p.w*hx-p.u*hz, vxh_z=p.u*hy-p.v*hx;
      const ex=vxh_x/mu-p.x/rMag, ey=vxh_y/mu-p.y/rMag, ez=vxh_z/mu-p.z/rMag;
      const eMag=Math.sqrt(ex*ex+ey*ey+ez*ez);
      const a=1/(2/rMag-speedNow*speedNow/mu);
      const r_p = (isFinite(a)&&a>0) ? a*(1-eMag) : -1;
      if (r_p>0 && (r_p-SOLAR_BODIES.earth.radius)>140000){
        this.phase='gagarin_orbit'; this.phaseStart=p.time; this.explain('gagarin_orbit');
        this.app.toast.show('🛰️ Órbita real alcanzada — perigeo '+((r_p-SOLAR_BODIES.earth.radius)/1000).toFixed(0)+'km', 6000);
      }
      if (speedNow>=vCirc*1.06){ this.stop('⚠️ Circularización fallida — velocidad excesiva.'); return null; }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la circularización.'); return null; }
      return controls;
    }

    if (this.phase==='gagarin_orbit'){
      this.explain('gagarin_orbit');
      const dir = norm3({x:p.u,y:p.v,z:p.w});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=0; controls.timeScale=200;
      // Una vuelta real (el periodo depende de la orbita conseguida; 108 min de la mision real
      // de Gagarin de polo a polo, aqui se deja correr un tiempo generoso y fijo en su lugar)
      if (p.time-this.phaseStart>6000){
        this.phase='gagarin_retro'; this.phaseStart=p.time; this.explain('gagarin_retro');
      }
      return controls;
    }

    if (this.phase==='gagarin_retro'){
      this.explain('gagarin_retro');
      const dir = norm3({x:-p.u,y:-p.v,z:-p.w});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=0.35; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z);
      const mu=G*SOLAR_BODIES.earth.mass;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
      const vxh_x=p.v*hz-p.w*hy, vxh_y=p.w*hx-p.u*hz, vxh_z=p.u*hy-p.v*hx;
      const ex=vxh_x/mu-p.x/rMag, ey=vxh_y/mu-p.y/rMag, ez=vxh_z/mu-p.z/rMag;
      const eMag=Math.sqrt(ex*ex+ey*ey+ez*ez);
      const a=1/(2/rMag-speedNow*speedNow/mu);
      const r_p = (isFinite(a)&&a>0) ? a*(1-eMag) : -1;
      if ((r_p>0 && (r_p-SOLAR_BODIES.earth.radius)<50000) || (p.time-this.phaseStart)>50){
        this.phase='gagarin_descent'; this.phaseStart=p.time; this.explain('gagarin_descent');
        this.app.toast.show('🔥 Retrocohetes encendidos — reentrada en curso.', 6000);
      }
      return controls;
    }

    if (this.phase==='gagarin_descent'){
      this.explain('gagarin_descent');
      controls.throttle=0; controls.timeScale = preState.altitude>7000 ? 5 : 1;
      if (preState.altitude<=7000 && preState.altitude>0){
        this.phase='gagarin_parachute'; this.phaseStart=p.time; this.explain('gagarin_parachute');
        this.app.toast.show('🪂 Paracaídas desplegado a 7km de altitud.', 6000);
      }
      return controls;
    }

    if (this.phase==='gagarin_parachute'){
      this.explain('gagarin_parachute');
      controls.throttle=0; controls.timeScale=1;
      // Frenada del paracaidas: ayuda simplificada (decaimiento exponencial de la velocidad
      // vertical), igual de declarada que el freno horizontal del descenso lunar del Apolo.
      const decay = Math.pow(0.15, 1/60);
      p.u*=decay; p.v*=decay; p.w*=decay;
      if (preState.altitude<=0){
        this.phase='done'; this.explain('done'); this.active=false; this._zeroControls();
        p.u=0; p.v=0; p.w=0; // misma parada real que en Apolo
        this.app.toast.show('🎉 "¡Poyejali!" — Gagarin aterriza sano y salvo cerca de Smelovka.', 8000);
      }
      return controls;
    }

    if (this.phase==='ascent'){
      this.explain('ascent');
      const tAsc = p.time - this.phaseStart;
      // Deteccion Shuttle: su perfil de ascenso necesita una rama propia porque el perfil
      // estandar (por reloj) satura a 83 grados demasiado pronto para su relacion
      // empuje/peso (TWR 1.58 inicial, pero cae al apagarse los SRB). Y la fase OMS
      // requiere orientacion prograda en vez de giro angular.
      const isShuttle = this.app.mission && this.app.mission.type === 'shuttle'; // mismo patron que isGagarin/isIss en start()/explain()
      let dir;
      if (isShuttle && p.stack.currentIndex === 2){
        // ---- Shuttle, fase OMS (etapa 3): orientacion PROGRADA ----
        // La quema de circularizacion real (OMS-2) apunta al vector velocidad, no sigue
        // un perfil angular de ascenso. Sin esto, el perigeo queda bajo tierra por mucho
        // que se alargue el ascenso (verificado en arnes).
        const speedNow = Math.sqrt(p.u*p.u + p.v*p.v + p.w*p.w);
        if (speedNow > 0.5){
          dir = { x: p.u/speedNow, y: p.v/speedNow, z: p.w/speedNow };
        } else {
          dir = FRAME_ROTATION({x:0,y:1,z:0});
        }
      } else if (isShuttle){
        // ---- Shuttle, etapas 1 y 2 (SRB+SSME / SSME solo): perfil por fracV ----
        // El perfil de reloj del resto de misiones (0.02*(t-8)) esta calibrado para naves
        // que ganan velocidad vertical suficiente en los primeros 80s. Con el Shuttle la
        // velocidad se gana mucho mas despacio al inicio, asi que el giro se basa en la
        // fraccion de velocidad orbital ya alcanzada, no en el tiempo transcurrido.
        // Exponente 0.7 y coeficiente 2.78: valores encontrados por busqueda parametrica
        // para ESTE physicsStack concreto (perigeo final +103km, verificado 6h de coast).
        // No es un valor universal -- si el physicsStack del Shuttle cambia (masas, Isp),
        // el coeficiente 2.78 puede necesitar recalibrarse.
        const rActual = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
        const speedNow = Math.sqrt(p.u*p.u + p.v*p.v + p.w*p.w);
        const vOrbital = Math.sqrt(G * SOLAR_BODIES.earth.mass / rActual);
        const fracV = Math.min(1, speedNow / vOrbital);
        const angle = Math.min(1.45, 2.78 * Math.pow(fracV, 0.7));
        dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0));
      } else {
        // ---- Resto (Apolo, ISS, Gagarin, sandbox): perfil por reloj (el actual, intacto) ----
        if (tAsc<8) dir = FRAME_ROTATION({x:0,y:1,z:0});
        else { const angle=Math.min(1.45,0.02*(tAsc-8)); dir = FRAME_ROTATION(RocketPhysics.rotateVec(0,1,0,angle,LAUNCH_YAW_EAST,0)); }
      }
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=1; controls.timeScale=1;
      // El Shuttle puede cumplir inOrbit de forma MARGINAL durante la etapa 2 (SSME solo),
      // mucho antes de que el OMS tenga oportunidad de circularizar -- verificado en pruebas:
      // perigeo de -2700km en ese momento, reentraria. Para el resto de misiones (una o dos
      // etapas, sin una fase de circularizacion separada) inOrbit marginal SI es el criterio
      // correcto de salida, como siempre. El Shuttle solo debe salir de ascent cuando la
      // etapa OMS (currentIndex===2) confirme la orbita, o se quede sin combustible en ella.
      if (isShuttle){
        // inOrbit puede cumplirse de forma marginal EN CUALQUIER PUNTO de la quema OMS, no
        // solo al final -- verificado en pruebas: salir ahi deja un perigeo de -14km (muy
        // cerca, pero reentra). El OMS necesita agotar TODO su combustible para que la
        // circularizacion progrado real surta efecto (asi se calibro: perigeo +103km,
        // estable 6h, cuando el OMS quema hasta el final sin cortar antes).
        // Salida hacia la ruta de la ISS (iss_coast_apo -> iss_circularize -> iss_orbit),
        // NO hacia coast_leo/tli_burn (esa es la ruta de Apolo, hacia la Luna). Bug real:
        // antes de este cambio, el Shuttle llegaba a inOrbit/se quedaba sin combustible en
        // el OMS y pasaba a coast_leo igual que Apolo, intentando despues una quema
        // translunar imposible con los 10t de OMS -- "sube y sube hasta quedarse sin
        // combustible" (confirmado por Luis, reproducido en el arnes).
        // Corte por PERIGEO REAL (no por agotar el OMS): con el criterio anterior el Shuttle
        // dependia de que los 10 t de OMS dieran justo un perigeo >70 km, y el resultado
        // cambiaba con la fecha de inicio de la simulacion (esperar unos minutos en la
        // plataforma antes de pulsar el piloto automatico lo dejaba sin combustible en la
        // circularizacion -- bug real reproducido en el arnes). Se corta el OMS en cuanto el
        // perigeo supera 100 km; el propelente sobrante queda para el acople automatico.
        // MECO dirigido a la ISS: el SSME se corta cuando el APOGEO alcanza ~408 km (no cuando
        // la velocidad es orbital, que dejaba apogeos de 2000-2900 km). Se descarta el
        // tanque/etapa, se hace coast hasta el apogeo y el OMS circulariza alli (~100 m/s).
        if (p.stack.currentIndex===1){
          const muM=G*SOLAR_BODIES.earth.mass, rM=Math.hypot(p.x,p.y,p.z);
          const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
          const ex=(p.v*hz-p.w*hy)/muM-p.x/rM, ey=(p.w*hx-p.u*hz)/muM-p.y/rM, ez=(p.u*hy-p.v*hx)/muM-p.z/rM;
          const eM=Math.sqrt(ex*ex+ey*ey+ez*ez), aM=1/(2/rM-(p.u*p.u+p.v*p.v+p.w*p.w)/muM);
          const apoAlt=(isFinite(aM)&&aM>0) ? aM*(1+eM)-SOLAR_BODIES.earth.radius : 1e12;
          const apoTarget=((this.app.mission&&this.app.mission.shuttleApoKm)||408)*1000;
          if (apoAlt>=apoTarget && preState.altitude>90000){
            p.stack.jettison(); this.app.toast.show('🚀 MECO — apogeo '+(apoAlt/1000).toFixed(0)+' km. Coast hasta el apogeo.', 5000);
            this.phase='iss_coast_apo'; this.phaseStart=p.time; this.explain('iss_coast_apo'); controls.throttle=0; return controls;
          }
        }
        if (p.stack.currentIndex===2){
          const muE=G*SOLAR_BODIES.earth.mass, rM=Math.hypot(p.x,p.y,p.z);
          const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
          const ex=(p.v*hz-p.w*hy)/muE-p.x/rM, ey=(p.w*hx-p.u*hz)/muE-p.y/rM, ez=(p.u*hy-p.v*hx)/muE-p.z/rM;
          const eM=Math.sqrt(ex*ex+ey*ey+ez*ez), aSM=1/(2/rM-(p.u*p.u+p.v*p.v+p.w*p.w)/muE);
          const periAlt=(isFinite(aSM)&&aSM>0) ? aSM*(1-eM)-SOLAR_BODIES.earth.radius : -1e9;
          if (periAlt>100000){ this.phase='iss_coast_apo'; this.phaseStart=p.time; this.explain('iss_coast_apo'); return controls; }
        }
        if (p.stack.currentIndex===2 && preState.fuelPercent<=0){
          if (preState.inOrbit){ this.phase='iss_coast_apo'; this.phaseStart=p.time; this.explain('iss_coast_apo'); }
          else { this.stop('⚠️ Sin combustible antes de alcanzar órbita.'); return null; }
        }
      } else {
        const PK=this.app.mission && this.app.mission.parking;
        if (PK){
          // Orbita de aparcamiento real (opt-in): corte cuando el apogeo llega a PK.altKm, coast al apogeo y circularizacion.
          const muA=G*SOLAR_BODIES.earth.mass, rA=Math.hypot(p.x,p.y,p.z);
          const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
          const ex=(p.v*hz-p.w*hy)/muA-p.x/rA, ey=(p.w*hx-p.u*hz)/muA-p.y/rA, ez=(p.u*hy-p.v*hx)/muA-p.z/rA;
          const eA=Math.sqrt(ex*ex+ey*ey+ez*ez), aA=1/(2/rA-speedNow*speedNow/muA);
          const apoAlt=(isFinite(aA)&&aA>0) ? aA*(1+eA)-SOLAR_BODIES.earth.radius : 1e12;
          if (preState.altitude>80000 && apoAlt>=PK.altKm*1000){
            this.phase='park_coast'; this.phaseStart=p.time; this.explain('park_coast'); controls.throttle=0;
            this.app.toast.show('🚀 Corte de motor — apogeo '+(apoAlt/1000).toFixed(0)+' km. Coast hasta el apogeo.', 5000);
            return controls;
          }
        } else
        if (preState.inOrbit){ this.phase='coast_leo'; this.phaseStart=p.time; this.explain('coast_leo'); }
        if (preState.fuelPercent<=0 && !preState.inOrbit){ this.stop('⚠️ Sin combustible antes de alcanzar órbita.'); return null; }
      }
      return controls;
    }

    if (this.phase==='park_coast'){
      this.explain('park_coast');
      controls.throttle=0; controls.timeScale=20;
      if (speedNow>0.5){ const st=p.autopilotSteer(norm3({x:p.u,y:p.v,z:p.w})); controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; }
      const rHat=norm3({x:p.x,y:p.y,z:p.z}), vRad=p.u*rHat.x+p.v*rHat.y+p.w*rHat.z;
      // la quema se centra en el apogeo (misma regla que las misiones ISS)
      let vRadStart=0;
      { const rM=Math.hypot(p.x,p.y,p.z), mu=G*SOLAR_BODIES.earth.mass, thr=p.stack.effectiveThrustAt(1,p.time).thrust, mass=p.dryMass+p.fuelMass;
        const dV=Math.max(0,Math.sqrt(mu/rM)-speedNow), acc=thr>0?thr/mass:0, aRad=Math.max(0,mu/(rM*rM)-speedNow*speedNow/rM);
        if (acc>0) vRadStart=aRad*(dV/acc)/2; }
      if (vRad<=vRadStart){ this._circBurning=false; this.phase='park_circ'; this.phaseStart=p.time; this.explain('park_circ'); }
      if (p.fuelMass<=0) { this.stop('⚠️ Sin combustible antes de la órbita de aparcamiento.'); return null; }
      return controls;
    }

    if (this.phase==='park_circ'){
      this.explain('park_circ');
      const st=p.autopilotSteer(speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0}));
      controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; controls.timeScale=1;
      const rMag=Math.hypot(p.x,p.y,p.z), mu=G*SOLAR_BODIES.earth.mass, vCirc=Math.sqrt(mu/rMag);
      const aligned=Math.abs(st.pitch)<0.15 && Math.abs(st.yaw)<0.15 && Math.abs(p.pitchRate)<0.05 && Math.abs(p.yawRate)<0.05;
      controls.throttle=(speedNow<vCirc && (aligned||this._circBurning)) ? 1 : 0;
      if (controls.throttle>0) this._circBurning=true;
      const hx=p.y*p.w-p.z*p.v, hy=p.z*p.u-p.x*p.w, hz=p.x*p.v-p.y*p.u;
      const ex=(p.v*hz-p.w*hy)/mu-p.x/rMag, ey=(p.w*hx-p.u*hz)/mu-p.y/rMag, ez=(p.u*hy-p.v*hx)/mu-p.z/rMag;
      const eMag=Math.sqrt(ex*ex+ey*ey+ez*ez), a=1/(2/rMag-speedNow*speedNow/mu);
      const periAlt=(isFinite(a)&&a>0) ? a*(1-eMag)-SOLAR_BODIES.earth.radius : -1e9;
      const PK=this.app.mission.parking;
      if (periAlt>(PK.altKm-25)*1000){
        this.phase='coast_leo'; this.phaseStart=p.time; this.explain('coast_leo');
        this.app.toast.show('🛰️ Órbita de aparcamiento '+(periAlt/1000).toFixed(0)+' × '+((a*(1+eMag)-SOLAR_BODIES.earth.radius)/1000).toFixed(0)+' km', 6000);
        return controls;
      }
      if (speedNow>=vCirc*1.06){ this.stop('⚠️ Circularización fallida — velocidad excesiva.'); return null; }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la circularización.'); return null; }
      return controls;
    }

    if (this.phase==='coast_leo'){
      this.explain('coast_leo');
      const dir = speedNow>0.5 ? norm3({x:p.u,y:p.v,z:p.w}) : FRAME_ROTATION({x:0,y:1,z:0});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=0; controls.timeScale=10;
      // Apolo 11 real: ~1,75 vueltas en la orbita de aparcamiento antes de la TLI (opt-in: mission.parking.revs)
      const PK=this.app.mission && this.app.mission.parking;
      let waitS=60;
      if (PK){
        const rNow0=SOLAR_BODIES.earth.radius+preState.altitude, GM0=G*SOLAR_BODIES.earth.mass;
        const sma=1/(2/Math.hypot(p.x,p.y,p.z)-speedNow*speedNow/GM0);
        waitS=PK.revs*2*Math.PI*Math.sqrt(sma*sma*sma/GM0);
        const tLeft=waitS-(p.time-this.phaseStart);
        controls.timeScale = tLeft>120 ? Math.min(PK.warp||1000, tLeft/4) : 10;
        // Ventana de la TLI: pasadas las vueltas minimas se espera al punto de la orbita opuesto a donde estara la Luna
        // al llegar (semiperiodo de la elipse de transferencia). Igual que el Apolo real, que encendia sobre el Pacifico.
        if (tLeft<=0 && PK.waitWindow!==false){
          const rN=Math.hypot(p.x,p.y,p.z), rM=SOLAR_BODIES.moon.a, rAp=(PK.tliApoKm||SOLAR_BODIES.moon.a/1000)*1000;
          const aT=(rN+rAp)/2, eT=(rAp-rN)/(rAp+rN);
          // tiempo y anomalia verdadera al cruzar la distancia de la Luna en la elipse de transferencia
          const cosE=Math.max(-1,Math.min(1,(1-rM/aT)/eT)), E=Math.acos(cosE), tHalf=Math.sqrt(aT*aT*aT/GM0)*(E-eT*Math.sin(E));
          const cosNu=Math.max(-1,Math.min(1,(aT*(1-eT*eT)/rM-1)/eT)), nu=Math.acos(cosNu);
          const eP=positionOf('earth',p.time), mP=positionOf('moon',p.time+tHalf);
          const hxx=p.y*p.w-p.z*p.v, hyy=p.z*p.u-p.x*p.w, hzz=p.x*p.v-p.y*p.u, n=norm3({x:hxx,y:hyy,z:hzz});
          let A=norm3({x:mP.x-eP.x,y:mP.y-eP.y,z:mP.z-eP.z});            // direccion de la Luna a la llegada
          const an=A.x*n.x+A.y*n.y+A.z*n.z; A=norm3({x:A.x-an*n.x,y:A.y-an*n.y,z:A.z-an*n.z});
          // salida = llegada girada -nu alrededor de la normal (Rodrigues, A perpendicular a n)
          const nxA={x:n.y*A.z-n.z*A.y,y:n.z*A.x-n.x*A.z,z:n.x*A.y-n.y*A.x}, c=Math.cos(nu), sn=Math.sin(nu);
          const Dp={x:A.x*c-nxA.x*sn,y:A.y*c-nxA.y*sn,z:A.z*c-nxA.z*sn};
          const rh=norm3({x:p.x,y:p.y,z:p.z});
          const cx=rh.y*Dp.z-rh.z*Dp.y, cy=rh.z*Dp.x-rh.x*Dp.z, cz=rh.x*Dp.y-rh.y*Dp.x;
          let ang=Math.atan2(cx*n.x+cy*n.y+cz*n.z, rh.x*Dp.x+rh.y*Dp.y+rh.z*Dp.z) - (PK.tliLeadDeg||0)*Math.PI/180;
          if (ang<0) ang+=2*Math.PI;
          const omega=speedNow/rN, tGo=ang/omega;
          const per=2*Math.PI/omega, inWindow = tGo<=2 || tGo>=per-8;   // ya en el punto (o lo acaba de pasar)
          controls.timeScale = Math.max(1, Math.min(200, tGo/4));
          if (!inWindow) return controls;
        }
      }
      if (p.time-this.phaseStart>waitS){
        const rNow=SOLAR_BODIES.earth.radius+preState.altitude, rApo=(PK&&PK.tliApoKm)?PK.tliApoKm*1000:SOLAR_BODIES.moon.a;
        const a=(rNow+rApo)/2, GM=G*SOLAR_BODIES.earth.mass;
        this.targetSpeedTLI=Math.sqrt(GM*(2/rNow-1/a));
        this.phase='tli_burn'; this.phaseStart=p.time; this.explain('tli_burn');
      }
      return controls;
    }

    if (this.phase==='tli_burn'){
      this.explain('tli_burn');
      const dir=norm3({x:p.u,y:p.v,z:p.w});
      const steer=p.autopilotSteer(dir);
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll;
      controls.throttle = speedNow<this.targetSpeedTLI ? 1 : 0; controls.timeScale=1;
      if (speedNow>=this.targetSpeedTLI){
        const TP=this.app.mission && this.app.mission.transposition;
        this.phase = TP ? 'transposicion' : 'coast_tli'; this.phaseStart=p.time; this.explain(this.phase);
      }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la inyección translunar.'); return null; }
      return controls;
    }

    if (this.phase==='transposicion'){
      // Fase 4 (guionizada, solo visual): el CSM se separa de la S-IVB, gira 180 grados, se acopla al LM y lo extrae. La fisica sigue
      // siendo un unico vehiculo; solo se baja el reloj a x1 durante durS segundos para que se vea.
      this.explain('transposicion');
      const dur=(this.app.mission.transposition&&this.app.mission.transposition.durS)||24;
      controls.throttle=0; controls.timeScale=1;
      if (speedNow>0.5){ const st=p.autopilotSteer(norm3({x:p.u,y:p.v,z:p.w})); controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; }
      if (p.time-this.phaseStart>=dur){ this.phase='coast_tli'; this.phaseStart=p.time; this.explain('coast_tli'); }
      return controls;
    }

    if (this.phase==='coast_tli'){
      this.explain('coast_tli');
      controls.throttle=0; controls.timeScale=(this.app.mission&&this.app.mission.cruiseTimeScale)||20000;   // Apolo 11: ~3000 (~3 min reales)
      const shipAbsNow=preState.shipAbs, moonAbsNow=preState.bodies.moon;
      const distMoonNow=Math.sqrt((shipAbsNow.x-moonAbsNow.x)**2+(shipAbsNow.y-moonAbsNow.y)**2+(shipAbsNow.z-moonAbsNow.z)**2);
      if (p.time-this.lastCorrection>3600*6){
        this.lastCorrection=p.time;
        const timeToArrival = speedNow>10 ? distMoonNow/speedNow : 1e9;
        const moonFuturePos = positionOf('moon', p.time+Math.min(timeToArrival,5*86400));
        const toTarget = norm3({x:moonFuturePos.x-shipAbsNow.x,y:moonFuturePos.y-shipAbsNow.y,z:moonFuturePos.z-shipAbsNow.z});
        const curDir = norm3({x:p.u,y:p.v,z:p.w});
        const dot = toTarget.x*curDir.x+toTarget.y*curDir.y+toTarget.z*curDir.z;
        const angleOff = Math.acos(Math.max(-1,Math.min(1,dot)));
        if (angleOff>0.005){
          const dv = Math.min(25, angleOff*speedNow*0.15);
          p.u += (toTarget.x-curDir.x)*dv; p.v += (toTarget.y-curDir.y)*dv; p.w += (toTarget.z-curDir.z)*dv;
        }
      }
      if (preState.body==='moon'){ this.phase='loi_burn'; this.phaseStart=p.time; this._loiSub='fall'; this._targetedOnce=false; this.explain('loi_burn'); }
      if (p.time-this.phaseStart>20*86400){ this.stop('⚠️ El crucero hacia la Luna tardó demasiado sin llegar.'); return null; }
      return controls;
    }

    if (this.phase==='loi_burn'){
      this.explain('loi_burn');
      const rNow=SOLAR_BODIES.moon.radius+preState.altitude, GMm=G*SOLAR_BODIES.moon.mass;
      const vCirc=Math.sqrt(GMm/rNow);
      const radial=norm3({x:p.x,y:p.y,z:p.z});
      const velRadialMag=p.u*radial.x+p.v*radial.y+p.w*radial.z;
      const tangVec={x:p.u-velRadialMag*radial.x,y:p.v-velRadialMag*radial.y,z:p.w-velRadialMag*radial.z};
      const tangSpeed=Math.sqrt(tangVec.x**2+tangVec.y**2+tangVec.z**2);
      if (this._loiSub===undefined) this._loiSub='fall';
      let dir=null, throttle=0;
      controls.timeScale = this._loiSub==='fall' ? ((this.app.mission&&this.app.mission.loiFallTimeScale)||300) : 1;

      if (this._loiSub==='fall'){
        if (!this._targetedOnce){
          this._targetedOnce=true;
          // Formula general (no asume energia casi-parabolica, que fallaba cuando la llegada
          // real tenia mas energia de la esperada): resuelve la tangencial exacta conservando
          // L y E entre el punto actual y el perilunio deseado, sea cual sea la energia real.
          const rPeriDeseado=SOLAR_BODIES.moon.radius+200000;
          const numerador = -(velRadialMag*velRadialMag) + 2*GMm*(1/rNow - 1/rPeriDeseado);
          const denominador = 1 - (rNow*rNow)/(rPeriDeseado*rPeriDeseado);
          const tangNecesaria=Math.sqrt(Math.max(0, numerador/denominador));
          const dv=tangNecesaria-tangSpeed; // puede ser negativo: hay que FRENAR tangencial, no solo acelerar
          const tangDir=tangSpeed>0.5?norm3(tangVec):norm3(cross3fix(radial));
          p.u+=tangDir.x*dv; p.v+=tangDir.y*dv; p.w+=tangDir.z*dv;
          this.app.toast.show('🎯 Empujón de puntería hacia un perilunio seguro de 200km.', 5000);
        }
        if (velRadialMag<0 && Math.abs(velRadialMag)<speedNow*0.5 && preState.altitude<1000000){ this._loiSub='approach'; }
        if (p.time-this.phaseStart>20*86400){ this.stop('⚠️ La caída hacia la Luna no llegó a buen puerto.'); return null; }
      } else if (this._loiSub==='approach'){
        if (velRadialMag>=0){ this._loiSub='insert'; }
        if (p.time-this.phaseStart>20*86400){ this.stop('⚠️ No se alcanzó el perilunio.'); return null; }
      } else {
        if (speedNow>vCirc*1.02){ dir=norm3({x:-p.u,y:-p.v,z:-p.w}); throttle=1; }
        else { throttle=0; }
      }
      const steer = dir ? p.autopilotSteer(dir) : {pitch:0,yaw:0,roll:0};
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=throttle;

      const speedAfter=Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w);
      if (this._loiSub==='insert' && speedAfter<=vCirc*1.02){
        if (this.app.mission && this.app.mission.transposition){
          // Fase 7: Columbia se queda en la orbita en la que se separa (circular a esta altura, mismo plano y sentido que la nave)
          const ci=DOCKING_TARGETS.findIndex(t=>t.id==='csm'); if (ci>=0) DOCKING_TARGETS.splice(ci,1);
          const r0=Math.hypot(p.x,p.y,p.z), e1={x:p.x/r0,y:p.y/r0,z:p.z/r0}, vr=p.u*e1.x+p.v*e1.y+p.w*e1.z;
          let e2={x:p.u-vr*e1.x,y:p.v-vr*e1.y,z:p.w-vr*e1.z}; const m2=Math.hypot(e2.x,e2.y,e2.z)||1; e2={x:e2.x/m2,y:e2.y/m2,z:e2.z/m2};
          const n0=Math.sqrt(G*SOLAR_BODIES.moon.mass/(r0*r0*r0));
          DOCKING_TARGETS.push({id:'csm', name:'Columbia (CSM)', parent:'moon', altitude:r0-SOLAR_BODIES.moon.radius, phase0:-n0*p.time, e1, e2});
          this.app.toast.show('🛰️ Separación: Columbia queda en órbita lunar; Eagle inicia el descenso.', 7000);
        }
        const LDm=this.app.mission && this.app.mission.lmDescent;
        if (LDm){
          // Opcion (b): el LOI lo hizo la pila grande (SPS del CSM); ahora Eagle se separa y queda solo la pila del LM (descenso + ascenso)
          p.stack=new StageStack(LDm.stack);
          this.phase='separation'; this.phaseStart=p.time; this._sepDir=null;
          this.explain('separation');
          this.app.toast.show('🛰️ Eagle se separa de Columbia (pila del módulo lunar: descenso + ascenso).', 6000);
        } else {
          this.phase='descent'; this.phaseStart=p.time; this._descSub='align'; this._fixedDeorbitDir=null; this._numBurns=1;
          this.explain('descent');
        }
      }
      if (preState.fuelPercent<=0){ this.stop('⚠️ Sin combustible durante la inserción orbital lunar.'); return null; }
      return controls;
    }

    if (this.phase==='separation'){
      // Fase 7: Eagle se aleja de Columbia sin empuje (RCS), actitud retrograda para el encendido de descenso
      const LDm=this.app.mission.lmDescent;
      if (!this._sepDir) this._sepDir=norm3({x:-p.u,y:-p.v,z:-p.w});
      const st=p.autopilotSteer(this._sepDir);
      controls.pitch=st.pitch; controls.yaw=st.yaw; controls.roll=st.roll; controls.throttle=0; controls.timeScale=1;
      if (p.time-this.phaseStart>=(LDm.sepS||30)){
        this.phase='descent'; this.phaseStart=p.time; this._descSub='doi_align'; this._fixedDeorbitDir=null; this._doiDir=null; this._numBurns=1;
        this.explain('descent');
      }
      return controls;
    }
    if (this.phase==='descent'){
      this.explain('descent');
      const LDd=this.app.mission && this.app.mission.lmDescent;
      if (LDd && p.stack.currentIndex>0 && !this._landedLM){ this.stop('⚠️ Se agotó el propergol de la etapa de descenso antes de alunizar.'); return null; }
      const horizSpeed=preState.horizSpeed, vertSpeed=preState.vertSpeed, alt=preState.altitude;
      if (this._descSub===undefined) this._descSub='align';
      let dir=null, throttle=0;

      const GMd=G*SOLAR_BODIES.moon.mass, rMoonD=SOLAR_BODIES.moon.radius;
      if (LDd && this._descSub==='doi_align'){
        // DOI (insercion en orbita de descenso): impulso retrogrado que baja el perilunio a ~15 km, como el LM real
        if (!this._fixedDeorbitDir) this._fixedDeorbitDir=norm3({x:-p.u,y:-p.v,z:-p.w});
        dir=this._fixedDeorbitDir; throttle=0.002;
        const ta=RocketPhysics.targetAngles(FRAME_ROTATION_INV(dir));
        if ((Math.abs(RocketPhysics.wrapAngle(ta.pitch-p.pitch))+Math.abs(RocketPhysics.wrapAngle(ta.yaw-p.yaw)))<0.1) this._descSub='doi_burn';
      } else if (LDd && this._descSub==='doi_burn'){
        // Se frena la velocidad TANGENCIAL hasta la que da un perilunio de periKm (conservacion de energia y momento angular)
        const rr=Math.hypot(p.x,p.y,p.z), ru=norm3({x:p.x,y:p.y,z:p.z}), rp=rMoonD+(LDd.periKm||15)*1000;
        const vr=p.u*ru.x+p.v*ru.y+p.w*ru.z, tv={x:p.u-vr*ru.x,y:p.v-vr*ru.y,z:p.w-vr*ru.z}, vt=Math.hypot(tv.x,tv.y,tv.z);
        if (!this._doiDir) this._doiDir=norm3({x:-tv.x,y:-tv.y,z:-tv.z});
        dir=this._doiDir;
        const vtNeed=Math.sqrt(Math.max(0,2*(GMd*(1/rr-1/rp)-vr*vr/2)/(1-(rr*rr)/(rp*rp))));
        if (vt<=vtNeed){ throttle=0; this._descSub='doi_coast'; this.app.toast.show('🌙 DOI completada: perilunio de ~15 km. Se coasta hasta el perilunio.', 5000); }
        else throttle=Math.max(0.05,Math.min(1,(vt-vtNeed)/3));
      } else if (LDd && this._descSub==='doi_coast'){
        dir=this._fixedDeorbitDir; throttle=0;
        controls.timeScale=Math.max(1,Math.min(100,(alt-(LDd.periKm||15)*1000-3000)/400));
        if (vertSpeed>-1 && alt<(LDd.periKm||15)*1000+4000){ this._descSub='brake'; this.app.toast.show('🔥 Encendido de frenado: descenso motorizado.', 5000); }
      } else if (LDd && this._descSub==='brake'){
        // Guiado de frenado: empuje maximo; el cabeceo reparte el empuje entre frenar la velocidad horizontal
        // y sostener el perfil de descenso vertical (como la fase de frenado del LM real).
        const up={x:p.x,y:p.y,z:p.z}, ru=norm3(up), vv=p.u*ru.x+p.v*ru.y+p.w*ru.z;
        const hv={x:p.u-vv*ru.x,y:p.v-vv*ru.y,z:p.w-vv*ru.z}, hs=Math.hypot(hv.x,hv.y,hv.z), hd=hs>0.5?norm3(hv):norm3(cross3fix(ru));
        const rr=Math.hypot(p.x,p.y,p.z), gl=GMd/(rr*rr), cent=hs*hs/rr;
        const A=p.maxThrust/(p.dryMass+p.fuelMass);
        const vT=-Math.min(LDd.brakeRateCap||30,Math.sqrt(Math.max(0,alt))*0.6);
        const av=Math.max(0,Math.min(A*0.95,gl-cent+(vT-vertSpeed)*(LDd.brakeGain||0.5)));
        const ah=Math.sqrt(Math.max(0,A*A-av*av));
        dir=norm3({x:-hd.x*ah+ru.x*av,y:-hd.y*ah+ru.y*av,z:-hd.z*ah+ru.z*av}); throttle=1;
        if (hs<(LDd.brakeEndHs||30)) this._descSub='final';
      } else if (this._descSub==='align'){
        if (!this._fixedDeorbitDir) this._fixedDeorbitDir=norm3({x:-p.u,y:-p.v,z:-p.w});
        dir=this._fixedDeorbitDir;
        const localDirCheck=FRAME_ROTATION_INV(dir);
        const ta=RocketPhysics.targetAngles(localDirCheck);
        const pitchErrNow=Math.abs(RocketPhysics.wrapAngle(ta.pitch-p.pitch));
        const yawErrNow=Math.abs(RocketPhysics.wrapAngle(ta.yaw-p.yaw));
        throttle=0.002; // casi cero: girar no necesita el motor principal, solo control de actitud
        if ((pitchErrNow+yawErrNow)<0.1) this._descSub='burn';
      } else if (this._descSub==='burn'){
        dir=this._fixedDeorbitDir;
        const velAlongDir=p.u*dir.x+p.v*dir.y+p.w*dir.z;
        if (velAlongDir>=-2){
          throttle=0;
          if (horizSpeed>20 && alt>2000){
            this._numBurns=(this._numBurns||1)+1; this._fixedDeorbitDir=null; this._descSub='align';
          } else { this._descSub='final'; }
        } else {
          throttle = Math.max(0.02, Math.min(1, Math.abs(velAlongDir)/100));
        }
        if (alt<2000) this._descSub='final';
      } else {
        dir=norm3({x:p.x,y:p.y,z:p.z});
        const rNowFinal=SOLAR_BODIES.moon.radius+alt;
        const gLocal=(G*SOLAR_BODIES.moon.mass)/(rNowFinal*rNowFinal);
        const massNowFinal=p.dryMass+p.fuelMass;
        const GKd=LDd?(LDd.rateCap||150):150, GKc=LDd?(LDd.rateK||0.6):0.6, GKg=LDd?(LDd.gain||0.3):0.3;
        const targetDescentRate=-Math.max(1,Math.min(GKd,Math.sqrt(Math.max(0,alt))*GKc));
        const desiredAccel=(targetDescentRate-vertSpeed)*GKg;
        const neededThrustAccel=Math.max(0,desiredAccel+gLocal);
        throttle=Math.max(0,Math.min(1,neededThrustAccel*massNowFinal/p.maxThrust));
        // Freno horizontal suave y continuo (ayuda simplificada, igual que las correcciones de
        // rumbo del crucero): sin esto, la unica forma de quitar velocidad horizontal residual
        // seria un giro grande y brusco -- lo que se veia como la nave "girando frenetica".
        // En vez de eso, se recorta un poco cada fotograma, sin tocar la orientacion.
        const velRadialF=p.u*dir.x+p.v*dir.y+p.w*dir.z;
        const tangVecF={x:p.u-velRadialF*dir.x,y:p.v-velRadialF*dir.y,z:p.w-velRadialF*dir.z};
        const tangSpeedF=Math.sqrt(tangVecF.x**2+tangVecF.y**2+tangVecF.z**2);
        if (tangSpeedF>0.5){
          const frenoFactor=Math.pow(0.3, 1/60);
          p.u-=tangVecF.x*(1-frenoFactor); p.v-=tangVecF.y*(1-frenoFactor); p.w-=tangVecF.z*(1-frenoFactor);
        }
      }
      const steer = dir ? p.autopilotSteer(dir) : {pitch:0,yaw:0,roll:0};
      controls.pitch=steer.pitch; controls.yaw=steer.yaw; controls.roll=steer.roll; controls.throttle=throttle; controls.timeScale=1;

      if (alt<=2 && Math.abs(vertSpeed)<3 && horizSpeed<5 && this.app.mission && this.app.mission.returnTrip){
        // Apolo con regreso: tras el alunizaje la mision continua (estancia, despegue lunar, regreso, amerizaje)
        p.u=0; p.v=0; p.w=0;
        // El margen de alunizaje admite hasta 2 m de altitud pero el congelado exige <=0.01: se clava la nave al radio lunar.
        { const rr0=Math.hypot(p.x,p.y,p.z), rBody=SOLAR_BODIES.moon.radius; if (rr0>1){ p.x*=rBody/rr0; p.y*=rBody/rr0; p.z*=rBody/rr0; } }
        this._ret=null; this.phase='ret_wait'; this.phaseStart=p.time;
        this.app.toast.show('🎉 ¡El Águila ha alunizado! Estancia de 21 h en la superficie y vuelta a casa.', 7000);
        controls.throttle=0; controls.timeScale=1; return controls;
      }
      if (alt<=2 && Math.abs(vertSpeed)<3 && horizSpeed<5){
        this.phase='done'; this.explain('done'); this.active=false; this._zeroControls();
        p.u=0; p.v=0; p.w=0; // parada real -- sin esto, la velocidad residual (hasta 5 m/s
        // horizontales admitidos como "aterrizaje logrado") se mantiene para siempre, porque
        // no hay friccion de suelo simulada que la frene sola.
      }
      if (alt<=2 && (Math.abs(vertSpeed)>=3 || horizSpeed>=5)){
        this.stop('💥 Alunizaje demasiado duro.');
        return null;
      }
      if (preState.fuelPercent<=0 && alt>2){ this.stop('⚠️ Sin combustible durante el descenso.'); return null; }
      return controls;
    }
    return null;
  }
}

/* ---------- APP ---------- */
class RocketSimApp {
  // Al terminar el piloto automatico (active=false) la fase pasaba a null y el renderizador
  // interpretaba "sandbox": volvian a aparecer los SRB y el ET ya descartados (los dos tubos
  // laterales junto al Orbiter al acoplar). En las misiones ISS/Shuttle/Artemis se conserva la
  // ultima fase para que la visibilidad de etapas siga la etapa fisica real.
  _keepPhaseAfterEnd(){
    const t=this.mission && this.mission.type;
    return (t==='shuttle'||t==='iss'||t==='artemis') && !!(this.missionAuto && this.missionAuto.phase);
  }
  constructor(){    this.physics=new RocketPhysics();
    this.sound=new SoundSystem();
    this.toast=new ToastSystem();
    this.hasOrbited=false; this.inReentry=false; this.hasBeenHigh=false;
    this.missionAuto = new MissionAutopilot(this);
    if (typeof DockingAutopilot !== 'undefined') {
      this.dockingAuto = new DockingAutopilot.Autopilot(this);
    } else {
      this.dockingAuto = null;
    }
    this.mapOpen=false; this.mapZoomVal=0.15; this.mapCenterMode='sun';
    // Enganche generico de misiones: el motor no sabe nada de "Apolo 11" ni de ningun otro
    // escenario concreto. Si el archivo que carga motor.js define window.MISSION_CONFIG
    // antes de esta linea, se activa el modo mision; si no, es el sandbox de siempre.
    this.mission = window.MISSION_CONFIG || null;
    // En iss.html, la ISS visible es la de iss.js. El HUD de acoplamiento debe
    // medir contra ella, no contra la ISS simplificada de DOCKING_TARGETS.
    // El Shuttle tambien acopla con la ISS real (misma rendezvous que la Soyuz) -- sin
    // incluir 'shuttle' aqui, el resolver nunca se instala y el HUD mide contra la
    // ISS-fantasma de DOCKING_TARGETS (el bug de 7.648km ya corregido para iss.html,
    // que se replicaria sin este cambio).
    if (this.mission && (this.mission.type === 'iss' || this.mission.type === 'shuttle')
        && typeof orbitalObjectPosition === 'function'
        && typeof orbitalObjectVelocity === 'function'
        && typeof positionOf === 'function'
        && typeof ISS !== 'undefined') {
      this.physics.setDockingTargetResolver(makeIssDockingResolver());
    }
    if (this.mission){
      if (this.mission.physicsStack){
        this.physics.stack = new StageStack(this.mission.physicsStack);
      } else if (this.mission.fuelMass){
        this.physics.stack = new StageStack([{ id:'unica', dryMass:30000, fuelMass:this.mission.fuelMass, maxFuelMass:this.mission.fuelMass, thrust:this.mission.maxThrust||6500000, isp:450 }]);
      }
      (this.mission.stages||[]).forEach(st=>st.done=false);
    }
    const container=document.getElementById('viewport');
    this.renderer=new RocketRenderer3D(container);
    this.controls={throttle:0,pitch:0,yaw:0,roll:0,hyperspace:false,warp:false,timeScale:100,autopilot:'off'};
    this.setupUI();
    if (this.mission){
      const hud=document.getElementById('missionHud');
      if (hud){
        hud.style.display='block';
        document.getElementById('mhTitle').textContent='🎯 '+this.mission.title;
        this.updateMissionHud();
      }
      this.toast.show(this.mission.briefing, 8000);
    }
    this.lastTime=performance.now();
    this.loop();
    document.addEventListener('click',()=>{ if (!this.sound.enabled) this.sound.init(); },{once:true});
  }
  setupUI(){
    document.getElementById('throttle').addEventListener('input',(e)=>{
      this.controls.throttle=parseFloat(e.target.value);
      document.getElementById('throttleVal').textContent=Math.round(this.controls.throttle*100)+'%';
    });
    document.getElementById('pitch').addEventListener('input',(e)=>{
      this.controls.pitch=parseFloat(e.target.value);
      document.getElementById('pitchVal').textContent=Math.round(this.controls.pitch*90)+'°';
    });
    document.getElementById('yaw').addEventListener('input',(e)=>{
      this.controls.yaw=parseFloat(e.target.value);
      document.getElementById('yawVal').textContent=Math.round(this.controls.yaw*90)+'°';
    });
    document.getElementById('roll').addEventListener('input',(e)=>{
      this.controls.roll=parseFloat(e.target.value);
      document.getElementById('rollVal').textContent=Math.round(this.controls.roll*90)+'°';
    });
    // Mandos de resorte: al soltar (raton o dedo), vuelven solos al centro y dejan de mandar giro.
    // Sin esto, si sueltas el deslizador en +0.3 la nave sigue recibiendo ese mando todo el rato.
    ['pitch','yaw','roll'].forEach(id=>{
      const el=document.getElementById(id);
      const center=()=>{
        el.value=0; this.controls[id]=0;
        document.getElementById(id+'Val').textContent='0°';
      };
      el.addEventListener('mouseup',center);
      el.addEventListener('touchend',center);
      el.addEventListener('mouseleave',(e)=>{ if (e.buttons===1) center(); });
    });
    document.getElementById('btnLaunch').addEventListener('click',()=>{
      this.controls.throttle=1;
      document.getElementById('throttle').value=1;
      document.getElementById('throttleVal').textContent='100%';
      if (!this.sound.enabled) this.sound.init();
    });
    document.getElementById('btnReset').addEventListener('click',()=>{
      this.physics.reset();
      // Reset = vuelo nuevo: motor quimico de la mision (si no, RCS/Nuclear seguian activos en
      // la plataforma y la nave no podia despegar). activateEngine se define mas abajo, en setupUI.
      activateEngine('chemical');
      this.hasBeenHigh=false;
      if (this.missionAuto.active){
        this.missionAuto.stop();
        const btnMA=document.getElementById('btnMissionAuto');
        if (btnMA) btnMA.textContent='▶️ Ver misión automática';
        const statusMA=document.getElementById('mhAutoStatus');
        if (statusMA) statusMA.style.display='none';
        const maControls=document.getElementById('maControls');
        if (maControls) maControls.style.display='none';
      }
      const ts=this.controls.timeScale;
      this.controls={throttle:0,pitch:0,yaw:0,roll:0,hyperspace:false,warp:false,timeScale:ts,autopilot:'off'};
      document.getElementById('throttle').value=0;
      document.getElementById('pitch').value=0;
      document.getElementById('yaw').value=0;
      document.getElementById('roll').value=0;
      document.getElementById('throttleVal').textContent='0%';
      document.getElementById('pitchVal').textContent='0°';
      document.getElementById('yawVal').textContent='0°';
      document.getElementById('rollVal').textContent='0°';
      document.getElementById('badgeHyperspace').className='badge off';
      document.getElementById('badgeWarp').className='badge off';
      document.getElementById('statusDot').className='status-dot on';
      document.getElementById('statusText').textContent='EN ESPERA';
    });
    const btnRet=document.getElementById('btnReturn');
    if (btnRet) btnRet.addEventListener('click',()=>{ if (this.mission && this.mission.returnTrip) this.missionAuto.startReturn(); });
    document.getElementById('btnRefuel').addEventListener('click',()=>{
      // Shuttle: el unico propelente 'de reserva' es el del OMS del Orbiter. Repostar los
      // tanques del ET/SSME en pleno ascenso seria un exploit, asi que solo se permite
      // con el Orbiter ya solo (ultima etapa).
      const st=this.physics.stack;
      if (this.mission && this.mission.type==='shuttle' && st.currentIndex < st.stages.length-1){
        this.toast.show('⛽ Solo puedes repostar el OMS una vez separado el ET', 4000);
        return;
      }
      if (!this.physics.refuel()) this.toast.show('⛽ Una etapa de combustible sólido no se puede repostar', 4000);
    });
    document.getElementById('btnDock').addEventListener('click',()=>{
      const ok=this.physics.tryDock();
      if (ok && this.dockingAuto) {
        this.dockingAuto.deactivate(); // deactivate() ya comprueba internamente si seguia activo
      }
      this.toast.show(ok?'🔗 Acoplado':'⚠️ Fuera de tolerancia', 3000);
      // Refresco del HUD en el mismo clic, sin esperar al siguiente fotograma.
      if (ok) this.updateUI(this.physics.getState());
    });
    document.getElementById('btnUndock').addEventListener('click',()=>{
      this.physics.undock();
      this.toast.show('🔓 Separado', 2000);
    });
    const btnCW = document.getElementById('btnCW');
    if (btnCW && this.dockingAuto) {
      btnCW.addEventListener('click', () => {
        if (this.dockingAuto.isActive()) {
          this.dockingAuto.deactivate('🛰️ Acople automático detenido');
        } else {
          this.dockingAuto.activate();
        }
      });
    }
    const engineBtns = {
      chemical: document.getElementById('btnEngineChem'),
      nuclear:  document.getElementById('btnEngineNuke'),
      rcs:      document.getElementById('btnEngineRCS')   // solo existe en iss.html
    };
    const activateEngine = (kind) => {
      this.physics.setEngine(kind);
      Object.keys(engineBtns).forEach(k => {
        const btn = engineBtns[k];
        if (btn) btn.classList.toggle('active', k === kind);
      });
    };
    if (engineBtns.chemical) engineBtns.chemical.addEventListener('click', () => activateEngine('chemical'));
    if (engineBtns.nuclear)  engineBtns.nuclear.addEventListener('click',  () => activateEngine('nuclear'));
    if (engineBtns.rcs)      engineBtns.rcs.addEventListener('click',      () => activateEngine('rcs'));
    const apBtns={off:document.getElementById('btnApOff'),prograde:document.getElementById('btnApPro'),retrograde:document.getElementById('btnApRetro'),hold:document.getElementById('btnApHold')};
    Object.keys(apBtns).forEach(k=>{
      apBtns[k].addEventListener('click',()=>{
        this.controls.autopilot=k;
        if (k==='hold'){
          this.holdDir=RocketPhysics.rotateVec(0,1,0,this.physics.pitch,this.physics.yaw,this.physics.roll);
        }
        Object.values(apBtns).forEach(b=>b.classList.remove('active'));
        apBtns[k].classList.add('active');
      });
    });
    document.getElementById('btnHyperspace').addEventListener('click',()=>{
      this.controls.hyperspace=!this.controls.hyperspace;
      const badge=document.getElementById('badgeHyperspace');
      badge.className=`badge ${this.controls.hyperspace?'hyper':'off'}`;
      document.getElementById('btnHyperspace').classList.toggle('active');
      if (this.controls.hyperspace){ document.getElementById('statusDot').className='status-dot hyper'; document.getElementById('statusText').textContent='🌀 HIPERESPACIO'; }
      else { document.getElementById('statusDot').className='status-dot on'; document.getElementById('statusText').textContent='EN VUELO'; }
    });
    document.getElementById('btnWarp').addEventListener('click',()=>{
      this.controls.warp=!this.controls.warp;
      const badge=document.getElementById('badgeWarp');
      badge.className=`badge ${this.controls.warp?'warp':'off'}`;
      document.getElementById('btnWarp').classList.toggle('active');
      if (this.controls.warp){ document.getElementById('statusDot').className='status-dot warp'; document.getElementById('statusText').textContent='⚡ WARP DRIVE'; }
      else { document.getElementById('statusDot').className='status-dot on'; document.getElementById('statusText').textContent='EN VUELO'; }
    });
    document.getElementById('btnToggleView').addEventListener('click',()=>{
      const mode=this.renderer.toggleView();
      const isGagarin = typeof window!=='undefined' && window.MISSION_CONFIG && window.MISSION_CONFIG.type==='gagarin';
      const label = isGagarin
        ? (mode==='external' ? '👁️ Cabina' : '👁️ Externa')
        : (mode==='external' ? '👁️ Cabina' : mode==='cockpit' ? '🎥 Cine' : '👁️ Externa');
      document.getElementById('btnToggleView').textContent=label;
    });
    document.getElementById('mvFront').addEventListener('click',()=>{
      this.renderer.setFocus(this.renderer.focusTarget==='earth' ? null : 'earth');
      document.getElementById('mvFront').classList.toggle('selected', this.renderer.focusTarget==='earth');
      document.getElementById('mvBack').classList.remove('selected');
    });
    document.getElementById('mvBack').addEventListener('click',()=>{
      this.renderer.setFocus(this.renderer.focusTarget==='moon' ? null : 'moon');
      document.getElementById('mvBack').classList.toggle('selected', this.renderer.focusTarget==='moon');
      document.getElementById('mvFront').classList.remove('selected');
    });
    const openMap=()=>{
      this.mapOpen=true;
      document.getElementById('mapOverlay').style.display='flex';
      this.resizeMapCanvas();
    };
    document.getElementById('btnMap').addEventListener('click',openMap);
    document.getElementById('btnMapFab').addEventListener('click',openMap);
    document.getElementById('btnHelp').addEventListener('click',()=>{
      document.getElementById('helpOverlay').style.display='flex';
    });
    document.getElementById('btnHelpClose').addEventListener('click',()=>{
      document.getElementById('helpOverlay').style.display='none';
    });
    const btnMissionAuto=document.getElementById('btnMissionAuto');
    if (btnMissionAuto){
      btnMissionAuto.addEventListener('click',()=>{
        if (this.missionAuto.active){
          this.missionAuto.stop('⏸️ Piloto automático detenido. Recuperas el control manual.');
          btnMissionAuto.textContent='▶️ Ver misión automática';
          document.getElementById('mhAutoStatus').style.display='none';
          document.getElementById('maControls').style.display='none';
        } else {
          this.missionAuto.start();
          btnMissionAuto.textContent='⏹️ Detener piloto automático';
          document.getElementById('mhAutoStatus').style.display='block';
          document.getElementById('maControls').style.display='flex';
          document.getElementById('btnMaPause').textContent='⏸️';
        }
      });
    }
    const btnMaPause=document.getElementById('btnMaPause');
    if (btnMaPause) btnMaPause.addEventListener('click',()=>{
      this.missionAuto.paused=!this.missionAuto.paused;
      btnMaPause.textContent=this.missionAuto.paused?'▶️':'⏸️';
    });
    document.querySelectorAll('.ma-speed').forEach(btn=>{
      btn.addEventListener('click',()=>{
        this.missionAuto.speed=parseInt(btn.dataset.speed,10);
        document.querySelectorAll('.ma-speed').forEach(b=>{
          b.style.background = b===btn ? 'rgba(255,179,71,.25)' : 'rgba(255,255,255,.05)';
          b.style.borderColor = b===btn ? 'var(--accent)' : 'var(--border-color)';
          b.style.color = b===btn ? 'var(--accent)' : 'var(--text-secondary)';
        });
      });
    });
    const btnMaSkip=document.getElementById('btnMaSkip');
    if (btnMaSkip) btnMaSkip.addEventListener('click',()=>{
      if (!this.missionAuto.active || this.missionAuto.paused) return;
      const startPhase=this.missionAuto.phase;
      let state=null, count=0;
      while (this.missionAuto.active && this.missionAuto.phase===startPhase && count<4000){
        const c=this.missionAuto.step();
        if (!c) break;
        this.controls=c;
        state=this.physics.step(1/60,c);
        count++;
      }
      if (state){ this.updateUI(state); this.checkMissionProgress(state); this.updateMissionHud(state); }
    });
    const INFO_TIPS={
      cabeceo:'🕹️ Cabeceo: inclina el morro arriba/abajo, como asentir con la cabeza.',
      guinada:'🕹️ Guiñada: gira el morro izquierda/derecha, como negar con la cabeza.',
      alabeo:'🕹️ Alabeo: gira la nave sobre su propio eje, como un sacacorchos.'
    };
    document.querySelectorAll('.info-i').forEach(el=>{
      el.addEventListener('click',(e)=>{
        e.stopPropagation();
        this.toast.show(INFO_TIPS[el.dataset.tip], 4000);
      });
    });
    document.getElementById('btnMapClose').addEventListener('click',()=>{
      this.mapOpen=false;
      document.getElementById('mapOverlay').style.display='none';
    });
    document.getElementById('mapZoom').addEventListener('input',(e)=>{
      this.mapZoomVal=parseFloat(e.target.value);
      const labels=['vista general','sist. exterior','sist. interior','Tierra-Luna'];
      const idx=Math.min(3,Math.floor(this.mapZoomVal*4));
      document.getElementById('mapZoomLabel').textContent=labels[idx];
    });
    const centerBtns={sun:document.getElementById('btnCenterSun'),earth:document.getElementById('btnCenterEarth'),ship:document.getElementById('btnCenterShip')};
    const smallCenterBtns=Array.from(document.querySelectorAll('#mapSmallRow .btn-small'));
    const clearAllCenterActive=()=>{
      Object.values(centerBtns).forEach(b=>b.classList.remove('active'));
      smallCenterBtns.forEach(b=>b.classList.remove('active'));
    };
    Object.keys(centerBtns).forEach(k=>{
      centerBtns[k].addEventListener('click',()=>{
        this.mapCenterMode=k;
        clearAllCenterActive();
        centerBtns[k].classList.add('active');
      });
    });
    smallCenterBtns.forEach(btn=>{
      btn.addEventListener('click',()=>{
        const key=btn.dataset.center;
        this.mapCenterMode = key==='kuiper' ? 'sun' : key;
        clearAllCenterActive();
        btn.classList.add('active');
        const zoomPreset = key==='kuiper' ? 0.03 : 0.55;
        this.mapZoomVal=zoomPreset;
        document.getElementById('mapZoom').value=zoomPreset;
        const labels=['vista general','sist. exterior','sist. interior','Tierra-Luna'];
        document.getElementById('mapZoomLabel').textContent=labels[Math.min(3,Math.floor(zoomPreset*4))];
      });
    });
    window.addEventListener('resize',()=>{ if (this.mapOpen) this.resizeMapCanvas(); });

    // Zoom tactil (pellizcar) y rueda del raton sobre el propio mapa
    const mapCanvasEl=document.getElementById('mapCanvas');
    const setZoomVal=(z)=>{
      z=Math.max(0,Math.min(1,z));
      this.mapZoomVal=z;
      document.getElementById('mapZoom').value=z;
      const labels=['vista general','sist. exterior','sist. interior','Tierra-Luna'];
      document.getElementById('mapZoomLabel').textContent=labels[Math.min(3,Math.floor(z*4))];
    };
    const ZOOM_RATIO=25000/3.5;
    const touchDist=(t)=>{ const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); };
    let pinchStartDist=null, pinchStartZoom=null;
    mapCanvasEl.addEventListener('touchstart',(e)=>{
      if (e.touches.length===2){ pinchStartDist=touchDist(e.touches); pinchStartZoom=this.mapZoomVal; }
    },{passive:true});
    mapCanvasEl.addEventListener('touchmove',(e)=>{
      if (e.touches.length===2 && pinchStartDist){
        e.preventDefault();
        const scaleFactor=touchDist(e.touches)/pinchStartDist;
        setZoomVal(pinchStartZoom + Math.log(scaleFactor)/Math.log(ZOOM_RATIO));
      }
    },{passive:false});
    mapCanvasEl.addEventListener('touchend',(e)=>{ if (e.touches.length<2){ pinchStartDist=null; pinchStartZoom=null; } });
    mapCanvasEl.addEventListener('wheel',(e)=>{
      e.preventDefault();
      setZoomVal(this.mapZoomVal + (e.deltaY<0 ? 0.04 : -0.04));
    },{passive:false});
    const timeBtns={
      1:document.getElementById('btnTime1'), 100:document.getElementById('btnTime100'),
      3000:document.getElementById('btnTime3000'), 30000:document.getElementById('btnTime30000'),
      300000:document.getElementById('btnTime300000'), 3000000:document.getElementById('btnTime3000000')
    };
    Object.keys(timeBtns).forEach(k=>{
      timeBtns[k].addEventListener('click',()=>{
        this.controls.timeScale=parseInt(k,10);
        Object.values(timeBtns).forEach(b=>b.classList.remove('active'));
        timeBtns[k].classList.add('active');
      });
    });
  }
  updateUI(state){
    if (this.missionAuto.active){
      document.getElementById('throttle').value = this.controls.throttle;
      document.getElementById('pitch').value = this.controls.pitch;
      document.getElementById('yaw').value = this.controls.yaw;
      document.getElementById('roll').value = this.controls.roll;
    }
    const met = state.time - (this.physics.metZero||0);   // tiempo de mision: el reloj de simulacion salta en las ventanas fijadas por el piloto (Artemis II)
    document.getElementById('dDate').textContent = formatMissionDate(missionDate(this.physics.metZero!==undefined ? met : state.time));
    document.getElementById('dElapsed').textContent = formatElapsed(met);
    // Actitud real de la nave (no el mando): pitch/roll en -180..180, rumbo (yaw) como brujula 0-360
    const toDeg180=r=>{ let d=(r*180/Math.PI)%360; if(d>180)d-=360; if(d<-180)d+=360; return d; };
    const toDeg360=r=>{ let d=(r*180/Math.PI)%360; if(d<0)d+=360; return d; };
    document.getElementById('realPitch').textContent = toDeg180(state.pitch).toFixed(0)+'°';
    document.getElementById('realYaw').textContent = toDeg360(state.yaw).toFixed(0)+'°';
    document.getElementById('realRoll').textContent = toDeg180(state.roll).toFixed(0)+'°';
    const BODY_LABELS = {earth:'🌍',moon:'🌑',mars:'🔴',jupiter:'🟠',io:'🌋',europa:'🧊',ganymede:'⚪',callisto:'⚫',saturn:'🪐',titan:'🟤',uranus:'🔵',neptune:'🔷',pluto:'❄️',sun:'☀️'};
    const bodyIcon = BODY_LABELS[state.body] || '❔';
    document.getElementById('tAltitude').textContent=bodyIcon+' '+formatDistance(state.altitude);
    document.getElementById('tVelocity').textContent=state.velocity.toFixed(0)+' m/s';
    document.getElementById('tFuel').textContent=state.stageFuelPercent.toFixed(0)+'%';
    document.getElementById('tGForce').textContent=state.gForce.toFixed(2)+'g';
    document.getElementById('tMass').textContent=(state.mass/1000).toFixed(0)+' t';
    document.getElementById('tVOrbit').textContent=state.vCirc.toFixed(0)+' m/s';
    document.getElementById('ovAltitude').textContent=formatDistance(state.altitude);
    document.getElementById('ovVelocity').textContent=state.velocity.toFixed(0);
    document.getElementById('ovGForce').textContent=state.gForce.toFixed(2);
    document.getElementById('badgeGForce').textContent=`📊 ${state.gForce.toFixed(1)}g`;
    document.getElementById('badgeGForce').className=state.gForce>3?'badge danger':'badge';
    const orbitBadge=document.getElementById('badgeOrbit');
    if (state.inOrbit){ orbitBadge.className='badge orbit'; orbitBadge.textContent='🛰️ ÓRBITA ✓'; }
    else if (state.ascending){ orbitBadge.className='badge warning'; orbitBadge.textContent='🚀 ASCENSO'; }
    else { orbitBadge.className='badge off'; orbitBadge.textContent='🛰️ ÓRBITA'; }
    document.getElementById('btnRefuel').style.display = state.inOrbit ? 'block' : 'none';

    const gArc=document.getElementById('gArc'), gLabel=document.getElementById('gLabel');
    if (gArc && gLabel){
      const g=Math.min(5,state.gForce||1);
      const circumference=157;
      gArc.style.strokeDashoffset=circumference-(g/5)*circumference;
      gArc.style.stroke = g>3?'#ff4444':g>2?'#ffaa00':'#00ff88';
      gLabel.textContent=g.toFixed(1)+'g';
    }

    if (state.inOrbit && !this.hasOrbited){
      this.hasOrbited=true;
      this.toast.show('🛰️ ¡ÓRBITA ALCANZADA! Velocidad: '+state.velocity.toFixed(0)+' m/s', 5000);
    }
    if (!state.inOrbit) this.hasOrbited=false;
    if (state.reentry && !this.inReentry){
      this.inReentry=true;
      this.toast.show('🔥 REENTRADA ATMOSFÉRICA', 3000);
    }
    if (!state.reentry) this.inReentry=false;
    const engineBadge=document.getElementById('badgeEngine');
    if (state.throttle>0.1 && state.fuelMass>0){ engineBadge.className='badge on'; engineBadge.textContent='🔥 MOTOR'; }
    else if (state.fuelMass<=0){ engineBadge.className='badge danger'; engineBadge.textContent='⛽ SIN COMBUSTIBLE'; }
    else { engineBadge.className='badge off'; engineBadge.textContent='⏸ MOTOR'; }
    const dot=document.getElementById('statusDot');
    if (state.inOrbit){ dot.className='status-dot on'; document.getElementById('statusText').textContent='🛰️ EN ÓRBITA'; }
    else if (state.hyperspace) dot.className='status-dot hyper';
    else if (state.warp) dot.className='status-dot warp';
    else if (state.throttle>0.1 && state.fuelMass>0){ dot.className='status-dot on'; document.getElementById('statusText').textContent='🚀 DESPEGANDO'; }
    else if (state.velocity>5){ dot.className='status-dot on'; document.getElementById('statusText').textContent='✈️ EN VUELO'; }
    else { dot.className='status-dot off'; document.getElementById('statusText').textContent='🟢 EN ESPERA'; }

    // HUD de aterrizaje: visible cerca de cualquier superficie cuando no estas en orbita
    const landingHud=document.getElementById('landingHud');
    if (state.altitude>20000) this.hasBeenHigh=true;
    const showLanding = !state.inOrbit && state.altitude < 15000 && state.body!=='sun' && this.hasBeenHigh;
    landingHud.style.display = showLanding ? 'block' : 'none';
    if (showLanding){
      document.getElementById('lhAlt').textContent = formatDistance(state.altitude);
      const vvertRow=document.getElementById('lhVvert').parentElement;
      document.getElementById('lhVvert').textContent = state.vertSpeed.toFixed(1)+' m/s';
      vvertRow.className = 'lh-row' + (state.vertSpeed<-30?' danger':state.vertSpeed<-8?' warn':'');
      document.getElementById('lhVhoriz').textContent = state.horizSpeed.toFixed(1)+' m/s';
      document.getElementById('lhFuel').textContent = state.stageFuelPercent.toFixed(0)+'%';
    }

    // HUD de acoplamiento: visible si hay un objetivo alcanzable a menos de 10km, o si ya estas acoplado
    const dockHud=document.getElementById('dockHud');
    const info=state.dockInfo;
    const showDock = !!state.dockedTo || (info && info.dist<10000);
    dockHud.style.display = showDock ? 'block' : 'none';
    if (showDock){
      if (state.dockedTo){
        document.getElementById('dhTitle').textContent='🔗 ACOPLADO';
        document.getElementById('dhName').textContent=info?info.target.name:state.dockedTo;
        document.getElementById('dhDist').textContent='0 m';
        document.getElementById('dhSpeed').textContent='0 m/s';
        document.getElementById('btnDock').style.display='none';
        document.getElementById('btnUndock').style.display='block';
      } else if (info){
        document.getElementById('dhTitle').textContent='🛰️ ACOPLAMIENTO';
        document.getElementById('dhName').textContent=info.target.name;
        document.getElementById('dhDist').textContent=formatDistance(info.dist);
        document.getElementById('dhSpeed').textContent=info.relSpeed.toFixed(2)+' m/s';
        const cwActive = this.dockingAuto && this.dockingAuto.isActive();
        document.getElementById('btnDock').style.display = info.canDock ? 'block' : 'none';
        document.getElementById('btnUndock').style.display='none';
      }
    }
    // Boton del Acople automatico (CW): visible solo en la mision ISS, si hay un objetivo
    // cerca o el acople esta activo. En pro.html/apolo11.html, el objetivo que ve
    // nearestDockingInfo() es la ISS-fantasma del sandbox (sin inclinacion), distinta de
    // la ISS real que usa el controlador CW -- no debe mostrarse ahi.
    // Subtitulo del panel: solo mientras el acople automatico esta en marcha, para que
    // quede claro que es un modelo simplificado (no simula sensores).
    const btnCWEl = document.getElementById('btnCW');
    const dhSubEl = document.getElementById('dhSubtitle');
    // El Shuttle tambien acopla con la ISS real -- misma condicion que el resolver de
    // docking (setDockingTargetResolver): dos sitios con la misma comprobacion, uno ya
    // arreglado y este sin arreglar habria dejado al Shuttle sin boton de acople jamas.
    const usesRealIssRendezvous = this.mission && (this.mission.type === 'iss' || this.mission.type === 'shuttle');
    if (btnCWEl && this.dockingAuto && usesRealIssRendezvous) {
      const cercaISS = info && info.dist < 200;
      const cwOn = this.dockingAuto.isActive();
      if (cwOn) {
        btnCWEl.style.display = 'block';
        btnCWEl.textContent = '⏹ Detener acople automático';
        btnCWEl.className = 'btn btn-danger';
      } else if (cercaISS) {
        btnCWEl.style.display = 'block';
        btnCWEl.textContent = '🛰️ Acople automático';
        btnCWEl.className = 'btn btn-warp';
      } else {
        btnCWEl.style.display = 'none';
      }
      if (dhSubEl) {
        dhSubEl.style.display = cwOn ? 'block' : 'none';
        // Generico (sin 'Kurs'): ese radar es especificamente sovietico/ruso, nunca lo
        // llevo el Shuttle -- mencionarlo en una mision Shuttle seria anacronico. El
        // mismo texto sirve para ambas naves sin tener que bifurcar por type.
        dhSubEl.textContent = cwOn ? 'acoplamiento automático simplificado · sin sensores de radar reales' : '';
      }
    } else {
      if (btnCWEl) btnCWEl.style.display = 'none';
      if (dhSubEl) dhSubEl.style.display = 'none';
    }

    // Pista contextual: cambia sola segun la fase de vuelo, para no depender de un consejo fijo
    // escondido en un footer que nadie relee una vez ha empezado a jugar.
    let hint=null;
    if (state.dockedTo){
      hint='🔗 Acoplado — da algo de gas para separarte';
    } else if (info && info.dist<10000){
      hint = info.canDock ? '🛰️ ¡Dentro de tolerancia! Pulsa Acoplar' : '🛰️ Iguala velocidad y acércate despacio';
    } else if (showLanding){
      if (state.vertSpeed<-30) hint='🛬 ¡Frena! Velocidad vertical peligrosa';
      else if (state.vertSpeed<-8) hint='🛬 Reduce la velocidad de descenso';
      else hint='🛬 Descenso controlado, sigue así';
    } else if (state.inOrbit){
      hint='🛰️ ¡En órbita! Prueba Prógrado/Retrógrado para maniobrar';
    } else if (state.reentry){
      hint='🔥 Reentrada atmosférica en curso';
    } else if (state.ascending){
      hint='📈 Sigue acelerando — vigila Velocidad frente a V. Orbital';
    } else if (state.body==='earth' && state.altitude>40000 && state.altitude<150000 && state.throttle>0.05){
      hint='🔄 Empieza a inclinar poco a poco hacia el horizonte';
    } else if (state.throttle>0.1 && state.altitude<40000){
      hint='🚀 Subiendo — mantén el cabeceo en 0° los primeros segundos';
    } else if (state.throttle<0.05 && state.altitude<100 && state.velocity<5){
      hint='🚀 Pulsa Lanzar para despegar';
    }
    const flightHint=document.getElementById('flightHint');
    if (hint){ flightHint.textContent=hint; flightHint.classList.add('show'); }
    else flightHint.classList.remove('show');

    // Eclipse (simplificacion: al ser orbitas coplanares, se alinea cada mes, no es tan raro como en la realidad)
    if (state.eclipse && !this.lastEclipse){
      this.toast.show(state.eclipse==='solar' ? '🌑 ECLIPSE SOLAR' : '🌕 ECLIPSE LUNAR', 4000);
    }
    this.lastEclipse = state.eclipse;
  }
  loop(){
    const now=performance.now();
    const rawDt=Math.min(0.05,(now-this.lastTime)/1000);
    this.lastTime=now;
    const FIXED_DT=1/60; // paso fijo para el piloto automatico: las maniobras de precision
    // (frenar justo al cruzar velocidad cero, converger la actitud) se probaron y calibraron
    // con este paso exacto. Usar el tiempo real del fotograma (que varia segun lo rapido que
    // vaya el ordenador dibujando la escena 3D) rompia esa precision en equipos mas lentos.

    let state=null;
    if (this.dockingAuto && this.dockingAuto.isActive()){
      const autoControls = this.dockingAuto.step();
      if (autoControls) {
        this.controls = autoControls;
        state = this.physics.step(FIXED_DT, autoControls);
      } else {
        state = this.physics.getState();
      }
    } else if (this.missionAuto.active){
      if (!this.missionAuto.paused){
        const ticks=Math.max(1,Math.min(20,this.missionAuto.speed||1));
        for (let i=0;i<ticks;i++){
          const autoControls=this.missionAuto.step();
          if (!autoControls) break;
          this.controls=autoControls;
          state=this.physics.step(FIXED_DT,autoControls);
          if (!this.missionAuto.active) break;
        }
      }
      if (!state) state=this.physics.getState();
    } else {
      if (this.controls.autopilot!=='off'){
        const p=this.physics;
        const speed=Math.sqrt(p.u*p.u+p.v*p.v+p.w*p.w);
        let dir;
        if (this.controls.autopilot==='hold' && this.holdDir){
          dir=this.holdDir;
        } else if (speed<0.5){
          dir=RocketPhysics.rotateVec(0,1,0,p.pitch,p.yaw,p.roll); // sin velocidad: mantener rumbo actual
        } else {
          dir = this.controls.autopilot==='retrograde'
            ? {x:-p.u/speed,y:-p.v/speed,z:-p.w/speed}
            : {x:p.u/speed,y:p.v/speed,z:p.w/speed};
        }
        const steer=p.autopilotSteer(dir);
        this.controls.pitch=steer.pitch; this.controls.yaw=steer.yaw; this.controls.roll=steer.roll;
      }
      // Con el motor encendido en modo manual, el timeScale elegido (x100 por defecto,
      // hasta x3.000.000) puede comprimir una quema entera en menos de un par de segundos
      // de reloj real, sin margen para bajar el gas a tiempo (medido: una quema de 185s
      // simulados con timeScale=100 dura 1,85s reales). Mientras el motor esta encendido,
      // se limita a x5 (37s reales para esos mismos 185s) -- el timeScale elegido por el
      // jugador se conserva sin tocar y vuelve a aplicarse en cuanto se suelta el motor.
      const effectiveControls = (this.controls.throttle>0 && this.controls.timeScale>5)
        ? {...this.controls, timeScale:5}
        : this.controls;
      state=this.physics.step(rawDt,effectiveControls);
    }

    if (this.sound.enabled) this.sound.update(state.throttle,state.rpm,state.gForce,state.velocity,state.altitude);
    this.updateUI(state);
    this.checkMissionProgress(state);
    if (this.mission) this.updateMissionHud(state);
    if (this.mapOpen) this.drawMap(state);
    else this.renderer.update(state, rawDt, (this.missionAuto && (this.missionAuto.active || this._keepPhaseAfterEnd())) ? this.missionAuto.phase : null);
    requestAnimationFrame(()=>this.loop());
  }
  updateMissionHud(state){
    if (!this.mission) return;
    document.getElementById('mhStages').innerHTML = this.mission.stages.map(st=>
      `<span class="mh-stage${st.done?' done':''}">${st.done?'✓':'○'} ${st.label}</span>`
    ).join(' &nbsp; ');
    const ms=this.mission.milestones;
    if (ms && state){
      const next=ms.find(m=>m.t>state.time);
      const hud=document.getElementById('mhNext');
      if (hud){
        if (next){
          const diff=next.t-state.time;
          hud.textContent = (diff<0?'⏰ YA TOCABA — ':'⏳ En '+formatElapsed(diff)+' — ')+next.label;
        } else {
          hud.textContent = '✅ Cronología real completada';
        }
      }
    }
    const btnRet=document.getElementById('btnReturn');
    if (btnRet) btnRet.style.display = (this.mission.returnTrip && state && state.body==='moon' && state.altitude<5 && state.velocity<5 && !this.missionAuto.active && this.physics.stack.stages.length===1) ? 'block' : 'none';
    const btnMissionAuto=document.getElementById('btnMissionAuto');
    const statusEl=document.getElementById('mhAutoStatus');
    if (btnMissionAuto && statusEl){
      if (this.missionAuto.active){
        btnMissionAuto.textContent='⏹️ Detener piloto automático';
        statusEl.style.display='block';
        statusEl.textContent='🤖 '+this.missionAuto.statusLabel()+'...';
      } else if (btnMissionAuto.textContent!=='▶️ Ver misión automática'){
        // el piloto se paro solo (exito, fallo, o combustible agotado): reflejarlo en el boton
        btnMissionAuto.textContent='▶️ Ver misión automática';
        if (this.missionAuto.phase==='done' || this.missionAuto.phase==='art_done' || this.missionAuto.phase==='ret_done'){ statusEl.textContent='🎉 Completado automáticamente'; }
        else if (this.missionAuto.failed){ statusEl.style.display='block'; statusEl.textContent='⛔ '+this.missionAuto.failed+' (puedes seguir a mano)'; }
        else { statusEl.style.display='none'; }
      }
    }
  }
  checkMissionProgress(state){
    if (!this.mission) return;
    let changed=false;
    for (const st of this.mission.stages){
      if (!st.done && st.check(state)){
        st.done=true; changed=true;
        this.toast.show(st.msg, 5000);
      }
    }
    if (changed) this.updateMissionHud(state);
  }
  resizeMapCanvas(){
    const canvas=document.getElementById('mapCanvas');
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1, 3);
    canvas.width=rect.width*dpr; canvas.height=rect.height*dpr;
    canvas.style.width=rect.width+'px'; canvas.style.height=rect.height+'px';
    this._mapDpr=dpr;
  }
  drawMap(state){
    const canvas=document.getElementById('mapCanvas');
    const ctx=canvas.getContext('2d');
    const dpr=this._mapDpr||1;
    const w=canvas.width/dpr, h=canvas.height/dpr;
    if (w===0||h===0) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#03030a'; ctx.fillRect(0,0,w,h);
    const cx=w/2, cy=h/2;

    const minPPA=3.5, maxPPA=25000;
    const ppa = minPPA*Math.pow(maxPPA/minPPA, this.mapZoomVal);
    const ppm = ppa/AU;

    let center={x:0,z:0};
    if (this.mapCenterMode==='ship') center={x:state.shipAbs.x,z:state.shipAbs.z};
    else if (this.mapCenterMode!=='sun' && state.bodies[this.mapCenterMode]) center={x:state.bodies[this.mapCenterMode].x,z:state.bodies[this.mapCenterMode].z};

    const toScreen=(x,z)=>({x:cx+(x-center.x)*ppm, y:cy+(z-center.z)*ppm});

    // cinturon de Kuiper
    const sunS=toScreen(0,0);
    ctx.strokeStyle='rgba(138,120,96,0.8)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(sunS.x,sunS.y,41*AU*ppm,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(sunS.x,sunS.y,48*AU*ppm,0,Math.PI*2); ctx.stroke();

    // orbita de Halley (elipse real, muestreada)
    ctx.strokeStyle='rgba(200,220,255,0.35)';
    ctx.beginPath();
    for (let i=0;i<=64;i++){
      const M=(i/64)*2*Math.PI;
      const E=(function(M,e){let E=M;for(let k=0;k<20;k++){E-=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));}return E;})(M,0.96658);
      const a=HALLEY.a;
      const r=a*(1-0.96658*Math.cos(E));
      const nu=2*Math.atan2(Math.sqrt(1.96658)*Math.sin(E/2),Math.sqrt(0.03342)*Math.cos(E/2));
      const xo=r*Math.cos(nu), zo=r*Math.sin(nu)*Math.cos(2.83);
      const s=toScreen(xo,zo);
      if (i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y);
    }
    ctx.closePath(); ctx.stroke();

    // orbitas y cuerpos
    const colorOf=(name)=>{
      const c={earth:0x3a8fd9, moon:0xaaaaaa}[name];
      if (c!==undefined) return c;
      return (SOLAR_BODIES[name]&&SOLAR_BODIES[name].color) || 0xffffff;
    };
    const DISPLAY_NAME={
      earth:'Tierra', moon:'Luna', mars:'Marte', jupiter:'Júpiter',
      io:'Ío', europa:'Europa', ganymede:'Ganímedes', callisto:'Calisto',
      saturn:'Saturno', titan:'Titán', uranus:'Urano', neptune:'Neptuno', pluto:'Plutón'
    };
    function drawLabel(text,x,y){
      ctx.font='11px "Courier New",monospace';
      ctx.lineWidth=3; ctx.strokeStyle='rgba(3,3,10,0.9)';
      ctx.strokeText(text,x,y);
      ctx.fillStyle='#e8e8f0';
      ctx.fillText(text,x,y);
    }
    // El factor de achatamiento es cos(inclinacion axial real) -- vistos desde arriba (el
    // mapa es siempre una vista de planta), Saturno (26.73 grados de inclinacion) se ve casi
    // circular, mientras que Urano (97.77 grados, practicamente tumbado de lado) se ve casi
    // de canto, como una linea. Antes ambos se dibujaban como circulos identicos con
    // ctx.arc(), perdiendo esta diferencia real tan marcada entre los dos.
    const RING_INFO={
      saturn:{inner:1.3, outer:2.3, rgb:'216,201,160', flatten:Math.abs(Math.cos(26.73*Math.PI/180))},
      uranus:{inner:1.6, outer:2.0, rgb:'85,101,112', flatten:Math.abs(Math.cos(97.77*Math.PI/180))}
    };
    SOLAR_BODY_NAMES.forEach(name=>{
      const b=SOLAR_BODIES[name];
      const parentPos = b.parent==='sun' ? {x:0,z:0} : state.bodies[b.parent];
      const parentScreen = toScreen(parentPos.x, parentPos.z);
      ctx.strokeStyle='rgba(120,140,160,0.18)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(parentScreen.x,parentScreen.y,b.a*ppm,0,Math.PI*2); ctx.stroke();

      const pos=state.bodies[name];
      const s=toScreen(pos.x,pos.z);
      const isMoon = b.parent!=='sun';
      const minDotR = isMoon ? 2 : 4;
      const realR = b.radius*ppm; // tamaño real a este zoom: crece de verdad al ampliar
      const dotR = Math.max(minDotR, realR);
      const hex='#'+colorOf(name).toString(16).padStart(6,'0');

      const ring=RING_INFO[name];
      if (ring && realR>1.5){
        ctx.strokeStyle=`rgba(${ring.rgb},0.65)`;
        // Grosor de linea real del anillo, no un donut grueso: antes casi igual al radio del
        // planeta (outer-inner=1.0*realR); un anillo real es fino comparado con el planeta.
        ctx.lineWidth=Math.max(1,(ring.outer-ring.inner)*realR*0.35);
        const rMean=(ring.inner+ring.outer)/2*realR;
        ctx.beginPath(); ctx.ellipse(s.x,s.y,rMean,rMean*ring.flatten,0,0,Math.PI*2); ctx.stroke();
      }

      // Indicador de altura sobre el plano de la eclíptica: anillo azul si esta por encima,
      // ambar si por debajo, mas intenso cuanto mayor sea la desviacion (util ahora que las
      // orbitas tienen inclinacion real y ya no estan todas en el mismo plano).
      const heightAU=pos.y/AU;
      if (Math.abs(heightAU)>0.001){
        const heightOpacity=Math.min(0.85, Math.abs(heightAU)/2);
        ctx.strokeStyle = heightAU>0 ? `rgba(100,180,255,${heightOpacity})` : `rgba(255,170,80,${heightOpacity})`;
        ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(s.x,s.y,dotR+3,0,Math.PI*2); ctx.stroke();
      }

      ctx.beginPath(); ctx.arc(s.x,s.y,dotR,0,Math.PI*2); ctx.fillStyle=hex; ctx.fill();
      // las lunas necesitan mas zoom antes de mostrar su nombre, si no se amontonan sobre su planeta
      const labelThreshold = isMoon ? 400 : 15;
      if (ppa>labelThreshold){
        const heightTxt = Math.abs(heightAU)>0.01 ? ` (${heightAU>0?'+':''}${heightAU.toFixed(2)} UA)` : '';
        drawLabel((DISPLAY_NAME[name]||name)+heightTxt, s.x+dotR+3, s.y+3);
      }
    });

    // Sol
    ctx.beginPath(); ctx.arc(sunS.x,sunS.y,6,0,Math.PI*2); ctx.fillStyle='#ffcc66'; ctx.fill();
    if (ppa>3) drawLabel('Sol', sunS.x+9, sunS.y+3);

    // Halley (posicion actual)
    const hs=toScreen(state.bodies.halley.x, state.bodies.halley.z);
    ctx.beginPath(); ctx.arc(hs.x,hs.y,2.5,0,Math.PI*2); ctx.fillStyle='#ddeeff'; ctx.fill();
    if (ppa>3) drawLabel('Halley', hs.x+6, hs.y+3);

    // nave
    const shipS=toScreen(state.shipAbs.x, state.shipAbs.z);
    ctx.beginPath(); ctx.arc(shipS.x,shipS.y,4,0,Math.PI*2); ctx.fillStyle='#ff3333'; ctx.fill();
    ctx.strokeStyle='#ff3333'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(shipS.x,shipS.y,8,0,Math.PI*2); ctx.stroke();
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  try {
    const app=new RocketSimApp();
    document.addEventListener('click',()=>{ if (!app.sound.enabled) app.sound.init(); });
    document.addEventListener('keydown',(e)=>{
      if (e.key===' '||e.key==='l'){ document.getElementById('btnLaunch').click(); e.preventDefault(); }
      if (e.key==='r') document.getElementById('btnReset').click();
      if (e.key==='h') document.getElementById('btnHyperspace').click();
      if (e.key==='w') document.getElementById('btnWarp').click();
      if (e.key==='v') document.getElementById('btnToggleView').click();
    });
  } catch(err){
    const el=document.getElementById('statusMsg');
    el.style.display='block';
    el.textContent='⚠️ Error al iniciar: '+err.message;
    console.error(err);
  }
});
