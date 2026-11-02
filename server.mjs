import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DOCUMENTS_DIR = path.join(os.homedir(), 'Documents');
const STEAM_DIR = 'C:\\Program Files (x86)\\Steam';

// Portas reservadas do sistema
const FORBIDDEN_PORTS = new Set([3050, 3051, 3060]);
const DEFAULT_PORT = 8765;

function loadConfig() {
  const defaults = {
    port: DEFAULT_PORT,
    ets2Path: 'E:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2',
    atsPath: 'T:\\SteamLibrary\\steamapps\\common\\American Truck Simulator',
    ets2ModPath: path.join(DOCUMENTS_DIR, 'Euro Truck Simulator 2', 'mod'),
    units: { speed: 'kmh', distance: 'km', weight: 'kg' },
    defaultCameraMode: 'flat-north',
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const merged = { ...defaults, ...parsed, units: { ...defaults.units, ...(parsed.units || {}) } };
      if (FORBIDDEN_PORTS.has(Number(merged.port))) merged.port = DEFAULT_PORT;
      return merged;
    }
  } catch { /* ignore */ }
  return defaults;
}

let appConfig = loadConfig();
const rawEnvPort = Number(process.env.PORT || appConfig.port || DEFAULT_PORT);
const PORT = FORBIDDEN_PORTS.has(rawEnvPort) ? DEFAULT_PORT : rawEnvPort;

const LOCAL_TELEMETRY_EXE = path.join(ROOT_DIR, 'bin', 'TruckNavTelemetry.exe');
const FALLBACK_TELEMETRY_EXE = 'C:\\Program Files\\TruckNav\\resources\\bin\\TruckNavTelemetry.exe';
const TELEMETRY_EXE = fs.existsSync(LOCAL_TELEMETRY_EXE) ? LOCAL_TELEMETRY_EXE : FALLBACK_TELEMETRY_EXE;
const LOCAL_PLUGIN_DLL = path.join(ROOT_DIR, 'bin', 'scs-telemetry.dll');
const TELEMETRY_WS_URL = 'ws://127.0.0.1:30001';

function getLocalLanIps() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function installPluginToGames() {
  const results = { ets2: false, ats: false, sourceDllExists: fs.existsSync(LOCAL_PLUGIN_DLL) };
  if (!results.sourceDllExists) return results;

  const tryInstall = (gameDir) => {
    if (!gameDir || !fs.existsSync(gameDir)) return false;
    const winX64 = path.join(gameDir, 'bin', 'win_x64');
    if (!fs.existsSync(winX64)) return false;
    const pluginsDir = path.join(winX64, 'plugins');
    const targetDll = path.join(pluginsDir, 'scs-telemetry.dll');
    try {
      fs.mkdirSync(pluginsDir, { recursive: true });
      if (!fs.existsSync(targetDll)) {
        fs.copyFileSync(LOCAL_PLUGIN_DLL, targetDll);
      }
      return fs.existsSync(targetDll);
    } catch {
      return fs.existsSync(targetDll);
    }
  };

  results.ets2 = tryInstall(appConfig.ets2Path);
  results.ats = tryInstall(appConfig.atsPath);
  return results;
}

// ============================================================================
// 1. CARREGADOR DE MAPAS, ÍNDICE ESPACIAL E ROTEADOR A* (0.00m DESALINHAMENTO)
// ============================================================================

const loadedMaps = new Map();
const gzipVisualCache = new Map();

