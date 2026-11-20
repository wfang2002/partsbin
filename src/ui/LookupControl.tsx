import { useEffect, useRef, useState } from 'react'
import { lookupLcscOnline, lookupOnline } from '../app/services'
import { LOOKUP_SOURCE_NAME, type PartInfo } from '../enrich/lookup'
import { Banner, Button, errorText } from './kit'

/**
 * "Look up online" for a part number. An exact match is applied at once; a
 * merely similar one is shown and applied only if the user accepts it.
 */
export function LookupControl({
  mpn,
  onApply,
  autoMpn,
  lcsc,
  autoLcsc = false,
}: {
  mpn: string
  /** Must not depend on values from the render it was created in. */
  onApply: (info: PartInfo) => void
  /** Look this part number up without being asked. */
  autoMpn?: string
  /** C-code and manufacturer part number read from an LCSC label. */
  lcsc?: { code?: string; pn?: string }
  /** Search the LCSC label once, C-code first, without being asked. */
  autoLcsc?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [similar, setSimilar] = useState<PartInfo>()
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string }>()
  const latest = useRef(0)

  const show = (token: number, info: PartInfo | null, errors: string[], missing: string) => {
    if (token !== latest.current) return
    if (info?.exact) {
      onApply(info)
      setMessage({ tone: 'ok', text: `Details filled in from ${LOOKUP_SOURCE_NAME[info.source]}.` })
    } else if (info) {
      setSimilar(info)
    } else {
      setMessage({
        tone: 'warn',
        text: errors.length > 0 ? errors.join(' ') : missing,
      })
    }
  }

  const run = async (target: string) => {
    const wanted = target.trim()
    if (!wanted) return
    const token = ++latest.current
    setSimilar(undefined)
    setMessage(undefined)
    setBusy(true)
    try {
      const { info, errors } = await lookupOnline(wanted)
      show(token, info, errors, `No distributor lists "${wanted}".`)
    } catch (e) {
      if (token === latest.current) setMessage({ tone: 'warn', text: errorText(e) })
    } finally {
      if (token === latest.current) setBusy(false)
    }
  }

  const runLcsc = async (code: string | undefined, pn: string | undefined) => {
    if (!code?.trim() && !pn?.trim()) return
    const token = ++latest.current
    setSimilar(undefined)
    setMessage(undefined)
    setBusy(true)
    try {
      const { info, errors } = await lookupLcscOnline(code, pn)
      const named = [code, pn].filter((part) => part?.trim()).join(' or ')
      show(token, info, errors, `LCSC does not list ${named}.`)
    } catch (e) {
      if (token === latest.current) setMessage({ tone: 'warn', text: errorText(e) })
    } finally {
      if (token === latest.current) setBusy(false)
    }
  }

  useEffect(() => {
    // Deliberately depends on the part numbers alone: it runs once per label read.
    if (autoLcsc) void runLcsc(lcsc?.code, lcsc?.pn)
    else if (autoMpn) void run(autoMpn)
  }, [autoLcsc, autoMpn, lcsc?.code, lcsc?.pn])

  const searchLcsc = () => void runLcsc(lcsc?.code, mpn.trim() || lcsc?.pn)

  return (
    <div className="mt-2 space-y-2">
      <Button
        small
        icon="search"
        busy={busy}
        disabled={!mpn.trim() && !lcsc?.code}
        onClick={() => (lcsc ? searchLcsc() : run(mpn))}
      >
        Look up online
      </Button>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      {similar ? (
        <Banner tone="warn">
          <p>
            No exact match. The closest at {LOOKUP_SOURCE_NAME[similar.source]} is{' '}
            <strong>{similar.mpn}</strong>
            {similar.description ? ` (${similar.description})` : ''}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              small
              onClick={() => {
                onApply(similar)
                setSimilar(undefined)
              }}
            >
              Use this part
            </Button>
            <Button small variant="ghost" onClick={() => setSimilar(undefined)}>
              Ignore
            </Button>
          </div>
        </Banner>
      ) : null}
    </div>
  )
}
