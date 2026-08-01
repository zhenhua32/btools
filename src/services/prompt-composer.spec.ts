import { describe, expect, it } from 'vitest'
import {
  composePrompt,
  countAllPromptTerms,
  createRandomSelection,
  DEFAULT_PROMPT_CATEGORIES,
  filterPromptCategories,
  flattenPromptCategories,
  getPromptLeafCategories,
  type PromptCategory,
} from './prompt-composer'

const categories: PromptCategory[] = [
  {
    id: 'subject',
    nameZh: '主体',
    nameEn: 'Subject',
    icon: '',
    terms: [],
    children: [
      {
        id: 'age',
        nameZh: '年龄',
        nameEn: 'Age',
        icon: '',
        terms: [
          { id: 'age-25', zh: '25岁', en: '25 years old' },
          { id: 'age-30', zh: '30岁', en: '30 years old' },
        ],
      },
      {
        id: 'profession',
        nameZh: '职业',
        nameEn: 'Profession',
        icon: '',
        terms: [
          { id: 'director', zh: '导演', en: 'director' },
          { id: 'artist', zh: '艺术家', en: 'artist' },
        ],
      },
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
  it('ships more than one thousand unique bilingual atomic terms in a category tree', () => {
    const allCategories = flattenPromptCategories(DEFAULT_PROMPT_CATEGORIES)
    const terms = allCategories.flatMap((category) => category.terms)
    const uniqueIds = new Set(terms.map((item) => item.id))

    expect(DEFAULT_PROMPT_CATEGORIES.length).toBeGreaterThanOrEqual(10)
    expect(DEFAULT_PROMPT_CATEGORIES.every((category) => category.children?.length)).toBe(true)
    expect(terms).toHaveLength(1326)
    expect(getPromptLeafCategories(DEFAULT_PROMPT_CATEGORIES)).toHaveLength(55)
    expect(uniqueIds.size).toBe(terms.length)
    expect(terms.every((item) => item.zh.trim() && item.en.trim())).toBe(true)
    expect(allCategories.some((category) => category.id === 'subject-adult')).toBe(false)
    expect(terms.some((item) => item.zh === '25岁')).toBe(true)
    expect(terms.some((item) => item.zh === '成年')).toBe(false)
    expect(terms.some((item) => item.zh === '女性')).toBe(true)
    expect(terms.some((item) => item.zh === '独立电影')).toBe(true)
    expect(terms.some((item) => item.zh === '导演')).toBe(true)
    expect(terms.some((item) => item.zh === '美丽')).toBe(true)
    expect(terms.some((item) => item.zh === '精致五官')).toBe(true)
    expect(terms.some((item) => item.zh === '裸妆')).toBe(true)
    expect(terms.some((item) => item.zh === '优雅体态')).toBe(true)
    expect(terms.some((item) => item.zh === '泡泡袖衬衫')).toBe(true)
    expect(terms.some((item) => item.zh === '茶歇裙')).toBe(true)
    expect(terms.some((item) => item.zh === '收腰西装')).toBe(true)
    expect(terms.some((item) => item.zh === '鸡尾酒礼服')).toBe(true)
    expect(terms.some((item) => item.zh === '方领')).toBe(true)
    expect(terms.some((item) => item.zh === '泡泡袖')).toBe(true)
    expect(terms.some((item) => item.zh === '珍珠纽扣')).toBe(true)
  })

  it('searches terms and category names across nested directories', () => {
    expect(filterPromptCategories(categories, '艺术家')[0].terms[0].id).toBe('artist')
    expect(filterPromptCategories(categories, 'misty')[0].category.id).toBe('scene')
    expect(filterPromptCategories(categories, 'Subject')).toHaveLength(2)
    expect(filterPromptCategories(categories, '', 'subject')).toHaveLength(2)
    expect(countAllPromptTerms(categories)).toBe(5)
  })

  it('selects one atomic term from every enabled leaf category', () => {
    const selection = createRandomSelection(
      categories,
      ['profession', 'age', 'scene'],
      () => 0.99,
    )

    expect(getPromptLeafCategories(categories).map((item) => item.id)).toEqual([
      'age',
      'profession',
      'scene',
    ])
    expect(selection.map((item) => item.term.id)).toEqual([
      'age-30',
      'artist',
      'forest',
    ])
  })

  it('composes Chinese, English, and bilingual prompts', () => {
    const selection = createRandomSelection(categories, ['age', 'profession', 'scene'], () => 0)

    expect(composePrompt(selection, 'zh')).toBe('25岁，导演，雾中森林。')
    expect(composePrompt(selection, 'en')).toBe('25 years old, director, a misty forest.')
    expect(composePrompt(selection, 'bilingual')).toContain('中文：25岁，导演，雾中森林。')
    expect(composePrompt(selection, 'bilingual')).toContain(
      'English: 25 years old, director, a misty forest.',
    )
  })
})
