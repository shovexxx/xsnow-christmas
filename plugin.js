/**
 * XSnow Christmas overlay for Hermes desktop.
 * Canvas snow + Santa sleigh flying across the workspace page, plus
 * controls to launch the real xsnow binary (X11, installed via dnf).
 * Save as ~/.hermes/desktop-plugins/xsnow-christmas/plugin.js
 * Reload via Cmd/Ctrl+K -> "Reload desktop plugins"
 */
import { atom, Button, haptic, host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS, TITLEBAR_AREAS, Tip, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const ID = 'xsnow-christmas'

// ---- shared state -----------------------------------------------------------
const DEFAULTS = { snow: 180, santa: true, speed: 1, tree: true, overlay: true, reindeer: 3, chonker: false, chonkerSize: 4, oops: true }
const $prefs = atom({ ...DEFAULTS })
const $overlayOn = atom(true)

let _ctx = null
function syncPrefs(ctx) {
  _ctx = ctx
  try {
    const raw = ctx.storage.get('prefs')
    if (raw) { $prefs.set({ ...DEFAULTS, ...JSON.parse(raw) }); $overlayOn.set($prefs.get().overlay !== false) }
  } catch {}
}
function savePrefs(next) {
  $prefs.set(next); $overlayOn.set(next.overlay !== false)
  try { _ctx?.storage.set('prefs', JSON.stringify(next)) } catch {}
}
function toggleOverlay() {
  savePrefs({ ...$prefs.get(), overlay: !($prefs.get().overlay !== false) })
}

// ---- canvas scene (xsnow homage, no X11 needed) ---------------------------
function drawSantaHat(ctx, x, y) {
  ctx.save()
  ctx.translate(x, y)
  const OUT = '#1a1a1a'  // bold cartoon outline
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
  // red cone with a curved, drooping tip (flops back, tip hangs down behind)
  ctx.fillStyle = '#d00000'
  ctx.beginPath()
  ctx.moveTo(5.5, -1)
  ctx.quadraticCurveTo(6, -9, 2.5, -12.5)        // front edge rising
  ctx.quadraticCurveTo(0, -15.5, -4, -15)        // arching over the top
  ctx.quadraticCurveTo(-7.5, -14.5, -7.5, -11.5) // tip curling down
  ctx.quadraticCurveTo(-7.5, -7, -5.5, -2)       // back edge coming down
  ctx.closePath(); ctx.fill(); ctx.stroke()
  // fluffy white brim with a scalloped (puffy) bottom edge
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(0, 0, 8.5, 3.4, 0, Math.PI, Math.PI * 2)  // top dome
  for (let i = 0; i < 4; i++) {
    const cx = 6.3 - i * 4.2
    ctx.arc(cx, 0, 2.1, 0, Math.PI)                     // puffy scallop bumps
  }
  ctx.closePath(); ctx.fill(); ctx.stroke()
  // white pom-pom at the drooped tip
  ctx.beginPath(); ctx.arc(-7.5, -13, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.restore()
}
// A wrapped present: paper, ribbon cross, optional bow on top and dot pattern.
function drawGift(ctx, x, y, w, h, paper, ribbon, bow, dots) {
  ctx.fillStyle = paper
  ctx.fillRect(x, y, w, h)
  if (dots) {
    ctx.fillStyle = ribbon
    for (let i = 1; i <= 3; i++) for (let j = 1; j <= 2; j++) {
      ctx.beginPath(); ctx.arc(x + i * w / 4, y + j * h / 3, 0.7, 0, 7); ctx.fill()
    }
  }
  ctx.fillStyle = ribbon
  ctx.fillRect(x + w / 2 - 0.8, y, 1.6, h)
  ctx.fillRect(x, y + h / 2 - 0.8, w, 1.6)
  if (bow) {
    ctx.beginPath(); ctx.arc(x + w / 2 - 1.7, y - 1.3, 1.5, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.arc(x + w / 2 + 1.7, y - 1.3, 1.5, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.arc(x + w / 2, y - 0.9, 1, 0, 7); ctx.fill()
  }
}

// ---- reindeer team + fire (shared by the page canvas and the overlay) -------
function teamOf(p) {
  const nR = Math.max(1, Math.min(20, Math.round(p.reindeer) || 3))
  const chonk = !!p.chonker
  const s = chonk ? Math.max(1, Math.min(10, Math.round(p.chonkerSize) || 4)) : 0
  return {
    nR, chonk,
    bodyRx: chonk ? 4 * s : 11,
    bodyRy: chonk ? 3 * s + 1 : 6,
    headR: chonk ? 1.5 * s : 4.5,
    spacing: chonk ? 8 * s + 8 : 26,
    startX: chonk ? 58 + 4 * s : 66,
  }
}

// Burn timers for the ignited targets (ms).
const BURN_MS = 10000
const BURN = { rudolph: 0, gifts: 0 }  // performance.now() timestamps until which each burns
// Oops mode: random-interval fire/plunge/crash cycle (shared timers).
const OOPS = { next: 0, fired: 0 }
const PILE = { n: 0 }  // gifts in the crash pile (per canvas pile.x)
const pickMin = () => [5, 7, 15][(Math.random() * 3) | 0] * 60000
function spawnFlames(list, ex, ey, n, spread = 14) {
  for (let k = 0; k < n; k++) {
    list.push({ x: ex + (Math.random() - 0.5) * spread, y: ey + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 0.6, vy: -(0.5 + Math.random() * 1.2), life: 1, r: 2 + Math.random() * 3 })
  }
  if (list.length > 400) list.splice(0, list.length - 400)
}
function drawFlames(ctx, list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i]
    f.x += f.vx; f.y += f.vy; f.vy -= 0.03; f.life -= 0.02
    if (f.life <= 0) { list.splice(i, 1); continue }
    const t = f.life
    ctx.fillStyle = t > 0.6 ? 'rgba(255,220,120,' + (0.9 * t) + ')' : t > 0.3 ? 'rgba(255,140,40,' + (0.9 * t) + ')' : 'rgba(200,60,20,' + (0.8 * t) + ')'
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * t), 0, 7); ctx.fill()
  }
}
// One Christmas tree. Lifted 20px above the ground line so the canopy
// clears the prompt/buttons at the bottom of the window; trunk reaches the ground.
function drawTree(ctx, x, groundY, h) {
  const baseY = groundY - 20
  ctx.fillStyle = '#2d6a4f'
  for (let i = 0; i < 3; i++) {
    const w = h * 0.62 * (1 - i * 0.22)
    ctx.beginPath()
    ctx.moveTo(x, baseY - h + i * h * 0.28)
    ctx.lineTo(x - w / 2, baseY - i * h * 0.28)
    ctx.lineTo(x + w / 2, baseY - i * h * 0.28)
    ctx.closePath(); ctx.fill()
  }
  ctx.fillStyle = '#7f5539'; ctx.fillRect(x - 3, baseY, 6, groundY + 8 - baseY)
  ctx.fillStyle = '#e63946'
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.arc(x + (Math.random() - 0.5) * h * 0.4, baseY - h * 0.15 - i * h * 0.12, 2.2, 0, 7)
    ctx.fill()
  }
}
// Heap of wrapped presents left where the rig crashed.
function drawPile(ctx, x, baseY, n) {
  const cols = [['#1d3557', '#f4d35e'], ['#e63946', '#f4d35e'], ['#2a9d8f', '#e63946']]
  const counts = [3, 2, 1]
  let k = 0
  for (let row = 0; row < 3 && k < n; row++) {
    for (let c = 0; c < counts[row] && k < n; c++, k++) {
      const [paper, rib] = cols[k % 3]
      drawGift(ctx, x + (c - (counts[row] - 1) / 2) * 11 - 5.5, baseY - 8 - row * 8, 11, 9, paper, rib, 1, row === 0 ? 1 : 0)
    }
  }
}
function SnowCanvas({ prefs, scene }) {
  const ref = useRef(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx2 = canvas.getContext('2d')
    let raf, W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2)
    let flakes = []
    let santaX = -220, santaY = 90, santaDir = 1, t = 0
    // trees (dx: offset from an edge); oops crash state
    const trees = [{ dx: 52, h: 100 }, { dx: 132, h: 125 }]
    let flames = [], plunge = false, pile = null, lastFire = 0

    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect()
      W = Math.max(200, r.width); H = Math.max(200, r.height)
      canvas.width = W * dpr; canvas.height = H * dpr
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement)
    resize()

    const seed = (n) => {
      flakes = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.8 + Math.random() * 2.6, vy: 0.4 + Math.random() * 1.4,
        vx: (Math.random() - 0.5) * 0.6, ph: Math.random() * Math.PI * 2
      }))
    }
    seed(prefsRef.current.snow)

    // (trees are drawn by the shared drawTree)

    const drawSanta = (x, y, dir, T) => {
      const { nR, bodyRx, bodyRy, headR, spacing, startX } = T
      ctx2.save(); ctx2.translate(x, y); ctx2.scale(dir, 1)
      // sleigh (classic curved profile + silver runner, bold sticker outline)
      ctx2.strokeStyle = '#1a1a1a'; ctx2.lineWidth = 1.5; ctx2.lineJoin = 'round'
      ctx2.fillStyle = '#d4af37'  // thin gold ski runner, tip curving up, hanging below the body
      ctx2.beginPath()
      ctx2.moveTo(-8, 16)
      ctx2.quadraticCurveTo(20, 18.5, 44, 15)  // bottom edge sweeping forward
      ctx2.quadraticCurveTo(49, 13, 49, 6)    // front tip curving up like a ski (thinner front)
      ctx2.quadraticCurveTo(47, 0, 40, 3)     // tip rounding over
      ctx2.quadraticCurveTo(20, 13, -2, 13)   // top edge back (gap below the body)
      ctx2.quadraticCurveTo(-9, 13, -8, 16)   // rear tip
      ctx2.closePath(); ctx2.fill(); ctx2.stroke()
      for (const sx of [4, 18, 32]) ctx2.fillRect(sx, 8, 3, 6)  // struts ending inside the ski
      ctx2.fillStyle = '#d00000'  // body
      ctx2.beginPath()
      ctx2.moveTo(0, 8)
      ctx2.quadraticCurveTo(18, 13, 36, 7)     // bottom
      ctx2.quadraticCurveTo(46, 2, 46, -8)     // front outer rising
      ctx2.quadraticCurveTo(46, -16, 40, -15)  // front bow tip
      ctx2.quadraticCurveTo(38, -7, 30, -2)    // bow inner down to the bowl
      ctx2.lineTo(8, -2)                        // bowl floor
      ctx2.quadraticCurveTo(0, -3, -1, -9)     // stern inner up
      ctx2.quadraticCurveTo(-2, -15, -6, -12)  // stern tip
      ctx2.quadraticCurveTo(-7, -3, 0, 8)      // stern outer down
      ctx2.closePath(); ctx2.fill(); ctx2.stroke()
      // Santa body + hat (shifted forward in the bowl; presents pile up behind him)
      ctx2.save(); ctx2.translate(8, 0)
      ctx2.fillStyle = '#d00000'; ctx2.beginPath(); ctx2.arc(14, -10, 9, 0, 7); ctx2.fill()
      ctx2.fillStyle = '#f1fa8c'; ctx2.beginPath(); ctx2.arc(14, -17, 8, 0, 7); ctx2.fill()
      ctx2.fillStyle = '#f2c094'; ctx2.beginPath(); ctx2.arc(14, -24, 7, 0, 7); ctx2.fill()
      // Santa beard (fuller, white, outlined, hanging below the face onto his chest)
      ctx2.fillStyle = '#ffffff'; ctx2.strokeStyle = '#9fb0bd'; ctx2.lineWidth = 1.2
      ctx2.beginPath()
      ctx2.moveTo(7.5, -21)
      ctx2.quadraticCurveTo(5.5, -8, 14, -2.5)
      ctx2.quadraticCurveTo(22.5, -8, 20.5, -21)
      ctx2.closePath(); ctx2.fill(); ctx2.stroke()
      // face features: eyes, nose, blush, mustache
      ctx2.fillStyle = '#1a1a1a'
      ctx2.beginPath(); ctx2.arc(11, -25, 0.9, 0, 7); ctx2.fill()
      ctx2.beginPath(); ctx2.arc(17, -25, 0.9, 0, 7); ctx2.fill()
      ctx2.fillStyle = '#e2786d'
      ctx2.beginPath(); ctx2.arc(14, -22, 1.3, 0, 7); ctx2.fill()
      ctx2.fillStyle = 'rgba(255,110,110,0.45)'
      ctx2.beginPath(); ctx2.arc(10, -22, 1.5, 0, 7); ctx2.fill()
      ctx2.beginPath(); ctx2.arc(18, -22, 1.5, 0, 7); ctx2.fill()
      ctx2.fillStyle = '#ffffff'; ctx2.strokeStyle = '#9fb0bd'; ctx2.lineWidth = 1.2
      ctx2.beginPath(); ctx2.ellipse(14, -20, 3.8, 1.7, 0, 0, Math.PI * 2); ctx2.fill(); ctx2.stroke()
      // Santa hat on top of the head
      drawSantaHat(ctx2, 14, -31)
      ctx2.restore()
      // gifts (piled behind Santa): navy with gold ribbon + dots, red at the stern, teal stacked on top
      drawGift(ctx2, 0, -9, 11, 9, '#1d3557', '#f4d35e', 0, 1)
      drawGift(ctx2, -5, -8, 7, 8, '#e63946', '#f4d35e', 1, 0)
      drawGift(ctx2, 2, -15, 9, 7, '#2a9d8f', '#e63946', 1, 0)
      // reindeer (simple silhouettes ahead of sleigh)
      ctx2.fillStyle = '#7f5539'
      const k = headR / 4.5  // antler/leg/nose scale for chonkers
      for (let i = 0; i < nR; i++) {
        const rx = startX + i * spacing, ry = -4 + Math.sin(t * 0.2 + i) * 3
        const hx = rx + bodyRx, hy = ry - 5
        ctx2.beginPath(); ctx2.ellipse(rx, ry, bodyRx, bodyRy, 0, 0, 7); ctx2.fill()
        ctx2.beginPath(); ctx2.arc(hx, hy, headR, 0, 7); ctx2.fill()
        // antlers
        ctx2.strokeStyle = '#e8d5a8'; ctx2.lineWidth = Math.min(2.5, 1.5 * k); ctx2.lineCap = 'round'
        ctx2.beginPath()
        ctx2.moveTo(hx - 1.5 * k, hy - 3.5 * k); ctx2.lineTo(hx - 3 * k, hy - 8.5 * k)
        ctx2.moveTo(hx + 1 * k, hy - 3.5 * k); ctx2.lineTo(hx + 2.5 * k, hy - 8.5 * k)
        ctx2.moveTo(hx - 2.1 * k, hy - 6 * k); ctx2.lineTo(hx - 4.5 * k, hy - 7 * k)
        ctx2.moveTo(hx + 1.7 * k, hy - 6 * k); ctx2.lineTo(hx + 4.5 * k, hy - 7 * k)
        ctx2.stroke()
        // trotting legs (alternate swing)
        const ph = t * 0.35 + i * 1.1
        ctx2.strokeStyle = '#5a3d24'; ctx2.lineWidth = Math.min(2.8, 1.8 * k); ctx2.lineCap = 'round'
        for (const [lx, off] of [[-3, 0], [3, Math.PI]]) {
          const swing = Math.sin(ph + off) * 2.5
          ctx2.beginPath()
          ctx2.moveTo(rx + lx, ry + 3)
          ctx2.lineTo(rx + lx + swing, ry + bodyRy + 2)
          ctx2.stroke()
        }
        if (i === nR - 1) {  // Rudolph leads the team
          const noseR = Math.max(2.6, headR * 0.45), glowR = Math.max(6, headR)
          ctx2.fillStyle = '#ff0000'; ctx2.beginPath(); ctx2.arc(hx + headR - 0.5, hy, noseR, 0, 7); ctx2.fill()
          ctx2.fillStyle = 'rgba(255,60,60,0.35)'; ctx2.beginPath(); ctx2.arc(hx + headR - 0.5, hy, glowR, 0, 7); ctx2.fill()
        }
      }
      ctx2.restore()
    }

    const frame = () => {
      t++
      const p = prefsRef.current
      const now = performance.now()
      const T = teamOf(p)
      ctx2.clearRect(0, 0, W, H)
      // gutter/ground line
      ctx2.fillStyle = 'rgba(255,255,255,0.10)'
      ctx2.fillRect(0, H - 26, W, 26)
      if (p.tree) trees.forEach(tr => drawTree(ctx2, tr.dx > 0 ? tr.dx : W + tr.dx, H - 26, tr.h))
      if (pile) drawPile(ctx2, pile.x, H - 26, pile.n)
      // snow
      if (flakes.length !== p.snow) seed(p.snow)
      ctx2.fillStyle = 'rgba(255,255,255,0.92)'
      for (const f of flakes) {
        f.y += f.vy * p.speed; f.x += f.vx * p.speed + Math.sin(t * 0.02 + f.ph) * 0.4
        if (f.y > H - 26) { f.y = -4; f.x = Math.random() * W }
        if (f.x > W) f.x = 0; if (f.x < 0) f.x = W
        ctx2.beginPath(); ctx2.arc(f.x, f.y, f.r, 0, 7); ctx2.fill()
      }
      // Santa
      if (p.santa) {
        if (!p.oops) OOPS.next = 0
        if (p.oops && OOPS.next === 0) OOPS.next = now + pickMin()  // first enable: schedule a random interval
        if (p.oops && OOPS.next !== 0 && now >= OOPS.next && santaX > -260 && santaX < W + 260) {
          OOPS.next = now + pickMin()
          OOPS.fired = now
          BURN.rudolph = now + BURN_MS; BURN.gifts = now + BURN_MS
          PILE.n = Math.min(6, PILE.n + 2)
        }
        if (OOPS.fired > lastFire) { lastFire = OOPS.fired; plunge = true }
        if (plunge) {
          santaY += 3  // rapid descent
          if (santaY >= H - 46) {  // crash on the ground
            pile = { x: santaX + santaDir * 5, n: PILE.n }
            plunge = false
            santaX = -220; santaDir = 1  // Santa resets
          }
        } else {
          santaX += 1.6 * p.speed * santaDir
          santaY = 90 + Math.sin(t * 0.015) * 26
          if (santaX > W + 260) santaDir = -1
          if (santaX < -260) santaDir = 1
        }
        if (now < BURN.rudolph) spawnFlames(flames, santaX + santaDir * (T.startX + (T.nR - 1) * T.spacing), santaY - 4, 2)
        if (now < BURN.gifts) spawnFlames(flames, santaX + santaDir * 5, santaY - 8, 2)
        drawSanta(santaX, santaY, santaDir, T)
        drawFlames(ctx2, flames)
        if (scene) scene.current = { santaX, santaY, santaDir, W, H, lead: T.startX + (T.nR - 1) * T.spacing + T.bodyRx }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return jsx('canvas', {
    ref, style: { position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }
  })
}

// ---- global overlay: append a fixed layer directly to document.body so it
// escapes the titlebar's clipping/transform and covers the chat (workspace) window.
function Overlay() {
  const on = useValue($overlayOn)
  useEffect(() => {
    if (!on) return
    const host = document.createElement('div')
    host.dataset.xsnowOverlay = '1'
    host.style.cssText = 'position:fixed;inset:0;z-index:5000;pointer-events:none;overflow:hidden'
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;display:block'
    host.appendChild(canvas)
    document.body.appendChild(host)
    const g = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let W = window.innerWidth, H = window.innerHeight, raf, t = 0
    let flakes = [], santaX = -220, santaY = 90, santaDir = 1, flames = []
    const trees = [{ dx: 52, h: 100 }, { dx: 132, h: 125 }]
    let plunge = false, pile = null, lastFire = 0
    const resize = () => {
      W = window.innerWidth; H = window.innerHeight
      canvas.width = W * dpr; canvas.height = H * dpr
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const seed = (n) => { flakes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 2.6, vy: 0.4 + Math.random() * 1.4, vx: (Math.random() - 0.5) * 0.6, ph: Math.random() * 6.28 })) }
    const drawSanta = (x, y, dir, T) => {
      const { nR, bodyRx, bodyRy, headR, spacing, startX } = T
      g.save(); g.translate(x, y); g.scale(dir, 1)
      // sleigh (classic curved profile + silver runner, bold sticker outline)
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 1.5; g.lineJoin = 'round'
      g.fillStyle = '#d4af37'  // thin gold ski runner, tip curving up, hanging below the body
      g.beginPath()
      g.moveTo(-8, 16)
      g.quadraticCurveTo(20, 18.5, 44, 15)  // bottom edge sweeping forward
      g.quadraticCurveTo(49, 13, 49, 6)    // front tip curving up like a ski (thinner front)
      g.quadraticCurveTo(47, 0, 40, 3)     // tip rounding over
      g.quadraticCurveTo(20, 13, -2, 13)   // top edge back (gap below the body)
      g.quadraticCurveTo(-9, 13, -8, 16)   // rear tip
      g.closePath(); g.fill(); g.stroke()
      for (const sx of [4, 18, 32]) g.fillRect(sx, 8, 3, 6)  // struts ending inside the ski
      g.fillStyle = '#d00000'  // body
      g.beginPath()
      g.moveTo(0, 8)
      g.quadraticCurveTo(18, 13, 36, 7)     // bottom
      g.quadraticCurveTo(46, 2, 46, -8)     // front outer rising
      g.quadraticCurveTo(46, -16, 40, -15)  // front bow tip
      g.quadraticCurveTo(38, -7, 30, -2)    // bow inner down to the bowl
      g.lineTo(8, -2)                        // bowl floor
      g.quadraticCurveTo(0, -3, -1, -9)     // stern inner up
      g.quadraticCurveTo(-2, -15, -6, -12)  // stern tip
      g.quadraticCurveTo(-7, -3, 0, 8)      // stern outer down
      g.closePath(); g.fill(); g.stroke()
      // Santa body + hat (shifted forward in the bowl; presents pile up behind him)
      g.save(); g.translate(8, 0)
      g.fillStyle = '#d00000'; g.beginPath(); g.arc(14, -10, 9, 0, 7); g.fill()
      g.fillStyle = '#f1fa8c'; g.beginPath(); g.arc(14, -17, 8, 0, 7); g.fill()
      g.fillStyle = '#f2c094'; g.beginPath(); g.arc(14, -24, 7, 0, 7); g.fill()
      // Santa beard (fuller, white, outlined, hanging below the face onto his chest)
      g.fillStyle = '#ffffff'; g.strokeStyle = '#9fb0bd'; g.lineWidth = 1.2
      g.beginPath()
      g.moveTo(7.5, -21)
      g.quadraticCurveTo(5.5, -8, 14, -2.5)
      g.quadraticCurveTo(22.5, -8, 20.5, -21)
      g.closePath(); g.fill(); g.stroke()
      // face features: eyes, nose, blush, mustache
      g.fillStyle = '#1a1a1a'
      g.beginPath(); g.arc(11, -25, 0.9, 0, 7); g.fill()
      g.beginPath(); g.arc(17, -25, 0.9, 0, 7); g.fill()
      g.fillStyle = '#e2786d'
      g.beginPath(); g.arc(14, -22, 1.3, 0, 7); g.fill()
      g.fillStyle = 'rgba(255,110,110,0.45)'
      g.beginPath(); g.arc(10, -22, 1.5, 0, 7); g.fill()
      g.beginPath(); g.arc(18, -22, 1.5, 0, 7); g.fill()
      g.fillStyle = '#ffffff'; g.strokeStyle = '#9fb0bd'; g.lineWidth = 1.2
      g.beginPath(); g.ellipse(14, -20, 3.8, 1.7, 0, 0, Math.PI * 2); g.fill(); g.stroke()
      // Santa hat on top of the head
      drawSantaHat(g, 14, -31)
      g.restore()
      // gifts (piled behind Santa): navy with gold ribbon + dots, red at the stern, teal stacked on top
      drawGift(g, 0, -9, 11, 9, '#1d3557', '#f4d35e', 0, 1)
      drawGift(g, -5, -8, 7, 8, '#e63946', '#f4d35e', 1, 0)
      drawGift(g, 2, -15, 9, 7, '#2a9d8f', '#e63946', 1, 0)
      g.fillStyle = '#7f5539'
      const k = headR / 4.5  // antler/leg/nose scale for chonkers
      for (let i = 0; i < nR; i++) {
        const rx = startX + i * spacing, ry = -4 + Math.sin(t * 0.2 + i) * 3
        const hx = rx + bodyRx, hy = ry - 5
        g.beginPath(); g.ellipse(rx, ry, bodyRx, bodyRy, 0, 0, 7); g.fill()
        g.beginPath(); g.arc(hx, hy, headR, 0, 7); g.fill()
        // antlers
        g.strokeStyle = '#e8d5a8'; g.lineWidth = Math.min(2.5, 1.5 * k); g.lineCap = 'round'
        g.beginPath()
        g.moveTo(hx - 1.5 * k, hy - 3.5 * k); g.lineTo(hx - 3 * k, hy - 8.5 * k)
        g.moveTo(hx + 1 * k, hy - 3.5 * k); g.lineTo(hx + 2.5 * k, hy - 8.5 * k)
        g.moveTo(hx - 2.1 * k, hy - 6 * k); g.lineTo(hx - 4.5 * k, hy - 7 * k)
        g.moveTo(hx + 1.7 * k, hy - 6 * k); g.lineTo(hx + 4.5 * k, hy - 7 * k)
        g.stroke()
        // trotting legs (alternate swing)
        const ph = t * 0.35 + i * 1.1
        g.strokeStyle = '#5a3d24'; g.lineWidth = Math.min(2.8, 1.8 * k); g.lineCap = 'round'
        for (const [lx, off] of [[-3, 0], [3, Math.PI]]) {
          const swing = Math.sin(ph + off) * 2.5
          g.beginPath()
          g.moveTo(rx + lx, ry + 3)
          g.lineTo(rx + lx + swing, ry + bodyRy + 2)
          g.stroke()
        }
        if (i === nR - 1) {  // Rudolph leads the team
          const noseR = Math.max(2.6, headR * 0.45), glowR = Math.max(6, headR)
          g.fillStyle = '#ff0000'; g.beginPath(); g.arc(hx + headR - 0.5, hy, noseR, 0, 7); g.fill()
          g.fillStyle = 'rgba(255,60,60,0.35)'; g.beginPath(); g.arc(hx + headR - 0.5, hy, glowR, 0, 7); g.fill()
        }
      }
      g.restore()
    }
    const frame = () => {
      t++
      const p = $prefs.get()
      const T = teamOf(p)
      const now = performance.now()
      g.clearRect(0, 0, W, H)
      g.fillStyle = 'rgba(255,255,255,0.10)'
      g.fillRect(0, H - 26, W, 26)
      if (p.tree) trees.forEach(tr => drawTree(g, tr.dx > 0 ? tr.dx : W + tr.dx, H - 26, tr.h))
      if (pile) drawPile(g, pile.x, H - 26, pile.n)
      if (flakes.length !== p.snow) seed(p.snow)
      g.fillStyle = 'rgba(255,255,255,0.92)'
      for (const f of flakes) {
        f.y += f.vy * p.speed; f.x += f.vx * p.speed + Math.sin(t * 0.02 + f.ph) * 0.4
        if (f.y > H) { f.y = -4; f.x = Math.random() * W }
        if (f.x > W) f.x = 0; if (f.x < 0) f.x = W
        g.beginPath(); g.arc(f.x, f.y, f.r, 0, 7); g.fill()
      }
      if (p.santa) {
        if (!p.oops) OOPS.next = 0
        if (p.oops && OOPS.next === 0) OOPS.next = now + pickMin()  // first enable: schedule a random interval
        if (p.oops && OOPS.next !== 0 && now >= OOPS.next && santaX > -260 && santaX < W + 260) {
          OOPS.next = now + pickMin()
          OOPS.fired = now
          BURN.rudolph = now + BURN_MS; BURN.gifts = now + BURN_MS
          PILE.n = Math.min(6, PILE.n + 2)
        }
        if (OOPS.fired > lastFire) { lastFire = OOPS.fired; plunge = true }
        if (plunge) {
          santaY += 3  // rapid descent
          if (santaY >= H - 46) {  // crash on the ground
            pile = { x: santaX + santaDir * 5, n: PILE.n }
            plunge = false
            santaX = -220; santaDir = 1  // Santa resets
          }
        } else {
          santaX += 1.6 * p.speed * santaDir
          santaY = 90 + Math.sin(t * 0.015) * 26
          if (santaX > W + 260) santaDir = -1
          if (santaX < -260) santaDir = 1
        }
        if (now < BURN.rudolph) spawnFlames(flames, santaX + santaDir * (T.startX + (T.nR - 1) * T.spacing), santaY - 4, 2)
        if (now < BURN.gifts) spawnFlames(flames, santaX + santaDir * 5, santaY - 8, 2)
        drawSanta(santaX, santaY, santaDir, T)
        drawFlames(g, flames)
      }
      raf = requestAnimationFrame(frame)
    }
    resize(); seed($prefs.get().snow)
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); host.remove() }
  }, [on])
  return null
}

