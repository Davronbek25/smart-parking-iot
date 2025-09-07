const { EventEmitter } = require('events');

class ParkingLock extends EventEmitter {
    constructor(lockId, gatewayId) {
        super();
        this.lockId = lockId;
        this.gatewayId = gatewayId;
        this.status = 'free';
        this.batteryLevel = Math.floor(Math.random() * 30) + 70;
        this.signalStrength = Math.floor(Math.random() * 20) + 80;
        this.armPosition = 'down';
        this.vehicleDetected = false;
        this.reservation = null;
        this.lastUpdate = new Date().toISOString();
        
        this.sensors = {
            magneticSensor: new MagneticSensor(this),
            batterySensor: new BatterySensor(this),
            signalSensor: new SignalSensor(this)
        };
        
        this.actuators = {
            mechanicalArm: new MechanicalArm(this),
            speaker: new Speaker(this)
        };
        
        this.startSensorMonitoring();
    }

    startSensorMonitoring() {
        setInterval(() => {
            this.sensors.magneticSensor.checkVehiclePresence();
            this.sensors.batterySensor.updateBatteryLevel();
            this.sensors.signalSensor.updateSignalStrength();
        }, 5000);

        setInterval(() => {
            this.simulateRealisticBehavior();
        }, 10000);
    }

    processCommand(command) {
        const { action, data } = command;
        
        switch (action) {
            case 'reserve':
                return this.reserve(data);
            case 'release':
                return this.release();
            case 'open':
                return this.openForParking();
            case 'status':
                return this.getStatus();
            default:
                return { success: false, message: 'Unknown command' };
        }
    }

    reserve(reservationData) {
        if (this.status !== 'free') {
            return { success: false, message: `Lock is currently ${this.status}` };
        }

        this.status = 'reserved';
        this.reservation = {
            ...reservationData,
            timestamp: new Date().toISOString()
        };
        
        const armResult = this.actuators.mechanicalArm.raise();
        if (!armResult.success) {
            this.status = 'free';
            this.reservation = null;
            return armResult;
        }

        this.lastUpdate = new Date().toISOString();
        this.emit('statusChanged', this.getStatus());
        
        console.log(`[Lock ${this.lockId}] Reserved for ${reservationData.plateNumber}`);
        return { success: true, message: 'Lock reserved successfully' };
    }

    release() {
        if (this.status === 'free') {
            return { success: false, message: 'Lock is already free' };
        }

        const oldStatus = this.status;
        this.status = 'free';
        this.reservation = null;
        this.vehicleDetected = false;
        
        const armResult = this.actuators.mechanicalArm.lower();
        if (!armResult.success) {
            this.status = oldStatus;
            return armResult;
        }

        this.lastUpdate = new Date().toISOString();
        this.emit('statusChanged', this.getStatus());
        
        console.log(`[Lock ${this.lockId}] Released and available`);
        return { success: true, message: 'Lock released successfully' };
    }

    openForParking() {
        if (this.status !== 'reserved') {
            return { success: false, message: `Cannot open lock in ${this.status} state` };
        }

        const armResult = this.actuators.mechanicalArm.lower();
        if (!armResult.success) {
            return armResult;
        }

        this.lastUpdate = new Date().toISOString();
        this.emit('statusChanged', this.getStatus());
        
        console.log(`[Lock ${this.lockId}] Opened for parking`);
        
        setTimeout(() => {
            if (this.status === 'reserved' && Math.random() > 0.2) {
                this.sensors.magneticSensor.simulateVehicleArrival();
            }
        }, 3000);
        
        return { success: true, message: 'Lock opened for parking' };
    }

    onVehicleDetected() {
        if (this.status === 'reserved' && !this.vehicleDetected) {
            this.vehicleDetected = true;
            this.status = 'occupied';
            this.lastUpdate = new Date().toISOString();
            this.emit('statusChanged', this.getStatus());
            
            console.log(`[Lock ${this.lockId}] Vehicle detected and parked`);
        }
    }

    onVehicleLeft() {
        if (this.vehicleDetected) {
            this.vehicleDetected = false;
            this.status = 'free';
            this.reservation = null;
            this.actuators.mechanicalArm.lower();
            this.lastUpdate = new Date().toISOString();
            this.emit('statusChanged', this.getStatus());
            
            console.log(`[Lock ${this.lockId}] Vehicle left, lock now free`);
        }
    }

    simulateRealisticBehavior() {
        if (this.status === 'occupied' && Math.random() < 0.05) {
            this.sensors.magneticSensor.simulateVehicleDeparture();
        }
        
        if (this.status === 'reserved' && this.reservation) {
            const reservationTime = new Date(this.reservation.timestamp);
            const expirationTime = new Date(reservationTime.getTime() + (this.reservation.duration || 60) * 60000);
            
            if (new Date() > expirationTime) {
                console.log(`[Lock ${this.lockId}] Reservation expired, releasing lock`);
                this.release();
            }
        }
        
        if (Math.random() < 0.02) {
            this.actuators.speaker.playTamperAlarm();
        }
    }

    getStatus() {
        return {
            lockId: this.lockId,
            gatewayId: this.gatewayId,
            status: this.status,
            batteryLevel: this.batteryLevel,
            signalStrength: this.signalStrength,
            armPosition: this.armPosition,
            vehicleDetected: this.vehicleDetected,
            reservation: this.reservation,
            timestamp: this.lastUpdate,
            sensors: {
                magnetic: this.sensors.magneticSensor.getReading(),
                battery: this.sensors.batterySensor.getReading(),
                signal: this.sensors.signalSensor.getReading()
            }
        };
    }
}

