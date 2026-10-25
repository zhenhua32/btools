import type { CompressionChunkRequest, CompressionChunkResult } from './file-compression-chunk'
import { checkCompressionAbort, compressionAbortError } from './file-compression-pool'

/** Completed records stop replenishment at this threshold; already running jobs may still finish. */
export const COMPLETED_RECORD_BACKPRESSURE_BYTES = 64 * 1024 ** 2

interface OrderedChunkOptions {
  count: number
  concurrency: number
  signal?: AbortSignal
  read: (index: number) => Promise<CompressionChunkRequest>
  run: (request: CompressionChunkRequest) => Promise<CompressionChunkResult>
  terminate: (error?: Error) => void
}
type Outcome = { result: CompressionChunkResult } | { error: Error }

/**
 * Keep idle slots working while a preceding block is slow. The hard bound is 2C
 * unwritten records, including the one source read in flight and the record being
 * consumed. At most C reads/jobs are active, with only one source read in flight.
 *
 * The 64 MiB limit is backpressure, not a hard allocation ceiling. Together with
 * the pool's per-record size validation, queued result bytes are bounded by the
 * smaller of 2C * maxRecordBytes and 64 MiB + C * maxRecordBytes, independently of
 * the original file's size. The consumer must finish writing each yielded record
 * before requesting the next one; that is when its window capacity is released.
 */
export async function* orderedCompressionChunks(options: OrderedChunkOptions): AsyncGenerator<CompressionChunkResult> {
  const { count, concurrency, signal, read, run, terminate } = options
  checkCompressionAbort(signal)
  const pending = new Map<number, Promise<Outcome>>()
  const waiters = new Set<() => void>()
  const window = Math.max(1, concurrency * 2)
  let nextRead = 0
  let written = 0
  let running = 0
  let completedBytes = 0
  let stopped = false
  let failure: Error | undefined
  let pumping = false
  let producer = Promise.resolve()
  const notify = () => { for (const resolve of waiters) resolve(); waiters.clear() }
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error('文件分块处理失败')
    stopped = true
    terminate(failure)
    notify()
  }
  const onAbort = () => fail(compressionAbortError())
  signal?.addEventListener('abort', onAbort, { once: true })
  const check = () => { checkCompressionAbort(signal); if (failure) throw failure }
  const settled = (outcome: Outcome): Outcome => {
    running--
    if ('error' in outcome) fail(outcome.error)
    else if (!stopped) completedBytes += outcome.result.bytes.byteLength
    notify()
    void fill()
    return outcome
  }
  function fill(): Promise<void> {
    if (pumping || stopped) return producer
    pumping = true
    producer = (async () => {
      try {
        while (!stopped && nextRead < count && running < concurrency && nextRead - written < window &&
          completedBytes < COMPLETED_RECORD_BACKPRESSURE_BYTES) {
          check()
          const index = nextRead++
          running++
          let dispatched = false
          try {
            const request = await read(index)
            check()
            if (stopped) return
            // Both branches handle rejection immediately, including out-of-order
            // failures. No rejected task waits unobserved behind the first block.
            const task = run(request).then(
              (result): Outcome => ({ result }),
              (error): Outcome => ({ error: error instanceof Error ? error : new Error('文件分块处理失败') }),
            ).then(settled)
            pending.set(index, task)
            dispatched = true
            notify()
          } finally {
            if (!dispatched) running--
          }
        }
      } catch (error) { fail(error) }
      finally { pumping = false; notify() }
    })()
    return producer
  }
  try {
    void fill()
    for (let index = 0; index < count; index++) {
      while (!pending.has(index)) {
        check()
        await new Promise<void>((resolve) => waiters.add(resolve))
      }
      const outcome = await pending.get(index)!
      check()
      if ('error' in outcome) throw outcome.error
      yield outcome.result
      check()
      pending.delete(index)
      written = index + 1
      completedBytes -= outcome.result.bytes.byteLength
      void fill()
    }
  } finally {
    stopped = true
    signal?.removeEventListener('abort', onAbort)
    terminate(failure)
    notify()
    // Await the only possible source read before returning to the coordinator's
    // storage cleanup/cancel acknowledgement. It must never dispatch after exit.
    await producer
    pending.clear()
    waiters.clear()
  }
}
