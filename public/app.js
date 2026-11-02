// ============================================================================
// TruckMap GPS Nativo — Renderizador Vetorial SCS Route Advisor (60-120 FPS)
// ============================================================================

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

// Elementos do HUD
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingTitle = document.getElementById('loadingTitle');
const loadingSub = document.getElementById('loadingSub');

const maneuverCard = document.getElementById('maneuverCard');
const maneuverSvg = document.getElementById('maneuverSvg');
const maneuverDist = document.getElementById('maneuverDist');
const maneuverText = document.getElementById('maneuverText');
const routeModeBadge = document.getElementById('routeModeBadge');
const routeTargetLabel = document.getElementById('routeTargetLabel');
const routeRemDist = document.getElementById('routeRemDist');
const routeRemTime = document.getElementById('routeRemTime');
const routeEtaClock = document.getElementById('routeEtaClock');
const btnClearRoute = document.getElementById('btnClearRoute');

const mapViewport = document.getElementById('mapViewport');
const mapSelector = document.getElementById('mapSelector');
const btnSearchDrawer = document.getElementById('btnSearchDrawer');
const btnCameraMode = document.getElementById('btnCameraMode');
const cameraModeLabel = document.getElementById('cameraModeLabel');
const btnUnitsToggle = document.getElementById('btnUnitsToggle');
const unitsBtnLabel = document.getElementById('unitsBtnLabel');
const btnSimToggle = document.getElementById('btnSimToggle');
const simBtnLabel = document.getElementById('simBtnLabel');
const btnSettingsModal = document.getElementById('btnSettingsModal');
const btnFullscreen = document.getElementById('btnFullscreen');

const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const cfgUrlsBox = document.getElementById('cfgUrlsBox');
const cfgCameraView = document.getElementById('cfgCameraView');
const cfgUnitsMode = document.getElementById('cfgUnitsMode');
const cfgEts2Path = document.getElementById('cfgEts2Path');
const cfgEts2ModPath = document.getElementById('cfgEts2ModPath');
const cfgAtsPath = document.getElementById('cfgAtsPath');
const cfgPluginStatus = document.getElementById('cfgPluginStatus');
const btnSaveConfig = document.getElementById('btnSaveConfig');
const btnReextractMaps = document.getElementById('btnReextractMaps');

const jobCard = document.getElementById('jobCard');
const jobCardHeader = document.getElementById('jobCardHeader');
const jobStatusDot = document.getElementById('jobStatusDot');
const jobHeaderTitle = document.getElementById('jobHeaderTitle');
const jobCargoText = document.getElementById('jobCargoText');
const jobOriginText = document.getElementById('jobOriginText');
const jobDestText = document.getElementById('jobDestText');
const jobIncomeText = document.getElementById('jobIncomeText');
const jobDamageText = document.getElementById('jobDamageText');

const btnRecenter = document.getElementById('btnRecenter');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');

const mapPinPopup = document.getElementById('mapPinPopup');
const pinPopupType = document.getElementById('pinPopupType');
const pinPopupTitle = document.getElementById('pinPopupTitle');
const btnRouteHere = document.getElementById('btnRouteHere');
const btnAddStopHere = document.getElementById('btnAddStopHere');
const btnClosePinPopup = document.getElementById('btnClosePinPopup');

const speedLimitSign = document.getElementById('speedLimitSign');
const speedLimitValue = document.getElementById('speedLimitValue');
const speedometerBox = document.getElementById('speedometerBox');
const currentSpeedValue = document.getElementById('currentSpeedValue');
const speedUnitLabel = document.getElementById('speedUnitLabel');
const currentGearBadge = document.getElementById('currentGearBadge');
const cruiseControlBadge = document.getElementById('cruiseControlBadge');
const cruiseSpeedVal = document.getElementById('cruiseSpeedVal');

const connStatusDot = document.getElementById('connStatusDot');
const connStatusText = document.getElementById('connStatusText');
const restAdvisorItem = document.getElementById('restAdvisorItem');
const restStopValue = document.getElementById('restStopValue');
const fuelAdvisorItem = document.getElementById('fuelAdvisorItem');
const fuelReserveFill = document.getElementById('fuelReserveFill');
const fuelMainFill = document.getElementById('fuelMainFill');
const fuelValue = document.getElementById('fuelValue');
const gameClockValue = document.getElementById('gameClockValue');

const searchDrawer = document.getElementById('searchDrawer');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');
const searchInput = document.getElementById('searchInput');
const searchResultsList = document.getElementById('searchResultsList');
const drawerTabs = document.querySelectorAll('.drawer-tab');

// Estado Global do App
let currentMapId = '';
let mapData = null;
let spatialGrid = null;
const GRID_CELL = 2000;

let appState = {
  connected: false,
  simulating: false,
  activeMapId: 'ets2_rbr',
  game: 'ets2',
  truck: {
    x: -2450,
    y: -1200,
    headingRad: 0,
    speedKph: 0,
    speedMph: 0,
    cruiseControlKph: 0,
    cruiseControlActive: false,
    gear: 0,
    fuelAmount: 600,
    fuelRangeKm: 1850,
    fuelWarning: false,
    damagePercent: 0,
  },
  navigation: {
    speedLimitKph: 80,
    speedLimitMph: 50,
    nextRestStopMinutes: 660,
    gameTimeFormatted: 'Seg 12:00',
  },
  job: {
    hasActiveJob: false,
  },
};

let activeRoute = null;

// Câmera e Interpolação Suave (60-120 FPS)
const camera = {
  x: -2450,
  y: -1200,
  scale: 0.65, // pixels por metro do mundo
  targetScale: 0.65,
  rotationRad: 0,
  mode: 'flat-north', // 'flat-north' | 'flat-heading' | '3d-heading' | 'free'
  lastFollowMode: 'flat-north',
  userZoomOverride: null,
};

const smoothTruck = {
  x: -2450,
  y: -1200,
  headingRad: 0,
  initialized: false,
};

let selectedPin = null;
let activeSearchTab = 'cities';
let audioBeepEnabled = true;
let lastOverspeedBeep = 0;
let useImperialUnits = false; // Padrão sempre Métrico Brasileiro: km/h, km e kg!

// ============================================================================
// 1. CARREGAMENTO DO MAPA E INDEXAÇÃO ESPACIAL NO CLIENTE
// ============================================================================

