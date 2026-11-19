import type { Barcode } from './types'

/*
 * On desktop the camera is a dialog rendered by React (CameraDialog). The
 * scanner asks for it through this small bridge and waits for the result.
 */

export type CameraRequest =
  | { mode: 'photo'; resolve: (photo: Blob | null) => void }
  | { mode: 'barcode'; resolve: (barcode: Barcode | null) => void }

type Listener = (request: CameraRequest | null) => void

let current: CameraRequest | null = null
const listeners = new Set<Listener>()

function set(request: CameraRequest | null) {
  current = request
  for (const listener of listeners) listener(request)
}

export function subscribeCameraRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const currentCameraRequest = () => current

export function requestPhoto(): Promise<Blob | null> {
  return new Promise((resolve) => {
    current?.resolve(null)
    set({
      mode: 'photo',
      resolve: (photo) => {
        set(null)
        resolve(photo)
      },
    })
  })
}

export function requestBarcode(): Promise<Barcode | null> {
  return new Promise((resolve) => {
    current?.resolve(null)
    set({
      mode: 'barcode',
      resolve: (barcode) => {
        set(null)
        resolve(barcode)
      },
    })
  })
}
