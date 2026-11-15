# Sound cutting in and out over wireless CarPlay

Notes behind v61's sound rebuild. Written without a car or an iPhone to test with, so every claim says how sure it is.

## The symptom

On wireless CarPlay, while the game runs, "the sound comes in and out … every second it goes in, out, in, out", and the coach's speech is hard to follow. Two earlier fixes did not help:

- **v43** asked Web Audio for bigger buffers (`latencyHint: 'playback'`) and recorded the tune once.
- **v44** moved the music and the voice from Web Audio to `<audio>` players. The sound effects stayed on a live `AudioContext`, which stayed alive for the whole session.

## Short answer

**The likeliest cause is the live `AudioContext` itself, not what plays through it.** While any `AudioContext` exists, WebKit sets the whole page's audio session to a 128-frame I/O buffer (about 2.7 ms). That session also carries the `<audio>` players. Wireless CarPlay is an AirPlay-style link with about a second of buffering, and it is the one route where a live WebKit `AudioContext` is reported to make audio stutter, even other apps' audio. So v44 could not work while the effects kept a context alive. Confidence: **medium-high**. The source code part is certain. The step from "128-frame buffer" to "wireless CarPlay breaks up" is a strong match to one report, but nobody has confirmed it on this car.

v61 removes every live `AudioContext`. All sound now plays through `<audio>` players (AVPlayer underneath), which is the path Apple builds wireless CarPlay and AirPlay buffering for.

## What the sources say

### 1. A live AudioContext sets the buffer size for the whole page (certain, from WebKit source)

- `MediaSessionManagerCocoa::updateSessionState()` counts the page's media sessions. If any Web Audio session exists, it sets `bufferSize = AudioUtilities::renderQuantumSize` (128 frames) and calls `AudioSession::setPreferredBufferSize`. Otherwise it keeps the default size, or uses 4096 frames for plain media playback when the low-power buffer setting is on. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm
- On iOS, `AudioSessionIOS::setPreferredBufferSize` calls `[AVAudioSession setPreferredIOBufferDuration:]` on the shared session. That is one session for all of the page's audio, players included. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ios/AudioSessionIOS.mm
- An `AudioContext` counts as a Web Audio session whenever it is not closed. `mediaType()` returns `WebAudio` unless the *document* is suspended or stopped, and `canProduceAudio()` is always `true`. So a context in the `suspended` state still forces the 128-frame buffer. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webaudio/AudioContext.h
- `latencyHint` does nothing in WebKit. The constructor has the comment `// FIXME: Figure out where latencyHint should go.` So v43's "bigger buffers" never took effect. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webaudio/AudioContext.cpp
- `OfflineAudioContext` is not a media session client, so it never touches the audio session. The game can keep using it to record sounds.

I read the current WebKit trunk (November 2026). I did not trace when each line first shipped in iOS.

### 2. Wireless CarPlay and a live WebKit AudioContext (medium: one detailed report, no Apple answer)

- An Apple Developer Forums post (May 2026) reports a *residual WebKit `AudioContext`* causing "persistent stuttering, dropped frames, and intermittent audio dropping" in other apps' audio, **only on wireless CarPlay**. Wired CarPlay and Bluetooth were fine. It has no replies. https://developer.apple.com/forums/thread/828298
- Wireless CarPlay has about **1100 ms** of output latency, against about 60 ms wired, with the `.playback` category. https://developer.apple.com/forums/thread/845736
- Apple's WWDC23 session "Tune up your AirPlay audio experience" says `AVPlayer` and `AVQueuePlayer` get enhanced (faster than real time) buffering on AirPlay routes, and that the "same APIs support CarPlay". Real-time audio paths such as Web Audio's output unit don't get that buffering. https://developer.apple.com/videos/play/wwdc2023/10238/ (notes: https://wwdcnotes.com/documentation/wwdc23-10238-tune-up-your-airplay-audio-experience/)

Together these fit the symptom: a tiny I/O buffer on the shared session, sent over a link built around big buffers.

