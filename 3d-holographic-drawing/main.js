/**
 * 3D Holographic Drawing v5.1 - two-hand fixes
 */
import * as THREE from "three";
const videoEl=document.getElementById("camera-preview");
const container=document.getElementById("canvas-container");
const statusBar=document.getElementById("status-bar");

const CAM_FOV=60,CAM_Z=3,PINCH_THRESHOLD=0.065;
const TOOL_COLLIDE_RADIUS=0.18,TOOL_CLICK_COOLDOWN=0.5;
const Z_SCALE=2.0,LERP_SPEED=0.22,LERP_SPEED_ROT=0.25;
const PAN_XY_SENS=2.5,PAN_Z_RANGE=4.0,SCALE_SENS=3.5;
const BRUSH_MIN=0.015,BRUSH_MAX=0.20,BRUSH_SENS=0.35;
const MAX_P=20000,GLOW_REFRESH_MS=150;
const SPRING_K=0.18,SPRING_C=0.08,CASCADE_DELAY_MS=45;
const CURTAIN_SENSITIVITY=4.0,CURTAIN_THRESHOLD=0.15,CURTAIN_TOP_ZONE=0.25;

let appMode="DRAW",brushColor="#ff0000",brushSize=0.04;
let camW=1280,camH=720;
let globalTime=0,prevWp0=null,handVelocity=0,lastGlowRefresh=0;
let isDraggingCurtain=false,curtainStartY=0;

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(CAM_FOV,window.innerWidth/window.innerHeight,0.1,100);
camera.position.set(0,0,CAM_Z);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setClearColor(0x000000,0);
renderer.physicallyCorrectLights=true;
container.appendChild(renderer.domElement);
const drawingGroup=new THREE.Group();scene.add(drawingGroup);
scene.add(new THREE.AmbientLight(0x404040,1.5));
const ptLight=new THREE.PointLight(0xffffff,1,10);ptLight.position.set(0,2,2);scene.add(ptLight);

function getVisibleHalfExtents(){const h=Math.tan((CAM_FOV/2)*Math.PI/180)*CAM_Z;return{halfH:h,halfW:h*(window.innerWidth/window.innerHeight)};}
function landmarkToNDC(lm){const sc=Math.max(window.innerWidth/camW,window.innerHeight/camH);const vfx=Math.min(1,(window.innerWidth/sc)/camW);const vfy=Math.min(1,(window.innerHeight/sc)/camH);return{x:((lm.x-(1-vfx)/2)/vfx)*2-1,y:1-((lm.y-(1-vfy)/2)/vfy)*2};}
function mapTo3D(lm){const{halfW,halfH}=getVisibleHalfExtents();const ndc=landmarkToNDC(lm);const wz=-lm.z*Z_SCALE;const ds=(CAM_Z-wz)/CAM_Z;return new THREE.Vector3(ndc.x*halfW*ds,ndc.y*halfH*ds,wz);}

const glowTexCache=new Map();
function getGlowTex(hex){const c=glowTexCache.get(hex);if(c)return c;const r=(hex>>16)&0xff,g=(hex>>8)&0xff,b=hex&0xff;const cv=document.createElement("canvas");cv.width=cv.height=128;const ctx=cv.getContext("2d"),hf=64;const grad=ctx.createRadialGradient(hf,hf,0,hf,hf,hf);grad.addColorStop(0,"rgba("+r+","+g+","+b+",1)");grad.addColorStop(0.15,"rgba("+r+","+g+","+b+",0.7)");grad.addColorStop(0.4,"rgba("+r+","+g+","+b+",0.2)");grad.addColorStop(1,"rgba("+r+","+g+","+b+",0)");ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);const t=new THREE.CanvasTexture(cv);glowTexCache.set(hex,t);return t;}

