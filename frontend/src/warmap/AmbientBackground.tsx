import { useEffect, useRef } from 'react'

// Command-room ambiance behind the war map: a slow radar sweep over a faint,
// drifting starfield. Decorative only; kept dim so the map and data stay readable.

const SWEEP_RGB = '32, 201, 94' // --wm-green
const SWEEP_PEAK_ALPHA = 0.07 // leading edge of the beam
const SWEEP_TRAIL = Math.PI * 0.55 // angular length of the fading trail
const SWEEP_PERIOD_MS = 14000 // one full revolution
const STAR_DENSITY = 1 / 9000 // stars per CSS pixel of screen area
const MAX_STARS = 260
const FRAME_MS = 1000 / 30 // ambiance does not need 60fps
const MAX_DPR = 2

interface Star {
  x: number
  y: number
  r: number
  alpha: number
  vx: number
  vy: number
}

function makeStars(width: number, height: number): Star[] {
  const count = Math.min(MAX_STARS, Math.round(width * height * STAR_DENSITY))
  return Array.from({ length: count }, () => {
    // Nearer stars are slightly larger, brighter and faster, for a hint of parallax.
    const depth = Math.random()
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.4 + depth * 0.8,
      alpha: 0.08 + depth * 0.22,
      vx: -(1.5 + depth * 4.5), // px per second
      vy: 0.4 + depth * 0.8,
    }
  })
}

export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let stars: Star[] = []
    let angle = -Math.PI / 2
    let frame = 0
    let last = 0

    const resize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = makeStars(width, height)
      draw()
    }

    const drawSweep = () => {
      const cx = width / 2
      const cy = height / 2
      const radius = Math.hypot(width, height) / 2
      const start = angle - SWEEP_TRAIL

      if (typeof ctx.createConicGradient === 'function') {
        // Conic gradient from the tail (transparent) to the leading edge (peak).
        const gradient = ctx.createConicGradient(start, cx, cy)
        const end = SWEEP_TRAIL / (Math.PI * 2)
        gradient.addColorStop(0, `rgba(${SWEEP_RGB}, 0)`)
        gradient.addColorStop(end * 0.7, `rgba(${SWEEP_RGB}, ${SWEEP_PEAK_ALPHA * 0.35})`)
        gradient.addColorStop(end, `rgba(${SWEEP_RGB}, ${SWEEP_PEAK_ALPHA})`)
        gradient.addColorStop(Math.min(1, end + 0.0001), `rgba(${SWEEP_RGB}, 0)`)
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, radius, start, angle)
        ctx.closePath()
        ctx.fill()
      } else {
        // Fallback: stepped wedges with rising opacity.
        const steps = 36
        for (let i = 0; i < steps; i++) {
          const a0 = start + (SWEEP_TRAIL * i) / steps
          const a1 = start + (SWEEP_TRAIL * (i + 1)) / steps
          ctx.fillStyle = `rgba(${SWEEP_RGB}, ${SWEEP_PEAK_ALPHA * ((i + 1) / steps) ** 2})`
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, radius, a0, a1 + 0.002)
          ctx.closePath()
          ctx.fill()
        }
      }

      // Thin leading edge so the beam reads as a radar arm.
      ctx.strokeStyle = `rgba(${SWEEP_RGB}, ${SWEEP_PEAK_ALPHA * 1.4})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
      ctx.stroke()
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height)
      for (const s of stars) {
        ctx!.fillStyle = `rgba(200, 220, 230, ${s.alpha})`
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx!.fill()
      }
      drawSweep()
    }

    const update = (dt: number) => {
      angle = (angle + (dt / SWEEP_PERIOD_MS) * Math.PI * 2) % (Math.PI * 2)
      const seconds = dt / 1000
      for (const s of stars) {
        s.x += s.vx * seconds
        s.y += s.vy * seconds
        if (s.x < -2) s.x += width + 4
        if (s.y > height + 2) s.y -= height + 4
      }
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (!last) last = now
      const dt = now - last
      if (dt < FRAME_MS) return
      // Cap the step so a stalled tab never makes the scene jump.
      update(Math.min(dt, 100))
      last = now
      draw()
    }

    const start = () => {
      if (frame || document.hidden || motionQuery?.matches) return
      last = 0
      frame = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
    // Reduced motion: hold a single still frame instead of animating.
    const sync = () => {
      if (document.hidden || motionQuery?.matches) {
        stop()
        draw()
      } else {
        start()
      }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    sync()
    document.addEventListener('visibilitychange', sync)
    motionQuery?.addEventListener?.('change', sync)

    return () => {
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      motionQuery?.removeEventListener?.('change', sync)
    }
  }, [])

  return <canvas ref={canvasRef} className="warmap__ambient" aria-hidden="true" />
}
