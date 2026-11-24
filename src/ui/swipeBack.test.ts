import { describe, expect, it } from 'vitest'
import { isSwipeBack } from './swipeBack'

const edge = {
  startX: 10,
  originX: 0,
  dx: 90,
  dy: 8,
  canGoBack: true,
  blocked: false,
}

describe('isSwipeBack', () => {
  it('accepts a rightward swipe from the left edge', () => {
    expect(isSwipeBack(edge)).toBe(true)
  })

  it('ignores a swipe that starts away from the left edge', () => {
    expect(isSwipeBack({ ...edge, startX: 80 })).toBe(false)
  })

  it('ignores a vertical drag', () => {
    expect(isSwipeBack({ ...edge, dx: 40, dy: 90 })).toBe(false)
  })

  it('ignores the gesture when there is no previous page or a sheet is open', () => {
    expect(isSwipeBack({ ...edge, canGoBack: false })).toBe(false)
    expect(isSwipeBack({ ...edge, blocked: true })).toBe(false)
  })
})
