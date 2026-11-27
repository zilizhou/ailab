"""A4 export for the approved experiment process report layout."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import math
import os
from pathlib import Path
import re
from threading import Lock
from xml.sax.saxutils import escape

from PIL import Image as PillowImage
from reportlab.graphics.shapes import Circle, Drawing, Line, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont, TTFError
from reportlab.platypus import Image, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

BLUE = colors.HexColor('#2054B8')
INK = colors.HexColor('#162B46')
MUTED = colors.HexColor('#51637B')
LINE = colors.HexColor('#D6E1EE')
PALE = colors.HexColor('#EAF2FF')
ORANGE = colors.HexColor('#A04D25')
CST = timezone(timedelta(hours=8))
FONT_LOCK = Lock()
FONT = None
WIDTH, HEIGHT = A4
MARGIN = 45
BODY = WIDTH - 2 * MARGIN - 12  # Account for the document frame padding.


def font_name():
    global FONT
    with FONT_LOCK:
        if FONT:
            return FONT
        candidates = [(os.getenv('LAB_REPORT_FONT'), 0),
                      ('/System/Library/Fonts/STHeiti Light.ttc', 1),
                      ('/usr/share/fonts/truetype/arphic/uming.ttc', 0),
                      ('/usr/share/fonts/truetype/arphic-gbsn00lp/gbsn00lp.ttf', 0)]
        for location, index in candidates:
            if location and Path(location).is_file():
                try:
                    candidate = TTFont('LabReportCN', location, subfontIndex=index)
                    sample = '验知有道实验报告 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-/:±Ω'
                    if not all(candidate.face.charToGlyph.get(ord(char)) for char in sample):
                        continue
                    pdfmetrics.registerFont(candidate)
                    FONT = 'LabReportCN'
                    return FONT
                except TTFError:
                    continue
        pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
        FONT = 'STSong-Light'
        return FONT


def display_time(raw):
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00')).astimezone(CST).strftime('%Y-%m-%d %H:%M')
    except (AttributeError, ValueError, TypeError):
        return ''


def clean(raw):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(raw or ''))


def measured(e):
    fields = e['data']['fields']
    return [fields['vin'].get('value_v'), fields['vout'].get('value_v'), e['data']['assessment'].get('expected_v')]


def format_v(value):
    return '—' if value is None else f'{value:.3f}'.rstrip('0').rstrip('.')


def measurement_chart(events, font):
    selected = events[-60:]
    valid = lambda v: isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 5
    values = [v for event in selected for v in measured(event)[1:] if valid(v)]
    if not values:
        return None
    plot = Drawing(BODY, 150)
    left, right, bottom, top = 46, BODY-22, 29, 112
    ceiling = max(1, math.ceil(max(values)))
    x = lambda i: (left + right)/2 if len(selected) == 1 else left + (right-left)*i/(len(selected)-1)
    y = lambda v: bottom + (top-bottom)*v/ceiling
    for i in range(5):
        level = i*ceiling/4
        plot.add(Line(left,y(level),right,y(level),strokeColor=LINE,strokeWidth=0.65))
        plot.add(String(left-8,y(level)-3,format_v(level),fontName=font,fontSize=9,fillColor=MUTED,textAnchor='end'))
    for field, color in [(2, ORANGE),(1, BLUE)]:
        previous = None
        for i, event in enumerate(selected):
            value = measured(event)[field]
            if not valid(value):
                previous = None
                continue
            point = (x(i),y(value),event['revision'])
            if previous and previous[2] == point[2]:
                plot.add(Line(previous[0],previous[1],point[0],point[1],strokeColor=color,strokeWidth=1.2,
                              strokeDashArray=[4, 3] if field == 2 else None))
            plot.add(Circle(point[0],point[1],2.5,fillColor=color,strokeColor=color))
            previous = point
    plot.add(String(left,bottom-17,'测量顺序',fontName=font,fontSize=9,fillColor=MUTED))
    plot.add(String(left-26,top+10,'V',fontName=font,fontSize=9,fillColor=MUTED))
    plot.add(String(left,132,'实测输出',fontName=font,fontSize=10,fillColor=BLUE))
    plot.add(String(left+76,132,'预期输出',fontName=font,fontSize=10,fillColor=ORANGE))
    return plot


def photo(path, available_width):
    try:
        with PillowImage.open(path) as img:
            if img.width * img.height > 16_000_000:
                return None
            img.thumbnail((720, 460))
            stream = BytesIO()
            img.convert('RGB').save(stream, format='JPEG', quality=83)
        stream.seek(0)
        max_width, max_height = min(available_width, 345), 190
        with PillowImage.open(stream) as img:
            scale = min(max_width/img.width, max_height/img.height, 1)
            width, height = img.width*scale, img.height*scale
        stream.seek(0)
        image = Image(stream, width=width, height=height, hAlign='LEFT')
        return image
    except (OSError, ValueError, PillowImage.DecompressionBombError):
        return None


def build_pdf(report, events, photo_dir, include_review):
    font = font_name()
    result = BytesIO()
    document = SimpleDocTemplate(result, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                                 topMargin=82, bottomMargin=57, title='实验过程报告', author='验知有道')
    base = ParagraphStyle('Report', fontName=font, fontSize=11.15, leading=18, textColor=INK,
                          wordWrap='CJK', spaceAfter=8)
    title = ParagraphStyle('Title', parent=base, fontSize=25, leading=33, spaceAfter=12)
    section = ParagraphStyle('Section', parent=base, fontSize=15, leading=23, textColor=BLUE,
                             spaceBefore=10, spaceAfter=7, keepWithNext=True)
    label = ParagraphStyle('Label', parent=base, fontSize=10, leading=15, textColor=MUTED, spaceAfter=4)
    cell = ParagraphStyle('Cell', parent=base, fontSize=10, leading=15, spaceAfter=0)
    header_cell = ParagraphStyle('HeaderCell', parent=cell, textColor=BLUE)
    grade_cell = ParagraphStyle('Grade', parent=base, alignment=TA_CENTER, fontSize=19, leading=28, textColor=BLUE)
    parts = []

    def p(value, style=base):
        return Paragraph(escape(clean(value)).replace('\n', '<br/>'), style)

    def table(rows, widths):
        contents = [[p(col, header_cell if i == 0 else cell) for col in row] for i, row in enumerate(rows)]
        panel = LongTable(contents, colWidths=widths, repeatRows=1, hAlign='LEFT')
        panel.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('GRID',(0,0),(-1,-1),0.45,LINE),
                                   ('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),
                                   ('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        return panel

    def field(name, value):
        if value:
            parts.extend([p(name, section),p(value)])

    def page_title(value, description):
        parts.extend([p(value, title),p(description, label),Spacer(1,9)])

    def header_footer(canvas, page):
        canvas.setFillColor(BLUE)
        canvas.rect(0,HEIGHT-6,WIDTH,6,fill=1,stroke=0)
        canvas.setFont(font,14)
        canvas.drawString(MARGIN,HEIGHT-46,'验知有道')
        canvas.setFont(font,10)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(WIDTH-MARGIN,HEIGHT-45,'实验过程报告 / 教师评阅版' if include_review else '实验过程报告')
        canvas.setStrokeColor(LINE)
        canvas.line(MARGIN,HEIGHT-61,WIDTH-MARGIN,HEIGHT-61)
        canvas.line(MARGIN,46,WIDTH-MARGIN,46)
        canvas.drawString(MARGIN,31,'提交编号 ' + report['id'][:8])
        canvas.drawRightString(WIDTH-MARGIN,31,f'{page.page:02d}')

    page_title('实验过程报告',report['title'])
    parts.append(table([['课程与学期','教学班与小组'],
                        [' / '.join(filter(None,[report['course'],report['term']])),
                         ' / '.join(filter(None,[report['classroom'],report['team']]))],
                        ['提交成员：'+'、'.join(report['members']), '提交时间：'+display_time(report['submitted_at'])]], [BODY/2]*2))
    sections = report['sections']
    field('01  实验目的与原理', sections['objective'])
    field('02  实验方法与条件', sections['method'])
    parts.append(p('03  实验过程与证据', section))
    labels={'measurement':'确认测量','observation':'实验观察','photo':'实验照片','revision':'调整与复测'}
    for event in events:
        detail=event['data']
        text=detail.get('raw') or detail.get('reason') or detail.get('caption') or '已上传照片证据。'
        parts.extend([p(f'{event["id"][:8]}  ·  {labels[event["kind"]]}  ·  修订 {event["revision"]}  ·  {event["author"]}  ·  {display_time(event["created"])}',label),p(text)])
        if event['kind']=='photo' and re.fullmatch(r'[a-f0-9]{32}\.(png|jpg)',detail.get('file','')):
            img=photo(photo_dir/detail['file'],BODY)
            if img:
                parts.extend([img,Spacer(1,7)])

    parts.append(PageBreak())
    page_title('结果与解释',report['title'])
    measurements = [event for event in events if event['kind']=='measurement']
    parts.append(p('04  数据与结果',section))
    if measurements:
        rows=[['记录编号','修订','供电 / V','实测输出 / V','预期输出 / V','判定']]
        rows += [[e['id'][:8],str(e['revision']),*(format_v(v) for v in measured(e)),e['data']['assessment']['label']] for e in measurements]
        parts.extend([table(rows,[80,43,74,86,87,BODY-370]),Spacer(1,9)])
        chart=measurement_chart(measurements,font)
        if chart:
            parts.append(chart)
            parts.append(p('曲线按修订分段，缺失或超范围的点留空。'+('图中展示最近 60 次测量。' if len(measurements)>60 else ''),label))
    else:
        parts.append(p('本实验采用观察记录。可按上一节的记录编号复核观察条件、现象与照片。',label))
    field('05  异常分析与讨论',sections['analysis'])
    field('06  实验结论',sections['conclusion'])

    if report['reflections']:
        parts.append(PageBreak())
        page_title('个人实验反思',report['title'])
        for reflection in report['reflections']:
            field(reflection['name'],reflection['text'])
    if include_review:
        evaluation = report['evaluation']
        parts.append(PageBreak())
        page_title('教师评阅','对应提交 ' + report['id'][:8])
        total = Table([[p(f'{evaluation["total"]} / {evaluation["maximum"]}', grade_cell),
                        p('评阅教师：'+evaluation['author']+'\n时间：'+display_time(evaluation['created']),cell)]],
                      colWidths=[135,BODY-135], hAlign='LEFT')
        total.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
        parts.extend([total,p('分项评分',section),table([['评分维度','得分 / 满分']]+[[item['label'],f'{item["score"]} / {item["maximum"]}'] for item in evaluation['scores']],[BODY*0.66,BODY*0.34])])
        field('教师意见',evaluation['text'])
    document.build(parts,onFirstPage=header_footer,onLaterPages=header_footer)
    return result.getvalue()
