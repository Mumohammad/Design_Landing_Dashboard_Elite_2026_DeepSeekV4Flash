"use client"

import Image from 'next/image'
import { cn } from "@/lib/utils"

interface Image3DProps {
  lightSrc: string
  darkSrc: string
  alt: string
  className?: string
  direction?: "left" | "right"
}

export function Image3D({
  lightSrc,
  darkSrc,
  alt,
  className,
  direction = "left"
}: Image3DProps) {
  const isRight = direction === "right"

  return (
    <div className={cn("group relative aspect-[4/3] w-full", className)}>
      <div className="perspective-distant transform-3d">

        {/* Main 3D container */}
        <div className="relative size-full transform-3d group-hover:rotate-x-8 group-hover:rotate-y-12 group-hover:translate-z-16 transition-all duration-700 ease-out">

          {/* Depth layers for 3D effect */}
          <div className="absolute inset-0 translate-y-4 translate-x-2 -translate-z-8 rounded-2xl">
            <div className="size-full rounded-2xl bg-primary/10" />
          </div>

          {/* Main image container */}
          <div className="relative z-10 size-full rounded-2xl overflow-hidden shadow-primary/20">
            {/* Shimmer effect */}
            <div className={cn(
              "absolute inset-0 z-20 bg-transparent -skew-x-12 transition-transform duration-1000 ease-out pointer-events-none",
              isRight
                ? "translate-x-full group-hover:-translate-x-full"
                : "-translate-x-full group-hover:translate-x-full"
            )} />

            {/* Content fade mask */}
            <div className={cn(
              "absolute inset-0 z-15 pointer-events-none",
              isRight
                ? "bg-background"
                : "bg-background"
            )} />

            {/* Theme-aware images */}
            <Image
              src={lightSrc}
              alt={`${alt} - Light Mode`}
              width={800}
              height={600}
              className={cn(
                "block size-full object-cover dark:hidden transition-transform duration-700 group-hover:scale-105",
                isRight ? "object-center" : "object-left"
              )}
              loading="lazy"
            />

            <Image
              src={darkSrc}
              alt={`${alt} - Dark Mode`}
              width={800}
              height={600}
              className={cn(
                "hidden dark:block size-full object-cover transition-transform duration-700 group-hover:scale-105",
                isRight ? "object-center" : "object-left"
              )}
              loading="lazy"
            />

            {/* Border highlight */}
            <div className="absolute inset-0 rounded-2xl ring-1 ring-white/20 dark:ring-white/10 group-hover:ring-primary/40 transition-all duration-500" />
          </div>
        </div>
      </div>
    </div>
  )
}
