# AcousticSim
## Browser-Based Binaural Loudspeaker Simulator
### Project Spec — Rev 1

---

## 1. Philosophy & Scope

AcousticSim is a **validation tool**, not a room acoustics suite. Its job is to answer a single question:

> *"What does this speaker system actually sound like from this position, given its real measured behavior?"*

It renders a loudspeaker's frequency response, directivity, and distance falloff binaurally in a browser — driven by real FRD measurement files exported from tools like AcousticBench or VituixCAD. The listener navigates a virtual 3D space and hears the speaker's polar behavior in real time: high frequencies roll off as they move off-axis, level drops with distance, and the binaural image shifts correctly with head orientation.

**What it does:**
- Render a speaker's measured on-axis and off-axis frequency response binaurally
- Apply inverse-square-law distance falloff from the speaker's measured sensitivity
- Visualize listener position relative to speaker in 3D with azimuth/distance readout
- Accept real `.frd` polar measurement sets as the acoustic source of truth

**What it intentionally does not do:**
- Room acoustics / reverberation modeling → EASE
- Multi-speaker array summation (V1 scope only)
- Personalized HRTFs
- Ground-plane reflection (stretch goal — see §7)

---

## 2. Technical Stack

| Layer | Library | Role |
|---|---|---|
| 3D Engine | `three.js` r128 | Scene, draggable objects, coordinate system |
| Audio Core | Web Audio API | Graph routing, GainNodes, ConvolverNodes |
| Spatialization | `resonance-audio` | Ambisonics HRTF, listener orientation, distance rolloff |
| FFT | `fft.js` (indutny) | FRD → IR conversion; ~8KB, handles complex arithmetic correctly |
| IFFT Processing | `IRGenerator.js` (custom) | Uniform-grid interpolation + IFFT + windowing pipeline |
| State | `AppState.js` (custom) | Single source of truth for positions, weights, loaded data |
| UI Controls | `lil-gui` | Real-time parameter tweaking |
| FR Display | `chart.js` | Live interpolated response overlay |
| Build | `Vite` | Fast ESM bundling, dev server |

**Install:**
```bash
npm create vite@latest acousticsim -- --template vanilla
cd acousticsim
npm install three resonance-audio fft.js lil-gui chart.js
```

---

## 3. System Architecture

### 3.1 Audio Pipeline

```
AudioBufferSourceNode (pink noise / sweep / WAV)
        │
        ├──► ConvolverNode A (lower polar angle FRD as IR)
        │         │
        │    GainNode A (crossfade weight α)
        │         │
        └──► ConvolverNode B (upper polar angle FRD as IR)
                  │
             GainNode B (crossfade weight 1-α)
                  │
             ┌────┴────┐
             │ Summation│  (GainNode, unity)
             └────┬────┘
                  │
          ResonanceAudio Source
          (distance rolloff + HRTF)
                  │
          ResonanceAudio Scene
          (listener orientation + binaural decode)
                  │
          AudioContext.destination
```

**Why this ordering matters:** Directivity coloring (the ConvolverNodes) is applied *before* the Resonance source. Resonance owns HRTF and distance. These are independent effects and must not be merged or double-applied.

### 3.2 Dual-Convolver Crossfading (Glitch-Free Directivity)

Naively swapping a `ConvolverNode` buffer mid-playback causes an audible click. The parallel A/B architecture avoids this:

1. At startup / FRD upload, all polar angles are pre-converted to `AudioBuffer` IRs and cached.
2. At any listener position, the two nearest polar angles (e.g., 30° and 45°) are loaded into **Convolver A** and **Convolver B** respectively.
3. As the listener moves, only the **Gain** of each convolver is adjusted — no buffer swaps during audio playback.
4. When the listener crosses into a new angular bracket (e.g., from [30°–45°] to [45°–60°]), the buffer swap happens on the **currently silent** convolver only, after its gain has crossfaded to zero.

