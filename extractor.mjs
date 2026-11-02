import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

// ============================================================================
// 1. CityHash64 & Token64 Decoder (Pure Node.js, Zero Dependencies)
// ============================================================================
const TOKEN_CHARS = "\x000123456789abcdefghijklmnopqrstuvwxyz_";
export function decodeToken(n) {
  let s = "";
  while (n > 0n) {
    const rem = Number(n % 38n);
    if (rem > 0) s += TOKEN_CHARS[rem];
    n /= 38n;
  }
  return s;
}

const k0 = 0xc3a5c85c97cb3127n;
const k1 = 0xb492b66fbe98f273n;
const k2 = 0x9ae16a3b2f90404fn;
const k3 = 0xc949d7c7509e6557n;
const kMul = 0x9ddfea08eb382d69n;

const u64 = (x) => BigInt.asUintN(64, x);
const rot = (val, shift) => shift === 0 ? val : u64((val >> BigInt(shift)) | (val << BigInt(64 - shift)));
const shiftMix = (val) => u64(val ^ (val >> 47n));

function hashLen16(u, v) {
  let a = u64((u ^ v) * kMul);
  a = u64(a ^ (a >> 47n));
  let b = u64((v ^ a) * kMul);
  b = u64(b ^ (b >> 47n));
  return u64(b * kMul);
}

function fetch64(buf, p) { return buf.readBigUInt64LE(p); }
function fetch32(buf, p) { return BigInt(buf.readUInt32LE(p)); }

function hashLen0to16(buf) {
  const len = buf.length;
  const lenB = BigInt(len);
  if (len > 8) {
    const a = fetch64(buf, 0);
    const b = fetch64(buf, len - 8);
    return u64(hashLen16(a, rot(u64(b + lenB), len)) ^ b);
  }
  if (len >= 4) {
    const a = fetch32(buf, 0);
    return hashLen16(u64(lenB + (a << 3n)), fetch32(buf, len - 4));
  }
  if (len > 0) {
    const a = BigInt(buf[0]);
    const b = BigInt(buf[len >> 1]);
    const c = BigInt(buf[len - 1]);
    const y = u64(a + (b << 8n));
    const z = u64(lenB + (c << 2n));
    return u64(shiftMix(u64(y * k2) ^ u64(z * k3)) * k2);
  }
  return k2;
}

function hashLen17to32(buf) {
  const len = buf.length;
  const lenB = BigInt(len);
  const a = u64(fetch64(buf, 0) * k1);
  const b = fetch64(buf, 8);
  const c = u64(fetch64(buf, len - 8) * k2);
  const d = u64(fetch64(buf, len - 16) * k0);
  return hashLen16(
    u64(rot(u64(a - b), 43) + rot(c, 30) + d),
    u64(a + rot(u64(b ^ k3), 20) - c + lenB)
  );
}

function weakHashLen32WithSeeds(buf, offset, a, b) {
  const w = fetch64(buf, offset);
  const x = fetch64(buf, offset + 8);
  const y = fetch64(buf, offset + 16);
  const z = fetch64(buf, offset + 24);
  a = u64(a + w);
  b = rot(u64(b + a + z), 21);
  const c = a;
  a = u64(a + x);
  a = u64(a + y);
  b = u64(b + rot(a, 44));
  return [u64(a + z), u64(b + c)];
}

function hashLen33to64(buf) {
  const len = buf.length;
  const lenB = BigInt(len);
  let z = fetch64(buf, 24);
  let a = u64(fetch64(buf, 0) + u64(lenB + fetch64(buf, len - 16)) * k0);
  let b = rot(u64(a + z), 52);
  let c = rot(a, 37);
  a = u64(a + fetch64(buf, 8));
  c = u64(c + rot(a, 7));
  a = u64(a + fetch64(buf, 16));
  const vf = u64(a + z);
  const vs = u64(b + rot(a, 31) + c);
  a = u64(fetch64(buf, 16) + fetch64(buf, len - 32));
  z = fetch64(buf, len - 8);
  b = rot(u64(a + z), 52);
  c = rot(a, 37);
  a = u64(a + fetch64(buf, len - 24));
  c = u64(c + rot(a, 7));
  a = u64(a + fetch64(buf, len - 16));
  const wf = u64(a + z);
  const ws = u64(b + rot(a, 31) + c);
  const r = shiftMix(u64(u64(vf + ws) * k2 + u64(wf + vs) * k0));
  return u64(shiftMix(u64(r * k0 + vs)) * k2);
}

export function city64(str) {
  const buf = Buffer.from(str, "utf8");
  const len = buf.length;
  if (len <= 16) return hashLen0to16(buf);
  if (len <= 32) return hashLen17to32(buf);
  if (len <= 64) return hashLen33to64(buf);
  const lenB = BigInt(len);
  let x = fetch64(buf, len - 40);
  let y = u64(fetch64(buf, len - 16) + fetch64(buf, len - 56));
  let z = hashLen16(u64(fetch64(buf, len - 48) + lenB), fetch64(buf, len - 24));
  let v = weakHashLen32WithSeeds(buf, len - 64, lenB, z);
  let w = weakHashLen32WithSeeds(buf, len - 32, u64(y + k1), x);
  x = u64(x * k1 + fetch64(buf, 0));
  let rem = (len - 1) & ~63;
  let pos = 0;
  do {
    x = u64(rot(u64(x + y + v[0] + fetch64(buf, pos + 8)), 37) * k1);
    y = u64(rot(u64(y + v[1] + fetch64(buf, pos + 48)), 42) * k1);
    x = u64(x ^ w[1]);
    y = u64(y + v[0] + fetch64(buf, pos + 40));
    z = u64(rot(u64(z + w[0]), 33) * k1);
    v = weakHashLen32WithSeeds(buf, pos, u64(v[1] * k1), u64(x + w[0]));
    w = weakHashLen32WithSeeds(buf, pos + 32, u64(z + w[1]), u64(y + fetch64(buf, pos + 16)));
    const tmp = z; z = x; x = tmp;
    pos += 64;
    rem -= 64;
  } while (rem !== 0);
  return hashLen16(
    u64(hashLen16(v[0], w[0]) + u64(shiftMix(y) * k1) + z),
    u64(hashLen16(v[1], w[1]) + x)
  );
}

// ============================================================================
// 2. Archive Readers: SCS HashFS v1/v2 & ZIP (.scs / .zip)
// ============================================================================
export class ScsHashFs {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, "r");
    const hdr = Buffer.alloc(60);
    fs.readSync(this.fd, hdr, 0, 60, 0);
    this.magic = hdr.toString("ascii", 0, 4);
    if (this.magic !== "SCS#") {
      fs.closeSync(this.fd);
      throw new Error("Not an SCS# HashFS file: " + filePath);
    }
    this.version = hdr.readUInt16LE(4);
    this.entries = new Map();

    if (this.version === 2) {
      const entryTableCount = hdr.readUInt32LE(12);
      const entryTableCompSize = hdr.readUInt32LE(16);
      const metaTableSize = hdr.readUInt32LE(20);
      const metaTableCompSize = hdr.readUInt32LE(24);
      const entryTableOffset = hdr.readBigUInt64LE(28);
      const metaTableOffset = hdr.readBigUInt64LE(36);

      const entryRaw = Buffer.alloc(entryTableCompSize);
      fs.readSync(this.fd, entryRaw, 0, entryTableCompSize, entryTableOffset);
      const entryBuf = entryTableCompSize !== entryTableCount * 16 ? zlib.inflateSync(entryRaw) : entryRaw;

      const metaRaw = Buffer.alloc(metaTableCompSize);
      fs.readSync(this.fd, metaRaw, 0, metaTableCompSize, metaTableOffset);
      const metaBuf = metaTableCompSize !== metaTableSize ? zlib.inflateSync(metaRaw) : metaRaw;

      for (let i = 0; i < entryTableCount; i++) {
        const p = i * 16;
        const hash = entryBuf.readBigUInt64LE(p);
        const metaIdx = entryBuf.readUInt32LE(p + 8);
        const flags = entryBuf.readUInt8(p + 14);
        const isDir = (flags & 1) !== 0;
        const mhPos = 4 * metaIdx;
        const idx = metaBuf.readUIntLE(mhPos, 3);
        const type = metaBuf.readUInt8(mhPos + 3);
        if (type === 128 || type === 129) {
          const mePos = 4 * idx;
          const packed = metaBuf.readUInt32LE(mePos);
          const compSize = packed & 0x0fffffff;
          const compression = (packed >>> 28) & 0x0f;
          const uncompSize = metaBuf.readUInt32LE(mePos + 4) & 0x0fffffff;
          const offset = BigInt(metaBuf.readUInt32LE(mePos + 12)) * 16n;
          this.entries.set(hash, { hash, isDir, compSize, uncompSize, compression, offset });
        }
      }
    } else if (this.version === 1) {
      const entryCount = hdr.readUInt32LE(12);
      const startOffset = hdr.readUInt32LE(16);
      const tableBuf = Buffer.alloc(entryCount * 32);
      fs.readSync(this.fd, tableBuf, 0, tableBuf.length, startOffset);
      for (let i = 0; i < entryCount; i++) {
        const p = i * 32;
        const hash = tableBuf.readBigUInt64LE(p);
        const offset = tableBuf.readBigUInt64LE(p + 8);
        const flags = tableBuf.readUInt32LE(p + 16);
        const uncompSize = tableBuf.readUInt32LE(p + 24);
        const compSize = tableBuf.readUInt32LE(p + 28);
        const isDir = (flags & 1) !== 0;
        const compression = (flags & 2) !== 0 ? 1 : 0;
        this.entries.set(hash, { hash, isDir, compSize, uncompSize, compression, offset });
      }
    }
  }
  readEntry(entry) {
    const raw = Buffer.alloc(entry.compSize);
    fs.readSync(this.fd, raw, 0, entry.compSize, entry.offset);
    if (entry.compression === 0) return raw;
    if (entry.compression === 1) return zlib.inflateSync(raw);
    if (entry.compression === 2) return zlib.inflateRawSync(raw);
    throw new Error("Unsupported compression " + entry.compression);
  }
  readDir(dirPath) {
    const clean = dirPath.replace(/^\/+|\/+$/g, "");
    const e = this.entries.get(city64(clean));
    if (!e || !e.isDir) return null;
    const buf = this.readEntry(e);
    if (this.version === 1) {
      const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
      const dirs = [], files = [];
      for (const l of lines) {
        if (l.startsWith("*")) dirs.push(l.slice(1));
        else files.push(l);
      }
      return { dirs, files };
    }
    const count = buf.readUInt32LE(0);
    let pos = 4 + count;
    const dirs = [], files = [];
    for (let i = 0; i < count; i++) {
      const len = buf.readUInt8(4 + i);
      const s = buf.toString("utf8", pos, pos + len);
      pos += len;
      if (s.startsWith("/")) dirs.push(s.slice(1));
      else files.push(s);
    }
    return { dirs, files };
  }
  readFile(filePath) {
    const clean = filePath.replace(/^\/+/g, "");
    const e = this.entries.get(city64(clean));
    if (!e || e.isDir) return null;
    return this.readEntry(e);
  }
  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

