// One-off script — generates a placeholder resources/icon.ico (dark square,
// H9000-green terminal-prompt mark) so the NSIS build has something to embed.
// Real branding/theming is explicitly an M7 concern per SHINSHELL_SPEC.md §6.13.
// Run: node scripts/generate-icon.mjs
import { deflateSync, crc32 } from 'zlib'
import { writeFileSync } from 'fs'

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function encodePng(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const bg = [12, 12, 12]
  const accent = [51, 255, 102] // #33FF66, H9000 terminal green
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = a
  }
  const cornerRadius = size * 0.18
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x < cornerRadius ? cornerRadius : x > size - cornerRadius ? size - cornerRadius : x
      const cy = y < cornerRadius ? cornerRadius : y > size - cornerRadius ? size - cornerRadius : y
      const dx = x - cx
      const dy = y - cy
      const inside = dx * dx + dy * dy <= cornerRadius * cornerRadius || (x >= cornerRadius && x <= size - cornerRadius) || (y >= cornerRadius && y <= size - cornerRadius)
      if (inside) set(x, y, bg)
    }
  }
  // ">" chevron — two segments meeting at a vertex on the right, opening left
  const s = size / 256
  const thickness = 16 * s
  const drawThickLine = (x0, y0, x1, y1) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2
    const dx = (y1 - y0) / Math.hypot(x1 - x0, y1 - y0) // perpendicular unit vector
    const dy = -(x1 - x0) / Math.hypot(x1 - x0, y1 - y0)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      for (let w = -thickness / 2; w < thickness / 2; w++) {
        set(Math.round(x + dx * w), Math.round(y + dy * w), accent)
      }
    }
  }
  const xLeft = 76 * s
  const xVertex = 168 * s
  const yTop = 68 * s
  const yMid = 128 * s
  const yBottom = 188 * s
  drawThickLine(xLeft, yTop, xVertex, yMid)
  drawThickLine(xVertex, yMid, xLeft, yBottom)
  // "_" underscore
  for (let x = 128 * s; x < 195 * s; x++) {
    for (let w = 0; w < thickness; w++) {
      set(Math.round(x), Math.round(188 * s + w), accent)
    }
  }
  return px
}

function buildIco(sizes) {
  const images = sizes.map((size) => ({ size, png: encodePng(size, drawIcon(size)) }))
  const headerSize = 6
  const dirEntrySize = 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = headerSize + dirEntrySize * images.length
  const dirEntries = []
  const dataChunks = []
  for (const { size, png } of images) {
    const entry = Buffer.alloc(dirEntrySize)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    dirEntries.push(entry)
    dataChunks.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...dirEntries, ...dataChunks])
}

const ico = buildIco([16, 32, 48, 256])
writeFileSync(new URL('../resources/icon.ico', import.meta.url), ico)
console.log('Wrote resources/icon.ico')
