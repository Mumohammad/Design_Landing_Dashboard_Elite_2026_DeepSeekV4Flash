"use client"

import Image from "next/image"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading } from "./shared"

interface Platform {
  name: string
  src: string
  width: number
  height: number
}

// Official delivery platforms the operation works across. Logos live in
// public/platform-logos (brand wordmarks / icons fetched from each site).
const platforms: Platform[] = [
  { name: "HungerStation", src: "/platform-logos/hungerstation.png", width: 512, height: 512 },
  { name: "Jahez", src: "/platform-logos/jahez.png", width: 512, height: 512 },
  { name: "Keeta", src: "/platform-logos/keeta.png", width: 512, height: 512 },
  { name: "Mrsool", src: "/platform-logos/mrsool.png", width: 512, height: 512 },
  { name: "Ninja", src: "/platform-logos/ninja.png", width: 512, height: 512 },
  { name: "ToYou", src: "/platform-logos/toyou.png", width: 512, height: 512 },
  { name: "Noon", src: "/platform-logos/noon.svg", width: 800, height: 372 },
  { name: "Keemart", src: "/platform-logos/keemart.png", width: 512, height: 512 },
]

function LogoChip({ platform }: { platform: Platform }) {
  const isSquare = platform.width === platform.height
  const isSvg = platform.src.endsWith(".svg")
  const imgClass = `${isSquare ? "h-9 w-9 rounded-lg object-contain" : "h-8 w-auto object-contain"}`
  return (
    <div className="group flex h-24 w-44 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-border/60 bg-white px-4 shadow-sm shadow-black/[0.03] transition-all duration-300 hover:-translate-y-1 hover:border-elite-blue-500/40 hover:shadow-lg hover:shadow-elite-blue-500/10 dark:bg-card animate-chip-glow">
      <span
        className={`flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ${
          isSquare ? "h-9 w-9" : "h-8 w-auto"
        }`}
      >
        {isSvg ? (
          // eslint-disable-next-line @next/next/no-img-element -- local SVG wordmark; next/image cannot optimize SVGs
          <img src={platform.src} alt={platform.name} width={platform.width} height={platform.height} className={imgClass} />
        ) : (
          <Image
            src={platform.src}
            alt={platform.name}
            width={platform.width}
            height={platform.height}
            className={imgClass}
            sizes="64px"
          />
        )}
      </span>
      <span className="text-center text-[11px] font-semibold text-muted-foreground transition-colors group-hover:text-elite-blue-600 group-hover:font-bold dark:group-hover:text-elite-blue-300">
        {platform.name}
      </span>
    </div>
  )
}

function MarqueeTrack() {
  // Two identical halves make the -50% translate loop perfectly seamless.
  return (
    <div dir="ltr" className="marquee-fade-edges overflow-hidden">
      <div className="animate-marquee-x flex w-max items-center gap-4 py-2">
        {[0, 1].map((half) => (
          <div key={half} aria-hidden={half === 1} className="flex items-center gap-4">
            {platforms.map((platform) => (
              <LogoChip key={`${half}-${platform.name}`} platform={platform} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PlatformMarquee() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="platforms" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-14">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.platforms.tag} title={c.platforms.title} subtitle={c.platforms.subtitle} />

        <Reveal delay={100} className="mt-10">
          <MarqueeTrack />
        </Reveal>
      </div>
    </section>
  )
}
