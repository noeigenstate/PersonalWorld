"""Install verified OpenCV Zoo face models into the ignored local data directory."""
import hashlib
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'data' / 'identity-models'
MODELS = [
    ('face_detection_yunet', 'face_detection_yunet_2023mar.onnx', '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'),
    ('face_recognition_sface', 'face_recognition_sface_2021dec.onnx', '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'),
]

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    for folder, name, expected in MODELS:
        target = ROOT / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            print(f'{name}: verified'); continue
        url = f'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{folder}/{name}'
        temporary = target.with_suffix('.download')
        with urllib.request.urlopen(url, timeout=45) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'{name}: SHA-256 mismatch')
        temporary.replace(target)
        license_url = f'https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/{folder}/LICENSE'
        (ROOT / (folder + '-LICENSE')).write_bytes(urllib.request.urlopen(license_url, timeout=20).read())
        print(f'{name}: installed and verified')

if __name__ == '__main__':
    main()
