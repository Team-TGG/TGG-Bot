# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm start        # sobe o bot (node index.js) — mesmo que `npm run sync`. Produção.
npm run dev      # sobe sem efeito no servidor real (ver docs/modo-dev.md)
npm run dev:slash # idem, mas registra os slash commands (PUT sobrescreve a lista da guilda)
```

Não há suíte de testes, linter ou build. Verificação = rodar o bot e usar o comando no Discord.
Node >= 18 (usa `fetch` nativo), ESM (`"type": "module"` — todo import precisa da extensão `.js`).

`.env` obrigatório (não versionado): `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_ANON_KEY`), `BRAWLHALLA_API_KEY`.
Opcionais: `BRAWLHALLA_CLAN_ID` (default `'396943'` no código), `INACTIVE_MESSAGE_INTERVAL` (default 3h),
`GEMINI_API_KEY` (sem ela só o `.ia` fica desligado), `GEMINI_MODEL` (default `gemini-3.5-flash-lite`),
`IGNORE_SSL_ERRORS=true` para desligar verificação TLS (uso local), `TICKET_CYCLE_SECONDS` (default 60,
piso 15) para o ciclo da fila por tickets. `win-ca` carrega os certificados do Windows.
O `.env` ainda tem `TGG_API_URL`, `TGG_API_KEY` e `GUILD_ACTIVITY_CHANNEL_ID` — sobras dos módulos removidos,
nenhum código lê essas três.

`npm start` **registra os slash commands na guild via PUT** ([src/slash/register.js](src/slash/register.js)),
dispara `startInactiveReminder` 5s depois do ready (ping no canal + DM para cada inativo) e liga os crons.
Rodar isso localmente com o token de produção afeta o servidor real — use `npm run dev`, que pula os
quatro efeitos e imprime um quadro no boot dizendo o que foi desligado.

O modo dev **não** isola do servidor: o bot segue conectado à guilda real e comando que escreve no banco
escreve de verdade. E como dois processos com o mesmo token recebem os mesmos eventos, **pare o bot da VM
antes de subir local**, senão cada comando é respondido duas vezes.

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
  cada handler é dono do próprio collector. Modais são roteados por prefixo de `customId`, e os
  botões de `justificativa_*` também — decisão da staff pode demorar horas e o collector morre no
  primeiro restart, então o estado vive na tabela e o botão continua valendo depois de deploy.
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
3. **`hasPermission(member, nível)`** — hierarquia por cargo do Discord (`ROLE_HIERARCHY`,
   1=assistant/helper … 6=leader), usada *dentro* dos handlers para graduar ações (warn exige 2,
   ban exige 3). `assistant` e `helper` dividem o nível 1 de propósito — `getMemberLevel` usa
   `Math.max`, então empate não é problema.

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

### A arte das missões

[src/services/missoesImagem.js](src/services/missoesImagem.js) monta o PNG do post colando quatro
prints do jogo sobre um fundo fixo, tudo em [assets/missoes/](assets/missoes/). **O nome do arquivo
é o slug do `TEMPLATES`** (`ouro-2v2.png`), e é só isso que liga missão a imagem — não há tabela
de-para. Print novo entra com o nome certo e funciona.

Três coisas que parecem defeito e não são:

- **O card do slot 1 vem com o botão destacado** (`INICIAR LOBBY` em ciano/rosa). É a seleção
  padrão que o jogo dá ao primeiro card ao abrir a tela, não mouse por cima: medido em 12/08/2026,
  11 dos 12 prints do slot 1 têm o destaque e nenhum dos 6 dos outros slots tem. Print do slot 1
  **sem** destaque é que está fora do padrão.
- **A arte mostra o primeiro tier e o texto do post o último.** O card diz "Alcance a onda 4" e a
  descrição diz "onda 20"; o alvo da imagem é 500 e o do texto, 16. Não existe print "certo" — o
  tier avança durante a semana. Decisão do usuário (12/08/2026): a imagem é ilustração, o texto
  carrega a informação.
- **O passo entre os slots (420) é menor que a largura do card (462).** Os cards são paralelogramos
  que se encaixam; a sobra de um entra no vão do vizinho.

O recorte de cada card é medido em execução (`trim` do sharp), não fixado numa tabela, justamente
para o usuário poder reexportar um print sem ninguém remedir coordenada.

### `player_weekly_info` — nunca sobrescrever

A linha de base semanal de cada conta é gravada por um **cron do site TGG (fora deste repo), a cada 15 min**,
que só insere se não existir. O bot também escreve nela via `ensurePlayerWeeklyInfo`
([src/tggCoins.js](src/tggCoins.js)), chamada por `.entrou` e `.add-account`. Regras a manter:

- Só `insert` quando ausente. Nunca `update`/`upsert` — as conquistas comparam inicial × atual, e sobrescrever
  zera ou paga progresso indevidamente.
- Convenção do cron: `initial_elo_1v1` = 0 quando não há partidas, mas `initial_elo_2v2`/`initial_elo_3v3` = **1200**.
- `games` = `stats.games`; `guild_xp` = `clan.personal_xp`; `guild_points` = `personal_points` da API nova.

### Tipos de conquista (`tgg_coins_achievements.type`)

`ELO`, `WINS`, `GAMES` e `CONTRIBUICAO`. As linhas são cadastradas fora do bot (painel do site); o bot
só lê. Cada tipo tem uma entrada em `typeConfig` ([src/handlers/tggCoinsHandlers.js](src/handlers/tggCoinsHandlers.js))
e um ramo em `checkMissionCompletion` ([src/tggCoins.js](src/tggCoins.js)) — tipo novo exige os dois.
`getTypeConfig` normaliza acento e caixa, então `CONTRIBUIÇÃO` e `contribuicao` resolvem igual.

`CONTRIBUICAO` = guild points ganhos na semana, medidos como `personal_points` atual menos
`player_weekly_info.guild_points`. O `mode` é só rótulo (ex.: `Guilda`), não passa por `getModeFields`.
Conta alt só entra se estiver na guilda da TGG (compara `guild_id` com `BRAWLHALLA_CLAN_ID`), nos dois
lados da conta.

**Base 0 tem dois significados** e a diferença é o `join_date`: quem entrou na guilda **durante a semana**
começou do zero de verdade e o progresso conta normal; para quem já estava na guilda, 0 quer dizer *base
não registrada* — aí o progresso não é calculado, porque somar contra 0 leria o acumulado inteiro (dezenas
de milhares) como ganho da semana e pagaria a conquista na hora. Medido em 05/08/2026: 20 membros ativos
nessa situação, 9 deles passariam de um alvo de 10k instantaneamente.

**O valor atual sai de `/v1/guild/members` (rota em lote), não de `/v1/player/guild`.** Uma chamada com
cache resolve todas as contas, e a rota individual devolve **404 intermitente** quando é chamada conta a
conta — num lote de 77 consultas seguidas ela falhou na maioria, inclusive para membros que respondem
normalmente quando consultados sozinhos. É a explicação mais provável para os zeros em `player_weekly_info`,
já que o cron do site percorre centenas de contas por essa rota a cada 15 min. `ensurePlayerWeeklyInfo`
também usa o lote primeiro, caindo na rota individual só para conta fora da guilda (alt).

### Contribuição da semana: MVP e inativação

As duas rotinas leem o **mesmo** número, de [src/services/contribuicaoSemanal.js](src/services/contribuicaoSemanal.js):
guild points atuais (rota em lote `/v1/guild/members`) menos `player_weekly_info.guild_points` da
semana de missões. Alt não entra — as duas medem a conta que está na guilda. Quem não pôde ser
medido volta com `motivo` (`SEM_BASE`, `BASE_ZERADA`, `FORA_DA_GUILDA`) em vez de sumir: 0 e "não
sei" são coisas diferentes, e tratar os dois como 0 daria MVP a quem não jogou e inativaria quem jogou.

O `.lb-guilda` lê o mesmo número (ordenação e embed em
[src/handlers/publicHandlers.js](src/handlers/publicHandlers.js)), filtrando `FORA_DA_GUILDA`: mostra quem tem cadastro **e** está na guilda do jogo. A rota devolve 643
contas (11/08/2026) mas a base semanal só existe para as cadastradas — sem o filtro, dois terços da
lista seria `—`. Registro incompleto da API (sem `rank`/`join_date`/`guild_points`, 38 das 643) vira
`points: null`, que o cálculo continua lendo como 0 e o leaderboard mostra como `—`.

O `.lb-guilda` também marca com 🏅 quem está elegível ao MVP, chamando `selecionarMvpsDasLinhas`
(a parte pura de `calcularMvpsDaSemana`, extraída para os dois lados usarem a mesma regra em vez de
recopiar o ranking). É prévia da quarta: mesma ordenação, mesmo `ocupaVaga`, mesmo fechamento na
última vaga — inclusive o efeito de officer que aparece depois do corte ficar de fora.

**MVP (quarta 06:00)** — cargo `weeklyMvp.roleId` para os 14 primeiros. Staff recebe sem ocupar
vaga; a contagem fecha quando a 14ª vaga é preenchida, então officer que aparece depois fica de
fora. Staff aqui é quem é staff em **qualquer** das duas fontes (`users.role` **ou** o `rank` do
jogo): medido em 08/08/2026, 6 pessoas divergiam entre as duas, nas duas direções.

**Prêmio do top 3** — a mesma rodada paga 250/200/150 TGG Coins (`weeklyMvp.premios`) para as três
maiores contribuições, no formato do `.addcoins`: transação de tipo `TOP 1 SEMANA 13/08/2026` mais o
saldo somado. Aqui é o **ranking puro, staff incluída** (decisão do usuário, 18/08/2026) — ao
contrário das vagas do cargo, onde staff aparece sem ocupar lugar; por isso a colocação do prêmio é
o índice na lista, não o campo `posicao`. A semana no tipo é a **trava contra pagamento duplo**: o
cargo pode ser reaplicado à vontade, moeda não. Quem já recebeu qualquer prêmio daquela semana é
pulado, mesmo que o ranking tenha virado entre duas rodadas. Cargo, prêmio e anúncio falham
separado, e o 💰 do embed só sai para quem ficou mesmo com as moedas.

**Inativação (quarta 06:10)** — grava em `weekly_inactive_players`, aplica o cargo de inativo,
manda DM e avisa no canal. Substitui a página `relatorio_inativar.php` do site, que media **XP**
(sistema antigo) e não contribuição.

**Tolerância na inativação**: o corte é `LIMIAR_INATIVACAO` (mínimo menos `TOLERANCIA_INATIVACAO`,
hoje 10% → 900), não os 1.000 cheios. É folga para erro de leitura da API de guild points: o desvio
normal é de 1 a 10 pontos, mas em 08/2026 um membro com 1.020 foi lido como 902. O número é para ir
sendo calibrado. A **regra continua sendo 1.000** — é o que a DM, o anúncio e o lembrete de domingo
cobram; a folga só decide quem é marcado. Quem cai nela vira `poupados` com motivo `TOLERANCIA`, e a
prévia do `.inativar` mostra a contagem. O lembrete de domingo passa `limiar: CONTRIBUICAO_MINIMA`
de propósito: lá o objetivo é empurrar para fora da fronteira, não poupar.

**A medição só vale entre quarta 06:00 e quinta 06:00.** Antes o número é parcial; depois,
`player_weekly_info` já virou para a semana nova e a conta dá ~0 para todo mundo — rodar numa
quinta de manhã inativaria a guilda inteira. `semanaFechada()` trava as duas pontas com uma
condição só, e vale para o cron e para o `.inativar`.

**Blindagem** (`inactivity_shields`): quem nunca é inativado. Officer e admin não precisam de linha
— são pulados pelo `users.role`. Membro específico entra por insert manual no Supabase (`weeks`
nulo = permanente). O `.justificativa <motivo> <semanas>` do membro cria a linha como `pendente`,
que **não protege nada** até um officer/admin aprovar pelos botões no canal de log-guilda.

O pedido vai com um **dossiê** para a staff decidir sem rodar `.scan`: contribuição da semana
(tirada de `calcularContribuicaoSemanal()`, o mesmo número que decide a inativação — ler de outra
fonte faria o embed discordar da quarta-feira), jogos totais e da semana, e o resumo do histórico
de inatividade. Fonte que falha vira "indisponível" no campo, nunca erro no pedido. O botão
`📋 Justificativas` abre a lista completa em mensagem efêmera, paginada; como a mensagem do pedido
vive por horas, a página vai no `customId` (`justificativa_histpg_<pedido>_<página>`) e cada clique
é consulta nova — **não use collector aqui**, ele morre no primeiro restart.

**Depois de marcado, quem cobra é o lembrete de 3h**
([inactivePlayers.js](src/services/inactivePlayers.js)): ping no canal dos inativos mais DM para
cada um. **DM que não chegou é dita em voz alta**, no mesmo canal, num embed à parte e sem ping.
DM fechada é o caso em que o lembrete automático não serve para nada — a pessoa é pingada num
canal que talvez nem abra e o aviso de verdade nunca chega; dizer isso passa o trabalho para a
staff, que chama no privado do jeito que um bot não consegue, e evita remover alguém por um
silêncio que nunca foi escolha dele.

**Chamada da staff (domingo 06:00)** — `avisarRemocaoDeInativos`
([avisoRemocaoInativos.js](src/services/avisoRemocaoInativos.js)) posta no **canal dos inativos**
quem continua marcado, com quantos avisos cada um já ignorou, pingando **só** `@Officer`
(`inactivePlayers.removalNotice.officerRoleId`). Os listados não são pingados: já levam ping a
cada 3h e a mensagem é sobre eles, não para eles. Domingo e não quarta porque a semana ainda não
fechou — três dias de conversa ainda salvam a vaga. E no canal dos inativos, não na log-guilda,
porque é onde a conversa com essas pessoas acontece.

A contagem sai de duas colunas de `weekly_inactive_players` que **o bot escreve**, incrementadas
pelo lembrete a cada ciclo:

```sql
alter table weekly_inactive_players
  add column avisos_enviados int not null default 0,
  add column dms_falhadas int not null default 0;
