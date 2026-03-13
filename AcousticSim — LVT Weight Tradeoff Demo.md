AcousticSim — LVT Weight Tradeoff Demo
## Development Specification — Rev 1

---

## 1. Purpose & Context

AcousticSim's original scope is a single-speaker directivity validation tool. The LVT engagement requires it to serve a more specific role: a **stakeholder decision tool** that lets LVT designers hear the perceptual difference between speaker configurations at different weight targets, at the actual deployment range (30m), using voice content.

The critical finding from the weight tradeoff analysis is that the audible leap from "alert tone" to "authoritative voice" happens at the 10 lb threshold. Below 10 lb, the driver budget cannot accommodate a midrange — the system covers 800 Hz–12 kHz and sounds thin. At 10 lb, the midrange extends coverage to 250 Hz and the voice gains body, presence, and perceived authority.

No amount of specification analysis substitutes for hearing the difference. AcousticSim is the tool that delivers that experience.

This document specifies the development work required to get there, organized as a four-phase development sequence. Each phase produces a testable, demonstrable increment. Phase 1 is the critical feature; phases 2–4 can be delivered incrementally.

---

## 2. Development Sequence Overview

| Phase | Feature | Priority | Depends On |
|---|---|---|---|
| **D1** | Configuration A/B/C switching | Critical | — |
| **D2** | LVT-specific synthetic speaker presets | Critical | D1 |
| **D3** | Built-in voice stimulus | High | — |
| **D4** | Scene rescaling and SPL calibration | High | D2 |

**D1 + D2 + D3** together produce a usable demo. D4 refines the experience for the actual Phase A stakeholder sessions.

---

## 3. Phase D1 — Configuration A/B/C Switching

### 3.1 Problem

AcousticSim renders one speaker at a time. There is no mechanism to define multiple speaker configurations and switch between them during playback. The demo requires instant toggling — voice content plays continuously while the listener compares configurations. Any interruption (silence gap, click, reload) breaks the perceptual contrast.

### 3.2 Design

#### SpeakerConfiguration class

A new data structure that bundles everything needed to render a speaker system:

```
SpeakerConfiguration {
  id: string               // e.g., "lvt_5lb", "lvt_10lb"
  name: string             // Display name: "5 lb — Compression Only"
  description: string      // One-line summary for the UI
  sensitivity: number      // On-axis sensitivity in dB SPL at 1m
  bandwidthLabel: string   // e.g., "800 Hz – 12 kHz"
  frdSet: Map<number, FRD> // Angle -> parsed FRD data
  irSet: Map<number, AudioBuffer> // Angle -> pre-converted IR (populated on load)
  color: string            // UI accent color for visual differentiation
}
```

#### ConfigurationManager

Manages the set of loaded configurations and handles switching:

```
ConfigurationManager {
  configurations: Map<string, SpeakerConfiguration>
  activeConfigId: string
  previousConfigId: string  // For "toggle back" / A/B comparison

  loadConfiguration(config: SpeakerConfiguration): void
  switchTo(configId: string): void
  toggleAB(): void   // Switch between active and previous
  getActive(): SpeakerConfiguration
}
```

#### New files

| File | Location | Purpose |
|---|---|---|
| `SpeakerConfiguration.js` | `src/data/` | Configuration data class |
| `ConfigurationManager.js` | `src/data/` | Load, store, and switch configurations |

#### Audio graph changes — dual DirectivityModel architecture

The current single `DirectivityModel` must be extended to support instant switching. The approach: **two parallel DirectivityModel instances** with a master crossfade between them.

```
Stimulus Output
      │
      ├──► DirectivityModel A ──► GainNode A ──┐
      │                                         │
      └──► DirectivityModel B ──► GainNode B ──┤
                                                │
                                           SumGain ──► ResonanceSource
```

At any time, one DirectivityModel is "active" (gain = 1) and the other is "standby" (gain = 0). On configuration switch:

1. Pre-load the new configuration's IRs into the **standby** DirectivityModel
2. Update the standby DirectivityModel's polar data store
3. Crossfade master gains: active → 0, standby → 1 (50ms ramp)
4. Swap active/standby labels

