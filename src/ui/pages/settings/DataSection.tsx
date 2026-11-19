import { useState } from 'react'
import { useApp } from '../../../app/context'
import { recordBag } from '../../../domain/actions'
import { findPartByMpn, mpnKey } from '../../../domain/inventory'
import { parseOrderCsv, type OrderLine } from '../../../import/orders'
import { pickFile, saveFile } from '../../../platform/files'
import { exportZip, importZip } from '../../../sync/zip'
import { LocationSelect } from '../../LocationSelect'
import {
  Banner,
  Button,
  Card,
  Field,
  SectionTitle,
  Sheet,
  errorText,
  useToast,
} from '../../kit'

export function BackupSection() {
  const { store, sync } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState<'export' | 'import'>()
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string }>()

  const exportBackup = async () => {
    setBusy('export')
    setNote(undefined)
    try {
      const { zip, blobs, blobsMissing } = await exportZip(store)
      const date = new Date().toISOString().slice(0, 10)
      const saved = await saveFile(`partsbin-backup-${date}.zip`, zip, 'application/zip')
      if (!saved) return
      setNote(
        blobsMissing > 0
          ? {
              tone: 'warn',
              text: `Backup saved with ${blobs} photos. ${blobsMissing} photos are not on this device yet and are not in the backup; sync first to include them.`,
            }
          : { tone: 'ok', text: `Backup saved, including ${blobs} photos.` },
      )
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(undefined)
    }
  }

  const importBackup = async () => {
    try {
      const file = await pickFile('.zip,application/zip')
      if (!file) return
      setBusy('import')
      setNote(undefined)
      const report = await importZip(store, new Uint8Array(await file.arrayBuffer()))
      setNote({
        tone: 'ok',
        text:
          report.rowsChanged > 0
            ? `Backup merged: ${report.rowsChanged} records added or updated.`
            : 'Everything in that backup is already here.',
      })
      sync.schedule(0)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <>
      <SectionTitle>Backup file</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          A backup is one zip file with every place, part and photo. Restoring merges it with what
          is here; newer edits win and nothing else is removed.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button icon="download" busy={busy === 'export'} onClick={exportBackup}>
            Save a backup
          </Button>
          <Button icon="upload" busy={busy === 'import'} onClick={importBackup}>
            Restore from a backup
          </Button>
        </div>
        {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      </Card>
    </>
  )
}

export function OrderImportSection() {
  const toast = useToast()
  const [lines, setLines] = useState<OrderLine[]>()

  const choose = async () => {
    try {
      const file = await pickFile('.csv,text/csv,text/plain')
      if (!file) return
      const parsed = parseOrderCsv(await file.text())
      if (parsed.length === 0) throw new Error('No order lines were found in that file.')
      setLines(parsed)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <>
      <SectionTitle>Order history</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Import an order history CSV exported from Digi-Key, Mouser or LCSC to record many parts
          at once. They go into one place you choose (an "Unsorted" box works well); move them as
          you sort the bags.
        </p>
        <Button icon="upload" onClick={choose}>
          Import orders from CSV
        </Button>
      </Card>
      {lines ? <OrderImportSheet lines={lines} onClose={() => setLines(undefined)} /> : null}
    </>
  )
}

function OrderImportSheet({ lines, onClose }: { lines: OrderLine[]; onClose: () => void }) {
  const { store, inv } = useApp()
  const toast = useToast()
  const [locationId, setLocationId] = useState<string | null>(null)
  const [skipKnown, setSkipKnown] = useState(true)
  const [busy, setBusy] = useState(false)

  // One entry per part: the same part ordered twice becomes one bag.
  const merged = new Map<string, OrderLine>()
  for (const line of lines) {
    const key = mpnKey(line.mpn) || `d:${(line.description ?? '').trim().toLowerCase()}`
    if (key === 'd:') continue
    const previous = merged.get(key)
    if (!previous) merged.set(key, { ...line })
    else if (line.qty !== undefined) previous.qty = (previous.qty ?? 0) + line.qty
  }
  const entries = [...merged.values()]
  const known = entries.filter((line) => findPartByMpn(inv, line.mpn))
  const toImport = skipKnown ? entries.filter((line) => !known.includes(line)) : entries

  const run = async () => {
    if (!locationId) return
    setBusy(true)
    try {
      for (const line of toImport) {
        await recordBag(store, inv, {
          part: {
            mpn: line.mpn,
            manufacturer: line.manufacturer,
            description: line.description,
            specs: line.package ? { Package: line.package } : {},
            source: 'manual',
          },
          locationId,
          qty: line.qty,
        })
      }
      toast(`Imported ${toImport.length} parts`)
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Import orders" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3">
        <p>
          The file lists {entries.length} different parts
          {known.length > 0 ? `; ${known.length} of them are already in your library` : ''}.
        </p>
        {known.length > 0 ? (
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-accent"
              checked={skipKnown}
              onChange={(e) => setSkipKnown(e.target.checked)}
            />
            <span>Skip parts I already have</span>
          </label>
        ) : null}
        <Field label="Put them in">
          <LocationSelect value={locationId} onChange={setLocationId} />
        </Field>
        {toImport.length === 0 ? <Banner tone="info">There is nothing new to import.</Banner> : null}
        <div className="flex gap-2">
          <Button
            variant="primary"
            busy={busy}
            disabled={!locationId || toImport.length === 0}
            onClick={run}
          >
            Import {toImport.length} parts
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