async function loadMap(mapId) {
  if (!mapId || currentMapId === mapId) return;
  currentMapId = mapId;
  mapSelector.value = mapId;

  loadingOverlay.classList.remove('hidden');
  const titles = {
    ets2_rbr: 'Carregando ETS2 — Mapa RBR (Brasil)...',
    ats: 'Carregando American Truck Simulator (EUA)...',
    ets2_europe: 'Carregando Euro Truck Simulator 2 (Europa)...',
  };
  loadingTitle.textContent = titles[mapId] || `Carregando ${mapId}...`;
  loadingSub.textContent = 'Montando malha viária vetorial de alta precisão (0.00m erro)';

  try {
    const res = await fetch(`/api/map/${mapId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mapData = data;
    buildClientSpatialGrid(data);

    // Ajusta estilo da placa de velocidade (EUA vs Mercosul/Europa)
    if (mapId === 'ats') {
      speedLimitSign.classList.remove('eu-sign');
      speedLimitSign.classList.add('us-sign');
    } else {
      speedLimitSign.classList.remove('us-sign');
      speedLimitSign.classList.add('eu-sign');
    }

    renderSearchList();
  } catch (err) {
    console.error('Erro ao carregar mapa:', err);
    loadingSub.textContent = 'Erro ao carregar mapa. Tentando novamente...';
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

function buildClientSpatialGrid(data) {
  const roadsGrid = new Map();
  const prefabsGrid = new Map();
  const polysGrid = new Map();
  const lodChunks = new Map();
  const LOD_CHUNK_SIZE = 12000;

  const insertBBox = (grid, minX, minY, maxX, maxY, idx) => {
    const gx0 = Math.floor(minX / GRID_CELL);
    const gx1 = Math.floor(maxX / GRID_CELL);
    const gy0 = Math.floor(minY / GRID_CELL);
    const gy1 = Math.floor(maxY / GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx},${gy}`;
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(idx);
      }
    }
  };

  const computeBBox = (pts) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  };

  // Mapa rápido de extremidades de estradas para que os prefabs herdem a cor/largura da rodovia conectada
  const endpointClassMap = new Map();
  const snapKey = (x, y) => `${Math.round(x / 8)},${Math.round(y / 8)}`;
  const recordEndpoint = (x, y, cls) => {
    const k = snapKey(x, y);
    const cur = endpointClassMap.get(k);
    if (cur === undefined || cls < cur) endpointClassMap.set(k, cls);
  };

  const globalHwPath = new Path2D();
  const globalPriPath = new Path2D();
  const globalLocPath = new Path2D();

  const getLodChunk = (cx, cy) => {
    const k = `${cx},${cy}`;
    let ch = lodChunks.get(k);
    if (!ch) {
      ch = {
        hwPath: new Path2D(),
        priPath: new Path2D(),
        locPath: new Path2D(),
        hasHw: false,
        hasPri: false,
        hasLoc: false,
      };
      lodChunks.set(k, ch);
    }
    return ch;
  };

  const addSimplifiedToPath = (p2d, pts) => {
    const n = pts.length;
    p2d.moveTo(pts[0], pts[1]);
    if (n >= 10) {
      const mid = (n >> 2) << 1;
      p2d.lineTo(pts[mid], pts[mid + 1]);
    }
    p2d.lineTo(pts[n - 2], pts[n - 1]);
  };

  for (let i = 0; i < data.roads.length; i++) {
    const r = data.roads[i];
    const pts = r[0];
    if (!pts || pts.length < 4) continue;
    const rType = r[1];
    const cls = rType === 0 || rType === 1 ? 1 : rType === 2 ? 2 : 3;

    recordEndpoint(pts[0], pts[1], cls);
    recordEndpoint(pts[pts.length - 2], pts[pts.length - 1], cls);

    const [minX, minY, maxX, maxY] = computeBBox(pts);
    insertBBox(roadsGrid, minX, minY, maxX, maxY, i);

    const cx = Math.floor(((minX + maxX) * 0.5) / LOD_CHUNK_SIZE);
    const cy = Math.floor(((minY + maxY) * 0.5) / LOD_CHUNK_SIZE);
    const ch = getLodChunk(cx, cy);

    if (cls === 1) {
      addSimplifiedToPath(ch.hwPath, pts);
      addSimplifiedToPath(globalHwPath, pts);
      ch.hasHw = true;
    } else if (cls === 2) {
      addSimplifiedToPath(ch.priPath, pts);
      addSimplifiedToPath(globalPriPath, pts);
      ch.hasPri = true;
    } else {
      addSimplifiedToPath(ch.locPath, pts);
      if (Math.hypot(maxX - minX, maxY - minY) > 65) {
        addSimplifiedToPath(globalLocPath, pts);
      }
      ch.hasLoc = true;
    }
  }

  const prefabClasses = new Uint8Array(data.prefabCurves.length);
  for (let i = 0; i < data.prefabCurves.length; i++) {
    const pf = data.prefabCurves[i];
    const pts = pf[0];
    if (!pts || pts.length < 4) continue;
    const [minX, minY, maxX, maxY] = computeBBox(pts);
    insertBBox(prefabsGrid, minX, minY, maxX, maxY, i);

    const cStart = endpointClassMap.get(snapKey(pts[0], pts[1])) || 3;
    const cEnd = endpointClassMap.get(snapKey(pts[pts.length - 2], pts[pts.length - 1])) || 3;
    const bestCls = pf[1] === 1 ? 1 : Math.min(cStart, cEnd);
    prefabClasses[i] = bestCls;

    const cx = Math.floor(((minX + maxX) * 0.5) / LOD_CHUNK_SIZE);
    const cy = Math.floor(((minY + maxY) * 0.5) / LOD_CHUNK_SIZE);
    const ch = getLodChunk(cx, cy);
    if (bestCls === 1) {
      addSimplifiedToPath(ch.hwPath, pts);
      addSimplifiedToPath(globalHwPath, pts);
      ch.hasHw = true;
    } else if (bestCls === 2) {
      addSimplifiedToPath(ch.priPath, pts);
      addSimplifiedToPath(globalPriPath, pts);
      ch.hasPri = true;
    }
  }

  for (let i = 0; i < data.polygons.length; i++) {
    const pts = data.polygons[i][0];
    if (!pts || pts.length < 6) continue;
    const [minX, minY, maxX, maxY] = computeBBox(pts);
    insertBBox(polysGrid, minX, minY, maxX, maxY, i);
  }

  spatialGrid = {
    roadsGrid,
    prefabsGrid,
    polysGrid,
    prefabClasses,
    lodChunks,
    LOD_CHUNK_SIZE,
    globalHwPath,
    globalPriPath,
    globalLocPath,
  };
}

