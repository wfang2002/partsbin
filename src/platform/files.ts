import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { toBase64 } from '../util/crypto'
import { platformKind } from './env'

/** Let the user keep a generated file. Returns false if they cancelled. */
export async function saveFile(
  name: string,
  data: Uint8Array,
  mime: string,
): Promise<boolean> {
  if (platformKind === 'desktop') {
    const path = await save({ defaultPath: name })
    if (!path) return false
    await writeFile(path, data)
    return true
  }
  if (platformKind === 'ios') {
    const { uri } = await Filesystem.writeFile({
      path: name,
      data: toBase64(data),
      directory: Directory.Cache,
    })
    await Share.share({ title: name, files: [uri] })
    return true
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

/** Ask the user to choose a file. Resolves with null if they cancel. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    const done = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    input.click()
  })
}
