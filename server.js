const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors(), express.json(), express.static('public'));

let mqttClient;
let memoryDB = {
    parkingLots: [
        { id: 'lot_001', name: 'Brignole Station Parking', address: 'Piazza Giuseppe Verdi, Brignole, 16121 Genova GE, Italy', latitude: 44.4056, longitude: 8.9463, total_slots: 3, available_slots: 3 },
        { id: 'lot_002', name: 'Brignole Center Parking', address: 'Via Cadorna, Brignole, 16121 Genova GE, Italy', latitude: 44.4048, longitude: 8.9471, total_slots: 3, available_slots: 3 }
    ],
    parkingSlots: [
        { id: 'slot_001', lot_id: 'lot_001', gateway_id: 'gateway_001', lock_id: 'lock_gateway_001_1', status: 'free', battery_level: 85, signal_strength: 92, arm_position: 'down', vehicle_detected: false, last_update: new Date().toISOString() },
        { id: 'slot_002', lot_id: 'lot_001', gateway_id: 'gateway_001', lock_id: 'lock_gateway_001_2', status: 'free', battery_level: 78, signal_strength: 88, arm_position: 'down', vehicle_detected: false, last_update: new Date().toISOString() },
        { id: 'slot_003', lot_id: 'lot_001', gateway_id: 'gateway_001', lock_id: 'lock_gateway_001_3', status: 'free', battery_level: 91, signal_strength: 95, arm_position: 'down', vehicle_detected: false, last_update: new Date().toISOString() },
        { id: 'slot_004', lot_id: 'lot_002', gateway_id: 'gateway_002', lock_id: 'lock_gateway_002_1', status: 'free', battery_level: 82, signal_strength: 87, arm_position: 'down', vehicle_detected: false, last_update: new Date().toISOString() },
        { id: 'slot_005', lot_id: 'lot_002', gateway_id: 'gateway_002', lock_id: 'lock_gateway_002_2', status: 'free', battery_level: 89, signal_strength: 91, arm_position: 'down', vehicle_detected: false, last_update: new Date().toISOString() },
        { id: 'slot_006', lot_id: 'lot_002', gateway_id: 'gateway_002', lock_id: 'lock_gateway_002_3', status: 'free', battery_level: 76, signal_strength: 84, arm_position: 'down', vehicle_detected: false, last_update: new Date().toISOString() }
    ],
    reservations: [],
    sensorData: [],
    systemLogs: []
};

const connectMQTT = () => {
    mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', { clientId: process.env.MQTT_CLIENT_ID || 'parking_system', clean: true });
    
    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        addSystemLog('MQTT Connected', 'Connected to MQTT broker successfully');
        mqttClient.subscribe(['+/up_link', '+/down_link_ack', '+/heartbeat'], (err) => {
            if (!err) console.log('Subscribed to MQTT topics');
        });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            const [gatewayId, messageType] = topic.split('/');
            
            if (messageType === 'up_link') handleStatusUpdate(data);
            else if (messageType === 'down_link_ack') addSystemLog('Command ACK', `${data.gatewayId}: ${data.success ? 'SUCCESS' : 'FAILED'}`);
            else if (messageType === 'heartbeat') addSystemLog('Gateway Heartbeat', `${data.gatewayId} online`);
            
            io.emit('mqtt_message', { topic, data });
        } catch (error) {
            console.error('Error parsing MQTT message:', error);
        }
    });
};

const handleStatusUpdate = (data) => {
    const { lockId, status, batteryLevel, signalStrength, armPosition, vehicleDetected } = data;
    const slot = memoryDB.parkingSlots.find(s => s.lock_id === lockId);
    
    if (slot) {
        const oldStatus = slot.status;
        Object.assign(slot, { status, battery_level: batteryLevel, signal_strength: signalStrength, arm_position: armPosition, vehicle_detected: vehicleDetected, last_update: new Date().toISOString() });
        
        updateLotAvailability(slot.lot_id);
        if (oldStatus !== status) addSystemLog('Status Change', `${lockId}: ${oldStatus} → ${status}`);
    }

    memoryDB.sensorData.push(
        { id: memoryDB.sensorData.length + 1, lock_id: lockId, sensor_type: 'battery', value: batteryLevel, timestamp: new Date().toISOString() },
        { id: memoryDB.sensorData.length + 2, lock_id: lockId, sensor_type: 'signal', value: signalStrength, timestamp: new Date().toISOString() }
    );
    
    if (memoryDB.sensorData.length > 1000) memoryDB.sensorData = memoryDB.sensorData.slice(-1000);
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
    const logEntry = { id: memoryDB.systemLogs.length + 1, type, message, level, timestamp: new Date().toISOString() };
    memoryDB.systemLogs.unshift(logEntry);
    if (memoryDB.systemLogs.length > 100) memoryDB.systemLogs = memoryDB.systemLogs.slice(0, 100);
    io.emit('system_log', logEntry);
};

