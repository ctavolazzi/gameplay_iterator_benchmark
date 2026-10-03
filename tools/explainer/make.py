#!/usr/bin/env python3
# A short explainer video of the project so far, with no voice: title cards, jump cuts of
# real gameplay from run 34, animated bars, and sound effects. The sounds are synthesized
# here from sines and noise, so they are free to use. Needs ffmpeg and the run 34 video.
#
#   tools/explainer/make.py [out.mp4]      default: ~/Desktop/gib-explainer-v1.mp4

import array, math, os, random, subprocess, sys, tempfile, wave

HOME = os.path.expanduser('~')
V34 = f'{HOME}/Desktop/run-20261003-101030-real-window.mov'
OUT = sys.argv[1] if len(sys.argv) > 1 else f'{HOME}/Desktop/gib-explainer-v1.mp4'
WORK = tempfile.mkdtemp(prefix='gib-explainer-')
W, H, FPS, SR = 1280, 720, 30, 44100
CREAM, CHOC, ORANGE, RUST, TEAL = '0xf5f0e6', '0x3a211f', '0xe07b3c', '0xe0531f', '0x2bb5a6'
CENTRE = '(w-text_w)/2'
ENC = ['-r', str(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an']


def font(*names):
    for name in names:
        path = f'/System/Library/Fonts/Supplemental/{name}'
        if os.path.exists(path):
            return path
    raise SystemExit(f'none of these fonts found: {names}')


BLACK, BOLD = font('Arial Black.ttf', 'Arial Bold.ttf'), font('Arial Bold.ttf', 'Arial.ttf')
texts = 0


def dt(text, size, colour, x, y, t0, f=None, box=False, t1=None):
    """Text that slides in from the left and fades up at t0 (and leaves at t1)."""
    global texts
    texts += 1
    path = f'{WORK}/t{texts}.txt'
    with open(path, 'w') as out:
        out.write(text)
    when = f'between(t,{t0},{t1})' if t1 else f'gte(t,{t0})'
    s = (f"drawtext=fontfile='{f or BLACK}':textfile='{path}':fontsize={size}:fontcolor={colour}"
         f":x='({x})-50*max(0,1-(t-{t0})/0.22)':y={y}:alpha='min(1,max(0,(t-{t0})/0.22))':enable='{when}'")
    return s + (f':box=1:boxcolor={CHOC}@0.88:boxborderw=16' if box else '')


def box(x, y, w, h, colour, when='gte(t,0)'):
    return f"drawbox=x={x}:y={y}:w={w}:h={h}:color={colour}:t=fill:enable='{when}'"


def bar(x, y, width, colour, t0, steps=10, step=0.06):
    """A bar that grows to its width in steps, starting at t0."""
    out = [box(x, y, round(width * k / steps), 50, colour, f'between(t,{t0 + step * (k - 1):.2f},{t0 + step * k:.2f})') for k in range(1, steps)]
    return out + [box(x, y, width, 50, colour, f'gte(t,{t0 + step * (steps - 1):.2f})')]


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def card(name, seconds, filters):
    ffmpeg(['-f', 'lavfi', '-i', f'color=c={CHOC}:s={W}x{H}:r={FPS}:d={seconds}', '-vf', ','.join(filters), *ENC, f'{WORK}/{name}.mp4'])


def clips(name, parts, filters):
    """Jump cuts of gameplay: parts are (start, seconds, zoom). A white flash marks each cut."""
    args, chain, cuts, at = [], [], [], 0
    for i, (start, seconds, zoom) in enumerate(parts):
        args += ['-ss', str(start), '-t', str(seconds + 0.5), '-i', V34]
        chain.append(f'[{i}:v]fps={FPS},scale={int(W * zoom) // 2 * 2}:{int(H * zoom) // 2 * 2},crop={W}:{H},setsar=1,'
                     f'trim=duration={seconds},setpts=PTS-STARTPTS[c{i}]')
        at += seconds
        cuts.append(at)
    joined = ''.join(f'[c{i}]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=1:a=0,' + box(0, 0, 'iw', 'ih', 'black@0.42')
    flashes = [box(0, 0, 'iw', 'ih', 'white@0.75', f'between(t,{c:.2f},{c + 0.07:.2f})') for c in cuts[:-1]]
    graph = ';'.join(chain) + ';' + ','.join([joined, *flashes, *filters]) + '[v]'
    ffmpeg([*args, '-filter_complex', graph, '-map', '[v]', *ENC, f'{WORK}/{name}.mp4'])


# ---- the scenes: (name, seconds). Sound events are (seconds into the scene, kind).
scenes, events = [], []


def scene(name, seconds, sounds):
    start = sum(s for _, s in scenes)
    scenes.append((name, seconds))
    events.extend((start + t, kind) for t, kind in sounds)


clips('s1', [(3, 4.0, 1.12)], [
    dt('A 0.5 GB MODEL', 92, CREAM, CENTRE, 225, 0.3),
    dt('PLAYS MINECRAFT', 92, ORANGE, CENTRE, 335, 0.8),
    dt('on a 2015 MacBook. No cloud. No bill.', 36, CREAM, CENTRE, 475, 1.7, BOLD),
])
scene('s1', 4.0, [(0.3, 'boom'), (0.8, 'pop'), (1.7, 'pop'), (3.75, 'whoosh')])

clips('s2', [(44, 2.5, 1.0), (113, 2.5, 1.2), (322.5, 2.5, 1.0)], [
    dt('WHAT WE BUILT', 40, ORANGE, 60, 50, 0.1, box=True),
    dt('A small local model picks from a short menu', 38, CREAM, CENTRE, 600, 0.4, BOLD, True, 2.5),
    dt('Code presses the real keys and mouse', 38, CREAM, CENTRE, 600, 2.9, BOLD, True, 5.0),
    dt('Every decision is stored in a database', 38, CREAM, CENTRE, 600, 5.4, BOLD, True, 7.5),
])
scene('s2', 7.5, [(0.4, 'pop'), (2.3, 'whoosh'), (2.9, 'pop'), (4.8, 'whoosh'), (5.4, 'pop'), (7.25, 'whoosh')])

lines = ["Run 12:  chose 'collect log' 25 times in a row", 'Run 13:  walked 511 blocks the wrong way',
         'Run 27:  reached the goal, then a skeleton got it', 'The real window:  our own code could not find it']
card('s3', 7.5, [dt('THE STRUGGLE', 64, RUST, 60, 55, 0.15), box(60, 140, 430, 6, RUST),
                 *[dt(line, 38, CREAM, 60, 205 + 88 * i, 0.7 + 1.4 * i, BOLD) for i, line in enumerate(lines)],
                 dt('Every wrong turn is written down in the notes.', 34, ORANGE, 60, 610, 6.3, BOLD)])
scene('s3', 7.5, [(0.15, 'boom'), *[(0.7 + 1.4 * i, 'buzz') for i in range(4)], (6.3, 'pop'), (7.25, 'whoosh')])

rows = [('Before (v004)', 720, RUST, '6400 ticks', 1.3), ('Opus coach', 450, TEAL, '4000 ticks', 2.5), ('Sonnet coach', 371, ORANGE, '3300 ticks', 3.7)]
graph = [dt('THE PLAN: TWO COACHES, ONE BRIEF', 50, ORANGE, 60, 50, 0.15),
         dt('Sonnet and Opus each rewrote the playbook. The local model stayed the brain.', 29, CREAM, 60, 135, 0.6, BOLD)]
sounds = [(0.15, 'pop')]
for i, (label, width, colour, value, t0) in enumerate(rows):
    y = 225 + 90 * i
    graph += [dt(label, 32, CREAM, 60, y + 8, t0, BOLD), *bar(330, y, width, colour, t0), dt(value, 30, CREAM, 330 + width + 18, y + 9, t0 + 0.6, BOLD)]
    sounds += [(t0 + 0.06 * k, 'tick') for k in range(10)] + [(t0 + 0.6, 'ding')]
graph += [dt('Twice as fast. But the model now had 1 option at 15 of 16 decisions.', 30, CREAM, 60, 525, 5.3, BOLD),
          dt('So the plan moves: let it choose goals, not steps.', 38, ORANGE, 60, 590, 6.4)]
card('s4', 8.0, graph)
scene('s4', 8.0, sounds + [(5.3, 'buzz'), (6.4, 'pop'), (7.75, 'whoosh')])

lines = ['The game window was invisible to our search', 'A table was placed, then reported missing',
         'It climbed into the treetops after one log', 'Cobblestone left lying one block away',
         'No room for a table at the bottom of a pit']
graph, sounds = [dt('OBSTACLES, FOUND ONLY BY PLAYING', 48, ORANGE, 60, 50, 0.15)], [(0.15, 'pop')]
for i, line in enumerate(lines):
    t0, y = 0.7 + 1.5 * i, 170 + 92 * i
    graph += [dt(line, 36, CREAM, 60, y, t0, BOLD), dt('FIXED', 34, TEAL, 1090, y, t0 + 0.7)]
    sounds += [(t0, 'pop'), (t0 + 0.7, 'ding')]
card('s5', 9.0, graph)
scene('s5', 9.0, sounds + [(8.75, 'whoosh')])

clips('s6', [(113.2, 1.5, 1.2), (322.6, 2.0, 1.0), (326.5, 1.5, 1.25), (331, 2.0, 1.0)], [
    box(0, 140, 'iw', 420, 'black@0.5'),
    dt('RUN 34', 110, ORANGE, CENTRE, 165, 0.25),
    dt('11 of 11 milestones', 64, CREAM, CENTRE, 320, 1.2),
    dt('Local model. Real window. No damage.', 38, CREAM, CENTRE, 430, 2.2, BOLD),
    dt('All of it on video.', 38, ORANGE, CENTRE, 500, 3.3, BOLD),
])
scene('s6', 7.0, [(0.25, 'boom'), (1.2, 'ding'), (1.4, 'whoosh'), (2.2, 'pop'), (3.3, 'pop'), (3.4, 'whoosh'), (4.9, 'whoosh'), (6.75, 'whoosh')])

lines = ['Code, notes and all 34 runs are on GitHub', 'Next:  reflexes when it gets hurt',
         'Next:  one goal per run, then free play', 'Next:  the model decides more, the script less']
card('s7', 7.0, [dt('HANDOFF TO THE NEXT AGENT', 56, ORANGE, 60, 50, 0.15),
                 *[dt(line, 36, CREAM, 60, 185 + 80 * i, 0.7 + 1.0 * i, BOLD) for i, line in enumerate(lines)],
                 box(60, 548, 1160, 4, ORANGE, 'gte(t,5.0)'),
                 dt('Same seed. Start from zero. Go further.', 50, CREAM, CENTRE, 585, 5.0)])
scene('s7', 7.0, [(0.15, 'pop'), *[(0.7 + 1.0 * i, 'pop') for i in range(4)], (4.0, 'riser'), (5.0, 'boom')])

TOTAL = sum(s for _, s in scenes)

# ---- the sound: every effect is worked out here, sample by sample.
random.seed(34)
TAU = 2 * math.pi


def tone(seconds, fn):
    return [fn(i / SR) for i in range(int(seconds * SR))]


def whoosh(seconds=0.45):
    out, low = [], 0.0
    for i in range(int(seconds * SR)):
        k = i / (seconds * SR)
        low += (0.05 + 0.5 * math.sin(math.pi * k)) * (random.uniform(-1, 1) - low)
        out.append(low * math.sin(math.pi * k) ** 2)
    return out


KINDS = {
    'pop': (0.5, lambda: tone(0.12, lambda t: math.sin(TAU * (900 - 3000 * t) * t) * math.exp(-38 * t))),
    'tick': (0.22, lambda: tone(0.05, lambda t: math.sin(TAU * 1800 * t) * math.exp(-90 * t))),
    'ding': (0.3, lambda: tone(1.0, lambda t: (math.sin(TAU * 1047 * t) + 0.6 * math.sin(TAU * 1568 * t) + 0.3 * math.sin(TAU * 2093 * t)) * math.exp(-5 * t))),
    'buzz': (0.22, lambda: tone(0.35, lambda t: ((1 if math.sin(TAU * 98 * t) > 0 else -1) + (1 if math.sin(TAU * 104 * t) > 0 else -1)) * math.exp(-9 * t))),
    'boom': (0.9, lambda: tone(1.2, lambda t: math.sin(TAU * (70 - 14 * t) * t) * math.exp(-3.2 * t) + 0.4 * random.uniform(-1, 1) * math.exp(-30 * t))),
    'riser': (0.3, lambda: tone(1.0, lambda t: (math.sin(TAU * (180 * t + 300 * t ** 3)) + 0.5 * random.uniform(-1, 1) * t) * t * t)),
    'whoosh': (0.9, whoosh),
}
sound = array.array('f', [0.0]) * int(TOTAL * SR)


def put(at, samples, gain):
    start = int(at * SR)
    for i, v in enumerate(samples[:max(0, len(sound) - start)]):
        sound[start + i] += gain * v


for at, kind in events:
    gain, make = KINDS[kind]
    put(at, make(), gain)
# A quiet pulse underneath, to keep things moving while someone talks over it.
kick = tone(0.22, lambda t: math.sin(TAU * (95 * t - 150 * t * t)) * math.exp(-14 * t))
hat = tone(0.03, lambda t: random.uniform(-1, 1) * math.exp(-140 * t))
for beat in range(int(TOTAL / 0.5)):
    put(beat * 0.5, kick, 0.16)
    put(beat * 0.5 + 0.25, hat, 0.03)
with wave.open(f'{WORK}/sfx.wav', 'wb') as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(SR)
    frames = array.array('h')
    for v in sound:
        s = int(32767 * math.tanh(v))
        frames.extend((s, s))
    out.writeframes(frames.tobytes())

# ---- join the scenes, lay a progress line along the bottom, add the sound.
with open(f'{WORK}/list.txt', 'w') as out:
    out.writelines(f"file '{WORK}/{name}.mp4'\n" for name, _ in scenes)
ffmpeg(['-f', 'concat', '-safe', '0', '-i', f'{WORK}/list.txt', '-c', 'copy', f'{WORK}/all.mp4'])
ffmpeg(['-i', f'{WORK}/all.mp4', '-f', 'lavfi', '-i', f'color=c={ORANGE}:s={W}x6:r={FPS}', '-i', f'{WORK}/sfx.wav',
        '-filter_complex', f"[0:v][1:v]overlay=x='-{W}+{W}*t/{TOTAL}':y={H - 6}:shortest=1[v]",
        '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', str(TOTAL), OUT])
print(f'{OUT}  ({TOTAL} seconds, {len(events)} sound effects)')
