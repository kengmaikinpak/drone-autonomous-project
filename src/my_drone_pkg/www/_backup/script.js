// 1. Initialize Icons
lucide.createIcons();

// 2. Initialize Map
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([14.039498, 100.606766], 15); // BU C2 Building default

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
}).addTo(map);



const droneIcon = L.divIcon({
    html: `
        <div class="relative">
            <!-- 
              Shape: Square with Top-Right corner sharp (rounded-tr-none), others full rounded.
              Initial State (0 deg rotation): Points to Top-Right.
              We control rotation in JS.
             -->
            <div class="absolute -top-5 -left-5 w-10 h-10 bg-blue-500 rounded-tl-full rounded-bl-full rounded-br-full rounded-tr-[200rem] border-2 border-white shadow-xl flex items-center justify-center">
                <!-- Rotate SVG 45deg so it points to the sharp corner (Top-Right) -->
                <svg style="transform: rotate(45deg);" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-drone-icon lucide-drone"><path d="M10 10 7 7"/><path d="m10 14-3 3"/><path d="m14 10 3-3"/><path d="m14 14 3 3"/><path d="M14.205 4.139a4 4 0 1 1 5.439 5.863"/><path d="M19.637 14a4 4 0 1 1-5.432 5.868"/><path d="M4.367 10a4 4 0 1 1 5.438-5.862"/><path d="M9.795 19.862a4 4 0 1 1-5.429-5.873"/><rect x="10" y="8" width="4" height="8" rx="1"/></svg>
            </div>
        </div>`,
    className: 'custom-div-icon'
});
const droneMarker = L.marker([14.039498, 100.606766], { icon: droneIcon }).addTo(map);

// 3. ROS 2 Connection Logic
const ros = new ROSLIB.Ros({
    url: 'ws://localhost:9090' // IP ของคอมพิวเตอร์ A (เครื่องที่รัน Rosbridge)
});

const connIndicator = document.getElementById('ros-conn-indicator');
const startBtn = document.getElementById('btn-start-mission');
const missionStatus = document.getElementById('mission-status');

// Connection Events
ros.on('connection', () => {
    connIndicator.innerHTML = '<span class="text-[9px] font-bold text-green-500 uppercase">Online</span><div class="w-2 h-2 rounded-full bg-green-500"></div>';
    updateHealthStatus('health-fcu', true);
    if (startBtn) startBtn.disabled = false; // Enable button on connection
    // Simulate Wifi/CPU health
    setTimeout(() => {
        updateHealthStatus('health-wifi', true);
        updateHealthStatus('health-gcs', true);
    }, 1000);
});

ros.on('error', () => {
    connIndicator.innerHTML = '<span class="text-[9px] font-bold text-red-500 uppercase">Error</span><div class="w-2 h-2 rounded-full bg-red-500"></div>';
    updateHealthStatus('health-fcu', false);
    if (startBtn) startBtn.disabled = true;
});

ros.on('close', () => {
    connIndicator.innerHTML = '<span class="text-[9px] font-bold text-slate-400 uppercase">Offline</span><div class="w-2 h-2 rounded-full bg-slate-400"></div>';
    updateHealthStatus('health-fcu', false);
    if (startBtn) startBtn.disabled = true;
});

// Subscribers
const stateSub = new ROSLIB.Topic({
    ros: ros, name: '/mavros/state', messageType: 'mavros_msgs/msg/State'
});

stateSub.subscribe((msg) => {
    document.getElementById('val-mode').innerText = msg.mode;

    // Style update based on mode
    const modeEl = document.getElementById('val-mode');
    if (msg.mode === 'OFFBOARD') {
        modeEl.className = 'font-bold text-green-500 uppercase';
        missionStatus.innerText = 'MISSION ACTIVE';
        missionStatus.className = 'text-green-500 font-bold';
    } else {
        modeEl.className = 'font-bold text-blue-500 uppercase';
    }

    updateHealthStatus('health-arm', msg.armed);

    // Reset Mission Button if drone disarms (Mission Finished)
    // Only reset if it has armed at least once (prevent immediate reset on start)
    if (msg.armed) {
        if (startBtn) startBtn.dataset.hasArmed = 'true';
    }

    if (!msg.armed && startBtn && startBtn.disabled) {
        // If we were tracking an active mission (hasArmed=true)
        if (startBtn.dataset.hasArmed === 'true') {
            startBtn.disabled = false;
            startBtn.innerText = 'START MISSION';
            if (missionStatus) {
                missionStatus.innerText = 'READY';
                missionStatus.className = 'text-slate-500 font-bold';
            }
            console.log('Mission finished (Disarmed), button reset.');
            startBtn.dataset.hasArmed = 'false'; // Reset state
            showMissionCompleteModal(); // Show modal when mission finishes
        }
    }
});

