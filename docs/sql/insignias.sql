-- Tabelas das insígnias do .profile.
-- Rodar no SQL editor do Supabase: o repo não tem migrations, o schema vive lá.
-- Nomes conferidos como livres em 13/09/2026.

-- Estado atual de cada insígnia de cada membro: uma linha por (membro, insígnia), reescrita pelo
-- cron das 04:00. O tier SOBE E DESCE (warn, streak quebrada, inativação); `tier_maximo` nunca desce.
-- Leitura que falhou não toca na linha — é por isso que `medido_em` existe.
create table if not exists profile_badges (
  discord_id    text        not null,
  badge_key     text        not null,
  tier          smallint    not null default 0,   -- 0 = bloqueada. Única: 0 ou 1. Progressiva: 0 até o nº de tiers
  tier_maximo   smallint    not null default 0,
  valor         numeric,                          -- o número medido, para a lista mostrar progresso
  medido_em     timestamptz,                      -- última leitura boa
  atualizado_em timestamptz not null default now(),
  primary key (discord_id, badge_key)
);

-- Quando cada tier foi alcançado pela primeira vez. Só insert: perder e reconquistar mantém a data
-- original. Os tiers que já existiam no primeiro cálculo nascem com a data desse cálculo, não a real.
create table if not exists profile_badge_tiers (
  discord_id   text        not null,
  badge_key    text        not null,
  tier         smallint    not null,
  alcancado_em timestamptz not null default now(),
  primary key (discord_id, badge_key, tier)
);

-- Perfil editável pelo membro. Usada a partir da fase 2 (cartão, vitrine e botão de sync);
-- criada agora para o SQL sair de uma vez só.
create table if not exists profiles (
  discord_id     text primary key,
  mensagem       text,
  vitrine        text[]      not null default '{}',  -- até 8 badge_key, na ordem de exibição
  ultimo_sync_em timestamptz,                        -- cooldown de 15 min do botão, gravado para sobreviver a restart
  atualizado_em  timestamptz not null default now()
);

-- MVP de cada semana, uma linha por pessoa por semana, staff incluída. Até 03/09/2026 foi importado
-- à mão; a partir da quarta 16/09/2026 o cron do MVP grava (gravarMvpsDaSemana em src/insignias.js).
-- A streak conta semanas consecutivas pela ORDEM das datas presentes na tabela, não por 7 dias
-- exatos — então tanto faz gravar a quarta do MVP ou a quinta que abriu a semana, desde que seja
-- sempre a mesma. Semana inteira faltando na tabela quebra a streak de todo mundo.
create table if not exists weekly_mvp_history (
  week_start date        not null,
  discord_id text        not null,
  created_at timestamptz not null default now(),
  primary key (week_start, discord_id)
);

-- Mensagens e tempo de call no servidor (Tagarela e Voz Ativa).
-- Mesma divisão do ticket_activity: *_iniciais é a sua exportação, *_contadas é o bot somando
-- a partir da data de corte dela. Zerar um lado não apaga o outro.
create table if not exists player_activity (
  discord_id             text primary key,
  mensagens_iniciais     integer     not null default 0,
  horas_call_iniciais    numeric     not null default 0,
  mensagens_contadas     integer     not null default 0,
  segundos_call_contados bigint      not null default 0,
  atualizado_em          timestamptz not null default now()
);
