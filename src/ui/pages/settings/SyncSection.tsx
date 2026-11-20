import { useCallback, useEffect, useState } from 'react'
import {
  CLOUD_SERVICES,
  PROVIDER_IDS,
  connect,
  disconnect,
  isConnected,
  loadCredentials,
  type ProviderId,
} from '../../../app/cloud'
import { useApp, useSyncState } from '../../../app/context'
import { platformKind } from '../../../platform/env'
import { oauthRedirectToRegister } from '../../../platform/oauthFlow'
import { openExternal } from '../../../platform/open'
import type { MigrationProgress, MigrationReport } from '../../../sync/migrate'
import {
  Banner,
  Button,
  Card,
  Chip,
  Field,
  Input,
  SectionTitle,
  Sheet,
  errorText,
  useToast,
} from '../../kit'

const canSignIn = platformKind !== 'browser'

interface SetupGuide {
  consoleName: string
  consoleUrl: string
  steps: string[]
  /** Whether the redirect address has to be registered with the service. */
  registerRedirect: boolean
}

const GUIDES: Record<ProviderId, SetupGuide> = {
  gdrive: {
    consoleName: 'Google Cloud Console',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    steps:
      platformKind === 'ios'
        ? [
            'Use the same Google Cloud project as for the desktop app, so both see the same files.',
            'Create credentials > OAuth client ID > iOS, with bundle ID com.wfang.partsbin.',
            'Paste the client ID below.',
          ]
        : [
            'Create a project and enable the Google Drive API.',
            'Set up the consent screen (External), then publish it ("In production"). While it is in "Testing", Google signs you out every 7 days.',
            'Create credentials > OAuth client ID > Desktop app.',
            'Paste the client ID and client secret below.',
          ],
    registerRedirect: false,
  },
  dropbox: {
    consoleName: 'Dropbox App Console',
    consoleUrl: 'https://www.dropbox.com/developers/apps',
    steps: [
      'Create app > Scoped access > App folder.',
      'On the Permissions tab enable files.metadata.read, files.content.read and files.content.write.',
      'On the Settings tab add the redirect address shown below, then paste the App key here.',
    ],
    registerRedirect: true,
  },
  box: {
    consoleName: 'Box Developer Console',
    consoleUrl: 'https://app.box.com/developers/console',
    steps: [
      'Create Platform App > Custom App > User Authentication (OAuth 2.0).',
      'Under Configuration, delete the redirect URIs already listed. Add the address shown below and save the page. Enable "Write all files and folders stored in Box".',
      'Paste the client ID and client secret below.',
    ],
    registerRedirect: true,
  },
}

