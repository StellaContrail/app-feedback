"""Send a test-only extension action shortcut to one owned Chrome window on an isolated Xvfb display.

Requires both the browser PID and a random fixture title to match. It never
searches by coordinates, captures the screen, or targets existing profiles.
"""

import ctypes as c
import sys
import time


def activate(browser_pid: int, fixture_title: str) -> None:
    x = c.CDLL("libX11.so.6")
    xtest = c.CDLL("libXtst.so.6")
    display_type, window_type = c.c_void_p, c.c_ulong
    x.XOpenDisplay.argtypes = [c.c_char_p]
    x.XOpenDisplay.restype = display_type
    x.XDefaultRootWindow.argtypes = [display_type]
    x.XDefaultRootWindow.restype = window_type
    x.XInternAtom.argtypes = [display_type, c.c_char_p, c.c_int]
    x.XInternAtom.restype = window_type
    x.XGetWindowProperty.argtypes = [
        display_type, window_type, window_type, c.c_long, c.c_long,
        c.c_int, window_type, c.POINTER(window_type), c.POINTER(c.c_int),
        c.POINTER(window_type), c.POINTER(window_type),
        c.POINTER(c.POINTER(c.c_ubyte)),
    ]
    x.XQueryTree.argtypes = [
        display_type, window_type, c.POINTER(window_type), c.POINTER(window_type),
        c.POINTER(c.POINTER(window_type)), c.POINTER(c.c_uint),
    ]
    x.XFree.argtypes = [c.c_void_p]
    x.XRaiseWindow.argtypes = [display_type, window_type]
    x.XSetInputFocus.argtypes = [display_type, window_type, c.c_int, window_type]
    x.XSync.argtypes = [display_type, c.c_int]
    x.XStringToKeysym.argtypes = [c.c_char_p]
    x.XStringToKeysym.restype = window_type
    x.XKeysymToKeycode.argtypes = [display_type, window_type]
    x.XKeysymToKeycode.restype = c.c_ubyte
    xtest.XTestFakeKeyEvent.argtypes = [display_type, c.c_uint, c.c_int, window_type]
    x.XCloseDisplay.argtypes = [display_type]
    x.XGetInputFocus.argtypes = [display_type, c.POINTER(window_type), c.POINTER(c.c_int)]
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError("An X11 display is required for the permission test")

    def property_value(window, name):
        atom = x.XInternAtom(display, name, 0)
        actual, count, remaining = window_type(), window_type(), window_type()
        fmt, data = c.c_int(), c.POINTER(c.c_ubyte)()
        x.XGetWindowProperty(
            display, window, atom, 0, 1024, 0, 0, c.byref(actual),
            c.byref(fmt), c.byref(count), c.byref(remaining), c.byref(data),
        )
        try:
            if not data or not count.value:
                return None
            if fmt.value == 32:
                return c.cast(data, c.POINTER(window_type))[0]
            if fmt.value == 8:
                return c.string_at(data, count.value).decode(errors="replace")
            return None
        finally:
            if data:
                x.XFree(data)

    def find(window, depth=0):
        if property_value(window, b"_NET_WM_PID") == browser_pid:
            name = property_value(window, b"_NET_WM_NAME")
            if isinstance(name, str) and fixture_title in name:
                return window
        if depth >= 6:
            return None
        root, parent = window_type(), window_type()
        children, count = c.POINTER(window_type)(), c.c_uint()
        x.XQueryTree(display, window, c.byref(root), c.byref(parent), c.byref(children), c.byref(count))
        try:
            ids = [children[i] for i in range(count.value)]
        finally:
            if children:
                x.XFree(children)
        for child in ids:
            found = find(child, depth + 1)
            if found:
                return found
        return None

    try:
        window = find(x.XDefaultRootWindow(display))
        if not window:
            raise RuntimeError("Owned test Chrome window not found; no keys sent")
        keys = [x.XKeysymToKeycode(display, x.XStringToKeysym(k)) for k in (b"Control_L", b"Shift_L", b"y")]
        if not all(keys):
            raise RuntimeError("Test shortcut unavailable; no keys sent")
        x.XRaiseWindow(display, window)
        x.XSetInputFocus(display, window, 2, 0)
        x.XSync(display, 0)
        focus, revert = window_type(), c.c_int()
        x.XGetInputFocus(display, c.byref(focus), c.byref(revert))
        if focus.value != window:
            raise RuntimeError("Owned Chrome window has no input focus; no keys sent")
        time.sleep(0.2)
        try:
            for key in keys:
                if not xtest.XTestFakeKeyEvent(display, key, 1, 0):
                    raise RuntimeError("XTest key event failed")

        finally:
            for key in reversed(keys):
                xtest.XTestFakeKeyEvent(display, key, 0, 0)
            x.XSync(display, 0)
    finally:
        x.XCloseDisplay(display)


if __name__ == "__main__":
    activate(int(sys.argv[1]), sys.argv[2])
