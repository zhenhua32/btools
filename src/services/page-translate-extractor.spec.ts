import { beforeEach, describe, expect, it } from 'vitest'

import { extractPageContentFromDocument } from './page-translate-extractor'

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

    const paragraph = repeatSentence(
      'Scientific workflow systems automate execution while preserving reproducibility across complex research pipelines.',
      12,
    )
    const bibliography = repeatSentence(
      'Pegasus is a workflow management system for science automation and future generation platforms.',
      4,
    )

    document.body.innerHTML = `
      <div class="ltx_page_content">
        <article class="ltx_document ltx_authors_1line">
          <h1 class="ltx_title ltx_title_document">From Research Question to Scientific Workflow</h1>
          <div class="ltx_abstract" id="abstract1">
            <h6 class="ltx_title ltx_title_abstract">Abstract</h6>
            <p class="ltx_p">${paragraph}</p>
          </div>
          <section>
            <h2 class="ltx_title ltx_title_section">1 Introduction</h2>
            <div class="ltx_para" id="S1.p1"><p class="ltx_p">${paragraph}</p></div>
            <div class="ltx_para" id="S1.p2"><p class="ltx_p">${paragraph}</p></div>
            <div class="ltx_para" id="S1.p3"><p class="ltx_p">${paragraph}</p></div>
          </section>
          <section>
            <h2 class="ltx_title ltx_title_section">2 Architecture</h2>
            <div class="ltx_para" id="S2.p1"><p class="ltx_p">${paragraph}</p></div>
            <div class="ltx_para" id="S2.p2"><p class="ltx_p">${paragraph}</p></div>
            <div class="ltx_para" id="S2.p3"><p class="ltx_p">${paragraph}</p></div>
          </section>
        </article>
      </div>
      <ol class="ltx_biblist">
        <li id="bib.bib2" class="ltx_bibitem ltx_bib_article">${bibliography}</li>
      </ol>
    `

    const extracted = extractPageContentFromDocument(document)

    expect(extracted.rootElement.className).toContain('ltx_page_content')
    expect(extracted.blocks.length).toBeGreaterThan(8)
    expect(extracted.text).toContain('1 Introduction')
    expect(extracted.text).not.toContain('ltx_bib_article')
    expect(extracted.text).not.toContain(bibliography)
  })

  it('still excludes small comment-like regions inside the main content area', () => {
    const paragraph = repeatSentence(
      'The main article body should be extracted for translation and keep its structural paragraphs intact.',
      6,
    )
    const comment = repeatSentence(
      'Readers can leave comments, reactions, and related discussion in this sidebar widget.',
      3,
    )

    document.body.innerHTML = `
      <main class="article-content">
        <h1>Main Content</h1>
        <p>${paragraph}</p>
        <section>
          <h2>Details</h2>
          <p>${paragraph}</p>
        </section>
        <aside class="related-comments">
          <p>${comment}</p>
        </aside>
      </main>
    `

    const extracted = extractPageContentFromDocument(document)

    expect(extracted.text).toContain('Main Content')
    expect(extracted.text).toContain('Details')
    expect(extracted.text).not.toContain(comment)
  })
})