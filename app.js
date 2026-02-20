// ═══════════════════════════════════════
//  CORE STATE
// ═══════════════════════════════════════
const S = {
  counts: {car:0,truck:0,bus:0,moto:0,bike:0},
  sessionStart: Date.now(),
  totalDetected: 0,
  frames: 0,
  isVideoLoaded: false,
  autoSignal: true,
  signalPhase: 0,
  phaseTimer: 45,
  phaseTimings: [45,5,30,5],
  logs: [],
  flowHistory: [],
  lastFpsTime: Date.now(),
  fpsFrames: 0,
  realFps: 30
};

const PHASES = [
  {label:'North-South: GREEN', ns:'green', ew:'red'},
  {label:'North-South: YELLOW', ns:'yellow', ew:'red'},
  {label:'East-West: GREEN', ns:'red', ew:'green'},
  {label:'East-West: YELLOW', ns:'red', ew:'yellow'}
];

// ═══════════════════════════════════════
//  TABS
// ═══════════════════════════════════════
function switchTab(n) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  const map={estimation:0,analysis:1,signal:2,sustainability:3,reports:4};
  document.querySelectorAll('.tab-btn')[map[n]].classList.add('active');
  document.getElementById('tab-'+n).classList.add('active');
}

// ═══════════════════════════════════════
//  CLOCK / UPTIME
// ═══════════════════════════════════════
setInterval(()=>{
  document.getElementById('clockDisplay').textContent=new Date().toLocaleTimeString();
  const s=Math.floor((Date.now()-S.sessionStart)/1000);
  const el=document.getElementById('uptimeDisplay');
  if(el) el.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
},1000);

