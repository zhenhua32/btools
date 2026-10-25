import wasmUrl from '../../third_party/brotli/brotli-file-encoder.wasm?url'
import { MAX_ARCHIVE_BYTES } from './file-compression-types'
import { FILE_CHUNK_BYTES } from './file-stream-types'

/** One independent linear-memory heap per compression worker/session. */
export interface FileBrotliEncoder {
  compress(bytes: Uint8Array): Uint8Array<ArrayBuffer>
}

interface EncoderExports {
  memory: WebAssembly.Memory
  bt_abi_version(): number
  bt_alloc(length: number): number
  bt_free(pointer: number, length: number): void
  bt_compress(pointer: number, length: number, quality: number): number
  bt_result_free(pointer: number): void
}

let compiledModule: Promise<WebAssembly.Module> | undefined

/** Exported separately so tests can execute the exact bundled binary without HTTP. */
export async function createFileBrotliEncoder(input: BufferSource | WebAssembly.Module): Promise<FileBrotliEncoder> {
  const module = input instanceof WebAssembly.Module ? input : await WebAssembly.compile(input)
  if (WebAssembly.Module.imports(module).length) throw new Error('Brotli 文件编码器包含不受支持的外部依赖')
  const instance = await WebAssembly.instantiate(module, {})
  const exports = instance.exports
  if (!(exports.memory instanceof WebAssembly.Memory) ||
    !['bt_abi_version', 'bt_alloc', 'bt_free', 'bt_compress', 'bt_result_free'].every((name) => typeof exports[name] === 'function')) {
    throw new Error('Brotli 文件编码器接口无效')
  }
  const api = exports as unknown as EncoderExports
  if (api.bt_abi_version() !== 1) throw new Error('Brotli 文件编码器版本不受支持')
  return {
    compress(bytes) {
      if (bytes.byteLength > FILE_CHUNK_BYTES) throw new Error('Brotli 文件分块不能超过 4 MiB')
      const inputPointer = api.bt_alloc(bytes.byteLength) >>> 0
      if (!inputPointer) throw new Error('Brotli 文件编码器内存分配失败')
      let resultPointer = 0
      try {
        // Calls may grow memory, so never retain typed views across an exported call.
        new Uint8Array(api.memory.buffer, inputPointer, bytes.byteLength).set(bytes)
        resultPointer = api.bt_compress(inputPointer, bytes.byteLength, 11) >>> 0
        if (!resultPointer || resultPointer + 16 > api.memory.buffer.byteLength) throw new Error('Brotli 文件编码器返回的数据无效')
        const descriptor = new DataView(api.memory.buffer, resultPointer, 16)
        const outputPointer = descriptor.getUint32(0, true)
        const outputLength = descriptor.getUint32(4, true)
        const status = descriptor.getUint32(8, true)
        if (status !== 0) throw new Error(`Brotli 文件压缩失败（${status}）`)
        if (!outputLength || outputLength > MAX_ARCHIVE_BYTES || outputPointer + outputLength > api.memory.buffer.byteLength) {
          throw new Error('Brotli 文件编码器返回的数据无效')
        }
        // The result must outlive bt_result_free and have its own transferable buffer.
        return new Uint8Array(api.memory.buffer, outputPointer, outputLength).slice()
      } finally {
        try { if (resultPointer) api.bt_result_free(resultPointer) }
        finally { api.bt_free(inputPointer, bytes.byteLength) }
      }
    },
  }
}

export async function loadFileBrotliEncoder(): Promise<FileBrotliEncoder> {
  compiledModule ??= (async () => {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error('Brotli 文件编码器加载失败')
    return WebAssembly.compile(await response.arrayBuffer())
  })()
  // Cache immutable compiled code only. The owning FileChunkCodec releases its
  // instance when disposed; terminating a worker releases its entire WASM heap.
  const pending = compiledModule
  try { return await createFileBrotliEncoder(await pending) }
  catch (error) {
    if (compiledModule === pending) compiledModule = undefined
    throw error
  }
}