// ============================================================================
// 2. RENDERIZADOR CANVAS 2D FIEL AO ROUTE ADVISOR DA SCS
// ============================================================================

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function shortestAngleDiff(fromRad, toRad) {
  let diff = (toRad - fromRad) % (Math.PI * 2);
  if (diff <= -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return diff;
}

function updateCameraAndInterpolation() {
  if (!smoothTruck.initialized) {
    smoothTruck.x = appState.truck.x;
    smoothTruck.y = appState.truck.y;
    smoothTruck.headingRad = appState.truck.headingRad || 0;
    camera.x = smoothTruck.x;
    camera.y = smoothTruck.y;
    smoothTruck.initialized = true;
  } else {
    const distJump = Math.hypot(appState.truck.x - smoothTruck.x, appState.truck.y - smoothTruck.y);
    if (distJump > 400) {
      smoothTruck.x = appState.truck.x;
      smoothTruck.y = appState.truck.y;
      smoothTruck.headingRad = appState.truck.headingRad || 0;
    } else {
      smoothTruck.x += (appState.truck.x - smoothTruck.x) * 0.22;
      smoothTruck.y += (appState.truck.y - smoothTruck.y) * 0.22;
      smoothTruck.headingRad += shortestAngleDiff(smoothTruck.headingRad, appState.truck.headingRad || 0) * 0.2;
    }
  }

  if (camera.mode !== 'free') {
    camera.x += (smoothTruck.x - camera.x) * 0.25;
    camera.y += (smoothTruck.y - camera.y) * 0.25;

    if (camera.mode === 'flat-heading' || camera.mode === '3d-heading') {
      const targetRot = -smoothTruck.headingRad;
      camera.rotationRad += shortestAngleDiff(camera.rotationRad, targetRot) * 0.18;
    } else {
      camera.rotationRad += shortestAngleDiff(camera.rotationRad, 0) * 0.22;
    }

    // Zoom adaptativo por velocidade (se o usuário não fixou um zoom manual)
    if (camera.userZoomOverride === null) {
      const spd = appState.truck.speedKph || 0;
      if (spd > 85) camera.targetScale = 0.48;
      else if (spd > 45) camera.targetScale = 0.65;
      else camera.targetScale = 0.85;
    } else {
      camera.targetScale = camera.userZoomOverride;
    }
  } else {
    camera.rotationRad += shortestAngleDiff(camera.rotationRad, 0) * 0.25;
  }

  camera.scale += (camera.targetScale - camera.scale) * 0.2;
}

function getAnchorYRatio() {
  if (camera.mode === '3d-heading') return 0.68;
  if (camera.mode === 'flat-heading') return 0.62;
  return 0.5;
}

/**
 * Converte coordenada do mundo (x, y) para pixel na tela considerando posição, escala e rotação da câmera
 */
function worldToScreen(wx, wy, w, h, anchorYRatio) {
  const dx = (wx - camera.x) * camera.scale;
  const dy = (wy - camera.y) * camera.scale;
  const cos = Math.cos(camera.rotationRad);
  const sin = Math.sin(camera.rotationRad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return [w * 0.5 + rx, h * anchorYRatio + ry];
}

function screenToWorld(sx, sy, w, h, anchorYRatio) {
  const rx = sx - w * 0.5;
  const ry = sy - h * anchorYRatio;
  const cos = Math.cos(-camera.rotationRad);
  const sin = Math.sin(-camera.rotationRad);
  const dx = (rx * cos - ry * sin) / camera.scale;
  const dy = (rx * sin + ry * cos) / camera.scale;
  return [camera.x + dx, camera.y + dy];
}

function drawPolylinePath(pts) {
  if (!pts || pts.length < 4) return;
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(pts[i], pts[i + 1]);
  }
}

let chevronAnimOffset = 0;

function renderFrame() {
  requestAnimationFrame(renderFrame);
  updateCameraAndInterpolation();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.width;
  const h = canvas.height;
  const anchorYRatio = getAnchorYRatio();

  // 1. Fundo escuro oficial Route Advisor
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#10151d';
  ctx.fillRect(0, 0, w, h);

  if (!mapData || !spatialGrid) return;

  const effectiveScale = camera.scale * dpr;

  // Calcula bounding box visível no mundo para culling na grade espacial
  const diagRadiusWorld = Math.hypot(w, h * 1.4) / effectiveScale;
  const minWx = camera.x - diagRadiusWorld;
  const maxWx = camera.x + diagRadiusWorld;
  const minWy = camera.y - diagRadiusWorld;
  const maxWy = camera.y + diagRadiusWorld;

  const minPx = (px) => px / effectiveScale;

  // Aplica transformação de câmera no mundo Prism3D
  ctx.save();
  ctx.translate(w * 0.5, h * anchorYRatio);
  ctx.rotate(camera.rotationRad);
  ctx.scale(effectiveScale, effectiveScale);
  ctx.translate(-camera.x, -camera.y);

  // ==========================================================================
  // MODO OTIMIZADO (LOD PATH2D GPU) QUANDO O ZOOM ESTÁ AFASTADO (< 0.16)
  // ==========================================================================
  if (camera.scale < 0.16) {
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'bevel';

    const wHwLod = Math.max(22.0, minPx(4.2));
    const wPriLod = Math.max(17.0, minPx(3.2));
    const wLocLod = Math.max(12.0, minPx(2.0));

    if (camera.scale < 0.045) {
      // Visão Geral do País / Continente — 3 chamadas diretas na GPU (Zero Lag!)
      if (camera.scale > 0.025) {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = wLocLod;
        ctx.stroke(spatialGrid.globalLocPath);
      }
      ctx.strokeStyle = '#e5c967';
      ctx.lineWidth = wPriLod;
      ctx.stroke(spatialGrid.globalPriPath);

      ctx.strokeStyle = '#eea63a';
      ctx.lineWidth = wHwLod;
      ctx.stroke(spatialGrid.globalHwPath);
    } else {
      // Visão Regional — Culling por Super-Chunks de 12km pré-compilados em Path2D
      const cs = spatialGrid.LOD_CHUNK_SIZE;
      const cx0 = Math.floor(minWx / cs);
      const cx1 = Math.floor(maxWx / cs);
      const cy0 = Math.floor(minWy / cs);
      const cy1 = Math.floor(maxWy / cs);
      const visibleChunks = [];
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const ch = spatialGrid.lodChunks.get(`${cx},${cy}`);
          if (ch) visibleChunks.push(ch);
        }
      }

      ctx.strokeStyle = '#7c8ea6';
      ctx.lineWidth = wLocLod;
      for (let i = 0; i < visibleChunks.length; i++) {
        if (visibleChunks[i].hasLoc) ctx.stroke(visibleChunks[i].locPath);
      }

      ctx.strokeStyle = '#e5c967';
      ctx.lineWidth = wPriLod;
      for (let i = 0; i < visibleChunks.length; i++) {
        if (visibleChunks[i].hasPri) ctx.stroke(visibleChunks[i].priPath);
      }

      ctx.strokeStyle = '#eea63a';
      ctx.lineWidth = wHwLod;
      for (let i = 0; i < visibleChunks.length; i++) {
        if (visibleChunks[i].hasHw) ctx.stroke(visibleChunks[i].hwPath);
      }
    }
  } else {
    // ========================================================================
    // MODO DETALHADO (ZOOM PRÓXIMO >= 0.16) — VIAS MAIS GROSSAS + DUAS VIAS
    // ========================================================================
    const gx0 = Math.floor(minWx / GRID_CELL);
    const gx1 = Math.floor(maxWx / GRID_CELL);
    const gy0 = Math.floor(minWy / GRID_CELL);
    const gy1 = Math.floor(maxWy / GRID_CELL);

    const visibleRoads = new Set();
    const visiblePrefabs = new Set();
    const visiblePolys = new Set();

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx},${gy}`;
        const rList = spatialGrid.roadsGrid.get(key);
        if (rList) for (let i = 0; i < rList.length; i++) visibleRoads.add(rList[i]);
        const pList = spatialGrid.prefabsGrid.get(key);
        if (pList) for (let i = 0; i < pList.length; i++) visiblePrefabs.add(pList[i]);
        const polyList = spatialGrid.polysGrid.get(key);
        if (polyList) for (let i = 0; i < polyList.length; i++) visiblePolys.add(polyList[i]);
      }
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 2. Polígonos de Pátios / Empresas / Postos (mapAreas)
    if (visiblePolys.size > 0) {
      ctx.fillStyle = '#1b2330';
      ctx.strokeStyle = '#263142';
      ctx.lineWidth = Math.max(1.5, 1.5 / effectiveScale);
      ctx.beginPath();
      for (const idx of visiblePolys) {
        const pts = mapData.polygons[idx][0];
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    // Larguras mais encorpadas para diferenciar perfeitamente pistas de mão dupla (duas vias) e mão única
    const wHw2 = Math.max(25.5, minPx(11.2));
    const wHw1 = Math.max(18.5, minPx(8.2));
    const wPri2 = Math.max(22.0, minPx(9.6));
    const wPri1 = Math.max(16.0, minPx(7.2));
    const wLoc2 = Math.max(18.0, minPx(7.8));
    const wLoc1 = Math.max(14.0, minPx(6.2));
    const wCasingExtra = Math.max(5.2, minPx(2.8));

    const hw2 = [], hw1 = [];
    const pri2 = [], pri1 = [];
    const loc2 = [], loc1 = [];
    const dirt = [];
    const twoLaneDividers = [];

    for (const idx of visibleRoads) {
      const r = mapData.roads[idx];
      const rType = r[1];
      const lanesL = r[2] ?? 1;
      const lanesR = r[3] ?? 1;
      const isTwoWay = lanesL > 0 && lanesR > 0;
      const hasMultiLanes = isTwoWay || (lanesL + lanesR >= 2);

      if (rType === 0 || rType === 1) {
        if (isTwoWay) hw2.push(r[0]);
        else hw1.push(r[0]);
        if (hasMultiLanes) twoLaneDividers.push(r[0]);
      } else if (rType === 2) {
        if (isTwoWay) pri2.push(r[0]);
        else pri1.push(r[0]);
        if (hasMultiLanes) twoLaneDividers.push(r[0]);
      } else if (rType === 4) {
        dirt.push(r[0]);
      } else {
        if (isTwoWay) loc2.push(r[0]);
        else loc1.push(r[0]);
        if (hasMultiLanes) twoLaneDividers.push(r[0]);
      }
    }

    // Prefabs herdam a classe e a espessura da via conectada (sem trechos cinzas finos no meio da rodovia!)
    for (const idx of visiblePrefabs) {
      const pts = mapData.prefabCurves[idx][0];
      const pCls = spatialGrid.prefabClasses[idx] || 3;
      if (pCls === 1) hw1.push(pts);
      else if (pCls === 2) pri1.push(pts);
      else loc1.push(pts);
    }

    const strokeGroup = (arr, width, color) => {
      if (arr.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) drawPolylinePath(arr[i]);
      ctx.stroke();
    };

    // 3A. Borda Externa Escura (Road Casing)
    strokeGroup(loc1, wLoc1 + wCasingExtra, '#070a0f');
    strokeGroup(loc2, wLoc2 + wCasingExtra, '#070a0f');
    strokeGroup(dirt, wLoc1 + wCasingExtra, '#070a0f');
    strokeGroup(pri1, wPri1 + wCasingExtra, '#070a0f');
    strokeGroup(pri2, wPri2 + wCasingExtra, '#070a0f');
    strokeGroup(hw1, wHw1 + wCasingExtra, '#070a0f');
    strokeGroup(hw2, wHw2 + wCasingExtra, '#070a0f');

    // 3B. Preenchimento das Vias
    strokeGroup(dirt, wLoc1, '#9c7b56');
    strokeGroup(loc1, wLoc1, '#8b9bb1');
    strokeGroup(loc2, wLoc2, '#8b9bb1');
    strokeGroup(pri1, wPri1, '#e5c967');
    strokeGroup(pri2, wPri2, '#e5c967');
    strokeGroup(hw1, wHw1, '#eea63a');
    strokeGroup(hw2, wHw2, '#eea63a');

    // 3C. Linha Divisória Central separando nitidamente as Duas Vias / Faixas
    if (twoLaneDividers.length > 0 && camera.scale >= 0.18) {
      strokeGroup(twoLaneDividers, Math.max(2.2, minPx(1.5)), 'rgba(12, 17, 25, 0.72)');
    }
  }

  // 4. ROTA GPS ATIVA (100% Cravada na Geometria das Estradas e Trevos — 0.00m Erro!)
  if (activeRoute && activeRoute.points && activeRoute.points.length >= 4) {
    const rPts = activeRoute.points;
    const progIdx = Math.max(0, Math.min((rPts.length / 2) - 1, activeRoute.progressIdx || 0));
    const wRoute = Math.max(11.5, minPx(6.5));

    // Trecho já percorrido (discreto)
    if (progIdx > 0) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = wRoute * 0.75;
      ctx.beginPath();
      ctx.moveTo(rPts[0], rPts[1]);
      for (let i = 1; i <= progIdx; i++) {
        ctx.lineTo(rPts[i * 2], rPts[i * 2 + 1]);
      }
      ctx.stroke();
    }

    // Borda escura da rota à frente
    ctx.strokeStyle = '#4c0505';
    ctx.lineWidth = wRoute + Math.max(4.0, minPx(2.6));
    ctx.beginPath();
    ctx.moveTo(rPts[progIdx * 2], rPts[progIdx * 2 + 1]);
    for (let i = progIdx + 1; i < rPts.length / 2; i++) {
      ctx.lineTo(rPts[i * 2], rPts[i * 2 + 1]);
    }
    ctx.stroke();

    // Preenchimento Vermelho Vivo SCS Route Advisor
    ctx.strokeStyle = '#ff2424';
    ctx.lineWidth = wRoute;
    ctx.stroke();

    // Brilho central da rota
    ctx.strokeStyle = '#ff7b7b';
    ctx.lineWidth = wRoute * 0.32;
    ctx.stroke();

    // Chevrons direcionais brancos animados ao longo da rota
    if (camera.scale > 0.12) {
      chevronAnimOffset = (chevronAnimOffset + 0.35) % 90;
      const stepWorld = Math.max(65, 55 / effectiveScale);
      let acc = chevronAnimOffset;
      ctx.fillStyle = '#ffffff';
      for (let i = progIdx; i < (rPts.length / 2) - 1; i++) {
        const ax = rPts[i * 2], ay = rPts[i * 2 + 1];
        const bx = rPts[(i + 1) * 2], by = rPts[(i + 1) * 2 + 1];
        const segLen = Math.hypot(bx - ax, by - ay);
        while (acc < segLen) {
          const t = acc / segLen;
          const cx = ax + (bx - ax) * t;
          const cy = ay + (by - ay) * t;
          const ang = Math.atan2(by - ay, bx - ax);
          const sz = wRoute * 0.38;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(sz, 0);
          ctx.lineTo(-sz * 0.7, -sz * 0.75);
          ctx.lineTo(-sz * 0.3, 0);
          ctx.lineTo(-sz * 0.7, sz * 0.75);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          acc += stepWorld;
        }
        acc -= segLen;
      }
    }
  }

  ctx.restore();

  // ==========================================================================
  // 5. CAMADA DE ÍCONES E RÓTULOS SEMPRE EM PÉ (SCREEN-SPACE UPRIGHT)
  // ==========================================================================

  // 5A. Ícones de POIs (Postos, Descanso, Oficinas, Balanças, Balsas)
  if (camera.scale > 0.18) {
    const iconRadius = camera.scale > 0.45 ? 11 * dpr : 8.5 * dpr;
    for (let i = 0; i < mapData.pois.length; i++) {
      const [type, px, py] = mapData.pois[i];
      if (type === 'road') continue;
      if (px < minWx || px > maxWx || py < minWy || py > maxWy) continue;
      if (camera.scale < 0.28 && type !== 'gas' && type !== 'rest' && type !== 'ferry') continue;

      const [sx, sy] = worldToScreen(px, py, w, h, anchorYRatio);
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

      drawPoiBadge(sx, sy, iconRadius, type, dpr);
    }
  }

  // 5B. Empresas (quando o zoom está próximo)
  if (camera.scale > 0.32) {
    ctx.font = `700 ${Math.round(10.5 * dpr)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < mapData.companies.length; i++) {
      const comp = mapData.companies[i];
      const cx = comp[3], cy = comp[4];
      if (cx < minWx || cx > maxWx || cy < minWy || cy > maxWy) continue;
      const [sx, sy] = worldToScreen(cx, cy, w, h, anchorYRatio);
      if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) continue;

      // Ponto de empresa
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(sx, sy, 5.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.8 * dpr, 0, Math.PI * 2);
      ctx.fill();

      if (camera.scale > 0.48) {
        const label = comp[1];
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(10, 14, 21, 0.92)';
        ctx.strokeText(label, sx, sy + 7 * dpr);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(label, sx, sy + 7 * dpr);
      }
    }
  }

  // 5C. Bandeiras de Paradas e Destino Final da Rota
  if (activeRoute && activeRoute.stops) {
    for (let i = 0; i < activeRoute.stops.length; i++) {
      const st = activeRoute.stops[i];
      const [sx, sy] = worldToScreen(st.x, st.y, w, h, anchorYRatio);
      const isFinal = i === activeRoute.stops.length - 1;

      // Halo pulsante
      ctx.fillStyle = isFinal ? 'rgba(255, 41, 41, 0.28)' : 'rgba(0, 229, 255, 0.28)';
      ctx.beginPath();
      ctx.arc(sx, sy, 18 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Pino principal
      ctx.fillStyle = isFinal ? '#ff2929' : '#00e5ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.arc(sx, sy, 9 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Nome do Destino
      ctx.font = `800 ${Math.round(12.5 * dpr)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = '#090d14';
      ctx.strokeText(st.label, sx, sy - 13 * dpr);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(st.label, sx, sy - 13 * dpr);
    }
  }

  // 5D. Pino de Seleção Ao Clicar no Mapa
  if (selectedPin) {
    const [sx, sy] = worldToScreen(selectedPin.x, selectedPin.y, w, h, anchorYRatio);
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, 14 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5E. Rótulos das Cidades (Sempre em Pé + Anti-Colisão em Zoom Afastado!)
  ctx.font = `800 ${Math.round(13.5 * dpr)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const occupiedLabelBoxes = camera.scale < 0.12 ? [] : null;
  for (let i = 0; i < mapData.cities.length; i++) {
    const city = mapData.cities[i];
    const cx = city[3], cy = city[4];
    if (cx < minWx || cx > maxWx || cy < minWy || cy > maxWy) continue;
    const [sx, sy] = worldToScreen(cx, cy, w, h, anchorYRatio);
    if (sx < -60 || sx > w + 60 || sy < -30 || sy > h + 30) continue;

    if (occupiedLabelBoxes) {
      let overlaps = false;
      for (let j = 0; j < occupiedLabelBoxes.length; j++) {
        if (Math.abs(sx - occupiedLabelBoxes[j][0]) < 88 * dpr && Math.abs(sy - occupiedLabelBoxes[j][1]) < 24 * dpr) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      occupiedLabelBoxes.push([sx, sy]);
    }

    ctx.lineWidth = 4.2 * dpr;
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.92)';
    ctx.strokeText(city[1], sx, sy);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(city[1], sx, sy);
  }

  // 6. SETA DO CAMINHÃO (ESTILO SCS NAVIGATION ARROW COM CONE DE LUZ)
  const [tx, ty] = worldToScreen(smoothTruck.x, smoothTruck.y, w, h, anchorYRatio);
  const truckScreenAngle = smoothTruck.headingRad + camera.rotationRad;

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(truckScreenAngle);

  // Cone de visão frontal
  const coneGrad = ctx.createRadialGradient(0, 0, 4 * dpr, 0, -28 * dpr, 44 * dpr);
  coneGrad.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
  coneGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
  ctx.fillStyle = coneGrad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 46 * dpr, -Math.PI * 0.72, -Math.PI * 0.28);
  ctx.closePath();
  ctx.fill();

  // Halo redondo sob o caminhão
  ctx.fillStyle = 'rgba(0, 229, 255, 0.22)';
  ctx.beginPath();
  ctx.arc(0, 0, 17 * dpr, 0, Math.PI * 2);
  ctx.fill();

  // Seta SCS Azul/Ciano com borda branca
  const sz = 14.5 * dpr;
  ctx.fillStyle = '#00e5ff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.6 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, -sz * 1.15);
  ctx.lineTo(sz * 0.85, sz * 0.95);
  ctx.lineTo(0, sz * 0.45);
  ctx.lineTo(-sz * 0.85, sz * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawPoiBadge(x, y, r, type, dpr) {
  let bg = '#334155';
  let sym = '•';
  if (type === 'gas') { bg = '#059669'; sym = '⛽'; }
  else if (type === 'rest') { bg = '#2563eb'; sym = 'P'; }
  else if (type === 'service') { bg = '#ea580c'; sym = '🔧'; }
  else if (type === 'weigh') { bg = '#ca8a04'; sym = '⚖'; }
  else if (type === 'ferry' || type === 'train') { bg = '#0891b2'; sym = '⚓'; }
  else if (type === 'garage' || type === 'dealer') { bg = '#7c3aed'; sym = 'G'; }

  ctx.fillStyle = bg;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(r * 1.05)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sym, x, y + 0.5 * dpr);
}

// ============================================================================
// 3. ATUALIZAÇÃO DO HUD, MANOBRAS TURN-BY-TURN E ALERTAS
// ============================================================================

function getManeuverSvgMarkup(type) {
  const stroke = 'stroke="#ffffff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"';
  switch (type) {
    case 'turn-left':
      return `<path ${stroke} d="M32 40V22a6 6 0 0 0-6-6H12"/><polyline ${stroke} points="20 8 10 16 20 24"/>`;
    case 'turn-right':
      return `<path ${stroke} d="M16 40V22a6 6 0 0 1 6-6h14"/><polyline ${stroke} points="28 8 38 16 28 24"/>`;
    case 'keep-left':
      return `<path ${stroke} d="M28 40V26L14 10"/><polyline ${stroke} points="12 20 14 10 24 12"/>`;
    case 'keep-right':
      return `<path ${stroke} d="M20 40V26L34 10"/><polyline ${stroke} points="24 12 34 10 36 20"/>`;
    case 'turn-sharp-left':
      return `<path ${stroke} d="M34 38V14L12 32"/><polyline ${stroke} points="12 20 12 32 24 32"/>`;
    case 'turn-sharp-right':
      return `<path ${stroke} d="M14 38V14L36 32"/><polyline ${stroke} points="24 32 36 32 36 20"/>`;
    case 'uturn':
      return `<path ${stroke} d="M32 38V18a8 8 0 0 0-16 0v18"/><polyline ${stroke} points="8 28 16 38 24 28"/>`;
    case 'arrive':
      return `<circle cx="24" cy="20" r="9" stroke="#f5a623" stroke-width="4"/><path stroke="#ffffff" stroke-width="4" stroke-linecap="round" d="M24 29v11"/>`;
    default:
      return `<line ${stroke} x1="24" y1="40" x2="24" y2="10"/><polyline ${stroke} points="14 20 24 10 34 20"/>`;
  }
}

function formatDistance(meters, isAts) {
  if (isAts) {
    const miles = meters / 1609.34;
    if (miles < 0.2) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function playOverspeedBeep() {
  if (!audioBeepEnabled) return;
  const now = Date.now();
  if (now - lastOverspeedBeep < 5000) return;
  lastOverspeedBeep = now;
  try {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, actx.currentTime);
    gain.gain.setValueAtTime(0.06, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start();
    osc.stop(actx.currentTime + 0.18);
  } catch { /* ignore */ }
}

function updateHud() {
  const isAts = currentMapId === 'ats';
  const useMph = useImperialUnits;
  const t = appState.truck || {};
  const nav = appState.navigation || {};
  const job = appState.job || {};

  // Status de Conexão
  if (appState.connected) {
    connStatusDot.className = 'conn-dot online';
    connStatusText.textContent = appState.paused ? 'Jogo Pausado' : 'Conectado ao Jogo';
  } else {
    connStatusDot.className = 'conn-dot offline';
    connStatusText.textContent = 'Aguardando Jogo (Auto)';
  }

  // Velocidade e Limite (Sempre km/h por padrão, mesmo no ATS!)
  const spd = useMph ? (t.speedMph || Math.round((t.speedKph || 0) * 0.621371)) : (t.speedKph || 0);
  const limit = useMph ? (nav.speedLimitMph || Math.round((nav.speedLimitKph || 0) * 0.621371)) : (nav.speedLimitKph || 0);
  currentSpeedValue.textContent = spd;
  speedUnitLabel.textContent = useMph ? 'mph' : 'km/h';
  speedLimitValue.textContent = limit > 0 ? limit : '—';
  unitsBtnLabel.textContent = useMph ? 'mph · lb' : 'km/h · kg';

  const gear = t.gear || 0;
  currentGearBadge.textContent = gear > 0 ? `D${gear}` : gear < 0 ? `R${Math.abs(gear)}` : 'N';

  if (t.cruiseControlActive && t.cruiseControlKph > 0) {
    cruiseControlBadge.classList.remove('hidden');
    cruiseSpeedVal.textContent = useMph ? Math.round(t.cruiseControlKph * 0.621371) : t.cruiseControlKph;
  } else {
    cruiseControlBadge.classList.add('hidden');
  }

  if (limit > 0 && spd > limit + (useMph ? 3 : 5)) {
    speedometerBox.classList.add('overspeed');
    playOverspeedBeep();
  } else {
    speedometerBox.classList.remove('overspeed');
  }

  // Fadiga / Próximo Descanso
  const restMin = nav.nextRestStopMinutes ?? 660;
  const rHours = Math.max(0, Math.floor(restMin / 60));
  const rMins = Math.max(0, restMin % 60);
  restStopValue.textContent = `${String(rHours).padStart(2, '0')}h ${String(rMins).padStart(2, '0')}m`;
  restAdvisorItem.classList.remove('warn', 'danger');
  if (restMin <= 45) restAdvisorItem.classList.add('danger');
  else if (restMin <= 110) restAdvisorItem.classList.add('warn');

  // Combustível + Barra Dividida (Reserva 15% | Tanque Principal 85%)
  const fuelAmt = Math.max(0, t.fuelAmount ?? 600);
  const fuelCap = Math.max(100, t.fuelCapacity || Math.max(700, fuelAmt));
  const fuelPct = Math.max(0, Math.min(1, fuelAmt / fuelCap));
  const reserveRatio = 0.15; // 15% do tanque = Reserva oficial SCS

  const resFillPct = Math.min(1, fuelPct / reserveRatio) * 100;
  const mainFillPct = fuelPct > reserveRatio ? ((fuelPct - reserveRatio) / (1 - reserveRatio)) * 100 : 0;

  if (fuelReserveFill) fuelReserveFill.style.width = `${resFillPct.toFixed(1)}%`;
  if (fuelMainFill) {
    fuelMainFill.style.width = `${mainFillPct.toFixed(1)}%`;
    fuelMainFill.classList.toggle('low', fuelPct <= 0.30);
  }

  fuelValue.textContent = `${fuelAmt} L (${t.fuelRangeKm || 0} km)`;
  fuelAdvisorItem.classList.toggle('danger', !!(t.fuelWarning || fuelPct <= reserveRatio));

  // Relógio do Jogo
  gameClockValue.textContent = nav.gameTimeFormatted || 'Seg 12:00';

  // Card de Entrega (Job) — Sempre visível e aberto embaixo do tempo da rota!
  if (job.hasActiveJob) {
    jobStatusDot.className = job.mustPickUp ? 'job-status-dot pickup' : 'job-status-dot active';
    jobHeaderTitle.textContent = job.mustPickUp
      ? `Coletar: ${job.sourceCity}`
      : `Entrega: ${job.destCity}`;
    const massStr = job.cargoMassKg
      ? useMph
        ? ` (${Math.round(job.cargoMassKg * 2.20462).toLocaleString('pt-BR')} lb)`
        : ` (${Math.round(job.cargoMassKg).toLocaleString('pt-BR')} kg)`
      : '';
    jobCargoText.textContent = `${job.cargoName || 'Carga'}${massStr}`;
    jobOriginText.textContent = `${job.sourceCompany} · ${job.sourceCity}`;
    jobDestText.textContent = `${job.destCompany} · ${job.destCity}`;
    const currency = currentMapId === 'ets2_rbr' ? 'R$' : isAts ? 'US$' : '€';
    jobIncomeText.textContent = `${currency} ${(job.income || 0).toLocaleString('pt-BR')}`;
    jobDamageText.textContent = `${job.cargoDamagePercent || 0}% / ${t.damagePercent || 0}%`;
  } else {
    jobStatusDot.className = 'job-status-dot';
    jobHeaderTitle.textContent = 'Sem Entrega Ativa (Livre)';
    jobCargoText.textContent = '—';
    jobOriginText.textContent = '—';
    jobDestText.textContent = '—';
    jobIncomeText.textContent = '—';
    jobDamageText.textContent = `0% / ${t.damagePercent || 0}%`;
  }

  // Card de Manobra e Tempo da Rota (Sempre visível acima do Card de Entrega)
  if (activeRoute) {
    btnClearRoute.classList.remove('hidden');
    const man = activeRoute.nextManeuver || { type: 'straight', text: 'Siga na rodovia', distanceMeters: 0 };
    maneuverSvg.innerHTML = getManeuverSvgMarkup(man.type);
    maneuverDist.textContent = formatDistance(man.distanceMeters ?? 0, useMph);
    maneuverText.textContent = man.text || 'Siga na via';

    routeModeBadge.className = 'route-mode-badge';
    if (activeRoute.mode === 'job-pickup') {
      routeModeBadge.classList.add('pickup');
      routeModeBadge.textContent = 'INDO COLETAR';
    } else if (activeRoute.mode === 'manual') {
      routeModeBadge.classList.add('manual');
      routeModeBadge.textContent = 'ROTA MANUAL';
    } else if (activeRoute.mode === 'save-waypoints') {
      routeModeBadge.textContent = 'MAPA DO JOGO';
    } else {
      routeModeBadge.textContent = 'EM ENTREGA';
    }

    routeTargetLabel.textContent = activeRoute.label || 'Destino';
    routeRemDist.textContent = formatDistance(activeRoute.remainingMeters || 0, useMph);
    routeRemTime.textContent = formatDuration(activeRoute.remainingSeconds || 0);

    const etaDate = new Date(Date.now() + (activeRoute.remainingSeconds || 0) * 1000);
    routeEtaClock.textContent = `${String(etaDate.getHours()).padStart(2, '0')}:${String(etaDate.getMinutes()).padStart(2, '0')}`;
  } else {
    btnClearRoute.classList.add('hidden');
    maneuverSvg.innerHTML = getManeuverSvgMarkup('straight');
    maneuverDist.textContent = '—';
    maneuverText.textContent = 'Aguardando rota';
    routeModeBadge.className = 'route-mode-badge';
    routeModeBadge.textContent = 'GPS PRONTO';
    routeTargetLabel.textContent = 'Sem destino ativo';
    routeRemDist.textContent = useMph ? '-- mi' : '-- km';
    routeRemTime.textContent = '-- min';
    routeEtaClock.textContent = '--:--';
  }
}

// ============================================================================
// 4. INTERAÇÃO TOUCH (GALAXY TAB S10 FE) E MOUSE (2ª TELA DO PC)
// ============================================================================

let pointers = new Map();
let isPanning = false;
let dragDistance = 0;
let lastPanMid = null;
let lastPinchDist = null;

function setCameraMode(mode) {
  camera.mode = mode;
  if (mode !== 'free') {
    camera.lastFollowMode = mode;
  }

  if (mode === '3d-heading') {
    mapViewport.classList.remove('flat-view');
    mapViewport.classList.add('perspective-3d');
  } else {
    mapViewport.classList.remove('perspective-3d');
    mapViewport.classList.add('flat-view');
  }

  if (mode === 'free') {
    btnRecenter.classList.remove('hidden');
    btnCameraMode.classList.remove('active');
    cameraModeLabel.textContent = 'Mapa Livre';
  } else {
    btnRecenter.classList.add('hidden');
    btnCameraMode.classList.add('active');
    if (mode === 'flat-north') cameraModeLabel.textContent = 'Plana (Norte)';
    else if (mode === 'flat-heading') cameraModeLabel.textContent = 'Plana (Siga)';
    else if (mode === '3d-heading') cameraModeLabel.textContent = '3D (GPS)';
  }
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragDistance = 0;

  if (pointers.size === 1) {
    isPanning = true;
    lastPanMid = { x: e.clientX, y: e.clientY };
  } else if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    lastPanMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1 && isPanning && lastPanMid) {
    const dx = e.clientX - lastPanMid.x;
    const dy = e.clientY - lastPanMid.y;
    dragDistance += Math.hypot(dx, dy);
    if (dragDistance > 6 && camera.mode !== 'free') {
      setCameraMode('free');
    }
    if (camera.mode === 'free') {
      const cos = Math.cos(-camera.rotationRad);
      const sin = Math.sin(-camera.rotationRad);
      camera.x -= (dx * cos - dy * sin) / camera.scale;
      camera.y -= (dx * sin + dy * cos) / camera.scale;
    }
    lastPanMid = { x: e.clientX, y: e.clientY };
  } else if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (lastPinchDist && lastPinchDist > 10) {
      const ratio = dist / lastPinchDist;
      camera.targetScale = Math.max(0.015, Math.min(3.5, camera.targetScale * ratio));
      camera.scale = camera.targetScale;
      camera.userZoomOverride = camera.targetScale;
    }
    lastPinchDist = dist;
  }
});

function handlePointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    if (isPanning && dragDistance < 7) {
      handleMapClick(e.clientX, e.clientY);
    }
    isPanning = false;
    lastPanMid = null;
    lastPinchDist = null;
  }
}

canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', handlePointerUp);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.22 : 1 / 1.22;
    camera.targetScale = Math.max(0.015, Math.min(3.5, camera.targetScale * factor));
    camera.userZoomOverride = camera.targetScale;
  },
  { passive: false }
);

function handleMapClick(clientX, clientY) {
  if (!mapData) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const anchorYRatio = getAnchorYRatio();
  const [wx, wy] = screenToWorld(clientX * dpr, clientY * dpr, canvas.width, canvas.height, anchorYRatio);

  const pickRadiusWorld = 28 / camera.scale;
  let bestMatch = null;
  let bestDist = pickRadiusWorld;

  // 1. Verifica se clicou numa Empresa
  for (const comp of mapData.companies) {
    const d = Math.hypot(comp[3] - wx, comp[4] - wy);
    if (d < bestDist) {
      bestDist = d;
      bestMatch = {
        type: 'EMPRESA SELECIONADA',
        title: `${comp[1]} (${comp[2]})`,
        x: comp[3],
        y: comp[4],
        nodeIdx: comp[5],
      };
    }
  }

  // 2. Verifica se clicou numa Cidade
  if (!bestMatch) {
    for (const city of mapData.cities) {
      const d = Math.hypot(city[3] - wx, city[4] - wy);
      if (d < bestDist * 1.4) {
        bestDist = d;
        bestMatch = {
          type: 'CIDADE SELECIONADA',
          title: city[1],
          x: city[3],
          y: city[4],
          nodeIdx: city[5],
        };
      }
    }
  }

  // 3. Verifica se clicou num Posto / Descanso / Oficina
  if (!bestMatch) {
    const poiNames = {
      gas: 'Posto de Combustível',
      rest: 'Área de Descanso',
      service: 'Oficina Mecânica',
      weigh: 'Balança Rodoviária',
      ferry: 'Terminal de Balsa',
      garage: 'Garagem',
      dealer: 'Concessionária',
    };
    for (const poi of mapData.pois) {
      const d = Math.hypot(poi[1] - wx, poi[2] - wy);
      if (d < bestDist) {
        bestDist = d;
        bestMatch = {
          type: 'PONTO DE INTERESSE',
          title: poiNames[poi[0]] || 'Ponto de Interesse',
          x: poi[1],
          y: poi[2],
          nodeIdx: poi[3],
        };
      }
    }
  }

  // 4. Ponto livre na rodovia
  if (!bestMatch) {
    bestMatch = {
      type: 'MARCADOR NO MAPA',
      title: `Ponto na Via (${Math.round(wx)}, ${Math.round(wy)})`,
      x: wx,
      y: wy,
    };
  }

  selectedPin = bestMatch;
  pinPopupType.textContent = bestMatch.type;
  pinPopupTitle.textContent = bestMatch.title;
  mapPinPopup.classList.remove('hidden');
}

