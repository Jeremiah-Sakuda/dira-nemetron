#!/usr/bin/env python3
"""Render the measured v2 screen walkthrough; requires macOS say, magick and ffmpeg."""
import json
import subprocess
import tempfile
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs/demo/v2'
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
story = json.loads((ASSETS / 'storyboard.json').read_text())
output = ASSETS / 'dira-v2-walkthrough-draft.mp4'

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

with tempfile.TemporaryDirectory(prefix='dira-v2-video-') as temp:
    temp = Path(temp)
    clips, durations = [], []
    for index, scene in enumerate(story['scenes'], 1):
        speech = temp / f'{index}.txt'
        audio = temp / f'{index}.aiff'
        frame = temp / f'{index}.png'
        clip = temp / f'{index}.mp4'
        speech.write_text(scene['narration'])
        run('/usr/bin/say', '-v', 'Samantha', '-r', '170', '-f', str(speech), '-o', str(audio))
        measured = subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(audio)
        ]).decode().strip()
        if measured == 'N/A':
            raise RuntimeError('Speech produced no audio; macOS installed voice access is required')
        seconds = float(measured) + 1.2
        seconds = max(seconds, 12)
        durations.append(seconds)
        title = textwrap.fill(scene['title'], 24)
        run('magick', '-size', '1280x720', 'xc:#11110f',
            '-font', FONT, '-fill', '#f2ede1', '-pointsize', '22', '-annotate', '+64+76', 'DIRA / PERSONAL AI',
            '-fill', '#579bdb', '-pointsize', '18', '-annotate', '+64+130', f'{index:02} / {len(story["scenes"]):02}',
            '-fill', '#f2ede1', '-pointsize', '46', '-annotate', '+64+222', title,
            '-fill', '#c9c4b9', '-pointsize', '28', '-annotate', '+64+410', scene['caption'],
            '-fill', '#929084', '-pointsize', '19', '-annotate', '+64+596', 'Live inference. Synthetic action integrations.',
            '-pointsize', '17', '-annotate', '+64+642', 'Measured October 13, 2026 | narrated capture draft',
            '-fill', '#24241f', '-draw', 'roundrectangle 816,31 1251,689 18,18',
            '(', str(ASSETS / scene['image']), '-resize', '395x618>', ')',
            '-geometry', '+836+51', '-composite', str(frame))
        run('ffmpeg', '-y', '-loop', '1', '-i', str(frame), '-i', str(audio),
            '-t', f'{seconds:.3f}', '-r', '24', '-vf', 'format=yuv420p', '-c:v', 'libx264',
            '-preset', 'fast', '-crf', '20', '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '128k',
            '-af', 'apad', '-movflags', '+faststart', str(clip))
        clips.append(clip)
        print(f'Chapter {index}: {seconds:.1f}s', flush=True)
    if sum(durations) >= 180:
        raise RuntimeError('Narration exceeds the three-minute submission limit')
    concat = temp / 'clips.txt'
    concat.write_text(''.join(f"file '{clip}'\n" for clip in clips))
    run('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat), '-c', 'copy', '-movflags', '+faststart', str(output))
    print(f'Video saved: {output} ({sum(durations):.1f}s)', flush=True)
