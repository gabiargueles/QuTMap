@echo off
chcp 65001 >nul
title QuTMap — Extrator Nativo de Mapas (.scs / .zip)
cd /d "%~dp0"
set NODE_CMD=node
if exist "%~dp0bin\node.exe" set NODE_CMD="%~dp0bin\node.exe"
if exist "%~dp0node.exe" set NODE_CMD="%~dp0node.exe"

echo Extraindo mapas diretamente dos arquivos .scs do ETS2, Mapa RBR e ATS...
%NODE_CMD% "%~dp0extractor.mjs"
echo.
echo Mapas atualizados com sucesso!
pause