const globalPosSub = new ROSLIB.Topic({
    ros: ros, name: '/mavros/global_position/global', messageType: 'sensor_msgs/msg/NavSatFix'
});

let homePosition = null; // Store first GPS fix as home

globalPosSub.subscribe((msg) => {
    if (msg.latitude && msg.longitude) {
        const lat = msg.latitude.toFixed(6);
        const lon = msg.longitude.toFixed(6);
        document.getElementById('val-coords').innerText = `${lat}, ${lon}`;
        droneMarker.setLatLng([msg.latitude, msg.longitude]);
        map.panTo([msg.latitude, msg.longitude]); // Follow drone

        // Store home position on first fix
        if (!homePosition) {
            homePosition = { lat: msg.latitude, lng: msg.longitude };
            console.log("Home position set to:", homePosition);
        }

        updateWaypointLines(); // Redraw lines to start from current drone location

        // Simple GPS status check (if we have fix)
        updateHealthStatus('health-gps', msg.status.status >= 0);
    }
});

const relAltSub = new ROSLIB.Topic({
    ros: ros, name: '/mavros/global_position/rel_alt', messageType: 'std_msgs/msg/Float64'
});

relAltSub.subscribe((msg) => {
    // Height from ground
    document.getElementById('val-height').innerText = msg.data.toFixed(1);
});

const vfrSub = new ROSLIB.Topic({
    ros: ros, name: '/mavros/vfr_hud', messageType: 'mavros_msgs/msg/VFR_HUD'
});

vfrSub.subscribe((msg) => {
    document.getElementById('val-speed').innerText = Math.round(msg.groundspeed * 3.6); // m/s to km/h
});

const batterySub = new ROSLIB.Topic({
    ros: ros, name: '/mavros/battery', messageType: 'sensor_msgs/msg/BatteryState'
});

batterySub.subscribe((msg) => {
    let pct = msg.percentage;
    if (pct > 1.0) pct /= 100.0; // Fix range if needed
    document.getElementById('val-battery').innerText = Math.round(pct * 100) + '%';
});

// 14. Drone Marker & Heading
const compassSub = new ROSLIB.Topic({
    ros: ros,
    name: '/mavros/global_position/compass_hdg',
    messageType: 'std_msgs/msg/Float64'
});

compassSub.subscribe((msg) => {
    const heading = msg.data;
    const markerIcon = droneMarker.getElement();
    if (markerIcon) {
        const iconBody = markerIcon.querySelector('.bg-blue-500');
        if (iconBody) {
            iconBody.style.transform = `rotate(${heading - 45}deg)`;
            iconBody.style.transition = 'transform 0.2s linear';
        }
    }
});

// Service Clients

// 1. Mission Start (Custom Trigger)
const missionClient = new ROSLIB.Service({
    ros: ros,
    name: '/mission/start',
    serviceType: 'std_srvs/Trigger'
});

if (startBtn) {
    startBtn.addEventListener('click', () => {
        startBtn.dataset.hasArmed = 'false'; // Reset armed state tracking
        if (missionStatus) missionStatus.innerText = 'SENDING...';
        const req = new ROSLIB.ServiceRequest({});

        missionClient.callService(req, (result) => {
            if (result.success) {
                console.log('Mission Triggered');
                if (missionStatus) {
                    missionStatus.innerText = 'STARTED';
                    missionStatus.className = 'text-green-500 font-bold';
                }
                startBtn.innerText = 'MISSION RUNNING';
                startBtn.disabled = true;
            } else {
                console.error('Mission Failed');
                if (missionStatus) {
                    missionStatus.innerText = 'FAILED';
                    missionStatus.className = 'text-red-500 font-bold';
                }
            }
        }, (err) => {
            console.error('Service Call Error:', err);
            if (missionStatus) {
                missionStatus.innerText = 'ERROR (Check Console)';
                missionStatus.className = 'text-red-500 font-bold';
            }
            startBtn.disabled = false; // Re-enable button on error
            startBtn.innerText = 'START MISSION';
        });
    });
}

// 2. Land (Standard MAVROS)
const landClient = new ROSLIB.Service({
    ros: ros, name: '/mavros/cmd/land', serviceType: 'mavros_msgs/srv/CommandTOL'
});

