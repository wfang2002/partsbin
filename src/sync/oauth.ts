import { randomHex, sha256Hex, toBase64Url, utf8 } from '../util/crypto'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** The OAuth endpoints of one cloud storage service. */
export interface OAuthService {
  authUrl: string
  tokenUrl: string
  scopes: string[]
  /** Extra query parameters for the sign-in page. */
  extraAuthParams?: Record<string, string>
}

/** The app registration the user created with the service. */
export interface OAuthCredentials {
  clientId: string
  /** Needed by Box, and by Google for "Desktop app" clients. */
  clientSecret?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Milliseconds since the epoch. */
  expiresAt: number
}

export interface AuthRequest {
  url: string
  state: string
  verifier: string
  redirectUri: string
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Build the sign-in URL for the authorization-code flow with PKCE. */
export async function createAuthRequest(
  service: OAuthService,
  credentials: OAuthCredentials,
  redirectUri: string,
): Promise<AuthRequest> {
  const verifier = toBase64Url(hexToBytes(randomHex(32)))
  const challenge = toBase64Url(
    hexToBytes(await sha256Hex(utf8.encode(verifier))),
  )
  const state = randomHex(16)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...service.extraAuthParams,
  })
  if (service.scopes.length > 0) params.set('scope', service.scopes.join(' '))
  return { url: `${service.authUrl}?${params}`, state, verifier, redirectUri }
}

async function tokenRequest(
  fetch: Fetch,
  service: OAuthService,
  credentials: OAuthCredentials,
  params: Record<string, string>,
  previousRefreshToken?: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({ ...params, client_id: credentials.clientId })
  if (credentials.clientSecret) body.set('client_secret', credentials.clientSecret)
  const response = await fetch(service.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text)
  } catch {
    // Fall through to the error below.
  }
  if (!response.ok || typeof json.access_token !== 'string') {
    const detail = json.error_description ?? json.error ?? text.slice(0, 200)
    throw new OAuthError(
      `Sign-in was not accepted (${response.status}): ${String(detail)}`,
      response.status === 400 || response.status === 401,
    )
  }
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === 'string'
        ? json.refresh_token
        : previousRefreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }
}

export class OAuthError extends Error {
  /** True when signing in again is the only way forward. */
  readonly needsSignIn: boolean
  constructor(message: string, needsSignIn: boolean) {
    super(message)
    this.name = 'OAuthError'
    this.needsSignIn = needsSignIn
  }
}

/** Finish sign-in: check the redirect and trade the code for tokens. */
export function completeAuthRequest(
  fetch: Fetch,
  service: OAuthService,
  credentials: OAuthCredentials,
  request: AuthRequest,
  redirectParams: URLSearchParams,
): Promise<TokenSet> {
  const error = redirectParams.get('error')
  if (error) {
    const detail = redirectParams.get('error_description') ?? error
    return Promise.reject(new OAuthError(`Sign-in failed: ${detail}`, true))
  }
  const code = redirectParams.get('code')
  if (!code || redirectParams.get('state') !== request.state) {
    return Promise.reject(
      new OAuthError('Sign-in returned an unexpected response.', true),
    )
  }
  return tokenRequest(fetch, service, credentials, {
    grant_type: 'authorization_code',
    code,
    code_verifier: request.verifier,
    redirect_uri: request.redirectUri,
  })
}

/**
 * Hands out a valid access token, refreshing it when it is about to expire,
 * and saves refreshed tokens (some services replace the refresh token on
 * every use).
 */
export class TokenManager {
  private tokens: TokenSet
  private refreshing: Promise<TokenSet> | null = null
  private readonly fetch: Fetch
  private readonly service: OAuthService
  private readonly credentials: OAuthCredentials
  private readonly save: (tokens: TokenSet) => Promise<void>

  constructor(
    fetch: Fetch,
    service: OAuthService,
    credentials: OAuthCredentials,
    tokens: TokenSet,
    save: (tokens: TokenSet) => Promise<void>,
  ) {
    this.fetch = fetch
    this.service = service
    this.credentials = credentials
    this.tokens = tokens
    this.save = save
  }

  async accessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.tokens.expiresAt - Date.now() > 60_000) {
      return this.tokens.accessToken
    }
    if (!this.tokens.refreshToken) {
      throw new OAuthError('The sign-in has expired. Please connect again.', true)
    }
    // Share one refresh between concurrent requests.
    this.refreshing ??= tokenRequest(
      this.fetch,
      this.service,
      this.credentials,
      { grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken },
      this.tokens.refreshToken,
    ).finally(() => {
      this.refreshing = null
    })
    this.tokens = await this.refreshing
    await this.save(this.tokens)
    return this.tokens.accessToken
  }

  /** fetch() with the Authorization header, retried once after a 401. */
  authedFetch: Fetch = async (input, init) => {
    const send = async (token: string) =>
      this.fetch(input, {
        ...init,
        headers: { ...(init?.headers as object), Authorization: `Bearer ${token}` },
      })
    const response = await send(await this.accessToken())
    if (response.status !== 401) return response
    return send(await this.accessToken(true))
  }
}
