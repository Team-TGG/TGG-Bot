# IA local: Qwen 4B e Lady Vera

O `.ia` pode usar `IA_PROVIDER=ollama`. O modelo seleciona uma consulta do catálogo existente;
os executores do bot continuam buscando os dados. A segunda chamada escreve a resposta no tom
da Lady Vera: sábia, altiva e ligada à luz, com ironia leve de mentora. Números, nomes, unidades,
previsões e ressalvas continuam vindo dos registros do bot.

A personalidade fica apenas na redação, separada das instruções que escolhem a consulta.
`GEMINI_API_KEY` não é usada nesse modo. Gemini continua disponível como provedor alternativo
por configuração, sem troca automática quando o PC estiver indisponível.

## Configuração

No `.env` do bot na VPS:

```dotenv
IA_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_BASE_URL=http://127.0.0.1:11435
IA_TIMEOUT_MS=60000
```

Para executar as chamadas do modelo no próprio PC, use `http://127.0.0.1:11434`.
O timeout pode ser configurado entre 1.000 e 120.000 ms. O roteamento usa `think: false`; a redação
usa raciocínio com até 4.096 tokens, sem expor esse pensamento ao Discord. As chamadas usam
contexto de 8.192 tokens, sem streaming, e mantêm o modelo carregado por dez minutos após o uso.

## Ativação manual

A integração fica preparada no bot e a conexão permanece desligada até o operador ativá-la.
Os atalhos **Ativar IA TGG** e **Desativar IA TGG**, na Área de Trabalho, controlam somente a
conexão da IA. O bot continua online durante os dois estados e não precisa reiniciar a cada uso.
Com a conexão desligada, `.ia` avisa que Lady Vera está em repouso. Não há início automático
no Windows na instalação manual.

## Conexão do PC à VPS

O bot permanece na VPS. Um túnel SSH reverso encaminha `127.0.0.1:11435` na VPS para
`127.0.0.1:11434` no PC. O listener remoto é restrito ao loopback da VPS.

Para instalar os atalhos sem ativar a conexão, execute no PC:

```powershell
.\tools\Install-OllamaTunnel.ps1 -IdentityFile 'C:\caminho\chave-ssh.key'
```

O destino padrão é `ubuntu@147.15.3.187`. `-SshTarget usuario@servidor` permite outro destino.
A instalação copia os scripts para `%LOCALAPPDATA%\TGG-Bot` e cria os dois atalhos da Área de
Trabalho. O atalho de ativar inicia o worker em segundo plano; o de desativar encerra apenas
esse worker e seu SSH, preservando o Ollama para outros usos. `-StartNow` inicia logo após
instalar. `-AutoStart` é opcional e só deve ser usado com início no Windows autorizado.
O worker tenta reconectar após
interrupções e inicia o Ollama local quando necessário. A chave original permanece no caminho
informado; o SSH usa uma cópia temporária com ACL restrita ao usuário atual.

Estado e logs ficam em `%LOCALAPPDATA%\TGG-Bot\ollama-tunnel-state.json` e
`ollama-tunnel.log`. A desativação verifica os processos antes de encerrá-los e remove somente
a cópia temporária da chave, em sua pasta temporária. A instalação sem `-AutoStart` remove o
atalho de início automático do próprio TGG, caso exista.

## Verificação

`npm test` verifica os provedores com HTTP simulado, incluindo argumentos inválidos, falha do
PC e compatibilidade do Gemini. `node .claude/skills/checar/perguntas.mjs` usa o modelo
configurado de verdade para testar o catálogo e a redação com dados fictícios; não inicia o bot.
Em Ollama ele não aplica os cinco segundos de intervalo exigidos pelo free tier do Gemini.

O roteamento aceita uma única função conhecida, com argumentos compatíveis com o catálogo.
Se o modelo não fornecer uma chamada válida, uma tentativa com JSON Schema força a escolha
estruturada. Uma saída ainda inválida não executa consulta alguma. O resultado chega à redação
como mensagem de ferramenta, e a saída de pensamento não é enviada ao Discord.

## Referências

- [Modelo Qwen3.5 4B](https://ollama.com/library/qwen3.5:4b)
- [Ollama: chamadas de ferramentas](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama: saídas estruturadas](https://docs.ollama.com/capabilities/structured-outputs)
- [Lady Vera: lore oficial](https://www.brawlhalla.com/legends/lady-vera)
