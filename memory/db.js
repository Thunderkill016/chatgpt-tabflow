const DB_NAME = 'tabflow_project_memory';
const DB_VERSION = 1;

let dbPromise = null;

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function ensureStore(db, name, keyPath, indexes = []) {
  const store = db.objectStoreNames.contains(name)
    ? null
    : db.createObjectStore(name, { keyPath });
  if (!store) return;
  for (const index of indexes) {
    store.createIndex(index.name, index.keyPath, index.options ?? {});
  }
}

export function openMemoryDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      ensureStore(db, 'projects', 'id', [
        { name: 'updatedAt', keyPath: 'updatedAt' }
      ]);
      ensureStore(db, 'conversations', 'id', [
        { name: 'projectId', keyPath: 'projectId' },
        { name: 'projectUpdatedAt', keyPath: ['projectId', 'updatedAt'] }
      ]);
      ensureStore(db, 'files', 'id', [
        { name: 'projectId', keyPath: 'projectId' },
        { name: 'projectPath', keyPath: ['projectId', 'path'], options: { unique: true } },
        { name: 'contentHash', keyPath: 'contentHash' },
        { name: 'updatedAt', keyPath: 'updatedAt' }
      ]);
      ensureStore(db, 'chunks', 'id', [
        { name: 'projectId', keyPath: 'projectId' },
        { name: 'fileId', keyPath: 'fileId' },
        { name: 'conversationId', keyPath: 'conversationId' },
        { name: 'projectMessage', keyPath: ['projectId', 'sourceMessageId'] },
        { name: 'contentHash', keyPath: 'contentHash' },
        { name: 'projectKind', keyPath: ['projectId', 'kind'] },
        { name: 'updatedAt', keyPath: 'updatedAt' }
      ]);
      ensureStore(db, 'decisions', 'id', [
        { name: 'projectId', keyPath: 'projectId' },
        { name: 'projectStatus', keyPath: ['projectId', 'status'] },
        { name: 'sourceConversationId', keyPath: 'sourceConversationId' },
        { name: 'updatedAt', keyPath: 'updatedAt' }
      ]);
      ensureStore(db, 'edges', 'id', [
        { name: 'projectId', keyPath: 'projectId' },
        { name: 'from', keyPath: 'from' },
        { name: 'to', keyPath: 'to' },
        { name: 'type', keyPath: 'type' }
      ]);
      ensureStore(db, 'meta', 'key', []);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open project memory database'));
    request.onblocked = () => reject(new Error('Project memory database upgrade is blocked by another TabFlow context'));
  });
  return dbPromise;
}

export async function withTx(storeNames, mode, callback) {
  const db = await openMemoryDb();
  const tx = db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
  const result = await callback(stores, tx);
  await txDone(tx);
  return result;
}

export async function put(storeName, value) {
  return withTx([storeName], 'readwrite', async stores => req(stores[storeName].put(value)));
}

export async function get(storeName, key) {
  return withTx([storeName], 'readonly', async stores => req(stores[storeName].get(key)));
}

export async function deleteKey(storeName, key) {
  return withTx([storeName], 'readwrite', async stores => req(stores[storeName].delete(key)));
}

export async function getAllFromIndex(storeName, indexName, query = null, count = undefined) {
  return withTx([storeName], 'readonly', async stores => {
    const index = stores[storeName].index(indexName);
    return req(index.getAll(query, count));
  });
}

export async function getOneFromIndex(storeName, indexName, query) {
  return withTx([storeName], 'readonly', async stores => req(stores[storeName].index(indexName).get(query)));
}

export async function deleteAllFromIndex(storeName, indexName, query) {
  return withTx([storeName], 'readwrite', async stores => {
    const index = stores[storeName].index(indexName);
    const request = index.openKeyCursor(query);
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        stores[storeName].delete(cursor.primaryKey);
        cursor.continue();
      };
    });
  });
}

export async function iterateIndex(storeName, indexName, query, callback) {
  return withTx([storeName], 'readonly', async stores => {
    const request = stores[storeName].index(indexName).openCursor(query);
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        try {
          // Callback deliberately synchronous. Awaiting inside an IndexedDB cursor
          // callback can let the transaction auto-close between turns.
          callback(cursor.value, cursor.primaryKey);
          cursor.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  });
}

export async function countFromIndex(storeName, indexName, query) {
  return withTx([storeName], 'readonly', async stores => req(stores[storeName].index(indexName).count(query)));
}

export async function clearProject(projectId) {
  const db = await openMemoryDb();
  const tx = db.transaction(['conversations', 'files', 'chunks', 'decisions', 'edges'], 'readwrite');
  const configs = [
    ['conversations', 'projectId'],
    ['files', 'projectId'],
    ['chunks', 'projectId'],
    ['decisions', 'projectId'],
    ['edges', 'projectId']
  ];

  await Promise.all(configs.map(([storeName, indexName]) => new Promise((resolve, reject) => {
    const store = tx.objectStore(storeName);
    const cursorReq = store.index(indexName).openKeyCursor(IDBKeyRange.only(projectId));
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error(`Failed clearing ${storeName}`));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  })));

  await txDone(tx);
}

export async function getProjectStats(projectId) {
  const [conversations, files, chunks, decisions, edges] = await Promise.all([
    countFromIndex('conversations', 'projectId', IDBKeyRange.only(projectId)),
    countFromIndex('files', 'projectId', IDBKeyRange.only(projectId)),
    countFromIndex('chunks', 'projectId', IDBKeyRange.only(projectId)),
    countFromIndex('decisions', 'projectId', IDBKeyRange.only(projectId)),
    countFromIndex('edges', 'projectId', IDBKeyRange.only(projectId))
  ]);
  return { conversations, files, chunks, decisions, edges };
}
