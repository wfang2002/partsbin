import { useMemo } from 'react'
import { useApp } from '../app/context'
import { pathLabel, type Inventory } from '../domain/inventory'
import { scanner } from '../scan'
import { parseLocationQr } from '../scan/labelParsers'
import { Button, Select, errorText, useToast } from './kit'

/** Every location as "Garage > Rack B > Box 12", sorted. */
export function useLocationOptions(exclude?: (id: string) => boolean) {
  const { inv } = useApp()
  return useMemo(
    () =>
      inv.locations
        .filter((l) => !exclude?.(l.id))
        .map((l) => ({ id: l.id, label: pathLabel(inv, l.id) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [inv, exclude],
  )
}

export function LocationSelect({
  value,
  onChange,
  exclude,
  noneLabel = 'Choose a place',
  allowNone,
  scan,
  label = 'Place',
}: {
  value: string | null
  onChange: (id: string | null) => void
  /** Locations that cannot be chosen. */
  exclude?: (id: string) => boolean
  noneLabel?: string
  /** Whether the "none" entry is a valid choice. */
  allowNone?: boolean
  /** Offer scanning a box sticker. */
  scan?: boolean
  label?: string
}) {
  const { inv } = useApp()
  const toast = useToast()
  const options = useLocationOptions(exclude)

  const scanSticker = async () => {
    try {
      const id = await scanLocationSticker(inv)
      if (id) onChange(id)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <div className="flex gap-2">
      <Select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1"
      >
        <option value="" disabled={!allowNone}>
          {noneLabel}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      {scan ? (
        <Button icon="qr" onClick={scanSticker} aria-label="Scan a box sticker">
          Scan
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Scan a PartsBin box sticker. Resolves with the location ID, or null if
 * the user cancelled. Throws if the code is not a known box sticker.
 */
export async function scanLocationSticker(inv: Inventory): Promise<string | null> {
  const barcode = await scanner.scanLive()
  if (!barcode) return null
  const id = parseLocationQr(barcode.text)
  if (!id) throw new Error('That code is not a PartsBin box sticker.')
  if (!inv.locById.has(id)) {
    throw new Error('That sticker belongs to a place that no longer exists here.')
  }
  return id
}
