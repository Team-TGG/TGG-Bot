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

Todos os membros do servidor podem usar `.ia` e `/ia`, sem cargo de administrador ou cadastro
prévio no bot. As regras de canal e o intervalo geral de 5 segundos para quem não é staff continuam
valendo. Consultas pessoais usam o cadastro do membro quando ele existe.

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

A chave vai apenas no cabeçalho de autorização da API. Os erros exibem o provedor e o código
HTTP, sem repetir o corpo da resposta ou a chave. As chamadas usam `store: false`.
O roteamento permite uma função conhecida por vez e valida seus argumentos. A redação recebe
o resultado vinculado ao `call_id`, incluindo o estado retornado pelo modelo quando necessário.
Perguntas gerais usam o modo de conversa, sem fabricar uma consulta aos dados da guilda.

O limite é de 1.024 tokens de saída no roteamento e 2.048 na redação. `OPENAI_REASONING_EFFORT`
pode ser alterado para uma opção suportada pelo modelo, mas `none` é a configuração preparada.

Referências: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) e
[function calling](https://developers.openai.com/api/docs/guides/function-calling).

Rotas do Brawlhalla: [busca por nome](https://dev.brawlhalla.com/v0/endpoints/rankings/),
[estatísticas](https://dev.brawlhalla.com/v0/endpoints/playerstats/) e
[ranked](https://dev.brawlhalla.com/v0/endpoints/playerrankedstats/).
