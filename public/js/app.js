class SmartParkingApp {
    constructor() {
        this.socket = null;
        this.currentTab = 'dashboard';
        this.selectedLotId = null;
        this.reservations = [];
        this.parkingLots = [];
        this.parkingSlots = [];
        this.map = null;
        this.mapMarkers = [];
        this.userLocation = null;
        
        this.init();
    }

    init() {
        this.initSocket();
        this.initEventListeners();
        this.loadDashboardStats();
        this.loadParkingLots();
    }

    initSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
            this.showToast('Connected to server', 'success');
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
            this.showToast('Disconnected from server', 'error');
        });

        this.socket.on('status_update', (data) => {
            this.handleStatusUpdate(data);
        });

        this.socket.on('command_ack', (data) => {
            this.handleCommandAck(data);
        });

        this.socket.on('heartbeat', (data) => {
            this.handleHeartbeat(data);
        });

        this.socket.on('mqtt_message', (data) => {
            this.addToActivityLog(data.topic, data.data);
        });

        this.socket.on('system_log', (logEntry) => {
            if (this.currentTab === 'monitoring') {
                this.addLogToMonitoring(logEntry);
            }
        });
    }

    initEventListeners() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        document.getElementById('refresh-parking').addEventListener('click', () => {
            this.loadParkingLots();
        });

        document.getElementById('back-to-lots').addEventListener('click', () => {
            this.showParkingLots();
        });

        document.getElementById('new-reservation').addEventListener('click', () => {
            // Navigate to parking tab to select a slot
            this.switchTab('parking');
            this.showToast('Select a slot to make a reservation', 'info');
        });

        document.querySelector('.close').addEventListener('click', () => {
            this.hideReservationModal();
        });

        document.getElementById('cancel-reservation').addEventListener('click', () => {
            this.hideReservationModal();
        });

        document.getElementById('reservation-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createReservation();
        });

        window.addEventListener('click', (e) => {
            const modal = document.getElementById('reservation-modal');
            if (e.target === modal) {
                this.hideReservationModal();
            }
        });

        // Map controls
        document.getElementById('locate-me').addEventListener('click', () => {
            this.getUserLocation();
        });

        document.getElementById('refresh-map').addEventListener('click', () => {
            this.refreshMapData();
        });

        document.getElementById('close-location-info').addEventListener('click', () => {
            document.getElementById('selected-location-info').style.display = 'none';
        });

        // Find nearby button
        document.getElementById('find-nearby').addEventListener('click', () => {
            this.switchTab('map');
            setTimeout(() => this.getUserLocation(), 500);
        });

        // Reservation filter
        document.getElementById('reservation-filter').addEventListener('change', (e) => {
            this.filterReservations(e.target.value);
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');

        this.currentTab = tabName;

        if (tabName === 'dashboard') {
            this.loadDashboardStats();
        } else if (tabName === 'map') {
            this.initMap();
        } else if (tabName === 'parking') {
            this.loadParkingLots();
        } else if (tabName === 'reservations') {
            this.loadReservations();
        } else if (tabName === 'monitoring') {
            this.loadMonitoringData();
        }
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        
        if (connected) {
            indicator.classList.remove('offline');
            indicator.classList.add('online');
            text.textContent = 'Connected';
        } else {
            indicator.classList.remove('online');
            indicator.classList.add('offline');
            text.textContent = 'Disconnected';
        }
    }

    async loadDashboardStats() {
        try {
            const response = await fetch('/api/dashboard-stats');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const stats = await response.json();
            
            document.getElementById('total-slots').textContent = stats.totalSlots || 0;
            document.getElementById('available-slots').textContent = stats.availableSlots || 0;
            document.getElementById('occupied-slots').textContent = stats.occupiedSlots || 0;
            document.getElementById('reserved-slots').textContent = stats.reservedSlots || 0;
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
            
            // Set default values on error
            document.getElementById('total-slots').textContent = '0';
            document.getElementById('available-slots').textContent = '0';
            document.getElementById('occupied-slots').textContent = '0';
            document.getElementById('reserved-slots').textContent = '0';
            
            this.showToast('Error loading dashboard stats', 'error');
        }
    }

    async loadParkingLots() {
        try {
            const response = await fetch('/api/parking-lots');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            this.parkingLots = Array.isArray(data) ? data : [];
            this.renderParkingLots();
        } catch (error) {
            console.error('Error loading parking lots:', error);
            this.parkingLots = [];
            this.showToast('Error loading parking lots', 'error');
            this.renderParkingLots();
        }
    }

    renderParkingLots() {
        const container = document.getElementById('parking-lots');
        if (!container) {
            console.error('Parking lots container not found');
            return;
        }
        
        if (!this.parkingLots || this.parkingLots.length === 0) {
            container.innerHTML = '<p class="no-data">No parking lots available</p>';
            return;
        }

        container.innerHTML = this.parkingLots.map(lot => `
            <div class="lot-card" onclick="app.showParkingSlots('${lot.id}')">
                <div class="lot-header">
                    <div class="lot-name">${lot.name}</div>
                    <div class="availability-badge">${lot.available_slots || 0}/${lot.total_slots || 0} Available</div>
                </div>
                <div class="lot-info">
                    <i class="fas fa-map-marker-alt"></i> ${lot.address}
                </div>
                <div class="availability-bar">
                    <div class="availability-fill" style="width: ${lot.total_slots ? (lot.available_slots / lot.total_slots) * 100 : 0}%"></div>
                </div>
                <div class="availability-text">
                    ${lot.available_slots} of ${lot.total_slots} slots available
                </div>
            </div>
        `).join('');
    }

    async showParkingSlots(lotId) {
        this.selectedLotId = lotId;
        const lot = this.parkingLots.find(l => l.id === lotId);
        
        if (!lot) return;

        document.getElementById('selected-lot-name').textContent = `${lot.name} - Parking Slots`;
        document.getElementById('parking-lots').style.display = 'none';
        document.getElementById('parking-slots').style.display = 'block';

        try {
            const response = await fetch(`/api/parking-slots?lot_id=${lotId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            this.parkingSlots = Array.isArray(data) ? data : [];
            this.renderParkingSlots();
        } catch (error) {
            console.error('Error loading parking slots:', error);
            this.parkingSlots = [];
            this.showToast('Error loading parking slots', 'error');
            this.renderParkingSlots();
        }
    }

    showParkingLots() {
        document.getElementById('parking-lots').style.display = 'grid';
        document.getElementById('parking-slots').style.display = 'none';
        this.selectedLotId = null;
    }

    renderParkingSlots() {
        const container = document.getElementById('slots-grid');
        if (!container) {
            console.error('Slots grid container not found');
            return;
        }
        
        if (!this.parkingSlots || this.parkingSlots.length === 0) {
            container.innerHTML = '<p class="no-data">No parking slots available</p>';
            return;
        }

        container.innerHTML = this.parkingSlots.map(slot => `
            <div class="slot-card ${slot.status}" onclick="app.selectSlot('${slot.id}', '${slot.lock_id}')">
                <div class="slot-header">
                    <div class="slot-id">${slot.lock_id}</div>
                    <div class="slot-status ${slot.status}">${slot.status}</div>
                </div>
                <div class="slot-info">
                    <div><i class="fas fa-battery-half"></i> Battery: ${slot.battery_level}%</div>
                    <div><i class="fas fa-signal"></i> Signal: ${slot.signal_strength}%</div>
                    ${slot.plate_number ? `<div><i class="fas fa-car"></i> ${slot.plate_number}</div>` : ''}
                    ${slot.user_name ? `<div><i class="fas fa-user"></i> ${slot.user_name}</div>` : ''}
                </div>
            </div>
        `).join('');
    }

    selectSlot(slotId, lockId) {
        const slot = this.parkingSlots.find(s => s.id === slotId);
        
        if (!slot || slot.status !== 'free') {
            this.showToast('Slot is not available for reservation', 'warning');
            return;
        }

        document.getElementById('selected-slot').value = lockId;
        document.getElementById('selected-slot-id').value = slotId;
        this.showReservationModal();
    }

    showReservationModal() {
        document.getElementById('reservation-modal').style.display = 'block';
    }

    hideReservationModal() {
        document.getElementById('reservation-modal').style.display = 'none';
        document.getElementById('reservation-form').reset();
    }

    async createReservation() {
        const reservationData = {
            slotId: document.getElementById('selected-slot-id').value,
            plateNumber: document.getElementById('plate-number').value.trim(),
            userName: document.getElementById('user-name').value.trim(),
            phoneNumber: document.getElementById('phone-number').value.trim(),
            duration: parseInt(document.getElementById('duration').value)
        };

        // Validate required fields
        if (!reservationData.slotId) {
            this.showToast('Please select a parking slot', 'error');
            return;
        }
        if (!reservationData.plateNumber) {
            this.showToast('License plate number is required', 'error');
            return;
        }
        if (!reservationData.duration || isNaN(reservationData.duration)) {
            this.showToast('Please select a valid duration', 'error');
            return;
        }

        try {
            const response = await fetch('/api/reservations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(reservationData)
            });

            const result = await response.json();

            if (response.ok) {
                this.showToast('Reservation created successfully!', 'success');
                this.hideReservationModal();
                this.loadDashboardStats();
                this.loadParkingLots(); // Refresh parking lots to show updated available slots
                if (this.selectedLotId) {
                    this.showParkingSlots(this.selectedLotId);
                }
            } else {
                this.showToast(result.error || 'Error creating reservation', 'error');
            }
        } catch (error) {
            console.error('Error creating reservation:', error);
            this.showToast('Error creating reservation', 'error');
        }
    }

    async loadReservations(filter = 'active') {
        try {
            const response = await fetch(`/api/reservations?filter=${filter}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            this.reservations = Array.isArray(data) ? data : [];
            this.renderReservations();
        } catch (error) {
            console.error('Error loading reservations:', error);
            this.reservations = [];
            this.showToast('Error loading reservations', 'error');
            this.renderReservations();
        }
    }

    renderReservations() {
        const container = document.getElementById('reservations-list');
        if (!container) {
            console.error('Reservations list container not found');
            return;
        }
        
        if (!this.reservations || this.reservations.length === 0) {
            container.innerHTML = '<p class="no-data">No active reservations</p>';
            return;
        }

        container.innerHTML = this.reservations.map(reservation => {
            // Check if slot is occupied (user has arrived) using slot_status
            const isOccupied = reservation.slot_status === 'occupied';
            const reservationStatus = reservation.status;
            const arriveButtonText = isOccupied ? 'Occupied' : "I'm Here";
            const arriveButtonClass = isOccupied ? 'btn btn-secondary' : 'btn btn-primary';
            const arriveButtonDisabled = isOccupied || reservationStatus !== 'active' ? 'disabled' : '';
            const statusBadge = reservationStatus === 'cancelled' ? '<span class="status-badge cancelled">Cancelled</span>' : 
                              reservationStatus === 'completed' ? '<span class="status-badge completed">Completed</span>' : 
                              isOccupied ? '<span class="status-badge occupied">Occupied</span>' : 
                              '<span class="status-badge active">Active</span>';
            
            return `
                <div class="reservation-card" data-reservation-id="${reservation.id}">
                    <div class="reservation-header">
                        <div class="reservation-id">${reservation.lock_id} ${statusBadge}</div>
                        <div class="reservation-actions">
                            ${reservationStatus === 'active' ? `
                                <button class="${arriveButtonClass}" ${arriveButtonDisabled} onclick="app.arriveAtReservation('${reservation.id}')">
                                    <i class="fas fa-${isOccupied ? 'check' : 'car'}"></i> ${arriveButtonText}
                                </button>
                                <button class="btn btn-danger" onclick="app.cancelReservation('${reservation.id}')">
                                    <i class="fas fa-times"></i> Cancel
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="reservation-info">
                        <div><strong>Plate:</strong> ${reservation.plate_number}</div>
                        <div><strong>User:</strong> ${reservation.user_name || 'Anonymous'}</div>
                        <div><strong>Location:</strong> ${reservation.lot_name}</div>
                        <div><strong>Until:</strong> ${reservation.end_time ? new Date(reservation.end_time).toLocaleString() : 'N/A'}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async arriveAtReservation(reservationId) {
        // Find and disable the button immediately
        const reservationCard = document.querySelector(`[data-reservation-id="${reservationId}"]`);
        const arriveButton = reservationCard?.querySelector('.btn-primary');
        
        if (arriveButton && !arriveButton.hasAttribute('disabled')) {
            arriveButton.disabled = true;
            arriveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            arriveButton.classList.remove('btn-primary');
            arriveButton.classList.add('btn-secondary');
        }
        
        try {
            console.log('🚗 Starting arrival process for reservation:', reservationId);
            
            const response = await fetch(`/api/reservations/${reservationId}/arrive`, {
                method: 'POST'
            });

            const result = await response.json();
            console.log('📡 Server response:', result);

            if (response.ok) {
                this.showToast(result.message || 'Lock opened! Park your vehicle now.', 'success');
                
                // Update button to show waiting state
                if (arriveButton) {
                    arriveButton.innerHTML = '<i class="fas fa-clock"></i> Waiting for vehicle...';
                }
                
                // Show progress message
                setTimeout(() => {
                    this.showToast('Detecting vehicle... Please wait.', 'info');
                }, 1000);
                
                console.log('✅ Arrival request successful');
                
                // Refresh data after a short delay to allow for status updates
                setTimeout(() => {
                    this.loadReservations();
                    this.loadDashboardStats();
                }, 2000);
            } else {
                this.showToast(result.error || 'Error opening lock', 'error');
                console.error('❌ Arrival request failed:', result);
                
                // Re-enable button on error
                if (arriveButton) {
                    arriveButton.disabled = false;
                    arriveButton.innerHTML = '<i class="fas fa-car"></i> I\'m Here';
                    arriveButton.classList.remove('btn-secondary');
                    arriveButton.classList.add('btn-primary');
                }
            }
        } catch (error) {
            console.error('❌ Error arriving at reservation:', error);
            this.showToast('Error opening lock', 'error');
            
            // Re-enable button on error
            if (arriveButton) {
                arriveButton.disabled = false;
                arriveButton.innerHTML = '<i class="fas fa-car"></i> I\'m Here';
                arriveButton.classList.remove('btn-secondary');
                arriveButton.classList.add('btn-primary');
            }
        }
    }

    async cancelReservation(reservationId) {
        if (!confirm('Are you sure you want to cancel this reservation?')) {
            return;
        }

        try {
            const response = await fetch(`/api/reservations/${reservationId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (response.ok) {
                this.showToast('Reservation cancelled successfully', 'success');
                this.loadReservations();
                this.loadDashboardStats();
            } else {
                this.showToast(result.error || 'Error cancelling reservation', 'error');
            }
        } catch (error) {
            console.error('Error cancelling reservation:', error);
            this.showToast('Error cancelling reservation', 'error');
        }
    }

    loadMonitoringData() {
        this.loadSystemLogs();
        this.loadSensorData();
    }

    async loadSystemLogs() {
        try {
            const response = await fetch('/api/system-logs?limit=50');
            const logs = await response.json();
            
            const logsContainer = document.getElementById('system-logs');
            
            if (logs.length === 0) {
                logsContainer.innerHTML = '<p class="no-data">No system logs available</p>';
                return;
            }

            logsContainer.innerHTML = logs.map(log => `
                <div class="log-item ${log.level}">
                    <div class="time">${new Date(log.timestamp).toLocaleString()}</div>
                    <div><strong>${log.type}:</strong> ${log.message}</div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading system logs:', error);
            document.getElementById('system-logs').innerHTML = '<p class="no-data">Error loading system logs</p>';
        }
    }

    async loadSensorData() {
        try {
            const response = await fetch('/api/sensor-data?hours=24');
            const sensorData = await response.json();
            
            const chartsContainer = document.getElementById('sensor-charts');
            
            if (sensorData.length === 0) {
                chartsContainer.innerHTML = '<p class="no-data">No sensor data available</p>';
                return;
            }

            // Group sensor data by lock and type
            const groupedData = {};
            sensorData.forEach(reading => {
                if (!groupedData[reading.lock_id]) {
                    groupedData[reading.lock_id] = { battery: [], signal: [] };
                }
                if (groupedData[reading.lock_id][reading.sensor_type]) {
                    groupedData[reading.lock_id][reading.sensor_type].push(reading);
                }
            });

            let chartsHtml = '';
            Object.keys(groupedData).forEach(lockId => {
                const lockData = groupedData[lockId];
                const latestBattery = lockData.battery[0]?.value || 0;
                const latestSignal = lockData.signal[0]?.value || 0;
                
                chartsHtml += `
                    <div class="sensor-chart">
                        <h4>${lockId}</h4>
                        <div class="sensor-reading">
                            <i class="fas fa-battery-half"></i> Battery: ${latestBattery}%
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${latestBattery}%"></div>
                            </div>
                        </div>
                        <div class="sensor-reading">
                            <i class="fas fa-signal"></i> Signal: ${latestSignal}%
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${latestSignal}%"></div>
                            </div>
                        </div>
                    </div>
                `;
            });

            chartsContainer.innerHTML = chartsHtml;
        } catch (error) {
            console.error('Error loading sensor data:', error);
            document.getElementById('sensor-charts').innerHTML = '<p class="no-data">Error loading sensor data</p>';
        }
    }

    addLogToMonitoring(logEntry) {
        const logsContainer = document.getElementById('system-logs');
        
        if (logsContainer.innerHTML.includes('No system logs available')) {
            logsContainer.innerHTML = '';
        }

        const logHtml = `
            <div class="log-item ${logEntry.level}">
                <div class="time">${new Date(logEntry.timestamp).toLocaleString()}</div>
                <div><strong>${logEntry.type}:</strong> ${logEntry.message}</div>
            </div>
        `;

        logsContainer.insertAdjacentHTML('afterbegin', logHtml);

        // Keep only last 50 logs
        const logs = logsContainer.querySelectorAll('.log-item');
        if (logs.length > 50) {
            logs[logs.length - 1].remove();
        }
    }

    handleStatusUpdate(data) {
        console.log('📡 Real-time status update received:', data);
        this.addToActivityLog('Status Update', `${data.lockId}: ${data.status}`, 'info');
        
        // Show toast for important status changes
        if (data.status === 'occupied') {
            this.showToast(`🚗 Vehicle detected in ${data.lockId}!`, 'success');
        } else if (data.status === 'reserved') {
            this.showToast(`🔒 ${data.lockId} reserved successfully`, 'info');
        }
        
        if (this.currentTab === 'dashboard') {
            this.loadDashboardStats();
        }
        
        if (this.currentTab === 'parking' && this.selectedLotId) {
            this.showParkingSlots(this.selectedLotId);
        }
        
        // Update monitoring data if on that tab
        if (this.currentTab === 'monitoring') {
            this.loadSensorData();
        }
    }

    handleCommandAck(data) {
        console.log('Command acknowledgment:', data);
        const status = data.success ? 'success' : 'error';
        this.showToast(data.message, status);
        this.addToActivityLog('Command Response', data.message, status);
    }

    handleHeartbeat(data) {
        console.log('Gateway heartbeat:', data);
        this.updateGatewayStatus(data);
    }

    updateGatewayStatus(heartbeat) {
        const container = document.getElementById('gateway-status');
        let gatewayList = container.innerHTML;
        
        if (gatewayList.includes('No gateways connected')) {
            container.innerHTML = '';
        }

        const existingGateway = container.querySelector(`[data-gateway="${heartbeat.gatewayId}"]`);
        
        const gatewayHtml = `
            <div class="gateway-item" data-gateway="${heartbeat.gatewayId}">
                <div>
                    <strong>${heartbeat.gatewayId}</strong><br>
                    <small>${heartbeat.locksCount} locks</small>
                </div>
                <div class="gateway-status-badge online">Online</div>
            </div>
        `;

        if (existingGateway) {
            existingGateway.outerHTML = gatewayHtml;
        } else {
            container.innerHTML += gatewayHtml;
        }
    }

    addToActivityLog(type, message, _level = 'info') {
        const container = document.getElementById('activity-log');
        
        if (container.innerHTML.includes('No recent activities')) {
            container.innerHTML = '';
        }

        const timestamp = new Date().toLocaleTimeString();
        const activityHtml = `
            <div class="activity-item">
                <div class="time">${timestamp}</div>
                <div><strong>${type}:</strong> ${message}</div>
            </div>
        `;

        container.insertAdjacentHTML('afterbegin', activityHtml);

        const activities = container.querySelectorAll('.activity-item');
        if (activities.length > 10) {
            activities[activities.length - 1].remove();
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    // Map functionality
    initMap() {
        if (!this.map) {
            // Default location - Brignole, Genova
            const defaultLocation = [44.4056, 8.9463]; // Brignole, Genova
            
            this.map = L.map('parking-map', {
                zoomControl: true,
                scrollWheelZoom: true,
                touchZoom: true
            }).setView(defaultLocation, 13);

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);

            // Add click event to close location info when clicking on map
            this.map.on('click', () => {
                document.getElementById('selected-location-info').style.display = 'none';
            });
        }
        
        // Load parking lots onto the map
        setTimeout(() => {
            this.loadParkingLotsOnMap();
        }, 500);
    }

    async loadParkingLotsOnMap() {
        try {
            await this.loadParkingLots();
            this.clearMapMarkers();
            
            this.parkingLots.forEach(lot => {
                this.addParkingLotToMap(lot);
            });
            
            if (this.parkingLots.length > 0 && !this.userLocation) {
                // Center map on first parking lot if no user location
                const firstLot = this.parkingLots[0];
                if (firstLot.latitude && firstLot.longitude) {
                    this.map.setView([firstLot.latitude, firstLot.longitude], 13);
                }
            }
        } catch (error) {
            console.error('Error loading parking lots on map:', error);
            this.showToast('Error loading map data', 'error');
        }
    }

    addParkingLotToMap(lot) {
        // Use default coordinates if not provided - Brignole, Genova area
        const lat = lot.latitude || 44.4056 + (Math.random() - 0.5) * 0.01;
        const lng = lot.longitude || 8.9463 + (Math.random() - 0.5) * 0.01;
        
        // Determine marker color based on availability
        let markerClass = 'available';
        if (lot.available_slots === 0) {
            markerClass = 'occupied';
        } else if (lot.available_slots < lot.total_slots * 0.3) {
            markerClass = 'reserved';
        }

        // Create custom marker
        const markerHtml = `<div class="custom-marker ${markerClass}"></div>`;
        const customMarker = L.divIcon({
            html: markerHtml,
            className: 'custom-div-icon',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        const marker = L.marker([lat, lng], { icon: customMarker })
            .addTo(this.map)
            .bindPopup(this.createMarkerPopup(lot))
            .on('click', () => {
                this.showLocationInfo(lot);
            });

        this.mapMarkers.push(marker);
    }

    createMarkerPopup(lot) {
        return `
            <div class="marker-popup">
                <h4>${lot.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${lot.address}</p>
                <p><i class="fas fa-parking"></i> ${lot.available_slots}/${lot.total_slots} available</p>
                <button class="btn btn-primary" onclick="app.viewParkingLot('${lot.id}')">
                    View Slots
                </button>
            </div>
        `;
    }

    showLocationInfo(lot) {
        const infoElement = document.getElementById('selected-location-info');
        const nameElement = document.getElementById('selected-location-name');
        const detailsElement = document.getElementById('location-details');
        
        nameElement.textContent = lot.name;
        
        detailsElement.innerHTML = `
            <div class="location-detail">
                <strong>Address:</strong>
                <span>${lot.address}</span>
            </div>
            <div class="location-detail">
                <strong>Available Slots:</strong>
                <span>${lot.available_slots}/${lot.total_slots}</span>
            </div>
            <div class="location-detail">
                <strong>Occupancy:</strong>
                <span>${Math.round((1 - lot.available_slots / lot.total_slots) * 100)}%</span>
            </div>
            <div class="location-actions">
                <button class="btn btn-primary" onclick="app.viewParkingLot('${lot.id}')">
                    <i class="fas fa-eye"></i> View Slots
                </button>
                <button class="btn btn-secondary" onclick="app.getDirections(${lot.latitude || 44.4056}, ${lot.longitude || 8.9463})">
                    <i class="fas fa-route"></i> Get Directions
                </button>
            </div>
        `;
        
        infoElement.style.display = 'block';
    }

    viewParkingLot(lotId) {
        this.switchTab('parking');
        setTimeout(() => {
            this.showParkingSlots(lotId);
        }, 300);
    }

    getDirections(lat, lng) {
        if (this.userLocation) {
            const url = `https://www.google.com/maps/dir/${this.userLocation.lat},${this.userLocation.lng}/${lat},${lng}`;
            window.open(url, '_blank');
        } else {
            const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            window.open(url, '_blank');
            this.showToast('Location opened in Google Maps', 'info');
        }
    }

    clearMapMarkers() {
        this.mapMarkers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.mapMarkers = [];
    }

    getUserLocation() {
        if (navigator.geolocation) {
            this.showToast('Getting your location...', 'info');
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    
                    // Center map on user location
                    this.map.setView([this.userLocation.lat, this.userLocation.lng], 15);
                    
                    // Add user location marker
                    const userMarker = L.marker([this.userLocation.lat, this.userLocation.lng], {
                        icon: L.divIcon({
                            html: '<div style="background: #667eea; border: 3px solid white; border-radius: 50%; width: 15px; height: 15px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);"></div>',
                            className: 'user-location-marker',
                            iconSize: [15, 15],
                            iconAnchor: [7.5, 7.5]
                        })
                    }).addTo(this.map).bindPopup('Your Location');
                    
                    this.mapMarkers.push(userMarker);
                    this.showToast('Location found!', 'success');
                },
                (error) => {
                    console.error('Error getting location:', error);
                    this.showToast('Could not get your location', 'error');
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000
                }
            );
        } else {
            this.showToast('Geolocation is not supported by this browser', 'error');
        }
    }

    refreshMapData() {
        this.showToast('Refreshing map data...', 'info');
        this.loadParkingLotsOnMap();
    }

    // Enhanced reservation filtering
    filterReservations(filter) {
        this.loadReservations(filter);
        const filterText = filter === 'all' ? 'all' : filter;
        this.showToast(`Showing ${filterText} reservations`, 'info');
    }
}

const app = new SmartParkingApp();