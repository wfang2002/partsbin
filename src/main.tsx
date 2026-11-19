import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './app/context'
import { SyncController } from './app/syncController'
import { Store } from './db/store'
import './index.css'

const root = createRoot(document.getElementById('root')!)

async function boot() {
  const store = await Store.open()
  const sync = new SyncController(store)
  await sync.start()
  root.render(
    <StrictMode>
      <AppProvider store={store} sync={sync}>
        <App />
      </AppProvider>
    </StrictMode>,
  )
}

boot().catch((e) => {
  root.render(
    <div role="alert" style={{ padding: 24 }}>
      <h1>PartsBin could not open its database</h1>
      <p>{e instanceof Error ? e.message : String(e)}</p>
    </div>,
  )
})
