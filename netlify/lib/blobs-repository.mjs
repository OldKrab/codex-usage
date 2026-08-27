import { getStore } from '@netlify/blobs'
import crypto from 'node:crypto'

const STORE_NAME = 'codex-usage-dashboard'
const SLOT_INDEX_KEY = 'control/slots'

function conflict(message) {
  const error = new Error(message)
  error.code = 'CONFLICT'
  return error
}

function identityKey(identity) {
  const digest = crypto.createHash('sha256').update(String(identity)).digest('hex')
  return `identities/${digest}`
}

async function getRecord(store, key) {
  const record = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' })
  if (!record || record.etag) return record
  const listed = await store.list({ prefix: key })
  const exact = listed.blobs.find(blob => blob.key === key)
  return exact?.etag ? { ...record, etag: exact.etag } : record
}

async function setConditional(store, key, value, options, message) {
  const result = await store.setJSON(key, value, options)
  if (!result.modified) throw conflict(message)
  return result.etag
}

async function updateSlotIndex(store, update) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await getRecord(store, SLOT_INDEX_KEY)
    const value = current?.data || { slots: [], nextSlot: 1 }
    const next = update({ slots: [...value.slots], nextSlot: Number(value.nextSlot || 1) })
    const options = current?.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true }
    const result = await store.setJSON(SLOT_INDEX_KEY, next, options)
    if (result.modified) return next
  }
  throw conflict('Slot index is busy')
}

