import { describe, expect, it } from 'vitest'
import { BOX_REDIRECT_URI, boxRedirectUris } from './oauthFlow'

describe('Box redirect addresses', () => {
  it('sends https://app.box.com on iPhone and desktop', () => {
    for (const kind of ['ios', 'desktop'] as const) {
      const uris = boxRedirectUris(kind)
      expect(uris.register).toBe(BOX_REDIRECT_URI)
      expect(uris.send).toBe('https://app.box.com')
    }
  })
})
