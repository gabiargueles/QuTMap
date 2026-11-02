@echo off
chcp 65001 >nul
title TruckMap — Extrator Nativo de Mapas (.scs / .zip)
cd /d "C:\Claude\Projetos\TruckMap"
echo Extraindo mapas diretamente dos arquivos .scs do ETS2, Mapa RBR e ATS...
node "C:\Claude\Projetos\TruckMap\extractor.mjs"
echo.
echo Mapas atualizados com sucesso!
pause
