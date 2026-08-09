import { beforeEach, describe, expect, it } from 'vitest'

import { extractPageContentFromDocument } from './page-translate-extractor'
import arxivFixtureHtml from './fixtures/page-translate-arxiv.html?raw'
import commentLikeFixtureHtml from './fixtures/page-translate-comment-like.html?raw'
import huggingFaceFixtureHtml from './fixtures/page-translate-hugging-face.html?raw'

function repeatSentence(sentence: string, count: number): string {
  return Array.from({ length: count }, () => sentence).join(' ')
}

describe('extractPageContentFromDocument', () => {
  beforeEach(() => {
    document.title = ''
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
  })

  it('extracts multiple text blocks from an arXiv-like article layout', () => {
    document.title = 'arXiv regression fixture'
    window.history.replaceState({}, '', '/html/2604.21910v1')
    const bibliography = repeatSentence(
      'Pegasus is a workflow management system for science automation and future generation platforms.',
      4,
    )

    document.body.innerHTML = arxivFixtureHtml

    const extracted = extractPageContentFromDocument(document)

    expect(extracted.rootElement.className).toContain('ltx_page_content')
    expect(extracted.blocks.length).toBeGreaterThan(8)
    expect(extracted.text).toContain('1 Introduction')
    expect(extracted.text).not.toContain('ltx_bib_article')
    expect(extracted.text).not.toContain(bibliography)
  })

  it('still excludes small comment-like regions inside the main content area', () => {
    document.body.innerHTML = commentLikeFixtureHtml

    const extracted = extractPageContentFromDocument(document)

    expect(extracted.text).toContain('Main Content')
    expect(extracted.text).toContain('Details')
    expect(extracted.text).not.toContain(
      'Readers can leave comments, reactions, and related discussion in this sidebar widget.',
    )
  })

  it('prefers the rendered Markdown prose over Hugging Face repository navigation', () => {
    document.title = 'docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md · MiniMaxAI/MiniMax-H3 at main'
    window.history.replaceState(
      {},
      '',
      '/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md',
    )
    document.body.innerHTML = huggingFaceFixtureHtml

    const extracted = extractPageContentFromDocument(document)

    expect(extracted.rootElement.classList).toContain('prose')
    expect(extracted.text).toContain('Video Prompt Writing Guide')
    expect(extracted.text).toContain('overall_soundscape')
    expect(extracted.text).not.toContain('Google Colab')
    expect(extracted.text).not.toContain('Kaggle')
  })
})
