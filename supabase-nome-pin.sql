-- Livro-Caixa: entrar em qualquer aparelho com nome e PIN.
-- Rode uma vez no SQL Editor do Supabase, depois do supabase.sql. Pode rodar de novo sem problema.
--
-- O servidor guarda a chave do cofre criptografada com o PIN e só a entrega com o PIN certo.
-- Cada 5 PINs errados travam a entrada por 1 hora; com 20 erros seguidos, ela só volta com o
-- código de recuperação ou por um aparelho já conectado (salvando o nome de novo).

create table if not exists public.lc_accounts (
  name text primary key,
  vault_id text not null references public.lc_vaults(id) on delete cascade,
  salt text not null,
  pin_hash text not null,
  wrapped text not null,
  fails int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.lc_accounts enable row level security;

-- cria ou atualiza o nome de um cofre; exige o token do cofre, que só os aparelhos conectados têm
create or replace function public.lc_account_set(
  p_name text, p_vault text, p_token text, p_salt text, p_pin_hash text, p_wrapped text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text := encode(extensions.digest(p_token, 'sha256'), 'hex');
begin
  if p_name !~ '^[a-z0-9._-]{3,30}$' or p_pin_hash !~ '^[0-9a-f]{64}$'
     or length(p_salt) > 100 or length(p_wrapped) > 2000 then
    raise exception 'invalid';
  end if;
  if not exists (select 1 from lc_vaults where id = p_vault and token_hash = h) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from lc_accounts where name = p_name and vault_id <> p_vault) then
    raise exception 'taken';
  end if;
  delete from lc_accounts where vault_id = p_vault and name <> p_name;
  insert into lc_accounts (name, vault_id, salt, pin_hash, wrapped, fails, locked_until, updated_at)
  values (p_name, p_vault, p_salt, p_pin_hash, p_wrapped, 0, null, now())
  on conflict (name) do update
    set salt = excluded.salt, pin_hash = excluded.pin_hash, wrapped = excluded.wrapped,
        fails = 0, locked_until = null, updated_at = now();
end;
$$;

create or replace function public.lc_account_salt(p_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select salt from lc_accounts where name = lower(p_name);
$$;

-- devolve a chave criptografada se o PIN estiver certo; os erros voltam como resposta
-- (e não como exceção) para a contagem de tentativas ficar gravada
create or replace function public.lc_account_login(p_name text, p_pin_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a lc_accounts%rowtype;
  n int;
begin
  select * into a from lc_accounts where name = lower(p_name) for update;
  if not found then
    return jsonb_build_object('error', 'unknown');
  end if;
  if a.fails >= 20 then
    return jsonb_build_object('error', 'blocked');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('error', 'locked', 'minutes', ceil(extract(epoch from (a.locked_until - now())) / 60));
  end if;
  if a.pin_hash = p_pin_hash then
    update lc_accounts set fails = 0, locked_until = null where name = a.name;
    return jsonb_build_object('wrapped', a.wrapped);
  end if;
  n := a.fails + 1;
  update lc_accounts
    set fails = n, locked_until = case when n % 5 = 0 then now() + interval '1 hour' else null end
    where name = a.name;
  if n >= 20 then
    return jsonb_build_object('error', 'blocked');
  end if;
  if n % 5 = 0 then
    return jsonb_build_object('error', 'locked', 'minutes', 60);
  end if;
  return jsonb_build_object('error', 'wrong', 'left', 5 - (n % 5));
end;
$$;

revoke all on function public.lc_account_set(text, text, text, text, text, text) from public;
revoke all on function public.lc_account_salt(text) from public;
revoke all on function public.lc_account_login(text, text) from public;
grant execute on function public.lc_account_set(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.lc_account_salt(text) to anon, authenticated;
grant execute on function public.lc_account_login(text, text) to anon, authenticated;
