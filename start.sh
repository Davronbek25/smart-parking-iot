#!/bin/bash

echo "Starting Smart Parking IoT System..."
echo

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed. Please install npm first."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo
fi

# Create directories if they don't exist
if [ ! -d "data" ]; then
    echo "Creating data directory..."
    mkdir -p data
fi

if [ ! -d "exports" ]; then
    echo "Creating exports directory..."
    mkdir -p exports
fi

echo "Starting system components..."
echo
echo "MQTT Broker will start on port 1883"
echo "Web Server will start on port 3000"
echo
echo "Press Ctrl+C to stop all services"
echo

# Function to handle cleanup on exit
cleanup() {
    echo
    echo "Stopping all services..."
    kill $BROKER_PID $SERVER_PID $GATEWAY1_PID $GATEWAY2_PID 2>/dev/null
    wait
    echo "All services stopped."
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start MQTT Broker
npm run broker &
BROKER_PID=$!
sleep 3

# Start Web Server
npm run start-windows &
SERVER_PID=$!
sleep 3

# Start Gateways
npm run start-gateway gateway_001 &
GATEWAY1_PID=$!
sleep 2

npm run start-gateway gateway_002 &
GATEWAY2_PID=$!
sleep 2

echo
echo "System started successfully!"
echo "Web Dashboard: http://localhost:3000"
echo
echo "System is running. Press Ctrl+C to stop all services."

# Wait for all background processes
wait