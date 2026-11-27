# Queue ranqueada

Use `/queue` ou `.queue` para Ranked 1v1 da BRZ. Use `/queue modo:2v2` ou `.queue 2v2` para duplas.
O alias `.fila-ranked` também funciona. O comando é público nos canais de comandos já permitidos
pelo bot; não exige cadastro, staff ou presença do jogador no servidor Discord.

O embed organiza até oito jogadores ou duplas por página, com ELO atual/pico, posição regional,
variação de posição na sessão detectada, partidas da temporada, taxa de vitória e horários da
sessão/atividade. As duplas permanecem juntas. Em 2v2, o cabeçalho distingue quantidade de duplas
e quantidade de jogadores únicos.
O cabeçalho traz a identidade da TGG, status por cor, ELO médio e faixa de ELO dos jogadores
ativos. Cada bloco tem numeração, ícone de patente, indicadores de posição e métricas em
destaque. Última e próxima leitura aparecem em colunas separadas; os controles também têm ícones.
A miniatura usa a imagem fornecida pela liderança em `assets/queue/ranked-mascot.png`, enviada
como anexo do próprio Discord. O anexo é preservado durante a navegação e a troca de modalidade.

Os botões permitem navegar, alternar 1v1/2v2 e atualizar a lista. Os controles pertencem a quem
abriu o comando e são desativados ao expirar. **Atualizar lista** lê o retrato mais recente do
monitor; clicar várias vezes não faz novas chamadas à API.

## O que significa atividade

A lista é uma **estimativa por partidas recentes**, não uma confirmação de que o jogador apertou
o botão de buscar partida naquele instante. O monitor consulta as primeiras dez páginas (até
500 entradas) do ranking BRZ de cada modalidade a cada cinco minutos. Só entra na lista quem
teve aumento no contador de partidas entre duas leituras válidas; a atividade expira após dez
minutos sem novo aumento. Mudança de ELO ou de posição, isoladamente, não confirma atividade.

A primeira leitura cria a base; a primeira lista confirmada depende de uma segunda leitura com
novas partidas. Um jogador novo no ranking também precisa de comparação. Depois de uma lacuna
maior que dez minutos ou de um reset no contador de partidas, o monitor estabelece nova base.
Isso evita apresentar partidas antigas como atividade atual após um reinício longo.

O monitor cobre o ranking regional, incluindo jogadores de fora da TGG. Quem está fora das
primeiras dez páginas pode estar jogando sem aparecer. Os horários exibidos são os momentos
em que o monitor detectou as alterações; a sessão é preservada enquanto há atividade contínua.

## Fontes e operação

A fonte são os rankings v0 do Brawlhalla, com a `BRAWLHALLA_API_KEY` já usada no bot:
`/rankings/1v1/brz/PAGINA` e `/rankings/2v2/brz/PAGINA`. A fila não depende de Guild Points da v1
nem de permissões de Presence Intent no Discord. Referências:

- [Brawlhalla — Rankings](https://dev.brawlhalla.com/v0/endpoints/rankings/).
- [Monitor público do Raybot](https://github.com/Saorax/raybot-queue/blob/main/start.ts), referência
  para detectar atividade pelo aumento de partidas. A implementação da TGG é independente.

São até 20 consultas por ciclo, normalmente 60 em 15 minutos, compartilhando o cliente HTTP
com os demais comandos. As chamadas v0 são espaçadas em pelo menos 500 ms para evitar rajadas
que a API rejeita com HTTP 429. Consultas de segundo plano são adiadas quando restam 60 chamadas v0
na janela, preservando esse saldo para comandos e outras rotinas. Falha em qualquer página
preserva o retrato inteiro daquela modalidade e aparece como leitura atrasada/indisponível;
não vira uma lista vazia confirmada. A outra modalidade pode continuar atualizando.

Estado em `data/ranked-queue.json`, independente de `data/sorteios.json` e ignorado pelo Git.
Escrita atômica, arquivo `0600` no Linux e um processo PM2 do bot. Preserve `data/` no deploy.
O monitor inicia somente em produção, sem enviar mensagens ou abrir embeds por conta própria.
No modo dev, o comando só lê o cache existente. Não há migração SQL nem nova dependência.

Arquivos: `rankedQueueService.js` calcula as sessões, `rankedQueueRuntime.js` consulta e agenda,
`rankedQueueStore.js` persiste, `queueHandlers.js` recebe os comandos e `queueViews.js` monta
os embeds. Verificação offline: `node --test test/rankedQueue.test.mjs test/queueIntegration.test.mjs test/brawlhallaHttp.test.mjs`.
