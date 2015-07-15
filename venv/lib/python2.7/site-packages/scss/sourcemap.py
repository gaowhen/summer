from __future__ import absolute_import
from __future__ import division
from __future__ import print_function
from __future__ import unicode_literals

import string


BASE64_DIGITS = string.ascii_uppercase + string.ascii_lowercase + '+/'
assert len(BASE64_DIGITS) == 64



def base64_vlq(n):
    """Encode a number into a base64 VLQ (variable-length quantity), the
    fundamental compression unit in version 3 source maps.  Returns an iterable
    of characters.
    """
    # A base64 digit contains six bits.  In this scheme, the high bit is a
    # "continuation" bit, meaning "shift me left by 5 and read another digit".
    # The low bit of the final digit is the sign: 0 positive, 1 negative.
    # See also the Mozilla implementation:
    # https://github.com/mozilla/source-map/blob/master/lib/source-map/base64-vlq.js#L32

    # The first thing we need to do, then, is add a sign bit to the end.
    if n < 0:
        n = ((-n) << 1) | 1
    else:
        n = n << 1

    # Then just break it into five-bit digits, add a continuation bit to all
    # but the last digit, and convert to base64.
    digits = []
    while n:
        digit = n & 0x1f
        n <<= 5
        if n:
            digit |= 0x20
        digits.append(digit)

    digits.reverse()
    return (BASE64_DIGITS[d] for d in digits)


class Source(object):
    def __init__(self, source_file):
        self.source_file = source_file
        self.line = 1
        self.column = 0




    source_map = dict(
        version='3',
        file=options.output,
        #sourceRoot='',
        sources=args,
        #sourcesContent=[...],
        names=[],
        mappings="...",
    )


