# QuTMap — ETS2 (Mapa RBR + Europa) & ATS

Navegador GPS em tempo real para **Euro Truck Simulator 2** (com suporte nativo ao **Mapa RBR — Brasil** e Europa) e **American Truck Simulator**, projetado para rodar na **2ª tela do PC** (`http://127.0.0.1:8765`) e no **Tablet / Celular** (`http://<IP-DO-PC>:8765`).

## ✨ Diferenciais

- **Alinhamento 100% Exato (`0.00m` de erro):** Extrai a malha viária diretamente dos arquivos `.scs` (`SCS#` HashFS v1/v2) e `.zip` instalados no computador (`.base` v905–907 e `.ppd` v19–25). A linha vermelha do GPS usa exatamente os mesmos vértices das estradas e alças de trevos renderizadas na tela.
- **Visão Plana 2D e Visão 3D GPS:** Alternância com 1 toque entre `Plana (Norte Fixo)`, `Plana (Siga o Caminhão)` e `3D (GPS Inclinado)`.
- **Unidades Brasileiras por Padrão (`km/h`, `km` e `kg`):** Velocímetro, placas de limite, distâncias e peso da carga sempre em `km/h` e `kg` (mesmo no ATS), com botão rápido caso queira alternar.
- **100% Automático (Zero Clique):**
  - Inicia e conecta sozinho ao `TruckNavTelemetry.exe` (`ws://127.0.0.1:30001`).
  - Traça rota automaticamente para a **empresa de coleta** (`INDO COLETAR`) enquanto a carga não foi carregada, e muda sozinho para a **empresa de destino** (`EM ENTREGA`) ao engatar — funcionando mesmo após recarregar o save no meio de uma entrega (`onJob: false`).
  - Lê automaticamente os pontos marcados à mão no mapa do jogo descriptografando o save mais recente (`ScsC` AES-256-CBC + `BSII` / `SiiNunit`).
  - Recálculo automático em `< 15ms` ao errar uma saída (`> 26m` de desvio), priorizando o sentido de marcha para evitar retornos na contramão.

## 📦 Instalação (Releases)

Na aba **[Releases](../../releases)** estão disponíveis:
1. **`QuTMap-Instalador.exe`**: Instalador gráfico do Windows que configura a pasta do aplicativo, cria atalhos na Área de Trabalho e no Menu Iniciar, registra a inicialização automática na bandeja do Windows, instala o plugin `scs-telemetry.dll` no ETS2 e ATS, **libera automaticamente a porta `8765` no Firewall do Windows** e extrai os mapas `.scs`.
2. **`QuTMap-Portatil.zip`**: Versão portátil completa já com os mapas extraídos (`ets2_rbr`, `ats` e `ets2_europe`). Basta extrair e executar `QuTMap.exe` (que também verifica e libera automaticamente a porta `8765` no Firewall).
<img width="1917" height="1079" alt="image" src="https://github.com/user-attachments/assets/b026a94b-3cf7-434d-bf62-5910ee90a592" />
