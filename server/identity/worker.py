"""Local JSON-lines worker: detection and identity features only. Never infers names/age/gender."""
import base64
import hashlib
import json
import sys
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(2)
root = Path(sys.argv[1])
detector_path = root / 'face_detection_yunet_2023mar.onnx'
recognizer_path = root / 'face_recognition_sface_2021dec.onnx'
fingerprint = 'yunet-sface-v1:' + hashlib.sha256(
    detector_path.read_bytes() + recognizer_path.read_bytes() + cv2.__version__.encode()
).hexdigest()[:24]
detector = cv2.FaceDetectorYN_create(str(detector_path), '', (640, 640), .88, .3, 500)
recognizer = cv2.FaceRecognizerSF_create(str(recognizer_path), '')

def detect(filename):
    image = cv2.imdecode(np.frombuffer(Path(filename).read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('无法读取这张照片')
    h, w = image.shape[:2]
    scale = min(1., 960. / max(w, h))
    small = cv2.resize(image, (round(w * scale), round(h * scale)))
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, detected = detector.detect(small)
    faces = []
    for face in sorted(detected if detected is not None else [], key=lambda f: -float(f[2] * f[3]))[:32]:
        actual = face.copy(); actual[:14] /= scale
        x, y, fw, fh = actual[:4]
        left, top = max(0, int(x)), max(0, int(y))
        right, bottom = min(w, int(x + fw)), min(h, int(y + fh))
        if min(right-left, bottom-top) < 28:
            continue
        aligned = recognizer.alignCrop(image, actual)
        feature = recognizer.feature(aligned).flatten().astype(float)
        norm = np.linalg.norm(feature)
        if not np.isfinite(feature).all() or norm < 1e-8:
            continue
        blur = float(cv2.Laplacian(cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var())
        quality = 'good' if min(fw, fh) >= 65 and blur >= 35 and float(face[-1]) >= .93 else 'review'
        # Context around the face makes human correction easier; no originals retained.
        mx, my = int(fw * .25), int(fh * .25)
        thumb = image[max(0,top-my):min(h,bottom+my),max(0,left-mx):min(w,right+mx)]
        thumb = cv2.resize(thumb,(128,128))
        _, jpeg = cv2.imencode('.jpg',thumb,[cv2.IMWRITE_JPEG_QUALITY,88])
        faces.append({'box':[left/w,top/h,right/w,bottom/h], 'confidence':float(face[-1]),
            'embedding':(feature/norm).tolist(),'quality':quality,'blur':round(blur,1),
            'thumb':base64.b64encode(jpeg).decode('ascii')})
    return {'fingerprint':fingerprint,'width':w,'height':h,'faces':faces}

for line in sys.stdin:
    try:
        request = json.loads(line)
        result = {'fingerprint':fingerprint,'engine':'OpenCV YuNet + SFace'} if request.get('action') == 'status' else detect(request['path'])
        print(json.dumps({'id':request.get('id'),'result':result},ensure_ascii=True),flush=True)
    except Exception as error:
        print(json.dumps({'id':request.get('id') if 'request' in locals() else None,'error':str(error)[:300]},ensure_ascii=True),flush=True)
