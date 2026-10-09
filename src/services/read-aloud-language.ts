export type ReadAloudLanguage = 'zh' | 'en'

export interface ReadAloudLanguageRun {
  text: string
  language: ReadAloudLanguage
}

/**
 * Switch voices at sentence boundaries. Short English names inside a Chinese
 * sentence stay with that sentence to avoid interrupting its natural rhythm.
 * Keep every character, including whitespace, for the synthesis planner.
 */
export function splitReadAloudLanguageRuns(
  text: string,
  defaultLanguage: ReadAloudLanguage = 'zh',
): ReadAloudLanguageRun[] {
  if (!text) return []
  const sentences: Array<{ text: string; language: ReadAloudLanguage | null }> = []
  let start = 0

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    const chineseBoundary = /[。！？；\n]/u.test(character)
    if (!chineseBoundary && !/[.!?;]/u.test(character)) continue
    let end = index + 1
    while (end < text.length && /["'”’»」』）)\]}]/u.test(text[end]!)) end++
    if (!chineseBoundary && end < text.length && !/[\s\p{Script=Han}]/u.test(text[end]!)) continue
    while (end < text.length && /\s/u.test(text[end]!)) end++
    const sentence = text.slice(start, end)
    sentences.push({ text: sentence, language: detectSentenceLanguage(sentence) })
    start = end
    index = end - 1
  }

  if (start < text.length) {
    const sentence = text.slice(start)
    sentences.push({ text: sentence, language: detectSentenceLanguage(sentence) })
  }

  const runs: ReadAloudLanguageRun[] = []
  let precedingLanguage: ReadAloudLanguage | undefined
  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index]!
    const language = sentence.language ?? precedingLanguage ??
      sentences.slice(index + 1).find((item) => item.language !== null)?.language ?? defaultLanguage
    const previous = runs[runs.length - 1]
    if (previous?.language === language) previous.text += sentence.text
    else runs.push({ text: sentence.text, language })
    precedingLanguage = language
  }

  return runs
}

function detectSentenceLanguage(text: string): ReadAloudLanguage | null {
  if (/\p{Script=Han}/u.test(text)) return 'zh'
  if (/\p{Script=Latin}/u.test(text)) return 'en'
  return null
}