const checkExpiredReservations = () => {
    const now = new Date();
    memoryDB.reservations.forEach(reservation => {
        if (reservation.status === 'active' && now > new Date(reservation.end_time)) {
            reservation.status = 'expired';
            const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
            if (slot) {
                Object.assign(slot, { status: 'free', vehicle_detected: false, arm_position: 'down', last_update: now.toISOString() });
                updateLotAvailability(slot.lot_id);
                addSystemLog('Reservation Expired', `${reservation.plate_number} reservation for ${slot.lock_id} has expired`);
                io.emit('status_update', { lockId: slot.lock_id, status: 'free', vehicleDetected: false, armPosition: 'down' });
            }
        }
    });
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/parking-lots', (req, res) => {
    memoryDB.parkingLots.forEach(lot => updateLotAvailability(lot.id));
    res.json(memoryDB.parkingLots);
});

app.get('/api/parking-slots', (req, res) => {
    const { lot_id } = req.query;
    let slots = lot_id ? memoryDB.parkingSlots.filter(s => s.lot_id === lot_id) : memoryDB.parkingSlots;
    
    const result = slots.map(slot => {
        const lot = memoryDB.parkingLots.find(l => l.id === slot.lot_id);
        const reservation = memoryDB.reservations.find(r => r.slot_id === slot.id && r.status === 'active');
        return { ...slot, lot_name: lot?.name || 'Unknown', plate_number: reservation?.plate_number, user_name: reservation?.user_name, end_time: reservation?.end_time };
    });
    
    res.json(result);
});

app.get('/api/reservations', (req, res) => {
    const { filter = 'active' } = req.query;
    let filteredReservations = memoryDB.reservations;
    
    if (filter === 'active') filteredReservations = memoryDB.reservations.filter(r => r.status === 'active');
    else if (filter === 'expired') filteredReservations = memoryDB.reservations.filter(r => r.status === 'expired' || (r.status === 'active' && new Date() > new Date(r.end_time)));
    
    const reservations = filteredReservations.map(reservation => {
        const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
        const lot = slot ? memoryDB.parkingLots.find(l => l.id === slot.lot_id) : null;
        return { ...reservation, lock_id: slot?.lock_id, lot_name: lot?.name || 'Unknown', slot_status: slot?.status || 'unknown' };
    });
    
    res.json(reservations);
});

app.post('/api/reservations', (req, res) => {
    const { slotId, plateNumber, userName, phoneNumber, duration = 1 } = req.body;
    
    if (!slotId || !plateNumber) return res.status(400).json({ error: 'Slot ID and plate number are required' });
    
    const slot = memoryDB.parkingSlots.find(s => s.id === slotId && s.status === 'free');
    if (!slot) return res.status(400).json({ error: 'Slot not available' });
    
    const reservationId = uuidv4();
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + duration * 60 * 60000);
    
    const reservation = { id: reservationId, slot_id: slotId, plate_number: plateNumber, user_name: userName, phone_number: phoneNumber, start_time: startTime.toISOString(), end_time: endTime.toISOString(), status: 'active', created_at: new Date().toISOString() };
    
    memoryDB.reservations.push(reservation);
    Object.assign(slot, { status: 'reserved', last_update: new Date().toISOString() });
    updateLotAvailability(slot.lot_id);
    addSystemLog('Reservation Created', `${plateNumber} reserved ${slot.lock_id} for ${duration} hours`);
    
    const command = { commandId: uuidv4(), lockId: slot.lock_id, action: 'reserve', data: { reservationId, plateNumber, userName: userName || 'Anonymous', duration, timestamp: startTime.toISOString() } };
    
    if (mqttClient?.connected) mqttClient.publish(`/${slot.gateway_id}/down_link`, JSON.stringify(command));
    
    res.json({ success: true, reservationId, message: 'Reservation created successfully' });
});

