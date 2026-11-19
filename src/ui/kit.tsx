import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

// ---- Icons -----------------------------------------------------------------

const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5V8zm0 0 9 5 9-5m-9 5v8',
  plus: 'M12 5v14M5 12h14',
  camera:
    'M4 8h3l2-3h6l2 3h3v11H4V8zm8 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm7.4 3a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9c.7.6 1.400 1 2.200 1.300l.4 2.400h4l.4-2.400a7.600 7.600 0 0 0 2.200-1.300l2.300.9 2-3.400-2-1.500c.1-.4.1-.9.1-1.300z',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zm10-13 4 4',
  folder: 'M3 6h6l2 2h10v11H3V6z',
  sync: 'M4 12a8 8 0 0 1 14-5.300M20 4v4h-4m4 4a8 8 0 0 1-14 5.300M4 20v-4h4',
  qr: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.500l4.500 4.500L19 7',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1m2 3.700a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  move: 'M5 12h14m-5-5 5 5-5 5',
  project: 'M5 4h14v16H5V4zm3 4h8M8 12h8M8 16h5',
  cloud: 'M7 18a4 4 0 0 1-.500-8 5.500 5.500 0 0 1 10.600-1.500A4.500 4.500 0 0 1 17 18H7z',
  sparkle: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3zm7 12 .800 2.200L22 18l-2.200.800L19 21l-.800-2.200L16 18l2.200-.800L19 15z',
  print: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7v-6z',
  upload: 'M12 16V5m-4 4 4-4 4 4M5 19h14',
  download: 'M12 5v11m-4-4 4 4 4-4M5 19h14',
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx('size-5 shrink-0', className)}
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

// ---- Buttons ---------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: IconName
  busy?: boolean
  small?: boolean
}

export function Button({
  variant = 'secondary',
  icon,
  busy,
  small,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const styles = {
    primary: 'bg-accent text-on-accent hover:opacity-90',
    secondary: 'bg-raised text-ink hover:bg-line',
    ghost: 'text-accent hover:bg-raised',
    danger: 'text-danger hover:bg-raised',
  }[variant]
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'disabled:cursor-not-allowed disabled:opacity-50',
        small ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4',
        styles,
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

export function Spinner() {
  return (
    <span
      role="status"
      aria-label="Working"
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

// ---- Form fields -----------------------------------------------------------

const fieldClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink ' +
  'placeholder:text-muted focus:border-accent focus:outline-none'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-sm text-muted">{hint}</span> : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      {...props}
      className={cx(fieldClass, props.className)}
    />
  )
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(fieldClass, props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldClass, props.className)} />
}

// ---- Layout pieces ---------------------------------------------------------

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('rounded-xl border border-line bg-surface', className)}>
      {children}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
      {children}
    </h2>
  )
}

export function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'ok' | 'error' | 'info'
  children: ReactNode
}) {
  const styles = {
    warn: 'bg-warn-soft text-warn',
    ok: 'bg-ok-soft text-ok',
    error: 'bg-warn-soft text-danger',
    info: 'bg-raised text-ink',
  }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg px-3 py-2 text-sm', styles)}>
      {children}
    </div>
  )
}

export function Chip({
  children,
  onClick,
  tone = 'plain',
}: {
  children: ReactNode
  onClick?: () => void
  tone?: 'plain' | 'accent' | 'warn' | 'ok' | 'danger'
}) {
  const styles = {
    plain: 'bg-raised text-ink',
    accent: 'bg-accent-soft text-accent',
    warn: 'bg-warn-soft text-warn',
    ok: 'bg-ok-soft text-ok',
    danger: 'bg-warn-soft text-danger',
  }[tone]
  const className = cx(
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-sm',
    styles,
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(className, 'min-h-8 hover:opacity-80')}>
      {children}
    </button>
  ) : (
    <span className={className}>{children}</span>
  )
}

export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  )
}

/** Page header with an optional back button and actions. */
export function PageHeader({
  title,
  onBack,
  actions,
}: {
  title: ReactNode
  onBack?: () => void
  actions?: ReactNode
}) {
  return (
    <header className="no-print sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="-ml-1 flex size-10 items-center justify-center rounded-lg text-accent hover:bg-raised"
        >
          <Icon name="back" />
        </button>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
      {actions}
    </header>
  )
}

/** Modal dialog: a bottom sheet on phones, a centered panel on desktop. */
export function Sheet({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex-1 truncate text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-raised"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  )
}

// ---- Toasts ----------------------------------------------------------------

interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(
  () => {},
)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, text, tone }])
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      tone === 'error' ? 7000 : 3000,
    )
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-lg',
              toast.tone === 'error'
                ? 'bg-danger text-white'
                : 'bg-ink text-bg',
            )}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Show a brief message at the bottom of the screen. */
export const useToast = () => useContext(ToastContext)

/** "1 bag", "3 bags". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** The message of anything thrown. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export { cx }