function timeAgo(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function SyncSection() {
  const { sync } = useApp()
  const state = useSyncState()
  const toast = useToast()
  const [connected, setConnected] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [setup, setSetup] = useState<ProviderId>()
  const [moveTarget, setMoveTarget] = useState<ProviderId>()

  const refresh = useCallback(async () => {
    const entries = await Promise.all(
      PROVIDER_IDS.map(async (id) => [id, await isConnected(id)] as const),
    )
    setConnected(Object.fromEntries(entries))
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (e) {
      toast(errorText(e), 'error')
    }
    await refresh()
  }

  const active = state.provider ? CLOUD_SERVICES[state.provider] : undefined

  return (
    <>
      <SectionTitle>Storage and sync</SectionTitle>
      <Card className="space-y-3 p-4">
        {!active ? (
          <p>
            Your library is saved on this device only. Connect a storage service to back it up and
            use it on your other devices.
          </p>
        ) : (
          <>
            <p>
              Syncing with <strong>{active.name}</strong>
              <span className="text-muted"> ({active.folderHint})</span>
            </p>
            {state.status === 'error' ? (
              <Banner tone="error">{state.message}</Banner>
            ) : (
              <p className="text-sm text-muted">
                {state.status === 'syncing'
                  ? (state.message ?? 'Syncing')
                  : (state.message ??
                    (state.lastSyncAt ? `Last synced ${timeAgo(state.lastSyncAt)}.` : 'Not synced yet.'))}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                icon="sync"
                busy={state.status === 'syncing'}
                onClick={() => act(() => sync.syncNow())}
              >
                Sync now
              </Button>
              {state.needsSignIn && state.provider ? (
                <Button onClick={() => setSetup(state.provider!)}>Sign in again</Button>
              ) : null}
              <Button variant="ghost" onClick={() => act(() => sync.use(null))}>
                Stop syncing
              </Button>
            </div>
          </>
        )}
        {!canSignIn ? (
          <Banner tone="info">
            This is the browser preview. Signing in to a storage service works in the desktop and
            iPhone apps.
          </Banner>
        ) : null}

        <ul className="divide-y divide-line border-t border-line">
          {PROVIDER_IDS.map((id) => {
            const service = CLOUD_SERVICES[id]
            const isActive = state.provider === id
            return (
              <li key={id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1 font-medium">{service.name}</span>
                {isActive ? (
                  <Chip tone="ok">Syncing here</Chip>
                ) : connected[id] ? (
                  <Chip>Signed in</Chip>
                ) : null}
                {connected[id] && !isActive ? (
                  state.provider ? (
                    <Button small icon="move" onClick={() => setMoveTarget(id)}>
                      Move library here
                    </Button>
                  ) : (
                    <Button small variant="primary" onClick={() => act(() => sync.use(id))}>
                      Sync with this
                    </Button>
                  )
                ) : null}
                {connected[id] ? (
                  <Button
                    small
                    variant="ghost"
                    onClick={() =>
                      act(async () => {
                        if (isActive) await sync.use(null)
                        await disconnect(id)
                      })
                    }
                  >
                    Sign out
                  </Button>
                ) : (
                  <Button small disabled={!canSignIn} onClick={() => setSetup(id)}>
                    Connect
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      {setup ? (
        <ConnectSheet
          id={setup}
          onClose={() => setSetup(undefined)}
          onConnected={() =>
            act(async () => {
              const id = setup
              setSetup(undefined)
              toast(`Signed in to ${CLOUD_SERVICES[id].name}`)
              // The first service connected becomes the one to sync with.
              if (!sync.getState().provider) await sync.use(id)
              else if (sync.getState().provider === id) await sync.syncNow()
            })
          }
        />
      ) : null}
      {moveTarget && state.provider ? (
        <MoveSheet
          from={state.provider}
          to={moveTarget}
          onClose={() => {
            setMoveTarget(undefined)
            void refresh()
          }}
        />
      ) : null}
    </>
  )
}

function ConnectSheet({
  id,
  onClose,
  onConnected,
}: {
  id: ProviderId
  onClose: () => void
  onConnected: () => void
}) {
  const { store } = useApp()
  const toast = useToast()
  const service = CLOUD_SERVICES[id]
  const guide = GUIDES[id]
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  useEffect(() => {
    void loadCredentials(store, id).then((saved) => {
      setClientId((current) => current || saved.clientId)
      setClientSecret((current) => current || (saved.clientSecret ?? ''))
    })
  }, [store, id])

  let redirect = ''
  try {
    redirect = oauthRedirectToRegister(id)
  } catch {
    // Browser preview: there is no redirect address.
  }

  const signIn = async () => {
    setBusy(true)
    setProblem(undefined)
    try {
      await connect(store, id, { clientId, clientSecret })
      onConnected()
    } catch (e) {
      setProblem(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Connect ${service.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          PartsBin signs in with an app registration that belongs to you, so no one else is
          involved. This is a one-time setup:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Button
          small
          icon="link"
          onClick={() => openExternal(guide.consoleUrl).catch((e) => toast(errorText(e), 'error'))}
        >
          Open {guide.consoleName}
        </Button>
        {guide.registerRedirect && redirect ? (
          <Field
            label="Redirect address to register"
            hint={
              id === 'box'
                ? 'Save https://app.box.com as the OAuth 2.0 Redirect URI, then save the Configuration page.'
                : undefined
            }
          >
            <Input readOnly value={redirect} onFocus={(e) => e.target.select()} />
          </Field>
        ) : null}
        <Field label={service.clientIdLabel}>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </Field>
        {service.secret === 'required' ? (
          <Field label="Client secret" hint="Kept in this device's keychain. Never synced.">
            <Input
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </Field>
        ) : null}
        {problem ? <Banner tone="error">{problem}</Banner> : null}
        <div className="flex gap-2">
          <Button variant="primary" busy={busy} disabled={!clientId.trim()} onClick={signIn}>
            Sign in
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {busy ? (
          <p className="text-sm text-muted">
            Finish signing in in your browser. This window continues by itself.
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}

function MoveSheet({
  from,
  to,
  onClose,
}: {
  from: ProviderId
  to: ProviderId
  onClose: () => void
}) {
  const { sync } = useApp()
  const [progress, setProgress] = useState<MigrationProgress>()
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<MigrationReport>()
  const [problem, setProblem] = useState<string>()
  const source = CLOUD_SERVICES[from].name
  const target = CLOUD_SERVICES[to].name

  const start = async () => {
    setRunning(true)
    setProblem(undefined)
    try {
      setReport(await sync.migrateTo(to, setProgress))
    } catch (e) {
      setProblem(errorText(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Sheet title={`Move to ${target}`} onClose={running ? () => {} : onClose}>
      <div className="space-y-3">
        {report ? (
          <>
            <Banner tone="ok">
              Moved and checked {report.files} files ({Math.round(report.bytes / 1024)} KB). This
              device now syncs with {target}.
            </Banner>
            <p className="text-sm">
              The copy in {source} was left untouched. On your other devices, sign in to {target}{' '}
              and choose it there too. Once they all use {target}, you can delete the PartsBin
              folder in {source}.
            </p>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <p>
              This copies your whole library from {source} to {target}, checks every file after
              copying, and then syncs with {target} from now on. Nothing in {source} is changed or
              deleted.
            </p>
            {progress ? (
              <div>
                <p className="text-sm text-muted">
                  {progress.phase === 'copying' ? 'Copying' : 'Checking'} {progress.done} of{' '}
                  {progress.total} files
                </p>
                <progress
                  className="mt-1 h-2 w-full accent-accent"
                  value={progress.done}
                  max={Math.max(progress.total, 1)}
                />
              </div>
            ) : null}
            {problem ? (
              <Banner tone="error">
                {problem} Nothing was switched; you are still syncing with {source}. It is safe to
                try again.
              </Banner>
            ) : null}
            <div className="flex gap-2">
              <Button variant="primary" icon="move" busy={running} onClick={start}>
                {problem ? 'Try again' : 'Start'}
              </Button>
              <Button variant="ghost" disabled={running} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
