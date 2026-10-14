/** Use a window opened synchronously from the user's click to avoid popup blocking. */
export async function printDocument(target: Window, html: string): Promise<void> {
  target.document.open()
  target.document.write(html)
  target.document.close()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all([
        target.document.fonts.ready,
        ...Array.from(target.document.images, (image) => image.decode()),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Invoice images or fonts did not finish loading. Try again.")), 15_000)
      }),
    ])
    if (target.closed) throw new Error("The invoice preview was closed.")
    target.focus()
    target.print()
  } finally { clearTimeout(timer) }
}