```

São contadores de verdade, e não `(agora - created_at) / intervalo`, porque o número é a
justificativa para tirar alguém da guilda: derivar do tempo contaria como tentativa todo ciclo em
que o bot esteve fora do ar, e mentiria a favor da remoção. Sem as colunas (`42703`) a leitura
loga o SQL que falta e devolve `null` — as duas rotinas seguem sem contar, porque deixar de
avisar a lista inteira por causa de um contador seria pior. Ler-somar-gravar aqui é seguro, ao contrário da pontuação dos tickets:
ninguém digita esses dois números no Supabase, e o update é agrupado pelo valor final, então a
lista inteira vira ~2 requisições. `dms_falhadas >= avisos_enviados` é o que marca 📪 na
lista de domingo: aí o silêncio não é resposta, é canal fechado.

Os avisos automáticos de missões, MVP, inativação, duelo e pedido de blindagem vão todos para
**log-guilda** (`1536704688689516624`), para não misturar log com chat. A única saída que também
vai para fora dali é o **post das missões em guild-updates** (`1451542963854508227`) — o aviso em
log-guilda continua existindo do mesmo jeito, com o link de correção; o post é outro público
(a guilda, com ping do `@TGG`) e não substitui o aviso. Os botões de
`justificativa_*` não passam pela allowlist de canal (só `isChatInputCommand` passa), então mover
o pedido de canal não quebra a aprovação. O canal dos inativos (`inactivePlayers.channelId`)
continua sendo outro — é onde o lembrete de 3h é postado e o único lugar onde `.active` funciona.

### Fila de espera por tickets

Os canais são criados pelo **Ticket Tool** (bot de terceiros) na categoria `cards`
(`1460768037518180352`). O bot não os cria nem os apaga — ele observa, pontua e ordena.

**Quem abriu o ticket** sai das *permission overwrites* do canal: o Ticket Tool dá acesso ao autor
com uma overwrite individual, e tirando bots e staff sobra ele. Medido em 14/08/2026: resolveu
todos os tickets abertos, sem uma divergência. Tópico do canal e primeira mensagem existem como
plano B em [ticketQueue.js](src/services/ticketQueue.js) e o `.scan-tickets` mostra os três lado a
lado — a primeira mensagem só é lida quando a overwrite não fecha sozinha, porque custa uma
requisição por canal.

**Pontuação** (`ticket_activity`, view `vw_ticket_pontos`):

```
(mensagens_iniciais + mensagens_contadas)
  + ((horas_call_iniciais + segundos_call_contados/3600) × 30)
  + prioridade
