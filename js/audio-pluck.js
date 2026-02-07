/**
 * Procedural pluck synth used by both background FX and the mini game.
 *
 * Requirements from the brief:
 * - Buffer length: 4096 samples
 * - ADSR attack: 24 samples
 * - Release: larger for bigger dots, shorter for smaller dots
 * - Loudness: bigger dot louder, smaller dot quieter
 */

const PLUCK_SETTINGS = {
  samples: 4096,
  attackSamples: 24,
  minReleaseSamples: 420,
  outputGainScale: 0.1
};

const REVERB_SETTINGS = {
  durationSec: 3.8,
  decay: 1.3,
  dryMix: 0.77,
  wetMix: 0.23
};

const SINE_SETTINGS = {
  minFrequencyHz: 160,
  maxFrequencyHz: 880,
  attackSec: 0.01,
  releaseSec: 0.22,
  gain: 0.022
};

let audioCtx = null;
let reverbChain = null;

function getAudioContext() {
  if (audioCtx) {
    return audioCtx;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }

  audioCtx = new AudioCtor();
  return audioCtx;
}

function sizeToUnit(size, minSize, maxSize) {
  if (!Number.isFinite(size)) {
    return 0;
  }
  const span = Math.max(0.001, maxSize - minSize);
  return Math.max(0, Math.min(1, (size - minSize) / span));
}

function createImpulseResponse(ac) {
  const length = Math.max(1, Math.floor(ac.sampleRate * REVERB_SETTINGS.durationSec));
  const impulse = ac.createBuffer(2, length, ac.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const envelope = Math.pow(1 - t, REVERB_SETTINGS.decay);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
  }

  return impulse;
}

function getReverbInput(ac) {
  if (reverbChain && reverbChain.ac === ac) {
    return reverbChain.input;
  }

  const input = ac.createGain();
  const dryGain = ac.createGain();
  const wetGain = ac.createGain();
  const convolver = ac.createConvolver();

  convolver.buffer = createImpulseResponse(ac);
  dryGain.gain.value = REVERB_SETTINGS.dryMix;
  wetGain.gain.value = REVERB_SETTINGS.wetMix;

  input.connect(dryGain);
  dryGain.connect(ac.destination);

  input.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(ac.destination);

  reverbChain = {
    ac,
    input
  };

  return input;
}

/**
 * Resume audio context after a user gesture (browser autoplay policy).
 */
export function unlockAudioContext() {
  const ac = getAudioContext();
  if (!ac) {
    return;
  }
  if (ac.state === "suspended") {
    ac.resume().catch(() => {});
  }
}

/**
 * Play one synthetic pluck.
 * @param {number} size Dot size used for loudness + release mapping.
 * @param {{min:number,max:number}} sizeRange Expected range for size normalization.
 */
export function playPluck(size, sizeRange = { min: 1, max: 10 }) {
  const ac = getAudioContext();
  if (!ac || ac.state !== "running") {
    return;
  }
  const reverbInput = getReverbInput(ac);

  const amount = sizeToUnit(size, sizeRange.min, sizeRange.max);
  const releaseMax = PLUCK_SETTINGS.samples - PLUCK_SETTINGS.attackSamples;
  const releaseSamples = Math.round(
    PLUCK_SETTINGS.minReleaseSamples + (releaseMax - PLUCK_SETTINGS.minReleaseSamples) * amount
  );
  const gainAmount = (0.06 + 0.18 * amount) * PLUCK_SETTINGS.outputGainScale;
  const frequency = 170 + 330 * (1 - amount);

  const buffer = ac.createBuffer(1, PLUCK_SETTINGS.samples, ac.sampleRate);
  const data = buffer.getChannelData(0);
  const twoPiF = Math.PI * 2 * frequency;

  for (let i = 0; i < PLUCK_SETTINGS.samples; i += 1) {
    const t = i / ac.sampleRate;
    const carrier = Math.sin(twoPiF * t) * Math.exp(-i / 1900);
    const noise = (Math.random() * 2 - 1) * Math.exp(-i / 320);
    const body = carrier * 0.76 + noise * 0.28;
    const env = i < PLUCK_SETTINGS.attackSamples
      ? i / PLUCK_SETTINGS.attackSamples
      : Math.max(0, 1 - (i - PLUCK_SETTINGS.attackSamples) / releaseSamples);
    data[i] = body * env;
  }

  const source = ac.createBufferSource();
  const gainNode = ac.createGain();
  gainNode.gain.value = gainAmount;
  source.buffer = buffer;
  source.connect(gainNode);
  gainNode.connect(reverbInput);
  source.start();
}

/**
 * Play a short sine tone for special game events.
 * @param {number} frequencyHz Target oscillator frequency in Hz.
 */
export function playSineTone(frequencyHz) {
  const ac = getAudioContext();
  if (!ac || ac.state !== "running") {
    return;
  }
  const reverbInput = getReverbInput(ac);

  const clampedHz = Math.max(
    SINE_SETTINGS.minFrequencyHz,
    Math.min(SINE_SETTINGS.maxFrequencyHz, Number.isFinite(frequencyHz) ? frequencyHz : 440)
  );

  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const gainNode = ac.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(clampedHz, now);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.linearRampToValueAtTime(SINE_SETTINGS.gain, now + SINE_SETTINGS.attackSec);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + SINE_SETTINGS.attackSec + SINE_SETTINGS.releaseSec);

  osc.connect(gainNode);
  gainNode.connect(reverbInput);
  osc.start(now);
  osc.stop(now + SINE_SETTINGS.attackSec + SINE_SETTINGS.releaseSec + 0.02);
}
