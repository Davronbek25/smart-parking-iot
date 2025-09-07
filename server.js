const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
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
let db;

const initializeDatabase = () => {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database('./data/parking.db', (err) => {
            if (err) {
                console.error('Error opening database:', err);
                reject(err);
                return;
            }
            console.log('Connected to SQLite database');

            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS parking_lots (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    address TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    total_slots INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS parking_slots (
                    id TEXT PRIMARY KEY,
                    lot_id TEXT,
                    gateway_id TEXT,
                    lock_id TEXT UNIQUE,
                    status TEXT DEFAULT 'free',
                    battery_level INTEGER,
                    signal_strength INTEGER,
                    arm_position TEXT DEFAULT 'down',
                    vehicle_detected BOOLEAN DEFAULT 0,
                    last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (lot_id) REFERENCES parking_lots (id)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS reservations (
                    id TEXT PRIMARY KEY,
                    slot_id TEXT,
                    plate_number TEXT NOT NULL,
                    user_name TEXT,
                    phone_number TEXT,
                    start_time DATETIME,
                    end_time DATETIME,
                    status TEXT DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (slot_id) REFERENCES parking_slots (id)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lock_id TEXT,
                    sensor_type TEXT,
                    value REAL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (lock_id) REFERENCES parking_slots (lock_id)
                )`);

                db.run(`INSERT OR IGNORE INTO parking_lots (id, name, address, latitude, longitude, total_slots) VALUES 
                    ('lot_001', 'Brignole Station Parking', 'Piazza Giuseppe Verdi, Brignole, 16121 Genova GE, Italy', 44.4056, 8.9463, 6),
                    ('lot_002', 'Brignole Center Parking', 'Via Cadorna, Brignole, 16121 Genova GE, Italy', 44.4048, 8.9471, 6)`);

                db.run(`INSERT OR IGNORE INTO parking_slots (id, lot_id, gateway_id, lock_id, status, battery_level, signal_strength, arm_position, vehicle_detected) VALUES 
                    ('slot_001', 'lot_001', 'gateway_001', 'lock_gateway_001_1', 'free', 85, 92, 'down', 0),
                    ('slot_002', 'lot_001', 'gateway_001', 'lock_gateway_001_2', 'free', 78, 88, 'down', 0),
                    ('slot_003', 'lot_001', 'gateway_001', 'lock_gateway_001_3', 'free', 91, 95, 'down', 0),
                    ('slot_004', 'lot_002', 'gateway_002', 'lock_gateway_002_1', 'free', 82, 87, 'down', 0),
                    ('slot_005', 'lot_002', 'gateway_002', 'lock_gateway_002_2', 'free', 89, 91, 'down', 0),
                    ('slot_006', 'lot_002', 'gateway_002', 'lock_gateway_002_3', 'free', 76, 84, 'down', 0)`);

                // Insert initial sensor data for testing
                const currentTime = new Date().toISOString();
                const locks = ['lock_gateway_001_1', 'lock_gateway_001_2', 'lock_gateway_001_3', 
                              'lock_gateway_002_1', 'lock_gateway_002_2', 'lock_gateway_002_3'];
                
                locks.forEach(lockId => {
                    const batteryLevel = Math.floor(Math.random() * 30) + 70;
                    const signalStrength = Math.floor(Math.random() * 20) + 80;
                    
                    db.run(`INSERT OR IGNORE INTO sensor_data (lock_id, sensor_type, value, timestamp) VALUES 
                        (?, 'battery', ?, ?), (?, 'signal', ?, ?)`,
                        [lockId, batteryLevel, currentTime, lockId, signalStrength, currentTime]);
                });
            });

            resolve();
        });
    });
};

const connectMQTT = () => {
    mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
        clientId: process.env.MQTT_CLIENT_ID || 'parking_system',
        clean: true,
    });

    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        
        mqttClient.subscribe([
            '+/up_link',
            '+/down_link_ack',
            '+/heartbeat'
        ], (err) => {
            if (err) {
                console.error('MQTT subscription error:', err);
            } else {
                console.log('Subscribed to MQTT topics');
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
    
    db.run(`UPDATE parking_slots SET 
        status = ?, 
        battery_level = ?, 
        signal_strength = ?, 
        arm_position = ?,
        vehicle_detected = ?,
        last_update = CURRENT_TIMESTAMP 
        WHERE lock_id = ?`,
        [status, batteryLevel, signalStrength, armPosition, vehicleDetected ? 1 : 0, lockId],
        function(err) {
            if (err) {
                console.error('Database update error:', err);
            } else {
                console.log(`Updated status for ${lockId}: ${status}`);
            }
        }
    );

    db.run(`INSERT INTO sensor_data (lock_id, sensor_type, value) VALUES 
        (?, 'battery', ?), (?, 'signal', ?)`,
        [lockId, batteryLevel, lockId, signalStrength]);

    io.emit('status_update', data);
};

const handleCommandAcknowledgment = (data) => {
    console.log('Command acknowledgment:', data);
    io.emit('command_ack', data);
};

const handleHeartbeat = (data) => {
    console.log('Gateway heartbeat:', data.gatewayId);
    io.emit('heartbeat', data);
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/parking-lots', (req, res) => {
    db.all(`SELECT pl.*, COUNT(ps.id) as total_slots,
            SUM(CASE WHEN ps.status = 'free' THEN 1 ELSE 0 END) as available_slots
            FROM parking_lots pl
            LEFT JOIN parking_slots ps ON pl.id = ps.lot_id
            GROUP BY pl.id`, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.get('/api/parking-slots', (req, res) => {
    const lotId = req.query.lot_id;
    let query = `SELECT ps.*, pl.name as lot_name, r.plate_number, r.user_name, r.end_time
                 FROM parking_slots ps
                 LEFT JOIN parking_lots pl ON ps.lot_id = pl.id
                 LEFT JOIN reservations r ON ps.id = r.slot_id AND r.status = 'active'`;
    
    const params = [];
    if (lotId) {
        query += ' WHERE ps.lot_id = ?';
        params.push(lotId);
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.get('/api/reservations', (req, res) => {
    const filter = req.query.filter || 'active';
    let whereClause = '';
    
    switch (filter) {
        case 'active':
            whereClause = "WHERE r.status = 'active'";
            break;
        case 'expired':
            whereClause = "WHERE r.status = 'active' AND datetime(r.end_time) < datetime('now')";
            break;
        case 'completed':
            whereClause = "WHERE r.status = 'completed'";
            break;
        case 'all':
        default:
            whereClause = "WHERE r.status IN ('active', 'completed', 'cancelled')";
            break;
    }
    
    db.all(`SELECT r.*, ps.lock_id, ps.gateway_id, ps.lot_id, ps.status as slot_status, pl.name as lot_name
            FROM reservations r
            JOIN parking_slots ps ON r.slot_id = ps.id
            JOIN parking_lots pl ON ps.lot_id = pl.id
            ${whereClause}
            ORDER BY r.created_at DESC`, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.post('/api/reservations', (req, res) => {
    const { slotId, plateNumber, userName, phoneNumber, duration } = req.body;
    
    if (!slotId || !plateNumber) {
        return res.status(400).json({ error: 'Slot ID and plate number are required' });
    }

    db.get('SELECT * FROM parking_slots WHERE id = ? AND status = "free"', [slotId], (err, slot) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!slot) {
            return res.status(400).json({ error: 'Slot not available' });
        }

        const reservationId = uuidv4();
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + (duration || 60) * 60000);
        
        db.run(`INSERT INTO reservations (id, slot_id, plate_number, user_name, phone_number, start_time, end_time)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [reservationId, slotId, plateNumber, userName, phoneNumber, startTime.toISOString(), endTime.toISOString()],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }

                    // Update slot status immediately
                    db.run(`UPDATE parking_slots SET status = 'reserved', last_update = CURRENT_TIMESTAMP WHERE id = ?`, [slotId], (err) => {
                        if (err) {
                            console.error('Error updating slot status:', err);
                        }
                    });

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
                    mqttClient.publish(topic, JSON.stringify(command));

                    res.json({
                        success: true,
                        reservationId,
                        message: 'Reservation created successfully'
                    });
                }
        );
    });
});

