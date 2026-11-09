"use client"

import { useEffect, useRef, useState } from "react"
import { Eraser } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Touch/mouse signature canvas. Calls onChange(hasInk). Use ref.current.toBlob(). */
export function SignaturePad({ canvasRef, onChange, label }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; onChange: (hasInk: boolean) => void; label: string }) {
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = Math.round(rect.width * ratio)
    c.height = Math.round(rect.height * ratio)
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#0f172a"
  }, [canvasRef])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = point(e) }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return
    const ctx = e.currentTarget.getContext("2d")
    if (!ctx) return
    const p = point(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
    if (!hasInk) { setHasInk(true); onChange(true) }
  }
  const up = () => { drawing.current = false; last.current = null }
  const clear = () => {
    const c = canvasRef.current
    const ctx = c?.getContext("2d")
    if (c && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore() }
    setHasInk(false); onChange(false)
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-dashed bg-white">
        <canvas ref={canvasRef} aria-label={label} role="img" className="h-40 w-full touch-none rounded-xl"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        {!hasInk && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">{label}</span>}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-slate-300" />
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={clear}><Eraser className="me-1.5 size-4" />Clear · مسح</Button>
    </div>
  )
}