async function requestManualRoute(target, addStop = false) {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapId: currentMapId,
        targetX: target.x,
        targetY: target.y,
        targetNodeIdx: target.nodeIdx,
        label: target.title || target.label,
        addStop,
      }),
    });
    const data = await res.json();
    if (data.ok && data.route) {
      activeRoute = data.route;
      selectedPin = null;
      mapPinPopup.classList.add('hidden');
      searchDrawer.classList.add('hidden');
      updateHud();
    }
  } catch (e) {
    console.error('Erro ao traçar rota:', e);
  }
}

// ============================================================================
// 5. EVENTOS DE BOTÕES E GAVETA DE BUSCA DE DESTINOS
// ============================================================================

btnRouteHere.addEventListener('click', () => {
  if (selectedPin) requestManualRoute(selectedPin, false);
});

btnAddStopHere.addEventListener('click', () => {
  if (selectedPin) requestManualRoute(selectedPin, true);
});

btnClosePinPopup.addEventListener('click', () => {
  selectedPin = null;
  mapPinPopup.classList.add('hidden');
});

btnClearRoute.addEventListener('click', async () => {
  await fetch('/api/route/clear', { method: 'POST' });
  activeRoute = null;
  updateHud();
});

btnRecenter.addEventListener('click', () => {
  camera.userZoomOverride = null;
  setCameraMode(camera.lastFollowMode || 'flat-north');
});