```js
// DirectivityModel.js — crossfade logic sketch
update(azimuthDeg) {
  const { lowerAngle, upperAngle, alpha } = this.getBracket(azimuthDeg);

  // Only adjust gains — never swap buffers mid-crossfade
  this.gainA.gain.linearRampToValueAtTime(1 - alpha, ctx.currentTime + XFADE_TIME);
  this.gainB.gain.linearRampToValueAtTime(alpha,     ctx.currentTime + XFADE_TIME);

  // Swap the silent node's buffer after crossfade completes
  setTimeout(() => {
    if (alpha > 0.5) {
      this.convolverA.buffer = this.irCache[lowerAngle]; // A is now silent
    } else {
      this.convolverB.buffer = this.irCache[upperAngle]; // B is now silent
    }
  }, XFADE_TIME * 1000 + 10);
}
```

### 3.3 Coordinate System

Both Three.js and Resonance Audio use **right-handed, Y-up** coordinates. Speaker and listener positions are read from Three.js `Object3D.matrixWorld` and passed directly to Resonance without transformation.

Directivity angle is computed in the **speaker's local space**:
```js
// MathUtils.js
function getListenerAzimuth(speakerObj, listenerPos) {
  // Transform listener into speaker's local coordinate frame
  const local = speakerObj.worldToLocal(listenerPos.clone());
  // Azimuth from speaker's forward axis (+Z)
  return Math.atan2(local.x, local.z) * (180 / Math.PI);
}
```
This means dragging the speaker object rotates its forward axis correctly — the HF lobe follows the speaker's physical orientation in the scene.

---

## 4. FRD → Impulse Response Pipeline

This is the most critical implementation detail. FRD files are **log-spaced in frequency** and cannot be IFFTed directly. The conversion must go through a uniform linear frequency grid.

### 4.1 Full Conversion Sequence (IRGenerator.js)

```js
import FFT from 'fft.js';

const IR_SIZE = 2048;       // Samples. Sufficient for speaker coloration; keep short.
const SAMPLE_RATE = 48000;  // Must match AudioContext sampleRate

function frdToAudioBuffer(parsedFRD, audioCtx) {
  const { freqs, magDb, phaseDeg } = parsedFRD;
  const N = IR_SIZE;
  const numBins = N / 2 + 1;

  // Step 1: Build uniform linear frequency grid (0 → Nyquist)
  const uniformFreqs = Array.from({ length: numBins },
    (_, k) => k * SAMPLE_RATE / N
  );

  // Step 2: Interpolate FRD (log-spaced) onto uniform grid
  // Use linear interpolation in log-frequency space for smooth results
  const uniformMagDb    = interpolateLogFreq(freqs, magDb,    uniformFreqs);
  const uniformPhaseDeg = interpolateLogFreq(freqs, phaseDeg, uniformFreqs);

  // Step 3: Convert to complex spectrum with conjugate symmetry
  // (required to produce a real-valued IFFT output)
  const fft = new FFT(N);
  const complexSpectrum = new Float32Array(N * 2); // interleaved [re, im, re, im, ...]

  for (let k = 0; k < numBins; k++) {
    const amp   = Math.pow(10, uniformMagDb[k] / 20);
    const phase = uniformPhaseDeg[k] * Math.PI / 180;
    const re = amp * Math.cos(phase);
    const im = amp * Math.sin(phase);
    complexSpectrum[2 * k]     = re;
    complexSpectrum[2 * k + 1] = im;
    // Mirror for conjugate symmetry (real output)
    if (k > 0 && k < N / 2) {
      complexSpectrum[2 * (N - k)]     =  re;
      complexSpectrum[2 * (N - k) + 1] = -im;
    }
  }

  // Step 4: IFFT
  const ir = new Float32Array(N);
  fft.inverseTransform(ir, complexSpectrum);
  fft.fromComplexArray(ir, ir); // extract real part in-place

  // Step 5: Apply Tukey window to IR (not to spectrum)
  // Suppresses edge artifacts; alpha=0.15 is a light taper
  applyTukeyWindow(ir, 0.15);

  // Step 6: Normalize peak to prevent clipping
  const peak = Math.max(...ir.map(Math.abs));
  if (peak > 0) ir.forEach((v, i) => ir[i] = v / peak);

  // Step 7: Load into AudioBuffer
  const buffer = audioCtx.createBuffer(1, N, SAMPLE_RATE);
  buffer.copyToChannel(ir, 0);
  return buffer;
}
```

### 4.2 Minimum Phase — Default On