export class ZipFs {
  constructor(filePath) {
    this.filePath = filePath;
    const stat = fs.statSync(filePath);
    this.fd = fs.openSync(filePath, "r");
    const tailSize = Math.min(65557, stat.size);
    const buf = Buffer.alloc(tailSize);
    fs.readSync(this.fd, buf, 0, tailSize, stat.size - tailSize);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) {
      fs.closeSync(this.fd);
      this.fd = null;
      throw new Error("Not a valid ZIP file: " + filePath);
    }
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(this.fd, cdBuf, 0, cdSize, cdOffset);
    this.entries = new Map();
    let pos = 0;
    while (pos + 46 <= cdBuf.length) {
      if (cdBuf.readUInt32LE(pos) !== 0x02014b50) break;
      const method = cdBuf.readUInt16LE(pos + 10);
      const compSize = cdBuf.readUInt32LE(pos + 20);
      const uncompSize = cdBuf.readUInt32LE(pos + 24);
      const fnLen = cdBuf.readUInt16LE(pos + 28);
      const exLen = cdBuf.readUInt16LE(pos + 30);
      const cmLen = cdBuf.readUInt16LE(pos + 32);
      const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
      const name = cdBuf.toString("utf8", pos + 46, pos + 46 + fnLen).replace(/\\/g, "/").replace(/^\/+/, "");
      if (!name.endsWith("/")) {
        this.entries.set(name, { name, method, compSize, uncompSize, localHeaderOffset });
      }
      pos += 46 + fnLen + exLen + cmLen;
    }
  }
  readEntry(e) {
    const lh = Buffer.alloc(30);
    fs.readSync(this.fd, lh, 0, 30, e.localHeaderOffset);
    const fnLen = lh.readUInt16LE(26);
    const exLen = lh.readUInt16LE(28);
    const compBuf = Buffer.alloc(e.compSize);
    fs.readSync(this.fd, compBuf, 0, e.compSize, e.localHeaderOffset + 30 + fnLen + exLen);
    if (e.method === 0) return compBuf;
    if (e.method === 8) return zlib.inflateRawSync(compBuf);
    throw new Error("Unsupported ZIP compression method " + e.method);
  }
  readFile(filePath) {
    const clean = filePath.replace(/^\/+/g, "");
    const e = this.entries.get(clean);
    if (!e) return null;
    return this.readEntry(e);
  }
  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