const strokes=[];let curStroke=null,isDrawing=false;
function createStroke(hex,sz,firstPt){const num=new THREE.Color(hex).getHex();const tex=getGlowTex(num);const s=sz||0.04;const pos=new Float32Array(MAX_P*3),gp=new Float32Array(MAX_P*3),op=new Float32Array(MAX_P*3);if(firstPt){for(let i=0;i<MAX_P;i++){const i3=i*3;pos[i3]=gp[i3]=op[i3]=firstPt.x;pos[i3+1]=gp[i3+1]=op[i3+1]=firstPt.y;pos[i3+2]=gp[i3+2]=op[i3+2]=firstPt.z;}}const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(pos,3));geo.setDrawRange(0,0);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:num,transparent:true,opacity:0.95}));const gGeo=new THREE.BufferGeometry();gGeo.setAttribute("position",new THREE.BufferAttribute(gp,3));gGeo.setDrawRange(0,0);const glow=new THREE.Points(gGeo,new THREE.PointsMaterial({size:s,map:tex,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0.8}));const oGeo=new THREE.BufferGeometry();oGeo.setAttribute("position",new THREE.BufferAttribute(op,3));oGeo.setDrawRange(0,0);const outer=new THREE.Points(oGeo,new THREE.PointsMaterial({size:s*2.2,map:tex,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0.35}));drawingGroup.add(line);drawingGroup.add(glow);drawingGroup.add(outer);return{points:[],positions:pos,gPos:gp,oPos:op,geo,gGeo,oGeo,line,glow,outer,count:0,birthTime:performance.now()/1000};}
function updStroke(s){const n=Math.min(s.points.length,MAX_P);const last=s.points[n-1];const i3=(n-1)*3;s.positions[i3]=last.x;s.positions[i3+1]=last.y;s.positions[i3+2]=last.z;s.geo.attributes.position.needsUpdate=true;s.geo.setDrawRange(0,n);s.gGeo.setDrawRange(0,n);s.oGeo.setDrawRange(0,n);s.count=n;}
function refreshGlowLayers(s,time){const n=s.count;if(n<1)return;const vf=Math.min(handVelocity/0.04,3.5);for(let i=0;i<n;i++){const p=s.points[i];const i3=i*3;const px=p.x,py=p.y,pz=p.z;const d=1-i/Math.max(n,1);const wx=Math.sin(px*12+time*4)*Math.cos(py*10+time*3);const wy=Math.cos(pz*14+time*3.5)*Math.sin(px*8+time*2.5);const wz=Math.sin(py*11+time*4.5)*Math.cos(pz*9+time*3);const a=0.012*(1+vf*0.6)*d;s.gPos[i3]=px+wx*a;s.gPos[i3+1]=py+wy*a;s.gPos[i3+2]=pz+wz*a*vf*0.7;s.oPos[i3]=px+wx*a*2.8;s.oPos[i3+1]=py+wy*a*2.8;s.oPos[i3+2]=pz+wz*a*3.5*vf*0.7;}s.gGeo.attributes.position.needsUpdate=true;s.gGeo.setDrawRange(0,n);s.oGeo.attributes.position.needsUpdate=true;s.oGeo.setDrawRange(0,n);}
function remStroke(s){drawingGroup.remove(s.line);drawingGroup.remove(s.glow);drawingGroup.remove(s.outer);s.line.material.dispose();s.glow.material.dispose();s.outer.material.dispose();s.geo.dispose();s.gGeo.dispose();s.oGeo.dispose();}
function clearAll(){while(strokes.length)remStroke(strokes.pop());curStroke=null;isDrawing=false;}

