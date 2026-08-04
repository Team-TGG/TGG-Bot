---
name: publicar
description: Fecha o trabalho no TGG-Bot — roda a checagem, commita seguindo o padrão do repo e atualiza o checkbox do roadmap no README quando o item entregue está listado lá. Use quando o usuário pedir para commitar, publicar, subir ou fechar uma mudança.
---

# Publicar uma mudança

## 1. Cheque antes

```bash
node .claude/skills/checar/check.mjs
```

Erro reprova o commit — conserte primeiro. Se o usuário mandar commitar mesmo assim, tudo bem,
mas diga na resposta o que está indo quebrado.

## 2. Veja o que está indo

```bash
git status --short && git diff --stat
```

Nunca commite `.env`, `cache/` nem `.brawlhalla-clan-cache.json` — estão no `.gitignore` e contêm
credenciais e dados de jogador. Se aparecerem em `git status`, o `.gitignore` foi quebrado: avise
em vez de dar `git add`.

## 3. Roadmap do README

Se a mudança entrega um item marcado como `- [ ]` no roadmap do [README.md](../../../README.md),
marque `- [x]` **no mesmo commit**. É a única lista de pendências do projeto, e ela só serve se
estiver correta.

## 4. Commit

Padrão do repo: prefixo convencional (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`), assunto
curto no imperativo. Corpo quando o "porquê" não for óbvio pelo diff — especialmente efeito
colateral, decisão do usuário ou coisa que alguém tentaria "consertar" depois.

Rodapé obrigatório:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Mudanças que não têm relação entre si vão em commits separados.

**Atenção com a ferramenta:** a chamada Bash roda em Git Bash, não em PowerShell. Para mensagem
de várias linhas use heredoc — `git commit -F - <<'EOF' … EOF`. Here-string do PowerShell
(`@'…'@`) entra literal e suja o assunto do commit.

## 5. Push

Só com o usuário pedindo. O fluxo aqui é direto na `main` — não crie branch nem PR sem ele pedir.

```bash
git push origin main
```

Depois do push, se a mudança altera comportamento do bot em produção, lembre que ela **só vale
depois de reiniciar o processo na VM** — e que reiniciar registra os slash commands de novo e
dispara o lembrete de inativos (ping + DM para membros reais).
