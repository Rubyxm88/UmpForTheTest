import * as THREE from 'three';

let scene, renderer;
let mainCamera, umpireCamera, sideCamera, topCamera, summaryReviewCamera;
let activeCamera;
let isZoomedIn = false;
let dimensionLineMesh = null;
let dimensionLabelSprite = null;
let dimensionTickGroup = null;

export function setZoomedIn(zoomed) {
  isZoomedIn = zoomed;
}

// Background customization state
let battersEyeMesh = null;
let mannequinOpacity = 0.24;

// Group containing all stadium/field meshes
let fieldGroup;
let summaryReviewGroup = null;

// Gameplay meshes
let ballMesh;
let strikeZoneMesh, strikeZoneOutline;
let catcherMittMesh;
let pitchTraceLine;
let crossingMarkerMesh;

// Holographic mannequins
let batterGroup = null;
let pitcherGroup = null;
let catcherGroup = null;
let catcherLeftArmGroup = null;
let pitcherNameplateSprite = null;
let batterNameplateSprite = null;

// Pitcher limb joints for animation
let pitcherTorso, pitcherLeftLeg, pitcherRightLeg, pitcherThrowingArm, pitcherGloveArm;

// Camera transition state
let targetCameraPos = new THREE.Vector3();
let targetCameraLookAt = new THREE.Vector3();
let currentCameraLookAt = new THREE.Vector3(0, 1.5, 15.0);
let cameraTransitionSpeed = 0.08;
let umpireXOffset = 0.0;
let umpireYOffset = 4.2;

// SmoothDamp and batter handedness trackers for camera resets
let currentBatterHandedness = 'RHB';
let cameraVelocity = new THREE.Vector3(0, 0, 0);
let lookAtVelocity = new THREE.Vector3(0, 0, 0);
let lastFrameTime = performance.now();

// Strike zone height trackers and HTML elements
let currentSzBot = 1.6;
let currentSzTop = 3.5;
let szTopLabelEl = null;
let szBotLabelEl = null;
let absBallDistanceLabelEl = null;
let isReviewing = false;
let markerTargetScale = 0.0;
let markerCurrentScale = 0.0;
let crossingMarkerRippleScale = 1.0;
let crossingMarkerRippleOpacity = 0.6;

export function setReviewingState(active) {
  isReviewing = active;
}

export function setCrossingMarkerVisible(visible) {
  markerTargetScale = visible ? 1.0 : 0.0;
  if (visible) {
    crossingMarkerRippleScale = 1.0;
    crossingMarkerRippleOpacity = 0.6;
  }
  if (!visible) {
    markerCurrentScale = 0.0;
    if (crossingMarkerMesh) {
      crossingMarkerMesh.scale.set(0.001, 0.001, 0.001);
    }
  }
}



export function getUmpireXOffset() {
  return umpireXOffset;
}

export function getUmpireYOffset() {
  return umpireYOffset;
}

// Colors
const COLORS = {
  grass: 0x112d16,
  grassStripe: 0x16391c,
  dirt: 0x5a391e,
  chalk: 0xdddddd,
  rubber: 0xffffff,
  ball: 0xffffff,
  seams: 0xff0000,
  mitt: 0x482b17,
  strikeZoneFill: 0xa855f7, // purple
  strikeZoneBorder: 0xc084fc,
  strikeZoneGlow: 0xd8b4fe,
  strikeCorrect: 0x22c55e, // green
  strikeIncorrect: 0xef4444, // red
  holoBatter: 0x06b6d4, // Cyan
  holoPitcher: 0xf97316, // Orange
  neonBat: 0xec4899, // Pink
};

/**
 * Initializes the Three.js scene, renderer, cameras, and lights
 */
export function initScene(containerEl, canvasEl) {
  // 1. Create Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06080b);
  scene.fog = new THREE.FogExp2(0x06080b, 0.012);

  summaryReviewGroup = new THREE.Group();
  scene.add(summaryReviewGroup);

  // 2. Setup Cameras
  const aspect = containerEl.clientWidth / containerEl.clientHeight;
  
  // Primary Umpire Camera: positioned behind catcher's mitt at eye level crouch (wide angle)
  umpireCamera = new THREE.PerspectiveCamera(72, aspect, 0.1, 1000);
  umpireCamera.position.set(0, 4.2, -4.5); 
  
  // Front Zoom Camera: looking back from in front of home plate
  sideCamera = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000);
  sideCamera.position.set(0, 3.2, 7.5);
  
  // Side Zoom Camera: looking directly down the plate midpoint breakpoint from the side
  topCamera = new THREE.PerspectiveCamera(38, aspect, 0.1, 1000);
  topCamera.position.set(-5.8, 2.5, 0.7083);

  // Summary Review Camera: side-front view zoomed tightly on the plate
  summaryReviewCamera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
  summaryReviewCamera.position.set(-4.2, 2.8, 5.0);

  // Main camera which interpolates towards active camera settings (wide angle matches umpire fov)
  mainCamera = new THREE.PerspectiveCamera(72, aspect, 0.1, 1000);
  mainCamera.position.copy(umpireCamera.position);
  
  activeCamera = umpireCamera;
  targetCameraPos.copy(umpireCamera.position);
  targetCameraLookAt.set(0, 1.5, 15.0); // look down home plate area
  currentCameraLookAt.copy(targetCameraLookAt);

  // 3. Setup Renderer
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // 4. Setup Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.22); // slightly brighter ambient
  scene.add(ambientLight);

  // Stadium Light Towers (directional)
  const leftTower = new THREE.DirectionalLight(0xfff5ea, 1.4);
  leftTower.position.set(-30, 45, 20);
  leftTower.castShadow = true;
  leftTower.shadow.mapSize.width = 1024;
  leftTower.shadow.mapSize.height = 1024;
  leftTower.shadow.camera.near = 0.5;
  leftTower.shadow.camera.far = 120;
  leftTower.shadow.camera.left = -20;
  leftTower.shadow.camera.right = 20;
  leftTower.shadow.camera.top = 20;
  leftTower.shadow.camera.bottom = -20;
  leftTower.shadow.bias = -0.0005;
  scene.add(leftTower);

  const rightTower = new THREE.DirectionalLight(0xe5efff, 0.9);
  rightTower.position.set(30, 40, -10);
  rightTower.castShadow = true;
  scene.add(rightTower);

  // Home plate spotlight
  const plateSpotlight = new THREE.SpotLight(0xffffff, 4, 25, Math.PI / 6, 0.4, 0.8);
  plateSpotlight.position.set(0, 14, 0.7);
  plateSpotlight.target.position.set(0, 0.5, 0.7);
  scene.add(plateSpotlight);
  scene.add(plateSpotlight.target);

  // CRITICAL: Dedicated Pitcher Spotlight to make the pitcher visible on the mound!
  const pitcherSpotlight = new THREE.SpotLight(0xfff0e0, 6, 25, Math.PI / 6, 0.4, 0.8);
  pitcherSpotlight.position.set(0, 15, 64.0); // directly behind/above pitcher
  pitcherSpotlight.target.position.set(0, 2.0, 60.5); // shines on pitcher body
  scene.add(pitcherSpotlight);
  scene.add(pitcherSpotlight.target);

  // Spotlight shining onto the FRONT of the pitcher from home plate side
  const frontPitcherSpot = new THREE.SpotLight(0xffffff, 8, 35, Math.PI / 6, 0.5, 0.8);
  frontPitcherSpot.position.set(0, 14, 42.0); // positioned at z = 42
  frontPitcherSpot.target.position.set(0, 1.5, 60.5); // shines on pitcher front
  scene.add(frontPitcherSpot);
  scene.add(frontPitcherSpot.target);

  // Spotlight illuminating the pitcher mound floor
  const moundSpot = new THREE.SpotLight(0xfff5ea, 5, 20, Math.PI / 4, 0.5, 0.8);
  moundSpot.position.set(0, 12, 59.0);
  moundSpot.target.position.set(0, 0, 59.0);
  scene.add(moundSpot);
  scene.add(moundSpot.target);

  // 5. Build Stadium/Field
  fieldGroup = new THREE.Group();
  scene.add(fieldGroup);
  buildField();

  // 6. Create Gameplay Objects
  createBall();
  createCatcherMitt();
  createStrikeZone();
  
  render();
}

function createGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // Base grass green
  ctx.fillStyle = '#112d16';
  ctx.fillRect(0, 0, 512, 512);
  
  // Draw subtle stripes (turf cut)
  ctx.fillStyle = '#16391c';
  for (let i = 0; i < 512; i += 64) {
    if ((i / 64) % 2 === 0) {
      ctx.fillRect(i, 0, 64, 512);
    }
  }

  // Draw organic noise / blades of grass
  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const h = 1.5 + Math.random() * 3.5;
    const w = 0.5 + Math.random() * 1.0;
    const angle = (Math.random() - 0.5) * 0.25;
    
    ctx.strokeStyle = Math.random() > 0.5 ? '#1f5329' : '#0a1d0e';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(angle) * h, y - Math.cos(angle) * h);
    ctx.stroke();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
  return texture;
}

function createDirtTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  // Base clay/dirt color
  ctx.fillStyle = '#5a391e';
  ctx.fillRect(0, 0, 256, 256);
  
  // Granular speckles / noise
  for (let i = 0; i < 10000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 0.4 + Math.random() * 1.2;
    const rand = Math.random();
    if (rand > 0.7) {
      ctx.fillStyle = '#734926'; // lighter clay
    } else if (rand > 0.4) {
      ctx.fillStyle = '#422a16'; // darker dirt
    } else {
      ctx.fillStyle = '#664a35'; // sandy speck
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  return texture;
}

function createPlateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  // Base rubber white
  ctx.fillStyle = '#dddddd';
  ctx.fillRect(0, 0, 256, 256);
  
  // Slightly darker bevel/grooves
  ctx.strokeStyle = '#bbbbbb';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 248);
  
  // Clay smudges/dirt marks around the edges for realism
  ctx.fillStyle = 'rgba(90, 57, 30, 0.4)'; // clay dirt
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 256;
    const y = Math.random() > 0.5 ? Math.random() * 20 : 236 + Math.random() * 20; // edges
    const r = 3 + Math.random() * 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Some random dirt splats in the middle
  for (let i = 0; i < 4; i++) {
    const x = 40 + Math.random() * 176;
    const y = 40 + Math.random() * 176;
    const r = 1 + Math.random() * 4;
    ctx.fillStyle = 'rgba(66, 42, 22, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
function createBaseballTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  // White leather base
  ctx.fillStyle = '#fffff0';
  ctx.fillRect(0, 0, 512, 256);
  
  // Leather texture noise
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
    ctx.fillRect(x, y, 1, 1);
  }
  
  // Draw the red curved seam lines first
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.lineWidth = 4.0;
  ctx.beginPath();
  for (let i = 0; i <= 512; i++) {
    const t = i / 512;
    const x = t * 512;
    const y = 128 + Math.sin(t * Math.PI * 2) * 64;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i <= 512; i++) {
    const t = i / 512;
    const x = t * 512;
    const y = 128 - Math.sin(t * Math.PI * 2) * 64;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  
  // Red stitching seams
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.0;
  
  const stitchCount = 100;
  for (let i = 0; i < stitchCount; i++) {
    const t = i / stitchCount;
    // Map stitch line 1 (sine wave on cylindrical coordinate map)
    const x1 = t * 512;
    const y1 = 128 + Math.sin(t * Math.PI * 2) * 64;
    
    // Map stitch line 2 (offset)
    const x2 = t * 512;
    const y2 = 128 - Math.sin(t * Math.PI * 2) * 64;
    
    // Draw perpendicular red stitch ticks
    const angle1 = t * Math.PI * 2 + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x1 - Math.cos(angle1) * 3, y1 - Math.sin(angle1) * 3);
    ctx.lineTo(x1 + Math.cos(angle1) * 3, y1 + Math.sin(angle1) * 3);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2 - Math.cos(angle1) * 3, y2 - Math.sin(angle1) * 3);
    ctx.lineTo(x2 + Math.cos(angle1) * 3, y2 + Math.sin(angle1) * 3);
    ctx.stroke();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}


function createWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  // Base wood color (ash/birch bat tone)
  ctx.fillStyle = '#8a5a36';
  ctx.fillRect(0, 0, 256, 64);
  
  // Darker wood lines
  ctx.strokeStyle = '#5a391e';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const y = Math.random() * 64;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(80, y + (Math.random() - 0.5) * 6, 160, y + (Math.random() - 0.5) * 6, 256, y);
    ctx.stroke();
  }
  
  // Faint highlights
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  for (let i = 0; i < 4; i++) {
    const y = Math.random() * 64;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createCityWindowTexture() {

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  // Base dark building color
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 0, 128, 256);
  
  // Draw columns and rows of windows
  const cols = 8;
  const rows = 24;
  const wWidth = 8;
  const wHeight = 6;
  const spacingX = 6;
  const spacingY = 4;
  
  const startX = (128 - (cols * wWidth + (cols - 1) * spacingX)) / 2;
  const startY = 8;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Randomly turn on/off windows (65% on)
      if (Math.random() > 0.35) {
        // Yellow-orange, cyan-blue, and warm white windows
        const rand = Math.random();
        if (rand > 0.4) {
          ctx.fillStyle = '#ffd166'; // gold/warm yellow
        } else if (rand > 0.15) {
          ctx.fillStyle = '#4cc9f0'; // cyan
        } else {
          ctx.fillStyle = '#ffffff'; // white
        }
        ctx.fillRect(startX + c * (wWidth + spacingX), startY + r * (wHeight + spacingY), wWidth, wHeight);
      } else {
        ctx.fillStyle = '#171b26'; // dark window
        ctx.fillRect(startX + c * (wWidth + spacingX), startY + r * (wHeight + spacingY), wWidth, wHeight);
      }
    }
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createSkyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  // Navy to purple to dark gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#030406');  // top - black
  grad.addColorStop(0.4, '#080c16'); // middle - deep navy
  grad.addColorStop(0.8, '#180e2b'); // horizon glow
  grad.addColorStop(1.0, '#2e183b'); // stadium bright horizon glow
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, 128);
  
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * Builds the visual elements of the baseball field (turf, clay, chalk lines) and procedural stadium/skyline
 */
function buildField() {
  // 1. Sky Dome
  const skyGeo = new THREE.SphereGeometry(180, 32, 15, 0, Math.PI * 2, 0, Math.PI / 2);
  const skyTexture = createSkyGradientTexture();
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.BackSide,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.position.y = -10;
  fieldGroup.add(skyDome);

  // 2. Turf / Grass Field
  const grassGeo = new THREE.PlaneGeometry(160, 160);
  const grassTexture = createGrassTexture();
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTexture,
    roughness: 0.92,
    metalness: 0.05,
  });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  fieldGroup.add(grass);

  // Home Plate Dirt Circle
  const dirtCircleGeo = new THREE.RingGeometry(0.1, 13, 48);
  const dirtTexture = createDirtTexture();
  const dirtCircleMat = new THREE.MeshStandardMaterial({
    map: dirtTexture,
    roughness: 0.96,
  });
  const dirtCircle = new THREE.Mesh(dirtCircleGeo, dirtCircleMat);
  dirtCircle.rotation.x = -Math.PI / 2;
  dirtCircle.position.set(0, 0.003, 0);
  dirtCircle.receiveShadow = true;
  fieldGroup.add(dirtCircle);

  // Pitcher's mound clay circle
  const moundGeo = new THREE.CylinderGeometry(9, 9, 0.8, 24);
  moundGeo.scale(1, 0.25, 1);
  const moundMat = new THREE.MeshStandardMaterial({
    map: dirtTexture,
    roughness: 0.96,
  });
  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.position.set(0, 0.1, 59.0);
  mound.receiveShadow = true;
  fieldGroup.add(mound);

  // Pitcher's rubber slab
  const rubberGeo = new THREE.BoxGeometry(2, 0.08, 0.5);
  const rubberMat = new THREE.MeshStandardMaterial({
    color: COLORS.rubber,
    roughness: 0.8,
  });
  const rubber = new THREE.Mesh(rubberGeo, rubberMat);
  rubber.position.set(0, 0.21, 60.5);
  rubber.castShadow = true;
  rubber.receiveShadow = true;
  fieldGroup.add(rubber);

  // Draw solid 3D Home Plate
  const plateShape = new THREE.Shape();
  plateShape.moveTo(0, 0); 
  plateShape.lineTo(-0.7083, 0.7083); 
  plateShape.lineTo(-0.7083, 1.417); 
  plateShape.lineTo(0.7083, 1.417); 
  plateShape.lineTo(0.7083, 0.7083); 
  plateShape.closePath();

  // Solid white rubber plate
  const extrudeSettings = { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 };
  const plateGeo = new THREE.ExtrudeGeometry(plateShape, extrudeSettings);
  const plateTexture = createPlateTexture();
  const plateMat = new THREE.MeshStandardMaterial({
    map: plateTexture,
    roughness: 0.75,
    metalness: 0.0,
  });
  const homePlate = new THREE.Mesh(plateGeo, plateMat);
  homePlate.rotation.x = -Math.PI / 2;
  homePlate.rotation.z = Math.PI;
  homePlate.position.set(0, 0.015, 0); 
  homePlate.castShadow = true;
  homePlate.receiveShadow = true;
  fieldGroup.add(homePlate);

  // Dark border around home plate
  const borderShape = new THREE.Shape();
  borderShape.moveTo(0, -0.015);
  borderShape.lineTo(-0.7233, 0.6933);
  borderShape.lineTo(-0.7233, 1.432);
  borderShape.lineTo(0.7233, 1.432);
  borderShape.lineTo(0.7233, 0.6933);
  borderShape.closePath();

  const borderExtrude = { depth: 0.035, bevelEnabled: false };
  const borderGeo = new THREE.ExtrudeGeometry(borderShape, borderExtrude);
  const borderMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.95,
    metalness: 0.0,
  });
  const plateBorder = new THREE.Mesh(borderGeo, borderMat);
  plateBorder.rotation.x = -Math.PI / 2;
  plateBorder.rotation.z = Math.PI;
  plateBorder.position.set(0, 0.008, 0); 
  plateBorder.receiveShadow = true;
  fieldGroup.add(plateBorder);

  // Batter's boxes
  const bboxWidth = 4;
  const bboxLength = 6;
  const bboxOffset = 0.7083 + 0.5 + bboxWidth / 2;

  const chalkLineMat = new THREE.MeshBasicMaterial({ color: COLORS.chalk });
  const leftBBoxGeo = new THREE.BoxGeometry(bboxWidth, 0.005, bboxLength);
  const leftBBoxOutlineGeo = new THREE.EdgesGeometry(leftBBoxGeo);
  
  const leftBBox = new THREE.LineSegments(leftBBoxOutlineGeo, chalkLineMat);
  leftBBox.position.set(-bboxOffset, 0.005, 0.7083);
  fieldGroup.add(leftBBox);

  const rightBBox = new THREE.LineSegments(leftBBoxOutlineGeo, chalkLineMat);
  rightBBox.position.set(bboxOffset, 0.005, 0.7083);
  fieldGroup.add(rightBBox);

  // Foul lines
  const lineGeo = new THREE.PlaneGeometry(0.25, 100);
  
  const leftFoul = new THREE.Mesh(lineGeo, chalkLineMat);
  leftFoul.rotation.x = -Math.PI / 2;
  leftFoul.rotation.z = -Math.PI / 4;
  leftFoul.position.set(-35.35, 0.004, 35.35);
  fieldGroup.add(leftFoul);

  const rightFoul = new THREE.Mesh(lineGeo, chalkLineMat);
  rightFoul.rotation.x = -Math.PI / 2;
  rightFoul.rotation.z = Math.PI / 4;
  rightFoul.position.set(35.35, 0.004, 35.35);
  fieldGroup.add(rightFoul);

  // Basepaths (5 ft wide flat dirt paths connecting the bases)
  const pathMat = new THREE.MeshStandardMaterial({
    map: dirtTexture,
    roughness: 0.98,
  });
  const pathW = 5.0;
  const pathL = 90.0;
  const pathGeo = new THREE.PlaneGeometry(pathW, pathL);

  // Home to 1st Basepath
  const pathHomeTo1st = new THREE.Mesh(pathGeo, pathMat);
  pathHomeTo1st.rotation.x = -Math.PI / 2;
  pathHomeTo1st.rotation.z = -Math.PI / 4;
  pathHomeTo1st.position.set(31.82, 0.0025, 31.82);
  pathHomeTo1st.receiveShadow = true;
  fieldGroup.add(pathHomeTo1st);

  // Home to 3rd Basepath
  const pathHomeTo3rd = new THREE.Mesh(pathGeo, pathMat);
  pathHomeTo3rd.rotation.x = -Math.PI / 2;
  pathHomeTo3rd.rotation.z = Math.PI / 4;
  pathHomeTo3rd.position.set(-31.82, 0.0025, 31.82);
  pathHomeTo3rd.receiveShadow = true;
  fieldGroup.add(pathHomeTo3rd);

  // 1st to 2nd Basepath
  const path1stTo2nd = new THREE.Mesh(pathGeo, pathMat);
  path1stTo2nd.rotation.x = -Math.PI / 2;
  path1stTo2nd.rotation.z = Math.PI / 4;
  path1stTo2nd.position.set(31.82, 0.0025, 95.46);
  path1stTo2nd.receiveShadow = true;
  fieldGroup.add(path1stTo2nd);

  // 3rd to 2nd Basepath
  const path3rdTo2nd = new THREE.Mesh(pathGeo, pathMat);
  path3rdTo2nd.rotation.x = -Math.PI / 2;
  path3rdTo2nd.rotation.z = -Math.PI / 4;
  path3rdTo2nd.position.set(-31.82, 0.0025, 95.46);
  path3rdTo2nd.receiveShadow = true;
  fieldGroup.add(path3rdTo2nd);

  // 3D White Canvas Bases (1.25 ft square, 0.22 ft high)
  const baseGeo = new THREE.BoxGeometry(1.25, 0.22, 1.25);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
  });

  // 1st Base
  const base1st = new THREE.Mesh(baseGeo, baseMat);
  base1st.position.set(63.64, 0.11, 63.64);
  base1st.castShadow = true;
  base1st.receiveShadow = true;
  fieldGroup.add(base1st);

  // 3rd Base
  const base3rd = new THREE.Mesh(baseGeo, baseMat);
  base3rd.position.set(-63.64, 0.11, 63.64);
  base3rd.castShadow = true;
  base3rd.receiveShadow = true;
  fieldGroup.add(base3rd);

  // 2nd Base
  const base2nd = new THREE.Mesh(baseGeo, baseMat);
  base2nd.position.set(0, 0.11, 127.28);
  base2nd.castShadow = true;
  base2nd.receiveShadow = true;
  fieldGroup.add(base2nd);

  // Curved outfield wall representation in the distance
  const wallGroup = new THREE.Group();
  
  // Center wall (Batter's Eye) - expanded & charcoal grey
  const battersEyeGeo = new THREE.BoxGeometry(45, 30, 2);
  const battersEyeMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c10, // matte charcoal
    roughness: 0.98,
    metalness: 0.05,
  });
  battersEyeMesh = new THREE.Mesh(battersEyeGeo, battersEyeMat);
  battersEyeMesh.position.set(0, 15, 85);
  battersEyeMesh.receiveShadow = true;
  wallGroup.add(battersEyeMesh);

  // Ivy hedge at the bottom of the batter's eye
  const ivyGeo = new THREE.BoxGeometry(45, 6, 2.5);
  const ivyMat = new THREE.MeshStandardMaterial({
    color: 0x0d2613, // lush dark green
    roughness: 0.98,
  });
  const ivyHedge = new THREE.Mesh(ivyGeo, ivyMat);
  ivyHedge.position.set(0, 3, 84);
  ivyHedge.receiveShadow = true;
  wallGroup.add(ivyHedge);

  // Left Outfield Wall
  const leftWallGeo = new THREE.BoxGeometry(45, 10, 2);
  const outfieldWallMat = new THREE.MeshStandardMaterial({
    color: 0x0d2113,
    roughness: 0.9,
  });
  const leftWall = new THREE.Mesh(leftWallGeo, outfieldWallMat);
  leftWall.position.set(-32, 5, 80);
  leftWall.rotation.y = 0.25; // angled inward
  leftWall.receiveShadow = true;
  wallGroup.add(leftWall);

  // Right Outfield Wall
  const rightWall = new THREE.Mesh(leftWallGeo, outfieldWallMat);
  rightWall.position.set(32, 5, 80);
  rightWall.rotation.y = -0.25; // angled inward
  rightWall.receiveShadow = true;
  wallGroup.add(rightWall);

  // Yellow Home Run Line borders
  const hrLineGeo = new THREE.BoxGeometry(45.2, 0.16, 2.1);
  const hrLineMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15, // yellow
    emissive: 0xfacc15,
    emissiveIntensity: 0.6,
  });
  
  const leftHRLine = new THREE.Mesh(hrLineGeo, hrLineMat);
  leftHRLine.position.set(-32, 10.08, 80);
  leftHRLine.rotation.y = 0.25;
  wallGroup.add(leftHRLine);
  
  const rightHRLine = new THREE.Mesh(hrLineGeo, hrLineMat);
  rightHRLine.position.set(32, 10.08, 80);
  rightHRLine.rotation.y = -0.25;
  wallGroup.add(rightHRLine);

  // Decorative Billboard/Scoreboard on top of Left Wall
  const scoreboardGeo = new THREE.BoxGeometry(22, 10, 0.8);
  const scoreboardMat = new THREE.MeshStandardMaterial({
    color: 0x101018,
    roughness: 0.5,
  });
  const scoreboard = new THREE.Mesh(scoreboardGeo, scoreboardMat);
  scoreboard.position.set(-30, 15, 78);
  scoreboard.rotation.y = 0.25;
  
  // Glowing neon header for the scoreboard
  const scoreGlowGeo = new THREE.BoxGeometry(20, 0.5, 0.1);
  const scoreGlowMat = new THREE.MeshStandardMaterial({
    color: COLORS.strikeZoneBorder, // purple glow
    emissive: COLORS.strikeZoneBorder,
    emissiveIntensity: 0.8,
  });
  const scoreGlow = new THREE.Mesh(scoreGlowGeo, scoreGlowMat);
  scoreGlow.position.set(0, 4.2, 0.45);
  scoreboard.add(scoreGlow);
  wallGroup.add(scoreboard);

  // Seating stand bowl (stepped boxes representing crowd concourse)
  const standGroup = new THREE.Group();
  const standSteps = 3;
  const standRadius = 90;
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x090b10,
    roughness: 0.9,
    metalness: 0.1,
  });
  for (let s = 0; s < standSteps; s++) {
    const stepRadius = standRadius + s * 4.0;
    const stepHeight = 2 + s * 3.0;
    const count = 28;
    
    // Outfield stands (Z > 0)
    const angleStartOut = -1.1;
    const angleEndOut = 1.1;
    const angleStepOut = (angleEndOut - angleStartOut) / (count - 1);
    for (let i = 0; i < count; i++) {
      const angle = angleStartOut + i * angleStepOut;
      const geo = new THREE.BoxGeometry(9, stepHeight, 4);
      const standSeg = new THREE.Mesh(geo, standMat);
      const x = stepRadius * Math.sin(angle);
      const z = stepRadius * Math.cos(angle);
      standSeg.position.set(x, stepHeight / 2 - 0.5, z);
      standSeg.rotation.y = angle;
      standGroup.add(standSeg);
    }

    // Home plate stands (Z < 0)
    const angleStartHome = Math.PI - 1.1;
    const angleEndHome = Math.PI + 1.1;
    const angleStepHome = (angleEndHome - angleStartHome) / (count - 1);
    for (let i = 0; i < count; i++) {
      const angle = angleStartHome + i * angleStepHome;
      const geo = new THREE.BoxGeometry(9, stepHeight, 4);
      const standSeg = new THREE.Mesh(geo, standMat);
      const x = stepRadius * Math.sin(angle);
      const z = stepRadius * Math.cos(angle);
      standSeg.position.set(x, stepHeight / 2 - 0.5, z);
      standSeg.rotation.y = angle;
      standGroup.add(standSeg);
    }
  }
  wallGroup.add(standGroup);

  // Procedural night city skyline (Outfield + Behind Home Plate)
  const cityGroup = new THREE.Group();
  const windowTexture = createCityWindowTexture();
  const rows = [
    { radius: 110, count: 18, minHeight: 25, maxHeight: 50, widthRange: [8, 14] },
    { radius: 135, count: 22, minHeight: 45, maxHeight: 80, widthRange: [10, 18] },
    { radius: 160, count: 22, minHeight: 65, maxHeight: 110, widthRange: [12, 22] }
  ];
  rows.forEach((row, rowIndex) => {
    // 1. Outfield Buildings (Z > 0)
    const angleStartOut = -1.1;
    const angleEndOut = 1.1;
    const angleStepOut = (angleEndOut - angleStartOut) / (row.count - 1);
    for (let i = 0; i < row.count; i++) {
      const angle = angleStartOut + i * angleStepOut + (Math.random() - 0.5) * 0.04;
      if (Math.abs(angle) < 0.20) continue; // Exclude center field to keep batter's eye clear
      const width = row.widthRange[0] + Math.random() * (row.widthRange[1] - row.widthRange[0]);
      const depth = width * 0.8;
      const height = row.minHeight + Math.random() * (row.maxHeight - row.minHeight);
      
      const geo = new THREE.BoxGeometry(width, height, depth);
      const tex = windowTexture.clone();
      tex.repeat.set(Math.max(1, Math.round(width / 3.5)), Math.max(1, Math.round(height / 4.5)));
      
      const mat = new THREE.MeshStandardMaterial({
        color: 0x07090e,
        roughness: 0.8,
        metalness: 0.3,
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.4 + Math.random() * 0.45,
      });
      
      const building = new THREE.Mesh(geo, mat);
      const x = row.radius * Math.sin(angle);
      const z = row.radius * Math.cos(angle);
      
      building.position.set(x, height / 2 - 1.0, z);
      building.rotation.y = angle;
      cityGroup.add(building);
    }

    // 2. Behind Home Plate Buildings (Z < 0)
    const angleStartHome = Math.PI - 1.1;
    const angleEndHome = Math.PI + 1.1;
    const angleStepHome = (angleEndHome - angleStartHome) / (row.count - 1);
    for (let i = 0; i < row.count; i++) {
      const angle = angleStartHome + i * angleStepHome + (Math.random() - 0.5) * 0.04;
      const width = row.widthRange[0] + Math.random() * (row.widthRange[1] - row.widthRange[0]);
      const depth = width * 0.8;
      const height = (row.minHeight + Math.random() * (row.maxHeight - row.minHeight)) * 0.8;
      
      const geo = new THREE.BoxGeometry(width, height, depth);
      const tex = windowTexture.clone();
      tex.repeat.set(Math.max(1, Math.round(width / 3.5)), Math.max(1, Math.round(height / 4.5)));
      
      const mat = new THREE.MeshStandardMaterial({
        color: 0x07090e,
        roughness: 0.8,
        metalness: 0.3,
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.4 + Math.random() * 0.45,
      });
      
      const building = new THREE.Mesh(geo, mat);
      const x = row.radius * Math.sin(angle);
      const z = row.radius * Math.cos(angle);
      
      building.position.set(x, height / 2 - 1.0, z);
      building.rotation.y = angle;
      cityGroup.add(building);
    }
  });
  wallGroup.add(cityGroup);

  // Distant stadium lights (glowing spheres on towers with PointLights)
  const createLightTower = (x, z) => {
    const towerGroup = new THREE.Group();
    // Tower pole
    const poleGeo = new THREE.CylinderGeometry(0.3, 0.6, 32, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.5 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 16;
    towerGroup.add(pole);

    // Light head
    const headGeo = new THREE.BoxGeometry(5, 3, 1);
    const head = new THREE.Mesh(headGeo, poleMat);
    head.position.y = 31;
    
    // Light fixtures (glowing spheres)
    const bulbGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.0,
    });
    
    for (let row = -1; row <= 1; row++) {
      for (let col = -2; col <= 2; col++) {
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(col * 0.9, row * 0.8, 0.55);
        head.add(bulb);
      }
    }

    // Volumetric glow effect (semi-transparent sphere around the tower head)
    const glowGeo = new THREE.SphereGeometry(3.5, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xfff5ea,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
    });
    const volumetricGlow = new THREE.Mesh(glowGeo, glowMat);
    volumetricGlow.position.set(0, 0, 0.5);
    head.add(volumetricGlow);

    // Dynamic point light on the tower head to illuminate nearby seating/walls
    const towerLight = new THREE.PointLight(0xfff5ea, 4, 60, 1.2);
    towerLight.position.set(0, 0, 1);
    head.add(towerLight);

    towerGroup.add(head);
    towerGroup.position.set(x, 0, z);
    
    // Point tower slightly towards mound
    towerGroup.lookAt(new THREE.Vector3(0, 2, 60.5));
    return towerGroup;
  };

  wallGroup.add(createLightTower(-45, 75));
  wallGroup.add(createLightTower(45, 75));

  fieldGroup.add(wallGroup);
}

