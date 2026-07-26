import { ATOMIC_PROMPT_CATEGORIES } from './prompt-library'

export type PromptLanguage = 'bilingual' | 'zh' | 'en'

export interface PromptTerm {
  id: string
  zh: string
  en: string
}

export interface PromptCategory {
  id: string
  nameZh: string
  nameEn: string
  icon: string
  terms: PromptTerm[]
  children?: PromptCategory[]
  custom?: boolean
}

export interface SelectedPrompt {
  categoryId: string
  categoryNameZh: string
  categoryNameEn: string
  term: PromptTerm
}

export interface PromptCategoryGroup {
  category: PromptCategory
  terms: PromptTerm[]
  pathZh: string
  pathEn: string
}

export const DEFAULT_PROMPT_CATEGORIES: PromptCategory[] = ATOMIC_PROMPT_CATEGORIES

export function clonePromptCategories(
  categories: PromptCategory[] = DEFAULT_PROMPT_CATEGORIES,
): PromptCategory[] {
  return categories.map((category) => ({
    ...category,
    terms: category.terms.map((item) => ({ ...item })),
    children: category.children
      ? clonePromptCategories(category.children)
      : undefined,
  }))
}

export function countPromptTerms(category: PromptCategory): number {
  return (
    category.terms.length +
    (category.children ?? []).reduce(
      (total, child) => total + countPromptTerms(child),
      0,
    )
  )
}

export function countAllPromptTerms(categories: PromptCategory[]): number {
  return categories.reduce(
    (total, category) => total + countPromptTerms(category),
    0,
  )
}

export function flattenPromptCategories(
  categories: PromptCategory[],
): PromptCategory[] {
  return categories.flatMap((category) => [
    category,
    ...flattenPromptCategories(category.children ?? []),
  ])
}

export function findPromptCategory(
  categories: PromptCategory[],
  categoryId: string,
): PromptCategory | undefined {
  for (const category of categories) {
    if (category.id === categoryId) return category
    const child = findPromptCategory(category.children ?? [], categoryId)
    if (child) return child
  }
  return undefined
}

export function getPromptLeafCategories(
  categories: PromptCategory[],
): PromptCategory[] {
  return flattenPromptCategories(categories).filter(
    (category) => category.terms.length > 0,
  )
}

export function filterPromptCategories(
  categories: PromptCategory[],
  query: string,
  activeCategoryId = 'all',
): PromptCategoryGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const selectedRoots =
    activeCategoryId === 'all'
      ? categories
      : [findPromptCategory(categories, activeCategoryId)].filter(
          (category): category is PromptCategory => Boolean(category),
        )
  const groups: PromptCategoryGroup[] = []

  function visit(
    category: PromptCategory,
    pathZh: string[],
    pathEn: string[],
    ancestorMatches: boolean,
  ) {
    const nextPathZh = [...pathZh, category.nameZh]
    const nextPathEn = [...pathEn, category.nameEn]
    const categoryMatches =
      ancestorMatches ||
      category.nameZh.toLocaleLowerCase().includes(normalizedQuery) ||
      category.nameEn.toLocaleLowerCase().includes(normalizedQuery)
    const terms =
      !normalizedQuery || categoryMatches
        ? category.terms
        : category.terms.filter(
            (item) =>
              item.zh.toLocaleLowerCase().includes(normalizedQuery) ||
              item.en.toLocaleLowerCase().includes(normalizedQuery),
          )

    if (terms.length > 0) {
      groups.push({
        category,
        terms,
        pathZh: nextPathZh.join(' / '),
        pathEn: nextPathEn.join(' / '),
      })
    }

    for (const child of category.children ?? []) {
      visit(child, nextPathZh, nextPathEn, categoryMatches)
    }
  }

  for (const category of selectedRoots) {
    visit(category, [], [], false)
  }

  return groups
}

export function createRandomSelection(
  categories: PromptCategory[],
  enabledCategoryIds: string[],
  random: () => number = Math.random,
): SelectedPrompt[] {
  const enabledIds = new Set(enabledCategoryIds)

  return getPromptLeafCategories(categories)
    .filter(
      (category) =>
        enabledIds.has(category.id) && category.terms.length > 0,
    )
    .map((category) => {
      const index = Math.min(
        category.terms.length - 1,
        Math.floor(Math.max(0, random()) * category.terms.length),
      )

      return {
        categoryId: category.id,
        categoryNameZh: category.nameZh,
        categoryNameEn: category.nameEn,
        term: { ...category.terms[index] },
      }
    })
}

export function composePrompt(
  selection: SelectedPrompt[],
  language: PromptLanguage,
): string {
  if (selection.length === 0) return ''

  const chinese = `${selection.map((item) => item.term.zh).join('，')}。`
  const english = `${selection.map((item) => item.term.en).join(', ')}.`

  if (language === 'zh') return chinese
  if (language === 'en') return english
  return `中文：${chinese}\nEnglish: ${english}`
}
