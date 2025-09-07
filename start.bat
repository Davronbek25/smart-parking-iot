@echo off
echo Starting Smart Parking IoT System...
echo.

if not exist node_modules (
    echo Installing dependencies...
    npm install
    echo.
)

if not exist data (
    echo Creating data directory...
    mkdir data
)

if not exist exports (
    echo Creating exports directory...
    mkdir exports
)

echo Starting system components...
echo.
echo MQTT Broker will start on port 1883
echo Web Server will start on port 3000
echo.
echo Press Ctrl+C to stop all services
echo.

start /B npm run broker
timeout /t 3 /nobreak > nul

start /B npm run start-windows
timeout /t 3 /nobreak > nul

start /B npm run start-gateway gateway_001
timeout /t 2 /nobreak > nul

start /B npm run start-gateway gateway_002
timeout /t 2 /nobreak > nul

echo.
echo System started successfully!
echo Web Dashboard: http://localhost:3000
echo.
echo Press any key to open dashboard in browser...
pause > nul

start http://localhost:3000

echo.
echo System is running. Press Ctrl+C to stop all services.
pause