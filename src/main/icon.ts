import { deflateSync, crc32 } from 'zlib'
import { nativeImage, type NativeImage } from 'electron'

// Minimal, dependency-free PNG encoder for a single filled circle — used to
// generate the taskbar overlay "dot" per project accent color (§4, §6.2).
// Avoids pulling in a canvas/image library for one small colored circle.

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return [255, 107, 53] // fallback: spec's example accent orange
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

function encodePng(size: number, pixels: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Prepend a filter-type byte (0 = none) to each scanline, as PNG requires.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** A filled circle (with a thin dark ring for contrast) as a NativeImage, for BrowserWindow.setOverlayIcon. */
export function createAccentDotIcon(accentColor: string, size = 16): NativeImage {
  const [r, g, b] = hexToRgb(accentColor)
  const pixels = Buffer.alloc(size * size * 4)
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const radius = size / 2 - 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * size + x) * 4
      if (dist <= radius) {
        pixels[i] = r
        pixels[i + 1] = g
        pixels[i + 2] = b
        pixels[i + 3] = 255
      } else if (dist <= radius + 1) {
        // 1px dark ring so the dot reads against light and dark taskbars alike
        pixels[i] = 20
        pixels[i + 1] = 20
        pixels[i + 2] = 20
        pixels[i + 3] = 255
      } else {
        pixels[i + 3] = 0
      }
    }
  }

  return nativeImage.createFromBuffer(encodePng(size, pixels), { width: size, height: size })
}