// ============================================================================
// 3. Binary Parsers: .base Sector (v905-907) & .ppd Prefab (v24-25)
// ============================================================================
class BufReader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  u8() { const v = this.buf.readUInt8(this.pos); this.pos += 1; return v; }
  i8() { const v = this.buf.readInt8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  i16() { const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  i32() { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  u64() { const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return v; }
  f32() { const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  skip(n) { this.pos += n; }
  tok() { return decodeToken(this.u64()); }
  str() {
    const len = Number(this.u64());
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
  skipStr() {
    const len = Number(this.u64());
    this.pos += len;
  }
  skipQuadInfo() {
    const matCount = this.u16();
    this.skip(matCount * 10);
    const colCount = this.u16();
    this.skip(colCount * 4);
    this.skip(4);
    const storCount = this.u32();
    this.skip(storCount * 4);
    const offCount = this.u32();
    this.skip(offCount * 16);
    const normCount = this.u32();
    this.skip(normCount * 16);
  }
  skipVegSpheres() {
    const cnt = this.u32();
    this.skip(cnt * 20);
  }
}

function readSectorItem(r, sectorVersion, isSimple, out) {
  const type = r.u32();
  const uid = r.u64();
  const x = r.f32();
  const z = r.f32();
  const y = r.f32();
  r.skip(28);
  const flags = r.u32();
  r.skip(1);

  switch (type) {
    case 1: { // Terrain
      r.skip(16 + 24 + 8 + 4 + 30 + 156);
      r.skipVegSpheres();
      r.skipQuadInfo();
      r.skipQuadInfo();
      r.skip(32);
      break;
    }
    case 2: { // Building
      r.skip(16 + 16 + 12);
      const cnt = r.u32();
      r.skip(cnt * 4);
      break;
    }
    case 3: { // Road
      const flags1 = r.u8();
      const dlcGuard = r.u8();
      const flags2 = r.u16();
      const roadLook = r.tok();
      const rightLanes = r.tok();
      const leftLanes = r.tok();
      r.skip(11 * 8 + 2 * 4 + 3 * 20 + 8);
      const startNodeUid = r.u64();
      const endNodeUid = r.u64();
      const length = r.f32();
      const hidden = (flags & 0x02000000) !== 0;
      out.roads.push({ uid, x, y, flags, flags1, flags2, dlcGuard, roadLook, rightLanes, leftLanes, startNodeUid, endNodeUid, length, hidden });
      break;
    }
    case 4: { // Prefab
      const model = r.tok();
      const variant = r.tok();
      const partsCnt = r.u32();
      r.skip(partsCnt * 8);
      const nodeCnt = r.u32();
      const nodeUids = [];
      for (let i = 0; i < nodeCnt; i++) nodeUids.push(r.u64());
      const connCnt = r.u32();
      r.skip(connCnt * 8);
      const ferryLink = r.u64();
      const originIndex = r.u16();
      r.skip(nodeCnt * 12 + 8);
      const hidden = (flags & 0x00020000) !== 0;
      const dlcGuard = (flags & 0x0000ff00) >>> 8;
      out.prefabs.push({ uid, x, y, flags, dlcGuard, model, variant, nodeUids, originIndex, ferryLink, hidden });
      break;
    }
    case 5: { // Model
      r.skip(24);
      const addCnt = r.u32();
      r.skip(addCnt * 8 + 8 + 12 + 8 + 4 + 4);
      break;
    }
    case 6: { // Company
      const cityName = r.tok();
      const prefabUid = r.u64();
      const overlayName = r.tok();
      const nodeUid = r.u64();
      const nodesCnt = r.u32();
      r.skip(nodesCnt * 12);
      out.companies.push({ uid, x, y, cityName, prefabUid, overlayName, nodeUid });
      break;
    }
    case 7: { // Service
      const nodeUid = r.u64();
      const prefabUid = r.u64();
      const subCnt = r.u32();
      r.skip(subCnt * 8);
      out.services.push({ uid, x, y, type: "service", nodeUid, prefabUid });
      break;
    }
    case 8: { // CutPlane
      const cnt = r.u32();
      r.skip(cnt * 8);
      break;
    }
    case 9: { // Mover
      const tagsCnt = r.u32();
      r.skip(tagsCnt * 8 + 24 + 16);
      const lenCnt = r.u32();
      r.skip(lenCnt * 4);
      const nodeCnt = r.u32();
      r.skip(nodeCnt * 8);
      break;
    }
    case 11: { // NoWeather
      r.skip(12 + 16 + 8);
      break;
    }
    case 12: { // City
      const token = r.tok();
      const width = r.f32();
      const height = r.f32();
      const nodeUid = r.u64();
      out.cities.push({ uid, x, y, token, width, height, nodeUid, hidden: (flags & 1) !== 0 });
      break;
    }
    case 13: { // Hinge
      r.skip(32);
      break;
    }
    case 18: { // MapOverlay
      const name = r.tok();
      const nodeUid = r.u64();
      out.overlays.push({ uid, x, y, flags, overlayType: flags & 0x0f, name, nodeUid });
      break;
    }
    case 19: { // Ferry
      const ferryPort = r.tok();
      const prefabUid = r.u64();
      const nodeUid = r.u64();
      r.skip(12);
      out.ferries.push({ uid, x, y, ferryPort, prefabUid, nodeUid, train: (flags & 1) !== 0 });
      break;
    }
    case 22: { // Garage
      const cityName = r.tok();
      const gType = r.u32();
      const nodeUid = r.u64();
      const prefabUid = r.u64();
      const chCnt = r.u32();
      r.skip(chCnt * 8);
      out.services.push({ uid, x, y, type: "garage", cityName, gType, nodeUid, prefabUid });
      break;
    }
    case 23: { // CameraPoint
      const cnt = r.u32();
      r.skip(cnt * 8 + 8);
      break;
    }
    case 34: { // Trigger
      const tagsCnt = r.u32();
      r.skip(tagsCnt * 8);
      const nodeCnt = r.u32();
      const nodeUids = [];
      for (let i = 0; i < nodeCnt; i++) nodeUids.push(r.u64());
      const actCnt = r.u32();
      let isParking = false;
      for (let i = 0; i < actCnt; i++) {
        const act = r.tok();
        if (act === "hud_parking") isParking = true;
        const hasOv = r.i32();
        if (hasOv > 0) r.skip(hasOv * 4);
        if (hasOv >= 0) {
          const pCnt = r.u32();
          for (let j = 0; j < pCnt; j++) r.skipStr();
          const tCnt = r.u32();
          r.skip(tCnt * 8 + 8);
        }
      }
      if (nodeCnt === 1) r.skip(4);
      if (isParking) {
        out.services.push({ uid, x, y, type: "rest", nodeUid: nodeUids[0] ?? 0n, prefabUid: 0n });
      }
      break;
    }
    case 35: { // FuelPump
      const nodeUid = r.u64();
      const prefabUid = r.u64();
      const chCnt = r.u32();
      r.skip(chCnt * 8);
      out.services.push({ uid, x, y, type: "fuel", nodeUid, prefabUid });
      break;
    }
    case 36: { // Sign
      r.skip(32);
      const bCnt = r.u8();
      r.skip(bCnt * 24);
      const ovTpl = r.str();
      if (ovTpl !== "") {
        const obCnt = r.u32();
        for (let i = 0; i < obCnt; i++) {
          r.skip(8);
          const fl = r.u8();
          if (fl & 1) r.skip(2);
          if (fl & 2) r.skip(8);
        }
        const itCnt = r.u32();
        for (let i = 0; i < itCnt; i++) {
          r.skip(12);
          const atCnt = r.u32();
          for (let j = 0; j < atCnt; j++) {
            const vt = r.u16();
            r.skip(4);
            if (vt === 1) r.skip(1);
            else if (vt === 2 || vt === 3 || vt === 4) r.skip(4);
            else if (vt === 5) r.skipStr();
            else if (vt === 6) r.skip(8);
            else throw new Error("Unknown sign attr vt " + vt);
          }
        }
      }
      break;
    }
    case 37: { // BusStop
      r.skip(24);
      break;
    }
    case 38: { // TrafficRule
      const tCnt = r.u32();
      r.skip(tCnt * 8);
      const nCnt = r.u32();
      r.skip(nCnt * 8 + 12);
      break;
    }
    case 39: { // BezierPatch
      r.skip(16 * 12 + 4 + 8 + 4 + 3 * 11);
      r.skipVegSpheres();
      r.skipQuadInfo();
      break;
    }
    case 40: { // Compound
      if (isSimple) throw new Error("Nested compound");
      r.skip(8);
      const chItCnt = r.u32();
      for (let i = 0; i < chItCnt; i++) readSectorItem(r, sectorVersion, true, out);
      const chNdCnt = r.u32();
      for (let i = 0; i < chNdCnt; i++) {
        const nuid = r.u64();
        const nx = r.i32() / 256, nz = r.i32() / 256, ny = r.i32() / 256;
        const qw = r.f32(), qx = r.f32(), qy = r.f32(), qz = r.f32();
        const backwardItemUid = r.u64();
        const forwardItemUid = r.u64();
        const nflags = r.u32();
        const rot = Math.atan2(-qy, qw) * 2 - Math.PI / 2;
        out.nodes.push({ uid: nuid, x: nx, y: ny, z: nz, rot, backwardItemUid, forwardItemUid, flags: nflags });
      }
      break;
    }
    case 41: { // TrajectoryItem
      const nCnt = r.u32();
      r.skip(nCnt * 8 + 8);
      const rCnt = r.u32();
      r.skip(rCnt * 28);
      const cCnt = r.u32();
      r.skip(cCnt * 16);
      const tCnt = r.u32();
      r.skip(tCnt * 8);
      break;
    }
    case 42: { // MapArea
      const nCnt = r.u32();
      const nodeUids = [];
      for (let i = 0; i < nCnt; i++) nodeUids.push(r.u64());
      const colorIndex = r.u32();
      const hidden = (flags & 0x10000010) !== 0;
      out.mapAreas.push({ uid, x, y, flags, nodeUids, colorIndex, hidden });
      break;
    }
    case 43: { // FarModel
      r.skip(8);
      const mCnt = r.u32(); r.skip(mCnt * 20);
      const cCnt = r.u32(); r.skip(cCnt * 8);
      const nCnt = r.u32(); r.skip(nCnt * 8);
      break;
    }
    case 44: { // Curve
      if (sectorVersion >= 907) {
        r.skip(36);
        let mask = r.u32();
        let cnt = 0;
        while (mask !== 0) { mask &= mask - 1; cnt++; }
        for (let i = 0; i < cnt; i++) {
          r.skip(76);
          const hCnt = r.u32();
          r.skip(hCnt * 4 + 20);
        }
      } else {
        r.skip(108);
        const hCnt = r.u32();
        r.skip(hCnt * 4);
      }
      break;
    }
    case 45: { // CameraPath
      const tCnt = r.u32(); r.skip(tCnt * 8);
      const nCnt = r.u32(); r.skip(nCnt * 8);
      const tpCnt = r.u32(); r.skip(tpCnt * 8);
      const ccCnt = r.u32(); r.skip(ccCnt * 8);
      const kfCnt = r.u32(); r.skip(kfCnt * 40);
      r.skip(4);
      break;
    }
    case 46: { // Cutscene
      const tCnt = r.u32();
      r.skip(tCnt * 8 + 8);
      const aCnt = r.u32();
      for (let i = 0; i < aCnt; i++) {
        const pCnt = r.u32(); r.skip(pCnt * 4);
        const sCnt = r.u32(); for (let j = 0; j < sCnt; j++) r.skipStr();
        const tgCnt = r.u32(); r.skip(tgCnt * 8 + 8);
      }
      break;
    }
    case 47: { // Hookup
      r.skipStr();
      r.skip(8);
      break;
    }
    case 48: { // VisibilityArea
      r.skip(16);
      const cCnt = r.u32();
      r.skip(cCnt * 8);
      break;
    }
    case 49: { // Gate
      r.skip(8);
      const nCnt = r.u32();
      r.skip(nCnt * 8);
      for (let i = 0; i < 2; i++) { r.skipStr(); r.skip(4); }
      break;
    }
    default:
      throw new Error(`Unknown item type ${type} at pos ${r.pos}`);
  }
}

export function parseSectorFast(buf) {
  const r = new BufReader(buf);
  const version = r.u32();
  r.skip(12);
  const itemCnt = r.u32();
  const out = { version, roads: [], prefabs: [], cities: [], companies: [], services: [], overlays: [], ferries: [], mapAreas: [], nodes: [] };
  for (let i = 0; i < itemCnt; i++) {
    readSectorItem(r, version, false, out);
  }
  const nodeCnt = r.u32();
  for (let i = 0; i < nodeCnt; i++) {
    const uid = r.u64();
    const x = r.i32() / 256;
    const z = r.i32() / 256;
    const y = r.i32() / 256;
    const qw = r.f32(), qx = r.f32(), qy = r.f32(), qz = r.f32();
    const backwardItemUid = r.u64();
    const forwardItemUid = r.u64();
    const flags = r.u32();
    const rot = Math.atan2(-qy, qw) * 2 - Math.PI / 2;
    out.nodes.push({ uid, x, y, z, rot, backwardItemUid, forwardItemUid, flags });
  }
  return out;
}

export function parsePpdFast(buf) {
  if (!buf || buf.length < 72) return null;
  const version = buf.readUInt32LE(0);
  if (version < 19 || version > 26) return null;

  const numNodes = buf.readUInt32LE(4);
  const numNavCurves = buf.readUInt32LE(8);
  const numSpawnPoints = buf.readUInt32LE(20);
  const numMapPoints = buf.readUInt32LE(version === 19 ? 28 : 32);
  const numTriggerPoints = buf.readUInt32LE(version === 19 ? 32 : 36);

  let offBase = 48;
  if (version === 21) offBase = 44;
  else if (version === 20) offBase = 40;
  else if (version === 19) offBase = 36;

  const offNodes = buf.readUInt32LE(offBase);
  const offNavCurves = buf.readUInt32LE(offBase + 4);
  const offSigns = buf.readUInt32LE(offBase + 8);
  const offSpawnPoints = buf.readUInt32LE(offBase + 16);
  const offMapPoints = buf.readUInt32LE(version >= 21 ? offBase + 32 : (version === 20 ? offBase + 28 : offBase + 24));
  const offTriggerPoints = buf.readUInt32LE(version >= 21 ? offBase + 36 : (version === 20 ? offBase + 32 : offBase + 28));

  const nodeStride = version >= 21 ? 104 : 96;
  const nodePosOff = version >= 21 ? 16 : 8;
  const nodes = [];
  for (let i = 0; i < numNodes; i++) {
    const p = offNodes + i * nodeStride;
    if (p + nodeStride > buf.length) break;
    const x = buf.readFloatLE(p + nodePosOff);
    const z = buf.readFloatLE(p + nodePosOff + 4);
    const y = buf.readFloatLE(p + nodePosOff + 8);
    const rx = buf.readFloatLE(p + nodePosOff + 12);
    const ry = buf.readFloatLE(p + nodePosOff + 20);
    const rot = Math.atan2(ry, rx);
    const inputLanes = [];
    const outputLanes = [];
    for (let j = 0; j < 8; j++) {
      const il = buf.readInt32LE(p + nodePosOff + 24 + j * 4);
      if (il !== -1) inputLanes.push(il);
      const ol = buf.readInt32LE(p + nodePosOff + 56 + j * 4);
      if (ol !== -1) outputLanes.push(ol);
    }
    nodes.push({ x, y, z, rot, inputLanes, outputLanes });
  }

  const navCurves = [];
  const ncStride = numNavCurves > 0 && offSigns > offNavCurves
    ? Math.round((offSigns - offNavCurves) / numNavCurves)
    : (version >= 22 ? 132 : 128);
  if (ncStride >= 116) {
    for (let i = 0; i < numNavCurves; i++) {
      const p = offNavCurves + i * ncStride;
      if (p + 116 > buf.length) break;
      const sx = buf.readFloatLE(p + 16), sy = buf.readFloatLE(p + 24);
      const ex = buf.readFloatLE(p + 28), ey = buf.readFloatLE(p + 36);
      const sqw = buf.readFloatLE(p + 40), sqy = buf.readFloatLE(p + 48);
      const eqw = buf.readFloatLE(p + 56), eqy = buf.readFloatLE(p + 64);
      const length = buf.readFloatLE(p + 72);
      const cntNext = buf.readUInt32LE(p + 108);
      const cntPrev = buf.readUInt32LE(p + 112);
      const nextLines = [];
      for (let j = 0; j < cntNext && j < 4; j++) {
        const nl = buf.readInt32LE(p + 76 + j * 4);
        if (nl >= 0 && nl < numNavCurves) nextLines.push(nl);
      }
      const prevLines = [];
      for (let j = 0; j < cntPrev && j < 4; j++) {
        const pl = buf.readInt32LE(p + 92 + j * 4);
        if (pl >= 0 && pl < numNavCurves) prevLines.push(pl);
      }
      const sRot = Math.atan2(-sqy, sqw) * 2 - Math.PI / 2;
      const eRot = Math.atan2(-eqy, eqw) * 2 - Math.PI / 2;
      navCurves.push({ sx, sy, sRot, ex, ey, eRot, length, nextLines, prevLines });
    }
  }

  const spawnPoints = [];
  const spStride = version >= 24 ? 36 : 32;
  for (let i = 0; i < numSpawnPoints; i++) {
    const p = offSpawnPoints + i * spStride;
    if (p + spStride > buf.length) break;
    const x = buf.readFloatLE(p);
    const y = buf.readFloatLE(p + 8);
    const type = buf.readUInt32LE(p + 28);
    spawnPoints.push({ x, y, type });
  }

  const mapPoints = [];
  for (let i = 0; i < numMapPoints; i++) {
    const p = offMapPoints + i * 48;
    if (p + 48 > buf.length) break;
    const sizeAndOffset = buf.readUInt8(p + 1);
    const paint = buf.readUInt8(p + 2);
    const controlFlags = buf.readUInt8(p + 5);
    const x = buf.readFloatLE(p + 8);
    const y = buf.readFloatLE(p + 16);
    const neighborCount = buf.readUInt32LE(p + 44);
    const neighbors = [];
    for (let j = 0; j < neighborCount && j < 6; j++) {
      const nb = buf.readInt32LE(p + 20 + j * 4);
      if (nb >= 0 && nb < numMapPoints) neighbors.push(nb);
    }
    mapPoints.push({ x, y, sizeAndOffset, paint, controlFlags, neighbors });
  }

  const triggerPoints = [];
  for (let i = 0; i < numTriggerPoints; i++) {
    const p = offTriggerPoints + i * 48;
    if (p + 48 > buf.length) break;
    const action = decodeToken(buf.readBigUInt64LE(p + 4));
    const x = buf.readFloatLE(p + 28);
    const y = buf.readFloatLE(p + 36);
    triggerPoints.push({ x, y, action });
  }

  return { nodes, navCurves, spawnPoints, mapPoints, triggerPoints };
}

// ============================================================================
// 4. Geometry Helpers (Hermite Splines & Prefab World Transform)
// ============================================================================
const round1 = (v) => Math.round(v * 10) / 10;

export function toSplineFlat(startX, startY, startRot, endX, endY, endRot, maxSteps = 8) {
  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5) {
    return [round1(startX), round1(startY), round1(endX), round1(endY)];
  }
  const dRot = Math.atan2(Math.sin(startRot - endRot), Math.cos(startRot - endRot));
  const steps = Math.max(1, Math.min(maxSteps, Math.floor(Math.abs(dRot) * 10 + dist / 45) + 1));
  if (steps === 1 && Math.abs(dRot) < 0.04) {
    return [round1(startX), round1(startY), round1(endX), round1(endY)];
  }
  const m0x = Math.cos(startRot) * dist;
  const m0y = Math.sin(startRot) * dist;
  const m1x = Math.cos(endRot) * dist;
  const m1y = Math.sin(endRot) * dist;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    pts.push(
      round1(h00 * startX + h10 * m0x + h01 * endX + h11 * m1x),
      round1(h00 * startY + h10 * m0y + h01 * endY + h11 * m1y)
    );
  }
  return pts;
}

export function extractPrefabTemplateConnections(ppd) {
  // Returns Map<startNodeIdx, Map<endNodeIdx, { localPts: [x,y][], length: number }>>
  const endingCurveToNode = new Map();
  for (let ni = 0; ni < ppd.nodes.length; ni++) {
    for (const ol of ppd.nodes[ni].outputLanes) {
      endingCurveToNode.set(ol, ni);
    }
  }

  const M = ppd.navCurves.length;
  const connections = new Map();
  for (let startNodeIdx = 0; startNodeIdx < ppd.nodes.length; startNodeIdx++) {
    const dist = new Float64Array(M).fill(Infinity);
    const prev = new Int32Array(M).fill(-1);
    const visited = new Uint8Array(M);
    const queue = [];

    for (const il of ppd.nodes[startNodeIdx].inputLanes) {
      if (il >= 0 && il < M) {
        dist[il] = Math.max(0.5, ppd.navCurves[il].length || 1);
        queue.push(il);
      }
    }

    while (queue.length > 0) {
      let bestI = 0;
      for (let i = 1; i < queue.length; i++) {
        if (dist[queue[i]] < dist[queue[bestI]]) bestI = i;
      }
      const u = queue[bestI];
      queue.splice(bestI, 1);
      if (visited[u]) continue;
      visited[u] = 1;

      const cur = ppd.navCurves[u];
      if (!cur) continue;
      for (const nxt of cur.nextLines) {
        if (nxt < 0 || nxt >= M) continue;
        const stepLen = Math.max(0.5, ppd.navCurves[nxt].length || 1);
        const nd = dist[u] + stepLen;
        if (nd < dist[nxt]) {
          dist[nxt] = nd;
          prev[nxt] = u;
          queue.push(nxt);
        }
      }
    }

    const byTarget = new Map();
    for (const [endCurveIdx, endNodeIdx] of endingCurveToNode) {
      if (dist[endCurveIdx] === Infinity) continue;
      const existing = byTarget.get(endNodeIdx);
      if (!existing || dist[endCurveIdx] < existing.length) {
        const pathIndices = [];
        let c = endCurveIdx;
        while (c !== -1) {
          pathIndices.push(c);
          c = prev[c];
        }
        pathIndices.reverse();
        const localPts = [];
        let totalLen = 0;
        for (let k = 0; k < pathIndices.length; k++) {
          const nc = ppd.navCurves[pathIndices[k]];
          const sp = toSplineFlat(nc.sx, nc.sy, nc.sRot, nc.ex, nc.ey, nc.eRot, 5);
          for (let p = (k === 0 ? 0 : 2); p < sp.length; p += 2) {
            localPts.push([sp[p], sp[p + 1]]);
          }
        }
        for (let k = 1; k < localPts.length; k++) {
          totalLen += Math.hypot(localPts[k][0] - localPts[k - 1][0], localPts[k][1] - localPts[k - 1][1]);
        }
        byTarget.set(endNodeIdx, { localPts, length: Math.max(1, totalLen) });
      }
    }
    if (byTarget.size > 0) {
      connections.set(startNodeIdx, byTarget);
    }
  }

  // Extract polygons from mapPoints
  const polygons = [];
  const visitedPoly = new Set();
  for (let i = 0; i < ppd.mapPoints.length; i++) {
    const mp = ppd.mapPoints[i];
    if ((mp.sizeAndOffset & 0x0f) !== 13 || visitedPoly.has(i)) continue;
    const poly = [];
    let curIdx = i;
    while (curIdx !== undefined && !visitedPoly.has(curIdx)) {
      visitedPoly.add(curIdx);
      const pt = ppd.mapPoints[curIdx];
      poly.push([pt.x, pt.y]);
      curIdx = pt.neighbors.find(nb => !visitedPoly.has(nb) && (ppd.mapPoints[nb]?.sizeAndOffset & 0x0f) === 13);
    }
    if (poly.length >= 3) {
      let color = 0;
      if (mp.paint & 2) color = 1; // light
      else if (mp.paint & 4) color = 2; // dark
      else if (mp.paint & 8) color = 3; // green
      polygons.push({ localPts: poly, color });
    }
  }

  // Extract internal mapPoint road segments (for prefabs with no navCurves or depot yards)
  const mapRoads = [];
  const skipBase = ppd.mapPoints.length > ppd.nodes.length + 1;
  for (let i = 0; i < ppd.mapPoints.length; i++) {
    const mp = ppd.mapPoints[i];
    if ((mp.sizeAndOffset & 0x0f) === 13) continue;
    if (skipBase && (mp.controlFlags & 2) !== 0) continue;
    for (const nb of mp.neighbors) {
      if (nb <= i) continue;
      const nmp = ppd.mapPoints[nb];
      if (!nmp || (nmp.sizeAndOffset & 0x0f) === 13) continue;
      if (skipBase && (nmp.controlFlags & 2) !== 0) continue;
      mapRoads.push([[mp.x, mp.y], [nmp.x, nmp.y]]);
    }
  }

  return { connections, polygons, mapRoads };
}

// ============================================================================
// 5. SII Def Parsers (road_look, prefab, city, company, ferry, locale)
// ============================================================================
function unescapeSiiString(s) {
  if (!s) return "";
  return s.replace(/(?:\\x[0-9a-fA-F]{2})+/g, (m) => {
    const bytes = m.slice(2).split("\\x").map(b => parseInt(b, 16));
    return Buffer.from(bytes).toString("utf8");
  });
}

function parseLocaleSii(txt, map) {
  const keys = [...txt.matchAll(/key\[\]\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  const vals = [...txt.matchAll(/val\[\]\s*:\s*"([^"]*)"/g)].map(m => unescapeSiiString(m[1]));
  const n = Math.min(keys.length, vals.length);
  for (let i = 0; i < n; i++) {
    map.set(keys[i], vals[i]);
  }
}

function parseRoadLookSii(txt, map) {
  const re = /road_look\s*:\s*road\.([a-z0-9_]+)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(txt))) {
    const tok = m[1].toLowerCase();
    const body = m[2];
    const lanesL = [...body.matchAll(/lanes_left\[\]\s*:\s*"?([^"\s\r\n]+)"?/gi)].map(x => x[1]);
    const lanesR = [...body.matchAll(/lanes_right\[\]\s*:\s*"?([^"\s\r\n]+)"?/gi)].map(x => x[1]);
    const sizeL = parseFloat(/road_size_left\s*:\s*([0-9.]+)/i.exec(body)?.[1] ?? "0");
    const sizeR = parseFloat(/road_size_right\s*:\s*([0-9.]+)/i.exec(body)?.[1] ?? "0");
    const offset = parseFloat(/road_offset\s*:\s*([0-9.]+)/i.exec(body)?.[1] ?? "0");
    const name = /name\s*:\s*"([^"]+)"/i.exec(body)?.[1] ?? tok;

    const allLanes = lanesL.concat(lanesR).join(" ").toLowerCase() + " " + name.toLowerCase();
    let roadType = 2; // 0=freeway, 1=divided, 2=local, 3=slow, 4=no_vehicles
    if (allLanes.includes("tram") || allLanes.includes("train") || allLanes.includes("no_vehicles")) {
      roadType = 4;
    } else if (allLanes.includes("freeway") || allLanes.includes("motorway") || allLanes.includes("hw") || allLanes.includes("autobahn")) {
      roadType = 0;
    } else if (allLanes.includes("divided") || allLanes.includes("expressway") || offset >= 2.0) {
      roadType = 1;
    } else if (allLanes.includes("slow") || allLanes.includes("dirt") || allLanes.includes("unpaved") || allLanes.includes("gravel")) {
      roadType = 3;
    }

    const countL = lanesL.length > 0 ? lanesL.length : (sizeL > 0 ? Math.max(1, Math.round(sizeL / 4.0)) : 0);
    const countR = lanesR.length > 0 ? lanesR.length : (sizeR > 0 ? Math.max(1, Math.round(sizeR / 4.0)) : 0);
    map.set(tok, { tok, name, lanesL: countL, lanesR: countR, offset, roadType });
  }
}