```

As colunas são divididas por **quem escreve**: `*_iniciais` e `prioridade` são digitadas pela staff
no Supabase, `*_contadas` são do bot. É o que permite zerar um lado sem perder o outro. A soma
acontece no Postgres (`incrementar_atividade_ticket`), nunca lendo-somando-gravando no bot — senão
o valor que a staff digitasse entre a leitura e a escrita seria sobrescrito.

Só conta quem tem **ticket aberto**, e mensagem conta em qualquer canal, inclusive no próprio
ticket. Tempo de call exige a intent `GuildVoiceStates` (não é privilegiada) e **não tem como ser
recuperado do passado** — só existe do dia em que ligou.

**O ciclo de 1 min** ([ticketActivity.js](src/services/ticketActivity.js)) faz, nessa ordem:
reconcilia a tabela com a categoria, credita quem está em call agora, grava os contadores, grava o
estado das conversas, cobra os pendentes e, por último, recalcula a ordem se algum ticket foi
encerrado. Nada vai ao banco no momento do evento; tudo acumula em
memória. O preço é perder até um ciclo se o processo cair, e é aceito porque a pontuação é
comparativa. `TICKET_CYCLE_SECONDS` calibra sem editar código.

**Reconciliação, não evento.** `channelCreate`/`channelDelete` só chegam com o bot de pé: ticket
aberto durante um deploy nunca seria cadastrado e o sintoma — a pessoa não pontuar — é invisível.
Comparar categoria × tabela se conserta sozinho depois de qualquer janela offline. Canal que saiu
da categoria é fechado; canal que voltou é **reaberto** explicitamente, senão o insert com
`ignoreDuplicates` o ignora calado e ele fica fora da fila para sempre.

O diff é calculado contra a memória **antes** de qualquer escrita, então em regime o ciclo é uma
consulta só. Sem isso, rodar de 1 em 1 min mandaria as ~60 linhas ao banco para descartar todas.

**Responsável** é escolhido por botão (`ticket_assumir`), postado pelo bot **só em ticket
recém-cadastrado** — é por isso que `inserirTicketsNovos` devolve os IDs inseridos e não a
contagem. Exige helper+ e o `update` é condicionado a `responsavel_discord_id is null`, então dois
cliques não se atropelam. Trocar depois é edição manual no Supabase; não existe "largar".

**As DMs são assimétricas de propósito** ([ticketNudge.js](src/services/ticketNudge.js)):

- **staff** — cobrança por tempo, quando o autor falou por último e não foi respondido. Repete a
  cada `LIMITE_SEM_RESPOSTA_MS`. Resposta de **qualquer** staff zera a pendência, e o botão
  **"mensagem lida"** da própria DM também: nem todo gif ou emoji do autor pede resposta, e sem
  essa saída o bot cobrava de hora em hora por algo já resolvido. Ele grava
  `ultima_msg_lado = 'responsavel'` em vez de coluna nova — o campo já significa "quem deu o
  último passo", e ler é um passo. O id da mensagem vai no `customId` para o botão valer só para
  aquela mensagem: clique atrasado não pode silenciar uma que chegou depois.
- **autor** — só quando é mencionado no próprio ticket, um ping = uma DM, na hora. Se a DM não
  entrar, o bot **responde no ticket** dizendo que o autor não foi avisado. Sem isso a menção
  falha em silêncio: quem chamou acha que avisou, o autor nunca soube, e o ticket fica parado
  esperando um lado que não foi cutucado. O retorno vai no canal, e não na DM de quem pingou,
  porque assim serve para a staff toda — e porque essa DM pode estar fechada do mesmo jeito.

A primeira versão cobrava os dois lados por tempo e nunca silenciava: como sempre existe um
"último lado", todo ticket parado gerava DM para alguém, para sempre. O filtro
`ultima_msg_lado = 'autor'` mora no SQL por isso. Gravar a conversa vem **antes** da cobrança no
mesmo ciclo, senão quem respondeu há segundos levaria DM pela resposta que já deu — e responder
zera `ultimo_aviso_em`, senão o outro lado herdaria a janela de silêncio do aviso anterior.

**Janela de silêncio das 20h às 08h**: nenhuma DM de ticket sai, nem para staff nem para autor.
Ping na janela é **descartado**, não guardado; a cobrança por tempo se resolve sozinha, porque é
recalculada a cada ciclo e sai às 08h. Vale só para as DMs de ticket — aplicar global silenciaria
a inativação da quarta, que manda DM às 06:10.

**Cron `0 1 * * *`** ([ticketReorder.js](src/services/ticketReorder.js)) recalcula posição, renomeia
`guild-<nick>-<posição>` e reordena os canais; `.organize-tickets` força o mesmo agora. Uma vez por
dia porque **renomear canal é limitado a 2×/10min por canal** — o nome é foto do último recálculo,
e isso é decisão do usuário (14/08/2026), não limitação escondida.

**Ticket encerrado também dispara o recálculo**, no ciclo que a reconciliação percebe o
fechamento: quem entra na guilda sai da fila e todo mundo abaixo sobe uma posição, e esperar
as 01:00 deixaria a fila mostrando um número errado pelo resto do dia. Fechamentos em sequência
viram **um** recálculo, com um intervalo mínimo de 11 min entre dois: é o mesmo teto de
2×/10min por canal que faz o cron ser diário, e a staff processando a fila fecha vários tickets
seguidos — um recálculo por ciclo de 1 min trancaria os nomes na terceira passada. Ticket novo
não dispara nada: ele entra no fim da fila e não mexe na posição de ninguém. Em modo dev o recálculo por
fechamento só é logado — o ciclo roda em dev, mas o cron diário não, e renomear ~60 canais reais a
partir do processo local seria efeito novo.

O rename **troca só o número do fim e preserva o resto do nome**, sem assumir prefixo — mesma regra
do `.organize-tickets` de antes. A primeira versão exigia `guild-` literal e por isso não
reconhecia `guilda-fulano-3`: o nick saía nulo e o canal nunca era renomeado. A base sai do **nome
atual do canal**, não da coluna, para correção manual da staff sobreviver ao cron. Empate desempata
por `aberto_em`, senão a ordem trocava sozinha entre dois dias e renomearia canal à toa. Só quem
**mudou de posição** recebe aviso, e **só no canal, nunca DM**.

### Aviso de modo errado no procurando-jogo

O bloco de ranked alterna entre `ranked-2v2` e `ranked-3v3` toda semana, então metade do tempo a
partida que alguém chama no `procurando-jogo` (`1466501462594158684`) não avança missão nenhuma.
[avisoModoDaSemana.js](src/services/avisoModoDaSemana.js) observa o canal e responde à mensagem
lembrando qual é a missão e quanto falta para o mínimo.

**A conferência é contra as quatro missões da semana, não contra o bloco que alterna.** A posição 1
do ciclo passa por `ouro-2v2`, `platina-2v2` e `diamante-2v2`: nessas semanas o 2v2 conta mesmo com
a ranked sendo 3v3, e cobrar ali seria dar informação errada. A fonte é o cadastro
(`weekly_missions`), com a previsão do ciclo como plano B — correção da staff pelo site tem que
valer aqui também. Os modos saem do **texto da missão** por regex, nos dois lados, então cadastro
editado à mão continua sendo entendido.

**Missão concluída (`status = 'done'`) sai da conta**, porque depois dela o modo não rende mais —
o que sobra é guild battle, e para isso não adianta trocar de fila. Some o motivo de avisar quando
a missão do modo certo fechou, e volta o motivo de avisar quando é a do modo citado que fechou
(semana de `ouro-2v2` concluída com a ranked 3v3 aberta).

Quem é avisado é exatamente quem o lembrete de domingo avisaria — `calcularQuemFalta()`, que já
carrega as isenções de staff, blindado, recém-chegado e sem medição. Repetir a regra aqui faria o
canal cobrar quem a quarta-feira não vai cobrar.

Detalhes que parecem sobra e não são: mensagem que cita **os dois** modos não gera aviso (quem
escreve "bora 3v3, ou 2v2 se faltar gente" já sabe da missão); `1v1` fica fora porque não é o bloco
que alterna; o cooldown é de 1h por pessoa; e em modo dev
o aviso só é logado, nunca enviado — o canal é o de produção.

### Média histórica de contribuição

Guild points totais divididos pelas semanas de guilda, em
[src/services/mediaHistorica.js](src/services/mediaHistorica.js). É a leitura de longo prazo, o
oposto da contribuição da semana — e é o que "média de contribuição" quer dizer sem qualificação:
a média *da semana* mede quantas contas existem, não como alguém rende (decisão do usuário,
12/08/2026). Lida pelo `.scan` (um membro) e pelo `.ia` (guilda inteira), pela mesma função.

O divisor de cada membro é o tempo desde **03/12/2025**, quando os guild points passaram a existir,
ou desde a entrada na guilda para quem chegou depois — dividir o total de quem está há duas semanas
pelas 36 da guilda mede a idade da guilda, não a pessoa. E ele é **fracionário**: contar semanas
inteiras dividia 13 dias e meio por 1 e dobrava a média de quem entrou há pouco (medido em
12/08/2026: 18.244/semana virando ~9.400, com o membro saindo do 3º lugar da guilda).

O ranking do `.ia` só lista quem tem **4 semanas ou mais**; a média da guilda conta todos. Sem esse
piso a ponta de baixo era quase toda de quem entrou nos últimos dias (51 dos 196 medidos, 7 dos 8
últimos colocados). O corte sai dito no rodapé e no `dados` — lista cortada tem que dizer que foi.

### Movimentação da guilda

`guild_membership_history` é escrita pelo cron do site (`automations/guild_history.php`) a cada 15 min,
com `action` em `entrou`/`saiu`/`promovido`/`rebaixado` (medido em 11/08/2026: 639/478/124/10 linhas).
O bot **só lê**: a cada quarto de hora + 5 min, `avisarMovimentacao`
([src/services/guildHistoryService.js](src/services/guildHistoryService.js)) procura linhas novas e
posta um embed em log-guilda, com um campo por ação. `action` fora dessas quatro é ignorada no aviso,
mas ainda avança a marca — senão a rotina releria a mesma linha para sempre.

O controle do que já foi avisado é a coluna **`avisado`** (`boolean not null default false`), a
**única** coluna desta tabela que o bot escreve — exceção deliberada ao "site escreve, bot lê",
porque o estado precisa sobreviver a rodar o bot de outra máquina, coisa que arquivo local não faz.
O cron do site não precisa saber da coluna: o `default false` marca cada linha nova como pendente.
O histórico antigo foi zerado com um `update ... set avisado = true` na criação da coluna, senão o
primeiro boot despejaria as ~1.250 linhas de uma vez.

A marcação vem **depois** do envio dar certo, então falha do Discord repete o aviso em vez de
engoli-lo. Se a coluna não existir (`42703`), a rotina loga o SQL que falta e desiste da passada, em
vez de estourar a cada 15 min.
O aviso anota o estado no cadastro do bot, que é o que gera trabalho para a staff: quem saiu do jogo e
continua `active` segue contando em sync, missões e inatividade; quem entrou e não tem cadastro ainda
precisa do `.entrou`. **Não existe comando de saída** — a desativação é feita fora do bot.

### Duelo semanal de guildas

O jogo pareia 1º×2º, 3º×4º, 5º×6º pela classificação corrente. **O campo `rank` de
`/v1/guild/stats` é essa posição** — não é o acumulado de guild points: medido em 05/08/2026,
BURLA tinha mais pontos que WSE (5,0M × 4,4M) e rank muito pior (178º × 39º), e a guilda dos
próprios devs aparece em 27.614º. O que explica as inversões é atividade recente.

Não existe endpoint de ranking de guildas (13 caminhos sondados, todos 404) e o espaço de
`guild_id` é esparso demais para varrer (3 guildas em ~80 IDs sondados; nem os vizinhos de
396943 respondem). Por isso o topo é mantido à mão em **`guild_registry`** (só `guild_id`)
e o oponente sai de uma leitura do `rank` de cada monitorada.

O cron roda **quarta 07:00**: as missões fecham 06:00 e na quarta não dá mais para farmar ponto,
então o valor lido é o fechamento da semana **e** a linha de base da seguinte. Grava com
`week_start` da **quinta seguinte** — é assim que as linhas manuais sempre foram feitas.
Não sobrescreve semana já cadastrada. Sem oponente no rank alvo (guilda nova no topo), avisa a
staff chamando o líder em vez de gravar palpite.

### `.ia` — pergunta em linguagem natural

A IA **não calcula nada**. Ela faz duas coisas: escolhe qual função do bot responde a pergunta e
escreve a frase em português a partir do resultado. Todo número sai dos mesmos serviços que decidem
o MVP, a inativação e o `.duel` — se a IA somasse dados crus, o `.ia` daria um número que discorda
da quarta-feira, que é exatamente o que [contribuicaoSemanal.js](src/services/contribuicaoSemanal.js)
existe para evitar.

Cada ferramenta é um **par**: a declaração que a IA lê e o executor que roda no bot, ambos em
[src/handlers/iaHandlers.js](src/handlers/iaHandlers.js). Ferramenta nova exige os dois. A exceção é
`nao_sei_responder`, declaração sem executor de propósito: o roteador usa `mode: 'ANY'`, que obriga o
modelo a escolher alguma ferramenta, e sem essa saída pergunta fora do catálogo vira resposta
confiante e errada. Ao adicionar ferramenta, **tire o assunto novo da descrição de
`nao_sei_responder`** e da mensagem de "não sei responder isso" em `handleIa`.

O que volta para a IA leva só apelido do jogo e números — `discord_id` e `brawlhalla_id` nunca saem
daqui, porque o free tier pode usar o conteúdo para treino.

Número sem unidade a IA batiza sozinha, e ela chamou guild points de **XP** (12/08/2026) — no jogo
XP é outra medida, ganha em qualquer partida, e é a que *não* conta como contribuição. Por isso a
unidade vai dita no `dados` (`UNIDADE`) **e** em `INSTRUCAO_RESPOSTA`: quem redige é uma segunda
chamada, que não enxerga a instrução de roteamento. `perguntas.mjs` reprova resposta que diga "XP".

Ressalva também não pode soar como ausência: `missoes_da_semana` com `quando: 'proxima'` responde
pela **previsão do ciclo** (a semana seguinte só é cadastrada na quinta 06:00), e na primeira versão
o `dados` dizia "ainda não foi cadastrada" — o modelo leu isso como falta de dado e respondeu "não
tenho essa informação" com as quatro missões na mão. O `dados` afirma a lista e põe a ressalva
depois; `INSTRUCAO_RESPOSTA` proíbe recusar tendo recebido dados. O erro espelho é apresentar a
previsão como cadastro, e `perguntas.mjs` cobra os dois lados.

Pela mesma razão o `ranking_contribuicao` devolve os dois totais da semana com o nome dizendo de
quem é cada um: `ganho_da_guilda_nesta_semana` (o que a staff vê no jogo) e
`soma_do_que_os_membros_ganharam`, que é sempre maior e **não** é o total da guilda (ver a mecânica
de tier em [API do Brawlhalla](#api-do-brawlhalla)). Campo genérico como `total_da_semana` é o que
faz a IA escolher o maior e a resposta discordar da tela.

Executor recebe `(args, contexto)`, e `contexto.discordId` é quem perguntou. É o que faz "quanto eu
contribuí?" funcionar: a declaração manda deixar `nome` vazio na primeira pessoa e o executor
resolve pelo cadastro. Procurar "eu" no apelido casaria com meia guilda, então a resolução é por
`discord_id`, nunca por texto.

Duas ferramentas dividem o assunto "contribuição" e é fácil uma roubar a pergunta da outra:
`media_de_contribuicao` é a **média histórica** (ver acima) e responde "média" sem período dito;
`ranking_contribuicao` é a **semana corrente**, e leva junto o resumo dela — quantos pontuaram,
quantos zeraram, média e mediana da semana — que é o que responde "a semana tá fraca?".

Quem decide o roteamento é a `description` de cada ferramenta, então mexer numa pode roubar
pergunta da vizinha. Depois de qualquer edição ali, rode
`node .claude/skills/checar/perguntas.mjs` — a lista de perguntas de referência é o que separa
"consertei" de "troquei um erro por outro". A segunda chamada precisa devolver o `thoughtSignature`
da primeira; sem ele os modelos Gemini 3 recusam com 400 e a frase some do embed sem erro visível.

Mexeu no **executor**, rode `node .claude/skills/checar/executores.mjs`, que é outra pergunta e
outro script: um mede qual ferramenta a IA escolhe, o outro o que a ferramenta produz. Os dois
existem porque o roteamento marcou 19/19 enquanto todo embed cortava lista em 15 linhas sem avisar
(11/08/2026). Lista longa **sempre** termina em `… e mais N` — corte calado faz resposta parcial
passar por completa, e ninguém tem como saber.

### API do Brawlhalla

Referência completa em [docs/brawlhalla-api.md](docs/brawlhalla-api.md): endpoints, schemas, o que ainda
está na v0 depreciada e as pegadinhas. Dois pontos que atravessam o código todo:

- **Contribuição = guild points**, ganhos nas missões semanais. É o que a staff avalia e é a unidade do
  limiar de inatividade (1.000/semana). **XP não conta como contribuição** — ganha-se em qualquer
  partida, inclusive contra bots, e serve só para medir volume de jogo.
- **Guild points acumulam.** A doc diz "resets weekly", mas isso é comportamento in-game; a API devolve
  o total acumulado. Ganho de uma semana é sempre **diferença entre duas capturas** de
  `player_weekly_info`, nunca o valor lido direto.
- **O ponto do membro e o ponto da guilda não são a mesma contagem.** O membro pontua a cada partida
  que avança uma missão; a **guilda** só pontua quando um **tier** da missão fecha (uma missão tem
  vários: 5 partidas → 500, 15 → 1.000, 30 → 2.000…), mais as guild battles. Enquanto ninguém fecha o
  tier seguinte, os membros somam e a guilda não — medido em 12/08/2026: 432.826 somando membro a
  membro contra 343.497 do lado da guilda, na mesma semana. **Somar os membros não dá o total da
  guilda**, e é o da guilda que a staff vê no jogo: ele sai de `calcularGanhoDaGuildaNaSemana()`
  ([dueloSemanal.js](src/services/dueloSemanal.js)), guild points atuais menos a base de
  `guild_weekly_guild_points`.

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
- Cron `0 6 * * 4` — cadastra as 4 missões da semana e faz **duas** saídas independentes
  ([src/services/weeklyMissionsService.js](src/services/weeklyMissionsService.js)): o aviso da staff em
  log-guilda (embed, com o link de correção) e o post da guilda em guild-updates (markdown, arte e ping
  do `@TGG`). Uma falhar não cancela a outra — é o aviso que permite corrigir cadastro divergente antes
  de alguém reclamar. Cada posição tem seu ciclo (12, 1, 2 e 3 semanas), ancorado em 06/08/2026. Não
  sobrescreve semana que já tem missão. Os textos espelham `$missionTemplates` de `cadastro_missao.php`,
  no repo do site — mudou lá, mude aqui; o `nome` curto de cada missão só existe aqui, é o que vira o
  `##` do post.
