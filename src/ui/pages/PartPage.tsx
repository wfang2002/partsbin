import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { fetchPartImage, partFieldsFromInfo } from '../../app/services'
import { deletePart, updatePart } from '../../domain/actions'
import { formatQty, partTitle, pathLabel, totalQty } from '../../domain/inventory'
import type { Part, Stock } from '../../domain/types'
import type { PartInfo } from '../../enrich/lookup'
import { openExternal } from '../../platform/open'
import { LookupControl } from '../LookupControl'
import {
  PartForm,
  draftFromPart,
  draftToFields,
  mergeIntoDraft,
  type PartDraft,
} from '../PartForm'
import { Photo } from '../Photo'
import { StockEditor } from '../StockEditor'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  PageHeader,
  SectionTitle,
  Sheet,
  errorText,
  useToast,
} from '../kit'

export function PartPage() {
  const { partId } = useParams()
  const { inv, store } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const part = partId ? inv.partById.get(partId) : undefined
  const [editing, setEditing] = useState(false)
  const [editingStock, setEditingStock] = useState<Stock>()
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!part) {
    return (
      <>
        <PageHeader title="Part" onBack={() => navigate(-1)} />
        <EmptyState title="This part no longer exists">
          It may have been deleted on another device.
        </EmptyState>
      </>
    )
  }

  const stock = inv.stockByPart.get(part.id) ?? []
  const { counted, uncounted } = totalQty(inv, part.id)
  const total =
    stock.length === 0
      ? 'No stock recorded'
      : [
          counted > 0 || uncounted === 0 ? `${counted} counted` : '',
          uncounted > 0 ? `${uncounted} uncounted ${uncounted === 1 ? 'bag' : 'bags'}` : '',
        ]
          .filter(Boolean)
          .join(' + ')
  const specs = Object.entries(part.specs)

  const remove = async () => {
    try {
      await deletePart(store, inv, part.id)
      toast('Part deleted')
      navigate(-1)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title={partTitle(part)}
        onBack={() => navigate(-1)}
        actions={
          <Button small icon="edit" onClick={() => setEditing(true)}>
            Edit
          </Button>
        }
      />
      <div className="p-3">
        <Card className="p-4">
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold break-words">{partTitle(part)}</p>
              {part.manufacturer ? <p className="text-muted">{part.manufacturer}</p> : null}
              {part.mpn && part.description ? <p className="mt-2">{part.description}</p> : null}
            </div>
            <Photo
              hash={part.imageBlob}
              alt={`Picture of ${partTitle(part)}`}
              zoomable
              className="size-20 rounded-lg"
            />
          </div>
          {part.category || part.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {part.category ? <Chip tone="accent">{part.category}</Chip> : null}
              {part.tags.map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
          ) : null}
          {part.datasheetUrl ? (
            <Button
              className="mt-3"
              icon="link"
              onClick={() => openExternal(part.datasheetUrl!).catch((e) => toast(errorText(e), 'error'))}
            >
              Open datasheet
            </Button>
          ) : null}
        </Card>

        <SectionTitle>Where it is</SectionTitle>
        <p className="mb-2 text-sm text-muted">{total}</p>
        <ul className="space-y-2">
          {stock.map((s) => {
            const where = pathLabel(inv, s.locationId)
            return (
            <li key={s.id} className="flex items-stretch gap-2">
              {s.labelPhotoBlob ? (
                <Photo
                  hash={s.labelPhotoBlob}
                  alt={`Label of the bag in ${where}`}
                  zoomable
                  className="size-16 shrink-0 rounded-lg"
                />
              ) : null}
              <Link
                to={`/locations/${s.locationId}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
              >
                <Icon name="box" className="text-accent" />
                <span className="min-w-0 flex-1">{where}</span>
                <span className="text-sm text-muted">{formatQty(s) || 'not counted'}</span>
              </Link>
              <Button
                icon="edit"
                aria-label={`Change the bag in ${where}`}
                onClick={() => setEditingStock(s)}
                className="!min-h-0"
              />
            </li>
            )
          })}
        </ul>
        <Button className="mt-3" icon="plus" onClick={() => navigate(`/add?part=${part.id}`)}>
          Add a bag of this part
        </Button>

        {specs.length > 0 ? (
          <>
            <SectionTitle>Specifications</SectionTitle>
            <Card>
              <dl className="divide-y divide-line">
                {specs.map(([name, value]) => (
                  <div key={name} className="flex gap-3 px-4 py-2 text-sm">
                    <dt className="w-2/5 shrink-0 text-muted">{name}</dt>
                    <dd className="min-w-0 flex-1 break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </>
        ) : null}

        {part.ocrText ? (
          <>
            <SectionTitle>Text read from the label</SectionTitle>
            <Card className="p-4">
              <pre className="font-mono text-sm break-words whitespace-pre-wrap">{part.ocrText}</pre>
            </Card>
          </>
        ) : null}

        <div className="mt-8">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                Delete this part and its {stock.length} {stock.length === 1 ? 'bag' : 'bags'}?
              </span>
              <Button variant="danger" icon="trash" onClick={remove}>
                Delete
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Delete part
            </Button>
          )}
        </div>
      </div>

      {editing ? <EditPartSheet part={part} onClose={() => setEditing(false)} /> : null}
      {editingStock ? (
        <StockEditor stock={editingStock} onClose={() => setEditingStock(undefined)} />
      ) : null}
    </>
  )
}

function EditPartSheet({ part, onClose }: { part: Part; onClose: () => void }) {
  const { store } = useApp()
  const toast = useToast()
  const [draft, setDraft] = useState<PartDraft>(() => draftFromPart(part))
  const [found, setFound] = useState<PartInfo>()
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const fields = draftToFields(draft)
      if (!fields.mpn && !fields.description) {
        toast('Enter a part number or a description.', 'error')
        return
      }
      if (found) {
        fields.source = found.source
        // Keep a picture only if the part has none yet.
        if (!part.imageBlob) fields.imageBlob = await fetchPartImage(store, found.imageUrl)
      }
      await updatePart(store, part.id, fields)
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet title="Edit part" onClose={onClose}>
      <PartForm
        draft={draft}
        onChange={setDraft}
        mpnExtra={
          <LookupControl
            mpn={draft.mpn}
            onApply={(info) => {
              setFound(info)
              // The user asked for the distributor's data, so it replaces
              // what is in the form; nothing is saved until "Save".
              setDraft((current) => mergeIntoDraft(current, partFieldsFromInfo(info), true))
            }}
          />
        }
      />
      <div className="mt-4 flex gap-2">
        <Button variant="primary" busy={saving} onClick={save}>
          Save
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}
