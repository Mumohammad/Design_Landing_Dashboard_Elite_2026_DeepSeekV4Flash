// Dev helper: decode PNG (non-interlaced, 8-bit) and report average color,
// white fraction, and unique-color estimate — to spot blank/broken captures.
import { readFileSync } from "node:fs"
import zlib from "node:zlib"

function analyze(file) {
  const buf = readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG: " + file)

  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0,
    interlace = 0
  const idat = []
  let pos = 8
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString("ascii", pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === "IDAT") {
      idat.push(data)
    } else if (type === "IEND") {
      break
    }
    pos += 12 + len
  }

  if (interlace !== 0) return { file, note: "interlaced — skipped" }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rows = new Array(height)
  let off = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[off++]
    const row = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0
      const b = y > 0 ? rows[y - 1][x] : 0
      const c = x >= channels && y > 0 ? rows[y - 1][x - channels] : 0
      let val = raw[off++]
      switch (filter) {
        case 0:
          break
        case 1:
          val += a
          break
        case 2:
          val += b
          break
        case 3:
          val += (a + b) >> 1
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          val += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
      }
      row[x] = val & 0xff
    }
    rows[y] = row
  }

  // Sample every 7th pixel
  let sum = 0,
    count = 0,
    white = 0,
    nearWhite = 0
  const seen = new Set()
  for (let y = 0; y < height; y += 7) {
    const row = rows[y]
    for (let x = 0; x < width; x += 7) {
      const i = x * channels
      let r = row[i],
        g = row[i + 1],
        b = row[i + 2]
      if (channels === 1) r = g = b = row[i]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      sum += lum
      count++
      if (r > 245 && g > 245 && b > 245) white++
      if (r > 235 && g > 235 && b > 235) nearWhite++
      seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
    }
  }
  return {
    file: file.split("/").pop(),
    size: buf.length,
    dims: `${width}x${height}`,
    avgLum: (sum / count).toFixed(1),
    whitePct: ((white / count) * 100).toFixed(1),
    nearWhitePct: ((nearWhite / count) * 100).toFixed(1),
    colorBuckets: seen.size,
  }
}

for (const f of process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(analyze(f)))
  } catch (e) {
    console.log(f, "ERR", e.message)
  }
}
