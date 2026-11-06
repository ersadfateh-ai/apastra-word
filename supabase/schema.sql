-- Apastra Word cloud database. Run once in Supabase SQL Editor.
create table if not exists public.word_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  front text not null default '', back text not null default '', note text not null default '',
  category_id text not null default 'uncategorized', phonetic text not null default '',
  uk_audio text not null default '', us_audio text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.word_categories (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.review_logs (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null, category_id text, reviewed_at timestamptz not null default now()
);
alter table public.word_cards enable row level security;
alter table public.word_categories enable row level security;
alter table public.review_logs enable row level security;
drop policy if exists "Users manage own word cards" on public.word_cards;
create policy "Users manage own word cards" on public.word_cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own categories" on public.word_categories;
create policy "Users manage own categories" on public.word_categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own review logs" on public.review_logs;
create policy "Users manage own review logs" on public.review_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists word_cards_user_id_idx on public.word_cards(user_id);
create index if not exists review_logs_user_id_idx on public.review_logs(user_id);