function TitlebarToggle() {
  const t = usePluginI18n(ID)
  const on = useValue($overlayOn)
  return jsx(Tip, {
    label: t('toggleTip'),
    children: jsx('button', {
      type: 'button',
      className: 'inline-flex h-full items-center px-1.5 text-[0.8125rem] hover:text-foreground',
      style: { color: on ? 'var(--ui-accent)' : 'var(--ui-text-tertiary)' },
      onClick: () => { haptic('tap'); toggleOverlay() },
      children: on ? '❄️' : '☀️'
    })
  })
}

// ---- page -------------------------------------------------------------------
function XsnowPage({ ctx }) {
  const t = usePluginI18n(ID)
  const prefs = useValue($prefs)
  const update = (patch) => savePrefs({ ...$prefs.get(), ...patch })
  const scene = useRef({})
  // Clicking the sleigh or the team sets Rudolph + the gift pile on fire.
  const onTap = (e) => {
    const tgt = e.target
    if (tgt && typeof tgt.closest === 'function' && tgt.closest('input,button')) return
    const s = scene.current
    if (!s || !s.W) return
    const r = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - r.left, cy = e.clientY - r.top
    const x0 = Math.min(s.santaX - 9 * s.santaDir, s.santaX + s.lead * s.santaDir)
    const x1 = Math.max(s.santaX - 9 * s.santaDir, s.santaX + s.lead * s.santaDir)
    if (cx >= x0 - 6 && cx <= x1 + 6 && cy >= s.santaY - 48 && cy <= s.santaY + 22) {
      const now = performance.now()
      BURN.rudolph = now + BURN_MS; BURN.gifts = now + BURN_MS
      haptic('tap')
    }
  }

  return jsxs('div', {
    className: 'relative flex h-full flex-col',
    onPointerDown: onTap,
    children: [
      jsx('div', {
        style: { position: 'absolute', inset: 0 },
        children: jsx(SnowCanvas, { prefs, scene })
      }),
      jsxs('div', {
        className: 'relative z-10 m-4 flex flex-wrap items-end gap-4 rounded-lg p-4',
        style: { background: 'var(--chrome-panel-bg, rgba(0,0,0,0.35))', border: '1px solid var(--ui-stroke-secondary)' },
        children: [
          jsxs('div', { className: 'flex flex-col gap-1', children: [
            jsx('div', { className: 'text-base font-semibold', children: t('title') }),
            jsx('div', { className: 'text-xs', style: { color: 'var(--ui-text-secondary)' }, children: t('subtitle') })
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            t('snow'), jsx('input', { type: 'range', min: 0, max: 400, value: prefs.snow, onChange: e => update({ snow: +e.target.value }) })
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            t('speed'), jsx('input', { type: 'range', min: 0.25, max: 2.5, step: 0.25, value: prefs.speed, onChange: e => update({ speed: +e.target.value }) })
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            t('reindeer'), jsx('input', { type: 'range', min: 1, max: 20, value: prefs.reindeer, onChange: e => update({ reindeer: +e.target.value }) })
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('input', { type: 'checkbox', checked: !!prefs.chonker, onChange: e => update({ chonker: e.target.checked }) }), t('chonker')
          ]}),
          prefs.chonker && jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            t('chonkerSize'), jsx('input', { type: 'range', min: 1, max: 10, value: prefs.chonkerSize, onChange: e => update({ chonkerSize: +e.target.value }) })
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('input', { type: 'checkbox', checked: !!prefs.santa, onChange: e => update({ santa: e.target.checked }) }), t('santa')
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('input', { type: 'checkbox', checked: !!prefs.tree, onChange: e => update({ tree: e.target.checked }) }), t('tree')
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('input', { type: 'checkbox', checked: !!prefs.oops, onChange: e => update({ oops: e.target.checked }) }), t('oops')
          ]}),
          jsxs('label', { className: 'flex items-center gap-2 text-xs', children: [
            jsx('input', { type: 'checkbox', checked: prefs.overlay !== false, onChange: e => update({ overlay: e.target.checked }) }), t('overlayAll')
          ]}),
          jsx(Button, {
            size: 'sm', variant: 'outline',
            onClick: () => { haptic('tap'); host.notify({ kind: 'info', message: t('runHint') }) },
            children: t('launch')
          })
        ]
      })
    ]
  })
}

