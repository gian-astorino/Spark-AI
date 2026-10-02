// A logo on a transparent background, laid on a solid one before a model sees
// it. OpenAI's models read transparent pixels as black: a black logo on a
// transparent background reached them as a black square — recreated as one,
// judged "the same" by the check, and replaced by an invented logo in the
// brand board. A dark logo goes on white, a light one on near-black.

// Decoding is plain JavaScript (CPU-bound): beyond this size the logo goes as it is.
const MAX_PIXELS = 6_000_000

export const LIGHT_BACKGROUND = '#FFFFFF'
export const DARK_BACKGROUND = '#111111'

export interface Flattened {
  bytes: Uint8Array
  type: string
  /** The background laid under it, when it had transparency. */
  background?: string
}

export async function flattenForModels(bytes: Uint8Array, type: string): Promise<Flattened> {
  if (!isPng(bytes) || !hasTransparency(bytes)) return { bytes, type }
  try {
    const { default: UPNG } = await import('npm:upng-js@^2.1.0')
    const image = UPNG.decode(bytes.slice().buffer)
    if (image.width * image.height > MAX_PIXELS) return { bytes, type }
    const rgba = new Uint8Array(UPNG.toRGBA8(image)[0])

    // How light the visible part of the logo is, weighted by its opacity.
    let light = 0
    let weight = 0
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] / 255
      if (alpha < 0.1) continue
      light += (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) * alpha
      weight += alpha
    }
    const darkLogo = weight === 0 || light / weight < 140
    const background = darkLogo ? LIGHT_BACKGROUND : DARK_BACKGROUND
    const under = darkLogo ? 255 : 17

    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] / 255
      rgba[i] = Math.round(rgba[i] * alpha + under * (1 - alpha))
      rgba[i + 1] = Math.round(rgba[i + 1] * alpha + under * (1 - alpha))
      rgba[i + 2] = Math.round(rgba[i + 2] * alpha + under * (1 - alpha))
      rgba[i + 3] = 255
    }
    const png = new Uint8Array(UPNG.encode([rgba.buffer], image.width, image.height, 0))
    return { bytes: png, type: 'image/png', background }
  } catch (failure) {
    console.error('Could not flatten the logo', failure)
    return { bytes, type }
  }
}

function isPng(bytes: Uint8Array) {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

/** An alpha channel (grey+alpha or RGBA), or a tRNS chunk, without decoding anything. */
function hasTransparency(bytes: Uint8Array) {
  const colorType = bytes[25]
  if (colorType === 4 || colorType === 6) return true
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset)
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (name === 'tRNS') return true
    if (name === 'IDAT' || name === 'IEND') return false
    offset += 12 + length
  }
  return false
}

/** Whether a PNG is one flat colour (give or take compression noise): a blank recreation. */
export async function isFlat(bytes: Uint8Array): Promise<boolean> {
  if (!isPng(bytes)) return false
  try {
    const { default: UPNG } = await import('npm:upng-js@^2.1.0')
    const image = UPNG.decode(bytes.slice().buffer)
    const rgba = new Uint8Array(UPNG.toRGBA8(image)[0])
    let min = 255
    let max = 0
    // Every 7th pixel is enough to tell a logo from an empty square.
    for (let i = 0; i < rgba.length; i += 4 * 7) {
      const light = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
      if (light < min) min = light
      if (light > max) max = light
    }
    return max - min < 24
  } catch {
    return false
  }
}
