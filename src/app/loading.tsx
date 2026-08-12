import Image from "next/image"

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background">
      <div className="relative">
        {/* Soft brand glow behind the splash */}
        <div className="absolute -inset-10 rounded-full bg-gradient-to-tr from-elite-blue-500/20 via-transparent to-elite-orange-500/20 blur-2xl" />
        <Image
          src="/Splash.png"
          alt="نخبة التطوير"
          width={1377}
          height={768}
          priority
          className="relative h-auto w-64 rounded-2xl object-contain shadow-2xl shadow-elite-blue-900/10 sm:w-80"
        />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-elite-blue-500 border-t-transparent" />
        Loading...
      </div>
    </div>
  )
}
