// Admin alert sounds: prefer a distinct WAV (not the phone's default
// notification ding). Falls back to WebAudio synthesis if the file
// cannot play (autoplay / missing file).

let sharedCtx = null;
let unlocked = false;

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContextClass();
  }
  return sharedCtx;
}

/** Call from a user gesture so later order/KYC chimes are allowed to play. */
export async function unlockNotificationAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }
    // Prime HTMLAudioElement autoplay on mobile.
    const probe = new Audio("/notify-order.wav");
    probe.volume = 0.01;
    try {
      await probe.play();
      probe.pause();
      probe.currentTime = 0;
    } catch {
      /* ignore — gesture may still unlock WebAudio */
    }
    unlocked = true;
  } catch {
    /* ignore */
  }
}

function playWav(url) {
  return new Promise((resolve) => {
    try {
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = 1;
      const done = () => resolve(true);
      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", () => resolve(false), { once: true });
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.then(() => {}).catch(() => resolve(false));
      }
      // Safety timeout if ended never fires
      setTimeout(() => resolve(true), 2500);
    } catch {
      resolve(false);
    }
  });
}

function synthBeeps(pattern) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    function beep(freq, startTime, duration, peakGain, type = "triangle") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    }

    const now = ctx.currentTime;
    for (const [freq, start, dur, gain, type] of pattern) {
      beep(freq, now + start, dur, gain, type);
    }
  } catch (e) {
    console.warn("Notification synth failed:", e);
  }
}

/** Distinct metallic rising alert for new orders (not the OS default ding). */
export async function playNotificationSound() {
  const ok = await playWav(`/notify-order.wav?v=2`);
  if (ok) return;
  synthBeeps([
    [1800, 0, 0.07, 0.55, "square"],
    [2400, 0.11, 0.09, 0.6, "square"],
    [988, 0.24, 0.11, 0.45, "triangle"],
    [1319, 0.36, 0.12, 0.5, "triangle"],
    [1760, 0.5, 0.18, 0.55, "triangle"],
  ]);
}

/** Distinct KYC chime — different rhythm from order alerts. */
export async function playKycNotificationSound() {
  const ok = await playWav(`/notify-kyc.wav?v=2`);
  if (ok) return;
  synthBeeps([
    [740, 0, 0.12, 0.45, "triangle"],
    [554, 0.17, 0.14, 0.45, "triangle"],
    [880, 0.36, 0.2, 0.5, "triangle"],
  ]);
}

export function notificationAudioUnlocked() {
  return unlocked;
}
