<script>
  import { onMount } from 'svelte'

  // job: parsed G-code or null; current: index of the segment being cut (-1 = none); pos: live work position
  let { job = null, current = -1, pos = [0, 0, 0] } = $props()

  let box, base, trail, dot
  let size = { w: 0, h: 0, dpr: 1 }
  let view = { scale: 1, ox: 0, oy: 0 } // screen x = ox + x * scale, screen y = oy - y * scale
  let colors = {}
  let drawnTo = -1 // trail segments drawn so far
  let raf = 0

  const sx = x => view.ox + x * view.scale
  const sy = y => view.oy - y * view.scale

  function ctxOf(canvas) {
    const ctx = canvas.getContext('2d')
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
    return ctx
  }

  function drawBase() {
    const ctx = ctxOf(base)
    ctx.clearRect(0, 0, size.w, size.h)
    if (!job) return
    const { pts: p, rapid } = job
    for (const r of [1, 0]) {
      ctx.beginPath()
      for (let i = 0; i < rapid.length; i++) {
        if (rapid[i] !== r) continue
        ctx.moveTo(sx(p[i * 3]), sy(p[i * 3 + 1]))
        ctx.lineTo(sx(p[i * 3 + 3]), sy(p[i * 3 + 4]))
      }
      ctx.strokeStyle = r ? colors.rapid : colors.path
      ctx.lineWidth = r ? 0.5 : 1
      ctx.stroke()
    }
  }

  // Finished cut segments (either end below work Z0) in red. Pass -1 to redraw from scratch.
  function drawTrail(from) {
    const ctx = ctxOf(trail)
    if (from < 0) ctx.clearRect(0, 0, size.w, size.h)
    drawnTo = current
    if (!job || current <= 0) return
    const p = job.pts
    ctx.beginPath()
    for (let i = Math.max(from, 0); i < current; i++) {
      if (p[i * 3 + 2] >= 0 && p[i * 3 + 5] >= 0) continue
      ctx.moveTo(sx(p[i * 3]), sy(p[i * 3 + 1]))
      ctx.lineTo(sx(p[i * 3 + 3]), sy(p[i * 3 + 4]))
    }
    ctx.strokeStyle = colors.cut
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // The tool: green above work Z0, red below, plus the part of the current segment already cut.
  function drawDot() {
    const ctx = ctxOf(dot)
    ctx.clearRect(0, 0, size.w, size.h)
    const below = pos[2] < 0
    const x = sx(pos[0]), y = sy(pos[1])
    if (job && current >= 0 && below) {
      const p = job.pts
      ctx.beginPath()
      ctx.moveTo(sx(p[current * 3]), sy(p[current * 3 + 1]))
      ctx.lineTo(x, y)
      ctx.strokeStyle = colors.cut
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, 2 * Math.PI)
    ctx.fillStyle = below ? colors.cut : colors.ok
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = colors.panel
    ctx.stroke()
  }

  // Pan and zoom redraw everything, at most once per frame.
  function redraw() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      drawBase()
      drawTrail(-1)
      drawDot()
    })
  }

  function fit() {
    const b = job && job.bounds.minX <= job.bounds.maxX ? job.bounds : { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1)
    view.scale = 0.9 * Math.min(size.w / w, size.h / h)
    view.ox = size.w / 2 - ((b.minX + b.maxX) / 2) * view.scale
    view.oy = size.h / 2 + ((b.minY + b.maxY) / 2) * view.scale
    redraw()
  }

  // A new file: fit it to the view.
  $effect(() => {
    job
    if (size.w) fit()
  })
  // Progress: add newly finished segments to the trail (or start over if it went backwards).
  $effect(() => {
    current
    if (size.w && !raf) drawTrail(current < drawnTo ? -1 : drawnTo)
  })
  $effect(() => {
    pos
    current
    if (size.w && !raf) drawDot()
  })

  const pointers = new Map()
  function local(e) {
    const r = box.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  function zoomAt([x, y], factor) {
    view.ox = x - (x - view.ox) * factor
    view.oy = y - (y - view.oy) * factor
    view.scale *= factor
    redraw()
  }
  function onpointerdown(e) {
    box.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, local(e))
  }
  function onpointermove(e) {
    if (!pointers.has(e.pointerId)) return
    const before = [...pointers.values()]
    pointers.set(e.pointerId, local(e))
    const after = [...pointers.values()]
    if (after.length === 1) {
      view.ox += after[0][0] - before[0][0]
      view.oy += after[0][1] - before[0][1]
      redraw()
    } else if (after.length === 2) {
      const gap = ps => Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1])
      const mid = [(after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2]
      if (gap(before) > 0) zoomAt(mid, gap(after) / gap(before))
    }
  }
  const onpointerup = e => pointers.delete(e.pointerId)
  function onwheel(e) {
    e.preventDefault()
    zoomAt(local(e), Math.exp(-e.deltaY * 0.0015))
  }

  onMount(() => {
    const css = getComputedStyle(box)
    const v = name => css.getPropertyValue(name).trim()
    colors = { path: v('--muted'), rapid: v('--line'), cut: v('--bad'), ok: v('--ok'), panel: v('--panel') }
    const ro = new ResizeObserver(() => {
      const r = box.getBoundingClientRect()
      if (!r.width || !r.height) return // hidden behind another tab
      size = { w: r.width, h: r.height, dpr: devicePixelRatio || 1 }
      for (const c of [base, trail, dot]) {
        c.width = Math.round(r.width * size.dpr)
        c.height = Math.round(r.height * size.dpr)
      }
      fit()
    })
    ro.observe(box)
    box.addEventListener('wheel', onwheel, { passive: false }) // passive listeners can't stop the page scrolling
    return () => {
      ro.disconnect()
      box.removeEventListener('wheel', onwheel)
      cancelAnimationFrame(raf)
    }
  })
</script>

<div class="panel preview" bind:this={box} {onpointerdown} {onpointermove} {onpointerup} onpointercancel={onpointerup} ondblclick={fit}>
  <canvas bind:this={base}></canvas>
  <canvas bind:this={trail}></canvas>
  <canvas bind:this={dot}></canvas>
  {#if !job}<p class="hint">Load a file to preview it here</p>{/if}
</div>

<style>
  .preview { position: relative; height: 50vh; min-height: 260px; padding: 0; overflow: hidden; touch-action: none; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hint { position: absolute; inset: auto 0 12px; margin: 0; text-align: center; font-size: 14px; color: var(--muted); pointer-events: none; }
  @media (min-width: 900px) { .preview { height: 60vh; } }
</style>