function createBall() {
  const ballRadius = 0.12;
  const geometry = new THREE.SphereGeometry(ballRadius, 16, 16);
  
  const ballTexture = createBaseballTexture();
  const material = new THREE.MeshStandardMaterial({
    map: ballTexture,
    roughness: 0.8,
  });

  ballMesh = new THREE.Mesh(geometry, material);
  ballMesh.castShadow = true;
  ballMesh.position.set(0, 5.8, 60.5);
  scene.add(ballMesh);
}

/**
 * Creates the catcher's mitt
 */
function createCatcherMitt() {
  const mittGroup = new THREE.Group();
  
  // Pocket (Main body)
  const pocketGeo = new THREE.SphereGeometry(0.36, 12, 12);
  pocketGeo.scale(1, 1, 0.4);
  const leatherMat = new THREE.MeshStandardMaterial({
    color: COLORS.mitt,
    roughness: 0.9,
  });
  const pocket = new THREE.Mesh(pocketGeo, leatherMat);
  pocket.castShadow = true;
  mittGroup.add(pocket);

  // Outer border
  const borderGeo = new THREE.TorusGeometry(0.3, 0.1, 6, 16);
  const border = new THREE.Mesh(borderGeo, leatherMat);
  border.castShadow = true;
  mittGroup.add(border);

  // Webbing lines inside the glove pocket
  const webMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.9,
  });
  const web1Geo = new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4);
  const web1 = new THREE.Mesh(web1Geo, webMat);
  web1.position.set(0.1, 0.1, 0.02);
  web1.rotation.z = Math.PI / 4;
  mittGroup.add(web1);

  const web2 = new THREE.Mesh(web1Geo, webMat);
  web2.position.set(0.1, -0.1, 0.02);
  web2.rotation.z = -Math.PI / 4;
  mittGroup.add(web2);

  // Glowing futuristic neon pink trim along the edge of the mitt
  const trimGeo = new THREE.TorusGeometry(0.31, 0.018, 4, 24);
  const trimMat = new THREE.MeshStandardMaterial({
    color: COLORS.neonBat, // pink glow
    emissive: COLORS.neonBat,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.75,
  });
  const trim = new THREE.Mesh(trimGeo, trimMat);
  trim.position.z = 0.06; // slightly forward
  mittGroup.add(trim);

  catcherMittMesh = mittGroup;
  catcherMittMesh.position.set(0, 2.2, -2.4);
  catcherMittMesh.rotation.y = Math.PI;
  scene.add(catcherMittMesh);
}

/**
 * Creates the 2D flat Strike Zone plane at z = 0.7083 feet
 */
function createStrikeZone() {
  const initialHeight = 1.8;
  const geometry = new THREE.PlaneGeometry(1.4167, initialHeight);
  
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.strikeZoneFill,
    transparent: true,
    opacity: 0.20,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  strikeZoneMesh = new THREE.Mesh(geometry, material);
  
  const outlineGeo = new THREE.EdgesGeometry(geometry);
  const outlineMat = new THREE.LineBasicMaterial({
    color: COLORS.strikeZoneBorder,
    linewidth: 3,
    transparent: true,
    opacity: 1.0,
  });
  strikeZoneOutline = new THREE.LineSegments(outlineGeo, outlineMat);
  strikeZoneMesh.add(strikeZoneOutline);

  // Position: Center is exactly at the midpoint of home plate (z = 0.7083)
  strikeZoneMesh.position.set(0, 2.5, 0.7083);
  
  // Hidden by default during play (blind test)
  strikeZoneMesh.visible = false;
  scene.add(strikeZoneMesh);
}

/**
 * Toggle strike zone visibility (e.g. show during review, hide during pitch)
 */
export function showStrikeZone(visible) {
  if (strikeZoneMesh) {
    strikeZoneMesh.visible = visible;
  }
}

let isPreviewFlashing = false;
let previewFlashStartTime = 0;
const PREVIEW_FLASH_DURATION = 1500;

export function flashStrikeZonePreview() {
  isPreviewFlashing = true;
  previewFlashStartTime = performance.now();
  if (strikeZoneMesh) {
    strikeZoneMesh.visible = true;
  }
}

export function updateStrikeZone(sz_bot, sz_top) {
  currentSzBot = sz_bot;
  currentSzTop = sz_top;
  const szHeight = sz_top - sz_bot;
  
  // Scale the geometry height
  strikeZoneMesh.scale.y = szHeight / 1.8;
  
  // Position height center half-way between top and bottom
  const centerHeight = sz_bot + (szHeight / 2);
  strikeZoneMesh.position.y = centerHeight;
}

/**
 * Toggle the visibility of the player models and catcher's mitt
 */
export function showMannequins(visible) {
  if (batterGroup) batterGroup.visible = visible;
  if (pitcherGroup) pitcherGroup.visible = visible;
  if (catcherGroup) catcherGroup.visible = visible;
  if (catcherMittMesh) catcherMittMesh.visible = visible;
}

/**
 * Helper function to create a cylindrical limb segment connecting two 3D points.
 * Optionally adds a joint sphere at point B to make connections look smooth.
 */
function createLimbSegment(pA, pB, radius, material, addJointSphere = false) {
  const group = new THREE.Group();
  
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const length = dir.length();
  if (length < 0.01) return group;
  
  // Cylinder for the limb segment
  const cylinderGeo = new THREE.CylinderGeometry(radius, radius, length, 8);
  const cylinder = new THREE.Mesh(cylinderGeo, material);
  
  // Position the cylinder at the midpoint between the two points
  const midpoint = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  cylinder.position.copy(midpoint);
  
  // Rotate the cylinder (which aligns along Y axis by default) to match the direction vector
  const u = dir.clone().normalize();
  const cylinderAxis = new THREE.Vector3(0, 1, 0);
  cylinder.quaternion.setFromUnitVectors(cylinderAxis, u);
  
  group.add(cylinder);
  
  // Joint sphere at the end of the segment
  if (addJointSphere) {
    const sphereGeo = new THREE.SphereGeometry(radius * 1.25, 8, 8);
    const jointSphere = new THREE.Mesh(sphereGeo, material);
    jointSphere.position.copy(pB);
    group.add(jointSphere);
  }
  
  return group;
}

