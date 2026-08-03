// Plays a short attention-grabbing alert tone using the Web Audio API
// directly - no external audio file needed, works instantly with no
// network request. A quick ascending triplet (like a standard
// message/notification chime), louder and sharper than a soft sine
// beep so it actually cuts through if the admin isn't looking at the
// screen.
export function playNotificationSound() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextClass();

        function beep(freq, startTime, duration, peakGain = 0.5) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle"; // sharper/more present than a pure sine, still not harsh
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        }

        const now = ctx.currentTime;
        // classic three-note ascending "new notification" pattern
        beep(660, now, 0.13);
        beep(880, now + 0.14, 0.13);
        beep(1175, now + 0.28, 0.22, 0.55);
    } catch (e) {
        // Some browsers block audio until the user interacts with the page
        // at least once - silently ignore rather than throwing.
        console.warn("Notification sound could not play:", e);
    }
}

/** Distinct two-tone chime for KYC requests (different from order alerts). */
export function playKycNotificationSound() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextClass();

        function tone(freq, startTime, duration, peakGain = 0.45) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        }

        const now = ctx.currentTime;
        // soft descending then soft rising — easy to tell apart from order triplet
        tone(988, now, 0.16, 0.4);
        tone(740, now + 0.18, 0.2, 0.42);
        tone(880, now + 0.4, 0.28, 0.48);
    } catch (e) {
        console.warn("KYC notification sound could not play:", e);
    }
}