btnCameraMode.addEventListener('click', () => {
  if (camera.mode === 'flat-north') setCameraMode('flat-heading');
  else if (camera.mode === 'flat-heading') setCameraMode('3d-heading');
  else setCameraMode('flat-north');
});

btnUnitsToggle.addEventListener('click', async () => {
  useImperialUnits = !useImperialUnits;
  updateHud();
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        units: useImperialUnits
          ? { speed: 'mph', distance: 'mi', weight: 'lb' }
          : { speed: 'kmh', distance: 'km', weight: 'kg' },
      }),
    });
  } catch { /* ignore */ }
});

btnZoomIn.addEventListener('click', () => {
  camera.targetScale = Math.min(3.5, camera.targetScale * 1.35);
  camera.userZoomOverride = camera.targetScale;
});

btnZoomOut.addEventListener('click', () => {
  camera.targetScale = Math.max(0.015, camera.targetScale / 1.35);
  camera.userZoomOverride = camera.targetScale;
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

// Modal de Configurações e Status
async function openSettingsModal() {
  settingsModal.classList.remove('hidden');
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const cfg = data.config || {};
    const port = data.port || 8765;
    const lanIp = (data.lanIps || []).find((ip) => ip.startsWith('192.168.')) || data.lanIps?.[0] || '192.168.1.103';

    cfgUrlsBox.innerHTML = `
      <div>🖥️ <strong>2ª Tela no PC:</strong> http://127.0.0.1:${port}</div>
      <div>📱 <strong>Tablet / Celular:</strong> http://${lanIp}:${port}</div>
    `;
    cfgCameraView.value = cfg.defaultCameraMode || camera.lastFollowMode || 'flat-north';
    cfgUnitsMode.value = cfg.units?.speed === 'mph' ? 'imperial' : 'metric';
    cfgEts2Path.value = cfg.ets2Path || '';
    cfgEts2ModPath.value = cfg.ets2ModPath || '';
    cfgAtsPath.value = cfg.atsPath || '';

    const ps = data.pluginStatus || {};
    cfgPluginStatus.textContent = `Plugin scs-telemetry.dll: ETS2 [${ps.ets2 ? 'Instalado ✓' : 'Pasta não encontrada'}] · ATS [${ps.ats ? 'Instalado ✓' : 'Pasta não encontrada'}]`;
  } catch {
    cfgUrlsBox.textContent = 'Erro ao carregar configurações.';
  }
}

btnSettingsModal.addEventListener('click', openSettingsModal);
btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

btnSaveConfig.addEventListener('click', async () => {
  const isImp = cfgUnitsMode.value === 'imperial';
  useImperialUnits = isImp;
  setCameraMode(cfgCameraView.value);
  updateHud();

  btnSaveConfig.textContent = 'Salvando...';
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultCameraMode: cfgCameraView.value,
        ets2Path: cfgEts2Path.value.trim(),
        ets2ModPath: cfgEts2ModPath.value.trim(),
        atsPath: cfgAtsPath.value.trim(),
        units: isImp
          ? { speed: 'mph', distance: 'mi', weight: 'lb' }
          : { speed: 'kmh', distance: 'km', weight: 'kg' },
      }),
    });
    const data = await res.json();
    const ps = data.pluginStatus || {};
    cfgPluginStatus.textContent = `Salvo! Plugin scs-telemetry.dll: ETS2 [${ps.ets2 ? 'Instalado ✓' : 'Pendente'}] · ATS [${ps.ats ? 'Instalado ✓' : 'Pendente'}]`;
  } finally {
    btnSaveConfig.textContent = 'Salvar e Instalar Plugin';
  }
});