class MagneticSensor {
    constructor(lock) {
        this.lock = lock;
        this.threshold = 500;
        this.currentReading = Math.floor(Math.random() * 100) + 50;
    }

    checkVehiclePresence() {
        this.currentReading += (Math.random() - 0.5) * 20;
        this.currentReading = Math.max(0, Math.min(1000, this.currentReading));
        
        const vehiclePresent = this.currentReading > this.threshold;
        
        if (vehiclePresent && !this.lock.vehicleDetected) {
            this.lock.onVehicleDetected();
        } else if (!vehiclePresent && this.lock.vehicleDetected) {
            this.lock.onVehicleLeft();
        }
    }

    simulateVehicleArrival() {
        this.currentReading = Math.floor(Math.random() * 300) + 600;
        this.checkVehiclePresence();
    }

    simulateVehicleDeparture() {
        this.currentReading = Math.floor(Math.random() * 200) + 100;
        this.checkVehiclePresence();
    }

    getReading() {
        return {
            value: this.currentReading,
            threshold: this.threshold,
            vehicleDetected: this.currentReading > this.threshold
        };
    }
}

class BatterySensor {
    constructor(lock) {
        this.lock = lock;
        this.lastUpdate = Date.now();
    }

    updateBatteryLevel() {
        const now = Date.now();
        const timeDiff = now - this.lastUpdate;
        
        const batteryDrain = (timeDiff / (1000 * 60 * 60 * 24)) * 0.1;
        this.lock.batteryLevel = Math.max(0, this.lock.batteryLevel - batteryDrain);
        
        this.lastUpdate = now;
        
        if (this.lock.batteryLevel < 20) {
            console.log(`[Lock ${this.lock.lockId}] Low battery warning: ${this.lock.batteryLevel.toFixed(1)}%`);
        }
    }

    getReading() {
        return {
            level: this.lock.batteryLevel,
            status: this.lock.batteryLevel > 20 ? 'good' : 'low',
            estimatedDays: Math.floor(this.lock.batteryLevel / 0.1)
        };
    }
}

class SignalSensor {
    constructor(lock) {
        this.lock = lock;
    }

    updateSignalStrength() {
        this.lock.signalStrength += (Math.random() - 0.5) * 10;
        this.lock.signalStrength = Math.max(0, Math.min(100, this.lock.signalStrength));
    }

    getReading() {
        return {
            strength: this.lock.signalStrength,
            quality: this.lock.signalStrength > 70 ? 'excellent' : 
                    this.lock.signalStrength > 50 ? 'good' : 
                    this.lock.signalStrength > 30 ? 'fair' : 'poor'
        };
    }
}

class MechanicalArm {
    constructor(lock) {
        this.lock = lock;
        this.isMoving = false;
    }

    raise() {
        if (this.isMoving) {
            return { success: false, message: 'Arm is currently moving' };
        }

        if (this.lock.armPosition === 'up') {
            return { success: true, message: 'Arm is already raised' };
        }

        console.log(`[Lock ${this.lock.lockId}] Raising mechanical arm...`);
        this.isMoving = true;
        
        setTimeout(() => {
            this.lock.armPosition = 'up';
            this.isMoving = false;
            console.log(`[Lock ${this.lock.lockId}] Mechanical arm raised`);
        }, 2000);

        return { success: true, message: 'Arm raising in progress' };
    }

    lower() {
        if (this.isMoving) {
            return { success: false, message: 'Arm is currently moving' };
        }

        if (this.lock.armPosition === 'down') {
            return { success: true, message: 'Arm is already lowered' };
        }

        console.log(`[Lock ${this.lock.lockId}] Lowering mechanical arm...`);
        this.isMoving = true;
        
        setTimeout(() => {
            this.lock.armPosition = 'down';
            this.isMoving = false;
            console.log(`[Lock ${this.lock.lockId}] Mechanical arm lowered`);
        }, 2000);

        return { success: true, message: 'Arm lowering in progress' };
    }
}

class Speaker {
    constructor(lock) {
        this.lock = lock;
        this.isPlaying = false;
    }

    playTamperAlarm() {
        if (this.isPlaying) return;
        
        console.log(`[Lock ${this.lock.lockId}] 🚨 TAMPER ALARM: Unauthorized access detected!`);
        this.isPlaying = true;
        
        setTimeout(() => {
            this.isPlaying = false;
            console.log(`[Lock ${this.lock.lockId}] Alarm stopped`);
        }, 5000);
    }

    playConfirmationBeep() {
        console.log(`[Lock ${this.lock.lockId}] 🔊 Beep - Command confirmed`);
    }
}

if (require.main === module) {
    const lockId = process.argv[2] || `lock_${Math.floor(Math.random() * 1000)}`;
    const gatewayId = process.argv[3] || 'gateway_001';
    
    const lock = new ParkingLock(lockId, gatewayId);
    
    lock.on('statusChanged', (status) => {
        console.log(`[Lock ${lockId}] Status changed:`, status);
    });

    setInterval(() => {
        console.log(`[Lock ${lockId}] Current status:`, lock.getStatus());
    }, 30000);

    process.on('SIGINT', () => {
        console.log(`\n[Lock ${lockId}] Shutting down...`);
        process.exit(0);
    });

    console.log(`[Lock ${lockId}] Started and monitoring...`);
}

module.exports = ParkingLock;