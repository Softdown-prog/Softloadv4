#!/usr/bin/env python3
"""Second pass for user-recorded vending sounds: percussion isolation for review.

This is not voice/source separation. Foreground impacts that overlap speech can
still carry fragments of the original background. Never register in the game.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess

import numpy as np
import soundfile as sf
from scipy import ndimage, signal

RATE=48000
OUT=Path("out/lhs-vending-review")

def percussive_focus(samples: np.ndarray) -> np.ndarray:
    """Soft harmonic/percussive mask plus stationary noise attenuation."""
    _freq,_time,complex_spectrum=signal.stft(
        samples,fs=RATE,nperseg=1024,noverlap=768
    )
    magnitude=np.abs(complex_spectrum)
    harmonic=ndimage.median_filter(magnitude,size=(1,33),mode="nearest")
    percussive=ndimage.median_filter(magnitude,size=(35,1),mode="nearest")
    hp_mask=percussive**1.5/(percussive**1.5+(1.20*harmonic)**1.5+1e-12)
    noise=np.percentile(magnitude,20,axis=1)[:,None]
    noise_mask=np.maximum(0.06,1.0-(noise/(magnitude+1e-8))**1.2*1.7)
    clean=complex_spectrum*(0.10+0.90*hp_mask)*noise_mask
    _t,reconstructed=signal.istft(clean,fs=RATE,nperseg=1024,noverlap=768)
    return reconstructed[:len(samples)]

def significant_impacts(samples: np.ndarray) -> list[int]:
    window=RATE//100
    count=len(samples)//window
    if not count:return []
    rms=np.sqrt(np.mean(samples[:count*window].reshape(count,window)**2,axis=1))
    baseline=ndimage.median_filter(rms,size=21)
    score=np.maximum(0,rms-baseline)
    peaks,_props=signal.find_peaks(
        score,distance=18,prominence=max(0.0035,float(np.percentile(score,99))*.15)
    )
    strong=sorted(peaks,key=lambda index:float(score[index]),reverse=True)[:6]
    return sorted(int(index) for index in strong)

def compact_impacts(samples: np.ndarray,events:list[int]) -> np.ndarray:
    output=np.zeros(int(RATE*(max(1,len(events))*.32+.16)),dtype=float)
    used=0
    for event in events:
        peak=int(event*.01*RATE)
        start=max(0,peak-int(.048*RATE))
        end=min(len(samples),peak+int(.205*RATE))
        clip=samples[start:end].copy()
        length=len(clip)
        if length<100:continue
        rise=min(300,length//4)
        fall=min(int(RATE*.09),length//2)
        envelope=np.ones(length,dtype=float)
        envelope[:rise]*=np.sin(np.linspace(0,np.pi/2,rise))**2
        envelope[-fall:]*=np.cos(np.linspace(0,np.pi/2,fall))**2
        clip*=envelope
        position=int(RATE*(used*.30+.02))
        output[position:position+length]+=clip
        used+=1
    output=output[:int(RATE*(used*.30+.05))]
    peak=np.max(np.abs(output)) if len(output) else 0.0
    if peak>0:output*=.42/peak
    return output

def main() -> None:
    report={}
    for index in (1,2):
        source=OUT/f"vending_0{index}_completo.ogg"
        if not source.is_file():raise SystemExit(f"Missing A7 review source: {source}")
        samples,rate=sf.read(source,always_2d=False)
        if rate!=RATE or samples.ndim!=1:raise SystemExit(f"Expected 48kHz mono: {source}")
        percussion=percussive_focus(samples)
        events=significant_impacts(percussion)
        if not events:raise SystemExit(f"No detectable impacts: {source}")
        isolated=compact_impacts(percussion,events)
        wav=OUT/f"refrigerante_0{index}_isolado_forte.wav"
        ogg=wav.with_suffix(".ogg")
        sf.write(wav,isolated,RATE,subtype="PCM_16")
        subprocess.run([
            "ffmpeg","-hide_banner","-loglevel","error","-y",
            "-i",str(wav),"-c:a","libvorbis","-q:a","5",str(ogg)
        ],check=True)
        report[f"refrigerante_0{index}"]={
            "source":source.name,
            "impactTimesSeconds":[round(float(i)*.01,2) for i in events],
            "previewSeconds":round(len(isolated)/RATE,3),
            "status":"review_only_not_source_separated",
        }
    (OUT/"isolamento_forte_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