- Cron `0 12 * * 0` — lembrete de contribuição no tgg-geral + DM para quem ainda não bateu os 1.000
  ([src/services/contributionReminderService.js](src/services/contributionReminderService.js)).
  Mesmo público e mesmas isenções da inativação, exceto que quem já está na lista da semana passada
  continua sendo avisado. As menções vão em lotes de 80: 100 usuários é o teto de `allowedMentions`
  e ~90 menções já estouram os 2.000 caracteres da mensagem.
- Cron `0 6 * * 0` — chama a staff no canal dos inativos sobre quem não respondeu aos avisos
  ([src/services/avisoRemocaoInativos.js](src/services/avisoRemocaoInativos.js)). Ver acima.
- Cron `0 6 * * 3` — troca os MVPs da semana
  ([src/services/weeklyMvpService.js](src/services/weeklyMvpService.js)). Ver abaixo.
- Cron `10 6 * * 3` — inativa quem ficou abaixo do limiar (1.000 menos a tolerância) de contribuição
  ([src/services/weeklyInactiveService.js](src/services/weeklyInactiveService.js)). Ver abaixo.
- Cron `0 7 * * 3` — cadastra o duelo da semana seguinte
  ([src/services/guildDuelService.js](src/services/guildDuelService.js)). Ver abaixo.
