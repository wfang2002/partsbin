import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { readLabelWithAi } from '../../ai/label'
import { useApp, useSetting } from '../../app/context'
import { KEYS, fetchPartImage, loadAi, partFieldsFromInfo } from '../../app/services'
import { recordBag, type PartFields } from '../../domain/actions'
import {
  findPartByMpn,
  formatQty,
  partTitle,
  pathLabel,
} from '../../domain/inventory'
import type { Part } from '../../domain/types'
import type { PartInfo } from '../../enrich/lookup'
import { toJpeg } from '../../platform/image'
import { readLabel, scanner } from '../../scan'
import { parseLabel, parseLocationQr } from '../../scan/labelParsers'
import type { ParsedLabel } from '../../scan/types'
import { LocationSelect } from '../LocationSelect'
import { LookupControl } from '../LookupControl'
import {
  EMPTY_DRAFT,
  PartForm,
  draftToFields,
  mergeIntoDraft,
  type PartDraft,
} from '../PartForm'
import { QuantityInput, type Quantity } from '../StockEditor'
import {
  Banner,
  Button,
  Card,
  Chip,
  Field,
  PageHeader,
  SectionTitle,
  Spinner,
  errorText,
  useToast,
} from '../kit'

/** Longest side of the label photo saved with a photographed bag. */
const LABEL_THUMB_MAX = 640

const LABEL_SOURCE: Record<ParsedLabel['source'], string> = {
  digikey: 'Read from the Digi-Key barcode.',
  mouser: 'Read from the Mouser barcode.',
  lcsc: 'Read from the LCSC QR code.',
  barcode: 'Read from the barcode.',
  ocr: 'Read from the printed text. Check the part number.',
  ai: 'Read by AI. Check the details.',
  none: 'Nothing on the label could be read. Type the details in, or try another photo.',
}

/** What is known about the bag being recorded. */
interface Capture {
  draft: PartDraft
  quantity: Quantity
  /** Other strings on the label that could be the part number. */
  candidates: string[]
  status?: string
  warnings: string[]
  /** Label photo kept with the bag: longest side 640px. */
  photoJpeg?: Uint8Array
  /** Larger copy used only to read the label. Not stored. */
  aiJpeg?: Uint8Array
  photoUrl?: string
  ocrText: string
  /** Part number to look up automatically. */
  autoMpn?: string
  usedAi: boolean
  found?: PartInfo
}

const labelToFields = (label: ParsedLabel): PartFields => ({
  mpn: label.mpn,
  manufacturer: label.manufacturer,
  description: label.description,
  category: label.category,
  specs: label.specs,
})

function newCapture(): Capture {
  return { draft: EMPTY_DRAFT, quantity: {}, candidates: [], warnings: [], ocrText: '', usedAi: false }
}

