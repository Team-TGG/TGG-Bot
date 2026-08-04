# API do Brawlhalla — referência do projeto

Doc oficial: **https://dev.brawlhalla.com**

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

## Guild points acumulam — o "reset semanal" é só in-game

A doc do `/v1/guild/stats` descreve `guild_points` como *"resets weekly"*. **Isso descreve o jogo, não
a API.** O reset semanal acontece in-game; o valor devolvido pela API é sempre o **total acumulado**.

Vale igual nos três lugares: `guild_points` do `/v1/guild/stats`, `guild_points` por membro do
`/v1/guild/members` e `personal_points` do `/v1/player/guild`. Confirmado em séries de 10 semanas em
`player_weekly_info`: sempre crescente, nunca zera.

Por isso o ganho de uma semana se calcula por **diferença entre duas capturas** (é o que
`player_weekly_info` existe para permitir), nunca lendo o valor direto como se fosse "pontos da semana".

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

**O bot usa um limitador só** (`apiFetch` em [src/brawlhalla.js](../src/brawlhalla.js)), configurado em
180/15min — o limite da API velha. Ou seja, as chamadas `/v1/` estão estranguladas no ritmo da v0.
Separar os dois contadores é pré-requisito para qualquer comando que varra a guilda inteira.

## O que o bot chama hoje

### Já na v1

| Onde | Endpoint |
| :-- | :-- |
| `fetchPlayerStatsNewAPI` | `/v1/player/stats` (`mode=all`, `ranked_1v1`, `ranked_3v3`) |
| `fetchPlayerGuildStatsNewAPI` | `/v1/player/guild` |
| `fetchGuildStatsNewAPI` | `/v1/guild/stats` |
| `fetchGuildMembersNewAPI` | `/v1/guild/members` |

### Ainda na v0 — a migrar

| Onde | Chamada v0 | Substituto v1 |
| :-- | :-- | :-- |
| `brawlhalla.js:608`, dentro de `fetchPlayerStatsNewAPI` | `/player/{id}/ranked` (só pelo 2v2) | `/v1/player/teams` |
| `fetchPlayerStats` (426-427) | `/player/{id}/stats` + `/ranked` | `/v1/player/stats` + `/v1/player/teams` |
| `fetchPlayerStatsNoResolve` (473-475) | idem | idem |
| `fetchClanStats` (517) | `/clan/{id}` | `/v1/guild/stats` + `/v1/guild/members` |
| `nicknameSync.js:55` | `/clan/{id}` | `/v1/guild/members` |
| `fetchLegends` (132) | `/legend/all` | `/v1/static/legends` |

### As duas rotas de membro não devolvem a mesma coisa — cuidado ao trocar

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
| `fetchLegends` | v1 sem o Aurus |
| `fetchPlayerStats` / `NoResolve` | mesmo acoplamento de baseline do 2v2 |
| `/clan/{id}` | v1 não separa plantel atual de ex-membro |

## Schemas (resumo do que o bot consome)

### `/v1/player/stats?brawlhalla_id=&mode=`
`mode` aceita `all` (padrão), `ranked_1v1`, `ranked_3v3`. **Não existe `ranked_2v2`** — 2v2 vem de
`/v1/player/teams`. Retorna agregados do jogador + array `legends` com `legend_id`, `games`, `wins`,
`rating`, `peak_rating`. Nos modos ranked traz `rating`, `peak_rating`, `tier`, `region`, `global_rank`.

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

5. **A doc mente sobre o reset semanal** — ver a seção acima. Não é a única vez que a descrição
   textual descreve o jogo em vez da resposta da API; na dúvida, meça contra os dados reais.