const cursorGrp=new THREE.Group();cursorGrp.visible=false;scene.add(cursorGrp);
const curBall=new THREE.Mesh(new THREE.SphereGeometry(0.04,16,16),new THREE.MeshBasicMaterial({color:0xff0000}));cursorGrp.add(curBall);
const curGlow=new THREE.Mesh(new THREE.SphereGeometry(0.08,16,16),new THREE.MeshBasicMaterial({color:0xff0000,transparent:true,opacity:0.3,depthWrite:false}));cursorGrp.add(curGlow);
const brushRing=new THREE.Mesh(new THREE.RingGeometry(0.05,0.07,48),new THREE.MeshBasicMaterial({color:0xff0000,side:THREE.DoubleSide,transparent:true,opacity:0.5,depthWrite:false}));cursorGrp.add(brushRing);
function updCursor(){const h=new THREE.Color(brushColor).getHex();curBall.material.color.setHex(h);curGlow.material.color.setHex(h);brushRing.material.color.setHex(h);brushRing.scale.setScalar((brushSize*1.2)/0.06);}
const toolbox={group:new THREE.Group(),items:[],expanded:false,_expandTime:0,lastClickTime:0,targetWorldPos:new THREE.Vector3(0,-1.3,0)};scene.add(toolbox.group);
const TOOL_DEFS=[{type:"color",value:"#ff0000",color:0xff0000},{type:"color",value:"#00ffff",color:0x00ffff},{type:"color",value:"#ffff00",color:0xffff00},{type:"color",value:"#ff00ff",color:0xff00ff},{type:"color",value:"#ffffff",color:0xffffff},{type:"eraser",value:"eraser",color:0xff88aa},{type:"laser",value:"laser",color:0x44ff44},{type:"mode_toggle",value:"mode",color:0x4488ff},{type:"clear",value:"clear",color:0xff4444}];
const TOOL_COUNT=TOOL_DEFS.length,TOOL_SPACING=0.35,TOOL_HIDDEN_Y=2.0,TOOL_EXPAND_Y=0.0,TOOL_BASE_SCALE=1.0;
const hubGeo=new THREE.CapsuleGeometry(0.07,0.10,8,16);const hubMat=new THREE.MeshPhysicalMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:0.8,roughness:0.1,metalness:0.15,clearcoat:0.5,clearcoatRoughness:0.1});const hubMesh=new THREE.Mesh(hubGeo,hubMat);toolbox.group.add(hubMesh);
const hubGlowGeo=new THREE.SphereGeometry(0.16,32,32);const hubGlowMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.25,depthWrite:false});const hubGlow=new THREE.Mesh(hubGlowGeo,hubGlowMat);hubMesh.add(hubGlow);
const hubRingGeo=new THREE.TorusGeometry(0.14,0.015,16,48);const hubRingMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.5,depthWrite:false});const hubRing=new THREE.Mesh(hubRingGeo,hubRingMat);hubMesh.add(hubRing);const hubCollider={mesh:hubMesh,radius:0.22};
const TOOL_ACTION_MAP={color:(d)=>{brushColor=d.value;appMode="DRAW";updCursor();},eraser:()=>{brushColor="#ff88aa";appMode="DRAW";updCursor();},laser:()=>{brushColor="#ff0000";appMode="DRAW";updCursor();},mode_toggle:()=>{toggleMode();},clear:()=>{clearAll();}};
function handleToolClick(r){if(r.isHub){toggleToolbox();return;}if(!r.item)return;const h=TOOL_ACTION_MAP[r.item.def.type];if(h)h(r.item.def);}
TOOL_DEFS.forEach((def,i)=>{const tw=(TOOL_COUNT-1)*TOOL_SPACING;const lx=(-tw/2)+i*TOOL_SPACING;const grp=new THREE.Group();grp.position.set(lx,TOOL_HIDDEN_Y,0);grp.scale.setScalar(0.01);toolbox.group.add(grp);let mesh,neonRing;const gm=new THREE.MeshPhysicalMaterial({color:def.color,emissive:def.color,emissiveIntensity:0.6,roughness:0.1,metalness:0.15,clearcoat:0.4,clearcoatRoughness:0.1});if(def.type==="color"||def.type==="mode_toggle"||def.type==="clear"){mesh=new THREE.Mesh(new THREE.SphereGeometry(0.09,32,32),gm);grp.add(mesh);grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.14,32,32),new THREE.MeshBasicMaterial({color:def.color,transparent:true,opacity:0.18,depthWrite:false})));neonRing=new THREE.Mesh(new THREE.TorusGeometry(0.12,0.006,8,48),new THREE.MeshBasicMaterial({color:def.color,transparent:true,opacity:0.65,depthWrite:false}));grp.add(neonRing);}else if(def.type==="eraser"){const bg=new THREE.BoxGeometry(0.14,0.10,0.06);mesh=new THREE.Mesh(bg,gm);grp.add(mesh);neonRing=new THREE.LineSegments(new THREE.EdgesGeometry(bg),new THREE.LineBasicMaterial({color:def.color,transparent:true,opacity:0.6,depthWrite:false}));grp.add(neonRing);}else if(def.type==="laser"){const cg=new THREE.CylinderGeometry(0.03,0.04,0.22,16);mesh=new THREE.Mesh(cg,gm);mesh.rotation.x=Math.PI/2;grp.add(mesh);const d=new THREE.Mesh(new THREE.SphereGeometry(0.025,8,8),new THREE.MeshBasicMaterial({color:0xff0000}));d.position.set(0,0,0.12);mesh.add(d);neonRing=new THREE.Mesh(new THREE.TorusGeometry(0.12,0.005,8,48),new THREE.MeshBasicMaterial({color:def.color,transparent:true,opacity:0.7,depthWrite:false}));grp.add(neonRing);}toolbox.items.push({def,grp,mesh,neonRing,targetScale:0.01,targetLocalY:TOOL_HIDDEN_Y,colliderRadius:TOOL_COLLIDE_RADIUS,lastClick:0,worldPos:new THREE.Vector3(),_floatPhase:0,_currentY:TOOL_HIDDEN_Y,_targetY:TOOL_HIDDEN_Y,_effectiveTargetY:TOOL_HIDDEN_Y,_velocity:0,_delayIndex:i,_triggerTime:0});});
function setToolItemTarget(it,ex,hv=false){it.targetScale=ex?TOOL_BASE_SCALE:(hv?1.2:0.01);it.targetLocalY=ex?TOOL_EXPAND_Y:TOOL_HIDDEN_Y;}
function expandToolbox(){toolbox.expanded=true;const n=performance.now()/1000;toolbox._expandTime=n;toolbox.items.forEach(it=>{setToolItemTarget(it,true);it._targetY=it.targetLocalY;it._triggerTime=n;});hubMat.emissiveIntensity=1.4;hubGlowMat.opacity=0.45;}
function collapseToolbox(){toolbox.expanded=false;const n=performance.now()/1000;toolbox._expandTime=n;toolbox.items.forEach(it=>{setToolItemTarget(it,false);it._targetY=it.targetLocalY;it._triggerTime=n;});hubMat.emissiveIntensity=0.8;hubGlowMat.opacity=0.25;}
function toggleToolbox(){toolbox.expanded?collapseToolbox():expandToolbox();}
function teleportToolboxTo(wp){toolbox.targetWorldPos.copy(wp);}
function animateToolbox(){toolbox.group.position.lerp(toolbox.targetWorldPos,0.15);const n=performance.now()/1000;toolbox.items.forEach((it,i)=>{const e=n-(it._triggerTime||0);const d=i*(CASCADE_DELAY_MS/1000);if(e>=d)it._effectiveTargetY=it._targetY;const disp=it._currentY-it._effectiveTargetY;const a=-SPRING_K*disp-SPRING_C*it._velocity;it._velocity+=a;it._currentY+=it._velocity;if(Math.abs(disp)<0.0008&&Math.abs(it._velocity)<0.001){it._currentY=it._effectiveTargetY;it._velocity=0;}it.grp.position.y=it._currentY;if(it.hovered){it._floatPhase+=0.07;it.grp.position.y+=Math.sin(it._floatPhase)*0.05;if(it.mesh&&it.mesh.material.emissiveIntensity!==undefined)it.mesh.material.emissiveIntensity=Math.min(1.4,it.mesh.material.emissiveIntensity+0.06);}else{it._floatPhase=0;if(it.mesh&&it.mesh.material.emissiveIntensity!==undefined)it.mesh.material.emissiveIntensity=Math.max(0.6,it.mesh.material.emissiveIntensity-0.04);}const c=it.grp.scale.x;it.grp.scale.setScalar(THREE.MathUtils.lerp(c,it.targetScale,0.25));});hubRing.rotation.z+=0.02;hubRing.rotation.x+=0.01;toolbox.items.forEach(it=>{it.mesh.getWorldPosition(it.worldPos);});}
function checkToolCollision(fwp,pn){const n=performance.now()/1000;const hwp=new THREE.Vector3();hubMesh.getWorldPosition(hwp);if(toolbox.expanded){for(let i=0;i<toolbox.items.length;i++){const it=toolbox.items[i];const dist=fwp.distanceTo(it.worldPos);const t=dist<it.colliderRadius;if(t&&!it.hovered)setToolItemTarget(it,true,true);else if(!t&&it.hovered)setToolItemTarget(it,true,false);if(t&&pn&&n-it.lastClick>TOOL_CLICK_COOLDOWN){it.lastClick=n;it.grp.scale.setScalar(1.5);setTimeout(()=>{if(toolbox.expanded)it.grp.scale.setScalar(TOOL_BASE_SCALE);},150);return{hit:true,item:it,isHub:false};}}}const hd=fwp.distanceTo(hwp);const ht=hd<hubCollider.radius;if(ht){hubMat.emissiveIntensity=toolbox.expanded?1.6:1.1;hubGlowMat.opacity=toolbox.expanded?0.55:0.35;}else{hubMat.emissiveIntensity=toolbox.expanded?1.4:0.8;hubGlowMat.opacity=toolbox.expanded?0.45:0.25;}if(ht&&pn&&n-toolbox.lastClickTime>TOOL_CLICK_COOLDOWN){toolbox.lastClickTime=n;return{hit:true,item:null,isHub:true};}if(!pn&&toolbox.expanded)toolbox.items.forEach(it=>{if(it.hovered)setToolItemTarget(it,true,false);});return{hit:false,item:null,isHub:false};}