Interpolating two **mixed-phase** IRs causes comb filtering as the direct-sound arrival time shifts between polar angles. Interpolating **minimum-phase** IRs is well-behaved because energy is front-loaded and time-aligned across angles.

**Minimum phase should be the default operating mode.** The UI exposes a "Use Raw Phase" toggle for users who have verified phase from a gated IR measurement (e.g., AcousticBench exports) and explicitly want it preserved.

```js
// In IRGenerator.js — applied before IFFT
function enforceMinimumPhase(magDb) {
  // Cepstral method:
  // 1. Convert magnitude to log magnitude
  // 2. IFFT → cepstrum
  // 3. Zero the anti-causal half
  // 4. FFT back → minimum phase spectrum
  // Phase is now uniquely determined by the magnitude — no cross-angle time shifts
}
```

Note: AcousticBench-exported FRDs (gated IR → FFT) have reliable phase. Manufacturer datasheets often do not. When in doubt, minimum phase is the safer default.

### 4.3 Web Worker Offload

All FRD-to-IR conversions happen in a `Worker` at upload time, not on the main thread. The main thread receives completed `AudioBuffer` objects and caches them in `PolarDataStore`.

```js
// IRWorker.js
self.onmessage = ({ data }) => {
  const { parsedFRD, angle, irSize, sampleRate, minimumPhase } = data;
  const ir = frdToIR(parsedFRD, irSize, sampleRate, minimumPhase);
  self.postMessage({ angle, ir }, [ir.buffer]); // transfer, don't copy
};
```

---

## 5. Polar Data Model

### 5.1 Angle Convention & Rear Hemisphere Policy

- Angles are stored as **signed azimuth in degrees**: −180° to +180°, where 0° = on-axis forward.
- Most measurement sets cover 0°–90° horizontal. For V1, values are **mirrored symmetrically**: `getIR(−37°)` returns the same IR as `getIR(+37°)`.
- Angles > 90° (rear hemisphere): **clamp to 90°** in V1 with a visible HUD warning ("Listener behind speaker — rear hemisphere not modeled"). Do not extrapolate.
- This policy is explicit in `PolarDataStore.getWeightedPair(azimuth)`.

### 5.2 Data Structure (PolarDataStore.js)

Designed to accommodate elevation in V1's data model even though only the horizontal plane is populated initially. Retrofitting elevation interpolation later should not require restructuring this.

```js
// PolarDataStore.js
class PolarDataStore {
  // Key: `${azimuthDeg}_${elevationDeg}`  e.g. "30_0", "45_0"
  // Value: AudioBuffer (pre-converted IR)
  irCache = new Map();

  // Loaded angle set for the current speaker — horizontal plane only in V1
  loadedAzimuths = [];   // e.g. [0, 15, 30, 45, 60, 75, 90]
  loadedElevations = []; // e.g. [0]  — stub for future vertical expansion

  set(azimuthDeg, elevationDeg = 0, audioBuffer) { ... }
  get(azimuthDeg, elevationDeg = 0) { ... }

  getWeightedPair(azimuthDeg, elevationDeg = 0) {
    // Returns { lowerAngle, upperAngle, alpha }
    // Applies mirroring for negative azimuths
    // Clamps and warns for |azimuth| > 90°
  }
}
```

### 5.3 FRD Filename Convention

Files are mapped to angles by filename:
```
speaker_000deg.frd   →  0°
speaker_015deg.frd   →  15°
speaker_030deg.frd   →  30°
speaker_045deg.frd   →  45°
speaker_060deg.frd   →  60°
speaker_075deg.frd   →  75°
speaker_090deg.frd   →  90°
```
The parser also accepts `speaker_-030deg.frd` for explicit rear-hemisphere files (future support).

---

## 6. Distance Model

**Resonance Audio owns distance rolloff.** Do not compute an additional manual `1/d` rolloff — this would double-attenuate. The integration is:

```js
// AudioEngine.js
resonanceSource.setPosition(speakerX, speakerY, speakerZ);
resonanceSource.setRolloff('logarithmic');

// Reference distance = 1m (all FRD sensitivity values are at 1m by convention)
// Resonance will compute attenuation from there automatically
```

