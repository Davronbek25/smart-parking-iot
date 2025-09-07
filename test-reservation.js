const http = require('http');

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(responseData)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: responseData
                    });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function testReservationFlow() {
    console.log('🚗 TESTING RESERVATION FLOW');
    console.log('============================');

    try {
        // Step 1: Check initial state
        console.log('\n1️⃣ Checking initial dashboard stats...');
        const initialStats = await makeRequest({
            hostname: 'localhost',
            port: 3000,
            path: '/api/dashboard-stats',
            method: 'GET'
        });
        console.log('Initial stats:', initialStats.data);

        // Step 2: Create reservation
        console.log('\n2️⃣ Creating test reservation...');
        const reservation = await makeRequest({
            hostname: 'localhost',
            port: 3000,
            path: '/api/reservations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, {
            slotId: 'slot_001',
            plateNumber: 'TEST-999',
            userName: 'Test User',
            duration: 1
        });
        console.log('Reservation response:', reservation.data);

        if (reservation.data.success) {
            const reservationId = reservation.data.reservationId;
            
            // Step 3: Check stats after reservation
            console.log('\n3️⃣ Checking stats after reservation...');
            const afterReservation = await makeRequest({
                hostname: 'localhost',
                port: 3000,
                path: '/api/dashboard-stats',
                method: 'GET'
            });
            console.log('Stats after reservation:', afterReservation.data);

            // Step 4: Check parking slots
            console.log('\n4️⃣ Checking slot status...');
            const slots = await makeRequest({
                hostname: 'localhost',
                port: 3000,
                path: '/api/parking-slots',
                method: 'GET'
            });
            const slot001 = slots.data.find(s => s.id === 'slot_001');
            console.log('Slot 001 status:', slot001);

            // Step 5: Simulate arrival
            console.log('\n5️⃣ Simulating arrival ("I\'m Here")...');
            const arrival = await makeRequest({
                hostname: 'localhost',
                port: 3000,
                path: `/api/reservations/${reservationId}/arrive`,
                method: 'POST'
            });
            console.log('Arrival response:', arrival.data);

            // Step 6: Wait and check final status
            console.log('\n6️⃣ Waiting 3 seconds for vehicle detection...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            const finalSlots = await makeRequest({
                hostname: 'localhost',
                port: 3000,
                path: '/api/parking-slots',
                method: 'GET'
            });
            const finalSlot001 = finalSlots.data.find(s => s.id === 'slot_001');
            console.log('Final slot 001 status:', finalSlot001);

            const finalStats = await makeRequest({
                hostname: 'localhost',
                port: 3000,
                path: '/api/dashboard-stats',
                method: 'GET'
            });
            console.log('Final stats:', finalStats.data);
        }

        console.log('\n✅ Test complete!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testReservationFlow();