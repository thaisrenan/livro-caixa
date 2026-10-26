-- Livro-Caixa: banco no Supabase.
-- Cole tudo no SQL Editor do projeto e clique em Run. Pode rodar de novo sem problema.
--
-- O servidor só guarda dados criptografados. Ninguém lê nem altera as tabelas diretamente:
-- o acesso é feito pelas duas funções abaixo, que exigem o identificador e o token do cofre,
-- ambos derivados da chave que fica só nos seus aparelhos.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lc_vaults (
  id text primary key,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lc_entries (
  vault_id text not null references public.lc_vaults(id) on delete cascade,
  doc_id text not null,
  iv text,
  data text,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (vault_id, doc_id)
);

-- Sem políticas: o acesso direto às tabelas fica bloqueado para a chave pública.
alter table public.lc_vaults enable row level security;
alter table public.lc_entries enable row level security;

create or replace function public.lc_get(p_vault text, p_since timestamptz default null)
returns table (doc_id text, iv text, data text, deleted boolean, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select e.doc_id, e.iv, e.data, e.deleted, e.updated_at
  from lc_entries e
  where e.vault_id = p_vault
    and (p_since is null or e.updated_at > p_since)
  order by e.updated_at;
$$;

create or replace function public.lc_put(
  p_vault text, p_token text, p_doc text, p_iv text, p_data text, p_deleted boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  t timestamptz := clock_timestamp();
begin
  if p_vault !~ '^[0-9a-f]{64}$' or p_token !~ '^[0-9a-f]{64}$' or p_doc !~ '^[A-Za-z0-9_-]{1,40}$' then
    raise exception 'invalid';
  end if;
  if length(coalesce(p_data, '')) > 500000 then
    raise exception 'too large';
  end if;

  insert into lc_vaults (id, token_hash) values (p_vault, h) on conflict (id) do nothing;
  if not exists (select 1 from lc_vaults where id = p_vault and token_hash = h) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from lc_entries where vault_id = p_vault and lc_entries.doc_id = p_doc)
     and (select count(*) from lc_entries where vault_id = p_vault) >= 1000 then
    raise exception 'quota';
  end if;

  insert into lc_entries (vault_id, doc_id, iv, data, deleted, updated_at)
  values (p_vault, p_doc, p_iv, p_data, p_deleted, t)
  on conflict (vault_id, doc_id) do update
    set iv = excluded.iv, data = excluded.data, deleted = excluded.deleted, updated_at = t;
  return t;
end;
$$;

revoke all on function public.lc_get(text, timestamptz) from public;
revoke all on function public.lc_put(text, text, text, text, text, boolean) from public;
grant execute on function public.lc_get(text, timestamptz) to anon, authenticated;
grant execute on function public.lc_put(text, text, text, text, text, boolean) to anon, authenticated;
