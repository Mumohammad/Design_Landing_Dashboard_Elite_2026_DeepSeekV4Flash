"use client"

import { recordPlatformCardPrints } from "@/app/actions/drivers/platform-accounts"

/** Opens a print window for rider cards and waits for fonts/photos. */
export async function printRiderCards(html: string | (() => Promise<string>)): Promise<boolean> {
  const popup = window.open("", "_blank", "width=760,height=620")
  if (!popup) return false
  let timeout: number | undefined
  try {
    // Open synchronously from the click, then prepare private photos before output.
    const output = typeof html === "function" ? await html() : html
    if (popup.closed) throw new Error("Print window was closed")
    popup.document.write(output)
    popup.document.close()
    await Promise.race([
      Promise.all([popup.document.fonts.ready, ...Array.from(popup.document.images, (image) => image.decode().catch(() => undefined))]),
      new Promise((resolve) => { timeout = window.setTimeout(resolve, 6000) }),
    ])
    popup.focus()
    popup.print()
    return true
  } catch (error) {
    popup.close()
    throw error
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

/** Records a successful platform card print, then notifies print-log listeners. */
export function logPlatformCardPrint(driverId: string, cards: { platform_code: string; rider_id: string | null }[], format: "pvc" | "a4" | "pdf") {
  void recordPlatformCardPrints({ driverId, cards, format }).then((r) => {
    if (r.ok && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("platform-card-printed", { detail: { driverId } }))
  })
}
