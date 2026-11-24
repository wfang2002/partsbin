import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { askInventory, type AskResult } from '../../ai/ask'
import { useApp } from '../../app/context'
import { loadAi } from '../../app/services'
import {
  formatQty,
  partPhotoHash,
  partSubtitle,
  partTitle,
  pathLabel,
  type Inventory,
} from '../../domain/inventory'
import type { Part } from '../../domain/types'
import { scanner } from '../../scan'
import { parseLabel, parseLocationQr } from '../../scan/labelParsers'
import { search } from '../../search'
import { PartThumb } from '../PartThumb'
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  SectionTitle,
  count,
  errorText,
  useToast,
} from '../kit'

export function SearchPage() {
  const { inv, index, store } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true })

  const hits = useMemo(() => search(index, query), [index, query])
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState<{ question: string; result: AskResult }>()

  const scan = async () => {
    try {
      const barcode = await scanner.scanLive()
      if (!barcode) return
      const locationId = parseLocationQr(barcode.text)
      if (locationId) {
        if (inv.locById.has(locationId)) navigate(`/locations/${locationId}`)
        else toast('That sticker belongs to a place that no longer exists here.', 'error')
        return
      }
      const label = parseLabel([barcode], '')
      setQuery(label.mpn ?? barcode.text.slice(0, 80))
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const ask = async () => {
    const question = query.trim()
    if (!question) return
    setAsking(true)
    try {
      const ai = await loadAi(store)
      if (!ai) {
        toast('Add your OpenAI key and choose a model in Settings to ask questions.', 'error')
        return
      }
      // Parts that match the words come first, then everything else.
      const matched = hits
        .filter((h) => h.kind === 'part')
        .map((h) => inv.partById.get(h.id))
        .filter((p): p is Part => p !== undefined)
      const rest = inv.parts.filter((p) => !matched.includes(p))
      const result = await askInventory(ai, inv, [...matched, ...rest], question)
      setAsked({ question, result })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setAsking(false)
    }
  }

  const answer = asked?.question === query.trim() ? asked.result : undefined

  return (
    <div className="p-3">
      <form
        role="search"
        className="sticky top-0 z-10 -mx-3 flex gap-2 bg-bg/95 px-3 py-2 backdrop-blur"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            aria-label="Search parts and places"
            placeholder="Part number, value, description, place"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 pl-10"
          />
        </div>
        <Button icon="qr" onClick={scan} aria-label="Scan a barcode or box sticker" />
      </form>

      {query.trim() === '' ? (
        <Overview inv={inv} />
      ) : (
        <>
          <div className="mt-1 mb-3 flex items-center gap-3">
            <p className="flex-1 text-sm text-muted">
              {hits.length === 0
                ? 'Nothing matches those words.'
                : count(hits.length, 'match', 'matches')}
            </p>
            <Button small icon="sparkle" busy={asking} onClick={ask}>
              Ask AI
            </Button>
          </div>

          {answer ? (
            <Card className="mb-4 p-3">
              <p className="text-sm font-medium text-muted">AI answer</p>
              <p className="mt-1">{answer.answer || 'No answer was given.'}</p>
              {answer.matches.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {answer.matches.map((match) => {
                    const part = inv.partById.get(match.partId)
                    return part ? (
                      <li key={match.partId}>
                        <PartResult inv={inv} part={part} note={match.why} />
                      </li>
                    ) : null
                  })}
                </ul>
              ) : null}
              {answer.truncated ? (
                <p className="mt-2 text-sm text-muted">
                  Only part of the inventory was considered because it is large.
                </p>
              ) : null}
            </Card>
          ) : null}

          <ul className="space-y-2">
            {hits.map((hit) => {
              if (hit.kind === 'location') {
                return inv.locById.has(hit.id) ? (
                  <li key={`l${hit.id}`}>
                    <Link
                      to={`/locations/${hit.id}`}
                      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
                    >
                      <Icon name="box" className="text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{pathLabel(inv, hit.id)}</span>
                        <span className="block text-sm text-muted">
                          {count((inv.stockByLocation.get(hit.id) ?? []).length, 'bag')} here
                        </span>
                      </span>
                      <Icon name="chevron" className="text-muted" />
                    </Link>
                  </li>
                ) : null
              }
              const part = inv.partById.get(hit.id)
              return part ? (
                <li key={`p${hit.id}`}>
                  <PartResult inv={inv} part={part} />
                </li>
              ) : null
            })}
          </ul>
        </>
      )}
    </div>
  )
}

/** A part with where every bag of it is. */
export function PartResult({
  inv,
  part,
  note,
}: {
  inv: Inventory
  part: Part
  note?: string
}) {
  const stock = inv.stockByPart.get(part.id) ?? []
  const title = partTitle(part)
  const subtitle = partSubtitle(part)
  return (
    <Link
      to={`/part/${part.id}`}
      className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
    >
      <PartThumb hash={partPhotoHash(part, stock)} alt={`Photo of ${title}`} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">{title}</span>
        {subtitle ? <span className="block text-sm text-muted">{subtitle}</span> : null}
        {note ? <span className="mt-1 block text-sm">{note}</span> : null}
        <span className="mt-2 block space-y-1">
          {stock.length === 0 ? (
            <span className="block text-sm text-muted">No stock recorded</span>
          ) : (
            stock.map((s) => (
              <span key={s.id} className="flex items-baseline gap-2 text-sm">
                <Icon name="box" className="size-4 translate-y-0.5 text-accent" />
                <span className="min-w-0 flex-1">{pathLabel(inv, s.locationId)}</span>
                <span className="text-muted">{formatQty(s) || 'not counted'}</span>
              </span>
            ))
          )}
        </span>
      </span>
    </Link>
  )
}

function Overview({ inv }: { inv: Inventory }) {
  const recent = useMemo(
    () => [...inv.stock].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 15),
    [inv],
  )
  if (inv.locations.length === 0) {
    return (
      <EmptyState title="Start with where things are">
        <p>Add your rooms, racks and boxes first. Then put parts away into them.</p>
        <Link to="/locations" className="mt-4 inline-block font-medium text-accent">
          Add a place
        </Link>
      </EmptyState>
    )
  }
  if (inv.parts.length === 0) {
    return (
      <EmptyState title="No parts yet">
        <p>Photograph a bag label to record what it is and where it goes.</p>
        <Link to="/add" className="mt-4 inline-block font-medium text-accent">
          Put parts away
        </Link>
      </EmptyState>
    )
  }
  return (
    <>
      <Banner tone="info">
        {count(inv.parts.length, 'part')} in {count(inv.stock.length, 'bag')} across{' '}
        {count(inv.locations.length, 'place')}. Try "10k 0603", "esp32" or a box name.
      </Banner>
      <SectionTitle>Recently put away</SectionTitle>
      <ul className="space-y-2">
        {recent.map((s) => {
          const part = inv.partById.get(s.partId)
          return part ? (
            <li key={s.id}>
              <Link
                to={`/part/${part.id}`}
                className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 hover:border-accent"
              >
                <PartThumb
                  hash={partPhotoHash(part, [s])}
                  alt={`Photo of ${partTitle(part)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{partTitle(part)}</span>
                  <span className="mt-1 flex items-baseline gap-2 text-sm">
                    <Icon name="box" className="size-4 translate-y-0.5 text-accent" />
                    <span className="min-w-0 flex-1">{pathLabel(inv, s.locationId)}</span>
                    <span className="text-muted">{formatQty(s) || 'not counted'}</span>
                  </span>
                </span>
              </Link>
            </li>
          ) : null
        })}
      </ul>
    </>
  )
}
