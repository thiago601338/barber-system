import subprocess,sys,json
from PIL import Image
vid=sys.argv[1]; n=int(sys.argv[2]) if len(sys.argv)>2 else 6
dur=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'out/{vid}.mp4']))
ts=[2.6+(dur-5.4)*i/(n-1) for i in range(n)]
sheet=Image.new('RGB',(640*3,400*((n+2)//3)),'white')
for i,t in enumerate(ts):
    subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',f'{t:.2f}','-i',f'out/{vid}.mp4','-frames:v','1','-vf','scale=640:-2',f'check/f.jpg'],check=True)
    sheet.paste(Image.open('check/f.jpg'),(640*(i%3),400*(i//3)))
sheet.save(f'check/{vid}.jpg',quality=80); print(f'check/{vid}.jpg')
