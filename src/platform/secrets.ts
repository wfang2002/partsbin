import { invoke } from '@tauri-apps/api/core'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { platformKind } from './env'

/**
 * API keys and sign-in tokens. They stay on this device and are never synced.
 * - desktop: operating system keychain
 * - ios: iOS Keychain
 * - browser: localStorage (development preview only, not secure)
 */
export interface SecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

const desktopSecrets: SecretStore = {
  async get(key) {
    return (await invoke<string | null>('secret_get', { key })) ?? undefined
  },
  set: (key, value) => invoke('secret_set', { key, value }),
  remove: (key) => invoke('secret_delete', { key }),
}

const iosSecrets: SecretStore = {
  async get(key) {
    try {
      return (await SecureStoragePlugin.get({ key })).value
    } catch {
      // The plugin rejects when the key does not exist.
      return undefined
    }
  },
  async set(key, value) {
    await SecureStoragePlugin.set({ key, value })
  },
  async remove(key) {
    try {
      await SecureStoragePlugin.remove({ key })
    } catch {
      // Already absent.
    }
  },
}

const PREFIX = 'partsbin.secret.'

const browserSecrets: SecretStore = {
  async get(key) {
    return localStorage.getItem(PREFIX + key) ?? undefined
  },
  async set(key, value) {
    localStorage.setItem(PREFIX + key, value)
  },
  async remove(key) {
    localStorage.removeItem(PREFIX + key)
  },
}

export const secrets: SecretStore =
  platformKind === 'desktop'
    ? desktopSecrets
    : platformKind === 'ios'
      ? iosSecrets
      : browserSecrets

export const secretsAreSecure = platformKind !== 'browser'