function makeGlowingHolographic(group, isTorsoScanline = false) {
  if (!group) return;
  
  const meshesToProcess = [];
  group.traverse(child => {
    if (child.isMesh && !child.isProcessedHolo) {
      meshesToProcess.push(child);
    }
  });
  
  meshesToProcess.forEach(child => {
    child.isProcessedHolo = true;
    
    const childColor = (child.material && child.material.color) ? child.material.color.clone() : new THREE.Color(0xffffff);
    
    if (child.material) {
      child.material.transparent = true;
      child.material.opacity = 0.15; // glowing glass solid fill
      if (child.material.emissive) {
        child.material.emissive.copy(childColor);
        child.material.emissiveIntensity = 0.4;
      }
    }
    
    // Add crisp edge outline geometry
    const edgesGeo = new THREE.EdgesGeometry(child.geometry);
    const lineMat = new THREE.LineBasicMaterial({
      color: childColor,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const outline = new THREE.LineSegments(edgesGeo, lineMat);
    outline.isProcessedHolo = true;
    child.add(outline);
    
    if (isTorsoScanline && child.geometry && child.geometry.type === 'CapsuleGeometry') {
      const radius = child.geometry.parameters.radius || 0.35;
      const length = child.geometry.parameters.length || 1.7;
      
      const ringGeo = new THREE.TorusGeometry(radius * 1.02, 0.015, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: childColor,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
      });
      
      const ringOffsets = [-length/3, 0, length/3];
      ringOffsets.forEach(offset => {
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.isProcessedHolo = true;
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.position.y = offset;
        child.add(ringMesh);
      });
    }
  });
}

/**
 * Creates and updates the holographic batter scaled to realistic 6.0 ft adult height
 */
export function updateHolographicBatter(handedness, sz_bot, sz_top) {
  currentBatterHandedness = (handedness || 'RHB').includes('L') ? 'LHB' : 'RHB';
  
  // Set camera positions based on batter handedness (LHB vs RHB slots)
  if (currentBatterHandedness === 'LHB') {
    umpireXOffset = 0.35;
    umpireYOffset = 3.95;
    if (topCamera) topCamera.position.set(-5.8, 2.5, 0.7083);
    if (summaryReviewCamera) summaryReviewCamera.position.set(-4.2, 2.8, 5.0);
  } else {
    umpireXOffset = -0.35;
    umpireYOffset = 3.95;
    if (topCamera) topCamera.position.set(5.8, 2.5, 0.7083);
    if (summaryReviewCamera) summaryReviewCamera.position.set(4.2, 2.8, 5.0);
  }
  
  if (umpireCamera) {
    umpireCamera.position.set(umpireXOffset, umpireYOffset, -4.5);
  }
  
  // Update targets immediately depending on active camera
  if (activeCamera === umpireCamera) {
    targetCameraPos.copy(umpireCamera.position);
  } else if (activeCamera === topCamera) {
    targetCameraPos.copy(topCamera.position);
  } else if (activeCamera === summaryReviewCamera) {
    targetCameraPos.copy(summaryReviewCamera.position);
  }

  if (batterGroup) {
    scene.remove(batterGroup);
    batterGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    batterGroup = null;
  }

  batterGroup = new THREE.Group();

  const holoMat = new THREE.MeshStandardMaterial({
    color: COLORS.holoBatter,
    transparent: true,
    opacity: mannequinOpacity * 0.5,
  });

  const solidHoloMat = new THREE.MeshStandardMaterial({
    color: COLORS.holoBatter,
    transparent: true,
    opacity: mannequinOpacity,
    roughness: 0.45,
    metalness: 0.25,
  });

  // Dynamic proportions relative to the actual strike zone top/bottom
  // A realistic 6.0 - 6.2 ft tall crouched batter
  const hipHeight = sz_bot + 0.5;
  const shoulderHeight = sz_top + 0.7;
  const headHeight = sz_top + 1.35;
  
  const legLength = hipHeight - 0.2;
  const legRadius = 0.16;
  const torsoLength = shoulderHeight - hipHeight;
  const torsoRadius = 0.35;
  const headRadius = 0.32;

  // Torso (Capsule)
  const torsoGeo = new THREE.CapsuleGeometry(torsoRadius, torsoLength, 4, 12);
  const torso = new THREE.Mesh(torsoGeo, solidHoloMat);
  torso.position.y = hipHeight + torsoLength / 2;
  torso.rotation.x = 0.25; // forward stance lean
  batterGroup.add(torso);

  // Head (Sphere)
  const headGeo = new THREE.SphereGeometry(headRadius, 16, 16);
  const head = new THREE.Mesh(headGeo, solidHoloMat);
  head.position.y = headHeight;
  batterGroup.add(head);

  // Helmet Visor
  const visorGeo = new THREE.BoxGeometry(0.2, 0.16, 0.45);
  const visor = new THREE.Mesh(visorGeo, holoMat);
  visor.position.set(0, head.position.y, 0.15); // face pitcher
  batterGroup.add(visor);

  // Legs (Capsules)
  const legGeo = new THREE.CapsuleGeometry(legRadius, legLength, 4, 8);
  
  // Left leg (back/bent)
  const leftLeg = new THREE.Mesh(legGeo, holoMat);
  leftLeg.position.set(-0.35, legLength / 2 + 0.1, -0.1);
  leftLeg.rotation.x = 0.3; // bent knee stance
  batterGroup.add(leftLeg);

  // Right leg (front/bent)
  const rightLeg = new THREE.Mesh(legGeo, holoMat);
  rightLeg.position.set(0.35, legLength / 2 + 0.1, 0.1);
  rightLeg.rotation.x = -0.1;
  batterGroup.add(rightLeg);

  // Humanesque Joint-Based Arms (Shoulder -> Elbow -> Hand)
  const shoulderLeft = new THREE.Vector3(0.42, shoulderHeight, 0.0);
  const shoulderRight = new THREE.Vector3(-0.42, shoulderHeight, 0.0);
  
  // Hands clustered together at the bat handle
  const handLeft = new THREE.Vector3(-0.38, sz_top + 1.05, -0.3);
  const handRight = new THREE.Vector3(-0.42, sz_top + 1.13, -0.34);
  
  // Elbow positions for a natural batting load posture
  const elbowLeft = new THREE.Vector3(0.08, sz_top + 0.35, 0.18);
  const elbowRight = new THREE.Vector3(-0.58, sz_top + 0.65, -0.15);
  
  const armRadius = 0.08;

  // Shoulder joint spheres for structural completeness
  const shoulderSphereGeo = new THREE.SphereGeometry(armRadius * 1.3, 8, 8);
  const shoulderLeftMesh = new THREE.Mesh(shoulderSphereGeo, solidHoloMat);
  shoulderLeftMesh.position.copy(shoulderLeft);
  batterGroup.add(shoulderLeftMesh);
  
  const shoulderRightMesh = new THREE.Mesh(shoulderSphereGeo, solidHoloMat);
  shoulderRightMesh.position.copy(shoulderRight);
  batterGroup.add(shoulderRightMesh);

  // Left arm segments (Shoulder -> Elbow -> Hand)
  const leftUpperArm = createLimbSegment(shoulderLeft, elbowLeft, armRadius, holoMat, true);
  const leftForearm = createLimbSegment(elbowLeft, handLeft, armRadius, holoMat, true);
  batterGroup.add(leftUpperArm);
  batterGroup.add(leftForearm);
  
  // Right arm segments (Shoulder -> Elbow -> Hand)
  const rightUpperArm = createLimbSegment(shoulderRight, elbowRight, armRadius, holoMat, true);
  const rightForearm = createLimbSegment(elbowRight, handRight, armRadius, holoMat, true);
  batterGroup.add(rightUpperArm);
  batterGroup.add(rightForearm);

  // Glowing Baseball Bat
  const batGeo = new THREE.CylinderGeometry(0.08, 0.04, 2.8, 8);
  batGeo.translate(0, 1.4, 0); // Translate so the pivot is at the handle/bottom of the bat
  const woodTexture = createWoodTexture();
  const batMat = new THREE.MeshStandardMaterial({
    color: COLORS.neonBat,
    map: woodTexture,
    emissive: COLORS.neonBat,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.8,
    roughness: 0.6,
  });
  const bat = new THREE.Mesh(batGeo, batMat);
  bat.rotation.x = -Math.PI / 4.5;
  bat.rotation.y = -Math.PI / 6;
  bat.rotation.z = Math.PI / 3.2;
  bat.position.set(-0.4, sz_top + 1.1, -0.32); // Position at hands
  batterGroup.add(bat);

  // Position batter in the box relative to plate midpoint (z = 0.7083)
  if (handedness === 'RHB') {
    batterGroup.position.set(-2.2, 0, 0.7083);
    batterGroup.rotation.y = Math.PI / 2; // face plate
  } else {
    batterGroup.position.set(2.2, 0, 0.7083);
    batterGroup.rotation.y = -Math.PI / 2; // face plate
    bat.rotation.y = Math.PI / 6;
  }

  makeGlowingHolographic(batterGroup, true);

  scene.add(batterGroup);
}

/**
 * Animates the batter swing from progress 0 to 1 (contact at 0.5)
 */
export function animateBatterSwing(progress, handedness) {
  if (!batterGroup) return;
  
  let torso = null;
  let bat = null;
  
  batterGroup.traverse(child => {
    if (child.isMesh) {
      if (child.geometry.type === 'CapsuleGeometry' && child.position.y > 1.0) {
        torso = child;
      }
      if (child.geometry.type === 'CylinderGeometry') {
        bat = child;
      }
    }
  });

  const baseGroupRotation = handedness === 'RHB' ? Math.PI / 2 : -Math.PI / 2;

  if (progress < 0) {
    // Reset to normal batting stance
    batterGroup.rotation.y = baseGroupRotation;
    if (torso) {
      torso.rotation.y = 0;
      torso.rotation.z = 0;
    }
    if (bat) {
      bat.rotation.set(-Math.PI / 4.5, handedness === 'RHB' ? Math.PI / 6 : -Math.PI / 6, Math.PI / 3.2);
      bat.position.set(-0.4, currentSzTop + 1.1, -0.32);
    }
    return;
  }

  // Swing progress: 0.0 to 1.0
  if (bat) {
    const isRHB = handedness === 'RHB';
    
    // Smooth interpolation curves for realistic 3-axis swing plane
    let rx, ry, rz;
    if (progress <= 0.5) {
      // Phase 1: Stance to Contact
      const p = progress / 0.5; // 0 to 1
      rx = -Math.PI / 4.5 + p * (-Math.PI / 12 - (-Math.PI / 4.5));
      ry = (isRHB ? Math.PI / 6 : -Math.PI / 6) + p * (isRHB ? -Math.PI * 0.5 : Math.PI * 0.5);
      rz = Math.PI / 3.2 + p * (Math.PI / 4 - Math.PI / 3.2);
    } else {
      // Phase 2: Contact to Follow-through
      const p = (progress - 0.5) / 0.5; // 0 to 1
      rx = -Math.PI / 12 + p * (Math.PI / 6 - (-Math.PI / 12));
      ry = (isRHB ? -Math.PI / 3 : Math.PI / 3) + p * ((isRHB ? -Math.PI * 0.8 : Math.PI * 0.8) - (isRHB ? -Math.PI / 3 : Math.PI / 3));
      rz = Math.PI / 4 + p * (-Math.PI / 6 - Math.PI / 4);
    }
    
    bat.rotation.x = rx;
    bat.rotation.y = ry;
    bat.rotation.z = rz;
    
    // Whip bat forward and outward through contact zone
    const handOffset = isRHB ? -1 : 1;
    bat.position.x = -0.4 + progress * 0.45 * handOffset;
    bat.position.z = -0.32 + progress * 0.35;
  }
  
  if (torso) {
    torso.rotation.y = progress * (handedness === 'RHB' ? -0.6 : 0.6);
  }
  
  batterGroup.rotation.y = baseGroupRotation + progress * (handedness === 'RHB' ? -0.55 : 0.55);
}

/**
 * Creates the holographic pitcher mannequin scaled to 6.3 ft adult height
 */
export function updateHolographicPitcher(handedness) {
  if (pitcherGroup) {
    scene.remove(pitcherGroup);
    pitcherGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    pitcherGroup = null;
  }

  pitcherGroup = new THREE.Group();

  const holoMat = new THREE.MeshStandardMaterial({
    color: COLORS.holoPitcher,
    transparent: true,
    opacity: mannequinOpacity * 0.5,
  });

  const solidHoloMat = new THREE.MeshStandardMaterial({
    color: COLORS.holoPitcher,
    transparent: true,
    opacity: mannequinOpacity,
    roughness: 0.5,
    metalness: 0.15,
  });

  // Scale variables for a realistic 6.3 foot tall pitcher standing
  const legLength = 2.2;
  const legRadius = 0.17;
  const torsoLength = 1.7;
  const torsoRadius = 0.35;
  const headRadius = 0.38;

  // Torso (Smooth Capsule)
  const torsoGeo = new THREE.CapsuleGeometry(torsoRadius, torsoLength, 4, 12);
  pitcherTorso = new THREE.Mesh(torsoGeo, solidHoloMat);
  pitcherTorso.position.y = legLength + (torsoLength / 2) + 0.1; // stack on legs
  pitcherGroup.add(pitcherTorso);

  // Head (Sphere)
  const headGeo = new THREE.SphereGeometry(headRadius, 16, 16);
  const head = new THREE.Mesh(headGeo, solidHoloMat);
  head.position.y = legLength + torsoLength + headRadius + 0.3;
  pitcherGroup.add(head);

  // Cap Visor
  const capGeo = new THREE.BoxGeometry(0.18, 0.05, 0.4);
  const capVisor = new THREE.Mesh(capGeo, holoMat);
  capVisor.position.set(0, head.position.y, -0.2); // facing home plate
  pitcherGroup.add(capVisor);

  // Legs (Capsules)
  const legGeo = new THREE.CapsuleGeometry(legRadius, legLength, 4, 8);
  
  pitcherLeftLeg = new THREE.Mesh(legGeo, holoMat);
  pitcherLeftLeg.position.set(0.35, legLength / 2 + 0.1, 0);
  pitcherGroup.add(pitcherLeftLeg);

  pitcherRightLeg = new THREE.Mesh(legGeo, holoMat);
  pitcherRightLeg.position.set(-0.35, legLength / 2 + 0.1, 0);
  pitcherGroup.add(pitcherRightLeg);

  // Arms (Capsules)
  const armGeo = new THREE.CapsuleGeometry(0.12, 1.5, 4, 8);
  const shoulderHeight = legLength + torsoLength - 0.2;
  
  pitcherThrowingArm = new THREE.Mesh(armGeo, holoMat);
  pitcherThrowingArm.position.y = shoulderHeight;
  if (handedness === 'RHP') {
    pitcherThrowingArm.position.x = 0.55;
  } else {
    pitcherThrowingArm.position.x = -0.55;
  }
  pitcherGroup.add(pitcherThrowingArm);

  pitcherGloveArm = new THREE.Mesh(armGeo, holoMat);
  pitcherGloveArm.position.y = shoulderHeight;
  if (handedness === 'RHP') {
    pitcherGloveArm.position.x = -0.55;
  } else {
    pitcherGloveArm.position.x = 0.55;
  }
  pitcherGroup.add(pitcherGloveArm);

  // Position on mound (rubber at z=60.5)
  // Mound center height is 0.8, rubber height is 0.21, so stack on top
  pitcherGroup.position.set(0, 0.25, 60.5);
  pitcherGroup.rotation.y = Math.PI; // Face home plate

  makeGlowingHolographic(pitcherGroup, true);

  scene.add(pitcherGroup);
}

/**
 * Animates the pitcher joints during wind-up based on progress (0.0 to 1.0)
 */
export function animatePitcherWindup(progress, handedness) {
  if (!pitcherGroup) return;

  // Dynamically stride the pitcher forward from the rubber (60.5 ft) to release (54.0 ft)
  let groupZ = 60.5;
  if (progress >= 0.4 && progress < 0.8) {
    const p = (progress - 0.4) / 0.4;
    groupZ = 60.5 - 6.5 * p; // Stride 6.5 feet forward
  } else if (progress >= 0.8) {
    groupZ = 54.0;
  }
  pitcherGroup.position.z = groupZ;

  const legLength = 2.2;
  const torsoLength = 1.7;
  const shoulderHeight = legLength + torsoLength - 0.2;

  // Reset
  pitcherLeftLeg.rotation.set(0, 0, 0);
  pitcherLeftLeg.position.set(0.35, legLength / 2 + 0.1, 0);
  
  pitcherRightLeg.rotation.set(0, 0, 0);
  pitcherRightLeg.position.set(-0.35, legLength / 2 + 0.1, 0);
  
  pitcherThrowingArm.rotation.set(0, 0, 0);
  pitcherThrowingArm.position.y = shoulderHeight;
  pitcherThrowingArm.position.x = (handedness === 'RHP' ? 0.55 : -0.55);
  pitcherThrowingArm.position.z = 0;
  
  pitcherGloveArm.rotation.set(0, 0, 0);
  pitcherGloveArm.position.y = shoulderHeight;
  pitcherGloveArm.position.x = (handedness === 'RHP' ? -0.55 : 0.55);
  pitcherGloveArm.position.z = 0;
  
  pitcherTorso.rotation.set(0, 0, 0);

  if (progress < 0.4) {
    // Phase 1: Winding Up
    const p = progress / 0.4;
    
    pitcherTorso.rotation.y = (handedness === 'RHP' ? 0.45 : -0.45) * p;
    
    if (handedness === 'RHP') {
      pitcherLeftLeg.rotation.x = -Math.PI / 2.6 * p;
      pitcherLeftLeg.position.y = (legLength / 2 + 0.1) + 0.3 * p;
      pitcherLeftLeg.position.z = -0.2 * p;
    } else {
      pitcherRightLeg.rotation.x = -Math.PI / 2.6 * p;
      pitcherRightLeg.position.y = (legLength / 2 + 0.1) + 0.3 * p;
      pitcherRightLeg.position.z = -0.2 * p;
    }

    const armRotX = -0.6 * p;
    const armRotZ = (handedness === 'RHP' ? -0.45 : 0.45) * p;
    pitcherThrowingArm.rotation.set(armRotX, 0, armRotZ);
    pitcherGloveArm.rotation.set(armRotX, 0, -armRotZ);

  } else if (progress < 0.8) {
    // Phase 2: Drive & Arm Whip
    const p = (progress - 0.4) / 0.4;
    
    pitcherTorso.rotation.y = (handedness === 'RHP' ? 0.45 : -0.45) * (1 - p) + (handedness === 'RHP' ? -0.75 : 0.75) * p;
    pitcherTorso.rotation.x = 0.3 * p; // lean

    if (handedness === 'RHP') {
      pitcherLeftLeg.rotation.x = -Math.PI / 2.6 * (1 - p) + (Math.PI / 3.8 * p);
      pitcherLeftLeg.position.y = ((legLength / 2 + 0.1) + 0.3) * (1 - p) + 0.1 * p;
      pitcherLeftLeg.position.z = -0.8 * p; // stride forward
    } else {
      pitcherRightLeg.rotation.x = -Math.PI / 2.6 * (1 - p) + (Math.PI / 3.8 * p);
      pitcherRightLeg.position.y = ((legLength / 2 + 0.1) + 0.3) * (1 - p) + 0.1 * p;
      pitcherRightLeg.position.z = -0.8 * p;
    }

    pitcherThrowingArm.rotation.x = -0.6 * (1 - p) + (Math.PI * 0.78 * p);
    pitcherThrowingArm.rotation.z = (handedness === 'RHP' ? -0.95 : 0.95) * p;
    pitcherThrowingArm.position.z = -0.35 * p;

    pitcherGloveArm.rotation.x = -0.6 * (1 - p) + 0.35 * p;
    pitcherGloveArm.rotation.z = (handedness === 'RHP' ? 0.45 : -0.45) * (1 - p);

  } else {
    // Phase 3: Follow Through
    const p = (progress - 0.8) / 0.2;
    
    pitcherTorso.rotation.y = (handedness === 'RHP' ? -0.75 : 0.75);
    pitcherTorso.rotation.x = 0.3 + 0.32 * p; // deep bow

    if (handedness === 'RHP') {
      pitcherLeftLeg.position.z = -0.8;
      pitcherLeftLeg.rotation.x = Math.PI / 3.8;
      
      pitcherRightLeg.rotation.x = -Math.PI / 4.5 * p;
      pitcherRightLeg.position.y = (legLength / 2 + 0.1) + 0.45 * p;
      pitcherRightLeg.position.z = 0.45 * p;
    } else {
      pitcherRightLeg.position.z = -0.8;
      pitcherRightLeg.rotation.x = Math.PI / 3.8;
      
      pitcherLeftLeg.rotation.x = -Math.PI / 4.5 * p;
      pitcherLeftLeg.position.y = (legLength / 2 + 0.1) + 0.45 * p;
      pitcherLeftLeg.position.z = 0.45 * p;
    }

    pitcherThrowingArm.rotation.x = (Math.PI * 0.78) + 0.8 * p;
    pitcherThrowingArm.rotation.z = (handedness === 'RHP' ? -0.95 : 0.95) + 0.4 * p;
  }
}

/**
 * Returns the release point position of the pitcher's hand
 */
export function getPitcherHandWorldPosition(handedness) {
  if (!pitcherGroup || !pitcherThrowingArm) {
    const offset = handedness === 'RHP' ? 1.8 : -1.8;
    return new THREE.Vector3(offset, 5.8, 59.2);
  }
  
  // Transform the bottom tip of the throwing arm capsule (representing the hand) to world coordinates
  const pos = new THREE.Vector3(0, -0.75, 0);
  pitcherThrowingArm.localToWorld(pos);
  return pos;
}

/**
 * Updates the 3D position of the ball mesh
 */
export function animateBallTo(pos) {
  if (ballMesh) {
    ballMesh.position.set(pos.x, pos.y, pos.z);
    ballMesh.rotation.x += 0.15;
    ballMesh.rotation.y += 0.25;
  }
}

/**
 * Sets visibility of the ball mesh
 */
export function showBall(visible) {
  if (ballMesh) {
    ballMesh.visible = visible;
  }
}


export function setCatcherMittPosition(pos) {
  if (catcherMittMesh) {
    catcherMittMesh.position.copy(pos);
  }

  if (catcherLeftArmGroup) {
    // Clear previous arm segments
    while (catcherLeftArmGroup.children.length > 0) {
      const child = catcherLeftArmGroup.children[0];
      catcherLeftArmGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    
    // Dynamic mitt arm connection from left shoulder
    const shoulderLeft = new THREE.Vector3(0.38, 1.7, -2.8);
    
    // Elbow bends outward to the left (positive X)
    const elbowLeft = new THREE.Vector3(
      0.55, 
      (1.7 + pos.y) / 2 - 0.2, 
      (-2.8 + pos.z) / 2
    );
    
    const limbRadius = 0.08;
    const holoMat = new THREE.MeshStandardMaterial({
      color: COLORS.holoBatter,
      transparent: true,
      opacity: 0.12,
    });
    
    catcherLeftArmGroup.add(createLimbSegment(shoulderLeft, elbowLeft, limbRadius, holoMat, true));
    catcherLeftArmGroup.add(createLimbSegment(elbowLeft, pos, limbRadius, holoMat, true));
    makeGlowingHolographic(catcherLeftArmGroup, false);
  }
}

/**
 * Creates a crouching catcher mannequin behind home plate
 */
export function updateHolographicCatcher() {
  if (catcherGroup) {
    scene.remove(catcherGroup);
    catcherGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    catcherGroup = null;
  }

  catcherGroup = new THREE.Group();

  const holoMat = new THREE.MeshStandardMaterial({
    color: COLORS.holoBatter, // cyan
    transparent: true,
    opacity: mannequinOpacity * 0.5,
  });

  const solidHoloMat = new THREE.MeshStandardMaterial({
    color: COLORS.holoBatter,
    transparent: true,
    opacity: mannequinOpacity,
    roughness: 0.45,
    metalness: 0.25,
  });

  // Torso
  const torsoGeo = new THREE.CapsuleGeometry(0.28, 1.0, 4, 12);
  const torso = new THREE.Mesh(torsoGeo, solidHoloMat);
  torso.position.set(0, 1.4, -2.8);
  torso.rotation.x = 0.35; // leaning forward slightly
  catcherGroup.add(torso);

  // Head
  const headGeo = new THREE.SphereGeometry(0.26, 16, 16);
  const head = new THREE.Mesh(headGeo, solidHoloMat);
  head.position.set(0, 2.15, -2.7);
  catcherGroup.add(head);

  // Catcher Mask grid representation
  const maskGeo = new THREE.BoxGeometry(0.2, 0.25, 0.35);
  const mask = new THREE.Mesh(maskGeo, holoMat);
  mask.position.set(0, 2.15, -2.5);
  catcherGroup.add(mask);

  const limbRadius = 0.08;

  // Squatting Legs
  const leftHip = new THREE.Vector3(0.25, 0.9, -2.8);
  const leftKnee = new THREE.Vector3(0.5, 0.6, -2.0);
  const leftFoot = new THREE.Vector3(0.35, 0.1, -2.4);

  const rightHip = new THREE.Vector3(-0.25, 0.9, -2.8);
  const rightKnee = new THREE.Vector3(-0.5, 0.6, -2.0);
  const rightFoot = new THREE.Vector3(-0.35, 0.1, -2.4);

  // Left leg segments
  catcherGroup.add(createLimbSegment(leftHip, leftKnee, limbRadius, holoMat, true));
  catcherGroup.add(createLimbSegment(leftKnee, leftFoot, limbRadius, holoMat, true));

  // Right leg segments
  catcherGroup.add(createLimbSegment(rightHip, rightKnee, limbRadius, holoMat, true));
  catcherGroup.add(createLimbSegment(rightKnee, rightFoot, limbRadius, holoMat, true));

  // Right Arm (resting on thigh)
  const shoulderRight = new THREE.Vector3(-0.38, 1.7, -2.8);
  const elbowRight = new THREE.Vector3(-0.52, 1.1, -2.6);
  const handRight = new THREE.Vector3(-0.35, 0.6, -2.2);

  catcherGroup.add(createLimbSegment(shoulderRight, elbowRight, limbRadius, holoMat, true));
  catcherGroup.add(createLimbSegment(elbowRight, handRight, limbRadius, holoMat, true));

  // Catcher Left Arm Group (mitt arm - dynamically populated in setCatcherMittPosition)
  catcherLeftArmGroup = new THREE.Group();
  catcherGroup.add(catcherLeftArmGroup);

  makeGlowingHolographic(catcherGroup, true);

  scene.add(catcherGroup);
}

export function setUmpireSlot(slot) {
  if (typeof slot === 'number' && !isNaN(slot)) {
    umpireXOffset = Math.max(-1.0, Math.min(1.0, slot));
  } else if (slot === 'left') {
    umpireXOffset = -0.7;
  } else if (slot === 'right') {
    umpireXOffset = 0.7;
  } else {
    umpireXOffset = 0.0;
  }
  if (activeCamera === umpireCamera) {
    targetCameraPos.x = umpireXOffset;
  }
}

/**
 * Custom setter for Umpire camera crouch height
 */
export function setUmpireHeight(height) {
  if (typeof height === 'number' && !isNaN(height)) {
    umpireYOffset = Math.max(3.6, Math.min(4.8, height));
  } else if (height === 'low') {
    umpireYOffset = 3.8;
  } else {
    umpireYOffset = 4.5;
  }
  if (activeCamera === umpireCamera) {
    targetCameraPos.y = umpireYOffset;
  }
}

/**
 * Critically damped spring-damper helper for Vector3 interpolation (limits velocity/jerk)
 */
function smoothDampVec3(current, target, currentVelocity, smoothTime, maxSpeed, deltaTime) {
  smoothTime = Math.max(0.0001, smoothTime);
  const num = 2 / smoothTime;
  const num2 = num * deltaTime;
  const num3 = 1 / (1 + num2 + 0.48 * num2 * num2 + 0.235 * num2 * num2 * num2);
  
  let changeX = current.x - target.x;
  let changeY = current.y - target.y;
  let changeZ = current.z - target.z;
  
  const maxChange = maxSpeed * smoothTime;
  const maxChangeSq = maxChange * maxChange;
  const changeSq = changeX * changeX + changeY * changeY + changeZ * changeZ;
  if (changeSq > maxChangeSq) {
    const changeLen = Math.sqrt(changeSq);
    changeX = (changeX / changeLen) * maxChange;
    changeY = (changeY / changeLen) * maxChange;
    changeZ = (changeZ / changeLen) * maxChange;
  }
  
  const targetX = current.x - changeX;
  const targetY = current.y - changeY;
  const targetZ = current.z - changeZ;
  
  const tempX = (currentVelocity.x + num * changeX) * deltaTime;
  const tempY = (currentVelocity.y + num * changeY) * deltaTime;
  const tempZ = (currentVelocity.z + num * changeZ) * deltaTime;
  
  currentVelocity.x = (currentVelocity.x - num * tempX) * num3;
  currentVelocity.y = (currentVelocity.y - num * tempY) * num3;
  currentVelocity.z = (currentVelocity.z - num * tempZ) * num3;
  
  let outputX = targetX + (changeX + tempX) * num3;
  let outputY = targetY + (changeY + tempY) * num3;
  let outputZ = targetZ + (changeZ + tempZ) * num3;
  
  const origMinusTargetX = current.x - target.x;
  const origMinusTargetY = current.y - target.y;
  const origMinusTargetZ = current.z - target.z;
  const outMinusTargetX = outputX - target.x;
  const outMinusTargetY = outputY - target.y;
  const outMinusTargetZ = outputZ - target.z;
  
  if (origMinusTargetX * outMinusTargetX + origMinusTargetY * outMinusTargetY + origMinusTargetZ * outMinusTargetZ < 0) {
    outputX = target.x;
    outputY = target.y;
    outputZ = target.z;
    currentVelocity.set(0, 0, 0);
  }
  
  return new THREE.Vector3(outputX, outputY, outputZ);
}

/**
 * Transition camera position and target orientation smoothly using spring-damper.
 * This prevents the camera from jerking or spinning when crossing the look-at target.
 */
export function updateCameraTransition() {
  const targetLook = new THREE.Vector3(0, 1.5, 15.0); // Default: looking down at plate area
  
  if (isZoomedIn) {
    const zoneCenter = (currentSzTop + currentSzBot) / 2;
    const aspect = mainCamera.aspect || 1.0;
    const zScale = aspect < 1.0 ? Math.max(0.6, aspect) : 1.0;
    const targetZ = -1.8 / zScale;
    targetCameraPos.set(umpireXOffset * 0.35, zoneCenter + 0.15, targetZ);
    targetLook.set(0, zoneCenter, 0.7083);
  } else if (activeCamera === summaryReviewCamera) {
    const zoneCenter = strikeZoneMesh ? strikeZoneMesh.position.y : 2.5;
    targetCameraPos.copy(summaryReviewCamera.position);
    targetLook.set(0, zoneCenter, 0.7083);
  } else if (activeCamera === umpireCamera) {
    targetCameraPos.set(umpireXOffset, umpireYOffset, -4.5);
    targetLook.set(0, 1.5, 15.0);
  } else if (activeCamera === sideCamera) {
    targetCameraPos.copy(sideCamera.position);
    const zoneCenter = strikeZoneMesh ? strikeZoneMesh.position.y : 2.5;
    targetLook.set(0, zoneCenter, 0.7083);
  } else if (activeCamera === topCamera) {
    targetCameraPos.copy(topCamera.position);
    const zoneCenter = strikeZoneMesh ? strikeZoneMesh.position.y : 2.5;
    targetLook.set(0, zoneCenter, 0.7083);
  } else if (strikeZoneMesh) {
    if (activeCamera === sideCamera || activeCamera === topCamera) {
      targetLook.set(0, strikeZoneMesh.position.y, 0.7083);
    }
  }

  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (dt > 0) {
    const smoothTime = 0.25; 
    const maxSpeed = 35.0; 
    
    const nextPos = smoothDampVec3(mainCamera.position, targetCameraPos, cameraVelocity, smoothTime, maxSpeed, dt);
    mainCamera.position.copy(nextPos);
    
    const nextLook = smoothDampVec3(currentCameraLookAt, targetLook, lookAtVelocity, smoothTime, maxSpeed, dt);
    currentCameraLookAt.copy(nextLook);
    mainCamera.lookAt(currentCameraLookAt);
  }
}

/**
 * Change the active camera angle
 */
export function setCameraAngle(angleName) {
  if (angleName === 'umpire') {
    activeCamera = umpireCamera;
    umpireCamera.position.set(umpireXOffset, umpireYOffset, -4.5);
    targetCameraPos.copy(umpireCamera.position);
    cameraTransitionSpeed = 0.08;
  } else if (angleName === 'side') {
    activeCamera = sideCamera;
    targetCameraPos.copy(sideCamera.position);
    cameraTransitionSpeed = 0.12; 
  } else if (angleName === 'top') {
    activeCamera = topCamera;
    targetCameraPos.copy(topCamera.position);
    cameraTransitionSpeed = 0.12; 
  } else if (angleName === 'summary-review') {
    activeCamera = summaryReviewCamera;
    targetCameraPos.copy(summaryReviewCamera.position);
    cameraTransitionSpeed = 0.08;
  }
}

/**
 * Start position check: verifies that the camera is exactly in the correct position for calling the pitch.
 * If there is significant drift or if it's out of position, snap it instantly to avoid transition lag.
 */
export function verifyAndForceUmpireCameraPosition() {
  const isLHB = (currentBatterHandedness || 'RHB').includes('L');
  const expectedX = isLHB ? 0.35 : -0.35;
  const expectedY = 3.95;
  const expectedZ = -4.5;
  
  const targetPos = new THREE.Vector3(expectedX, expectedY, expectedZ);
  const distance = mainCamera.position.distanceTo(targetPos);
  
  if (distance > 0.05) {
    console.log(`[Camera Verify] Camera out of position by ${distance.toFixed(3)}m. Snapping to (${expectedX}, ${expectedY}, ${expectedZ}).`);
    mainCamera.position.copy(targetPos);
    cameraVelocity.set(0, 0, 0);
    lookAtVelocity.set(0, 0, 0);
    
    const zoneCenter = strikeZoneMesh ? strikeZoneMesh.position.y : 2.5;
    const targetLook = new THREE.Vector3(0, zoneCenter, 0.7083);
    currentCameraLookAt.copy(targetLook);
    mainCamera.lookAt(currentCameraLookAt);
  }
}

/**
 * Positions the summary-review camera (post-AB chart 3D replay).
 */
export function setSummaryReviewCameraPose(x, y, z, lookAtY) {
  if (!summaryReviewCamera) return;
  const lookY = lookAtY !== undefined ? lookAtY : (strikeZoneMesh ? strikeZoneMesh.position.y : 2.5);
  summaryReviewCamera.position.set(x, y, z);
  summaryReviewCamera.lookAt(0, lookY, 0.7083);
  if (activeCamera === summaryReviewCamera) {
    targetCameraPos.copy(summaryReviewCamera.position);
  }
}

/**
 * Returns the name of the active camera
 */
export function getActiveCameraName() {
  if (activeCamera === umpireCamera) return 'umpire';
  if (activeCamera === sideCamera) return 'side';
  if (activeCamera === topCamera) return 'top';
  if (activeCamera === summaryReviewCamera) return 'summary-review';
  return 'unknown';
}

/**
 * Updates camera position dynamically on the welcome screen to pan slowly
 */
export function updateWelcomeCamera(time) {
  if (activeCamera === umpireCamera) {
    umpireCamera.position.set(
      umpireXOffset + Math.sin(time) * 1.6,
      3.2 + Math.cos(time * 0.7) * 0.35,
      -5.0 + Math.sin(time * 0.4) * 0.5
    );
    targetCameraPos.copy(umpireCamera.position);
  }
}


/**
 * Draws a 3D line tracing the trajectory path of the pitch
 */
export function drawTrajectoryTrace(points, currentZ = 0.7083) {
  if (pitchTraceLine) {
    scene.remove(pitchTraceLine);
    pitchTraceLine.geometry.dispose();
    pitchTraceLine = null;
  }

  if (points.length < 2) return;

  // Filter points to only draw the trajectory up to the current ball Z
  // Remember: as ball travels from pitcher to catcher, z decreases.
  // We want to draw from release point (z ~54) down to the current ball position.
  // So we include points where p.z is >= currentZ - 0.02 (with safety epsilon).
  const limitZ = currentZ;
  const filteredPoints = points.filter(p => p.z >= limitZ - 0.02);
  if (filteredPoints.length < 2) return;

  const curvePoints = filteredPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.5);
  
  const tubeGeo = new THREE.TubeGeometry(curve, Math.max(2, Math.round(filteredPoints.length * 1.5)), 0.035, 8, false);
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0xd8b4fe,
    emissive: 0xc084fc,
    emissiveIntensity: 1.4,
    transparent: true,
    opacity: 0.65,
    roughness: 0.3,
    metalness: 0.1,
    depthWrite: false,
  });

  pitchTraceLine = new THREE.Mesh(tubeGeo, tubeMat);
  scene.add(pitchTraceLine);
}

