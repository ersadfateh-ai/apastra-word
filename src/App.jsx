import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Layers, Brain, BarChart3, FileUp, Settings, Plus, Search, Clock3,
  Volume2, Pencil, Trash2, UserRound, Upload, RotateCcw, Check, X, ChevronRight,
  Download, FolderPlus, Sparkles, Keyboard, FileDown
} from "lucide-react";

import {
  getAllCards, saveCard, saveCardsBulk, removeCard, getSetting, setSetting, getProfile,
  setProfile, resetAll, getReviewLogs, saveReviewLog, getDictionaryCache, setDictionaryCache
} from "./lib/db";
import { lookupWord } from "./lib/dictionary";
import { supabase, cloudReady, syncAccountData } from "./lib/supabase";

const DEFAULTS = { theme: "midnight", reviewReverse: false };

const NAV = [
  ["Dictionary", BookOpen], ["My Flashcards", Layers], ["Review", Brain],
  ["Statistics", BarChart3], ["Import / Export", FileUp], ["Settings", Settings]
];
const uid = () => crypto.randomUUID();
const toDate = value => value instanceof Date ? value : value ? new Date(value) : null;
const dueDate = card => toDate(card.fsrs?.due || card.due) || new Date(0);
const isDue = () => true;

export default function App() {
  const [page, setPage] = useState("Dictionary");
  const [cards, setCards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [profile, setProfileState] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [settings, setSettings] = useState(DEFAULTS);
  const [logs, setLogs] = useState([]);
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [reviewCategory, setReviewCategory] = useState("all");
  const [reviewCards, setReviewCards] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewDone, setReviewDone] = useState(0);
  const [query, setQuery] = useState("");
  const [dict, setDict] = useState(null);
  const [dictBusy, setDictBusy] = useState(false);
  const [dictError, setDictError] = useState("");
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [recentSearches, setRecentSearches] = useState([]);
  const [dictUpdatedAt, setDictUpdatedAt] = useState(null);
  const [dictFromCache, setDictFromCache] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [session, setSession] = useState(null);
  const [dataReady, setDataReady] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const avatarRef = useRef(null);
  const importRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [rawCards, storedCategories, storedProfile, storedSettings, storedLogs] = await Promise.all([
        getAllCards(), getSetting("categories", []), getProfile(), getSetting("app", DEFAULTS), getReviewLogs()
      ]);
      const migrated = rawCards.map(c => ({
        ...c,
        front: c.front ?? c.word ?? "",
        back: c.back ?? c.translation ?? "",
        note: c.note ?? c.definition ?? c.example ?? "",
        categoryId: c.categoryId || "uncategorized",
      }));
      for (const card of migrated) await saveCard(card);
      const cats = storedCategories.length ? storedCategories : [{ id: "uncategorized", name: "Uncategorized", createdAt: Date.now() }];
      if (!cats.some(c => c.id === "uncategorized")) cats.unshift({ id: "uncategorized", name: "Uncategorized", createdAt: Date.now() });
      setCards(migrated.sort((a,b) => b.createdAt - a.createdAt));
      setCategories(cats); await setSetting("categories", cats);
      setProfileState(storedProfile || null); setSettings({ ...DEFAULTS, ...(storedSettings || {}) });
      setLogs(storedLogs);
      setRecentSearches(await getSetting("dictionaryRecent", []));
      if (!storedProfile?.name) setShowWelcome(true);
      setDataReady(true);
    })().catch(error => { console.error("Apastra startup failed", error); setDataReady(true); setNotice("Could not load saved data. Refresh the page and try again."); });
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!dataReady || !session?.user?.id || !cloudReady) return;
    const timer = window.setTimeout(() => {
      syncAccountData(session.user.id, { cards, categories, logs }).catch(error => console.warn("Apastra background sync paused:", error));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [dataReady, session?.user?.id, cards, categories, logs]);

  useEffect(() => { document.documentElement.dataset.theme = settings.theme || "midnight"; }, [settings.theme]);
  useEffect(() => {
    const online = () => setIsOnline(true); const offline = () => setIsOnline(false);
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);
  useEffect(() => {
    const onKey = e => {
      if (page !== "Review" || !reviewCards.length || editor || showWelcome) return;
      if (e.code === "Space" && !e.target.closest?.("button,input,textarea,select")) { e.preventDefault(); setRevealed(v => !v); }
      if (e.key === "ArrowRight" && revealed) { e.preventDefault(); nextReviewCard(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, reviewCards, editor, showWelcome, reviewIndex, revealed]);

  const filteredCards = useMemo(() => cards.filter(c =>
    (activeCategory === "all" || c.categoryId === activeCategory) &&
    `${c.front} ${c.back} ${c.note || ""}`.toLowerCase().includes(query.toLowerCase())
  ), [cards, activeCategory, query]);
  const current = reviewCards[reviewIndex];
  const dueCount = cards.filter(isDue).length;

  async function refreshCards() { const latest = (await getAllCards()).sort((a,b) => b.createdAt - a.createdAt); setCards(latest); return latest; }
  async function saveCategory() {
    const name = categoryDraft.trim();
    if (!name) return;
    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) { setNotice("That category already exists."); return; }
    const next = [...categories, { id: uid(), name, createdAt: Date.now() }];
    setCategories(next); await setSetting("categories", next); setCategoryDraft(""); setNotice("Category created.");
  }
  async function deleteCategory(category) {
    if (category.id === "uncategorized") return;
    const next = categories.filter(c => c.id !== category.id);
    const moved = cards.map(c => c.categoryId === category.id ? { ...c, categoryId: "uncategorized" } : c);
    setCategories(next); setCards(moved); await setSetting("categories", next);
    for (const c of moved.filter(c => c.categoryId === "uncategorized")) await saveCard(c);
    if (activeCategory === category.id) setActiveCategory("all");
  }
  async function saveFlashcard(data) {
    const old = cards.find(c => c.id === data.id);
    const card = {
      ...(old || {}), ...data, id: data.id || uid(), createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(),
      categoryId: data.categoryId || (activeCategory !== "all" ? activeCategory : "uncategorized")
    };
    await saveCard(card);
    const latest = await refreshCards();
    setEditor(null);
    setNotice("Flashcard saved successfully.");
    return card;
  }
  async function deleteFlashcard(id) {
    if (!window.confirm("Delete this flashcard?")) return;
    await removeCard(id); await refreshCards(); setNotice("Flashcard deleted.");
  }
  async function searchDictionary(forceRefresh = false, searchTerm = query) {
    const term = searchTerm.trim();
    if (!term) return;
    setDictBusy(true); setDictError("");
    const key = term.toLocaleLowerCase();
    try {
      const cached = await getDictionaryCache(key);
      if (cached && !forceRefresh) {
        setDict(cached.data || cached); setDictFromCache(true);
        setDictUpdatedAt(cached.savedAt || null);
      }
      if (!navigator.onLine) {
        if (!cached) { setDict(null); setDictError("You are offline. This word has not been saved on this device yet."); }
        else setNotice("Showing the saved offline dictionary entry.");
      } else {
        try {
          const fresh = await lookupWord(term);
          const record = { data: fresh, savedAt: Date.now(), query: term };
          await setDictionaryCache(key, record);
          setDict(fresh); setDictFromCache(false); setDictUpdatedAt(record.savedAt);
        } catch (networkError) {
          if (!cached) throw networkError;
          setDict(cached.data || cached); setDictFromCache(true); setDictUpdatedAt(cached.savedAt || null);
          setNotice("Online lookup failed. Showing the saved copy instead.");
        }
      }
      const recent = [term, ...recentSearches.filter(x => x.toLowerCase() !== key)].slice(0, 8);
      setRecentSearches(recent); await setSetting("dictionaryRecent", recent);
    } catch (e) { setDictError(e.message || "Search failed."); }
    finally { setDictBusy(false); }
  }
  async function addFromDictionary() {
    if (!dict) return;
    const normalized = String(dict.word || query).trim().toLocaleLowerCase();
    const existing = cards.find(card => String(card.front || "").trim().toLocaleLowerCase() === normalized);
    if (existing) {
      setPage("My Flashcards"); setActiveCategory("all"); setNotice("This word is already in your flashcards."); return;
    }
    const senses = (dict.meanings || []).flatMap(group => (group.definitions || []).map(item =>
      `${group.partOfSpeech || "Meaning"}: ${item.definition}\nترجمه: ${item.persianDefinition || "ترجمه در دسترس نیست"}${item.example ? `\nExample: ${item.example}` : ""}`
    ));
    const card = {
      front: dict.word, back: dict.persian || "Translation unavailable", note: senses.slice(0, 8).join("\n\n"),
      phonetic: dict.phonetic, ukAudio: dict.audios?.uk?.[0] || "", usAudio: dict.audios?.us?.[0] || "",
      categoryId: "uncategorized"
    };
    await saveFlashcard(card);
    await refreshCards();
    setPage("My Flashcards"); setActiveCategory("all");
    setNotice(`“${dict.word}” was saved to My Flashcards.`);
  }
  function beginReview() {
    const selected = cards.filter(c => reviewCategory === "all" || c.categoryId === reviewCategory);
    if (!selected.length) { setNotice("No cards are due in this category. Add new cards or come back later."); return; }
    setReviewCards(selected); setReviewIndex(0); setReviewDone(0); setRevealed(false); setPage("Review");
  }
  async function nextReviewCard() {
    const card = reviewCards[reviewIndex];
    if (!card) return;
    setRevealed(false);
    const log = { id: uid(), cardId: card.id, categoryId: card.categoryId, reviewedAt: Date.now() };
    await saveReviewLog(log);
    setLogs(prev => [...prev, log]);
    setReviewDone(v => v + 1);
    if (reviewIndex + 1 >= reviewCards.length) {
      setReviewCards([]); setReviewIndex(0);
    } else setReviewIndex(v => v + 1);
  }

  async function accountAction(mode) {
    if (!supabase) { setNotice("Cloud account is not configured. Add the Supabase environment variables in Vercel."); return; }
    if (!accountEmail.trim() || accountPassword.length < 8) { setNotice("Enter a valid email and a password with at least 8 characters."); return; }
    setAccountBusy(true);
    try {
      const result = mode === "signup"
        ? await supabase.auth.signUp({ email: accountEmail.trim(), password: accountPassword })
        : await supabase.auth.signInWithPassword({ email: accountEmail.trim(), password: accountPassword });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) {
        setNotice("Check your email to confirm your account, then sign in.");
      } else if (result.data.session) {
        setSession(result.data.session);
        const merged = await syncAccountData(result.data.session.user.id, { cards, categories, logs });
        const cardMap = new Map(merged.cards.map(card => [card.id, card]));
        cards.forEach(card => cardMap.set(card.id, card));
        const mergedCards = [...cardMap.values()];
        const categoryMap = new Map(merged.categories.map(category => [category.id, category]));
        categories.forEach(category => categoryMap.set(category.id, category));
        const mergedCategories = [...categoryMap.values()];
        const logMap = new Map(merged.logs.map(log => [log.id, log]));
        logs.forEach(log => logMap.set(log.id, log));
        const mergedLogs = [...logMap.values()];
        for (const card of mergedCards) await saveCard(card);
        await setSetting("categories", mergedCategories);
        for (const log of mergedLogs) await saveReviewLog(log);
        setCards(mergedCards); setCategories(mergedCategories); setLogs(mergedLogs);
        setNotice("Account connected. Your local and cloud words have been merged.");
      }
    } catch (error) { setNotice(error.message || "Account operation failed."); }
    finally { setAccountBusy(false); }
  }
  async function syncNow() {
    if (!session?.user?.id) return;
    setAccountBusy(true);
    try {
      const merged = await syncAccountData(session.user.id, { cards, categories, logs });
      const cardMap = new Map(merged.cards.map(card => [card.id, card])); cards.forEach(card => cardMap.set(card.id, card));
      const mergedCards = [...cardMap.values()];
      const categoryMap = new Map(merged.categories.map(category => [category.id, category])); categories.forEach(category => categoryMap.set(category.id, category));
      const mergedCategories = [...categoryMap.values()];
      const logMap = new Map(merged.logs.map(log => [log.id, log])); logs.forEach(log => logMap.set(log.id, log));
      const mergedLogs = [...logMap.values()];
      for (const card of mergedCards) await saveCard(card);
      await setSetting("categories", mergedCategories);
      for (const log of mergedLogs) await saveReviewLog(log);
      setCards(mergedCards); setCategories(mergedCategories); setLogs(mergedLogs);
      setNotice("Sync completed. Your words are up to date.");
    } catch (error) { setNotice(error.message || "Sync failed. Your local words are still saved."); }
    finally { setAccountBusy(false); }
  }

  async function updateProfile(next) {
    const value = { ...(profile || {}), ...next }; setProfileState(value); await setProfile(value);
  }
  function handleAvatar(file) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 3 * 1024 * 1024) { setNotice("Choose an image file smaller than 3 MB."); return; }
    const reader = new FileReader(); reader.onload = () => updateProfile({ avatar: reader.result }); reader.readAsDataURL(file);
  }
  async function resetEverything() {
    if (resetPassword !== "reset.ai") { setNotice("Incorrect reset password."); return; }
    if (!window.confirm("This permanently deletes all local cards, categories, profile and review history. Continue?")) return;
    await resetAll(); setCards([]); setCategories([{ id: "uncategorized", name: "Uncategorized" }]);
    setLogs([]); setProfileState(null); setShowWelcome(true); setPage("Dictionary"); setShowReset(false); setResetPassword("");
    await setSetting("categories", [{ id: "uncategorized", name: "Uncategorized" }]);
    setNotice("All local data has been reset.");
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ app: "Apastra Word", version: 2, exportedAt: new Date().toISOString(), categories, cards, logs }, null, 2)], { type: "application/json" });
    downloadBlob(blob, "apastra-word-backup.json");
  }
  function exportCSV() {
    const rows = [["front","back","note","category","phonetic"], ...cards.map(c => [c.front,c.back,c.note || "",categories.find(k=>k.id===c.categoryId)?.name || "Uncategorized",c.phonetic || ""])];
    const csv = rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
    downloadBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), "apastra-word-cards.csv");
  }
  async function importFile(file) {
    if (!file) return;
    setFileBusy(true);
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      let imported = [];
      let nextCategories = [...categories];
      if (file.name.toLowerCase().endsWith(".json")) {
        const data = JSON.parse(text);
        if (!Array.isArray(data.cards)) throw new Error("This JSON file does not contain a cards array.");
        const categoryIdMap = new Map();
        for (const category of (Array.isArray(data.categories) ? data.categories : [])) {
          const name = String(category?.name || "").trim();
          if (!name) continue;
          let existing = nextCategories.find(x => x.name.toLowerCase() === name.toLowerCase());
          if (!existing) { existing = { ...category, id: uid(), name }; nextCategories.push(existing); }
          if (category.id) categoryIdMap.set(category.id, existing.id);
        }
        imported = data.cards.map(raw => ({
          ...raw, id: uid(), front: String(raw.front ?? raw.word ?? "").trim(),
          back: String(raw.back ?? raw.translation ?? "").trim(),
          note: String(raw.note ?? raw.definition ?? raw.example ?? ""),
          categoryId: categoryIdMap.get(raw.categoryId) || nextCategories.find(x => x.id === raw.categoryId)?.id || "uncategorized",
          createdAt: Date.now(), updatedAt: Date.now()
        })).filter(card => card.front && card.back);
      } else {
        const rows = parseCSV(text);
        if (rows.length < 2) throw new Error("The file has no data rows.");
        const headers = rows.shift().map(x => normalizeHeader(x));
        const aliases = {
          front: ["front","word","question","english","term","vocabulary","source","لغت","کلمه","واژه"],
          back: ["back","translation","answer","meaning","persian","farsi","definition","ترجمه","معنی"],
          note: ["note","description","explanation","details","توضیحات"],
          example: ["example","sentence","sample_sentence","مثال","جمله"],
          pos: ["part_of_speech","partofspeech","pos","word_type","grammar","نوع_کلمه","نقش_دستوری"],
          category: ["category","deck","دسته"], phonetic: ["phonetic","ipa","pronunciation","تلفظ"]
        };
        const index = key => headers.findIndex(h => aliases[key].includes(h));
        const frontIndex = index("front"), backIndex = index("back");
        if (frontIndex < 0 || backIndex < 0) throw new Error("Could not identify the word and meaning columns. Use headers such as English/Persian or Front/Back.");
        const cell = (row,key) => { const i=index(key); return i>=0 ? String(row[i] ?? "").trim() : ""; };
        for (const row of rows) {
          const front=String(row[frontIndex] ?? "").trim(), back=String(row[backIndex] ?? "").trim();
          if (!front || !back) continue;
          const categoryName=cell(row,"category") || "Uncategorized";
          let category=nextCategories.find(c=>c.name.toLowerCase()===categoryName.toLowerCase());
          if (!category) { category={id:uid(),name:categoryName,createdAt:Date.now()}; nextCategories.push(category); }
          const noteParts=[cell(row,"note"), cell(row,"pos") ? `Part of speech: ${cell(row,"pos")}` : "", cell(row,"example") ? `Example: ${cell(row,"example")}` : ""].filter(Boolean);
          imported.push({id:uid(),front,back,note:noteParts.join("\n\n"),phonetic:cell(row,"phonetic"),categoryId:category.id,createdAt:Date.now(),updatedAt:Date.now()});
        }
      }
      if (!imported.length) throw new Error("No valid cards were found. Each row needs both a word and a meaning.");
      await saveCardsBulk(imported);
      await setSetting("categories", nextCategories);
      setCategories(nextCategories);
      await refreshCards();
      setActiveCategory("all"); setQuery(""); setPage("My Flashcards");
      setNotice(`${imported.length} cards imported successfully.`);
    } catch (e) { setNotice(`Import failed: ${e.message}`); }
    finally { setFileBusy(false); if (importRef.current) importRef.current.value = ""; }
  }

  const recentDays = Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (6-i));
    return { label: d.toLocaleDateString("en-US",{weekday:"short"}), count: logs.filter(l => new Date(l.reviewedAt).toDateString() === d.toDateString()).length };
  });
  const maxDaily = Math.max(1, ...recentDays.map(d=>d.count));
  const dueNow = cards.filter(isDue).length;
  const learned = cards.length;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><BookOpen size={23}/></div><div><b>Apastra Word</b><small>Vocabulary, simplified.</small></div></div>
      <div className="profile-mini"><div className="avatar">{profile?.avatar ? <img src={profile.avatar}/> : <UserRound/>}</div><b>{profile?.name || "Learner"}</b><small>{cards.length} flashcards</small></div>
      <nav className="nav-list">{NAV.map(([label,Icon])=><button key={label} className={`nav-item ${page===label?"active":""}`} onClick={()=>setPage(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-foot">APASTRA WORD <span>•</span> OFFLINE FIRST</div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div><span className="eyebrow">YOUR VOCABULARY SPACE</span><h1>{page}</h1></div><div className="top-actions">{page === "My Flashcards" && <div className="searchbox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search flashcards..."/></div>}<button className="user-chip" onClick={()=>setPage("Settings")}>{profile?.avatar?<img src={profile.avatar}/>:<UserRound size={17}/>}<span>{profile?.name || "Profile"}</span></button></div></header>

      {page === "Dictionary" && <section className="content">
        <div className="dictionary-hero"><div className="dict-connectivity"><span className={`connection-dot ${isOnline ? "online" : "offline"}`}></span><b>{isOnline ? "Online dictionary" : "Offline mode"}</b><span>{isOnline ? "Live lookup + saved words" : "Saved words available on this device"}</span></div><span className="eyebrow">ENGLISH ↔ PERSIAN</span><h2>Find the right word.</h2><p>Search in English or Persian. Hear the pronunciation and save useful words.</p>
          <div className="lookup-box"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchDictionary()} placeholder="Type an English or Persian word..."/><button className="primary-btn" onClick={searchDictionary} disabled={dictBusy}>{dictBusy?"Searching...":"Search"}</button></div>
          {dictError && <div className="error-banner">{dictError}</div>}
        </div>
        {recentSearches.length > 0 && <div className="recent-searches"><span className="eyebrow">RECENT SEARCHES</span>{recentSearches.map(term=><button key={term} onClick={()=>{setQuery(term);searchDictionary(false,term)}}>{term}</button>)}</div>}
        {dict && <div className="dictionary-result"><div className="dict-head"><div><span className="eyebrow">WORD</span><h2>{dict.word}</h2><p className="phonetic">{dict.phonetic || "IPA unavailable"}</p></div><div className="dict-actions"><button className="secondary-btn" onClick={()=>searchDictionary(true)} disabled={!isOnline}><RotateCcw size={15}/> Refresh</button><button className="primary-btn" onClick={addFromDictionary}><Plus size={16}/> Add to flashcards</button></div></div>
          <div className="translation-panel"><span>فارسی</span><strong>{dict.persian}</strong></div>
          {!!dict.meanings?.length && <div className="dict-senses"><div className="panel-heading"><h3>Meanings & usage</h3><small>English definitions with Persian machine translations</small></div>{dict.meanings.map((group,index)=><div className="dict-sense" key={`${group.partOfSpeech}-${index}`}><b>{group.partOfSpeech || "Meaning"}</b>{group.definitions.map((item,i)=><div className="dict-definition" key={i}><p>{item.definition}</p>{item.persianDefinition && <strong>{item.persianDefinition}</strong>}{item.example && <><small>Example: “{item.example}”</small>{item.persianExample && <small className="example-translation">ترجمه مثال: {item.persianExample}</small>}</>}</div>)}</div>)}</div>}
          {(dict.synonyms?.length>0 || dict.antonyms?.length>0) && <div className="dict-senses dict-related">{dict.synonyms?.length>0 && <div><b>Synonyms / مترادف‌ها</b><p>{dict.synonyms.join(" · ")}</p></div>}{dict.antonyms?.length>0 && <div><b>Antonyms / متضادها</b><p>{dict.antonyms.join(" · ")}</p></div>}</div>}
          <div className="dict-cache-meta"><span>{dictFromCache ? "Saved offline copy" : "Latest online result"}</span><span>{dictUpdatedAt ? `Saved ${new Date(dictUpdatedAt).toLocaleString()}` : "Not saved yet"}</span></div>
          <div className="audio-grid"><AudioCard label="British English" url={dict.audios?.uk?.[0]}/><AudioCard label="American English" url={dict.audios?.us?.[0]}/></div>
          {!(dict.audios?.uk?.length) && !(dict.audios?.us?.length) && <small className="muted-note">Accent-specific audio is not available for this entry.</small>}
        </div>}
        <div className="offline-note"><Sparkles size={18}/><span>Dictionary entries are saved on this device. Previously searched words remain available offline; new words and updated definitions require an internet connection. Audio is cached by the browser when available.</span></div>
      </section>}

      {page === "My Flashcards" && <section className="content">
        <div className="section-heading"><div><span className="eyebrow">YOUR PERSONAL COLLECTION</span><h3>My Flashcards</h3><p>Create categories, then add simple front-and-back cards.</p></div><button className="primary-btn" onClick={()=>setEditor({front:"",back:"",note:"",categoryId:activeCategory!=="all"?activeCategory:"uncategorized"})}><Plus size={17}/> Add Flashcard</button></div>
        <div className="category-manager"><div className="category-create"><FolderPlus size={18}/><input value={categoryDraft} onChange={e=>setCategoryDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveCategory()} placeholder="New category name"/><button className="secondary-btn" onClick={saveCategory}>Create category</button></div><div className="category-chips"><button className={activeCategory==="all"?"selected":""} onClick={()=>setActiveCategory("all")}>All ({cards.length})</button>{categories.map(c=><span className="category-chip" key={c.id}><button className={activeCategory===c.id?"selected":""} onClick={()=>setActiveCategory(c.id)}>{c.name} ({cards.filter(x=>x.categoryId===c.id).length})</button>{c.id!=="uncategorized"&&<button className="chip-delete" title="Delete category" onClick={()=>deleteCategory(c)}><X size={12}/></button>}</span>)}</div></div>
        {filteredCards.length ? <div className="flashcard-grid">{filteredCards.map(c=><article className="saved-card" key={c.id}><div className="saved-card-top"><span>{categories.find(k=>k.id===c.categoryId)?.name || "Uncategorized"}</span><div><button onClick={()=>setEditor(c)} title="Edit"><Pencil size={15}/></button><button onClick={()=>deleteFlashcard(c.id)} title="Delete"><Trash2 size={15}/></button></div></div><div className="saved-front">{c.front}</div><div className="saved-divider"/><div className="saved-back">{c.back}</div>{c.note&&<p className="saved-note">{c.note}</p>}</article>)}</div> : <Empty icon={Layers} title="No flashcards here yet" text="Create a category and add your first front-and-back card."/>}
      </section>}

      {page === "Review" && <section className="content review-page">
        {!reviewCards.length ? <div className="review-start"><div className="review-symbol"><Brain size={34}/></div><span className="eyebrow">SIMPLE WORD REVIEW</span><h2>Review your words.</h2><p>See a word, check its meaning, and move to the next one. No ratings or difficulty buttons.</p><label className="field-label">Choose a category<select value={reviewCategory} onChange={e=>setReviewCategory(e.target.value)}><option value="all">All categories</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><div className="review-start-stats"><div><b>{cards.length}</b><small>Total cards</small></div><div><b>{cards.filter(c=>reviewCategory==="all"||c.categoryId===reviewCategory).length}</b><small>In this category</small></div></div><button className="primary-btn" onClick={beginReview} disabled={!cards.some(c=>reviewCategory==="all"||c.categoryId===reviewCategory)}>Start Review <ChevronRight size={17}/></button></div> : <div className="review-workspace">
          <div className="review-topline"><span>WORD REVIEW</span><span>{reviewIndex+1} of {reviewCards.length}</span></div><div className="review-progress"><span style={{width:`${(reviewIndex+1)/reviewCards.length*100}%`}}/></div>
          {current && <button type="button" className={`review-card ${revealed ? "is-revealed" : ""}`} onClick={()=>setRevealed(v=>!v)} aria-label={revealed ? "Hide answer" : "Reveal answer"}>
            <span className="review-card-label">{revealed ? (settings.reviewReverse ? "ORIGINAL FRONT" : "BACK OF CARD") : (settings.reviewReverse ? "BACK OF CARD" : "FRONT OF CARD")}</span>
            <div className="review-card-main">{revealed ? (settings.reviewReverse ? current.front : current.back) : (settings.reviewReverse ? current.back : current.front)}</div>
            {revealed && current.note && <div className="review-card-note">{current.note}</div>}
            <small>{revealed ? "Click to hide answer" : "Click the card to reveal the answer"}</small>
          </button>}
          <button className="primary-btn" onClick={nextReviewCard}>Next word <ChevronRight size={17}/></button>
          <div className="keyboard-hint"><Keyboard size={14}/> Space: reveal / hide · →: next word</div>
        </div>}
        {reviewDone>0&&!reviewCards.length&&<div className="review-complete"><Check size={28}/><h3>Review complete</h3><p>You reviewed {reviewDone} words.</p><button className="secondary-btn" onClick={()=>{setReviewDone(0);setPage("Statistics")}}>View Statistics</button></div>}
      </section>}

      {page === "Statistics" && <section className="content"><div className="section-heading"><div><span className="eyebrow">YOUR LEARNING DATA</span><h3>Statistics</h3><p>A clear picture of your vocabulary progress.</p></div></div><div className="stats-grid"><Stat icon={Layers} label="Total flashcards" value={cards.length}/><Stat icon={Brain} label="Cards reviewed" value={logs.length}/><Stat icon={Clock3} label="Categories" value={categories.length}/><Stat icon={Check} label="Reviews today" value={logs.filter(log => new Date(log.reviewedAt).toDateString() === new Date().toDateString()).length}/></div><div className="stats-panel"><div className="panel-heading"><div><h3>Reviews · Last 7 days</h3><small>Number of card reviews per day</small></div><BarChart3 size={20}/></div><div className="bar-chart">{recentDays.map(d=><div className="bar-column" key={d.label}><b>{d.count}</b><div className="bar-track"><span style={{height:`${Math.max(4,d.count/maxDaily*100)}%`}}/></div><small>{d.label}</small></div>)}</div></div><div className="stats-panel category-stats"><div className="panel-heading"><h3>Cards by category</h3></div>{categories.map(c=><div className="category-stat" key={c.id}><span>{c.name}</span><div className="mini-track"><span style={{width:`${cards.length?cards.filter(x=>x.categoryId===c.id).length/cards.length*100:0}%`}}/></div><b>{cards.filter(x=>x.categoryId===c.id).length}</b></div>)}</div></section>}

      {page === "Import / Export" && <section className="content"><div className="section-heading"><div><span className="eyebrow">YOUR DATA, YOUR CONTROL</span><h3>Import / Export</h3><p>Back up your cards or move them between devices.</p></div></div><div className="io-grid"><div className="io-card"><div className="io-icon blue"><Download size={22}/></div><h3>Export backup</h3><p>Download categories, flashcards and FSRS review progress in one JSON file.</p><button className="primary-btn" onClick={exportJSON}>Export full backup</button></div><div className="io-card"><div className="io-icon gold"><FileDown size={22}/></div><h3>Export CSV</h3><p>Download your front, back, notes and category names as a spreadsheet-friendly file.</p><button className="secondary-btn" onClick={exportCSV}>Export CSV</button></div><div className="io-card"><div className="io-icon green"><FileUp size={22}/></div><h3>Import cards</h3><p>Import an Apastra JSON backup or a CSV with Front, Back, Note and Category columns.</p><input ref={importRef} type="file" accept=".json,.csv,application/json,text/csv" hidden onChange={e=>importFile(e.target.files?.[0])}/><button className="secondary-btn" onClick={()=>importRef.current?.click()} disabled={fileBusy}>{fileBusy?"Importing...":"Choose a file"}</button></div></div><div className="offline-note"><Check size={17}/><span>Import and export run locally in your browser. No file is uploaded to a server.</span></div></section>}

      {page === "Settings" && <section className="content"><div className="section-heading"><div><span className="eyebrow">PREFERENCES & PROFILE</span><h3>Settings</h3><p>Personalise your workspace and protect your data.</p></div></div><div className="settings-layout"><div className="settings-card"><div className="settings-title"><UserRound size={19}/><div><b>Profile</b><small>Your display name and profile photo</small></div></div><div className="profile-settings"><div className="profile-large">{profile?.avatar?<img src={profile.avatar}/>:<UserRound size={36}/>}</div><div><b>{profile?.name || "Learner"}</b><p className="muted-note">Your profile details are saved on this device.</p><button className="secondary-btn" onClick={()=>avatarRef.current?.click()}><Upload size={15}/> Change photo</button><input ref={avatarRef} type="file" accept="image/*" hidden onChange={e=>handleAvatar(e.target.files?.[0])}/></div></div><label className="field-label">Display name<input value={profile?.name||""} onChange={e=>updateProfile({name:e.target.value})}/></label></div>
          <div className="settings-card"><div className="settings-title"><UserRound size={19}/><div><b>Cloud account</b><small>{!cloudReady ? "Cloud sync setup required" : session ? `Connected: ${session.user.email}` : "Save and access your words across devices"}</small></div></div>
            {!cloudReady ? <p className="muted-note">To enable cloud storage, add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel after creating your Supabase project. Local saving continues to work.</p> : session ? <><p className="muted-note">Your words are stored locally and can be merged with your private cloud account.</p><div className="modal-actions"><button className="primary-btn" disabled={accountBusy} onClick={syncNow}>{accountBusy?"Syncing...":"Sync now"}</button><button className="secondary-btn" onClick={async()=>{await supabase.auth.signOut();setSession(null);setNotice("Signed out. Local words remain on this device.");}}>Sign out</button></div></> : <><label className="field-label">Email<input type="email" autoComplete="email" value={accountEmail} onChange={e=>setAccountEmail(e.target.value)} placeholder="you@example.com"/></label><label className="field-label">Password<input type="password" autoComplete="current-password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} placeholder="At least 8 characters"/></label><div className="modal-actions"><button className="secondary-btn" disabled={accountBusy} onClick={()=>accountAction("signup")}>Create account</button><button className="primary-btn" disabled={accountBusy} onClick={()=>accountAction("signin")}>{accountBusy?"Please wait...":"Sign in"}</button></div><small className="muted-note">Create an account once. Confirm your email if Supabase asks you to. Never share your password or secret service-role keys.</small></>}
          </div>
          <div className="settings-card"><div className="settings-title"><Layers size={19}/><div><b>Flashcard sides</b><small>Choose which side appears first during review</small></div></div><label className="field-label" style={{display:"flex",alignItems:"center",gap:12,marginTop:16}}><input type="checkbox" checked={Boolean(settings.reviewReverse)} onChange={async e=>{const next={...settings,reviewReverse:e.target.checked};setSettings(next);await setSetting("app",next);}}/><span>Swap front and back during review</span></label><p className="muted-note">When enabled, the saved back is shown first and the saved front appears after clicking the card.</p></div>
          <div className="settings-card"><div className="settings-title"><Sparkles size={19}/><div><b>Appearance</b><small>Choose your preferred colour theme</small></div></div><div className="theme-options">{["midnight","light","forest"].map(t=><button key={t} className={`theme-choice ${settings.theme===t?"selected":""}`} onClick={async()=>{const n={...settings,theme:t};setSettings(n);await setSetting("app",n);}}><span className={`theme-swatch ${t}`}/><b>{t==="midnight"?"Midnight":t==="light"?"Light":"Forest"}</b>{settings.theme===t&&<Check size={16}/>}</button>)}</div></div>
          <div className="settings-card danger-card"><div className="settings-title"><RotateCcw size={19}/><div><b>Reset all data</b><small>Delete all flashcards, categories, profile and review history</small></div></div><button className="danger-btn" onClick={()=>setShowReset(v=>!v)}><Trash2 size={16}/> Reset all data</button>{showReset&&<div className="reset-confirm"><p>Enter the reset password to continue.</p><input type="password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} placeholder="Reset password"/><button className="danger-btn" onClick={resetEverything}>Confirm reset</button></div>}<small className="muted-note">Export a backup before resetting. This action cannot be undone.</small></div>
        </div></section>}
    </main>

    {showWelcome&&<div className="modal-backdrop"><div className="modal welcome-modal"><div className="modal-logo"><BookOpen size={27}/></div><span className="eyebrow">WELCOME</span><h2>Apastra Word</h2><p>What name should appear on your profile?</p><input autoFocus value={nameDraft} onChange={e=>setNameDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&nameDraft.trim()&&(updateProfile({name:nameDraft.trim()}),setShowWelcome(false))} placeholder="Your name"/><button className="primary-btn full" disabled={!nameDraft.trim()} onClick={()=>{updateProfile({name:nameDraft.trim()});setShowWelcome(false);}}>Continue <ChevronRight size={16}/></button></div></div>}
    {editor&&<CardEditor initial={editor} categories={categories} onClose={()=>setEditor(null)} onSave={saveFlashcard}/>}
    {notice&&<div className="toast"><Check size={16}/>{notice}<button onClick={()=>setNotice("")}><X size={15}/></button></div>}
  </div>;
}

function downloadBlob(blob, name) { const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }
function reviveFsrs(raw) { return raw || null; }
function normalizeHeader(value) { return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_"); }
function parseCSV(text) {
  const sample=text.slice(0,12000); const candidates=[",",";","\t","|"];
  const delimiter=candidates.map(d=>({d,count:(sample.split(/\r?\n/).slice(0,8).map(line=>line.split(d).length-1).reduce((a,b)=>a+b,0))})).sort((a,b)=>b.count-a.count)[0]?.d || ",";
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++) { const ch=text[i],next=text[i+1];
    if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;}
    else if(ch==='"') quoted=!quoted;
    else if(ch===delimiter&&!quoted){row.push(cell);cell="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&next==="\n")i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell="";}
    else cell+=ch;
  }
  if(quoted) throw new Error("The CSV file contains an unclosed quotation mark.");
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
function Empty({icon:Icon,title,text}) { return <div className="empty-state"><Icon size={30}/><h3>{title}</h3><p>{text}</p></div>; }
function Stat({icon:Icon,label,value}) { return <div className="stat-card"><div className="stat-icon"><Icon size={18}/></div><div><small>{label}</small><b>{value}</b></div></div>; }
function AudioCard({label,url}) { return <div className="audio-card"><div><Volume2 size={18}/><b>{label}</b></div>{url?<audio controls preload="none" src={url}/>:<small className="muted-note">Audio unavailable</small>}</div>; }
function CardEditor({initial,categories,onClose,onSave}) {
  const [form,setForm]=useState({front:"",back:"",note:"",categoryId:"uncategorized",...initial});
  const change=e=>setForm(v=>({...v,[e.target.name]:e.target.value}));
  return <div className="modal-backdrop"><div className="modal editor-modal"><div className="modal-head"><div><span className="eyebrow">MY FLASHCARDS</span><h2>{initial.id?"Edit Flashcard":"Add Flashcard"}</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></div><label className="field-label">Front *<textarea autoFocus name="front" value={form.front} onChange={change} placeholder="Word or question"/></label><label className="field-label">Back *<textarea name="back" value={form.back} onChange={change} placeholder="Meaning or answer"/></label><label className="field-label">Note (optional)<textarea name="note" value={form.note||""} onChange={change} placeholder="Add a short note, or leave empty"/></label><small className="muted-note">Category: {categories.find(c=>c.id===form.categoryId)?.name || "Uncategorized"}. Select a category in My Flashcards before adding a card.</small><div className="modal-actions"><button className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={!form.front.trim()||!form.back.trim()} onClick={()=>onSave(form)}><Check size={16}/> Save Flashcard</button></div></div></div>;
}