function parsePrefabSii(txt, map) {
  const re = /prefab_model\s*:\s*prefab\.([a-z0-9_]+)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(txt))) {
    const tok = m[1].toLowerCase();
    const pm = /prefab_desc\s*:\s*"\/?([^"]+)"/i.exec(m[2]);
    if (pm) map.set(tok, pm[1]);
  }
}

function parseCitySii(txt, map) {
  const re = /city_data\s*:\s*city\.([a-z0-9_]+)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(txt))) {
    const tok = m[1].toLowerCase();
    const body = m[2];
    const name = unescapeSiiString(/city_name\s*:\s*"([^"]+)"/i.exec(body)?.[1] ?? tok);
    const nameLoc = unescapeSiiString(/city_name_localized\s*:\s*"([^"]+)"/i.exec(body)?.[1] ?? "");
    const country = /country\s*:\s*([a-z0-9_]+)/i.exec(body)?.[1]?.toLowerCase() ?? "";
    const population = parseInt(/population\s*:\s*(\d+)/i.exec(body)?.[1] ?? "0", 10);
    map.set(tok, { tok, name, nameLoc, country, population });
  }
}

function parseCompanySii(txt, map) {
  const re = /company_permanent\s*:\s*company\.permanent\.([a-z0-9_]+)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(txt))) {
    const tok = m[1].toLowerCase();
    const body = m[2];
    const name = unescapeSiiString(/name\s*:\s*"([^"]+)"/i.exec(body)?.[1] ?? tok);
    map.set(tok, { tok, name });
  }
}

