# API do Brawlhalla — referência do projeto

Doc oficial: **https://dev.brawlhalla.com**

## Integração unificada (21/11/2026)

Os comandos e regras usam `fetchGuildStats`, `fetchGuildMembers`, `fetchPlayerGuildStats`,
`fetchPlayerProfile` e `fetchPlayerBasic`, expostos por `brawlhalla.js`. A seleção das fontes de
guilda, membros e perfil fica em `src/services/brawlhallaService.js`.

- O mesmo formato de guilda representa resposta v1 ou fallback v0. `sources` identifica a origem
  e `availability.guildPoints` distingue pontuação conhecida de indisponível; zero continua válido.
- A v1 fornece GP. A v0 completa nome, quantidade de membros, entrada e XP. Membros são ligados
  somente pelo ID, sem cruzar guildas ou associar pessoas pelo nome. A lista v1 continua sendo a
  referência quando disponível; uma lista vazia que contradiz a v0 é tratada como leitura incerta.
- Regras exigem GP por padrão. Interfaces podem passar `{ requireGuildPoints: false }` para
  mostrar os dados básicos da v0. XP nunca é convertido em GP; essa combinação não resolve um 502.
- A consulta individual de GP tem alternativa pela rota em lote. O limite temporário de uma rota
  HTTP com falha não bloqueia as outras rotas v1.
- `.stats` busca contadores e pontos independentemente; GP opcional tem orçamento de seis segundos.
  Os contadores e ranked permanecem na v0 para continuar compatíveis com as bases do cron do site.
  Caches v0 e v1 de estatísticas são separados; resolver alt para contadores não altera a conta dos GP.
- Os nomes antigos terminados em `NewAPI` continuam como adaptadores compatíveis. Não devem ser
  usados por comandos novos, que devem consumir a camada unificada.

Consulta real em cópia temporária na VPS em 21/11/2026: a camada recuperou Team TGG com 188 membros
e 49.732.567 de XP acumulado pela v0. GP permaneceu indisponível; nenhum valor de XP foi tratado como pontos.

## Queda da v1 (20/11/2026)

Na VPS, `/clan/396943`, `/player/4165486/stats` e `/ranked` responderam 200. A v1 respondeu 502
(`origin_bad_gateway`) com e sem a mesma chave válida, inclusive em lendas e nos exemplos oficiais.
A resposta real da v0 tem XP, mas não Guild Points.

- O cliente HTTP é compartilhado com a sincronização de nomes: timeout de 10 s, duas tentativas,
  no máximo quatro chamadas simultâneas por versão e pausa de 30 s por rota v1 após falhas persistentes.
  As cotas continuam independentes. Chamadas idênticas em andamento são reaproveitadas.
- `.stats` preserva as estatísticas v0 e mostra GP indisponível quando a consulta de guilda falha.
  `.guild` e o cartão de perfil permitem dados básicos da v0; `.alts` recupera os dados da conta
  pedida na v0, sem resolver a conta principal.
- O fallback de interface exige `{ requireGuildPoints: false }` e não entra no cache de GP da v1. MVP,
  contribuição, duelo e inatividade continuam exigindo dados da v1 e não usam GP vencido.
- Capturas semanais guardam `guild_points: null` se a leitura falhar, preservando os jogos.
  A coluna já aceita null. Não sobrescreva a captura quando a API voltar: o valor tardio não é a
  linha de base da quinta. A contribuição fica sem base válida até existir uma captura correta.

Verificação offline: `npm test` e `node .claude/skills/checar/check.mjs`. Não iniciar outro bot para testar.

As páginas de endpoint não são linkadas da home e `/reference/` dá 404. O padrão de URL é:

```
https://dev.brawlhalla.com/v1/endpoints/{categoria}/{nome}/
```

Ex.: `/v1/endpoints/guild/getguildmembers/`, `/v1/endpoints/player/getplayerteams/`.

## Regra de negócio: contribuição é Guild Points

Decisão da liderança (04/08/2026), vale para todo cálculo de atividade no bot:

