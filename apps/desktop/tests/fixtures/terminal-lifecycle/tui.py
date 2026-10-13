import os, sys, tty, re
# A real raw-mode PTY application: retained history, SGR scrolling, keyboard,
# and redraw traffic that exceeds legacy replay. No network or user files.
tty.setraw(sys.stdin.fileno())
capture = os.path.join(os.environ['SS_FIXTURE_ROOT'], 'input')
open(capture, 'wb').close()
def reset():
    sys.stdout.write('\x1bc' + ''.join('history %d\r\n' % n for n in range(300)) + '\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[1;1HREADY')
    sys.stdout.flush()
reset()
while True:
    data = os.read(0, 4096)
    with open(capture,'ab') as f: f.write(data)
    if b'R' in data:
        sys.stdout.write('\x1b[?2026h\x1b[2;1Hworking\x1b[?2026l' * 7000 + '\x1b[1;1HREDRAW_DONE')
        sys.stdout.flush()
    if b'S' in data: reset()
    if b'B' in data:
        sys.stdout.write('\x1b[?1006l\x1b[1;1HBINARY_READY');sys.stdout.flush()
    if b'k' in data:
        sys.stdout.write('\x1b[3;1HKEY_ACK');sys.stdout.flush()
    if re.search(rb'\x1b\[<6[45];',data):
        sys.stdout.write('\x1b[4;1HSCROLL_ACK');sys.stdout.flush()
