import sharp from 'sharp'

/**
 * Perceptual hash (dHash) for near-duplicate detection.
 * Resizes to 9x8 greyscale and encodes row-wise adjacent-pixel comparisons
 * into a 64-bit hash (16 hex chars). Robust to minor visual changes.
 */
export async function computeDHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  let bits = ''
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 9 + col
      bits += data[i] > data[i + 1] ? '1' : '0'
    }
  }
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

/** Hamming distance between two equal-length hex hashes (0..64). */
export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/** 0..1 similarity (1 = identical). */
export function similarity(a: string, b: string): number {
  return 1 - hammingHex(a, b) / 64
}