The **SPL vs. Distance overlay** in the UI is a *display* computation only — it derives the theoretical curve from the on-axis FRD sensitivity and inverse square law for the chart, but does not feed back into the audio graph.

```js
// DistanceFalloff.js — display only, no audio graph involvement
function splAtDistance(sensitivityDb1m, distanceM) {
  return sensitivityDb1m - 20 * Math.log10(distanceM);
}
```

---

## 7. Project Structure

```
acousticsim/
├── index.html
├── vite.config.js
├── package.json
├── src/
│   ├── main.js                  # Bootstrap: scene + audio + state + loop
│   ├── state/
│   │   └── AppState.js          # Single source of truth: positions, weights, mode flags
│   ├── scene/
│   │   ├── SceneManager.js      # Three.js setup, render loop, ortho/perspective toggle
│   │   ├── SpeakerObject.js     # Draggable mesh + forward-axis gizmo
│   │   └── ListenerObject.js    # Binaural head mesh, head orientation binding
│   ├── audio/
│   │   ├── AudioEngine.js       # Web Audio context, Resonance scene, master graph
│   │   ├── DirectivityModel.js  # Dual-convolver A/B, crossfade gain logic
│   │   ├── IRGenerator.js       # FRD → uniform grid → IFFT → AudioBuffer
│   │   ├── IRWorker.js          # Web Worker wrapper for IRGenerator
│   │   └── Stimulus.js          # Pink noise, log sweep, WAV file player
│   ├── data/
│   │   ├── FRDParser.js         # Tab-separated .frd → {freqs, magDb, phaseDeg}
│   │   └── PolarDataStore.js    # IR cache keyed by (azimuth, elevation)
│   ├── ui/
│   │   ├── HUD.js               # Distance / azimuth / rear-hemisphere warning
│   │   ├── FRChart.js           # Live interpolated FR + SPL-vs-distance chart
│   │   ├── DropZone.js          # Drag-and-drop FRD file intake
│   │   └── UIManager.js         # lil-gui panel wiring
│   ├── utils/
│   │   ├── MathUtils.js         # Polar interpolation, azimuth calc, log-freq interp
│   │   └── WindowFunctions.js   # Tukey, Hann window generators
│   └── presets/
│       └── SyntheticSpeakers.js # Built-in: flat, 6dB/oct roll, horn preset FRDs
└── public/
    └── sample_frd/              # Example polar set for demo without upload
```

---

## 8. UI Layout

### Scene View (main canvas)
- Top-down orthographic by default; perspective toggle in toolbar
- Speaker object: box mesh with a visible forward-axis arrow (+Z direction)
- Listener object: simple head icon
- Wireframe polar fan overlay showing loaded measurement angles
- Drag either object with mouse; positions sync to AppState on every frame

### HUD Overlay (top-left)
```
Azimuth:   34.2°  (off-axis)
Distance:  2.8 m
SPL est:   81.4 dB  (on-axis sensitivity − distance rolloff)
[⚠ Rear hemisphere — clamped to 90°]   ← shown only when applicable
```

### Right Panel (lil-gui)
- Stimulus: Pink Noise / Log Sweep / WAV Upload selector
- Master output level (dB)
- Min Phase: **ON** (default) / Raw Phase toggle
- IR Size: 1024 / 2048 (default) selector
- Preset speaker selector (Flat / Horn / Woofer / Custom)
- Distance model: Logarithmic (default) / Linear toggle

### Bottom Panel (chart.js)
- **FR tab:** Live interpolated frequency response at current listener position (updates on move)
- **SPL vs. Distance tab:** On-axis SPL curve with current listener position marker

---

## 9. Stimulus Sources

| Source | Implementation | Use case |
|---|---|---|
| Pink noise | Pre-baked 5s `AudioBuffer`, looping | General listening / directivity feel |
| Log sweep | Pre-generated WAV loaded at startup | Diagnostic — hear each frequency move through the polar map |
| User WAV | `FileReader` → `decodeAudioData` | Pass program material through the speaker model |

The log sweep is the most diagnostic stimulus for this use case. It lets you hear the polar behavior frequency-by-frequency as the sound sweeps from 20 Hz to 20 kHz.

---

## 10. Implementation Roadmap