- **Guild Points = contribuição.** Ganhos **fazendo as missões semanais**. É o único número que a
  staff usa para avaliar membro. O limiar de inatividade ("menos de 1.000 de contribuição na semana
  passada", em `src/services/inactivePlayers.js`) é em guild points.
- **XP é irrelevante para contribuição.** Serve só como métrica de *quanto a pessoa jogou* — ganha-se
  em qualquer partida, inclusive contra bots.

## Pontos da guilda reiniciam semanalmente (20/11/2026)

Por pedido do usuário, o total da guilda segue o contrato de
[GetGuildStats](https://dev.brawlhalla.com/v1/endpoints/guild/getguild/): `guild_points` é a pontuação
da semana e reinicia semanalmente. `.guild`, `.duel` e a IA usam o valor atual diretamente, sem
subtrair `guild_weekly_guild_points.total_guild_points` ou `guild_duels.guild_points`.
Zero é válido depois do reset; leitura ausente continua desconhecida. O cache desses totais
também exige a mesma semana da leitura, além do TTL de cinco minutos.

As capturas do banco ficam preservadas como histórico. O XP continua acumulado e seu ganho semanal
continua sendo calculado por diferença entre capturas.

Isso não altera os pontos individuais de `/v1/guild/members` e `/v1/player/guild`: os schemas desses
campos não especificam reset semanal. A contribuição dos membros mantém a diferença contra
`player_weekly_info`. O projeto registrou séries históricas individuais crescentes durante dez
semanas; essa observação não deve mais ser generalizada para o total semanal da guilda.

## Confiabilidade do histórico (importante)

A API vinha **devolvendo guild points errados** e isso foi corrigido pouco antes de 04/08/2026 — é o
motivo de a migração estar sendo feita agora. Consequências:

- Os dados de guild points gravados em `player_weekly_info` **antes de agosto/2026 não são confiáveis**.
  Há muita conta com valor congelado por 9-10 semanas seguidas enquanto o XP subia; isso é defeito da
  API antiga, não retrato de comportamento do jogador.
- **Não tire conclusão sobre membro** a partir do histórico anterior a essa correção, e não construa
  ranking ou cobrança em cima dele.
- A semana corrente está sendo usada como teste. **Dados sólidos a partir de ~18/08/2026**, quando
  houver duas semanas limpas para comparar.

## Autenticação e rate limit

| | v0.0 (depreciada) | v1.0 |
| :-- | :-- | :-- |
| API key | obrigatória (`?api_key=`) | **não exige** |
| Rate limit | 180 req / 15 min | **2000 req / 5 min** |

O bot tem **dois limitadores independentes** em `apiFetch` ([src/brawlhalla.js](../src/brawlhalla.js)),
escolhidos pelo `/v1/` na URL.

**Na v1 o gargalo não é a cota, é a concorrência.** Medido em 02/09/2026: 20 chamadas em série passam
todas; 32 disparadas juntas dão 13 respostas boas, 18× `502` e 1× `404`. Em milhares de chamadas não saiu
nenhum `429` nem cabeçalho de cota. Varrer a guilda inteira exige teto de chamadas em voo — as insígnias
usam 4, em `lerApi` de [src/services/insigniasLeitura.js](../src/services/insigniasLeitura.js).

## O que o bot chama hoje

### Já na v1

| Onde | Endpoint |
| :-- | :-- |
| `fetchPlayerStatsNewAPI` | `/v1/player/stats` (`mode=all`, `ranked_1v1`, `ranked_3v3`) |
| `fetchPlayerGuildStatsNewAPI` | `/v1/player/guild` |
| `fetchGuildStatsNewAPI` | `/v1/guild/stats` |
| `fetchGuildMembersNewAPI` | `/v1/guild/members` |
| `insigniasLeitura.js` (cron 04:00) | `/v1/player/stats` (`ranked_1v1`, `ranked_3v3`), `/v1/player/teams`, `/v1/guild/members`, `/v1/static/legends` — a rota base está na v0, ver abaixo |

### Ainda na v0 — a migrar

| Onde | Chamada v0 | Substituto v1 |
| :-- | :-- | :-- |
| `brawlhalla.js:608`, dentro de `fetchPlayerStatsNewAPI` | `/player/{id}/ranked` (só pelo 2v2) | `/v1/player/teams` |
| `fetchPlayerStats` (426-427) | `/player/{id}/stats` + `/ranked` | `/v1/player/stats` + `/v1/player/teams` |
| `fetchPlayerStatsNoResolve` (473-475) | idem | idem |
| `fetchClanStats` (517) | `/clan/{id}` | `/v1/guild/stats` + `/v1/guild/members` |
| `nicknameSync.js:55` | `/clan/{id}` | `/v1/guild/members` |
| `fetchLegends` (132) | `/legend/all` | `/v1/static/legends` |
| `lerGeral` em `insigniasLeitura.js` | `/player/{id}/stats` | `/v1/player/stats` — **voltou para a v0 de propósito** (14/09/2026), pelo bug de conta vinculada (pegadinha 7). Volta quando a Brawlhalla corrigir |

### As duas rotas de membro não devolvem a mesma coisa — cuidado ao trocar

> **Mudou em 02/09/2026:** `/v1/guild/members` passou a devolver o plantel atual, e não mais todo mundo que
> já passou pela guilda — 200 contas, um `Leader`, nenhuma sem `rank`. Mas **com atraso para quem sai**: em
> 13/09/2026 vieram 204, e 9 delas o cron do site tinha registrado como saída naquele mesmo dia, enquanto
> quem saiu dois dias antes já não aparecia. O texto abaixo é de quando a rota misturava ex-membros.

Medido em 04/08/2026:

| Rota | Devolve | Quantidade |
| :-- | :-- | :-- |
| `/clan/{id}` (v0) | **só quem está na guilda hoje** | 200 (o teto real da guilda é 200) |
| `/v1/guild/members` | **todo mundo que já passou pela guilda**, incluindo quem saiu | 629 |

Os 200 da v0 são um subconjunto exato dos 629. Não é corte nem paginação da API velha: 200 é o tamanho
máximo da guilda no jogo.

**Não existe campo que separe atual de ex-membro na resposta v1.** Os dois grupos têm exatamente a
mesma forma (`brawlhalla_id, name, rank, join_date, xp, guild_points`). O que denuncia a mistura é a
distribuição: entre os 429 que só aparecem na v1 há **29 "Leader"** (a guilda tem um), e 38 registros
vêm com `rank` ausente.

Consequência para a migração: **`syncNicknames` e qualquer coisa que precise do plantel atual não podem
simplesmente trocar `/clan/{id}` por `/v1/guild/members`** — passariam a renomear e contabilizar quem já
saiu. Hoje o único jeito de obter o plantel atual é a rota v0, que é depreciada. Alternativa quando ela
morrer: derivar de `guild_membership_history` no Supabase (quem tem `entrou` sem um `saiu` posterior).

Serve de alerta para análises: tratar os 629 como "membros da guilda" infla a base em mais de 3x.

## Bloqueios da migração (medidos em 04/08/2026)

Nenhuma das pendências da v0 é troca direta. Cada uma esbarra em algo do lado da API ou em acoplamento
com o cron do site. **Não migre nenhuma sem reler esta seção.**

### 2v2 — a v1 só mostra time que fechou a md10

`/v1/player/teams` funciona (o erro 500 que travou a tentativa anterior não acontece mais), mas devolve
**só times com 10+ jogos**, ou seja, que completaram a colocação. Medido em 14 jogadores: 40 times na v1,
menor contagem de jogos = 10, nenhum abaixo disso, e **nenhum** time da v0 com ≥10 jogos ficou de fora.
A v0 também traz um registro fantasma com `brawlhalla_id_two: 0` e `teamname` igual ao nome do jogador.

O impedimento real é outro: `player_weekly_info.initial_games_2v2` é gravado pelo **cron do site**, com
números da v0. O bot calcula `atual − base`. Trocar só o lado do bot produz **jogos negativos**:

| jogador | base (v0) | atual v0 | atual v1 | hoje | se migrar |
| --: | --: | --: | --: | --: | --: |
| 82796827 | 444 | 505 | 146 | 61 | **−298** |
| 124479891 | 329 | 386 | 298 | 57 | **−31** |
| 8195450 | 90 | 106 | 78 | 16 | **−12** |

7 de 10 jogadores ficariam negativos, sem erro nenhum aparecer — só número errado no `.games`, nas
missões e nas conquistas. **Bot e cron do site têm que trocar juntos, numa virada de quinta 06:00.**

Enquanto isso, a v0 se sustenta: base e atual saem da mesma fonte, então o delta continua coerente.

Mudanças de formato para quando for a hora: `region` virou string (`"BRZ"` em vez de `5`), sumiu
`teamname` (dá para compor de `username_one` + `username_two`), apareceu `region_ranks`.

### Lendas — a v1 está sem o Aurus

> **Mudou em 02/09/2026:** a rota passou a trazer 71 registros numa página, com o Aurus (`legend_id 71`,
> Chakram + Spear). O `RANDOM` (`legend_id 2`) continua lá, então são 70 lendas de verdade.

`/v1/static/legends?max_results=100` traz as 69 numa página só (`total_pages: 1`), então a paginação
não chega a ser problema. Os atributos e as armas batem com a v0. Mas comparando por `legend_id`:

- **falta `legend_id 71` (`aurus`)** — a lenda mais nova, justamente a que foi adicionada às estatísticas
- **sobra `legend_id 2` (`RANDOM`)**, um placeholder com `weapon_one` e `weapon_two` vazios

Migrar agora perderia o mapeamento de armas do Aurus silenciosamente.

Além disso a chave mudou de natureza: v0 usa `legend_name_key` (`bodvar`, `redraptor`), v1 usa
`legend_name` em caixa alta e com acento (`BÖDVAR`, `RED RAPTOR`). Como o array `legends` das
estatísticas do jogador é indexado por `legend_name_key`, **se um dia migrar, faça o join por
`legend_id`**, que é estável nas duas versões — não tente normalizar nome.

### Resumo do que trava o quê

| Item | Trava |
| :-- | :-- |
| 2v2 (`brawlhalla.js:608`) | cron do site precisa migrar junto; senão jogos negativos |
| `fetchLegends` | ~~v1 sem o Aurus~~ (resolvido em 02/09/2026); falta ignorar o `RANDOM` |
| `fetchPlayerStats` / `NoResolve` | mesmo acoplamento de baseline do 2v2 |
| `/clan/{id}` | v1 não separa plantel atual de ex-membro |

## Schemas (resumo do que o bot consome)

### `/v1/player/stats?brawlhalla_id=&mode=`
`mode` aceita `all` (padrão), `ranked_1v1`, `ranked_3v3`. **Não existe `ranked_2v2`** — 2v2 vem de
`/v1/player/teams`.

Com `mode=all` (medido em 02/09/2026) a raiz traz `name`, `games`, `wins`, `xp`, `level`, `xp_percentage`,
os `damage_*`/`ko_*` de itens e `region_ranks`. Cada item de `legends` traz `legend_id`, `games`, `wins`,
`damage_dealt`, `damage_taken`, `kos`, `falls`, `suicides`, `team_kos`, `match_time`, `damage_unarmed`,
`damage_thrown_item`, `damage_weapon_one`/`_two`, `damage_gadgets`, `ko_unarmed`, `ko_weapon_one`/`_two`,
`ko_gadgets`, `time_held_weapon_one`/`_two`, `xp`, `level` e `xp_percentage`. Ou seja, **tudo que a v0
dá, menos `legend_name_key` e `ko_thrown_item`** — junte lenda por `legend_id`. `level` e `xp` **somem da
resposta** em conta com pouquíssimas partidas (vista com 4 jogos): ausente não é 0. Também somem, junto com o
`level` de cada lenda, em conta afetada pelo bug de conta vinculada (pegadinha 7): vista em 14/09/2026 com 10 mil jogos.

Nos modos ranked traz `rating`, `peak_rating`, `tier`, `region`, `global_rank`, `games` e `wins` — **da
temporada atual, não da vida inteira**. Medido em 13/09/2026: o veterano com 63 mil vitórias tinha 24 de
ranked 1v1, e na semana seguinte à virada de 24/06 a base de vitórias de 166 contas caiu pela metade.
Conta sem partida no modo devolve `404`.

### `/v1/player/teams?brawlhalla_id=`
```json
{ "brawlhalla_id": 4697805,
  "teams": { "ranked_2v2": [ { "brawlhalla_id_one": 4697805, "brawlhalla_id_two": 2467374,
    "username_one": "Octavius", "username_two": "UpyriDensetsu", "rating": 1618,
    "peak_rating": 1705, "tier": "Gold 4", "wins": 41, "games": 87, "region": "US-E",
    "global_rank": 195136 } ] } }
```

### `/v1/guild/members?guild_id=`
```json
{ "guild_id": 3, "guild_members": [ { "brawlhalla_id": 5464542, "name": "...", "rank": "Leader",
    "join_date": 1660419655, "xp": 20801, "guild_points": 243 } ] }
```
Traz **todos** os membros numa chamada (629 na TGG). É a base certa para qualquer comando de guilda
inteira — e o `join_date` vem junto, então não precisa de consulta extra para tempo de casa. Contar
**saídas** ainda exige a tabela `guild_membership_history` no Supabase.

### `/v1/guild/stats?guild_id=`
`guild_id, name, create_date, xp, legacy_xp, notice, tags, discord_invite_code, guild_points, rank,
is_recruiting, member_count`.

### `/v1/player/guild?brawlhalla_id=`
```json
{ "brawlhalla_id": 5464542, "guild": { "guild_id": 3, "guild_name": "...", "personal_xp": 20801,
    "personal_xp_this_week": 1895, "personal_points": 243, "join_date": 1660419655, "rank": "Leader" } }
```

### `/v1/static/legends`
Parâmetros: `page`, `max_results` (máx 100, **padrão 50**), `filter_by_id`, `filter_by_name`,
`filter_by_weapon`. Retorna `{ legends: [...], total_pages: N }` com `legend_id`, `legend_name`,
`bio_name`, `weapon_one`, `weapon_two`, atributos.

## Pegadinhas

1. **O campo por membro chama `guild_points`, não `personal_points`.** `personal_points` só existe na
   rota individual, aninhado em `data.guild`. Ler o nome errado devolve `undefined` e, com fallback
   `|| 0`, vira "todo mundo tem zero" silenciosamente — foi exatamente o erro que me fez concluir que
   o endpoint em lote não trazia pontos.

2. **`/v1/static/legends` é paginado; `/legend/all` não era.** Trocar um pelo outro sem tratar
   `total_pages` traz só 50 lendas e some com o resto sem erro nenhum.

3. **A chave da lenda mudou de nome:** v0 usava `legend_name_key`, v1 usa `legend_name`. O cache de
   lendas em `fetchLegends` é indexado por essa chave.

4. **O array de 2v2 mudou de lugar:** v0 `ranked['2v2']`, v1 `teams.ranked_2v2`. `calculateGames`
   ([src/handlers/publicHandlers.js](../src/handlers/publicHandlers.js)) itera esse array.

5. **Não generalize o total da guilda para os membros.** O total `guild_points` de GetGuildStats
   segue o reset semanal documentado. Os contadores individuais mantêm o cálculo por diferença
   descrito acima; XP não substitui nenhum desses pontos.

6. **`404` sob carga não quer dizer "não existe".** Varrendo `/v1/player/stats` conta a conta, a v1
   devolve `404` para jogador que responde normalmente sozinho — e como `404` também é a resposta legítima
   de conta sem partida no modo, o erro passa como dado. Na primeira varredura das insígnias (02/09/2026),
   183 de 200 membros saíram com zero vitória **sem um único erro registrado**. Repita o `404` antes de
   aceitá-lo e refaça em série quem sobrou. É o mesmo comportamento que o `CLAUDE.md` registra na
   `/v1/player/guild`, então vale para as rotas por conta em geral, não para uma só.

7. **Com conta vinculada (cross progression), a v1 responde com a conta errada.** Pedindo a conta da
   Steam de quem está jogando na vinculada do celular, `/v1/player/stats` devolve a **última conta
   vinculada em que a pessoa jogou**; a v0 devolve a pedida. Medido em 14/09/2026 na mesma conta: v0 com
   level 100, XP 1.237.193 e Scarlet 49; v1 com level 84, XP 741.005 e maior lenda 34. Reportado à
   Brawlhalla por email. Até corrigirem, a rota base das insígnias lê a v0 (`lerGeral`). Não foi
   conferido se as rotas de modo e `/v1/player/teams` têm o mesmo defeito. A v0 tem dois detalhes que
   a v1 não tem: conta inexistente volta `200 {}` em vez de `404`, e os campos das lendas vêm sem
   sublinhado (`damagedealt`, `matchtime`, `timeheldweaponone`).
