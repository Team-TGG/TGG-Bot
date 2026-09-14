# Handoff — insígnias e `.profile`

Documento de passagem entre conversas. **Leia inteiro antes de mexer em qualquer coisa das insígnias**:
ele diz o que já existe, o que falta e o que já foi decidido — para não perguntar de novo o que o
usuário já respondeu. O *como funciona* está na seção "Insígnias do `.profile`" do
[CLAUDE.md](../CLAUDE.md); aqui fica o *onde estamos*.

Atualizado em 14/09/2026. **Ao terminar uma fase, atualize este arquivo** — é ele que o próximo chat lê.

## O projeto em uma frase

Um comando `.profile` que gera uma **imagem** com o perfil do membro e uma vitrine de insígnias
conquistadas automaticamente. São 39 insígnias em 4 categorias, a maioria com 5 tiers (Bronze, Prata,
Ouro, Platina, Diamante), algumas únicas.

## Fases

| Fase | O que é | Estado |
| :-- | :-- | :-- |
| 1 | Motor: tabelas, catálogo, leitura, cálculo, cron 04:00, contadores | **pronta, na VM** |
| 2 | Cartão em imagem, `.profile`, vitrine, botões, `.limpar-perfil` | **pronta, em teste só com o líder** |
| 3 | Arte das insígnias e insígnias finais (feitas pelo usuário) | não começada |
| 4 | Insígnia Explorador, de login no site (depende do site) | não começada |

## Próximos passos, em ordem

1. **Subir o último commit.** Push, `git pull` na VM e restart. Não precisa de SQL nem de `npm install`.
2. **Conferir a Trégua.** `profile_badge_launches` precisa ter a linha `sem_marcar_topson`; sem ela, o
   contador do Topson não começou (o SQL das duas tabelas tinha que ser rodado antes do deploy).
3. **Quinta 17/09/2026:** conferir se a semana `2026-09-10` apareceu em `weekly_mvp_history` com ~20
   linhas. É a primeira quarta gravando sozinha, pelo cron do MVP.
4. **Investigar a cobertura do cron.** Em 14/09/2026, depois da primeira rodada das 04:00, `profile_badges`
   tinha **140** membros e havia **195** ativos. Não foi investigado: pode ser só quem não tem conta
   vinculada, ou membro ficando de fora. Olhar o log `[Insignias] Recalculated` da VM primeiro.
5. **Nomes finais** — o usuário vai trocar. É só o campo `nome` no catálogo; nunca a `chave`.
6. **Fase 3** — quando a arte chegar (ver abaixo).
7. **Lançamento** — checklist abaixo.
8. **Meados de novembro/2026:** revisar com dado real os cortes da contribuição semanal (base de só 4
   semanas em 09/2026), do Tagarela e da Voz Ativa.
9. **Fase 4** — quando o site gravar o login.

### Checklist do lançamento

O `.profile` está **em teste** (pedido do usuário, 14/09/2026). Para abrir à guilda:

- `config/index.js` → `perfil.channelId` de volta para Comandos (`1437416406038872225`).
- `handleProfile` em `public.js`: trocar `leaderOnly` + a checagem de canal sem isenção por
  `channelOnly(perfilConfig.channelId, ...)`, que isenta staff. As checagens de membro ativo já estão lá.
- Builder `/profile` em `slash/builders/public.js`: tirar o `setDefaultMemberPermissions(Administrator)`.
- Voltar a linha do `.profile` na primeira página do `.help`.
- Trocar o desenho provisório pela arte da fase 3, se ela já existir.

## O que já existe

**Código** (detalhes no CLAUDE.md):