// ===== GESTURE DETECTION (v5.1: relaxed 2-hand thresholds) =====
function isFingerExt(lm,t,p){return lm[t].y<lm[p].y;}
function isFingerCurl(lm,t,p){return lm[t].y>lm[p].y;}

// 3D-distance fist: finger curled = tip closer to wrist than base*1.2
function isFist(lm){const w=lm[0];const fingers=[{tip:8,base:5},{tip:12,base:9},{tip:16,base:13},{tip:20,base:17}];for(const f of fingers){const dt=Math.sqrt((lm[f.tip].x-w.x)**2+(lm[f.tip].y-w.y)**2+(lm[f.tip].z-w.z)**2);const db=Math.sqrt((lm[f.base].x-w.x)**2+(lm[f.base].y-w.y)**2+(lm[f.base].z-w.z)**2);if(dt>=db*1.2)return false;}return true;}
function isOpenPalm(lm){return isFingerExt(lm,4,3)&&isFingerExt(lm,8,6)&&isFingerExt(lm,12,10)&&isFingerExt(lm,16,14)&&isFingerExt(lm,20,18);}
function isLShape(lm){return isFingerExt(lm,4,3)&&isFingerExt(lm,8,6)&&isFingerCurl(lm,12,10)&&isFingerCurl(lm,16,14)&&isFingerCurl(lm,20,18);}
function isThumbsUp(lm){return isFingerExt(lm,4,3)&&isFingerCurl(lm,8,6)&&isFingerCurl(lm,12,10)&&isFingerCurl(lm,16,14)&&isFingerCurl(lm,20,18)&&lm[4].y<lm[0].y-0.05;}

