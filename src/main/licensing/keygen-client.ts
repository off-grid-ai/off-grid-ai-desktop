/**
 * Low-level Keygen REST client (desktop).
 *
 * Wraps the validate-key, machine activate/deactivate, and list-machines
 * endpoints. The license KEY is the credential (policies are unprotected with a
 * MIXED authentication strategy), so machine actions authenticate with
 * `Authorization: License <key>` and validate-key needs no auth at all.
 *
 * Transport failures throw KeygenNetworkError so the service layer can fall back
 * to the cached license (offline grace) instead of locking the user out.
 *
 * Ported verbatim from mobile/src/services/keygenClient.ts (RN logger → console).
 * Uses the global `fetch` (Electron main runs on Node 18+).
 */
import { KEYGEN_API_BASE, KEYGEN_PRODUCT_ID } from './keygen-config'

const JSON_API = 'application/vnd.api+json'

type ValidationCode =
  | 'VALID'
  | 'NO_MACHINE'
  | 'NO_MACHINES'
  | 'TOO_MANY_MACHINES'
  | 'FINGERPRINT_SCOPE_MISMATCH'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'BANNED'
  | 'OVERDUE'
  | 'NOT_FOUND'
  | 'UNKNOWN'

export interface KeygenLicense {
  id: string
  expiry: string | null // ISO timestamp, or null for a perpetual (lifetime) key
  metadata: Record<string, unknown>
  name: string | null
}

export interface ValidateResult {
  valid: boolean
  code: ValidationCode
  license: KeygenLicense | null
}

export interface KeygenMachine {
  id: string
  fingerprint: string
  platform: string | null
  name: string | null
  lastSeen: string | null
}

/** Raised on a network/transport failure (offline), never on a 4xx from Keygen. */
export class KeygenNetworkError extends Error {}

type JsonObject = Record<string, unknown>

function objectValue(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null ? (value as JsonObject) : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${KEYGEN_API_BASE}${path}`, init)
  } catch (e) {
    throw new KeygenNetworkError(e instanceof Error ? e.message : String(e))
  }
}

/** Validate a Keygen resource id (a UUID/token) BEFORE it is placed into a request URL
 *  path — rejects anything that isn't a plain id so tainted data can't reshape the URL
 *  (Sonar S7044/S8476). Keygen ids are UUIDs, so this never rejects a real id. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error('invalid Keygen resource id')
  return id
}

export function toLicense(data: unknown): KeygenLicense | null {
  const resource = objectValue(data)
  const id = stringValue(resource?.id)
  if (!resource || !id) return null
  const attributes = objectValue(resource.attributes)
  return {
    id,
    expiry: stringValue(attributes?.expiry),
    metadata: objectValue(attributes?.metadata) ?? {},
    name: stringValue(attributes?.name)
  }
}

/** Turn a validate-key JSON:API body into our ValidateResult shape. Pure. */
export function parseValidateResult(body: unknown): ValidateResult {
  const document = objectValue(body)
  const meta = objectValue(document?.meta)
  return {
    valid: meta?.valid === true,
    code: (stringValue(meta?.code) ?? 'UNKNOWN') as ValidationCode,
    license: toLicense(document?.data)
  }
}

/**
 * Turn a machine-activate response (status + JSON:API body) into { ok, limitReached }.
 * Pure — 201 means activated; a 422 whose errors carry a LIMIT code or a "machine
 * limit" detail means the device cap was hit. Any other non-201 is a plain failure.
 */
export function parseActivateResult(
  status: number,
  body: unknown
): { ok: boolean; limitReached: boolean } {
  if (status === 201) return { ok: true, limitReached: false }
  const document = objectValue(body)
  const errors = Array.isArray(document?.errors) ? document.errors : []
  const limitReached =
    status === 422 &&
    errors.some((error) => {
      const detail = objectValue(error)
      return (
        String(detail?.code ?? '').includes('LIMIT') ||
        String(detail?.detail ?? '')
          .toLowerCase()
          .includes('machine limit')
      )
    })
  return { ok: false, limitReached }
}

/** Turn a list-machines JSON:API body into our KeygenMachine[] shape. Pure. */
export function parseMachines(body: unknown): KeygenMachine[] {
  const document = objectValue(body)
  const data = Array.isArray(document?.data) ? document.data : []
  return data.map((machine) => {
    const resource = objectValue(machine)
    const attributes = objectValue(resource?.attributes)
    return {
      id: stringValue(resource?.id) ?? '',
      fingerprint: stringValue(attributes?.fingerprint) ?? '',
      platform: stringValue(attributes?.platform),
      name: stringValue(attributes?.name),
      lastSeen: stringValue(attributes?.lastHeartbeat) ?? stringValue(attributes?.created)
    }
  })
}

/** Validate a key, scoped to this product + device fingerprint. No auth needed. */
export async function validateKey(key: string, fingerprint: string): Promise<ValidateResult> {
  const res = await request('/licenses/actions/validate-key', {
    method: 'POST',
    headers: { 'Content-Type': JSON_API, Accept: JSON_API },
    body: JSON.stringify({
      meta: { key, scope: { product: KEYGEN_PRODUCT_ID, fingerprint } }
    })
  })
  const body: unknown = await res.json().catch(() => ({}))
  return parseValidateResult(body)
}

/** Register this device as a machine on the license. Enforces the device cap. */
export async function activateMachine(
  key: string,
  licenseId: string,
  device: { fingerprint: string; platform: string }
): Promise<{ ok: boolean; limitReached: boolean }> {
  const { fingerprint, platform } = device
  const res = await request('/machines', {
    method: 'POST',
    headers: { 'Content-Type': JSON_API, Accept: JSON_API, Authorization: `License ${key}` },
    body: JSON.stringify({
      data: {
        type: 'machines',
        attributes: { fingerprint, platform, metadata: { platform } },
        relationships: { license: { data: { type: 'licenses', id: licenseId } } }
      }
    })
  })
  if (res.status === 201) return { ok: true, limitReached: false }
  const body: unknown = await res.json().catch(() => ({}))
  const result = parseActivateResult(res.status, body)
  if (!result.limitReached) {
    // Strip CR/LF from the server-returned error before logging (anti log-forging) and cap it.
    const errStr = JSON.stringify(objectValue(body)?.errors ?? [])
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 300)
    console.error(`[Keygen] activate failed (${res.status}): ${errStr}`)
  }
  return result
}

/** List the machines currently activated on a license. */
export async function listMachines(key: string, licenseId: string): Promise<KeygenMachine[]> {
  const res = await request(`/licenses/${safeId(licenseId)}/machines`, {
    method: 'GET',
    headers: { Accept: JSON_API, Authorization: `License ${key}` }
  })
  const body: unknown = await res.json().catch(() => ({}))
  return parseMachines(body)
}

/** Free a device slot. */
export async function deactivateMachine(key: string, machineId: string): Promise<boolean> {
  const res = await request(`/machines/${safeId(machineId)}`, {
    method: 'DELETE',
    headers: { Accept: JSON_API, Authorization: `License ${key}` }
  })
  return res.status === 204 || res.ok
}
