import { describe, expect, it } from 'vitest'

import basePromptWritingGuide from './minimax-h3-docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md?raw'
import referencePromptWritingGuide from './minimax-h3-docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md?raw'
import {
  DEFAULT_PROMPT_OPTIMIZER_SYSTEM_PROMPT,
  MINIMAX_H3_OFFICIAL_DOCUMENTS,
} from './prompt-optimizer-system-prompt'

describe('MiniMax-H3 optimizer system prompt', () => {
  it('contains both upstream prompt guides verbatim and in directory order', () => {
    expect(MINIMAX_H3_OFFICIAL_DOCUMENTS).toBe(
      [basePromptWritingGuide, referencePromptWritingGuide].join('\n\n'),
    )
    expect(DEFAULT_PROMPT_OPTIMIZER_SYSTEM_PROMPT).toContain(MINIMAX_H3_OFFICIAL_DOCUMENTS)
    expect(DEFAULT_PROMPT_OPTIMIZER_SYSTEM_PROMPT.indexOf(basePromptWritingGuide)).toBeLessThan(
      DEFAULT_PROMPT_OPTIMIZER_SYSTEM_PROMPT.indexOf(referencePromptWritingGuide),
    )
  })

  it('keeps the application JSON contract after the official documents', () => {
    const documentsEnd = DEFAULT_PROMPT_OPTIMIZER_SYSTEM_PROMPT.indexOf(
      '===== END UNMODIFIED MINIMAX-H3 OFFICIAL PROMPT GUIDES =====',
    )
    const outputContract = DEFAULT_PROMPT_OPTIMIZER_SYSTEM_PROMPT.indexOf(
      '{"englishPrompt":"complete English prompt"}',
    )

    expect(documentsEnd).toBeGreaterThan(-1)
    expect(outputContract).toBeGreaterThan(documentsEnd)
  })
})