export function CapturePage() {
  const { inv, store } = useApp()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const fixedPart = inv.partById.get(params.get('part') ?? '')

  const [lastLocation, setLastLocation] = useSetting<string | null>('ui.lastLocation', null)
  const [chosenLocation, setChosenLocation] = useState<string | null>(params.get('loc'))
  const candidateLocation = chosenLocation ?? lastLocation
  const locationId = candidateLocation && inv.locById.has(candidateLocation) ? candidateLocation : null

  const [aiAuto] = useSetting(KEYS.aiAuto, false)
  const [capture, setCapture] = useState<Capture | null>(null)
  /** Quantity when adding a bag of a part that is already known. */
  const [fixedQuantity, setFixedQuantity] = useState<Quantity>({})
  const [reading, setReading] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [session, setSession] = useState<{ partId: string; title: string; where: string }[]>([])

  // Free the preview image when it is replaced or the page closes.
  const photoUrl = capture?.photoUrl
  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
  }, [photoUrl])

  const applyLabel = (label: ParsedLabel, base: Capture): Capture => ({
    ...base,
    draft: mergeIntoDraft(base.draft, labelToFields(label), label.source === 'ai'),
    quantity: base.quantity.qty === undefined && label.qty !== undefined ? { qty: label.qty } : base.quantity,
    candidates: [...new Set([...base.candidates, ...label.mpnCandidates])].filter(
      (c) => c !== label.mpn,
    ),
    status: LABEL_SOURCE[label.source],
    autoMpn: label.mpn && label.confidence === 'high' ? label.mpn : base.autoMpn,
    usedAi: base.usedAi || label.source === 'ai',
  })

  const readWithAi = async (target: Capture) => {
    if (!target.photoJpeg) return
    setAiBusy(true)
    try {
      const ai = await loadAi(store)
      if (!ai) {
        toast('Add your OpenAI key and choose a model in Settings first.', 'error')
        return
      }
      const label = await readLabelWithAi(ai, target.aiJpeg ?? target.photoJpeg, target.ocrText)
      setCapture((current) => (current ? applyLabel(label, current) : current))
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setAiBusy(false)
    }
  }

  const photograph = async () => {
    try {
      const image = await scanner.capturePhoto()
      if (!image) return
      setReading(true)
      const [result, aiJpeg, photoJpeg] = await Promise.all([
        readLabel(image),
        toJpeg(image.blob),
        toJpeg(image.blob, LABEL_THUMB_MAX),
      ])
      const next = applyLabel(result.label, {
        ...newCapture(),
        warnings: result.warnings,
        ocrText: result.ocrText,
        photoJpeg,
        aiJpeg,
        photoUrl: URL.createObjectURL(new Blob([photoJpeg as BlobPart], { type: 'image/jpeg' })),
      })
      setCapture(next)
      setReading(false)
      if (aiAuto && result.label.confidence === 'low') await readWithAi(next)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setReading(false)
    }
  }

  const scanBarcode = async () => {
    try {
      const barcode = await scanner.scanLive()
      if (!barcode) return
      const scannedLocation = parseLocationQr(barcode.text)
      if (scannedLocation) {
        if (inv.locById.has(scannedLocation)) setChosenLocation(scannedLocation)
        else toast('That sticker belongs to a place that no longer exists here.', 'error')
        return
      }
      const label = parseLabel([barcode], '')
      const next = applyLabel(label, newCapture())
      // A barcode that is not a known label format is most likely the part number itself.
      if (!label.mpn && label.mpnCandidates.length === 0) {
        next.candidates = [barcode.text.slice(0, 60)]
      }
      setCapture(next)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const save = async () => {
    if (!locationId) {
      toast('Choose the place this bag goes into.', 'error')
      return
    }
    if (!capture && !fixedPart) return
    setSaving(true)
    try {
      let part: PartFields = {}
      let labelPhotoBlob: string | undefined
      if (capture) {
        part = draftToFields(capture.draft)
        if (!fixedPart && !part.mpn && !part.description) {
          toast('Enter a part number or a description.', 'error')
          return
        }
        part.ocrText = capture.ocrText.trim().slice(0, 4000) || undefined
        part.source = capture.found?.source ?? (capture.usedAi ? 'ai' : 'manual')
        if (capture.photoJpeg) labelPhotoBlob = await store.putBlob(capture.photoJpeg)
        const known = fixedPart ?? findPartByMpn(inv, part.mpn)
        if (!known?.imageBlob) {
          part.imageBlob = await fetchPartImage(store, capture.found?.imageUrl)
        }
      }
      const quantity = capture?.quantity ?? fixedQuantity
      const result = await recordBag(store, inv, {
        partId: fixedPart?.id,
        part,
        locationId,
        qty: quantity.qty,
        qtyApprox: quantity.qtyApprox,
        labelPhotoBlob,
      })
      await setLastLocation(locationId)
      const where = pathLabel(inv, locationId)
      // A bag added to a known part is listed under that part's own name.
      const known = fixedPart ?? findPartByMpn(inv, part.mpn)
      const title = known ? partTitle(known) : part.mpn || part.description || 'Part'
      toast(`Saved to ${where}`)
      if (fixedPart) {
        navigate(`/part/${fixedPart.id}`, { replace: true })
        return
      }
      setSession((current) => [{ partId: result.partId, title, where }, ...current])
      setCapture(null)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const setDraft = (draft: PartDraft) =>
    setCapture((current) => (current ? { ...current, draft } : current))
  const existing = capture && !fixedPart ? findPartByMpn(inv, capture.draft.mpn) : undefined

  return (
    <>
      <PageHeader
        title={fixedPart ? `Add a bag of ${partTitle(fixedPart)}` : 'Put parts away'}
        onBack={fixedPart || capture ? () => (capture && !fixedPart ? setCapture(null) : navigate(-1)) : undefined}
      />
      <div className="space-y-4 p-3">
        <Card className="p-3">
          <Field
            label="Goes into"
            hint={
              inv.locations.length === 0 ? (
                <>
                  There are no places yet.{' '}
                  <Link to="/locations" className="font-medium text-accent">
                    Add a room or box first.
                  </Link>
                </>
              ) : (
                'Stays selected, so you can put away one bag after another.'
              )
            }
          >
            <LocationSelect value={locationId} onChange={setChosenLocation} scan />
          </Field>
        </Card>

        {fixedPart ? (
          <Card className="space-y-4 p-3">
            <QuantityInput value={fixedQuantity} onChange={setFixedQuantity} />
            <Button variant="primary" icon="check" busy={saving} onClick={save}>
              Save
            </Button>
          </Card>
        ) : capture ? (
          <>
            <Card className="space-y-3 p-3">
              {capture.photoUrl ? (
                <img
                  src={capture.photoUrl}
                  alt="The label you photographed"
                  className="max-h-48 w-full rounded-lg object-contain"
                />
              ) : null}
              {capture.status ? (
                <Banner tone={capture.draft.mpn || capture.draft.description ? 'info' : 'warn'}>
                  {capture.status}
                </Banner>
              ) : null}
              {capture.warnings.map((warning) => (
                <Banner key={warning} tone="warn">
                  {warning}
                </Banner>
              ))}
              {capture.photoJpeg ? (
                <Button small icon="sparkle" busy={aiBusy} onClick={() => readWithAi(capture)}>
                  Read with AI
                </Button>
              ) : null}
              {existing ? <DuplicateNotice part={existing} locationId={locationId} /> : null}

              <PartForm
                draft={capture.draft}
                onChange={setDraft}
                mpnExtra={
                  <>
                    {capture.candidates.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm text-muted">Also on the label:</span>
                        {capture.candidates.map((candidate) => (
                          <Chip
                            key={candidate}
                            onClick={() => setDraft({ ...capture.draft, mpn: candidate })}
                          >
                            {candidate}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                    <LookupControl
                      mpn={capture.draft.mpn}
                      autoMpn={existing ? undefined : capture.autoMpn}
                      onApply={(info) =>
                        setCapture((current) =>
                          current
                            ? {
                                ...current,
                                found: info,
                                draft: mergeIntoDraft(current.draft, partFieldsFromInfo(info), true),
                              }
                            : current,
                        )
                      }
                    />
                  </>
                }
              />
              <QuantityInput
                value={capture.quantity}
                onChange={(quantity) => setCapture({ ...capture, quantity })}
              />
              {capture.ocrText.trim() ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Text read from the label</summary>
                  <pre className="mt-2 font-mono text-sm break-words whitespace-pre-wrap">
                    {capture.ocrText}
                  </pre>
                </details>
              ) : null}
            </Card>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="check" busy={saving} onClick={save}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setCapture(null)}>
                Discard
              </Button>
            </div>
          </>
        ) : reading ? (
          <Card className="flex items-center gap-3 p-4">
            <Spinner />
            Reading the label
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="primary" icon="camera" onClick={photograph} className="min-h-16">
              Photograph label
            </Button>
            <Button icon="qr" onClick={scanBarcode} className="min-h-16">
              Scan barcode
            </Button>
            <Button icon="edit" onClick={() => setCapture(newCapture())} className="min-h-16">
              Type it in
            </Button>
          </div>
        )}

        {session.length > 0 && !capture ? (
          <>
            <SectionTitle>Put away just now</SectionTitle>
            <Card>
              <ul className="divide-y divide-line">
                {session.map((entry, index) => (
                  <li key={index}>
                    <Link to={`/part/${entry.partId}`} className="block px-3 py-2 hover:text-accent">
                      <span className="block font-medium break-words">{entry.title}</span>
                      <span className="block text-sm text-muted">{entry.where}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : null}
      </div>
    </>
  )
}

/** Tells the user they already own this part, and where it is. */
function DuplicateNotice({ part, locationId }: { part: Part; locationId: string | null }) {
  const { inv } = useApp()
  const stock = inv.stockByPart.get(part.id) ?? []
  const sameSpot = stock.some((s) => s.locationId === locationId)
  return (
    <Banner tone="warn">
      <p className="font-medium">You already have {partTitle(part)}.</p>
      {stock.length === 0 ? (
        <p>No bags of it are recorded at the moment.</p>
      ) : (
        <ul className="mt-1">
          {stock.map((s) => (
            <li key={s.id}>
              {pathLabel(inv, s.locationId)}
              {formatQty(s) ? ` (${formatQty(s)})` : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1">
        {sameSpot
          ? 'Saving adds a second bag in the same place.'
          : 'Saving adds this bag to the same part.'}{' '}
        <Link to={`/part/${part.id}`} className="font-medium underline">
          Open the part
        </Link>
      </p>
    </Banner>
  )
}