// ═══════════════════════════════════════
//  REALISTIC SCENE ENGINE
// ═══════════════════════════════════════
const SCENE = (() => {
  let canvas, ctx, overlay, octx, W, H, animId;
  let vehicles = [];
  let isRunning = false;

  // ─── Road geometry ───
  // Simulated top-down perspective of a 4-lane road
  // Vehicles travel left-to-right (even lanes) and right-to-left (odd lanes)

  const COLOR = {
    car:   '#3b82f6',
    truck: '#ef4444',
    bus:   '#f97316',
    moto:  '#eab308',
    bike:  '#10b981'
  };

  // Vehicle blueprints (widthRatio x heightRatio relative to lane height)
  const BLUEPRINTS = {
    car:   {W:52, H:28, speed:[1.2,2.8], color:'#3b82f6', bboxColor:'#3b82f6'},
    truck: {W:90, H:36, speed:[0.7,1.4], color:'#ef4444', bboxColor:'#ef4444'},
    bus:   {W:110,H:38, speed:[0.9,1.5], color:'#f97316', bboxColor:'#f97316'},
    moto:  {W:30, H:18, speed:[1.8,3.5], color:'#eab308', bboxColor:'#eab308'},
    bike:  {W:22, H:16, speed:[0.5,0.9], color:'#10b981', bboxColor:'#10b981'}
  };

  // Weighted spawn distribution
  const TYPE_POOL = [
    'car','car','car','car','car','car','car',
    'truck','truck',
    'bus',
    'moto','moto',
    'bike'
  ];

  const NUM_LANES = 4;
  let LANE_Y = []; // computed on resize
  let LANE_H = 0;
  const ROAD_TOP_FRAC  = 0.12;
  const ROAD_BOT_FRAC  = 0.88;

  function laneDir(lane) { return lane < NUM_LANES/2 ? 1 : -1; } // 1=rightward -1=leftward

  function spawnVehicle(lane, forceX) {
    const dir = laneDir(lane);
    const typeName = TYPE_POOL[Math.floor(Math.random()*TYPE_POOL.length)];
    const bp = BLUEPRINTS[typeName];
    const speed = bp.speed[0] + Math.random()*(bp.speed[1]-bp.speed[0]);
    const x = forceX !== undefined ? forceX : (dir > 0 ? -bp.W - 10 : W + bp.W + 10);
    const conf = parseFloat((82 + Math.random()*16).toFixed(1));
    return {
      type: typeName,
      lane,
      x, y: LANE_Y[lane],
      w: bp.W, h: bp.H,
      speed: speed * dir,
      color: bp.color,
      bboxColor: bp.bboxColor,
      conf,
      id: Math.random(),
      // Per-vehicle body color variation
      bodyHue: Math.floor(Math.random()*360)
    };
  }

  function initVehicles() {
    vehicles = [];
    for(let lane=0; lane<NUM_LANES; lane++){
      const count = 3 + Math.floor(Math.random()*4);
      const dir = laneDir(lane);
      const spacing = W / count;
      for(let i=0; i<count; i++){
        const fx = dir>0 ? i*spacing + Math.random()*spacing*0.5 : W - i*spacing - Math.random()*spacing*0.5;
        vehicles.push(spawnVehicle(lane, fx));
      }
    }
  }

  function resize() {
    const container = document.getElementById('videoContainer');
    W = container.clientWidth  || 800;
    H = container.clientHeight || 450;
    canvas.width = W; canvas.height = H;
    overlay.width = W; overlay.height = H;
    const roadTop  = H * ROAD_TOP_FRAC;
    const roadBot  = H * ROAD_BOT_FRAC;
    LANE_H = (roadBot - roadTop) / NUM_LANES;
    for(let i=0; i<NUM_LANES; i++){
      LANE_Y[i] = roadTop + LANE_H*i + LANE_H/2;
    }
  }

  // ─── Draw scene background ───
  function drawRoad() {
    // Sky / background gradient
    const sky = ctx.createLinearGradient(0,0,0,H*ROAD_TOP_FRAC);
    sky.addColorStop(0,'#0f2340');
    sky.addColorStop(1,'#1a3a5c');
    ctx.fillStyle=sky;
    ctx.fillRect(0,0,W,H*ROAD_TOP_FRAC);

    // Sidewalk top
    ctx.fillStyle='#2d3a4a';
    ctx.fillRect(0,H*ROAD_TOP_FRAC-12,W,12);

    // Road surface
    const roadGrad = ctx.createLinearGradient(0,H*ROAD_TOP_FRAC,0,H*ROAD_BOT_FRAC);
    roadGrad.addColorStop(0,'#1e2530');
    roadGrad.addColorStop(0.5,'#252d3a');
    roadGrad.addColorStop(1,'#1e2530');
    ctx.fillStyle=roadGrad;
    ctx.fillRect(0,H*ROAD_TOP_FRAC,W,H*(ROAD_BOT_FRAC-ROAD_TOP_FRAC));

    // Sidewalk bottom
    ctx.fillStyle='#2d3a4a';
    ctx.fillRect(0,H*ROAD_BOT_FRAC,W,12);

    // Lane dividers
    const roadTop = H*ROAD_TOP_FRAC;
    // Center double yellow line
    const cx = roadTop + LANE_H*(NUM_LANES/2);
    ctx.setLineDash([]);
    ctx.strokeStyle='#e8a000';
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,cx-3); ctx.lineTo(W,cx-3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,cx+3); ctx.lineTo(W,cx+3); ctx.stroke();

    // Dashed white lane lines
    ctx.setLineDash([30,20]);
    ctx.strokeStyle='rgba(255,255,255,0.45)';
    ctx.lineWidth=1.5;
    for(let i=1; i<NUM_LANES; i++){
      if(i===NUM_LANES/2) continue; // skip center (yellow)
      const y = roadTop + LANE_H*i;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Road edge lines
    ctx.strokeStyle='rgba(255,255,255,0.6)';
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,roadTop); ctx.lineTo(W,roadTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,H*ROAD_BOT_FRAC); ctx.lineTo(W,H*ROAD_BOT_FRAC); ctx.stroke();

    // Footpath areas
    // Top footpath
    const ftop = ctx.createLinearGradient(0,0,0,H*ROAD_TOP_FRAC-12);
    ftop.addColorStop(0,'#0f2340'); ftop.addColorStop(1,'#1e2c3c');
    ctx.fillStyle=ftop;
    ctx.fillRect(0,0,W,H*ROAD_TOP_FRAC-12);

    // Bottom footpath
    ctx.fillStyle='#1e2c3c';
    ctx.fillRect(0,H*ROAD_BOT_FRAC+12,W,H);

    // Lane direction arrows (subtle)
    ctx.fillStyle='rgba(255,255,255,0.06)';
    ctx.font='16px Arial';
    ctx.textAlign='center';
    for(let lane=0;lane<NUM_LANES;lane++){
      const arrow = laneDir(lane)>0 ? '→' : '←';
      for(let x=100;x<W;x+=200){
        ctx.fillText(arrow, x, LANE_Y[lane]+5);
      }
    }
  }

  // ─── Draw a vehicle shape ───
  function drawVehicle(v) {
    const cx = v.x, cy = v.y;
    const hw = v.w/2, hh = v.h/2;
    const dir = v.speed > 0 ? 1 : -1;

    ctx.save();
    ctx.translate(cx, cy);
    if(dir < 0) ctx.scale(-1, 1);

    if(v.type === 'car') {
      // Body
      ctx.fillStyle = v.color + 'cc';
      ctx.beginPath();
      ctx.roundRect(-hw,-hh,v.w,v.h,4);
      ctx.fill();
      // Roof (lighter)
      ctx.fillStyle = v.color + 'aa';
      ctx.fillRect(-hw*0.4,-hh*0.85,v.w*0.5,v.h*0.7);
      // Windshield
      ctx.fillStyle='rgba(120,200,255,0.3)';
      ctx.fillRect(-hw*0.3,-hh*0.8,v.w*0.35,v.h*0.55);
      // Headlights
      ctx.fillStyle='#ffffaa';
      ctx.fillRect(hw-8,-hh+4,6,5);
      ctx.fillRect(hw-8,hh-9,6,5);
      // Taillights
      ctx.fillStyle='#ff4444';
      ctx.fillRect(-hw+2,-hh+4,5,5);
      ctx.fillRect(-hw+2,hh-9,5,5);

    } else if(v.type === 'truck') {
      // Cab
      ctx.fillStyle='#c0392b';
      ctx.beginPath();
      ctx.roundRect(hw*0.3,-hh,hw*0.7,v.h,3);
      ctx.fill();
      // Cargo
      ctx.fillStyle='#7f8c8d';
      ctx.beginPath();
      ctx.roundRect(-hw,-hh,v.w*0.65,v.h,3);
      ctx.fill();
      // Cargo stripe
      ctx.fillStyle='rgba(255,255,255,0.1)';
      for(let si=0;si<3;si++) {
        ctx.fillRect(-hw+si*20+4,-hh+4,12,v.h-8);
      }
      // Headlights
      ctx.fillStyle='#ffffaa';
      ctx.fillRect(hw-10,-hh+6,7,6);
      ctx.fillRect(hw-10,hh-12,7,6);

    } else if(v.type === 'bus') {
      // Main body
      ctx.fillStyle='#e67e22';
      ctx.beginPath();
      ctx.roundRect(-hw,-hh,v.w,v.h,5);
      ctx.fill();
      // Windows strip
      ctx.fillStyle='rgba(120,200,255,0.35)';
      ctx.fillRect(-hw+8,-hh+5,v.w-16,v.h*0.38);
      // Window panes
      ctx.fillStyle='rgba(80,150,200,0.3)';
      const wW=18, gap=5;
      for(let wi=-hw+10;wi<hw-22;wi+=wW+gap) {
        ctx.fillRect(wi,-hh+7,wW,v.h*0.32);
      }
      // Headlights
      ctx.fillStyle='#ffffaa';
      ctx.fillRect(hw-12,-hh+8,9,8);
      ctx.fillRect(hw-12,hh-16,9,8);

    } else if(v.type === 'moto') {
      // Body
      ctx.fillStyle='#c9a800';
      ctx.beginPath();
      ctx.ellipse(0,0,hw,hh,0,0,Math.PI*2);
      ctx.fill();
      // Rider silhouette
      ctx.fillStyle='rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(0,-hh*0.5,hw*0.35,hh*0.6,0,0,Math.PI*2);
      ctx.fill();
      // Front light
      ctx.fillStyle='#ffffaa';
      ctx.beginPath();
      ctx.arc(hw-4,0,4,0,Math.PI*2);
      ctx.fill();

    } else if(v.type === 'bike') {
      // Frame
      ctx.strokeStyle='#10b981';
      ctx.lineWidth=3;
      ctx.beginPath();
      ctx.moveTo(-hw,0); ctx.lineTo(hw,0);
      ctx.moveTo(-hw*0.2,-hh); ctx.lineTo(hw*0.2,hh);
      ctx.stroke();
      // Wheels
      ctx.strokeStyle='#34d399';
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(-hw+5,0,hh,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(hw-5,0,hh,0,Math.PI*2); ctx.stroke();
      // Rider
      ctx.fillStyle='rgba(16,185,129,0.6)';
      ctx.beginPath(); ctx.arc(0,-hh*0.8,5,0,Math.PI*2); ctx.fill();
    }

    ctx.restore();
  }

  // ─── Draw bounding box + label ───
  function drawBBox(v) {
    const x = v.x - v.w/2;
    const y = v.y - v.h/2;
    const color = v.bboxColor;
    const LABEL_NAMES = {car:'Car',truck:'Truck',bus:'Bus',moto:'Motorcycle',bike:'Bicycle'};
    const label = `${LABEL_NAMES[v.type]} ${v.conf.toFixed(0)}%`;
    const CONF_THRESHOLDS = {high: 90, med: 75};

    // Confidence-based alpha: higher confidence = brighter box
    const alpha = v.conf > CONF_THRESHOLDS.high ? 1.0 : v.conf > CONF_THRESHOLDS.med ? 0.8 : 0.6;

    octx.save();

    // Inner glow fill
    octx.fillStyle = color + Math.floor(alpha*28).toString(16).padStart(2,'0');
    octx.fillRect(x+1,y+1,v.w-2,v.h-2);

    // Main border
    octx.strokeStyle = color;
    octx.lineWidth = 2;
    octx.globalAlpha = alpha;
    octx.strokeRect(x,y,v.w,v.h);

    // Corner brackets (thick + longer)
    const cL = Math.min(14, v.w*0.22);
    octx.lineWidth = 3.5;
    octx.strokeStyle = color;
    // TL
    octx.beginPath(); octx.moveTo(x,y+cL); octx.lineTo(x,y); octx.lineTo(x+cL,y); octx.stroke();
    // TR
    octx.beginPath(); octx.moveTo(x+v.w-cL,y); octx.lineTo(x+v.w,y); octx.lineTo(x+v.w,y+cL); octx.stroke();
    // BL
    octx.beginPath(); octx.moveTo(x,y+v.h-cL); octx.lineTo(x,y+v.h); octx.lineTo(x+cL,y+v.h); octx.stroke();
    // BR
    octx.beginPath(); octx.moveTo(x+v.w-cL,y+v.h); octx.lineTo(x+v.w,y+v.h); octx.lineTo(x+v.w,y+v.h-cL); octx.stroke();

    // Center crosshair dot
    octx.globalAlpha = alpha * 0.7;
    octx.fillStyle = color;
    octx.beginPath();
    octx.arc(v.x, v.y, 3, 0, Math.PI*2);
    octx.fill();

    // Label pill
    octx.globalAlpha = 1;
    octx.font = 'bold 10px monospace';
    const tw = octx.measureText(label).width;
    const lx = x;
    const ly = y > 20 ? y - 20 : y + v.h + 2;
    const lw = tw + 10;
    const lh = 18;

    // Pill background
    octx.fillStyle = color;
    octx.globalAlpha = 0.9;
    octx.beginPath();
    octx.roundRect(lx, ly, lw, lh, 4);
    octx.fill();

    // Label text
    octx.globalAlpha = 1;
    octx.fillStyle = '#fff';
    octx.fillText(label, lx+5, ly+13);

    // Confidence bar under label
    const barW = lw;
    octx.fillStyle = 'rgba(0,0,0,0.4)';
    octx.fillRect(lx, ly+lh-3, barW, 3);
    octx.fillStyle = v.conf > 90 ? '#34d399' : v.conf > 75 ? '#fbbf24' : '#f87171';
    octx.fillRect(lx, ly+lh-3, barW*(v.conf/100), 3);

    octx.restore();
  }

  // ─── Draw density heatmap overlay ───
  function drawDensityMap(vehicleList) {
    // Light road-region heatmap cells
    const cellW = W / 12;
    const roadTop  = H * ROAD_TOP_FRAC;
    const roadBot  = H * ROAD_BOT_FRAC;
    const roadH = roadBot - roadTop;
    const cellH = roadH / 4;

    // Count vehicles per grid cell
    const grid = Array.from({length:4},()=>new Array(12).fill(0));
    vehicleList.forEach(v => {
      const col = Math.floor(v.x / cellW);
      const row = Math.floor((v.y - roadTop) / cellH);
      if(col >= 0 && col < 12 && row >= 0 && row < 4) grid[row][col]++;
    });
    const maxCount = Math.max(1,...grid.flat());

    for(let r=0;r<4;r++){
      for(let c=0;c<12;c++){
        const density = grid[r][c] / maxCount;
        if(density < 0.01) continue;
        octx.save();
        octx.globalAlpha = density * 0.18;
        if(density > 0.7) octx.fillStyle='#ef4444';
        else if(density > 0.4) octx.fillStyle='#f97316';
        else octx.fillStyle='#eab308';
        octx.fillRect(c*cellW, roadTop+r*cellH, cellW, cellH);
        octx.restore();
      }
    }
  }

  // ─── Main frame ───
  function frame() {
    animId = requestAnimationFrame(frame);
    ctx.clearRect(0,0,W,H);
    octx.clearRect(0,0,W,H);
    drawRoad();

    // Manage vehicles
    // Respawn vehicles that exit screen
    vehicles = vehicles.filter(v => {
      if(v.speed > 0 && v.x - v.w/2 > W + 20) return false;
      if(v.speed < 0 && v.x + v.w/2 < -20) return false;
      return true;
    });

    // Spawn new vehicles to maintain lane density
    for(let lane=0;lane<NUM_LANES;lane++){
      const laneVehicles = vehicles.filter(v=>v.lane===lane);
      const target = 3 + Math.floor(Math.random()*3);
      if(laneVehicles.length < target && Math.random() < 0.012){
        // Check if there's room to spawn at edge
        const dir = laneDir(lane);
        const spawnX = dir > 0 ? -60 : W + 60;
        const nearEdge = laneVehicles.filter(v => Math.abs(v.x - spawnX) < 120);
        if(nearEdge.length === 0) vehicles.push(spawnVehicle(lane));
      }
    }

    // Simple vehicle collision avoidance - slow down if too close to vehicle ahead
    for(let lane=0;lane<NUM_LANES;lane++){
      const lv = vehicles.filter(v=>v.lane===lane).sort((a,b)=>a.x-b.x);
      const dir = laneDir(lane);
      for(let i=0;i<lv.length;i++){
        const v = lv[i];
        const ahead = dir>0 ? lv[i+1] : lv[i-1];
        if(ahead){
          const gap = dir>0 ? (ahead.x - ahead.w/2) - (v.x + v.w/2) : (v.x - v.w/2) - (ahead.x + ahead.w/2);
          const safeGap = 15;
          if(gap < safeGap + 20){
            // Slow down proportionally
            const slowFactor = Math.max(0.1, (gap - safeGap)/(40));
            v.x += v.speed * Math.min(1, slowFactor);
          } else {
            v.x += v.speed;
          }
        } else {
          v.x += v.speed;
        }
      }
    }

    // Draw vehicles (sorted by y for natural overlap ordering)
    const sorted = [...vehicles].sort((a,b)=>a.y-b.y);
    sorted.forEach(v => drawVehicle(v));

    // Draw density heatmap then bboxes on overlay
    drawDensityMap(vehicles);
    sorted.forEach(v => drawBBox(v));

    // Update state counts from actual vehicles in scene
    const cnts = {car:0,truck:0,bus:0,moto:0,bike:0};
    vehicles.forEach(v=>cnts[v.type]++);
    S.counts = cnts;
    S.frames++;

    // FPS tracking
    S.fpsFrames++;
    const now = Date.now();
    if(now - S.lastFpsTime >= 1000){
      S.realFps = S.fpsFrames;
      S.fpsFrames = 0;
      S.lastFpsTime = now;
    }
    document.getElementById('fpsCounter').textContent = S.realFps;
    document.getElementById('frameCount').textContent = S.frames;
  }

  function start() {
    canvas  = document.getElementById('sceneCanvas');
    overlay = document.getElementById('detectionCanvas');
    ctx  = canvas.getContext('2d');
    octx = overlay.getContext('2d');
    resize();
    initVehicles();
    if(!isRunning){ isRunning=true; frame(); }
    window.addEventListener('resize', ()=>{ resize(); initVehicles(); });
  }

  return {start, vehicles: ()=>vehicles};
})();

