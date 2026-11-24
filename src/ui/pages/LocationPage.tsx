import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useApp, useSetting } from '../../app/context'
import {
  createLocation,
  deleteLocation,
  isInside,
  locationContents,
  moveLocation,
  updateLocation,
} from '../../domain/actions'
import {
  formatQty,
  locationPath,
  partPhotoHash,
  partSubtitle,
  partTitle,
  withDescendants,
  type Inventory,
} from '../../domain/inventory'
import { compareName, groupByCategory, sortByName, type SortDir } from '../../domain/order'
import { LOCATION_KINDS, type Location, type LocationKind, type Stock } from '../../domain/types'
import { toJpeg } from '../../platform/image'
import { scanner } from '../../scan'
import { LocationSelect, scanLocationSticker } from '../LocationSelect'
import { PartThumb } from '../PartThumb'
import { Photo } from '../Photo'
import { StockEditor } from '../StockEditor'
import {
  Button,
  EmptyState,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  Sheet,
  TextArea,
  errorText,
  useToast,
} from '../kit'

const KIND_LABEL: Record<LocationKind, string> = {
  room: 'Room',
  rack: 'Rack',
  shelf: 'Shelf',
  box: 'Box',
  compartment: 'Compartment',
}

/** The kind a new place inside `parent` most likely is. */
function childKind(parent: Location | undefined): LocationKind {
  if (!parent) return 'room'
  const next = LOCATION_KINDS.indexOf(parent.kind) + 1
  return LOCATION_KINDS[Math.min(next, LOCATION_KINDS.length - 1)]
}

function bagCount(inv: Inventory, id: string): number {
  return withDescendants(inv, id).reduce(
    (sum, l) => sum + (inv.stockByLocation.get(l)?.length ?? 0),
    0,
  )
}

