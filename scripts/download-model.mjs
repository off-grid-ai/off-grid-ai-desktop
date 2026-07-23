import fs from 'fs'
import path from 'path'
import https from 'https'
import { getAppSupportDir } from './lib/app-support.mjs'

const modelDownload = {
  // Model storage location - user's app support directory
  getModelsDir() {
    return path.join(getAppSupportDir(), 'models')
  },

  async downloadFile(url, destPath) {
    return new Promise((resolveDownload, rejectDownload) => {
      console.log(`Downloading from ${url}...`)

      const file = fs.createWriteStream(destPath)
      const transport = {
        request(redirectUrl) {
          https
            .get(redirectUrl, (response) => {
              if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
              ) {
                console.log(`Redirecting...`)
                transport.request(response.headers.location)
                return
              }

              if (response.statusCode !== 200) {
                fs.unlink(destPath, () => {})
                rejectDownload(new Error(`HTTP ${response.statusCode}`))
                return
              }

              const totalSize = parseInt(response.headers['content-length'], 10)
              let downloaded = 0

              response.pipe(file)

              response.on('data', (chunk) => {
                downloaded += chunk.length
                if (totalSize) {
                  const percent = ((downloaded / totalSize) * 100).toFixed(1)
                  const mb = (downloaded / 1024 / 1024).toFixed(1)
                  process.stdout.write(`\rProgress: ${percent}% (${mb} MB)`)
                }
              })

              file.on('finish', () => {
                file.close()
                console.log('\nDownload complete!')
                resolveDownload()
              })
            })
            .on('error', (err) => {
              fs.unlink(destPath, () => {})
              rejectDownload(err)
            })
        }
      }

      transport.request(url)
    })
  },

  async main() {
    console.log(`Models directory: ${MODELS_DIR}`)

    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true })
      console.log('Created models directory')
    }

    for (const model of MODELS) {
      const destPath = path.join(MODELS_DIR, model.name)

      if (fs.existsSync(destPath)) {
        console.log(`${model.name} already exists, skipping.`)
        continue
      }

      console.log(`\nDownloading ${model.name}...`)
      try {
        await modelDownload.downloadFile(model.url, destPath)
      } catch (err) {
        console.error(`Failed to download ${model.name}:`, err.message)
        process.exit(1)
      }
    }

    console.log('\nAll models ready!')
  }
}

const MODELS_DIR = modelDownload.getModelsDir()

// Qwen3-VL-4B model files
const MODELS = [
  {
    name: 'Qwen3-VL-4B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen_Qwen3-VL-4B-Instruct-Q4_K_M.gguf'
  },
  {
    name: 'mmproj-Qwen3VL-4B-Instruct-F16.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-F16.gguf'
  }
]

modelDownload.main()
