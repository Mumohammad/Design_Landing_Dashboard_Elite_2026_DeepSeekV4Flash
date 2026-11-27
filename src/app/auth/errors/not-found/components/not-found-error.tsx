"use client"

import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { BilingualText } from "@/components/localized-text"
import { REDIRECTS } from "@/lib/redirects"

export function NotFoundError() {
  const router = useRouter()

  return (
    <div className='mx-auto flex w-full flex-col items-center gap-5 rounded-lg border border-border bg-card p-6 sm:p-8'>
      <ShieldAlert className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <div className='text-center'>
        <h1 className='mb-3 text-sm font-medium tabular-nums text-muted-foreground'>404</h1>
        <h2 className="mb-3 text-2xl font-semibold leading-snug"><BilingualText ar="الصفحة غير موجودة" en="Page Not Found" /></h2>
        <p className="text-sm leading-6 text-muted-foreground"><BilingualText ar="الصفحة المطلوبة غير موجودة أو تم نقلها." en="The page you are looking for doesn't exist or has been moved to another location." /></p>
        <div className='mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row'>
          <Button className='cursor-pointer' onClick={() => router.push(REDIRECTS.dashboardUrl)}><BilingualText ar="العودة للرئيسية" en="Go Back Home" /></Button>
          <Button variant='outline' className='flex cursor-pointer items-center gap-1' onClick={() => router.push('/help')}>
            <BilingualText ar="تواصل معنا" en="Contact Us" />
          </Button>
        </div>
      </div>
    </div>
  )
}
