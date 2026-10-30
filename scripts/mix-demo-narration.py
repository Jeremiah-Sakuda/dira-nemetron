#!/usr/bin/env python3
"""Fit generated speech to the eight demo chapters and mux a narrated copy."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    records = json.loads((args.work/'generation.json').read_text())
    clips = []
    for scene in records:
        source = args.work/f'{scene["index"]:02}.wav'
        scan = run(['ffmpeg', '-hide_banner', '-i', str(source), '-af',
                    'silencedetect=n=-45dB:d=0.15', '-f', 'null', '-']).stderr
        silences = re.findall(r'silence_(start|end): ([0-9.]+)', scan)
        start, end = 0.0, scene['generatedSeconds']
        if len(silences) > 1 and silences[0] == ('start', '0'):
            start = max(0.0, float(silences[1][1])-0.10)
        if len(silences) > 1 and silences[-1][0] == 'end':
            if abs(float(silences[-1][1])-end) < 0.05:
                end = min(end, float(silences[-2][1])+0.20)
        speed = (end-start)/(scene['duration']-0.35)
        if not 0.70 <= speed <= 1.5:
            raise RuntimeError(f'Chapter {scene["index"]+1} needs a new take: {speed:.2f}x')
        target = args.work/f'fit-{scene["index"]:02}.wav'
        filters = (f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,'
                   f'atempo={speed:.8f},loudnorm=I=-16:TP=-1.5:LRA=7,'
                   f'aresample=48000,adelay=100,asetpts=N/SR/TB,'
                   f'apad=whole_len={scene["duration"]*48000},'
                   f'atrim=end_sample={scene["duration"]*48000}')
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-af', filters,
             '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(target)])
        scene['trimStartSeconds'] = round(start, 5)
        scene['trimEndSeconds'] = round(end, 5)
        scene['tempoFactor'] = round(speed, 5)
        scene['speechStartSeconds'] = scene['start']+0.10
        scene['speechEndSeconds'] = scene['start']+scene['duration']-0.25
        clips.append(target.resolve())
        print(f'Chapter {scene["index"]+1}: fitted {scene["duration"]}s, {speed:.3f}x', flush=True)
    concat = args.work/'audio-concat.txt'
    concat.write_text(''.join(f"file '{p}'\n" for p in clips))
    narration = args.output.with_name('dira-gemini-narration.wav')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i',
         str(concat), '-c:a', 'pcm_s16le', str(narration)])
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(args.video), '-i', str(narration),
         '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
         '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '160',
         '-metadata', 'title=Dira — Your Commitments, Kept',
         '-metadata', 'comment=Actual screen footage; synthetic integrations; Gemini-generated narration.',
         '-movflags', '+faststart', str(args.output)])
    usage = [s.get('usage', {}) for s in records]
    input_tokens = sum(u.get('promptTokenCount', 0) for u in usage)
    output_tokens = sum(u.get('candidatesTokenCount', 0) for u in usage)
    manifest = {'provider': 'Google Cloud Vertex AI', 'model': records[0]['model'],
                'voice': records[0]['voice'], 'narration': 'AI-generated speech',
                'durationSeconds': 160, 'inputTokens': input_tokens, 'audioOutputTokens': output_tokens,
                'estimatedTtsCostUsd': round(input_tokens*0.5/1e6+output_tokens*10/1e6, 6),
                'pricingReference': 'https://cloud.google.com/text-to-speech/pricing',
                'silentMasterSha256': hashlib.sha256(args.video.read_bytes()).hexdigest(),
                'chapters': records}
    (args.output.parent/'gemini-narration.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(args.output, flush=True)


if __name__ == '__main__':
    main()
