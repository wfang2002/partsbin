import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { pickFile } from '../platform/files'
import {
  currentCameraRequest,
  subscribeCameraRequest,
  type CameraRequest,
} from '../scan/cameraRequest'
import { decodeBarcodes } from '../scan/webScanner'
import { Banner, Button, Sheet, errorText } from './kit'

/**
 * The desktop camera: a live preview from the webcam for taking a label
 * photo or scanning a barcode, with "choose an image" as the alternative
 * (also by dropping or pasting an image).
 */
export function CameraDialog() {
  const request = useSyncExternalStore(subscribeCameraRequest, currentCameraRequest)
  return request ? <CameraSheet key={request.mode} request={request} /> : null
}

function CameraSheet({ request }: { request: CameraRequest }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia)
  const [problem, setProblem] = useState<string | undefined>(
    hasCamera ? undefined : 'No camera is available here. Choose an image instead.',
  )

  // Start the webcam; stop it when the dialog closes.
  useEffect(() => {
    if (!hasCamera) return
    let stream: MediaStream | undefined
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        const video = videoRef.current
        if (!video) return
        video.srcObject = s
        await video.play()
        setReady(true)
      })
      .catch((e) => {
        if (!cancelled) {
          setProblem(`The camera could not be used (${errorText(e)}). Choose an image instead.`)
        }
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [hasCamera])

  const grabFrame = (): HTMLCanvasElement | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    return canvas
  }

  // Barcode mode: look for a code in the preview a few times a second.
  useEffect(() => {
    if (request.mode !== 'barcode' || !ready) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const canvas = grabFrame()
        const ctx = canvas?.getContext('2d')
        if (canvas && ctx) {
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const [found] = await decodeBarcodes(frame)
          if (found && !stopped) {
            stopped = true
            request.resolve(found)
            return
          }
        }
      } catch (e) {
        setProblem(`Barcode scanning failed: ${errorText(e)}`)
        return
      }
      setTimeout(tick, 250)
    }
    void tick()
    return () => {
      stopped = true
    }
  }, [request, ready])

  const acceptImage = async (image: Blob) => {
    if (request.mode === 'photo') {
      request.resolve(image)
      return
    }
    try {
      const [found] = await decodeBarcodes(image)
      if (found) request.resolve(found)
      else setProblem('No barcode was found in that image.')
    } catch (e) {
      setProblem(`Barcode scanning failed: ${errorText(e)}`)
    }
  }

  const takePhoto = () => {
    grabFrame()?.toBlob((blob) => blob && request.mode === 'photo' && request.resolve(blob), 'image/jpeg', 0.92)
  }

  const chooseImage = async () => {
    const file = await pickFile('image/*')
    if (file) await acceptImage(file)
  }

  // Accept an image pasted from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) void acceptImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const cancel = () => request.resolve(null)

  return (
    <Sheet title={request.mode === 'photo' ? 'Photograph the label' : 'Scan a barcode'} onClose={cancel} wide>
      <div
        className="space-y-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
          if (file) void acceptImage(file)
        }}
      >
        {problem ? <Banner tone="warn">{problem}</Banner> : null}
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} playsInline muted className="mx-auto max-h-[55dvh] w-full object-contain" />
          {!ready && !problem ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white">
              Starting the camera
            </p>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          {request.mode === 'photo'
            ? 'Hold the label flat and fill the frame. You can also drop or paste an image here.'
            : 'Hold the barcode in view. You can also drop or paste an image of it here.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {request.mode === 'photo' ? (
            <Button variant="primary" icon="camera" disabled={!ready} onClick={takePhoto}>
              Take photo
            </Button>
          ) : null}
          <Button icon="upload" onClick={chooseImage}>
            Choose an image
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
