/** Select the most specific internal link, including its required query values. */
export function activeNavigationUrl(pathname: string, query: string, urls: string[]): string | null {
  const current = new URLSearchParams(query)
  let selected: string | null = null
  let specificity = -1
  for (const url of urls) {
    if (!url.startsWith("/") || url.startsWith("//")) continue
    const target = new URL(url, "https://navigation.invalid")
    const base = target.pathname.length > 1 ? target.pathname.replace(/\/$/, "") : target.pathname
    if (pathname !== base && (base === "/" || !pathname.startsWith(`${base}/`))) continue
    const required = [...target.searchParams]
    if (!required.every(([key, value]) => current.get(key) === value)) continue
    const rank = base.length * 1024 + required.length
    if (rank > specificity) { selected = url; specificity = rank }
  }
  return selected
}
