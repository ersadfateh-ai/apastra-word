import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;
export const cloudReady = Boolean(supabase);

export async function syncAccountData(userId, { cards, categories, logs }) {
  if (!supabase) throw new Error('Cloud storage is not configured yet.');
  const cardRows = cards.map(card => ({
    id: card.id, user_id: userId, front: card.front || '', back: card.back || '', note: card.note || '',
    category_id: card.categoryId || 'uncategorized', phonetic: card.phonetic || '',
    uk_audio: card.ukAudio || '', us_audio: card.usAudio || '', created_at: new Date(card.createdAt || Date.now()).toISOString(),
    updated_at: new Date(card.updatedAt || card.createdAt || Date.now()).toISOString()
  }));
  const categoryRows = categories.map(category => ({
    id: category.id, user_id: userId, name: category.name,
    created_at: new Date(category.createdAt || Date.now()).toISOString()
  }));
  const logRows = logs.map(log => ({
    id: log.id, user_id: userId, card_id: log.cardId, category_id: log.categoryId || null,
    reviewed_at: new Date(log.reviewedAt || Date.now()).toISOString()
  }));
  // Merge rather than replace: existing cloud rows are never cleared during first sync.
  for (const [table, rows] of [['word_cards', cardRows], ['word_categories', categoryRows], ['review_logs', logRows]]) {
    if (!rows.length) continue;
    const { error } = await supabase.from(table).upsert(rows, { onConflict: table === 'word_categories' ? 'user_id,id' : 'id' });
    if (error) throw error;
  }
  const [cloudCards, cloudCategories, cloudLogs] = await Promise.all([
    supabase.from('word_cards').select('*').eq('user_id', userId),
    supabase.from('word_categories').select('*').eq('user_id', userId),
    supabase.from('review_logs').select('*').eq('user_id', userId)
  ]);
  for (const result of [cloudCards, cloudCategories, cloudLogs]) if (result.error) throw result.error;
  return {
    cards: (cloudCards.data || []).map(row => ({ id: row.id, front: row.front, back: row.back, note: row.note, categoryId: row.category_id || 'uncategorized', phonetic: row.phonetic, ukAudio: row.uk_audio, usAudio: row.us_audio, createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime() })),
    categories: (cloudCategories.data || []).map(row => ({ id: row.id, name: row.name, createdAt: new Date(row.created_at).getTime() })),
    logs: (cloudLogs.data || []).map(row => ({ id: row.id, cardId: row.card_id, categoryId: row.category_id, reviewedAt: new Date(row.reviewed_at).getTime() }))
  };
}
