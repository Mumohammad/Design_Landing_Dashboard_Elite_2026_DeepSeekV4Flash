"use client";

const DRIVER_CHANGED_EVENT = "elitedev:driver-changed";

export type DriverChangedDetail = {
  driverId?: string;
  action?: "status" | "archive" | "photo" | "document" | "leave" | "profile";
};

export function emitDriverChanged(detail: DriverChangedDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DriverChangedDetail>(DRIVER_CHANGED_EVENT, { detail }));
}

export function subscribeDriverChanged(handler: (detail: DriverChangedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<DriverChangedDetail>).detail ?? {});
  };
  window.addEventListener(DRIVER_CHANGED_EVENT, listener);
  return () => window.removeEventListener(DRIVER_CHANGED_EVENT, listener);
}