- Cron `5,20,35,50 * * * *` — avisa entradas, saídas, promoções e rebaixamentos na guilda do jogo
  ([src/services/guildHistoryService.js](src/services/guildHistoryService.js)). Ver abaixo.
- Cron `0 1 * * *` — recalcula a ordem da fila por tickets ([src/services/ticketReorder.js](src/services/ticketReorder.js)). Ver acima.
- `setInterval` — ciclo da fila por tickets (1 min, `TICKET_CYCLE_SECONDS`): reconciliação,
  contadores de mensagem e call, cobrança de resposta pendente e recálculo da ordem quando algum
  ticket foi encerrado. Roda **também em modo dev**
  (decisão do usuário, 14/08/2026) — dois processos com o mesmo token contam cada mensagem duas
  vezes, então pare a VM antes de subir local.
- `setInterval` — lembrete de inativos (3h por padrão, `INACTIVE_MESSAGE_INTERVAL`).
- `restoreMutes` / `restoreTemporaryWarnings` — reagendam expirações persistidas em `mutes` / `warnings`
  depois de um restart.

## Skills do projeto

Em [.claude/skills/](.claude/skills/), versionadas junto com o código:

- **`checar`** — checagem estática (`node .claude/skills/checar/check.mjs`), offline e em 2s. Use antes
  de commitar e depois de mexer em comando. A mesma skill traz
  `node .claude/skills/checar/perguntas.mjs`, que mede o roteamento do `.ia` contra as perguntas de
  referência — gasta cota da API e leva ~80s, então é script à parte e só depois de mexer em
  `FERRAMENTAS`. São as duas únicas verificações que rodam sem subir o bot.
