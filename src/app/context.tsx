import { useLiveQuery } from 'dexie-react-hooks'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Row } from '../db/merge'
import type { Store } from '../db/store'
import {
  EMPTY_INVENTORY,
  buildInventory,
  type Inventory,
} from '../domain/inventory'
import type { Location, Part, Project, Stock } from '../domain/types'
import { buildIndex } from '../search'
import type { SyncController, SyncState } from './syncController'

interface AppContextValue {
  store: Store
  sync: SyncController
  inv: Inventory
  index: ReturnType<typeof buildIndex>
  /** False until the first read of the database has finished. */
  loaded: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

const live = <T,>(rows: Row<T>[]): T[] => rows.filter((r) => !r.deleted)

export function AppProvider({
  store,
  sync,
  children,
}: {
  store: Store
  sync: SyncController
  children: ReactNode
}) {
  const rows = useLiveQuery(async () => {
    const [locations, parts, stock, projects] = await Promise.all([
      store.db.locations.toArray(),
      store.db.parts.toArray(),
      store.db.stock.toArray(),
      store.db.projects.toArray(),
    ])
    return { locations, parts, stock, projects }
  }, [store])

  const inv = useMemo(
    () =>
      rows
        ? buildInventory(
            live<Location>(rows.locations),
            live<Part>(rows.parts),
            live<Stock>(rows.stock),
            live<Project>(rows.projects),
          )
        : EMPTY_INVENTORY,
    [rows],
  )
  const index = useMemo(() => buildIndex(inv), [inv])
  const value = useMemo(
    () => ({ store, sync, inv, index, loaded: rows !== undefined }),
    [store, sync, inv, index, rows],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

export function useSyncState(): SyncState {
  const { sync } = useApp()
  return useSyncExternalStore(sync.subscribe, sync.getState)
}

/** An object URL for a stored photo, or undefined while it is not available. */
export function useBlobUrl(hash: string | undefined): string | undefined {
  const { store } = useApp()
  const data = useLiveQuery(
    async () => (hash ? ((await store.getBlob(hash)) ?? null) : null),
    [store, hash],
  )
  const [made, setMade] = useState<{ from: Uint8Array; url: string }>()
  useEffect(() => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' }))
    setMade({ from: data, url })
    return () => URL.revokeObjectURL(url)
  }, [data])
  // A URL made for earlier data has been revoked and must not be shown.
  return data && made?.from === data ? made.url : undefined
}

/** A device-local setting kept in the database, with a setter. */
export function useSetting<T>(
  key: string,
  fallback: T,
): [T, (value: T) => Promise<void>] {
  const { store } = useApp()
  const stored = useLiveQuery(() => store.getMeta<T>(key), [store, key])
  return [stored ?? fallback, (value) => store.setMeta(key, value)]
}