// ---- statusbar chip ---------------------------------------------------------
function SnowChip({ ctx }) {
  const t = usePluginI18n(ID)
  const on = useValue($overlayOn)
  return jsx(Tip, {
    label: t('chipTip'),
    children: jsx('button', {
      type: 'button',
      className: 'inline-flex h-full items-center px-1.5 text-[0.6875rem] hover:text-foreground',
      style: { color: on ? 'var(--ui-accent)' : 'var(--ui-text-tertiary)' },
      onClick: () => { haptic('tap'); toggleOverlay() },
      children: on ? '❄️ xsnow' : '☀️ xsnow'
    })
  })
}

export default {
  id: ID, // must match folder name
  name: 'XSnow Christmas',
  register(ctx) {
    syncPrefs(ctx)
    ctx.i18n.register({
      en: {
        title: '❄️ XSnow Christmas Overlay',
        subtitle: 'Snow + Santa sleigh overlay every chat window (Wayland-safe). Real xsnow binary is installed — run `xsnow` in a terminal for the classic X11 version.',
        snow: 'Snowfall', speed: 'Speed', reindeer: 'Reindeer', chonker: 'Chonker mode', chonkerSize: 'Chonker size', santa: 'Santa sleigh', tree: 'Trees', oops: 'Oops mode', overlayAll: 'Overlay all windows',
        launch: 'Run real xsnow',
        runHint: 'Open a terminal and run: xsnow   (add -above for snow over windows)',
        chipTip: 'Toggle snow overlay on all windows',
        toggleTip: 'Toggle snow overlay',
        nav: 'XSnow'
      }
    })

    // Permanent global overlay — titlebar slot stays mounted across chat/page navigation
    ctx.register({
      id: 'overlay', area: TITLEBAR_AREAS.center,
      render: () => jsx(Overlay, {})
    })
    ctx.register({
      id: 'titlebar-toggle', area: TITLEBAR_AREAS.right,
      render: () => jsx(TitlebarToggle, {})
    })

    // Full-page overlay canvas
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/xsnow' },
      render: () => jsx(XsnowPage, { ctx })
    })
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: '/xsnow', label: '❄️ XSnow', codicon: 'sparkle' }
    })
    // Palette commands
    ctx.register({
      id: 'cmd',
      area: PALETTE_AREA,
      data: { id: 'xsnow.open', label: 'XSnow: open Christmas overlay', keywords: ['xsnow', 'christmas', 'snow', 'santa'], run: () => host.navigate('/xsnow') }
    })
    ctx.register({
      id: 'cmd-toggle',
      area: PALETTE_AREA,
      data: { id: 'xsnow.toggle', label: 'XSnow: toggle overlay on all windows', keywords: ['xsnow', 'toggle', 'overlay'], run: () => toggleOverlay() }
    })
    ctx.register({
      id: 'cmd-fire',
      area: PALETTE_AREA,
      data: { id: 'xsnow.fire', label: 'XSnow: set Rudolph and presents on fire', keywords: ['xsnow', 'fire', 'burn', 'rudolph', 'santa'], run: () => { const now = performance.now(); BURN.rudolph = now + BURN_MS; BURN.gifts = now + BURN_MS } }
    })
    // Statusbar chip
    ctx.register({
      id: 'chip', area: STATUSBAR_AREAS.right, order: 140,
      render: () => jsx(SnowChip, { ctx })
    })
  }
}