This reuses the same parallel A/B pattern already proven in DirectivityModel for polar angle transitions, applied one level up.

#### Modifications to existing files

| File | Change |
|---|---|
| `AudioEngine.js` | Instantiate two `DirectivityModel` instances. Add `switchConfiguration(configId)` method that triggers the master crossfade. Expose `configurationManager` reference. |
| `AppState.js` | Add `activeConfiguration` (string), `configurations` (array of loaded config metadata). Add `setActiveConfiguration(id)` with subscriber notification. |
| `UIManager.js` | Add Configuration selector dropdown in a new "Configuration" folder. Wire keyboard shortcuts. |
| `main.js` | Initialize `ConfigurationManager`. On configuration switch, update HUD sensitivity, chart sensitivity, and active DirectivityModel. |

#### Keyboard shortcuts

| Key | Action |
|---|---|
| `1` | Switch to configuration slot 1 (e.g., 5 lb) |
| `2` | Switch to configuration slot 2 (e.g., 7 lb) |
| `3` | Switch to configuration slot 3 (e.g., 10 lb) |
| `Space` | Toggle A/B between current and previous configuration |
| `P` | Play/Stop toggle |

These must work during playback without interrupting audio. The keyboard handler fires `configurationManager.switchTo()` which triggers the master crossfade.

#### UI additions

- **Configuration indicator**: Persistent banner at the top of the HUD showing the active configuration name, bandwidth label, and a colored dot matching `config.color`. This changes instantly on switch so the listener knows which configuration they're hearing.
- **Configuration selector**: Dropdown in the lil-gui panel listing all loaded configurations. Selecting one triggers the switch.
- **Keyboard hint**: Small text below the HUD — "Press 1/2/3 to switch · Space to A/B" — dismissable after first use.

### 3.3 Acceptance Criteria

- [ ] Three configurations can be loaded simultaneously
- [ ] Switching between configurations during playback produces no audible click, pop, or silence gap
- [ ] The crossfade between configurations is ≤100ms (perceptually instant, not a slow morph)
- [ ] Keyboard shortcuts 1/2/3/Space work during playback
- [ ] HUD updates immediately to reflect the active configuration's name and sensitivity
- [ ] The frequency response chart reflects the active configuration's data at the current listener position

---

## 4. Phase D2 — LVT-Specific Synthetic Speaker Presets

### 4.1 Problem

The existing presets (flat, bookshelf, horn, woofer) are generic archetypes. The LVT demo needs presets that model the actual weight configurations using real driver data from the feasibility analysis.

### 4.2 Design

#### Three new presets in SyntheticSpeakers.js

Each preset generates a set of FRD data (0°–90° in 15° steps) that models the system's frequency response and directivity.

**Preset: `lvt_5lb` — "5 lb: Single Compression Driver"**

Source data: FaitalPRO HF102 (107 dB/W/m) + ABS CD horn (90° × 60°)

- Frequency range: 800 Hz – 12 kHz
- On-axis sensitivity: 111 dB/W/m (107 dB driver + ~4 dB horn loading)
- SPL at 1m (25W): ~125 dB
- Below 800 Hz: 18 dB/octave rolloff (compression driver natural rolloff + horn cutoff)
- Above 12 kHz: 12 dB/octave rolloff
- Directivity: 90° horn pattern — moderate beaming above 4 kHz, ±3 dB within 45° of axis, steep rolloff beyond 60°
- Horn resonance character: subtle 1–2 dB ripple in 1–3 kHz region

**Preset: `lvt_7lb` — "7 lb: 4× Compression Array"**

Source data: 4× FaitalPRO HF102 + 4× ABS horns in composite array

- Frequency range: 800 Hz – 12 kHz (same bandwidth as 5 lb)
- On-axis sensitivity: 116 dB/W/m (111 dB single-driver + ~5 dB array gain)
- SPL at 1m (25W): ~130 dB
- Below 800 Hz: 18 dB/octave rolloff (identical to 5 lb)
- Above 12 kHz: 12 dB/octave rolloff
- Directivity: composite ~180° coverage — much flatter off-axis response than 5 lb single horn. Model as ±3 dB within 80° of axis, gradual rolloff to 90°. The key difference from 5 lb is coverage uniformity, not bandwidth.
- Horn character: same 1–2 dB ripple, slightly smoothed by array summation

