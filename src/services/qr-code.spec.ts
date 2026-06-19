/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { generateQrCodeDataUrl } from './qr-code'

describe('generateQrCodeDataUrl', () => {
  it('returns a png data url', async () => {
    const dataUrl = await generateQrCodeDataUrl('https://example.com', {
      size: 256,
      margin: 2,
      darkColor: '#111827',
      lightColor: '#ffffff',
      errorCorrectionLevel: 'M',
    })

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
})