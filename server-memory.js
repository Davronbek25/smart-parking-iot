const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let mqttClient;
let memoryDB = {
    parkingLots: [
        {
            id: 'lot_001',
            name: 'Downtown Parking',
            address: '123 Main St',
            latitude: 40.7128,
            longitude: -74.0060,
            total_slots: 3,
            available_slots: 3,
            created_at: new Date().toISOString()
        },
        {
            id: 'lot_002',
            name: 'Mall Parking',
            address: '456 Shopping Ave',
            latitude: 40.7589,
            longitude: -73.9851,
            total_slots: 3,
            available_slots: 3,
            created_at: new Date().toISOString()
        }
    ],
    parkingSlots: [
        {
            id: 'slot_001',
            lot_id: 'lot_001',
            gateway_id: 'gateway_001',
            lock_id: 'lock_gateway_001_1',
            status: 'free',
            battery_level: 85,
            signal_strength: 92,
            arm_position: 'down',
            vehicle_detected: false,
            last_update: new Date().toISOString()
        },
        {
            id: 'slot_002',
            lot_id: 'lot_001',
            gateway_id: 'gateway_001',
            lock_id: 'lock_gateway_001_2',
            status: 'free',
            battery_level: 78,
            signal_strength: 88,
            arm_position: 'down',
            vehicle_detected: false,
            last_update: new Date().toISOString()
        },
        {
            id: 'slot_003',
            lot_id: 'lot_001',
            gateway_id: 'gateway_001',
            lock_id: 'lock_gateway_001_3',
            status: 'free',
            battery_level: 91,
            signal_strength: 95,
            arm_position: 'down',
            vehicle_detected: false,
            last_update: new Date().toISOString()
        },
        {
            id: 'slot_004',
            lot_id: 'lot_002',
            gateway_id: 'gateway_002',
            lock_id: 'lock_gateway_002_1',
            status: 'free',
            battery_level: 82,
            signal_strength: 87,
            arm_position: 'down',
            vehicle_detected: false,
            last_update: new Date().toISOString()
        },
        {
            id: 'slot_005',
            lot_id: 'lot_002',
            gateway_id: 'gateway_002',
            lock_id: 'lock_gateway_002_2',
            status: 'free',
            battery_level: 89,
            signal_strength: 91,
            arm_position: 'down',
            vehicle_detected: false,
            last_update: new Date().toISOString()
        },
        {
            id: 'slot_006',
            lot_id: 'lot_002',
            gateway_id: 'gateway_002',
            lock_id: 'lock_gateway_002_3',
            status: 'free',
            battery_level: 76,
            signal_strength: 84,
            arm_position: 'down',
            vehicle_detected: false,
            last_update: new Date().toISOString()
        }
    ],
    reservations: [],
    sensorData: [],
    systemLogs: []
};

const connectMQTT = () => {
    mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
        clientId: process.env.MQTT_CLIENT_ID || 'parking_system',
        clean: true,
    });

    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        addSystemLog('System Startup', 'Connected to MQTT broker successfully');
        
        mqttClient.subscribe([
            '+/up_link',
            '+/down_link_ack',
            '+/heartbeat'
        ], (err) => {
            if (err) {
                console.error('MQTT subscription error:', err);
                addSystemLog('MQTT Error', 'Failed to subscribe to topics', 'error');
            } else {
                console.log('Subscribed to MQTT topics');
                addSystemLog('MQTT Setup', 'Subscribed to all required topics');
            }
        });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            handleMQTTMessage(topic, data);
        } catch (error) {
            console.error('Error parsing MQTT message:', error);
        }
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT connection error:', err);
    });
};

const handleMQTTMessage = (topic, data) => {
    const [gatewayId, messageType] = topic.split('/');
    
    console.log(`Received ${messageType} from ${gatewayId}:`, data);

    switch (messageType) {
        case 'up_link':
            handleStatusUpdate(data);
            break;
        case 'down_link_ack':
            handleCommandAcknowledgment(data);
            break;
        case 'heartbeat':
            handleHeartbeat(data);
            break;
    }

    io.emit('mqtt_message', { topic, data });
};

