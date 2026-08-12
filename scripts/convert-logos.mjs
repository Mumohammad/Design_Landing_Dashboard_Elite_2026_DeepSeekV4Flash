import { readFileSync, writeFileSync } from "node:fs"
import sharp from "sharp"

const DIR = "C:/Users/Zbook/Downloads/shadcn-dashboard-landing-template-main (1)/shadcn-dashboard-landing-template-main/nextjs-version/public/platform-logos"
const names = ["hungerstation", "jahez", "keeta", "toyou", "mrsool", "ninja"]

for (const n of names) {
  const buf = readFileSync(`${DIR}/${n}.png`)
  const meta = await sharp(buf).metadata()
  if (meta.format === "jpeg") {
    const png = await sharp(buf).png().toBuffer()
    writeFileSync(`${DIR}/${n}.png`, png)
    console.log(`converted ${n}.png (was ${meta.format})`)
  } else {
    console.log(`ok ${n}.png (${meta.format})`)
  }
}