### 3. Other WebKit Web Audio bugs on wireless and Bluetooth routes (high that they exist, low that they are this bug)

- Bug 258864: Web Audio distorts and plays at the wrong speed after a switch to a Bluetooth speaker; `<audio>` playback is not affected. A WebKit engineer traced it to the output sample rate changing with the route. https://bugs.webkit.org/show_bug.cgi?id=258864
- Bug 232728: `AudioContext.currentTime` runs fast with a Bluetooth speaker, and audio cuts out after a few seconds. https://bugs.webkit.org/show_bug.cgi?id=232728
- Bug 221334: Web Audio is "delayed and glitchy", with stutter and small gaps, mostly over Bluetooth. https://bugs.webkit.org/show_bug.cgi?id=221334
- Bug 291892: a home-screen web app's `AudioContext` goes silent after returning from the background, while `<audio>` worked (until an iOS 26 regression, bug 295518). https://bugs.webkit.org/show_bug.cgi?id=291892

The pattern across all of them: Web Audio is the fragile path on non-built-in routes, and `<audio>` is the robust one.

### 4. Each effect switched the page between "playing" and "not playing" (certain in source, effect unknown)

`DefaultAudioDestinationNode::setIsSilent` flips the context's "effectively playing audio" flag every time the output goes from silence to sound and back. Each flip calls `document->updateIsPlayingMedia()`. With the music moved to players in v44, the context was silent between effects. So every footstep (about 7 a second while the hero runs: `sim.js` fires `step` every 0.7 m) flipped the page's playing state twice. I found nothing that ties these flips to routing. They are one more reason to drop live Web Audio. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webaudio/DefaultAudioDestinationNode.cpp

### 5. The audio session type (high)

- `navigator.audioSession.type` is in Safari and Safari on iOS **16.4+** (March 2023). https://web-platform-dx.github.io/web-features-explorer/features/audio-session
- The values are `auto` (the default), `playback`, `transient`, `transient-solo`, `ambient` and `play-and-record`. `playback`, `play-and-record` and `transient-solo` are exclusive types. https://w3c.github.io/audio-session/
- In WebKit, an explicit type overrides the category the page would get. `playback` maps to the `MediaPlayback` category with the long-form audio route policy, which is what plays through the silent switch. Without an override, a page with only Web Audio gets `AmbientSound`. With an override, WebKit trunk doesn't deactivate the session when playback stops (`maybeDeactivateAudioSession` returns early). That helps keep the car's channel open between sounds. (MediaSessionManagerCocoa.mm and MediaSessionManagerInterface.cpp, as above.)
- WebKit bug 264473: `<audio>` is silent with `transient` or `transient-solo`. So `playback` is the right value and should stay. https://bugs.webkit.org/show_bug.cgi?id=264473

### 6. Silence and sleeping links (low to medium: user reports, not Apple)

- An Apple Community thread reports that many Bluetooth devices mute the stream during silence and wake with a short delay, which clips the first word after a pause. https://discussions.apple.com/thread/256116368
- Howler.js keeps a pool of `<audio>` elements that it unlocks on the first touch, because "HTML5 Audio objects must be individually unlocked". https://github.com/goldfire/howler.js/blob/master/src/howler.core.js

I found no Apple statement on how wireless CarPlay treats digital silence. A quiet, non-zero stream costs nothing and covers the case.

## The hypotheses

