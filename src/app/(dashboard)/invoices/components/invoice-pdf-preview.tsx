"use client"

import { useEffect, useRef, useState } from "react"
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask } from "pdfjs-dist"
import { Button } from "@/components/ui/button"

export function InvoicePdfPreview({ blob, ar }: { blob: Blob; ar: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [renderedPage, setRenderedPage] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let worker: Worker | undefined
    let pdfWorker: PDFWorker | undefined
    let loading: PDFDocumentLoadingTask | undefined
    let deadline: number | undefined
    let stopped = false
    function stopWorker() {
      window.clearTimeout(deadline)
      if (stopped) return
      stopped = true
      pdfWorker?.destroy()
      worker?.terminate()
    }
    function fail() {
      stopWorker()
      if (!disposed) setFailed(true)
    }
    async function open() {
      try {
        const [pdfjs, bytes] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          blob.arrayBuffer(),
        ])
        if (disposed) return
        worker = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url), { type: "module" })
        worker.addEventListener("error", fail, { once: true })
        deadline = window.setTimeout(fail, 20_000)
        pdfWorker = pdfjs.PDFWorker.create({ port: worker })
        loading = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          worker: pdfWorker,
          useWasm: false,
          disableFontFace: true,
        })
        const document = await loading.promise
        if (!disposed && !stopped) {
          window.clearTimeout(deadline)
          setPdf(document)
        }
      } catch {
        fail()
      }
    }
    void open()
    return () => {
      disposed = true
      window.clearTimeout(deadline)
      if (loading && !stopped) {
        deadline = window.setTimeout(stopWorker, 1000)
        void loading.destroy().catch(() => undefined).finally(stopWorker)
      } else {
        stopWorker()
      }
    }
  }, [blob])

  useEffect(() => {
    if (!pdf) return
    let disposed = false
    let rendering: RenderTask | undefined
    async function render(document: PDFDocumentProxy) {
      try {
        const sheet = await document.getPage(page)
        const element = canvas.current
        if (disposed || !element) return
        const original = sheet.getViewport({ scale: 1 })
        const scale = Math.min(2, 1600 / Math.max(original.width, original.height))
        const viewport = sheet.getViewport({ scale })
        element.width = Math.ceil(viewport.width)
        element.height = Math.ceil(viewport.height)
        rendering = sheet.render({ canvas: element, viewport })
        await rendering.promise
        if (!disposed) setRenderedPage(page)
      } catch {
        if (!disposed) setFailed(true)
      }
    }
    void render(pdf)
    return () => {
      disposed = true
      rendering?.cancel()
    }
  }, [page, pdf])

  if (failed) return <p role="alert" className="text-sm text-destructive">
    {ar ? "تعذر عرض المعاينة هنا. نزّل ملف PDF لفتحه أو طباعته." : "Could not display the preview here. Download the PDF to open or print it."}
  </p>

  const ready = renderedPage === page
  const pageLabel = ar ? `صفحة الفاتورة ${page} من ${pdf?.numPages}` : `Invoice page ${page} of ${pdf?.numPages}`
  return <section className="space-y-2" aria-busy={!ready}>
    {pdf && pdf.numPages > 1 && <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{pageLabel}</span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={page === 1 || !ready} onClick={() => setPage(page - 1)}>{ar ? "السابق" : "Previous"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={page === pdf.numPages || !ready} onClick={() => setPage(page + 1)}>{ar ? "التالي" : "Next"}</Button>
      </div>
    </div>}
    <div className="relative overflow-hidden rounded-md border bg-muted p-2 sm:p-4">
      {!ready && <p role="status" className="absolute inset-x-3 top-3 text-sm text-muted-foreground">{ar ? "جارٍ عرض الفاتورة…" : "Rendering invoice…"}</p>}
      <canvas ref={canvas} role={ready ? "img" : undefined} aria-label={ready ? pageLabel : undefined}
        aria-hidden={!ready} className={ready ? "mx-auto block h-auto w-full max-w-[44rem] bg-white" : "invisible block h-20 w-full"} />
    </div>
  </section>
}