### Phase 1 — Foundation (Silent Scene)
- [ ] Vite + Three.js scaffolding
- [ ] `AppState.js` with reactive position tracking
- [ ] Draggable `SpeakerObject` and `ListenerObject` meshes
- [ ] HUD: azimuth and distance readout, updating live
- [ ] Ortho / perspective toggle
- [ ] Polar fan wireframe overlay

### Phase 2 — Spatial Audio (Generic Speaker)
- [ ] Web Audio context + Resonance Audio scene init
- [ ] Pink noise source → Resonance → binaural output
- [ ] Three.js position → Resonance listener sync on `requestAnimationFrame`
- [ ] Head orientation: camera forward/up → `resonanceScene.setListenerOrientation()`
- [ ] Validate: pink noise pans correctly as listener moves

### Phase 3 — FRD Data Pipeline
- [ ] `FRDParser.js`: tab-separated → `{freqs, magDb, phaseDeg}`
- [ ] Drag-and-drop `DropZone.js` with filename-to-angle mapping
- [ ] `IRGenerator.js`: full pipeline (§4.1) including uniform-grid interpolation
- [ ] `IRWorker.js`: offload conversion to Web Worker
- [ ] `PolarDataStore.js` with mirror + clamp + rear-hemisphere warning
- [ ] `FRChart.js`: plot uploaded FRD to validate parse is correct before touching audio

### Phase 4 — Directivity Engine
- [ ] `DirectivityModel.js`: dual-convolver A/B setup
- [ ] Crossfade gain logic on listener move
- [ ] Buffer swap on silent convolver post-crossfade
- [ ] Minimum phase enforced by default; raw phase toggle
- [ ] Integration test: move listener from 0° → 90° and hear HF roll off smoothly

### Phase 5 — Polish & Presets
- [ ] Synthetic speaker presets (`SyntheticSpeakers.js`)
- [ ] SPL-vs-distance chart with live listener position marker
- [ ] Log sweep stimulus
- [ ] WAV upload stimulus
- [ ] CSS layout and dark theme
- [ ] README with AcousticBench FRD export → AcousticSim workflow

---

## 11. Key Decisions & Trade-offs

| Decision | Choice | Rationale |
|---|---|---|
| Minimum phase on by default | Yes | Mixed-phase polar interpolation causes comb filtering; min-phase is always safe |
| Uniform grid interpolation before IFFT | Required | FRD files are log-spaced; direct IFFT of raw data produces aliased IR |
| `fft.js` (indutny) as FFT library | Yes | Correct complex arithmetic, ~8KB, well-tested in audio contexts |
| Resonance Audio owns distance rolloff | Yes | Prevents double-attenuation; one authority per effect |
| Elevation axis stubbed in data model | Yes | Retrofit-proof; vertical directivity is real for alert speaker systems |
| Rear hemisphere clamped to 90° + warning | Yes | Extrapolation beyond measured data is worse than clamping |
| IR size capped at 2048 samples | Yes | Speaker coloration needs no long tail; keeps ConvolverNode overhead low |
| Web Worker for IR conversion | Yes | Main-thread IFFT will cause audio dropout on FRD upload |
| Buffer swap only on silent convolver | Yes | Prevents audible clicks on polar bracket transitions |
| Phase always stored in HDF5 / FRD | Yes | Required for gated-IR round-trip; min-phase applied at render time, not baked |

---

## 12. Integration with AcousticBench

AcousticSim is designed as the downstream consumer of AcousticBench polar measurement exports:

1. **AcousticBench** runs a polar sequence: FRFMeasure at 0°, 15°, 30° … 90°, exports `speaker_{angle:03d}deg.frd` per VituixCAD naming convention
2. **AcousticSim** accepts the folder drag-drop, parses all angles, converts to IRs in the Worker, and the speaker is immediately listenable
3. BenchMind pre-export check ("Ready for AcousticSim?") validates: polar coverage complete, phase present, SR matches, sensitivity logged

The `phase_deg` column in AcousticBench's gated-IR-derived FRD exports is reliable — the "Use Raw Phase" toggle is the right default for these files. For imported manufacturer datasheets or non-gated measurements, minimum phase should remain on.

---

*AcousticSim — Rev 1*
*A focused directivity validation tool, not a room acoustics simulator.*