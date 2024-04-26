import AsyncStorage from '@react-native-async-storage/async-storage'

import { KeyValueDB } from '.'
import { DBShape } from './types'
import { mockUUID } from '../../__mocks__/expo-crypto'

const defaultMeta = {
  lastMigrationVersion: 0,
  currUser: 'guest',
}

beforeEach(async () => {
  await AsyncStorage.clear()
  jest.clearAllMocks()
})

test('getting meta before using DB should return undefined', async () => {
  const db = new KeyValueDB(defaultMeta)
  const m = await db.getMeta()
  // db must be created by first putting or getting
  expect(m).toBe(undefined)
})

test('calling get must init db', async () => {
  const db = new KeyValueDB(defaultMeta)
  await db.get('testing')
  const m = await db.getMeta()
  expect(m.lastMigrationVersion).toBe(0)
})

type TestDB = {
  testing: {
    ver: number
  }
  bigobj: {
    name: string
    email: string
    lastName: string
  }
}

test('common case get put', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.put('testing', { ver: 3 })
  const t = await db.get('testing')
  expect(t.ver).toBe(3)
})

test('cache is populated after a put', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.put('testing', { ver: 3 })
  const c = db.getCache()
  expect(c['guest:testing'].ver).toBe(3)
})

test('cache purge works', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.put('testing', { ver: 3 })
  db.purgeCache()
  expect(db.getCache()).toEqual({})
})

test('cache is populated after a get', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.put('testing', { ver: 3 })
  db.purgeCache()
  const t = await db.get('testing')
  expect(t.ver).toBe(3)
  expect(db.getCache()['guest:testing'].ver).toBe(3)
})

test('removing should return undefined on next get', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.put('testing', { ver: 3 })
  const t = await db.get('testing')
  expect(t.ver).toBe(3)
  await db.del('testing')
  expect(db.getCache().testing).toBe(undefined)
  const t1 = await db.get('testing')
  expect(t1).toBe(undefined)
})

test('update partial object', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.put('bigobj', { name: 'akshay', lastName: 'dua', email: 'akshay@gmail.com' })
  await db.update('bigobj', { name: 'candy' })
  expect(db.getCache()['guest:bigobj'].name).toEqual('candy')
  const b = await db.get('bigobj')
  expect(b.name).toEqual('candy')
})

const migration1 = jest.fn(async () => {
  return true
})

const migration2 = jest.fn(async () => {
  return true
})

const migration3 = jest.fn(async (d: KeyValueDB<DBShape>) => {
  return true
})

const migTable1 = {
  1: [migration1, migration2],
}

const migTable2 = {
  1: [migration1, migration2],
  2: [migration3],
}

test('get put db meta', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.putMeta({
    lastMigrationVersion: 3,
    currUser: 'guest',
  })
  const m = await db.getMeta()
  expect(m.lastMigrationVersion).toEqual(3)
})

test('migration does not run if no db', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  await db.migrate(migTable1)
  // internal meta key to store migration version
  // it should get updated to the latest migration version in the table
  //@ts-ignore
  expect(await AsyncStorage.getItem('ns342xcv334Meta')).toBe(null)
  expect(await db.getMeta()).toBe(undefined)
})

test('migrate to version 1', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)

  await AsyncStorage.clear()

  // put something in db
  await db.put('testing', { ver: 3 })

  // later migrate to version 1
  await db.migrate(migTable1)

  // internal meta key to store migration version
  // it should get updated to the latest migration version in the table
  //@ts-ignore
  //expect((await AsyncStorage.getItem('ns342xcv334Meta')).lastMigrationVersion).toEqual(1)
  const m = await db.getMeta()
  expect(m.lastMigrationVersion).toEqual(1)

  expect(migration1.mock.calls).toHaveLength(1)
  expect(migration2.mock.calls).toHaveLength(1)
})

test('migrate to version 2', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  // put something in db
  await db.put('testing', { ver: 3 })

  // later migrate to version 1
  await db.migrate(migTable1)

  // internal meta key to store migration version
  // it should get updated to the latest migration version in the table
  //@ts-ignore
  //expect((await AsyncStorage.getItem('ns342xcv334Meta')).lastMigrationVersion).toEqual(1)
  const m = await db.getMeta()
  expect(m.lastMigrationVersion).toEqual(1)

  // now upgrade again
  await db.migrate(migTable2)
  expect((await db.getMeta()).lastMigrationVersion).toEqual(2)
  expect(migration1.mock.calls).toHaveLength(1)
  expect(migration2.mock.calls).toHaveLength(1)
  expect(migration3.mock.calls).toHaveLength(1)
})

test('cache get', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)
  // put something in db
  await db.put('testing', { ver: 3 })

  const v = db.cacheGet('testing')
  expect(v.ver).toBe(3)
})

test('create installation id', async () => {
  const db = new KeyValueDB<TestDB>(defaultMeta)

  const dbid = await db.getInstallId()
  expect(dbid).toEqual(mockUUID)

  const dbid2 = await db.getInstallId()
  expect(dbid).toEqual(dbid2)
})