const handleStatusUpdate = (data) => {
    const { lockId, status, batteryLevel, signalStrength, armPosition, vehicleDetected, reservation } = data;
    
    // Update slot in memory
    const slot = memoryDB.parkingSlots.find(s => s.lock_id === lockId);
    if (slot) {
        const oldStatus = slot.status;
        slot.status = status;
        slot.battery_level = batteryLevel;
        slot.signal_strength = signalStrength;
        slot.arm_position = armPosition;
        slot.vehicle_detected = vehicleDetected;
        slot.last_update = new Date().toISOString();
        
        // Update lot availability
        updateLotAvailability(slot.lot_id);
        
        // Add system log for status changes
        if (oldStatus !== status) {
            addSystemLog('Status Change', `${lockId}: ${oldStatus} → ${status}`);
        }
        
        console.log(`Updated status for ${lockId}: ${status}`);
    }

    // Add sensor data
    memoryDB.sensorData.push({
        id: memoryDB.sensorData.length + 1,
        lock_id: lockId,
        sensor_type: 'battery',
        value: batteryLevel,
        timestamp: new Date().toISOString()
    });

    memoryDB.sensorData.push({
        id: memoryDB.sensorData.length + 1,
        lock_id: lockId,
        sensor_type: 'signal',
        value: signalStrength,
        timestamp: new Date().toISOString()
    });

    // Keep only last 1000 sensor readings
    if (memoryDB.sensorData.length > 1000) {
        memoryDB.sensorData = memoryDB.sensorData.slice(-1000);
    }

    io.emit('status_update', data);
};

const updateLotAvailability = (lotId) => {
    const lot = memoryDB.parkingLots.find(l => l.id === lotId);
    if (lot) {
        const slotsInLot = memoryDB.parkingSlots.filter(s => s.lot_id === lotId);
        lot.available_slots = slotsInLot.filter(s => s.status === 'free').length;
        lot.total_slots = slotsInLot.length;
    }
};

const addSystemLog = (type, message, level = 'info') => {
    const logEntry = {
        id: memoryDB.systemLogs.length + 1,
        type,
        message,
        level,
        timestamp: new Date().toISOString()
    };
    
    memoryDB.systemLogs.unshift(logEntry); // Add to beginning for newest first
    
    // Keep only last 100 log entries
    if (memoryDB.systemLogs.length > 100) {
        memoryDB.systemLogs = memoryDB.systemLogs.slice(0, 100);
    }
    
    // Emit to clients
    io.emit('system_log', logEntry);
    
    console.log(`[${level.toUpperCase()}] ${type}: ${message}`);
};

const handleCommandAcknowledgment = (data) => {
    console.log('Command acknowledgment:', data);
    addSystemLog('Command ACK', `${data.gatewayId}: ${data.success ? 'SUCCESS' : 'FAILED'} - ${data.message}`, data.success ? 'info' : 'error');
    io.emit('command_ack', data);
};

const handleHeartbeat = (data) => {
    console.log('Gateway heartbeat:', data.gatewayId);
    addSystemLog('Gateway Heartbeat', `${data.gatewayId} online (${data.locksCount} locks)`);
    io.emit('heartbeat', data);
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/parking-lots', (req, res) => {
    // Update availability for all lots
    memoryDB.parkingLots.forEach(lot => updateLotAvailability(lot.id));
    res.json(memoryDB.parkingLots);
});

app.get('/api/parking-slots', (req, res) => {
    const lotId = req.query.lot_id;
    let slots = memoryDB.parkingSlots;
    
    if (lotId) {
        slots = slots.filter(s => s.lot_id === lotId);
    }
    
    // Add lot name and reservation info
    const result = slots.map(slot => {
        const lot = memoryDB.parkingLots.find(l => l.id === slot.lot_id);
        const reservation = memoryDB.reservations.find(r => r.slot_id === slot.id && r.status === 'active');
        
        return {
            ...slot,
            lot_name: lot ? lot.name : 'Unknown',
            plate_number: reservation ? reservation.plate_number : null,
            user_name: reservation ? reservation.user_name : null,
            end_time: reservation ? reservation.end_time : null,
            reservation_id: reservation ? reservation.id : null
        };
    });
    
    res.json(result);
});