function loadMapData(mapId) {
  if (loadedMaps.has(mapId)) return loadedMaps.get(mapId);
  const filePath = path.join(DATA_DIR, `${mapId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const t0 = performance.now();
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Normaliza nodesFlat -> nodes e objetos -> tuplas compactas para o servidor e o cliente PWA
  if (!raw.nodes && raw.nodesFlat) {
    const nodes = new Array(raw.nodesFlat.length / 3);
    for (let i = 0, j = 0; i < raw.nodesFlat.length; i += 3, j++) {
      nodes[j] = [raw.nodesFlat[i], raw.nodesFlat[i + 1], raw.nodesFlat[i + 2]];
    }
    raw.nodes = nodes;
  }
  if (raw.cities && raw.cities.length > 0 && !Array.isArray(raw.cities[0])) {
    raw.cities = raw.cities.map((c) => [c.token, c.name, c.country || '', c.x, c.y, c.nodeIdx]);
  }
  if (raw.companies && raw.companies.length > 0 && !Array.isArray(raw.companies[0])) {
    raw.companies = raw.companies.map((c) => [c.token, c.name, c.cityToken, c.x, c.y, c.nodeIdx, c.cityName || c.cityToken]);
  }
  if (raw.pois && raw.pois.length > 0 && !Array.isArray(raw.pois[0])) {
    raw.pois = raw.pois.map((p) => [p.type === 'fuel' ? 'gas' : p.type, p.x, p.y, p.nodeIdx, p.name || '']);
  }

  // Identifica a Componente Fortemente Conexa Direcionada (SCC: alcançável na ida E na volta)
  // a partir da 1ª cidade, garantindo que nenhum snap caia num beco sem saída unidirecional
  const nNodes = raw.nodes.length;
  const seedNode = raw.cities?.[0]?.[5] ?? 0;
  const fwd = new Uint8Array(nNodes);
  const revAdj = Array.from({ length: nNodes }, () => []);
  for (let u = 0; u < nNodes; u++) {
    for (const dir of [0, 1]) {
      const edges = raw.adj[u]?.[dir];
      if (!edges) continue;
      for (let i = 0; i < edges.length; i++) revAdj[edges[i][0]].push(u);
    }
  }
  const qF = [seedNode];
  fwd[seedNode] = 1;
  for (let qi = 0; qi < qF.length; qi++) {
    const u = qF[qi];
    for (const dir of [0, 1]) {
      const edges = raw.adj[u]?.[dir];
      if (!edges) continue;
      for (let i = 0; i < edges.length; i++) {
        const v = edges[i][0];
        if (!fwd[v]) { fwd[v] = 1; qF.push(v); }
      }
    }
  }
  const bwd = new Uint8Array(nNodes);
  const qB = [seedNode];
  bwd[seedNode] = 1;
  for (let qi = 0; qi < qB.length; qi++) {
    const u = qB[qi];
    const revs = revAdj[u];
    for (let i = 0; i < revs.length; i++) {
      const v = revs[i];
      if (!bwd[v]) { bwd[v] = 1; qB.push(v); }
    }
  }
  const validNodes = new Uint8Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    if (fwd[i] && bwd[i]) validNodes[i] = 1;
  }

  // Constrói índice espacial de arestas (grid de 500m) apenas com arestas navegáveis da malha principal
  const CELL = 500;
  const edgeGrid = new Map();
  const addEdgeToCell = (gx, gy, entry) => {
    const key = `${gx},${gy}`;
    let list = edgeGrid.get(key);
    if (!list) { list = []; edgeGrid.set(key, list); }
    list.push(entry);
  };

  const getEdgePoints = (geomType, geomIdx) => {
    if (geomType === 0) return raw.roads[geomIdx]?.[0] || null;
    if (geomType === 1) {
      const pts = raw.roads[geomIdx]?.[0];
      if (!pts) return null;
      const rev = [];
      for (let i = pts.length - 2; i >= 0; i -= 2) rev.push(pts[i], pts[i + 1]);
      return rev;
    }
    if (geomType === 2) return raw.prefabCurves[geomIdx]?.[0] || null;
    return null;
  };

  for (let u = 0; u < raw.adj.length; u++) {
    if (!validNodes[u]) continue;
    for (let dir = 0; dir < 2; dir++) {
      const edges = raw.adj[u][dir];
      if (!edges) continue;
      for (let ei = 0; ei < edges.length; ei++) {
        const edge = edges[ei];
        const [v, nextDir, dist, dur, geomType, geomIdx] = edge;
        if (!validNodes[v]) continue;
        const pts = getEdgePoints(geomType, geomIdx);
        let x0, y0, x1, y1;
        if (pts && pts.length >= 4) {
          x0 = pts[0]; y0 = pts[1];
          x1 = pts[pts.length - 2]; y1 = pts[pts.length - 1];
        } else {
          x0 = raw.nodes[u][0]; y0 = raw.nodes[u][1];
          x1 = raw.nodes[v][0]; y1 = raw.nodes[v][1];
        }
        const minGx = Math.floor(Math.min(x0, x1) / CELL);
        const maxGx = Math.floor(Math.max(x0, x1) / CELL);
        const minGy = Math.floor(Math.min(y0, y1) / CELL);
        const maxGy = Math.floor(Math.max(y0, y1) / CELL);
        const entry = { u, dir, v, nextDir, dist, dur, geomType, geomIdx };
        for (let gx = minGx; gx <= maxGx; gx++) {
          for (let gy = minGy; gy <= maxGy; gy++) {
            addEdgeToCell(gx, gy, entry);
          }
        }
      }
    }
  }

  // Gera o pacote visual (sem grafo pesado adj/nodes) já comprimido em GZIP para o tablet/PC
  const visualPayload = JSON.stringify({
    meta: raw.meta,
    roads: raw.roads,
    prefabCurves: raw.prefabCurves,
    polygons: raw.polygons,
    cities: raw.cities,
    companies: raw.companies,
    pois: raw.pois,
  });
  gzipVisualCache.set(mapId, zlib.gzipSync(Buffer.from(visualPayload, 'utf8')));

  const mapObj = { ...raw, validNodes, edgeGrid, CELL, getEdgePoints };
  loadedMaps.set(mapId, mapObj);
  console.log(`[Mapa] ${mapId} carregado e indexado em ${(performance.now() - t0).toFixed(0)}ms`);
  return mapObj;
}

/**
 * Encontra a aresta e o ponto projetado mais próximo do caminhão ou ponto clicado,
 * priorizando arestas alinhadas com o sentido de marcha (headingRad) para evitar retornos (laços).
 */
function snapPointToGraph(map, x, y, headingRad = null, maxRadius = 2500) {
  const { edgeGrid, CELL, getEdgePoints, nodes } = map;
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);

  let fx = 0, fy = 0, hasHeading = false;
  if (headingRad !== null && Number.isFinite(headingRad)) {
    fx = Math.sin(headingRad);
    fy = -Math.cos(headingRad);
    hasHeading = true;
  }

  let best = null;
  let bestScore = Infinity;

  const radii = [1, 2, 5];
  for (const rCells of radii) {
    if (rCells * CELL > maxRadius && best) break;
    const seen = new Set();
    for (let dx = -rCells; dx <= rCells; dx++) {
      for (let dy = -rCells; dy <= rCells; dy++) {
        const list = edgeGrid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const e of list) {
          const eKey = `${e.u}:${e.dir}:${e.v}:${e.geomIdx}`;
          if (seen.has(eKey)) continue;
          seen.add(eKey);

          const pts = getEdgePoints(e.geomType, e.geomIdx);
          if (pts && pts.length >= 4) {
            for (let i = 0; i < pts.length - 2; i += 2) {
              const ax = pts[i], ay = pts[i + 1];
              const bx = pts[i + 2], by = pts[i + 3];
              const vx = bx - ax, vy = by - ay;
              const lenSq = vx * vx + vy * vy;
              let t = 0;
              if (lenSq > 0.0001) {
                t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / lenSq));
              }
              const px = ax + t * vx;
              const py = ay + t * vy;
              const dist = Math.hypot(x - px, y - py);

              let headingPenalty = 0;
              if (hasHeading && lenSq > 0.01) {
                const segLen = Math.sqrt(lenSq);
                const tx = vx / segLen;
                const ty = vy / segLen;
                const dot = tx * fx + ty * fy; // +1 = mesmo sentido, -1 = contramão
                if (dot < -0.25) headingPenalty = 90; // forte penalidade para pista contrária
                else if (dot < 0.15) headingPenalty = 18;
              }

              const score = dist + headingPenalty;
              if (score < bestScore) {
                bestScore = score;
                best = {
                  edge: e,
                  projX: Math.round(px * 10) / 10,
                  projY: Math.round(py * 10) / 10,
                  dist,
                  segIndex: i,
                  pts,
                };
              }
            }
          } else {
            const ax = nodes[e.u][0], ay = nodes[e.u][1];
            const bx = nodes[e.v][0], by = nodes[e.v][1];
            const dist = Math.hypot(x - bx, y - by);
            if (dist < bestScore) {
              bestScore = dist;
              best = { edge: e, projX: bx, projY: by, dist, segIndex: 0, pts: [ax, ay, bx, by] };
            }
          }
        }
      }
    }
    if (best && best.dist < 65) break;
  }

  if (best) return best;

  // Fallback global para o nó navegável mais próximo
  let bestNode = map.cities?.[0]?.[5] ?? 0;
  let bestNodeDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (map.validNodes && !map.validNodes[i]) continue;
    const d = Math.hypot(nodes[i][0] - x, nodes[i][1] - y);
    if (d < bestNodeDist) {
      bestNodeDist = d;
      bestNode = i;
    }
  }
  return {
    edge: { u: bestNode, dir: 0, v: bestNode, nextDir: 0, dist: 0, dur: 0, geomType: 3, geomIdx: -1 },
    projX: nodes[bestNode][0],
    projY: nodes[bestNode][1],
    dist: bestNodeDist,
    segIndex: 0,
    pts: [nodes[bestNode][0], nodes[bestNode][1]],
  };
}

/**
 * Roteador A* em heap binário entre (startSnap ou startNodeIdx) e endNodeIdx.
 */
function findAStarSegment(map, startSnap, endNodeIdx) {
  const numStates = map.nodes.length * 2;
  const gScore = new Float64Array(numStates).fill(Infinity);
  const parentState = new Int32Array(numStates).fill(-1);
  const parentEdgeIdx = new Int16Array(numStates).fill(-1);
  const closed = new Uint8Array(numStates);

  const tx = map.nodes[endNodeIdx][0];
  const ty = map.nodes[endNodeIdx][1];

  const heapState = [];
  const heapF = [];
  const push = (st, f) => {
    let i = heapState.length;
    heapState.push(st);
    heapF.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapState[i] = heapState[p];
      heapF[i] = heapF[p];
      i = p;
    }
    heapState[i] = st;
    heapF[i] = f;
  };
  const pop = () => {
    const top = heapState[0];
    const lastSt = heapState.pop();
    const lastF = heapF.pop();
    if (heapState.length > 0) {
      let i = 0;
      const n = heapState.length;
      while ((i << 1) + 1 < n) {
        let c = (i << 1) + 1;
        if (c + 1 < n && heapF[c + 1] < heapF[c]) c++;
        if (lastF <= heapF[c]) break;
        heapState[i] = heapState[c];
        heapF[i] = heapF[c];
        i = c;
      }
      heapState[i] = lastSt;
      heapF[i] = lastF;
    }
    return top;
  };

  if (typeof startSnap === 'number') {
    for (const dir of [0, 1]) {
      const st = startSnap * 2 + dir;
      gScore[st] = 0;
      push(st, 0);
    }
  } else {
    // Começa na extremidade v da aresta onde o caminhão está projetado (sentido de marcha garantido)
    const vState = startSnap.edge.v * 2 + startSnap.edge.nextDir;
    gScore[vState] = 0;
    const h0 = Math.hypot(map.nodes[startSnap.edge.v][0] - tx, map.nodes[startSnap.edge.v][1] - ty) / 36.0;
    push(vState, h0);

    // Permite também o sentido oposto de v e u com penalidade para nunca travar em pátio/retorno
    for (const [nodeId, pen] of [[startSnap.edge.v, 10], [startSnap.edge.u, 8]]) {
      for (const d of [0, 1]) {
        const st = nodeId * 2 + d;
        if (gScore[st] > pen) {
          gScore[st] = pen;
          push(st, pen + h0);
        }
      }
    }
  }

  let reachedState = -1;
  while (heapState.length > 0) {
    const curr = pop();
    if (closed[curr]) continue;
    closed[curr] = 1;
    const u = curr >> 1;
    const dir = curr & 1;
    if (u === endNodeIdx) {
      reachedState = curr;
      break;
    }
    const g = gScore[curr];
    const edges = map.adj[u][dir];
    if (!edges) continue;
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const nextSt = e[0] * 2 + e[1];
      if (closed[nextSt]) continue;
      const tentative = g + e[3];
      if (tentative < gScore[nextSt]) {
        gScore[nextSt] = tentative;
        parentState[nextSt] = curr;
        parentEdgeIdx[nextSt] = ei;
        const h = Math.hypot(map.nodes[e[0]][0] - tx, map.nodes[e[0]][1] - ty) / 36.0;
        push(nextSt, tentative + h);
      }
    }
  }

  if (reachedState === -1) return null;

  const steps = [];
  let curr = reachedState;
  while (parentState[curr] !== -1) {
    const prev = parentState[curr];
    const ei = parentEdgeIdx[curr];
    const edge = map.adj[prev >> 1][prev & 1][ei];
    steps.push({ fromNode: prev >> 1, edge });
    curr = prev;
  }
  steps.reverse();

  const points = [];
  const stepMeta = [];
  let totalDist = 0;
  let totalDur = 0;

  // Se partiu de um snap em meio de estrada, inclui a fração restante da primeira estrada
  if (typeof startSnap === 'object' && startSnap.pts && startSnap.pts.length >= 4) {
    const startNodeReached = curr >> 1;
    if (startNodeReached === startSnap.edge.v) {
      points.push(startSnap.projX, startSnap.projY);
      for (let i = startSnap.segIndex + 2; i < startSnap.pts.length; i += 2) {
        points.push(startSnap.pts[i], startSnap.pts[i + 1]);
      }
    }
  }

  for (const s of steps) {
    const [toNode, , dist, dur, geomType, geomIdx] = s.edge;
    totalDist += dist;
    totalDur += dur;
    const startPtIdx = Math.max(0, (points.length / 2) - 1);

    if (geomType === 0) {
      const rPts = map.roads[geomIdx][0];
      for (let i = 0; i < rPts.length; i += 2) points.push(rPts[i], rPts[i + 1]);
    } else if (geomType === 1) {
      const rPts = map.roads[geomIdx][0];
      for (let i = rPts.length - 2; i >= 0; i -= 2) points.push(rPts[i], rPts[i + 1]);
    } else if (geomType === 2) {
      const pPts = map.prefabCurves[geomIdx][0];
      for (let i = 0; i < pPts.length; i += 2) points.push(pPts[i], pPts[i + 1]);
    } else {
      const n1 = map.nodes[s.fromNode];
      const n2 = map.nodes[toNode];
      points.push(n1[0], n1[1], n2[0], n2[1]);
    }

    stepMeta.push({
      geomType,
      geomIdx,
      dist,
      dur,
      startPtIdx,
      endPtIdx: (points.length / 2) - 1,
    });
  }

  return { points, stepMeta, totalDist, totalDur, endState: reachedState };
}

/**
 * Remove vértices duplicados consecutivos e calcula distância acumulada em cada vértice
 */
function buildRouteProfile(rawPoints) {
  const points = [];
  const cumDist = [];
  let acc = 0;
  for (let i = 0; i < rawPoints.length; i += 2) {
    const x = rawPoints[i];
    const y = rawPoints[i + 1];
    if (points.length >= 2) {
      const px = points[points.length - 2];
      const py = points[points.length - 1];
      const d = Math.hypot(x - px, y - py);
      if (d < 0.2) continue;
      acc += d;
    }
    points.push(x, y);
    cumDist.push(acc);
  }
  return { points, cumDist, totalWorldMeters: acc };
}

/**
 * Extrai manobras Turn-by-Turn a partir da geometria real da rota
 */
function extractManeuvers(points, cumDist, targetLabel) {
  const maneuvers = [];
  const numPts = points.length / 2;
  if (numPts < 3) return maneuvers;

  let lastManeuverDist = -120;

  for (let i = 2; i < numPts - 2; i++) {
    const dCurr = cumDist[i];
    if (dCurr - lastManeuverDist < 85) continue;

    // Olha vetor ~25m antes e ~25m depois do vértice i
    let iPrev = i - 1;
    while (iPrev > 0 && dCurr - cumDist[iPrev] < 22) iPrev--;
    let iNext = i + 1;
    while (iNext < numPts - 1 && cumDist[iNext] - dCurr < 22) iNext++;

    const v1x = points[i * 2] - points[iPrev * 2];
    const v1y = points[i * 2 + 1] - points[iPrev * 2 + 1];
    const v2x = points[iNext * 2] - points[i * 2];
    const v2y = points[iNext * 2 + 1] - points[i * 2 + 1];

    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 5 || l2 < 5) continue;

    const a1 = Math.atan2(v1x, -v1y);
    const a2 = Math.atan2(v2x, -v2y);
    let diffDeg = ((a2 - a1) * 180) / Math.PI;
    while (diffDeg <= -180) diffDeg += 360;
    while (diffDeg > 180) diffDeg -= 360;

    const absDeg = Math.abs(diffDeg);
    if (absDeg < 28) continue;

    // Verifica se há um pico maior logo adiante (+35m)
    let type = 'straight';
    let text = 'Siga em frente';
    if (absDeg > 145) {
      type = 'uturn';
      text = 'Faça o retorno';
    } else if (diffDeg >= 28 && diffDeg < 55) {
      type = 'keep-right';
      text = 'Mantenha-se à direita';
    } else if (diffDeg >= 55 && diffDeg < 115) {
      type = 'turn-right';
      text = 'Vire à direita';
    } else if (diffDeg >= 115) {
      type = 'turn-sharp-right';
      text = 'Curva fechada à direita';
    } else if (diffDeg <= -28 && diffDeg > -55) {
      type = 'keep-left';
      text = 'Mantenha-se à esquerda';
    } else if (diffDeg <= -55 && diffDeg > -115) {
      type = 'turn-left';
      text = 'Vire à esquerda';
    } else if (diffDeg <= -115) {
      type = 'turn-sharp-left';
      text = 'Curva fechada à esquerda';
    }

    maneuvers.push({
      pointIndex: i,
      x: points[i * 2],
      y: points[i * 2 + 1],
      cumDist: Math.round(dCurr),
      type,
      text,
      angleDeg: Math.round(diffDeg),
    });
    lastManeuverDist = dCurr;
  }

  const lastIdx = numPts - 1;
  maneuvers.push({
    pointIndex: lastIdx,
    x: points[lastIdx * 2],
    y: points[lastIdx * 2 + 1],
    cumDist: Math.round(cumDist[lastIdx] || 0),
    type: 'arrive',
    text: targetLabel ? `Chegada em ${targetLabel}` : 'Chegada ao destino',
    angleDeg: 0,
  });

  return maneuvers;
}

/**
 * Calcula rota completa passando por 1 ou mais paradas
 * targets: Array<{ x, y, nodeIdx?, label? }>
 */
function computeRoute(map, startX, startY, startHeadingRad, targets, mode = 'auto', label = '') {
  if (!map || !targets || targets.length === 0) return null;

  const t0 = performance.now();
  const startSnap = snapPointToGraph(map, startX, startY, startHeadingRad);

  const allRawPoints = [];
  let totalGraphDist = 0;
  let totalGraphDur = 0;
  const resolvedStops = [];

  let currentStart = startSnap;
  for (let i = 0; i < targets.length; i++) {
    const tgt = targets[i];
    let endNodeIdx = tgt.nodeIdx;
    let stopX = tgt.x;
    let stopY = tgt.y;

    if (endNodeIdx === undefined || endNodeIdx === null || endNodeIdx < 0) {
      const tgtSnap = snapPointToGraph(map, tgt.x, tgt.y, null);
      endNodeIdx = tgtSnap.edge.u;
      stopX = tgtSnap.projX;
      stopY = tgtSnap.projY;
    } else {
      stopX = map.nodes[endNodeIdx]?.[0] ?? tgt.x;
      stopY = map.nodes[endNodeIdx]?.[1] ?? tgt.y;
    }

    const seg = findAStarSegment(map, currentStart, endNodeIdx);
    if (!seg) continue;

    for (let k = 0; k < seg.points.length; k++) allRawPoints.push(seg.points[k]);
    totalGraphDist += seg.totalDist;
    totalGraphDur += seg.totalDur;
    resolvedStops.push({
      x: stopX,
      y: stopY,
      nodeIdx: endNodeIdx,
      label: tgt.label || `Parada ${i + 1}`,
    });
    currentStart = endNodeIdx;
  }

  if (allRawPoints.length < 4) return null;

  const { points, cumDist, totalWorldMeters } = buildRouteProfile(allRawPoints);
  const finalLabel = label || resolvedStops[resolvedStops.length - 1]?.label || 'Destino';
  const maneuvers = extractManeuvers(points, cumDist, finalLabel);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    mode, // 'job-pickup' | 'job-delivery' | 'save-waypoints' | 'manual'
    label: finalLabel,
    points,
    cumDist,
    totalDistanceMeters: Math.round(totalGraphDist || totalWorldMeters),
    totalDurationSeconds: Math.round(totalGraphDur),
    maneuvers,
    stops: resolvedStops,
    progressIdx: 0,
    remainingMeters: Math.round(totalGraphDist || totalWorldMeters),
    remainingSeconds: Math.round(totalGraphDur),
    nextManeuver: maneuvers[0] || null,
    calcTimeMs: Math.round(performance.now() - t0),
  };
}

// ============================================================================
// 2. LEITOR DE ROTA DO SAVE (ScsC AES-256-CBC + BSII / SiiNunit)
// ============================================================================

const SII_KEY = Buffer.from([
  0x2a, 0x5f, 0xcb, 0x17, 0x91, 0xd2, 0x2f, 0xb6, 0x02, 0x45, 0xb3, 0xd8,
  0x36, 0x9e, 0xd0, 0xb2, 0xc2, 0x73, 0x71, 0x56, 0x3f, 0xbf, 0x1f, 0x3c,
  0x9e, 0xdf, 0x6b, 0x11, 0x82, 0x5a, 0x5d, 0x0a,
]);

const ENC_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz_';
function decodeBsiiToken(value) {
  const base = 38n;
  let s = '';
  let v = value;
  while (v > 0n) {
    const c = Number(v % base);
    v /= base;
    if (c > 0) s += ENC_CHARS[c - 1];
  }
  return s;
}

const BSII_FIXED_SIZES = {
  0x05: 4, 0x07: 8, 0x09: 12, 0x11: 12, 0x17: 16, 0x19: 32,
  0x25: 4, 0x27: 4, 0x29: 2, 0x2b: 2, 0x2f: 4, 0x31: 8, 0x33: 8, 0x35: 1, 0x37: 4,
};

function parseBsiiWaypoints(buf) {
  let pos = 8; // "BSII" + version
  const len = buf.length;
  const u8 = () => buf.readUInt8(pos++);
  const u32 = () => { const v = buf.readUInt32LE(pos); pos += 4; return v; };
  const i32 = () => { const v = buf.readInt32LE(pos); pos += 4; return v; };
  const u64 = () => { const v = buf.readBigUInt64LE(pos); pos += 8; return v; };
  const str = () => { const l = u32(); const s = buf.toString('utf8', pos, pos + l); pos += l; return s; };
  const readId = () => {
    const l = u8();
    if (l === 0xff) return `_nameless.${u64().toString(16)}`;
    const parts = [];
    for (let i = 0; i < l; i++) parts.push(decodeBsiiToken(u64()));
    return parts.join('.');
  };
  const readVal = (type) => {
    if (type === 0x01) return str();
    if (type === 0x03) return decodeBsiiToken(u64());
    if (type === 0x11) return [i32(), i32(), i32()];
    if (type === 0x39 || type === 0x3b || type === 0x3d) return readId();
    if (BSII_FIXED_SIZES[type] !== undefined) {
      pos += BSII_FIXED_SIZES[type];
      return undefined;
    }
    const elType = type - 1;
    if ((BSII_FIXED_SIZES[elType] !== undefined || [0x01, 0x03, 0x39, 0x3b, 0x3d].includes(elType)) && type !== 0x38) {
      const cnt = u32();
      const arr = [];
      for (let i = 0; i < cnt; i++) arr.push(readVal(elType));
      return arr;
    }
    throw new Error(`BSII tipo desconhecido 0x${type.toString(16)}`);
  };

  const structs = new Map();
  const storage = new Map();
  let ahead = [];

  while (pos < len) {
    const blockType = u32();
    if (blockType === 0) {
      if (!u8()) continue;
      const id = u32();
      const name = str();
      const fields = [];
      while (true) {
        const fType = u32();
        if (fType === 0) break;
        const fName = str();
        if (fType === 0x37) {
          const cnt = u32();
          for (let i = 0; i < cnt; i++) { u32(); str(); }
        }
        fields.push({ type: fType, name: fName });
      }
      structs.set(id, { name, fields });
      continue;
    }
    const st = structs.get(blockType);
    if (!st) break;
    const unitId = readId();
    for (const f of st.fields) {
      const val = readVal(f.type);
      if (st.name === 'economy' && f.name === 'stored_gps_ahead_waypoints') {
        ahead = val || [];
      } else if (st.name === 'gps_waypoint_storage' && f.name === 'nav_node_position') {
        if (Array.isArray(val) && val.length >= 3) {
          storage.set(unitId, [val[0] / 256, val[2] / 256]);
        }
      }
    }
  }
  return ahead.map((id) => storage.get(id)).filter(Boolean);
}

function parseTextWaypoints(text) {
  const ahead = [];
  const aheadRe = /stored_gps_ahead_waypoints\[\d*\]:\s*(\S+)/g;
  let m;
  while ((m = aheadRe.exec(text)) !== null) ahead.push(m[1]);
  const storage = new Map();
  const unitRe = /gps_waypoint_storage\s*:\s*(\S+)\s*\{[^}]*?nav_node_position:\s*\(([^,]+),[^,]+,([^)]+)\)/g;
  while ((m = unitRe.exec(text)) !== null) {
    const x = Number(m[2].trim());
    const z = Number(m[3].trim());
    if (Number.isFinite(x) && Number.isFinite(z)) storage.set(m[1], [x / 256, z / 256]);
  }
  return ahead.map((id) => storage.get(id)).filter(Boolean);
}

let saveCache = { file: '', mtime: 0, waypoints: [] };

function getWaypointsFromNewestSave(gameName) {
  const info = gameName === 'ats'
    ? { folder: 'American Truck Simulator', appId: '270880' }
    : { folder: 'Euro Truck Simulator 2', appId: '227300' };

  const safeReaddir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  const listSaves = (profilesDir) => {
    const out = [];
    if (!fs.existsSync(profilesDir)) return out;
    for (const p of safeReaddir(profilesDir)) {
      const sDir = path.join(profilesDir, p, 'save');
      for (const s of safeReaddir(sDir)) {
        const f = path.join(sDir, s, 'game.sii');
        if (fs.existsSync(f)) out.push(f);
      }
    }
    return out;
  };

  const candidates = [
    ...listSaves(path.join(DOCUMENTS_DIR, info.folder, 'profiles')),
    ...listSaves(path.join(DOCUMENTS_DIR, info.folder, 'steam_profiles')),
  ];
  const userdata = path.join(STEAM_DIR, 'userdata');
  for (const u of safeReaddir(userdata)) {
    candidates.push(...listSaves(path.join(userdata, u, info.appId, 'remote', 'profiles')));
  }

  let newest = null;
  for (const file of candidates) {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { file, mtime };
    } catch { /* ignore */ }
  }
  if (!newest) return null;
  if (saveCache.file === newest.file && saveCache.mtime === newest.mtime) {
    return saveCache;
  }

  try {
    let raw = fs.readFileSync(newest.file);
    if (raw.subarray(0, 4).toString('latin1') === 'ScsC') {
      const iv = raw.subarray(36, 52);
      const decipher = crypto.createDecipheriv('aes-256-cbc', SII_KEY, iv);
      const compressed = Buffer.concat([decipher.update(raw.subarray(56)), decipher.final()]);
      raw = zlib.inflateSync(compressed);
    }
    const magic = raw.subarray(0, 4).toString('latin1');
    let waypoints = [];
    if (magic === 'BSII') waypoints = parseBsiiWaypoints(raw);
    else if (raw.subarray(0, 8).toString('latin1') === 'SiiNunit') waypoints = parseTextWaypoints(raw.toString('utf8'));
    saveCache = { file: newest.file, mtime: newest.mtime, waypoints };
    return saveCache;
  } catch {
    return null;
  }
}

// ============================================================================
// 3. ESTADO AO VIVO, DETECÇÃO DE MAPA E PROGRESSO DE NAVEGAÇÃO
// ============================================================================

const state = {
  connected: false,
  simulating: false,
  activeMapId: 'ets2_rbr',
  manualMapLock: false,
  game: 'ets2',
  paused: false,
  truck: {
    x: -2450,
    y: -1200,
    z: 0,
    headingRad: 0,
    headingDeg: 0,
    speedKph: 0,
    speedMph: 0,
    cruiseControlKph: 0,
    cruiseControlActive: false,
    gear: 0,
    rpm: 0,
    fuelAmount: 600,
    fuelCapacity: 700,
    fuelRangeKm: 1850,
    fuelWarning: false,
    parkingBrake: false,
    damagePercent: 0,
    brand: 'Scania',
    name: 'R 540',
  },
  navigation: {
    speedLimitKph: 80,
    speedLimitMph: 50,
    gameNavDistanceMeters: 0,
    gameNavTimeSec: 0,
    nextRestStopMinutes: 660,
    gameTimeFormatted: '12:00',
  },
  job: {
    hasActiveJob: false,
    mustPickUp: false,
    cargoLoaded: false,
    trailerAttached: false,
    cargoName: '',
    cargoMassKg: 0,
    cargoDamagePercent: 0,
    income: 0,
    remainingMinutes: null,
    sourceCity: '',
    sourceCityId: '',
    sourceCompany: '',
    sourceCompanyId: '',
    destCity: '',
    destCityId: '',
    destCompany: '',
    destCompanyId: '',
  },
  activeRoute: null, // rota completa atual
};

let pickedUpJobKey = '';
let lastAutoRouteKey = '';
let lastRecalcTime = 0;
let prevTruckPos = null;
let smoothedHeadingOffsetRad = 0;

/**
 * Detecta se o ETS2 aberto está com o Mapa RBR montado lendo o game.log.txt ou coordenadas
 */
function detectEts2Map(truckX, truckY) {
  try {
    const logPath = path.join(DOCUMENTS_DIR, 'Euro Truck Simulator 2', 'game.log.txt');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      if (/Mapa RBR|RBR Mod/i.test(content)) return 'ets2_rbr';
    }
  } catch { /* ignore */ }

  // Verifica em qual mapa o caminhão está mais perto de uma rodovia (< 120m)
  const rbr = loadMapData('ets2_rbr');
  const eur = loadMapData('ets2_europe');
  if (rbr && eur && (Math.abs(truckX) > 1 || Math.abs(truckY) > 1)) {
    const sRbr = snapPointToGraph(rbr, truckX, truckY, null, 400);
    const sEur = snapPointToGraph(eur, truckX, truckY, null, 400);
    if (sRbr.dist < 80 && sEur.dist > 250) return 'ets2_rbr';
    if (sEur.dist < 80 && sRbr.dist > 250) return 'ets2_europe';
  }
  return 'ets2_rbr';
}

/**
 * Localiza o nó de uma empresa ou cidade no mapa carregado
 */
function resolveCompanyOrCityTarget(map, cityToken, companyToken, fallbackCityName, fallbackCompanyName) {
  if (!map) return null;
  const cTok = (cityToken || '').toLowerCase().trim();
  const compTok = (companyToken || '').toLowerCase().trim();

  // 1. Procura a empresa exata na cidade exata
  if (compTok && cTok) {
    const exact = map.companies.find(
      (c) => c[0].toLowerCase() === compTok && c[2].toLowerCase() === cTok
    );
    if (exact) {
      return {
        x: exact[3],
        y: exact[4],
        nodeIdx: exact[5],
        label: `${exact[1]} (${fallbackCityName || exact[2]})`,
      };
    }
  }

  // 2. Procura a cidade pelo token ou nome e, se houver empresa com mesmo token perto, usa a empresa
  const city = map.cities.find(
    (c) => c[0].toLowerCase() === cTok || c[1].toLowerCase() === (fallbackCityName || '').toLowerCase()
  );
  if (city) {
    if (compTok) {
      let bestComp = null;
      let bestDist = Infinity;
      for (const comp of map.companies) {
        if (comp[0].toLowerCase() === compTok) {
          const d = Math.hypot(comp[3] - city[3], comp[4] - city[4]);
          if (d < bestDist && d < 6500) {
            bestDist = d;
            bestComp = comp;
          }
        }
      }
      if (bestComp) {
        return {
          x: bestComp[3],
          y: bestComp[4],
          nodeIdx: bestComp[5],
          label: `${bestComp[1]} (${city[1]})`,
        };
      }
    }
    return {
      x: city[3],
      y: city[4],
      nodeIdx: city[5],
      label: fallbackCompanyName ? `${fallbackCompanyName} (${city[1]})` : city[1],
    };
  }

  return null;
}

/**
 * Atualiza o progresso do caminhão sobre a rota ativa e recalcula automaticamente se desviar > 25m
 */
function updateRouteProgressAndCheckDeviation() {
  const route = state.activeRoute;
  if (!route || !route.points || route.points.length < 4) return;

  const pts = route.points;
  const numPts = pts.length / 2;
  const tx = state.truck.x;
  const ty = state.truck.y;

  // Busca na janela ao redor de progressIdx primeiro, depois global se necessário
  const searchStart = Math.max(0, route.progressIdx - 15);
  const searchEnd = Math.min(numPts - 1, route.progressIdx + 220);

  let bestIdx = route.progressIdx;
  let bestDist = Infinity;

  for (let i = searchStart; i < searchEnd; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[(i + 1) * 2], by = pts[(i + 1) * 2 + 1];
    const vx = bx - ax, vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    const t = lenSq > 0.001 ? Math.max(0, Math.min(1, ((tx - ax) * vx + (ty - ay) * vy) / lenSq)) : 0;
    const d = Math.hypot(tx - (ax + t * vx), ty - (ay + t * vy));
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // Se não achou perto na janela, faz busca completa na rota
  if (bestDist > 40) {
    for (let i = 0; i < numPts - 1; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const bx = pts[(i + 1) * 2], by = pts[(i + 1) * 2 + 1];
      const vx = bx - ax, vy = by - ay;
      const lenSq = vx * vx + vy * vy;
      const t = lenSq > 0.001 ? Math.max(0, Math.min(1, ((tx - ax) * vx + (ty - ay) * vy) / lenSq)) : 0;
      const d = Math.hypot(tx - (ax + t * vx), ty - (ay + t * vy));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }

  route.progressIdx = bestIdx;
  const passedDist = route.cumDist[bestIdx] || 0;
  const totalWorld = route.cumDist[numPts - 1] || 1;
  const fracRemaining = Math.max(0, 1 - passedDist / totalWorld);
  route.remainingMeters = Math.round(route.totalDistanceMeters * fracRemaining);
  route.remainingSeconds = Math.round(route.totalDurationSeconds * fracRemaining);

  // Próxima manobra à frente
  let nextMan = route.maneuvers[route.maneuvers.length - 1] || null;
  for (const m of route.maneuvers) {
    if (m.pointIndex > bestIdx + 1) {
      nextMan = {
        ...m,
        distanceMeters: Math.max(0, Math.round(m.cumDist - passedDist)),
      };
      break;
    }
  }
  route.nextManeuver = nextMan;

  // Se chegou ao destino (< 32m do final) em rota manual, limpa
  const endX = pts[(numPts - 1) * 2];
  const endY = pts[(numPts - 1) * 2 + 1];
  if (Math.hypot(tx - endX, ty - endY) < 32 && bestIdx >= numPts - 8) {
    if (route.mode === 'manual') {
      state.activeRoute = null;
      return;
    }
  }

  // Recálculo automático se o caminhão desviou > 26m da linha da rota
  const now = Date.now();
  if (bestDist > 26 && now - lastRecalcTime > 2500 && route.stops && route.stops.length > 0) {
    const map = loadMapData(state.activeMapId);
    if (map) {
      const snap = snapPointToGraph(map, tx, ty, state.truck.headingRad, 300);
      // Só recalcula se o caminhão estiver em outra rua/alça válida (< 90m do grafo)
      if (snap.dist < 90) {
        lastRecalcTime = now;
        // Filtra paradas já visitadas
        const remainingStops = route.stops.filter((st, idx) => {
          if (idx === route.stops.length - 1) return true;
          return Math.hypot(st.x - tx, st.y - ty) > 65;
        });
        const newRoute = computeRoute(
          map,
          tx,
          ty,
          state.truck.headingRad,
          remainingStops,
          route.mode,
          route.label
        );
        if (newRoute) {
          console.log(`[GPS] Desvio de ${bestDist.toFixed(1)}m detectado — rota recalculada em ${newRoute.calcTimeMs}ms!`);
          state.activeRoute = newRoute;
        }
      }
    }
  }
}

/**
 * Processa pacote de telemetria vindo do TruckNavTelemetry.exe (ws://127.0.0.1:30001)
 */
function handleTelemetryPacket(pkt) {
  if (!pkt || !pkt.truck) return;
  const pos = pkt.truck.current?.position || { x: 0, y: 0, z: 0 };
  const isZeroPos = Math.abs(pos.x) < 0.01 && Math.abs(pos.z) < 0.01;
  if (isZeroPos) return;

  if (state.simulating) stopSimulation();
  state.connected = true;
  state.paused = !!pkt.paused;

  const rawGame = (pkt.game || 'ets2').toLowerCase();
  state.game = rawGame === 'ats' ? 'ats' : 'ets2';

  // Seleção automática de mapa se não estiver travado manualmente
  if (!state.manualMapLock) {
    const wantedMap = state.game === 'ats' ? 'ats' : detectEts2Map(pos.x, pos.z);
    if (wantedMap !== state.activeMapId) {
      state.activeMapId = wantedMap;
      lastAutoRouteKey = '';
      console.log(`[Mapa] Alternado automaticamente para: ${wantedMap}`);
    }
  }

  const dash = pkt.truck.current?.dashboard || {};
  const speedKph = Math.max(0, Math.round(dash.speedKph || 0));
  const speedMph = Math.max(0, Math.round(dash.speedMph || speedKph * 0.621371));

  // Heading real no mundo Prism3D: 0 rad = Norte (0, -1), sentido horário
  const rawHeadingRad = -(pkt.truck.current?.heading || 0) * Math.PI * 2;
  if (prevTruckPos && speedKph > 8) {
    const moveDist = Math.hypot(pos.x - prevTruckPos.x, pos.z - prevTruckPos.z);
    if (moveDist > 0.6) {
      const moveBearing = Math.atan2(pos.x - prevTruckPos.x, -(pos.z - prevTruckPos.z));
      let diff = moveBearing - (rawHeadingRad + smoothedHeadingOffsetRad);
      while (diff <= -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      if (Math.abs(diff) < Math.PI / 2) {
        smoothedHeadingOffsetRad += diff * 0.15;
      }
    }
  }
  prevTruckPos = { x: pos.x, z: pos.z };

  let headingRad = (rawHeadingRad + smoothedHeadingOffsetRad) % (Math.PI * 2);
  if (headingRad < 0) headingRad += Math.PI * 2;

  const dmg = pkt.truck.current?.damage || {};
  const maxTruckDmg = Math.max(dmg.engine || 0, dmg.transmission || 0, dmg.cabin || 0, dmg.chassis || 0, dmg.wheels || 0);

  state.truck = {
    x: Math.round(pos.x * 100) / 100,
    y: Math.round(pos.z * 100) / 100, // No mapa 2D, Z do jogo é o eixo Y (Sul positivo)
    z: Math.round((pos.y || 0) * 10) / 10, // Altitude
    headingRad,
    headingDeg: Math.round((headingRad * 180) / Math.PI),
    speedKph,
    speedMph,
    cruiseControlKph: Math.round(dash.cruiseControlSpeedKph || 0),
    cruiseControlActive: !!dash.cruiseControlActive,
    gear: dash.currentGear || 0,
    rpm: Math.round(dash.rpm || 0),
    fuelAmount: Math.round(dash.fuelAmount || 0),
    fuelCapacity: Math.round(pkt.truck.constants?.fuelCapacity || 700),
    fuelRangeKm: Math.round(dash.fuelRange || 0),
    fuelWarning: !!dash.fuelWarning,
    parkingBrake: !!pkt.truck.current?.parkingBrake,
    damagePercent: Math.round(maxTruckDmg * 100),
    brand: pkt.truck.constants?.brand || '',
    name: pkt.truck.constants?.name || '',
  };

  // Navegação e Fadiga
  const nav = pkt.navigation || {};
  const common = pkt.common || {};
  let gameTimeFormatted = '12:00';
  if (common.gameTime) {
    const dt = new Date(common.gameTime);
    if (!Number.isNaN(dt.getTime())) {
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      gameTimeFormatted = `${days[dt.getUTCDay()]} ${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`;
    }
  }

  state.navigation = {
    speedLimitKph: Math.max(0, Math.round(nav.speedLimitKph || 0)),
    speedLimitMph: Math.max(0, Math.round(nav.speedLimitMph || 0)),
    gameNavDistanceMeters: Math.max(0, Math.round(nav.distance || 0)),
    gameNavTimeSec: Math.max(0, Math.round(nav.time || 0)),
    nextRestStopMinutes: common.nextRestStopMinutes ?? 660,
    gameTimeFormatted,
  };

  // Estado da Entrega (Job) — funciona mesmo após reabrir o jogo com onJob: false!
  const job = pkt.job || {};
  const trailer = pkt.trailers?.[0];
  const hasActiveJob = !!(pkt.specialEvents?.onJob || ((job.income || 0) > 0 && job.companyDestinationId));
  const jobKey = `${job.companySourceId || ''}|${job.companyDestinationId || ''}|${job.income || 0}`;
  if (!hasActiveJob) pickedUpJobKey = '';

  const isTrailerAttached = !!trailer?.attached;
  const isTrailerAvailable = !!(trailer && (trailer.position?.x !== 0 || trailer.position?.y !== 0));
  const cargoNotLoaded = job.cargoLoaded === false;

  if (hasActiveJob && isTrailerAttached && !cargoNotLoaded) {
    pickedUpJobKey = jobKey;
  }

  const mustPickUp =
    hasActiveJob &&
    !!job.companySourceId &&
    pickedUpJobKey !== jobKey &&
    ((isTrailerAvailable && !isTrailerAttached) || cargoNotLoaded);

  const cargoDmg = Math.max(job.cargo?.cargoDamage || 0, trailer?.damage?.cargo || 0);

  state.job = {
    hasActiveJob,
    mustPickUp,
    cargoLoaded: !!job.cargoLoaded,
    trailerAttached: isTrailerAttached,
    cargoName: job.cargo?.name || '',
    cargoMassKg: Math.round(job.cargo?.mass || 0),
    cargoDamagePercent: Math.round(cargoDmg * 100),
    income: job.income || 0,
    remainingMinutes: null,
    sourceCity: job.citySource || job.citySourceId || '',
    sourceCityId: job.citySourceId || '',
    sourceCompany: job.companySource || job.companySourceId || '',
    sourceCompanyId: job.companySourceId || '',
    destCity: job.cityDestination || job.cityDestinationId || '',
    destCityId: job.cityDestinationId || '',
    destCompany: job.companyDestination || job.companyDestinationId || '',
    destCompanyId: job.companyDestinationId || '',
  };

  // Decisão Automática de Rota (se não houver uma rota manual travada pelo usuário no app)
  const map = loadMapData(state.activeMapId);
  if (map && (!state.activeRoute || state.activeRoute.mode !== 'manual')) {
    if (hasActiveJob) {
      const targetMode = mustPickUp ? 'job-pickup' : 'job-delivery';
      const targetCityId = mustPickUp ? job.citySourceId : job.cityDestinationId;
      const targetCompId = mustPickUp ? job.companySourceId : job.companyDestinationId;
      const targetCityName = mustPickUp ? job.citySource : job.cityDestination;
      const targetCompName = mustPickUp ? job.companySource : job.companyDestination;
      const autoKey = `${state.activeMapId}:${targetMode}:${targetCityId}:${targetCompId}`;

      if (autoKey !== lastAutoRouteKey || !state.activeRoute) {
        const resolved = resolveCompanyOrCityTarget(map, targetCityId, targetCompId, targetCityName, targetCompName);
        if (resolved) {
          const newRoute = computeRoute(
            map,
            state.truck.x,
            state.truck.y,
            state.truck.headingRad,
            [resolved],
            targetMode,
            resolved.label
          );
          if (newRoute) {
            state.activeRoute = newRoute;
            lastAutoRouteKey = autoKey;
            console.log(`[GPS] Rota de frete (${targetMode}) traçada automaticamente para ${resolved.label} em ${newRoute.calcTimeMs}ms`);
          }
        }
      }
    } else if (state.navigation.gameNavDistanceMeters > 80) {
      // Sem entrega ativa, mas há rota marcada no mapa do jogo -> lê waypoints do save!
      const saveInfo = getWaypointsFromNewestSave(state.game);
      if (saveInfo && saveInfo.waypoints.length > 0) {
        const autoKey = `save:${saveInfo.mtime}:${saveInfo.waypoints.length}`;
        if (autoKey !== lastAutoRouteKey || !state.activeRoute) {
          // Filtra waypoints que já ficaram para trás
          const validWps = saveInfo.waypoints
            .filter(([wx, wy]) => Math.hypot(wx - state.truck.x, wy - state.truck.y) > 45)
            .map(([wx, wy], idx, arr) => ({
              x: wx,
              y: wy,
              label: idx === arr.length - 1 ? 'Marcador do Jogo' : `Parada ${idx + 1}`,
            }));
          if (validWps.length > 0) {
            const newRoute = computeRoute(
              map,
              state.truck.x,
              state.truck.y,
              state.truck.headingRad,
              validWps,
              'save-waypoints',
              'Rota do Mapa do Jogo'
            );
            if (newRoute) {
              state.activeRoute = newRoute;
              lastAutoRouteKey = autoKey;
              console.log(`[GPS] Rota lida do save do jogo (${validWps.length} waypoints) em ${newRoute.calcTimeMs}ms`);
            }
          }
        }
      }
    } else if (state.activeRoute && state.activeRoute.mode !== 'manual') {
      state.activeRoute = null;
      lastAutoRouteKey = '';
    }
  }

  updateRouteProgressAndCheckDeviation();
  broadcastState();
}

// ============================================================================
// 4. SIMULADOR DE VIAGEM INTEGRADO (PARA TESTAR SEM O JOGO ABERTO)
// ============================================================================

let simInterval = null;
let simDistAlongRoute = 0;

function startSimulation(speedKph = 95) {
  stopSimulation();
  const map = loadMapData(state.activeMapId);
  if (!map) return false;

  // Se não houver rota ativa, cria uma rota de demonstração bonita no mapa atual
  if (!state.activeRoute || !state.activeRoute.points || state.activeRoute.points.length < 4) {
    let c1 = map.cities[0];
    let c2 = map.cities[Math.min(12, map.cities.length - 1)];
    if (state.activeMapId === 'ets2_rbr') {
      c1 = map.cities.find((c) => /paulo/i.test(c[1])) || c1;
      c2 = map.cities.find((c) => /campinas|santos|curitiba|rio/i.test(c[1]) && c[0] !== c1[0]) || c2;
    } else if (state.activeMapId === 'ats') {
      c1 = map.cities.find((c) => /angeles|francisco|oakland/i.test(c[1])) || c1;
      c2 = map.cities.find((c) => /bakersfield|stockton|fresno|vegas/i.test(c[1]) && c[0] !== c1[0]) || c2;
    }
    if (c1 && c2) {
      state.truck.x = c1[3];
      state.truck.y = c1[4];
      state.activeRoute = computeRoute(
        map,
        c1[3],
        c1[4],
        null,
        [{ x: c2[3], y: c2[4], nodeIdx: c2[5], label: c2[1] }],
        'manual',
        c2[1]
      );
    }
  }

  if (!state.activeRoute) return false;
  state.simulating = true;
  simDistAlongRoute = state.activeRoute.cumDist[state.activeRoute.progressIdx] || 0;

  simInterval = setInterval(() => {
    const r = state.activeRoute;
    if (!r || !r.points || r.points.length < 4) {
      stopSimulation();
      return;
    }
    const pts = r.points;
    const cum = r.cumDist;
    const numPts = pts.length / 2;
    const stepWorldMeters = (speedKph / 3.6) * 0.25; // avanço a cada 50ms (escala acelerada suave)
    simDistAlongRoute += stepWorldMeters;

    if (simDistAlongRoute >= cum[numPts - 1]) {
      simDistAlongRoute = 0;
      r.progressIdx = 0;
    }

    // Interpola posição exata e ângulo na polilinha da rota
    let idx = r.progressIdx;
    while (idx < numPts - 2 && cum[idx + 1] < simDistAlongRoute) idx++;
    const segLen = Math.max(0.01, cum[idx + 1] - cum[idx]);
    const t = Math.max(0, Math.min(1, (simDistAlongRoute - cum[idx]) / segLen));

    const ax = pts[idx * 2], ay = pts[idx * 2 + 1];
    const bx = pts[(idx + 1) * 2], by = pts[(idx + 1) * 2 + 1];
    state.truck.x = Math.round((ax + (bx - ax) * t) * 100) / 100;
    state.truck.y = Math.round((ay + (by - ay) * t) * 100) / 100;

    let hRad = Math.atan2(bx - ax, -(by - ay));
    if (hRad < 0) hRad += Math.PI * 2;
    state.truck.headingRad = hRad;
    state.truck.headingDeg = Math.round((hRad * 180) / Math.PI);
    state.truck.speedKph = speedKph;
    state.truck.speedMph = Math.round(speedKph * 0.621371);
    state.truck.gear = 12;
    state.truck.rpm = 1350;

    updateRouteProgressAndCheckDeviation();
    broadcastState();
  }, 50);

  return true;
}

function stopSimulation() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  state.simulating = false;
}

// ============================================================================
// 5. CONEXÃO AUTOMÁTICA COM TRUCKNAVTELEMETRY.EXE (PORTA 30001)
// ============================================================================

let telemetryWs = null;
let lastSpawnAttempt = 0;

function ensureTelemetryBridgeRunning() {
  const now = Date.now();
  if (now - lastSpawnAttempt < 15000) return;
  lastSpawnAttempt = now;
  if (!fs.existsSync(TELEMETRY_EXE)) return;

  try {
    const child = spawn(TELEMETRY_EXE, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch { /* ignore */ }
}

function connectToTelemetryBridge() {
  if (telemetryWs) return;
  try {
    const ws = new WebSocket(TELEMETRY_WS_URL);
    telemetryWs = ws;

    ws.onopen = () => {
      console.log('[Telemetria] Conectado ao TruckNavTelemetry.exe (ws://127.0.0.1:30001)');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        handleTelemetryPacket(data);
      } catch { /* ignore malformed packet */ }
    };

    ws.onerror = () => {
      ensureTelemetryBridgeRunning();
    };

    ws.onclose = () => {
      telemetryWs = null;
      state.connected = false;
      broadcastState();
      setTimeout(connectToTelemetryBridge, 2500);
    };
  } catch {
    telemetryWs = null;
    ensureTelemetryBridgeRunning();
    setTimeout(connectToTelemetryBridge, 2500);
  }
}

// ============================================================================
// 6. SERVIDOR HTTP + WEBSOCKET RFC-6455 NATIVO (0.0.0.0:3050)
// ============================================================================

const wsClients = new Set();

function sendWsFrame(socket, payloadStr) {
  if (socket.destroyed) return;
  const payload = Buffer.from(payloadStr, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  try {
    socket.write(Buffer.concat([header, payload]));
  } catch {
    wsClients.delete(socket);
  }
}

function buildCompactStatePayload() {
  const r = state.activeRoute;
  return JSON.stringify({
    type: 'state',
    connected: state.connected,
    simulating: state.simulating,
    activeMapId: state.activeMapId,
    manualMapLock: state.manualMapLock,
    game: state.game,
    paused: state.paused,
    truck: state.truck,
    navigation: state.navigation,
    job: state.job,
    route: r
      ? {
          id: r.id,
          mode: r.mode,
          label: r.label,
          progressIdx: r.progressIdx,
          remainingMeters: r.remainingMeters,
          remainingSeconds: r.remainingSeconds,
          totalDistanceMeters: r.totalDistanceMeters,
          totalDurationSeconds: r.totalDurationSeconds,
          nextManeuver: r.nextManeuver,
          stops: r.stops,
        }
      : null,
  });
}

let lastBroadcastRouteId = '';

function broadcastState(forceFullRoute = false) {
  if (wsClients.size === 0) return;
  const r = state.activeRoute;
  const routeChanged = (r ? r.id : '') !== lastBroadcastRouteId || forceFullRoute;
  if (routeChanged) {
    lastBroadcastRouteId = r ? r.id : '';
    const fullRouteMsg = JSON.stringify({
      type: 'route',
      route: r
        ? {
            id: r.id,
            mode: r.mode,
            label: r.label,
            points: r.points,
            maneuvers: r.maneuvers,
            stops: r.stops,
            progressIdx: r.progressIdx,
            remainingMeters: r.remainingMeters,
            remainingSeconds: r.remainingSeconds,
            totalDistanceMeters: r.totalDistanceMeters,
            totalDurationSeconds: r.totalDurationSeconds,
            nextManeuver: r.nextManeuver,
            calcTimeMs: r.calcTimeMs,
          }
        : null,
    });
    for (const client of wsClients) sendWsFrame(client, fullRouteMsg);
  }

  const stateMsg = buildCompactStatePayload();
  for (const client of wsClients) sendWsFrame(client, stateMsg);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. Visual Map Pack (GZIP)
  if (pathname.startsWith('/api/map/')) {
    const mapId = pathname.replace('/api/map/', '').trim();
    const map = loadMapData(mapId);
    if (!map) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Mapa '${mapId}' não encontrado.` }));
      return;
    }
    const gz = gzipVisualCache.get(mapId);
    const acceptEnc = req.headers['accept-encoding'] || '';
    if (gz && acceptEnc.includes('gzip')) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-cache',
      });
      res.end(gz);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(zlib.gunzipSync(gz));
    }
    return;
  }

  // 2. Estado atual completo + Rota ativa
  if (pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        connected: state.connected,
        simulating: state.simulating,
        activeMapId: state.activeMapId,
        manualMapLock: state.manualMapLock,
        game: state.game,
        paused: state.paused,
        truck: state.truck,
        navigation: state.navigation,
        job: state.job,
        activeRoute: state.activeRoute,
      })
    );
    return;
  }

  // 3. Trocar Mapa Ativo
  if (pathname === '/api/select-map' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const mapId = body.mapId;
    const map = loadMapData(mapId);
    if (!map) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mapa inválido' }));
      return;
    }
    stopSimulation();
    state.activeMapId = mapId;
    state.manualMapLock = !!body.lock;
    state.activeRoute = null;
    lastAutoRouteKey = '';

    // Posiciona câmera/caminhão inicial numa cidade principal se o jogo estiver fechado
    if (!state.connected && map.cities.length > 0) {
      let c = map.cities[0];
      if (mapId === 'ets2_rbr') c = map.cities.find((x) => /s.o paulo/i.test(x[1])) || c;
      else if (mapId === 'ats') c = map.cities.find((x) => /los angeles|san francisco/i.test(x[1])) || c;
      else if (mapId === 'ets2_europe') c = map.cities.find((x) => /berlim|berlin|paris/i.test(x[1])) || c;
      state.truck.x = c[3];
      state.truck.y = c[4];
    }

    broadcastState(true);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, activeMapId: state.activeMapId, truck: state.truck }));
    return;
  }

  // 4. Calcular Rota Manual (Clique no Mapa, Cidade, Empresa ou POI, com suporte a paradas extras)
  if (pathname === '/api/route' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const map = loadMapData(body.mapId || state.activeMapId);
    if (!map) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mapa não carregado' }));
      return;
    }

    const startX = body.startX ?? state.truck.x;
    const startY = body.startY ?? state.truck.y;
    const addAsStop = !!body.addStop && state.activeRoute && state.activeRoute.stops?.length > 0;

    const newTarget = {
      x: Number(body.targetX),
      y: Number(body.targetY),
      nodeIdx: body.targetNodeIdx !== undefined ? Number(body.targetNodeIdx) : undefined,
      label: body.label || 'Destino Marcado',
    };

    const targets = addAsStop ? [...state.activeRoute.stops, newTarget] : [newTarget];
    const route = computeRoute(
      map,
      startX,
      startY,
      state.connected || state.simulating ? state.truck.headingRad : null,
      targets,
      'manual',
      newTarget.label
    );

    if (!route) {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Não foi possível encontrar rota conectada até este ponto.' }));
      return;
    }

    state.activeRoute = route;
    broadcastState(true);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, route }));
    return;
  }

  // 5. Limpar Rota Manual / Retomar Rota Automática do Jogo
  if (pathname === '/api/route/clear' && req.method === 'POST') {
    stopSimulation();
    state.activeRoute = null;
    lastAutoRouteKey = '';
    broadcastState(true);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 6. Iniciar / Parar Simulador de Viagem
  if (pathname === '/api/sim/toggle' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (state.simulating || body.stop) {
      stopSimulation();
    } else {
      startSimulation(Number(body.speedKph || 95));
    }
    broadcastState(true);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, simulating: state.simulating, activeRoute: state.activeRoute }));
    return;
  }

  // 7. Obter / Salvar Configurações + Status dos Plugins e IPs da Rede
  if (pathname === '/api/config' && req.method === 'GET') {
    const pluginStatus = installPluginToGames();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        config: appConfig,
        port: PORT,
        lanIps: getLocalLanIps(),
        pluginStatus,
        availableMaps: ['ets2_rbr', 'ats', 'ets2_europe'].filter((id) =>
          fs.existsSync(path.join(DATA_DIR, `${id}.json`))
        ),
      })
    );
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const nextPort = Number(body.port || appConfig.port || DEFAULT_PORT);
    appConfig = {
      ...appConfig,
      ...body,
      port: FORBIDDEN_PORTS.has(nextPort) ? DEFAULT_PORT : nextPort,
      units: { ...appConfig.units, ...(body.units || {}) },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2), 'utf8');
    const pluginStatus = installPluginToGames();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, config: appConfig, pluginStatus }));
    return;
  }

  // 8. Re-extrair Mapas (.scs / .zip) sob demanda pela interface
  if (pathname === '/api/extract-maps' && req.method === 'POST') {
    const extractorPath = path.join(ROOT_DIR, 'extractor.mjs');
    const child = spawn(process.execPath, [extractorPath], { cwd: ROOT_DIR });
    let logOut = '';
    child.stdout.on('data', (d) => { logOut += d.toString(); });
    child.stderr.on('data', (d) => { logOut += d.toString(); });
    child.on('close', (code) => {
      loadedMaps.clear();
      gzipVisualCache.clear();
      loadMapData(state.activeMapId);
      res.writeHead(code === 0 ? 200 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: code === 0, log: logOut }));
    });
    return;
  }

  // 9. Arquivos Estáticos do PWA (public/)
  let relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!safePath.startsWith(PUBLIC_DIR) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(safePath).pipe(res);
});