- **`novo-comando`** — as três edições obrigatórias para adicionar um comando, no padrão do repo.
- **`publicar`** — checagem + commit no padrão + checkbox do roadmap do README.

## Banco (Supabase)

Sem migrations no repo — o schema vive no Supabase. Domínios principais:

- **Membros**: `users` (`discord_id`, `brawlhalla_id`, `role`, `active`, `need_update`), `alt_ids`,
  `player_elo_history`, view `vw_player_elo_max`.
- **Semana/atividade**: `player_weekly_info`, `weekly_missions`, `weekly_inactive_players`,
  `inactivity_shields`, `guild_weekly_guild_points`, `guild_duels`, `season`.
- **Economia (TGG Coins)**: `tgg_coins_wallet`, `_transactions`, `_shop`, `_shop_roles`, `_shop_exitlag`,
  `_purchases`, `_inventory`, `_service_providers`, `_coach_prices`, `_daily_streak`, `_achievements`,
  `_achievements_alts`, `_achievements_finished`, view `vw_tgg_coins_wallet_total`.
  A variante `tgg_coins_event_*` é a carteira paralela de eventos/tickets — mesma lógica, tabelas separadas.
- **Fila por tickets**: `ticket_queue`, `ticket_activity`, view `vw_ticket_pontos`, função
  `incrementar_atividade_ticket`.