function parseFerrySii(txt, map) {
  const re = /ferry_data\s*:\s*ferry\.([a-z0-9_]+)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(txt))) {
    const tok = m[1].toLowerCase();
    const body = m[2];
    const name = unescapeSiiString(/ferry_name\s*:\s*"([^"]+)"/i.exec(body)?.[1] ?? tok);
    const nameLoc = unescapeSiiString(/ferry_name_localized\s*:\s*"([^"]+)"/i.exec(body)?.[1] ?? "");
    if (!map.has(tok)) map.set(tok, { tok, name, nameLoc, connections: [] });
  }
}

function parseFerryConnSii(txt, map) {
  const re = /ferry_connection\s*:\s*conn\.([a-z0-9_]+)\.([a-z0-9_]+)\s*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(txt))) {
    const fromTok = m[1].toLowerCase();
    const toTok = m[2].toLowerCase();
    const body = m[3];
    const dist = parseFloat(/distance\s*:\s*([0-9.]+)/i.exec(body)?.[1] ?? "100");
    const time = parseFloat(/time\s*:\s*([0-9.]+)/i.exec(body)?.[1] ?? "60");
    if (!map.has(fromTok)) map.set(fromTok, { tok: fromTok, name: fromTok, nameLoc: "", connections: [] });
    map.get(fromTok).connections.push({ toTok, distance: dist * 1000, duration: time * 60 });
  }
}

