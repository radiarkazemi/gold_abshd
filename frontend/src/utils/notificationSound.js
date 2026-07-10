// Plays a short two-tone alert beep using the Web Audio API directly -
// no external audio file needed, works instantly with no network request.
export function playNotificationSound() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextClass();

        function beep(freq, startTime, duration) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        }

        const now = ctx.currentTime;
        beep(880, now, 0.15);
        beep(1180, now + 0.16, 0.18);
    } catch (e) {
        // Some browsers block audio until the user interacts with the page
        // at least once - silently ignore rather than throwing.
        console.warn("Notification sound could not play:", e);
    }
}