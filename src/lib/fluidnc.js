import { parseStatus, EMPTY } from './status.js'

const OPEN = 1 // WebSocket.OPEN

// Talks to FluidNC over its websocket: one command line in flight at a time,
// real-time bytes straight through, status reports parsed as they arrive.
export class FluidNC {
  constructor({ host, WebSocket = globalThis.WebSocket, onStatus = () => {}, onLine = () => {}, onConnection = () => {} }) {
    // FluidNC 4.x serves the websocket on port 80, 3.x on port 81.
    // ponytail: an explicit port in host (dev server, fake) skips the 3.x fallback.
    this.urls = host.includes(':') ? [`ws://${host}/`] : [`ws://${host}/`, `ws://${host}:81/`]
    this.WebSocket = WebSocket
    this.onStatus = onStatus
    this.onLine = onLine
    this.onConnection = onConnection
    this.status = EMPTY
    this.queue = []
    this.inflight = null
    this.ws = null
    this.urlIndex = 0
    this.retryMs = 500
  }

  connect() {
    if (this.ws) return
    this.wanted = true
    this._open()
  }

  close() {
    this.wanted = false
    this._drop()
  }

  // Resolves with { ok, error, lines } when FluidNC answers ok or error:N. Never rejects.
  // Refuses at once when not connected, so motion is never queued for later.
  send(line) {
    if (this.ws?.readyState !== OPEN) return Promise.resolve({ ok: false, error: 'disconnected', lines: [] })
    return new Promise(resolve => {
      this.queue.push({ line, resolve, lines: [] })
      this._pump()
    })
  }

  // Codes >= 0x80 go out UTF-8 encoded; FluidNC decodes UTF-8 before acting on them.
  realtime(code) {
    if (this.ws?.readyState === OPEN) this.ws.send(String.fromCharCode(code))
  }

  // FluidNC drops everything on a soft reset, so nothing pending will be answered.
  reset() {
    this.realtime(0x18)
    this._failAll('reset')
  }

  // Cancels queued (not yet sent) commands, e.g. leftover jog moves.
  dropQueued(match) {
    const keep = []
    for (const c of this.queue) {
      if (match(c.line)) c.resolve({ ok: false, error: 'cancelled', lines: [] })
      else keep.push(c)
    }
    this.queue = keep
  }

  _open() {
    const url = this.urls[this.urlIndex]
    const ws = url.endsWith(':81/') ? new this.WebSocket(url, ['arduino']) : new this.WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.opened = false
    this.buf = ''
    this.decoder = new TextDecoder()
    this.onConnection('connecting')
    ws.onopen = () => {
      this.opened = true
      this.retryMs = 500
      this.lastRx = Date.now()
      this.onConnection('open')
      this.timer = setInterval(() => this._watch(), 250)
      this.send('$RI=100')
    }
    ws.onmessage = e => this._receive(e.data)
    ws.onclose = () => this._closed()
  }

  _watch() {
    const quiet = Date.now() - this.lastRx
    if (quiet > 3000) this._drop() // dead link, e.g. a phone that slept: start over
    else if (quiet > 250) this.realtime(0x3f) // '?': FluidNC only auto-reports while moving
  }

  _drop() {
    const ws = this.ws
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onclose = null
    try { ws.close() } catch {}
    this._closed()
  }

  _closed() {
    clearInterval(this.timer)
    const wasOpen = this.opened
    this.ws = null
    this.opened = false
    this._failAll('disconnected')
    this.onConnection('closed')
    if (!this.wanted) return
    if (!wasOpen) this.urlIndex = (this.urlIndex + 1) % this.urls.length // try the other port
    setTimeout(() => this.wanted && !this.ws && this._open(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, 5000)
  }

  _receive(data) {
    this.lastRx = Date.now()
    if (typeof data === 'string') return // control frames: currentID, PING, ...
    this.buf += this.decoder.decode(data, { stream: true })
    let i
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')
      this.buf = this.buf.slice(i + 1)
      if (line) this._line(line)
    }
  }

  _line(line) {
    if (line.startsWith('<')) {
      this.status = parseStatus(line, this.status)
      this.onStatus(this.status)
      return
    }
    this.onLine(line)
    const c = this.inflight
    if (!c) return
    if (line === 'ok' || line.startsWith('error:')) {
      this.inflight = null
      c.resolve({ ok: line === 'ok', error: line === 'ok' ? null : Number(line.slice(6)), lines: c.lines })
      this._pump()
    } else {
      c.lines.push(line)
    }
  }

  _pump() {
    if (this.inflight || !this.queue.length || this.ws?.readyState !== OPEN) return
    this.inflight = this.queue.shift()
    this.ws.send(this.inflight.line + '\n')
  }

  _failAll(error) {
    const all = this.inflight ? [this.inflight, ...this.queue] : this.queue
    this.inflight = null
    this.queue = []
    for (const c of all) c.resolve({ ok: false, error, lines: c.lines })
  }
}
