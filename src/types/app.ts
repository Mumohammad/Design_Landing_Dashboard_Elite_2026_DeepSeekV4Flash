export type Locale = "ar" | "en"

export type User = {
  id: string
  name: string
  email: string
  role: string
  locale: Locale
}

export type Tenant = {
  id: string
  name: string
  defaultLocale: Locale
}
