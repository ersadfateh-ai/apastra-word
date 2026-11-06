import { openDB } from "idb";

const DB_NAME = "apastra-word";
const DB_VERSION = 3;
const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("cards")) db.createObjectStore("cards", { keyPath: "id" });
    if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile");
    if (!db.objectStoreNames.contains("reviewLogs")) db.createObjectStore("reviewLogs", { keyPath: "id" });
    if (!db.objectStoreNames.contains("dictionaryCache")) db.createObjectStore("dictionaryCache");
  }
});
export async function getAllCards() { return (await dbPromise).getAll("cards"); }
export async function saveCard(card) { return (await dbPromise).put("cards", card); }
export async function saveCardsBulk(cards) {
  const db = await dbPromise;
  const tx = db.transaction("cards", "readwrite");
  for (const card of cards) tx.store.put(card);
  await tx.done;
}
export async function removeCard(id) { return (await dbPromise).delete("cards", id); }
export async function getSetting(key, fallback = null) { return (await dbPromise).get("settings", key) ?? fallback; }
export async function setSetting(key, value) { return (await dbPromise).put("settings", value, key); }
export async function getProfile() { return (await dbPromise).get("profile", "current"); }
export async function setProfile(profile) { return (await dbPromise).put("profile", profile, "current"); }
export async function getReviewLogs() { return (await dbPromise).getAll("reviewLogs"); }
export async function getDictionaryCache(key) { return (await dbPromise).get("dictionaryCache", key.toLowerCase()); }
export async function setDictionaryCache(key, value) { return (await dbPromise).put("dictionaryCache", value, key.toLowerCase()); }
export async function saveReviewLog(log) { return (await dbPromise).put("reviewLogs", log); }
export async function resetAll() {
  const db = await dbPromise;
  const names = ["cards", "settings", "profile", "reviewLogs", "dictionaryCache"];
  const tx = db.transaction(names, "readwrite");
  await Promise.all([...names.map(name => tx.objectStore(name).clear()), tx.done]);
}