// Upgrade para WebSocket nativo (/ws)
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  wsClients.add(socket);

  // Envia estado e rota atuais imediatamente ao conectar
  if (state.activeRoute) {
    sendWsFrame(
      socket,
      JSON.stringify({
        type: 'route',
        route: state.activeRoute,
      })
    );
  }
  sendWsFrame(socket, buildCompactStatePayload());

  socket.on('data', (buf) => {
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    if (opcode === 0x08) {
      // Close frame
      wsClients.delete(socket);
      socket.end();
    } else if (opcode === 0x09) {
      // Ping -> Pong
      const pong = Buffer.from([0x8a, 0x00]);
      try { socket.write(pong); } catch { /* ignore */ }
    }
  });

  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

// Pré-carrega o mapa inicial (ETS2 RBR) e posiciona em São Paulo enquanto aguarda o jogo
const initMap = loadMapData('ets2_rbr');
if (initMap) {
  const sp = initMap.cities.find((c) => /s.o paulo/i.test(c[1])) || initMap.cities[0];
  if (sp) {
    const spNode = initMap.nodes[sp[5]];
    state.truck.x = spNode ? spNode[0] : sp[3];
    state.truck.y = spNode ? spNode[1] : sp[4];
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalLanIps();
  const mainLanIp = ips.find((ip) => ip.startsWith('192.168.')) || ips[0] || '192.168.1.103';
  const plug = installPluginToGames();
  console.log('======================================================');
  console.log(`QuTMap rodando na porta ${PORT}!`);
  console.log(`  PC (2ª Tela):        http://127.0.0.1:${PORT}`);
  console.log(`  Galaxy Tab S10 FE:   http://${mainLanIp}:${PORT}`);
  console.log(`  Plugin Telemetria:   ETS2=${plug.ets2 ? 'OK' : 'Pendente'} | ATS=${plug.ats ? 'OK' : 'Pendente'}`);
  console.log('======================================================');
  ensureTelemetryBridgeRunning();
  connectToTelemetryBridge();
});
