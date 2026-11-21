import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useBlobUrl } from '../app/context'
import { cx, Button, Sheet } from './kit'

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
          <ZoomablePhoto
            src={url}
            alt={alt}
            frameClassName="h-[65dvh]"
            hint="Pinch or double-tap to enlarge."
            subject="the photo"
          />
        </Sheet>
      ) : null}
    </>
  )
}

const MIN_SCALE = 1
const MAX_SCALE = 6

/** A photo the user can enlarge and pan, leaving the rest of the page visible. */
export function ZoomablePhoto({
  src,
  alt,
  frameClassName = 'h-64',
  hint = 'Pinch or double-tap to enlarge the label.',
  subject = 'the label',
}: {
  src: string
  alt: string
  frameClassName?: string
  hint?: string
  subject?: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const view = useRef({ scale: 1, x: 0, y: 0 })
  const [shown, setShown] = useState(view.current)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const tap = useRef({ time: 0, x: 0, y: 0, moved: false })
  const lastTap = useRef(0)

  const apply = (scale: number, x: number, y: number) => {
    const el = frame.current
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
    let next = { scale: nextScale, x: 0, y: 0 }
    if (el && nextScale > 1) {
      const maxX = ((nextScale - 1) * el.clientWidth) / 2
      const maxY = ((nextScale - 1) * el.clientHeight) / 2
      next = {
        scale: nextScale,
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      }
    }
    view.current = next
    setShown(next)
  }

  useEffect(() => {
    view.current = { scale: 1, x: 0, y: 0 }
    setShown(view.current)
    pinch.current = null
    pan.current = null
  }, [src])

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2
      apply(view.current.scale * factor, view.current.x, view.current.y)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src])

  const point = (id: number, x: number, y: number) => {
    pointers.current.set(id, { x, y })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    point(event.pointerId, event.clientX, event.clientY)
    tap.current = { time: Date.now(), x: event.clientX, y: event.clientY, moved: false }
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: view.current.scale }
      pan.current = null
    } else if (view.current.scale > 1) {
      pan.current = { x: event.clientX, y: event.clientY, ox: view.current.x, oy: view.current.y }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    const start = pointers.current.get(event.pointerId)!
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) tap.current.moved = true
    point(event.pointerId, event.clientX, event.clientY)
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      apply(pinch.current.scale * (dist / pinch.current.dist), view.current.x, view.current.y)
    } else if (pan.current) {
      apply(
        view.current.scale,
        pan.current.ox + (event.clientX - pan.current.x),
        pan.current.oy + (event.clientY - pan.current.y),
      )
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      pan.current = null
      const elapsed = Date.now() - tap.current.time
      const travel = Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y)
      const now = Date.now()
      if (!tap.current.moved && travel < 12 && elapsed < 280 && now - lastTap.current < 320) {
        if (view.current.scale > 1) apply(1, 0, 0)
        else apply(2.5, 0, 0)
        lastTap.current = 0
      } else if (!tap.current.moved && travel < 12) {
        lastTap.current = now
      }
    } else if (view.current.scale > 1) {
      const [left] = [...pointers.current]
      pan.current = { x: left[1].x, y: left[1].y, ox: view.current.x, oy: view.current.y }
    }
  }

  return (
    <div className="space-y-2">
      <div
        ref={frame}
        className={cx('relative touch-none overflow-hidden rounded-lg bg-raised', frameClassName)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="pointer-events-none h-full w-full object-contain select-none"
          style={{
            transform: `translate(${shown.x}px, ${shown.y}px) scale(${shown.scale})`,
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{hint}</p>
        <div className="flex shrink-0 gap-1">
          <Button
            small
            disabled={shown.scale <= MIN_SCALE}
            aria-label={`Make ${subject} smaller`}
            onClick={() => apply(shown.scale / 1.5, shown.x, shown.y)}
          >
            Smaller
          </Button>
          <Button
            small
            disabled={shown.scale >= MAX_SCALE}
            aria-label={`Enlarge ${subject}`}
            onClick={() => apply(shown.scale * 1.5, shown.x, shown.y)}
          >
            Larger
          </Button>
        </div>
      </div>
    </div>
  )
}
