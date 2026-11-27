import "server-only"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type ReceiptPrimitive = { text: string; xml: string | null; qr: string | null }
type Status = "complete" | "invalid" | "busy" | "timeout" | "memory_limit" | "unavailable"
export type ReceiptProcessResult = { status: Status; value: ReceiptPrimitive | null; processExited: boolean; ready: boolean; peakRssBytes: number }
const MAX_RSS = 256 * 1024 * 1024
let active = 0

function validPrimitive(value: unknown): value is ReceiptPrimitive {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join() === "qr,text,xml" && typeof row.text === "string" && row.text.length <= 60000 && (row.xml === null || typeof row.xml === "string" && row.xml.length <= 262144 && !/<!DOCTYPE|<!ENTITY/i.test(row.xml)) && (row.qr === null || typeof row.qr === "string" && /^[A-Za-z0-9+/=\s]{20,4000}$/.test(row.qr))
}

/** Runs a trusted worker entrypoint, with untrusted bytes only in IPC. The
 * optional entrypoint is for isolated lifecycle verification, never request data.
 * Linux RSS sampling is a polling guard, not an OS sandbox or zero-burst limit. */
export async function runReceiptProcess(bytes: Uint8Array, mime: string, timeoutMs = 20000, workerFile = path.join(process.cwd(), "workers", "receipt-extract.cjs")): Promise<ReceiptProcessResult> {
  const stopped = (status: Status): ReceiptProcessResult => ({ status, value: null, processExited: false, ready: false, peakRssBytes: 0 })
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024 || !/^(?:application\/pdf|(?:application|text)\/xml|image\/(?:jpeg|png|webp|heic|heif))$/.test(mime) || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 25000 || !path.isAbsolute(workerFile) || workerFile.includes("\0")) return stopped("invalid")
  if (active >= 1) return stopped("busy")
  active++
  return new Promise((resolve, reject) => {
    // Never inherit DB/API/provider credentials, NODE_OPTIONS, or preload hooks.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", TZ: "UTC" }
    for (const name of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name]
    let status: Status = "unavailable", value: ReceiptPrimitive | null = null, ready = false, peakRssBytes = 0, closed = false, settled = false, sampling = false, stopping = false
    let retirement: ReturnType<typeof setTimeout> | undefined
    let child: ReturnType<typeof spawn>
    try { child = spawn(process.execPath, ["--max-old-space-size=128", "--max-semi-space-size=8", workerFile], { env, windowsHide: true, shell: false, stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced" }) }
    catch { active--; resolve(stopped("unavailable")); return }
    const deadline = setTimeout(() => stop("timeout"), timeoutMs)
    const sample = setInterval(async () => {
      if (process.platform !== "linux" || closed || sampling || !child.pid) return
      sampling = true
      try {
        const stat = await readFile(`/proc/${child.pid}/status`, "utf8")
        const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(stat)
        if (match) usage(Number(match[1]) * 1024)
        else if (!closed) stop("unavailable")
      } catch (error) {
        // A just-exited PID disappears before close. Other failures must not
        // leave a running Linux parser without its configured RSS guard.
        if (!closed && (error as NodeJS.ErrnoException).code !== "ENOENT") stop("unavailable")
      } finally { sampling = false }
    }, 25)
    function stop(reason: Status) {
      if (closed || stopping) return
      stopping = true; status = reason
      if (reason !== "complete") value = null
      try { child.kill("SIGKILL") } catch { /* retirement still must be observed */ }
      retirement ??= setTimeout(() => {
        if (!closed && !settled) { settled = true; reject(new Error("RECEIPT_PARSER_RETIREMENT_UNCONFIRMED")) }
        // Keep the occupied slot until close; never launch more unknown work.
      }, 2000)
    }
    function usage(rss: number) {
      if (!Number.isFinite(rss) || rss < 0) { stop("unavailable"); return }
      peakRssBytes = Math.max(peakRssBytes, rss)
      if (rss > MAX_RSS) stop("memory_limit")
    }
    child.on("message", (message: unknown) => {
      if (closed || settled || stopping || !message || typeof message !== "object") return
      const row = message as Record<string, unknown>
      if ((row.type === "ready" || row.type === "usage") && typeof row.rss === "number") { if (row.type === "ready") ready = true; usage(row.rss); return }
      if (row.type === "result" && validPrimitive(row.value) && status === "unavailable") { value = row.value; status = "complete"; stop("complete"); return }
      stop("unavailable")
    })
    child.once("error", () => { if (!stopping) { status = "unavailable"; value = null } })
    child.once("close", () => {
      closed = true; active--; clearTimeout(deadline); clearTimeout(retirement); clearInterval(sample)
      if (!settled) { settled = true; resolve({ status, value: status === "complete" ? value : null, processExited: true, ready, peakRssBytes }) }
    })
    child.once("spawn", () => {
      if (stopping) { try { child.kill("SIGKILL") } catch { /* close remains required */ }; return }
      child.send({ bytes, mime }, error => { if (error) stop("unavailable") })
    })
  })
}