// Add endpoint to get all active reservations
app.get('/api/reservations', (req, res) => {
    const activeReservations = memoryDB.reservations
        .filter(r => r.status === 'active')
        .map(reservation => {
            const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
            const lot = slot ? memoryDB.parkingLots.find(l => l.id === slot.lot_id) : null;
            
            return {
                ...reservation,
                lock_id: slot ? slot.lock_id : null,
                lot_name: lot ? lot.name : 'Unknown',
                slot_status: slot ? slot.status : 'unknown'
            };
        });
    
    res.json(activeReservations);
});

app.post('/api/reservations', (req, res) => {
    const { slotId, plateNumber, userName, phoneNumber, duration } = req.body;
    
    if (!slotId || !plateNumber) {
        return res.status(400).json({ error: 'Slot ID and plate number are required' });
    }

    const slot = memoryDB.parkingSlots.find(s => s.id === slotId && s.status === 'free');
    if (!slot) {
        return res.status(400).json({ error: 'Slot not available' });
    }

    const reservationId = uuidv4();
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (duration || 60) * 60000);
    
    const reservation = {
        id: reservationId,
        slot_id: slotId,
        plate_number: plateNumber,
        user_name: userName,
        phone_number: phoneNumber,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'active',
        created_at: new Date().toISOString()
    };
    
    memoryDB.reservations.push(reservation);

    // Update slot status immediately when reservation is created
    slot.status = 'reserved';
    slot.last_update = new Date().toISOString();
    
    // Update lot availability
    updateLotAvailability(slot.lot_id);

    // Add system log
    addSystemLog('Reservation Created', `${plateNumber} reserved ${slot.lock_id} for ${duration} hours`);

    const command = {
        commandId: uuidv4(),
        lockId: slot.lock_id,
        action: 'reserve',
        data: {
            reservationId,
            plateNumber,
            userName: userName || 'Anonymous',
            duration: duration || 60,
            timestamp: startTime.toISOString()
        }
    };

    const topic = `/${slot.gateway_id}/down_link`;
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(command));
        console.log(`Sent reservation command for ${slot.lock_id}`);
    } else {
        console.log(`MQTT not connected, but slot status updated for ${slot.lock_id}`);
    }

    // Emit real-time update to connected clients
    io.emit('status_update', {
        lockId: slot.lock_id,
        status: 'reserved',
        reservation: reservation
    });

    res.json({
        success: true,
        reservationId,
        message: 'Reservation created successfully'
    });
});

app.post('/api/reservations/:id/arrive', (req, res) => {
    const reservationId = req.params.id;
    
    const reservation = memoryDB.reservations.find(r => r.id === reservationId && r.status === 'active');
    if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
    }

    const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
    if (!slot) {
        return res.status(404).json({ error: 'Slot not found' });
    }

    // Simulate the complete arrival process: open lock and then vehicle detection
    slot.arm_position = 'down';
    slot.last_update = new Date().toISOString();

    const command = {
        commandId: uuidv4(),
        lockId: slot.lock_id,
        action: 'open',
        data: { reservationId }
    };

    const topic = `/${slot.gateway_id}/down_link`;
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(command));
        console.log(`Sent open command for ${slot.lock_id}`);
    } else {
        console.log(`MQTT not connected, but slot updated for arrival at ${slot.lock_id}`);
    }

    // Simulate vehicle detection after a short delay (like real world)
    setTimeout(() => {
        slot.status = 'occupied';
        slot.vehicle_detected = true;
        slot.last_update = new Date().toISOString();
        
        // Update lot availability
        updateLotAvailability(slot.lot_id);
        
        // Add system log
        addSystemLog('Vehicle Detected', `Vehicle parked in ${slot.lock_id} by ${reservation.user_name || 'User'}`);
        
        // Emit real-time update for vehicle detection
        io.emit('status_update', {
            lockId: slot.lock_id,
            status: 'occupied',
            vehicleDetected: true,
            message: 'Vehicle detected and parked'
        });
        
        console.log(`Vehicle detected in ${slot.lock_id} - Status changed to occupied`);
    }, 2000); // 2 second delay to simulate real arrival

    // Emit immediate update for lock opening
    io.emit('status_update', {
        lockId: slot.lock_id,
        status: slot.status,
        armPosition: 'down',
        message: 'Lock opened for parking'
    });

    res.json({ success: true, message: 'Lock opened! Park your vehicle now.' });
});

