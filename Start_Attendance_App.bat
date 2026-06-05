@echo off
rem Change directory to the location of this script
cd /d "%~dp0"

rem Start the Node.js server in a new console window
start "Attendance Server" cmd /c "node server.js"

rem Wait a few seconds for the server to start
timeout /t 5 >nul

rem Start localtunnel for remote access
start "LocalTunnel" cmd /c "npx localtunnel --port 3000"

rem Open the app in the default browser
start "" "http://localhost:3000"

pause