// middle-pinch: thumb(4) + middle(12) pinch, index(8) extended
function isMiddlePinch(lm){const t=lm[4],m=lm[12];const dist=Math.sqrt((t.x-m.x)**2+(t.y-m.y)**2+(t.z-m.z)**2);return dist<PINCH_THRESHOLD*1.35&&isFingerExt(lm,8,6);}

// double-palm-push: both open palms facing camera (Z > 0.55, was 0.80)
function isDoublePalmPush(lm0,lm1){if(!isOpenPalm(lm0)||!isOpenPalm(lm1))return false;const n0=palmNormal(lm0),n1=palmNormal(lm1);return n0.z>0.55&&n1.z>0.55;}

function handWidth(lm){const a=lm[5],b=lm[17];return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2);}
function isPinching(lm){const t=lm[4],i=lm[8];return Math.sqrt((t.x-i.x)**2+(t.y-i.y)**2+(t.z-i.z)**2)<PINCH_THRESHOLD;}
function palmNormal(lm){const w=lm[0],im=lm[5],pm=lm[17];const v1=new THREE.Vector3(im.x-w.x,im.y-w.y,im.z-w.z);const v2=new THREE.Vector3(pm.x-w.x,pm.y-w.y,pm.z-w.z);const n=new THREE.Vector3().crossVectors(v1,v2).normalize();return new THREE.Vector3(n.x,-n.y,-n.z).normalize();}

// ===== GLOBAL STATE =====
const ACTION_COOLDOWN=1.2;let lastActionTime=0;
const HAND_PATH_MAX=25;const handPathBuffer=[];let handPathOffset=0;
function pushHandPath(x,t){handPathBuffer.push({x,t});if(handPathBuffer.length-handPathOffset>HAND_PATH_MAX*4){handPathBuffer.splice(0,handPathOffset);handPathOffset=0;}}
function getHandPathSlice(){while(handPathBuffer.length-handPathOffset>HAND_PATH_MAX)handPathOffset++;return handPathBuffer.slice(handPathOffset);}
function clearHandPath(){handPathBuffer.length=0;handPathOffset=0;}
const WIPE_A=0.18,WIPE_T=3;
function detectWipe(){const s=getHandPathSlice();if(s.length<8)return false;const xs=s.map(p=>p.x);let turns=0,prev=null,extreme=xs[0];for(let i=1;i<xs.length;i++){const delta=xs[i]-xs[i-1];if(Math.abs(delta)<0.002)continue;const sign=delta>0?1:-1;if(prev!==null&&sign!==prev){if(Math.abs(xs[i]-extreme)>=WIPE_A){turns++;extreme=xs[i];}}if((sign>0&&xs[i]>extreme)||(sign<0&&xs[i]<extreme))extreme=xs[i];prev=sign;}return turns>=WIPE_T;}

