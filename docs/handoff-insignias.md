# Handoff — insígnias e `.profile`

Documento de passagem entre conversas. **Leia inteiro antes de mexer em qualquer coisa das insígnias**:
ele diz o que já existe, o que falta e o que já foi decidido — para não perguntar de novo o que o
usuário já respondeu. O *como funciona* está na seção "Insígnias do `.profile`" do
[CLAUDE.md](../CLAUDE.md); aqui fica o *onde estamos*.

Atualizado em 13/09/2026. **Ao terminar uma fase, atualize este arquivo** — é ele que o próximo chat lê.

## O projeto em uma frase

Um comando `.profile`, só para membros da guilda, que gera uma **imagem** com o perfil do membro e uma
vitrine de insígnias conquistadas automaticamente. São 39 insígnias em 4 categorias, a maioria com 5
tiers (Bronze, Prata, Ouro, Platina, Diamante).

## Fases

| Fase | O que é | Estado |
| :-- | :-- | :-- |
| 1 | Motor: tabelas, catálogo, leitura, cálculo, cron 04:00, contador de mensagens/call | **pronta, na VM** |
| 2 | Cartão em imagem, comando `.profile`, vitrine, botões | não começada |
| 3 | Arte das insígnias (feita pelo usuário) | não começada |
| 4 | Insígnia de login no site (depende do site) | não começada |

## O que já existe

**Código** (detalhes no CLAUDE.md):

| Arquivo | Papel |
| :-- | :-- |
| [src/services/insigniasCatalogo.js](../src/services/insigniasCatalogo.js) | as 39 insígnias: nome, cortes, o que cada uma mede |
| [src/services/insigniasLeitura.js](../src/services/insigniasLeitura.js) | lê API v1 e banco, monta o contexto de cada membro |
| [src/services/insigniasMotor.js](../src/services/insigniasMotor.js) | calcula tier e grava — `recalcularInsignias({ discordIds, gravar })` |
| [src/services/insigniasAtividade.js](../src/services/insigniasAtividade.js) | contador de mensagens e call, grava a cada 5 min, só em produção |
| [src/insignias.js](../src/insignias.js) | acesso ao Supabase |
| [docs/sql/insignias.sql](sql/insignias.sql) | SQL das 5 tabelas |

**No banco** (SQL já rodado pelo usuário em 13/09/2026):

- `weekly_mvp_history` — 594 linhas, 33 semanas de 22/01 a 03/09/2026, importadas à mão.
- `player_activity` — 194 membros, exportação do Apolo feita em 13/09/2026 nas colunas `*_iniciais`.
- `profile_badges` / `profile_badge_tiers` — **só um membro gravado** (teste). O resto entra na primeira
  rodada do cron depois do deploy.
- `profiles` — vazia; é da fase 2.

**Validado em 13/09/2026:** o cálculo bateu com a medição em 183 de 183 membros; a leitura ao vivo pegou
226 de 226 contas; a gravação não duplica; o contador não apaga o número do Apolo.

**Relatório dos cortes** para a staff:
https://claude.ai/code/artifact/1229cd9a-d1f2-48f3-9157-9b63cb03d842 (privado, do usuário).

**Scripts da medição** ficam em `cache/_medicao/` — ignorado pelo git, **só existe na máquina do
usuário**. O `raw.json` de lá guarda as respostas da API de 02/09 e permite validar o motor sem a API.

## O que falta, em ordem

1. ~~Deploy da fase 1~~ — feito (confirmado pelo usuário em 14/09/2026).
2. ~~MVP da quarta gravar em `weekly_mvp_history`~~ — feito em 14/09/2026 (`gravarMvpsDaSemana`).
   **Precisa estar na VM antes de quarta 16/09/2026 06:00.** Na quinta 17/09, conferir se a semana
   `2026-09-10` apareceu na tabela com ~20 linhas.
3. **Contador do Topson** (insígnia Trégua) — escutar menção ao usuário Topson. Vale para todos, inclusive
   quem nunca marcou (decisão 12).
4. ~~Contador do `.help`~~ — feito em 14/09/2026 (`registrarUsoDoHelp`, tabela `help_usage`).
   **O usuário precisa rodar o SQL da `help_usage`** em [docs/sql/insignias.sql](sql/insignias.sql).
5. **Fase 2** — ver seção abaixo.
6. **Revisar cortes com dado real** depois de algumas noites de cron: as insígnias de ranked convergem ao
   longo das noites, e o recorde de contribuição semanal tem só 4 semanas de base (revisar em ~60 dias).

### Fase 2 — o que precisa ter

- `.profile` (e `.profile @membro`): três edições do padrão do repo (handler, `commands.js`, builder).
- Só membro com `active = true`; pode ver o perfil de outro membro ativo; quem não tem cadastro recebe erro.
- Só no canal `1437416406038872225`, staff isenta.
- **Imagem**, não embed, gerada com `@napi-rs/canvas` e uma fonte `.ttf` no repo (livre, ex.: Google Fonts).
- Cartão: foto de perfil, mensagem customizada, nick no jogo, cargo/rank na guilda, tempo de guilda, peak
  elo (maior entre os modos) e a vitrine.
