// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Modal, TouchableOpacity, ScrollView, TextInput, Animated, Easing, Image, Alert, StyleSheet, Pressable, FlatList, ActivityIndicator, Dimensions } from 'react-native';
import { AppText as Text } from '../emoji/AppText';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Slider from '@react-native-community/slider';
import { getRandomImageLogoSet } from '../lib/logoManifest';
import {
  COSTS, SLOW_CINEMA_PRESETS, calcVideoCost, calcSlowCinemaCost,
  type SlowCinemaPreset, type ControlNetModule,
} from '../config/aiEndpoints';
import {
  loadLibrary, saveLibrary, addLibraryItem, updateLibraryItem, deleteLibraryItem,
  uriToBase64,
  uriToBase64WithInfo,
  generateStandardImage, generateControlNetImage, generateTxt2Img,
  generateAnimateDiff, startSlowCinema, pollSlowCinema, exportSlowCinema,
  generateTransition,
  generateTransitionAuto, generateSlowmotionAuto, generateV2V,
  submit3DJob, poll3DJob, download3DModel, getApi3DFactoryUrl,
  generateText2Tripo, generateProcedural3D,
  listAppArtwork,
  checkA1111, checkSdStream, check4MA,
  getSdStreamPassword, setSdStreamPassword,
  generateEasterEgg,
  interrogateImage,
  pollA1111Progress,
  getCachedClipPrompt, setCachedClipPrompt,
  removeBackground,
} from '../services/aiContentService';
import type { AILibraryItem, AIItemType } from '../types/coinShop';

const { width: SW } = Dimensions.get('window');
const IS_IPAD = SW >= 768;

// ─── 3D model-viewer HTML (inline WebView — blob URL avoids data: URI limits) ─
// Includes: Textured/Grey/Wire toggles, dark floor with dotted grid, realtime shadow.
function makeModelViewerHtml(glbBase64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100vw;height:100vh;background:#0a0a0f;overflow:hidden}
model-viewer{position:absolute;top:50px;left:0;right:0;bottom:80px;width:100%;height:calc(100% - 130px);--poster-color:transparent}
#floor{position:absolute;bottom:0;left:0;right:0;height:88px;background:#111;pointer-events:none;z-index:0}
#floor::after{content:'';position:absolute;inset:0;background-image:radial-gradient(circle,#2a2a2a 1.2px,transparent 1.2px);background-size:18px 18px}
#ctrl{position:absolute;top:58px;left:0;right:0;display:flex;justify-content:center;gap:6px;z-index:10;padding:4px}
.tb{border:1px solid #333;background:rgba(0,0,0,0.72);color:#888;font:11px/1 sans-serif;padding:6px 13px;border-radius:20px;cursor:pointer;-webkit-tap-highlight-color:transparent;outline:none}
.tb.on{border-color:#ff9f6b;color:#ff9f6b;background:rgba(255,159,107,0.15)}
@keyframes ldpulse{0%,100%{opacity:0.3;transform:scale(0.85)}50%{opacity:1;transform:scale(1.1)}}
#ld{position:absolute;inset:0;background:#0a0a0f;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:20;pointer-events:none;transition:opacity 0.7s ease}
#ldico{font-size:40px;animation:ldpulse 2s ease-in-out infinite;margin-bottom:10px}
#ldtxt{color:#555;font:12px/1 sans-serif}
</style>
</head>
<body>
<div id="ctrl">
  <button class="tb on" onclick="setMode('textured',this)">Textured</button>
  <button class="tb"    onclick="setMode('grey',this)">Grey</button>
  <button class="tb"    onclick="setMode('wire',this)">Wireframe</button>
</div>
<div id="ld"><span id="ldico">🧊</span><span id="ldtxt">Loading 3D…</span></div>
<model-viewer id="mv" camera-controls auto-rotate
  shadow-intensity="1.4" shadow-softness="0.7"
  environment-image="neutral" exposure="1.1">
</model-viewer>
<div id="floor"></div>
<script>
(function(){
  var ld=document.getElementById('ld'),mv=document.getElementById('mv'),sent=false;
  var origColors=[];

  window.setMode=function(mode,btn){
    document.querySelectorAll('.tb').forEach(function(b){b.classList.remove('on');});
    btn.classList.add('on');
    if(!mv.model)return;
    mv.model.materials.forEach(function(mat,i){
      var pbr=mat.pbrMetallicRoughness;
      if(mode==='textured'){
        if(origColors[i])pbr.setBaseColorFactor(origColors[i]);
        pbr.setMetallicFactor(origColors[i]?origColors[i+'m']:0);
        pbr.setRoughnessFactor(origColors[i]?origColors[i+'r']:0.5);
      } else if(mode==='grey'){
        pbr.setBaseColorFactor([0.55,0.55,0.55,1]);
        pbr.setMetallicFactor(0);pbr.setRoughnessFactor(0.88);
      } else {
        pbr.setBaseColorFactor([0.05,0.72,1,1]);
        pbr.setMetallicFactor(0.9);pbr.setRoughnessFactor(0.08);
      }
    });
  };

  try{
    var bin=atob('${glbBase64}');
    var buf=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);
    var blob=new Blob([buf],{type:'model/gltf-binary'});
    mv.src=URL.createObjectURL(blob);
    mv.addEventListener('load',function(){
      ld.style.opacity='0';setTimeout(function(){ld.style.display='none';},700);
      if(mv.model){
        mv.model.materials.forEach(function(mat,i){
          var pbr=mat.pbrMetallicRoughness;
          origColors[i]=pbr.baseColorFactor?pbr.baseColorFactor.slice():[1,1,1,1];
          origColors[i+'m']=pbr.metallicFactor||0;
          origColors[i+'r']=pbr.roughnessFactor||0.5;
        });
      }
      setTimeout(function(){
        if(sent)return;
        mv.toBlob({mimeType:'image/jpeg',qualityArgument:0.85}).then(function(b){
          var fr=new FileReader();
          fr.onload=function(e){
            if(sent)return;sent=true;
            try{window.ReactNativeWebView.postMessage(e.target.result);}catch(x){}
          };
          fr.readAsDataURL(b);
        }).catch(function(){});
      },1600);
    });
    mv.addEventListener('error',function(e){ld.innerHTML='⚠️ Model error<br><small>'+(e.detail||'')+'</small>';});
  }catch(e){ld.innerHTML='⚠️ '+e.message;}
  setTimeout(function(){if(!mv.src)ld.innerHTML='⚠️ No internet<br>CDN needed';},8000);
})();
</script>
</body>
</html>`;
}

// ─── Mini 3D viewer HTML (auto-rotate turntable, no UI controls) ─────────────
function makeMiniViewerHtml(glbBase64: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
<style>
*{margin:0;padding:0}html,body{width:100vw;height:100vh;background:#0d0d12;overflow:hidden}
model-viewer{width:100%;height:100%;--poster-color:transparent}
@keyframes mp{0%,100%{opacity:0.2;transform:scale(0.7)}50%{opacity:1;transform:scale(1)}}
#ml{position:absolute;inset:0;background:#0d0d12;display:flex;align-items:center;justify-content:center;z-index:10;transition:opacity 0.5s ease}
#mld{width:16px;height:16px;border-radius:50%;background:#ce93d8;animation:mp 1.5s ease-in-out infinite}
</style>
</head><body>
<model-viewer auto-rotate auto-rotate-delay="0" rotation-per-second="28deg"
  exposure="1.1" style="width:100%;height:100%">
</model-viewer>
<div id="ml"><div id="mld"></div></div>
<script>
(function(){
  var ml=document.getElementById('ml');
  var mv=document.querySelector('model-viewer');
  var b=atob('${glbBase64}'),n=b.length,a=new Uint8Array(n);
  for(var i=0;i<n;i++)a[i]=b.charCodeAt(i);
  mv.src=URL.createObjectURL(new Blob([a],{type:'model/gltf-binary'}));
  mv.addEventListener('load',function(){
    ml.style.opacity='0';
    setTimeout(function(){ml.style.display='none';},500);
  });
})();
</script></body></html>`;
}

// ─── Pre-rendered coin spin video ────────────────────────────────────────────
let COIN_SPIN_VIDEO: any = null;
try { COIN_SPIN_VIDEO = require('../../assets/coin_spin.mp4'); } catch {}

// ─── Easter egg prompts (33 unique) ──────────────────────────────────────────
const EASTER_EGG_PROMPTS: string[] = [
  'A Fabergé imperial Easter egg with intricate 24k gold filigree, sapphire and ruby gemstone inlays, enamel painted miniature portraits, on black velvet, macro photography',
  'A crystalline Easter egg containing a miniature universe, swirling galaxies and nebulae visible through optical glass, perfect reflections, dark void background, macro photography',
  'A steampunk mechanical Easter egg with exposed brass clockwork gears, ruby jeweled bearings, glass porthole windows revealing moving parts, aged copper patina, volumetric lighting',
  'An Art Nouveau Easter egg with flowing golden botanical vines in the style of Alphonse Mucha, exotic flowers, antique ivory background, museum photograph',
  'A bioluminescent deep-sea Easter egg glowing with ethereal blue and violet light, organic alien texture, floating plankton in complete darkness, underwater macro photography',
  'A Japanese Kintsugi Easter egg repaired with glowing golden lacquer seams, fractured ancient ceramic, wabi-sabi philosophy made visible, professional still-life photography',
  'A holographic Easter egg with iridescent rainbow interference patterns, floating in darkness, emanating soft laser light grids, futuristic minimal aesthetic, product photography',
  'A Viking Nordic Easter egg carved from fossilized mammoth ivory, ancient runic inscriptions filled with blue pigment, bronze age clasps, archaeological museum lighting',
  'A microscopic Easter egg made from crystallized amino acids and proteins, electron microscopy aesthetic, false color enhanced, scientific beauty at nanoscale',
  'A forbidden forest Easter egg overgrown with miniature moss, tiny glowing mushrooms, dewdrops on spider webs, living ecosystem inside cracks, extreme close-up nature photography',
  'A cosmic horror Easter egg housing a small eldritch entity, dark tentacles pressing against glass from inside, dim amber bioluminescent light, cinematic unsettling beauty',
  'A Georgian enamel Easter egg featuring intricate millefiori glass patterns in jewel tones, cloisonné metalwork, Florentine goldsmith artistry, art historical document photography',
  'A quantum Easter egg existing in superposition, simultaneously cracked and whole, ghost double-exposure image overlay, beautiful physics made visual',
  'An ice cave Easter egg carved from a single glacial crystal, ancient air bubbles trapped inside like stars, cool blue internal light, polar expedition photography',
  'A silk embroidered Easter egg wrapped in impossible microscopic needlework depicting entire landscapes, magnified to reveal infinite detail, textile art mastery',
  'A fractal mathematical Easter egg where the surface reveals recursive infinite patterns, Mandelbrot set meets traditional decoration, digital hyperrealism',
  'A lava lamp Easter egg with molten colored wax in constant slow motion, warm amber glow from within, retro futurism, long exposure photography',
  'A neural network Easter egg with actual synaptic connections visible, bioluminescent brain tissue patterns, neuroscience meets sacred decorative art, darkfield microscopy',
  'An ancient Egyptian Easter egg with hieroglyphic inscriptions, lapis lazuli and 24k gold leaf decoration, polished limestone base, British Museum collection style',
  'A liquid mercury Easter egg with perfect chrome reflective surface showing warped surroundings, heavy precious metal sheen, industrial surrealism, high-key studio lighting',
  'A gaseous nebula Easter egg formed from cosmic hydrogen plasma dust clouds, Hubble telescope aesthetic, a billion-year formation made intimate, astrophotography',
  'A clock mechanism Easter egg with hundreds of tiny interlocked Swiss watch parts creating a mechanical flower, German horology precision, close-up photography',
  'A bonsai Easter egg where the entire shell surface is a miniature ancient forest landscape, tiny ceramic trees and stone formations, Japanese garden philosophy',
  'A phoenix feather Easter egg woven from fire and molten light, liquid gold and deep crimson tones, mythological artifact, dramatic heroic studio lighting',
  'A meteorite Easter egg fused from authentic space rock, visible chondrule crystals and metallic flakes, cosmic origin story, scientific specimen photography',
  'A music box Easter egg opening to reveal a crystalline mechanical stage with tiny ethereal dancers, music notes made visible as golden light waves, nostalgia and wonder',
  'An alchemist Easter egg containing the glowing philosopher stone, warmly glowing amber orb inside mercury glass shell, medieval mysticism meets chemistry laboratory',
  'A deep sea hydrothermal vent Easter egg formed from exotic minerals, vivid orange sulfur crystals, white silica formations, extremophile ecosystem details visible',
  'A digital glitch Easter egg with RGB color channel separation, scanlines and pixel corruption as aesthetic choice, vaporwave meets sacred geometry, extreme detail',
  'A Tibetan mandala Easter egg hand-painted with geometric patterns in mineral pigments representing hundreds of hours of meditative artistry, spiritual centeredness',
  'A coral reef Easter egg with living corals and tropical fish visible in cross section, underwater macro photography, vibrant saturated ocean color palette',
  'A clockwork origami Easter egg folded from a single sheet of platinum foil into impossible geometric complexity, mathematical art, minimal product photography',
  'An Easter egg containing a parallel universe, tiny figures living in eternal spring with cherry blossoms falling, golden hour light filtering through, Gods eye perspective',
];

function pickEasterEggPrompt(): string {
  const a = EASTER_EGG_PROMPTS[Math.floor(Math.random() * EASTER_EGG_PROMPTS.length)];
  if (Math.random() < 0.4) {
    const b = EASTER_EGG_PROMPTS[Math.floor(Math.random() * EASTER_EGG_PROMPTS.length)];
    const bStyle = b.split(',').slice(1, 3).join(',').trim();
    const aBase = a.split(',')[0];
    const aEnd  = a.split(',').slice(-2).join(',');
    return `${aBase}, ${bStyle}, ${aEnd}`;
  }
  return a;
}

// ─── Category + subtype definitions ──────────────────────────────────────────
type Category = 'image' | 'video' | 'mesh3d';

interface SubtypeDef {
  isVideo?: boolean;   // picks a video file instead of an image
  id: AIItemType;
  title: string;
  desc: string;
  costLabel: string;
  accent: string;
  needsSource: boolean;
  textOnly?: boolean;
  isTransition?: boolean;
}

const IMAGE_SUBTYPES: SubtypeDef[] = [
  { id: 'image_standard',   title: '✨ Img to Img',  desc: 'Reimagine with AI — ControlNet + Cutout optional',  costLabel: '1 🪙',  accent: '#7eb8ff', needsSource: true },
  { id: 'image_txt2img',    title: '✍️ Text→Image', desc: 'Generate from text only',          costLabel: '1 🪙',  accent: '#7eb8ff', needsSource: false, textOnly: true },
];

const VIDEO_SUBTYPES: SubtypeDef[] = [
  { id: 'video_transition_auto', title: '🎬 RIFE Morph',    desc: '2 images → silky morph video (RIFE + AI)',  costLabel: '5 🪙',     accent: '#81c784', needsSource: true, isTransition: true },
  { id: 'video_slowmotion_auto', title: '🌊 Dream Flow',    desc: 'Image → evolving dreamscape video',         costLabel: '8 🪙',     accent: '#4fc3f7', needsSource: true },
  { id: 'video_v2v',            title: '🎨 Restyle Video', desc: 'Upload video → AI restyle every frame',      costLabel: '10 🪙',    accent: '#ce93d8', needsSource: true, isVideo: true },
  { id: 'video_animatediff',    title: '🎞️ AnimateDiff',   desc: 'Animate image (needs AnimateDiff ext)',      costLabel: '5/10f 🪙', accent: '#ff9f6b', needsSource: true },
  { id: 'video_slowcinema',     title: '🌊 Slow Cinema',   desc: 'Manual session: latent drift with abort',    costLabel: '5 🪙',     accent: '#4fc3f7', needsSource: true },
  { id: 'video_transition',     title: '🔄 Transition',    desc: 'Session-based morph (legacy)',               costLabel: '3 🪙',     accent: '#81c784', needsSource: true, isTransition: true },
];

const MESH_SUBTYPES: SubtypeDef[] = [
  { id: 'mesh3d_sf3d',       title: '⚡ SF3D',        desc: 'Fast textured 3D — ~45s, USDZ+GLB', costLabel: '5 🪙', accent: '#4fc3f7', needsSource: true },
  { id: 'mesh3d_tripo',      title: '🧊 TripoSR',     desc: 'Photo → 3D mesh, AR-ready USDZ',    costLabel: '5 🪙', accent: '#ffb74d', needsSource: true },
  { id: 'mesh3d_hunyuan',    title: '🌟 Hunyuan',     desc: 'Max-quality 3D — ~4 min, USDZ+GLB', costLabel: '5 🪙', accent: '#ce93d8', needsSource: true },
  { id: 'mesh3d_trellis2',   title: '💠 Trellis2',    desc: 'High-detail mesh + 2K textures — ~3–6 min', costLabel: '5 🪙', accent: '#80cbc4', needsSource: true },
  { id: 'mesh3d_procedural', title: '🌀 Procedural',  desc: 'Procedural 3D from image',           costLabel: '5 🪙', accent: '#a5d6a7', needsSource: true },
];

const CATEGORY_DEFS = [
  { id: 'image'  as Category, title: 'IMAGE', emoji: ['🖼️','🧮','🌄','🌅','🎇','🎆'], accent: '#7eb8ff', costFrom: 'from 1 🪙',  subtypes: IMAGE_SUBTYPES },
  { id: 'video'  as Category, title: 'VIDEO', emoji: ['🎬','📽️','🎥','📹','🎬'],      accent: '#ff9f6b', costFrom: 'from 3 🪙',  subtypes: VIDEO_SUBTYPES },
  { id: 'mesh3d' as Category, title: '3D',    emoji: ['🧊','👾','🧮','🧪','🗿'],      accent: '#ce93d8', costFrom: 'from 5 🪙',  subtypes: MESH_SUBTYPES },
];

const ALL_SUBTYPES = [...IMAGE_SUBTYPES, ...VIDEO_SUBTYPES, ...MESH_SUBTYPES];

function typeLabel(t: AIItemType): string {
  return ALL_SUBTYPES.find(o => o.id === t)?.title ?? t;
}

// ─── Emoji sequences ──────────────────────────────────────────────────────────
const EMOJI_SEQS: Record<Category, string[]> = {
  image: ['🖼️', '🧮', '🌄', '🌅', '🎇', '🎆'],
  video: ['🎬', '📽️', '🎥', '📹', '🎬'],
  mesh3d: ['🧊', '👾', '🧮', '🧪', '🗿'],
};

function getCategorySeq(cat: Category): string[] { return EMOJI_SEQS[cat]; }

function getEmojiSeq(type: AIItemType): string[] {
  if (type.startsWith('image')) return EMOJI_SEQS.image;
  if (type.startsWith('video')) return EMOJI_SEQS.video;
  return EMOJI_SEQS.mesh3d;
}

// ─── Animated category icon ───────────────────────────────────────────────────
const AnimatedCategoryEmoji: React.FC<{ seq: string[]; size?: number }> = ({ seq, size = 32 }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const delay = Math.floor(Math.random() * 400);
    let id: any;
    const tid = setTimeout(() => {
      id = setInterval(() => setFrame(f => (f + 1) % seq.length), 160);
    }, delay);
    return () => { clearTimeout(tid); if (id) clearInterval(id); };
  }, [seq.length]);
  return <Text style={{ fontSize: size }}>{seq[frame]}</Text>;
};

