import type { Fetch } from '../sync/oauth'
import { toBase64 } from '../util/crypto'

export interface AiRequest {
  /** Instructions and input. Must ask for JSON. */
  prompt: string
  imageJpeg?: Uint8Array
}

/**
 * The one thing PartsBin needs from a language model: answer a prompt
 * (optionally about a photo) with a JSON object. Other model providers can
 * be added by implementing this interface.
 */
export interface AiClient {
  completeJson(request: AiRequest): Promise<unknown>
}

export interface OpenAiSettings {
  apiKey: string
  model: string
  /** Defaults to OpenAI; any OpenAI-compatible endpoint works. */
  baseUrl?: string
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

async function openAiError(response: Response): Promise<Error> {
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // No JSON body.
  }
  if (response.status === 401) {
    return new Error('OpenAI did not accept the API key. Check it in Settings.')
  }
  if (response.status === 429) {
    return new Error(`OpenAI rate or spending limit reached. ${detail}`.trim())
  }
  return new Error(`OpenAI request failed (HTTP ${response.status}). ${detail}`.trim())
}

/** OpenAI Chat Completions with image input and JSON output. */
export class OpenAiClient implements AiClient {
  private readonly fetch: Fetch
  private readonly settings: OpenAiSettings

  constructor(fetch: Fetch, settings: OpenAiSettings) {
    this.fetch = fetch
    this.settings = settings
  }

  async completeJson({ prompt, imageJpeg }: AiRequest): Promise<unknown> {
    const content: unknown[] = [{ type: 'text', text: prompt }]
    if (imageJpeg) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${toBase64(imageJpeg)}` },
      })
    }
    const base = (this.settings.baseUrl || OPENAI_BASE_URL).replace(/\/+$/, '')
    const response = await this.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) throw await openAiError(response)
    const body = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[]
    }
    const text = body.choices?.[0]?.message?.content
    if (!text) throw new Error('OpenAI returned an empty answer.')
    return parseJsonAnswer(text)
  }
}

/** Parse a model answer, tolerating a Markdown code fence around the JSON. */
export function parseJsonAnswer(text: string): unknown {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(unfenced)
  } catch {
    throw new Error('The AI answer could not be understood. Try again.')
  }
}

/** Model IDs available to this API key, for the settings screen. */
export async function listOpenAiModels(
  fetch: Fetch,
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  const base = (baseUrl || OPENAI_BASE_URL).replace(/\/+$/, '')
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) throw await openAiError(response)
  const body = (await response.json()) as { data?: { id: string }[] }
  return (body.data ?? [])
    .map((m) => m.id)
    // Leave out models that cannot answer a chat prompt about an image.
    .filter(
      (id) =>
        !/embedding|whisper|tts|dall-e|moderation|audio|realtime|transcribe|image|sora|babbage|davinci/i.test(
          id,
        ),
    )
    .sort()
}