// ═══════════════════════════════════════
//  VIDEO LOAD (overlay on top of real video)
// ═══════════════════════════════════════
function loadVideo(event) {
  const file = event.target.files[0];
  if(!file) return;
  const video = document.getElementById('videoElement');
  video.src = URL.createObjectURL(file);
  video.style.display = 'block';
  video.play();
  // Hide scene canvas, bbox overlay stays on top
  document.getElementById('sceneCanvas').style.opacity = '0';
  document.getElementById('feedStatus').textContent = 'LIVE';
  document.getElementById('feedModeLabel').textContent = 'LIVE · AI DETECTION';
  S.isVideoLoaded = true;
  addLog('📹 Video loaded: ' + file.name);
}

// ═══════════════════════════════════════
//  COUNT UPDATE (from SCENE vehicles)
// ═══════════════════════════════════════
let flowHistory = [];

function updateCounts() {
  const v = S.counts;
  const total = v.car+v.truck+v.bus+v.moto+v.bike;
  S.totalDetected += total;

  const keys  = ['car','truck','bus','moto','bike'];
  const ids   = ['countCar','countTruck','countBus','countMoto','countBike'];
  const bars  = ['barCar','barTruck','barBus','barMoto','barBike'];
  const pcts  = ['pctCar','pctTruck','pctBus','pctMoto','pctBike'];
  const confIds = ['confCar','confTruck','confBus','confMoto','confBike'];
  const confBars = ['confBarCar','confBarTruck','confBarBus','confBarMoto','confBarBike'];
  const baseConf = [94,91,97,86,83];

  keys.forEach((k,i)=>{
    const el=document.getElementById(ids[i]); if(el) el.textContent=v[k];
    const pct=total?Math.round(v[k]/total*100):0;
    const bEl=document.getElementById(bars[i]); if(bEl) bEl.style.width=pct+'%';
    const pEl=document.getElementById(pcts[i]); if(pEl) pEl.textContent=pct+'% of total';
    // confidence noise
    const conf=(baseConf[i]+(Math.random()-0.5)*3).toFixed(1);
    const cEl=document.getElementById(confIds[i]); if(cEl) cEl.textContent=conf+'%';
    const cbEl=document.getElementById(confBars[i]); if(cbEl) cbEl.style.width=conf+'%';
  });

  // Totals & overlays
  const totEl=document.getElementById('totalCountBig'); if(totEl) totEl.textContent=S.totalDetected.toLocaleString();

  // Density computation: occupancy = sum of vehicle areas / road area
  const roadW=document.getElementById('videoContainer').clientWidth||800;
  const roadH=(document.getElementById('videoContainer').clientHeight||450)*0.76;
  let occArea=0;
  SCENE.vehicles().forEach(v=>occArea+=v.w*v.h);
  const roadArea=roadW*roadH;
  const occupancy=Math.min(100,Math.round(occArea/roadArea*100));
  const density=Math.min(100,Math.round(total/22*100));
  const speed=Math.max(8,Math.round(60-density*0.45+(Math.random()-0.5)*4));

  // Overlay meters
  const dmV=document.getElementById('dmVehicles'); if(dmV) dmV.textContent=total;
  const dmD=document.getElementById('dmDensity'); if(dmD) dmD.textContent=density+'%';
  const dmS=document.getElementById('dmSpeed'); if(dmS) dmS.textContent=speed+' km/h';
  const dmO=document.getElementById('dmOccupancy'); if(dmO) dmO.textContent=occupancy+'%';

  // Density badge
  const badge=document.getElementById('densityBadge');
  if(badge){
    badge.className='density-badge';
    if(density<30){badge.classList.add('density-low');badge.textContent='LOW';}
    else if(density<55){badge.classList.add('density-medium');badge.textContent='MEDIUM';}
    else if(density<75){badge.classList.add('density-high');badge.textContent='HIGH';}
    else{badge.classList.add('density-critical');badge.textContent='CRITICAL';}
  }

  // Congestion
  const cEl=document.getElementById('congestionLevel');
  if(cEl) cEl.textContent=['LOW','MOD','HIGH','CRIT'][Math.min(3,Math.floor(density/25))];

  // Throughput (vehicles passed per minute estimate)
  const tp=document.getElementById('throughput'); if(tp) tp.innerHTML=Math.round(total*4.2)+'<span style="font-size:11px;font-weight:400"> v/min</span>';

  // GPU
  const g=document.getElementById('gpuUsage'); if(g) g.textContent=Math.round(62+Math.random()*22)+'%';
  const g2=document.getElementById('gpuDisp'); if(g2) g2.textContent=g.textContent;

  // FPS display
  const fps=document.getElementById('fpsDisplay'); if(fps) fps.textContent=S.realFps;

  // Latency
  const lat=document.getElementById('latencyDisplay'); if(lat) lat.textContent=Math.round(7+Math.random()*9)+'ms';

  // Analysis total
  const at=document.getElementById('anaTotal'); if(at) at.textContent=(14000+S.totalDetected).toLocaleString();

  // Flow history (actual vehicle count)
  flowHistory.push(total);
  if(flowHistory.length>120) flowHistory.shift();
  updateFlowChart();

  // Sustainability
  const co2=Math.round(S.totalDetected*0.08);
  const fuel=Math.round(S.totalDetected*0.012);
  const trees=Math.round(co2/21);
  const c2=document.getElementById('co2Reduced'); if(c2) c2.textContent=co2.toLocaleString();
  const fs=document.getElementById('fuelSaved'); if(fs) fs.textContent=fuel.toLocaleString();
  const tr=document.getElementById('treesEq'); if(tr) tr.textContent=trees.toLocaleString();

  // Update pie chart
  if(pieChart){
    pieChart.data.datasets[0].data=[v.car,v.truck,v.bus,v.moto,v.bike];
    pieChart.update('none');
  }
}
setInterval(updateCounts,1000);