// ===== PAN / MODE =====
const targetPos=new THREE.Vector3(0,0,0),targetScale=new THREE.Vector3(1,1,1),targetQuat=new THREE.Quaternion();
const pan={active:false,prevNDC:null,handWBase:0};
let prevPalmQuat=null,prevPinchDist=null,prevPinchAngle=null,modeToggleLock=0,lastResults=null,handsInst=null;
function updatePan(lm){const ndc=landmarkToNDC(lm[8]);if(!pan.active){pan.active=true;pan.prevNDC={x:ndc.x,y:ndc.y};pan.handWBase=handWidth(lm);return;}const dx=ndc.x-pan.prevNDC.x,dy=ndc.y-pan.prevNDC.y;if(Math.abs(dx)>0.001||Math.abs(dy)>0.001){const{halfW,halfH}=getVisibleHalfExtents();targetPos.x+=dx*halfW*PAN_XY_SENS;targetPos.y+=dy*halfH*PAN_XY_SENS;}const hw=handWidth(lm);if(pan.handWBase>0.001&&Math.abs(hw/pan.handWBase-1)>0.02)targetPos.z=THREE.MathUtils.lerp(targetPos.z,(hw/pan.handWBase-1)*PAN_Z_RANGE,0.12);pan.prevNDC={x:ndc.x,y:ndc.y};}
function exitPan(){if(!pan.active)return;targetPos.copy(drawingGroup.position);pan.active=false;pan.prevNDC=null;pan.handWBase=0;}function snapshotTransform(){targetPos.copy(drawingGroup.position);targetScale.copy(drawingGroup.scale);targetQuat.copy(drawingGroup.quaternion);}
function toggleMode(){appMode=appMode==="NAVIGATE"?"DRAW":"NAVIGATE";isDrawing=false;curStroke=null;exitPan();prevPalmQuat=null;prevPinchDist=null;prevPinchAngle=null;}
function resetCanvas(){isDrawing=false;curStroke=null;exitPan();targetPos.set(0,0,0);targetScale.set(1,1,1);targetQuat.identity();}

// ===== MEDIAPIPE / CAMERA / ERASER =====
function onResults(r){lastResults=r;}
function initHands(){handsInst=new Hands({locateFile:(f)=>"https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/"+f});handsInst.setOptions({maxNumHands:2,modelComplexity:1,minDetectionConfidence:0.7,minTrackingConfidence:0.6,selfieMode:true});handsInst.onResults(onResults);}
async function startCamera(){const cfgs=[{w:3840,h:2160},{w:2560,h:1440},{w:1920,h:1080},{w:1280,h:720},{w:640,h:480}];for(const c of cfgs){try{const stream=await Promise.race([navigator.mediaDevices.getUserMedia({video:{width:{ideal:c.w,max:3840},height:{ideal:c.h,max:2160},facingMode:"user"},audio:false}),new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),12000))]);videoEl.srcObject=stream;await videoEl.play();await Promise.race([new Promise(r=>{videoEl.onloadedmeta=r}),new Promise(r=>setTimeout(r,4000))]);camW=videoEl.videoWidth||c.w;camH=videoEl.videoHeight||c.h;return;}catch(e){}}throw new Error("no camera");}
function eraseAt(wPos){const lp=drawingGroup.worldToLocal(wPos.clone());const tr=[];for(let i=strokes.length-1;i>=0;i--){const s=strokes[i];for(let j=0;j<s.count;j++){const j3=j*3;const dx=lp.x-s.positions[j3],dy=lp.y-s.positions[j3+1],dz=lp.z-s.positions[j3+2];if(Math.sqrt(dx*dx+dy*dy+dz*dz)<brushSize*2.5){tr.push(i);break;}}}tr.sort((a,b)=>b-a);for(const idx of tr){remStroke(strokes[idx]);strokes.splice(idx,1);}return tr.length;}
function status(t){if(statusBar)statusBar.textContent=t;}

// ===== ANIMATION SUB-FUNCTIONS =====
function updateHandPathBuffer(res,nowS){if(res&&res.multiHandLandmarks&&res.multiHandLandmarks.length>=1){pushHandPath(landmarkToNDC(res.multiHandLandmarks[0][9]).x,nowS);}else{const s=getHandPathSlice();if(s.length>0&&nowS-s[s.length-1].t>2.0)clearHandPath();}}

// Priority gestures (non-blocking for multi-hand)
function checkPriorityGestures(res,hc,nowS){
  // 1. Fist 鈥?iterate ALL hands
  for(let h=0;h<hc;h++){if(isFist(res.multiHandLandmarks[h])){isDrawing=false;curStroke=null;prevPalmQuat=null;exitPan();snapshotTransform();if(toolbox.expanded)collapseToolbox();isDraggingCurtain=false;prevPinchDist=null;prevPinchAngle=null;return true;}}
  // 2. Double-palm-push 鈥?reset canvas (relaxed Z>0.55)
  if(hc>=2&&nowS-lastActionTime>ACTION_COOLDOWN){const lm1=res.multiHandLandmarks[1];if(isDoublePalmPush(res.multiHandLandmarks[0],lm1)){lastActionTime=nowS;resetCanvas();return true;}}
  // 3. Wipe 鈥?single hand only
  const lm0=res.multiHandLandmarks[0];
  if(hc===1&&nowS-lastActionTime>ACTION_COOLDOWN&&detectWipe()){lastActionTime=nowS;clearAll();clearHandPath();return true;}
  // 4. Middle-pinch 鈥?iterate ALL hands (non-blocking)
  for(let h=0;h<hc;h++){if(isMiddlePinch(res.multiHandLandmarks[h])&&nowS-modeToggleLock>1.5){modeToggleLock=nowS;toggleMode();return true;}}
  return false;
}
function checkToolInteraction(wp0,lm0){const p=isPinching(lm0);const th=checkToolCollision(wp0,p);if(th.hit){handleToolClick(th);return true;}return false;}

