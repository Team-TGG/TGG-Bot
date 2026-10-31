-- Cargos personalizados comprados na loja (item de type CUSTOM_ROLE em tgg_coins_shop).
-- Rodar no SQL editor do Supabase: o repo não tem migrations, o schema vive lá.
--
-- Uma linha por compra. `role_id` nulo = pago e ainda não criado: a compra vira um crédito que o
-- dono resgata pelo .cargo, então fechar o modal sem querer não perde as moedas.
-- Quem está usando cada cargo continua em tgg_coins_inventory, como as cores da loja.

create table if not exists tgg_coins_custom_roles (
  id               uuid        primary key default gen_random_uuid(),
  owner_discord_id text        not null,          -- quem comprou: só ele edita, dá e tira
  role_id          text        unique,            -- cargo no Discord; nulo até o dono criar
  criado_em        timestamptz not null default now(),
  cargo_criado_em  timestamptz
);

create index if not exists tgg_coins_custom_roles_owner on tgg_coins_custom_roles (owner_discord_id);
