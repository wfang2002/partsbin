import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { createProject, deleteProject, updateProject } from '../../domain/actions'
import { formatQty, partPhotoHash, partTitle, pathLabel } from '../../domain/inventory'
import { buildPickList, type PickLine } from '../../domain/picklist'
import type { BomLine, Project } from '../../domain/types'
import { parseBom } from '../../import/bom'
import { pickFile } from '../../platform/files'
import { search } from '../../search'
import { LocationSelect } from '../LocationSelect'
import { PartThumb } from '../PartThumb'
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Icon,
  Input,
  PageHeader,
  SectionTitle,
  Sheet,
  TextArea,
  errorText,
  useToast,
} from '../kit'

export function ProjectsPage() {
  const { inv, store } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const projects = useMemo(
    () => [...inv.projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [inv],
  )

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const id = await createProject(store, trimmed)
      setName('')
      navigate(`/projects/${id}`)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <>
      <PageHeader title="Projects" />
      <div className="p-3">
        {projects.length === 0 ? (
          <EmptyState title="No projects yet">
            A project links the boxes that belong to it and can check a parts list (BOM) against
            what you have.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
                >
                  <Icon name="project" className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{project.name}</span>
                    <span className="block text-sm text-muted">
                      {project.bom.length > 0 ? `${project.bom.length} lines in the parts list` : 'No parts list'}
                      {project.locationIds.length > 0 ? ` · ${project.locationIds.length} places` : ''}
                    </span>
                  </span>
                  <Icon name="chevron" className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <Input
            aria-label="New project name"
            autoCapitalize="words"
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" icon="plus" disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </div>
    </>
  )
}

const STATUS: Record<PickLine['status'], { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  have: { label: 'In stock', tone: 'ok' },
  uncounted: { label: 'Have, not counted', tone: 'warn' },
  short: { label: 'Not enough', tone: 'danger' },
  missing: { label: 'Missing', tone: 'danger' },
}

export function ProjectPage() {
  const { projectId } = useParams()
  const { inv, index, store } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const project = inv.projects.find((p) => p.id === projectId)
  const [editing, setEditing] = useState(false)
  const [boards, setBoards] = useState(1)
  const [addingPlace, setAddingPlace] = useState<string | null>(null)

  const pickList = useMemo(() => {
    if (!project) return []
    const scaled = project.bom.map((line) => ({ ...line, qty: line.qty * boards }))
    return buildPickList(inv, scaled, (text) => {
      const hit = search(index, text).find((h) => h.kind === 'part')
      return hit ? inv.partById.get(hit.id) : undefined
    })
  }, [project, boards, inv, index])

  if (!project) {
    return (
      <>
        <PageHeader title="Project" onBack={() => navigate('/projects')} />
        <EmptyState title="This project no longer exists">
          It may have been deleted on another device.
        </EmptyState>
      </>
    )
  }

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const importBom = () =>
    act(async () => {
      const file = await pickFile('.csv,text/csv,text/plain')
      if (!file) return
      const bom = parseBom(await file.text())
      if (bom.length === 0) throw new Error('No parts were found in that file.')
      await updateProject(store, project.id, { bom })
      toast(`Imported ${bom.length} lines`)
    })

  const setLinePart = (lineIndex: number, partId: string | undefined) =>
    act(() => {
      const bom: BomLine[] = project.bom.map((line, i) => {
        if (i !== lineIndex) return line
        const { partId: _previous, ...rest } = line
        return partId ? { ...rest, partId } : rest
      })
      return updateProject(store, project.id, { bom })
    })

  const places = project.locationIds.filter((id) => inv.locById.has(id))
  const ready = pickList.filter((l) => l.status === 'have' || l.status === 'uncounted').length

  return (
    <>
      <PageHeader
        title={project.name}
        onBack={() => navigate('/projects')}
        actions={
          <Button small icon="edit" onClick={() => setEditing(true)}>
            Edit
          </Button>
        }
      />
      <div className="p-3">
        {project.note ? <p className="mb-3 whitespace-pre-wrap">{project.note}</p> : null}

        <SectionTitle>Kept in</SectionTitle>
        {places.length === 0 ? (
          <p className="mb-2 text-sm text-muted">No boxes are linked to this project.</p>
        ) : (
          <ul className="mb-2 space-y-2">
            {places.map((id) => (
              <li key={id} className="flex items-stretch gap-2">
                <Link
                  to={`/locations/${id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
                >
                  <Icon name="box" className="text-accent" />
                  <span className="min-w-0 flex-1">{pathLabel(inv, id)}</span>
                </Link>
                <Button
                  variant="ghost"
                  icon="close"
                  aria-label={`Unlink ${pathLabel(inv, id)}`}
                  onClick={() =>
                    act(() =>
                      updateProject(store, project.id, {
                        locationIds: project.locationIds.filter((l) => l !== id),
                      }),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <LocationSelect
              value={addingPlace}
              onChange={setAddingPlace}
              exclude={(id) => project.locationIds.includes(id)}
              noneLabel="Link a place"
              scan
            />
          </div>
          <Button
            icon="plus"
            disabled={!addingPlace}
            onClick={() =>
              act(async () => {
                if (!addingPlace) return
                await updateProject(store, project.id, {
                  locationIds: [...project.locationIds, addingPlace],
                })
                setAddingPlace(null)
              })
            }
          >
            Link
          </Button>
        </div>

        <SectionTitle>Parts list</SectionTitle>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Button icon="upload" onClick={importBom}>
            {project.bom.length > 0 ? 'Replace from CSV' : 'Import from CSV'}
          </Button>
          {project.bom.length > 0 ? (
            <label className="flex items-center gap-2 text-sm text-muted">
              Boards to build
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={boards}
                onChange={(e) => setBoards(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                className="w-20"
              />
            </label>
          ) : null}
        </div>
        {project.bom.length === 0 ? (
          <p className="text-sm text-muted">
            Export a BOM from KiCad (or any CSV with part number and quantity columns) to see which
            parts you have and where they are.
          </p>
        ) : (
          <>
            <Banner tone={ready === pickList.length ? 'ok' : 'info'}>
              {ready} of {pickList.length} lines are in stock.
            </Banner>
            <ul className="mt-3 space-y-2">
              {pickList.map((pick, lineIndex) => (
                <li key={lineIndex}>
                  <PickRow
                    pick={pick}
                    linked={Boolean(project.bom[lineIndex]?.partId)}
                    onLink={(partId) => setLinePart(lineIndex, partId)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {editing ? (
        <EditProjectSheet
          project={project}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate('/projects', { replace: true })}
        />
      ) : null}
    </>
  )
}

function PickRow({
  pick,
  linked,
  onLink,
}: {
  pick: PickLine
  /** The line was matched to a part by hand. */
  linked: boolean
  onLink: (partId: string | undefined) => void
}) {
  const { inv } = useApp()
  const status = STATUS[pick.status]
  const have =
    pick.counted > 0
      ? `have ${pick.counted}${pick.uncounted > 0 ? ' + uncounted bags' : ''}`
      : pick.uncounted > 0
        ? 'have uncounted bags'
        : ''
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-0 flex-1 font-medium break-words">{pick.line.mpn}</span>
        <Chip tone={status.tone}>{status.label}</Chip>
      </div>
      <p className="text-sm text-muted">
        {[`need ${pick.line.qty}`, have, pick.line.refs].filter(Boolean).join(' · ')}
      </p>
      {pick.part ? (
        <div className="mt-2 flex items-start gap-3">
          <PartThumb
            hash={partPhotoHash(pick.part, pick.stock)}
            alt={`Photo of ${partTitle(pick.part)}`}
          />
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/part/${pick.part.id}`} className="text-accent">
                {partTitle(pick.part)}
              </Link>
              {linked ? (
                <Button small variant="ghost" onClick={() => onLink(undefined)}>
                  Not this part
                </Button>
              ) : null}
            </div>
            {pick.stock.map((s) => (
              <div key={s.id} className="flex items-baseline gap-2">
                <Icon name="box" className="size-4 translate-y-0.5 text-accent" />
                <span className="min-w-0 flex-1">{pathLabel(inv, s.locationId)}</span>
                <span className="text-muted">{formatQty(s) || 'not counted'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : pick.suggestion ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>
            Similar part you have:{' '}
            <Link to={`/part/${pick.suggestion.id}`} className="text-accent">
              {partTitle(pick.suggestion)}
            </Link>
          </span>
          <Button small onClick={() => onLink(pick.suggestion?.id)}>
            Use it
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function EditProjectSheet({
  project,
  onClose,
  onDeleted,
}: {
  project: Project
  onClose: () => void
  onDeleted: () => void
}) {
  const { store } = useApp()
  const toast = useToast()
  const [name, setName] = useState(project.name)
  const [note, setNote] = useState(project.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await updateProject(store, project.id, { name: trimmed, note: note.trim() || undefined })
      onClose()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const remove = async () => {
    try {
      await deleteProject(store, project.id)
      toast(`Deleted ${project.name}`)
      onClose()
      onDeleted()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Sheet title={`Edit ${project.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name">
          <Input autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Note">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Delete this project? Parts and places are kept.</span>
              <Button variant="danger" icon="trash" onClick={remove}>
                Delete
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Delete project
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
