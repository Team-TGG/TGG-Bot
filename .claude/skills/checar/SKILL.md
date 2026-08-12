---
name: checar
description: Roda a checagem estática do TGG-Bot — verifica se todo handler tem slash builder, se os aliases são alcançáveis, se os builders respeitam as regras do Discord e se as convenções do projeto foram seguidas. Use antes de commitar, depois de adicionar ou renomear qualquer comando, e sempre que quiser saber se algo quebrou sem precisar subir o bot.
---

# Checagem estática

O projeto não tem teste nem linter, e subir o bot mexe em produção (registra slash commands na
guild e pinga membros inativos). Esta skill é a única verificação que roda sem esse custo.

## Como rodar

```bash
node .claude/skills/checar/check.mjs
```

Da raiz do projeto. O script **não conecta no Discord e não escreve nada** — só importa os módulos
e lê arquivos. Precisa do `.env` porque `src/discord.js` cria o client do Supabase no topo do módulo.

Saída: lista de `ok` / `aviso` / `ERRO`. Exit code 0 se não houver erro, 1 se houver, 2 se os
módulos nem carregarem.

## Executores do `.ia`

```bash
node .claude/skills/checar/executores.mjs
```

Roda cada ferramenta de verdade e confere o que ela devolve: campo dentro dos 1024 do Discord,
lista cortada sempre com o aviso `… e mais N`, `dados` sem `discord_id` nem `brawlhalla_id`, e o
par declaração + executor completo. Lê banco e API do Brawlhalla; **não gasta cota do Gemini**.

Roda depois de mexer em qualquer executor, e antes de commitar ferramenta nova.

É o par do script abaixo, e a divisão é o que faz os dois valerem: em 11/08/2026 o roteamento
marcava 19/19 enquanto todo embed cortava lista em 15 linhas sem avisar — 7 MVPs e 16 dos 31 da
prévia de inativação sumiam da resposta. Um testa qual ferramenta a IA escolhe, o outro testa o
que a ferramenta produz.

## Roteamento do `.ia`

Script separado, porque gasta rede e cota da API do Gemini — não entre no `check.mjs`, senão a
checagem de todo commit passa a depender do free tier:

```bash
node .claude/skills/checar/perguntas.mjs
```

Roda as perguntas de referência contra o modelo configurado (`GEMINI_MODEL=outro-modelo node ...`
compara dois), afirma **ferramenta e argumentos**, e no fim checa que `redigirResposta` devolve
texto. Leva ~80s: o free tier limita por minuto e o script se espaça para não tomar 429.

Rode **depois de mexer em qualquer `description` de `FERRAMENTAS`** ou nas instruções, em
[src/handlers/iaHandlers.js](../../../src/handlers/iaHandlers.js). É o único jeito de ver que
consertar uma pergunta não roubou outra da ferramenta vizinha.

- *ferramenta errada* — a `description` da escolhida está pegando caso que não é dela, ou a da
  certa está estreita demais. Ajuste uma das duas e rode de novo: o efeito é sempre nas duas pontas.
- *argumento errado* — ferramenta certa, resposta errada ("top 5" com `limite: 10`). Costuma ser
  descrição de parâmetro vaga, não a da ferramenta.
- *`redigirResposta` vazio ou 400* — a resposta escrita parou de sair. Já aconteceu por falta do
  `thoughtSignature` (ver o comentário em [iaProvider.js](../../../src/services/iaProvider.js)), e
  é invisível no Discord: `handleIa` engole a falha e o embed sai só com os números.

Pergunta que a staff errar no uso real vira **linha nova em `CASOS`**, com a ferramenta certa
anotada. O log `[IA]` do bot grava quem perguntou, o texto e a ferramenta escolhida.

## Como interpretar

**ERRO = quebra de verdade.** Corrija antes de commitar.

- *handler sem SlashCommandBuilder* — o comando só vai funcionar por prefixo. Falta o builder em
  `src/slash/builders/{public,admin,economy}.js`. Exceções conhecidas e propositais: `crz`, `wam`, `bam`
  (estão na allowlist `PREFIX_ONLY` do script).
- *builder sem handler* — o `/comando` aparece no Discord e falha ao ser usado.
- *alias inalcançável* — o router faz `content.split(/\s+/)` e `.toLowerCase()` antes de procurar a
  chave, então alias com espaço ou maiúscula **nunca** casa. É código morto silencioso.
- *alias declarado 2x* — objeto literal em JS mantém só o último; o primeiro some sem aviso.
- *nome/descrição de slash inválidos* — o Discord recusa o registro inteiro no `PUT`, derrubando
  todos os slash commands de uma vez, não só o errado.

**aviso = dívida conhecida.** Não reprova, mas não aumente a conta:

- emoji com ID colado fora de `config/emojis.js`
- chamada direta ao Supabase dentro de arquivo de handler
- comando sem alias próprio

## Ao mexer no script

Se um comando novo for propositalmente só-prefixo, adicione o nome em `PREFIX_ONLY` no topo do
`check.mjs` — com um comentário dizendo por quê. Não relaxe uma regra só para o check passar:
se o aviso incomoda, conserte a causa.
