// Free-build stub. The Vite config aliases `@offgrid/pro/main` and
// `@offgrid/pro/renderer` here when the `pro/` submodule is absent. The loaders
// check for the activate* exports and skip activation, so the open build runs
// with core features only. Mirrors mobile/src/bootstrap/proStub.js.
export default null

// Named no-op so core's main.tsx can `import * as Pro` and read Pro.ClipboardPopup
// in the free build (the popup window never opens there, so it never renders).
export function ClipboardPopup(): null {
  return null
}
