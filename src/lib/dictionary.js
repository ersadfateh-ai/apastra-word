const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const WIKTIONARY_API = "https://en.wiktionary.org/api/rest_v1/page/definition/";
const MEMORY_API = "https://api.mymemory.translated.net/get";
const DATAMUSE_API = "https://api.datamuse.com/words";

export function isPersian(text) { return /[\u0600-\u06FF]/.test(text); }

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export async function translate(text, from, to) {
  const url = `${MEMORY_API}?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const data = await fetchJson(url);
  const value = data?.responseData?.translatedText;
  if (!value || Number(data.responseStatus) !== 200) throw new Error("Translation service is unavailable.");
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function audioRegion(url = "") {
  const value = url.toLowerCase();
  if (/(uk|gb)([-_.]|\.mp3)/.test(value)) return "uk";
  if (/(us|us_)([-_.]|\.mp3)/.test(value)) return "us";
  return "unknown";
}
function normalizeDefinition(item) {
  return { definition: item.definition || "", example: item.example || "", synonyms: item.synonyms || [], antonyms: item.antonyms || [] };
}
function normalizeEntry(entries, fallbackWord) {
  const phonetics = entries.flatMap(entry => entry.phonetics || []);
  const audios = { uk: [], us: [], unknown: [] };
  phonetics.forEach(item => { if (item.audio) audios[audioRegion(item.audio)].push(item.audio); });
  const meanings = entries.flatMap(entry => (entry.meanings || []).map(meaning => ({
    partOfSpeech: meaning.partOfSpeech,
    definitions: (meaning.definitions || []).map(normalizeDefinition).filter(x => x.definition),
    synonyms: meaning.synonyms || [], antonyms: meaning.antonyms || []
  })).filter(x => x.definitions.length));
  return { word: entries[0]?.word || fallbackWord, phonetic: entries.map(entry => entry.phonetic).find(Boolean) || phonetics.map(item => item.text).find(Boolean) || "", audios, meanings, synonyms: [...new Set(meanings.flatMap(x => x.synonyms))], antonyms: [...new Set(meanings.flatMap(x => x.antonyms))], source: entries.flatMap(entry => entry.sourceUrls || [])[0] || "https://dictionaryapi.dev/" };
}
async function lookupEnglish(raw) {
  const word = raw.trim().replace(/^[“”"'`]+|[“”"'`.,!?;:]+$/g, "");
  if (!word) throw new Error("Enter a word to search.");
  try {
    const entries = await fetchJson(DICTIONARY_API + encodeURIComponent(word));
    if (Array.isArray(entries) && entries.length) return normalizeEntry(entries, word);
  } catch { /* use the second dictionary source */ }
  // Wiktionary includes many inflections, compounds, technical terms and less common words.
  const data = await fetchJson(WIKTIONARY_API + encodeURIComponent(word));
  const english = data?.en || [];
  const meanings = english.flatMap(pos => (pos.definitions || []).map(def => ({
    partOfSpeech: pos.partOfSpeech || "meaning",
    definitions: [{ definition: String(def.definition || "").replace(/<[^>]*>/g, ""), example: (def.examples || []).map(x => String(x).replace(/<[^>]*>/g, "")).filter(Boolean)[0] || "", synonyms: [], antonyms: [] }],
    synonyms: [], antonyms: []
  }))).filter(x => x.definitions[0].definition);
  if (!meanings.length) throw new Error("No dictionary definition found for this entry.");
  return { word, phonetic: "", audios: { uk: [], us: [], unknown: [] }, meanings, source: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}` };
}
async function getSuggestions(term) {
  try {
    const words = await fetchJson(`${DATAMUSE_API}?sp=${encodeURIComponent(term)}&max=8`);
    return [...new Set((words || []).map(item => item.word).filter(Boolean))].slice(0, 6);
  } catch { return []; }
}
async function relatedWords(word, relation) {
  try {
    const list = await fetchJson(`${DATAMUSE_API}?${relation}=${encodeURIComponent(word)}&max=12`);
    return [...new Set((list || []).map(x => x.word).filter(Boolean))].slice(0, 10);
  } catch { return []; }
}
function candidates(input) {
  const clean = input.trim().replace(/\s+/g, " ").replace(/^[“”"'`]+|[“”"'`.,!?;:]+$/g, "");
  const values = [clean];
  if (/ies$/i.test(clean)) values.push(clean.replace(/ies$/i, "y"));
  if (/ves$/i.test(clean)) values.push(clean.replace(/ves$/i, "f"), clean.replace(/ves$/i, "fe"));
  if (/s$/i.test(clean) && clean.length > 3) values.push(clean.slice(0, -1));
  if (/ing$/i.test(clean) && clean.length > 5) { const stem = clean.slice(0, -3); values.push(stem, stem + "e"); if (/(.)\1$/i.test(stem)) values.push(stem.slice(0, -1)); }
  if (/ed$/i.test(clean) && clean.length > 4) { const stem = clean.slice(0, -2); values.push(stem, stem + "e"); if (/(.)\1$/i.test(stem)) values.push(stem.slice(0, -1)); }
  return [...new Set(values.filter(Boolean))];
}
async function translateDefinitions(entry) {
  const all = entry.meanings.flatMap(group => group.definitions);
  // Limit concurrent requests to keep mobile browsers responsive.
  for (let i = 0; i < Math.min(all.length, 30); i += 4) {
    await Promise.all(all.slice(i, i + 4).map(async item => {
      try { item.persianDefinition = await translate(item.definition, "en", "fa"); }
      catch { item.persianDefinition = "ترجمهٔ این تعریف در دسترس نیست."; }
      if (item.example) {
        try { item.persianExample = await translate(item.example, "en", "fa"); }
        catch { item.persianExample = ""; }
      }
    }));
  }
  return entry;
}

