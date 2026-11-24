import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { canSwipeBack, isSwipeBack } from './swipeBack'

/** Go back when the user swipes right from the left edge of this element. */
export function useSwipeBack<T extends HTMLElement>() {
  const navigate = useNavigate()
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let startX = 0
    let startY = 0
    let originX = 0
    let tracking = false
    let blocked = false
    let suppressClick = false

    const down = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
      const target = e.target
      blocked = target instanceof Element && Boolean(target.closest('[data-sheet]'))
      const rect = el.getBoundingClientRect()
      originX = rect.left
      startX = e.clientX
      startY = e.clientY
      tracking = !blocked && startX - originX <= 32 && canSwipeBack()
    }
    const move = (e: PointerEvent) => {
      if (!tracking || el.hasPointerCapture(e.pointerId)) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dx > 10 && dx > Math.abs(dy)) el.setPointerCapture(e.pointerId)
      else if (Math.abs(dy) > 10) tracking = false
    }
    const up = (e: PointerEvent) => {
      if (!tracking) return
      tracking = false
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!isSwipeBack({ startX, originX, dx, dy, canGoBack: canSwipeBack(), blocked })) return
      suppressClick = true
      navigate(-1)
    }
    const cancel = () => {
      tracking = false
    }
    const click = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('click', click, true)
    }
  }, [navigate])
  return ref
}