| Arquivo | Papel |
| :-- | :-- |
| [src/services/insigniasCatalogo.js](../src/services/insigniasCatalogo.js) | as 39 insígnias: nome, cortes, o que cada uma mede (`descricao`) |
| [src/services/insigniasLeitura.js](../src/services/insigniasLeitura.js) | lê API v1 e banco, monta o contexto de cada membro |
| [src/services/insigniasMotor.js](../src/services/insigniasMotor.js) | calcula tier e grava — `recalcularInsignias({ discordIds, gravar })` |
| [src/services/insigniasAtividade.js](../src/services/insigniasAtividade.js) | contadores de mensagens, call e marcação do Topson, a cada 5 min, só em produção |
| [src/services/perfilCartao.js](../src/services/perfilCartao.js) | desenha o cartão (só desenho, sem banco nem API) |
| [src/handlers/perfilHandlers.js](../src/handlers/perfilHandlers.js) | dados e cache do cartão, vitrine, botões, lista, sync, limpeza |
| [src/insignias.js](../src/insignias.js) | acesso ao Supabase |
| [docs/sql/insignias.sql](sql/insignias.sql) | SQL de todas as tabelas das insígnias |
| `assets/fonts/` | Montserrat e três Noto de reserva, com as licenças |

**No banco** (todo o SQL já rodado pelo usuário):

- `profile_badges` / `profile_badge_tiers` — estado e histórico de tiers, reescritos às 04:00.
- `weekly_mvp_history` — 594 linhas importadas (22/01 a 03/09/2026); daqui para frente o cron do MVP grava.
- `player_activity` — exportação do Apolo de 13/09/2026 em `*_iniciais`, contador em `*_contadas`.
- `help_usage` — quem já usou o `.help` (Curioso). Só desde 14/09/2026.
- `topson_mentions` e `profile_badge_launches` — contador da Trégua e o dia em que ele começou.
- `profiles` — mensagem, vitrine e último sync de cada membro.

**Validado:** o cálculo bateu com a medição em 183 de 183 membros (13/09/2026). Cartão, vitrine, botões,
lista, sync e `.limpar-perfil` foram testados com interações simuladas e dados reais (14/09/2026), e o
usuário testou no Discord.

**Relatório dos cortes** para a staff:
https://claude.ai/code/artifact/1229cd9a-d1f2-48f3-9157-9b63cb03d842 (privado, do usuário).

**Só na máquina do usuário** (ignorado pelo git): `cache/_medicao/` com os scripts da medição e o
`raw.json` da API de 02/09; `cache/_previa/` com as prévias do cartão e da lista.

## Como a fase 2 ficou

**Cartão** — imagem 1000×420: avatar, nick do jogo, **rank do jogo** (não `users.role`), tempo de guilda,
peak de elo (maior entre 1v1/2v2/3v3, **resolvido pela conta principal** como no `.scan`), mensagem e
vitrine de 8. Montserrat com Noto Sans, Symbols 2 e JP de reserva, porque 12 dos 195 nicks usam caractere
que a Montserrat não tem (só o ࿐ de um nick fica sem desenho). O PNG fica em memória e é redesenhado
quando muda qualquer coisa que ele mostra, ou quando vira o dia.

**Comando** — `.profile`, `.perfil`, `.pf`, `/profile`; aceita menção ou **ID do Discord** (serve para quem
saiu do servidor). Autor e alvo precisam ser membros ativos.

**Botões** — roteados pelo prefixo `perfil_`, sobrevivem a restart e redesenham o cartão no canal:

- **Vitrine** (só o dono): espaço → categoria → insígnia, só as conquistadas; se a escolhida já está noutro
  espaço, as duas trocam. Posicional (espaço vazio é null). Sem escolha, mostra as **8 de maior tier**, e na
  primeira edição essa vitrine automática vira a escolhida.
- **Editar mensagem** (só o dono): modal, até **150** caracteres.
- **Sync** (só o dono): recalcula o membro, cooldown de **15 min** carimbado antes de começar.
- **Todas as insígnias** (qualquer um): abre na aba **Faltando** (o que não está no máximo, da mais perto do
  próximo tier para a mais longe), mais uma aba por categoria. **7 por página.** Cada insígnia em três
  linhas: nome e tier (atual → próximo), **o que é contado** (a `descricao` do catálogo: modo, período, se
  soma as contas) e barra `▰▱` com porcentagem e números sem unidade.

**`.limpar-perfil <@membro|ID>`** — helper para cima: apaga a mensagem, avisa por DM e registra em
log-guilda com o texto removido. Cartões já enviados continuam com a imagem antiga.