// ============================================================================
// 6. Full Map Extractor & Compiler
// ============================================================================
export function buildMapDataset(config) {
  const t0 = Date.now();
  console.log(`\n======================================================`);
  console.log(`Extraindo mapa: ${config.name} (${config.id})...`);
  console.log(`======================================================`);

  const hashArchives = [];
  for (const p of config.hashPaths) {
    if (fs.existsSync(p)) {
      try { hashArchives.push({ name: path.basename(p), ar: new ScsHashFs(p) }); } catch {}
    }
  }
  const zipArchives = [];
  for (const p of config.zipPaths || []) {
    if (fs.existsSync(p)) {
      try { zipArchives.push({ name: path.basename(p), ar: new ZipFs(p) }); } catch {}
    }
  }

  const l10n = new Map();
  const roadLooks = new Map();
  const prefabPaths = new Map();
  const cityDefs = new Map();
  const companyDefs = new Map();
  const ferryDefs = new Map();

  // 1. Parse definitions from HashFS archives
  for (const { ar } of hashArchives) {
    // Locale (prefer pt_br, fallback en_us)
    for (const lang of ["en_us", "pt_br"]) {
      const ld = ar.readDir(`locale/${lang}`);
      if (ld) {
        for (const f of ld.files) {
          if (f.endsWith(".sii") || f.endsWith(".sui")) {
            const b = ar.readFile(`locale/${lang}/${f}`);
            if (b) parseLocaleSii(b.toString("utf8"), l10n);
          }
        }
      }
    }
    const dw = ar.readDir("def/world");
    if (dw) {
      for (const f of dw.files) {
        if (!f.endsWith(".sii")) continue;
        if (f.startsWith("road_look")) {
          const b = ar.readFile(`def/world/${f}`);
          if (b) parseRoadLookSii(b.toString("utf8"), roadLooks);
        } else if (f.startsWith("prefab.")) {
          const b = ar.readFile(`def/world/${f}`);
          if (b) parsePrefabSii(b.toString("utf8"), prefabPaths);
        }
      }
    }
    const dc = ar.readDir("def/city");
    if (dc) {
      for (const f of dc.files) {
        if (f.endsWith(".sui") || f.endsWith(".sii")) {
          const b = ar.readFile(`def/city/${f}`);
          if (b) parseCitySii(b.toString("utf8"), cityDefs);
        }
      }
    }
    const dcomp = ar.readDir("def/company");
    if (dcomp) {
      for (const f of dcomp.files) {
        if (f.endsWith(".sui") || f.endsWith(".sii")) {
          const b = ar.readFile(`def/company/${f}`);
          if (b) parseCompanySii(b.toString("utf8"), companyDefs);
        }
      }
    }
    const dferry = ar.readDir("def/ferry");
    if (dferry) {
      for (const f of dferry.files) {
        if (f.endsWith(".sui") || f.endsWith(".sii")) {
          const b = ar.readFile(`def/ferry/${f}`);
          if (b) parseFerrySii(b.toString("utf8"), ferryDefs);
        }
      }
    }
    const dfconn = ar.readDir("def/ferry/connection");
    if (dfconn) {
      for (const f of dfconn.files) {
        if (f.endsWith(".sui") || f.endsWith(".sii")) {
          const b = ar.readFile(`def/ferry/connection/${f}`);
          if (b) parseFerryConnSii(b.toString("utf8"), ferryDefs);
        }
      }
    }
  }

  // 2. Parse definitions from ZIP mod archives (overrides base)
  for (const { ar } of zipArchives) {
    for (const [k, e] of ar.entries) {
      if (!k.endsWith(".sii") && !k.endsWith(".sui")) continue;
      if (k.startsWith("def/world/road_look")) {
        parseRoadLookSii(ar.readEntry(e).toString("utf8"), roadLooks);
      } else if (k.startsWith("def/world/prefab.")) {
        parsePrefabSii(ar.readEntry(e).toString("utf8"), prefabPaths);
      } else if (k.startsWith("def/city/")) {
        parseCitySii(ar.readEntry(e).toString("utf8"), cityDefs);
      } else if (k.startsWith("def/company/") && !k.includes("/in/") && !k.includes("/out/") && !k.includes("/editor/")) {
        parseCompanySii(ar.readEntry(e).toString("utf8"), companyDefs);
      } else if (k.startsWith("def/ferry/connection/")) {
        parseFerryConnSii(ar.readEntry(e).toString("utf8"), ferryDefs);
      } else if (k.startsWith("def/ferry/")) {
        parseFerrySii(ar.readEntry(e).toString("utf8"), ferryDefs);
      }
    }
  }

  const resolveLoc = (str, fallback) => {
    if (!str) return fallback;
    const key = str.replace(/^@@|@@$/g, "");
    return l10n.get(key) || (str.startsWith("@@") ? fallback : str);
  };

  function readAnyFile(relPath) {
    const clean = relPath.replace(/^\/+/g, "");
    for (let i = zipArchives.length - 1; i >= 0; i--) {
      const b = zipArchives[i].ar.readFile(clean);
      if (b) return b;
    }
    for (let i = hashArchives.length - 1; i >= 0; i--) {
      const b = hashArchives[i].ar.readFile(clean);
      if (b) return b;
    }
    return null;
  }

  // 3. Collect and parse all .base sector files
  const sectorBuffers = new Map();
  if (config.sectorSource === "zip") {
    for (const { ar } of zipArchives) {
      for (const [k, e] of ar.entries) {
        if (k.startsWith(`map/${config.mapFolder}/`) && k.endsWith(".base")) {
          const baseName = path.basename(k);
          if (e.uncompSize > 28) {
            sectorBuffers.set(baseName, ar.readEntry(e));
          } else {
            sectorBuffers.delete(baseName);
          }
        }
      }
    }
  } else {
    for (const { ar } of hashArchives) {
      const md = ar.readDir(`map/${config.mapFolder}`);
      if (!md) continue;
      for (const f of md.files) {
        if (f.endsWith(".base")) {
          const b = ar.readFile(`map/${config.mapFolder}/${f}`);
          if (b && b.length > 28) sectorBuffers.set(f, b);
        }
      }
    }
  }

  console.log(`Setores .base encontrados: ${sectorBuffers.size}`);

  const allNodes = new Map();
  const allRoads = [];
  const allPrefabs = new Map();
  const allCities = [];
  const allCompanies = [];
  const allServices = [];
  const allOverlays = [];
  const allFerries = [];
  const allMapAreas = [];

  for (const [, buf] of sectorBuffers) {
    const sec = parseSectorFast(buf);
    for (const n of sec.nodes) allNodes.set(n.uid, n);
    for (const r of sec.roads) if (!r.hidden) allRoads.push(r);
    for (const p of sec.prefabs) if (!p.hidden) allPrefabs.set(p.uid, p);
    for (const c of sec.cities) allCities.push(c);
    for (const co of sec.companies) allCompanies.push(co);
    for (const s of sec.services) allServices.push(s);
    for (const ov of sec.overlays) allOverlays.push(ov);
    for (const fe of sec.ferries) allFerries.push(fe);
    for (const ma of sec.mapAreas) if (!ma.hidden) allMapAreas.push(ma);
  }

  console.log(`Itens brutos: ${allRoads.length} estradas, ${allPrefabs.size} prefabs, ${allNodes.size} nós, ${allCompanies.length} empresas`);

  // 4. Parse unique used .ppd prefab templates
  const ppdTemplates = new Map();
  for (const pf of allPrefabs.values()) {
    if (ppdTemplates.has(pf.model)) continue;
    const ppdPath = prefabPaths.get(pf.model);
    if (!ppdPath) { ppdTemplates.set(pf.model, null); continue; }
    const buf = readAnyFile(ppdPath);
    if (!buf) { ppdTemplates.set(pf.model, null); continue; }
    const ppd = parsePpdFast(buf);
    if (!ppd) { ppdTemplates.set(pf.model, null); continue; }
    ppdTemplates.set(pf.model, { ppd, ppdPath, ...extractPrefabTemplateConnections(ppd) });
  }

  // 5. Index nodes and build compact node table
  const nodeUidList = [];
  const nodeUidToIdx = new Map();
  const nodesFlat = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function getOrAddNodeIdx(uid) {
    let idx = nodeUidToIdx.get(uid);
    if (idx !== undefined) return idx;
    const n = allNodes.get(uid);
    if (!n) return -1;
    idx = nodeUidList.length;
    nodeUidList.push(uid.toString(16));
    nodeUidToIdx.set(uid, idx);
    const rx = round1(n.x), ry = round1(n.y);
    nodesFlat.push(rx, ry, Math.round(n.rot * 1000) / 1000);
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
    return idx;
  }

  // Ensure all road, prefab, company, and ferry nodes are indexed
  for (const r of allRoads) {
    getOrAddNodeIdx(r.startNodeUid);
    getOrAddNodeIdx(r.endNodeUid);
  }
  for (const pf of allPrefabs.values()) {
    for (const uid of pf.nodeUids) getOrAddNodeIdx(uid);
  }
  for (const co of allCompanies) {
    getOrAddNodeIdx(co.nodeUid);
  }
  for (const fe of allFerries) {
    getOrAddNodeIdx(fe.nodeUid);
  }

  const numNodes = nodeUidList.length;
  // adj[nodeIdx] = [forwardEdges[], backwardEdges[]]
  // edge = [targetNodeIdx, nextDir (0=fwd, 1=bwd), distMeters, durationSec, geomType, geomIdx]
  const adj = Array.from({ length: numNodes }, () => [[], []]);

  // 6. Build visual roads & road routing edges
  const compiledRoads = [];
  const roadByUid = new Map();
  const defaultSpeeds = config.speedUnit === "mph"
    ? [65, 55, 45, 25, 15] // mph
    : [90, 80, 70, 40, 20]; // km/h

  for (const r of allRoads) {
    const startNode = allNodes.get(r.startNodeUid);
    const endNode = allNodes.get(r.endNodeUid);
    if (!startNode || !endNode) continue;

    const rl = roadLooks.get(r.roadLook);
    let roadType = rl ? rl.roadType : 2;
    if (roadType === 4) continue; // skip trams/trains/no_vehicles

    let lanesL = rl ? rl.lanesL : 1;
    let lanesR = rl ? rl.lanesR : 1;
    if (lanesL === 0 && lanesR === 0) {
      if (r.leftLanes && r.leftLanes !== "no_vehicles") lanesL = 1;
      if (r.rightLanes && r.rightLanes !== "no_vehicles") lanesR = 1;
      if (lanesL === 0 && lanesR === 0) { lanesL = 1; lanesR = 1; }
    }
    const offset = rl ? round1(rl.offset || 0) : 0;
    const speedLimit = defaultSpeeds[roadType] || 70;
    const pts = toSplineFlat(startNode.x, startNode.y, startNode.rot, endNode.x, endNode.y, endNode.rot, 8);
    const roadIdx = compiledRoads.length;
    compiledRoads.push([pts, roadType, lanesL, lanesR, offset, speedLimit]);
    roadByUid.set(r.uid, { roadIdx, r, lanesL, lanesR, roadType, speedLimit });
  }

  // 7. Build visual prefab curves, prefab polygons, facility POIs & prefab connections
  const compiledPrefabCurves = [];
  const compiledPolygons = [];
  const pois = [];
  // Map prefabUid -> Map<originNodeUid, Array<{ targetNodeUid, dist, curveIdx, exitDir }>>
  const prefabGraphEdges = new Map();

  for (const pf of allPrefabs.values()) {
    const tpl = ppdTemplates.get(pf.model);
    const originWorldNode = allNodes.get(pf.nodeUids[0]);
    const originPpdNode = tpl?.ppd?.nodes?.[pf.originIndex];
    if (!tpl || !originWorldNode || !originPpdNode) {
      const N = pf.nodeUids.length;
      if (N >= 2) {
        const pfEdgeMap = new Map();
        for (let i = 0; i < N; i++) {
          const startUid = pf.nodeUids[i];
          const startWorld = allNodes.get(startUid);
          if (!startWorld) continue;
          const list = [];
          for (let j = 0; j < N; j++) {
            if (i === j) continue;
            const endUid = pf.nodeUids[j];
            const endWorld = allNodes.get(endUid);
            if (!endWorld) continue;
            const dist = Math.max(1, Math.round(Math.hypot(endWorld.x - startWorld.x, endWorld.y - startWorld.y)));
            const flat = [round1(startWorld.x), round1(startWorld.y), round1(endWorld.x), round1(endWorld.y)];
            const curveIdx = compiledPrefabCurves.length;
            compiledPrefabCurves.push([flat, 2, 1]);
            list.push({ targetNodeUid: endUid, dist, curveIdx });
          }
          if (list.length > 0) pfEdgeMap.set(startUid, list);
        }
        prefabGraphEdges.set(pf.uid, pfEdgeMap);
      }
      continue;
    }
    const { ppd, ppdPath, connections, polygons, mapRoads } = tpl;

    const rot = originWorldNode.rot - originPpdNode.rot;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tx = (px, py) => [
      originWorldNode.x + cos * (px - originPpdNode.x) - sin * (py - originPpdNode.y),
      originWorldNode.y + sin * (px - originPpdNode.x) + cos * (py - originPpdNode.y)
    ];

    // Polygons
    for (const poly of polygons) {
      const flat = [];
      for (const [px, py] of poly.localPts) {
        const [wx, wy] = tx(px, py);
        flat.push(round1(wx), round1(wy));
      }
      compiledPolygons.push([flat, poly.color]);
    }

    // Internal mapRoads (for prefabs without navCurves or depot yards)
    if (connections.size === 0 && mapRoads.length > 0) {
      for (const [[x0, y0], [x1, y1]] of mapRoads) {
        const [wx0, wy0] = tx(x0, y0);
        const [wx1, wy1] = tx(x1, y1);
        compiledPrefabCurves.push([[round1(wx0), round1(wy0), round1(wx1), round1(wy1)], 3, 1]);
      }
    }

    // NavCurve connections (with exact endpoint blending to world nodes!)
    const N = pf.nodeUids.length;
    const pfEdgeMap = new Map();
    for (const [startNodeIdx, targets] of connections) {
      const startUid = pf.nodeUids[(startNodeIdx - pf.originIndex + N) % N];
      const startWorld = allNodes.get(startUid);
      if (!startWorld) continue;
      const list = [];

      for (const [endNodeIdx, branch] of targets) {
        const endUid = pf.nodeUids[(endNodeIdx - pf.originIndex + N) % N];
        const endWorld = allNodes.get(endUid);
        if (!endWorld) continue;

        const worldPts = branch.localPts.map(([px, py]) => tx(px, py));
        const m = worldPts.length;
        if (m < 2) continue;

        // Exact endpoint lock: blend lateral lane offset smoothly from startWorld to endWorld
        const dxStart = startWorld.x - worldPts[0][0];
        const dyStart = startWorld.y - worldPts[0][1];
        const dxEnd = endWorld.x - worldPts[m - 1][0];
        const dyEnd = endWorld.y - worldPts[m - 1][1];

        const flat = [];
        for (let k = 0; k < m; k++) {
          const t = k / (m - 1);
          const wx = worldPts[k][0] + (1 - t) * dxStart + t * dxEnd;
          const wy = worldPts[k][1] + (1 - t) * dyStart + t * dyEnd;
          flat.push(round1(wx), round1(wy));
        }
        // Guarantee exact node match at endpoints
        flat[0] = round1(startWorld.x);
        flat[1] = round1(startWorld.y);
        flat[flat.length - 2] = round1(endWorld.x);
        flat[flat.length - 1] = round1(endWorld.y);

        const curveIdx = compiledPrefabCurves.length;
        const isRamp = ppdPath.includes("fork") || ppdPath.includes("hw") || ppdPath.includes("flyover");
        compiledPrefabCurves.push([flat, isRamp ? 1 : 2, 1]);
        list.push({ targetNodeUid: endUid, dist: Math.round(branch.length), curveIdx });
      }
      if (list.length > 0) pfEdgeMap.set(startUid, list);
    }
    if (pfEdgeMap.size === 0 && pf.nodeUids.length >= 2) {
      for (let i = 0; i < N; i++) {
        const startUid = pf.nodeUids[i];
        const startWorld = allNodes.get(startUid);
        if (!startWorld) continue;
        const list = [];
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const endUid = pf.nodeUids[j];
          const endWorld = allNodes.get(endUid);
          if (!endWorld) continue;
          const dist = Math.max(1, Math.round(Math.hypot(endWorld.x - startWorld.x, endWorld.y - startWorld.y)));
          const flat = [round1(startWorld.x), round1(startWorld.y), round1(endWorld.x), round1(endWorld.y)];
          const curveIdx = compiledPrefabCurves.length;
          compiledPrefabCurves.push([flat, 2, 1]);
          list.push({ targetNodeUid: endUid, dist, curveIdx });
        }
        if (list.length > 0) pfEdgeMap.set(startUid, list);
      }
    }
    prefabGraphEdges.set(pf.uid, pfEdgeMap);

    // Facility POIs from spawnPoints & triggerPoints
    const closestPfNodeIdx = () => {
      for (const uid of pf.nodeUids) {
        const idx = nodeUidToIdx.get(uid);
        if (idx !== undefined && idx >= 0) return idx;
      }
      return -1;
    };
    const seenTypes = new Set();
    for (const sp of ppd.spawnPoints) {
      let poiType = null, poiName = "";
      if (sp.type === 3) { poiType = "fuel"; poiName = "Posto de Combustível"; }
      else if (sp.type === 4) { poiType = "service"; poiName = "Oficina Mecânica"; }
      else if (sp.type === 6 || sp.type === 22) { poiType = "weigh"; poiName = "Balança de Pesagem"; }
      else if (sp.type === 7) { poiType = "dealer"; poiName = "Concessionária"; }
      else if (sp.type === 14 || sp.type === 15) { poiType = "garage"; poiName = "Garagem"; }
      else if (sp.type === 16) { poiType = "recruitment"; poiName = "Agência de Motoristas"; }
      if (poiType && !seenTypes.has(poiType)) {
        seenTypes.add(poiType);
        const [wx, wy] = tx(sp.x, sp.y);
        pois.push({ type: poiType, name: poiName, x: round1(wx), y: round1(wy), nodeIdx: closestPfNodeIdx() });
      }
    }
    for (const tp of ppd.triggerPoints) {
      if (tp.action === "hud_parking" && !seenTypes.has("rest")) {
        seenTypes.add("rest");
        const [wx, wy] = tx(tp.x, tp.y);
        pois.push({ type: "rest", name: "Parada de Descanso", x: round1(wx), y: round1(wy), nodeIdx: closestPfNodeIdx() });
      }
    }
  }

  // MapArea Polygons
  for (const ma of allMapAreas) {
    const flat = [];
    for (const uid of ma.nodeUids) {
      const n = allNodes.get(uid);
      if (n) flat.push(round1(n.x), round1(n.y));
    }
    if (flat.length >= 6) {
      compiledPolygons.push([flat, Math.min(3, ma.colorIndex)]);
    }
  }

  // 8. Build Directed Routing Graph (matching truckermudgeon/maps exact node direction semantics)
  const companiesByPrefabUid = new Map();
  const companiesByUid = new Map();
  for (const co of allCompanies) {
    companiesByPrefabUid.set(co.prefabUid, co);
    companiesByUid.set(co.uid, co);
  }

  const speedMps = (speedVal) => config.speedUnit === "mph" ? speedVal * 0.44704 : speedVal / 3.6;

  for (let nodeIdx = 0; nodeIdx < numNodes; nodeIdx++) {
    const uid = BigInt("0x" + nodeUidList[nodeIdx]);
    const node = allNodes.get(uid);
    if (!node) continue;

    for (let dirIdx = 0; dirIdx < 2; dirIdx++) {
      // dirIdx: 0 = 'forward', 1 = 'backward'
      const itemUid = dirIdx === 0 ? node.forwardItemUid : node.backwardItemUid;
      if (itemUid === 0n) continue;

      // Case A: Road
      const roadInfo = roadByUid.get(itemUid);
      if (roadInfo) {
        const { roadIdx, r, lanesL, lanesR, speedLimit } = roadInfo;
        const lanesInDir = dirIdx === 0 ? lanesR : lanesL;
        if (lanesInDir > 0) {
          const destUid = dirIdx === 0 ? r.endNodeUid : r.startNodeUid;
          const destIdx = nodeUidToIdx.get(destUid);
          if (destIdx !== undefined && destIdx >= 0) {
            const dist = Math.max(1, Math.round(r.length));
            const dur = Math.round((dist / speedMps(speedLimit)) * 10) / 10;
            // geomType: 0 = roadFwd (start->end), 1 = roadBwd (end->start)
            const geomType = dirIdx === 0 ? 0 : 1;
            adj[nodeIdx][dirIdx].push([destIdx, dirIdx, dist, dur, geomType, roadIdx]);
          }
        }
        continue;
      }

      // Case B: Prefab
      const pf = allPrefabs.get(itemUid);
      if (pf) {
        const comp = companiesByPrefabUid.get(pf.uid);
        if (comp) {
          const compNodeIdx = nodeUidToIdx.get(comp.nodeUid);
          const otherItemUid = dirIdx === 0 ? node.backwardItemUid : node.forwardItemUid;
          if (compNodeIdx !== undefined && compNodeIdx >= 0 && otherItemUid !== 0n) {
            const compNode = allNodes.get(comp.nodeUid);
            const dist = compNode ? Math.max(1, Math.round(Math.hypot(compNode.x - node.x, compNode.y - node.y))) : 15;
            adj[nodeIdx][dirIdx].push([compNodeIdx, dirIdx, dist, Math.round(dist / 8), 3, -1]);
          }
          continue;
        }

        const pfEdges = prefabGraphEdges.get(pf.uid);
        const conns = pfEdges ? pfEdges.get(uid) : null;
        if (conns) {
          for (const { targetNodeUid, dist, curveIdx } of conns) {
            const targetNode = allNodes.get(targetNodeUid);
            const targetIdx = nodeUidToIdx.get(targetNodeUid);
            if (!targetNode || targetIdx === undefined || targetIdx < 0) continue;
            const targetNeighborItem = dirIdx === 0 ? targetNode.forwardItemUid : targetNode.backwardItemUid;
            const nextDir = itemUid === targetNeighborItem ? (dirIdx === 0 ? 1 : 0) : dirIdx;
            const dur = Math.round((dist / speedMps(55)) * 10) / 10;
            adj[nodeIdx][dirIdx].push([targetIdx, nextDir, dist, dur, 2, curveIdx]);
          }
        }
        continue;
      }

      // Case C: Company (direction === 'forward' / dirIdx === 0)
      const compItem = companiesByUid.get(itemUid);
      if (compItem && dirIdx === 0) {
        const compPf = allPrefabs.get(compItem.prefabUid);
        if (compPf) {
          for (const pfNodeUid of compPf.nodeUids) {
            const pfNode = allNodes.get(pfNodeUid);
            const pfNodeIdx = nodeUidToIdx.get(pfNodeUid);
            if (!pfNode || pfNodeIdx === undefined || pfNodeIdx < 0) continue;
            if (pfNode.forwardItemUid === compPf.uid && pfNode.backwardItemUid === 0n) continue;
            const dist = Math.max(1, Math.round(Math.hypot(pfNode.x - node.x, pfNode.y - node.y)));
            const dur = Math.round(dist / 8);
            adj[nodeIdx][0].push([pfNodeIdx, 0, dist, dur, 3, -1]);
            adj[nodeIdx][0].push([pfNodeIdx, 1, dist, dur, 3, -1]);
          }
        }
      }
    }
  }

  // Dead-end intersection bidirectional fix (same as graph.ts)
  for (let i = 0; i < numNodes; i++) {
    const uid = BigInt("0x" + nodeUidList[i]);
    const node = allNodes.get(uid);
    if (!node) continue;
    const hasFwdItem = roadByUid.has(node.forwardItemUid) || allPrefabs.has(node.forwardItemUid);
    const hasBwdItem = roadByUid.has(node.backwardItemUid) || allPrefabs.has(node.backwardItemUid);
    if (!hasFwdItem && adj[i][0].length === 0 && adj[i][1].length > 0) {
      for (const e of adj[i][1]) adj[i][0].push([...e]);
    } else if (!hasBwdItem && adj[i][1].length === 0 && adj[i][0].length > 0) {
      for (const e of adj[i][0]) adj[i][1].push([...e]);
    }
  }

  // Build spatial grid of active graph nodes (nodes that have at least 1 edge)
  const activeGrid = new Map();
  const gridKey = (x, y) => `${Math.floor(x / 2000)},${Math.floor(y / 2000)}`;
  for (let i = 0; i < numNodes; i++) {
    if (adj[i][0].length > 0 || adj[i][1].length > 0) {
      const x = nodesFlat[i * 3], y = nodesFlat[i * 3 + 1];
      const k = gridKey(x, y);
      let bucket = activeGrid.get(k);
      if (!bucket) { bucket = []; activeGrid.set(k, bucket); }
      bucket.push(i);
    }
  }

  function findClosestActiveNode(x, y, excludeIdx = -1) {
    const gx = Math.floor(x / 2000), gy = Math.floor(y / 2000);
    let bestIdx = -1, bestDist = Infinity;
    for (let r = 1; r <= 5; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const bucket = activeGrid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const idx of bucket) {
            if (idx === excludeIdx) continue;
            const d = Math.hypot(nodesFlat[idx * 3] - x, nodesFlat[idx * 3 + 1] - y);
            if (d < bestDist) { bestDist = d; bestIdx = idx; }
          }
        }
      }
      if (bestIdx !== -1 && bestDist < 1500) break;
    }
    return { bestIdx, bestDist };
  }

  // Connect Ferries first so ferry-linked islands join the main component
  const ferryItemByToken = new Map();
  for (const fe of allFerries) {
    ferryItemByToken.set(fe.ferryPort, fe);
    const feIdx = nodeUidToIdx.get(fe.nodeUid);
    if (feIdx !== undefined && feIdx >= 0) {
      const fx = nodesFlat[feIdx * 3], fy = nodesFlat[feIdx * 3 + 1];
      const { bestIdx, bestDist } = findClosestActiveNode(fx, fy, feIdx);
      if (bestIdx !== -1) {
        const dist = Math.max(1, Math.round(bestDist));
        const dur = Math.round(dist / 10);
        adj[feIdx][0].push([bestIdx, 0, dist, dur, 3, -1], [bestIdx, 1, dist, dur, 3, -1]);
        adj[feIdx][1].push([bestIdx, 0, dist, dur, 3, -1], [bestIdx, 1, dist, dur, 3, -1]);
        adj[bestIdx][0].push([feIdx, 0, dist, dur, 3, -1], [feIdx, 1, dist, dur, 3, -1]);
        adj[bestIdx][1].push([feIdx, 0, dist, dur, 3, -1], [feIdx, 1, dist, dur, 3, -1]);
      }
      const fdef = ferryDefs.get(fe.ferryPort);
      const fname = fdef ? resolveLoc(fdef.nameLoc, fdef.name) : fe.ferryPort;
      pois.push({
        type: fe.train ? "train" : "ferry",
        name: fname,
        x: round1(fe.x),
        y: round1(fe.y),
        nodeIdx: feIdx
      });
    }
  }
  for (const [fromTok, fdef] of ferryDefs) {
    const fromItem = ferryItemByToken.get(fromTok);
    if (!fromItem) continue;
    const fromIdx = nodeUidToIdx.get(fromItem.nodeUid);
    if (fromIdx === undefined || fromIdx < 0) continue;
    for (const conn of fdef.connections) {
      const toItem = ferryItemByToken.get(conn.toTok);
      if (!toItem) continue;
      const toIdx = nodeUidToIdx.get(toItem.nodeUid);
      if (toIdx === undefined || toIdx < 0) continue;
      const dist = Math.round(conn.distance);
      const dur = Math.round(conn.duration);
      adj[fromIdx][0].push([toIdx, 0, dist, dur, 3, -1], [toIdx, 1, dist, dur, 3, -1]);
      adj[fromIdx][1].push([toIdx, 0, dist, dur, 3, -1], [toIdx, 1, dist, dur, 3, -1]);
      adj[toIdx][0].push([fromIdx, 0, dist, dur, 3, -1], [fromIdx, 1, dist, dur, 3, -1]);
      adj[toIdx][1].push([fromIdx, 0, dist, dur, 3, -1], [fromIdx, 1, dist, dur, 3, -1]);
    }
  }

  // Compute Strongly Connected Component (SCC) of the directed state graph (nodeIdx * 2 + dir)
  // so that every node in activeGrid can both REACH and BE REACHED FROM the entire main road network!
  const numStates = numNodes * 2;
  const revAdj = Array.from({ length: numStates }, () => []);
  for (let u = 0; u < numNodes; u++) {
    for (let d = 0; d < 2; d++) {
      const fromState = u * 2 + d;
      for (const [v, nd] of adj[u][d]) {
        revAdj[v * 2 + nd].push(fromState);
      }
    }
  }

  function bfsDirected(startStates, getNextStates) {
    const vis = new Uint8Array(numStates);
    const q = [];
    for (const s of startStates) {
      if (!vis[s]) { vis[s] = 1; q.push(s); }
    }
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      for (const nxt of getNextStates(cur)) {
        if (!vis[nxt]) { vis[nxt] = 1; q.push(nxt); }
      }
    }
    return { vis, count: q.length };
  }

  const getFwd = (s) => {
    const u = s >> 1, d = s & 1;
    return adj[u][d].map(e => e[0] * 2 + e[1]);
  };
  const getBwd = (s) => revAdj[s];

  // Sample candidate seed nodes to find the giant strongly connected component
  let mainSccSet = new Set();
  const triedSeeds = new Uint8Array(numNodes);
  const step = Math.max(1, Math.floor(numNodes / 40));
  for (let i = 0; i < numNodes; i += step) {
    if (triedSeeds[i] || (adj[i][0].length === 0 && adj[i][1].length === 0)) continue;
    const fwd = bfsDirected([i * 2, i * 2 + 1], getFwd);
    if (fwd.count < numNodes * 0.1) continue;
    const bwd = bfsDirected([i * 2, i * 2 + 1], getBwd);
    const sccNodes = new Set();
    for (let u = 0; u < numNodes; u++) {
      triedSeeds[u] = triedSeeds[u] || fwd.vis[u * 2] || fwd.vis[u * 2 + 1];
      if ((fwd.vis[u * 2] || fwd.vis[u * 2 + 1]) && (bwd.vis[u * 2] || bwd.vis[u * 2 + 1])) {
        sccNodes.add(u);
      }
    }
    if (sccNodes.size > mainSccSet.size) {
      mainSccSet = sccNodes;
    }
    if (mainSccSet.size > numNodes * 0.45) break;
  }

  const mainCompSet = mainSccSet;

  // Rebuild activeGrid with only nodes in mainCompSet
  activeGrid.clear();
  for (const i of mainCompSet) {
    const x = nodesFlat[i * 3], y = nodesFlat[i * 3 + 1];
    const k = gridKey(x, y);
    let bucket = activeGrid.get(k);
    if (!bucket) { bucket = []; activeGrid.set(k, bucket); }
    bucket.push(i);
  }

  // Connect all companies bidirectionally to the closest main-SCC road node
  let linkedIslandCompanies = 0;
  for (const co of allCompanies) {
    const coIdx = nodeUidToIdx.get(co.nodeUid);
    if (coIdx === undefined || coIdx < 0) continue;
    if (!mainCompSet.has(coIdx)) {
      const cx = nodesFlat[coIdx * 3], cy = nodesFlat[coIdx * 3 + 1];
      const { bestIdx, bestDist } = findClosestActiveNode(cx, cy, coIdx);
      if (bestIdx !== -1 && bestDist < 3500) {
        const dist = Math.max(1, Math.round(bestDist));
        const dur = Math.round(dist / 8);
        adj[coIdx][0].push([bestIdx, 0, dist, dur, 3, -1], [bestIdx, 1, dist, dur, 3, -1]);
        adj[coIdx][1].push([bestIdx, 0, dist, dur, 3, -1], [bestIdx, 1, dist, dur, 3, -1]);
        adj[bestIdx][0].push([coIdx, 0, dist, dur, 3, -1], [coIdx, 1, dist, dur, 3, -1]);
        adj[bestIdx][1].push([coIdx, 0, dist, dur, 3, -1], [coIdx, 1, dist, dur, 3, -1]);
        mainCompSet.add(coIdx);
        linkedIslandCompanies++;
      }
    } else if (adj[coIdx][1].length === 0 && adj[coIdx][0].length > 0) {
      for (const e of adj[coIdx][0]) adj[coIdx][1].push([...e]);
    }
  }

  // 9. Compile Cities, Companies & Sector POIs
  const cityByToken = new Map();
  for (const c of allCities) {
    if (c.hidden && cityByToken.has(c.token)) continue;
    const cdef = cityDefs.get(c.token);
    if (!cdef && config.sectorSource === "hash") continue; // skip unowned DLC stub cities
    const name = (cdef ? resolveLoc(cdef.nameLoc, cdef.name) : c.token).trim();
    if (!name) continue;
    const country = cdef?.country || "";
    const population = cdef?.population || 0;
    const cx = round1(c.x + c.width / 2);
    const cy = round1(c.y + c.height / 2);
    const { bestIdx, bestDist } = findClosestActiveNode(cx, cy);
    if (bestIdx === -1 || bestDist > 5000) continue;
    cityByToken.set(c.token, {
      token: c.token,
      name,
      country,
      population,
      x: cx,
      y: cy,
      nodeIdx: bestIdx
    });
  }
  const compiledCities = [...cityByToken.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const compiledCompanies = [];
  for (const co of allCompanies) {
    if (config.sectorSource === "hash" && !cityByToken.has(co.cityName)) continue;
    const cdef = companyDefs.get(co.overlayName);
    const name = cdef ? cdef.name : co.overlayName;
    const cityObj = cityByToken.get(co.cityName);
    const cityName = cityObj ? cityObj.name : (cityDefs.get(co.cityName)?.name || co.cityName);
    const nodeIdx = nodeUidToIdx.get(co.nodeUid) ?? -1;
    if (nodeIdx < 0 || !mainCompSet.has(nodeIdx)) continue;
    compiledCompanies.push({
      uid: co.uid.toString(16),
      token: co.overlayName,
      name,
      cityToken: co.cityName,
      cityName,
      x: round1(co.x),
      y: round1(co.y),
      nodeIdx
    });
  }

  // Add sector services & overlays to POIs
  for (const s of allServices) {
    const isNearExisting = pois.some(p => p.type === s.type && Math.hypot(p.x - s.x, p.y - s.y) < 120);
    if (isNearExisting) continue;
    const { bestIdx } = findClosestActiveNode(s.x, s.y);
    const labelMap = {
      fuel: "Posto de Combustível",
      service: "Oficina Mecânica",
      garage: "Garagem",
      rest: "Parada de Descanso"
    };
    pois.push({
      type: s.type,
      name: labelMap[s.type] || s.type,
      x: round1(s.x),
      y: round1(s.y),
      nodeIdx: bestIdx
    });
  }

  for (const ov of allOverlays) {
    if (ov.overlayType === 1) {
      // Parking overlay
      const isNearExisting = pois.some(p => p.type === "rest" && Math.hypot(p.x - ov.x, p.y - ov.y) < 120);
      if (!isNearExisting) {
        const { bestIdx } = findClosestActiveNode(ov.x, ov.y);
        pois.push({ type: "rest", name: "Parada de Descanso", x: round1(ov.x), y: round1(ov.y), nodeIdx: bestIdx });
      }
    } else if (ov.overlayType === 0 && ov.name) {
      // Road shield / number overlay
      pois.push({ type: "road", name: ov.name.toUpperCase(), x: round1(ov.x), y: round1(ov.y), nodeIdx: -1 });
    }
  }

  for (const { ar } of hashArchives) ar.close();
  for (const { ar } of zipArchives) ar.close();

  let totalEdges = 0;
  for (let i = 0; i < numNodes; i++) totalEdges += adj[i][0].length + adj[i][1].length;

  const dataset = {
    meta: {
      id: config.id,
      name: config.name,
      game: config.game,
      speedUnit: config.speedUnit,
      bounds: [minX, minY, maxX, maxY],
      counts: {
        nodes: numNodes,
        edges: totalEdges,
        roads: compiledRoads.length,
        prefabCurves: compiledPrefabCurves.length,
        polygons: compiledPolygons.length,
        cities: compiledCities.length,
        companies: compiledCompanies.length,
        pois: pois.length,
        linkedIslandCompanies
      }
    },
    nodesFlat,
    nodeUids: nodeUidList,
    roads: compiledRoads,
    prefabCurves: compiledPrefabCurves,
    polygons: compiledPolygons,
    adj,
    cities: compiledCities,
    companies: compiledCompanies,
    pois
  };

  console.log(`Concluído em ${((Date.now() - t0) / 1000).toFixed(2)}s:`, dataset.meta.counts);
  return dataset;
}

