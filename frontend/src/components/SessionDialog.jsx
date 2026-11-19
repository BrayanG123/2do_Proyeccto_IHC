import { useLayoutEffect, useRef } from 'react'

export default function SessionDialog({ className, labelledBy, describedBy, onClose, children }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const element = ref.current
    const trigger = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [])

  const closeFromBackdrop = event => {
    if (event.target !== event.currentTarget) return
    const { top, right, bottom, left } = event.currentTarget.getBoundingClientRect()
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
      onClose()
    }
  }

  return (
    <dialog
      ref={ref}
      className={`session-dialog ${className}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={closeFromBackdrop}
    >
      {children}
    </dialog>
  )
}