**Visual provisório** — bases geradas por código (círculo, quadrado, hexágono, escudo, gema e um selo lilás
para a insígnia única) e a inicial do nome como ícone.

### Fase 3 — arte (do usuário)

6 bases (os 5 tiers e a única), 39 ícones, fundo do cartão e o visual da insígnia bloqueada. **As
insígnias também podem mudar no lançamento, junto com a arte** (aviso do usuário, 14/09/2026): o desenho
de `perfilCartao.js` é provisório e não vale polir. Ícone em **silhueta chapada** (a tintura apaga
sombreado), 256×256 com o desenho nos 200px centrais. As bases precisam ser distinguíveis **em preto e
branco** — prata e platina se confundem pela cor.

## Decisões já tomadas — não pergunte de novo

**Formato:** cartão em imagem, sem emoji no cartão; base + ícone tingido; 5 tiers com esses nomes; 4
categorias (Jogo, Guilda, Discord, Economia); vitrine de 8; cartão horizontal; lista em texto, não imagem.

**Regras gerais:**

- Tudo automático — **nenhuma concessão manual** de insígnia.
- **Nunca** paga TGG Coins.
- Sem aviso ao desbloquear, por enquanto.
- Insígnia **pode ser perdida** (tier cai); `.unwarn` e warn expirado devolvem a Ficha Limpa.
- Contas alt: **soma tudo**, exceto level da conta, que usa o maior.
- Cron diário às 04:00 com a API v1; sync manual com cooldown de 15 min.

**Por insígnia:**

- Tempo de guilda conta a **entrada mais recente**.
- Contribuição usa só dado de **08/2026 em diante**; vitórias semanais usam o histórico inteiro.
- Recordes semanais guardam o **recorde**, não a semana atual.
- Vitórias ranqueadas guardam a **melhor temporada**.
- **Staff conta como MVP** pela regra do cargo: sem ocupar vaga, mas só acima do corte.
- **Dinastia**, **Assíduo** (`.daily`) e **Trégua** valem a **maior** sequência.
- **Completista**: todas no tier máximo, exceto Ficha Limpa e ela mesma, **inclusive as pendentes** — ninguém
  pega até o site gravar o login.
- **Trégua**: dia inteiro de 00:00 a 00:00 sem marcar o Topson, tiers de 1 a 5 dias, **vale para todos**
  (inclusive quem nunca marcou), conta a partir do lançamento e o dia do lançamento conta inteiro. Resposta
  a mensagem dele não é marcação.
- **Cofre** mede todo tipo de ganho, sem excluir tipo nenhum. `vw_tgg_coins_wallet_total` já é a soma das
  entradas, não o saldo.
- **2v2** subconta de propósito: a v1 só devolve dupla com 10+ jogos.
- **VIP** é o item `ROLE` de 5.000 moedas, não os cargos de cor.
- Mensagens e call: exportação do Apolo como base, contador por cima, só membros ativos, travado em dev.
- **Removidas:** Apoiador da comunidade, Alterou o perfil no site, Eventos de ticket, Embalado.

**Cortes** — os valores em vigor estão no catálogo. Mantidos de propósito mesmo com tier alto vazio:
Veterano (level da conta, 5 tiers), Colecionador 15/30/50/70/100, Constante (abre com o tempo), Camaleão 1..5
(abre com cor nova). Definidos pelo usuário: contribuição total 40k/100k/200k/300k/500k; contribuição
semanal 5k/10k/20k/30k/40k; MVP total 2/6/12/18/26; streak de MVP 2/4/6/8/10; Tagarela 500/3k/10k/25k/50k;
Voz Ativa 20/50/100/175/300 h; Assíduo 3/7/30/60/100; Vínculo 1/2/3; Trégua 1..5 dias.

**Fase 2:** vitrine por espaço; mensagem de 150; "todas as insígnias" é o único botão de quem não é dono;
`.limpar-perfil` para helper+ com DM e log; aliases `perfil` e `pf`; em teste só o líder em comandos-staff.

## Para começar um chat novo

Algo como: *"Leia `docs/handoff-insignias.md` e vamos fazer [o passo X / o lançamento / a arte da fase 3]."*