export async function lookupWord(raw) {
  const input = raw.trim();
  if (!input) throw new Error("Enter a word to search.");
  let englishTerm = input;
  const originalPersian = isPersian(input) ? input : "";
  if (originalPersian) {
    try { englishTerm = await translate(input, "fa", "en"); }
    catch { throw new Error("Persian-to-English translation is unavailable. Try an English spelling or check your connection."); }
  }
  let entry;
  let lastError;
  for (const candidate of candidates(englishTerm)) {
    try { entry = await lookupEnglish(candidate); break; }
    catch (error) { lastError = error; }
  }
  if (!entry && !originalPersian && /\s/.test(englishTerm)) {
    // Retry the complete phrase before falling back to suggestions (phrasal verbs and idioms).
    try { entry = await lookupEnglish(englishTerm); } catch (error) { lastError = error; }
  }
  if (!entry) {
    const suggestions = await getSuggestions(englishTerm.split(/\s+/)[0]);
    const error = new Error(suggestions.length
      ? `No exact dictionary entry found. Similar spellings: ${suggestions.join(", ")}.`
      : (lastError?.message || "No dictionary entry found. Check the spelling or try the complete base word."));
    error.suggestions = suggestions;
    throw error;
  }
  try { entry.persian = originalPersian || await translate(entry.word, "en", "fa"); }
  catch { entry.persian = originalPersian || "ترجمهٔ کلی در دسترس نیست."; }
  await Promise.all([translateDefinitions(entry), (async () => {
    const [synonyms, antonyms] = await Promise.all([relatedWords(entry.word, "rel_syn"), relatedWords(entry.word, "rel_ant")]);
    entry.synonyms = [...new Set([...(entry.synonyms || []), ...synonyms])].slice(0, 12); entry.antonyms = [...new Set([...(entry.antonyms || []), ...antonyms])].slice(0, 12);
  })()]);
  entry.searchTerm = input;
  return entry;
}