app.post('/api/reservations/:id/arrive', (req, res) => {
    const reservation = memoryDB.reservations.find(r => r.id === req.params.id && r.status === 'active');
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    
    const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    
    Object.assign(slot, { arm_position: 'down', last_update: new Date().toISOString() });
    
    const command = { commandId: uuidv4(), lockId: slot.lock_id, action: 'open', data: { reservationId: reservation.id } };
    if (mqttClient?.connected) mqttClient.publish(`/${slot.gateway_id}/down_link`, JSON.stringify(command));
    
    setTimeout(() => {
        Object.assign(slot, { status: 'occupied', vehicle_detected: true, last_update: new Date().toISOString() });
        updateLotAvailability(slot.lot_id);
        addSystemLog('Vehicle Detected', `Vehicle parked in ${slot.lock_id}`);
        io.emit('status_update', { lockId: slot.lock_id, status: 'occupied', vehicleDetected: true });
    }, 2000);
    
    res.json({ success: true, message: 'Lock opened! Park your vehicle now.' });
});

app.delete('/api/reservations/:id', (req, res) => {
    const reservation = memoryDB.reservations.find(r => r.id === req.params.id && r.status === 'active');
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    
    const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    
    reservation.status = 'cancelled';
    Object.assign(slot, { status: 'free', arm_position: 'down', last_update: new Date().toISOString() });
    updateLotAvailability(slot.lot_id);
    addSystemLog('Reservation Cancelled', `${reservation.plate_number} cancelled reservation for ${slot.lock_id}`);
    
    const command = { commandId: uuidv4(), lockId: slot.lock_id, action: 'release', data: { reservationId: reservation.id } };
    if (mqttClient?.connected) mqttClient.publish(`/${slot.gateway_id}/down_link`, JSON.stringify(command));
    
    res.json({ success: true, message: 'Reservation cancelled' });
});

app.get('/api/dashboard-stats', (req, res) => {
    const totalSlots = memoryDB.parkingSlots.length;
    const availableSlots = memoryDB.parkingSlots.filter(s => s.status === 'free').length;
    const occupiedSlots = memoryDB.parkingSlots.filter(s => s.status === 'occupied').length;
    const reservedSlots = memoryDB.parkingSlots.filter(s => s.status === 'reserved').length;
    const activeReservations = memoryDB.reservations.filter(r => r.status === 'active').length;
    
    res.json({ totalSlots, availableSlots, occupiedSlots, reservedSlots, activeReservations });
});

app.get('/api/system-logs', (req, res) => {
    const limit = req.query.limit || 50;
    res.json(memoryDB.systemLogs.slice(0, limit));
});

app.get('/api/sensor-data/:lockId', (req, res) => {
    const { lockId } = req.params;
    const hours = req.query.hours || 24;
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const data = memoryDB.sensorData.filter(d => d.lock_id === lockId && d.timestamp > cutoffTime).slice(-1000).reverse();
    res.json(data);
});

// CSV Generator Helper
const generateCSV = (data) => {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    };

    const csvRows = [
        headers.join(','),
        ...data.map(row => headers.map(header => escapeCSV(row[header])).join(','))
    ];

    return csvRows.join('\n');
};

// Export Endpoints

// Export parking lots
app.get('/api/export/parking-lots', (req, res) => {
    const format = req.query.format || 'json';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0] + 'Z';

    memoryDB.parkingLots.forEach(lot => updateLotAvailability(lot.id));
    const data = memoryDB.parkingLots;

    if (format === 'csv') {
        const csv = generateCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="parking-lots-${timestamp}.csv"`);
        res.send(csv);
    } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="parking-lots-${timestamp}.json"`);
        res.json(data);
    }

    addSystemLog('Data Export', `Parking lots exported as ${format.toUpperCase()}`);
});