document.getElementById('btn-land').addEventListener('click', () => {
    const req = new ROSLIB.ServiceRequest({});
    missionStatus.innerText = 'CANCELLING...';
    missionStatus.className = 'text-orange-500 font-bold';

    landClient.callService(req, (res) => {
        console.log('Land Command Sent', res);
    });
});


// Helper: Update Health UI
function updateHealthStatus(id, isHealthy) {
    const el = document.getElementById(id);
    if (!el) return;

    if (isHealthy) {
        el.className = "p-2 bg-green-50 rounded-full text-green-500";
    } else {
        el.className = "p-2 bg-slate-50 rounded-full text-slate-400";
    }
}

// ===================================================
// Mission Waypoint Selection Mode
// ===================================================

let missionMode = false;
let waypoints = [];
try {
    const saved = localStorage.getItem('droneWaypoints');
    if (saved) {
        waypoints = JSON.parse(saved);
    }
} catch (e) {
    console.error('Failed to load waypoints', e);
}
let waypointMarkers = [];
let waypointLines = null;

const missionBtn = document.getElementById('btn-mission');
const missionPanel = document.getElementById('mission-panel');
const waypointListEl = document.getElementById('waypoint-list');
const waypointCountEl = document.getElementById('waypoint-count');
const clearWaypointsBtn = document.getElementById('btn-clear-waypoints');
const confirmMissionBtn = document.getElementById('btn-confirm-mission');
const closeMissionBtn = document.getElementById('btn-close-mission');

// Waypoint marker icon factory
function createWaypointIcon(number) {
    return L.divIcon({
        html: `
            <div class="relative">
                <div class="absolute -top-5 -left-5 w-10 h-10 bg-orange-500 rounded-full border-2 border-white shadow-xl flex items-center justify-center text-white font-bold text-sm">
                    ${number}
                </div>
            </div>`,
        className: 'waypoint-marker'
    });
}

// Toggle mission mode
function toggleMissionMode() {
    missionMode = !missionMode;

    if (missionMode) {
        missionBtn.classList.remove('text-slate-400');
        missionBtn.classList.add('text-blue-500');
        missionPanel.classList.remove('hidden');
        map.getContainer().style.cursor = 'crosshair';
    } else {
        missionBtn.classList.remove('text-blue-500');
        missionBtn.classList.add('text-slate-400');
        missionPanel.classList.add('hidden');
        map.getContainer().style.cursor = '';
    }

    // Reinitialize icons after adding new elements
    lucide.createIcons();
}

// Add waypoint
function addWaypoint(latlng) {
    const defaultAltInput = document.getElementById('input-default-alt');
    let altitudeVal = 3.0; // Default altitude
    if (defaultAltInput) {
        const parsed = parseFloat(defaultAltInput.value);
        if (!isNaN(parsed) && parsed > 0) {
            altitudeVal = parsed;
        } else {
            defaultAltInput.value = "3.0";
        }
    }

    const index = waypoints.length;
    waypoints.push({
        lat: latlng.lat,
        lng: latlng.lng,
        altitude: altitudeVal
    });

    // Add marker on map
    const marker = L.marker(latlng, { icon: createWaypointIcon(index + 1) }).addTo(map);
    waypointMarkers.push(marker);

    // Draw polyline connecting waypoints
    updateWaypointLines();

    // Update UI
    syncWaypoints();
}

// Remove waypoint
function removeWaypoint(index) {
    waypoints.splice(index, 1);

    // Remove marker from map
    map.removeLayer(waypointMarkers[index]);
    waypointMarkers.splice(index, 1);

    // Update remaining marker numbers
    waypointMarkers.forEach((marker, i) => {
        marker.setIcon(createWaypointIcon(i + 1));
    });

    updateWaypointLines();
    syncWaypoints();
}

// Clear all waypoints
function clearWaypoints() {
    waypoints = [];
    waypointMarkers.forEach(marker => map.removeLayer(marker));
    waypointMarkers = [];

    if (waypointLines) {
        map.removeLayer(waypointLines);
        waypointLines = null;
    }

    syncWaypoints();
}

// Update polyline
function updateWaypointLines() {
    if (waypointLines) {
        map.removeLayer(waypointLines);
    }

    if (waypoints.length > 0) {
        let latlngs = [];
        // Connect home to drone current pos, then to waypoints
        if (homePosition) {
            latlngs.push([homePosition.lat, homePosition.lng]);
        }

        const dronePos = droneMarker.getLatLng();
        latlngs.push([dronePos.lat, dronePos.lng]);

        latlngs.push(...waypoints.map(wp => [wp.lat, wp.lng]));

        waypointLines = L.polyline(latlngs, {
            color: '#f97316',
            weight: 3,
            opacity: 0.8,
            dashArray: '10, 10'
        }).addTo(map);
    }
}

