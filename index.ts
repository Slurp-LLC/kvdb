// Adapter for async storage. In the app, please don't use any
// async-storage APIs directly. Create a function here and use
// that instead.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'

import { DBInfo, DBShape } from './types'

const metaKey = 'ns342xcv334Meta'
const installIdKey = 'ns342xcv334InstallId'

// Type DBSchema is supplied by app using this class
export class KeyValueDB<DBSchema extends DBShape> {
  // this default meta object should not be used.
  // the constructor makes sure this is changed.
  // its here just to support type safety.
  #defaultMeta: DBInfo = {
    lastMigrationVersion: 0,
    currUser: '',
  }

  #dbCache: { [key: string]: any }

  #dbMetaCache: DBInfo

  #dbInstallId: string

  // only initializes the meta object. Rest
  // happens in the init function because
  // we can't use async/await within constructors
  constructor(defaultMeta: DBInfo) {
    this.#defaultMeta = defaultMeta
  }

  async getInstallId(): Promise<string> {
    if (this.#dbInstallId) {
      return this.#dbInstallId
    }

    // not cached. get from db
    let dbid = await AsyncStorage.getItem(installIdKey)
    if (dbid) {
      // in db. cache and return
      this.#dbInstallId = dbid
    } else {
      // not in db. create, cache, and return
      dbid = randomUUID()
      await AsyncStorage.setItem(installIdKey, dbid)
      this.#dbInstallId = dbid
    }

    return this.#dbInstallId
  }

  async getMeta(): Promise<DBInfo> {
    if (this.#dbMetaCache) {
      return this.#dbMetaCache
    }
    const jsonValue = await AsyncStorage.getItem(metaKey)
    if (jsonValue) {
      this.#dbMetaCache = JSON.parse(jsonValue)
    }

    return this.#dbMetaCache
  }

  async putMeta(m: Partial<DBInfo>) {
    if (!this.#dbMetaCache) {
      this.#dbMetaCache = Object.assign({ ...this.#defaultMeta }, m)
    } else {
      Object.assign(this.#dbMetaCache, m)
    }
    // set in cache and db
    await AsyncStorage.setItem(metaKey, JSON.stringify(this.#dbMetaCache))
  }

  // create the database. Should happen
  // only on a fresh install.
  async #init() {
    // setup the cache and db
    const m = await this.getMeta()
    if (!m) {
      // creation needed
      await this.putMeta(this.#defaultMeta)
    }

    this.#dbCache = {} as DBSchema
  }

  async #makeUserKey(k: keyof DBSchema) {
    return (await this.getMeta()).currUser + ':' + (k as string)
  }

  #cacheMakeUserKey(k: keyof DBSchema) {
    if (!this.#dbMetaCache || !this.#dbMetaCache.currUser) {
      return ''
    }

    return this.#dbMetaCache.currUser + ':' + (k as string)
  }

  // will add an object to async storage or throw an error
  async put<K extends keyof DBSchema>(k: K, v: DBSchema[K]) {
    if (!k || !v) {
      throw Error('Key (' + (k as string) + ') or value (' + v + ') must be non-empty')
    }

    if (!this.#dbCache) {
      await this.#init()
    }

    const userKey = await this.#makeUserKey(k as string)

    // set in cache
    this.#dbCache[userKey] = v

    // set in db
    await AsyncStorage.setItem(userKey, JSON.stringify(v))
  }

  // checks for existence must use this function as well. If 'get' returns undefined, then
  // key does not exist. Values are not allowed to be empty/null/falsy so only a key can
  // exist or not.
  // throws errors if there are problems reading async storage or parsing json
  async get<K extends keyof DBSchema>(k: K): Promise<DBSchema[K]> {
    if (!k) {
      throw Error('Key (' + (k as string) + ') must be non-empty')
    }

    if (!this.#dbCache) {
      await this.#init()
    }

    const userKey = await this.#makeUserKey(k as string)

    if (userKey in this.#dbCache) {
      // if data in cache, return it
      return this.#dbCache[userKey] as DBSchema[K]
    }

    // data not in cache. Read from DB.
    try {
      const jsonValue = await AsyncStorage.getItem(userKey)

      if (jsonValue) {
        // in db
        this.#dbCache[userKey] = JSON.parse(jsonValue) // save in cache
        return this.#dbCache[userKey] as DBSchema[K]
      }
    } catch (e) {
      console.error(e)
      return undefined
    }

    // not in db
    return undefined
  }

  cacheGet<K extends keyof DBSchema>(k: K): DBSchema[K] | null {
    if (!k) {
      throw Error('Key (' + (k as string) + ') must be non-empty')
    }

    if (!this.#dbCache) {
      return null
    }

    const userKey = this.#cacheMakeUserKey(k)

    if (userKey) {
      return this.#dbCache[userKey] as DBSchema[K]
    }

    return null
  }

  async del(k: keyof DBSchema) {
    if (!k) {
      throw Error('Key (' + (k as string) + ') must be non-empty')
    }

    if (!this.#dbCache) {
      await this.#init()
    }

    const userKey = await this.#makeUserKey(k as string)

    delete this.#dbCache[userKey]

    await AsyncStorage.removeItem(userKey)
  }

  // will insert or update an object in the db for the given key.
  // this function accepts partial objects so that certain keys
  // in the object can be updated. Use with caution, as you don't
  // want to be adding new keys to your existing objects using this
  // function. Pay attention to ts errors and all will be good.
  async update<K extends keyof DBSchema>(k: K, v: Partial<DBSchema[K]>) {
    if (!k || !v) {
      throw Error('Key (' + (k as string) + ') or value (' + v + ') must be non-empty')
    }

    if (!this.#dbCache) {
      await this.#init()
    }

    const userKey = await this.#makeUserKey(k as string)

    if (!(userKey in this.#dbCache)) {
      // this is now an insert
      this.#dbCache[userKey] = {}
    }

    // update cache and then update the db using put
    Object.assign(this.#dbCache[userKey], v)
    await AsyncStorage.setItem(userKey, JSON.stringify(v))
  }

  async migrate(migrationFunctionTable: { [key: number]: MigrationFunction[] }): Promise<boolean> {
    try {
      if (!migrationFunctionTable) {
        console.error('Migration function table must be non-empty')
        return false
      }

      const storedMeta: DBInfo = await this.getMeta()
      if (!storedMeta) {
        console.info('No database exists. Skipping migration.')
        return false
      }

      const { passed, sortedVersions } = validateMigrationVersionNumbers(
        Object.keys(migrationFunctionTable)
      )

      if (!passed) {
        return false
      }

      if (!sortedVersions.length) {
        console.info('Empty migration function table. Skipping migration')
      }

      let lmv = 0 // current last migration version
      for (const v of sortedVersions) {
        if (storedMeta.lastMigrationVersion >= v) {
          // these migrations have been previously applied
          continue
        }

        for (const migrationF of migrationFunctionTable[v]) {
          if (!(await migrationF(this))) {
            console.error(
              'Migration function ',
              migrationF.name,
              ' returned false. Migration might have failed'
            )
          }
        }

        lmv = v
      }

      if (lmv)
        await this.putMeta({
          lastMigrationVersion: lmv,
        })
    } catch (e) {
      console.error(e)
      return false
    }

    return true
  }

  getCache() {
    return this.#dbCache
  }

  purgeCache() {
    this.#dbCache = {} as DBSchema
  }
}

function validateMigrationVersionNumbers(allVersions: string[]): {
  passed: boolean
  sortedVersions: number[]
} {
  try {
    const vArray = allVersions.map((v) => {
      return parseInt(v, 10)
    })

    if (vArray.find((v) => v <= 0)) {
      // found a negative version number
      console.error(Error('Migration versions must be positive integers'))
      return { passed: false, sortedVersions: [] }
    }

    return { passed: true, sortedVersions: vArray.sort((a, b) => a - b) }
  } catch {
    // parseInt failed. Some version must have been a non-integer
    console.error(Error('Migration versions must be positive integers'))
    return { passed: false, sortedVersions: [] }
  }
}

export type MigrationFunction = (d: KeyValueDB<DBShape>) => Promise<boolean>
