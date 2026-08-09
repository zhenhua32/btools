import { describe, expect, it } from 'vitest'

import promptWritingSkill from './minimax-h3-skills/h3-prompt-writing/SKILL.md?raw'
import minimalistProductAdSkill from './minimax-h3-skills/minimalist-product-ad-generator/SKILL.cn.md?raw'
import basePromptWritingGuide from './minimax-h3-docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md?raw'
import referencePromptWritingGuide from './minimax-h3-docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md?raw'
import { DEFAULT_AI_SETTINGS } from './ai-types'
import { buildPromptOptimizationMessages } from './prompt-optimizer'
import {
  buildPromptOptimizerSystemInstruction,
  normalizePromptOptimizerSkillSelection,
} from './prompt-optimizer-skills'

describe('MiniMax-H3 prompt optimizer skills', () => {
  it('preserves the configured system prompt when no skill is enabled', () => {
    expect(
      buildPromptOptimizerSystemInstruction({
        configuredSystemPrompt: 'custom optimizer system prompt',
        mode: 'T2VA',
      }),
    ).toBe('custom optimizer system prompt')
  })

  it('uses only the mode-specific guide when the base writing skill is enabled', () => {
    const baseModeInstruction = buildPromptOptimizerSystemInstruction({
      configuredSystemPrompt: 'must not be included',
      mode: 'FL2VA',
      skillSelection: {
        useBasePromptWritingSkill: true,
        styleSkillId: null,
      },
    })
    const referenceModeInstruction = buildPromptOptimizerSystemInstruction({
      configuredSystemPrompt: 'must not be included',
      mode: 'Ref2VA',
      skillSelection: {
        useBasePromptWritingSkill: true,
        styleSkillId: null,
      },
    })

    expect(baseModeInstruction).toContain(promptWritingSkill)
    expect(baseModeInstruction).toContain(basePromptWritingGuide)
    expect(baseModeInstruction).not.toContain(referencePromptWritingGuide)
    expect(baseModeInstruction).not.toContain('must not be included')

    expect(referenceModeInstruction).toContain(promptWritingSkill)
    expect(referenceModeInstruction).toContain(referencePromptWritingGuide)
    expect(referenceModeInstruction).not.toContain(basePromptWritingGuide)
    expect(referenceModeInstruction).not.toContain('must not be included')
  })

  it('combines one style skill with either prompt source and keeps the host contract last', () => {
    const configuredInstruction = buildPromptOptimizerSystemInstruction({
      configuredSystemPrompt: 'custom optimizer system prompt',
      mode: 'I2VA',
      skillSelection: {
        useBasePromptWritingSkill: false,
        styleSkillId: 'minimalist-product-ad-generator',
      },
    })
    const baseSkillInstruction = buildPromptOptimizerSystemInstruction({
      configuredSystemPrompt: 'must not be included',
      mode: 'I2VA',
      skillSelection: {
        useBasePromptWritingSkill: true,
        styleSkillId: 'minimalist-product-ad-generator',
      },
    })

    expect(configuredInstruction).toContain('custom optimizer system prompt')
    expect(configuredInstruction).toContain(minimalistProductAdSkill)
    expect(configuredInstruction.indexOf(minimalistProductAdSkill)).toBeLessThan(
      configuredInstruction.indexOf('{"englishPrompt":"complete English prompt"}'),
    )

    expect(baseSkillInstruction).toContain(promptWritingSkill)
    expect(baseSkillInstruction).toContain(basePromptWritingGuide)
    expect(baseSkillInstruction).toContain(minimalistProductAdSkill)
    expect(baseSkillInstruction).not.toContain('must not be included')
  })

  it('normalizes unknown persisted style values to no style skill', () => {
    expect(
      normalizePromptOptimizerSkillSelection({
        useBasePromptWritingSkill: true,
        styleSkillId: 'unknown-skill' as never,
      }),
    ).toEqual({
      useBasePromptWritingSkill: true,
      styleSkillId: null,
    })
  })

  it('wires the selected skills into the optimizer system message', () => {
    const messages = buildPromptOptimizationMessages('一款耳机的极简产品广告', {
      settings: DEFAULT_AI_SETTINGS,
      mode: 'T2VA',
      durationSeconds: 10,
      skillSelection: {
        useBasePromptWritingSkill: true,
        styleSkillId: 'minimalist-product-ad-generator',
      },
    })
    const systemContent = messages[0].content

    expect(typeof systemContent).toBe('string')
    if (typeof systemContent !== 'string') throw new Error('expected string system content')
    expect(systemContent).toContain(promptWritingSkill)
    expect(systemContent).toContain(minimalistProductAdSkill)
    expect(systemContent).not.toBe(DEFAULT_AI_SETTINGS.promptOptimizerSystemPrompt)
  })
})
