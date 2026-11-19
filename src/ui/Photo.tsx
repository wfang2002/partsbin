import { useState } from 'react'
import { useBlobUrl } from '../app/context'
import { cx, Sheet } from './kit'

/** A stored photo. Shows a neutral placeholder until it is available. */
export function Photo({
  hash,
  alt,
  className,
  zoomable,
}: {
  hash: string | undefined
  alt: string
  className?: string
  /** Open the photo full size when tapped. */
  zoomable?: boolean
}) {
  const url = useBlobUrl(hash)
  const [zoomed, setZoomed] = useState(false)
  if (!hash) return null
  if (!url) {
    return (
      <div
        role="img"
        aria-label={`${alt} (not downloaded yet)`}
        className={cx('bg-raised', className)}
      />
    )
  }
  const image = <img src={url} alt={alt} className={cx('object-cover', className)} />
  if (!zoomable) return image
  return (
    <>
      <button type="button" onClick={() => setZoomed(true)} aria-label={`Enlarge ${alt}`}>
        {image}
      </button>
      {zoomed ? (
        <Sheet title={alt} onClose={() => setZoomed(false)} wide>
          <img src={url} alt={alt} className="mx-auto max-h-[75dvh] rounded-lg" />
        </Sheet>
      ) : null}
    </>
  )
}
