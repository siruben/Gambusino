# Caçador de Gambusinos

Jogo web (HTML/CSS/JS, PWA) em que apanhas gambusinos com a luz da lanterna numa mina às escuras.

## Como jogar
- Liga a **lanterna** e inclina o telemóvel (giroscópio) para apontar o feixe. Sem giroscópio, o feixe varre o ecrã sozinho.
- Carrega no botão de **disparo** para abater os gambusinos iluminados.
- Cada nível tem um número de gambusinos a apanhar. Se deixares fugir **7 num nível**, o jogo acaba; o contador volta a zero a cada nível.
- Os combos multiplicam os pontos (até x5). Os raros precisam de 3 tiros.
- Power-ups: Multi-Tiro, Câmara Lenta, Super Tiro.
- 30 níveis; o último é o boss. O recorde fica guardado no dispositivo.
- Com a lanterna desligada (ou em pausa) o jogo fica parado.

## Ficheiros
| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura e ecrãs |
| `style.css` | Aspeto |
| `script.js` | Lógica do jogo |
| `sw.js` | Service worker (offline). **Mudar `CACHE` a cada versão** |
| `manifest.json` | PWA |

## Afinação
Tudo o que mexe na dificuldade está no topo de `script.js` (`GAMEPLAY TUNING`) e em `getLevelConfig()`.
`TAP_TO_KILL` liga/desliga matar gambusinos só com um toque (sem usar o botão de disparo).