app.delete('/api/reservations/:id', (req, res) => {
    const reservationId = req.params.id;
    
    const reservation = memoryDB.reservations.find(r => r.id === reservationId && r.status === 'active');
    if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
    }

    const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
    if (!slot) {
        return res.status(404).json({ error: 'Slot not found' });
    }

    reservation.status = 'cancelled';

    // Update slot status when reservation is cancelled
    slot.status = 'free';
    slot.arm_position = 'down';
    slot.last_update = new Date().toISOString();
    
    // Update lot availability
    updateLotAvailability(slot.lot_id);

    // Add system log
    addSystemLog('Reservation Cancelled', `${reservation.plate_number} cancelled reservation for ${slot.lock_id}`);

    const command = {
        commandId: uuidv4(),
        lockId: slot.lock_id,
        action: 'release',
        data: { reservationId }
    };

    const topic = `/${slot.gateway_id}/down_link`;
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(command));
        console.log(`Sent release command for ${slot.lock_id}`);
    } else {
        console.log(`MQTT not connected, but slot freed: ${slot.lock_id}`);
    }

    // Emit real-time update
    io.emit('status_update', {
        lockId: slot.lock_id,
        status: 'free',
        armPosition: 'down',
        message: 'Reservation cancelled, slot available'
    });

    res.json({ success: true, message: 'Reservation cancelled' });
});

app.get('/api/sensor-data/:lockId', (req, res) => {
    const lockId = req.params.lockId;
    const hours = req.query.hours || 24;
    
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const data = memoryDB.sensorData
        .filter(d => d.lock_id === lockId && d.timestamp > cutoffTime)
        .slice(-1000)
        .reverse();
    
    res.json(data);
});

// Get all sensor data for monitoring
app.get('/api/sensor-data', (req, res) => {
    const hours = req.query.hours || 24;
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    const data = memoryDB.sensorData
        .filter(d => d.timestamp > cutoffTime)
        .slice(-1000)
        .reverse();
    
    res.json(data);
});

// Get system logs
app.get('/api/system-logs', (req, res) => {
    const limit = req.query.limit || 50;
    const logs = memoryDB.systemLogs.slice(0, limit);
    res.json(logs);
});

app.get('/api/dashboard-stats', (req, res) => {
    const totalSlots = memoryDB.parkingSlots.length;
    const availableSlots = memoryDB.parkingSlots.filter(s => s.status === 'free').length;
    const occupiedSlots = memoryDB.parkingSlots.filter(s => s.status === 'occupied').length;
    const reservedSlots = memoryDB.parkingSlots.filter(s => s.status === 'reserved').length;
    const activeReservations = memoryDB.reservations.filter(r => r.status === 'active').length;

    res.json({
        totalSlots,
        availableSlots,
        occupiedSlots,
        reservedSlots,
        activeReservations
    });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.WEB_PORT || 3000;

const startServer = async () => {
    try {
        console.log('Using in-memory database (compatible with Windows)');
        
        // Add startup log
        addSystemLog('System Startup', 'Smart Parking IoT System starting up...');
        
        // Update lot availability
        memoryDB.parkingLots.forEach(lot => updateLotAvailability(lot.id));
        
        connectMQTT();
        
        server.listen(PORT, () => {
            console.log(`Smart Parking Server running on port ${PORT}`);
            console.log(`Dashboard: http://localhost:${PORT}`);
            addSystemLog('System Startup', `Web server started on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        addSystemLog('System Error', `Failed to start server: ${error.message}`, 'error');
        process.exit(1);
    }
};

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    if (mqttClient) mqttClient.end();
    process.exit(0);
});

startServer();