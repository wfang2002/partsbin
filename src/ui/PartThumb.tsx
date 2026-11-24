import { Icon, cx } from './kit'
import { Photo } from './Photo'

/** The small photo at the left of a part row. */
export function PartThumb({
  hash,
  alt,
  className,
}: {
  hash: string | undefined
  alt: string
  className?: string
}) {
  return (
    <span className={cx('relative shrink-0 overflow-hidden rounded-lg bg-raised', className ?? 'size-14')}>
      {hash ? (
        <Photo hash={hash} alt={alt} fit="contain" className="absolute inset-0 size-full" />
      ) : (
        <span className="flex size-full items-center justify-center text-muted">
          <Icon name="box" className="size-6" />
        </span>
      )}
    </span>
  )
}
