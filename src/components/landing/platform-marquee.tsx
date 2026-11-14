"use client"

import Image from "next/image"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading } from "./shared"

const platforms = [
  { name: "HungerStation", src: "/platform-logos/hungerstation.png", width: 512, height: 512 },
  { name: "Jahez", src: "/platform-logos/jahez.png", width: 512, height: 512 },
  { name: "Keeta", src: "/platform-logos/keeta.png", width: 512, height: 512 },
  { name: "Mrsool", src: "/platform-logos/mrsool.png", width: 512, height: 512 },
  { name: "Ninja", src: "/platform-logos/ninja.png", width: 512, height: 512 },
  { name: "ToYou", src: "/platform-logos/toyou.png", width: 512, height: 512 },
  { name: "Noon", src: "/platform-logos/noon.svg", width: 800, height: 372 },
  { name: "Keemart", src: "/platform-logos/keemart.png", width: 512, height: 512 },
]

export function PlatformMarquee() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="platforms" className="scroll-mt-8 bg-muted py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading tag={c.platforms.tag} title={locale === "ar" ? "عبر منصات التوصيل." : "Across delivery platforms."} subtitle={c.platforms.subtitle} />
        <Reveal className="mt-12">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-4 lg:grid-cols-8">{platforms.map(platform => <li key={platform.name} className="flex flex-col items-start gap-4">
            <Image src={platform.src} alt="" width={platform.width} height={platform.height} className="h-12 w-16 object-contain object-left" sizes="64px" unoptimized={platform.src.endsWith('.svg')} />
            <span className="text-base font-medium">{platform.name}</span>
          </li>)}</ul>
        </Reveal>
      </div>
    </section>
  )
}
