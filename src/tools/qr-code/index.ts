import { defineAsyncComponent } from 'vue'
import { registerTool } from '../registry'

registerTool({
  id: 'qr-code',
  name: '二维码',
  description: '生成二维码并识别本地图片中的二维码内容',
  icon: 'i-carbon-qr-code',
  category: '图像处理',
  keywords: ['二维码', 'qr', 'qrcode', '扫码', '识别', '生成'],
  component: defineAsyncComponent(() => import('./QrCodeTool.vue')),
})