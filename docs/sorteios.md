# Sorteios da TGG

Use `.sorteio` ou `/sorteio`. Criação e gerenciamento exigem Assistant, Helper ou superior,
ou um administrador já autorizado no bot. A participação é pelo botão da mensagem publicada.
Aliases: `.sorteios`, `.giveaway` e `.raffle`.

## Criar e revisar

`/sorteio` abre o formulário; `.sorteio` mostra um exemplo de embed com o botão para preenchê-lo.
O formulário pede prêmio/título, descrição/regras, quantidade de vencedores, duração e público.
Exemplos nos campos mostram como preencher. Ao enviar, aparece uma prévia real do embed; a
mensagem pública só é enviada quando o organizador clica em **Publicar sorteio**.

Na prévia, é possível:

- Editar os dados principais, preservando o que já foi preenchido.
- Abrir **Duração e aparência** para informar dias, horas e minutos separados, cor hexadecimal e
  uma imagem por URL HTTPS.
- Escolher outro canal de texto ou anúncios pelo seletor **Alterar canal**.
- Descartar a prévia sem publicar nada.

O Discord não envia eventos a cada tecla do formulário. Por isso a prévia é atualizada após
**Enviar**; o organizador pode editar e revisar quantas vezes precisar antes de publicar.
O canal também pode ser escolhido na opção `canal` do slash ou em `.sorteio criar #canal`.

## Público e participação

- **Somente membros ativos da TGG:** exige cadastro `users.active = true` com `brawlhalla_id`.
- **Todos do servidor:** aceita visitantes e membros, sem exigir cadastro no bot.

Nos dois modos, a pessoa precisa estar no servidor e não pode ser bot. Há uma participação por
ID do Discord; clicar várias vezes não aumenta as chances. O botão **Sair do sorteio** permite
retirar a participação enquanto ele estiver aberto. As confirmações de entrada/saída são privadas.
O organizador participa pelas mesmas regras, sem chances extras.

No encerramento, o bot confere novamente quem ainda está no servidor e, no modo exclusivo,
quem continua ativo no cadastro. Se Discord ou banco estiver indisponível, a apuração aguarda
uma nova tentativa; não transforma erro de consulta em uma lista vazia de participantes.

## Encerramento e gerenciamento

O relógio considera a duração a partir da confirmação de publicação. O agendador verifica os
sorteios a cada 10 segundos. Vencedores são escolhidos com `crypto.randomInt`, sem reposição,
e o resultado é salvo antes de atualizar a mensagem. O embed original passa a mostrar os vencedores
e os botões de participação ficam desativados. Não há DM automática nem cobrança para participar.
O organizador é responsável pela entrega do prêmio; o comando não debita nem concede TGG Coins.

Use `/sorteio acao:Listar sorteios` ou `.sorteio listar` para abrir a lista e selecionar um sorteio.
Use `pagina` no slash ou `.sorteio listar 2` para outra página (25 itens por página).
Para abrir diretamente, use `/sorteio acao:Gerenciar sorteio id:...` ou `.sorteio gerenciar ID`.
O identificador pode ser o UUID do rodapé, o ID da mensagem ou seu link completo.

O painel permite **Encerrar agora**, **Cancelar sorteio** e **Sortear novamente**. Essas ações
exigem confirmação, vinculada à pessoa que a abriu, e uma nova checagem de staff em cada clique.
Cancelar encerra sem novos vencedores; sortear novamente exclui todos os vencedores das rodadas
anteriores e preserva o histórico. Se não restar ninguém elegível, o resultado anterior é mantido.

Se houver menos pessoas elegíveis que o número escolhido, todas as restantes ganham. Sem
participantes elegíveis na primeira rodada, o sorteio encerra sem inventar um vencedor.

## Persistência e operação

Estado privado em `data/sorteios.json`, ignorado pelo Git. O diretório é criado com modo `0700`
e o arquivo com `0600` no Linux. As transações são serializadas; a escrita usa arquivo temporário,
`fsync` e troca atômica. Arquivo inválido não é substituído por um vazio.

Mantenha **um processo PM2** do bot, conforme a regra do projeto. Preserve `data/` nos deploys e
inclua o diretório nos backups da VPS. Não copie dados reais para testes nem comite esse arquivo.
Não há migração SQL nova: o modo TGG consulta o cadastro já existente no Supabase.

No boot de produção, o agendador retoma sorteios vencidos e apurações pendentes. Falhas de edição
da mensagem são tentadas novamente após 60 segundos, com os mesmos vencedores. Botões não dependem
de collectors, então continuam válidos depois de reiniciar o processo. O modo dev não inicia esse
agendador; comandos manuais continuam sendo ações reais, como os demais comandos do bot.

Se houver uma queda entre enviar a mensagem e salvar seu ID, a publicação fica pendente. O bot
procura a mensagem entre as 100 mais recentes sem republicá-la. Se ela estiver fora desse intervalo,
a staff pode informar o link completo em **Gerenciar sorteio** para recuperar o vínculo. O bot
confere autor, servidor, canal e identificador dos botões antes de aceitar a mensagem.

Limites: duração de 1 minuto a 30 dias; 1 a 20 vencedores; até 5000 participantes por sorteio e
20 sorteios simultâneos por servidor. Prévias expiram após 2 horas. O idioma da prévia e do anúncio
segue o idioma do organizador; respostas privadas seguem os cargos de idioma de quem interage.

Verificações: `node --test test/sorteios*.test.mjs` e `node .claude/skills/checar/check.mjs`.
Referência do formulário nativo: [Discord — Modal Components](https://docs.discord.com/developers/components/using-modal-components).
