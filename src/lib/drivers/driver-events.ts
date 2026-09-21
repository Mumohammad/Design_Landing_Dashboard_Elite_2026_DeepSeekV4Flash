"use client";

const DRIVER_CHANGED_EVENT = "elitedev:driver-changed";

export type DriverChangedDetail = {
  driverId?: string;
  action?: "status" | "archive" | "photo" | "document" | "leave" | "profile";
};

export function emitDriverChanged(detail: DriverChangedDetail | string = {}) {
  if (typeof window === "undefined") return;
  // Allow a bare action string ("photo", "status"…) used by older callers.
  const payload: DriverChangedDetail =
    typeof detail === "string" ? { action: detail as DriverChangedDetail["action"] } : detail;
  window.dispatchEvent(new CustomEvent<DriverChangedDetail>(DRIVER_CHANGED_EVENT, { detail: payload }));
}

export function subscribeDriverChanged(handler: (detail: DriverChangedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<DriverChangedDetail>).detail ?? {});
  };
  window.addEventListener(DRIVER_CHANGED_EVENT, listener);
  return () => window.removeEventListener(DRIVER_CHANGED_EVENT, listener);
}
