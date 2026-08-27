import assert from 'node:assert/strict'
import test from 'node:test'

import { createBlobsRepository } from '../netlify/lib/blobs-repository.mjs'

function createFakeBlobStore() {
  const values = new Map()
  let revision = 0
  return {
    values,
    async getWithMetadata(key) {
      const record = values.get(key)
      return record ? { data: structuredClone(record.data), etag: record.etag, metadata: {} } : null
    },
    async setJSON(key, data, options = {}) {
      const current = values.get(key)
      if (options.onlyIfNew && current) return { modified: false }
      if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false }
      const etag = `etag-${++revision}`
      values.set(key, { data: structuredClone(data), etag })
      return { modified: true, etag }
    },
    async list({ prefix }) {
      return {
        blobs: [...values.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, record]) => ({ key, etag: record.etag })),
        directories: [],
      }
    },
    async delete(key) {
      values.delete(key)
    },
  }
}

test('Blobs repository allocates separate account keys and uses CAS for updates', async () => {
  const store = createFakeBlobStore()
  const repository = createBlobsRepository({ store })

  const slots = await Promise.all([
    repository.createAccountSlot(),
    repository.createAccountSlot(),
  ])
  assert.deepEqual(slots.sort(), ['slot1', 'slot2'])
  assert.ok(store.values.has('accounts/slot1'))
  assert.ok(store.values.has('accounts/slot2'))
  assert.ok(store.values.has('control/slots'))

  const left = await repository.getAccount('slot1')
  const right = await repository.getAccount('slot1')
  await repository.putAccount('slot1', { email: 'winner@example.com' }, { version: left.version })
  await assert.rejects(
    repository.putAccount('slot1', { email: 'stale@example.com' }, { version: right.version }),
    error => error.code === 'CONFLICT',
  )
  assert.equal((await repository.getAccount('slot1')).account.email, 'winner@example.com')
})

test('Blobs repository recovers ETags when local reads omit them', async () => {
  const store = createFakeBlobStore()
  const originalGet = store.getWithMetadata
  store.getWithMetadata = async (key, options) => {
    const record = await originalGet(key, options)
    if (!record) return null
    const { etag: _etag, ...withoutEtag } = record
    return withoutEtag
  }
  const repository = createBlobsRepository({ store })

  const slot = await repository.createAccountSlot()
  const current = await repository.getAccount(slot)
  const saved = await repository.putAccount(slot, { email: 'local@example.com' }, { version: current.version })

  assert.equal(slot, 'slot1')
  assert.equal(typeof current.version, 'string')
  assert.equal(typeof saved.version, 'string')
  assert.equal((await repository.getAccount(slot)).account.email, 'local@example.com')
})

test('Blobs repository reads every history page', async () => {
  const store = createFakeBlobStore()
  const first = { timestamp: 1_800_000_000_000, accounts: {} }
  const second = { timestamp: 1_800_000_900_000, accounts: {} }
  await store.setJSON('history/6000000', first)
  await store.setJSON('history/6000003', second)
  store.list = options => {
    if (!options.paginate) {
      return Promise.resolve({ blobs: [{ key: 'history/6000000', etag: 'first' }], directories: [] })
    }
    return (async function * pages() {
      yield { blobs: [{ key: 'history/6000000', etag: 'first' }], directories: [] }
      yield { blobs: [{ key: 'history/6000003', etag: 'second' }], directories: [] }
    })()
  }

  const repository = createBlobsRepository({ store })

  assert.deepEqual(await repository.listHistory(), [first, second])
})

test('Blobs history reads skip old buckets and retention prunes them', async () => {
  const store = createFakeBlobStore()
  const oldSnapshot = { timestamp: 1_700_000_000_000, accounts: { old: {} } }
  const recentSnapshot = { timestamp: 1_800_000_000_000, accounts: { recent: {} } }
  const oldKey = `history/${Math.floor(oldSnapshot.timestamp / 300_000)}`
  const recentKey = `history/${Math.floor(recentSnapshot.timestamp / 300_000)}`
  await store.setJSON(oldKey, oldSnapshot)
  await store.setJSON(recentKey, recentSnapshot)
  const fetched = []
  const originalGet = store.getWithMetadata
  store.getWithMetadata = async (key, options) => {
    fetched.push(key)
    return originalGet(key, options)
  }
  store.list = () => (async function * pages() {
    yield { blobs: [{ key: oldKey }, { key: recentKey }], directories: [] }
  })()
  const repository = createBlobsRepository({ store })

  assert.deepEqual(await repository.listHistory({ since: 1_750_000_000_000 }), [recentSnapshot])
  assert.deepEqual(fetched, [recentKey])
  await repository.pruneHistory(1_750_000_000_000)
  assert.equal(store.values.has(oldKey), false)
  assert.equal(store.values.has(recentKey), true)
})

test('failed slot blob creation rolls back the slot index instead of leaving a ghost', async () => {
  const store = createFakeBlobStore()
  const originalSet = store.setJSON
  let failAccountCreate = true
  store.setJSON = async (key, data, options) => {
    if (key.startsWith('accounts/') && options?.onlyIfNew && failAccountCreate) {
      failAccountCreate = false
      throw new Error('injected account write failure')
    }
    return originalSet(key, data, options)
  }
  const repository = createBlobsRepository({ store })

  await assert.rejects(repository.createAccountSlot(), /injected account write failure/)

  assert.deepEqual((await store.getWithMetadata('control/slots')).data.slots, [])
  assert.deepEqual(await repository.listAccounts(), [])
})

test('failed delete index update leaves no credentials and list self-heals the stale index', async () => {
  const store = createFakeBlobStore()
  const repository = createBlobsRepository({ store })
  const slot = await repository.createAccountSlot()
  const current = await repository.getAccount(slot)
  await repository.putAccount(slot, { access: 'secret-access', refresh: 'secret-refresh' }, { version: current.version })
  const connected = await repository.getAccount(slot)
  const originalSet = store.setJSON
  let failIndexWrites = true
  store.setJSON = async (key, data, options) => {
    if (key === 'control/slots' && failIndexWrites) return { modified: false }
    return originalSet(key, data, options)
  }

  await assert.rejects(repository.deleteAccount(slot, { version: connected.version }), /Slot index is busy/)
  failIndexWrites = false

  assert.equal(await repository.getAccount(slot), null)
  assert.deepEqual(await repository.listAccounts(), [])
  assert.deepEqual((await store.getWithMetadata('control/slots')).data.slots, [])
  assert.doesNotMatch(JSON.stringify((await store.getWithMetadata(`accounts/${slot}`)).data), /secret-access|secret-refresh/)
})

test('Blobs identity reservations are atomic, hashed, and owner-safe to release', async () => {
  const store = createFakeBlobStore()
  const repository = createBlobsRepository({ store })
  const identity = 'email:owner@example.com'

  const claims = await Promise.all([
    repository.claimIdentity(identity, 'slot1'),
    repository.claimIdentity(identity, 'slot2'),
  ])
  await repository.releaseIdentity(identity, 'slot2')
  const stillOwned = await repository.claimIdentity(identity, 'slot2')
  await repository.releaseIdentity(identity, 'slot1')
  const reclaimed = await repository.claimIdentity(identity, 'slot2')
  const reservationKey = [...store.values.keys()].find(key => key.startsWith('identities/'))

  assert.deepEqual(claims.sort(), [false, true])
  assert.equal(stillOwned, false)
  assert.equal(reclaimed, true)
  assert.ok(reservationKey)
  assert.doesNotMatch(reservationKey, /owner|example|@/i)
})