// ============================================================================
// 7. CLI Entrypoint — Extracts ATS, ETS2 Mapa RBR, and ETS2 Europe
// ============================================================================
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, "data");
  fs.mkdirSync(outDir, { recursive: true });

  let userCfg = {};
  const cfgPath = path.join(__dirname, "config.json");
  if (fs.existsSync(cfgPath)) {
    try { userCfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { /* ignore */ }
  }

  const atsDir = userCfg.atsPath || "T:\\SteamLibrary\\steamapps\\common\\American Truck Simulator";
  const ets2Dir = userCfg.ets2Path || "E:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2";
  const modDir = userCfg.ets2ModPath || path.join(process.env.USERPROFILE || "", "Documents", "Euro Truck Simulator 2", "mod");

  const getScsFiles = (dir) => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith(".scs")).map(f => path.join(dir, f))
    : [];

  const rbrZipFiles = [
    "MAPA_RBR_COMPLEMENTO_DLC.scs",
    "MAPA_RBR_PARTE_1.scs",
    "MAPA_RBR_PARTE_2.scs",
    "MAPA_RBR_PARTE_3.scs",
    "MAPA_RBR_PARTE_4.scs",
    "MAPA_RBR_PARTE_5.scs",
    "MAPA_RBR_PARTE_6.scs",
    "MAPA_RBR_PARTE_7.scs",
    "company_RBR.zip"
  ].map(f => path.join(modDir, f)).filter(f => fs.existsSync(f));

  const configs = [];
  if (fs.existsSync(ets2Dir) && rbrZipFiles.length > 0) {
    configs.push({
      id: "ets2_rbr",
      name: "ETS2 — Mapa RBR (Brasil)",
      game: "ets2",
      speedUnit: "kmh",
      mapFolder: "europe",
      sectorSource: "zip",
      hashPaths: getScsFiles(ets2Dir),
      zipPaths: rbrZipFiles
    });
  }
  if (fs.existsSync(atsDir)) {
    configs.push({
      id: "ats",
      name: "American Truck Simulator (EUA)",
      game: "ats",
      speedUnit: "kmh",
      mapFolder: "usa",
      sectorSource: "hash",
      hashPaths: getScsFiles(atsDir),
      zipPaths: []
    });
  }
  if (fs.existsSync(ets2Dir)) {
    configs.push({
      id: "ets2_europe",
      name: "Euro Truck Simulator 2 (Europa)",
      game: "ets2",
      speedUnit: "kmh",
      mapFolder: "europe",
      sectorSource: "hash",
      hashPaths: getScsFiles(ets2Dir),
      zipPaths: []
    });
  }

  for (const cfg of configs) {
    const data = buildMapDataset(cfg);
    const outPath = path.join(outDir, `${cfg.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data));
    const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
    console.log(`Salvo em ${outPath} (${sizeMb} MB)`);
  }
}