export function LocationPage() {
  const { locId } = useParams()
  const { inv, store } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const location = locId ? inv.locById.get(locId) : undefined
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editingStock, setEditingStock] = useState<Stock>()
  const [photoBusy, setPhotoBusy] = useState(false)
  const [storedBoxSort, setBoxSort] = useSetting<SortDir>('ui.boxSort', 'asc')
  const boxSort: SortDir = storedBoxSort === 'desc' ? 'desc' : 'asc'

  if (locId && !location) {
    return (
      <>
        <PageHeader title="Place" onBack={() => navigate('/locations')} />
        <EmptyState title="This place no longer exists">
          It may have been deleted on another device.
        </EmptyState>
      </>
    )
  }

  const children = inv.childrenOf.get(location?.id ?? null) ?? []
  const orderedChildren = sortByName(children, (child) => child.name, boxSort)
  const stock = location ? (inv.stockByLocation.get(location.id) ?? []) : []
  const path = location ? locationPath(inv, location.id) : []
  const newKind = childKind(location)

  const scanSticker = async () => {
    try {
      const id = await scanLocationSticker(inv)
      if (id) navigate(`/locations/${id}`)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const takePhoto = async () => {
    if (!location) return
    try {
      const image = await scanner.capturePhoto()
      if (!image) return
      setPhotoBusy(true)
      const hash = await store.putBlob(await toJpeg(image.blob))
      await updateLocation(store, location.id, { photoBlob: hash })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={location ? location.name : 'Places'}
        onBack={
          location
            ? () => navigate(location.parentId ? `/locations/${location.parentId}` : '/locations')
            : undefined
        }
        actions={
          location ? (
            <Button small icon="edit" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : (
            <Button small icon="qr" onClick={scanSticker}>
              Scan sticker
            </Button>
          )
        }
      />
      <div className="p-3">
        {location ? (
          <>
            <nav aria-label="Path" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted">
              <Link to="/locations" className="hover:text-accent">
                Places
              </Link>
              {path.map((step) => (
                <span key={step.id} className="flex items-center gap-1">
                  <Icon name="chevron" className="size-3" />
                  {step.id === location.id ? (
                    <span className="text-ink">{step.name}</span>
                  ) : (
                    <Link to={`/locations/${step.id}`} className="hover:text-accent">
                      {step.name}
                    </Link>
                  )}
                </span>
              ))}
            </nav>

            {location.photoBlob ? (
              <Photo
                hash={location.photoBlob}
                alt={`Photo of ${location.name}`}
                zoomable
                className="mb-3 h-44 w-full rounded-xl"
              />
            ) : null}
            {location.note ? <p className="mb-3 whitespace-pre-wrap">{location.note}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon="plus"
                onClick={() => navigate(`/add?loc=${location.id}`)}
              >
                Put parts away here
              </Button>
              <Button icon="camera" busy={photoBusy} onClick={takePhoto}>
                {location.photoBlob ? 'Replace photo' : 'Add photo'}
              </Button>
              <Button icon="qr" onClick={() => navigate(`/stickers?loc=${location.id}`)}>
                Sticker
              </Button>
            </div>
          </>
        ) : null}

        {location || children.length > 0 ? (
          <div
            className={
              location
                ? 'mt-6 mb-2 flex flex-wrap items-center justify-between gap-2'
                : 'mb-2 flex flex-wrap items-center justify-end gap-2'
            }
          >
            {location ? (
              <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Inside</h2>
            ) : null}
            {children.length > 0 ? (
              <Segmented
                label="Sort places by name"
                value={boxSort}
                options={[
                  { id: 'asc', label: 'A–Z' },
                  { id: 'desc', label: 'Z–A' },
                ]}
                onChange={setBoxSort}
              />
            ) : null}
          </div>
        ) : null}
        {children.length === 0 && !location ? (
          <EmptyState title="No places yet">
            Add the rooms where you keep parts, then racks, shelves and boxes inside them.
          </EmptyState>
        ) : null}
        <ul className="space-y-2">
          {orderedChildren.map((child) => {
            const inside = inv.childrenOf.get(child.id)?.length ?? 0
            const bags = bagCount(inv, child.id)
            return (
              <li key={child.id}>
                <Link
                  to={`/locations/${child.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
                >
                  <Icon name={child.kind === 'box' || child.kind === 'compartment' ? 'box' : 'folder'} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{child.name}</span>
                    <span className="block text-sm text-muted">
                      {[
                        KIND_LABEL[child.kind],
                        inside > 0 ? `${inside} inside` : '',
                        `${bags} ${bags === 1 ? 'bag' : 'bags'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Icon name="chevron" className="text-muted" />
                </Link>
              </li>
            )
          })}
        </ul>
        <Button className="mt-3" icon="plus" onClick={() => setAdding(true)}>
          Add a {KIND_LABEL[newKind].toLowerCase()}
        </Button>

        {location ? (
          <PartsHere stock={stock} inv={inv} onEdit={setEditingStock} />
        ) : null}
      </div>

      {adding ? (
        <AddLocationSheet
          parent={location}
          defaultKind={newKind}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing && location ? (
        <EditLocationSheet
          location={location}
          onClose={() => setEditing(false)}
          onDeleted={() =>
            navigate(location.parentId ? `/locations/${location.parentId}` : '/locations', {
              replace: true,
            })
          }
        />
      ) : null}
      {editingStock ? (
        <StockEditor stock={editingStock} onClose={() => setEditingStock(undefined)} />
      ) : null}
    </>
  )
}

type PartsHereView = 'list' | 'thumbnails'

function PartsHere({
  stock,
  inv,
  onEdit,
}: {
  stock: Stock[]
  inv: Inventory
  onEdit: (stock: Stock) => void
}) {
  const [stored, setStored] = useSetting<PartsHereView>('ui.partsHereView', 'list')
  const view: PartsHereView = stored === 'thumbnails' ? 'thumbnails' : 'list'
  const [storedSort, setSort] = useSetting<SortDir>('ui.partsSort', 'asc')
  const sort: SortDir = storedSort === 'desc' ? 'desc' : 'asc'
  const [storedGroup, setGroup] = useSetting<boolean>('ui.partsGroupByCategory', false)
  const grouped = storedGroup === true
  const groups = useMemo(() => {
    const compare = (a: Stock, b: Stock) => {
      const name = (s: Stock) => {
        const part = inv.partById.get(s.partId)
        return part ? partTitle(part) : 'Unknown part'
      }
      return compareName(name(a), name(b), sort) || a.id.localeCompare(b.id)
    }
    if (!grouped) return [{ key: 'all', label: '', items: [...stock].sort(compare) }]
    return groupByCategory(stock, (s) => inv.partById.get(s.partId)?.category, compare)
  }, [grouped, inv, sort, stock])
  return (
    <>
      <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Parts here</h2>
        {stock.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Sort parts by part number"
              value={sort}
              options={[
                { id: 'asc', label: 'A–Z' },
                { id: 'desc', label: 'Z–A' },
              ]}
              onChange={setSort}
            />
            <button
              type="button"
              aria-pressed={grouped}
              className={
                grouped
                  ? 'min-h-9 rounded-lg bg-accent px-2.5 text-sm font-medium text-on-accent'
                  : 'min-h-9 rounded-lg bg-raised px-2.5 text-sm text-muted'
              }
              onClick={() => void setGroup(!grouped)}
            >
              Category
            </button>
            <Segmented
              label="How to show the parts here"
              value={view}
              options={[
                { id: 'list', label: 'List' },
                { id: 'thumbnails', label: 'Thumbnails' },
              ]}
              onChange={setStored}
            />
          </div>
        ) : null}
      </div>
      {stock.length === 0 ? (
        <p className="text-sm text-muted">Nothing is stored directly in this place.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className={group.label ? 'mt-3' : undefined}>
            {group.label ? <h3 className="mb-2 text-sm font-medium text-muted">{group.label}</h3> : null}
            {view === 'list' ? (
              <ul className="space-y-2">
                {group.items.map((s) => {
                  const part = inv.partById.get(s.partId)
                  const title = part ? partTitle(part) : 'Unknown part'
                  const subtitle = part ? partSubtitle(part) : ''
                  return (
                    <li key={s.id} className="flex items-stretch gap-2">
                      <Link
                        to={`/part/${s.partId}`}
                        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
                      >
                        <PartThumb hash={partPhotoHash(part, [s])} alt={`Photo of ${title}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium break-words">{title}</span>
                          {subtitle ? <span className="block text-sm text-muted">{subtitle}</span> : null}
                          <span className="mt-1 block text-sm text-muted">
                            {formatQty(s) || 'not counted'}
                          </span>
                        </span>
                      </Link>
                      <Button
                        small
                        variant="ghost"
                        icon="edit"
                        aria-label={`Change the bag of ${title}`}
                        onClick={() => onEdit(s)}
                        className="self-center"
                      />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {group.items.map((s) => {
                  const part = inv.partById.get(s.partId)
                  const title = part ? partTitle(part) : 'Unknown part'
                  const thumb = partPhotoHash(part, [s])
                  return (
                    <li key={s.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                      <Link to={`/part/${s.partId}`} className="block hover:text-accent">
                        <div className="relative aspect-square bg-raised">
                          {thumb ? (
                            <Photo
                              hash={thumb}
                              alt={`Photo of ${title}`}
                              fit="contain"
                              className="absolute inset-0 size-full"
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center text-muted">
                              <Icon name="box" className="size-8" />
                            </span>
                          )}
                        </div>
                        <span className="block px-2 pt-2 text-sm font-medium break-words">{title}</span>
                      </Link>
                      <div className="flex items-center justify-between gap-1 px-2 pb-2">
                        <span className="text-sm text-muted">{formatQty(s) || 'not counted'}</span>
                        <Button
                          small
                          variant="ghost"
                          icon="edit"
                          aria-label={`Change the bag of ${title}`}
                          onClick={() => onEdit(s)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))
      )}
    </>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { id: T; label: string }[]
  onChange: (id: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-raised p-0.5">
      {options.map((option) => {
        const selected = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={
              selected
                ? 'min-h-9 rounded-md bg-accent px-2.5 text-sm font-medium text-on-accent'
                : 'min-h-9 rounded-md px-2.5 text-sm text-muted'
            }
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function KindSelect({
  value,
  onChange,
}: {
  value: LocationKind
  onChange: (kind: LocationKind) => void
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as LocationKind)}>
      {LOCATION_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {KIND_LABEL[kind]}
        </option>
      ))}
    </Select>
  )
}

function AddLocationSheet({
  parent,
  defaultKind,
  onClose,
}: {
  parent: Location | undefined
  defaultKind: LocationKind
  onClose: () => void
}) {
  const { store } = useApp()
  const toast = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState(defaultKind)

  const add = async (another: boolean) => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await createLocation(store, { name: trimmed, kind, parentId: parent?.id ?? null })
      if (another) {
        toast(`Added ${trimmed}`)
        setName(nextName(trimmed))
      } else {
        onClose()
      }
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Sheet title={parent ? `Add inside ${parent.name}` : 'Add a place'} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void add(false)
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            autoCapitalize="words"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'room' ? 'e.g. Garage' : `e.g. ${KIND_LABEL[kind]} 1`}
          />
        </Field>
        <Field label="Kind">
          <KindSelect value={kind} onChange={setKind} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            Add
          </Button>
          <Button disabled={!name.trim()} onClick={() => add(true)}>
            Add and add another
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** "Box 12" -> "Box 13", to make adding a row of boxes quick. */
function nextName(name: string): string {
  const match = /^(.*?)(\d+)$/.exec(name)
  if (!match) return ''
  const next = String(Number(match[2]) + 1).padStart(match[2].length, '0')
  return match[1] + next
}

function EditLocationSheet({
  location,
  onClose,
  onDeleted,
}: {
  location: Location
  onClose: () => void
  onDeleted: () => void
}) {
  const { store, inv } = useApp()
  const toast = useToast()
  const [name, setName] = useState(location.name)
  const [kind, setKind] = useState(location.kind)
  const [note, setNote] = useState(location.note ?? '')
  const [parentId, setParentId] = useState(location.parentId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const contents = locationContents(inv, location.id)

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      if (parentId !== location.parentId) {
        await moveLocation(store, inv, location.id, parentId)
      }
      await updateLocation(store, location.id, {
        name: trimmed,
        kind,
        note: note.trim() || undefined,
      })
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const remove = async () => {
    try {
      await deleteLocation(store, inv, location.id)
      toast(`Deleted ${location.name}`)
      onClose()
      onDeleted()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Sheet title={`Edit ${location.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name">
          <Input autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind">
          <KindSelect value={kind} onChange={setKind} />
        </Field>
        <Field label="Note">
          <TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. top shelf, blue lid"
          />
        </Field>
        <Field label="Inside" hint="Moving a place moves everything in it.">
          <LocationSelect
            label="Inside"
            value={parentId}
            onChange={setParentId}
            exclude={(id) => isInside(inv, id, location.id)}
            noneLabel="Top level"
            allowNone
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <div className="border-t border-line pt-3">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-sm">
                This deletes {location.name}
                {contents.locations > 0 ? `, ${contents.locations} places inside it` : ''}
                {contents.stock > 0
                  ? ` and the record of ${contents.stock} ${contents.stock === 1 ? 'bag' : 'bags'} stored there`
                  : ''}
                . The parts themselves stay in your list.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" icon="trash" onClick={remove}>
                  Delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Delete this place
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
