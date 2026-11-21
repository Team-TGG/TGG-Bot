# IA na VPS com OpenAI

O provedor `openai` mantém a conversa livre, a personalidade da Lady Vera e as consultas da guilda.
Ele usa a Responses API, com `gpt-6-luna` como modelo padrão e raciocínio `none`.
A VPS chama a API diretamente; o PC e o túnel do Ollama não são necessários nesse modo.

## Arquivo para preencher

O arquivo local `.env.openai.local`, na raiz do repositório, está ignorado pelo Git. Preencha
somente `OPENAI_API_KEY=` e salve. O restante já está preparado:

```dotenv
IA_PROVIDER=openai
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=none
IA_TIMEOUT_MS=60000
```

Esse arquivo é separado da configuração de Discord, Supabase e Brawlhalla. Depois de preenchido,
suas variáveis devem ser aplicadas ao `.env` da VPS e o bot reiniciado. Não substitua o `.env`
inteiro por esse arquivo: as configurações dos outros serviços precisam permanecer.

Editar o arquivo local não troca o provedor do bot em produção. A ativação depende da chave válida
e da publicação das variáveis na VPS. Depois disso, o comando fica disponível 24/7 enquanto o
processo PM2 e o serviço da API estiverem disponíveis, sem precisar manter o PC ligado.

## Comportamento

Todos os membros do servidor podem usar `.ia`, seus aliases e `/ia`, somente no canal
`1437416406038872225`. A regra de canal vale também para staff e admins e é conferida antes
de consultar o filtro, a IA ou os dados do jogo. As regras gerais de canal/cooldown do bot continuam.
Consultas pessoais usam o cadastro do membro quando ele existe.

Perguntas e respostas completas passam por moderação SFW e verificação contextual das diretrizes
do Discord. Títulos, nomes, campos de perfis e rodapés também são examinados antes da publicação.
Se a validação falhar ou o serviço ficar indisponível, o conteúdo não é publicado. O filtro usa
`OPENAI_API_KEY` também quando a geração usa outro provedor. Veja [a política de conteúdo](ia-content-policy.md).

Perguntas como `.ia quem é o Trinca Ferro?`, `.ia qual o elo do Trinca Ferro?` ou
`.ia qual lenda o Trinca Ferro mais joga?` usam `perfil_de_jogador`.
O perfil mostra nível, partidas e vitórias totais, ranked 1v1, a dupla 2v2 de maior elo e
as três lendas mais jogadas. A consulta usa as rotas da API antiga e não depende dos Guild Points.
Também aceita uma menção ao Discord ou um ID explícito do Brawlhalla; a menção e "meu perfil"
usam o ID cadastrado. O perfil é da conta encontrada, sem trocar por uma conta alternativa.

A busca prioriza os apelidos da guilda e, se não encontrar, consulta a primeira página da busca
pública por nome do ranking 1v1. Nomes sem ranking podem não aparecer nessa busca; nesse caso,
informe o ID do Brawlhalla. Nomes ambíguos pedem uma identificação mais específica. A IA recebe
somente o resumo do perfil, sem os IDs do cadastro, e não inventa uma biografia do jogador.

A chave vai apenas no cabeçalho de autorização da API. Erros no comando exibem mensagens
genéricas, sem repetir o corpo da resposta ou a chave. As chamadas à Responses API usam `store: false`.
O roteamento permite uma função conhecida por vez e valida seus argumentos. A redação recebe
o resultado vinculado ao `call_id`, incluindo o estado retornado pelo modelo quando necessário.
Perguntas gerais usam o modo de conversa, sem fabricar uma consulta aos dados da guilda.

O limite é de 1.024 tokens de saída no roteamento e 2.048 na redação. O filtro faz chamadas
adicionais de moderação e classificação, com limite de 256 tokens por decisão estruturada.
`OPENAI_REASONING_EFFORT`
pode ser alterado para uma opção suportada pelo modelo, mas `none` é a configuração preparada.

Referências: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) e
[function calling](https://developers.openai.com/api/docs/guides/function-calling).

Rotas do Brawlhalla: [busca por nome](https://dev.brawlhalla.com/v0/endpoints/rankings/),
[estatísticas](https://dev.brawlhalla.com/v0/endpoints/playerstats/) e
[ranked](https://dev.brawlhalla.com/v0/endpoints/playerrankedstats/).
