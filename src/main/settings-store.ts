interface SettingsStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
}

export interface SettingsDatabase {
  prepare(sql: string): SettingsStatement
}

export interface SettingsStore {
  get<T>(key: string, defaultValue: T): T
  set(key: string, value: unknown): void
  delete(key: string): void
}

/** Create the app-settings repository over any compatible SQLite driver. */
export function createSettingsStore(database: SettingsDatabase): SettingsStore {
  return {
    get<T>(key: string, defaultValue: T): T {
      const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined
      if (!row) {
        return defaultValue
      }
      try {
        return JSON.parse(row.value) as T
      } catch {
        return defaultValue
      }
    },

    set(key: string, value: unknown): void {
      const valueJson = JSON.stringify(value)
      database
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`
        )
        .run(key, valueJson, valueJson)
    },

    delete(key: string): void {
      database.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
    }
  }
}
