# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm start        # sobe o bot (node index.js) — mesmo que `npm run sync`
```

Não há suíte de testes, linter ou build. Verificação = rodar o bot e usar o comando no Discord.
Node >= 18 (usa `fetch` nativo), ESM (`"type": "module"` — todo import precisa da extensão `.js`).

`.env` obrigatório (não versionado): `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_ANON_KEY`), `BRAWLHALLA_API_KEY`.
Opcionais: `BRAWLHALLA_CLAN_ID` (default `'396943'` no código), `INACTIVE_MESSAGE_INTERVAL` (default 3h),
`IGNORE_SSL_ERRORS=true` para desligar verificação TLS (uso local). `win-ca` carrega os certificados do Windows.
O `.env` ainda tem `TGG_API_URL`, `TGG_API_KEY` e `GUILD_ACTIVITY_CHANNEL_ID` — sobras dos módulos removidos,
nenhum código lê essas três.

Subir o bot **registra os slash commands na guild via PUT** ([src/slash/register.js](src/slash/register.js)) e
dispara `startInactiveReminder` 5s depois do ready — ou seja, rodar localmente com o token de produção
afeta o servidor real. Considere isso antes de sugerir "é só rodar pra testar".

## Arquitetura

### Dois caminhos de entrada, um só conjunto de handlers

Todo comando existe como prefixo `.comando` **e** como `/comando`, executando a **mesma função handler**:

- **Prefixo**: `messageCreate` em [index.js](index.js) → resolve alias em `COMMAND_ALIASES` → `commands[nome]`.
- **Slash**: `interactionCreate` em [src/interactions.js](src/interactions.js) → `commands[interaction.commandName]`
  → `runAsSlash()` de [utils/slashAdapter.js](utils/slashAdapter.js).

O adapter monta um **message-shim**: converte `interaction.options` em `args` posicionais e em um objeto
parecido com `Message` (`author`, `member`, `channel`, `mentions`, `reply()`). Consequências práticas:

- A assinatura de todo handler é `(message, args, client)` — nunca `(interaction)`.
- `reply()` usa `fetchReply: true` para devolver uma `Message` real, então `createMessageComponentCollector`
  funciona igual nos dois caminhos. Botões/menus **não** passam pelo router de `interactionCreate`;
  cada handler é dono do próprio collector. Só modais são roteados por prefixo de `customId`.
- Quando o handler precisa de opções tipadas (número, canal, texto longo), ele testa `if (message.interaction)`
  e lê `message.interaction.options.getX(...)`, com fallback para parse de `args` no caminho prefixo.
  Ver `handleEditWarn`, `handleCadastrarMissao`, `handleEscrever`, `handleAddCoins`.

Adicionar um comando exige **três** edições: o handler no módulo correspondente, a entrada em `commands`
+ aliases em [src/commands.js](src/commands.js), e o `SlashCommandBuilder` em
[src/slash/builders/](src/slash/builders/) (`public.js` / `admin.js` / `economy.js`). Esquecer o builder
faz o comando existir só por prefixo. Limite de 100 slash commands por guild.

Três comandos existem **só por prefixo**, de propósito: `crz`, `wam` e `bam` (brincadeira/interno).
Não assuma que é esquecimento e não crie builder pra eles sem pedir.

Para saber quantos comandos existem, rode `node .claude/skills/checar/check.mjs` — **não confie nos
comentários de contagem** nos arquivos de builder, eles desatualizam a cada comando novo.

Os aliases incluem dezenas de typos e apelidos internos de membros (`.deiucu`, `.pizzolho` → `daily`).
Isso é intencional, não sujeira — não "limpe" sem pedir.

### Camadas

| Camada | Arquivos | Papel |
| :-- | :-- | :-- |
| Entrada | [index.js](index.js), [src/interactions.js](src/interactions.js) | login, rate limit 5s/usuário (staff isento), permissão de canal, try/catch global |
| Roteamento | [src/commands.js](src/commands.js) | mapa alias → nome → handler |
| Handlers | [src/public.js](src/public.js), [src/admin.js](src/admin.js), [src/tggCoinsCommands.js](src/tggCoinsCommands.js) | um handler por comando, monta embeds e collectors |
| Lógica de apoio | [src/handlers/](src/handlers/) | ramos de compra (`buyHandlers`), cálculo de missões, quiz — extraído dos handlers grandes |
| Dados | [src/db.js](src/db.js), [src/tggCoins.js](src/tggCoins.js), [src/guild.js](src/guild.js), [src/moderation.js](src/moderation.js) | acesso Supabase — handler novo deve passar por aqui (o `admin.js` ainda tem 3 chamadas diretas legadas) |
| APIs externas | [src/brawlhalla.js](src/brawlhalla.js), [src/nicknameSync.js](src/nicknameSync.js) | Brawlhalla API (stats, clã, guild points) |
| Sincronização | [src/discord.js](src/discord.js) | mapas de cargo e a lógica de aplicar cargos por rank/ELO |
| Agendamento | [src/scheduler/cron.js](src/scheduler/cron.js), [src/services/](src/services/) | crons e loops de fundo |
| Config | [config/index.js](config/index.js), [config/emojis.js](config/emojis.js) | IDs de cargo/canal, emojis customizados |

### Permissões (três mecanismos independentes)

1. **Canal** — `checkChannelPermission` / `checkInteractionChannelPermission` em
   [utils/permissions.js](utils/permissions.js): allowlist de canais e categorias em código.
   Admins/officers passam em qualquer canal. No caminho prefixo a mensagem barrada é apagada.
2. **`adminOnly(handler)` / `leaderOnly(handler)`** — wrappers que checam o **banco** (`users.role` =
   `admin`/`officer` e `active`), não os cargos do Discord. Quase todo handler em `admin.js` é
   `export const handleX = adminOnly(async (message, args, client) => {...})`.
3. **`hasPermission(member, nível)`** — hierarquia por cargo do Discord (`ROLE_HIERARCHY`, 1=helper …
   6=leader), usada *dentro* dos handlers para graduar ações (warn exige 2, ban exige 3).

`LEADER_ID` e `ALLOWED_USER_IDS` são IDs fixos no código. `ALLOWED_USER_IDS` está marcado como deprecated.

### IDs hardcoded

Cargos, canais e categorias vivem como strings literais em [config/index.js](config/index.js),
[src/discord.js](src/discord.js) (`ROLE_MAP`, `SYSTEM_ROLES`, `ELO_ROLES`) e
[utils/permissions.js](utils/permissions.js).
Ao adicionar um cargo/canal, coloque em `config/index.js` e importe; não espalhe literais nos handlers.

Os tiers de ELO **Bronze e Tin** em `ELO_ROLES` leem env vars que não existem e caem em `''`, então
`syncMemberEloRoles` os pula. **Isso é decisão do usuário (jul/2026): esses elos não são considerados na
guilda.** Não é bug e não deve ser "corrigido" — deixe as entradas onde estão.

### Sincronização de cargos

`runSync` (rank pelo `users.role`) e `runEloSync` (cargo de ELO pelo maior peak entre 1v1/2v2/3v3) iteram
membro a membro, `guild.members.fetch` individual, e **zeram a flag `need_update`** ao final de cada usuário.
Daí existirem dois pares de getters em `db.js`: `getUsers`/`getUsersWithElo` (só `need_update = true`, usados
no cron horário) e `getAllUsers`/`getAllUsersWithElo` (todos os ativos, usados no full sync das 3h e no `.sync-all`).

Contas alt são resolvidas por `alt_ids` → `resolveBrawlhallaId()`, com cache em memória carregado uma vez
por `loadAliases()`. Estatísticas de uma alt específica precisam de `fetchPlayerStatsNoResolve`.

### Semana de missões

A semana começa **quinta-feira 06:00** (`getMissionWeekStart`) e termina na quarta seguinte. A referência de
inatividade é outra: `getLastWednesdayReference` (quarta retrasada). Essas duas âncoras aparecem em quase toda
query de conquista/missão/inatividade — usar a errada zera o progresso da semana silenciosamente.
Todos os cálculos de data usam o fuso local do processo; os crons declaram `timezone: 'America/Sao_Paulo'`.

### `player_weekly_info` — nunca sobrescrever

A linha de base semanal de cada conta é gravada por um **cron do site TGG (fora deste repo), a cada 15 min**,
que só insere se não existir. O bot também escreve nela via `ensurePlayerWeeklyInfo`
([src/tggCoins.js](src/tggCoins.js)), chamada por `.entrou` e `.add-account`. Regras a manter:

- Só `insert` quando ausente. Nunca `update`/`upsert` — as conquistas comparam inicial × atual, e sobrescrever
  zera ou paga progresso indevidamente.
- Convenção do cron: `initial_elo_1v1` = 0 quando não há partidas, mas `initial_elo_2v2`/`initial_elo_3v3` = **1200**.
- `games` = `stats.games`; `guild_xp` = `clan.personal_xp`; `guild_points` = `personal_points` da API nova.

### API do Brawlhalla

Referência completa em [docs/brawlhalla-api.md](docs/brawlhalla-api.md): endpoints, schemas, o que ainda
está na v0 depreciada e as pegadinhas. Dois pontos que atravessam o código todo:

- **Contribuição = guild points**, ganhos nas missões semanais. É o que a staff avalia e é a unidade do
  limiar de inatividade (1.000/semana). **XP não conta como contribuição** — ganha-se em qualquer
  partida, inclusive contra bots, e serve só para medir volume de jogo.
- **Guild points acumulam.** A doc diz "resets weekly", mas isso é comportamento in-game; a API devolve
  o total acumulado. Ganho de uma semana é sempre **diferença entre duas capturas** de
  `player_weekly_info`, nunca o valor lido direto.

O histórico de guild points anterior a **agosto/2026 não é confiável** (a API devolvia valores errados,
corrigida pouco antes de 04/08/2026). Não monte análise de membro em cima dele.

### Cache

Dois caches em disco, ambos no `.gitignore`:

- `cache/` — por jogador (`player_<id>.json`) e compartilhado (`shared.json`), TTL de 5 min,
  gerenciado em [src/brawlhalla.js](src/brawlhalla.js). Há um rate limiter próprio (180 req / 15 min)
  que *espera* em vez de falhar.
- `.brawlhalla-clan-cache.json` — snapshot do clã, atualizado por `fetchBrawlhallaClanData()`.
  `syncNicknames` prefere o cache e só chama a API se o arquivo não existir; `.refresh-cache` força atualização.

### Jobs de fundo

Todos registrados no `ClientReady`:

- Cron `0 * * * *` — refresh do clã + `runSync` + `runEloSync` + `syncNicknames` (só `need_update`).
- Cron `0 3 * * *` — full sync (todos os ativos).
- Cron `0 0 * * *` — cargos de aniversário; `0 6 * * *` — publica MOTD (buscado de `teamtgg.com.br/api/motd.php`).
- `setInterval` — lembrete de inativos (3h por padrão, `INACTIVE_MESSAGE_INTERVAL`).
- `restoreMutes` / `restoreTemporaryWarnings` — reagendam expirações persistidas em `mutes` / `warnings`
  depois de um restart.

## Skills do projeto

Em [.claude/skills/](.claude/skills/), versionadas junto com o código:

- **`checar`** — checagem estática (`node .claude/skills/checar/check.mjs`). Única verificação que roda
  sem subir o bot. Use antes de commitar e depois de mexer em comando.
- **`novo-comando`** — as três edições obrigatórias para adicionar um comando, no padrão do repo.
- **`publicar`** — checagem + commit no padrão + checkbox do roadmap do README.

## Banco (Supabase)

Sem migrations no repo — o schema vive no Supabase. Domínios principais:

- **Membros**: `users` (`discord_id`, `brawlhalla_id`, `role`, `active`, `need_update`), `alt_ids`,
  `player_elo_history`, view `vw_player_elo_max`.
- **Semana/atividade**: `player_weekly_info`, `weekly_missions`, `weekly_inactive_players`,
  `guild_weekly_guild_points`, `guild_duels`, `season`.
- **Economia (TGG Coins)**: `tgg_coins_wallet`, `_transactions`, `_shop`, `_shop_roles`, `_shop_exitlag`,
  `_purchases`, `_inventory`, `_service_providers`, `_coach_prices`, `_daily_streak`, `_achievements`,
  `_achievements_alts`, `_achievements_finished`, view `vw_tgg_coins_wallet_total`.
  A variante `tgg_coins_event_*` é a carteira paralela de eventos/tickets — mesma lógica, tabelas separadas.
- **Moderação/diversos**: `warnings`, `mutes`, `motd`, `birthdays`, `tgg_quiz_completed`, `contador_crz`.

## Convenções

- Toda saída ao usuário é **embed**, via os builders de [utils/discordUtils.js](utils/discordUtils.js)
  (`createErrorEmbed`, `createSuccessEmbed`, `createLoadingEmbed`, `createWarningEmbed`).
  Listas longas usam `createPagination`; ações destrutivas usam `awaitConfirmation`.
- Texto voltado ao usuário em **português (pt-BR)**; logs em inglês com prefixo entre colchetes
  (`[CRON]`, `[ELO ADD]`, `[WeeklyInfo]`).
- Erros: handlers deixam a exceção subir para o try/catch de `index.js`/`interactions.js`, que responde um
  embed de erro genérico. Falhas de API externa que não devem abortar o fluxo são engolidas com
  `.catch(() => {})` e um `console.warn`.
- Emojis customizados do servidor ficam em [config/emojis.js](config/emojis.js) — usar `EMOJIS.x`, não colar o ID.
- O README lista um roadmap com itens marcados; ao concluir algo que está lá, atualize o checkbox.