| Hypothesis | Verdict | Why |
|---|---|---|
| 1. The live AudioContext sets the whole session's buffer | **Holds** (likely main cause) | It is in the WebKit source (§1), and it matches the wireless-only CarPlay report (§2). It also explains why v44 changed nothing. |
| 2. Each live effect starts and stops on another path | **Partly holds** | Each effect flipped the page's playing state (§4), and Web Audio has no AirPlay-style buffering (§2). It probably works with hypothesis 1, not alone. |
| 3. A new voice `src` and the music mute swap clip speech | **Minor** | With a context alive, the session never went idle, so this was not the in-and-out. A cold start on a slow route can still clip a first word, so v61 keeps a stream open and adds lead-in. |
| 4a. Sample-rate mismatch between WAVs | **Unlikely alone** | AVPlayer resamples each file, so the hardware rate doesn't change per file. Web Audio does break when the route's rate changes (§3). v61 uses one rate anyway. |
| 4b. The 8 kHz silent unlock WAV | **Unlikely** | It plays once on the first tap. It is now 48 kHz like everything else. |
| 4c. `audioSession.type = 'playback'` | **Correct, kept** | See §5. |
| 4d. `visibilitychange` and home-screen apps | **Not this bug** | Bug 291892 is silence after the background, not in-and-out. Pausing in the background is kept. |
| 4e. The silent `speechSynthesis` utterance at each flow start | **Unknown, small** | It runs once per lesson or match, not every second. It stays because the built-in voice needs it. |

## What v61 changes

- **No live AudioContext, ever.** `OfflineAudioContext` only, to record the effects and the tune and to decode voice clips. A unit test (`tests/sound.test.js`) fails if `js/` names `AudioContext` or `webkitAudioContext`.
- **Effects are recordings.** They use the same synthesis as before, rendered offline once after the first tap. Each effect has its own pre-unlocked `<audio>` player, so different effects overlap, and the same effect replayed starts over. The only randomness was the noise start point, which can't be heard, so each effect has one recording. Peaks and lengths match the old live sound (checked numerically).
- **Footsteps are gone.** About 7 a second was the biggest stream of sound starts, and the least missed sound.
- **One stream stays open.** While the game is visible and not muted, one looping player always plays: the tune if the music is on, else a hush of soft noise at about −60 dBFS RMS. The hush is not digital silence, so a link that sleeps on silence (§6) stays awake. Nothing else in the game restarts it.
- **No ducking.** The tune peaks at −26 dBFS against a voice line peaking at about −4 dBFS (about 20 dB apart in RMS), so the voice stands out without it. This removes the second music player and its mute swap around every line.
- **Voice lead-in is 150 ms** (was 50 ms), plus 100 ms of quiet at the end. With the stream open, the route doesn't have to wake up, so this is only a margin for the player's own start.
- **One sample rate: 48000 Hz** for every WAV: effects, tune, hush and voice. The clips are decoded at 48 kHz by the offline context. 48 kHz is the iPhone's own output rate (the reports in §3 show `AudioContext` at 48000 Hz on the built-in speaker).
- **Kept:** `audioSession.type = 'playback'`, the three volumes (baked into the recordings and re-recorded when a slider settles: effects at once on the next sound, the tune after 300 ms), mute all, pause in the background and resume, the `speechSynthesis` fallback, clip retry after a failed fetch, and preloading.

## If it still happens: the sound lab

Open `dev/sound-lab.html` on the phone (the same site, `/dev/sound-lab.html`) in the car with CarPlay on. Tap each row in order, answer Clear, Choppy or Silent, then tap Copy results. The copied log includes every player's `waiting` and `stalled` events and the audio session state.

| Rows that break up | What it means | Next step |
|---|---|---|
| Only 6, 7 and 8 (old Web Audio) | The cause was live Web Audio, and v61 fixes it. | Done. |
| 8 breaks, but 6 and 7 are clear | The mix of a live context and players breaks it. This still confirms hypothesis 1. | Done. |
| 4 breaks, 1 to 3 are clear | Several players at once is the problem. | Fold the effects into fewer players, or into the stream itself. |
| 1 breaks (one voice player, nothing else) | `<audio>` itself breaks up on this car. That is not a page problem. | Test another web audio site, and check the car's firmware. Compare a home-screen app with a Safari tab. |
| 5 breaks but 4 is clear | The hush is too quiet or is treated as silence. | Raise `HUSH_RMS` in `js/sound.js`. |
| Everything is clear, but the game still breaks up | Something outside sound is the cause, such as a busy phone (the 3D drawing) starving the audio. | Try the game with the graphics on low, and look for `waiting` in the log. |
