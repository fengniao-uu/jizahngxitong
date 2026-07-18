@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title 智能记账 - 一键启动脚本
echo.
echo  ======================================================
echo   智能记账 / 房东收租管理系统  -  Windows 一键启动
echo  ======================================================
echo.

REM -------- 1. 检查 Python --------
where python >nul 2>nul
if errorlevel 1 (
  echo. [X] 未检测到 Python！请先安装 Python 3.9+，并勾选 "Add Python to PATH"
  echo.    下载地址: https://www.python.org/downloads/
  pause
  exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo  [OK] Python 版本: %PY_VER%

cd /d "%~dp0"

REM -------- 2. 创建/激活虚拟环境 --------
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo  [*] 首次启动，正在创建虚拟环境 .venv ...
  python -m venv .venv
  if errorlevel 1 (
    echo. [X] 创建虚拟环境失败，请检查 Python 安装完整性
    pause
    exit /b 1
  )
  echo  [OK] 虚拟环境创建完成
)

set "VENV_PY=%~dp0.venv\Scripts\python.exe"
set "VENV_PIP=%~dp0.venv\Scripts\pip.exe"

REM -------- 3. 安装依赖（只在缺的时候装） --------
"%VENV_PY%" -c "import flask, flask_cors, jwt, openpyxl, dotenv, PIL, werkzeug" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [*] 正在安装依赖（可能需要 1~5 分钟，首次启动请耐心等待）...
  "%VENV_PIP%" install --disable-pip-version-check -r "backend\requirements.txt"
  if errorlevel 1 (
    echo. [X] 依赖安装失败，请检查网络或手动执行: pip install -r backend\requirements.txt
    pause
    exit /b 1
  )
  echo  [OK] 依赖安装完成
) else (
  echo  [OK] 依赖已就绪
)

REM -------- 4. .env 检查（缺失则从模板复制） --------
set "ENV_SRC=backend\.env.example"
set "ENV_DST=backend\.env"
if not exist "%ENV_DST%" (
  if exist "%ENV_SRC%" (
    copy "%ENV_SRC%" "%ENV_DST%" >nul
    echo  [OK] 已自动从 .env.example 复制生成 backend\.env
  )
)
REM JWT_SECRET 启动时系统会自动生成，无需手动处理

REM -------- 5. 启动 Flask 并打开浏览器 --------
echo.
echo  [*] 正在启动服务（端口 5000）...
echo  [*] 首次启动会自动初始化数据库，请稍候几秒 ...
echo  [*] 浏览器将自动打开: http://127.0.0.1:5000
echo  [*] 关闭本窗口即停止服务
echo.
echo  ======================================================
echo   默认管理员: 100000 / 123456
echo   Demo 账号 : 123456 / 123456
echo   （生产请在 backend\.env 修改密码并关闭 Demo 账号）
echo  ======================================================
echo.

REM 延迟 2 秒后打开浏览器，避免服务还没起来
start "" "http://127.0.0.1:5000"

REM 进入后端目录启动 Flask（保持窗口，方便看日志）
cd /d "%~dp0"
"%VENV_PY%" index.py

endlocal
pause