// NAVIGATE: 1-hand (pinch=pan, palm=rotate, L=scale) / 2-hand (pinch=scale+rotate)
function processNavigateMode(res,hc){isDrawing=false;curStroke=null;const lm0=res.multiHandLandmarks[0];
  if(hc===1){if(isPinching(lm0)){updatePan(lm0);}else if(isOpenPalm(lm0)){exitPan();targetQuat.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),palmNormal(lm0)));}else if(isLShape(lm0)){exitPan();const t3=mapTo3D(lm0[4]),i3=mapTo3D(lm0[8]);targetScale.setScalar(Math.max(0.15,Math.min(6,t3.distanceTo(i3)*SCALE_SENS)));}else{if(!pan.active)targetPos.copy(drawingGroup.position);}return;}
  // hc>=2 鈥?dual pinch: distance->scale, angle->rotate
  exitPan();const lm1=res.multiHandLandmarks[1];const p0=isPinching(lm0),p1=isPinching(lm1);
  if(p0&&p1){const ca0=mapTo3D(lm0[8]),cb0=mapTo3D(lm0[4]),ca1=mapTo3D(lm1[8]),cb1=mapTo3D(lm1[4]);const c0=new THREE.Vector3().addVectors(ca0,cb0).multiplyScalar(0.5);const c1=new THREE.Vector3().addVectors(ca1,cb1).multiplyScalar(0.5);const dist=c0.distanceTo(c1);const ang=Math.atan2(c0.y-c1.y,c0.x-c1.x);if(prevPinchDist!==null){const ratio=dist/prevPinchDist;targetScale.setScalar(Math.max(0.15,Math.min(6,targetScale.x*ratio)));}if(prevPinchAngle!==null){let da=ang-prevPinchAngle;if(da>Math.PI)da-=Math.PI*2;if(da<-Math.PI)da+=Math.PI*2;if(Math.abs(da)<0.25)targetQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),da));}prevPinchDist=dist;prevPinchAngle=ang;prevPalmQuat=null;}else{prevPinchDist=null;prevPinchAngle=null;prevPalmQuat=null;snapshotTransform();}
}

// DRAW mode with velocity-pressure
function processDrawMode(hc,lm0,wp0){if(hc===1){if(isOpenPalm(lm0)){isDrawing=false;curStroke=null;}else if(isPinching(lm0)){const lp=drawingGroup.worldToLocal(wp0.clone());if(!isDrawing){isDrawing=true;curStroke=createStroke(brushColor,brushSize,lp);curStroke.points.push(lp);curStroke.geo.setDrawRange(0,1);curStroke.gGeo.setDrawRange(0,1);curStroke.oGeo.setDrawRange(0,1);curStroke.count=1;}else{curStroke.points.push(lp);if(curStroke.points.length>=2){const prevPt=curStroke.points[curStroke.points.length-2];const v=lp.distanceTo(prevPt);const dynSz=brushSize/(1.0+v*15.0);curStroke.glow.material.size=dynSz;curStroke.outer.material.size=dynSz*2.2;updStroke(curStroke);if(!strokes.includes(curStroke))strokes.push(curStroke);}}}else if(isLShape(lm0)){isDrawing=false;curStroke=null;const t3=mapTo3D(lm0[4]),i3=mapTo3D(lm0[8]);brushSize=Math.max(BRUSH_MIN,Math.min(BRUSH_MAX,t3.distanceTo(i3)*BRUSH_SENS));updCursor();}else{if(isDrawing){isDrawing=false;if(curStroke&&curStroke.count<2)remStroke(curStroke);curStroke=null;}}}else{isDrawing=false;curStroke=null;}}