app.post('/api/reservations/:id/arrive', (req, res) => {
    const reservationId = req.params.id;
    
    db.get(`SELECT r.*, ps.lock_id, ps.gateway_id FROM reservations r
            JOIN parking_slots ps ON r.slot_id = ps.id
            WHERE r.id = ? AND r.status = 'active'`, [reservationId], (err, reservation) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        const command = {
            commandId: uuidv4(),
            lockId: reservation.lock_id,
            action: 'open',
            data: { reservationId }
        };

        const topic = `/${reservation.gateway_id}/down_link`;
        mqttClient.publish(topic, JSON.stringify(command));

        res.json({ success: true, message: 'Opening lock for parking' });
    });
});

app.delete('/api/reservations/:id', (req, res) => {
    const reservationId = req.params.id;
    
    db.get(`SELECT r.*, ps.lock_id, ps.gateway_id FROM reservations r
            JOIN parking_slots ps ON r.slot_id = ps.id
            WHERE r.id = ? AND r.status = 'active'`, [reservationId], (err, reservation) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        db.run('UPDATE reservations SET status = "cancelled" WHERE id = ?', [reservationId], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Update slot status immediately
            db.run(`UPDATE parking_slots SET status = 'free', last_update = CURRENT_TIMESTAMP WHERE lock_id = ?`, [reservation.lock_id], (err) => {
                if (err) {
                    console.error('Error updating slot status:', err);
                }
            });

            const command = {
                commandId: uuidv4(),
                lockId: reservation.lock_id,
                action: 'release',
                data: { reservationId }
            };

            const topic = `/${reservation.gateway_id}/down_link`;
            mqttClient.publish(topic, JSON.stringify(command));

            res.json({ success: true, message: 'Reservation cancelled' });
        });
    });
});

