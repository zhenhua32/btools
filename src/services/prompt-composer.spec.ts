import { describe, expect, it } from 'vitest'
import {
  composePrompt,
  createRandomSelection,
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

