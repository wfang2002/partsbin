import { useEffect, useState } from 'react'
import { listOpenAiModels } from '../../../ai/client'
import { useApp, useSetting } from '../../../app/context'
import { KEYS, lookupOnline } from '../../../app/services'
import { platformFetch } from '../../../platform/http'
import { openExternal } from '../../../platform/open'
import { secrets, secretsAreSecure } from '../../../platform/secrets'
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  SectionTitle,
  errorText,
  useToast,
} from '../../kit'

/** Text fields backed by the device's secret store, saved together. */
function useSecrets<K extends string>(keys: readonly K[]) {
  const [values, setValues] = useState<Record<K, string>>(
    () => Object.fromEntries(keys.map((k) => [k, ''])) as Record<K, string>,
  )
  const [loaded, setLoaded] = useState(false)
  const joined = keys.join('|')
  useEffect(() => {
    let cancelled = false
    void Promise.all(keys.map(async (k) => [k, (await secrets.get(k)) ?? ''] as const)).then(
      (entries) => {
        if (cancelled) return
        setValues(Object.fromEntries(entries) as Record<K, string>)
        setLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
    // The joined names stand for the list of keys.
  }, [joined])
  const save = async () => {
    for (const key of keys) {
      const value = values[key].trim()
      if (value) await secrets.set(key, value)
      else await secrets.remove(key)
    }
  }
  const set = (key: K, value: string) => setValues((current) => ({ ...current, [key]: value }))
  return { values, set, save, loaded }
}

const SECRET_HINT = secretsAreSecure
  ? "Kept in this device's keychain. Never synced."
  : 'Browser preview: kept in this browser only, without keychain protection.'

function SecretInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <Input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

const LOOKUP_KEYS = [KEYS.digikeyClientId, KEYS.digikeyClientSecret, KEYS.mouserApiKey] as const

export function LookupSection() {
  const toast = useToast()
  const { values, set, save } = useSecrets(LOOKUP_KEYS)
  const [testMpn, setTestMpn] = useState('NE555P')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'warn'; text: string }>()

  const open = (url: string) => openExternal(url).catch((e) => toast(errorText(e), 'error'))

  const saveKeys = async () => {
    try {
      await save()
      toast('Keys saved')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const test = async () => {
    setTesting(true)
    setResult(undefined)
    try {
      await save()
      const { info, errors } = await lookupOnline(testMpn)
      if (info) {
        setResult({
          tone: errors.length > 0 ? 'warn' : 'ok',
          text: [
            `Found ${info.mpn} at ${info.source === 'digikey' ? 'Digi-Key' : 'Mouser'}: ${info.description ?? 'no description'}.`,
            ...errors,
          ].join(' '),
        })
      } else {
        setResult({ tone: 'warn', text: errors.join(' ') || 'Nothing was found for that part number.' })
      }
    } catch (e) {
      setResult({ tone: 'warn', text: errorText(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <SectionTitle>Part lookup</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          With a free API key from Digi-Key or Mouser, PartsBin fills in the description,
          specifications and datasheet link from the part number. {SECRET_HINT}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button small icon="link" onClick={() => open('https://developer.digikey.com/')}>
            Get Digi-Key keys
          </Button>
          <Button
            small
            icon="link"
            onClick={() => open('https://www.mouser.com/api-search/')}
          >
            Get a Mouser key
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SecretInput
            label="Digi-Key client ID"
            value={values[KEYS.digikeyClientId]}
            onChange={(v) => set(KEYS.digikeyClientId, v)}
          />
          <SecretInput
            label="Digi-Key client secret"
            value={values[KEYS.digikeyClientSecret]}
            onChange={(v) => set(KEYS.digikeyClientSecret, v)}
          />
        </div>
        <SecretInput
          label="Mouser search API key"
          value={values[KEYS.mouserApiKey]}
          onChange={(v) => set(KEYS.mouserApiKey, v)}
        />
        <Button variant="primary" onClick={saveKeys}>
          Save keys
        </Button>
        <div className="flex items-end gap-2 border-t border-line pt-3">
          <div className="min-w-0 flex-1">
            <Field label="Try a part number">
              <Input value={testMpn} onChange={(e) => setTestMpn(e.target.value)} />
            </Field>
          </div>
          <Button busy={testing} disabled={!testMpn.trim()} onClick={test}>
            Test
          </Button>
        </div>
        {result ? <Banner tone={result.tone}>{result.text}</Banner> : null}
      </Card>
    </>
  )
}

const AI_KEYS = [KEYS.openaiApiKey] as const

export function AiSection() {
  const { store } = useApp()
  const toast = useToast()
  const { values, set, save } = useSecrets(AI_KEYS)
  const [savedModel] = useSetting(KEYS.aiModel, '')
  const [savedBaseUrl] = useSetting(KEYS.aiBaseUrl, '')
  const [auto, setAuto] = useSetting(KEYS.aiAuto, false)
  const [model, setModel] = useState<string>()
  const [baseUrl, setBaseUrl] = useState<string>()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const apiKey = values[KEYS.openaiApiKey]
  const modelValue = model ?? savedModel
  const baseUrlValue = baseUrl ?? savedBaseUrl

  const saveAll = async () => {
    try {
      await save()
      await store.setMeta(KEYS.aiModel, modelValue.trim())
      await store.setMeta(KEYS.aiBaseUrl, baseUrlValue.trim())
      toast('AI settings saved')
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const loadModels = async () => {
    setLoading(true)
    try {
      const found = await listOpenAiModels(
        platformFetch,
        apiKey.trim(),
        baseUrlValue.trim() || undefined,
      )
      setModels(found)
      toast(
        found.length > 0
          ? `${found.length} models available. Choose one in the Model field.`
          : 'The key works, but no usable models were listed.',
      )
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <SectionTitle>AI (OpenAI)</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Optional. With your own OpenAI API key, PartsBin can read labels that barcodes and
          on-device text recognition cannot, and answer questions such as "do I have a regulator
          for 5 V to 3.3 V?". A label photo is sent to OpenAI only when you use "Read with AI" (or
          for unclear labels, if you turn on the automatic option below); your parts list is sent
          only when you use "Ask AI". {SECRET_HINT}
        </p>
        <SecretInput
          label="OpenAI API key"
          value={apiKey}
          onChange={(v) => set(KEYS.openaiApiKey, v)}
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label="Model"
              hint="Use a model that accepts images. Load the list to see what your key offers."
            >
              <Input
                list="openai-models"
                value={modelValue}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model name"
              />
              <datalist id="openai-models">
                {models.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </Field>
          </div>
        </div>
        <Button small busy={loading} disabled={!apiKey.trim()} onClick={loadModels}>
          Load model list
        </Button>
        <details>
          <summary className="cursor-pointer text-sm text-muted">Advanced</summary>
          <div className="mt-2">
            <Field
              label="API address"
              hint="Leave empty for OpenAI. Any service with the same chat completions API works."
            >
              <Input
                type="url"
                value={baseUrlValue}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </Field>
          </div>
        </details>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-accent"
            checked={auto}
            onChange={(e) => void setAuto(e.target.checked)}
          />
          <span>Read a label with AI automatically when the part number is unclear</span>
        </label>
        <Button variant="primary" onClick={saveAll}>
          Save AI settings
        </Button>
      </Card>
    </>
  )
}