/**
 * Highlights the point where the ball crossed the plate with a 3D marker and vertical indicator line
 */
export function drawCrossingMarker(point, isStrike) {
  const markerRadius = 0.13;
  const color = isStrike ? COLORS.strikeCorrect : COLORS.strikeIncorrect;
  
  if (crossingMarkerMesh) {
    scene.remove(crossingMarkerMesh);
    crossingMarkerMesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    crossingMarkerMesh = null;
  }
  
  crossingMarkerMesh = new THREE.Group();

  // Flat filled circle (broadcast-style stamp disk)
  const circleGeo = new THREE.CircleGeometry(markerRadius, 24);
  const circleMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const circle = new THREE.Mesh(circleGeo, circleMat);
  crossingMarkerMesh.add(circle);

  // White border ring (TorusGeometry for clean outline)
  const borderGeo = new THREE.TorusGeometry(markerRadius, 0.018, 8, 32);
  const borderMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
  });
  const border = new THREE.Mesh(borderGeo, borderMat);
  crossingMarkerMesh.add(border);

  // Outer glow ring
  const glowGeo = new THREE.TorusGeometry(markerRadius * 1.35, 0.012, 8, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  crossingMarkerMesh.add(glow);



  // Sonar ripple ring (animated in render loop)
  const rippleGeo = new THREE.TorusGeometry(markerRadius * 1.8, 0.01, 8, 32);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const ripple = new THREE.Mesh(rippleGeo, rippleMat);
  ripple.name = 'sonarRipple';
  crossingMarkerMesh.add(ripple);

  crossingMarkerMesh.position.set(point.x, point.y, point.z - 0.01);
  
  // Start at zero scale for animated pop-in
  crossingMarkerMesh.scale.set(0.001, 0.001, 0.001);
  markerCurrentScale = 0.0;
  markerTargetScale = 0.0;
  
  scene.add(crossingMarkerMesh);
}

