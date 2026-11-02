"use client"

import { recordPlatformCardPrints } from "@/app/actions/drivers/platform-accounts"

/** Opens a print window for rider cards and waits for fonts/photos. */
export async function printRiderCards(html: string): Promise<boolean> {
  const popup = window.open("", "_blank", "width=760,height=620")
  if (!popup) return false
  popup.document.write(html)
  popup.document.close()
  let timeout: number | undefined
  try {
    await Promise.race([
      Promise.all([popup.document.fonts.ready, ...Array.from(popup.document.images, (image) => image.decode().catch(() => undefined))]),
      new Promise((resolve) => { timeout = window.setTimeout(resolve, 6000) }),
    ])
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
  popup.focus()
  popup.print()
  return true
}

/** Records a successful platform card print, then notifies print-log listeners. */
export function logPlatformCardPrint(driverId: string, cards: { platform_code: string; rider_id: string | null }[], format: "pvc" | "a4" | "pdf") {
  void recordPlatformCardPrints({ driverId, cards, format }).then((r) => {
    if (r.ok && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("platform-card-printed", { detail: { driverId } }))
  })
}
