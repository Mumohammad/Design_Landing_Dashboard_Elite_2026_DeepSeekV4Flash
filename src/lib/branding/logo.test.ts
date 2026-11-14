import { describe, expect, it, vi } from "vitest"
import sharp from "sharp"

vi.mock("server-only", () => ({}))
import { LogoValidationError, normalizeLogo } from "./logo"

describe("normalizeLogo", () => {
  it("re-encodes a large JPEG to a ≤512px PNG", async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#1E5A99" } }).jpeg().toBuffer()
    const png = await normalizeLogo(jpeg)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe("png")
    expect(meta.width).toBe(512)
    expect(meta.height).toBe(256)
  })

  it("rejects SVG and corrupt images", async () => {
    await expect(normalizeLogo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toBeInstanceOf(LogoValidationError)
    await expect(normalizeLogo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).rejects.toBeInstanceOf(LogoValidationError)
  })
})

const T="11111111-2222-3333-4444-555555555555",A="22222222-2222-3333-4444-555555555555",R="33333333-2222-3333-4444-555555555555"
const legacyPath=`${T}/logo-0123456789abcdef.png`
function storageClient(blob:Blob|null){
 const download=vi.fn(async()=>({data:blob,error:null})),upload=vi.fn(async()=>({data:null,error:null})),remove=vi.fn(),list=vi.fn(),from=vi.fn()
 const bucket={download,upload,remove,list,getPublicUrl:(path:string)=>({data:{publicUrl:`http://127.0.0.1:54321/storage/v1/object/public/company-assets/${path}`}})}
 return {client:{storage:{from:()=>bucket},from} as unknown as import("@supabase/supabase-js").SupabaseClient,bucket,from}
}
it("stages immutable caller storage without tenant updates or object cleanup",async()=>{
 const {stageTenantLogo}=await import("./logo");const png=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer();const m=storageClient(null)
 const path=await stageTenantLogo(m.client,T,A,R,png)
 expect(path).toMatch(new RegExp(`^${T}/logos/${A}/${R}/logo-[0-9a-f]{16}[.]png$`))
 expect(m.bucket.upload).toHaveBeenCalledWith(path,png,expect.objectContaining({upsert:false,contentType:"image/png"}))
 expect(m.from).not.toHaveBeenCalled();expect(m.bucket.remove).not.toHaveBeenCalled();expect(m.bucket.list).not.toHaveBeenCalled()
})
it("exact immutable upload retries verify stored bytes before accepting a duplicate",async()=>{
 const {stageTenantLogo}=await import("./logo");const png=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer();const m=storageClient(new Blob([new Uint8Array(png)]))
 m.bucket.upload.mockResolvedValue({data:null,error:{statusCode:"409"}} as never)
 await expect(stageTenantLogo(m.client,T,A,R,png)).resolves.toContain("/logos/")
 m.bucket.download.mockResolvedValue({data:new Blob([new Uint8Array(png).fill(0)]),error:null})
 await expect(stageTenantLogo(m.client,T,A,R,png)).rejects.toThrow("SETTINGS_UNAVAILABLE")
 expect(m.bucket.remove).not.toHaveBeenCalled()
})
it("loads a valid bounded PNG using configured Storage only",async()=>{
 const {loadTenantLogoDataUrl}=await import("./logo");const png=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer();const m=storageClient(new Blob([new Uint8Array(png)]))
 expect(await loadTenantLogoDataUrl(m.client,T,`http://127.0.0.1:54321/storage/v1/object/public/company-assets/${legacyPath}`)).toMatch(/^data:image\/png;base64,/)
 expect(m.bucket.download).toHaveBeenCalledWith(legacyPath)
 m.bucket.download.mockClear()
 expect(await loadTenantLogoDataUrl(m.client,T,`https://evil.test/storage/v1/object/public/company-assets/${legacyPath}`)).toBeNull()
 expect(await loadTenantLogoDataUrl(m.client,T,null,legacyPath.replace(T,A))).toBeNull()
 expect(m.bucket.download).not.toHaveBeenCalled()
})
it("rejects oversized stored blobs before buffering and ignores invalid PNG pixels",async()=>{
 const {loadTenantLogoDataUrl}=await import("./logo");const arrayBuffer=vi.fn();const m=storageClient({size:524289,arrayBuffer} as unknown as Blob)
 expect(await loadTenantLogoDataUrl(m.client,T,null,legacyPath)).toBeNull();expect(arrayBuffer).not.toHaveBeenCalled()
 for(const bytes of [Buffer.from([137,80,78,71,13,10,26,10,1,2]),await sharp({create:{width:1024,height:2,channels:3,background:"red"}}).png().toBuffer()]){
  m.bucket.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes)]),error:null});expect(await loadTenantLogoDataUrl(m.client,T,null,legacyPath)).toBeNull()
 }
})
