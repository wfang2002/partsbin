import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Must match IOS_URL_SCHEME in src/platform/env.ts and the bundle ID
  // registered with Google for the iOS OAuth client.
  appId: 'com.wfang.partsbin',
  appName: 'PartsBin',
  webDir: 'dist',
  plugins: {
    // Route fetch() through native code so cloud and distributor APIs can be
    // called without browser cross-origin restrictions.
    CapacitorHttp: { enabled: true },
  },
}

export default config
