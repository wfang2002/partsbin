import { useState } from 'react'
import { TAPES, loadTape, printD11h, saveTape, type TapeId } from '../print/niimbot'
import { renderStickerBitmap, type StickerArt } from '../print/stickerBitmap'
import {
  connectLabelPrinter,
  labelPrinterSupported,
  requestWebLabelPrinter,
  scanLabelPrinters,
  type NiimbotDevice,
} from '../platform/niimbotLink'
import { platformKind } from '../platform/env'
import { Button, Sheet, errorText, useToast } from './kit'

/**
 * Print the selected box stickers on a NIIMBOT D11_H.
 * `art` is called when printing starts, so the QR codes match the checkboxes.
 */
export function LabelPrinterButton({
  count,
  art,
}: {
  count: number
  art: () => StickerArt[]
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [devices, setDevices] = useState<NiimbotDevice[] | null>(null)
  const [tape, setTape] = useState<TapeId>(loadTape)

  if (!labelPrinterSupported()) return null

  const close = () => {
    if (busy) return
    setOpen(false)
  }

  const fail = (e: unknown) => {
    toast(errorText(e), 'error')
    setBusy(false)
    setStatus('')
  }

  const printOn = async (link: Awaited<ReturnType<typeof connectLabelPrinter>>) => {
    try {
      const size = TAPES[tape]
      const pages = art().map((sticker) => renderStickerBitmap(sticker, size))
      await printD11h(link, pages, { tape: size, onProgress: setStatus })
      toast(pages.length === 1 ? 'Printed 1 sticker.' : `Printed ${pages.length} stickers.`)
      setOpen(false)
    } finally {
      await link.close()
      setBusy(false)
      setStatus('')
    }
  }

  const printWeb = () => {
    const pending = requestWebLabelPrinter()
    setOpen(true)
    setBusy(true)
    setDevices(null)
    setStatus('Choose the D11_H in the Bluetooth list.')
    pending.then((link) => printOn(link)).catch(fail)
  }

  const find = async () => {
    setBusy(true)
    setDevices(null)
    setStatus('Looking for a D11_H. Turn the printer on and keep it nearby.')
    try {
      const found = await scanLabelPrinters()
      setDevices(found)
      setStatus(
        found.length === 0
          ? 'No D11_H found. Turn it on, then look again.'
          : 'Choose the printer.',
      )
    } catch (e) {
      fail(e)
      return
    }
    setBusy(false)
  }

  const printNative = (device: NiimbotDevice) => {
    setBusy(true)
    setStatus(`Connecting to ${device.name}…`)
    connectLabelPrinter(device.id)
      .then((link) => printOn(link))
      .catch(fail)
  }

  return (
    <>
      <Button
        variant={platformKind === 'ios' ? 'primary' : 'secondary'}
        icon="print"
        disabled={count === 0}
        onClick={() => {
          setDevices(null)
          setStatus('')
          setOpen(true)
        }}
      >
        Print on NIIMBOT
      </Button>
      {open ? (
        <Sheet title="NIIMBOT D11_H" onClose={close}>
          <p className="text-sm text-muted">
            Prints the selected stickers with the box code above the name.
          </p>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Tape size">
            {(Object.keys(TAPES) as TapeId[]).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={tape === id}
                disabled={busy}
                onClick={() => {
                  setTape(id)
                  saveTape(id)
                }}
                className={
                  tape === id
                    ? 'min-h-11 flex-1 rounded-lg bg-accent px-3 font-medium text-on-accent'
                    : 'min-h-11 flex-1 rounded-lg bg-raised px-3 font-medium'
                }
              >
                {TAPES[id].label}
              </button>
            ))}
          </div>
          {tape === '15x30' ? (
            <p className="mt-2 text-sm text-muted">
              15 mm tape prints across the printer's 12 mm head.
            </p>
          ) : null}
          {status ? <p className="mt-3">{status}</p> : null}
          {!busy ? (
            <Button
              className="mt-3"
              icon="print"
              onClick={() => {
                if (platformKind === 'browser') printWeb()
                else void find()
              }}
            >
              {platformKind === 'browser' ? 'Choose printer' : devices ? 'Look again' : 'Find printer'}
            </Button>
          ) : null}
          {devices && devices.length > 0 ? (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {devices.map((device) => (
                <li key={device.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => printNative(device)}
                    className="flex min-h-11 w-full items-center px-3 text-left hover:text-accent disabled:opacity-50"
                  >
                    {device.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Sheet>
      ) : null}
    </>
  )
}