// ─── Coin count display ───────────────────────────────────────────────────────
const CoinDisplay: React.FC<{ count: number }> = ({ count }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const prev  = useRef(count);
  useEffect(() => {
    if (count !== prev.current) {
      prev.current = count;
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.45, duration: 100, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [count, scale]);
  return <Animated.Text style={[styles.coinCount, { transform: [{ scale }] }]}>{count.toLocaleString()}</Animated.Text>;
};

// ─── Coin widget ──────────────────────────────────────────────────────────────
interface CoinWidgetProps {
  coinCount: number;
  userName?: string;
  onAddCoins: (n: number) => void;
  onEasterEgg: () => void;
  onWildLevelChange: (level: number) => void;
  flyAnims: { x: Animated.Value; y: Animated.Value; rot: Animated.Value }[];
}

// spinMode: 'idle' = bouncing | 'spinning' = tap one-shot spin | 'holding' = held loop
type SpinMode = 'idle' | 'spinning' | 'holding';

const CoinWidget: React.FC<CoinWidgetProps> = ({
  coinCount, userName, onAddCoins, onEasterEgg, onWildLevelChange, flyAnims,
}) => {
  const [spinMode, setSpinMode]  = useState<SpinMode>('idle');
  const bounceAnim               = useRef(new Animated.Value(0)).current;
  const spinAnim                 = useRef(new Animated.Value(0)).current;
  const flatAnim                 = useRef(new Animated.Value(0)).current; // 0=upright → 1=flat
  const spinLoopRef              = useRef<any>(null);
  const hapticIntervalRef        = useRef<any>(null);
  const holdTimerRef             = useRef<any>(null);
  const holdElapsedRef           = useRef(0);
  const lastCoinRef              = useRef(0);
  const lastHapticRef            = useRef(0);
  const spinModeRef              = useRef<SpinMode>('idle');
  spinModeRef.current = spinMode;

  // Idle bounce
  useEffect(() => {
    if (spinMode !== 'idle') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bounceAnim, { toValue: -12, duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bounceAnim, { toValue: 0,   duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [spinMode, bounceAnim]);

  useEffect(() => () => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
    spinLoopRef.current?.stop();
  }, []);

  // ── Tap: one-shot accelerating spin then fall flat ────────────────────────
  const doTapSpin = useCallback(() => {
    if (spinModeRef.current !== 'idle') return;
    const rotations = 3 + Math.floor(Math.random() * 6); // 3–8 full spins
    spinAnim.setValue(0);
    flatAnim.setValue(0);
    setSpinMode('spinning');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.sequence([
      // Accelerating spin: Easing.in(quad) = slow start → fast end
      Animated.timing(spinAnim, {
        toValue: rotations,
        duration: 350 + rotations * 250,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      // Fall flat: rotateX tilts from upright to flat
      Animated.timing(flatAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Brief pause flat, then hide 3D and return to idle
      setTimeout(() => {
        setSpinMode('idle');
        spinAnim.setValue(0);
        flatAnim.setValue(0);
      }, 180);
    });
  }, [spinAnim, flatAnim]);

  // ── Hold: infinite loop + escalating haptics ──────────────────────────────
  const startHold = useCallback(() => {
    if (spinModeRef.current === 'spinning') return; // don't interrupt tap spin
    spinLoopRef.current?.stop();
    spinAnim.setValue(0);
    flatAnim.setValue(0);
    setSpinMode('holding');

    // Fast infinite spin loop
    spinLoopRef.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 380, easing: Easing.linear, useNativeDriver: true })
    );
    spinLoopRef.current.start();

    holdElapsedRef.current = 0;
    lastCoinRef.current    = 0;
    lastHapticRef.current  = 0;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onAddCoins(10);

    holdTimerRef.current = setInterval(() => {
      holdElapsedRef.current += 0.1;
      const t = holdElapsedRef.current;

      if (t - lastCoinRef.current >= 3) { lastCoinRef.current = t; onAddCoins(10); }

      const lvl = t < 10 ? 0 : t < 25 ? 1 : t < 45 ? 2 : t < 65 ? 3 : t < 85 ? 4 : 5;
      onWildLevelChange(lvl);

      if (t > 15) {
        const intensity = Math.min((t - 15) / 85, 1);
        const maxD = SW * intensity * 0.55;
        flyAnims.forEach((fa, i) => {
          const phase = (i + 1) * 0.33;
          Animated.spring(fa.x, { toValue: Math.sin(t * 0.8 + phase) * maxD, useNativeDriver: true, damping: 3 + intensity * 8, stiffness: 80 + intensity * 180 }).start();
          Animated.spring(fa.y, { toValue: Math.cos(t * 0.6 + phase) * maxD * 0.4, useNativeDriver: true, damping: 3 + intensity * 8, stiffness: 80 + intensity * 180 }).start();
          Animated.spring(fa.rot, { toValue: Math.sin(t * 1.1 + phase) * 35 * intensity, useNativeDriver: true, damping: 4 + intensity * 6 }).start();
        });
      }

      const hapticPeriod = t < 10 ? 0.9 : t < 30 ? 0.45 : t < 60 ? 0.22 : t < 85 ? 0.1 : 0.05;
      if (t - lastHapticRef.current >= hapticPeriod) {
        lastHapticRef.current = t;
        if (t < 10)      void Haptics.selectionAsync();
        else if (t < 30) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        else if (t < 60) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        else if (t < 85) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        else Math.random() > 0.4
          ? void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }

      if (t >= 100) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        onEasterEgg();
      }
    }, 100);
  }, [spinAnim, flatAnim, onAddCoins, onEasterEgg, onWildLevelChange, flyAnims]);

  const endHold = useCallback(() => {
    if (spinModeRef.current !== 'holding') return;
    if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
    spinLoopRef.current?.stop();
    spinAnim.setValue(0);
    setSpinMode('idle');
    flyAnims.forEach(fa => {
      Animated.spring(fa.x,   { toValue: 0, useNativeDriver: true, damping: 12 }).start();
      Animated.spring(fa.y,   { toValue: 0, useNativeDriver: true, damping: 12 }).start();
      Animated.spring(fa.rot, { toValue: 0, useNativeDriver: true, damping: 12 }).start();
    });
    onWildLevelChange(0);
  }, [spinAnim, flyAnims, onWildLevelChange]);

  // rotateY from spin (extends beyond 1 for multiple rotations)
  const rotateY = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'], extrapolate: 'extend' });
  // rotateX for fall-flat effect (0=upright, 1=flat on table)
  const rotateX = flatAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '88deg'] });
  const scaleY  = flatAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.85, 0.15] });

  const coinTransform = spinMode === 'idle'
    ? [{ translateY: bounceAnim }]
    : [{ perspective: 900 }, { rotateY }, { rotateX }, { scaleY }, { scale: 1.08 }];

  const is3d = spinMode !== 'idle';

  return (
    <View style={styles.coinRow}>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={doTapSpin}
        onLongPress={startHold}
        onPressOut={endHold}
        delayLongPress={480}
        style={styles.coinPressable}
      >
        <Animated.Text style={[styles.bigCoin, { transform: coinTransform }]}>🪙</Animated.Text>
        {is3d && <Text style={styles.coin3dLabel}>3D</Text>}
      </Pressable>
      <View style={[styles.coinInfo, { alignItems: 'flex-end' }]}>
        <CoinDisplay count={coinCount} />
        <Text style={styles.coinLabel}>coins</Text>
        {!!userName && <Text style={styles.coinUserName}>{userName}</Text>}
      </View>
    </View>
  );
};

// ─── Bounce wrapper ───────────────────────────────────────────────────────────
const Bounce: React.FC<{ children: React.ReactNode; amount?: number; period?: number }> = ({
  children, amount = 8, period = 900,
}) => {
  const ty = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(ty, { toValue: -amount, duration: period, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0,       duration: period, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [ty, amount, period]);
  return <Animated.View style={{ transform: [{ translateY: ty }] }}>{children}</Animated.View>;
};

// ─── Pixel reveal image ───────────────────────────────────────────────────────
const PX_COLS = 12;
const PX_ROWS = 12;
const PX_TILES = PX_COLS * PX_ROWS;

const PixelRevealImage: React.FC<{ uri: string; size: number; reveal: boolean }> = ({ uri, size, reveal }) => {
  const anims = useRef(Array.from({ length: PX_TILES }, () => new Animated.Value(1))).current;
  const revealedRef = useRef(false);

  useEffect(() => {
    if (!reveal || revealedRef.current) return;
    revealedRef.current = true;
    const indices = Array.from({ length: PX_TILES }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    indices.forEach((tileIdx, order) => {
      Animated.timing(anims[tileIdx], {
        toValue: 0,
        duration: 100 + Math.random() * 160,
        delay: order * (1600 / PX_TILES),
        useNativeDriver: true,
      }).start();
    });
  }, [reveal]);

  const tileW = size / PX_COLS;
  const tileH = size / PX_ROWS;

  return (
    <View style={{ width: size, height: size, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' }}>
      <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="contain" />
      <View style={StyleSheet.absoluteFillObject}>
        {Array.from({ length: PX_ROWS }, (_, row) => (
          <View key={row} style={{ flexDirection: 'row', height: tileH }}>
            {Array.from({ length: PX_COLS }, (_, col) => (
              <Animated.View
                key={col}
                style={{ width: tileW, height: tileH, backgroundColor: '#0a0a0a', opacity: anims[row * PX_COLS + col] }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
};

// ─── Mini logo animator ───────────────────────────────────────────────────────
const MiniLogoAnimator: React.FC<{ size?: number }> = ({ size = 58 }) => {
  const [logoSet] = useState(() => getRandomImageLogoSet());
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % logoSet.frames.length), 180);
    return () => clearInterval(id);
  }, [logoSet]);
  return (
    <Image source={logoSet.frames[frame]} style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} resizeMode="contain" />
  );
};

// ─── Server status strip (invisible — long-press for settings) ───────────────
const ServerStatus: React.FC<{ onLongPress?: () => void }> = ({ onLongPress }) => (
  <TouchableOpacity
    onLongPress={onLongPress}
    delayLongPress={2000}
    style={{ height: 10, marginHorizontal: 20, marginBottom: 2 }}
  />
);

// ─── Password config ──────────────────────────────────────────────────────────
const PasswordConfig: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [pw, setPw] = useState('');
  useEffect(() => { getSdStreamPassword().then(setPw); }, []);
  const save = async () => {
    await setSdStreamPassword(pw.trim());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };
  return (
    <View style={styles.modalOverlay}>
      <View style={styles.sheetBox}>
        <Text style={styles.sheetTitle}>⚙️ SD-Stream Password</Text>
        <Text style={styles.sheetDesc}>
          Required for Slow Cinema, Transition, and 3D Mesh.{'\n'}
          Found in env var <Text style={{ color: '#ff9f6b' }}>TTS_AUTH_PASSWORD</Text> on your server.
        </Text>
        <TextInput
          style={styles.textInput} value={pw} onChangeText={setPw}
          secureTextEntry placeholder="Enter password…" placeholderTextColor="#444" autoFocus
        />
        <TouchableOpacity onPress={save} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>💾 Save</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={styles.btnBack}>
          <Text style={styles.btnBackText}>← Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Category card (main grid) ────────────────────────────────────────────────
const CategoryCard: React.FC<{
  cat: typeof CATEGORY_DEFS[0];
  onPress: () => void;
  isActive: boolean;
  bounce?: boolean;
}> = ({ cat, onPress, isActive, bounce }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!isActive) { setFrame(0); return; }
    setFrame(0);
    const id = setInterval(() => setFrame(f => (f + 1) % cat.emoji.length), 120);
    return () => clearInterval(id);
  }, [isActive, cat.emoji.length]);

  const card = (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}
      style={[styles.catCard, { borderColor: cat.accent + (isActive ? 'cc' : '55') }]}>
      <Text style={{ fontSize: 38 }}>{cat.emoji[frame]}</Text>
      <Text style={[styles.catTitle, { color: cat.accent }]}>{cat.title}</Text>
      <Text style={styles.catCost}>{cat.costFrom}</Text>
    </TouchableOpacity>
  );
  return bounce ? <Bounce amount={8}>{card}</Bounce> : card;
};

// ─── App artwork picker ───────────────────────────────────────────────────────
const AppArtworkPicker: React.FC<{
  onPick: (uri: string, b64: string) => void;
  onClose: () => void;
}> = ({ onPick, onClose }) => {
  const [files, setFiles]   = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { listAppArtwork().then(f => { setFiles(f); setLoading(false); }); }, []);

  const handlePick = async (uri: string) => {
    try {
      const b64 = await uriToBase64(uri);
      onPick(uri, b64);
    } catch { Alert.alert('Error', 'Could not read this file.'); }
  };

  return (
    <View style={styles.modalOverlay}>
      <View style={styles.artSheet}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={styles.sheetTitle}>🎨 App Artwork</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ fontSize: 22 }}>❎</Text></TouchableOpacity>
        </View>
        {loading
          ? <ActivityIndicator color="#ff9f6b" />
          : files.length === 0
            ? <Text style={{ color: '#555', textAlign: 'center', padding: 24 }}>No exports found. Export a painting first!</Text>
            : (
              <FlatList
                data={files}
                keyExtractor={i => i}
                numColumns={3}
                contentContainerStyle={{ gap: 4 }}
                columnWrapperStyle={{ gap: 4 }}
                renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => void handlePick(item)}>
                    <Image source={{ uri: item }} style={styles.artThumb} resizeMode="cover" />
                  </TouchableOpacity>
                )}
              />
            )}
      </View>
    </View>
  );
};

// ─── Factory camera WebView ────────────────────────────────────────────────────
// Memoized: inner WebView never re-renders from parent state changes (no progress prop).
// Height fills ~52% of screen (or 42% on iPad landscape to keep aspect ratio correct).
const { height: SCREEN_H_DEV } = Dimensions.get('window');
const IS_LANDSCAPE = SW > SCREEN_H_DEV;
const CAM_H = Math.round(SCREEN_H_DEV * (IS_IPAD ? (IS_LANDSCAPE ? 0.42 : 0.38) : 0.52));

const FACTORY_CAMS = [
  { id: 'overview', e: '🌐' }, { id: 'printer', e: '🖨️' },
  { id: 'machine',  e: '⚙️' }, { id: 'scanner', e: '📡' },
  { id: 'belt',     e: '📦' }, { id: 'bucket',  e: '🪣' },
];

const HIDE_FACTORY_UI_JS = `(function(){var s=document.createElement('style');s.textContent='[class*="info"],[class*="status"],[class*="overlay"],[class*="label"],[class*="counter"],[class*="stats"],[class*="hud"],[class*="ui-"],[class*="-ui"],[class*="badge"],[class*="bubble"],[class*="toast"],[class*="progress"],[class*="stage"],[class*="queue"],[class*="fps"]{display:none!important}canvas,video,img{will-change:transform;transform:translateZ(0)}body{background:#000!important;overflow:hidden!important}';if(document.head)document.head.appendChild(s);})();true;`;

// Module-level cache: avoids re-probing LAN/WAN each time a new WebView mounts
let _factoryUrlCache: string | null = null;
function getFactoryUrlCached(): Promise<string> {
  if (_factoryUrlCache) return Promise.resolve(_factoryUrlCache);
  return getApi3DFactoryUrl().then(url => { _factoryUrlCache = url; return url; });
}

// Inner WebView — memoized so it never remounts on parent state changes

