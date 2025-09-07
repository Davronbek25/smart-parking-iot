const http = require('http');

function testEndpoint(path, description) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                console.log(`\n=== ${description} ===`);
                console.log(`Status: ${res.statusCode}`);
                try {
                    const parsed = JSON.parse(data);
                    console.log('Response:', JSON.stringify(parsed, null, 2));
                } catch (e) {
                    console.log('Response (raw):', data.substring(0, 200) + (data.length > 200 ? '...' : ''));
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            console.log(`\n=== ${description} ===`);
            console.log(`ERROR: ${err.message}`);
            resolve();
        });

        req.end();
    });
}

async function runDiagnostics() {
    console.log('🔍 SMART PARKING DIAGNOSTICS');
    console.log('============================');
    
    console.log('\n📊 Testing API Endpoints...');
    
    await testEndpoint('/api/dashboard-stats', 'Dashboard Stats');
    await testEndpoint('/api/reservations', 'Reservations API');
    await testEndpoint('/api/system-logs?limit=5', 'System Logs API');
    await testEndpoint('/api/sensor-data?hours=1', 'Sensor Data API');
    await testEndpoint('/api/parking-slots', 'Parking Slots API');
    
    console.log('\n✅ Diagnostics complete!');
    console.log('\nIf any endpoints show ERROR, the server may not be running properly.');
    console.log('If endpoints return empty arrays [], the system may need time to collect data.');
}

runDiagnostics();