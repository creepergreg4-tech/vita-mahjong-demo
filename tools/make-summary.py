"""One-page Chinese planning mind map, with screenshots from verified play sessions."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

root=Path(__file__).resolve().parents[1]
out=root/'delivery';out.mkdir(exist_ok=True)
file=out/'Vita Mahjong玩法设计与迭代总结.pdf'
pdfmetrics.registerFont(TTFont('CN','C:/Windows/Fonts/msyh.ttc'))
pdfmetrics.registerFont(TTFont('CNBold','C:/Windows/Fonts/msyhbd.ttc'))
W,H=1190,842
c=canvas.Canvas(str(file),pagesize=(W,H))
c.setTitle('Vita Mahjong玩法设计与迭代总结')
c.setAuthor('项目总结')
bg='#F6F4ED';ink='#173C32';muted='#60736B';gold='#B58136'
def box(x,y,w,h,fill,stroke=None,r=12):
 c.setFillColor(HexColor(fill));c.setStrokeColor(HexColor(stroke or fill));c.roundRect(x,y,w,h,r,fill=1,stroke=int(bool(stroke)))
def text(s,x,y,size=12,color=ink,bold=False):
 c.setFillColor(HexColor(color));c.setFont('CNBold' if bold else 'CN',size);c.drawString(x,y,s)
def wrap(s,width,size):
 result=[];line=''
 for ch in s:
  if pdfmetrics.stringWidth(line+ch,'CN',size)>width:
   if ch in '，。；：！？、）' and line:
    result.append(line[:-1]);line=line[-1]+ch
   else:result.append(line);line=ch
  else: line+=ch
 if line:result.append(line)
 return result
def para(s,x,y,w,size=12,color=muted,leading=19):
 for line in wrap(s,w,size):text(line,x,y,size,color);y-=leading
 return y
def curve(x1,y1,x2,y2,color):
 c.setStrokeColor(HexColor(color));c.setLineWidth(2.2);p=c.beginPath();p.moveTo(x1,y1);p.curveTo(x1+42,y1,x2-40,y2,x2,y2);c.drawPath(p)

box(0,0,W,H,bg,r=0)
text('在熟悉的二合里，做出新的解法',36,786,30,bold=True)
text('Vita Mahjong 微创新总结',38,753,15,muted)
text('30关主线，另加1关整线实验。保留首页、游戏页和结果页。',38,728,12,muted)
box(991,751,163,42,'#173C32',r=21);text('手机网页体验  2.7',1010,766,14,'#F5E7C7',True)
c.setStrokeColor(HexColor('#DADFD5'));c.line(36,707,1154,707)

# The connective structure is the document's primary navigation.
box(36,436,151,110,'#173C32',r=16)
text('巧解麻将',58,512,23,'#FFF3D4',True)
text('先想怎么取牌',58,480,15,'#FFF3D4')
text('再享受消除',58,457,15,'#FFF3D4')
branches=[
 (640,'核心不变','#DDECE2','#3E8169',[
  ('二合与四格缓冲','普通取牌仍受上层遮挡和左右夹牌限制。'),
  ('熟悉的操作手感','复用原牌面、飞牌、连击语音和彩色槽框。')]),
 (540,'改变取牌选择','#F4E6CC','#B58A43',[
  ('暂存解围，爆破开路','暂存放行表面夹牌，特殊牌配对后才生效。'),
  ('礼盒保留风险','70%正向，30%轻负面，最多遮住四张表面牌。')]),
 (440,'让棋盘变化','#E0E8F0','#6686A5',[
  ('移动改变下一步','取走即补位，搭配外圈旋转和周期传送。'),
  ('整线实验','二合后下落，凑齐一行或一列六张同牌消除。')]),
 (340,'惊喜也要解谜','#EFE0D8','#B17A65',[
  ('龙头和转轮吐牌','首次加入六张普通牌，两叠三层，顶牌不同。'),
  ('控制节奏','先拆当前牌堆，占槽过多时延后，每关最多三次。')]),
]
for y,title,fill,line,leaves in branches:
 curve(187,491,220,y+12,line)
 box(220,y-8,118,42,fill,r=10);text(title,234,y+7,14,line,True)
 c.setStrokeColor(HexColor(line));c.setLineWidth(1.5);c.line(338,y+12,356,y+12)
 for i,(heading,desc) in enumerate(leaves):
  yy=y+29-i*44
  text(heading,366,yy,13,ink,True)
  para(desc,366,yy-19,332,11,muted,15)
text('设计取舍：随机带来新局面，解题仍靠玩家判断。',220,284,13,ink,True)

# Three real game states, never mock screenshots.
shots=[
 ('开箱与奖励到账','test-output/v9-reward/03-gold-reveal.png'),
 ('转轮加入新牌堆','test-output/v11-stacks/19-03-stacked-puzzle.png'),
 ('整线巧解实验','test-output/v8-lines/04-line-opening-guide.png')]
for i,(label,name) in enumerate(shots):
 x=730+i*145
 text(label,x+2,661,12,ink,True)
 c.drawImage(ImageReader(str(root/name)),x,357,width=132,height=286,preserveAspectRatio=True,mask='auto')
text('截图来自实际运行版本',733,333,10,muted)
para('新增普通牌会形成遮挡。先拆哪一叠、何时用暂存，都会改变后续取牌顺序。',733,310,415,12,ink,19)

text('从试玩问题，回到具体修复',36,245,19,ink,True)
issues=[
 ('取牌规则混淆','普通点击严格判断遮挡和夹牌。暂存单独放行表面牌，不穿透上层。'),
 ('暂存救不了局','补齐蓝背与特殊牌。存入不触发能力，配对才结算，同步修复回退与存档。'),
 ('磁铁后补位停住','从配对成功后移动，改为每张离开棋盘即补位，避免空洞阻断后续操作。'),
 ('机关只是送福利','改为有先后顺序的普通叠牌，保留少量特殊结果，并验证新增牌后的完整解法。'),
 ('开箱发黑又生硬','拆开宝箱与发光层，复用原素材。开盖亮起金光，奖励飞入后再加数量。'),
]
for i,(heading,desc) in enumerate(issues):
 x=36+i*226
 box(x,102,214,122,'#FFFFFF','#E1E4DB',10)
 text(str(i+1).zfill(2),x+13,202,11,gold,True)
 text(heading,x+39,201,14,ink,True)
 para(desc,x+14,178,186,11,muted,19)

url='https://creepergreg4-tech.github.io/vita-mahjong-demo/'
text('验证与交付',36,76,12,ink,True)
text('89项自动检查通过，四个机关关均有完整解法。手机手感继续结合实测调整。',126,76,10,muted)
text('关卡为参考原版体验后的新编排，并非原APK前30关。AI辅助编码、资源整理和回归检查。',36,54,10,muted)
text('工程随包提供，固定体验链接支持手机浏览器打开。',36,34,10,muted)
c.setFillColor(HexColor('#296A55'));c.setFont('CN',9);c.drawString(744,40,'打开手机体验链接');c.linkURL(url,(742,30,900,60),relative=0)
q=qr.QrCodeWidget(url);bound=q.getBounds();d=Drawing(66,66,transform=[66/(bound[2]-bound[0]),0,0,66/(bound[3]-bound[1]),0,0]);d.add(q);renderPDF.draw(d,c,1086,23)
c.showPage();c.save();print(file)
