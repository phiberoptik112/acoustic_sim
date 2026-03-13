# AcousticSim

Browser-based binaural loudspeaker simulator that renders a speaker's measured frequency response, directivity, and distance falloff binaurally using real FRD measurement files.

## What It Does

AcousticSim is a **validation tool** that answers the question:

> *"What does this speaker system actually sound like from this position, given its real measured behavior?"*

- Renders a speaker's measured on-axis and off-axis frequency response binaurally
- Applies inverse-square-law distance falloff from the speaker's measured sensitivity
- Visualizes listener position relative to speaker in 3D with azimuth/distance readout
- Accepts real `.frd` polar measurement sets as the acoustic source of truth

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Usage

1. **Load Speaker Data**: Drag and drop a set of FRD files onto the application, or select a built-in preset speaker
2. **Position Listener**: Drag the listener (head icon) around the 3D scene
3. **Listen**: Hear how the speaker sounds from different positions and angles
4. **Analyze**: View the interpolated frequency response at your current position

## FRD File Format

FRD (Frequency Response Data) files are tab or space-separated text files with three columns:

```
# Optional comment lines start with #
Frequency(Hz)    Magnitude(dB)    Phase(deg)
20               85.0             0.0
25               86.2             -5.3
...
20000            72.1             -180.5
```

### Filename Convention

Files are mapped to polar angles by filename:

```
speaker_000deg.frd   →  0° (on-axis)
speaker_015deg.frd   →  15°
speaker_030deg.frd   →  30°
speaker_045deg.frd   →  45°
speaker_060deg.frd   →  60°
speaker_075deg.frd   →  75°
speaker_090deg.frd   →  90°
```

## AcousticBench Integration

AcousticSim is designed as the downstream consumer of AcousticBench polar measurement exports:

1. **AcousticBench** runs a polar sequence: FRFMeasure at 0°, 15°, 30° … 90°
2. Export as `speaker_{angle:03d}deg.frd` per VituixCAD naming convention
3. **AcousticSim** accepts the folder drag-drop, parses all angles, converts to IRs
4. The speaker is immediately listenable in 3D

## Controls

### Scene Controls
- **Drag** speaker or listener to reposition
- **Scroll** to zoom
- **Toggle** between orthographic (top-down) and perspective view

### Audio Controls
- **Stimulus**: Pink Noise / Log Sweep / WAV Upload
- **Master Volume**: Output level in dB
- **Min Phase**: Toggle minimum phase conversion (default: ON)
- **IR Size**: 1024 / 2048 samples

## Technical Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| 3D Engine | Three.js | Scene, draggable objects, coordinate system |
| Audio Core | Web Audio API | Graph routing, GainNodes, ConvolverNodes |
| Spatialization | Resonance Audio | Ambisonics HRTF, listener orientation, distance rolloff |
| FFT | fft.js | FRD → IR conversion |
| UI Controls | lil-gui | Real-time parameter tweaking |
| Charts | Chart.js | Live frequency response display |
| Build | Vite | Fast ESM bundling, dev server |

## Architecture

### Audio Pipeline

```
AudioBufferSourceNode (pink noise / sweep / WAV)
        │
        ├──► ConvolverNode A (lower polar angle FRD as IR)
        │         │
        │    GainNode A (crossfade weight α)
        │
        └──► ConvolverNode B (upper polar angle FRD as IR)
                  │
             GainNode B (crossfade weight 1-α)
                  │
             Summation GainNode
                  │
          ResonanceAudio Source (distance rolloff + HRTF)
                  │
          ResonanceAudio Scene (listener orientation + binaural decode)
                  │
          AudioContext.destination
```

### Key Design Decisions

- **Minimum phase default**: Prevents comb filtering during polar interpolation
- **Dual convolver crossfading**: Glitch-free directivity transitions
- **Web Worker IR conversion**: Prevents audio dropout during FRD upload
- **Resonance Audio owns distance**: Prevents double-attenuation

## Limitations

AcousticSim intentionally does **not** model:

- Room acoustics / reverberation
- Multi-speaker array summation
- Personalized HRTFs
- Ground-plane reflections

It focuses purely on validating the direct sound from a single speaker's measured polar behavior.

## License

MIT