/**
 * Removes the trajectory line trace and crossing marker from the scene
 */
export function clearTrajectoryTrace() {
  if (pitchTraceLine) {
    scene.remove(pitchTraceLine);
    pitchTraceLine.geometry.dispose();
    pitchTraceLine = null;
  }
  if (crossingMarkerMesh) {
    scene.remove(crossingMarkerMesh);
    crossingMarkerMesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    crossingMarkerMesh = null;
  }
}

/**
 * Window resize handler
 */
export function onResize(width, height) {
  const aspect = width / height;
  
  umpireCamera.aspect = aspect;
  umpireCamera.updateProjectionMatrix();
  
  sideCamera.aspect = aspect;
  sideCamera.updateProjectionMatrix();
  
  topCamera.aspect = aspect;
  topCamera.updateProjectionMatrix();
  
  if (summaryReviewCamera) {
    summaryReviewCamera.aspect = aspect;
    summaryReviewCamera.updateProjectionMatrix();
  }
  
  mainCamera.aspect = aspect;
  mainCamera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
  render();
}

/**
 * Projects the 3D strike zone corners to update screen-space HTML labels showing zone dimensions
 */
/**
 * Calculates the exact Euclidean distance from the ball center (at plate Z)
 * to the boundary of the extended ABS strike zone.
 * Ball is a strike if center is inside the zone (returns negative distance to closest edge).
 * Ball is a ball if center is outside the zone (returns positive distance to zone boundary).
 */
