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

**Prioridade:** `brawlhalla.js:608`. A função é "nova" mas depende de uma chamada v0 para o 2v2, e
lança exceção se qualquer uma das 4 falhar — o dia em que a v0 sair do ar, `.stats` cai junto.

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
