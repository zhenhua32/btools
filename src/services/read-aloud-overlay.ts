import { createReadAloudSession, type ReadAloudSession } from './read-aloud-client'

export function createPageReadAloudController() {
  const host = document.createElement('div')
  host.setAttribute('data-btools-page-translation', 'true')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    .panel { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 18px;
      background: #fff; color: #102a43; border: 1px solid #dbeafe; border-radius: 16px;
      box-shadow: 0 12px 48px #0f172a30; font: 14px/1.6 system-ui, sans-serif; }
    .panel[hidden], button[hidden] { display: none; }
    .header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .header { font-weight: 600; }
    .preview { max-height: 100px; overflow: auto; white-space: pre-wrap; color: #64748b; margin: 10px 0; }
    .status { margin: 12px 0; }
    button { font: inherit; cursor: pointer; border: 1px solid #cbd5e1; background: #f8fafc;
      color: #334155; border-radius: 8px; padding: 5px 12px; }
    button:disabled { opacity: .5; cursor: default; }
    .resume, .replay { background: #0ea5e9; color: white; border-color: #0ea5e9; }
    .close { border: 0; font-size: 20px; padding: 0 6px; background: transparent; }
    .error { color: #b91c1c; }
  `
  const panel = document.createElement('section')
  panel.className = 'panel'
  panel.setAttribute('aria-label', 'BTools AI 朗读')
  panel.hidden = true
  const header = document.createElement('div')
  header.className = 'header'
  const title = document.createElement('span')
  title.textContent = 'BTools · AI 朗读'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.textContent = '×'
  close.setAttribute('aria-label', '关闭朗读')
  header.append(title, close)
  const preview = document.createElement('div')
  preview.className = 'preview'
  const status = document.createElement('div')
  status.className = 'status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const actions = document.createElement('div')
  actions.className = 'actions'
  const resume = document.createElement('button')
  resume.type = 'button'
  resume.className = 'resume'
  resume.textContent = '开始播放'
  resume.hidden = true
  const replay = document.createElement('button')
  replay.type = 'button'
  replay.className = 'replay'
  replay.textContent = '重新朗读'
  replay.hidden = true
  const stopButton = document.createElement('button')
  stopButton.type = 'button'
  stopButton.textContent = '停止朗读'
  actions.append(resume, replay, stopButton)
  panel.append(header, preview, status, actions)
  shadow.append(style, panel)

  let session: ReadAloudSession | undefined
  let generation = 0
  let lastText = ''

  function stop() {
    generation++
    session?.stop()
    session = undefined
    stopButton.disabled = true
    resume.hidden = true
    replay.hidden = true
  }

  stopButton.addEventListener('click', () => {
    stop()
    status.className = 'status'
    status.textContent = '已停止朗读'
  })
  close.addEventListener('click', () => {
    stop()
    panel.hidden = true
  })
  resume.addEventListener('click', () => {
    void session?.resume()
  })
  replay.addEventListener('click', () => start(lastText))
  window.addEventListener('pagehide', stop)

  function start(text: string) {
    stop()
    const currentGeneration = generation
    if (!host.isConnected) document.documentElement.appendChild(host)
    panel.hidden = false
    preview.textContent = text.length > 300 ? `${text.slice(0, 300)}…` : text
    status.className = 'status'
    status.textContent = '正在生成首段音频...'
    if (!text.trim()) {
      status.textContent = '请先选中需要朗读的文本'
      return
    }
    lastText = text
    stopButton.disabled = false
    session = createReadAloudSession(text, {
      onStatus(nextStatus) {
        if (currentGeneration !== generation) return
        resume.hidden = nextStatus !== 'blocked'
        replay.hidden = nextStatus !== 'finished'
        stopButton.disabled = nextStatus === 'finished'
        status.textContent = {
          loading: '正在生成首段音频...',
          playing: '正在朗读，后续音频会继续生成',
          blocked: '点击“开始播放”以允许浏览器播放音频',
          finished: '朗读完成',
        }[nextStatus]
      },
      onError(message) {
        if (currentGeneration !== generation) return
        status.className = 'status error'
        status.textContent = message
        stopButton.disabled = true
        resume.hidden = true
        replay.hidden = true
      },
    })
  }
  return { start, stop }
}
