import type { ReactNode } from 'react'
import type { PartFields } from '../domain/actions'
import type { Part } from '../domain/types'
import { Button, Field, Input, TextArea } from './kit'

/** A part as edited in a form: every field is text. */
export interface PartDraft {
  mpn: string
  manufacturer: string
  description: string
  category: string
  tags: string
  datasheetUrl: string
  specs: [name: string, value: string][]
}

export const EMPTY_DRAFT: PartDraft = {
  mpn: '',
  manufacturer: '',
  description: '',
  category: '',
  tags: '',
  datasheetUrl: '',
  specs: [],
}

export function draftFromFields(fields: PartFields): PartDraft {
  return {
    mpn: fields.mpn ?? '',
    manufacturer: fields.manufacturer ?? '',
    description: fields.description ?? '',
    category: fields.category ?? '',
    tags: (fields.tags ?? []).join(', '),
    datasheetUrl: fields.datasheetUrl ?? '',
    specs: Object.entries(fields.specs ?? {}),
  }
}

export const draftFromPart = (part: Part) => draftFromFields(part)

export function draftToFields(draft: PartDraft): PartFields {
  const text = (value: string) => value.trim() || undefined
  return {
    mpn: text(draft.mpn),
    manufacturer: text(draft.manufacturer),
    description: text(draft.description),
    category: text(draft.category),
    datasheetUrl: text(draft.datasheetUrl),
    tags: [
      ...new Set(
        draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ],
    specs: Object.fromEntries(
      draft.specs
        .map(([name, value]) => [name.trim(), value.trim()] as const)
        .filter(([name, value]) => name && value),
    ),
  }
}

/**
 * Combine found data (a label, a distributor record) into the form. Text
 * the user already has is kept unless `overwrite` is set.
 */
export function mergeIntoDraft(
  draft: PartDraft,
  found: PartFields,
  overwrite = false,
): PartDraft {
  const pick = (current: string, incoming: string | undefined) =>
    incoming && (overwrite || !current.trim()) ? incoming : current
  const specs = [...draft.specs]
  for (const [name, value] of Object.entries(found.specs ?? {})) {
    const at = specs.findIndex(([n]) => n.trim().toLowerCase() === name.toLowerCase())
    if (at === -1) specs.push([name, value])
    else if (overwrite || !specs[at][1].trim()) specs[at] = [specs[at][0], value]
  }
  const tags = draftToFields(draft).tags ?? []
  for (const tag of found.tags ?? []) if (!tags.includes(tag)) tags.push(tag)
  return {
    mpn: pick(draft.mpn, found.mpn),
    manufacturer: pick(draft.manufacturer, found.manufacturer),
    description: pick(draft.description, found.description),
    category: pick(draft.category, found.category),
    datasheetUrl: pick(draft.datasheetUrl, found.datasheetUrl),
    tags: tags.join(', '),
    specs,
  }
}

export function PartForm({
  draft,
  onChange,
  mpnExtra,
}: {
  draft: PartDraft
  onChange: (draft: PartDraft) => void
  /** Shown under the part number field (candidates, lookup button). */
  mpnExtra?: ReactNode
}) {
  const set = (patch: Partial<PartDraft>) => onChange({ ...draft, ...patch })
  const setSpec = (index: number, pair: [string, string]) =>
    set({ specs: draft.specs.map((s, i) => (i === index ? pair : s)) })

  return (
    <div className="space-y-3">
      <Field label="Part number">
        <Input
          value={draft.mpn}
          onChange={(e) => set({ mpn: e.target.value })}
          placeholder="e.g. LM358DR"
        />
        {mpnExtra}
      </Field>
      <Field label="Description">
        <TextArea
          rows={2}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="e.g. 10k resistor 0603 1%"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Manufacturer">
          <Input
            value={draft.manufacturer}
            onChange={(e) => set({ manufacturer: e.target.value })}
          />
        </Field>
        <Field label="Category">
          <Input
            value={draft.category}
            onChange={(e) => set({ category: e.target.value })}
            placeholder="e.g. Resistors"
          />
        </Field>
      </div>
      <Field label="Tags" hint="Separate with commas.">
        <Input value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
      </Field>
      <Field label="Datasheet link">
        <Input
          type="url"
          inputMode="url"
          value={draft.datasheetUrl}
          onChange={(e) => set({ datasheetUrl: e.target.value })}
          placeholder="https://"
        />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-muted">Specifications</legend>
        <div className="space-y-2">
          {draft.specs.map(([name, value], index) => (
            <div key={index} className="flex gap-2">
              <Input
                aria-label="Specification name"
                value={name}
                onChange={(e) => setSpec(index, [e.target.value, value])}
                placeholder="Name"
                className="min-w-0 flex-1"
              />
              <Input
                aria-label="Specification value"
                value={value}
                onChange={(e) => setSpec(index, [name, e.target.value])}
                placeholder="Value"
                className="min-w-0 flex-1"
              />
              <Button
                variant="ghost"
                icon="close"
                aria-label={`Remove ${name || 'specification'}`}
                onClick={() => set({ specs: draft.specs.filter((_, i) => i !== index) })}
              />
            </div>
          ))}
          <Button small icon="plus" onClick={() => set({ specs: [...draft.specs, ['', '']] })}>
            Add specification
          </Button>
        </div>
      </fieldset>
    </div>
  )
}
