import jsQR from 'jsqr'
import * as QRCode from 'qrcode'

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrGenerateOptions {
  size: number
  margin: number
  darkColor: string
  lightColor: string
  errorCorrectionLevel: QrErrorCorrectionLevel
}

export interface QrDecodeResult {
  text: string
  width: number
  height: number
}

export async function generateQrCodeDataUrl(
  content: string,
  options: QrGenerateOptions
): Promise<string> {
  return QRCode.toDataURL(content, {
    width: options.size,
    margin: options.margin,
    errorCorrectionLevel: options.errorCorrectionLevel,
    color: {
      dark: options.darkColor,
      light: options.lightColor,
    },
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

export async function decodeQrCodeFromDataUrl(imageUrl: string): Promise<QrDecodeResult> {
  const image = await loadImage(imageUrl)
  const { imageData, width, height } = getImageData(image)
  const decoded = jsQR(imageData.data, width, height, {
    inversionAttempts: 'attemptBoth',
  })

  if (!decoded) {
    throw new Error('未识别到二维码，请确认图片清晰、方向正常且只包含一个二维码')
  }

  return {
    text: decoded.data,
    width,
    height,
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解析失败'))
    image.src = src
  })
}

function getImageData(image: HTMLImageElement): {
  imageData: ImageData
  width: number
  height: number
} {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('当前浏览器不支持 Canvas 图像解析')
  }

  context.drawImage(image, 0, 0, width, height)

  return {
    imageData: context.getImageData(0, 0, width, height),
    width,
    height,
  }
}