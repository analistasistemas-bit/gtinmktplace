-- Credencial JoomPulse por organização + estado efêmero do OAuth (ADR-0132 D-5, D-15; Errata 1).
--
-- Duas tabelas com ciclos de vida opostos:
--   joompulse_credenciais      — uma linha por org, vive até o "Desconectar"
--   joompulse_oauth_estados    — uma linha por tentativa de conexão, vive 10 minutos
--
-- REGRA CENTRAL: nenhum token aparece aqui em texto puro. As colunas guardam o resultado do
-- AES-256-GCM feito no Gateway; o Postgres nunca vê a chave. Isso é deliberado — o cofre é o
-- ambiente do Web Service, não o banco, e um dump do banco não entrega acesso à JoomPulse.
--
-- RLS: `authenticated` NÃO recebe grant de select nestas tabelas. Diferente das tabelas do Pulse,
-- aqui nem o membro da própria org tem o que ler — o conteúdo é credencial. O acesso é do Gateway,
-- que usa service role. As policies existem mesmo assim, como segunda tranca independente do
-- privilégio (o mesmo raciocínio do comentário "privilégio e policy são checagens independentes"
-- da migration do Pulse).

create table if not exists public.joompulse_credenciais (
  org_id uuid primary key references public.organizations(id) on delete cascade,

  -- Envelope do AES-256-GCM, em base64: iv || tag || ciphertext. `versao_chave` permite rotacionar
  -- a chave sem reconectar todas as orgs de uma vez.
  access_token_cifrado text not null,
  refresh_token_cifrado text,
  versao_chave smallint not null default 1,

  expira_em timestamptz,
  escopo text,

  -- Quem conectou, para a D-21: a assinatura pode ser pessoal e o app precisa avisar o admin
  -- quando essa pessoa sai. Nunca serve para resolver org — isso vem do token (D-15).
  conectado_por uuid references auth.users(id),
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.joompulse_credenciais is
  'Credencial OAuth da JoomPulse por organização. Tokens cifrados no Gateway (AES-256-GCM); o banco nunca vê a chave.';

create table if not exists public.joompulse_oauth_estados (
  -- O `state` do OAuth. É a única prova de identidade no callback, porque o redirect da JoomPulse
  -- chega ao Gateway sem o JWT do usuário. Por isso: aleatório, uso único e curto.
  state text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  iniciado_por uuid not null references auth.users(id),

  -- Verifier do PKCE. Fica no servidor de propósito: se trafegasse pelo browser junto do state,
  -- o PKCE deixaria de proteger contra interceptação do code.
  code_verifier text not null,
  redirect_uri text not null,

  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  -- Marcado no primeiro uso. Segunda tentativa com o mesmo state é replay e deve falhar.
  usado_em timestamptz
);

create index joompulse_oauth_estados_expira_idx on public.joompulse_oauth_estados (expira_em);

comment on table public.joompulse_oauth_estados is
  'Estado efêmero do fluxo OAuth (state + PKCE verifier). Uso único, expira em minutos.';

alter table public.joompulse_credenciais   enable row level security;
alter table public.joompulse_oauth_estados enable row level security;

-- Sem policy permissiva e sem grant a `authenticated`: com RLS ligada e nenhuma policy, o acesso
-- de qualquer papel que não seja service role é negado por padrão. É o comportamento desejado —
-- credencial não é dado de tela.
revoke all on public.joompulse_credenciais   from authenticated, anon;
revoke all on public.joompulse_oauth_estados from authenticated, anon;
