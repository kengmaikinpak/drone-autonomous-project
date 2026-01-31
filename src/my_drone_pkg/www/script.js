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

// Drone Marker
const droneIcon = L.divIcon({
    html: `
        <div class="relative">
            <!-- ส่วนที่ทำหน้าที่เป็นตัวโดรนสีฟ้า (ใช้ Tailwind แทน .marker-pin) -->
            <div class="absolute -top-4 -left-4 w-8 h-8 bg-blue-500 rounded-full border-0 border-white shadow-xl flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-drone-icon lucide-drone"><path d="M10 10 7 7"/><path d="m10 14-3 3"/><path d="m14 10 3-3"/><path d="m14 14 3 3"/><path d="M14.205 4.139a4 4 0 1 1 5.439 5.863"/><path d="M19.637 14a4 4 0 1 1-5.432 5.868"/><path d="M4.367 10a4 4 0 1 1 5.438-5.862"/><path d="M9.795 19.862a4 4 0 1 1-5.429-5.873"/><rect x="10" y="8" width="4" height="8" rx="1"/></svg>
            </div>
        </div>`,
    className: 'custom-div-icon'
});
const droneMarker = L.marker([14.039498, 100.606766], { icon: droneIcon }).addTo(map);

// 3. ROS 2 Connection Logic
const ros = new ROSLIB.Ros({
    url: 'ws://localhost:9090'
});

const connIndicator = document.getElementById('ros-conn-indicator');
const startBtn = document.getElementById('btn-start-mission');
const missionStatus = document.getElementById('mission-status');

// Connection Events
ros.on('connection', () => {
    connIndicator.innerHTML = '<span class="text-[9px] font-bold text-green-500 uppercase">Online</span><div class="w-2 h-2 rounded-full bg-green-500"></div>';
    updateHealthStatus('health-fcu', true);
    startBtn.disabled = false; // Enable button on connection
    // Simulate Wifi/CPU health
    setTimeout(() => {
        updateHealthStatus('health-wifi', true);
        updateHealthStatus('health-cpu', true);
    }, 1000);
});

ros.on('error', () => {
    connIndicator.innerHTML = '<span class="text-[9px] font-bold text-red-500 uppercase">Error</span><div class="w-2 h-2 rounded-full bg-red-500"></div>';
    updateHealthStatus('health-fcu', false);
    startBtn.disabled = true;
});

ros.on('close', () => {
    connIndicator.innerHTML = '<span class="text-[9px] font-bold text-slate-400 uppercase">Offline</span><div class="w-2 h-2 rounded-full bg-slate-400"></div>';
    updateHealthStatus('health-fcu', false);
    startBtn.disabled = true;
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
});

const globalPosSub = new ROSLIB.Topic({
    ros: ros, name: '/mavros/global_position/global', messageType: 'sensor_msgs/msg/NavSatFix'
});

globalPosSub.subscribe((msg) => {
    if (msg.latitude && msg.longitude) {
        const lat = msg.latitude.toFixed(6);
        const lon = msg.longitude.toFixed(6);
        document.getElementById('val-coords').innerText = `${lat}, ${lon}`;
        droneMarker.setLatLng([msg.latitude, msg.longitude]);
        map.panTo([msg.latitude, msg.longitude]); // Follow drone

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

// Service Clients

// 1. Mission Start (Custom Trigger)
const missionClient = new ROSLIB.Service({
    ros: ros,
    name: '/mission/start',
    serviceType: 'std_srvs/Trigger'
});

startBtn.addEventListener('click', () => {
    missionStatus.innerText = 'SENDING...';
    const req = new ROSLIB.ServiceRequest({});

    missionClient.callService(req, (result) => {
        if (result.success) {
            console.log('Mission Triggered');
            missionStatus.innerText = 'STARTED';
            missionStatus.className = 'text-green-500 font-bold';
            startBtn.innerText = 'MISSION RUNNING';
            startBtn.disabled = true;
        } else {
            console.error('Mission Failed');
            missionStatus.innerText = 'FAILED';
            missionStatus.className = 'text-red-500 font-bold';
        }
    }, (err) => {
        console.error(err);
        missionStatus.innerText = 'ERROR';
        missionStatus.className = 'text-red-500 font-bold';
    });
});

// 2. Land (Standard MAVROS)
const landClient = new ROSLIB.Service({
    ros: ros, name: '/mavros/cmd/land', serviceType: 'mavros_msgs/srv/CommandTOL'
});

document.getElementById('btn-land').addEventListener('click', () => {
    const req = new ROSLIB.ServiceRequest({});
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
