(function (global) {
    let audioCtx = null;
    let sfxVolume = parseFloat(global.localStorage?.getItem('sfxVolume') ?? '1') || 1;

    function ctx() {
        if (!audioCtx) {
            audioCtx = new (global.AudioContext || global.webkitAudioContext)();
        }
        return audioCtx;
    }

    function play(type) {
        if (sfxVolume <= 0) return;
        const ac = ctx();
        if (ac.state === 'suspended') {
            ac.resume().then(() => play(type)).catch(() => {});
            return;
        }
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        const t = ac.currentTime;
        const v = 0.22 * sfxVolume;

        const tone = (freq, wave, dur, vol = v, slide = null) => {
            osc.type = wave;
            osc.frequency.setValueAtTime(freq, t);
            if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
            gain.gain.setValueAtTime(vol, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
            osc.start(t);
            osc.stop(t + dur);
        };

        switch (type) {
            case 'click':
                tone(720, 'triangle', 0.04, v * 0.35);
                break;
            case 'card':
                tone(520, 'sine', 0.08, v * 0.5);
                osc.frequency.exponentialRampToValueAtTime(680, t + 0.08);
                break;
            case 'cards':
                tone(480, 'sine', 0.12, v * 0.55);
                osc.frequency.exponentialRampToValueAtTime(820, t + 0.12);
                break;
            case 'draw':
                tone(340, 'sine', 0.1, v * 0.4);
                break;
            case 'uno':
                tone(600, 'square', 0.06, v * 0.35);
                osc.frequency.setValueAtTime(900, t + 0.06);
                gain.gain.setValueAtTime(v * 0.4, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
                osc.stop(t + 0.18);
                break;
            case 'penalty':
                tone(200, 'sawtooth', 0.2, v * 0.45, 140);
                break;
            case 'turn':
                tone(440, 'sine', 0.07, v * 0.3);
                break;
            case 'win':
                [523, 659, 784].forEach((f, i) => {
                    const o = ac.createOscillator();
                    const g = ac.createGain();
                    o.connect(g);
                    g.connect(ac.destination);
                    o.type = 'sine';
                    o.frequency.value = f;
                    g.gain.setValueAtTime(0, t + i * 0.1);
                    g.gain.linearRampToValueAtTime(v * 0.35, t + i * 0.1 + 0.02);
                    g.gain.exponentialRampToValueAtTime(0.01, t + i * 0.1 + 0.25);
                    o.start(t + i * 0.1);
                    o.stop(t + i * 0.1 + 0.25);
                });
                return;
            case 'error':
                tone(160, 'sawtooth', 0.22, v * 0.5, 110);
                break;
            case 'roulette':
                tone(280, 'triangle', 0.15, v * 0.5, 120);
                break;
            case 'shot':
                tone(90, 'sawtooth', 0.35, v * 0.6, 60);
                break;
            default:
                tone(500, 'sine', 0.08);
        }
    }

    global.GameSounds = { play, setVolume: (n) => { sfxVolume = n; } };
})(window);