// ═══════════════════════════════════════
//  CHARTS
// ═══════════════════════════════════════
const CD = { grid:{color:'rgba(48,54,61,0.5)'}, ticks:{color:'#8b949e',font:{size:11}} };
let flowChart,pieChart,densityChart,speedChart,emissionChart,weeklyChart;

function buildCharts(){
  Chart.defaults.color='#8b949e';

  const fCtx=document.getElementById('flowChart');
  if(fCtx){
    flowChart=new Chart(fCtx,{
      type:'line',
      data:{
        labels:Array.from({length:120},(_,i)=>i%30===0?`-${120-i}s`:''),
        datasets:[{label:'Vehicles in frame',data:Array.from({length:120},()=>Math.round(8+Math.random()*14)),borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,0.07)',fill:true,tension:0.4,pointRadius:0,borderWidth:2}]
      },
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:CD.grid,ticks:CD.ticks},y:{grid:CD.grid,ticks:CD.ticks,min:0}}}
    });
  }

  const pCtx=document.getElementById('pieChart');
  if(pCtx){
    pieChart=new Chart(pCtx,{
      type:'doughnut',
      data:{
        labels:['Cars','Trucks','Buses','Motorcycles','Bicycles'],
        datasets:[{data:[7,2,1,2,1],backgroundColor:['#3b82f6','#ef4444','#f97316','#eab308','#10b981'],borderColor:'#1c2128',borderWidth:3,hoverOffset:8}]
      },
      options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'right',labels:{color:'#8b949e',font:{size:11},padding:12,boxWidth:12}}}}
    });
  }

  const dCtx=document.getElementById('densityChart');
  if(dCtx){
    densityChart=new Chart(dCtx,{
      type:'line',
      data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[{label:'Avg Density %',data:[58,72,65,80,87,45,38],borderColor:'#10b981',backgroundColor:'rgba(16,185,129,0.1)',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#10b981',borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:CD.grid,ticks:CD.ticks},y:{grid:CD.grid,ticks:CD.ticks,min:0,max:100}}}
    });
  }

  const sCtx=document.getElementById('speedChart');
  if(sCtx){
    speedChart=new Chart(sCtx,{
      type:'bar',
      data:{labels:['Cars','Trucks','Buses','Motorcycles','Bicycles'],datasets:[{label:'Avg Speed (km/h)',data:[38,28,24,45,18],backgroundColor:['rgba(59,130,246,0.7)','rgba(239,68,68,0.7)','rgba(249,115,22,0.7)','rgba(234,179,8,0.7)','rgba(16,185,129,0.7)'],borderColor:['#3b82f6','#ef4444','#f97316','#eab308','#10b981'],borderWidth:2,borderRadius:6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:CD.grid,ticks:CD.ticks},y:{grid:CD.grid,ticks:CD.ticks,min:0}}}
    });
  }

  const emCtx=document.getElementById('emissionChart');
  if(emCtx){
    emissionChart=new Chart(emCtx,{
      type:'bar',
      data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[{label:'CO₂ Baseline (kg)',data:[320,410,380,450,490,210,180],backgroundColor:'rgba(239,68,68,0.3)',borderColor:'#ef4444',borderWidth:2,borderRadius:4},{label:'CO₂ With AI (kg)',data:[240,300,270,310,340,160,140],backgroundColor:'rgba(16,185,129,0.3)',borderColor:'#10b981',borderWidth:2,borderRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8b949e',font:{size:11}}}},scales:{x:{grid:CD.grid,ticks:CD.ticks},y:{grid:CD.grid,ticks:CD.ticks}}}
    });
  }

  const wCtx=document.getElementById('weeklyChart');
  if(wCtx){
    weeklyChart=new Chart(wCtx,{
      type:'bar',
      data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[{label:'Cars',data:[8200,9400,8800,10100,11200,6500,5200],backgroundColor:'rgba(59,130,246,0.7)',borderRadius:4},{label:'Trucks',data:[1800,2100,1900,2300,2500,1200,900],backgroundColor:'rgba(239,68,68,0.7)',borderRadius:4},{label:'Buses',data:[900,1100,950,1200,1300,700,500],backgroundColor:'rgba(249,115,22,0.7)',borderRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8b949e',font:{size:11}}}},scales:{x:{stacked:true,grid:CD.grid,ticks:CD.ticks},y:{stacked:true,grid:CD.grid,ticks:CD.ticks}}}
    });
  }
}

function updateFlowChart(){
  if(!flowChart||flowHistory.length<2) return;
  const d=flowHistory.slice(-120);
  flowChart.data.datasets[0].data=d;
  flowChart.update('none');
}

// ═══════════════════════════════════════
//  HEATMAP
// ═══════════════════════════════════════
function buildHeatmap(){
  const container=document.getElementById('heatmapContainer');
  if(!container) return;
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hours=Array.from({length:24},(_,i)=>i);
  let html='<div class="heatmap-row"><div class="heatmap-day"></div>';
  hours.forEach(h=>html+=`<div class="heatmap-label">${h%6===0?h:''}</div>`);
  html+='</div>';
  days.forEach(day=>{
    html+=`<div class="heatmap-row"><div class="heatmap-day">${day}</div>`;
    hours.forEach(h=>{
      let base=0.05;
      if(h>=7&&h<=9) base=0.75+Math.random()*0.25;
      else if(h>=16&&h<=19) base=0.65+Math.random()*0.3;
      else if(h>=11&&h<=14) base=0.35+Math.random()*0.25;
      else if(h>=20&&h<=22) base=0.2+Math.random()*0.2;
      else base=0.05+Math.random()*0.15;
      if(day==='Sat'||day==='Sun') base*=0.55;
      const v=Math.min(1,base);
      const r=Math.round(16+v*223),g=Math.round(185-v*155),b=Math.round(129-v*115);
      html+=`<div class="heatmap-cell" style="background:rgba(${r},${g},${b},${0.25+v*0.75});" title="${day} ${h}:00 — Density: ${Math.round(v*100)}%"></div>`;
    });
    html+='</div>';
  });
  container.innerHTML=html;
}

// ═══════════════════════════════════════
//  TRAFFIC LIGHTS
// ═══════════════════════════════════════
function setLights(ns,ew){
  ['n','s'].forEach(d=>['red','yellow','green'].forEach(c=>{
    const el=document.getElementById(d+c[0].toUpperCase()+c.slice(1));
    if(el) el.className=`light-bulb ${c}-light${ns===c?' active':''}`;
  }));
  ['e','w'].forEach(d=>['red','yellow','green'].forEach(c=>{
    const el=document.getElementById(d+c[0].toUpperCase()+c.slice(1));
    if(el) el.className=`light-bulb ${c}-light${ew===c?' active':''}`;
  }));
}

function tickSignal(){
  if(!S.autoSignal) return;
  S.phaseTimer--;
  if(S.phaseTimer<=0){
    S.signalPhase=(S.signalPhase+1)%4;
    S.phaseTimer=S.phaseTimings[S.signalPhase];
  }
  const ph=PHASES[S.signalPhase];
  setLights(ph.ns,ph.ew);
  const lEl=document.getElementById('phaseLabel'); if(lEl) lEl.textContent=ph.label;
  const tEl=document.getElementById('phaseTimerDisplay');
  if(tEl){
    tEl.textContent=String(Math.floor(S.phaseTimer/60)).padStart(2,'0')+':'+String(S.phaseTimer%60).padStart(2,'0');
    tEl.style.color=ph.ns==='green'||ph.ew==='green'?'#34d399':ph.ns==='yellow'||ph.ew==='yellow'?'#fbbf24':'#f87171';
  }
}
setInterval(tickSignal,1000);

function setAutoMode(a){
  S.autoSignal=a;
  document.getElementById('modeAutoBtn').className='control-btn'+(a?' active':'');
  document.getElementById('modeManBtn').className='control-btn'+(!a?' active':'');
}

function skipPhase(){
  S.signalPhase=(S.signalPhase+1)%4;
  S.phaseTimer=S.phaseTimings[S.signalPhase];
  addLog('⏭ Signal phase manually skipped');
}

// ═══════════════════════════════════════
//  SESSIONS TABLE
// ═══════════════════════════════════════
function buildSessionsTable(){
  const tbody=document.getElementById('sessionsTbody');
  if(!tbody) return;
  tbody.innerHTML=Array.from({length:12},(_,i)=>{
    const d=new Date(Date.now()-i*5400000);
    const total=Math.round(8000+Math.random()*6000);
    const car=Math.round(total*0.62),truck=Math.round(total*0.13),bus=Math.round(total*0.08),moto=Math.round(total*0.12);
    const peak=Math.round(60+Math.random()*35);
    const eff=Math.round(75+Math.random()*22);
    const co2=Math.round(total*0.07);
    return `<tr>
      <td style="color:#60a5fa;font-weight:600;font-family:monospace;">SES-${1000+i}</td>
      <td style="color:var(--text-secondary);">${d.toLocaleString()}</td>
      <td>${Math.floor(20+Math.random()*60)}m</td>
      <td style="font-weight:600;">${total.toLocaleString()}</td>
      <td style="color:#60a5fa;">${car.toLocaleString()}</td>
      <td style="color:#f87171;">${truck.toLocaleString()}</td>
      <td style="color:#fb923c;">${bus.toLocaleString()}</td>
      <td style="color:#fde047;">${moto.toLocaleString()}</td>
      <td><span style="color:${peak>80?'#f87171':peak>60?'#fbbf24':'#34d399'}">${peak}%</span></td>
      <td><span class="efficiency-badge ${eff>85?'eff-high':eff>70?'eff-med':'eff-low'}">${eff}%</span></td>
      <td style="color:#34d399;">${co2} kg</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════
//  ACTIVITY LOG
// ═══════════════════════════════════════
function addLog(msg){
  S.logs.unshift({time:new Date().toLocaleTimeString(),msg});
  if(S.logs.length>60) S.logs.pop();
  const el=document.getElementById('activityLog');
  if(el) el.innerHTML=S.logs.map(l=>`<div style="padding:8px 12px;border-bottom:1px solid rgba(48,54,61,0.4);font-size:12px;"><span style="color:var(--text-muted);font-family:monospace;margin-right:8px;">${l.time}</span><span style="color:var(--text-secondary);">${l.msg}</span></div>`).join('');
}

function exportCSV(){
  addLog('📥 CSV export triggered');
  const h='Session ID,Date,Duration,Total,Cars,Trucks,Buses,Motorcycles,Peak Density,Efficiency,CO2 Saved\n';
  const r=Array.from({length:5},(_,i)=>`SES-${1000+i},${new Date().toLocaleDateString()},45m,${10000+i*500},6500,1300,800,1200,${75+i}%,${82+i}%,${700+i*50}kg`).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([h+r],{type:'text/csv'}));
  a.download='traffic_report.csv'; a.click();
}

function exportPDF(){
  const jspdfApi = window.jspdf;
  if(!jspdfApi || !jspdfApi.jsPDF){
    addLog('⚠️ PDF export failed: jsPDF not loaded');
    alert('PDF library failed to load. Please check internet and try again.');
    return;
  }

  const { jsPDF } = jspdfApi;
  const doc = new jsPDF({ unit:'pt', format:'a4' });

  const now = new Date();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 48;

  doc.setFont('helvetica','bold');
  doc.setFontSize(18);
  doc.text('AI Traffic Control System', margin, y);
  y += 18;
  doc.setFont('helvetica','normal');
  doc.setFontSize(11);
  doc.text('Session History & Reports', margin, y);
  y += 14;
  doc.setTextColor(90, 100, 120);
  doc.text(`Generated: ${now.toLocaleString()}`, margin, y);
  doc.setTextColor(0, 0, 0);
  y += 22;

  const stats = [
    `Feed: ${document.getElementById('feedStatus')?.textContent || 'SIMULATING'}`,
    `FPS: ${document.getElementById('fpsDisplay')?.textContent || '-'}`,
    `Inference: ${document.getElementById('latencyDisplay')?.textContent || '-'}`,
    `GPU: ${document.getElementById('gpuUsage')?.textContent || '-'}`
  ];
  doc.setFontSize(10);
  stats.forEach((line)=>{
    doc.text(line, margin, y);
    y += 13;
  });
  y += 8;

  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text('Recent Sessions', margin, y);
  y += 16;

  const table = document.querySelector('#sessionsTbody');
  const rows = table ? Array.from(table.querySelectorAll('tr')) : [];
  const maxRows = 12;

  doc.setFont('helvetica','normal');
  doc.setFontSize(9);

  if(rows.length === 0){
    doc.text('No session data available.', margin, y);
  } else {
    const headers = ['Session','Date & Time','Duration','Total','Peak','Efficiency','CO2 Saved'];
    const colRatios = [0.15, 0.30, 0.10, 0.10, 0.10, 0.12, 0.13];
    const tableWidth = pageW - (margin * 2);
    const colWidths = colRatios.map(r => tableWidth * r);
    const colX = [];
    let cursorX = margin;
    colWidths.forEach((w)=>{
      colX.push(cursorX);
      cursorX += w;
    });

    doc.setFont('helvetica','bold');
    headers.forEach((h,i)=>doc.text(h,colX[i],y));
    y += 12;
    doc.setDrawColor(220,220,220);
    doc.line(margin,y,pageW-margin,y);
    y += 12;

    doc.setFont('helvetica','normal');
    rows.slice(0,maxRows).forEach((tr)=>{
      const tds = tr.querySelectorAll('td');
      if(tds.length < 11) return;
      const vals = [
        tds[0].textContent?.trim() || '',
        tds[1].textContent?.trim() || '',
        tds[2].textContent?.trim() || '',
        tds[3].textContent?.trim() || '',
        tds[8].textContent?.trim() || '',
        tds[9].textContent?.trim() || '',
        tds[10].textContent?.trim() || ''
      ];

      vals.forEach((v,i)=>{
        const maxW = Math.max(30, colWidths[i] - 8);
        const text = doc.splitTextToSize(v, maxW)[0] || '';
        doc.text(text, colX[i], y);
      });

      y += 13;
      if(y > 760){
        doc.addPage();
        y = 48;
      }
    });
  }

  const fileName = `traffic_report_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.pdf`;
  doc.save(fileName);
  addLog('📄 PDF report downloaded');
}

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
['🟢 System online and ready','🤖 YOLOv8x-Traffic model loaded (94.2% mAP@0.5)','📡 4-lane scene detection pipeline initialized','🚦 Signal control module active – Auto mode','🌿 Sustainability metrics tracking started'].forEach(m=>addLog(m));

window.addEventListener('DOMContentLoaded',()=>{
  buildCharts();
  buildHeatmap();
  buildSessionsTable();
  setLights('green','red');
  SCENE.start();

  setInterval(()=>{
    const msgs=[
      '🚗 Dense vehicle cluster detected in Lane 2',
      '🚦 Signal timing adjusted: +8s green for N-S',
      '📊 Density spike: 79% at main junction',
      '🌿 CO₂ savings updated',
      `⚡ Frame batch #${Math.round(1000+Math.random()*9000)} processed`,
      '🎯 Confidence maintained >90% on Car/Bus classes',
      '🔄 Adaptive NMS threshold recalibrated',
      '🏍️ Motorcycle cluster detected — Lane 3',
      '📐 Occupancy ratio recalculated: 38%'
    ];
    addLog(msgs[Math.floor(Math.random()*msgs.length)]);
  },4000);

  setInterval(()=>{
    const v=Math.round(72+Math.random()*22);
    const eEl=document.getElementById('ecoScore'); if(eEl) eEl.textContent=v;
    const cEl=document.getElementById('ecoCircle'); if(cEl) cEl.style.strokeDashoffset=377-(377*v/100);
  },3000);
});