btnReextractMaps.addEventListener('click', async () => {
  btnReextractMaps.textContent = 'Extraindo (.scs)... ~7s';
  btnReextractMaps.disabled = true;
  try {
    const res = await fetch('/api/extract-maps', { method: 'POST' });
    const data = await res.json();
    cfgPluginStatus.textContent = data.ok
      ? 'Mapas re-extraídos com sucesso dos arquivos .scs!'
      : 'Erro ao extrair mapas — verifique os caminhos das pastas.';
    currentMapId = '';
    await loadMap(appState.activeMapId || 'ets2_rbr');
  } finally {
    btnReextractMaps.textContent = 'Re-extrair Mapas (.scs)';
    btnReextractMaps.disabled = false;
  }
});

speedLimitSign.addEventListener('click', () => {
  audioBeepEnabled = !audioBeepEnabled;
  speedLimitSign.style.opacity = audioBeepEnabled ? '1' : '0.65';
});

mapSelector.addEventListener('change', async (e) => {
  const newMapId = e.target.value;
  await fetch('/api/select-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId: newMapId, lock: true }),
  });
  activeRoute = null;
  await loadMap(newMapId);
});

// Gaveta de Busca
btnSearchDrawer.addEventListener('click', () => {
  searchDrawer.classList.toggle('hidden');
  if (!searchDrawer.classList.contains('hidden')) {
    renderSearchList();
    searchInput.focus();
  }
});

