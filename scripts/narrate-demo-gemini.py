#!/usr/bin/env python3
"""Generate chapter narration via an existing gcloud login.

Example:
  python3 scripts/narrate-demo-gemini.py --project PROJECT_ID \
    --script docs/demo/v2/2026-10-30-recording/voiceover-script.md \
    --work .dira-runtime/demo-recording-20261030/gemini-tts

Uses only Python's standard library, gcloud, ffmpeg and ffprobe.
Credentials are held in memory and never written to the output files.
"""
import argparse
import base64
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stdout


def seconds(value):
    minute, second = value.split(':')
    return int(minute) * 60 + int(second)


def chapters(script):
    blocks = re.findall(
        r'^## (\d+:\d+)–(\d+:\d+) — ([^\n]+)\n\n(.*?)(?=\n## |\Z)',
        script, re.M | re.S,
    )
    return [dict(index=i, start=seconds(a), duration=seconds(b)-seconds(a),
                 title=title, text=text.strip())
            for i, (a, b, title, text) in enumerate(blocks)]


def synthesize(args, scenes):
    token = run(['gcloud', 'auth', 'print-access-token', '--project', args.project,
                 '--quiet']).strip()
    endpoint = (f'https://{args.location}-aiplatform.googleapis.com/v1beta1/'
                f'projects/{args.project}/locations/{args.location}/publishers/'
                f'google/models/{args.model}:generateContent')
    records = []
    for scene in scenes:
        target = args.work / f'{scene["index"]:02}.wav'
        receipt = target.with_suffix('.json')
        if target.exists() and receipt.exists():
            cached = json.loads(receipt.read_text())
            if (cached['text'], cached['model'], cached['voice']) != (
                    scene['text'], args.model, args.voice):
                raise RuntimeError(f'Cached audio differs from script: {target}')
            records.append(cached)
            print(f'Chapter {scene["index"]+1}: using saved narration', flush=True)
            continue
        prompt = (
            'Read only the passage below as narration for a product demonstration. '
            'One warm, clear, confident American English narrator. Natural conversation, '
            'precise articulation, calm energy. No introduction, no music, no sound effects. '
            f'Aim to finish this passage in {scene["duration"]-0.8:.1f} seconds. '
            'Dira is pronounced DEE-rah. Nebius is NEH-bee-us. '
            'Nemotron is NEH-moh-tron. NVIDIA is en-VID-ee-uh. Maya is MY-uh. '
            'Read HTTP as H T T P, 409 as four-oh-nine, and 403 as four-oh-three. '
            'Do not read these directions aloud. Passage:\n\n' + scene['text']
        )
        payload = {
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'generationConfig': {
                'responseModalities': ['AUDIO'],
                'speechConfig': {
                    'languageCode': 'en-US',
                    'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': args.voice}},
                },
            },
        }
        request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(),
            headers={'Authorization': f'Bearer {token}',
                     'x-goog-user-project': args.project,
                     'Content-Type': 'application/json'})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            body = json.loads(error.read())
            message = body.get('error', {}).get('message', 'request failed')
            raise RuntimeError(f'TTS HTTP {error.code}: {message}') from None
        candidates = result.get('candidates', [])
        if not candidates or candidates[0].get('finishReason') != 'STOP':
            raise RuntimeError('Speech generation did not finish normally')
        parts = candidates[0].get('content', {}).get('parts', [])
        audio = next((p['inlineData'] for p in parts
                      if p.get('inlineData', {}).get('mimeType', '').startswith('audio/')), None)
        if not audio:
            raise RuntimeError('No audio returned by the speech model')
        content = base64.b64decode(audio['data'])
        if content.startswith(b'RIFF'):
            target.write_bytes(content)
        else:
            rate = int(re.search(r'rate=(\d+)', audio['mimeType']).group(1))
            with wave.open(str(target), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(rate)
                output.writeframes(content)
        duration = float(run(['ffprobe', '-v', 'error', '-show_entries',
                              'format=duration', '-of', 'csv=p=0', str(target)]))
        record = dict(scene, model=args.model, voice=args.voice,
                      generatedSeconds=duration, requestSeconds=round(time.monotonic()-started, 2),
                      mimeType=audio['mimeType'], usage=result.get('usageMetadata', {}))
        receipt.write_text(json.dumps(record, indent=2)+'\n')
        records.append(record)
        print(f'Chapter {scene["index"]+1}: {duration:.2f}s generated, '
              f'{scene["duration"]}s scene', flush=True)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--script', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--location', default='us-central1')
    parser.add_argument('--model', default='gemini-2.5-flash-tts')
    parser.add_argument('--voice', default='Kore')
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    scenes = chapters(args.script.read_text())
    if len(scenes) != 8 or scenes[0]['start'] != 0 or scenes[-1]['start']+scenes[-1]['duration'] != 160:
        raise RuntimeError('Expected the agreed eight-chapter, 160-second script')
    records = synthesize(args, scenes)
    (args.work/'generation.json').write_text(json.dumps(records, indent=2)+'\n')


if __name__ == '__main__':
    main()
