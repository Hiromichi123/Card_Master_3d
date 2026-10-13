"""Download selected CC0 SFX, trim leading silence and normalize to -6 dBFS.
Run from the repository root with Python and ffmpeg on PATH. No full packs are saved.
"""
import argparse
import io
import json
import math
import struct
import subprocess
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/audio'
SOURCES = {
    'casino': ('https://kenney.nl/assets/casino-audio', 'Kenney', 'https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip'),
    'interface': ('https://kenney.nl/assets/interface-sounds', 'Kenney', 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip'),
    'kenney': ('https://kenney.nl/assets/rpg-audio', 'Kenney', 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip'),
    'rpg': ('https://opengameart.org/content/80-cc0-rpg-sfx', 'rubberduck', 'https://opengameart.org/sites/default/files/80-CC0-RPG-SFX_0.zip'),
    'ice': ('https://opengameart.org/content/ice-spells', 'bart', 'https://opengameart.org/sites/default/files/icespells.zip'),
    'spell': ('https://opengameart.org/content/spell-sounds', 'Brandon Morris / Augmentality (uploaded by HaelDB)', 'https://opengameart.org/sites/default/files/'),
}
# cue, source, original, maximum duration in seconds
SELECTION = [
    ('attack', 'kenney', 'Audio/knifeSlice.ogg', .35),
    ('hit', 'kenney', 'Audio/chop.ogg', .3),
    ('deal', 'casino', 'Audio/card-slide-1.ogg', .8),
    ('play', 'kenney', 'Audio/bookFlip1.ogg', .3),
    ('uiClick', 'interface', 'Audio/click_001.ogg', .2),
    ('slash', 'rpg', 'blade_02.ogg', .65),
    ('fire', 'rpg', 'spell_fire_02.ogg', .9),
    ('ice', 'ice', 'ice.wav', .9),
    ('lightning', 'spell', 'electricspell.ogg', .65),
    ('heal', 'spell', 'healing.ogg', 1.2),
    ('shield', 'rpg', 'metal_02.ogg', .5),
    ('teleport', 'spell', 'teleport.ogg', .9),
]


def run_ffmpeg(data, args):
    result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', *args, 'pipe:1'], input=data, capture_output=True, check=True)
    return result.stdout


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    parser = argparse.ArgumentParser()
    parser.add_argument('--cues', nargs='+', choices=[item[0] for item in SELECTION])
    selected = parser.parse_args().cues
    packs = {}
    manifest = OUT / 'sources.json'
    records = json.loads(manifest.read_text(encoding='utf-8')) if selected and manifest.exists() else []
    for cue, source, name, max_seconds in SELECTION:
        if selected and cue not in selected:
            continue
        page, author, url = SOURCES[source]
        if source == 'spell':
            download = url + name
            data = urllib.request.urlopen(download, timeout=60).read()
        else:
            download = url
            if source not in packs:
                packs[source] = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=60).read()))
            data = packs[source].read(name)
        pcm = run_ffmpeg(data, ['-f', 'f32le', '-ac', '1', '-ar', '22050'])
        values = [x[0] for x in struct.iter_unpack('<f', pcm)]
        first = next((i for i, x in enumerate(values) if abs(x) > .003), 0)
        start = max(0, first - 110)  # Keep a 5 ms onset margin.
        values = values[start:start + int(max_seconds * 22050)]
        # Ice recordings contain isolated spikes; tame them before peak scaling.
        # Otherwise the sustained ice texture is ~30 dB quieter than other cues.
        if source == 'ice':
            values = [.06 * math.tanh(x / .06) for x in values]
        peak = max(abs(x) for x in values)
        scale = .5 / max(peak, .0001)
        fade = min(441, len(values))
        normalized = []
        for i, x in enumerate(values):
            envelope = min(1, i / 44, (len(values) - 1 - i) / fade)
            normalized.append(x * scale * max(0, envelope))
        # Very short clicks can peak inside the fade-in; normalize the final envelope.
        if cue == 'uiClick':
            correction = .5 / max(max(abs(x) for x in normalized), .0001)
            normalized = [x * correction for x in normalized]
            scale *= correction
        # Use a canonical PCM WAV: browser decoding does not depend on OGG support.
        import wave
        path = OUT / f'{cue}.wav'
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(22050)
            wav.writeframes(b''.join(struct.pack('<h', round(x * 32767)) for x in normalized))
        actual_peak = max(abs(x) for x in normalized)
        record = {'cue': cue, 'author': author, 'url': page, 'download': download,
                  'original': name, 'destination': f'public/assets/audio/{cue}.wav', 'license': 'CC0-1.0',
                  'bytes': path.stat().st_size, 'durationSeconds': round(len(normalized) / 22050, 4),
                  'peakDbfs': round(20 * math.log10(max(actual_peak, 1e-8)), 2),
                  'trimStartSeconds': round(start / 22050, 4), 'gainMultiplier': round(scale, 5),
                  'spikeTreatment': '0.06 * tanh(sample / 0.06)' if source == 'ice' else 'none'}
        records = [item for item in records if item['cue'] != cue]
        records.append(record)
        print(f'{cue}: {record["bytes"]} bytes, {record["durationSeconds"]} s, {record["peakDbfs"]} dBFS')
    order = ['deal', 'play', 'uiClick', 'hit', 'attack', 'slash', 'fire', 'ice', 'lightning', 'heal', 'shield', 'teleport']
    records.sort(key=lambda item: order.index(item['cue']))
    (OUT / 'sources.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'LICENSE.txt').write_text('Selected sound effects: CC0 1.0 Universal\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nAuthors, source pages and original filenames: sources.json\nSpell sounds offers CC0 and OGA-BY; these files are used under CC0.\nProcessing: mono PCM16 WAV at 22050 Hz, leading silence trimmed, duration capped,\npeak normalized to <= -6 dBFS, 2 ms fade-in and 20 ms fade-out.\nReproduce with scripts/prepare-audio.py (requires ffmpeg).\n', encoding='utf-8')
    print('Total audio bytes:', sum(r['bytes'] for r in records))


if __name__ == '__main__':
    main()