export function getDistanceToABSZone(x, y) {
  // Extended ABS strike zone dimensions (plate width + ball radius)
  const xMin = -0.8283;
  const xMax = 0.8283;
  const yMin = currentSzBot - 0.12;
  const yMax = currentSzTop + 0.12;

  // Distance on X and Y axes to the edge of the extended zone
  const dx = Math.max(0, xMin - x, x - xMax);
  const dy = Math.max(0, yMin - y, y - yMax);

  if (dx === 0 && dy === 0) {
    // Inside the extended zone (Strike). Calculate distance to closest edge inside.
    const distToLeft = x - xMin;
    const distToRight = xMax - x;
    const distToBottom = y - yMin;
    const distToTop = yMax - y;
    const minEdgeDist = Math.min(distToLeft, distToRight, distToBottom, distToTop);
    return -minEdgeDist; 
  } else {
    // Outside the extended zone (Ball). Return Euclidean distance to extended box.
    return Math.sqrt(dx * dx + dy * dy);
  }
}

export function drawDimensionLine(crossPos) {
  clearDimensionLine();
  
  // Visual ruler should match the visible strike-zone plane (rulebook),
  // otherwise it looks like the line extends past the zone.
  const xMin = -0.7083;
  const xMax = 0.7083;
  const yMin = currentSzBot;
  const yMax = currentSzTop;
  
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  
  let targetX, targetY;
  
  // Compute distance relative to the visual (rulebook) zone for this ruler.
  const dist = (() => {
    const dx = Math.max(0, xMin - crossPos.x, crossPos.x - xMax);
    const dy = Math.max(0, yMin - crossPos.y, crossPos.y - yMax);
    if (dx === 0 && dy === 0) {
      const distToLeft = crossPos.x - xMin;
      const distToRight = xMax - crossPos.x;
      const distToBottom = crossPos.y - yMin;
      const distToTop = yMax - crossPos.y;
      const minEdgeDist = Math.min(distToLeft, distToRight, distToBottom, distToTop);
      return -minEdgeDist;
    }
    return Math.sqrt(dx * dx + dy * dy);
  })();
  if (dist < 0) {
    const distToLeft = crossPos.x - xMin;
    const distToRight = xMax - crossPos.x;
    const distToBottom = crossPos.y - yMin;
    const distToTop = yMax - crossPos.y;
    const minDist = Math.min(distToLeft, distToRight, distToBottom, distToTop);
    
    if (minDist === distToLeft) {
      targetX = xMin; targetY = crossPos.y;
    } else if (minDist === distToRight) {
      targetX = xMax; targetY = crossPos.y;
    } else if (minDist === distToBottom) {
      targetX = crossPos.x; targetY = yMin;
    } else {
      targetX = crossPos.x; targetY = yMax;
    }
  } else {
    targetX = clamp(crossPos.x, xMin, xMax);
    targetY = clamp(crossPos.y, yMin, yMax);
  }
  
  const zPlane = 0.7083;
  const startPt = new THREE.Vector3(crossPos.x, crossPos.y, zPlane);
  const endPt = new THREE.Vector3(targetX, targetY, zPlane);
  
  // --- 1. Dashed Leader Line ---
  const linePoints = [startPt.clone(), endPt.clone()];
  const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const isStrike = dist < 0;
  const lineColor = isStrike ? 0x22c55e : 0xef4444;
  
  const material = new THREE.LineDashedMaterial({
    color: lineColor,
    linewidth: 3.0,
    scale: 1.0,
    dashSize: 0.05,
    gapSize: 0.03,
  });
  
  dimensionLineMesh = new THREE.Line(geometry, material);
  dimensionLineMesh.computeLineDistances();
  dimensionLineMesh.name = "dimensionLine";
  scene.add(dimensionLineMesh);
  
  // --- 2. Perpendicular Tick Marks at Endpoints ---
  dimensionTickGroup = new THREE.Group();
  dimensionTickGroup.name = "dimensionTicks";
  
  const dx = endPt.x - startPt.x;
  const dy = endPt.y - startPt.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len > 0.001) {
    // Perpendicular direction
    const perpX = -dy / len;
    const perpY = dx / len;
    const tickHalf = 0.06; // half-length of tick mark
    
    const tickMat = new THREE.LineBasicMaterial({ color: lineColor });
    
    // Tick at start point (ball crossing)
    const tick1Pts = [
      new THREE.Vector3(startPt.x + perpX * tickHalf, startPt.y + perpY * tickHalf, zPlane),
      new THREE.Vector3(startPt.x - perpX * tickHalf, startPt.y - perpY * tickHalf, zPlane)
    ];
    const tick1Geo = new THREE.BufferGeometry().setFromPoints(tick1Pts);
    const tick1 = new THREE.Line(tick1Geo, tickMat);
    dimensionTickGroup.add(tick1);
    
    // Tick at end point (zone edge)
    const tick2Pts = [
      new THREE.Vector3(endPt.x + perpX * tickHalf, endPt.y + perpY * tickHalf, zPlane),
      new THREE.Vector3(endPt.x - perpX * tickHalf, endPt.y - perpY * tickHalf, zPlane)
    ];
    const tick2Geo = new THREE.BufferGeometry().setFromPoints(tick2Pts);
    const tick2 = new THREE.Line(tick2Geo, tickMat);
    dimensionTickGroup.add(tick2);
  }
  
  scene.add(dimensionTickGroup);
  
  // --- 3. 3D Label Sprite at Midpoint ---
  const midX = (startPt.x + endPt.x) / 2;
  const midY = (startPt.y + endPt.y) / 2;
  const absDist = Math.abs(dist);
  const distInches = absDist * 12.0;
  
  let labelText;
  if (distInches < 0.1) {
    labelText = '< 0.1"';
  } else if (isStrike && distInches > 12.0) {
    labelText = 'IN ZONE';
  } else {
    labelText = `${distInches.toFixed(1)}"`;
  }
  const statusText = isStrike ? 'IN' : 'OUT';
  
  // Render label to canvas
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  
  // Background pill
  const bgColor = isStrike ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)';
  ctx.fillStyle = bgColor;
  const rx = 14;
  const bw = 250, bh = 88;
  ctx.beginPath();
  ctx.moveTo(3 + rx, 4);
  ctx.lineTo(3 + bw - rx, 4);
  ctx.quadraticCurveTo(3 + bw, 4, 3 + bw, 4 + rx);
  ctx.lineTo(3 + bw, 4 + bh - rx);
  ctx.quadraticCurveTo(3 + bw, 4 + bh, 3 + bw - rx, 4 + bh);
  ctx.lineTo(3 + rx, 4 + bh);
  ctx.quadraticCurveTo(3, 4 + bh, 3, 4 + bh - rx);
  ctx.lineTo(3, 4 + rx);
  ctx.quadraticCurveTo(3, 4, 3 + rx, 4);
  ctx.closePath();
  ctx.fill();
  
  // Outline
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Distance text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, 128, 38);
  
  // Status subtext
  ctx.font = 'bold 28px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(statusText, 128, 72);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  });
  
  dimensionLabelSprite = new THREE.Sprite(spriteMat);
  
  // Place label above or below the zone (flip if it would cover the pitch)
  const zoneMidY = (currentSzTop + currentSzBot) / 2;
  const labelOffset = 0.22;
  let labelWorldY = crossPos.y >= zoneMidY ? currentSzTop + labelOffset : currentSzBot - labelOffset;
  if (Math.abs(labelWorldY - crossPos.y) < 0.22) {
    labelWorldY = crossPos.y >= zoneMidY ? currentSzBot - labelOffset : currentSzTop + labelOffset;
  }
  const labelWorldX = Math.max(xMin, Math.min(crossPos.x, xMax));
  
  dimensionLabelSprite.position.set(labelWorldX, labelWorldY, zPlane + 0.03);
  dimensionLabelSprite.scale.set(0.45, 0.17, 1);
  dimensionLabelSprite.name = "dimensionLabel";
  scene.add(dimensionLabelSprite);
}

export function clearDimensionLine() {
  if (dimensionLineMesh) {
    scene.remove(dimensionLineMesh);
    dimensionLineMesh.geometry.dispose();
    dimensionLineMesh.material.dispose();
    dimensionLineMesh = null;
  }
  if (dimensionLabelSprite) {
    scene.remove(dimensionLabelSprite);
    if (dimensionLabelSprite.material) {
      if (dimensionLabelSprite.material.map) dimensionLabelSprite.material.map.dispose();
      dimensionLabelSprite.material.dispose();
    }
    dimensionLabelSprite = null;
  }
  if (dimensionTickGroup) {
    dimensionTickGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    scene.remove(dimensionTickGroup);
    dimensionTickGroup = null;
  }
}

/**
 * Projects the 3D strike zone corners to update screen-space HTML labels showing zone dimensions,
 * and projects the ball crossing point to display distance-to-zone measurements.
 */
function projectWorldPointToScreen(x, y, z) {
  if (!mainCamera || !renderer) return null;
  const container = renderer.domElement.parentElement;
  if (!container) return null;
  const tempV = new THREE.Vector3(x, y, z);
  tempV.project(mainCamera);
  if (tempV.z > 1) return { behind: true };
  const width = container.clientWidth;
  const height = container.clientHeight;
  return {
    behind: false,
    x: (tempV.x * 0.5 + 0.5) * width,
    y: (tempV.y * -0.5 + 0.5) * height,
  };
}

/**
 * Picks above-zone vs below-zone screen placement for distance labels.
 * Flips side if the label would overlap the pitch marker.
 */
export function pickZoneDistanceLabelScreenPos(crossX, crossY, z = 0.7083) {
  const top = projectWorldPointToScreen(0, currentSzTop + 0.06, z);
  const bot = projectWorldPointToScreen(0, currentSzBot - 0.06, z);
  const pitch = projectWorldPointToScreen(crossX, crossY, z);
  if (!top || !bot || !pitch || top.behind || bot.behind || pitch.behind) {
    return null;
  }

  const zoneMidScreenY = (top.y + bot.y) / 2;
  let aboveZone = pitch.y > zoneMidScreenY;
  let labelX = pitch.x;
  let labelY = aboveZone ? top.y - 14 : bot.y + 14;
  let transform = aboveZone ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';

  if (Math.hypot(labelX - pitch.x, labelY - pitch.y) < 46) {
    aboveZone = !aboveZone;
    labelY = aboveZone ? top.y - 14 : bot.y + 14;
    transform = aboveZone ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
  }

  return { x: labelX, y: labelY, transform, aboveZone };
}

export function positionZoneDistanceHtmlLabel(el, crossX, crossY) {
  if (!el) return;
  const pos = pickZoneDistanceLabelScreenPos(crossX, crossY);
  if (!pos) {
    el.style.opacity = '0';
    return;
  }
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  el.style.transform = pos.transform;
}