const FactoryWebView: React.FC<{ onOpenSettings?: () => void; camHeight?: number }> = ({ camHeight }) => {
  const [factoryUrl, setFactoryUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [webLoaded,  setWebLoaded]  = useState(false);
  const [cam, setCam]               = useState('overview');
  const webRef2                     = useRef<any>(null);
  const loadTimerRef                = useRef<any>(null);
  const h = camHeight ?? CAM_H;

  useEffect(() => { getFactoryUrlCached().then(setFactoryUrl); }, []);

  // Timeout: if page doesn't load in 30s, mark offline
  useEffect(() => {
    if (!factoryUrl || webLoaded || loadFailed) return;
    loadTimerRef.current = setTimeout(() => setLoadFailed(true), 30_000);
    return () => clearTimeout(loadTimerRef.current);
  }, [factoryUrl, webLoaded, loadFailed]);

  const handleError = () => {
    clearTimeout(loadTimerRef.current);
    if (factoryUrl?.includes('192.168.')) {
      _factoryUrlCache = null;
      setLoadFailed(false);
      setWebLoaded(false);
      getFactoryUrlCached().then(setFactoryUrl).catch(() => setLoadFailed(true));
    } else {
      setLoadFailed(true);
    }
  };

  const handleLoadEnd = () => {
    clearTimeout(loadTimerRef.current);
    webRef2.current?.injectJavaScript(HIDE_FACTORY_UI_JS);
    // Small delay so the video stream has time to start before we hide the overlay
    setTimeout(() => setWebLoaded(true), 2000);
  };

  const switchCam = (id: string) => {
    setCam(id);
    if (webRef2.current) {
      webRef2.current.injectJavaScript(
        `(function(){var id=${JSON.stringify(id)};if(typeof window.setCamera==='function')window.setCamera(id);else if(typeof window.switchCamera==='function')window.switchCamera(id);else window.postMessage(JSON.stringify({type:'camera',id:id}),'*');})();true;`
      );
    }
  };

  if (!factoryUrl) return (
    <View style={{ height: h, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <ActivityIndicator color="#ce93d8" size="small" />
      <Text style={{ color: '#444', fontSize: 10 }}>Connecting to factory…</Text>
    </View>
  );

  if (loadFailed) return (
    <View style={{ height: h, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Text style={{ fontSize: 26 }}>📡</Text>
      <Text style={{ color: '#555', fontSize: 11, textAlign: 'center' }}>Factory cam offline{'\n'}(job still running)</Text>
      <TouchableOpacity onPress={() => { setLoadFailed(false); setWebLoaded(false); setFactoryUrl(null); void getFactoryUrlCached().then(setFactoryUrl); }}>
        <Text style={{ color: '#ce93d8', fontSize: 11 }}>↻ Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ width: '100%', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(206,147,216,0.2)' }}>
      <View style={{ width: '100%', height: h }}>
        <WebView
          ref={webRef2}
          source={{ uri: factoryUrl }}
          style={{ width: '100%', height: h, backgroundColor: '#000' }}
          scrollEnabled={false}
          javaScriptEnabled domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onError={handleError}
          onHttpError={e => { if ((e.nativeEvent?.statusCode ?? 0) >= 500) handleError(); }}
          onLoadEnd={handleLoadEnd}
          onContentProcessDidTerminate={() => webRef2.current?.reload()}
        />
        {/* Loading overlay — fades away once stream connects */}
        {!webLoaded && (
          <View style={{
            position: 'absolute', inset: 0,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#0a0a0f', gap: 8,
          }}>
            <ActivityIndicator color="#ce93d8" size="large" />
            <Text style={{ color: '#555', fontSize: 11 }}>Loading factory feed…</Text>
          </View>
        )}
      </View>
      {/* Camera selector strip */}
      <View style={{ flexDirection: 'row', backgroundColor: '#080808', justifyContent: 'center', paddingVertical: 5, gap: 2, flexWrap: 'wrap' }}>
        {FACTORY_CAMS.map(c => (
          <TouchableOpacity key={c.id} onPress={() => switchCam(c.id)}
            style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
              backgroundColor: cam === c.id ? 'rgba(206,147,216,0.25)' : 'transparent',
              borderWidth: 1, borderColor: cam === c.id ? '#ce93d8' : 'transparent' }}>
            <Text style={{ fontSize: 14 }}>{c.e}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

// ─── Factory top-cam strip (decorative, auto-rotates every 30s) ──────────────
const FactoryTopCamView: React.FC = React.memo(() => {
  const [factoryUrl, setFactoryUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const webRef = useRef<any>(null);
  const currentCamRef = useRef(FACTORY_CAMS[Math.floor(Math.random() * FACTORY_CAMS.length)].id);

  useEffect(() => {
    getFactoryUrlCached()
      .then(setFactoryUrl)
      .catch(() => setLoadFailed(true));
  }, []);

  const injectCam = useCallback((id: string) => {
    if (!webRef.current) return;
    webRef.current.injectJavaScript(
      `(function(){var id=${JSON.stringify(id)};if(typeof window.setCamera==='function')window.setCamera(id);else if(typeof window.switchCamera==='function')window.switchCamera(id);else window.postMessage(JSON.stringify({type:'camera',id:id}),'*');})();true;`
    );
  }, []);

  const handleLoadEnd = useCallback(() => {
    if (!webRef.current) return;
    webRef.current.injectJavaScript(HIDE_FACTORY_UI_JS);
    injectCam(currentCamRef.current);
  }, [injectCam]);

  // Auto-rotate to a different random cam every 30s
  useEffect(() => {
    const id = setInterval(() => {
      const others = FACTORY_CAMS.filter(c => c.id !== currentCamRef.current);
      const next = others[Math.floor(Math.random() * others.length)].id;
      currentCamRef.current = next;
      injectCam(next);
    }, 30_000);
    return () => clearInterval(id);
  }, [injectCam]);

  if (loadFailed || !factoryUrl) return null;

  return (
    <View style={{ width: '100%', height: 150, borderRadius: 14, overflow: 'hidden',
      marginVertical: 10, borderWidth: 1, borderColor: 'rgba(206,147,216,0.15)' }}>
      <WebView
        ref={webRef}
        source={{ uri: factoryUrl }}
        style={{ width: '100%', height: 150, backgroundColor: '#000' }}
        scrollEnabled={false}
        javaScriptEnabled domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onError={() => setLoadFailed(true)}
        onHttpError={e => { if ((e.nativeEvent?.statusCode ?? 0) >= 500) setLoadFailed(true); }}
        onLoadEnd={handleLoadEnd}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
      />
    </View>
  );
});

// ─── Factory stage progress strip ────────────────────────────────────────────
// Shown during image/video processing — cycles world→print→machine→laser→cardbox→basket
const PROC_STAGES = [
  { id: 'world',   emoji: '🌍', label: 'World Scan' },
  { id: 'print',   emoji: '🖨️', label: 'Printing'   },
  { id: 'machine', emoji: '⚙️', label: 'Machining'  },
  { id: 'laser',   emoji: '🔴', label: 'Laser Cut'  },
  { id: 'cardbox', emoji: '📦', label: 'Packaging'  },
  { id: 'basket',  emoji: '🧺', label: 'Assembly'   },
];

const ProcessingStageBar: React.FC<{ running: boolean }> = ({ running }) => {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setIdx(i => (i + 1) % PROC_STAGES.length), 4000);
    return () => clearInterval(id);
  }, [running]);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 8, flexWrap: 'wrap' }}>
      {PROC_STAGES.map((s, i) => (
        <View key={s.id} style={{
          flexDirection: 'row', alignItems: 'center', gap: 3,
          paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
          backgroundColor: i === idx ? 'rgba(206,147,216,0.2)' : 'transparent',
          borderWidth: i === idx ? 1 : 0, borderColor: '#ce93d8',
          opacity: i <= idx ? 1 : 0.3,
        }}>
          <Text style={{ fontSize: i === idx ? 16 : 13 }}>{s.emoji}</Text>
          {i === idx && <Text style={{ color: '#ce93d8', fontSize: 10, fontWeight: '700' }}>{s.label}</Text>}
        </View>
      ))}
    </View>
  );
};

// ─── Processing view (extracted so it can own hooks safely) ──────────────────
const ProcessingView: React.FC<{
  flow: FlowState;
  setFlow: any;
  catDef: typeof CATEGORY_DEFS[0];
  subtypeDef: SubtypeDef | null;
  coinCount: number;
  onRun: (params: RunParams) => string;
  onClose: () => void;
  onOpenSettings?: () => void;
  onAbort?: () => void;
  onOpenFullscreen?: (itemId: string) => void;
}> = ({ flow, setFlow, catDef, subtypeDef, coinCount, onRun, onClose, onOpenSettings, onAbort, onOpenFullscreen }) => {
  const logScrollRef = useRef<ScrollView>(null);
  const [typewriterText, setTypewriterText] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdown3D, setCountdown3D] = useState(100);

  const hasFailed   = flow.done && flow.log.some(l => l.startsWith('❌'));
  const retryCount  = flow.retryCount ?? 0;
  const isImageType = !!(flow.subtype?.startsWith('image'));
  const isVideoType = !!(flow.subtype?.startsWith('video'));
  const is3DType    = !!(flow.subtype?.startsWith('mesh3d'));
  const previewSize = Math.min(SW - 80, IS_IPAD ? 380 : 280);

  // Typewriter: runs once on mount (= when user hits Generate and panel appears)
  useEffect(() => {
    const full = flow.prompt || '';
    if (!full) return;
    let i = 0;
    const tid = setInterval(() => {
      i++;
      setTypewriterText(full.slice(0, i));
      if (i >= full.length) clearInterval(tid);
    }, 16);
    return () => clearInterval(tid);
  }, []);

  // 3D countdown: starts at 100s, ticks down to 0; job may finish before or after
  useEffect(() => {
    if (!flow.subtype?.startsWith('mesh3d')) return;
    const id = setInterval(() => setCountdown3D(c => c > 0 ? c - 1 : 0), 1000);
    return () => clearInterval(id);
  }, []); // mount only — 3D job starts immediately

  // After 3D success: jump directly to fullscreen viewer
  useEffect(() => {
    if (!flow.done || hasFailed || !is3DType) return;
    if (!flow.itemId || !onOpenFullscreen) return;
    onOpenFullscreen(flow.itemId);
  }, [flow.done, hasFailed, is3DType]);

  // Auto-close 10s after success (non-3D)
  useEffect(() => {
    if (!flow.done || hasFailed || is3DType) return;
    let t = 10;
    setCountdown(t);
    const cid = setInterval(() => {
      t--;
      setCountdown(t);
      if (t <= 0) { clearInterval(cid); onClose(); }
    }, 1000);
    return () => clearInterval(cid);
  }, [flow.done, hasFailed, is3DType]);

  const handleRetry = () => {
    if (!flow.subtype) return;
    const cost = flow.subtype === 'video_animatediff' ? calcVideoCost(flow.frameCount)
      : flow.subtype === 'video_slowcinema' ? calcSlowCinemaCost(flow.frameCount)
      : (COSTS as any)[flow.subtype] ?? 0;
    if (cost > coinCount) { Alert.alert('Not enough coins', `Need ${cost} 🪙 to retry.`); return; }
    const newId = onRun({
      type: flow.subtype, sourceB64: flow.sourceB64 ?? '',
      source2B64: flow.source2B64, sourceDims: flow.sourceDims,
      prompt: flow.prompt, cnModule: flow.cnModule,
      scPreset: flow.scPreset, frameCount: flow.frameCount,
      removeBg: flow.removeBg,
      aiPower: flow.aiPower ?? 0.5,
    });
    setFlow((prev: FlowState | null) => prev
      ? { ...prev, itemId: newId, log: ['⏳ Retrying…'], done: false, previewUri: undefined, frameProgress: undefined, retryCount: (prev.retryCount ?? 0) + 1 }
      : prev
    );
  };

  const handleEditAndRetry = () => {
    // Go back to options step so user can change prompt / settings
    setFlow((prev: FlowState | null) => prev
      ? { ...prev, step: 'options', done: false, log: [], previewUri: undefined, frameProgress: undefined }
      : prev
    );
  };

  const hasPreview  = !!(flow.previewUri);
  const isWIPPreview = hasPreview && flow.previewUri!.startsWith('data:');
  const isDoneImage  = hasPreview && flow.done && !hasFailed && isImageType;
  const isDoneVideo  = hasPreview && flow.done && !hasFailed && isVideoType;

  // factory cam replaces the log while actively processing image/video
  const showFactoryCam = !is3DType && !flow.done && !hasFailed;
  // log box: only shown on failure; active processing uses factory cam; 3D has its own log section
  const showLog = hasFailed;

  return (
    <View style={[styles.modalOverlay, is3DType && !flow.done ? { padding: 0 } : {}]}>
      <View style={[styles.sheetBox, { maxHeight: '96%', paddingBottom: 14 },
        is3DType && !flow.done ? { padding: 10, borderRadius: 18, width: '100%', maxWidth: undefined } : {}
      ]}>

        {/* ── Header ── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, width: '100%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <AnimatedCategoryEmoji seq={catDef.emoji} size={22} />
            <Text style={[styles.sheetTitle, { color: catDef.accent, fontSize: 16 }]}>
              {flow.done ? (hasFailed ? '❌ Failed' : '✅ Done!') : (subtypeDef?.title ?? 'Generating…')}
            </Text>
          </View>
          {!flow.done
            ? <ActivityIndicator size="small" color={catDef.accent} />
            : countdown !== null && !hasFailed
              ? <Text style={{ color: '#555', fontSize: 11 }}>closes in {countdown}s</Text>
              : null
          }
        </View>

        {/* ── Typewriter prompt (not shown for 3D) ── */}
        {typewriterText.length > 0 && !is3DType && (
          <View style={styles.processingPromptBox}>
            <Text style={styles.processingPrompt} numberOfLines={4}>{typewriterText}</Text>
          </View>
        )}

        {/* ── A1111 step progress bar (not shown for 3D — handled inside 3D section) ── */}
        {!!flow.frameProgress && flow.frameProgress.total > 0 && !flow.done && !is3DType && (
          <View style={{ width: '100%', marginBottom: 8 }}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${flow.frameProgress.pct}%` as any }]} />
            </View>
            <Text style={styles.progressBarLabel}>
              {isVideoType ? `Frame step ${flow.frameProgress.current}/${flow.frameProgress.total}` : `Step ${flow.frameProgress.current}/${flow.frameProgress.total}`}{' '}— {flow.frameProgress.pct}%
            </Text>
          </View>
        )}

        {/* ── Image preview ── */}
        {(hasPreview && isImageType) && (
          <View style={{ alignItems: 'center', marginVertical: 8 }}>
            {isDoneImage ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => flow.itemId && onOpenFullscreen?.(flow.itemId)}
                disabled={!onOpenFullscreen || !flow.itemId}
              >
                <PixelRevealImage uri={flow.previewUri!} size={previewSize} reveal={true} />
                {!!onOpenFullscreen && <Text style={{ color: '#7eb8ff', fontSize: 10, textAlign: 'center', marginTop: 3 }}>tap to fullscreen</Text>}
              </TouchableOpacity>
            ) : isWIPPreview ? (
              <Image source={{ uri: flow.previewUri }} style={{ width: previewSize, height: previewSize, borderRadius: 14, opacity: 0.65 }} resizeMode="contain" />
            ) : null}
            {flow.done && !hasFailed && (
              <Text style={{ color: '#4caf50', fontSize: 11, marginTop: 6, fontWeight: '700' }}>✅ Saved to AI Library</Text>
            )}
          </View>
        )}

        {/* ── Video preview (WIP image or done video) ── */}
        {isVideoType && (
          isDoneVideo && flow.previewUri ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => flow.itemId && onOpenFullscreen?.(flow.itemId)}
              disabled={!onOpenFullscreen || !flow.itemId}
              style={{ alignItems: 'center', marginVertical: 8 }}
            >
              {(() => {
                const ratio = flow.sourceDims ? flow.sourceDims.w / flow.sourceDims.h : 4 / 3;
                const vH = Math.round(previewSize / ratio);
                return flow.previewUri.endsWith('.gif') ? (
                  <WebView source={{ uri: flow.previewUri }} style={{ width: previewSize, height: vH, borderRadius: 14 }} scrollEnabled={false} />
                ) : (
                  <Video source={{ uri: flow.previewUri }} style={{ width: previewSize, height: vH, borderRadius: 14 }} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping isMuted useNativeControls={false} />
                );
              })()}
              {!!onOpenFullscreen && <Text style={{ color: '#7eb8ff', fontSize: 10, textAlign: 'center', marginTop: 3 }}>tap to fullscreen</Text>}
              <Text style={{ color: '#4caf50', fontSize: 11, marginTop: 4, fontWeight: '700' }}>✅ Saved to AI Library</Text>
            </TouchableOpacity>
          ) : isWIPPreview ? (
            <View style={{ alignItems: 'center', marginVertical: 8 }}>
              <Image source={{ uri: flow.previewUri }} style={{ width: previewSize * 0.7, height: previewSize * 0.7, borderRadius: 12, opacity: 0.65 }} resizeMode="contain" />
            </View>
          ) : null
        )}

        {/* ── 3D: factory cam fills panel, status strip below ── */}
        {is3DType && !flow.done && (
          <>
            {/* Factory cam — takes up most of the panel */}
            <FactoryWebView onOpenSettings={onOpenSettings} />
            {/* Animated server status label */}
            {!!flow.statusLabel && (
              <Text style={{
                color: '#ce93d8', fontSize: 13, fontWeight: '800',
                textAlign: 'center', marginTop: 6, letterSpacing: 0.4,
              }}>
                ⚙️ {flow.statusLabel}
              </Text>
            )}
            {/* Status row below cam */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', paddingHorizontal: 4, marginTop: flow.statusLabel ? 2 : 4 }}>
              <Text style={{
                color: countdown3D > 30 ? '#ce93d8' : countdown3D > 0 ? '#ff9f6b' : '#f88',
                fontSize: 18, fontWeight: '800', minWidth: 52,
              }}>
                {countdown3D > 0 ? `⏱${countdown3D}s` : '⏱ …'}
              </Text>
              {!!flow.frameProgress && flow.frameProgress.pct > 0 && (
                <View style={{ flex: 1 }}>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${flow.frameProgress.pct}%` as any, backgroundColor: '#ce93d8' }]} />
                  </View>
                  <Text style={{ color: '#444', fontSize: 8, textAlign: 'right' }}>{flow.frameProgress.pct}%</Text>
                </View>
              )}
            </View>
            {/* Tiny scrollable log */}
            <View style={[styles.logBox, { height: 42, marginTop: 2 }]}>
              <ScrollView
                ref={logScrollRef}
                onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: true })}
                showsVerticalScrollIndicator={false}
              >
                {flow.log.map((line, i) => (
                  <Text key={i} style={[styles.logLine, { fontSize: 8, lineHeight: 12 }]}>{line}</Text>
                ))}
              </ScrollView>
            </View>
          </>
        )}

        {/* ── 3D done viewer ── */}
        {is3DType && flow.done && !hasFailed && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => flow.itemId && onOpenFullscreen?.(flow.itemId)}
            disabled={!onOpenFullscreen || !flow.itemId}
            style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}
          >
            <Text style={{ fontSize: 60 }}>{flow.previewUri?.endsWith('.usdz') ? '🎭' : '🧊'}</Text>
            <Text style={{ color: '#ce93d8', fontSize: 14, fontWeight: '800' }}>
              {flow.previewUri?.endsWith('.usdz') ? '3D Model — USDZ' : '3D Model'}
            </Text>
            {!!onOpenFullscreen && <Text style={{ color: '#7eb8ff', fontSize: 11 }}>👆 Tap to view in 3D viewer</Text>}
            <Text style={{ color: '#4caf50', fontSize: 11, fontWeight: '700' }}>✅ Saved to AI Library</Text>
          </TouchableOpacity>
        )}

        {/* ── Factory cam + stage strip for image/video during processing ── */}
        {showFactoryCam && (
          <>
            <FactoryWebView camHeight={160} />
            <ProcessingStageBar running={!flow.done} />
          </>
        )}

        {/* ── Log (only on failure) ── */}
        {showLog && (
          <View style={[styles.logBox, { height: 110 }]}>
            <ScrollView
              ref={logScrollRef}
              onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: true })}
              showsVerticalScrollIndicator={false}
            >
              {flow.log.map((line, i) => (
                <Text key={i} style={styles.logLine}>{line}</Text>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Retry / Edit & Retry (on failure) ── */}
        {hasFailed && retryCount === 0 && (
          <TouchableOpacity onPress={handleRetry} style={[styles.btnPrimary, { marginTop: 8 }]}>
            <Text style={styles.btnPrimaryText}>🔄 Retry</Text>
          </TouchableOpacity>
        )}
        {hasFailed && retryCount > 0 && (
          <>
            <TouchableOpacity onPress={handleEditAndRetry} style={[styles.btnPrimary, { marginTop: 8, backgroundColor: 'rgba(126,184,255,0.85)' }]}>
              <Text style={styles.btnPrimaryText}>✏️ Edit Prompt / Settings & Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRetry} style={[styles.btnSecondary, { marginTop: 4 }]}>
              <Text style={styles.btnSecondaryText}>🔄 Try Again Anyway</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Abort button (only while running) ── */}
        {!flow.done && !!onAbort && (
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                'Abort Job?',
                'This will cancel the current job and refund your coins.',
                [
                  { text: 'Keep Waiting', style: 'cancel' },
                  { text: '🛑 Abort & Refund', style: 'destructive', onPress: () => { onAbort(); onClose(); } },
                ]
              );
            }}
            style={[styles.btnSecondary, { marginTop: 6, borderColor: 'rgba(255,80,80,0.4)' }]}
          >
            <Text style={[styles.btnSecondaryText, { color: '#ff6060' }]}>🛑 Abort Job</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={onClose} style={[styles.btnSecondary, { marginTop: hasFailed ? 6 : 4 }]}>
          <Text style={styles.btnSecondaryText}>
            {flow.done ? '← Back to Workshop' : '← Back (job continues in background)'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── JobMonitorSheet: shown when tapping a still-processing library item ────────
const JobMonitorSheet: React.FC<{
  item: AILibraryItem;
  onClose: () => void;
  onAbort?: (item: AILibraryItem) => void;
}> = ({ item, onClose, onAbort }) => {
  const is3D = item.type.startsWith('mesh3d');
  const [elapsed, setElapsed] = useState(Math.round((Date.now() - item.createdAt) / 1000));
  const def = ALL_SUBTYPES.find(s => s.id === item.type);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.round((Date.now() - item.createdAt) / 1000)), 2000);
    return () => clearInterval(id);
  }, [item.createdAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.sheetBox, { maxHeight: '92%', paddingBottom: 14, gap: 8 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <Text style={{ color: def?.accent ?? '#ce93d8', fontSize: 15, fontWeight: '800' }}>
            ⏳ {def?.title ?? item.type}
          </Text>
          <ActivityIndicator size="small" color={def?.accent ?? '#ce93d8'} />
        </View>
        <Text style={{ color: '#555', fontSize: 11, alignSelf: 'flex-start' }}>
          Running for {elapsedStr} · still processing in background
        </Text>
        {item.jobId && (
          <Text style={{ color: '#333', fontSize: 9, alignSelf: 'flex-start' }}>
            job: {item.jobId.slice(0, 16)}…
          </Text>
        )}
        {is3D && <FactoryWebView />}
        <View style={{ flexDirection: 'row', gap: 8, width: '100%', marginTop: 6 }}>
          <TouchableOpacity onPress={onClose} style={[styles.btnSecondary, { flex: 1 }]}>
            <Text style={styles.btnSecondaryText}>← Back</Text>
          </TouchableOpacity>
          {onAbort && (
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Abort Job', 'Stop this job and refund coins?', [
                  { text: 'Keep Running', style: 'cancel' },
                  { text: '🛑 Abort', style: 'destructive', onPress: () => { onAbort(item); onClose(); } },
                ]);
              }}
              style={[styles.btnSecondary, { flex: 1, borderColor: '#f44' }]}
            >
              <Text style={[styles.btnSecondaryText, { color: '#f44' }]}>🛑 Abort</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

// ─── CategoryFlow: handles all steps of one generation flow ───────────────────
// step: 'subtype' → 'source' → 'options' → 'processing'
// For text-only types: 'subtype' → 'options' (skip source)
// For processing: closeable (job continues in background)

type FlowStep = 'subtype' | 'source' | 'options' | 'processing';

interface FlowState {
  category: Category;
  step: FlowStep;
  subtype?: AIItemType;
  sourceUri?: string;
  sourceB64?: string;
  sourceDims?: { w: number; h: number };
  source2Uri?: string;
  source2B64?: string;
  waitingSlot2?: boolean;
  prompt: string;
  autoPrompting: boolean;
  cnModule: ControlNetModule;
  scPreset: SlowCinemaPreset;
  frameCount: number;
  // set when processing starts
  itemId?: string;
  log: string[];
  done: boolean;
  previewUri?: string;
  frameProgress?: { current: number; total: number; pct: number };
  removeBg?: boolean;
  useControlNet?: boolean;
  retryCount?: number;
  aiPower: number; // 0–1, default 0.5
  statusLabel?: string; // live server progress label for 3D jobs
  parentItemId?: string; // for img2img redo: append result to this existing item
  redoSources?: string[]; // all available source versions [original, ai1, ai2, ...]
  redoSourceIdx?: number; // currently selected source version index
  // video_transition_auto
  pingpong?: boolean;
  doSd?: boolean;
  // video_slowmotion_auto
  slomoPresets?: string;   // e.g. "DREAM" or "DREAM,AGING"
  slomoSlowness?: number;  // 0–1
  // video_v2v
  consistencyMode?: 'standard' | 'enhanced';
  v2vFrameSkip?: number;
}

