import { createHash, randomBytes } from "crypto"

/** 256-bit random portal token (64 hex chars). Only its SHA-256 hash is stored. */
export function generatePortalToken(): string { return randomBytes(32).toString("hex") }
export function hashPortalToken(token: string): string { return createHash("sha256").update(token).digest("hex") }
export function isPortalToken(token: string): boolean { return /^[0-9a-f]{64}$/.test(token) }
