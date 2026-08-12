import Image from "next/image"

interface LogoProps {
  size?: number
  className?: string
  priority?: boolean
}

/**
 * Brand logo — renders /logo.png (the company's official mark).
 * Used across the sidebar, auth pages, and landing.
 */
export function Logo({ size = 24, className, priority = false }: LogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="Elite Development"
      width={size}
      height={size}
      priority={priority}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}

interface LogoMarkProps {
  size?: number
  showIndicator?: boolean
  className?: string
}

/**
 * Rounded brand mark with an optional online-status indicator.
 * Used on auth pages and the landing hero.
 */
export function LogoMark({ size = 40, showIndicator = false, className }: LogoMarkProps) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 shadow-lg shadow-elite-blue-500/20 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/logo.png"
        alt="Elite Development"
        width={size}
        height={size}
        priority
        className="rounded-2xl object-cover"
        style={{ width: size, height: size }}
      />
      {showIndicator && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-white dark:border-elite-blue-900" />
      )}
    </div>
  )
}