- **Moderação/diversos**: `warnings`, `mutes`, `motd`, `birthdays`, `tgg_quiz_completed`, `contador_crz`.

## Convenções

- Toda saída ao usuário é **embed**, via os builders de [utils/discordUtils.js](utils/discordUtils.js)
  (`createErrorEmbed`, `createSuccessEmbed`, `createLoadingEmbed`, `createWarningEmbed`).
  Listas longas usam `createPagination`; ações destrutivas usam `awaitConfirmation`.
  O `time` de `createPagination` é a vida útil **absoluta** do collector, e o padrão são 60s — lista
  com muitas páginas fica inalcançável do meio para o fim. Passe `idle` (reinicia a cada clique) e um
  `time` maior de teto, como faz o `.lb-guilda`. Os outros comandos paginados ainda estão nos 60s.
- Texto voltado ao usuário em **português (pt-BR)**; logs em inglês com prefixo entre colchetes
  (`[CRON]`, `[ELO ADD]`, `[WeeklyInfo]`).
- Erros: handlers deixam a exceção subir para o try/catch de `index.js`/`interactions.js`, que responde um
  embed de erro genérico. Falhas de API externa que não devem abortar o fluxo são engolidas com
  `.catch(() => {})` e um `console.warn`.
- Emojis customizados do servidor ficam em [config/emojis.js](config/emojis.js) — usar `EMOJIS.x`, não colar o ID.
- O README lista um roadmap com itens marcados; ao concluir algo que está lá, atualize o checkbox.

