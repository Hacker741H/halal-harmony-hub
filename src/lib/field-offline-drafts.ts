import type { FieldDeclarationValues } from "@/lib/field-reports.functions";

const DATABASE_NAME = "halal-field-offline";
const DATABASE_VERSION = 1;
const STORE_NAME = "field-declaration-drafts";

export type OfflineFieldDeclarationDraft = {
  clientSubmissionId: string;
  reportId: string;
  values: FieldDeclarationValues;
  savedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Les brouillons hors connexion ne sont pas disponibles sur cet appareil."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Impossible d’ouvrir le stockage local sécurisé."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "clientSubmissionId" });
        store.createIndex("reportId", "reportId", { unique: false });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error ?? new Error("Impossible de mettre à jour le brouillon hors connexion."));
    request.onsuccess = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error("La mise à jour du brouillon a été annulée."));
    transaction.oncomplete = () => database.close();
  });
}

export async function saveOfflineFieldDeclarationDraft(draft: OfflineFieldDeclarationDraft) {
  await withStore("readwrite", (store) => store.put(draft));
}

export async function getOfflineFieldDeclarationDrafts(reportId: string): Promise<OfflineFieldDeclarationDraft[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index("reportId");
    const request = index.getAll(IDBKeyRange.only(reportId));
    request.onerror = () => reject(request.error ?? new Error("Impossible de lire les brouillons hors connexion."));
    request.onsuccess = () => {
      const drafts = (request.result as OfflineFieldDeclarationDraft[]).sort((left, right) => left.savedAt.localeCompare(right.savedAt));
      resolve(drafts);
    };
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => reject(transaction.error ?? new Error("La lecture des brouillons a été annulée."));
  });
}

export async function removeOfflineFieldDeclarationDraft(clientSubmissionId: string) {
  await withStore("readwrite", (store) => store.delete(clientSubmissionId));
}
