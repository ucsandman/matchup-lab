@echo off
rem Matchup Lab: double-click this file to set up (first time only) and open the web page.
rem It runs launch.py with Python 3.8 or newer; if Python is missing it says how to install it.
setlocal
cd /d "%~dp0"

py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if errorlevel 1 goto try_python
py -3 launch.py %*
goto done

:try_python
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if errorlevel 1 goto no_python
python launch.py %*
goto done

:no_python
echo.
echo Matchup Lab needs Python 3.8 or newer, and it was not found on this computer.
echo.
echo   1. Your browser will now open https://www.python.org/downloads/
echo   2. Click the yellow Download Python button and run the file it downloads.
echo   3. On the first screen of the installer, tick the box "Add python.exe to PATH",
echo      then click Install Now.
echo   4. When it says Setup was successful, close the installer.
echo   5. Double-click Launch.bat again.
echo.
start "" https://www.python.org/downloads/
pause
exit /b 1

:done
exit /b %errorlevel%
