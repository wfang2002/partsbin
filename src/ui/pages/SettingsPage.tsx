import { useApp } from '../../app/context'
import { platformKind } from '../../platform/env'
import { Card, PageHeader, SectionTitle, count } from '../kit'
import { BackupSection, OrderImportSection } from './settings/DataSection'
import { AiSection, LookupSection } from './settings/KeysSection'
import { SyncSection } from './settings/SyncSection'

const PLATFORM_NAME = {
  desktop: 'Desktop app',
  ios: 'iPhone app',
  browser: 'Browser preview',
} as const

export function SettingsPage() {
  const { inv, store } = useApp()
  return (
    <>
      <PageHeader title="Settings" />
      <div className="p-3 pb-10">
        <SyncSection />
        <BackupSection />
        <LookupSection />
        <AiSection />
        <OrderImportSection />
        <SectionTitle>About</SectionTitle>
        <Card className="space-y-1 p-4 text-sm text-muted">
          <p>
            {count(inv.parts.length, 'part')}, {count(inv.stock.length, 'bag')},{' '}
            {count(inv.locations.length, 'place')}, {count(inv.projects.length, 'project')}
          </p>
          <p>{PLATFORM_NAME[platformKind]}</p>
          <p>Device ID {store.deviceId}</p>
        </Card>
      </div>
    </>
  )
}
