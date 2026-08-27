import crypto from 'node:crypto'

/** In-process repository for tests and local Netlify development. */
export function createMemoryRepository() {
  const accounts = new Map()
  const pendingLogins = new Map()
  const identities = new Map()
  const refreshLeases = new Map()
  let settings = null
  const history = new Map()

  return {
    async createAccountSlot() {
      for (let number = 1; ; number += 1) {
        const slot = `slot${number}`
        if (accounts.has(slot)) continue
        accounts.set(slot, { value: null, version: 1 })
        return slot
      }
    },

    async listAccounts() {
      return [...accounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([slot, record]) => ({ slot, account: structuredClone(record.value), version: String(record.version) }))
    },

    async getAccount(slot) {
      const record = accounts.get(slot)
      return record
        ? { slot, account: structuredClone(record.value), version: String(record.version) }
        : null
    },

    async putAccount(slot, account, { version } = {}) {
      const current = accounts.get(slot)
      if (!current || (version !== undefined && String(current.version) !== String(version))) {
        const error = new Error('Account was changed by another request')
        error.code = 'CONFLICT'
        throw error
      }
      const next = { value: structuredClone(account), version: current.version + 1 }
      accounts.set(slot, next)
      return { slot, account: structuredClone(next.value), version: String(next.version) }
    },

    async deleteAccount(slot, { version } = {}) {
      const current = accounts.get(slot)
      if (!current || String(current.version) !== String(version)) {
        const error = new Error('Account was changed by another request')
        error.code = 'CONFLICT'
        throw error
      }
      accounts.delete(slot)
    },

    async putPendingLogin(state, pending) {
      if (pendingLogins.has(state)) {
        const error = new Error('Login state already exists')
        error.code = 'CONFLICT'
        throw error
      }
      pendingLogins.set(state, structuredClone(pending))
    },

    async getPendingLogin(state) {
      const pending = pendingLogins.get(state)
      return pending ? structuredClone(pending) : null
    },

    async claimPendingLogin(state) {
      const pending = pendingLogins.get(state)
      if (!pending || pending.consumed) return null
      pendingLogins.set(state, { ...pending, consumed: true })
      return structuredClone(pending)
    },

    async deletePendingLogin(state) {
      pendingLogins.delete(state)
    },

    async prunePendingLogins(before) {
      for (const [state, pending] of pendingLogins) {
        if (Number(pending.startedAt) < Number(before)) pendingLogins.delete(state)
      }
    },

    async claimIdentity(identity, slot) {
      const owner = identities.get(identity)
      if (owner && owner !== slot) return false
      identities.set(identity, slot)
      return true
    },

    async releaseIdentity(identity, slot) {
      if (identities.get(identity) === slot) identities.delete(identity)
    },

    async acquireRefreshLease(slot, { now, leaseMs, minimumIntervalMs }) {
      const current = refreshLeases.get(slot)
      if (current && (current.expiresAt > now || current.startedAt + minimumIntervalMs > now)) return null
      const token = crypto.randomUUID()
      refreshLeases.set(slot, { token, startedAt: now, expiresAt: now + leaseMs })
      return { token }
    },

    async releaseRefreshLease(slot, token, now) {
      const current = refreshLeases.get(slot)
      if (current?.token === token) refreshLeases.set(slot, { ...current, expiresAt: now })
    },

    async getSettings() {
      return settings
        ? { settings: structuredClone(settings.value), version: String(settings.version) }
        : null
    },

    async putSettings(value, { version } = {}) {
      const currentVersion = settings ? String(settings.version) : null
      if (version !== currentVersion) {
        const error = new Error('Settings were changed by another request')
        error.code = 'CONFLICT'
        throw error
      }
      settings = { value: structuredClone(value), version: (settings?.version || 0) + 1 }
      return { settings: structuredClone(settings.value), version: String(settings.version) }
    },

    async appendHistory(snapshot) {
      const key = String(Math.floor(Number(snapshot.timestamp) / (5 * 60 * 1000)))
      if (history.has(key)) return false
      history.set(key, structuredClone(snapshot))
      return true
    },

    async listHistory({ since = 0 } = {}) {
      return [...history.values()]
        .filter(snapshot => Number(snapshot.timestamp) >= Number(since))
        .map(snapshot => structuredClone(snapshot))
        .sort((left, right) => left.timestamp - right.timestamp)
    },

    async pruneHistory(before) {
      for (const [key, snapshot] of history) {
        if (Number(snapshot.timestamp) < Number(before)) history.delete(key)
      }
    },
  }
}
