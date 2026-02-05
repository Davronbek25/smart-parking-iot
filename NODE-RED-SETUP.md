# Node-RED Integration Setup Guide

## Overview
This guide explains how to set up and use Node-RED for monitoring the Smart Parking IoT system.

## Installation

Node-RED has already been installed globally:
```bash
npm install -g --omit=dev node-red
```

## Starting Node-RED

### Option 1: Start Node-RED Separately
```bash
npm run node-red
```
Access Node-RED at: http://localhost:1880

### Option 2: Start Full System with Node-RED
```bash
npm run start-system-full
```
This starts:
- MQTT Broker (port 1883)
- Web Server (port 3000)
- Gateway Simulators (2 instances)
- Node-RED (port 1880)

## Importing Flows

1. Open Node-RED at http://localhost:1880
2. Click the menu (☰) in the top right
3. Select "Import"
4. Click "select a file to import"
5. Choose `node-red-flows.json` from the project directory
6. Click "Import"
7. Click "Deploy" (red button in top right)

## Installing Required Nodes

The flows require the Node-RED Dashboard. Install it:

1. In Node-RED, click the menu (☰)
2. Select "Manage palette"
3. Go to "Install" tab
4. Search for "node-red-dashboard"
5. Click "Install" next to "node-red-dashboard"

## Flow Descriptions

### Flow 1: Real-time Lock Monitoring
**Purpose**: Monitor lock status updates in real-time

**Components**:
- **MQTT In**: Subscribes to `+/up_link` topic
- **Parse Lock Data**: Extracts battery, signal, status from messages
- **Gauges**: Display battery level and signal strength
- **Chart**: Shows battery level history over time

**Dashboard**: http://localhost:1880/ui

### Flow 2: Alerting System
**Purpose**: Generate alerts for critical conditions

**Alert Conditions**:
- Battery level < 20%
- Signal strength < 50%
- Status changes to "occupied"

**Outputs**:
- Debug sidebar (real-time alerts)
- `alerts.log` file (persistent log)

### Flow 3: Data Logging
**Purpose**: Log all MQTT messages to CSV

**Components**:
- **MQTT In**: Subscribes to all topics (`#`)
- **Format Log Entry**: Adds timestamp and formats data
- **CSV Convert**: Converts to CSV format
- **File Write**: Appends to `mqtt-messages.csv`

**Output File**: `mqtt-messages.csv` in Node-RED user directory

## MQTT Configuration

The flows connect to the local MQTT broker with these settings:

- **Broker**: localhost:1883
- **Client ID**: node-red-monitor
- **Topics Monitored**:
  - `+/up_link` - Lock status updates
  - `+/heartbeat` - Gateway health checks
  - `+/down_link_ack` - Command acknowledgments

## Dashboard Access

Once flows are deployed and the dashboard is installed:

1. Open http://localhost:1880/ui
2. View real-time gauges for battery and signal
3. Dashboard updates automatically when locks send data

## Customizing Flows

### Modify Alert Thresholds

In Flow 2, edit the "Check Thresholds" switch node:
- Double-click the node
- Modify the JSONata expressions:
  - Battery: `payload.batteryLevel < 20` (change 20 to desired %)
  - Signal: `payload.signalStrength < 50` (change 50 to desired %)

### Change Log File Locations

Edit the "Write Alert Log" and "Write CSV Log" nodes:
- Double-click the file node
- Change the "Filename" field to desired path
- Click "Done" and "Deploy"

## Testing the Integration

### 1. Start the System
```bash
npm run start-system-full
```

### 2. Verify MQTT Connection
- Open Node-RED at http://localhost:1880
- Check that MQTT nodes show "connected" status (green dot)

### 3. Monitor Real-time Data
- Open dashboard at http://localhost:1880/ui
- Open web dashboard at http://localhost:3000
- Create a reservation
- Watch both dashboards update in real-time

### 4. Check Logs
- Open Node-RED debug sidebar (bug icon on right)
- View real-time messages

## Troubleshooting

### Node-RED Won't Start
```bash
# Check if port 1880 is in use
netstat -ano | findstr :1880

# Kill process if needed
taskkill /PID <process_id> /F
```

### MQTT Not Connecting
- Ensure MQTT broker is running (`npm run broker`)
- Check broker is on localhost:1883
- Verify no firewall blocking port 1883

### Dashboard Not Showing
- Install node-red-dashboard via Manage Palette
- Deploy the flows after importing
- Refresh browser at http://localhost:1880/ui

### No Data in Dashboard
- Ensure parking system is running
- Check MQTT broker has connections
- Create a reservation to trigger lock updates
- View debug sidebar for incoming messages

## File Outputs

### alerts.log
Location: Node-RED user directory (typically `~/.node-red/alerts.log` on Linux/Mac, `%USERPROFILE%\.node-red\alerts.log` on Windows)

Format:
```json
{"alert":"LOW_BATTERY","lockId":"lock_gateway_001_1","batteryLevel":18,"message":"LOW BATTERY: lock_gateway_001_1 at 18%","timestamp":"2026-02-03T12:34:56.789Z"}
```

### mqtt-messages.csv
Location: Node-RED user directory

Format:
```csv
timestamp,topic,message
2026-02-03T12:34:56.789Z,gateway_001/up_link,"{\"lockId\":\"lock_gateway_001_1\",\"status\":\"free\",\"batteryLevel\":85}"
```

## Integration Benefits

1. **Real-time Monitoring**: Visual gauges and charts for all locks
2. **Alerting**: Automatic detection of low battery and weak signals
3. **Data Logging**: Historical record of all MQTT messages
4. **Separate Dashboard**: Independent monitoring interface
5. **Extensibility**: Easy to add new flows and visualizations

## Next Steps

- Add more dashboard widgets (text, notifications, tables)
- Create email/SMS alerts using Node-RED nodes
- Add filtering to view specific locks
- Create aggregate statistics (average battery, uptime)
- Integrate with external services (databases, APIs)
