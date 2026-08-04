# Modo dev

Sobe o bot para testar comando **sem mexer no servidor real**.

## Como usar

```bash
npm run dev
```

É só isso. Nenhum arquivo precisa ser editado — nem `.env`, nem `package.json`. A VM continua rodando
`npm start` e não é afetada por nada disso.

## O que ele desliga

| Efeito | `npm start` | `npm run dev` |
| :-- | :-- | :-- |
| Registrar slash commands (PUT na guilda) | roda | **pulado** |
| Lembrete de inativos (ping no canal + DM) | roda 5 s após o boot | **pulado** |
| Crons (cargos, ELO, apelidos, aniversários, MOTD) | roda | **pulado** |
| Restaurar mutes e warns temporários | roda | **pulado** |
| Responder comandos `.` e `/` | roda | roda |

O lembrete de inativos é o motivo principal de isso existir: ele não tem controle de "já mandei hoje",
então **cada restart dispara ping e DM de novo** para todo mundo da lista.

## Como saber que funcionou

O boot imprime o modo antes de qualquer outra coisa:

```
============================================================
  MODO DEV — nada que afete o servidor real vai rodar
============================================================
  pulado : lembrete de inativos (ping no canal + DM)
  pulado : crons (cargos, ELO, apelidos, aniversarios, MOTD)
  pulado : restauracao de mutes e warns temporarios
  pulado : registro de slash commands
  ativo  : comandos por prefixo e slash ja registrados na guilda
============================================================
```

Em produção sai uma linha só: `[MODE] PRODUCAO — slash commands, crons e lembrete de inativos ATIVOS`.

Se você não vir o quadro, **está em produção** — pare o processo.

## O que a flag não resolve: pare o bot da VM antes

O modo dev impede os efeitos colaterais, mas não impede que **dois bots com o mesmo token** recebam os
mesmos eventos do Discord. Se o processo da VM estiver no ar enquanto você roda local, cada comando é
respondido duas vezes e as duas conexões disputam a mesma sessão de gateway.

Fluxo de trabalho:

1. Parar o bot na VM
2. `npm run dev` local, testar
3. `Ctrl+C`
4. Subir a VM de volta

## Testando comando novo

Comando novo só aparece como `/comando` depois de registrado na guilda, e o modo dev pula o registro
justamente para não reescrever os comandos de produção. Quando precisar:

```bash
npm run dev:slash
```

Isso roda em modo dev **mas registra os slash commands**. Como o registro é um `PUT` que sobrescreve a
lista inteira da guilda, use só quando for essa a intenção. Para testar a lógica do handler sem isso,
o caminho por prefixo (`.comando`) funciona em modo dev normal e chama exatamente a mesma função.

## Alternativas ao `npm run dev`

A flag também é aceita direto, se preferir:

```bash
node index.js --dev
node index.js --dev --register-commands
BOT_MODE=dev npm start          # em shell que aceite variavel inline (nao no PowerShell)
```

O `BOT_MODE` existe para o dia em que um gerenciador de processo na VM controlar isso pelo ambiente.

## Limitação conhecida

Isso **não é uma guilda de teste** — o bot continua conectado ao servidor real e respondendo comandos
lá. Comando que escreve no banco (`.warn`, `.entrou`, `.addcoins`) escreve de verdade. O modo dev
protege contra os efeitos *automáticos* do boot, não contra o que você mandar o bot fazer.

Isolamento completo exigiria um segundo app no Discord e uma guilda de teste — e como os IDs de cargo,
canal e categoria são literais em `config/index.js`, `src/discord.js` e `utils/permissions.js`, isso
significa recriar toda essa configuração. Não foi feito.