app.get('/api/sensor-data/:lockId', (req, res) => {
    const lockId = req.params.lockId;
    const hours = req.query.hours || 24;
    
    db.all(`SELECT * FROM sensor_data 
            WHERE lock_id = ? AND timestamp > datetime('now', '-${hours} hours')
            ORDER BY timestamp DESC LIMIT 1000`, [lockId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.get('/api/dashboard-stats', (req, res) => {
    const queries = [
        'SELECT COUNT(*) as total_slots FROM parking_slots',
        'SELECT COUNT(*) as available_slots FROM parking_slots WHERE status = "free"',
        'SELECT COUNT(*) as occupied_slots FROM parking_slots WHERE status = "occupied"',
        'SELECT COUNT(*) as reserved_slots FROM parking_slots WHERE status = "reserved"',
        'SELECT COUNT(*) as active_reservations FROM reservations WHERE status = "active"'
    ];

    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            db.get(query, (err, row) => {
                if (err) reject(err);
                else resolve(Object.values(row)[0]);
            });
        })
    )).then(results => {
        res.json({
            totalSlots: results[0],
            availableSlots: results[1],
            occupiedSlots: results[2],
            reservedSlots: results[3],
            activeReservations: results[4]
        });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.get('/api/system-logs', (req, res) => {
    const limit = req.query.limit || 50;
    const hours = req.query.hours || 24;
    
    const logs = [];
    
    const currentTime = new Date();
    const timeAgo = new Date(currentTime.getTime() - hours * 60 * 60 * 1000);
    
    for (let i = 0; i < limit && i < 20; i++) {
        const logTime = new Date(timeAgo.getTime() + (Math.random() * hours * 60 * 60 * 1000));
        const logLevel = ['INFO', 'WARN', 'ERROR'][Math.floor(Math.random() * 3)];
        const messages = [
            'MQTT message received from gateway',
            'Lock status updated',
            'Reservation created successfully',
            'Gateway heartbeat received',
            'Database connection established',
            'Client connected to dashboard',
            'Sensor data updated',
            'Command sent to lock device'
        ];
        const message = messages[Math.floor(Math.random() * messages.length)];
        
        logs.push({
            timestamp: logTime.toISOString(),
            level: logLevel,
            message: message,
            source: 'parking-system'
        });
    }
    
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(logs);
});

app.get('/api/sensor-data', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    
    db.all(`SELECT sd.*, ps.lot_id, pl.name as lot_name
            FROM sensor_data sd
            JOIN parking_slots ps ON sd.lock_id = ps.lock_id
            JOIN parking_lots pl ON ps.lot_id = pl.id
            WHERE sd.timestamp > datetime('now', '-' || ? || ' hours')
            ORDER BY sd.timestamp DESC LIMIT 1000`, [hours], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
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
        await initializeDatabase();
        connectMQTT();
        
        server.listen(PORT, () => {
            console.log(`Smart Parking Server running on port ${PORT}`);
            console.log(`Dashboard: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    if (mqttClient) mqttClient.end();
    if (db) db.close();
    process.exit(0);
});

startServer();