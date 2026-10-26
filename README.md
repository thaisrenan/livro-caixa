# Livro-Caixa

Controle pessoal de receitas, despesas, gastos divididos e reserva de emergência.
App instalável (PWA) que roda no GitHub Pages, com dados sincronizados pelo Supabase.

## Como os dados ficam protegidos

- Na primeira vez, o app gera uma chave aleatória de 256 bits. Ela fica só nos seus aparelhos,
  guardada com o PIN de 4 dígitos.
- Tudo é criptografado no aparelho (AES-GCM) antes de ir para o Supabase. O servidor e este
  repositório nunca veem os lançamentos.
- O banco só aceita as funções `lc_get` e `lc_put`, que exigem o identificador e o token do cofre,
  ambos derivados da chave.
- Para conectar outro aparelho: Configurações → Conectar outro aparelho (QR code ou link).
- O código de recuperação mostrado na primeira vez é a única forma de recuperar os dados se
  todos os aparelhos forem perdidos.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html` | O app |
| `vault.js` | PIN, criptografia e sincronização |
| `importer.js` | Importação da planilha de controle financeiro |
| `config.js` | Endereço e chave pública do Supabase |
| `supabase.sql` | Tabelas e funções do banco (rodar uma vez no SQL Editor) |
| `sw.js`, `manifest.webmanifest`, ícones | Instalação no celular e uso sem internet |
| `qrcode.js` | Gerador de QR code (Kazuhiko Arase, licença MIT) |

## Publicar

1. No Supabase, rode `supabase.sql` no SQL Editor.
2. Preencha `config.js` com a Project URL e a chave `anon` (Project Settings → API).
3. No GitHub, Settings → Pages → Deploy from a branch → `main` / `(root)`.