### Onde a função mora

O corte é por **assunto**, não por tipo. "Todo comando aqui, toda função ali" produz um saco único
que cresce para sempre; o que paga é separar o que **muda por motivo próprio** ou o que **mais de um
lugar precisa**. [src/services/contribuicaoSemanal.js](src/services/contribuicaoSemanal.js) é o
modelo: 123 linhas, importado por MVP, inativação, lembrete de domingo e `.scan` — se cada um
calculasse do seu jeito, a prévia de domingo discordaria da quarta-feira. Já `parseColor` em
[src/admin.js](src/admin.js) é usado por um handler 20 linhas acima: extrair só custaria um pulo
entre arquivos.

Na prática:

- Função de apoio usada por **um** handler fica no mesmo arquivo, logo abaixo dele. Não extraia.
- Usada por **dois ou mais**, ou que carrega regra de negócio que precisa bater entre rotinas →
  arquivo próprio em [src/services/](src/services/) (regra) ou [src/handlers/](src/handlers/) (apoio de UI).
- Arquivo passando de **~800 linhas** é sinal de corte, mas o corte tira um **assunto inteiro**
  (handler + os helpers dele), nunca "as funções". Os alvos abertos hoje são o bloco de justificativa
  em `public.js` (~410 linhas) e o de warns em `admin.js` (~490).
- Não faça reorganização de arquivo grande "de passagem" — só quando a tarefa já for mexer nele.
  Não há teste; verificação é rodar o bot no Discord.

### Comentários

Comentário explica **por quê**, nunca **o quê** — linha que traduz o código para português é ruído.
Passando de 3 linhas, o conteúdo pertence a este arquivo ou a [docs/](docs/), não inline. A exceção
é decisão não recuperável lendo o código, e essa vale ouro: por que base 0 tem dois significados
([contribuicaoSemanal.js:65](src/services/contribuicaoSemanal.js#L65)), por que a tolerância existe,
por que Bronze e Tin ficam de fora. Nesses casos, registre a **data da medição** junto.
