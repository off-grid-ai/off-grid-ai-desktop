// Optimistic write-through for a persisted toggle/select, with revert on failure.
// The UI updates immediately (apply(next)) so it feels instant, but if the persist
// rejects (e.g. the settings DB is briefly locked during heavy capture / a
// delete-all), the optimistic value is REVERTED so the control never shows a state
// the backend didn't accept — the D34 §A bug where a toggle silently kept its new
// position while the setting never saved, then flipped back on the next mount.
//
// Pure + framework-free: `apply` is the caller's setState, `persist` the caller's
// IPC write. Unit-tested directly (the revert is the observable contract).

export async function persistToggle<T>(
  next: T,
  prev: T,
  apply: (v: T) => void,
  persist: (v: T) => Promise<unknown> | unknown
): Promise<void> {
  apply(next)
  try {
    await persist(next)
  } catch {
    apply(prev) // persist failed — never leave the UI showing an unsaved value
  }
}
