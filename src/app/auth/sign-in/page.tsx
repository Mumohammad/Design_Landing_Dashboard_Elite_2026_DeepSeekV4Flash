"use client"

import { LogoMark } from "@/components/logo"
import { LoginForm1 } from "./components/login-form-1"
import { useTranslation } from "@/hooks/use-translation"

export default function Page() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <div className="stagger-1 flex justify-center">
        <LogoMark size={56} showIndicator />
      </div>
      <LoginForm1 />
      <div className="stagger-5 text-center text-xs text-muted-foreground">
        <a href="/privacy" className="underline underline-offset-4 hover:text-foreground transition-colors">
          {t.footer.privacyPolicy}
        </a>
        {" · "}
        <a href="/terms" className="underline underline-offset-4 hover:text-foreground transition-colors">
          {t.footer.termsOfService}
        </a>
        {" · "}
        <a href="/help" className="underline underline-offset-4 hover:text-foreground transition-colors">
          {t.footer.helpSupport}
        </a>
      </div>
    </div>
  )
}
