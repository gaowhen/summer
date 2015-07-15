from __future__ import absolute_import
from __future__ import print_function
from __future__ import unicode_literals
from __future__ import division

import os.path

from scss.namespace import Namespace
from scss.types import Boolean
from scss.types import List
from scss.types import Null
from scss.types import String
from scss.types import expect_type


# TODO would like to just add a new /child/ to an existing namespace, i think,
# so i don't have to do an import dance?  maybe?
ns = Namespace()


@ns.declare
def join_file_segments(*segments):
    """Join path parts into a single path, using the appropriate OS-specific
    delimiter.
    """
    parts = []
    for segment in segments:
        expect_type(segment, String)
        parts.append(segment.value)

    if parts:
        return String(os.path.join(*parts))
    else:
        return String('')


@ns.declare
def absolute_path(relative_path):
    """Return an absolute path for the given relative path, relative to the
    calling file.
    """
    expect_type(relative_path, String)
    # TODO i can't get the calling file until "rule" or something else helpful
    # is actually passed in!
    return String(os.path.abspath(relative_path.value))


@ns.declare
def split_filename(path):
    expect_type(path, String)
    dir_, file_ = os.path.split(path.value)
    base, ext = os.path.splitext(file_)
    return List([String(dir_), String(base), String(ext)], use_comma=False)


@ns.declare
def using_compass_compiler():
    # TODO
    return Boolean(False)


@ns.declare
def reset_configuration():
    # TODO
    return Null()


@ns.declare
def add_configuration(options):
    # TODO
    return Null()





# TODO these go in env.py

# TODO compass-env()
# TODO current-time(format=)
# TODO current-date(format=)
# TODO current-source-file(absolute=False)
# TODO current-output-file(absolute=False)
# TODO compass-extensions()
# TODO at-stylesheet-root()
