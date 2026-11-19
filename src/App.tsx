import { HashRouter, NavLink, Outlet, Route, Routes } from 'react-router'
import { useApp, useSyncState } from './app/context'
import { CameraDialog } from './ui/CameraDialog'
import { Icon, ToastProvider, cx, type IconName } from './ui/kit'
import { CapturePage } from './ui/pages/CapturePage'
import { LocationPage } from './ui/pages/LocationPage'
import { PartPage } from './ui/pages/PartPage'
import { ProjectPage, ProjectsPage } from './ui/pages/ProjectsPage'
import { SearchPage } from './ui/pages/SearchPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { StickersPage } from './ui/pages/StickersPage'

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Search', icon: 'search', end: true },
  { to: '/locations', label: 'Places', icon: 'box' },
  { to: '/add', label: 'Add', icon: 'plus' },
  { to: '/projects', label: 'Projects', icon: 'project' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<SearchPage />} />
            <Route path="part/:partId" element={<PartPage />} />
            <Route path="locations" element={<LocationPage />} />
            <Route path="locations/:locId" element={<LocationPage />} />
            <Route path="add" element={<CapturePage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="stickers" element={<StickersPage />} />
          </Route>
        </Routes>
      </HashRouter>
      <CameraDialog />
    </ToastProvider>
  )
}

function Shell() {
  const { loaded } = useApp()
  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] lg:flex-row lg:pt-0 print:block print:h-auto">
      <nav
        aria-label="Main"
        className="no-print order-last flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:order-first lg:w-52 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:p-3"
      >
        <div className="hidden px-3 pt-1 pb-4 text-lg font-semibold lg:block">PartsBin</div>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cx(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs',
                'lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-base',
                isActive ? 'font-medium text-accent lg:bg-accent-soft' : 'text-muted hover:text-ink',
              )
            }
          >
            <Icon name={tab.icon} />
            {tab.label}
          </NavLink>
        ))}
        <div className="hidden flex-1 lg:block" />
        <SyncBadge />
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        <div className="mx-auto max-w-3xl">{loaded ? <Outlet /> : null}</div>
      </main>
    </div>
  )
}

/** Sync status in the sidebar (desktop). Phones see it under Settings. */
function SyncBadge() {
  const sync = useSyncState()
  const text =
    sync.status === 'off'
      ? 'Saved on this device only'
      : sync.status === 'syncing'
        ? 'Syncing'
        : sync.status === 'error'
          ? 'Sync problem'
          : 'Synced'
  return (
    <NavLink
      to="/settings"
      className={cx(
        'hidden items-center gap-2 rounded-lg px-3 py-2 text-sm lg:flex',
        sync.status === 'error' ? 'text-danger' : 'text-muted',
      )}
    >
      <Icon name="cloud" className="size-4" />
      {text}
    </NavLink>
  )
}
