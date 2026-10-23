-- Aliases do .daily compradas na loja (item de type DAILY_ALIAS em tgg_coins_shop).
-- Rodar no SQL editor do Supabase: o repo não tem migrations, o schema vive lá.
--
-- As aliases antigas continuam escritas em COMMAND_ALIASES (src/commands.js), com o autor no
-- comentário. Daqui pra frente cada compra vira uma linha aqui, com quem comprou.

create table if not exists tgg_coins_daily_aliases (
  alias      text        primary key,              -- já em minúsculas e sem o ponto, como o index.js compara
  discord_id text        not null,                 -- quem comprou
  nome       text,                                 -- nome de exibição na hora da compra, pra leitura humana
  criado_em  timestamptz not null default now()
);
