import { Icon } from './kit'
import { Photo } from './Photo'

/** The small photo at the left of a part row. */
export function PartThumb({ hash, alt }: { hash: string | undefined; alt: string }) {
  return (
    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-raised">
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