// ===== MAIN LOOP =====
function animate(){requestAnimationFrame(animate);if(handsInst&&videoEl.readyState>=2)handsInst.send({image:videoEl}).catch(()=>{});
  const nowS=performance.now()/1000;globalTime=nowS;const res=lastResults;const hc=res&&res.multiHandLandmarks?res.multiHandLandmarks.length:0;
  updateHandPathBuffer(res,nowS);animateToolbox();
  if(hc===0){cursorGrp.visible=false;isDrawing=false;curStroke=null;prevPalmQuat=null;exitPan();isDraggingCurtain=false;prevWp0=null;handVelocity=0;prevPinchDist=null;prevPinchAngle=null;renderer.render(scene,camera);return;}
  // For multi-hand, extract both landmarks up front
  const lm0=res.multiHandLandmarks[0];const wp0=mapTo3D(lm0[8]);cursorGrp.position.copy(wp0);cursorGrp.visible=true;if(prevWp0)handVelocity=wp0.distanceTo(prevWp0);prevWp0=wp0.clone();
  // curtain drag
  if(!toolbox.expanded&&!isDraggingCurtain){if(isPinching(lm0)&&lm0[8].y<CURTAIN_TOP_ZONE){isDraggingCurtain=true;curtainStartY=lm0[8].y;}}
  if(isDraggingCurtain){const sp=isPinching(lm0);const dy=lm0[8].y-curtainStartY;if(sp){const t=Math.max(0.0,TOOL_HIDDEN_Y-dy*CURTAIN_SENSITIVITY);toolbox.items.forEach(it=>{it._targetY=t;it._triggerTime=0;});}else{isDraggingCurtain=false;const n=performance.now()/1000;if(dy>CURTAIN_THRESHOLD){expandToolbox();}else{toolbox.expanded=false;toolbox._expandTime=n;toolbox.items.forEach(it=>{setToolItemTarget(it,false);it._targetY=TOOL_HIDDEN_Y;it._triggerTime=0;});}}renderer.render(scene,camera);return;}
  // priority (now handles 2 hands properly)
  if(checkPriorityGestures(res,hc,nowS)){renderer.render(scene,camera);return;}
  if(checkToolInteraction(wp0,lm0)){renderer.render(scene,camera);return;}
  exitPan();prevPalmQuat=null;snapshotTransform();
  if(hc>=2){processNavigateMode(res,hc);}else if(appMode==="NAVIGATE")processNavigateMode(res,hc);else processDrawMode(hc,lm0,wp0);
  // glow refresh
  if(nowS-lastGlowRefresh>=GLOW_REFRESH_MS/1000){lastGlowRefresh=nowS;for(const s of strokes){if(nowS-s.birthTime>5.0)continue;refreshGlowLayers(s,globalTime);}}
  for(const s of strokes){const age=nowS-s.birthTime;if(age>5.0||age<0.05)continue;const shift=(Math.sin(globalTime*1.5+s.birthTime*3.7)+1)/2;s.glow.material.color.copy(new THREE.Color(s.line.material.color).lerp(new THREE.Color(0xffd700),shift*0.2));s.outer.material.color.copy(s.glow.material.color);}
  if(appMode==="DRAW"){const sn=Math.min(handVelocity/0.04,2.0);brushRing.scale.setScalar((brushSize*1.2)/0.06*(1.0+Math.sin(globalTime*9.0)*0.12*sn));}
  drawingGroup.position.lerp(targetPos,LERP_SPEED);drawingGroup.scale.lerp(targetScale,LERP_SPEED);drawingGroup.quaternion.slerp(targetQuat,LERP_SPEED_ROT);
  const cs=drawingGroup.scale.x;if(cs<0.1||cs>10)drawingGroup.scale.setScalar(Math.max(0.1,Math.min(10,cs)));renderer.render(scene,camera);
}

window.addEventListener("resize",()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(k==="c")clearAll();if(k==="escape")resetCanvas();if(k==="m")toggleMode();if(k==="]"){brushSize=Math.min(BRUSH_MAX,brushSize*1.3);updCursor();}if(k==="["){brushSize=Math.max(BRUSH_MIN,brushSize/1.3);updCursor();}if(k==="e")toggleToolbox();});
updCursor();targetPos.set(0,0,0);targetScale.set(1,1,1);targetQuat.identity();toolbox.group.position.copy(toolbox.targetWorldPos);
async function bootstrap(){const ov=document.getElementById("loading-overlay");try{initHands();await handsInst.initialize();await startCamera();status("● 系统就绪 | 等待手势输入");animate();setTimeout(()=>{ov?.classList.add("hidden");},600);}catch(err){status("● 摄像头未连接 | 仅手势模拟");animate();setTimeout(()=>ov?.classList.add("hidden"),300);}}bootstrap();