btnCloseDrawer.addEventListener('click', () => {
  searchDrawer.classList.add('hidden');
});

drawerTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    drawerTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeSearchTab = tab.dataset.tab;
    renderSearchList();
  });
});

searchInput.addEventListener('input', renderSearchList);

function renderSearchList() {
  if (!mapData) return;
  const q = (searchInput.value || '').trim().toLowerCase();
  const tx = appState.truck.x;
  const ty = appState.truck.y;
  const items = [];

  if (activeSearchTab === 'cities') {
    for (const c of mapData.cities) {
      if (q && !c[1].toLowerCase().includes(q) && !c[0].toLowerCase().includes(q)) continue;
      const distKm = Math.hypot(c[3] - tx, c[4] - ty) / 1000;
      items.push({
        title: c[1],
        sub: `Cidade · ${distKm.toFixed(1)} km em linha reta`,
        x: c[3],
        y: c[4],
        nodeIdx: c[5],
        distKm,
      });
    }
  } else if (activeSearchTab === 'companies') {
    const cityMap = new Map(mapData.cities.map((c) => [c[0], c[1]]));
    for (const comp of mapData.companies) {
      const cityName = cityMap.get(comp[2]) || comp[2];
      const fullText = `${comp[1]} ${cityName}`.toLowerCase();
      if (q && !fullText.includes(q)) continue;
      const distKm = Math.hypot(comp[3] - tx, comp[4] - ty) / 1000;
      items.push({
        title: comp[1],
        sub: `${cityName} · ${distKm.toFixed(1)} km`,
        x: comp[3],
        y: comp[4],
        nodeIdx: comp[5],
        distKm,
      });
    }
  } else {
    const poiLabels = {
      gas: '⛽ Posto de Combustível',
      rest: '🛏️ Parada de Descanso',
      service: '🔧 Oficina Mecânica',
      weigh: '⚖️ Balança',
      ferry: '⚓ Balsa / Porto',
    };
    for (const p of mapData.pois) {
      if (p[0] === 'road') continue;
      const title = poiLabels[p[0]] || p[4] || p[0];
      if (q && !title.toLowerCase().includes(q)) continue;
      const distKm = Math.hypot(p[1] - tx, p[2] - ty) / 1000;
      items.push({
        title,
        sub: `Mais próximo · ${distKm.toFixed(1)} km`,
        x: p[1],
        y: p[2],
        nodeIdx: p[3],
        distKm,
      });
    }
  }

  items.sort((a, b) => a.distKm - b.distKm);
  const topItems = items.slice(0, 60);

  searchResultsList.innerHTML = '';
  for (const item of topItems) {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `
      <div class="result-info">
        <span class="result-title">${item.title}</span>
        <span class="result-sub">${item.sub}</span>
      </div>
      <div class="result-btns">
        <button class="res-btn go">Ir</button>
        <button class="res-btn add" title="Adicionar como Parada">+ Parada</button>
      </div>
    `;
    row.querySelector('.go').addEventListener('click', () => requestManualRoute(item, false));
    row.querySelector('.add').addEventListener('click', () => requestManualRoute(item, true));
    searchResultsList.appendChild(row);
  }
}

// ============================================================================
// 6. CONEXÃO WEBSOCKET EM TEMPO REAL (AUTO-RESUME ZERO CLIQUE)
// ============================================================================

function connectLiveSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'route') {
        activeRoute = msg.route;
        updateHud();
        return;
      }
      if (msg.type === 'state') {
        if (msg.activeMapId && msg.activeMapId !== currentMapId) {
          await loadMap(msg.activeMapId);
        }
        appState = msg;
        if (msg.route && activeRoute && msg.route.id === activeRoute.id) {
          activeRoute.progressIdx = msg.route.progressIdx;
          activeRoute.remainingMeters = msg.route.remainingMeters;
          activeRoute.remainingSeconds = msg.route.remainingSeconds;
          activeRoute.nextManeuver = msg.route.nextManeuver;
        } else if (!msg.route) {
          activeRoute = null;
        }
        updateHud();
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    setTimeout(connectLiveSocket, 1500);
  };
}

async function initApp() {
  try {
    const [cfgRes, stRes] = await Promise.all([fetch('/api/config'), fetch('/api/state')]);
    if (cfgRes.ok) {
      const cfgData = await cfgRes.json();
      const cfg = cfgData.config || {};
      useImperialUnits = cfg.units?.speed === 'mph';
      setCameraMode(cfg.defaultCameraMode || 'flat-north');
    } else {
      setCameraMode('flat-north');
    }
    const st = await stRes.json();
    appState = st;
    if (st.activeRoute) activeRoute = st.activeRoute;
    await loadMap(st.activeMapId || 'ets2_rbr');
    updateHud();
  } catch {
    setCameraMode('flat-north');
    await loadMap('ets2_rbr');
  }
  connectLiveSocket();
  requestAnimationFrame(renderFrame);
}

initApp();