/** Site-wide Netlify Blobs repository with per-record keys and atomic writes. */
export function createBlobsRepository({ store = getStore(STORE_NAME) } = {}) {
  return {
    async createAccountSlot() {
      let allocated
      await updateSlotIndex(store, index => {
        allocated = `slot${index.nextSlot}`
        return {
          slots: index.slots,
          nextSlot: index.nextSlot + 1,
        }
      })
      const accountKey = `accounts/${allocated}`
      const result = await store.setJSON(accountKey, { account: null }, { onlyIfNew: true })
      if (!result.modified) throw conflict('Allocated account slot already exists')
      try {
        await updateSlotIndex(store, index => ({
          ...index,
          slots: index.slots.includes(allocated) ? index.slots : [...index.slots, allocated],
        }))
      } catch (error) {
        await store.delete(accountKey)
        throw error
      }
      return allocated
    },

    async listAccounts() {
      const index = await getRecord(store, SLOT_INDEX_KEY)
      const indexedSlots = index?.data?.slots || []
      const records = await Promise.all(indexedSlots.map(slot => this.getAccount(slot)))
      const staleSlots = new Set(indexedSlots.filter((_slot, position) => !records[position]))
      if (staleSlots.size > 0) {
        await updateSlotIndex(store, value => ({
          ...value,
          slots: value.slots.filter(slot => !staleSlots.has(slot)),
        }))
      }
      return records.filter(Boolean)
    },

    async getAccount(slot) {
      const record = await getRecord(store, `accounts/${slot}`)
      if (!record || record.data?.deleted) return null
      return { slot, account: record.data?.account ?? null, version: record.etag }
    },

    async putAccount(slot, account, { version } = {}) {
      const etag = await setConditional(
        store,
        `accounts/${slot}`,
        { account },
        { onlyIfMatch: version },
        'Account was changed by another request',
      )
      return { slot, account, version: etag }
    },

    async deleteAccount(slot, { version } = {}) {
      await setConditional(
        store,
        `accounts/${slot}`,
        { deleted: true },
        { onlyIfMatch: version },
        'Account was changed by another request',
      )
      await updateSlotIndex(store, index => ({
        ...index,
        slots: index.slots.filter(candidate => candidate !== slot),
      }))
    },

    async putPendingLogin(state, pending) {
      await setConditional(
        store,
        `pending/${state}`,
        pending,
        { onlyIfNew: true },
        'Login state already exists',
      )
    },

    async getPendingLogin(state) {
      const record = await getRecord(store, `pending/${state}`)
      return record?.data || null
    },

    async claimPendingLogin(state) {
      const key = `pending/${state}`
      const record = await getRecord(store, key)
      if (!record || record.data?.consumed) return null
      const result = await store.setJSON(key, { ...record.data, consumed: true }, { onlyIfMatch: record.etag })
      return result.modified ? record.data : null
    },

    async deletePendingLogin(state) {
      await store.delete(`pending/${state}`)
    },

    async prunePendingLogins(before) {
      for await (const page of store.list({ prefix: 'pending/', paginate: true })) {
        await Promise.all(page.blobs.map(async ({ key }) => {
          const record = await getRecord(store, key)
          if (record && Number(record.data?.startedAt) < Number(before)) await store.delete(key)
        }))
      }
    },

    async claimIdentity(identity, slot) {
      const key = identityKey(identity)
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await getRecord(store, key)
        if (current?.data?.slot === slot) return true
        if (current?.data?.slot) return false
        const result = await store.setJSON(key, { slot }, current?.etag
          ? { onlyIfMatch: current.etag }
          : { onlyIfNew: true })
        if (result.modified) return true
      }
      throw conflict('Account identity reservation is busy')
    },

    async releaseIdentity(identity, slot) {
      const key = identityKey(identity)
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await getRecord(store, key)
        if (!current || current.data?.slot !== slot) return
        const result = await store.setJSON(key, { released: true }, { onlyIfMatch: current.etag })
        if (result.modified) return
      }
      throw conflict('Account identity reservation is busy')
    },

    async acquireRefreshLease(slot, { now, leaseMs, minimumIntervalMs }) {
      const key = `leases/${slot}`
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await getRecord(store, key)
        if (current && (Number(current.data?.expiresAt) > now
          || Number(current.data?.startedAt) + minimumIntervalMs > now)) return null
        const lease = { token: crypto.randomUUID(), startedAt: now, expiresAt: now + leaseMs }
        const result = await store.setJSON(key, lease, current?.etag
          ? { onlyIfMatch: current.etag }
          : { onlyIfNew: true })
        if (result.modified) return { token: lease.token }
      }
      throw conflict('Refresh lease is busy')
    },

    async releaseRefreshLease(slot, token, now) {
      const key = `leases/${slot}`
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await getRecord(store, key)
        if (!current || current.data?.token !== token) return
        const result = await store.setJSON(key, { ...current.data, expiresAt: now }, { onlyIfMatch: current.etag })
        if (result.modified) return
      }
      throw conflict('Refresh lease is busy')
    },

    async getSettings() {
      const record = await getRecord(store, 'settings/current')
      return record ? { settings: record.data, version: record.etag } : null
    },

    async putSettings(settings, { version } = {}) {
      const options = version ? { onlyIfMatch: version } : { onlyIfNew: true }
      const etag = await setConditional(store, 'settings/current', settings, options, 'Settings were changed by another request')
      return { settings, version: etag }
    },

    async appendHistory(snapshot) {
      const bucket = Math.floor(Number(snapshot.timestamp) / (5 * 60 * 1000))
      const result = await store.setJSON(`history/${bucket}`, snapshot, { onlyIfNew: true })
      return result.modified
    },

    async listHistory({ since = 0 } = {}) {
      const blobKeys = []
      const firstBucket = Math.floor(Number(since) / (5 * 60 * 1000))
      for await (const page of store.list({ prefix: 'history/', paginate: true })) {
        blobKeys.push(...page.blobs
          .map(({ key }) => key)
          .filter(key => Number(key.slice('history/'.length)) >= firstBucket))
      }
      const snapshots = await Promise.all(blobKeys.map(async key => (await getRecord(store, key))?.data))
      return snapshots
        .filter(snapshot => snapshot && Number(snapshot.timestamp) >= Number(since))
        .sort((left, right) => left.timestamp - right.timestamp)
    },

    async pruneHistory(before) {
      const deletions = []
      const boundaryBucket = Math.floor(Number(before) / (5 * 60 * 1000))
      for await (const page of store.list({ prefix: 'history/', paginate: true })) {
        for (const { key } of page.blobs) {
          const bucket = Number(key.slice('history/'.length))
          if (bucket < boundaryBucket) {
            deletions.push(store.delete(key))
          } else if (bucket === boundaryBucket) {
            deletions.push((async () => {
              const record = await getRecord(store, key)
              if (record && Number(record.data?.timestamp) < Number(before)) await store.delete(key)
            })())
          }
        }
      }
      await Promise.all(deletions)
    },
  }
}
