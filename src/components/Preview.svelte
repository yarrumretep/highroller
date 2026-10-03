<script>
  import { onMount } from 'svelte'

  // Drawn in machine coordinates: the file's work coordinates shifted by the work offset `wco`, the tool at
  // `mpos`. `wpos` supplies the work Z for the red/green rule; `range` is the X/Y travel, if known.
  let { job = null, current = -1, mpos = [0, 0, 0], wpos = [0, 0, 0], wco = [0, 0, 0], range = null, canGo = false, onGo = null } = $props()

  let box, base, trail, dot
  let size = { w: 0, h: 0, dpr: 1 }
  let view = { scale: 1, ox: 0, oy: 0 } // screen x = ox + x * scale, screen y = oy - y * scale
  let colors = {}
  let drawnTo = -1 // trail segments drawn so far
  let raf = 0

  const sx = x => view.ox + x * view.scale
  const sy = y => view.oy - y * view.scale
  const jx = x => sx(x + wco[0]) // a job (work) coordinate on screen
  const jy = y => sy(y + wco[1])
  const mx = px => (px - view.ox) / view.scale // screen → machine
  const my = py => (view.oy - py) / view.scale
  let target = $state(null) // { x, y } machine coordinates of the tapped spot
  let goError = $state('') // why onGo refused, shown once the attempt comes back
  const TAP_PX = 8 // a press that moves less than this is a tap

  function ctxOf(canvas) {
    const ctx = canvas.getContext('2d')
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
    return ctx
  }

  function drawBase() {
    const ctx = ctxOf(base)
    ctx.clearRect(0, 0, size.w, size.h)
    if (range) { // the machine's reach
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = colors.path
      ctx.lineWidth = 1
      ctx.strokeRect(sx(range.X.min), sy(range.Y.max), (range.X.max - range.X.min) * view.scale, (range.Y.max - range.Y.min) * view.scale)
      ctx.setLineDash([])
    }
    if (!job || !wco) return // the job is drawn shifted by the work offset, which may not be known yet
    const { pts: p, rapid } = job
    for (const r of [1, 0]) {
      ctx.beginPath()
      for (let i = 0; i < rapid.length; i++) {
        if (rapid[i] !== r) continue
        ctx.moveTo(jx(p[i * 3]), jy(p[i * 3 + 1]))
        ctx.lineTo(jx(p[i * 3 + 3]), jy(p[i * 3 + 4]))
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
    if (!job || current <= 0 || !wco) return
    const p = job.pts
    ctx.beginPath()
    for (let i = Math.max(from, 0); i < current; i++) {
      if (p[i * 3 + 2] >= 0 && p[i * 3 + 5] >= 0) continue
      ctx.moveTo(jx(p[i * 3]), jy(p[i * 3 + 1]))
      ctx.lineTo(jx(p[i * 3 + 3]), jy(p[i * 3 + 4]))
    }
    ctx.strokeStyle = colors.cut
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // The tool: green above work Z0, red below, plus the part of the current segment already cut.
  function drawDot() {
    const ctx = ctxOf(dot)
    ctx.clearRect(0, 0, size.w, size.h)
    if (!mpos) return // no tool to draw until the machine position is known
    const below = wpos?.[2] < 0
    const x = sx(mpos[0]), y = sy(mpos[1])
    if (job && wco && current >= 0 && below) {
      const p = job.pts
      ctx.beginPath()
      ctx.moveTo(jx(p[current * 3]), jy(p[current * 3 + 1]))
      ctx.lineTo(x, y)
      ctx.strokeStyle = colors.cut
      ctx.lineWidth = 2
      ctx.stroke()
    }
    if (target && canGo) {
      const tx = sx(target.x), ty = sy(target.y)
      ctx.beginPath()
      ctx.moveTo(tx - 10, ty); ctx.lineTo(tx + 10, ty)
      ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty + 10)
      ctx.strokeStyle = colors.accent
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

  // Fit the travel rectangle, or the job (a double-tap toggles). Falls back to whichever exists, then to 100 mm.
  let fitMode = 'table'
  function fit() {
    const jb = job && wco && job.bounds.minX <= job.bounds.maxX
      ? { minX: job.bounds.minX + wco[0], maxX: job.bounds.maxX + wco[0], minY: job.bounds.minY + wco[1], maxY: job.bounds.maxY + wco[1] }
      : null
    const tb = range ? { minX: range.X.min, maxX: range.X.max, minY: range.Y.min, maxY: range.Y.max } : null
    const b = (fitMode === 'table' ? tb ?? jb : jb ?? tb) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1)
    view.scale = 0.9 * Math.min(size.w / w, size.h / h)
    view.ox = size.w / 2 - ((b.minX + b.maxX) / 2) * view.scale
    view.oy = size.h / 2 + ((b.minY + b.maxY) / 2) * view.scale
    redraw()
  }
  function toggleFit() {
    fitMode = fitMode === 'table' ? 'job' : 'table'
    fit()
  }

  // A new file or a newly known travel: refit.
  $effect(() => {
    job
    range
    if (size.w) fit()
  })
  // A changed work offset moves the drawn toolpath (only when the values really changed: the array is
  // renewed often, e.g. whenever FluidNC happens to resend WCO with the same numbers). In job-fit mode
  // the camera is anchored to the job's shifted bounds, so a real change there refits too, not just redraws.
  let drawnWco = null
  $effect(() => {
    const w = wco ? wco.join(',') : null
    if (size.w && w !== drawnWco) {
      drawnWco = w
      if (fitMode === 'job') fit()
      else redraw()
    }
  })
  // Progress: add newly finished segments to the trail (or start over if it went backwards).
  $effect(() => {
    current
    if (size.w && !raf) drawTrail(current < drawnTo ? -1 : drawnTo)
  })
  $effect(() => {
    mpos
    wpos
    current
    if (size.w && !raf) drawDot()
  })
  $effect(() => { if (!canGo) target = null })
  $effect(() => {
    target
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
  let press = null // where a single pointer went down, to tell a tap from a drag
  function onpointerdown(e) {
    box.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, local(e))
    press = pointers.size === 1 ? { id: e.pointerId, at: local(e) } : null
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
      press = null
      const gap = ps => Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1])
      const mid = [(after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2]
      if (gap(before) > 0) zoomAt(mid, gap(after) / gap(before))
    }
  }
  function onpointerup(e) {
    const p = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    // `!p` is load-bearing: the Go button's own pointerdown stops propagation, so a press that started on it
    // never registered here, and this guard is what keeps that click from also being read as a tap on the canvas.
    if (press?.id !== e.pointerId || !p) return
    const [x0, y0] = press.at
    press = null
    if (Math.hypot(p[0] - x0, p[1] - y0) > TAP_PX) return
    tap(p)
  }
  function onpointercancel(e) {
    pointers.delete(e.pointerId)
    press = null
  }
  function tap([px, py]) {
    if (!canGo) return
    if (target && Math.hypot(sx(target.x) - px, sy(target.y) - py) < 16) { // tapping the crosshair clears it
      target = null
      return
    }
    if (!range) return // can't validate the reach yet
    const x = mx(px), y = my(py)
    if (x < range.X.min || x > range.X.max || y < range.Y.min || y > range.Y.max) return // outside the reach
    target = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
    goError = ''
  }
  async function goToTarget() {
    if (!target) return // canGo can flip false between pointerdown and click
    const t = target
    target = null
    goError = ''
    const r = await onGo?.(t.x, t.y)
    if (r && !r.ok) goError = r.error
  }
  function onwheel(e) {
    e.preventDefault()
    zoomAt(local(e), Math.exp(-e.deltaY * 0.0015))
  }

  onMount(() => {
    const css = getComputedStyle(box)
    const v = name => css.getPropertyValue(name).trim()
    colors = { path: v('--muted'), rapid: v('--line'), cut: v('--bad'), ok: v('--ok'), panel: v('--panel'), accent: v('--accent') }
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

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel preview" aria-label="Toolpath preview" bind:this={box} {onpointerdown} {onpointermove} {onpointerup} {onpointercancel} ondblclick={() => { target = null; toggleFit() }}>
  <canvas bind:this={base}></canvas>
  <canvas bind:this={trail}></canvas>
  <canvas bind:this={dot}></canvas>
  {#if target && canGo}
    <button class="goto" onpointerdown={e => e.stopPropagation()} onpointerup={e => e.stopPropagation()} onclick={goToTarget}>Go to X {target.x.toFixed(1)} Y {target.y.toFixed(1)}</button>
  {/if}
  {#if goError}<p class="goerr">{goError}</p>{/if}
  {#if !job}<p class="hint">{range ? 'Load a file to see it on the table' : 'Load a file to preview it here'}</p>{/if}
</div>

<style>
  .preview { position: relative; height: 50vh; min-height: 260px; padding: 0; overflow: hidden; touch-action: none; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hint { position: absolute; inset: auto 0 12px; margin: 0; text-align: center; font-size: 14px; color: var(--muted); pointer-events: none; }
  .goerr { position: absolute; inset: auto 0 12px; margin: 0; text-align: center; font-size: 14px; font-weight: 600; color: var(--bad); pointer-events: none; }
  .goto { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); min-height: 48px; padding: 0 18px; font-weight: 700; color: white; background: var(--accent); border-color: var(--accent); }
  @media (min-width: 900px) { .preview { height: 60vh; } }
</style>
