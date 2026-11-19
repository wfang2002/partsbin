import { Browser } from '@capacitor/browser'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platformKind } from './env'

/** Open a web page (a datasheet, a setup console) outside the app. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Only web links can be opened.')
  }
  if (platformKind === 'desktop') await openUrl(url)
  else if (platformKind === 'ios') await Browser.open({ url })
  else window.open(url, '_blank', 'noopener')
}
