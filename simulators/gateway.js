const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class Gateway {
    constructor(gatewayId) {
        this.gatewayId = gatewayId;
        this.client = null;
        this.locks = new Map();
        this.isConnected = false;
        this.heartbeatInterval = null;
        
        this.topics = {
            upLink: `/${gatewayId}/up_link`,
            downLink: `/${gatewayId}/down_link`,
            downLinkAck: `/${gatewayId}/down_link_ack`,
            heartbeat: `/${gatewayId}/heartbeat`
        };
    }

    connect() {
        console.log(`[Gateway ${this.gatewayId}] Connecting to MQTT broker...`);
        
        this.client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
            clientId: `gateway_${this.gatewayId}_${Date.now()}`,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 1000,
        });

        this.client.on('connect', () => {
            console.log(`[Gateway ${this.gatewayId}] Connected to MQTT broker`);
            this.isConnected = true;
            this.subscribeToTopics();
            this.startHeartbeat();
            this.initializeLocks();
        });

        this.client.on('message', (topic, message) => {
            this.handleMessage(topic, message);
        });

        this.client.on('error', (err) => {
            console.error(`[Gateway ${this.gatewayId}] MQTT Error:`, err);
        });

        this.client.on('close', () => {
            console.log(`[Gateway ${this.gatewayId}] Disconnected from MQTT broker`);
            this.isConnected = false;
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }
        });
    }

    subscribeToTopics() {
        this.client.subscribe(this.topics.downLink, (err) => {
            if (err) {
                console.error(`[Gateway ${this.gatewayId}] Failed to subscribe to down_link:`, err);
            } else {
                console.log(`[Gateway ${this.gatewayId}] Subscribed to ${this.topics.downLink}`);
            }
        });
    }

    initializeLocks() {
        const lockIds = [`lock_${this.gatewayId}_1`, `lock_${this.gatewayId}_2`, `lock_${this.gatewayId}_3`];
        
        lockIds.forEach(lockId => {
            this.locks.set(lockId, {
                id: lockId,
                status: 'free',
                batteryLevel: Math.floor(Math.random() * 30) + 70,
                signalStrength: Math.floor(Math.random() * 20) + 80,
                lastUpdate: new Date().toISOString(),
                armPosition: 'down',
                vehicleDetected: false,
                reservation: null
            });
        });

        console.log(`[Gateway ${this.gatewayId}] Initialized ${lockIds.length} locks`);
        this.publishLockStatuses();
    }

    handleMessage(topic, message) {
        try {
            const data = JSON.parse(message.toString());
            console.log(`[Gateway ${this.gatewayId}] Received message on ${topic}:`, data);

            if (topic === this.topics.downLink) {
                this.processCommand(data);
            }
        } catch (error) {
            console.error(`[Gateway ${this.gatewayId}] Error parsing message:`, error);
        }
    }

    processCommand(command) {
        const { commandId, lockId, action, data } = command;
        
        if (!this.locks.has(lockId)) {
            this.sendAcknowledgment(commandId, false, 'Lock not found');
            return;
        }

        const lock = this.locks.get(lockId);
        let success = false;
        let message = '';

        switch (action) {
            case 'reserve':
                if (lock.status === 'free') {
                    lock.status = 'reserved';
                    lock.armPosition = 'up';
                    lock.reservation = data;
                    lock.lastUpdate = new Date().toISOString();
                    success = true;
                    message = 'Lock reserved successfully';
                } else {
                    message = `Lock is currently ${lock.status}`;
                }
                break;

            case 'release':
                if (lock.status === 'reserved' || lock.status === 'occupied') {
                    lock.status = 'free';
                    lock.armPosition = 'down';
                    lock.reservation = null;
                    lock.vehicleDetected = false;
                    lock.lastUpdate = new Date().toISOString();
                    success = true;
                    message = 'Lock released successfully';
                } else {
                    message = `Lock is already ${lock.status}`;
                }
                break;

            case 'open':
                if (lock.status === 'reserved') {
                    lock.armPosition = 'down';
                    lock.lastUpdate = new Date().toISOString();
                    success = true;
                    message = 'Lock opened for parking';
                    
                    setTimeout(() => {
                        if (Math.random() > 0.3) {
                            lock.vehicleDetected = true;
                            lock.status = 'occupied';
                            this.publishLockStatus(lockId);
                        }
                    }, 5000);
                } else {
                    message = `Cannot open lock in ${lock.status} state`;
                }
                break;

            case 'status':
                success = true;
                message = 'Status retrieved successfully';
                break;

            default:
                message = 'Unknown command';
        }

        this.sendAcknowledgment(commandId, success, message);
        
        if (success && action !== 'status') {
            this.publishLockStatus(lockId);
        }
    }

    sendAcknowledgment(commandId, success, message) {
        const ack = {
            commandId,
            gatewayId: this.gatewayId,
            success,
            message,
            timestamp: new Date().toISOString()
        };

        this.client.publish(this.topics.downLinkAck, JSON.stringify(ack));
        console.log(`[Gateway ${this.gatewayId}] Sent acknowledgment:`, ack);
    }

    publishLockStatus(lockId) {
        if (!this.locks.has(lockId)) return;

        const lock = this.locks.get(lockId);
        const statusUpdate = {
            gatewayId: this.gatewayId,
            lockId: lockId,
            status: lock.status,
            batteryLevel: lock.batteryLevel,
            signalStrength: lock.signalStrength,
            armPosition: lock.armPosition,
            vehicleDetected: lock.vehicleDetected,
            reservation: lock.reservation,
            timestamp: new Date().toISOString()
        };

        this.client.publish(this.topics.upLink, JSON.stringify(statusUpdate));
        console.log(`[Gateway ${this.gatewayId}] Published status for ${lockId}:`, statusUpdate);
    }

    publishLockStatuses() {
        this.locks.forEach((_, lockId) => {
            this.publishLockStatus(lockId);
        });
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            const heartbeat = {
                gatewayId: this.gatewayId,
                status: 'online',
                locksCount: this.locks.size,
                locks: Array.from(this.locks.keys()),
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            };

            this.client.publish(this.topics.heartbeat, JSON.stringify(heartbeat));
            console.log(`[Gateway ${this.gatewayId}] Heartbeat sent`);

            this.simulateRandomEvents();
        }, 30000);
    }

    simulateRandomEvents() {
        if (Math.random() < 0.1) {
            const lockIds = Array.from(this.locks.keys());
            const randomLockId = lockIds[Math.floor(Math.random() * lockIds.length)];
            const lock = this.locks.get(randomLockId);

            if (lock.status === 'occupied' && Math.random() < 0.3) {
                lock.status = 'free';
                lock.vehicleDetected = false;
                lock.reservation = null;
                lock.armPosition = 'down';
                lock.lastUpdate = new Date().toISOString();
                
                console.log(`[Gateway ${this.gatewayId}] Simulated vehicle departure from ${randomLockId}`);
                this.publishLockStatus(randomLockId);
            }
        }
    }

    disconnect() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.client) {
            this.client.end();
        }
    }
}

if (require.main === module) {
    const gatewayId = process.argv[2] || `gateway_${Math.floor(Math.random() * 1000)}`;
    const gateway = new Gateway(gatewayId);
    
    gateway.connect();

    process.on('SIGINT', () => {
        console.log(`\n[Gateway ${gatewayId}] Shutting down...`);
        gateway.disconnect();
        process.exit(0);
    });
}

module.exports = Gateway;