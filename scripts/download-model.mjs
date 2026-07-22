import fs from 'fs'
import path from 'path'
import https from 'https'
import os from 'os'

// Model storage location - user's app support directory
function getModelsDir() {
  const platform = process.platform
  let appDataDir

  if (platform === 'darwin') {
    appDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'My Memories')
  } else if (platform === 'win32') {
    appDataDir = path.join(process.env.APPDATA || os.homedir(), 'My Memories')
  } else {
    appDataDir = path.join(os.homedir(), '.my-memories')
  }

  return path.join(appDataDir, 'models')
}

const MODELS_DIR = getModelsDir()

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

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from ${url}...`)

    const file = fs.createWriteStream(destPath)

    const request = (redirectUrl) => {
      https
        .get(redirectUrl, (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            console.log(`Redirecting...`)
            request(response.headers.location)
            return
          }

          if (response.statusCode !== 200) {
            fs.unlink(destPath, () => {})
            reject(new Error(`HTTP ${response.statusCode}`))
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
            resolve()
          })
        })
        .on('error', (err) => {
          fs.unlink(destPath, () => {})
          reject(err)
        })
    }

    request(url)
  })
}

async function main() {
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
      await downloadFile(model.url, destPath)
    } catch (err) {
      console.error(`Failed to download ${model.name}:`, err.message)
      process.exit(1)
    }
  }

  console.log('\nAll models ready!')
}

main()
