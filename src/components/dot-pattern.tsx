/**
 * Decorative dot patterns were removed in the Taste Skill design pass
 * (no decorative patterns). The components remain as no-ops so existing
 * imports keep compiling.
 */
type DotPatternProps = {
  className?: string
  size?: "sm" | "md" | "lg"
  opacity?: "low" | "medium" | "high"
  fadeStyle?: "ellipse" | "circle" | "none"
}

export function DotPattern(_props: DotPatternProps) {
  return null
}

export function DotPatternLight(_props: DotPatternProps) {
  return null
}

export function DotPatternDark(_props: DotPatternProps) {
  return null
}
