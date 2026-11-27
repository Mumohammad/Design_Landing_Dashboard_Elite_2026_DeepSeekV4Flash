import {afterEach,beforeEach,expect,it,vi} from "vitest"
import {prepareLogoFile} from "./logo-client"
const close=vi.fn(),draw=vi.fn(),toDataURL=vi.fn()
beforeEach(()=>{
 vi.clearAllMocks();toDataURL.mockReturnValue("data:image/png;base64,iVBORw0KGgo=")
 vi.stubGlobal("createImageBitmap",vi.fn(async()=>({width:512,height:512,close})))
 vi.stubGlobal("document",{createElement:()=>({width:0,height:0,getContext:()=>({drawImage:draw}),toDataURL})})
})
afterEach(()=>vi.unstubAllGlobals())
it("iteratively reduces complex PNG output below the action transport bound",async()=>{
 toDataURL.mockReturnValueOnce("data:image/png;base64,"+"A".repeat(700000))
 const result=await prepareLogoFile(new File(["image"],"logo.png",{type:"image/png"}))
 expect(result.ok).toBe(true);expect(toDataURL).toHaveBeenCalledTimes(2)
 expect(draw.mock.calls.map(call=>call.slice(-2))).toEqual([[512,512],[384,384]])
 expect(close).toHaveBeenCalledOnce()
})
it("closes decoded bitmap when canvas is unavailable or encoding throws",async()=>{
 vi.stubGlobal("document",{createElement:()=>({getContext:()=>null})})
 expect(await prepareLogoFile(new File(["image"],"logo.png",{type:"image/png"}))).toMatchObject({ok:false,error:"decode"});expect(close).toHaveBeenCalledOnce()
 vi.stubGlobal("document",{createElement:()=>({getContext:()=>({drawImage:()=>{throw new Error("decode")}})})})
 await prepareLogoFile(new File(["image"],"logo.png",{type:"image/png"}));expect(close).toHaveBeenCalledTimes(2)
})
it("rejects unsafe file types and excessive pixel counts",async()=>{
 expect(await prepareLogoFile(new File(["image"],"logo.svg",{type:"image/svg+xml"}))).toMatchObject({ok:false,error:"type"})
 vi.stubGlobal("createImageBitmap",vi.fn(async()=>({width:9000,height:9000,close})))
 expect(await prepareLogoFile(new File(["image"],"logo.png",{type:"image/png"}))).toMatchObject({ok:false,error:"size"});expect(close).toHaveBeenCalledOnce()
})
