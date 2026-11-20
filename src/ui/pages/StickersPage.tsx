import qrcode from 'qrcode-generator'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useApp } from '../../app/context'
import { locationPath, withDescendants, type Inventory } from '../../domain/inventory'
import { platformKind } from '../../platform/env'
import { saveFile } from '../../platform/files'
import { locationQrPayload } from '../../scan/labelParsers'
import { LabelPrinterButton } from '../LabelPrinter'
import { Button, EmptyState, PageHeader, errorText, useToast } from '../kit'

interface Sticker {
  id: string
  name: string
  /** Where the place is, e.g. "Garage > Rack B". */
  inside: string
  /** Dark modules of the QR code, row by row. */
  modules: boolean[][]
}

/** Quiet zone around the code, in modules, as the QR standard asks. */
const QUIET = 4
const PER_SHEET = 30

function makeSticker(inv: Inventory, id: string): Sticker {
  const qr = qrcode(0, 'M')
  qr.addData(locationQrPayload(id))
  qr.make()
  const count = qr.getModuleCount()
  const modules = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  )
  const path = locationPath(inv, id)
  return {
    id,
    name: path[path.length - 1]?.name ?? '',
    inside: path
      .slice(0, -1)
      .map((l) => l.name)
      .join(' > '),
    modules,
  }
}

function QrSvg({ modules }: { modules: boolean[][] }) {
  const size = modules.length + QUIET * 2
  let d = ''
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) d += `M${c + QUIET},${r + QUIET}h1v1h-1z`
    }),
  )
  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="size-full" role="img" aria-label="QR code">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

/** Draw one sheet of stickers (3 across) as a PNG, for printing from a phone. */
async function renderSheet(stickers: Sticker[]): Promise<Uint8Array> {
  const columns = 3
  const cellW = 600
  const cellH = 260
  const rows = Math.ceil(stickers.length / columns)
  const canvas = document.createElement('canvas')
  canvas.width = columns * cellW
  canvas.height = rows * cellH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the stickers.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  stickers.forEach((sticker, i) => {
    const x = (i % columns) * cellW
    const y = Math.floor(i / columns) * cellH
    ctx.strokeStyle = '#bbb'
    ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1)
    const size = sticker.modules.length + QUIET * 2
    const scale = Math.floor((cellH - 20) / size)
    const qrX = x + 10
    const qrY = y + Math.floor((cellH - size * scale) / 2)
    ctx.fillStyle = '#000'
    sticker.modules.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) ctx.fillRect(qrX + (c + QUIET) * scale, qrY + (r + QUIET) * scale, scale, scale)
      }),
    )
    const textX = qrX + size * scale + 12
    const textW = x + cellW - 14 - textX
    ctx.textBaseline = 'top'
    ctx.font = 'bold 44px system-ui, sans-serif'
    let lineY = y + 34
    for (const line of wrapText(ctx, sticker.name, textW).slice(0, 2)) {
      ctx.fillText(line, textX, lineY)
      lineY += 52
    }
    ctx.font = '26px system-ui, sans-serif'
    for (const line of wrapText(ctx, sticker.inside, textW).slice(0, 3)) {
      ctx.fillText(line, textX, lineY + 6)
      lineY += 32
    }
  })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not draw the stickers.')
  return new Uint8Array(await blob.arrayBuffer())
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && ctx.measureText(candidate).width > width) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

export function StickersPage() {
  const { inv } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const rootId = params.get('loc')
  const root = rootId ? inv.locById.get(rootId) : undefined

  // The chosen place and everything in it, or every place.
  const candidates = useMemo(() => {
    const ids = root
      ? withDescendants(inv, root.id)
      : (inv.childrenOf.get(null) ?? []).flatMap((l) => withDescendants(inv, l.id))
    return ids.flatMap((id) => {
      const location = inv.locById.get(id)
      return location ? [location] : []
    })
  }, [inv, root])

  // By default: the boxes, or everything when there are no boxes.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const hasBoxes = candidates.some((l) => l.kind === 'box')
  const isSelected = (id: string, kind: string) =>
    overrides[id] ?? (root?.id === id || !hasBoxes || kind === 'box')
  // One string stands for the selection, so the codes are redrawn only when it changes.
  const selectedIds = candidates
    .filter((l) => isSelected(l.id, l.kind))
    .map((l) => l.id)
    .join(',')
  const stickers = useMemo(
    () => (selectedIds ? selectedIds.split(',').map((id) => makeSticker(inv, id)) : []),
    [inv, selectedIds],
  )
  const sheets = Math.ceil(stickers.length / PER_SHEET)

  const saveSheet = async (sheet: number) => {
    try {
      const png = await renderSheet(stickers.slice(sheet * PER_SHEET, (sheet + 1) * PER_SHEET))
      const suffix = sheets > 1 ? `-${sheet + 1}` : ''
      await saveFile(`partsbin-stickers${suffix}.png`, png, 'image/png')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <>
      <PageHeader title="Box stickers" onBack={() => navigate(-1)} />
      <div className="p-3">
        {candidates.length === 0 ? (
          <EmptyState title="No places yet">Add a place first, then print a sticker for it.</EmptyState>
        ) : (
          <>
            <div className="no-print">
              <p className="text-sm text-muted">
                Stick these on your boxes. Scanning one opens the box, or selects it when putting
                parts away.
              </p>
              <ul className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface">
                {candidates.map((location) => (
                  <li key={location.id}>
                    <label className="flex min-h-11 items-center gap-3 px-3">
                      <input
                        type="checkbox"
                        className="size-5 accent-accent"
                        checked={isSelected(location.id, location.kind)}
                        onChange={(e) =>
                          setOverrides({ ...overrides, [location.id]: e.target.checked })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {locationPath(inv, location.id)
                          .map((l) => l.name)
                          .join(' > ')}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {platformKind !== 'ios' ? (
                  <Button
                    variant="primary"
                    icon="print"
                    disabled={stickers.length === 0}
                    onClick={() => window.print()}
                  >
                    Print {stickers.length} {stickers.length === 1 ? 'sticker' : 'stickers'}
                  </Button>
                ) : null}
                <LabelPrinterButton count={stickers.length} art={() => stickers} />
                {Array.from({ length: sheets }, (_, sheet) => (
                  <Button key={sheet} icon="download" onClick={() => saveSheet(sheet)}>
                    {sheets > 1 ? `Save sheet ${sheet + 1} of ${sheets} as image` : 'Save as image'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 print:mt-0 print:grid-cols-3 print:gap-0">
              {stickers.map((sticker) => (
                <div
                  key={sticker.id}
                  className="flex break-inside-avoid items-center gap-2 rounded-lg border border-line bg-white p-2 text-black print:rounded-none print:border-neutral-400"
                >
                  <div className="size-24 shrink-0">
                    <QrSvg modules={sticker.modules} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg leading-tight font-bold break-words">{sticker.name}</p>
                    <p className="text-xs leading-tight break-words">{sticker.inside}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
