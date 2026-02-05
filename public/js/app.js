class SmartParkingApp {
    constructor() {
        this.socket = null;
        this.currentTab = 'dashboard';
        this.selectedLotId = null;
        this.data = { reservations: [], parkingLots: [], parkingSlots: [] };
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
        this.socket.on('status_update', (data) => this.handleStatusUpdate(data));
        this.socket.on('command_ack', (data) => this.showToast(data.message, data.success ? 'success' : 'error'));
        this.socket.on('system_log', (logEntry) => {
            if (this.currentTab === 'monitoring') this.addLogToMonitoring(logEntry);
        });
    }

    initEventListeners() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        const elements = {
            'back-to-lots': () => this.showParkingLots(),
            'new-reservation': () => { this.switchTab('parking'); this.showToast('Select a slot to make a reservation', 'info'); },
            'close': () => this.hideReservationModal(),
            'cancel-reservation': () => this.hideReservationModal(),
            'locate-me': () => this.getUserLocation(),
            'close-location-info': () => document.getElementById('selected-location-info').style.display = 'none',
            'find-nearby': () => { this.switchTab('map'); setTimeout(() => this.getUserLocation(), 500); },
            'export-lots-csv': () => this.downloadData('/api/export/parking-lots?format=csv', 'parking-lots.csv'),
            'export-lots-json': () => this.downloadData('/api/export/parking-lots?format=json', 'parking-lots.json'),
            'export-slots-csv': () => this.downloadData('/api/export/parking-slots?format=csv', 'parking-slots.csv'),
            'export-slots-json': () => this.downloadData('/api/export/parking-slots?format=json', 'parking-slots.json'),
            'export-reservations-csv': () => this.downloadData('/api/export/reservations?format=csv&filter=all', 'reservations.csv'),
            'export-reservations-json': () => this.downloadData('/api/export/reservations?format=json&filter=all', 'reservations.json'),
            'export-logs-csv': () => this.downloadData('/api/export/system-logs?format=csv', 'system-logs.csv'),
            'export-logs-json': () => this.downloadData('/api/export/system-logs?format=json', 'system-logs.json'),
        };

        Object.entries(elements).forEach(([id, handler]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', handler);
        });

        document.getElementById('reservation-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createReservation();
        });

        document.getElementById('duration').addEventListener('change', (e) => {
            const customGroup = document.getElementById('custom-duration-group');
            customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        window.addEventListener('click', (e) => {
            const modal = document.getElementById('reservation-modal');
            if (e.target === modal) this.hideReservationModal();
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.nav-item, .tab-content').forEach(el => el.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
        this.currentTab = tabName;

        const tabActions = {
            'dashboard': () => this.loadDashboardStats(),
            'map': () => this.initMap(),
            'parking': () => this.loadParkingLots(),
            'reservations': () => this.loadReservations('active'),
            'monitoring': () => this.loadSystemLogs()
        };

        if (tabActions[tabName]) tabActions[tabName]();
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        indicator.className = `status-indicator ${connected ? 'online' : 'offline'}`;
        text.textContent = connected ? 'Connected' : 'Disconnected';
    }

    async apiCall(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error(`API call failed for ${url}:`, error);
            this.showToast(`Error loading data from ${url}`, 'error');
            return null;
        }
    }

    async loadDashboardStats() {
        const stats = await this.apiCall('/api/dashboard-stats');
        if (stats) {
            ['total-slots', 'available-slots', 'occupied-slots', 'reserved-slots'].forEach(id => {
                const key = id.replace('-', '').replace('slots', 'Slots');
                document.getElementById(id).textContent = stats[key] || 0;
            });
        }
    }

    async loadParkingLots() {
        this.data.parkingLots = await this.apiCall('/api/parking-lots') || [];
        this.renderParkingLots();
    }

    renderParkingLots() {
        const container = document.getElementById('parking-lots');
        if (!this.data.parkingLots.length) {
            container.innerHTML = '<p class="no-data">No parking lots available</p>';
            return;
        }

        container.innerHTML = this.data.parkingLots.map(lot => `
            <div class="lot-card" onclick="app.showParkingSlots('${lot.id}')">
                <div class="lot-header">
                    <div class="lot-name">${lot.name}</div>
                    <div class="availability-badge">${lot.available_slots || 0}/${lot.total_slots || 0} Available</div>
                </div>
                <div class="lot-info"><i class="fas fa-map-marker-alt"></i> ${lot.address}</div>
                <div class="availability-bar">
                    <div class="availability-fill" style="width: ${lot.total_slots ? (lot.available_slots / lot.total_slots) * 100 : 0}%"></div>
                </div>
                <div class="availability-text">${lot.available_slots} of ${lot.total_slots} slots available</div>
            </div>
        `).join('');
    }

    async showParkingSlots(lotId) {
        this.selectedLotId = lotId;
        const lot = this.data.parkingLots.find(l => l.id === lotId);
        if (!lot) return;

        document.getElementById('selected-lot-name').textContent = `${lot.name} - Parking Slots`;
        document.getElementById('parking-lots').style.display = 'none';
        document.getElementById('parking-slots').style.display = 'block';

        this.data.parkingSlots = await this.apiCall(`/api/parking-slots?lot_id=${lotId}`) || [];
        this.renderParkingSlots();
    }

    showParkingLots() {
        document.getElementById('parking-lots').style.display = 'grid';
        document.getElementById('parking-slots').style.display = 'none';
        this.selectedLotId = null;
    }

    renderParkingSlots() {
        const container = document.getElementById('slots-grid');
        if (!this.data.parkingSlots.length) {
            container.innerHTML = '<p class="no-data">No parking slots available</p>';
            return;
        }

        container.innerHTML = this.data.parkingSlots.map(slot => `
            <div class="slot-card ${slot.status}" onclick="app.selectSlot('${slot.id}', '${slot.lock_id}')">
                <div class="slot-header">
                    <div class="slot-id">${slot.lock_id}</div>
                    <div class="slot-status ${slot.status}">${slot.status}</div>
                </div>
                <div class="slot-info">
                    <div><i class="fas fa-battery-half"></i> Battery: ${Math.round(slot.battery_level)}%</div>
                    <div><i class="fas fa-signal"></i> Signal: ${Math.round(slot.signal_strength)}%</div>
                    ${slot.plate_number ? `<div><i class="fas fa-car"></i> ${slot.plate_number}</div>` : ''}
                    ${slot.user_name ? `<div><i class="fas fa-user"></i> ${slot.user_name}</div>` : ''}
                </div>
            </div>
        `).join('');
    }

    selectSlot(slotId, lockId) {
        const slot = this.data.parkingSlots.find(s => s.id === slotId);
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
        document.getElementById('custom-duration-group').style.display = 'none';
    }

    async createReservation() {
        const durationSelect = document.getElementById('duration');
        let duration;
        
        if (durationSelect.value === 'custom') {
            const minutes = parseInt(document.getElementById('custom-minutes').value) || 0;
            const seconds = parseInt(document.getElementById('custom-seconds').value) || 0;
            duration = minutes / 60 + seconds / 3600;
        } else {
            duration = parseInt(durationSelect.value);
        }

        const reservationData = {
            slotId: document.getElementById('selected-slot-id').value,
            plateNumber: document.getElementById('plate-number').value.trim(),
            userName: document.getElementById('user-name').value.trim(),
            phoneNumber: document.getElementById('phone-number').value.trim(),
            duration
        };

        if (!reservationData.slotId || !reservationData.plateNumber || !duration || duration <= 0) {
            this.showToast('Please fill in all required fields with valid values', 'error');
            return;
        }

        const result = await this.apiCall('/api/reservations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reservationData)
        });

        if (result?.success) {
            this.showToast('Reservation created successfully!', 'success');
            this.hideReservationModal();
            this.loadDashboardStats();
            this.loadParkingLots();
            if (this.selectedLotId) this.showParkingSlots(this.selectedLotId);
        }
    }

    async loadReservations(filter = 'active') {
        this.data.reservations = await this.apiCall(`/api/reservations?filter=${filter}`) || [];
        this.renderReservations();
    }

    renderReservations() {
        const container = document.getElementById('reservations-list');
        if (!this.data.reservations.length) {
            container.innerHTML = '<p class="no-data">No active reservations</p>';
            return;
        }

        container.innerHTML = this.data.reservations.map(reservation => {
            const isOccupied = reservation.slot_status === 'occupied';
            const isActive = reservation.status === 'active';
            const statusBadge = `<span class="status-badge ${reservation.status}">${reservation.status}</span>`;
            
            return `
                <div class="reservation-card" data-reservation-id="${reservation.id}">
                    <div class="reservation-header">
                        <div class="reservation-id">${reservation.lock_id} ${statusBadge}</div>
                        <div class="reservation-actions">
                            ${isActive ? `
                                <button class="btn ${isOccupied ? 'btn-secondary' : 'btn-primary'}" ${isOccupied ? 'disabled' : ''} onclick="app.arriveAtReservation('${reservation.id}')">
                                    <i class="fas fa-${isOccupied ? 'check' : 'car'}"></i> ${isOccupied ? 'Occupied' : "I'm Here"}
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
        const result = await this.apiCall(`/api/reservations/${reservationId}/arrive`, { method: 'POST' });
        if (result?.success) {
            this.showToast(result.message || 'Lock opened! Park your vehicle now.', 'success');
            setTimeout(() => {
                this.loadReservations('active');
                this.loadDashboardStats();
                this.loadParkingLots();
            }, 2000);
        }
    }

    async cancelReservation(reservationId) {
        if (!confirm('Are you sure you want to cancel this reservation?')) return;
        
        const result = await this.apiCall(`/api/reservations/${reservationId}`, { method: 'DELETE' });
        if (result?.success) {
            this.showToast('Reservation cancelled successfully', 'success');
            this.loadReservations('active');
            this.loadDashboardStats();
            this.loadParkingLots();
        }
    }

    async loadSystemLogs() {
        const logs = await this.apiCall('/api/system-logs?limit=50') || [];
        const container = document.getElementById('system-logs');
        
        if (!logs.length) {
            container.innerHTML = '<p class="no-data">No system logs available</p>';
            return;
        }

        container.innerHTML = logs.map(log => `
            <div class="log-item ${log.level}">
                <div class="time">${new Date(log.timestamp).toLocaleString()}</div>
                <div><strong>${log.type}:</strong> ${log.message}</div>
            </div>
        `).join('');
    }

    addLogToMonitoring(logEntry) {
        const container = document.getElementById('system-logs');
        if (container.innerHTML.includes('No system logs available')) container.innerHTML = '';

        const logHtml = `
            <div class="log-item ${logEntry.level}">
                <div class="time">${new Date(logEntry.timestamp).toLocaleString()}</div>
                <div><strong>${logEntry.type}:</strong> ${logEntry.message}</div>
            </div>
        `;

        container.insertAdjacentHTML('afterbegin', logHtml);
        const logs = container.querySelectorAll('.log-item');
        if (logs.length > 50) logs[logs.length - 1].remove();
    }

    handleStatusUpdate(data) {
        if (data.status === 'occupied') this.showToast(`🚗 Vehicle detected in ${data.lockId}!`, 'success');
        else if (data.status === 'reserved') this.showToast(`🔒 ${data.lockId} reserved successfully`, 'info');
        
        if (this.currentTab === 'dashboard') this.loadDashboardStats();
        if (this.currentTab === 'parking') {
            if (this.selectedLotId) this.showParkingSlots(this.selectedLotId);
            else this.loadParkingLots();
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    initMap() {
        if (!this.map) {
            this.map = L.map('parking-map').setView([44.4056, 8.9463], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);
            this.map.on('click', () => document.getElementById('selected-location-info').style.display = 'none');
        }
        setTimeout(() => this.loadParkingLotsOnMap(), 500);
    }

    async loadParkingLotsOnMap() {
        await this.loadParkingLots();
        this.clearMapMarkers();
        
        this.data.parkingLots.forEach(lot => {
            const lat = lot.latitude || 44.4056 + (Math.random() - 0.5) * 0.01;
            const lng = lot.longitude || 8.9463 + (Math.random() - 0.5) * 0.01;
            
            let markerClass = 'available';
            if (lot.available_slots === 0) markerClass = 'occupied';
            else if (lot.available_slots < lot.total_slots * 0.3) markerClass = 'reserved';

            const marker = L.marker([lat, lng], {
                icon: L.divIcon({
                    html: `<div class="custom-marker ${markerClass}"></div>`,
                    className: 'custom-div-icon',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            }).addTo(this.map)
            .bindPopup(`
                <div class="marker-popup">
                    <h4>${lot.name}</h4>
                    <p><i class="fas fa-map-marker-alt"></i> ${lot.address}</p>
                    <p><i class="fas fa-parking"></i> ${lot.available_slots}/${lot.total_slots} available</p>
                    <button class="btn btn-primary" onclick="app.viewParkingLot('${lot.id}')">View Slots</button>
                </div>
            `).on('click', () => this.showLocationInfo(lot));

            this.mapMarkers.push(marker);
        });

        if (this.data.parkingLots.length > 0 && !this.userLocation) {
            const firstLot = this.data.parkingLots[0];
            if (firstLot.latitude && firstLot.longitude) {
                this.map.setView([firstLot.latitude, firstLot.longitude], 13);
            }
        }
    }

    showLocationInfo(lot) {
        const infoElement = document.getElementById('selected-location-info');
        document.getElementById('selected-location-name').textContent = lot.name;
        
        document.getElementById('location-details').innerHTML = `
            <div class="location-detail"><strong>Address:</strong> <span>${lot.address}</span></div>
            <div class="location-detail"><strong>Available Slots:</strong> <span>${lot.available_slots}/${lot.total_slots}</span></div>
            <div class="location-detail"><strong>Occupancy:</strong> <span>${Math.round((1 - lot.available_slots / lot.total_slots) * 100)}%</span></div>
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
        setTimeout(() => this.showParkingSlots(lotId), 300);
    }

    getDirections(lat, lng) {
        const url = this.userLocation 
            ? `https://www.google.com/maps/dir/${this.userLocation.lat},${this.userLocation.lng}/${lat},${lng}`
            : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        window.open(url, '_blank');
        this.showToast('Location opened in Google Maps', 'info');
    }

    clearMapMarkers() {
        this.mapMarkers.forEach(marker => this.map.removeLayer(marker));
        this.mapMarkers = [];
    }

    async downloadData(endpoint, defaultFilename) {
        try {
            this.showToast('Preparing download...', 'info');

            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = defaultFilename;

            if (contentDisposition) {
                const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
                if (matches && matches[1]) {
                    filename = matches[1].replace(/['"]/g, '');
                }
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();

            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            this.showToast(`Downloaded ${filename}`, 'success');
        } catch (error) {
            console.error('Download failed:', error);
            this.showToast('Failed to download data', 'error');
        }
    }

    getUserLocation() {
        if (!navigator.geolocation) {
            this.showToast('Geolocation is not supported by this browser', 'error');
            return;
        }

        this.showToast('Getting your location...', 'info');
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                this.map.setView([this.userLocation.lat, this.userLocation.lng], 15);
                
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
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
        );
    }
}

const app = new SmartParkingApp();