import type { FileCompressionResult } from './file-compression-types'
import type { FileOperationContext, ProcessedFile } from './file-stream-types'

const DIRECTORY = 'btools-file-outputs'
const MEMORY_LIMIT = 64 * 1024 ** 2
const STALE_AGE = 24 * 60 * 60 * 1000
const RELEASE_DELAY = 60 * 1000
const activeOperations = new Map<string, number>()

interface SyncWriter {
  write(bytes: Uint8Array, options?: { at: number }): number
  flush(): void
  close(): void
}
interface AsyncWriter {
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
interface OutputFileHandle {
  getFile(): Promise<File>
  createSyncAccessHandle?: () => Promise<SyncWriter>
  createWritable?: () => Promise<AsyncWriter>
}
interface OutputDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OutputDirectory>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OutputFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, { kind: string }]>
}

export interface OutputSink {
  readonly size: number
  write(bytes: Uint8Array): Promise<void>
  finish(): Promise<ProcessedFile>
  abort(): Promise<void>
}

function operationName(operationId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) throw new Error('文件任务标识无效')
  return `op-${operationId}`
}

async function rootDirectory(): Promise<OutputDirectory | undefined> {
  const storage = globalThis.navigator?.storage as unknown as { getDirectory?: () => Promise<OutputDirectory> } | undefined
  if (!storage?.getDirectory) return undefined
  const root = await storage.getDirectory()
  return root.getDirectoryHandle(DIRECTORY, { create: true })
}

async function removeFile(storageKey: string): Promise<void> {
  const [operation, file, extra] = storageKey.split('/')
  if (extra !== undefined || !/^op-[a-zA-Z0-9_-]{1,100}$/.test(operation) || !/^out-[a-zA-Z0-9_-]+$/.test(file)) return
  const root = await rootDirectory()
  if (!root) return
  try {
    const directory = await root.getDirectoryHandle(operation)
    await directory.removeEntry(file)
    // Non-recursive removal succeeds only after the last output is released.
    await root.removeEntry(operation).catch(() => undefined)
  } catch { /* Releasing an already removed result is harmless. */ }
}

async function cleanExpiredOperations(root: OutputDirectory): Promise<void> {
  try {
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory' || !/^op-[a-zA-Z0-9_-]{1,100}$/.test(name) || activeOperations.has(name)) continue
      const directory = await root.getDirectoryHandle(name)
      let newest = 0
      for await (const [filename, entry] of directory.entries()) {
        if (entry.kind === 'file' && /^out-[a-zA-Z0-9_-]+$/.test(filename)) {
          newest = Math.max(newest, (await (await directory.getFileHandle(filename)).getFile()).lastModified)
        }
      }
      if (newest > 0 && Date.now() - newest > STALE_AGE) await root.removeEntry(name, { recursive: true })
    }
  } catch { /* A cleanup failure must not prevent a new compression task. */ }
}

/** Results remain disk backed until released by the UI or expired after a day. */
export async function createOutputSink(context: FileOperationContext, name: string, type: string): Promise<OutputSink> {
  const operation = operationName(context.operationId)
  let root: OutputDirectory | undefined
  try { root = await rootDirectory() } catch { /* Small-file fallback also works in browsers without OPFS permission. */ }
  if (!root) return createMemorySink(name, type)
  await cleanExpiredOperations(root)
  const directory = await root.getDirectoryHandle(operation, { create: true })
  const filename = `out-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  const file = await directory.getFileHandle(filename, { create: true })
  const storageKey = `${operation}/${filename}`
  let sync: SyncWriter | undefined
  let writable: AsyncWriter | undefined
  try {
    if (file.createSyncAccessHandle) sync = await file.createSyncAccessHandle()
    else if (file.createWritable) writable = await file.createWritable()
    else {
      await directory.removeEntry(filename)
      return createMemorySink(name, type)
    }
  } catch (error) {
    await directory.removeEntry(filename).catch(() => undefined)
    throw error
  }
  activeOperations.set(operation, (activeOperations.get(operation) ?? 0) + 1)
  let size = 0
  let finished = false
  const closeActive = () => {
    const remaining = (activeOperations.get(operation) ?? 1) - 1
    if (remaining) activeOperations.set(operation, remaining)
    else activeOperations.delete(operation)
  }
  return {
    get size() { return size },
    async write(bytes) {
      if (finished) throw new Error('文件输出已关闭')
      if (sync) {
        let offset = 0
        while (offset < bytes.length) {
          const written = sync.write(bytes.subarray(offset), { at: size + offset })
          if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) throw new Error('临时文件写入失败，可能磁盘空间不足')
          offset += written
        }
      } else await writable!.write(bytes)
      size += bytes.length
    },
    async finish() {
      if (finished) throw new Error('文件输出已关闭')
      try {
        if (sync) { sync.flush(); sync.close(); sync = undefined }
        else { await writable!.close(); writable = undefined }
        const blob = await file.getFile()
        if (blob.size !== size) throw new Error('临时文件大小校验失败')
        finished = true
        closeActive()
        return { name, type, blob, storageKey }
      } catch (error) {
        throw error instanceof Error ? error : new Error('临时文件写入失败')
      }
    },
    async abort() {
      if (!finished) {
        try { if (sync) sync.close(); else await writable?.abort() } catch { /* Continue removing partial data. */ }
        finished = true
        closeActive()
      }
      await removeFile(storageKey)
    },
  }
}

function createMemorySink(name: string, type: string): OutputSink {
  let chunks: Uint8Array[] = []
  let size = 0
  let closed = false
  return {
    get size() { return size },
    async write(bytes) {
      if (closed) throw new Error('文件输出已关闭')
      if (size + bytes.length > MEMORY_LIMIT) throw new Error('此浏览器未提供本地临时文件存储，最多处理 64 MiB 输出；请使用支持 OPFS 的浏览器处理大文件')
      chunks.push(bytes.slice())
      size += bytes.length
    },
    async finish() {
      if (closed) throw new Error('文件输出已关闭')
      closed = true
      const blob = new Blob(chunks, { type })
      chunks = []
      return { name, type, blob }
    },
    async abort() { closed = true; chunks = [] },
  }
}

/** Explicit cancellation cleanup. Call after terminating the operation's worker. */
export async function cleanupOperationStorage(operationId: string): Promise<void> {
  const name = operationName(operationId)
  const root = await rootDirectory().catch(() => undefined)
  if (!root) return
  activeOperations.delete(name)
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await root.removeEntry(name, { recursive: true }); return }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt ? 200 : 50))
    }
  }
}

/** Allow an in-progress browser download to consume its File snapshot before deleting storage. */
export function releaseProcessedResult(result: FileCompressionResult | null | undefined): void {
  const keys = new Set([...(result?.outputs ?? []), ...(result?.textOutput ? [result.textOutput] : [])]
    .map((file) => file.storageKey).filter((key): key is string => !!key))
  for (const key of keys) setTimeout(() => { void removeFile(key).catch(() => undefined) }, RELEASE_DELAY)
}
