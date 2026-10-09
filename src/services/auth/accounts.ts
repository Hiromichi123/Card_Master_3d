/** Browser-local accounts. Credentials and profiles never leave this origin. */
export interface LoginAccount {
  readonly id: string;
  readonly username: string;
}

export const ACCOUNT_USERNAME_MAX_LENGTH = 24;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 4;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

interface StoredAccount extends LoginAccount {
  readonly version: 1;
  readonly usernameKey: string;
  readonly algorithm: 'PBKDF2-SHA-256';
  readonly iterations: number;
  readonly salt: string;
  readonly passwordHash: string;
  readonly createdAt: string;
}

const DATABASE = 'card-master-3d-accounts';
const STORE = 'accounts';
const ITERATIONS = 600_000;
let connection: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

function credentials(username: string, password: string): { username: string; key: string } {
  const name = username.normalize('NFKC').trim();
  if (!/^[\p{L}\p{N}_.-]{2,24}$/u.test(name)) {
    throw new Error('账号需为 2–24 位中文、字母、数字、下划线、连字符或英文点。');
  }
  if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH || password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
    throw new Error('密码长度需为 4–128 位，空格会作为密码的一部分。');
  }
  return { username: name, key: name.toLowerCase() };
}

function requireCrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('此环境不支持安全密码校验，请使用 localhost 或 HTTPS 打开游戏。');
  }
  return globalThis.crypto;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomHex(length: number): string {
  return hex(requireCrypto().getRandomValues(new Uint8Array(length)));
}

async function passwordDigest(password: string, saltHex: string, iterations: number): Promise<string> {
  try {
    const crypto = requireCrypto();
    const salt = new Uint8Array(saltHex.length / 2);
    for (let index = 0; index < salt.length; index += 1) {
      salt[index] = Number.parseInt(saltHex.slice(index * 2, index * 2 + 2), 16);
    }
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
    );
    const digest = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256,
    );
    return hex(new Uint8Array(digest));
  } catch {
    throw new Error('安全密码校验未完成，请使用支持 Web Crypto 的浏览器重试。');
  }
}

function storedAccount(value: unknown): StoredAccount | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('本地账号数据损坏，无法登录。');
  const candidate = value as Partial<StoredAccount>;
  if (
    candidate.version !== 1 || candidate.algorithm !== 'PBKDF2-SHA-256'
    || typeof candidate.id !== 'string' || !/^(admin|player-[a-f0-9]{32})$/.test(candidate.id)
    || typeof candidate.username !== 'string' || typeof candidate.usernameKey !== 'string'
    || candidate.username.normalize('NFKC').trim().toLowerCase() !== candidate.usernameKey
    || (candidate.id === 'admin') !== (candidate.usernameKey === 'admin')
    || typeof candidate.iterations !== 'number' || !Number.isInteger(candidate.iterations)
    || candidate.iterations < 100_000 || candidate.iterations > 1_000_000
    || typeof candidate.salt !== 'string' || !/^[a-f0-9]{32}$/.test(candidate.salt)
    || typeof candidate.passwordHash !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.passwordHash)
    || typeof candidate.createdAt !== 'string'
  ) throw new Error('本地账号数据格式不正确，无法登录。');
  return candidate as StoredAccount;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      reject(new Error('无法打开本地账号库，请允许浏览器保存此站点的数据。'));
      return;
    }
    let settled = false;
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('本地账号库打开超时，请关闭其它游戏标签页后重试。'), 5000);
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort();
        return;
      }
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'usernameKey' });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => fail('本地账号库打开失败，请检查浏览器的站点存储权限。');
    request.onblocked = () => fail('账号库被其它游戏标签页占用，请关闭其它页面后重试。');
  });
}

function readAccount(db: IDBDatabase, key: string): Promise<StoredAccount | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key);
    transaction.oncomplete = () => {
      try { resolve(storedAccount(request.result)); } catch (error) { reject(error); }
    };
    transaction.onabort = () => reject(new Error('读取本地账号失败，请重试。'));
    transaction.onerror = () => reject(new Error('读取本地账号失败，请检查站点存储权限。'));
  });
}

async function makeAccount(id: string, username: string, key: string, password: string): Promise<StoredAccount> {
  const salt = randomHex(16);
  return {
    id, username, usernameKey: key, version: 1, algorithm: 'PBKDF2-SHA-256',
    iterations: ITERATIONS, salt, passwordHash: await passwordDigest(password, salt, ITERATIONS),
    createdAt: new Date().toISOString(),
  };
}

async function ensureDefaultAccount(db: IDBDatabase): Promise<void> {
  if (await readAccount(db, 'admin')) return;
  const initial = await makeAccount('admin', 'admin', 'admin', 'admin');
  // Check again in the same write transaction: two tabs may initialize together.
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get('admin');
    request.onsuccess = () => {
      if (request.result === undefined) store.add(initial);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('默认账号保存失败，请允许本地存储后重试。'));
    transaction.onerror = () => reject(new Error('默认账号保存失败，请检查可用存储空间。'));
  });
}

async function getDatabase(): Promise<IDBDatabase> {
  requireCrypto();
  if (typeof indexedDB === 'undefined') throw new Error('此浏览器不支持本地账号存储。');
  if (connection) return connection;
  if (!opening) {
    opening = openDatabase().then(async (db) => {
      try {
        await ensureDefaultAccount(db);
        connection = db;
        db.onversionchange = () => {
          db.close();
          if (connection === db) connection = null;
        };
        db.onclose = () => { if (connection === db) connection = null; };
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    }).finally(() => { opening = null; });
  }
  return opening;
}

/** Storage can also throw synchronously when a browser closes a connection. */
async function withStorageErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DOMException) {
      throw new Error('本地账号存储暂时不可用，请检查站点存储权限后重试。');
    }
    if (error instanceof Error) throw error;
    throw new Error('本地账号操作未完成，请重试。');
  }
}

/** Resolve only after successful password verification; no session is saved. */
export function authenticateAccount(username: string, password: string): Promise<LoginAccount> {
  return withStorageErrors(async () => {
    const validated = credentials(username, password);
    const db = await getDatabase();
    const account = await readAccount(db, validated.key);
    if (!account) throw new Error('账号或密码不正确。');
    const digest = await passwordDigest(password, account.salt, account.iterations);
    let difference = 0;
    for (let index = 0; index < digest.length; index += 1) {
      difference |= digest.charCodeAt(index) ^ account.passwordHash.charCodeAt(index);
    }
    if (difference !== 0) throw new Error('账号或密码不正确。');
    return { id: account.id, username: account.username };
  });
}

/** Resolve only after the unique account has been committed to IndexedDB. */
export function registerAccount(username: string, password: string): Promise<LoginAccount> {
  return withStorageErrors(async () => {
    const validated = credentials(username, password);
    const db = await getDatabase();
    if (await readAccount(db, validated.key)) throw new Error('该账号已存在，请更换账号或直接登录。');
    const account = await makeAccount(`player-${randomHex(16)}`, validated.username, validated.key, password);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const request = transaction.objectStore(STORE).add(account);
      const failure = (): void => reject(new Error(
        request.error?.name === 'ConstraintError'
          ? '该账号已存在，请更换账号或直接登录。'
          : '账号保存失败，请检查浏览器的站点存储权限及可用空间后重试。',
      ));
      transaction.oncomplete = () => resolve();
      transaction.onabort = failure;
      transaction.onerror = failure;
    });
    return { id: account.id, username: account.username };
  });
}
