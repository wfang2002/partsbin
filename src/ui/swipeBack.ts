const EDGE_PX = 32
const MIN_DX = 72

export function canSwipeBack(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}

/** A rightward swipe that started at the left edge and should go back a page. */
export function isSwipeBack(input: {
  startX: number
  originX: number
  dx: number
  dy: number
  canGoBack: boolean
  blocked: boolean
}): boolean {
  if (!input.canGoBack || input.blocked) return false
  if (input.startX - input.originX > EDGE_PX) return false
  return input.dx >= MIN_DX && input.dx > Math.abs(input.dy)
}
