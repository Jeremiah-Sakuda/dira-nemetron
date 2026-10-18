#!/usr/bin/env python3
"""Render the measured v2 screen walkthrough; requires macOS say, magick and ffmpeg."""
import argparse
import json
import subprocess
import tempfile
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--storyboard',type=Path,default=ROOT/'docs/demo/v2/storyboard.json')
parser.add_argument('--output',type=Path)
args=parser.parse_args()
ASSETS = args.storyboard.resolve().parent
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
story = json.loads(args.storyboard.read_text())
output = args.output or ASSETS / 'dira-v2-walkthrough-draft.mp4'

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
        title = textwrap.fill(scene['title'], 70)
        run('magick', '-size', '1920x1080', 'xc:#11110f',
            '-font', FONT, '-fill', '#f2ede1', '-pointsize', '24', '-annotate', '+64+48', 'DIRA / PERSONAL AI',
            '-fill', '#579bdb', '-pointsize', '22', '-annotate', '+1490+48', f'{index:02} / {len(story["scenes"]):02} | '+story['capturedDate'],
            '-fill', '#f2ede1', '-pointsize', '42', '-annotate', '+64+108', title,
            '(', str(ASSETS / scene['image']), '-resize', '1700x830', ')',
            '-gravity', 'north', '-geometry', '+0+145', '-composite',
            '-gravity', 'northwest', '-fill', '#c9c4b9', '-pointsize', '26', '-annotate', '+64+1004', scene['caption'],
            '-fill', '#929084', '-pointsize', '18', '-annotate', '+64+1046', 'Actual product screenshots | edited narrated walkthrough | execution time not shown', str(frame))
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
    def timestamp(seconds):
        millis=round(seconds*1000)
        return f'{millis//3600000:02}:{(millis//60000)%60:02}:{(millis//1000)%60:02}.{millis%1000:03}'
    cues=['WEBVTT','']; elapsed=0.0
    chapters=[]
    for scene,duration in zip(story['scenes'],durations):
        words=scene['narration'].split(); spoken=duration-1.2
        chapters.append({'title':scene['title'],'startSeconds':elapsed,'durationSeconds':duration})
        for offset in range(0,len(words),14):
            start=elapsed+spoken*offset/len(words);end=elapsed+spoken*min(offset+14,len(words))/len(words)
            cues.extend([f'{timestamp(start)} --> {timestamp(end)}',textwrap.fill(' '.join(words[offset:offset+14]),64),''])
        elapsed+=duration
    output.with_suffix('.vtt').write_text('\n'.join(cues))
    output.with_suffix('.json').write_text(json.dumps({'title':story['title'],'capturedDate':story['capturedDate'],'disclosure':story['disclosure'],'durationSeconds':sum(durations),'voice':'macOS Samantha','wordsPerMinute':170,'chapters':chapters},indent=2)+'\n')
    print(f'Video saved: {output} ({sum(durations):.1f}s)', flush=True)