**Preset: `lvt_10lb` — "10 lb: 2-Way (Midrange + Compression Array)"**

Source data: 4× FaitalPRO HF102 array + 18 Sound 6ND410 midrange (102 dB/W/m in-band)

- Frequency range: **250 Hz – 12 kHz** (this is the critical difference)
- On-axis sensitivity (midrange band): 102 dB/W/m from 250–3500 Hz
- On-axis sensitivity (HF band): 116 dB/W/m from 3500–12000 Hz
- Crossover: 3.5 kHz, 12 dB/octave Linkwitz-Riley alignment
- Below 250 Hz: 12 dB/octave rolloff (sealed midrange in ~4L volume)
- Above 12 kHz: 12 dB/octave rolloff
- Midrange directivity: wide below 1 kHz (effectively omnidirectional for a 6.5" driver), progressive narrowing above 1 kHz with ~120° –6 dB coverage at 3 kHz
- HF directivity: same composite array pattern as 7 lb
- Crossover interaction: model a ~1–2 dB dip at crossover when off-axis (natural consequence of differing driver directivities at the handoff frequency)

#### FRD generation implementation

Each preset function generates frequency response curves for each angle by:

1. Computing the on-axis magnitude using the sensitivity, crossover filter shape, and band limits
2. Applying an angle-dependent directivity function per frequency — derived from driver diameter and horn coverage data
3. Adding realistic character features (horn ripple, crossover interaction, baffle step)

The directivity model for each band should use the standard `ka` beaming approximation: a cone driver of diameter `d` begins to beam at `f = c / (π · d)` where `c` = 343 m/s. Above this frequency, off-axis response rolls off proportional to `(angle/90)² · beamingFactor`. For horns, the coverage angle defines a plateau region within which the response is approximately flat, with a steep rolloff beyond the coverage edge.

#### Preset metadata for ConfigurationManager

Each preset should also export a `SpeakerConfiguration` object (from D1) that bundles the FRD set with display metadata:

```js
export function getLVTConfigurations() {
  return [
    {
      id: 'lvt_5lb',
      name: '5 lb — Single Compression',
      description: '1× HF102 + CD horn · 800 Hz–12 kHz · 90° coverage',
      sensitivity: 111,
      bandwidthLabel: '800 Hz – 12 kHz',
      color: '#e57373',  // Red — alert: no midrange
    },
    {
      id: 'lvt_7lb',
      name: '7 lb — Compression Array',
      description: '4× HF102 + array · 800 Hz–12 kHz · 180° coverage',
      sensitivity: 116,
      bandwidthLabel: '800 Hz – 12 kHz',
      color: '#ffb74d',  // Amber — better coverage, still no midrange
    },
    {
      id: 'lvt_10lb',
      name: '10 lb — 2-Way System',
      description: '4× HF102 + 6ND410 mid · 250 Hz–12 kHz · 180°/120°',
      sensitivity: 102, // Midrange sensitivity (dominant for voice content)
      bandwidthLabel: '250 Hz – 12 kHz',
      color: '#81c784',  // Green — full voice band
    },
  ];
}
```

#### Modifications to existing files

| File | Change |
|---|---|
| `SyntheticSpeakers.js` | Add `generateLVT5lb()`, `generateLVT7lb()`, `generateLVT10lb()` functions. Add `getLVTConfigurations()` export. |
| `UIManager.js` | Add "LVT Demo" as a preset group in the preset dropdown. Selecting it loads all three configurations into the ConfigurationManager and activates the first. |
| `DropZone.js` | Add `loadLVTDemo()` method that generates all three presets, creates SpeakerConfiguration objects, and registers them with ConfigurationManager. |

### 4.3 Acceptance Criteria

- [ ] All three LVT presets generate valid FRD data at 0°, 15°, 30°, 45°, 60°, 75°, 90°
- [ ] The 5 lb and 7 lb presets produce negligible energy below 800 Hz (≥30 dB down from passband at 400 Hz)
- [ ] The 10 lb preset produces energy down to 250 Hz within 6 dB of passband level
- [ ] The crossover region (3–4 kHz) in the 10 lb preset shows realistic behavior (slight dip off-axis, smooth on-axis)
- [ ] Frequency response chart visually confirms the bandwidth difference between configurations
- [ ] All three presets load into the ConfigurationManager and are switchable via D1 controls

---

## 5. Phase D3 — Built-In Voice Stimulus

### 5.1 Problem

Pink noise and log sweeps are engineering diagnostics. The missing 250–800 Hz band is most perceptible on voice content, where the fundamental frequency (~85–180 Hz for adult male) and low harmonics (250–800 Hz) carry the perception of authority and presence. Stakeholders must hear a voice — specifically one that approximates the talk-down use case.

### 5.2 Design

#### Voice sample requirements

- **Content**: Firm, clear male voice delivering a short security-style announcement. Example: "Attention. You are being recorded. This is private property. Leave the area immediately." (Or similar — the exact wording can be adjusted. The key is an authoritative, commanding tone.)
- **Duration**: 5–10 seconds, loopable (with a 1–2 second silence gap at the end before loop)
- **Format**: WAV, 48 kHz, 16-bit mono
- **Recording quality**: Clean, dry (no reverb), close-mic'd. Broadcast-quality voice with full bandwidth. The voice sample must contain strong energy in the 100–800 Hz range so the midrange presence difference is audible.
- **Licensing**: Either recorded by the consultant (preferred — full control, no licensing issues) or sourced from a royalty-free library with a license that permits embedding in a web application.

#### File location and loading

The voice sample ships as a built-in asset:

```
public/
  stimuli/
    voice_talkdown.wav    # Primary voice sample
```

#### Modifications to existing files

| File | Change |
|---|---|
| `Stimulus.js` | Add `'voice'` as a stimulus type. On init, fetch `/stimuli/voice_talkdown.wav` and decode it (same pattern as pink noise buffer, but loaded from file instead of generated). Make `'voice'` the default stimulus type when LVT presets are active. |
| `AppState.js` | Add `'voice'` to the stimulus type enum. |
| `UIManager.js` | Add "Voice (Talk-Down)" to the stimulus type dropdown. When LVT Demo mode is activated, auto-select voice stimulus. |

#### Fallback

If the voice sample fails to load (network error, file missing), fall back to pink noise with a console warning. The UI should never block on stimulus loading.

### 5.3 Acceptance Criteria

- [ ] Voice stimulus loads and plays without user action (beyond pressing Play)
- [ ] Voice sample loops cleanly with no click at loop boundary
- [ ] When switching configurations during voice playback, the bandwidth difference is clearly audible — the 10 lb configuration sounds fuller and more authoritative than the 5 lb and 7 lb
- [ ] Voice stimulus is auto-selected when LVT Demo mode is activated
- [ ] WAV upload still works for custom voice samples

### 5.4 Note on Voice Sample Production

If recording a custom sample, the following recording chain is recommended:

- Dynamic microphone (SM7B, RE20, or similar) at 6–8 inches
- Clean preamp, no compression, no EQ
- 48 kHz / 24-bit recording, dithered to 16-bit for delivery
- Normalize to –3 dBFS peak
- Trim to content + 1.5s silence tail
- Export as mono WAV

The voice should sound natural and unprocessed — any EQ or compression applied to the recording will mask the very frequency-response differences the demo is designed to reveal.

---

## 6. Phase D4 — Scene Rescaling and SPL Calibration

### 6.1 Problem

The default scene positions the listener at 3m with a 20×20m grid. The LVT deployment range is 30m. At the current scale, 30m is far off-screen and the grid provides no visual reference for the deployment geometry. Additionally, the SPL readout and audible level don't reflect real sensitivity differences between configurations.

### 6.2 Design

#### Scene changes

**Grid and camera defaults (LVT Demo mode):**

When LVT Demo mode is activated (loading the LVT presets), apply these scene parameters:

| Parameter | Current Default | LVT Demo Default |
|---|---|---|
| Grid size | 20 × 20 m | 80 × 80 m |
| Grid divisions | 20 | 16 (5m spacing) |
| Ortho frustum size | 10 | 40 |
| Listener default position | (0, 0, 3) | (0, 0, 30) |
| Speaker default position | (0, 0, 0) | (0, 0, 0) |

**Distance reference rings:**

Add concentric distance rings around the speaker at 10m, 20m, and 30m. These provide immediate spatial reference for the deployment range without requiring the listener to read the HUD distance value.

```js
// In SceneManager.js — new method
_addDistanceRings(distances = [10, 20, 30]) {
  distances.forEach(radius => {
    const geometry = new THREE.RingGeometry(radius - 0.05, radius + 0.05, 64);
    const material = new THREE.MeshBasicMaterial({
      color: 0x2a2a4a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);

    // Distance label (sprite or CSS2D — implementation TBD)
  });
}
```

**Coverage angle overlay:**

For the LVT demo, visualize the 180° target coverage zone as a shaded arc on the ground plane. This grounds the "Auditory FOV" concept spatially — the listener can see whether they're inside or outside the intended coverage zone as they move.

#### SPL calibration

**Problem:** Currently, `onAxisSensitivity` is a single number that drives the HUD SPL readout. It doesn't change when configurations switch, and it doesn't account for bandwidth-dependent sensitivity differences (the 10 lb system has 102 dB midrange sensitivity but 116 dB HF sensitivity).

**Solution:** When configurations switch, `onAxisSensitivity` should update to reflect the active configuration's representative sensitivity for voice content. For the LVT presets:

| Configuration | Representative Sensitivity | Rationale |
|---|---|---|
| 5 lb | 111 dB/W/m | Single compression driver + horn — HF only |
| 7 lb | 116 dB/W/m | Array gain — HF only |
| 10 lb | 102 dB/W/m | Midrange sensitivity — the voice-relevant band |

The SPL-at-distance chart and HUD readout use this value. The 10 lb system will show a *lower* SPL number than the 7 lb system in the HUD — which is acoustically correct (the midrange band is less efficient than the HF compression array) but potentially confusing to non-acoustic stakeholders. Add a note in the HUD or chart: "SPL shown for voice band (250–4 kHz)" when LVT Demo mode is active.

**Audio-level calibration:**

For the audible output, the relative level between configurations should reflect real sensitivity differences in the voice-relevant band. The 10 lb system's midrange is ~9 dB quieter than the 7 lb system's HF array on paper — but the voice content has energy in the midrange, not just HF. The bandwidth difference means:

- 5 lb / 7 lb: voice sounds louder in the HF formant region (1–4 kHz) but has no body
- 10 lb: voice sounds slightly quieter overall but fuller, with body from 250–800 Hz

The `ConfigurationManager.switchTo()` method should apply a gain offset to the master output that reflects the sensitivity difference between configurations. This keeps the perceptual comparison fair — the stakeholder hears the timbral difference, not just a level difference.

Recommended approach: normalize all configurations to the same broadband perceived loudness (A-weighted equivalent level) for the voice stimulus, so the comparison is purely about timbre and bandwidth, not volume. This is more informative for the stakeholder decision than raw SPL-matched playback.

#### Modifications to existing files

| File | Change |
|---|---|
| `SceneManager.js` | Add `setSceneScale(gridSize, divisions, frustumSize)` method. Add `_addDistanceRings()`. Add coverage angle overlay. Call these when LVT Demo mode activates. |
| `ListenerObject.js` | Update default position to be configurable per mode. |
| `AppState.js` | Add `sceneMode` ('default' or 'lvt_demo'). When 'lvt_demo', apply LVT scene defaults. |
| `HUD.js` | Add "voice band" annotation to SPL readout when in LVT Demo mode. |
| `FRChart.js` | Update SPL-vs-distance chart to show curves for all loaded configurations simultaneously (color-coded), with the active configuration highlighted. |
| `ConfigurationManager.js` | On switch, update `appState.onAxisSensitivity` and apply gain normalization offset. |

### 6.3 Acceptance Criteria

- [ ] When LVT Demo mode activates, the listener starts at 30m from the speaker
- [ ] Distance rings at 10m, 20m, 30m are visible on the ground plane
- [ ] The 180° coverage zone is visualized as a ground-plane overlay
- [ ] SPL readout in HUD updates to the active configuration's voice-band sensitivity on switch
- [ ] SPL-vs-distance chart shows all three configuration curves simultaneously
- [ ] Relative audio levels between configurations are perceptually normalized for the voice stimulus

---

## 7. File Map — New and Modified

### New Files

| File | Phase | Purpose |
|---|---|---|
| `src/data/SpeakerConfiguration.js` | D1 | Configuration data class |
| `src/data/ConfigurationManager.js` | D1 | Multi-configuration management and switching |
| `public/stimuli/voice_talkdown.wav` | D3 | Built-in voice stimulus sample |

### Modified Files

| File | Phase(s) | Summary of Changes |
|---|---|---|
| `src/audio/AudioEngine.js` | D1, D4 | Dual DirectivityModel instances, master crossfade, config switch method, gain normalization |
| `src/audio/DirectivityModel.js` | D1 | No structural changes — instantiated twice instead of once |
| `src/audio/Stimulus.js` | D3 | Add 'voice' type, auto-load voice sample from public folder |
| `src/state/AppState.js` | D1, D3, D4 | Add activeConfiguration, sceneMode, 'voice' stimulus type |
| `src/presets/SyntheticSpeakers.js` | D2 | Add lvt_5lb, lvt_7lb, lvt_10lb generators and getLVTConfigurations() export |
| `src/scene/SceneManager.js` | D4 | Scene rescaling, distance rings, coverage overlay |
| `src/scene/ListenerObject.js` | D4 | Configurable default position |
| `src/ui/UIManager.js` | D1, D2, D3, D4 | Configuration selector, LVT Demo preset group, voice stimulus option, keyboard shortcut wiring |
| `src/ui/HUD.js` | D1, D4 | Configuration name display, voice-band SPL annotation |
| `src/ui/FRChart.js` | D4 | Multi-configuration SPL-vs-distance overlay |
| `src/ui/DropZone.js` | D2 | loadLVTDemo() method |
| `src/main.js` | D1 | ConfigurationManager initialization, keyboard event listener |

---

## 8. Future Considerations (Not In This Scope)

These items are noted for awareness but are **not** included in D1–D4:

**Array summation modeling.** The 7 lb configuration uses a 4-driver array with composite coverage. Properly modeling this requires summing multiple sources with inter-driver spacing, phase relationships, and comb filtering. For the weight tradeoff demo, the bandwidth difference (800 Hz+ vs. 250 Hz+) is the dominant perceptual variable — the array modeling is secondary. If array coverage uniformity becomes a stakeholder question, it can be addressed in a separate development phase.

**Personalized HRTF.** Resonance Audio uses generic HRTFs. Individual listener head geometry affects binaural perception, particularly for elevation cues. For the horizontal-plane weight tradeoff demo, generic HRTFs are adequate.

**Room/environment modeling.** The demo renders direct sound only. Real deployment environments have ground reflections, boundary effects, and ambient noise. These are intentionally excluded — the demo isolates the speaker system's contribution so the bandwidth comparison is clean. Environmental effects can be layered in a future "deployment simulation" mode.

**Real FRD import per configuration.** Once AcousticBench measurement data exists for actual driver candidates, each LVT configuration's synthetic FRD data should be replaced with measured data. The ConfigurationManager and SpeakerConfiguration architecture supports this — the FRD source (synthetic vs. measured) is transparent to the switching and rendering pipeline. The D1 architecture is designed to accommodate this upgrade with no structural changes.

**Remote demo delivery.** If stakeholder demos must be conducted remotely, the playback chain quality becomes a variable. A future enhancement could include a "headphone calibration" step that adjusts output EQ for known headphone models, ensuring the bandwidth difference is faithfully reproduced through the remote listener's playback equipment.

---

*AcousticSim LVT Demo Dev Spec — Rev 1*
*Prepared for LVT Acoustics Engagement — Phase A tooling*