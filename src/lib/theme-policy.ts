export function oppositeTheme(theme: "light" | "dark" | "system", systemDark: boolean): "light" | "dark" {
  const isDark = theme === "dark" || (theme === "system" && systemDark)
  return isDark ? "light" : "dark"
}
