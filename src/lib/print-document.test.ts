import { describe, expect, it, vi } from 'vitest'
import { printDocument } from './print-document'
function target(ready: Promise<unknown>, decode = vi.fn().mockResolvedValue(undefined)) {
 return { document: {open:vi.fn(),write:vi.fn(),close:vi.fn(),fonts:{ready},images:[{decode}]},
  closed:false,focus:vi.fn(),print:vi.fn() } as unknown as Window
}
describe('printDocument',()=>{
 it('waits for fonts and images before opening print',async()=>{
  let loaded!: () => void
  const win=target(new Promise<void>(resolve=>{loaded=resolve}))
  const task=printDocument(win,'<p>invoice</p>')
  expect(win.print).not.toHaveBeenCalled()
  loaded();await task
  expect(win.document.write).toHaveBeenCalledWith('<p>invoice</p>')
  expect(win.print).toHaveBeenCalledOnce()
 })
 it('does not print missing assets',async()=>{
  const win=target(Promise.resolve(),vi.fn().mockRejectedValue(new Error('Image missing')))
  await expect(printDocument(win,'')).rejects.toThrow('Image missing')
  expect(win.print).not.toHaveBeenCalled()
 })
 it('does not print a closed preview',async()=>{
  const win=target(Promise.resolve())
  Object.defineProperty(win,'closed',{value:true})
  await expect(printDocument(win,'')).rejects.toThrow('closed')
  expect(win.print).not.toHaveBeenCalled()
 })
})
