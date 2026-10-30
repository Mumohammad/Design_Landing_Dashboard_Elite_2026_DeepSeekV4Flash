"use client"
// App-wide toast: identical to sonner's, except error messages are passed
// through friendlyError so database codes never reach users raw.
import { toast as base } from "sonner"
import { currentIsArabic, friendlyError } from "@/lib/errors/friendly"

type Toast = typeof base
const error: Toast["error"] = (message, data) =>
  base.error(typeof message === "string" ? friendlyError(message, currentIsArabic()) : message, data)

export const toast: Toast = Object.assign((...args: Parameters<Toast>) => base(...args), base, { error })