function syncWaypoints() {
    localStorage.setItem('droneWaypoints', JSON.stringify(waypoints));
    updateWaypointListUI();
    updateDashboardQueueUI();
}

function initWaypoints() {
    waypointMarkers.forEach(marker => map.removeLayer(marker));
    waypointMarkers = [];

    waypoints.forEach((wp, index) => {
        const marker = L.marker([wp.lat, wp.lng], { icon: createWaypointIcon(index + 1) }).addTo(map);
        waypointMarkers.push(marker);
    });
    updateWaypointLines();
    updateWaypointListUI();
    updateDashboardQueueUI();
}

// Set up UI on load
initWaypoints();

// Update waypoint list UI
function updateWaypointListUI() {
    if (!waypointListEl) return;

    if (waypoints.length === 0) {
        waypointListEl.innerHTML = '<p class="text-[11px] text-slate-400 text-center py-4">Empty Waypoint</p>';
    } else {
        waypointListEl.innerHTML = waypoints.map((wp, i) => `
            <div class="flex items-center justify-between bg-slate-50 rounded-lg p-2">
                <div class="flex items-center gap-2">
                    <span class="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">${i + 1}</span>
                    <div>
                        <p class="text-[10px] font-bold text-slate-700">${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}</p>
                        <div class="flex items-center gap-1 mt-0.5">
                            <span class="text-[9px] text-slate-400">Alt:</span>
                            <input type="number" value="${wp.altitude}" onchange="updateWaypointAlt(${i}, this.value)" class="w-12 text-[10px] border border-slate-200 rounded px-1 py-0.5 text-center font-bold text-slate-600 bg-white focus:outline-none focus:border-blue-400" step="0.5" />
                            <span class="text-[9px] text-slate-400">m</span>
                        </div>
                    </div>
                </div>
                <button onclick="removeWaypoint(${i})" class="text-red-400 hover:text-red-600 p-1 transition">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
            </div>
        `).join('');
    }

    if (waypointCountEl) {
        waypointCountEl.textContent = `${waypoints.length} Waypoints`;
    }
    lucide.createIcons();
}

function updateDashboardQueueUI() {
    const queueList = document.getElementById('mission-queue-list');
    if (!queueList) return;

    if (waypoints.length === 0) {
        queueList.innerHTML = '<div class="text-[11px] text-slate-400 text-center py-4">No Active Missions</div>';
        return;
    }

    let queueHTML = '';

    if (homePosition && waypoints.length > 0) {
        queueHTML += `
            <div class="flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:border-blue-200 transition group cursor-pointer bg-slate-50 opacity-80">
                <div class="flex items-center gap-3">
                    <div class="w-6 h-6 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold"><i data-lucide="home" class="w-3 h-3"></i></div>
                    <div class="flex flex-col">
                        <span class="text-xs font-bold text-slate-600">Home Position</span>
                        <span class="text-[9px] font-bold text-slate-400">Lat: ${homePosition.lat.toFixed(4)}, Lng: ${homePosition.lng.toFixed(4)}</span>
                    </div>
                </div>
                <span class="text-[10px] font-bold text-slate-500">Takeoff</span>
            </div>
        `;
    }

    queueList.innerHTML = queueHTML + waypoints.map((wp, i) => `
        <div class="flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:border-blue-200 transition group cursor-pointer ${i === 0 ? 'bg-slate-50' : 'bg-white'}">
            <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full ${i === 0 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'} flex items-center justify-center text-[10px] font-bold">${i + 1}</div>
                <div class="flex flex-col">
                    <span class="text-xs font-bold ${i === 0 ? 'text-slate-700' : 'text-slate-600'}">Waypoint ${i + 1}</span>
                    <span class="text-[9px] font-bold text-slate-400">Lat: ${wp.lat.toFixed(4)}, Lng: ${wp.lng.toFixed(4)} • Alt: ${wp.altitude}m</span>
                </div>
            </div>
            <span class="text-[10px] font-bold text-slate-500">${i === 0 ? 'Next' : 'Pending'}</span>
        </div>
    `).join('');

    lucide.createIcons();
}

function updateWaypointAlt(index, value) {
    let alt = parseFloat(value);
    if (isNaN(alt) || alt <= 0) {
        alt = 3.0; // fallback
    }
    waypoints[index].altitude = alt;
    syncWaypoints();
}

