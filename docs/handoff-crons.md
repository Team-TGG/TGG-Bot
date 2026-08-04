# Handoff para o repositório dos crons (`C:\xampp\htdocs\TGG`)

Documento para quem for trabalhar nos crons do site sabendo que existe um bot do outro lado.
O par deste arquivo é [brawlhalla-api.md](brawlhalla-api.md), que tem os endpoints e os bloqueios.

> Levantamento feito em 04/08/2026 com uma varredura leve do repo do site — localizei os arquivos
> relevantes, não auditei a lógica deles. Confirme antes de assumir qualquer coisa como completa.

## Os dois sistemas e o contrato entre eles

| | Repositório | Papel |
| :-- | :-- | :-- |
| Site / crons | `C:\xampp\htdocs\TGG` (PHP) | **escreve** `player_weekly_info` e o histórico |
| Bot | `C:\xampp\htdocs\TGG-Bot` (Node) | **lê** essas tabelas e mostra no Discord |

Os dois falam com a mesma API do Brawlhalla e o mesmo Supabase. **Nenhum dos dois chama o outro** — a
integração é inteiramente pelo banco. Por isso mudança de semântica em qualquer lado quebra o outro
sem erro nenhum aparecer: só número errado no Discord.

## Onde as coisas estão no repo do site

| Arquivo | O que faz |
| :-- | :-- |
| `api/brawlhalla-service.php` | **único** ponto que chama a API do Brawlhalla. Já mistura v0 e v1 |
| `automations/player_elo.php` | cron de 15 min — grava a linha de base semanal em `player_weekly_info` |
| `automations/player_elo_finish.php` | fecha a semana, grava os campos `final_*` |
| `automations/guild_history.php` | alimenta `guild_membership_history` |
| `automations/player_legend_stats.php` | estatísticas por lenda |
| `automations/update_peak_elo.php` | `player_elo_history` / peaks |

Toda chamada de API passar por um arquivo só é uma sorte: a migração do lado do site fica contida em
`brawlhalla-service.php`.

## Regras que o cron precisa manter

### `player_weekly_info` — só inserir, nunca sobrescrever

O bot também escreve nessa tabela (`ensurePlayerWeeklyInfo` em `src/tggCoins.js`, chamada por `.entrou`
e `.add-account`), e **os dois lados só inserem quando a linha não existe**. As conquistas comparam
valor inicial × atual; um `update`/`upsert` zera ou paga progresso indevidamente.

Convenções a espelhar:

- `initial_elo_1v1` = **0** quando não há partidas, mas `initial_elo_2v2` e `initial_elo_3v3` = **1200**
- `games` = total de partidas da conta (`stats.games`)
- `guild_xp` = `clan.personal_xp`
- `guild_points` = `personal_points` da API nova
- semana começa **quinta 06:00** (BRT). O bot usa a mesma âncora (`getMissionWeekStart`)

A gravação vive em `automations/player_elo.php` (por volta das linhas 261-272).

### O que o bot lê de lá

- `player_weekly_info` → `.games`, `.conquistas`, `.scan`, cálculo de missões
- `guild_membership_history` → `.scan` (entradas, saídas, promoções)
- `weekly_inactive_players` → `.active`, lembrete de inativos
- `weekly_missions`, `guild_weekly_guild_points`, `guild_duels` → `.missoes`, `.duel`

## A troca coordenada do 2v2

Este é o motivo principal deste documento. **Não faça de um lado só.**

`/v1/player/teams` já funciona, mas devolve só times que fecharam a md10 (10+ jogos), então o total de
partidas 2v2 fica menor que o da v0. Como o bot calcula `atual − base` e a base vem deste cron, trocar
apenas um dos lados produz **jogos negativos** — medido: 7 de 10 jogadores, um deles −298.

Procedimento seguro:

1. Combinar a data — tem que ser uma **quinta 06:00**, quando a semana vira e uma base nova é gravada.
2. Preparar os dois lados antes, sem publicar: `brawlhalla-service.php` no site e
   `src/brawlhalla.js:608` no bot (hoje a única chamada v0 dentro de `fetchPlayerStatsNewAPI`).
3. Publicar os dois **antes** da virada. A primeira base gravada pelo cron já sai com números da v1, e
   o bot passa a comparar v1 com v1.
4. Não reprocessar semanas antigas: as bases anteriores são v0 e vão continuar coerentes entre si.
5. Conferir no primeiro dia com `.games` de alguns jogadores — número negativo é o sintoma de que
   um dos lados não trocou.

Mudanças de formato no 2v2 da v1: `region` virou string (`"BRZ"` em vez de `5`), sumiu `teamname`
(componha de `username_one` + `username_two`), apareceu `region_ranks`.

## Pendências e coisas não verificadas

- O site usa `rankings/{queue}/brz/{page}`, endpoint v0 que **não está** na lista dos seis que a
  liderança levantou. Precisa de equivalente v1 antes de a v0 morrer — vale incluir no email ao time.
- O site também chama `/legend/all` (v0). A v1 (`/v1/static/legends`) **está sem o Aurus** hoje —
  ver [brawlhalla-api.md](brawlhalla-api.md). Não migre ainda.
- Não conferi se `player_elo_finish.php` usa a mesma fonte de 2v2 que o `player_elo.php`. Se usar outra,
  entra na troca coordenada também.
- Guild points anteriores a agosto/2026 não são confiáveis (a API devolvia valores errados). Não use
  esse histórico como base de análise nem de reprocessamento.