interface RunParams {
  type: AIItemType;
  sourceUri?: string;   // video URI for video_v2v; image URI for transition_auto
  sourceB64: string;
  source2B64?: string;
  sourceDims?: { w: number; h: number };
  prompt: string;
  cnModule: ControlNetModule;
  scPreset: SlowCinemaPreset;
  frameCount: number;
  removeBg?: boolean;
  useControlNet?: boolean;
  aiPower: number;
  parentItemId?: string;
  pingpong?: boolean;
  doSd?: boolean;
  slomoPresets?: string;
  slomoSlowness?: number;
  consistencyMode?: 'standard' | 'enhanced';
  v2vFrameSkip?: number;
}

const CategoryFlow: React.FC<{
  flow: FlowState;
  setFlow: (fn: (prev: FlowState) => FlowState) => void;
  coinCount: number;
  onRun: (params: RunParams) => string; // returns itemId
  onClose: () => void;
  onOpenSettings?: () => void;
  onAbortJob?: () => void;
  onOpenFullscreen?: (itemId: string) => void;
  passportPortrait?: string | null;
}> = ({ flow, setFlow, coinCount, onRun, onClose, onOpenSettings, onAbortJob, onOpenFullscreen, passportPortrait }) => {
  const catDef = CATEGORY_DEFS.find(c => c.id === flow.category)!;
  const subtypeDef = flow.subtype ? ALL_SUBTYPES.find(s => s.id === flow.subtype) : null;

  const pickFromLibrary = async (slot: 1 | 2 = 1) => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.82,
        base64: true,
        exif: false,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      const b64 = asset.base64 ?? await uriToBase64(asset.uri);
      handleSourcePicked(asset.uri, b64, slot,
        asset.width && asset.height ? { w: asset.width, h: asset.height } : undefined
      );
    } catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not load image'); }
  };

  const pickFromCamera = async (slot: 1 | 2 = 1) => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera access needed', 'Please allow camera access in Settings.'); return; }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.82,
        base64: true,
        exif: false,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      const b64 = asset.base64 ?? await uriToBase64(asset.uri);
      handleSourcePicked(asset.uri, b64, slot,
        asset.width && asset.height ? { w: asset.width, h: asset.height } : undefined
      );
    } catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not use camera'); }
  };

  const pickVideoFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Photos access needed', 'Please allow Photos access in Settings.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      const sourceDims = asset.width && asset.height ? { w: asset.width, h: asset.height } : undefined;
      setFlow(prev => ({ ...prev, sourceUri: asset.uri, sourceB64: '', sourceDims, step: 'options' }));
    } catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not load video'); }
  };

  const handleSourcePicked = (uri: string, b64: string, slot: 1 | 2 = 1, dims?: { w: number; h: number }) => {
    if (slot === 2) {
      setFlow(prev => ({ ...prev, source2Uri: uri, source2B64: b64, waitingSlot2: false, step: 'options' }));
      return;
    }
    // Transition: slot 1 stays on source step so user can pick 2nd image
    if ((flow.subtype === 'video_transition' || flow.subtype === 'video_transition_auto') && !flow.sourceUri) {
      setFlow(prev => ({ ...prev, sourceUri: uri, sourceB64: b64, sourceDims: dims }));
      return;
    }
    // Slot 1 — set source + dims, go to options, auto-prompt in background
    setFlow(prev => ({
      ...prev,
      sourceUri: uri, sourceB64: b64, sourceDims: dims,
      step: 'options',
      autoPrompting: true,
      prompt: '',
    }));
    // CLIP auto-prompt — check persistent cache first (survives app restarts), then interrogate
    void (async () => {
      try {
        const persistent = await getCachedClipPrompt(uri);
        if (persistent) {
          setFlow(prev => ({ ...prev, prompt: persistent, autoPrompting: false }));
          return;
        }
        const caption = await interrogateImage(b64);
        setFlow(prev => ({ ...prev, prompt: caption || prev.prompt, autoPrompting: false }));
        if (caption) void setCachedClipPrompt(uri, caption);
      } catch {
        setFlow(prev => ({ ...prev, autoPrompting: false }));
      }
    })();
  };

  const getCost = () => {
    if (!flow.subtype) return 0;
    if (flow.subtype === 'video_animatediff') return calcVideoCost(flow.frameCount);
    if (flow.subtype === 'video_slowcinema')  return calcSlowCinemaCost(flow.frameCount);
    return (COSTS as any)[flow.subtype] ?? 0;
  };

  const handleGenerate = () => {
    if (!flow.subtype) return;
    const cost = getCost();
    if (cost > coinCount) {
      Alert.alert('Not enough coins', `Need ${cost} 🪙, you have ${coinCount}.`);
      return;
    }
    const effectiveType: AIItemType = (flow.subtype === 'image_standard' && flow.useControlNet)
      ? 'image_controlnet'
      : flow.subtype!;
    const itemId = onRun({
      type: effectiveType,
      sourceUri: flow.sourceUri,
      sourceB64: flow.sourceB64 ?? '',
      source2B64: flow.source2B64,
      sourceDims: flow.sourceDims,
      prompt: flow.prompt,
      cnModule: flow.cnModule,
      scPreset: flow.scPreset,
      frameCount: flow.frameCount,
      removeBg: flow.removeBg ?? false,
      useControlNet: flow.useControlNet,
      aiPower: flow.aiPower,
      parentItemId: flow.parentItemId,
      pingpong: flow.pingpong,
      doSd: flow.doSd,
      slomoPresets: flow.slomoPresets,
      slomoSlowness: flow.slomoSlowness,
      consistencyMode: flow.consistencyMode,
      v2vFrameSkip: flow.v2vFrameSkip,
    });
    setFlow(prev => ({ ...prev, step: 'processing', itemId, log: ['⏳ Job queued…'], done: false }));
  };

  // ── Subtype step ──────────────────────────────────────────────────────────
  if (flow.step === 'subtype') {
    return (
      <View style={styles.modalOverlay}>
        <View style={[styles.sheetBox, { paddingBottom: 20 }]}>
          <View style={styles.sheetHeader}>
            <AnimatedCategoryEmoji seq={catDef.emoji} size={28} />
            <Text style={[styles.sheetTitle, { color: catDef.accent, marginLeft: 8 }]}>{catDef.title}</Text>
          </View>
          <Text style={[styles.sheetDesc, { marginBottom: 14 }]}>Choose what to make:</Text>
          {catDef.subtypes.map(st => (
            <TouchableOpacity
              key={st.id}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (st.textOnly) {
                  setFlow(prev => ({ ...prev, subtype: st.id, step: 'options', sourceUri: '', sourceB64: '' }));
                } else {
                  setFlow(prev => ({ ...prev, subtype: st.id, step: 'source' }));
                }
              }}
              style={[styles.subtypeRow, { borderColor: st.accent + '44' }]}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.subtypeTitle, { color: st.accent }]}>{st.title}</Text>
                <Text style={styles.subtypeDesc}>{st.desc}</Text>
              </View>
              <Text style={[styles.subtypeCost, { color: st.accent }]}>{st.costLabel}</Text>
              <Text style={{ color: '#444', fontSize: 18, marginLeft: 6 }}>›</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={onClose} style={[styles.btnBack, { marginTop: 10 }]}>
            <Text style={styles.btnBackText}>← Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Source step ───────────────────────────────────────────────────────────
  if (flow.step === 'source') {
    const isTransition = subtypeDef?.isTransition;
    const isVideoPicker = subtypeDef?.isVideo;

    // V2V: show video picker UI
    if (isVideoPicker) {
      return (
        <View style={styles.modalOverlay}>
          <View style={styles.sheetBox}>
            <TouchableOpacity onPress={() => setFlow(prev => ({ ...prev, step: 'subtype' }))} style={styles.backRow}>
              <Text style={styles.backArrow}>‹</Text>
              <Text style={styles.backLabel}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>🎨 Pick a Video</Text>
            <Text style={styles.sheetDesc}>Choose a video from your library to restyle with AI.</Text>
            <TouchableOpacity
              onPress={() => void pickVideoFromLibrary()}
              style={[styles.btnPrimary, { marginTop: 14 }]}
            >
              <Text style={styles.btnPrimaryText}>🎬 Video Library</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFlow(prev => ({ ...prev, step: 'subtype' }))} style={styles.btnBack}>
              <Text style={styles.btnBackText}>← Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const title = isTransition
      ? (flow.sourceUri ? '🎬 Pick 2nd Image' : '🎬 Pick 1st Image')
      : `${subtypeDef?.title ?? 'Pick Image'}`;

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.sheetBox}>
          <TouchableOpacity onPress={() => setFlow(prev => ({ ...prev, step: 'subtype' }))} style={styles.backRow}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.sheetTitle}>{title}</Text>
          <Text style={styles.sheetDesc}>
            {isTransition && !flow.sourceUri ? 'Pick the starting image' : isTransition && flow.sourceUri ? 'Now pick the ending image' : 'Pick a source image from your device'}
          </Text>

          {/* slot 1 preview */}
          {!!flow.sourceUri && isTransition && (
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <Image source={{ uri: flow.sourceUri }} style={styles.previewSmall} resizeMode="cover" />
              <Text style={{ color: '#555', fontSize: 10, marginTop: 4 }}>Image 1 ✓</Text>
            </View>
          )}

          <>
            <TouchableOpacity
              onPress={() => void pickFromLibrary(isTransition && flow.sourceUri ? 2 : 1)}
              style={[styles.btnPrimary, { marginTop: 10 }]}
            >
              <Text style={styles.btnPrimaryText}>📷 Photo Library</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void pickFromCamera(isTransition && flow.sourceUri ? 2 : 1)}
              style={styles.btnSecondary}
            >
              <Text style={styles.btnSecondaryText}>📸 Use Camera</Text>
            </TouchableOpacity>
            {!!passportPortrait && (
              <TouchableOpacity
                onPress={async () => {
                  try {
                    const slot = (isTransition && flow.sourceUri ? 2 : 1) as 1 | 2;
                    const b64 = passportPortrait.replace(/^data:[^;]+;base64,/, '');
                    const tmpPath = `${FileSystem.cacheDirectory}passport_ai_src_${Date.now()}.jpg`;
                    await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: 'base64' as any });
                    handleSourcePicked(tmpPath, b64, slot);
                  } catch (e: any) { Alert.alert('Error', e?.message ?? 'Could not load profile image'); }
                }}
                style={[styles.btnSecondary, { borderColor: '#ce93d8', marginTop: 0 }]}
              >
                <Text style={[styles.btnSecondaryText, { color: '#ce93d8' }]}>👤 Use Profile Image</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setFlow(prev => ({ ...prev, step: 'subtype' }))} style={styles.btnBack}>
              <Text style={styles.btnBackText}>← Back</Text>
            </TouchableOpacity>
          </>
        </View>
      </View>
    );
  }

  // ── Options step ──────────────────────────────────────────────────────────
  if (flow.step === 'options') {
    const isTextOnly   = subtypeDef?.textOnly;
    const isTransition = subtypeDef?.isTransition;
    const cost         = getCost();

    return (
      <View style={styles.modalOverlay}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, alignItems: 'center' }}
          style={{ width: '100%' }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.sheetBox, { width: Math.min(SW - 40, IS_IPAD ? 480 : 390) }]}>
            <TouchableOpacity
              onPress={() => setFlow(prev => ({ ...prev, step: isTextOnly ? 'subtype' : 'source' }))}
              style={styles.backRow}
            >
              <Text style={styles.backArrow}>‹</Text>
              <Text style={styles.backLabel}>Back</Text>
            </TouchableOpacity>

            {/* Source preview — letterboxed (full image, not cropped) */}
            {!!flow.sourceUri && !isTextOnly && (
              <View style={{ width: '100%', alignItems: 'center', marginBottom: 12 }}>
                {/* Redo source version arrows — shown when there are existing AI results */}
                {!!(flow.parentItemId) && !!(flow.redoSources) && flow.redoSources.length > 1 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <TouchableOpacity
                      disabled={flow.redoSourceIdx <= 0}
                      onPress={() => {
                        const idx = Math.max(0, (flow.redoSourceIdx ?? 0) - 1);
                        const uri = flow.redoSources![idx];
                        setFlow(prev => ({ ...prev, redoSourceIdx: idx, sourceUri: uri, sourceB64: '' }));
                        void uriToBase64WithInfo(uri).then(({ b64, w, h }) =>
                          setFlow(prev => prev ? { ...prev, sourceB64: b64, sourceDims: { w, h } } : prev)
                        );
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={{ fontSize: 20, opacity: (flow.redoSourceIdx ?? 0) <= 0 ? 0.25 : 1 }}>◀</Text>
                    </TouchableOpacity>
                    <Text style={{ color: '#888', fontSize: 11 }}>
                      {(flow.redoSourceIdx ?? 0) === 0 ? '📷 Original' : `🎨 AI v${flow.redoSourceIdx}`}
                      {' '}({(flow.redoSourceIdx ?? 0) + 1}/{flow.redoSources.length})
                    </Text>
                    <TouchableOpacity
                      disabled={(flow.redoSourceIdx ?? 0) >= flow.redoSources.length - 1}
                      onPress={() => {
                        const idx = Math.min(flow.redoSources!.length - 1, (flow.redoSourceIdx ?? 0) + 1);
                        const uri = flow.redoSources![idx];
                        setFlow(prev => ({ ...prev, redoSourceIdx: idx, sourceUri: uri, sourceB64: '' }));
                        void uriToBase64WithInfo(uri).then(({ b64, w, h }) =>
                          setFlow(prev => prev ? { ...prev, sourceB64: b64, sourceDims: { w, h } } : prev)
                        );
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={{ fontSize: 20, opacity: (flow.redoSourceIdx ?? 0) >= (flow.redoSources?.length ?? 1) - 1 ? 0.25 : 1 }}>▶</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={[styles.previewLarge, { backgroundColor: '#111', overflow: 'hidden' }]}>
                  <Image source={{ uri: flow.sourceUri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
                </View>
                {isTransition && !!flow.source2Uri && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    <View style={[styles.previewMini, { backgroundColor: '#111', overflow: 'hidden' }]}>
                      <Image source={{ uri: flow.sourceUri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
                    </View>
                    <Text style={{ color: '#555', fontSize: 18, alignSelf: 'center' }}>→</Text>
                    <View style={[styles.previewMini, { backgroundColor: '#111', overflow: 'hidden' }]}>
                      <Image source={{ uri: flow.source2Uri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
                    </View>
                  </View>
                )}
              </View>
            )}

            <Text style={[styles.sheetTitle, { marginBottom: 4 }]}>{subtypeDef?.title}</Text>

            {/* Transition guard — user must pick a 2nd image before generating */}
            {isTransition && !flow.source2Uri && (
              <View style={{ backgroundColor: 'rgba(129,199,132,0.1)', borderRadius: 10, borderWidth: 1, borderColor: '#81c784', padding: 12, marginBottom: 10, width: '100%', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#81c784', fontSize: 13, fontWeight: '700' }}>🔄 Transition needs 2 images</Text>
                <Text style={{ color: '#888', fontSize: 11, textAlign: 'center' }}>You've picked the 1st image. Pick an ending image to morph into.</Text>
                <TouchableOpacity
                  onPress={() => setFlow(prev => ({ ...prev, step: 'source' }))}
                  style={{ backgroundColor: '#81c784', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, marginTop: 2 }}
                >
                  <Text style={{ color: '#0a0a0f', fontWeight: '700', fontSize: 13 }}>📷 Pick 2nd Image</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Prompt input */}
            {(flow.subtype !== 'video_transition') && (
              <View style={{ width: '100%', marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>
                      {flow.subtype === 'video_slowcinema' ? '✨ Style Hint (optional)' : 'Prompt'}
                    </Text>
                    {flow.autoPrompting && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <ActivityIndicator size="small" color="#7eb8ff" />
                        <Text style={{ color: '#7eb8ff', fontSize: 10 }}>CLIP…</Text>
                      </View>
                    )}
                  </View>
                  {/* CLIP auto-prompt button for slow cinema */}
                  {flow.subtype === 'video_slowcinema' && !!flow.sourceUri && !!flow.sourceB64 && !flow.autoPrompting && (
                    <TouchableOpacity
                      onPress={() => {
                        setFlow(prev => ({ ...prev, autoPrompting: true }));
                        void (async () => {
                          try {
                            const persistent = await getCachedClipPrompt(flow.sourceUri!);
                            if (persistent) {
                              setFlow(prev => ({ ...prev, prompt: persistent, autoPrompting: false }));
                              return;
                            }
                            const caption = await interrogateImage(flow.sourceB64!);
                            setFlow(prev => ({ ...prev, prompt: caption || prev.prompt, autoPrompting: false }));
                            if (caption && flow.sourceUri) void setCachedClipPrompt(flow.sourceUri, caption);
                          } catch {
                            setFlow(prev => ({ ...prev, autoPrompting: false }));
                          }
                        })();
                      }}
                      style={{ borderRadius: 8, backgroundColor: 'rgba(79,195,247,0.1)', borderWidth: 1, borderColor: '#4fc3f7', paddingHorizontal: 8, paddingVertical: 3 }}
                    >
                      <Text style={{ color: '#4fc3f7', fontSize: 10, fontWeight: '700' }}>🔍 Auto CLIP</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={styles.textInput}
                  value={flow.prompt}
                  onChangeText={s => setFlow(prev => ({ ...prev, prompt: s }))}
                  placeholder={
                    flow.subtype === 'video_slowcinema' ? 'Optional style hint (tap Auto CLIP to detect)…'
                    : isTextOnly ? 'Describe what you want to generate…'
                    : 'Leave blank to use auto-prompt'
                  }
                  placeholderTextColor="#444"
                  multiline
                  numberOfLines={2}
                />
              </View>
            )}

            {/* AI Power slider — shown for all AI-powered types */}
            {(flow.subtype === 'image_standard' || flow.subtype === 'image_controlnet' || flow.subtype === 'image_txt2img' || flow.subtype?.startsWith('video')) && (
              <View style={{ width: '100%', marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ color: '#888', fontSize: 11 }}>⚡ AI Power</Text>
                  <Text style={{ color: '#ff9f6b', fontSize: 11, fontWeight: '700' }}>
                    {flow.aiPower < 0.25 ? 'Subtle' : flow.aiPower < 0.55 ? 'Balanced' : flow.aiPower < 0.8 ? 'Creative' : 'Max Wild'}
                    {flow.subtype?.startsWith('image') || flow.subtype === 'video_animatediff'
                      ? ` · denoise ${(0.3 + flow.aiPower * 0.5).toFixed(2)} · cfg ${(5 + flow.aiPower * 7).toFixed(0)}`
                      : ` · strength ${Math.round(flow.aiPower * 100)}%`}
                  </Text>
                </View>
                <Slider
                  style={{ width: '100%', height: 36 }}
                  minimumValue={0} maximumValue={1} step={0.05}
                  value={flow.aiPower}
                  onValueChange={v => setFlow(prev => ({ ...prev, aiPower: v }))}
                  minimumTrackTintColor="#ff9f6b"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#ff9f6b"
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#444', fontSize: 10 }}>Subtle</Text>
                  <Text style={{ color: '#444', fontSize: 10 }}>Max Wild</Text>
                </View>
              </View>
            )}

            {/* ── Advanced options for image_standard / legacy image_controlnet ── */}
            {(flow.subtype === 'image_standard' || flow.subtype === 'image_controlnet') && (
              <View style={{ width: '100%', gap: 8, marginBottom: 8 }}>
                {/* ControlNet toggle — turning ON always resets module to lineart */}
                <TouchableOpacity
                  onPress={() => setFlow(prev => ({
                    ...prev,
                    useControlNet: !prev.useControlNet,
                    cnModule: !prev.useControlNet ? 'lineart' : prev.cnModule,
                  }))}
                  style={[styles.optionPill, flow.useControlNet && { borderColor: '#b97eff', backgroundColor: 'rgba(185,126,255,0.15)' }]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.optionPillText, flow.useControlNet && { color: '#d4a0ff' }]}>
                    {flow.useControlNet ? '✓ ControlNet ON — structure guided' : '🔬 ControlNet — structure guide (optional)'}
                  </Text>
                </TouchableOpacity>
                {/* ControlNet module picker — only when enabled */}
                {flow.useControlNet && (
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', paddingLeft: 4 }}>
                    {([
                      { id: 'lineart', label: '✏️ Line Art' },
                      { id: 'depth',   label: '🌊 Depth' },
                      { id: 'tile',    label: '🔲 Tile' },
                    ] as const).map(m => {
                      const sel = (flow.cnModule ?? 'lineart') === m.id;
                      return (
                        <TouchableOpacity key={m.id}
                          onPress={() => setFlow(prev => ({ ...prev, cnModule: m.id }))}
                          style={[styles.frameBtn, sel && { borderColor: '#b97eff', backgroundColor: 'rgba(185,126,255,0.22)' }]}
                        >
                          <Text style={{ color: sel ? '#d4a0ff' : '#777', fontSize: 12, fontWeight: sel ? '800' : '400' }}>
                            {sel ? '✓ ' : ''}{m.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {/* Remove BG / Cutout toggle */}
                <TouchableOpacity
                  onPress={() => setFlow(prev => ({ ...prev, removeBg: !prev.removeBg }))}
                  style={[styles.optionPill, flow.removeBg && { borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.1)' }]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.optionPillText, flow.removeBg && { color: '#4fc3f7' }]}>
                    {flow.removeBg ? '✓ Cutout subject — background removed' : '✂️ Cutout subject (optional — removes BG)'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* AnimateDiff frame count */}
            {flow.subtype === 'video_animatediff' && (
              <View style={{ width: '100%', marginBottom: 8 }}>
                <Text style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>
                  Frames: {flow.frameCount} → {calcVideoCost(flow.frameCount)} 🪙
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[8, 16, 24, 32, 48, 60, 90].map(f => (
                    <TouchableOpacity key={f} onPress={() => setFlow(prev => ({ ...prev, frameCount: f }))}
                      style={[styles.frameBtn, flow.frameCount === f && styles.frameBtnActive]}>
                      <Text style={{ color: flow.frameCount === f ? '#ff9f6b' : '#666', fontSize: 12 }}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* 3D options — background removal + optional prompt for all 3D types */}
            {flow.subtype?.startsWith('mesh3d') && (
              <View style={{ width: '100%', marginBottom: 12, gap: 8 }}>
                {/* Optional style/subject prompt for SF3D and Hunyuan */}
                {(flow.subtype === 'mesh3d_sf3d' || flow.subtype === 'mesh3d_hunyuan' || flow.subtype === 'mesh3d_trellis2') && (
                  <View>
                    <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>✨ Subject / Style Hint (optional)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={flow.prompt}
                      onChangeText={s => setFlow(prev => ({ ...prev, prompt: s }))}
                      placeholder="e.g. cartoon character, shiny metal surface…"
                      placeholderTextColor="#444"
                      multiline
                      numberOfLines={2}
                    />
                  </View>
                )}
                {/* Background removal (not for Hunyuan — it handles its own BG) */}
                {flow.subtype !== 'mesh3d_hunyuan' && (
                  <View>
                    <Text style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>Background Removal</Text>
                    <TouchableOpacity
                      onPress={() => setFlow(prev => ({ ...prev, removeBg: !prev.removeBg }))}
                      style={[styles.optionPill, flow.removeBg && { borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.1)' }]}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.optionPillText, flow.removeBg && { color: '#4fc3f7' }]}>
                        {flow.removeBg ? '✅ Remove background (black bg sent to 3D)' : '⬜ Keep background (default)'}
                      </Text>
                    </TouchableOpacity>
                    {flow.removeBg && (
                      <Text style={{ color: '#4fc3f7', fontSize: 10, marginTop: 4 }}>
                        Background will be cut using A1111 rembg, then black fill sent to 3D API
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Slow Cinema — frame slider + preset picker */}
            {flow.subtype === 'video_slowcinema' && (
              <View style={{ width: '100%', marginBottom: 8, gap: 10 }}>
                {/* Frame count slider */}
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>🎞 Frames</Text>
                    <Text style={{ color: '#4fc3f7', fontSize: 11, fontWeight: '700' }}>
                      {flow.frameCount} frames · {calcSlowCinemaCost(flow.frameCount)} 🪙
                    </Text>
                  </View>
                  <Slider
                    style={{ width: '100%', height: 36 }}
                    minimumValue={2} maximumValue={100} step={2}
                    value={flow.frameCount}
                    onValueChange={v => setFlow(prev => ({ ...prev, frameCount: Math.round(v / 2) * 2 }))}
                    minimumTrackTintColor="#4fc3f7"
                    maximumTrackTintColor="#333"
                    thumbTintColor="#4fc3f7"
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: '#444', fontSize: 10 }}>2 (1 🪙)</Text>
                    <Text style={{ color: '#444', fontSize: 10 }}>10 (1 🪙)</Text>
                    <Text style={{ color: '#444', fontSize: 10 }}>100 (50 🪙)</Text>
                  </View>
                </View>
                {/* Visual Style preset picker */}
                <View>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>Visual Style</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {SLOW_CINEMA_PRESETS.map(p => (
                      <TouchableOpacity key={p} onPress={() => setFlow(prev => ({ ...prev, scPreset: p }))}
                        style={[styles.presetBtn, flow.scPreset === p && { borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.12)' }]}>
                        <Text style={[styles.presetBtnText, flow.scPreset === p && { color: '#4fc3f7' }]}>{p}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* ── RIFE Morph (video_transition_auto) options ── */}
            {flow.subtype === 'video_transition_auto' && (
              <View style={{ width: '100%', marginBottom: 8, gap: 10 }}>
                {/* Frame count */}
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>🎞 Morph frames</Text>
                    <Text style={{ color: '#81c784', fontSize: 11, fontWeight: '700' }}>{flow.frameCount} frames</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[10, 20, 30, 48, 60, 90].map(f => (
                      <TouchableOpacity key={f} onPress={() => setFlow(prev => ({ ...prev, frameCount: f }))}
                        style={[styles.frameBtn, flow.frameCount === f && { borderColor: '#81c784', backgroundColor: 'rgba(129,199,132,0.12)' }]}>
                        <Text style={{ color: flow.frameCount === f ? '#81c784' : '#666', fontSize: 12 }}>{f}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                {/* AI style pass toggle */}
                <TouchableOpacity
                  onPress={() => setFlow(prev => ({ ...prev, doSd: !(prev.doSd !== false) }))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: '#333' }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: flow.doSd !== false ? '#81c784' : '#555', backgroundColor: flow.doSd !== false ? '#81c784' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {flow.doSd !== false && <Text style={{ color: '#000', fontSize: 10, fontWeight: '900' }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '600' }}>AI Style Pass</Text>
                    <Text style={{ color: '#555', fontSize: 10 }}>SD reimagines in-between frames (slower, more stylized)</Text>
                  </View>
                </TouchableOpacity>
                {/* Pingpong toggle */}
                <TouchableOpacity
                  onPress={() => setFlow(prev => ({ ...prev, pingpong: !prev.pingpong }))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: '#333' }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: flow.pingpong ? '#81c784' : '#555', backgroundColor: flow.pingpong ? '#81c784' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {flow.pingpong && <Text style={{ color: '#000', fontSize: 10, fontWeight: '900' }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#ccc', fontSize: 12, fontWeight: '600' }}>Pingpong Loop (A→B→A)</Text>
                    <Text style={{ color: '#555', fontSize: 10 }}>Creates a seamless looping morph</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Dream Flow (video_slowmotion_auto) options ── */}
            {flow.subtype === 'video_slowmotion_auto' && (
              <View style={{ width: '100%', marginBottom: 8, gap: 10 }}>
                {/* Max frames */}
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>🎞 Max frames</Text>
                    <Text style={{ color: '#4fc3f7', fontSize: 11, fontWeight: '700' }}>{flow.frameCount} frames</Text>
                  </View>
                  <Slider
                    style={{ width: '100%', height: 36 }}
                    minimumValue={20} maximumValue={300} step={10}
                    value={flow.frameCount}
                    onValueChange={v => setFlow(prev => ({ ...prev, frameCount: Math.round(v / 10) * 10 }))}
                    minimumTrackTintColor="#4fc3f7"
                    maximumTrackTintColor="#333"
                    thumbTintColor="#4fc3f7"
                  />
                </View>
                {/* Slowness */}
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>🐢 Drift Speed</Text>
                    <Text style={{ color: '#4fc3f7', fontSize: 11, fontWeight: '700' }}>
                      {(flow.slomoSlowness ?? 0.5) <= 0.25 ? 'Fast morph' : (flow.slomoSlowness ?? 0.5) >= 0.75 ? 'Slow drift' : 'Balanced'}
                    </Text>
                  </View>
                  <Slider
                    style={{ width: '100%', height: 36 }}
                    minimumValue={0} maximumValue={1} step={0.05}
                    value={flow.slomoSlowness ?? 0.5}
                    onValueChange={v => setFlow(prev => ({ ...prev, slomoSlowness: parseFloat(v.toFixed(2)) }))}
                    minimumTrackTintColor="#4fc3f7"
                    maximumTrackTintColor="#333"
                    thumbTintColor="#4fc3f7"
                  />
                </View>
                {/* Style presets — multi-select CSV */}
                <View>
                  <Text style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>Visual Style</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {SLOW_CINEMA_PRESETS.map(p => {
                      const selected = (flow.slomoPresets ?? 'DREAM').split(',').map(s => s.trim()).includes(p);
                      return (
                        <TouchableOpacity key={p}
                          onPress={() => {
                            const parts = (flow.slomoPresets ?? 'DREAM').split(',').map(s => s.trim()).filter(Boolean);
                            const next = selected ? parts.filter(x => x !== p) : [...parts, p];
                            setFlow(prev => ({ ...prev, slomoPresets: (next.length ? next : ['DREAM']).join(',') }));
                          }}
                          style={[styles.presetBtn, selected && { borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.12)' }]}>
                          <Text style={[styles.presetBtnText, selected && { color: '#4fc3f7' }]}>{p}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
            )}

            {/* ── Restyle Video (video_v2v) options ── */}
            {flow.subtype === 'video_v2v' && (
              <View style={{ width: '100%', marginBottom: 8, gap: 10 }}>
                {/* Video preview row */}
                {!!flow.sourceUri && (
                  <View style={{ alignItems: 'center', marginBottom: 4 }}>
                    <View style={{ backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10, alignItems: 'center', width: '100%' }}>
                      <Text style={{ color: '#4fc3f7', fontSize: 12, fontWeight: '700' }}>🎬 Video selected ✓</Text>
                      <Text style={{ color: '#555', fontSize: 10, marginTop: 2 }}>{flow.sourceUri.split('/').pop()}</Text>
                    </View>
                  </View>
                )}
                {/* Consistency mode */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['standard', 'enhanced'] as const).map(mode => (
                    <TouchableOpacity key={mode}
                      onPress={() => setFlow(prev => ({ ...prev, consistencyMode: mode }))}
                      style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1.5,
                        borderColor: (flow.consistencyMode ?? 'standard') === mode ? '#ce93d8' : '#333',
                        backgroundColor: (flow.consistencyMode ?? 'standard') === mode ? 'rgba(206,147,216,0.1)' : 'transparent' }}>
                      <Text style={{ color: (flow.consistencyMode ?? 'standard') === mode ? '#ce93d8' : '#666', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
                        {mode === 'standard' ? '⚡ Standard' : '🔒 Enhanced'}
                      </Text>
                      <Text style={{ color: '#444', fontSize: 9, textAlign: 'center', marginTop: 2 }}>
                        {mode === 'standard' ? 'Fast, good quality' : 'Depth + IP-Adapter, slow'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Frame skip */}
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>Frame Skip</Text>
                    <Text style={{ color: '#ce93d8', fontSize: 11, fontWeight: '700' }}>
                      every {flow.v2vFrameSkip ?? 1} frame{(flow.v2vFrameSkip ?? 1) > 1 ? 's' : ''} · {flow.v2vFrameSkip === 1 ? 'all frames' : `${100 / (flow.v2vFrameSkip ?? 1)}% of frames`}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {[1, 2, 3, 4].map(n => (
                      <TouchableOpacity key={n}
                        onPress={() => setFlow(prev => ({ ...prev, v2vFrameSkip: n }))}
                        style={[styles.frameBtn, (flow.v2vFrameSkip ?? 1) === n && { borderColor: '#ce93d8', backgroundColor: 'rgba(206,147,216,0.12)' }]}>
                        <Text style={{ color: (flow.v2vFrameSkip ?? 1) === n ? '#ce93d8' : '#666', fontSize: 12 }}>
                          {n === 1 ? 'All' : `/${n}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* Cost + generate */}
            <View style={styles.costRow}>
              <Text style={styles.costLabel}>Cost: {cost} 🪙</Text>
              <Text style={styles.costLabel}>  ·  You have: {coinCount} 🪙</Text>
            </View>

            {isTextOnly && !flow.prompt.trim()
              ? <Text style={{ color: '#666', fontSize: 11, textAlign: 'center', marginBottom: 8 }}>Enter a prompt to continue</Text>
              : null}

            {/* b64 still loading after redo — show spinner instead of silently failing */}
            {!isTextOnly && !!flow.sourceUri && !flow.sourceB64 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, justifyContent: 'center' }}>
                <ActivityIndicator size="small" color="#ce93d8" />
                <Text style={{ color: '#666', fontSize: 11 }}>Preparing image…</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleGenerate}
              disabled={
                cost > coinCount ||
                (isTextOnly && !flow.prompt.trim()) ||
                (flow.subtype === 'video_v2v' && !flow.sourceUri) ||
                (!isTextOnly && flow.subtype !== 'video_v2v' && !!flow.sourceUri && !flow.sourceB64) ||
                (isTransition && !flow.source2Uri)
              }
              style={[styles.btnPrimary, (
                cost > coinCount ||
                (isTextOnly && !flow.prompt.trim()) ||
                (flow.subtype === 'video_v2v' && !flow.sourceUri) ||
                (!isTextOnly && flow.subtype !== 'video_v2v' && !!flow.sourceUri && !flow.sourceB64) ||
                (isTransition && !flow.source2Uri)
              ) && { opacity: 0.4 }]}
            >
              <Text style={styles.btnPrimaryText}>⚡ Generate — {cost} 🪙</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFlow(prev => ({ ...prev, step: isTextOnly ? 'subtype' : 'source' }))} style={styles.btnBack}>
              <Text style={styles.btnBackText}>← Back</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Processing step ───────────────────────────────────────────────────────
  if (flow.step === 'processing') {
    return (
      <ProcessingView
        flow={flow}
        setFlow={setFlow}
        catDef={catDef}
        subtypeDef={subtypeDef}
        coinCount={coinCount}
        onRun={onRun}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
        onAbort={onAbortJob}
        onOpenFullscreen={onOpenFullscreen}
      />
    );
  }

  return null;
};

// ─── Live mini 3D viewer for library card thumbnail ───────────────────────────
// Writes viewer HTML to a cache file (avoids native-bridge 15 MB limit for large
// GLBs), then loads via file:// URI.  Falls back to ThumbSpinner while loading.
const Mini3DViewer: React.FC<{ glbUri: string; style: any; fallbackUri?: string }> = ({ glbUri, style, fallbackUri }) => {
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [failed,  setFailed]  = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Derive a stable cache filename from the glbUri
        const key = glbUri.replace(/[^a-z0-9]/gi, '_').slice(-48);
        const htmlPath = `${FileSystem.cacheDirectory}mini3d_${key}.html`;

        // Re-use cached HTML if still valid
        const cached = await FileSystem.getInfoAsync(htmlPath);
        if (cached.exists) {
          if (active) setHtmlUri(htmlPath);
          return;
        }

        // Read GLB → generate HTML → write to cache
        const b64  = await FileSystem.readAsStringAsync(glbUri, { encoding: 'base64' as any });
        const html = makeMiniViewerHtml(b64);
        await FileSystem.writeAsStringAsync(htmlPath, html, { encoding: FileSystem.EncodingType.UTF8 as any });
        if (active) setHtmlUri(htmlPath);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [glbUri]);

  if (!htmlUri) {
    if (fallbackUri) return <ThumbSpinner uri={fallbackUri} style={style} />;
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
        {failed
          ? <Text style={{ fontSize: 30 }}>🧊</Text>
          : <ActivityIndicator color="#ce93d8" size="small" />}
      </View>
    );
  }

  return (
    <View style={style} pointerEvents="none">
      <WebView
        source={{ uri: htmlUri }}
        style={{ width: style.width, height: style.height }}
        scrollEnabled={false}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        originWhitelist={['*', 'file://*']}
        mixedContentMode="always"
        javaScriptEnabled
      />
    </View>
  );
};

// ─── 3D thumbnail spinner (Z-axis slow rotation on 2D snapshot) ──────────────
const ThumbSpinner: React.FC<{ uri: string; style: any }> = ({ uri, style }) => {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
      <Animated.Image
        source={{ uri }}
        style={{ width: style.width * 0.85, height: style.height * 0.85, transform: [{ rotate }] }}
        resizeMode="contain"
      />
    </View>
  );
};

// ─── Library grid card ────────────────────────────────────────────────────────
const CARD_COLS   = IS_IPAD ? 3 : 2;
const CARD_GAP    = 8;
const CARD_W      = Math.floor((SW - 24 - CARD_GAP * (CARD_COLS - 1)) / CARD_COLS);
const CARD_THUMB_H = Math.round(CARD_W * 0.82);  // ~4:3.3 ratio

const StatusDot: React.FC<{ s: AILibraryItem['status'] }> = ({ s }) => {
  const c = { queued: '#666', processing: '#ff9f6b', done: '#4caf50', failed: '#f44' }[s];
  return <View style={[styles.statusDot, { backgroundColor: c }]} />;
};

const LibraryCard: React.FC<{
  item: AILibraryItem; onView: () => void; onDelete: () => void; onShare: () => void;
  onAbortItem?: (item: AILibraryItem) => void;
}> = ({ item, onView, onDelete, onShare, onAbortItem }) => {
  const def = ALL_SUBTYPES.find(o => o.id === item.type);
  const seq = getEmojiSeq(item.type);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % seq.length), 220);
    return () => clearInterval(id);
  }, [seq]);

  const [fileSize, setFileSize] = useState<string>('');
  useEffect(() => {
    if (!item.resultUri || item.status !== 'done') return;
    FileSystem.getInfoAsync(item.resultUri).then(info => {
      if (info.exists && (info as any).size) {
        const bytes = (info as any).size;
        setFileSize(bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`);
      }
    }).catch(() => {});
  }, [item.resultUri, item.status]);

  const thumbFill = { width: CARD_W, height: CARD_THUMB_H };

  const thumbContent = () => {
    if (item.type.startsWith('image')) {
      const uri = item.resultUri ?? item.sourceUri;
      return uri
        ? <Image source={{ uri }} style={[thumbFill, { borderRadius: 0 }]} resizeMode="cover" />
        : <ActivityIndicator color="#ff9f6b" />;
    }
    if (item.type.startsWith('video') && item.resultUri) {
      return item.resultUri.endsWith('.gif')
        ? <WebView source={{ uri: item.resultUri }} style={thumbFill} scrollEnabled={false} />
        : <Video source={{ uri: item.resultUri }} style={thumbFill} resizeMode={ResizeMode.COVER} shouldPlay isLooping isMuted useNativeControls={false} />;
    }
    if (item.type.startsWith('mesh3d')) {
      if (item.thumbnailUri) {
        return <Image source={{ uri: item.thumbnailUri }} style={[thumbFill, { borderRadius: 0 }]} resizeMode="cover" />;
      }
    }
    // No media yet — animated emoji placeholder
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', gap: 4, flex: 1 }}>
        <Text style={{ fontSize: 36 }}>{seq[frame]}</Text>
        {item.type.startsWith('mesh3d') && item.resultUri && (
          <Text style={{ color: '#555', fontSize: 9, fontWeight: '700' }}>3D MODEL</Text>
        )}
      </View>
    );
  };

  const accentColor = def?.accent ?? '#ff9f6b';

  return (
    <TouchableOpacity
      onPress={onView}
      onLongPress={onDelete}
      activeOpacity={0.82}
      style={[styles.libCard, { width: CARD_W }]}
    >
      {/* Media thumbnail */}
      <View style={[styles.libThumb, {
        width: CARD_W, height: CARD_THUMB_H,
        borderRadius: 0, borderTopLeftRadius: 12, borderTopRightRadius: 12,
        borderWidth: 0, backgroundColor: '#0e0e12',
      }]}>
        {thumbContent()}

        {/* Status badge — top-left */}
        {item.status !== 'done' && (
          <View style={{
            position: 'absolute', top: 6, left: 6,
            backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 6,
            paddingHorizontal: 5, paddingVertical: 2,
            flexDirection: 'row', alignItems: 'center', gap: 4,
          }}>
            <StatusDot s={item.status} />
            <Text style={{ color: '#ccc', fontSize: 8, fontWeight: '700', letterSpacing: 0.4 }}>
              {item.status === 'processing' ? 'LIVE' : item.status.toUpperCase()}
            </Text>
          </View>
        )}

        {/* Abort button — top-right, only on processing */}
        {item.status === 'processing' && onAbortItem && (
          <TouchableOpacity
            onPress={e => {
              e.stopPropagation?.();
              Alert.alert('Abort job?', `Cancel and refund ${item.coinCost} 🪙?`, [
                { text: 'Keep waiting', style: 'cancel' },
                { text: '🛑 Abort', style: 'destructive', onPress: () => onAbortItem(item) },
              ]);
            }}
            style={{
              position: 'absolute', top: 6, right: 6,
              backgroundColor: 'rgba(255,60,60,0.82)', borderRadius: 8,
              padding: 4,
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontSize: 12 }}>🛑</Text>
          </TouchableOpacity>
        )}

        {/* Multi-result badge — bottom-right */}
        {(item.resultUris?.length ?? 0) > 1 && (
          <View style={{
            position: 'absolute', bottom: 5, right: 5,
            backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 7,
            paddingHorizontal: 5, paddingVertical: 2,
          }}>
            <Text style={{ color: '#ce93d8', fontSize: 10, fontWeight: '800' }}>
              ×{item.resultUris!.length}
            </Text>
          </View>
        )}
      </View>

      {/* Text section */}
      <View style={{ paddingHorizontal: 7, paddingVertical: 6, gap: 3 }}>
        <Text style={[styles.libLabel, { fontSize: 11 }]} numberOfLines={1}>
          {item.label ?? def?.title ?? item.type}{item.preset ? ` · ${item.preset}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.libMeta}>
              {item.coinCost}🪙 · {new Date(item.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </Text>
            {!!fileSize && <Text style={[styles.libMeta, { opacity: 0.55, marginTop: 1 }]}>{fileSize}</Text>}
          </View>
          <View style={{ alignItems: 'center', gap: 5, marginLeft: 4 }}>
            {item.resultUri && item.status === 'done' && (
              <TouchableOpacity
                onPress={e => { e.stopPropagation?.(); onShare(); }}
                hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}
              >
                <Text style={{ fontSize: 13 }}>📤</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={e => {
                e.stopPropagation?.();
                Alert.alert('Delete', 'Remove this item from your library?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: onDelete },
                ]);
              }}
              hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}
            >
              <Text style={{ fontSize: 12 }}>🗑️</Text>
            </TouchableOpacity>
          </View>
        </View>
        {item.status === 'processing' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <ActivityIndicator size="small" color="#ff9f6b" style={{ transform: [{ scale: 0.75 }] }} />
            <Text style={{ color: '#ff9f6b', fontSize: 9 }}>Generating…</Text>
          </View>
        )}
        {item.status === 'failed' && (
          <Text style={[styles.libError, { fontSize: 9 }]} numberOfLines={1}>
            {item.downloadUrl ? '⚠️ Download failed — tap to retry' : (item.errorMsg ?? 'Failed')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

// ─── Full-screen viewer ───────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const FullscreenViewer: React.FC<{
  item: AILibraryItem;
  onClose: () => void;
  onDelete: () => void;
  onRedo: () => void;
  onUseAsProfileImage?: (uri: string) => void;
}> = ({ item, onClose, onDelete, onRedo, onUseAsProfileImage }) => {
  const insets  = useSafeAreaInsets();
  const isUsdz  = item.resultUri?.endsWith('.usdz');
  const scrollRef = useRef(null);
  const lastTapRef = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  // ── Unified navigation: Original(0) → AI result 1 → AI result 2 … ──────────
  const aiResults = item.resultUris && item.resultUris.length > 1
    ? item.resultUris
    : (item.resultUri ? [item.resultUri] : []);
  const hasSource = !!(item.sourceUri) && (item.type.startsWith('image') || item.type.startsWith('video'));
  const navItems: string[] = hasSource ? [item.sourceUri!, ...aiResults] : aiResults;
  const [navIdx, setNavIdx] = useState(hasSource && navItems.length > 1 ? 1 : 0);
  const isShowingOriginal = hasSource && navIdx === 0;
  const displayUri = navItems[navIdx] ?? item.resultUri ?? '';
  const aiResultIdx = isShowingOriginal ? -1 : navIdx - (hasSource ? 1 : 0);

  // Transition animation: slow 1s fade-in when going back to original; instant for AI results
  const transAnim = useRef(new Animated.Value(1)).current;

  const navigateTo = (idx: number) => {
    if (idx < 0 || idx >= navItems.length) return;
    if (hasSource && idx === 0) {
      transAnim.setValue(0);
      setNavIdx(idx);
      Animated.timing(transAnim, { toValue: 1, duration: 1000, useNativeDriver: true }).start();
    } else {
      transAnim.setValue(1);
      setNavIdx(idx);
    }
  };

  // GLB base64 for in-app 3D viewer
  const glbSource = item.glbUri ?? (item.resultUri?.endsWith('.glb') ? item.resultUri : null);
  const [glbB64, setGlbB64] = useState<string | null>(null);
  const [glbLoading, setGlbLoading] = useState(false);
  useEffect(() => {
    if (!glbSource) return;
    setGlbLoading(true);
    FileSystem.readAsStringAsync(glbSource, { encoding: 'base64' as any })
      .then(b64 => { setGlbB64(b64); setGlbLoading(false); })
      .catch(() => { setGlbB64(''); setGlbLoading(false); });
  }, [glbSource]);

  const doShare = async (uri: string) => {
    const mimeType = item.type.startsWith('image') ? 'image/png'
      : item.type.startsWith('video') ? 'video/mp4'
      : isUsdz ? 'model/vnd.usdz+zip' : 'model/gltf-binary';
    const UTI = isUsdz ? 'com.pixar.universal-scene-description-mobile' : undefined;
    await Sharing.shareAsync(uri, { mimeType, ...(UTI ? { UTI } : {}) });
  };

  const shareFile = async () => {
    if (!item.resultUri) { Alert.alert('Not ready', 'No output to share yet.'); return; }
    try {
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Not available', 'Sharing not supported on this device.'); return; }
      if (aiResults.length > 1) {
        Alert.alert('Share', `You have ${aiResults.length} versions. Share which one?`, [
          { text: `This one (#${aiResultIdx + 1})`, onPress: () => void doShare(aiResults[aiResultIdx]) },
          { text: 'All versions', onPress: async () => { for (const u of aiResults) await doShare(u).catch(() => {}); } },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } else {
        await doShare(item.resultUri);
      }
    } catch (e: any) { Alert.alert('Share Error', e?.message ?? 'Could not share'); }
  };

  const confirmDelete = () => {
    if (aiResults.length > 1 && !isShowingOriginal) {
      Alert.alert('Delete', 'Delete which result?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `This one (#${aiResultIdx + 1})`,
          style: 'destructive',
          onPress: async () => {
            const remaining = aiResults.filter((_, i) => i !== aiResultIdx);
            await updateLibraryItem(item.id, { resultUri: remaining[remaining.length - 1], resultUris: remaining });
            if (remaining.length === 0) { onClose(); onDelete(); }
            else setNavIdx(Math.max(hasSource ? 1 : 0, navIdx - 1));
          },
        },
        { text: 'All versions', style: 'destructive', onPress: () => { onClose(); onDelete(); } },
      ]);
    } else {
      Alert.alert('Delete', 'Remove this item from your library?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { onClose(); onDelete(); } },
      ]);
    }
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (zoomed) {
        scrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: true });
        scrollRef.current?.setNativeProps?.({ zoomScale: 1 });
        setZoomed(false);
      } else {
        scrollRef.current?.setNativeProps?.({ zoomScale: 3 });
        setZoomed(true);
      }
    }
    lastTapRef.current = now;
  };

  const imageContent = (uri: string) => (
    <Animated.View style={{ opacity: transAnim }}>
      <Image source={{ uri }} style={{ width: SCREEN_W, height: SCREEN_H }} resizeMode="contain" />
    </Animated.View>
  );

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={styles.viewerBg}>
        {item.type.startsWith('image') && displayUri ? (
          <ScrollView
            ref={scrollRef}
            style={StyleSheet.absoluteFillObject}
            contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
            maximumZoomScale={6} minimumZoomScale={1} bouncesZoom centerContent
            showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity activeOpacity={1} onPress={handleDoubleTap}>
              {imageContent(displayUri)}
            </TouchableOpacity>
          </ScrollView>
        ) : item.type.startsWith('video') && displayUri ? (
          <ScrollView
            ref={scrollRef}
            style={StyleSheet.absoluteFillObject}
            contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
            maximumZoomScale={4} minimumZoomScale={1} bouncesZoom centerContent
            showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity activeOpacity={1} onPress={handleDoubleTap}>
              <Animated.View style={{ opacity: transAnim }}>
                {isShowingOriginal ? (
                  <Image source={{ uri: item.sourceUri! }} style={{ width: SCREEN_W, height: SCREEN_H }} resizeMode="contain" />
                ) : displayUri.endsWith('.gif') ? (
                  <WebView source={{ uri: displayUri }} style={{ width: SCREEN_W, height: SCREEN_H }} scrollEnabled={false} />
                ) : (
                  (() => {
                    const ratio = item.sourceAspectRatio ?? 1;
                    const vW = ratio >= 1 ? SCREEN_W : Math.round(SCREEN_H * ratio);
                    const vH = ratio >= 1 ? Math.min(Math.round(SCREEN_W / ratio), SCREEN_H) : SCREEN_H;
                    return <Video source={{ uri: displayUri }} style={{ width: vW, height: vH }} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping isMuted useNativeControls={false} />;
                  })()
                )}
              </Animated.View>
            </TouchableOpacity>
          </ScrollView>
        ) : item.type.startsWith('mesh3d') ? (
          <View style={StyleSheet.absoluteFillObject}>
            {glbSource && glbB64 && glbB64.length > 0 ? (
              <WebView
                source={{ html: makeModelViewerHtml(glbB64) }}
                originWhiteList={['*']} mixedContentMode="always" javaScriptEnabled
                style={StyleSheet.absoluteFillObject}
                onMessage={event => {
                  const data = event.nativeEvent.data;
                  if (data.startsWith('data:image') && !item.thumbnailUri) {
                    const b64 = data.split(',')[1];
                    if (!b64) return;
                    const thumbPath = `${FileSystem.documentDirectory}thumb_${item.id}.jpg`;
                    FileSystem.writeAsStringAsync(thumbPath, b64, { encoding: 'base64' as any })
                      .then(() => updateLibraryItem(item.id, { thumbnailUri: thumbPath }))
                      .catch(() => {});
                  }
                }}
              />
            ) : glbLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color="#ff9f6b" />
                <Text style={{ color: '#888', marginTop: 12, fontSize: 13 }}>Loading 3D model…</Text>
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 40 }}>
                <Text style={{ fontSize: 72 }}>{isUsdz ? '🎭' : '🧊'}</Text>
                <Text style={{ color: '#ff9f6b', fontSize: 20, fontWeight: '800', textAlign: 'center' }}>
                  {isUsdz ? '3D Model — USDZ' : '3D Model'}
                </Text>
                <Text style={{ color: '#bbb', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                  Tap Share below to open in AR QuickLook or external viewer.
                </Text>
              </View>
            )}
            {/* Only show Re-download if model isn't loaded */}
            {!glbB64 && item.downloadUrl && (
              <View style={{ position: 'absolute', bottom: 110 + insets.bottom, alignSelf: 'center' }}>
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const newUri = await download3DModel(item.downloadUrl!, item.id, item.type as any);
                      await updateLibraryItem(item.id, { resultUri: newUri });
                      Alert.alert('Re-downloaded', 'Model refreshed.');
                    } catch (e: any) { Alert.alert('Re-download failed', e?.message ?? 'Could not download'); }
                  }}
                  style={[styles.arBtn, { backgroundColor: 'rgba(255,255,255,0.04)' }]}
                >
                  <Text style={[styles.arBtnText, { color: '#888' }]}>🔄 Re-download</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : null}

        {/* Nav label */}
        {(item.type.startsWith('image') || item.type.startsWith('video')) && (
          <View style={{ position: 'absolute', top: insets.top + 56, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5, pointerEvents: 'none' }}>
            {isShowingOriginal
              ? <Text style={{ color: '#ff9f6b', fontSize: 11, fontWeight: '700' }}>📷 Original Input</Text>
              : <Text style={{ color: '#aaa', fontSize: 11 }}>
                  {aiResults.length > 1 ? `AI Result ${aiResultIdx + 1}/${aiResults.length} · ` : ''}Pinch to zoom
                </Text>
            }
          </View>
        )}

        {/* Navigation arrows — shown when navItems has multiple items */}
        {navItems.length > 1 && (
          <View style={{
            position: 'absolute', bottom: insets.bottom + 92,
            flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'center',
            backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 8,
          }}>
            <TouchableOpacity disabled={navIdx <= 0} onPress={() => navigateTo(navIdx - 1)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 22, opacity: navIdx <= 0 ? 0.25 : 1 }}>◀</Text>
            </TouchableOpacity>
            <Text style={{ color: '#ce93d8', fontSize: 12, fontWeight: '700', minWidth: 56, textAlign: 'center' }}>
              {isShowingOriginal ? '📷 Orig' : `🎨 v${aiResultIdx + 1}`}
              {'\n'}
              <Text style={{ color: '#666', fontSize: 10, fontWeight: '400' }}>{navIdx + 1}/{navItems.length}</Text>
            </Text>
            <TouchableOpacity disabled={navIdx >= navItems.length - 1} onPress={() => navigateTo(navIdx + 1)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 22, opacity: navIdx >= navItems.length - 1 ? 0.25 : 1 }}>▶</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Top close button */}
        <TouchableOpacity onPress={onClose} style={styles.viewerClose}>
          <Text style={{ fontSize: 28 }}>❎</Text>
        </TouchableOpacity>

        {/* Bottom action bar */}
        <View style={[styles.viewerBottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity onPress={confirmDelete} style={styles.viewerActionBtn}>
            <Text style={styles.viewerActionIcon}>🗑️</Text>
            <Text style={styles.viewerActionLabel}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { onClose(); onRedo(); }} style={styles.viewerActionBtn}>
            <Text style={styles.viewerActionIcon}>🔄</Text>
            <Text style={styles.viewerActionLabel}>Redo</Text>
          </TouchableOpacity>
          {item.resultUri && (
            <TouchableOpacity onPress={shareFile} style={styles.viewerActionBtn}>
              <Text style={styles.viewerActionIcon}>📤</Text>
              <Text style={styles.viewerActionLabel}>Share</Text>
            </TouchableOpacity>
          )}
          {!!onUseAsProfileImage && !isShowingOriginal && !item.type.startsWith('mesh3d') && !!displayUri && (
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Use as Profile Image?',
                  'This AI image will be set as your passport portrait and loaded into the Profile Studio so you can paint on top.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: '✓ Yes, use it', onPress: () => { onUseAsProfileImage(displayUri); onClose(); } },
                  ]
                );
              }}
              style={styles.viewerActionBtn}
            >
              <Text style={styles.viewerActionIcon}>👤</Text>
              <Text style={styles.viewerActionLabel}>Profile</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ─── Easter egg panel ─────────────────────────────────────────────────────────
const EasterEggPanel: React.FC<{
  loading: boolean; resultUri: string | null; promptUsed: string; onClose: () => void;
}> = ({ loading, resultUri, promptUsed, onClose }) => {
  const enterAnim = useRef(new Animated.Value(0)).current;
  const eggRock   = useRef(new Animated.Value(0)).current;
  const glow      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enterAnim, { toValue: 1, useNativeDriver: true, damping: 7, stiffness: 90 }).start();
    const rock = Animated.loop(Animated.sequence([
      Animated.timing(eggRock, { toValue: 1,  duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(eggRock, { toValue: -1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    rock.start();
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1,   duration: 1200, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
    ]));
    glowLoop.start();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return () => { rock.stop(); glowLoop.stop(); };
  }, []);

  const eggRotate    = eggRock.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });
  const contentScale = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={styles.eggPanelBg}>
        <Animated.View style={[styles.eggPanelContent, { opacity: enterAnim, transform: [{ scale: contentScale }] }]}>
          <Animated.Text style={{ fontSize: 96, transform: [{ rotate: eggRotate }] }}>🥚</Animated.Text>
          <Animated.Text style={[styles.eggFoundTitle, { opacity: glow }]}>YOU FOUND IT!</Animated.Text>
          <Text style={styles.eggFoundSub}>
            🎉 Hidden Easter Egg Unlocked{'\n'}
            Your unique artwork is being forged on the dedicated machine...
          </Text>
          {loading ? (
            <View style={styles.eggLoadingBox}>
              <ActivityIndicator size="large" color="#ff9f6b" />
              <Text style={styles.eggPromptText} numberOfLines={3}>
                "{promptUsed.slice(0, 120)}..."
              </Text>
              <Text style={{ color: '#555', fontSize: 11, marginTop: 6, textAlign: 'center' }}>
                Generating 768×768 at 40 steps · ~60–90 seconds
              </Text>
            </View>
          ) : resultUri ? (
            <View style={{ alignItems: 'center', gap: 16, width: '100%' }}>
              <Image source={{ uri: resultUri }} style={styles.eggResultImage} resizeMode="cover" />
              <Text style={{ color: '#4caf50', fontSize: 14, fontWeight: '800' }}>✅ Saved to your AI Library!</Text>
            </View>
          ) : (
            <View style={styles.eggLoadingBox}>
              <Text style={{ fontSize: 36 }}>😔</Text>
              <Text style={{ color: '#f44', fontSize: 13, textAlign: 'center' }}>
                Server unreachable right now.{'\n'}Try again when A1111 🟢 is online!
              </Text>
            </View>
          )}
          {!loading && (
            <TouchableOpacity onPress={onClose} style={styles.eggCloseBtn}>
              <Text style={styles.eggCloseBtnText}>✨ Amazing, close</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─── Main overlay ─────────────────────────────────────────────────────────────
interface CoinShopOverlayProps {
  visible: boolean;
  onClose: () => void;
  coinCount: number;
  userName?: string;
  onAddCoins: (n: number) => void;
  onSpendCoins: (n: number) => void;
  passportPortrait?: string | null;
  onUseAsProfileImage?: (uri: string) => void;
}

const CoinShopOverlay: React.FC<CoinShopOverlayProps> = ({
  visible, onClose, coinCount, userName, onAddCoins, onSpendCoins,
  passportPortrait, onUseAsProfileImage,
}) => {
  const insets = useSafeAreaInsets();

  const [library, setLibrary]   = useState<AILibraryItem[]>([]);
  const [flow, setFlow]         = useState<FlowState | null>(null);
  const [viewerItemId, setViewerItemId] = useState<string | null>(null);
  const viewerItem = viewerItemId ? (library.find(it => it.id === viewerItemId) ?? null) : null;
  const [monitorItem, setMonitorItem] = useState<AILibraryItem | null>(null);
  const [showPwConfig, setShowPwConfig] = useState(false);

  // Easter egg state
  const [eggVisible, setEggVisible]   = useState(false);
  const [eggLoading, setEggLoading]   = useState(false);
  const [eggResultUri, setEggResultUri] = useState<string | null>(null);
  const [eggPrompt, setEggPrompt]     = useState('');

  const [wildLevel, setWildLevel]         = useState(0);
  const [activeCardIdx, setActiveCardIdx] = useState(-1); // -1 = break (no card animating)
  const spotlightRef                      = useRef<any>(null);

  // Sequential spotlight: IMAGE ~7s → break → VIDEO ~3s → break → 3D ~5s → break → repeat
  useEffect(() => {
    if (!visible) { setActiveCardIdx(-1); return; }

    const runSequence = () => {
      // [cardIndex, durationMs]  —  index -1 means "no card" (pause between)
      const seq: [number, number][] = [
        [0, 5000 + Math.random() * 4000],  // IMAGE  5–9 s
        [-1, 500  + Math.random() * 600],   // break  0.5–1.1 s
        [1, 2000 + Math.random() * 2000],  // VIDEO  2–4 s
        [-1, 400  + Math.random() * 500],   // break
        [2, 3000 + Math.random() * 3000],  // 3D     3–6 s
        [-1, 700  + Math.random() * 800],   // break
      ];
      let i = 0;
      const step = () => {
        const [idx, dur] = seq[i % seq.length];
        setActiveCardIdx(idx);
        i++;
        spotlightRef.current = setTimeout(step, dur);
      };
      step();
    };

    // Short delay so panel entrance animation completes first
    spotlightRef.current = setTimeout(runSequence, 900);
    return () => { if (spotlightRef.current) clearTimeout(spotlightRef.current); };
  }, [visible]);

  const flyAnims = useRef([
    { x: new Animated.Value(0), y: new Animated.Value(0), rot: new Animated.Value(0) },
    { x: new Animated.Value(0), y: new Animated.Value(0), rot: new Animated.Value(0) },
    { x: new Animated.Value(0), y: new Animated.Value(0), rot: new Animated.Value(0) },
  ]).current;

  const panelAnims = useRef([
    new Animated.Value(0), new Animated.Value(0), new Animated.Value(0),
  ]).current;

  const pollIntervalRef = useRef<any>(null);

  const refresh = useCallback(() => loadLibrary().then(setLibrary), []);

  useEffect(() => {
    if (!visible) return;
    // On open: recover stuck 'processing' items.
    // 3D triposr/procedural jobs with a jobId: poll server to see if complete, download if done.
    // All others: mark as failed so user can retry.
    loadLibrary().then(async items => {
      // Pre-warm factory URL cache so subsequent WebViews start instantly
    void getFactoryUrlCached();

    // Auto-delete failed items, EXCEPT 3D items with a downloadUrl — those can be re-downloaded
      const failed = items.filter(it => it.status === 'failed');
      const deletable = failed.filter(it => !(it.type.startsWith('mesh3d') && it.downloadUrl));
      if (deletable.length > 0) {
        await Promise.all(deletable.map(f => deleteLibraryItem(f.id)));
        items = items.filter(it => !deletable.some(d => d.id === it.id));
      }

      // Auto-retry failed 3D items that have a downloadUrl (e.g. prior 502 errors)
      const failedWith3DUrl = items.filter(it => it.status === 'failed' && it.type.startsWith('mesh3d') && it.downloadUrl);
      for (const item of failedWith3DUrl) {
        void (async () => {
          try {
            console.log('[CoinShop] Auto-retrying failed 3D download for', item.id);
            const resultUri = await download3DModel(item.downloadUrl!, item.id, item.type as any);
            // Also get GLB for in-app viewer
            const glbUrl = item.downloadUrl!.replace('/usdz', '/glb');
            let glbUri: string | undefined;
            try {
              glbUri = await download3DModel(glbUrl, item.id + '_glb', item.type as any);
            } catch { /* non-fatal */ }
            await updateLibraryItem(item.id, { status: 'done', resultUri, errorMsg: undefined, ...(glbUri ? { glbUri } : {}) });
            refresh();
          } catch (e: any) {
            console.log('[CoinShop] Auto-retry still failed:', e?.message?.slice(0, 80));
          }
        })();
      }

      const processing = items.filter(it => it.status === 'processing');
      if (processing.length === 0) { setLibrary(items); return; }

      const resumable = processing.filter(it => it.type.startsWith('mesh3d') && it.jobId);
      const nonResumable = processing.filter(it => !it.type.startsWith('mesh3d') || !it.jobId);

      let current = [...items];
      if (nonResumable.length > 0) {
        current = current.map(it =>
          nonResumable.some(o => o.id === it.id)
            ? { ...it, status: 'failed' as const, errorMsg: 'App was restarted during generation' }
            : it
        );
        await saveLibrary(current);
      }
      setLibrary(current);

      // Try to resume each 3D job in background
      for (const item of resumable) {
        void (async () => {
          try {
            console.log('[CoinShop] Resuming 3D job', item.jobId, 'type:', item.type);
            const { done, error, urls } = await poll3DJob(item.jobId!);
            if (!done) {
              console.log('[CoinShop] Job still running — leaving as processing:', item.jobId);
              return;
            }
            if (error) {
              await updateLibraryItem(item.id, { status: 'failed', errorMsg: error });
            } else {
              const path = urls ? (urls.usdz ?? urls.glb ?? '') : '';
              if (path) {
                const resultUri = await download3DModel(path, item.id, item.type as any);
                await updateLibraryItem(item.id, { status: 'done', resultUri, downloadUrl: path });
                // Also fetch GLB for in-app viewer
                if (urls?.glb && urls?.usdz) {
                  try {
                    const glbUri = await download3DModel(urls.glb, item.id + '_glb', item.type as any);
                    await updateLibraryItem(item.id, { glbUri });
                  } catch { /* non-fatal */ }
                } else if (urls?.glb && !urls?.usdz) {
                  await updateLibraryItem(item.id, { glbUri: resultUri });
                }
              } else {
                await updateLibraryItem(item.id, { status: 'failed', errorMsg: 'Job done but no download URLs in poll response' });
              }
            }
            refresh();
          } catch (e: any) {
            await updateLibraryItem(item.id, { status: 'failed', errorMsg: e?.message ?? 'Resume failed' });
            refresh();
          }
        })();
      }
    });
    panelAnims.forEach(a => a.setValue(0));
    panelAnims.forEach((a, i) => {
      Animated.timing(a, {
        toValue: 1, duration: 560 + i * 60,
        delay: i * (120 + Math.random() * 60),
        easing: Easing.out(Easing.back(1.1)),
        useNativeDriver: true,
      }).start();
    });
  }, [visible]);

  const panelStyle = (i: number) => ({
    opacity: panelAnims[i],
    transform: [{ translateY: panelAnims[i].interpolate({ inputRange: [0, 1], outputRange: [55, 0] }) }],
  });

  const flyStyle = (i: number) => ({
    transform: [
      { translateX: flyAnims[i].x },
      { translateY: flyAnims[i].y },
      { rotate: flyAnims[i].rot.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] }) },
    ],
  });

  const handleEasterEgg = useCallback(async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const prompt = pickEasterEggPrompt();
    setEggPrompt(prompt);
    setEggLoading(true);
    setEggResultUri(null);
    setEggVisible(true);
    try {
      const resultUri = await generateEasterEgg(prompt);
      setEggResultUri(resultUri);
      setEggLoading(false);
      const shortLabel = prompt.split(',')[0].slice(0, 40);
      const id = `egg_${Date.now()}`;
      await addLibraryItem({
        id, type: 'image_standard', status: 'done',
        createdAt: Date.now(), coinCost: 0, sourceUri: '', resultUri,
        label: `🥚 ${shortLabel}`, prompt,
      });
      refresh();
    } catch { setEggLoading(false); }
  }, [refresh]);

  const openCategory = useCallback((cat: Category) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFlow({
      category: cat,
      step: 'subtype',
      prompt: '',
      autoPrompting: false,
      cnModule: 'lineart',
      scPreset: 'DREAM',
      frameCount: cat === 'video' ? 40 : 24,
      log: [],
      done: false,
      aiPower: 0.5,
    });
  }, []);

  // Called when user taps Generate in CategoryFlow
  const handleRun = useCallback((params: RunParams): string => {
    const { type, sourceB64, source2B64, sourceDims, prompt, cnModule, scPreset, frameCount, removeBg, aiPower, parentItemId } = params;
    const safeAiPower = aiPower ?? 0.5;
    const denoise  = parseFloat((0.3 + safeAiPower * 0.5).toFixed(2));
    const cfgScale = parseFloat((5 + safeAiPower * 7).toFixed(1));
    const cnWeight = parseFloat((0.1 + safeAiPower * 0.3).toFixed(2));
    const fc   = frameCount;
    const cost = type === 'video_animatediff' ? calcVideoCost(fc)
      : type === 'video_slowcinema' ? calcSlowCinemaCost(fc)
      : (COSTS as any)[type] ?? 0;
    // If redoing into a parent item, reuse parent's ID so result is appended to it
    const id   = parentItemId ?? `${type}_${Date.now()}`;
    const isRedo = !!parentItemId;

    const subtypeDef = ALL_SUBTYPES.find(s => s.id === type);
    // For image_controlnet: store cnModule in preset so redo can restore the toggle.
    // For everything else: store scPreset (slow cinema / 3D / default).
    const itemPreset = type === 'image_controlnet' ? (cnModule ?? 'lineart') : scPreset;
    const sourceAspectRatio = sourceDims ? sourceDims.w / sourceDims.h : undefined;
    const item: AILibraryItem = {
      id, type, status: 'queued', createdAt: Date.now(), coinCost: cost,
      sourceUri: flow?.sourceUri ?? '', frameCount: fc, preset: itemPreset,
      prompt, label: subtypeDef?.title ?? (type === 'image_controlnet' ? '🔬 ControlNet' : type),
      sourceAspectRatio,
    };

    void (async () => {
      if (isRedo) {
        // Don't create new item — mark existing as queued for new generation
        await updateLibraryItem(id, { status: 'queued', errorMsg: undefined, prompt, sourceUri: flow?.sourceUri ?? '' });
      } else {
        await addLibraryItem(item);
      }
      onSpendCoins(cost);
      refresh();

      const appendLog = (line: string) => {
        setFlow(prev => prev && prev.step === 'processing'
          ? { ...prev, log: [...prev.log, line] }
          : prev
        );
      };

      const setFrameProgress = (current: number, total: number, pct: number) => {
        setFlow(prev => prev && prev.step === 'processing'
          ? { ...prev, frameProgress: { current, total, pct } }
          : prev
        );
      };

      const runJob = async () => {
        // Parallel A1111 progress polling for image/video types (SD-Stream also uses A1111 internally)
        const isA1111 = type.startsWith('image') || type.startsWith('video');
        let stopPoll = false;
        if (isA1111) {
          void (async () => {
            await new Promise(r => setTimeout(r, 900)); // wait for job to start
            while (!stopPoll) {
              try {
                const prog = await pollA1111Progress();
                if (prog.totalSteps > 0) {
                  setFrameProgress(prog.step, prog.totalSteps, Math.round(prog.progress * 100));
                }
                if (prog.currentImage) {
                  setFlow(prev => prev && prev.step === 'processing' && !prev.done
                    ? { ...prev, previewUri: `data:image/png;base64,${prog.currentImage}` }
                    : prev
                  );
                }
              } catch { /* ignore poll errors */ }
              if (!stopPoll) await new Promise(r => setTimeout(r, 1200));
            }
          })();
        }

        try {
          await updateLibraryItem(id, { status: 'processing' }); refresh();
          appendLog('🔄 Processing started…');
          let resultUri: string | undefined;

          if (type === 'image_standard') {
            let img = sourceB64;
            if (removeBg) {
              appendLog('✂️ Cutting out subject…');
              img = await removeBackground(sourceB64);
              appendLog('✅ Background removed!');
            }
            appendLog(`📡 img2img ${sourceDims ? `${sourceDims.w}×${sourceDims.h}` : ''} · power ${Math.round(safeAiPower * 100)}%…`);
            resultUri = await generateStandardImage(img, prompt || undefined, sourceDims, denoise, cfgScale);
          } else if (type === 'image_controlnet') {
            const safeModule = cnModule ?? 'lineart';
            appendLog(`📡 ControlNet [${safeModule}] · power ${Math.round(safeAiPower * 100)}%…`);
            resultUri = await generateControlNetImage(sourceB64, safeModule, prompt || undefined, sourceDims, denoise, cfgScale, cnWeight);
          } else if (type === 'image_txt2img') {
            appendLog('📡 txt2img generation…');
            resultUri = await generateTxt2Img(prompt || 'colorful emoji art, vivid, digital painting');
          } else if (type === 'video_animatediff') {
            appendLog(`📡 AnimateDiff: ${fc} frames · power ${Math.round(safeAiPower * 100)}%…`);
            resultUri = await generateAnimateDiff(sourceB64, fc, prompt || undefined, sourceDims, denoise, cfgScale);
          } else if (type === 'video_transition_auto') {
            appendLog('📡 RIFE Morph starting…');
            resultUri = await generateTransitionAuto(sourceB64, source2B64 ?? sourceB64, {
              prompt: prompt || undefined,
              count: fc,
              fps: 24,
              doSd: params.doSd !== false,
              denoise: parseFloat((0.2 + safeAiPower * 0.4).toFixed(2)),
              pingpong: params.pingpong,
            }, (pct) => setFrameProgress(pct, 100, pct));
          } else if (type === 'video_slowmotion_auto') {
            appendLog(`📡 Dream Flow [${params.slomoPresets ?? 'DREAM'}] ${fc} frames…`);
            resultUri = await generateSlowmotionAuto(sourceB64, {
              presets: params.slomoPresets ?? 'DREAM',
              theme: prompt || undefined,
              maxFrames: fc,
              fps: 12,
              slowness: params.slomoSlowness ?? 0.5,
            }, (frameCount) => setFrameProgress(frameCount, fc, Math.round(frameCount / fc * 100)));
          } else if (type === 'video_v2v') {
            const videoSrc = params.sourceUri ?? '';
            appendLog('📡 Uploading video for restyle…');
            resultUri = await generateV2V(videoSrc, {
              prompt: prompt || 'artistic restyle, vivid colors, painterly',
              denoise: parseFloat((0.15 + safeAiPower * 0.2).toFixed(2)),
              consistencyMode: params.consistencyMode ?? 'standard',
              frameSkip: params.v2vFrameSkip ?? 1,
            }, (pct, phase) => {
              appendLog(`⏳ ${phase}: ${pct}%`);
              setFrameProgress(pct, 100, pct);
            });
          } else if (type === 'video_transition') {
            appendLog('📡 Generating transition…');
            resultUri = await generateTransition(sourceB64, source2B64 ?? sourceB64);
          } else if (type === 'video_slowcinema') {
            appendLog(`📡 Slow Cinema [${scPreset}] ${fc} frames — starting session…`);
            const sid = await startSlowCinema(sourceB64, scPreset, fc, prompt || undefined);
            await updateLibraryItem(id, { jobId: sid }); refresh();
            appendLog(`⏳ Session ${sid.slice(0, 8)}… polling…`);
            await new Promise<void>((resolve, reject) => {
              let attempts = 0;
              pollIntervalRef.current = setInterval(async () => {
                attempts++;
                const { done, error, progress } = await pollSlowCinema(sid, fc);
                if (done) {
                  clearInterval(pollIntervalRef.current);
                  error ? reject(new Error(error)) : resolve();
                } else if (attempts > 120) {
                  clearInterval(pollIntervalRef.current);
                  reject(new Error('Slow cinema timed out — try fewer frames'));
                } else {
                  if (typeof progress === 'number' && progress > 0) {
                    setFrameProgress(Math.round(progress * fc), fc, Math.round(progress * 100));
                  } else {
                    appendLog(`⌛ Still rendering… frame ${Math.round(progress ?? 0 * fc)}/${fc}`);
                  }
                }
              }, 3000);
            });
            appendLog('📥 Exporting video…');
            resultUri = await exportSlowCinema(sid, id);
          } else if (type === 'mesh3d_tripo' || type === 'mesh3d_procedural' || type === 'mesh3d_sf3d' || type === 'mesh3d_hunyuan' || type === 'mesh3d_trellis2') {
            const method = type === 'mesh3d_tripo' ? 'triposr'
              : type === 'mesh3d_procedural' ? 'procedural'
              : type === 'mesh3d_sf3d' ? 'sf3d'
              : type === 'mesh3d_trellis2' ? 'trellis2'
              : 'hunyuan';
            const waitHint = type === 'mesh3d_sf3d' ? '~45s'
              : type === 'mesh3d_hunyuan' ? '~4–5 min'
              : type === 'mesh3d_trellis2' ? '~3–6 min'
              : type === 'mesh3d_tripo' ? '~2–3 min'
              : '~40–60s';
            const label3D = type === 'mesh3d_sf3d' ? 'SF3D'
              : type === 'mesh3d_hunyuan' ? 'Hunyuan'
              : type === 'mesh3d_trellis2' ? 'Trellis2'
              : type === 'mesh3d_tripo' ? 'TripoSR'
              : 'Procedural 3D';
            appendLog(`📡 Uploading to ${label3D} (${waitHint})…`);
            if (removeBg) appendLog('🪄 Background removal on (server-side)…');

            const { jobId, emojiId, urls } = await submit3DJob(
              sourceB64, method, 'emoji3d', removeBg ?? false, prompt || ''
            );
            await updateLibraryItem(id, { jobId, emojiId }); refresh();
            appendLog(`✅ Job queued — id ${jobId.slice(0, 8)}`);

            // Poll /api/3d/job/<id> — per-job endpoint, stable, URLs embedded when done
            // Max ~120 polls × 3s = 6 min (server says worst-case ~4-5 min queue)
            let finalUrls: Record<string, string> = {};
            // Trellis2 high-detail jobs can run ~3–6 min plus queue time — give them longer
            const MAX_POLLS = type === 'mesh3d_trellis2' ? 240 : 120;
            let consecutiveNotFound = 0;
            let resubmitted = false;
            let activeJobId = jobId;
            await new Promise<void>((resolve, reject) => {
              let attempts = 0;
              let lastLabel = '';
              const startPoll = (jid: string) => {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = setInterval(async () => {
                  attempts++;
                  const { done, error, urls: jobUrls, progress, label, jobNotFound } = await poll3DJob(jid);

                  if (jobNotFound) {
                    consecutiveNotFound++;
                    appendLog(`⚠️ Server lost job (${consecutiveNotFound}/3)…`);
                    if (consecutiveNotFound >= 3 && !resubmitted) {
                      resubmitted = true;
                      clearInterval(pollIntervalRef.current);
                      appendLog('🔄 Re-submitting after backend restart…');
                      try {
                        const r = await submit3DJob(sourceB64, method, 'emoji3d', removeBg ?? false, prompt || '');
                        activeJobId = r.jobId;
                        await updateLibraryItem(id, { jobId: r.jobId, emojiId: r.emojiId });
                        appendLog(`✅ Re-queued — id ${r.jobId.slice(0, 8)}`);
                        consecutiveNotFound = 0;
                        startPoll(r.jobId);
                      } catch (e) { reject(new Error('Re-submit failed: ' + String(e))); }
                    }
                    return;
                  }
                  consecutiveNotFound = 0;

                  if (done) {
                    clearInterval(pollIntervalRef.current);
                    if (error) { reject(new Error(error)); return; }
                    finalUrls = jobUrls ?? {};
                    resolve();
                  } else if (attempts >= MAX_POLLS) {
                    clearInterval(pollIntervalRef.current);
                    reject(new Error('3D job timed out after 6 min — server may be overloaded'));
                  } else {
                    const pct = progress ?? Math.round(attempts / MAX_POLLS * 100);
                    setFrameProgress(attempts, MAX_POLLS, pct);
                    if (label && label !== lastLabel) {
                      lastLabel = label;
                      appendLog(`⏳ ${label} ${pct}%`);
                      setFlow(prev => prev && prev.step === 'processing'
                        ? { ...prev, statusLabel: label }
                        : prev
                      );
                    }
                  }
                }, 3000);
              };
              startPoll(activeJobId);
            });

            // Download using URLs returned by poll — usdz preferred for iOS AR, glb fallback
            const serverDownloadUrl = finalUrls.usdz ?? finalUrls.glb ?? '';
            if (!serverDownloadUrl) throw new Error('3D job finished but server returned no download URLs');
            appendLog(`📥 Downloading 3D model (${finalUrls.usdz ? 'USDZ' : 'GLB'})…`);
            resultUri = await download3DModel(serverDownloadUrl, id, type);
            await updateLibraryItem(id, { downloadUrl: serverDownloadUrl });
            // Also download GLB for in-app 3D viewer (alongside USDZ)
            if (finalUrls.glb && finalUrls.usdz) {
              try {
                appendLog('📥 Downloading GLB for 3D viewer…');
                const glbLocalUri = await download3DModel(finalUrls.glb, id + '_glb', type);
                await updateLibraryItem(id, { glbUri: glbLocalUri });
                appendLog('✅ GLB ready!');
              } catch { appendLog('⚠️ GLB download failed (AR still works).'); }
            } else if (finalUrls.glb && !finalUrls.usdz) {
              // resultUri IS the GLB — use it directly for the viewer
              await updateLibraryItem(id, { glbUri: resultUri });
            }
          }

          if (resultUri) {
            if (isRedo) {
              // Append new result to the parent item's resultUris list
              const parent = (await loadLibrary()).find(it => it.id === id);
              const prevResults = parent?.resultUris ?? (parent?.resultUri ? [parent.resultUri] : []);
              const newResultUris = [...prevResults, resultUri];
              await updateLibraryItem(id, { status: 'done', resultUri, resultUris: newResultUris });
            } else {
              await updateLibraryItem(id, { status: 'done', resultUri });
            }
            setFlow(prev => prev && prev.step === 'processing'
              ? { ...prev, done: true, previewUri: resultUri, log: [...(prev.log ?? []), '✅ Done!'] }
              : prev
            );
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch (err: any) {
          const msg = err?.message ?? 'Unknown error';
          console.error('[CoinShop] AI job failed — type:', flow?.subtype, 'error:', msg, err);
          appendLog(`❌ Failed: ${msg}`);
          appendLog('↩ Coins refunded. Tap Retry to try again.');
          await updateLibraryItem(id, { status: 'failed', errorMsg: msg });
          onAddCoins(cost);
          setFlow(prev => prev && prev.step === 'processing'
            ? { ...prev, done: true, log: [...(prev.log ?? []), '❌ ' + msg, '↩ Coins refunded.'] }
            : prev
          );
        } finally {
          stopPoll = true;
        }
        refresh();
      };

      void runJob();
    })();

    return id;
  }, [flow, onSpendCoins, onAddCoins, refresh]);

  const handleAbortJob = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (flow?.itemId) {
      void updateLibraryItem(flow.itemId, { status: 'failed', errorMsg: 'Aborted by user' });
      const cost = flow.subtype === 'video_animatediff' ? calcVideoCost(flow.frameCount ?? 24)
        : flow.subtype === 'video_slowcinema' ? calcSlowCinemaCost(flow.frameCount ?? 40)
        : (COSTS as any)[flow.subtype ?? ''] ?? 0;
      if (cost > 0) onAddCoins(cost);
    }
    refresh();
  }, [flow, pollIntervalRef, onAddCoins, refresh]);

  const handleAbortLibraryItem = useCallback(async (item: AILibraryItem) => {
    await updateLibraryItem(item.id, { status: 'failed', errorMsg: 'Aborted by user' });
    if (item.coinCost > 0) onAddCoins(item.coinCost);
    refresh();
  }, [onAddCoins, refresh]);

  const handleDeleteItem = useCallback(async (item: AILibraryItem) => {
    await deleteLibraryItem(item.id);
    refresh();
  }, [refresh]);

  const handleShareItem = useCallback(async (item: AILibraryItem) => {
    if (!item.resultUri) { Alert.alert('Not ready', 'Generation not complete yet.'); return; }
    try {
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Unavailable', 'Sharing not supported on this device.'); return; }
      const isUsdz  = item.resultUri.endsWith('.usdz');
      const mimeType = item.type.startsWith('image') ? 'image/png'
        : item.type.startsWith('video') ? 'video/mp4'
        : isUsdz ? 'model/vnd.usdz+zip'
        : 'model/gltf-binary';
      await Sharing.shareAsync(item.resultUri, { mimeType });
    } catch (e: any) { Alert.alert('Share Error', e?.message ?? 'Could not share'); }
  }, []);

  const handleRedoItem = useCallback((item: AILibraryItem) => {
    setViewerItemId(null);
    const category: Category = item.type.startsWith('image') ? 'image'
      : item.type.startsWith('video') ? 'video'
      : 'mesh3d';
    const textOnly = item.type === 'image_txt2img';

    // image_controlnet is now a toggle inside image_standard, not its own subtype.
    // Normalize old image_controlnet items so the full options panel appears.
    const isLegacyCN = item.type === 'image_controlnet';
    const normalizedSubtype = isLegacyCN ? 'image_standard' : item.type;

    const baseFlow = {
      category,
      step: 'options' as FlowStep,
      subtype: normalizedSubtype,
      useControlNet: isLegacyCN,                             // restore toggle
      cnModule: (item.preset as ControlNetModule) ?? 'lineart', // restored from stored preset
      scPreset: (item.preset as SlowCinemaPreset) ?? 'DREAM',
      prompt: item.prompt ?? '',
      autoPrompting: false,
      frameCount: item.frameCount ?? 24,
      log: [],
      done: false,
      retryCount: 0,
      aiPower: 0.5,
      // For image types: append next result to this item so user can flip through iterations
      parentItemId: category === 'image' ? item.id : undefined,
    };

    if (!item.sourceUri || textOnly) {
      setFlow({ ...baseFlow, sourceUri: '', sourceB64: '' });
      return;
    }

    // Build the list of all available source versions: [original, ...aiResults]
    const aiResults = item.resultUris && item.resultUris.length > 1
      ? item.resultUris
      : (item.resultUri ? [item.resultUri] : []);
    const redoSources = [item.sourceUri, ...aiResults];
    const redoSourceIdx = 0; // start with original

    // Show options immediately with URI for preview; load b64 async
    setFlow({ ...baseFlow, sourceUri: item.sourceUri, sourceB64: '', redoSources, redoSourceIdx });
    void uriToBase64WithInfo(item.sourceUri).then(({ b64, w, h }) => {
      setFlow(prev => prev ? { ...prev, sourceB64: b64, sourceDims: { w, h } } : prev);
    });
  }, []);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, backgroundColor: wildLevel > 3 ? '#110000' : '#070709' }]}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={{ width: 32 }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            {wildLevel > 1 && (
              <Text style={{ color: 'rgba(255,80,0,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>
                {'🔥'.repeat(Math.min(wildLevel, 5))} KEEP HOLDING {'🔥'.repeat(Math.min(wildLevel, 5))}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={{ fontSize: 26 }}>❎</Text>
          </TouchableOpacity>
        </View>

        <ServerStatus onLongPress={() => setShowPwConfig(true)} />

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={wildLevel < 3}
          bounces
        >
          {/* Panel 0: header */}
          <Animated.View style={[styles.panel, panelStyle(0), flyStyle(0)]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
              <MiniLogoAnimator size={53} />
              <View style={{ flex: 1 }}>
                <CoinWidget
                  coinCount={coinCount}
                  userName={userName}
                  onAddCoins={onAddCoins}
                  onEasterEgg={handleEasterEgg}
                  onWildLevelChange={setWildLevel}
                  flyAnims={flyAnims}
                />
              </View>
            </View>
            <View style={styles.headerBox}>
              <Text style={styles.headerTitle}>🎉 Coin Workshop</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, width: '100%' }}>
                <Text style={[styles.headerDesc, { flex: 1, minWidth: 180 }]}>
                  Turn paintings into AI images, videos & 3D — all on your machine.
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Factory live cam — decorative strip, random angle, no controls */}
          <FactoryTopCamView />

          {/* Panel 1: 3 category cards */}
          <Animated.View style={[panelStyle(1), flyStyle(1)]}>
            <Text style={styles.sectionHeader}>⚡ Generate AI Content</Text>
            <View style={styles.catGrid}>
              {CATEGORY_DEFS.map((cat, i) => (
                <Bounce key={cat.id} amount={6 + i * 2} period={900 + i * 120}>
                  <CategoryCard cat={cat} onPress={() => openCategory(cat.id)} isActive={activeCardIdx === i} />
                </Bounce>
              ))}
            </View>
          </Animated.View>

          {/* Panel 2: library */}
          <Animated.View style={[styles.panel, panelStyle(2), flyStyle(2)]}>
            <View style={styles.libHeaderRow}>
              <Text style={styles.sectionHeader}>📦 AI Library</Text>
              <TouchableOpacity onPress={refresh}>
                <Text style={{ color: '#ff9f6b', fontSize: 12 }}>↻ Refresh</Text>
              </TouchableOpacity>
            </View>
            {library.length === 0 ? (
              <View style={styles.libEmpty}>
                <Text style={{ fontSize: 50 }}>🌌</Text>
                <Text style={styles.libEmptyText}>No AI creations yet.{'\n'}Pick a category above!</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP }}>
                {library.map(item => (
                  <LibraryCard
                    key={item.id}
                    item={item}
                    onView={() => item.status === 'processing' ? setMonitorItem(item) : setViewerItemId(item.id)}
                    onDelete={() => void handleDeleteItem(item)}
                    onShare={() => void handleShareItem(item)}
                    onAbortItem={handleAbortLibraryItem}
                  />
                ))}
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Category flow */}
        {flow && (
          <View style={StyleSheet.absoluteFillObject}>
            <CategoryFlow
              flow={flow}
              setFlow={setFlow as any}
              coinCount={coinCount}
              onRun={handleRun}
              onClose={() => setFlow(null)}
              onOpenSettings={() => setShowPwConfig(true)}
              onAbortJob={handleAbortJob}
              passportPortrait={passportPortrait}
              onOpenFullscreen={itemId => {
                setFlow(null);
                setViewerItemId(itemId);
              }}
            />
          </View>
        )}

        {showPwConfig && (
          <View style={StyleSheet.absoluteFillObject}>
            <PasswordConfig onClose={() => setShowPwConfig(false)} />
          </View>
        )}
      </View>

      {viewerItem && (
        <FullscreenViewer
          item={viewerItem}
          onClose={() => setViewerItemId(null)}
          onDelete={() => void handleDeleteItem(viewerItem)}
          onRedo={() => handleRedoItem(viewerItem)}
          onUseAsProfileImage={onUseAsProfileImage}
        />
      )}

      {monitorItem && (
        <View style={StyleSheet.absoluteFillObject}>
          <JobMonitorSheet
            item={monitorItem}
            onClose={() => setMonitorItem(null)}
            onAbort={item => {
              void updateLibraryItem(item.id, { status: 'failed', errorMsg: 'Aborted by user' });
              if (item.coinCost > 0) onAddCoins(item.coinCost);
              setMonitorItem(null);
              refresh();
            }}
          />
        </View>
      )}

      {eggVisible && (
        <EasterEggPanel
          loading={eggLoading}
          resultUri={eggResultUri}
          promptUsed={eggPrompt}
          onClose={() => { setEggVisible(false); setEggResultUri(null); }}
        />
      )}
    </Modal>
  );
};

export default CoinShopOverlay;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070709' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },

  statusStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 20, borderRadius: 10, paddingVertical: 7, marginBottom: 4,
  },
  statusText:    { color: '#555', fontSize: 11 },
  statusRefresh: { color: '#ff9f6b', fontSize: 13 },

  scroll: { paddingHorizontal: IS_IPAD ? 40 : 16, paddingTop: 10, gap: 24 },
  panel:  { alignItems: 'center', gap: 8 },

  // ── Coin widget ──
  coinRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6, marginTop: 6,
  },
  coinPressable: { alignItems: 'center', justifyContent: 'center' },
  bigCoin:       { fontSize: IS_IPAD ? 72 : 58 },
  coinVideo:     { width: IS_IPAD ? 80 : 64, height: IS_IPAD ? 80 : 64, borderRadius: 40 },
  coin3dLabel: {
    position: 'absolute', bottom: -4, right: -6,
    backgroundColor: '#ff9f6b', color: '#000',
    fontSize: 9, fontWeight: '900',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5,
  },
  coinInfo:    { flex: 1, gap: 2 },
  coinCount:   { color: '#ff9f6b', fontSize: IS_IPAD ? 52 : 42, fontWeight: '900', letterSpacing: -2 },
  coinLabel:   { color: 'rgba(255,159,107,0.5)', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 2 },
  coinUserName: { color: '#555', fontSize: 12, marginTop: 2 },

  headerBox: {
    marginTop: 12, backgroundColor: 'rgba(255,159,107,0.06)',
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,159,107,0.2)',
    padding: 18, width: '100%', maxWidth: IS_IPAD ? 600 : undefined, gap: 8,
  },
  headerTitle: { color: '#ff9f6b', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  headerDesc:  { color: '#bbb', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  headerHint:  { color: '#444', fontSize: 11, textAlign: 'center' },

  sectionHeader: { color: '#fff', fontSize: 16, fontWeight: '800', alignSelf: 'flex-start', marginBottom: 10 },

  // ── Category cards ──
  catGrid: {
    flexDirection: 'row',
    gap: IS_IPAD ? 16 : 10,
    width: '100%',
    maxWidth: IS_IPAD ? 640 : undefined,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  catCard: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 20,
    borderWidth: 1.5,
    padding: IS_IPAD ? 20 : 16,
    alignItems: 'center',
    gap: 8,
    minWidth: 90,
  },
  catTitle:  { fontSize: IS_IPAD ? 15 : 13, fontWeight: '900', letterSpacing: 1 },
  catCost:   { fontSize: 10, color: '#555', fontWeight: '600' },

  // ── Library ──
  libHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
  libEmpty:      { alignItems: 'center', paddingVertical: 40, gap: 12 },
  libEmptyText:  { color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 22 },
  libCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#1e1e1e',
    padding: 12, marginBottom: 8,
    width: '100%', maxWidth: IS_IPAD ? 620 : undefined, alignSelf: 'center',
  },
  libThumb: {
    width: 54, height: 54, borderRadius: 10, backgroundColor: '#1a1a1a',
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  libThumbImg:  { width: 54, height: 54 },
  libThumbIcon: { fontSize: 26 },
  libLabel:     { color: '#fff', fontSize: 13, fontWeight: '600' },
  libMeta:      { color: '#555', fontSize: 10, marginTop: 1 },
  libError:     { color: '#f44', fontSize: 11, marginTop: 2 },
  statusDot:    { width: 7, height: 7, borderRadius: 4 },

  // ── Viewer ──
  viewerBg:    { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 56, right: 20 },
  viewerBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingTop: 12, paddingHorizontal: 24,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  viewerActionBtn:   { alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 20, borderRadius: 12 },
  viewerActionIcon:  { fontSize: 24 },
  viewerActionLabel: { color: '#ccc', fontSize: 11, fontWeight: '600' },
  arBtn: {
    backgroundColor: 'rgba(255,159,107,0.15)', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#ff9f6b',
    paddingHorizontal: 36, paddingVertical: 16, marginTop: 8,
  },
  arBtnText: { color: '#ff9f6b', fontWeight: '800', fontSize: 17 },

  // ── Modals / sheets ──
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  sheetBox: {
    backgroundColor: '#111', borderRadius: 24, borderWidth: 1,
    borderColor: 'rgba(255,159,107,0.25)',
    padding: 22, alignItems: 'center', width: '100%',
    maxWidth: IS_IPAD ? 480 : 390, gap: 10,
  },
  sheetHeader:   { flexDirection: 'row', alignItems: 'center' },
  sheetTitle:    { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  sheetDesc:     { color: '#999', fontSize: 12, lineHeight: 18, textAlign: 'center', width: '100%' },

  backRow:   { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 6 },
  backArrow: { color: '#ff9f6b', fontSize: 20, marginRight: 4 },
  backLabel: { color: '#ff9f6b', fontSize: 13, fontWeight: '600' },

  // ── Subtype rows ──
  subtypeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 14, borderWidth: 1,
    padding: 14, width: '100%', gap: 8,
  },
  subtypeTitle: { fontSize: 14, fontWeight: '800' },
  subtypeDesc:  { color: '#666', fontSize: 11, marginTop: 2 },
  subtypeCost:  { fontSize: 11, fontWeight: '700' },

  // ── Options ──
  optionPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a',
    padding: 12, width: '100%', marginBottom: 4,
  },
  optionPillText: { color: '#ccc', fontSize: 13 },

  frameBtn:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  frameBtnActive: { borderColor: '#ff9f6b', backgroundColor: 'rgba(255,159,107,0.15)' },

  presetBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: 'rgba(255,159,107,0.3)' },
  presetBtnText: { color: '#ff9f6b', fontSize: 11, fontWeight: '700' },

  costRow:   { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 10, width: '100%', flexDirection: 'row', justifyContent: 'center' },
  costLabel: { color: '#ff9f6b', fontSize: 12, fontWeight: '700' },

  // ── Preview images ──
  previewLarge: { width: IS_IPAD ? 200 : 160, height: IS_IPAD ? 200 : 160, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(255,159,107,0.4)' },
  previewSmall: { width: 90, height: 90, borderRadius: 12, borderWidth: 1, borderColor: '#333' },
  previewMini:  { width: 60, height: 60, borderRadius: 10 },

  // ── Buttons ──
  btnPrimary: {
    backgroundColor: 'rgba(255,159,107,0.9)', borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 24,
    alignItems: 'center', width: '100%', marginTop: 4,
  },
  btnPrimaryText:    { color: '#000', fontWeight: '800', fontSize: 15 },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 24,
    alignItems: 'center', width: '100%', marginTop: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  btnSecondaryText: { color: '#ccc', fontWeight: '700', fontSize: 14 },
  btnBack:          { paddingVertical: 10 },
  btnBackText:      { color: '#555', fontSize: 13 },

  textInput: {
    backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1, borderColor: '#333',
    color: '#fff', fontSize: 13, padding: 12, width: '100%', textAlignVertical: 'top',
    minWidth: 0, flexShrink: 1,
  },

  // ── Progress log ──
  logBox: {
    backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a',
    padding: 10, width: '100%',
  },
  logLine: { color: '#7eb8ff', fontSize: 11, lineHeight: 18, fontFamily: 'monospace' },

  // ── Processing panel extras ──
  processingPromptBox: {
    width: '100%', backgroundColor: 'rgba(126,184,255,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(126,184,255,0.2)',
    padding: 10, marginBottom: 8,
  },
  processingPrompt: { color: '#7eb8ff', fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  progressBarBg: {
    width: '100%', height: 6, backgroundColor: '#1a1a1a',
    borderRadius: 3, overflow: 'hidden', marginBottom: 4,
  },
  progressBarFill: { height: 6, backgroundColor: '#ff9f6b', borderRadius: 3 },
  progressBarLabel: { color: '#888', fontSize: 10, textAlign: 'right' },

  // ── App artwork picker ──
  artSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '75%', width: '100%', position: 'absolute', bottom: 0,
  },
  artThumb: { width: (SW - 48) / 3, height: (SW - 48) / 3, borderRadius: 8, backgroundColor: '#1a1a1a' },


  // ── Easter egg panel ──
  eggPanelBg: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 28 },
  eggPanelContent: { alignItems: 'center', gap: 18, width: '100%', maxWidth: IS_IPAD ? 520 : undefined },
  eggFoundTitle: { color: '#ff9f6b', fontSize: IS_IPAD ? 40 : 32, fontWeight: '900', textAlign: 'center', letterSpacing: 2 },
  eggFoundSub:   { color: '#ccc', fontSize: 15, lineHeight: 24, textAlign: 'center' },
  eggLoadingBox: {
    alignItems: 'center', gap: 14, width: '100%',
    backgroundColor: 'rgba(255,159,107,0.06)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,159,107,0.2)', padding: 22,
  },
  eggPromptText:  { color: '#666', fontSize: 12, fontStyle: 'italic', textAlign: 'center', lineHeight: 18 },
  eggResultImage: { width: IS_IPAD ? 380 : SW - 80, height: IS_IPAD ? 380 : SW - 80, borderRadius: 24, borderWidth: 2, borderColor: '#ff9f6b' },
  eggCloseBtn: {
    marginTop: 8, paddingHorizontal: 44, paddingVertical: 16,
    backgroundColor: 'rgba(255,159,107,0.15)', borderRadius: 16, borderWidth: 1, borderColor: '#ff9f6b',
  },
  eggCloseBtnText: { color: '#ff9f6b', fontWeight: '800', fontSize: 16 },
});
