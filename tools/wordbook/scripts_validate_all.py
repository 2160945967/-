# -*- coding: utf-8 -*-
import json, os, re, glob
BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ld = os.path.join(BASE, 'public', 'wordbooks', 'cet4-beidanci', 'lessons')
bad_ph, empty_pos, empty_w, total = [], [], [], 0
cov = {'mem':0,'ex':0,'real':0,'der':0}
respelled_leftover = re.compile(r'[ә]|(?<![jɡ])\b[iu](?![ː])')
for fp in sorted(glob.glob(os.path.join(ld,'*.json'))):
    d = json.load(open(fp, encoding='utf-8'))
    for w in d['words']:
        total += 1
        if not w['w']: empty_w.append((d['id'], w))
        if not w['pos']: empty_pos.append((d['id'], w['w']))
        ph = w['ph']
        # 确定性错误：西里尔 schwa、未转长音冒号、问号、反斜杠
        if not ph or re.search(r'[ә?:\\]', ph):
            bad_ph.append((d['id'], w['w'], ph))
        if w['mem']: cov['mem']+=1
        if w['ex']: cov['ex']+=1
        if w['real']: cov['real']+=1
        if w['der']: cov['der']+=1
        for dd in w['der']:
            if not dd['ph'] or re.search(r'[ә?:\\]', dd['ph']):
                bad_ph.append((d['id'], '派生:'+dd['w'], dd['ph']))
print('total words:', total)
print('coverage:', {k: f'{v} ({v*100//total}%)' for k,v in cov.items()})
print('empty word:', len(empty_w))
print('empty pos:', len(empty_pos), empty_pos[:10])
print('bad phonetic:', len(bad_ph))
for x in bad_ph[:40]: print('  ', x)
