"""Local photo-film compositor. Original pixels, evidence-bound captions, no AI faces.

Each treatment has its own composition, pacing, transitions and illustrated motion.
Frames stream straight to FFmpeg; private intermediate frame sequences are not stored.
"""
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

W, H, FPS = 720, 960, 24


class Film:
    def __init__(self, root, plan):
        self.root, self.plan = root, plan
        self.style = plan.get('treatment', 'warm-album')
        self.snow = self.style == 'snow-journal'
        self.sweet = self.style == 'sweet-moments'
        self.making = self.style == 'little-makers'
        self.together = self.style == 'together-pages'
        self.poem = self.style == 'detail-poem'
        self.paper = '#203c3b' if self.poem else '#f6f1e5' if self.together else '#e7f0f1' if self.snow else '#fff0db' if self.sweet else '#f5efdd'
        self.ink = '#f3ead5' if self.poem else '#344f47' if self.together else '#1e454e' if self.snow else '#613534' if self.sweet else '#334f50'
        self.accent = '#f57445' if self.sweet else '#d07a4f'
        self.fonts = {}
        self.photo_cache = {}
        self.images = [ImageOps.exif_transpose(Image.open(root / f'image-{i}.jpg')).convert('RGB') for i in range(len(plan['shots']))]
        self.segments = []
        self.make_segments()

    def font(self, size, bold=False):
        key = (size, bold)
        if key not in self.fonts:
            self.fonts[key] = ImageFont.truetype(str(self.root / ('font-bold.ttf' if bold else 'font.ttf')), size)
        return self.fonts[key]

    def text(self, image, value, xy, size=30, color=None, width=610, bold=False, spacing=12):
        draw = ImageDraw.Draw(image)
        font = self.font(size, bold)
        lines, line = [], ''
        for c in str(value):
            if c == '\n' or (line and draw.textlength(line + c, font=font) > width):
                lines.append(line)
                line = '' if c == '\n' else c
            else:
                line += c
        if line:
            lines.append(line)
        if len(lines)>1 and len(lines[-1])<3 and len(lines[-2])>4:
            move=3-len(lines[-1]);lines[-1]=lines[-2][-move:]+lines[-1];lines[-2]=lines[-2][:-move]
        for n, line in enumerate(lines):
            draw.text((xy[0], xy[1] + n * (size + spacing)), line, font=font, fill=color or self.ink)
        return len(lines) * (size + spacing)

    def background(self):
        if hasattr(self,'background_cache'):return self.background_cache.copy()
        image = Image.new('RGB', (W, H), self.paper)
        d = ImageDraw.Draw(image)
        if self.together:
            d.rounded_rectangle((22,22,W-22,H-22),radius=24,outline='#d8d9c9',width=2)
            d.ellipse((460,-100,920,330),fill='#e0e4d3')
            d.ellipse((-240,790,350,1350),fill='#e9d6bd')
        elif self.poem:
            for y in range(H):
                mix=y/H
                d.line((0,y,W,y),fill=tuple(round(a*(1-mix)+b*mix) for a,b in zip((23,45,45),(52,73,66))))
            d.line((49,38,49,97),fill='#baa783',width=2)
        elif self.sweet:
            d.ellipse((-190, -220, 610, 400), fill='#ffbcbd')
            d.ellipse((420, 720, 960, 1270), fill='#d5df7f')
            for i in range(22):
                x, y = (i * 97 + 23) % W, (i * 157 + 91) % H
                d.line((x, y, x+10, y+4), fill=['#ed9373','#dadb91','#e8a8c7'][i%3], width=3)
        elif self.making:
            for x in range(0, W, 28): d.line((x, 0, x, H), fill='#e9e1cc')
            for y in range(0, H, 28): d.line((0, y, W, y), fill='#e9e1cc')
            d.rectangle((33, 0, 39, H), fill='#dc8a78')
            for y in range(40, H, 60):
                d.ellipse((13,y,24,y+11),fill='#d9cdb4')
        else:
            for y in range(H):
                mix = y/H
                a,b = ((224,237,238),(155,182,185)) if self.snow else ((252,246,231),(229,213,187))
                d.line((0,y,W,y),fill=tuple(round(a[k]*(1-mix)+b[k]*mix) for k in range(3)))
        self.background_cache=image.copy()
        return image

    def photograph(self, index, size, zoom=1, cover=True):
        image = self.images[index]
        w,h = size
        ratio=max(w/image.width,h/image.height)*zoom
        sw,sh=max(w,round(image.width*ratio)),max(h,round(image.height*ratio))
        left,top=(sw-w)/2,(sh-h)/2
        # A crop is permitted only if all detected faces retain a margin. If no
        # face box exists, use the whole photograph instead of guessing subjects.
        boxes=self.plan['shots'][index].get('faceBoxes',[])
        safe=bool(boxes) and all(b[0]*sw>=left+12 and b[2]*sw<=left+w-12 and b[1]*sh>=top+12 and b[3]*sh<=top+h-12 for b in boxes)
        if cover and safe:
            resized=image.resize((sw,sh),Image.Resampling.BICUBIC)
            return resized.crop((round(left),round(top),round(left)+w,round(top)+h))
        # Full source remains visible over an unobtrusive blurred color field.
        key=(index,w,h)
        if key in self.photo_cache:return self.photo_cache[key]
        back=ImageOps.fit(image,(w,h)).filter(ImageFilter.GaussianBlur(24))
        veil=Image.new('RGB',(w,h),self.paper)
        back=Image.blend(back,veil,.42)
        front=ImageOps.contain(image,(w,h),Image.Resampling.LANCZOS)
        back.paste(front,((w-front.width)//2,(h-front.height)//2))
        self.photo_cache[key]=back
        return back

    def paste_photo(self, canvas, index, rect, progress=0, angle=0, border=0, radius=0, cover=True):
        x,y,w,h=map(int,rect)
        motion=self.plan['shots'][index].get('motion','still')
        z=1 if motion=='still' else 1+.025*(1-progress if motion=='pull' else progress)
        pic=self.photograph(index,(w,h),z,cover)
        layer=Image.new('RGBA',(w+border*2,h+border*2),'#fffdf1')
        layer.paste(pic,(border,border))
        if radius:
            mask=Image.new('L',layer.size,0);ImageDraw.Draw(mask).rounded_rectangle((0,0,layer.width-1,layer.height-1),radius=radius,fill=255)
            layer.putalpha(mask)
        if angle:layer=layer.rotate(angle,Image.Resampling.BICUBIC,expand=True)
        shadow=Image.new('RGBA',(W,H));shadow.paste((52,38,21,45),(x+8,y+14,x+8+layer.width,y+14+layer.height))
        if border:canvas.paste(shadow.filter(ImageFilter.GaussianBlur(10)),(0,0),shadow.filter(ImageFilter.GaussianBlur(10)))
        canvas.paste(layer,(x,y),layer)

    def make_segments(self):
        shots=self.plan['shots']
        self.segments.append({'kind':'intro','duration':2.3 if self.sweet else 2.8})
        previous=''
        for i,shot in enumerate(shots):
            month=shot.get('date','')[:7]
            if i and month and previous and month!=previous and not self.sweet:
                self.segments.append({'kind':'chapter','duration':1.1,'index':i,'label':month.replace('-',' / ')})
            self.segments.append({'kind':'photo','index':i,'duration':shot['seconds']})
            if month:previous=month
        self.segments.append({'kind':'outro','duration':3.0})

    def doodle(self, image, x, y, scale=1):
        d=ImageDraw.Draw(image)
        if self.sweet:
            d.polygon([(x-20*scale,y),(x+20*scale,y),(x,y+53*scale)],fill='#d59b61')
            d.ellipse((x-25*scale,y-39*scale,x+25*scale,y+8*scale),fill='#fff8df',outline='#bc765a',width=2)
            d.arc((x-12*scale,y-42*scale,x+22*scale,y-15*scale),180,345,fill='#f78fa1',width=6)
        else:
            d.line((x,y,x+40*scale,y-48*scale),fill='#e39746',width=max(3,round(10*scale)))
            d.line((x+8*scale,y+2*scale,x+49*scale,y-47*scale),fill='#527f86',width=max(3,round(7*scale)))
            d.arc((x-58*scale,y+2*scale,x+70*scale,y+40*scale),0,200,fill='#ce7457',width=3)

    def thread(self,image,y,progress=1):
        points=[(58+i*604/80,y+17*math.sin(i/80*math.pi*2)) for i in range(round(80*progress)+1)]
        if len(points)>1:ImageDraw.Draw(image).line(points,fill='#ba8d66',width=3)
        for x in [75,645]:ImageDraw.Draw(image).ellipse((x-5,y-5,x+5,y+5),fill='#ba8d66')

    def render_story(self,segment,p):
        """Relationship spreads and quiet detail poems use distinct compositions.
        Pairing is editorial juxtaposition, never a generated interaction or crop.
        """
        image=self.background();shots=self.plan['shots'];last=len(shots)-1;kind=segment['kind']
        if self.together:
            self.text(image,'一起的这些日子',(54,51),21)
            if kind=='intro':
                self.text(image,self.plan['title'],(52,112),48,width=610,bold=True)
                self.paste_photo(image,0,(49,302,298,459),p,radius=20,cover=False)
                self.paste_photo(image,last,(373,347,298,459),p,radius=20,cover=False)
                self.thread(image,850,min(1,p*1.5))
                self.text(image,shots[0].get('date','').replace('-',' / '),(55,902),17)
            elif kind=='chapter':
                self.text(image,'日历翻过一页',(57,339),25)
                self.text(image,segment['label'],(53,405),61,bold=True)
                self.thread(image,520)
            elif kind=='outro':
                self.paste_photo(image,last,(52,154,616,494),0,radius=20,cover=False)
                self.thread(image,707)
                self.text(image,self.plan['closing'],(57,758),38,width=605,bold=True)
                self.text(image,'这一页，留给我们',(57,904),19)
            else:
                i=segment['index'];shot=shots[i];caption=shot.get('caption','')
                if shot.get('layout')=='pair' and i:
                    self.paste_photo(image,i-1,(49,198,298,419),0,radius=18,cover=False)
                    self.paste_photo(image,i,(373,279,298,419),p,radius=18,cover=False)
                    self.thread(image,752)
                    self.text(image,caption,(56,799),33,width=595,bold=True)
                else:
                    self.paste_photo(image,i,(51,145,618,580),p,radius=20,cover=False)
                    self.thread(image,772)
                    self.text(image,caption,(56,809),32,width=592,bold=True)
                self.text(image,shot.get('date','').replace('-',' / '),(57,910),17)
                self.text(image,f'{i+1:02d} / {len(shots):02d}',(568,910),17)
        else:
            self.text(image,'日常里的小小诗句',(65,48),18,'#c0cbb7')
            if kind=='intro':
                self.text(image,self.plan['title'],(54,136),49,width=606,bold=True)
                self.paste_photo(image,0,(54,322,612,491),p,radius=4,cover=False)
                self.text(image,'把目光，停在一个小瞬间',(55,872),22,'#d6cfb9')
            elif kind=='chapter':
                self.text(image,segment['label'],(58,411),59,bold=True)
                ImageDraw.Draw(image).line((62,513,178,513),fill='#baa783',width=2)
            elif kind=='outro':
                self.paste_photo(image,last,(54,144,612,529),0,cover=False)
                self.text(image,self.plan['closing'],(57,748),37,width=596,bold=True)
                ImageDraw.Draw(image).line((58,899,191,899),fill='#baa783',width=2)
            else:
                i=segment['index'];shot=shots[i]
                top=158 if shot.get('beat') in ['rest','closing'] else 124
                self.paste_photo(image,i,(52,top,616,574),p,cover=False)
                # Captions settle in after the image, leaving a quiet opening beat.
                caption_layer=image.copy()
                self.text(caption_layer,shot.get('caption',''),(58,771),34,width=595,spacing=13)
                image=Image.blend(image,caption_layer,min(1,max(0,(p-.08)/.18)))
                self.text(image,shot.get('date',''),(59,906),16,'#b7c1ae')
                self.text(image,f'{i+1:02d}',(619,900),23,'#baa783')
        return image

    def render(self, segment, seconds):
        duration=segment['duration'];p=min(1,max(0,seconds/duration))
        image=self.background();d=ImageDraw.Draw(image)
        kind=segment['kind'];shots=self.plan['shots'];last=len(shots)-1
        if self.together or self.poem:return self.render_story(segment,p)
        if kind=='intro':
            if self.snow:
                self.paste_photo(image,0,(0,0,W,660),p,cover=False)
                d.rectangle((0,624,W,H),fill='#214b55')
                self.text(image,'一小段 / 冬日纪实',(46,673),19,'#b9d9da')
                self.text(image,self.plan['title'],(42,724),47,'#fff9e9',620,True)
                self.text(image,shots[0].get('date','').replace('-',' · '),(46,892),18,'#bdd5d2')
            elif self.sweet:
                self.text(image,'SWEET LITTLE MOMENTS',(42,44),17,bold=True)
                self.text(image,self.plan['title'],(38,99),64,width=600,bold=True,spacing=6)
                self.paste_photo(image,0,(52,348,360,444),p,angle=5,border=9)
                self.paste_photo(image,last,(398,470,234,310),p,angle=-7,border=7)
                self.doodle(image,570,350,1.8)
                self.text(image,'把甜甜的片刻，装进口袋',(48,865),24)
            else:
                self.text(image,'小小创作簿' if self.making else '我们的日常放映室',(68,48),22)
                self.text(image,self.plan['title'],(67,112),51,width=584,bold=True)
                self.paste_photo(image,0,(85,326,496,438),p,angle=-3,border=12,cover=False)
                self.doodle(image,583,253,1.2)
                self.text(image,shots[0].get('date','').replace('-',' / '),(76,851),22)
        elif kind=='chapter':
            i=segment['index']
            self.paste_photo(image,i,(0,0,W,H),0,cover=False)
            image=Image.blend(image,Image.new('RGB',(W,H),self.paper),.86)
            self.text(image,'翻到另一个日子',(66,371),22)
            self.text(image,segment['label'],(60,427),62,bold=True)
            ImageDraw.Draw(image).line((66,533,326,533),fill=self.accent,width=5)
        elif kind=='outro':
            self.text(image,'片刻收藏' if self.sweet else '这一页，留给回忆',(48 if not self.making else 65,48),24,bold=True)
            indices=list(dict.fromkeys([0,last//3,2*last//3,last]))
            for n,i in enumerate(indices):
                x,y=(46+(n%2)*332,126+(n//2)*262)
                self.paste_photo(image,i,(x,y,292,225),0,border=6,angle=(2 if n%2 else -2) if not self.snow else 0,cover=False)
            self.text(image,self.plan['closing'],(52,735),39,width=610,bold=True)
            days=[s.get('date','') for s in shots if s.get('date')]
            dates=(days[0]+(' — '+days[-1] if days[-1]!=days[0] else '')) if days else ''
            self.text(image,dates,(54,891),17)
        else:
            i=segment['index'];shot=shots[i];caption=shot.get('caption','');date=shot.get('date','')
            layout={'hero':0,'pair':1,'page':2,'full':0}.get(shot.get('layout'),i%3)
            if self.snow:
                if layout==1:
                    self.paste_photo(image,i,(0,0,W,590),p)
                    self.paste_photo(image,max(0,i-1),(30,620,256,216),0,cover=False)
                    self.text(image,caption,(320,634),30,width=355,bold=True)
                    self.text(image,'同一天的小片段' if shot.get('date')==shots[max(0,i-1)].get('date') else '回望一格',(322,797),17)
                else:
                    self.paste_photo(image,i,(0,0,W,795),p)
                    d.rectangle((0,795,W,H),fill='#214b55')
                    self.text(image,caption,(42,817),31,'#fffae9',625)
                self.text(image,f'{date}    /    {i+1:02d}',(42,921),16,'#abc7c9' if layout!=1 else self.ink)
            elif self.sweet:
                self.text(image,f'{i+1:02d}',(38,30),100,bold=True)
                self.text(image,caption,(185,54),35,width=480,bold=True)
                if layout==0:
                    self.paste_photo(image,i,(47,225,608,586),p,radius=60)
                    self.doodle(image,603,822,1.1)
                elif layout==1:
                    self.paste_photo(image,max(0,i-1),(20,380,286,343),0,angle=5,border=7,cover=False)
                    self.paste_photo(image,i,(284,232,365,523),p,angle=-4,border=8)
                else:
                    self.paste_photo(image,i,(0,217,W,578),p)
                    self.doodle(image,615,840,1)
                self.text(image,date.replace('-',' / '),(43,884),20)
                ImageDraw.Draw(image).rounded_rectangle((43,928,43+int(630*(i+p)/len(shots)),934),radius=3,fill=self.accent)
            else:
                self.text(image,('观察 · ' if self.making else '回忆 · ')+f'{i+1:02d}',(68,35),21)
                if layout==0:
                    self.paste_photo(image,i,(68,142,580,594),p,border=8,cover=False)
                    self.text(image,caption,(72,779),33,width=565,bold=True)
                elif layout==1:
                    self.text(image,caption,(76,109),38,width=550,bold=True)
                    self.paste_photo(image,i,(113,330,455,496),p,angle=-4,border=10,cover=False)
                    self.doodle(image,592,296,.85)
                else:
                    self.paste_photo(image,max(0,i-1),(71,152,280,312),0,angle=3,border=5,cover=False)
                    self.paste_photo(image,i,(301,411,322,356),p,angle=-3,border=7,cover=False)
                    self.text(image,caption,(70,805),29,width=575,bold=True)
                    self.doodle(image,552,243,1.1)
                self.text(image,date.replace('-',' / '),(70,910),18)
        # Movement belongs to the scene, not an oscillating frame around the photo.
        if self.snow:
            d=ImageDraw.Draw(image)
            for j in range(24):
                x=(j*139+math.sin(seconds*.38+j)*14)%W;y=(j*199+seconds*(9+j%6))%H
                r=1+j%2;d.ellipse((x-r,y-r,x+r,y+r),fill='#f8fcf8')
        elif self.sweet and kind=='intro':
            d=ImageDraw.Draw(image);r=12+int(5*math.sin(seconds*5))
            d.ellipse((650-r,75-r,650+r,75+r),fill='#d07755')
        return image


def main():
    root=Path(sys.argv[1]).resolve()
    plan=json.loads((root/'creative-plan.json').read_text(encoding='utf-8'))
    film=Film(root,plan)
    command=[os.environ.get('FFMPEG_PATH','ffmpeg'),'-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','720x960','-r',str(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','19','-threads','2','-pix_fmt','yuv420p',str(root/'creative-silent.mp4')]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    frames=0;last=None
    try:
        for number,segment in enumerate(film.segments):
            count=round(segment['duration']*FPS)
            transition=round((.24 if film.sweet else .7 if film.poem else .5 if film.together else .42)*FPS)
            previous=last
            for n in range(count):
                frame=film.render(segment,n/FPS)
                if previous is not None and n<transition:
                    p=(n+1)/transition
                    if film.sweet or film.making:
                        old=previous.copy();cut=round(W*(1-(1-p)**3));old.paste(frame.crop((0,0,cut,H)),(0,0));frame=old
                    else:frame=Image.blend(previous,frame,p)
                if number==0 and n<8:frame=Image.blend(Image.new('RGB',(W,H),film.paper),frame,(n+1)/8)
                process.stdin.write(frame.tobytes());frames+=1;last=frame
            print(json.dumps({'progress':round(15+65*(number+1)/len(film.segments))}),flush=True)
        process.stdin.close()
        errors=process.stderr.read().decode('utf-8',errors='replace');code=process.wait()
        if code:raise RuntimeError(errors[-2000:])
        (root/'creative-result.json').write_text(json.dumps({'duration':frames/FPS,'segments':[{'kind':s['kind'],'seconds':s['duration']} for s in film.segments]}),encoding='utf-8')
    finally:
        if process.poll() is None:process.kill()


if __name__=='__main__':
    main()
