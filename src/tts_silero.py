#!/usr/bin/env python3
"""Silero TTS v5 (русский, локально) — синтез из файла в wav.
Один запуск = одна загрузка модели. Режимы:
  --text-file in.txt --out out.wav            (один текст)
  --text-file in.txt --multi --out base       (чанки разделены строкой ===CHUNK=== → base.part0.wav, base.part1.wav ...)
"""
import argparse, sys, wave

import torch

CHUNK_MARK = '===CHUNK==='

def save_wav(audio, out, rate=48000):
    pcm = (audio * 32767).clamp(-32768, 32767).to(torch.int16).numpy()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--text-file', required=True)
    ap.add_argument('--speaker', default='xenia')
    ap.add_argument('--out', required=True)
    ap.add_argument('--multi', action='store_true')
    a = ap.parse_args()

    importer = torch.package.PackageImporter(a.model)
    model = importer.load_pickle('tts_models', 'model')

    content = open(a.text_file, encoding='utf-8').read()
    if a.multi:
        chunks = [c.strip() for c in content.split(CHUNK_MARK) if c.strip()]
        for i, text in enumerate(chunks):
            audio = model.apply_tts(text=text, speaker=a.speaker, sample_rate=48000)
            save_wav(audio, f'{a.out}{i}.wav')
        print('OK parts', len(chunks))
    else:
        text = content.strip()
        if not text:
            sys.exit(1)
        audio = model.apply_tts(text=text, speaker=a.speaker, sample_rate=48000)
        save_wav(audio, a.out)
        print('OK', a.out)

if __name__ == '__main__':
    main()
