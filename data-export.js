const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class DataExporter {
    constructor(dbPath = './data/parking.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    disconnect() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    async exportToCSV(tableName, filePath, whereClause = '') {
        const query = `SELECT * FROM ${tableName} ${whereClause}`;
        
        return new Promise((resolve, reject) => {
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (rows.length === 0) {
                    reject(new Error('No data found'));
                    return;
                }

                const headers = Object.keys(rows[0]);
                const csvContent = [
                    headers.join(','),
                    ...rows.map(row => 
                        headers.map(header => {
                            const value = row[header];
                            return typeof value === 'string' && value.includes(',') 
                                ? `"${value}"` : value;
                        }).join(',')
                    )
                ].join('\n');

                fs.writeFileSync(filePath, csvContent);
                resolve(filePath);
            });
        });
    }

    async exportToJSON(tableName, filePath, whereClause = '') {
        const query = `SELECT * FROM ${tableName} ${whereClause}`;
        
        return new Promise((resolve, reject) => {
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
                resolve(filePath);
            });
        });
    }

    async exportSensorDataByTimeRange(startDate, endDate, format = 'csv') {
        const exportDir = './exports';
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `sensor_data_${startDate}_to_${endDate}_${timestamp}`;
        const filePath = path.join(exportDir, `${fileName}.${format}`);
        
        const whereClause = `WHERE timestamp BETWEEN '${startDate}' AND '${endDate}' ORDER BY timestamp DESC`;

        if (format === 'csv') {
            return await this.exportToCSV('sensor_data', filePath, whereClause);
        } else {
            return await this.exportToJSON('sensor_data', filePath, whereClause);
        }
    }

    async exportReservationHistory(format = 'csv') {
        const exportDir = './exports';
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `reservations_${timestamp}`;
        const filePath = path.join(exportDir, `${fileName}.${format}`);
        
        const whereClause = 'ORDER BY created_at DESC';

        if (format === 'csv') {
            return await this.exportToCSV('reservations', filePath, whereClause);
        } else {
            return await this.exportToJSON('reservations', filePath, whereClause);
        }
    }

    async exportParkingUsageReport(format = 'csv') {
        const exportDir = './exports';
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `usage_report_${timestamp}`;
        const filePath = path.join(exportDir, `${fileName}.${format}`);
        
        const query = `
            SELECT 
                ps.lock_id,
                pl.name as lot_name,
                ps.status,
                ps.battery_level,
                ps.signal_strength,
                COUNT(r.id) as total_reservations,
                MAX(r.created_at) as last_reservation,
                AVG(CASE WHEN r.end_time IS NOT NULL AND r.start_time IS NOT NULL 
                    THEN (julianday(r.end_time) - julianday(r.start_time)) * 24 
                    ELSE NULL END) as avg_duration_hours
            FROM parking_slots ps
            LEFT JOIN parking_lots pl ON ps.lot_id = pl.id
            LEFT JOIN reservations r ON ps.id = r.slot_id
            GROUP BY ps.id, pl.name
            ORDER BY total_reservations DESC
        `;

        return new Promise((resolve, reject) => {
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (format === 'csv') {
                    const headers = Object.keys(rows[0] || {});
                    const csvContent = [
                        headers.join(','),
                        ...rows.map(row => 
                            headers.map(header => {
                                const value = row[header];
                                return typeof value === 'string' && value.includes(',') 
                                    ? `"${value}"` : value;
                            }).join(',')
                        )
                    ].join('\n');

                    fs.writeFileSync(filePath, csvContent);
                } else {
                    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
                }

                resolve(filePath);
            });
        });
    }

    async getDataStats() {
        const queries = {
            totalReservations: 'SELECT COUNT(*) as count FROM reservations',
            activeReservations: 'SELECT COUNT(*) as count FROM reservations WHERE status = "active"',
            totalSensorReadings: 'SELECT COUNT(*) as count FROM sensor_data',
            totalSlots: 'SELECT COUNT(*) as count FROM parking_slots',
            availableSlots: 'SELECT COUNT(*) as count FROM parking_slots WHERE status = "free"',
            oldestData: 'SELECT MIN(timestamp) as timestamp FROM sensor_data',
            newestData: 'SELECT MAX(timestamp) as timestamp FROM sensor_data'
        };

        const stats = {};
        
        for (const [key, query] of Object.entries(queries)) {
            await new Promise((resolve, reject) => {
                this.db.get(query, (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        stats[key] = row?.count || row?.timestamp || 0;
                        resolve();
                    }
                });
            });
        }

        return stats;
    }
}

if (require.main === module) {
    const exporter = new DataExporter();
    
    const main = async () => {
        try {
            await exporter.connect();
            console.log('Connected to database');

            const stats = await exporter.getDataStats();
            console.log('Database Statistics:', stats);

            const args = process.argv.slice(2);
            const command = args[0];

            switch (command) {
                case 'sensor-data':
                    const startDate = args[1] || '2024-01-01';
                    const endDate = args[2] || new Date().toISOString().split('T')[0];
                    const format = args[3] || 'csv';
                    
                    const sensorFile = await exporter.exportSensorDataByTimeRange(startDate, endDate, format);
                    console.log(`Sensor data exported to: ${sensorFile}`);
                    break;

                case 'reservations':
                    const reservationFormat = args[1] || 'csv';
                    const reservationFile = await exporter.exportReservationHistory(reservationFormat);
                    console.log(`Reservation history exported to: ${reservationFile}`);
                    break;

                case 'usage-report':
                    const reportFormat = args[1] || 'csv';
                    const reportFile = await exporter.exportParkingUsageReport(reportFormat);
                    console.log(`Usage report exported to: ${reportFile}`);
                    break;

                default:
                    console.log('Available commands:');
                    console.log('  sensor-data [start-date] [end-date] [format]');
                    console.log('  reservations [format]');
                    console.log('  usage-report [format]');
                    console.log('');
                    console.log('Formats: csv, json');
                    console.log('Date format: YYYY-MM-DD');
            }

        } catch (error) {
            console.error('Export error:', error);
        } finally {
            await exporter.disconnect();
        }
    };

    main();
}

module.exports = DataExporter;