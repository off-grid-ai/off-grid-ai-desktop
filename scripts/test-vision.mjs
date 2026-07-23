import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getAppSupportDir } from './lib/app-support.mjs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Configuration
const resourcesDir = path.join(__dirname, '../resources')
const binName = 'llama-server'
const serverPath = path.join(resourcesDir, 'bin', binName)
const modelPath = path.join(resourcesDir, 'models', 'qwen2.5-vl-3b-instruct-q4_k_m.gguf')
const mmProjPath = path.join(resourcesDir, 'models', 'qwen2.5-vl-3b-instruct-mmproj-f16.gguf')
const PORT = 8081 // Use a different port for testing to avoid conflict if app is running

const visionTest = {
  async run() {
    console.log('=== Testing Vision Model via llama-server ===')

    // 1. Validation
    if (!fs.existsSync(serverPath)) {
      console.error(`Binary not found at: ${serverPath}`)
      console.error('Please download llama-server and place it there.')
      process.exit(1)
    }
    if (!fs.existsSync(modelPath)) {
      console.error(`Model not found at: ${modelPath}`)
      process.exit(1)
    }

    console.log('Starting llama-server...')

    // 2. Spawn Server
    const server = spawn(serverPath, [
      '-m',
      modelPath,
      '--mmproj',
      mmProjPath,
      '--port',
      String(PORT),
      '--host',
      '127.0.0.1',
      '-c',
      '8192'
    ])

    server.stderr.on('data', (d) => {
      console.log(`[Server] ${d.toString().trim()}`)
    })

    server.on('close', (code) => {
      console.log(`[Server] Exited with code ${code}`)
    })

    // Cleanup on exit
    process.on('exit', () => server.kill())
    process.on('SIGINT', () => {
      server.kill()
      process.exit()
    })

    // 3. Wait for Ready
    console.log('Waiting for server...')
    await visionTest.waitForServer(PORT)
    console.log('Server Ready!')

    // 4. Find an image
    const captureDir = path.join(getAppSupportDir(), 'captures')
    let imagePath = ''
    if (fs.existsSync(captureDir)) {
      const files = fs
        .readdirSync(captureDir)
        .filter((f) => f.endsWith('.png'))
        .sort()
        .reverse()
      if (files.length > 0) {
        imagePath = path.join(captureDir, files[0])
        console.log('Using recent capture:', imagePath)
      }
    }

    if (!imagePath) {
      console.error('No capture found. Please provide an image path or take a screenshot.')
      server.kill()
      process.exit(1)
    }

    // 5. Send Request
    console.log('Sending request...')
    try {
      const imageBuffer = fs.readFileSync(imagePath)
      const base64 = imageBuffer.toString('base64')
      const mime = 'image/png'

      const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this image in detail.' },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
              ]
            }
          ],
          max_tokens: 500
        })
      })

      const data = await response.json()
      console.log('\nResponse:\n', data.choices?.[0]?.message?.content)
    } catch (e) {
      console.error('Error during request:', e)
    } finally {
      console.log('Stopping server...')
      server.kill()
    }
  },

  async waitForServer(port) {
    const start = Date.now()
    while (Date.now() - start < 60000) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) return
      } catch {
        // Server is still starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
    throw new Error('Timeout waiting for server')
  }
}

visionTest.run()
