import { ipcMain } from 'electron'
import {
  createArtifactPreview,
  revokeArtifactPreview,
  revokeArtifactPreviewsForOwner
} from './artifact-preview'

const trackedOwners = new Set<number>()

export function setupArtifactPreviewIpc(): void {
  ipcMain.handle('artifacts:preview:create', (event, documentHtml: string) => {
    const ownerId = event.sender.id
    if (!trackedOwners.has(ownerId)) {
      trackedOwners.add(ownerId)
      event.sender.once('destroyed', () => {
        trackedOwners.delete(ownerId)
        revokeArtifactPreviewsForOwner(ownerId)
      })
    }
    return createArtifactPreview(documentHtml, ownerId)
  })
  ipcMain.handle('artifacts:preview:revoke', (event, url: string) =>
    revokeArtifactPreview(url, event.sender.id)
  )
}