- Vitrine de **8** insígnias escolhidas pelo membro; escolha por select de categoria → select de insígnia
  (o select do Discord aceita 25 opções).
- Insígnia desenhada como **base** (forma e cor mudam com o tier) + **ícone cinza tingido** na cor do tier.
  Até a arte existir: bases geradas por código e a inicial do nome como ícone.
- Botão **todas as insígnias**: efêmero, desbloqueadas e bloqueadas, com progresso e como desbloquear.
- Botão **sync**: recalcula só o membro (`recalcularInsignias({ discordIds: [id] })`), cooldown de 15 min
  gravado em `profiles.ultimo_sync_em`.
- Botão **editar perfil**: modal com a mensagem customizada.
- Comando de staff para apagar mensagem imprópria. Sem filtro automático.
- Cache da imagem por membro, invalidado quando o tier muda.

### Fase 3 — arte (do usuário)

5 bases, 40 ícones, fundo do cartão e o visual da insígnia bloqueada. Ícone em **silhueta chapada**
(a tintura apaga sombreado), 256×256 com o desenho nos 200px centrais. As 5 bases precisam ser
distinguíveis **em preto e branco** — prata e platina se confundem pela cor.

## Decisões em aberto

Os números saíram da medição de 13/09/2026 sobre os membros ativos.

1. ~~Level da conta~~ — **manter os 5 tiers** (14/09/2026).
2. ~~Conquistas concluídas~~ — **manter 15/30/50/70/100** (14/09/2026).
3. ~~Semanas sem inativar~~ — **aceitar**: os tiers altos abrem com o tempo (14/09/2026).
4. ~~TGG Coins~~ — **todo tipo de ganho, sem excluir tipo nenhum** (14/09/2026). A pergunta partia de
   premissa errada: `vw_tgg_coins_wallet_total` já é a soma das entradas, não o saldo, então o Cofre já
   media isso. Cortes e distribuição continuam os do relatório.
5. ~~Streak do `.daily`~~ — **maior sequência**, `recorde` (14/09/2026).
6. ~~Ficha Limpa~~ — **manter como está** (14/09/2026).
7. ~~Cores de evento~~ — **manter 1..5**; abrem com cor nova (14/09/2026).
8. ~~Contas vinculadas~~ — **3 tiers (1/2/3)** (14/09/2026).
9. ~~Contribuição semanal~~ — **publicar e revisar em meados de novembro/2026** (14/09/2026).
10. ~~Completista~~ — **conta todas, inclusive pendentes**: ninguém pega até o site gravar o login (14/09/2026).
11. ~~Vitórias ranked~~ — **melhor temporada**, como já está (14/09/2026).
12. ~~Topson~~ — **vale para todos**, inclusive quem nunca marcou (14/09/2026).
13. ~~Lista das insígnias~~ — **texto** (embed paginado); imagem só no cartão (14/09/2026).
14. **Nomes finais** — o usuário está revisando. Mudar é só editar `nome` no catálogo; nunca a `chave`.
15. ~~Embalado~~ — **removido** do catálogo; ficam 39 insígnias (14/09/2026).
16. ~~Tagarela e Voz Ativa~~ — cortes novos do usuário (14/09/2026): Tagarela 500/3k/10k/25k/50k
    (39/14/9/8/6 membros por tier); Voz Ativa 20/50/100/175/300 h (28/19/10/8/13, o Diamante ainda
    passa a Platina, aceito).

## Decisões já tomadas — não pergunte de novo

**Formato:** perfil em imagem, sem emoji nenhum; base + ícone tingido; 5 tiers com esses nomes; 4
categorias (Jogo, Guilda, Discord, Economia); vitrine de 8.

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
- **Staff conta como MVP** pela regra do cargo: sem ocupar vaga, mas só acima do corte.
- **Dinastia** conta a **maior** sequência de semanas como MVP.
- **Completista**: todas no tier máximo, exceto Ficha Limpa e ela mesma.
- **Topson**: por pessoa, dia inteiro de 00:00 a 00:00 sem marcar, tiers de 1 a 5 dias, conta só a
  partir do lançamento, e resposta a mensagem dele não conta como marcação.
- **2v2** subconta de propósito: a v1 só devolve dupla com 10+ jogos.
- **VIP** é o item `ROLE` de 5.000 moedas, não os cargos de cor.
- Mensagens e call: exportação do Apolo como base, contador por cima, só membros ativos, travado em dev.
- Removidas: Apoiador da comunidade, Alterou o perfil no site, Eventos de ticket.

**Cortes definidos pelo usuário** (o resto veio da medição): contribuição total 40k/100k/200k/300k/500k;
contribuição semanal 5k/10k/20k/30k/40k; MVP total 2/6/12/18/26; streak de MVP 2/4/6/8/10; mensagens
500/3k/10k/25k/50k; call 20/50/100/175/300 h; streak do daily 3/7/30/60/100; conquistas 15/30/50/70/100;
cores de evento 1..5; Topson 1..5 dias. Os valores em vigor estão no catálogo.

## Para começar um chat novo

Algo como: *"Leia `docs/handoff-insignias.md` e vamos fazer [o item X / a fase 2]."*
