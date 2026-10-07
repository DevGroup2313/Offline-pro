"""Make src/lib/clepsydra.css from the rules Carpe Diem itself applies to Clepsydra.

tools/clepsydra/carpe_diem_rules.json holds every CSS rule Carpe Diem applies
to its Clepsydra panel (#pomo-modal and its backdrop), its corner dial
(#horo-fab, idle, running and live) and its Custodia prompt, by day and by
night, in Carpe Diem's own order, with the values of the custom properties
they use. It was captured from carpe_diem.html in a browser.

Each rule is kept as written, then
- scoped to the element it styled, so it cannot reach the rest of Inkwell:
  #pomo-modal :is(RULE) for the panel's contents, #pomo-modal:is(RULE) for the
  panel itself, and the same for the backdrop, the dial and Custodia;
- given Inkwell's night condition (html[data-theme=dark]) where Carpe Diem
  wrote body[data-theme="night"];
- for the live dial, applied a second time to the hourglasses in Tabula's dock
  and the floating windows (.cdDockHoro), contents only: the dock keeps its own
  size and place.

usage: python tools/clepsydra_css.py   (writes src/lib/clepsydra.css)
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src', 'lib', 'clepsydra.css')
DATA = os.path.join(HERE, 'clepsydra', 'carpe_diem_rules.json')

ROOTS = {
    '#pomo-modal': '#pomo-modal',
    'BACKDROP': '.modal-backdrop:has(> #pomo-modal)',
    '#horo-fab': '#horo-fab',
    '#custodia-overlay': '#custodia-overlay',
}
NIGHT = 'html[data-theme=dark] *'


def night(sel):
    sel = re.sub(r'body\[data-theme=(["\']?)night\1\]', 'body:is(%s)' % NIGHT, sel)
    sel = re.sub(r'body:not\(\[data-theme=(["\']?)night\1\]\)', 'body:not(%s)' % NIGHT, sel)
    sel = re.sub(r'\[data-theme=(["\']?)night\1\]', '[data-theme=night]', sel)
    return sel


def split_pseudo_element(part):
    m = re.search(r'::?(before|after|placeholder|selection|-webkit-[a-z-]+)', part)
    if not m:
        return part, ''
    return part[:m.start()], part[m.start():]


def emit(root_css, base, pe, on_root, on_desc):
    out = []
    base = base.strip()
    inner = ':is(%s)' % base if base else ''
    if on_root:
        out.append('%s%s%s' % (root_css, inner, pe))
    if on_desc:
        out.append('%s %s%s' % (root_css, inner or '*', pe))
    return out


def main():
    data = json.load(open(DATA))
    blocks = []
    for r in data['rules']:
        base, pe = split_pseudo_element(night(r['sel']))
        sels = emit(ROOTS[r['root']], base, pe, r['onRoot'], r['onDesc'])
        if r['root'] == '#horo-fab' and r['onDesc']:
            # the live dial's contents, for the dock hourglasses (ids become classes)
            b2 = base.replace('#horo-fab', '.cdDockHoro').replace('#horo-num', '.cdHoroNum').replace('#horo-arc', '.cdHoroArc')
            sels += emit('.cdDockHoro', b2, pe, False, True)
        decl = r['decl']
        rule = '%s{%s}' % (',\n'.join(sels), decl)
        if r['media']:
            rule = '@media %s{%s}' % (r['media'], rule)
        blocks.append(rule)
    scope = ', '.join(ROOTS.values()) + ', .cdDockHoro'
    def vars_block(v):
        return ';'.join('%s:%s' % (k, val) for k, val in v.items() if val)
    head = ('/* CLEPSYDRA: the rules Carpe Diem applies to it, scoped to it. Made by\n'
            '   tools/clepsydra_css.py from tools/clepsydra/carpe_diem_rules.json; do not edit. */\n')
    base_text = ('#pomo-modal,#custodia-overlay{font-family:%s;font-size:16px;line-height:normal;'
                 '-webkit-font-smoothing:antialiased;color:var(--text-primary)}\n'
                 '#pomo-modal *,#custodia-overlay *{font-family:inherit}\n'
                 '#pomo-modal svg *{font-family:inherit}\n'
                 '#pomo-modal #pomo-time{font-family:var(--cd-serif)}\n') % data['font']
    css = (head
           + ':is(%s){%s}\n' % (scope, vars_block(data['vars']['day']))
           + 'html[data-theme=dark] :is(%s){%s}\n' % (scope, vars_block(data['vars']['night']))
           + base_text
           + '\n'.join(blocks) + '\n'
           + '\n'.join(data['keyframes'].values()) + '\n')
    open(SRC, 'w').write(css)
    print('wrote', SRC, len(blocks), 'rules,', len(css), 'bytes')


if __name__ == '__main__':
    main()