// ROS Publisher for waypoints
const waypointsTopic = new ROSLIB.Topic({
    ros: ros,
    name: '/mission/waypoints',
    messageType: 'geometry_msgs/msg/PoseArray'
});

// Convert lat/lng to local coordinates (relative to first waypoint)
function convertToLocalCoords(wps) {
    if (wps.length === 0) return [];

    const poses = [];
    const dronePos = droneMarker.getLatLng();
    const baseLat = dronePos.lat;
    const baseLng = dronePos.lng;

    // Rough conversion: 1 degree lat ≈ 111320m, 1 degree lng ≈ 111320 * cos(lat)m
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(baseLat * Math.PI / 180);

    wps.forEach((wp, i) => {
        // ENU Coordinate System: X = East, Y = North
        // Latitude = North/South (Y axis)
        // Longitude = East/West (X axis)
        const x = (wp.lng - baseLng) * metersPerDegreeLng; // Longitude diff -> X (East)
        const y = (wp.lat - baseLat) * metersPerDegreeLat; // Latitude diff  -> Y (North)

        poses.push({
            position: { x: x, y: y, z: wp.altitude },
            orientation: { x: 0, y: 0, z: 0, w: 1 }
        });
    });

    return poses;
}

// Send waypoints to ROS
function sendMissionToROS() {
    if (waypoints.length === 0) {
        console.warn('No waypoints to send');
        return;
    }

    const poses = convertToLocalCoords(waypoints);

    const msg = new ROSLIB.Message({
        header: {
            stamp: { sec: 0, nanosec: 0 },
            frame_id: 'map'
        },
        poses: poses
    });

    waypointsTopic.publish(msg);
    console.log('Mission waypoints sent to ROS:', poses);

    // Update UI
    missionStatus.innerText = 'WAYPOINTS SENT';
    missionStatus.className = 'text-green-500 font-bold';

    // Close mission panel
    toggleMissionMode();
}

// Event Listeners
if (missionBtn) missionBtn.addEventListener('click', toggleMissionMode);
if (closeMissionBtn) closeMissionBtn.addEventListener('click', toggleMissionMode);
if (clearWaypointsBtn) clearWaypointsBtn.addEventListener('click', clearWaypoints);
if (confirmMissionBtn) confirmMissionBtn.addEventListener('click', sendMissionToROS);

// Map click handler
map.on('click', function (e) {
    if (missionMode) {
        addWaypoint(e.latlng);
    }
});

// Helper functions for footer buttons
function centerMapOnDrone() {
    const pos = droneMarker.getLatLng();
    map.setView(pos, 18);
}

function returnToHome() {
    console.log('Return to Home command');
    // Could call a ROS service here
}

// ===================================================
// Mission Complete Modal Logic
// ===================================================
function showMissionCompleteModal() {
    const modal = document.getElementById('mission-complete-modal');
    if (modal) {
        modal.classList.remove('hidden');
        lucide.createIcons(); // Re-render icons for modal if needed
    }

    // Update the waypoints info text if needed
    const resumeWpEl = document.getElementById('val-resume-wp');
    if (resumeWpEl) {
        resumeWpEl.innerText = '1';
    }
}

function hideMissionCompleteModal() {
    const modal = document.getElementById('mission-complete-modal');
    if (modal) modal.classList.add('hidden');
}

const btnCloseModal = document.getElementById('btn-close-modal');
const btnLeavePlan = document.getElementById('btn-leave-plan');
const btnRemovePlan = document.getElementById('btn-remove-plan');
const btnResumeMission = document.getElementById('btn-resume-mission');

if (btnCloseModal) btnCloseModal.addEventListener('click', hideMissionCompleteModal);
if (btnLeavePlan) btnLeavePlan.addEventListener('click', hideMissionCompleteModal);
if (btnRemovePlan) btnRemovePlan.addEventListener('click', () => {
    clearWaypoints();
    hideMissionCompleteModal();
});
if (btnResumeMission) btnResumeMission.addEventListener('click', hideMissionCompleteModal);

// Cross-tab synchronization via localStorage
window.addEventListener('storage', (e) => {
    if (e.key === 'droneWaypoints') {
        try {
            const saved = e.newValue;
            waypoints = saved ? JSON.parse(saved) : [];
            initWaypoints(); // Redraw UI and map markers
        } catch (err) {
            console.error('Failed to sync waypoints across tabs', err);
        }
    }
});