// Export parking slots
app.get('/api/export/parking-slots', (req, res) => {
    const format = req.query.format || 'json';
    const lot_id = req.query.lot_id;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0] + 'Z';

    let slots = lot_id ? memoryDB.parkingSlots.filter(s => s.lot_id === lot_id) : memoryDB.parkingSlots;

    const data = slots.map(slot => {
        const lot = memoryDB.parkingLots.find(l => l.id === slot.lot_id);
        const reservation = memoryDB.reservations.find(r => r.slot_id === slot.id && r.status === 'active');
        return {
            id: slot.id,
            lot_id: slot.lot_id,
            lot_name: lot?.name || 'Unknown',
            gateway_id: slot.gateway_id,
            lock_id: slot.lock_id,
            status: slot.status,
            battery_level: slot.battery_level,
            signal_strength: slot.signal_strength,
            arm_position: slot.arm_position,
            vehicle_detected: slot.vehicle_detected,
            plate_number: reservation?.plate_number || '',
            user_name: reservation?.user_name || '',
            end_time: reservation?.end_time || '',
            last_update: slot.last_update
        };
    });

    if (format === 'csv') {
        const csv = generateCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="parking-slots-${timestamp}.csv"`);
        res.send(csv);
    } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="parking-slots-${timestamp}.json"`);
        res.json(data);
    }

    addSystemLog('Data Export', `Parking slots exported as ${format.toUpperCase()}`);
});

// Export reservations
app.get('/api/export/reservations', (req, res) => {
    const format = req.query.format || 'json';
    const filter = req.query.filter || 'all';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0] + 'Z';

    let filteredReservations = memoryDB.reservations;

    if (filter === 'active') {
        filteredReservations = memoryDB.reservations.filter(r => r.status === 'active');
    } else if (filter === 'expired') {
        filteredReservations = memoryDB.reservations.filter(r => r.status === 'expired' || (r.status === 'active' && new Date() > new Date(r.end_time)));
    }

    const data = filteredReservations.map(reservation => {
        const slot = memoryDB.parkingSlots.find(s => s.id === reservation.slot_id);
        const lot = slot ? memoryDB.parkingLots.find(l => l.id === slot.lot_id) : null;
        return {
            id: reservation.id,
            slot_id: reservation.slot_id,
            lock_id: slot?.lock_id || 'Unknown',
            lot_name: lot?.name || 'Unknown',
            plate_number: reservation.plate_number,
            user_name: reservation.user_name || '',
            phone_number: reservation.phone_number || '',
            start_time: reservation.start_time,
            end_time: reservation.end_time,
            status: reservation.status,
            slot_status: slot?.status || 'unknown',
            created_at: reservation.created_at
        };
    });

    if (format === 'csv') {
        const csv = generateCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="reservations-${timestamp}.csv"`);
        res.send(csv);
    } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="reservations-${timestamp}.json"`);
        res.json(data);
    }

    addSystemLog('Data Export', `Reservations (${filter}) exported as ${format.toUpperCase()}`);
});

// Export sensor data for a specific lock
app.get('/api/export/sensor-data/:lockId', (req, res) => {
    const { lockId } = req.params;
    const format = req.query.format || 'json';
    const hours = req.query.hours || 24;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0] + 'Z';

    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const data = memoryDB.sensorData.filter(d => d.lock_id === lockId && d.timestamp > cutoffTime);

    if (format === 'csv') {
        const csv = generateCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="sensor-data-${lockId}-${timestamp}.csv"`);
        res.send(csv);
    } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="sensor-data-${lockId}-${timestamp}.json"`);
        res.json(data);
    }

    addSystemLog('Data Export', `Sensor data for ${lockId} exported as ${format.toUpperCase()}`);
});

// Export system logs
app.get('/api/export/system-logs', (req, res) => {
    const format = req.query.format || 'json';
    const limit = parseInt(req.query.limit) || 100;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0] + 'Z';

    const data = memoryDB.systemLogs.slice(0, limit);

    if (format === 'csv') {
        const csv = generateCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="system-logs-${timestamp}.csv"`);
        res.send(csv);
    } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="system-logs-${timestamp}.json"`);
        res.json(data);
    }

    addSystemLog('Data Export', `System logs exported as ${format.toUpperCase()}`);
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const PORT = process.env.WEB_PORT || 3000;

const startServer = async () => {
    console.log('Using in-memory database for cross-platform compatibility');
    addSystemLog('System Startup', 'Smart Parking IoT System starting up...');
    memoryDB.parkingLots.forEach(lot => updateLotAvailability(lot.id));
    setInterval(checkExpiredReservations, 30000);
    connectMQTT();
    
    server.listen(PORT, () => {
        console.log(`Smart Parking Server running on port ${PORT}`);
        console.log(`Dashboard: http://localhost:${PORT}`);
        addSystemLog('System Startup', `Web server started on port ${PORT}`);
    });
};

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    if (mqttClient) mqttClient.end();
    process.exit(0);
});

startServer();