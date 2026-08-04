---
name: novo-comando
description: Cria um comando novo no TGG-Bot fazendo as três edições obrigatórias (handler, mapa em commands.js, SlashCommandBuilder) no padrão do repo. Use sempre que for adicionar um comando novo, ou quando um comando existente precisar virar slash também — esquecer o builder faz o comando existir só por prefixo e ninguém percebe.
---

# Comando novo

Todo comando existe como `.comando` **e** `/comando`, executando a mesma função. Adicionar um exige
**três edições**. Fazer só as duas primeiras é a falha mais comum do repo: o comando funciona quando
você testa por prefixo e simplesmente não existe como slash.

## Antes de escrever

Descubra do usuário, se ele não disse:

1. **Nome e aliases** — inclusive typos e apelidos internos, que aqui são intencionais.
2. **Quem pode usar** — público, `adminOnly` (checa `users.role` no banco) ou `leaderOnly`.
   Se for graduado por cargo do Discord, qual nível de `ROLE_HIERARCHY` (1=helper … 6=leader).
3. **Que dados ele mostra** — de qual tabela ou de qual endpoint da API do Brawlhalla.
4. **Se recebe argumentos** e de que tipo (usuário, número, texto).

## Edição 1 — o handler

Escolha o arquivo pelo tipo: público → `src/public.js`; staff/moderação → `src/admin.js`;
economia/TGG Coins → `src/tggCoinsCommands.js`. Lógica de apoio longa vai para `src/handlers/`.

Assinatura sempre `(message, args, client)` — nunca `(interaction)`, porque o slash chega pelo
message-shim de `utils/slashAdapter.js`.

```js
export const handleExemplo = adminOnly(async (message, args, client) => {
  // opção tipada só existe no caminho slash; prefixo cai no parse de args
  let alvo;
  if (message.interaction) {
    alvo = message.interaction.options.getUser('usuario');
  } else {
    alvo = message.mentions.users.first();
  }

  if (!alvo) {
    return message.reply({ embeds: [createErrorEmbed('Faltou o usuário', 'Use: `.exemplo @user`')] });
  }

  const dados = await getAlgumaCoisa(alvo.id);   // acesso a banco passa por db.js/tggCoins.js
  await message.reply({ embeds: [createSuccessEmbed('Pronto', `...`)] });
});
```

Regras do repo: toda saída é embed (`createErrorEmbed` / `createSuccessEmbed` / `createLoadingEmbed` /
`createWarningEmbed`); lista longa usa `createPagination`; ação destrutiva usa `awaitConfirmation`;
texto em pt-BR e log em inglês com prefixo (`[EXEMPLO]`); emoji vem de `EMOJIS`, nunca com ID colado.
Não use try/catch para erro genérico — deixe subir para o handler global.

## Edição 2 — `src/commands.js`

Importe o handler no topo (no import do arquivo certo), acrescente os aliases em `COMMAND_ALIASES`
e a entrada em `commands`, na seção correspondente (Públicos / Admin / TGG-Coins).

Chave de alias **sempre minúscula e sem espaço** — o router faz `.toLowerCase()` e quebra por
espaço antes de procurar, então `'Exemplo'` ou `'exemplo '` nunca casam com nada.

## Edição 3 — `src/slash/builders/`

`public.js`, `admin.js` ou `economy.js`, no mesmo grupo do handler:

```js
new SlashCommandBuilder()
  .setName('exemplo')
  .setDescription('Explica o que faz, em pt-BR')
  .addUserOption(o => o.setName('usuario').setDescription('De quem').setRequired(true)),
```

O `name` tem que ser **idêntico** à chave em `commands` — é assim que o router acha o handler.
Descrição é obrigatória e vai até 100 caracteres. A ordem das opções vira a ordem de `args` no
caminho prefixo. Limite de 100 slash commands por guild.

## Depois

Rode a checagem — ela confirma as três edições de uma vez:

```bash
node .claude/skills/checar/check.mjs
```

Se o comando for propositalmente só-prefixo (brincadeira interna, tipo `crz`/`wam`/`bam`), pule a
edição 3 e adicione o nome em `PREFIX_ONLY` no `check.mjs`.

Lembre o usuário que o comando **só aparece no Discord depois de reiniciar o bot**, porque o
registro dos slash commands acontece no `ClientReady` — e que reiniciar hoje também dispara o
lembrete de inativos.
