import { describe, expect, it } from 'vitest'
import {
  composePrompt,
  createRandomSelection,
  DEFAULT_PROMPT_CATEGORIES,
  filterPromptCategories,
  type PromptCategory,
} from './prompt-composer'

const categories: PromptCategory[] = [
  {
    id: 'subject',
    nameZh: '主体',
    nameEn: 'Subject',
    icon: '',
    terms: [
      { id: 'adult', zh: '成年摄影师', en: 'an adult photographer' },
      { id: 'artist', zh: '成年艺术家', en: 'an adult artist' },
    ],
  },
  {
    id: 'scene',
    nameZh: '场景',
    nameEn: 'Scene',
    icon: '',
    terms: [{ id: 'forest', zh: '雾中森林', en: 'a misty forest' }],
  },
]

describe('prompt composer', () => {
  it('ships more than one thousand unique bilingual prompt groups', () => {
    const terms = DEFAULT_PROMPT_CATEGORIES.flatMap((category) => category.terms)
    const uniqueIds = new Set(terms.map((item) => item.id))

    expect(DEFAULT_PROMPT_CATEGORIES.length).toBeGreaterThanOrEqual(10)
    expect(terms.length).toBeGreaterThanOrEqual(1000)
    expect(uniqueIds.size).toBe(terms.length)
    expect(terms.every((item) => item.zh.trim() && item.en.trim())).toBe(true)
  })

  it('searches Chinese and English terms and category names', () => {
    expect(filterPromptCategories(categories, '艺术家')[0].terms[0].id).toBe('artist')
    expect(filterPromptCategories(categories, 'misty')[0].category.id).toBe('scene')
    expect(filterPromptCategories(categories, 'Subject')[0].terms).toHaveLength(2)
  })

  it('selects one term from every enabled category in category order', () => {
    const selection = createRandomSelection(categories, ['scene', 'subject'], () => 0.99)

    expect(selection.map((item) => item.term.id)).toEqual(['artist', 'forest'])
  })

  it('composes Chinese, English, and bilingual prompts', () => {
    const selection = createRandomSelection(categories, ['subject', 'scene'], () => 0)

    expect(composePrompt(selection, 'zh')).toBe('成年摄影师，雾中森林。')
    expect(composePrompt(selection, 'en')).toBe('an adult photographer, a misty forest.')
    expect(composePrompt(selection, 'bilingual')).toContain('中文：成年摄影师，雾中森林。')
    expect(composePrompt(selection, 'bilingual')).toContain(
      'English: an adult photographer, a misty forest.',
    )
  })
})