export function updateStrikeZoneLabels() {
  if (!szTopLabelEl) szTopLabelEl = document.getElementById('sz-top-label');
  if (!szBotLabelEl) szBotLabelEl = document.getElementById('sz-bot-label');
  if (!absBallDistanceLabelEl) absBallDistanceLabelEl = document.getElementById('abs-ball-distance-label');

  if (!szTopLabelEl || !szBotLabelEl) return;

  const szVisible = strikeZoneMesh && strikeZoneMesh.visible;
  if (!szVisible) {
    szTopLabelEl.style.opacity = '0';
    szBotLabelEl.style.opacity = '0';
    if (absBallDistanceLabelEl) absBallDistanceLabelEl.style.opacity = '0';
    return;
  }

  const container = renderer.domElement.parentElement;
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  const tempV = new THREE.Vector3();

  // 1. Strike Zone Height Labels (only when NOT reviewing to avoid clutter)
  const showHeightLabels = szVisible && !isReviewing;
  if (!showHeightLabels) {
    szTopLabelEl.style.opacity = '0';
    szBotLabelEl.style.opacity = '0';
  } else {
    // Top Height Label
    tempV.set(-0.85, currentSzTop, 0.7083);
    tempV.project(mainCamera);
    if (tempV.z > 1) {
      szTopLabelEl.style.opacity = '0';
    } else {
      const topX = (tempV.x * 0.5 + 0.5) * width;
      const topY = (tempV.y * -0.5 + 0.5) * height;
      szTopLabelEl.style.left = `${topX}px`;
      szTopLabelEl.style.top = `${topY}px`;
      szTopLabelEl.style.transform = 'translate(-110%, -50%)';
      szTopLabelEl.style.opacity = '1';
      szTopLabelEl.textContent = `${currentSzTop.toFixed(2)} FT`;
    }

    // Bottom Height Label
    tempV.set(-0.85, currentSzBot, 0.7083);
    tempV.project(mainCamera);
    if (tempV.z > 1) {
      szBotLabelEl.style.opacity = '0';
    } else {
      const botX = (tempV.x * 0.5 + 0.5) * width;
      const botY = (tempV.y * -0.5 + 0.5) * height;
      szBotLabelEl.style.left = `${botX}px`;
      szBotLabelEl.style.top = `${botY}px`;
      szBotLabelEl.style.transform = 'translate(-110%, -50%)';
      szBotLabelEl.style.opacity = '1';
      szBotLabelEl.textContent = `${currentSzBot.toFixed(2)} FT`;
    }
  }

  // 2. Ball Distance-to-Zone Label (only when reviewing)
  if (absBallDistanceLabelEl) {
    const showDistanceLabel = szVisible && isReviewing && crossingMarkerMesh;
    if (!showDistanceLabel) {
      absBallDistanceLabelEl.style.opacity = '0';
    } else {
      const markerPos = crossingMarkerMesh.position;
      tempV.set(markerPos.x, markerPos.y + 0.28, markerPos.z);
      tempV.project(mainCamera);

      if (tempV.z > 1) {
        absBallDistanceLabelEl.style.opacity = '0';
      } else {
        positionZoneDistanceHtmlLabel(absBallDistanceLabelEl, markerPos.x, markerPos.y);
        absBallDistanceLabelEl.style.opacity = '1';

        const dist = getDistanceToABSZone(markerPos.x, markerPos.y);
        const distInches = dist * 12.0;

        if (distInches > 0) {
          // Ball
          if (distInches < 0.1) {
            absBallDistanceLabelEl.textContent = '< 0.1"';
          } else {
            absBallDistanceLabelEl.textContent = `${distInches.toFixed(1)}"`;
          }
          absBallDistanceLabelEl.className = 'absolute pointer-events-none transition-opacity duration-200 px-2 py-0.5 text-[10px] font-extrabold font-mono-tech bg-white text-slate-900 border border-slate-300 rounded shadow-md z-30';
        } else {
          // Strike
          const absDist = Math.abs(distInches);
          if (absDist < 0.1) {
            absBallDistanceLabelEl.textContent = '< 0.1"';
          } else if (absDist < 1.0) {
            absBallDistanceLabelEl.textContent = `${absDist.toFixed(1)}"`;
          } else {
            absBallDistanceLabelEl.textContent = 'IN ZONE';
          }
          absBallDistanceLabelEl.className = 'absolute pointer-events-none transition-opacity duration-200 px-2 py-0.5 text-[10px] font-extrabold font-mono-tech bg-white text-red-600 border border-red-200 rounded shadow-md z-30';
        }
      }
    }
  }
}


/**
 * Renders the scene from the perspective of the main camera
 */
export function render() {
  updateCameraTransition();
  updateStrikeZoneLabels();

  // Animate crossing marker scale (spring-like pop)
  if (crossingMarkerMesh) {
    const stiffness = 0.16;
    markerCurrentScale += (markerTargetScale - markerCurrentScale) * stiffness;
    const s = Math.max(0.001, markerCurrentScale);
    crossingMarkerMesh.scale.set(s, s, s);
  }

  // Animate sonar ripple effect
  if (crossingMarkerMesh && markerTargetScale > 0.5) {
    crossingMarkerRippleScale += 0.02;
    crossingMarkerRippleOpacity -= 0.008;
    if (crossingMarkerRippleOpacity <= 0) {
      crossingMarkerRippleScale = 1.0;
      crossingMarkerRippleOpacity = 0.6;
    }
    crossingMarkerMesh.traverse(child => {
      if (child.name === 'sonarRipple') {
        child.scale.set(crossingMarkerRippleScale, crossingMarkerRippleScale, 1);
        if (child.material) {
          child.material.opacity = Math.max(0, crossingMarkerRippleOpacity);
        }
      }
    });
  }

  // Animate strike zone preview flash
  if (isPreviewFlashing && strikeZoneMesh) {
    const elapsed = performance.now() - previewFlashStartTime;
    const progress = elapsed / PREVIEW_FLASH_DURATION;
    
    if (progress >= 1.0) {
      isPreviewFlashing = false;
      strikeZoneMesh.visible = false;
      // Reset to defaults
      strikeZoneMesh.material.opacity = 0.20;
      if (strikeZoneOutline && strikeZoneOutline.material) {
        strikeZoneOutline.material.opacity = 1.0;
      }
    } else {
      let targetOpacity = 0.20;
      let targetOutlineOpacity = 1.0;
      
      if (progress < 0.2) {
        // Fade in
        const p = progress / 0.2;
        targetOpacity = 0.35 * p;
        targetOutlineOpacity = p;
      } else if (progress < 0.6) {
        // Pulse slightly
        const p = (progress - 0.2) / 0.4;
        const pulse = Math.sin(p * Math.PI * 4) * 0.05;
        targetOpacity = 0.30 + pulse;
        targetOutlineOpacity = 0.85 + pulse * 2.0;
      } else {
        // Fade out
        const p = (progress - 0.6) / 0.4;
        targetOpacity = 0.30 * (1.0 - p);
        targetOutlineOpacity = 1.0 - p;
      }
      
      strikeZoneMesh.material.opacity = targetOpacity;
      strikeZoneMesh.material.transparent = true;
      if (strikeZoneOutline && strikeZoneOutline.material) {
        strikeZoneOutline.material.opacity = targetOutlineOpacity;
        strikeZoneOutline.material.transparent = true;
      }
    }
  }

  if (renderer && scene && mainCamera) {
    renderer.render(scene, mainCamera);
  }
}

export function setMannequinOpacity(opacity) {
  mannequinOpacity = opacity;
  
  const updateGroupMat = (group) => {
    if (!group) return;
    group.traverse(child => {
      if (child.material) {
        if (child.material.opacity <= 0.15) {
          child.material.opacity = opacity * 0.5;
        } else {
          child.material.opacity = opacity;
        }
        child.material.transparent = true;
        child.material.needsUpdate = true;
      }
    });
  };

  updateGroupMat(batterGroup);
  updateGroupMat(pitcherGroup);
  updateGroupMat(catcherGroup);
}

export function setBattersEyeColor(colorHex) {
  if (battersEyeMesh && battersEyeMesh.material) {
    battersEyeMesh.material.color.setHex(parseInt(colorHex.replace('#', '0x')));
    battersEyeMesh.material.needsUpdate = true;
  }
}

export function updateNameplates(pitcherName, pitcherHand, batterName, batterHand) {
  // Remove and dispose of old nameplates
  if (pitcherNameplateSprite) {
    scene.remove(pitcherNameplateSprite);
    if (pitcherNameplateSprite.material) {
      if (pitcherNameplateSprite.material.map) pitcherNameplateSprite.material.map.dispose();
      pitcherNameplateSprite.material.dispose();
    }
    pitcherNameplateSprite = null;
  }
  if (batterNameplateSprite) {
    scene.remove(batterNameplateSprite);
    if (batterNameplateSprite.material) {
      if (batterNameplateSprite.material.map) batterNameplateSprite.material.map.dispose();
      batterNameplateSprite.material.dispose();
    }
    batterNameplateSprite = null;
  }
  // 3D nameplates are deprecated in favor of 2D Matchup Cards in HUD.
}

function createNameplateTexture(name, details, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, 512, 128);
  
  // Capsule outline
  ctx.fillStyle = 'rgba(6, 8, 11, 0.85)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  
  const r = 24;
  const x = 10;
  const y = 10;
  const w = 492;
  const h = 108;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw Name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  let displayName = name || "";
  const parts = displayName.split(' ');
  if (parts.length > 1) {
    displayName = `${parts[0][0]}. ${parts[parts.length - 1]}`;
  }
  ctx.fillText(displayName.toUpperCase(), 40, 64);
  
  // Draw Details
  ctx.fillStyle = color;
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(details.toUpperCase(), 472, 64);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Renders all pitches in the current At-Bat as 3D markers in the summary review group
 */
export function showSummaryPitchReview(pitches) {
  // Clear any existing summary markers
  clearSummaryPitchReview();

  // Draw each pitch
  pitches.forEach((item, index) => {
    if (!item.trajectory || !item.trajectory.crossPoint) return;
    
    const cross = item.trajectory.crossPoint;
    const isCorrect = item.userCorrect;
    
    // Choose color: green for correct, red for incorrect
    const color = isCorrect ? COLORS.strikeCorrect : COLORS.strikeIncorrect;
    
    const group = new THREE.Group();
    
    // Flat filled circle (broadcast-style stamp disk)
    const circleGeo = new THREE.CircleGeometry(0.12, 24);
    const circleMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const circle = new THREE.Mesh(circleGeo, circleMat);
    circle.userData = { originalOpacity: 0.85 };
    group.add(circle);

    // White border ring (TorusGeometry for clean outline)
    const borderGeo = new THREE.TorusGeometry(0.12, 0.015, 8, 32);
    const borderMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.userData = { originalOpacity: 0.9 };
    group.add(border);

    // Outer glow ring
    const glowGeo = new THREE.TorusGeometry(0.12 * 1.35, 0.01, 8, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.userData = { originalOpacity: 0.4 };
    group.add(glow);
    
    // Position at cross point, offset slightly along Z to prevent z-fighting
    group.position.set(cross.x, cross.y, cross.z - 0.01);
    
    // Attach index and original pitch item for access during highlight
    group.userData = { index, pitch: item };
    
    summaryReviewGroup.add(group);
  });
}

/**
 * Highlights a specific pitch in the 3D summary review, scales it up,
 * draws its trajectory line, and dims the other markers.
 */
export function highlightSummaryPitch(index) {
  if (!summaryReviewGroup) return;

  if (index < 0) {
    summaryReviewGroup.children.forEach((group) => {
      group.scale.set(1, 1, 1);
      group.traverse((child) => {
        if (child.material) {
          const origOpacity = child.userData.originalOpacity || 1.0;
          child.material.opacity = origOpacity;
        }
      });
    });
    clearTrajectoryTrace();
    clearDimensionLine();
    return;
  }
  
  let selectedPitch = null;
  
  summaryReviewGroup.children.forEach(group => {
    const isSelected = group.userData.index === index;
    if (isSelected) {
      selectedPitch = group.userData.pitch;
      // Scale up the highlighted marker group
      group.scale.set(1.5, 1.5, 1.5);
    } else {
      // Reset scale
      group.scale.set(1.0, 1.0, 1.0);
    }
    
    // Set child mesh opacities
    group.traverse(child => {
      if (child.material) {
        const origOpacity = child.userData.originalOpacity || 1.0;
        child.material.opacity = isSelected ? origOpacity : origOpacity * 0.2;
      }
    });
  });

  // Handle trajectory line and 3D dimension line
  if (selectedPitch && selectedPitch.trajectory && selectedPitch.trajectory.points) {
    // Draw the full trajectory line (limitZ set to -10.0 to show the whole path)
    drawTrajectoryTrace(selectedPitch.trajectory.points, -10.0);
    
    // Dynamically draw dimension line and 3D distance label for the selected pitch
    if (selectedPitch.trajectory.crossPoint) {
      drawDimensionLine(selectedPitch.trajectory.crossPoint);
    }
  } else {
    clearTrajectoryTrace();
    clearDimensionLine();
  }
}

/**
 * Clears all 3D review markers, trajectory lines, and dimension lines
 */
export function clearSummaryPitchReview() {
  if (summaryReviewGroup) {
    while (summaryReviewGroup.children.length > 0) {
      const child = summaryReviewGroup.children[0];
      summaryReviewGroup.remove(child);
      child.traverse(subChild => {
        if (subChild.geometry) subChild.geometry.dispose();
        if (subChild.material) subChild.material.dispose();
      });
    }
  }
  clearTrajectoryTrace();
  clearDimensionLine();
}
