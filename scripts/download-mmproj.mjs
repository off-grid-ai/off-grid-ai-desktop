import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESOURCES_DIR = path.join(__dirname, '../resources/models')
const MODEL_URL =
  'https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf'
const MODEL_FILENAME = 'qwen2.5-vl-3b-instruct-mmproj-f16.gguf'
const DEST_PATH = path.join(RESOURCES_DIR, MODEL_FILENAME)

const projectorDownload = {
  downloadStream(response, fileStream) {
    if (response.statusCode !== 200) {
      console.error(`Failed to download: HTTP Status ${response.statusCode}`)
      process.exit(1)
    }

    const totalSize = parseInt(response.headers['content-length'], 10)
    let downloaded = 0

    response.pipe(fileStream)

    response.on('data', (chunk) => {
      downloaded += chunk.length
      if (totalSize) {
        const percent = ((downloaded / totalSize) * 100).toFixed(2)
        process.stdout.write(
          `\rDownloading: ${percent}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`
        )
      } else {
        process.stdout.write(`\rDownloading: ${(downloaded / 1024 / 1024).toFixed(2)} MB`)
      }
    })

    fileStream.on('finish', () => {
      fileStream.close()
      console.log('\nDownload complete!')
    })
  }
}

if (!fs.existsSync(RESOURCES_DIR)) {
  fs.mkdirSync(RESOURCES_DIR, { recursive: true })
}

if (fs.existsSync(DEST_PATH)) {
  console.log('Pinned vision projector is already installed.')
  process.exit(0)
}

console.log('Downloading pinned vision projector...')

const file = fs.createWriteStream(DEST_PATH)

https
  .get(MODEL_URL, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      console.log('Following the verified model host redirect...')
      https.get(response.headers.location, (redirectResponse) => {
        projectorDownload.downloadStream(redirectResponse, file)
      })
      return
    }

    projectorDownload.downloadStream(response, file)
  })
  .on('error', (err) => {
    fs.unlink(DEST_PATH, () => {})
    console.error('Download failed:', err.message)
    process.exit(1)
  })
