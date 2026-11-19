import type { Store } from '../db/store'
import { syncOnce, type SyncReport } from '../sync/engine'
import { migrate, type MigrationProgress, type MigrationReport } from '../sync/migrate'
import { OAuthError } from '../sync/oauth'
import { CLOUD_SERVICES, openProvider, type ProviderId } from './cloud'

export interface SyncState {
  /** The service this device syncs with, or null for local-only. */
  provider: ProviderId | null
  status: 'off' | 'idle' | 'syncing' | 'error'
  /** What is happening, or what went wrong. */
  message?: string
  /** True when signing in again is needed. */
  needsSignIn?: boolean
  lastSyncAt?: number
  lastReport?: SyncReport
}

const ACTIVE_KEY = 'cloud.active'

/**
 * Owns the connection between the local database and the cloud folder:
 * which service is active, when to sync, and the state shown in the UI.
 */
export class SyncController {
  private state: SyncState = { provider: null, status: 'off' }
  private readonly listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** True while a migration copies files: nothing may be written meanwhile. */
  private paused = false
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Load the saved configuration and start syncing automatically. */
  async start(): Promise<void> {
    const provider = (await this.store.getMeta<ProviderId>(ACTIVE_KEY)) ?? null
    this.setState({
      provider,
      status: provider ? 'idle' : 'off',
      lastSyncAt: await this.store.getMeta<number>('sync.lastSyncAt'),
    })
    this.store.onLocalChange(() => this.schedule(4000))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.schedule(500)
    })
    window.addEventListener('online', () => this.schedule(500))
    setInterval(() => this.schedule(0), 5 * 60_000)
    this.schedule(1000)
  }

  /** Sync soon; repeated calls collapse into one. */
  schedule(delayMs: number) {
    if (!this.state.provider) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, delayMs)
  }

  /** Sync now. If a sync is already running, run once more after it. */
  syncNow(): Promise<void> {
    if (this.paused) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.run().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        this.schedule(0)
      }
    })
    return this.running
  }

  private async run(): Promise<void> {
    const id = this.state.provider
    if (!id) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState({ status: 'idle', message: 'Offline. Changes are saved on this device.' })
      return
    }
    this.setState({ status: 'syncing', message: 'Syncing', needsSignIn: false })
    try {
      const provider = await openProvider(this.store, id)
      if (!provider) {
        throw new OAuthError(
          `Not signed in to ${CLOUD_SERVICES[id].name}. Connect again in Settings.`,
          true,
        )
      }
      const report = await syncOnce(this.store, provider, {
        onProgress: (message) => this.setState({ message }),
      })
      this.setState({
        status: 'idle',
        message: undefined,
        lastSyncAt: Date.now(),
        lastReport: report,
      })
    } catch (e) {
      this.setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        needsSignIn: e instanceof OAuthError && e.needsSignIn,
      })
    }
  }

  /**
   * Start syncing with a (connected) service, or stop syncing with null.
   * Local data is kept either way.
   */
  async use(provider: ProviderId | null): Promise<void> {
    if (this.running) await this.running
    await this.store.setMeta(ACTIVE_KEY, provider)
    if (provider && provider !== this.state.provider) {
      // The new folder may be missing changes this device already uploaded
      // elsewhere, so the next sync uploads the full state.
      await this.store.setMeta('sync.needsFullPush', true)
    }
    this.setState({
      provider,
      status: provider ? 'idle' : 'off',
      message: undefined,
      needsSignIn: false,
    })
    if (provider) await this.syncNow()
  }

  /**
   * Copy the library from the active service to another connected one,
   * verify the copy, then switch to it. The old copy is left in place.
   */
  async migrateTo(
    target: ProviderId,
    onProgress: (progress: MigrationProgress) => void,
  ): Promise<MigrationReport> {
    const sourceId = this.state.provider
    if (!sourceId) throw new Error('This device is not syncing with any storage yet.')
    if (sourceId === target) throw new Error('That is already the current storage.')
    if (this.running) await this.running

    // Make sure the old storage has everything from this device first.
    await this.syncNow()
    if (this.state.status === 'error') {
      throw new Error(`Could not sync with the current storage first: ${this.state.message}`)
    }
    // A sync during the copy would upload changes to the old storage that
    // the new one never receives, so syncing waits until the switch is made.
    this.paused = true
    let report: MigrationReport
    try {
      // A sync that started in the meantime finishes before the copy begins.
      if (this.running) await this.running
      const source = await openProvider(this.store, sourceId)
      const destination = await openProvider(this.store, target)
      if (!source || !destination) {
        throw new Error('Both storage services must be connected first.')
      }
      this.setState({ status: 'syncing', message: 'Moving to the new storage' })
      report = await migrate(source, destination, onProgress)
      // The copy is verified and identical, so no full upload is needed.
      await this.store.setMeta(ACTIVE_KEY, target)
      this.setState({ provider: target, status: 'idle', message: undefined })
    } catch (e) {
      this.setState({ status: 'idle', message: undefined })
      throw e
    } finally {
      this.paused = false
    }
    await this.syncNow()
    return report
  }
}
