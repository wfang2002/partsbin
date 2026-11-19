/*
 * The OpenAI client is tested against a canned response in the documented
 * Chat Completions shape. It has not been run against the live API here
 * (that needs an API key).
 */
import { describe, expect, it } from 'vitest'
import { buildInventory } from '../domain/inventory'
import type { Part } from '../domain/types'
import type { Fetch } from '../sync/oauth'
import { askInventory } from './ask'
import { OpenAiClient, listOpenAiModels, parseJsonAnswer, type AiClient } from './client'
import { labelFromAiAnswer, readLabelWithAi } from './label'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('OpenAiClient', () => {
  it('sends the prompt and photo and parses the JSON answer', async () => {
    let seen: { url: string; init?: RequestInit } | undefined
    const fetch: Fetch = async (url, init) => {
      seen = { url, init }
      return json({ choices: [{ message: { content: '{"mpn":"NE555P"}' } }] })
    }
    const client = new OpenAiClient(fetch, { apiKey: 'sk-test', model: 'some-model' })
    const answer = await client.completeJson({
      prompt: 'Reply in JSON',
      imageJpeg: new Uint8Array([255, 216, 255]),
    })
    expect(answer).toEqual({ mpn: 'NE555P' })
    expect(seen?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(new Headers(seen?.init?.headers as HeadersInit).get('Authorization')).toBe(
      'Bearer sk-test',
    )
    const body = JSON.parse(seen?.init?.body as string)
    expect(body.model).toBe('some-model')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Reply in JSON' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } },
    ])
  })

  it('uses a custom base URL and explains failures', async () => {
    const urls: string[] = []
    const fetch: Fetch = async (url) => {
      urls.push(url)
      return json({ error: { message: 'Incorrect API key provided' } }, 401)
    }
    const client = new OpenAiClient(fetch, {
      apiKey: 'bad',
      model: 'm',
      baseUrl: 'http://localhost:11434/v1/',
    })
    await expect(client.completeJson({ prompt: 'x' })).rejects.toThrow(/API key/)
    expect(urls).toEqual(['http://localhost:11434/v1/chat/completions'])
  })

  it('lists chat models only', async () => {
    const fetch: Fetch = async () =>
      json({ data: [{ id: 'text-embedding-3-small' }, { id: 'gpt-b' }, { id: 'gpt-a' }, { id: 'whisper-1' }] })
    expect(await listOpenAiModels(fetch, 'k')).toEqual(['gpt-a', 'gpt-b'])
  })

  it('accepts JSON wrapped in a code fence', () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => parseJsonAnswer('sorry, no')).toThrow(/could not be understood/)
  })
})

describe('label reading', () => {
  it('maps the answer onto a parsed label', () => {
    const label = labelFromAiAnswer({
      mpn: ' AMS1117-3.3 ',
      manufacturer: null,
      description: 'IC REG LINEAR 3.3V 1A SOT-223',
      category: 'Voltage regulator',
      quantity: '20',
      specs: { 'Output voltage': '3.3V', Current: 1, Empty: null },
      other_part_numbers: ['AMS1117-3.3', 'LOT1234'],
    })
    expect(label).toEqual({
      source: 'ai',
      mpn: 'AMS1117-3.3',
      manufacturer: undefined,
      description: 'IC REG LINEAR 3.3V 1A SOT-223',
      category: 'Voltage regulator',
      qty: 20,
      specs: { 'Output voltage': '3.3V', Current: '1' },
      mpnCandidates: ['LOT1234'],
      confidence: 'high',
    })
  })

  it('survives an unexpected answer', () => {
    expect(labelFromAiAnswer('nonsense')).toMatchObject({ source: 'ai', confidence: 'low' })
    expect(labelFromAiAnswer({ specs: [1, 2], quantity: -3 })).toMatchObject({
      specs: {},
      confidence: 'low',
    })
  })

  it('passes the OCR text along with the photo', async () => {
    let prompt = ''
    const ai: AiClient = {
      async completeJson(request) {
        prompt = request.prompt
        return { mpn: 'X1234' }
      },
    }
    const label = await readLabelWithAi(ai, new Uint8Array([1]), 'QTY 10 X1234')
    expect(label.mpn).toBe('X1234')
    expect(prompt).toContain('QTY 10 X1234')
  })
})

describe('askInventory', () => {
  const parts: Part[] = [
    { id: 'ldo', mpn: 'AMS1117-3.3', description: 'LDO 3.3V 1A', specs: { Vout: '3.3V' }, tags: [] },
    { id: 'timer', mpn: 'NE555P', description: 'Timer', specs: {}, tags: [] },
  ]
  const inv = buildInventory(
    [{ id: 'box', parentId: null, name: 'Box 7', kind: 'box' }],
    parts,
    [{ id: 's', partId: 'ldo', locationId: 'box', qty: 12, lastSeenAt: 0 }],
    [],
  )

  it('sends the inventory and maps line numbers back to parts', async () => {
    let prompt = ''
    const ai: AiClient = {
      async completeJson(request) {
        prompt = request.prompt
        return {
          answer: 'Yes, the AMS1117-3.3.',
          matches: [
            { n: 1, why: 'LDO with 3.3 V output at 1 A' },
            { n: 1, why: 'duplicate' },
            { n: 99, why: 'made up' },
            { n: 'x' },
          ],
        }
      },
    }
    const result = await askInventory(ai, inv, parts, '5V to 3.3V regulator?')
    expect(prompt).toContain('#1 | AMS1117-3.3 |')
    expect(prompt).toContain('Box 7 (12)')
    expect(prompt).toContain('#2 | NE555P |')
    expect(prompt).toContain('no stock recorded')
    expect(result).toEqual({
      answer: 'Yes, the AMS1117-3.3.',
      matches: [{ partId: 'ldo', why: 'LDO with 3.3 V output at 1 A' }],
      truncated: false,
    })
  })

  it('copes with an answer that has no matches', async () => {
    const ai: AiClient = { completeJson: async () => ({ answer: 'Nothing fits.' }) }
    expect(await askInventory(ai, inv, parts, 'a relay?')).toEqual({
      answer: 'Nothing fits.',
      matches: [],
      truncated: false,
    })
  })
})
