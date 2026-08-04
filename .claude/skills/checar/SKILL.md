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
