import { describe, expect, it } from "vitest"
import {
  DRIVER_PHOTO_BUCKET,
  DRIVER_PHOTO_MAX_BYTES,
  DRIVER_PHOTO_MIME_TYPES,
  driverPhotoImageMeta,
  driverPhotoPath,
  driverPhotoSafeName,
  isDriverPhotoObjectPath,
  isDriverPhotoPathValid,
} from "./photo"

const TENANT = "11111111-1111-1111-1111-111111111111"
const DRIVER = "22222222-2222-2222-2222-222222222222"

function makeFile(name: string, type: string, size = 1024): File {
  // Node 24: File is global. Blob part is irrelevant for meta resolution.
  return { name, type, size } as unknown as File
}

describe("driver photo constants", () => {
  it("matches the storage bucket name and its configured 5MB limit", () => {
    expect(DRIVER_PHOTO_BUCKET).toBe("driver-photos")
    expect(DRIVER_PHOTO_MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  it("excludes svg from the allowed image types", () => {
    expect(DRIVER_PHOTO_MIME_TYPES.has("image/svg+xml")).toBe(false)
  })
})

describe("driverPhotoImageMeta", () => {
  it("accepts explicit image mime types", () => {
    expect(driverPhotoImageMeta(makeFile("a.png", "image/png"))).toEqual({
      ok: true,
      contentType: "image/png",
    })
    expect(driverPhotoImageMeta(makeFile("a.webp", "image/webp"))).toEqual({
      ok: true,
      contentType: "image/webp",
    })
  })

  it("resolves mime from extension when the browser reports an empty type", () => {
    expect(driverPhotoImageMeta(makeFile("photo.heic", ""))).toEqual({
      ok: true,
      contentType: "image/heic",
    })
    expect(driverPhotoImageMeta(makeFile("PHOTO.JPG", ""))).toEqual({
      ok: true,
      contentType: "image/jpeg",
    })
  })

  it("rejects svg both by mime and extension", () => {
    expect(driverPhotoImageMeta(makeFile("evil.svg", "image/svg+xml")).ok).toBe(false)
    expect(driverPhotoImageMeta(makeFile("evil.svg", "")).ok).toBe(false)
  })

  it("rejects non-image types and extensions", () => {
    expect(driverPhotoImageMeta(makeFile("doc.pdf", "application/pdf")).ok).toBe(false)
    expect(driverPhotoImageMeta(makeFile("virus.exe", "")).ok).toBe(false)
    expect(driverPhotoImageMeta(makeFile("noext", "")).ok).toBe(false)
  })
})

describe("driverPhotoSafeName", () => {
  it("strips path separators and traversal dots", () => {
    expect(driverPhotoSafeName("../../etc/passwd.png")).toBe("etc-passwd.png")
    expect(driverPhotoSafeName("a/b\\c.png")).toBe("a-b-c.png")
    expect(driverPhotoSafeName("...png")).toBe("png")
  })

  it("falls back when the name cleans to empty", () => {
    expect(driverPhotoSafeName("///")).toBe("image.jpg")
    expect(driverPhotoSafeName("")).toBe("image.jpg")
  })
})

describe("driverPhotoPath", () => {
  it("builds a tenant/driver-prefixed path that passes validation", () => {
    const p = driverPhotoPath(TENANT, DRIVER, "Portrait Photo.PNG")
    expect(p).toMatch(new RegExp(`^${TENANT}/${DRIVER}/photo-\\d+-portrait-photo\\.png$`))
    expect(isDriverPhotoPathValid(p, TENANT, DRIVER)).toBe(true)
  })

  it("never produces cross-driver paths even with hostile file names", () => {
    const p = driverPhotoPath(TENANT, DRIVER, `../${DRIVER}-other/photo.png`)
    expect(isDriverPhotoPathValid(p, TENANT, DRIVER)).toBe(true)
  })
})

describe("isDriverPhotoPathValid", () => {
  it("rejects paths for a different driver or tenant (cross-driver isolation)", () => {
    const otherDriver = "33333333-3333-3333-3333-333333333333"
    expect(
      isDriverPhotoPathValid(`${TENANT}/${otherDriver}/photo-1-a.png`, TENANT, DRIVER),
    ).toBe(false)
    const otherTenant = "44444444-4444-4444-4444-444444444444"
    expect(
      isDriverPhotoPathValid(`${otherTenant}/${DRIVER}/photo-1-a.png`, TENANT, DRIVER),
    ).toBe(false)
  })

  it("rejects traversal and full URLs", () => {
    expect(isDriverPhotoPathValid(`${TENANT}/${DRIVER}/../x/photo-1-a.png`, TENANT, DRIVER)).toBe(
      false,
    )
    expect(isDriverPhotoPathValid("https://evil.example/x.png", TENANT, DRIVER)).toBe(false)
  })
})

describe("isDriverPhotoObjectPath", () => {
  it("treats bucket paths as deletable objects", () => {
    expect(isDriverPhotoObjectPath(`${TENANT}/${DRIVER}/photo-1-a.png`)).toBe(true)
  })

  it("treats legacy full URLs and empties as non-objects", () => {
    expect(isDriverPhotoObjectPath("https://cdn.example/p.png")).toBe(false)
    expect(isDriverPhotoObjectPath("http://cdn.example/p.png")).toBe(false)
    expect(isDriverPhotoObjectPath("")).toBe(false)
    expect(isDriverPhotoObjectPath(null)).toBe(false)
    expect(isDriverPhotoObjectPath(undefined)).toBe(false)
  })
})
