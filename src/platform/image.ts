/**
 * Re-encode an image as a JPEG no larger than maxDim on its longest side.
 * Everything in the blob store goes through this, so photos stay small.
 */
export async function toJpeg(
  source: Blob,
  maxDim = 1280,
  quality = 0.8,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process the image.')
    // JPEG has no transparency; put transparent images on white.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob) throw new Error('Could not encode the image.')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
