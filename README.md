
<p align="center">
  <img src="https://github.com/Team-TGG/TGG-Bot/blob/main/tgg_logo.png?raw=true&" alt="TGG Logo" width="200" style="border-radius: 15px;"/>
</p>

<h1 align="center">TGG-Bot</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord.js"/>
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase"/>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript"/>
</p>

---

### Descrição
O **TGG-Bot** é um serviço especializado para o Discord, projetado para a guilda TGG no Brawlhalla. Ele gerencia a sincronização automática de cargos com base nos ranks e ELO dos jogadores, rastreia a atividade da guilda e fornece estatísticas detalhadas do jogo para os membros.

---

## Principais Funcionalidades

### Sincronização
- **Sincronização de Cargos:** Atualiza automaticamente os cargos no Discord com base nos ranks do Brawlhalla.
- **Sincronização de ELO:** Sincroniza os cargos com base no ELO competitivo.
- **Sincronização de Apelidos:** Alinha os apelidos no Discord com os nomes dos membros da guilda no Brawlhalla.

### Estatísticas e Informações
- **Estatísticas de Jogador:** Estatísticas detalhadas do Brawlhalla para qualquer usuário.
- **Informações do Clã:** Exibe o status atual do clã e a lista de membros.
- **Missões Semanais:** Acompanha e exibe as missões atuais da guilda.
- **Atividade da Guilda:** Registra entradas, saídas e movimentação geral dos membros via API.

### Moderação e Gerenciamento
- **Gerenciamento de Inatividade:** Identifica e marca automaticamente jogadores inativos.
- **Ferramentas de Moderação:** Sistemas integrados de avisos (warn), silenciamento (mute) e banimento.

---

## Comandos

| Comando | Descrição |
| :--- | :--- |
| `.help` | Mostra o menu de ajuda interativo |
| `.stats` | Estatísticas do jogador no Brawlhalla |
| `.missoes` | Lista as missões da semana |
| `.regras` | Exibe as regras da guilda |
| `.sync` | Sincroniza cargos e ELO (Admin) |
| `.sync-nick` | Sincroniza apelidos do clã (Admin) |
| `.active` | Justifica inatividade / Ativa usuário |

---

## Roadmap

### Concluído
- [x] Criar um inventário para as cores usando as cores armazenadas em compras.
- [x] Ao usar `.buy` em uma cor, verificar se o usuário já possui a cor e ajustar o fluxo de compra.
- [x] Mostrar as cores em um embed antes de comprar no `.buy`.
- [x] Fazer warn temporário e mandar mensagem na DM.
- [x] Fazer o bot mandar o MOTD no canal configurado, sem pingar ninguém.
- [x] Sincronizar MOTD com o site (`/api/motd.php`).
- [x] Criar `.edit-warn <@user> [número] "Motivo"`.
- [x] Criar `.crz` como contador geral.
- [x] Basear Coach na lista de instrutores.
- [x] Fazer o preço do Coach variar dependendo do elo.
- [x] Adicionar `.games` mensal/seasonal.
- [x] Adicionar botão para voltar para "essa semana" no `.games`.
- [x] Criar um `.bam` (.ban falso)
- [x] `.bal @user` e `.conquistas @user`para mostrar dados de outro usuário
- [x] Corrigir os emojis Silver 4 e Rupture nas estatísticas.
- [x] Adicionar Aurus às estatísticas de lendas.

### Correções e Ajustes
- [ ] Caso o usuário não tenha registro para a semana, mostrar esse erro no `.conquistas`.
- [ ] `.add-account` deve adicionar registro em `player_weekly_info`.
- [ ] `.entrou` deve adicionar registro em `player_weekly_info`.

### Novos Comandos
- [ ] Criar `.resumão` com um resumo grande e detalhado da guilda.
- [ ] Criar `.scan` com visão de staff sobre um membro: justificativas, jogos da semana atual/passada, histórico de saída da guilda e outros dados relevantes.
- [ ] Criar `.alts`.
- [ ] Adicionar a tabela de warns em um comando do bot, bloqueado em canais que não sejam da staff.
- [ ] Criar `.refund`, restrito ao dono.
- [ ] Criar `.registrarmissão` com dropdown para registrar missão por clique.

### Sistemas e Melhorias
- [ ] Discutir com staff/helpers os preços e o que incluir no Coach.
- [ ] Melhorar a automação do histórico da guilda, deixando mais rápido e criando views para evitar ler muitas linhas.
- [ ] Criação de uma aba no Leaderboard para streaks

### Futuro
- [ ] Comandos slash.
- [ ] Criar um Brawdle.
- [ ] Criar leilões no TGG Coins, com lances para itens pagos ou exclusivos.
- [ ] StarTGG.

---

## Autores

- [@joaopaulofeijao](https://github.com/joaopaulofeijao)
- [@disneyritozx](https://github.com/disneyritozxdev)

---

## Licença

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
