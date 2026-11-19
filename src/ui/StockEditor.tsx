import { useState } from 'react'
import { useApp } from '../app/context'
import { deleteStock, updateStock } from '../domain/actions'
import { partTitle } from '../domain/inventory'
import type { QtyApprox, Stock } from '../domain/types'
import { LocationSelect } from './LocationSelect'
import { Photo } from './Photo'
import { Button, Chip, Field, Input, Sheet, errorText, useToast } from './kit'

export interface Quantity {
  qty?: number
  qtyApprox?: QtyApprox
}

const APPROX: { value: QtyApprox; label: string }[] = [
  { value: 'few', label: 'A few' },
  { value: 'some', label: 'Some' },
  { value: 'many', label: 'Many' },
]

/** An exact count, or a rough amount for bags not worth counting. */
export function QuantityInput({
  value,
  onChange,
}: {
  value: Quantity
  onChange: (value: Quantity) => void
}) {
  return (
    <Field label="Quantity" hint="Leave empty if you do not want to count.">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          aria-label="Exact quantity"
          value={value.qty ?? ''}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)))
            onChange(n === undefined || Number.isNaN(n) ? {} : { qty: n })
          }}
          className="w-28"
        />
        <span className="text-sm text-muted">or</span>
        {APPROX.map((option) => (
          <Chip
            key={option.value}
            tone={value.qtyApprox === option.value ? 'accent' : 'plain'}
            onClick={() =>
              onChange(value.qtyApprox === option.value ? {} : { qtyApprox: option.value })
            }
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </Field>
  )
}

/** Change the amount in a bag, move it, or remove it. */
export function StockEditor({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const { store, inv } = useApp()
  const toast = useToast()
  const part = inv.partById.get(stock.partId)
  const [quantity, setQuantity] = useState<Quantity>({
    qty: stock.qty,
    qtyApprox: typeof stock.qty === 'number' ? undefined : stock.qtyApprox,
  })
  const [locationId, setLocationId] = useState<string | null>(stock.locationId)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    if (!locationId) return
    try {
      await updateStock(store, stock.id, {
        qty: quantity.qty,
        qtyApprox: quantity.qtyApprox,
        locationId,
      })
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const remove = async () => {
    try {
      await deleteStock(store, stock.id)
      toast('Bag removed')
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Sheet title={part ? partTitle(part) : 'Bag'} onClose={onClose}>
      <div className="space-y-4">
        <QuantityInput value={quantity} onChange={setQuantity} />
        <Field label="Place">
          <LocationSelect value={locationId} onChange={setLocationId} scan />
        </Field>
        {stock.labelPhotoBlob ? (
          <Photo
            hash={stock.labelPhotoBlob}
            alt="Label photo"
            zoomable
            className="h-32 w-full rounded-lg"
          />
        ) : null}
        <p className="text-sm text-muted">
          Last checked {new Date(stock.lastSeenAt).toLocaleDateString()}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={!locationId}>
            Save
          </Button>
          {confirmDelete ? (
            <Button variant="danger" icon="trash" onClick={remove}>
              Yes, remove this bag
            </Button>
          ) : (
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Remove bag
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
