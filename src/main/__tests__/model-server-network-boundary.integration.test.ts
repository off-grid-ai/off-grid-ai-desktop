import net from 'node:net'
import os from 'node:os'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startModelServer, stopModelServer } from '../model-server'

let gatewayPort = 0

function nonLoopbackIpv4Address(): string | undefined {
  return Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find((address) => address.family === 'IPv4' && !address.internal)?.address
}

async function freeLoopbackPort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

async function waitForLoopbackGateway(): Promise<Response> {
  const deadline = Date.now() + 2_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${String(gatewayPort)}/v1`)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw lastError
}

function acceptsTcpConnection(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: gatewayPort })
    const finish = (accepted: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(accepted)
    }
    socket.setTimeout(1_000)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

beforeAll(async () => {
  gatewayPort = await freeLoopbackPort()
  startModelServer(gatewayPort)
})

afterAll(() => {
  stopModelServer()
})

describe('model gateway network boundary', () => {
  it('serves the production gateway over IPv4 loopback', async () => {
    const response = await waitForLoopbackGateway()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      message: 'Off Grid AI local gateway. OpenAI-compatible API.'
    })
  })

  const lanAddress = nonLoopbackIpv4Address()
  it.skipIf(!lanAddress)('does not listen on a non-loopback interface', async () => {
    expect(await acceptsTcpConnection(lanAddress!)).toBe(false)
  })
})
