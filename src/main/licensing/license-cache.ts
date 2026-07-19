export type ProLicense = {
  isPro: boolean
  key: string | null
  licenseId: string | null
  expiry: string | null
  verifiedAt: number
}

interface StoredLicenseWrapper {
  enc: boolean
  data: string
}

interface ReadLicenseCacheOptions {
  packaged: boolean
  decrypt: (encrypted: Buffer) => string
}

interface WriteLicenseCacheOptions {
  packaged: boolean
  encryptionAvailable: boolean
  encrypt: (plaintext: string) => Buffer
}

function parseWrapper(raw: string): StoredLicenseWrapper {
  const value: unknown = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as Record<string, unknown>).enc !== 'boolean' ||
    typeof (value as Record<string, unknown>).data !== 'string'
  ) {
    throw new Error('license cache wrapper is malformed')
  }
  return value as StoredLicenseWrapper
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new Error(`license cache ${name} is malformed`)
}

function parseLicense(json: string): ProLicense {
  const value: unknown = JSON.parse(json)
  if (!value || typeof value !== 'object') {
    throw new Error('license cache payload is malformed')
  }
  const record = value as Record<string, unknown>
  if (typeof record.isPro !== 'boolean') {
    throw new Error('license cache isPro is malformed')
  }
  if (
    typeof record.verifiedAt !== 'number' ||
    !Number.isFinite(record.verifiedAt) ||
    record.verifiedAt < 0
  ) {
    throw new Error('license cache verifiedAt is malformed')
  }
  return {
    isPro: record.isPro,
    key: nullableString(record.key, 'key'),
    licenseId: nullableString(record.licenseId, 'licenseId'),
    expiry: nullableString(record.expiry, 'expiry'),
    verifiedAt: record.verifiedAt
  }
}

export function decodeLicenseCache(raw: string, options: ReadLicenseCacheOptions): ProLicense {
  const wrapper = parseWrapper(raw)
  if (!wrapper.enc && options.packaged) {
    throw new Error('packaged builds reject plaintext license caches')
  }
  const json = wrapper.enc ? options.decrypt(Buffer.from(wrapper.data, 'base64')) : wrapper.data
  return parseLicense(json)
}

export function encodeLicenseCache(
  license: ProLicense,
  options: WriteLicenseCacheOptions
): StoredLicenseWrapper | null {
  const json = JSON.stringify(license)
  if (options.encryptionAvailable) {
    return { enc: true, data: options.encrypt(json).toString('base64') }
  }
  if (options.packaged) return null
  return { enc: false, data: json }
}
