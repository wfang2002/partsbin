import { useEffect, useRef, useState } from 'react'
import { loadLookupKeys, lookupOnline } from '../app/services'
import type { PartInfo } from '../enrich/lookup'
import { Banner, Button, errorText } from './kit'

const SOURCE_NAME = { digikey: 'Digi-Key', mouser: 'Mouser' } as const

/**
 * "Look up online" for a part number. An exact match is applied at once; a
 * merely similar one is shown and applied only if the user accepts it.
 */
export function LookupControl({
  mpn,
  onApply,
  autoMpn,
}: {
  mpn: string
  /** Must not depend on values from the render it was created in. */
  onApply: (info: PartInfo) => void
  /** Look this part number up without being asked (if keys are set up). */
  autoMpn?: string
}) {
  const [busy, setBusy] = useState(false)
  const [similar, setSimilar] = useState<PartInfo>()
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string }>()
  const latest = useRef(0)

  const run = async (target: string, automatic: boolean) => {
    const wanted = target.trim()
    if (!wanted) return
    const run = ++latest.current
    setSimilar(undefined)
    setMessage(undefined)
    if (automatic) {
      const keys = await loadLookupKeys()
      if (!keys.digikey && !keys.mouser) return
    }
    setBusy(true)
    try {
      const { info, errors } = await lookupOnline(wanted)
      if (run !== latest.current) return
      if (info?.exact) {
        onApply(info)
        setMessage({ tone: 'ok', text: `Details filled in from ${SOURCE_NAME[info.source]}.` })
      } else if (info) {
        setSimilar(info)
      } else {
        setMessage({
          tone: 'warn',
          text: errors.length > 0 ? errors.join(' ') : `No distributor lists "${wanted}".`,
        })
      }
    } catch (e) {
      if (run === latest.current) setMessage({ tone: 'warn', text: errorText(e) })
    } finally {
      if (run === latest.current) setBusy(false)
    }
  }

  useEffect(() => {
    // Deliberately depends on autoMpn alone: it runs once per label read.
    if (autoMpn) void run(autoMpn, true)
  }, [autoMpn])

  return (
    <div className="mt-2 space-y-2">
      <Button small icon="search" busy={busy} disabled={!mpn.trim()} onClick={() => run(mpn, false)}>
        Look up online
      </Button>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      {similar ? (
        <Banner tone="warn">
          <p>
            No exact match. The closest at {SOURCE_NAME[similar.source]} is{' '}
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
