"use client"

import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { BilingualText } from "@/components/localized-text"
import { REDIRECTS } from "@/lib/redirects"

export function UnderMaintenanceError() {
  const router = useRouter()

  return (
    <div className='mx-auto flex min-h-dvh flex-col items-center justify-center gap-8 p-8 md:gap-12 md:p-16'>
      <ShieldAlert className="h-20 w-20 text-muted-foreground" aria-hidden="true" />
      <div className='text-center'>
        <h1 className='mb-4 text-3xl font-bold'>503</h1>
        <h2 className="mb-3 text-2xl font-semibold"><BilingualText ar="تحت الصيانة" en="Under Maintenance" /></h2>
        <p><BilingualText ar="الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا." en="The service is currently unavailable. Please try again later." /></p>
        <div className='mt-6 flex items-center justify-center gap-4 md:mt-8'>
          <Button className='cursor-pointer' onClick={() => router.push(REDIRECTS.dashboardUrl)}><BilingualText ar="العودة للرئيسية" en="Go Back Home" /></Button>
          <Button variant='outline' className='flex cursor-pointer items-center gap-1' onClick={() => router.push('/help')}>
            <BilingualText ar="تواصل معنا" en="Contact Us" />
          </Button>
        </div>
      </div>
    </div>
  )
}
