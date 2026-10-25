import { h } from 'vue'
import type { SelectOption } from 'naive-ui'
import type { CompressionAlgorithm } from '@/services/text-compression-types'
import type { FileCompressionAlgorithm } from '@/services/file-compression-types'

type Algorithm = CompressionAlgorithm | FileCompressionAlgorithm

export const ALGORITHM_GUIDANCE: Record<Algorithm, { summary: string; description: string }> = {
  brotli: { summary: '体积优先', description: '体积优先，压缩较慢，适合优先减小结果的场景。' },
  zstd: { summary: '均衡之选', description: '速度与体积兼顾，适合日常使用。' },
  lzma: { summary: '很慢，慎选', description: '当前实现压缩很慢，大文件慎选；结果不保证比其他算法更小。' },
  deflate: { summary: '速度优先', description: '速度优先，结果通常比 Brotli / Zstd 更大。' },
  gzip: { summary: '速度优先', description: '速度优先的常见压缩算法，结果通常比 Brotli / Zstd 更大。' },
  zip: { summary: '归档封装', description: '常见归档算法，有额外封装开销；这里仍输出 BTF2 纯文本。' },
  'lz-string': { summary: '短文本可试', description: '小段文本可试，结果体积未必最小。' },
}

/** Show the same short tradeoff in the menu and beside the selected algorithm. */
export function renderAlgorithmLabel(option: SelectOption) {
  const label = String(option.label ?? '')
  const guidance = ALGORITHM_GUIDANCE[option.value as Algorithm]
  if (!guidance) return label
  return h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: '8px', whiteSpace: 'nowrap' } }, [
    h('span', label),
    h('span', { style: { color: 'var(--text-secondary, #6b7280)', fontSize: '12px' } }, `· ${guidance.summary}`),
  ])
}
