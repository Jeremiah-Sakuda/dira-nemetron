#!/usr/bin/env bash
set -euo pipefail

# v1 artifact: renders the original deterministic evidence walkthrough from
# repository assets and measured replay results. It makes no live claims. The
# v2 submission video follows docs/demo/video-script.md and is recorded from
# the running product.

video_root="docs/demo/v1"
output="$video_root/dira-demo-evidence.mp4"
font_file="/System/Library/Fonts/Supplemental/Arial.ttf"
architecture="docs/architecture/v1/dira-production.png"

command -v ffmpeg >/dev/null || {
  echo "ffmpeg is required; install it and retry." >&2
  exit 1
}
command -v magick >/dev/null || {
  echo "ImageMagick is required; install it and retry." >&2
  exit 1
}

if [[ ! -f "$font_file" || ! -f "$architecture" ]]; then
  echo "Required font or architecture asset is missing." >&2
  exit 1
fi

mkdir -p "$video_root"
frame_root="$(mktemp -d /private/tmp/dira-video.XXXXXX)"
trap 'rm -rf "$frame_root"' EXIT

render_card() {
  local file="$1"
  local heading="$2"
  local subheading="$3"
  local footer="$4"
  magick -size 1920x1080 xc:'#08111f' \
    -fill '#101f35' -draw 'roundrectangle 120,120 1800,960 32,32' \
    -fill '#22c55e' -draw 'rectangle 120,120 138,960' \
    -gravity northwest -font "$font_file" -fill '#f8fafc' -pointsize 72 -annotate +190+250 "$heading" \
    -fill '#cbd5e1' -pointsize 38 -annotate +190+405 "$subheading" \
    -fill '#94a3b8' -pointsize 28 -annotate +190+860 "$footer" \
    "$file"
}

render_card "$frame_root/01-title.png" 'DIRA' 'One thing changes. Everything adapts.' 'Evidence walkthrough | deterministic replay | 72 seconds'
render_card "$frame_root/02-problem.png" 'THE PROBLEM' 'Calendars reveal conflicts. Dira repairs the consequences.' 'A changed midterm can break preparation, recruiting, and delegated work.'
render_card "$frame_root/03-loop.png" 'AUTONOMOUS REPAIR' 'Interpret -> propagate -> measure slack -> plan -> act -> verify.' 'The first recruiter slot returns 409. Dira refreshes state and replans.'
render_card "$frame_root/04-proof.png" 'VERIFIED REPLAY' '18 / 18 assertions passed. Final global slack: +1.3h.' '20 / 20 reliability runs | 0 duplicate mutations | 0 policy violations'
render_card "$frame_root/06-judge.png" 'JUDGE THIS IN 60 SECONDS' 'Run 48-Hour Shock, then try No slots available.' 'A safe stop is evidence of autonomy too. See README: Judge quick-start.'

magick "$architecture" -resize '1680x900>' -gravity center -background '#08111f' -extent 1920x1080 \
  "$frame_root/05-architecture.png"

ffmpeg -y \
  -loop 1 -t 7 -i "$frame_root/01-title.png" \
  -loop 1 -t 10 -i "$frame_root/02-problem.png" \
  -loop 1 -t 18 -i "$frame_root/03-loop.png" \
  -loop 1 -t 12 -i "$frame_root/04-proof.png" \
  -loop 1 -t 15 -i "$frame_root/05-architecture.png" \
  -loop 1 -t 10 -i "$frame_root/06-judge.png" \
  -filter_complex '[0:v][1:v][2:v][3:v][4:v][5:v]concat=n=6:v=1:a=0,format=yuv420p[out]' \
  -map '[out]' -c:v libx264 -crf 20 -preset medium -movflags +faststart "$output"

echo "Rendered $output"
