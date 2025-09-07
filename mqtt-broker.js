const aedes = require('aedes')();
const net = require('net');

class MQTTBroker {
    constructor(port = 1883) {
        this.port = port;
        this.server = null;
        this.clients = new Map();
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        aedes.on('client', (client) => {
            console.log(`[MQTT Broker] Client connected: ${client.id}`);
            this.clients.set(client.id, {
                id: client.id,
                connected: true,
                subscriptions: [],
                lastSeen: new Date()
            });
        });

        aedes.on('clientDisconnect', (client) => {
            console.log(`[MQTT Broker] Client disconnected: ${client.id}`);
            if (this.clients.has(client.id)) {
                this.clients.get(client.id).connected = false;
            }
        });

        aedes.on('subscribe', (subscriptions, client) => {
            const clientInfo = this.clients.get(client.id);
            if (clientInfo) {
                subscriptions.forEach(sub => {
                    clientInfo.subscriptions.push(sub.topic);
                    console.log(`[MQTT Broker] Client ${client.id} subscribed to: ${sub.topic}`);
                });
            }
        });

        aedes.on('unsubscribe', (subscriptions, client) => {
            const clientInfo = this.clients.get(client.id);
            if (clientInfo) {
                subscriptions.forEach(topic => {
                    const index = clientInfo.subscriptions.indexOf(topic);
                    if (index > -1) {
                        clientInfo.subscriptions.splice(index, 1);
                    }
                    console.log(`[MQTT Broker] Client ${client.id} unsubscribed from: ${topic}`);
                });
            }
        });

        aedes.on('publish', (packet, client) => {
            if (client) {
                console.log(`[MQTT Broker] Message published by ${client.id} to ${packet.topic}`);
                
                try {
                    const payload = JSON.parse(packet.payload.toString());
                    this.logMessage(client.id, packet.topic, payload);
                } catch (error) {
                    console.log(`[MQTT Broker] Non-JSON message: ${packet.payload.toString()}`);
                }
            }
        });

        aedes.on('clientError', (client, err) => {
            console.error(`[MQTT Broker] Client error for ${client.id}:`, err);
        });

        aedes.on('connectionError', (client, err) => {
            console.error(`[MQTT Broker] Connection error for ${client.id}:`, err);
        });
    }

    logMessage(clientId, topic, payload) {
        const timestamp = new Date().toISOString();
        const [gatewayId, messageType] = topic.split('/');
        
        switch (messageType) {
            case 'up_link':
                console.log(`[${timestamp}] Gateway ${gatewayId} - Lock Status: ${payload.lockId} = ${payload.status}`);
                break;
            case 'down_link':
                console.log(`[${timestamp}] Command to Gateway ${gatewayId} - ${payload.action} on ${payload.lockId}`);
                break;
            case 'down_link_ack':
                console.log(`[${timestamp}] Gateway ${gatewayId} - Command ACK: ${payload.success ? 'SUCCESS' : 'FAILED'} - ${payload.message}`);
                break;
            case 'heartbeat':
                console.log(`[${timestamp}] Gateway ${gatewayId} - Heartbeat (${payload.locksCount} locks)`);
                break;
            default:
                console.log(`[${timestamp}] ${clientId} -> ${topic}:`, payload);
        }
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = net.createServer(aedes.handle);
            
            this.server.listen(this.port, (err) => {
                if (err) {
                    console.error(`[MQTT Broker] Failed to start on port ${this.port}:`, err);
                    reject(err);
                } else {
                    console.log(`[MQTT Broker] Started on port ${this.port}`);
                    console.log(`[MQTT Broker] Clients can connect to: mqtt://localhost:${this.port}`);
                    resolve();
                }
            });

            this.server.on('error', (err) => {
                console.error('[MQTT Broker] Server error:', err);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('[MQTT Broker] Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    getStats() {
        const connected = Array.from(this.clients.values()).filter(c => c.connected).length;
        const total = this.clients.size;
        
        return {
            connectedClients: connected,
            totalClients: total,
            clients: Array.from(this.clients.values()),
            uptime: process.uptime()
        };
    }

    publishMessage(topic, payload) {
        const message = {
            topic,
            payload: JSON.stringify(payload),
            qos: 0,
            retain: false
        };
        
        aedes.publish(message, (err) => {
            if (err) {
                console.error(`[MQTT Broker] Error publishing to ${topic}:`, err);
            } else {
                console.log(`[MQTT Broker] Published message to ${topic}`);
            }
        });
    }
}

const broker = new MQTTBroker(1883);

const startBroker = async () => {
    try {
        await broker.start();
        
        setInterval(() => {
            const stats = broker.getStats();
            console.log(`[MQTT Broker] Stats - Connected: ${stats.connectedClients}, Total: ${stats.totalClients}, Uptime: ${Math.floor(stats.uptime)}s`);
        }, 60000);
        
    } catch (error) {
        console.error('Failed to start MQTT broker:', error);
        process.exit(1);
    }
};

process.on('SIGINT', async () => {
    console.log('\n[MQTT Broker] Shutting down...');
    await broker.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[MQTT Broker] Shutting down...');
    await broker.stop();
    process.exit(0);
});

if (require.main === module) {
    startBroker();
}

module.exports = MQTTBroker;