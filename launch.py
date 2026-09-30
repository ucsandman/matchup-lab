#!/usr/bin/env python3
"""Matchup Lab launcher: the one thing to run after downloading this folder.

    python launch.py              set everything up (first time only) and open the web page
    python launch.py --no-browser  same, but do not open the browser
    python launch.py --port 4000   start on port 4000 (or the next free one)
    python launch.py --check       set up only (steps 1 to 4), then exit 0; used by CI
    python launch.py --reinstall   delete node_modules and dist, then set up again

On Windows you can double-click Launch.bat (or this file); on macOS, launch.command.
Python 3.8 or newer, standard library only. It never changes the system PATH: when Node.js 22 or
newer is missing it downloads the current Node.js LTS from nodejs.org into the .node folder here
and uses that copy for everything.
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_NODE = os.path.join(ROOT, ".node")
MIN_NODE = 22
DEFAULT_PORT = 3456
DIST_URL = "https://nodejs.org/dist/"
IS_WINDOWS = os.name == "nt"


class LaunchError(Exception):
    """A failure with a plain-language next step for the person running this."""

    def __init__(self, what, next_step):
        Exception.__init__(self, what)
        self.what = what
        self.next_step = next_step


def say(msg=""):
    print(msg, flush=True)


# ---- step 1: Node.js ---------------------------------------------------------------------------


def node_info(node_cmd):
    """(major, version, real executable path) for a node command, or None when it does not run."""
    try:
        out = (
            subprocess.run(
                [node_cmd, "-p", "process.versions.node + ' ' + process.execPath"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            )
            .stdout.decode("utf-8", "replace")
            .strip()
        )
        version, exe = out.split(" ", 1)
        return int(version.split(".")[0]), version, exe
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def npm_for(node_exe):
    """The command that runs the npm belonging to this node: [node, npm-cli.js] when it can be found."""
    here = os.path.dirname(node_exe)
    for cli in (
        os.path.join(here, "node_modules", "npm", "bin", "npm-cli.js"),
        os.path.join(here, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ):
        if os.path.isfile(cli):
            return [node_exe, os.path.normpath(cli)]
    npm = shutil.which("npm")
    return [npm] if npm else None


def local_node_exe(folder):
    return (
        os.path.join(folder, "node.exe")
        if IS_WINDOWS
        else os.path.join(folder, "bin", "node")
    )


def find_local_node():
    """The newest usable node already downloaded into .node, or None."""
    if not os.path.isdir(LOCAL_NODE):
        return None
    best = None
    for name in os.listdir(LOCAL_NODE):
        exe = local_node_exe(os.path.join(LOCAL_NODE, name))
        if not name.startswith("node-v") or not os.path.isfile(exe):
            continue
        info = node_info(exe)
        if info and info[0] >= MIN_NODE and (best is None or info[0] > best[0]):
            best = info
    return best


def platform_tag():
    """nodejs.org names for this computer: (os, cpu, archive extension)."""
    machine = platform.machine().lower()
    if machine in ("amd64", "x86_64", "x64"):
        cpu = "x64"
    elif machine in ("arm64", "aarch64"):
        cpu = "arm64"
    else:
        raise LaunchError(
            "This computer's processor type (%s) has no ready-made Node.js download."
            % machine,
            "Install Node.js 22 or newer from https://nodejs.org yourself, then run this again.",
        )
    if IS_WINDOWS:
        return "win", cpu, ".zip"
    if sys.platform == "darwin":
        return "darwin", cpu, ".tar.gz"
    if sys.platform.startswith("linux"):
        return "linux", cpu, ".tar.gz"
    raise LaunchError(
        "This operating system (%s) has no ready-made Node.js download." % sys.platform,
        "Install Node.js 22 or newer from https://nodejs.org yourself, then run this again.",
    )


def open_url(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "matchup-lab-launcher"})
    return urllib.request.urlopen(req, timeout=timeout)


def network_error(e, what):
    reason = getattr(e, "reason", e)
    if isinstance(reason, ssl.SSLError) or isinstance(e, ssl.SSLError):
        nxt = "Check the internet connection, then run this again."
        if sys.platform == "darwin":
            nxt = (
                "On a Mac, open the Applications folder, open the Python 3 folder, double-click "
                "Install Certificates.command, then run this again."
            )
        return LaunchError(
            "%s: Python could not check the website's security certificate (%s)."
            % (what, reason),
            nxt,
        )
    return LaunchError(
        "%s (%s)." % (what, reason),
        "Check the internet connection, then run this again.",
    )


def download_node():
    os_name, cpu, ext = platform_tag()
    say(
        "      Node.js %d or newer was not found, so a private copy is being downloaded into the .node folder."
        % MIN_NODE
    )
    say("      (This happens once. Nothing else on your computer is changed.)")
    try:
        with open_url(DIST_URL + "index.json") as r:
            releases = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise network_error(
            e,
            "Node.js could not be downloaded: the list of versions on nodejs.org did not load",
        )
    lts = [
        x
        for x in releases
        if x.get("lts") and int(x["version"].lstrip("v").split(".")[0]) >= MIN_NODE
    ]
    if not lts:
        raise LaunchError(
            "nodejs.org did not list a long-term-support Node.js %d or newer."
            % MIN_NODE,
            "Install Node.js from https://nodejs.org yourself, then run this again.",
        )
    version = lts[0]["version"]
    base = "node-%s-%s-%s" % (version, os_name, cpu)
    archive_name = base + ext
    url = "%s%s/%s" % (DIST_URL, version, archive_name)
    os.makedirs(LOCAL_NODE, exist_ok=True)
    part = os.path.join(LOCAL_NODE, archive_name + ".part")
    try:
        with open_url("%s%s/SHASUMS256.txt" % (DIST_URL, version)) as r:
            sums = r.read().decode("utf-8")
        expected_sha = next(
            (
                line.split()[0]
                for line in sums.splitlines()
                if line.strip().endswith(" " + archive_name)
            ),
            None,
        )
        with open_url(url, timeout=120) as r, open(part, "wb") as out:
            total = int(r.headers.get("Content-Length") or 0)
            got, last_shown, sha = 0, -1, hashlib.sha256()
            tty = sys.stdout.isatty()
            while True:
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                sha.update(chunk)
                got += len(chunk)
                pct = int(got * 100 / total) if total else 0
                step = pct if tty else pct // 20 * 20
                if step != last_shown:
                    last_shown = step
                    line = "      downloading Node.js %s: %.1f of %.1f MB (%d%%)" % (
                        version,
                        got / 1e6,
                        total / 1e6,
                        pct,
                    )
                    if tty:
                        sys.stdout.write("\r" + line)
                        sys.stdout.flush()
                    else:
                        say(line)
            if tty:
                say()
    except (urllib.error.URLError, OSError) as e:
        raise network_error(e, "Node.js could not be downloaded from %s" % url)
    if total and got != total:
        raise LaunchError(
            "The Node.js download stopped early (%d of %d bytes)." % (got, total),
            "Check the internet connection, then run this again.",
        )
    if expected_sha is None or sha.hexdigest() != expected_sha:
        raise LaunchError(
            "The Node.js download did not match the checksum nodejs.org publishes, so it was not used.",
            "Run this again; if it keeps happening, install Node.js from https://nodejs.org yourself.",
        )
    say("      downloaded %.1f MB, size and checksum match; unpacking..." % (got / 1e6))
    staging = os.path.join(LOCAL_NODE, "unpacking")
    shutil.rmtree(staging, ignore_errors=True)
    try:
        if ext == ".zip":
            with zipfile.ZipFile(part) as z:
                z.extractall(staging)
        else:
            with tarfile.open(part) as t:
                if hasattr(tarfile, "data_filter"):
                    t.extractall(staging, filter="data")
                else:
                    t.extractall(staging)
        final = os.path.join(LOCAL_NODE, base)
        shutil.rmtree(final, ignore_errors=True)
        os.replace(os.path.join(staging, base), final)
    except (OSError, zipfile.BadZipFile, tarfile.TarError) as e:
        raise LaunchError(
            "The Node.js download could not be unpacked (%s)." % e,
            "Delete the .node folder in this project folder, then run this again.",
        )
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        if os.path.exists(part):
            os.remove(part)
    info = node_info(local_node_exe(final))
    if not info:
        raise LaunchError(
            "The downloaded Node.js does not start on this computer.",
            "Install Node.js 22 or newer from https://nodejs.org yourself, then run this again.",
        )
    return info


def find_node():
    say("[1/5] Looking for Node.js %d or newer..." % MIN_NODE)
    on_path = shutil.which("node")
    info = node_info(on_path) if on_path else None
    if info and info[0] >= MIN_NODE:
        say(
            "      Found Node.js v%s already installed on this computer; using it."
            % info[1]
        )
        return info
    if info:
        say(
            "      The installed Node.js v%s is too old (this needs %d or newer); it is left alone."
            % (info[1], MIN_NODE)
        )
    local = find_local_node()
    if local:
        say(
            "      Using the private copy of Node.js v%s in the .node folder."
            % local[1]
        )
        return local
    info = download_node()
    say("      Node.js v%s is ready in the .node folder." % info[1])
    return info


# ---- steps 2 to 4 ------------------------------------------------------------------------------


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def newest_under(folder):
    newest = 0.0
    for dirpath, _dirs, files in os.walk(folder):
        for f in files:
            newest = max(newest, mtime(os.path.join(dirpath, f)) or 0.0)
    return newest


def run(cmd, env, what, next_step):
    code = subprocess.call(cmd, cwd=ROOT, env=env)
    if code != 0:
        raise LaunchError(
            "%s failed (exit code %d; the messages above say why)." % (what, code),
            next_step,
        )


def install_packages(npm, env):
    say("[2/5] Checking the project's packages...")
    lock = os.path.join(ROOT, "package-lock.json")
    stamp = os.path.join(ROOT, "node_modules", ".package-lock.json")
    lock_time, stamp_time = mtime(lock), mtime(stamp)
    if stamp_time is not None and (lock_time is None or lock_time <= stamp_time):
        say("      Packages are already installed.")
        return
    say(
        "      Installing packages (about a minute the first time; it downloads them)..."
    )
    cmd = (
        npm
        + (["ci"] if lock_time is not None else ["install"])
        + ["--include=dev", "--no-audit", "--no-fund"]
    )
    run(
        cmd,
        env,
        "Installing the packages",
        "Check the internet connection, then run this again. If it fails again, run: python launch.py --reinstall",
    )
    say("      Packages installed.")


def build(npm, env):
    say("[3/5] Checking the compiled program...")
    dist = os.path.join(ROOT, "dist")
    server = os.path.join(dist, "web", "server.js")
    if os.path.isfile(server) and newest_under(
        os.path.join(ROOT, "src")
    ) <= newest_under(dist):
        say("      Already built and up to date.")
        return
    say("      Building (about half a minute)...")
    run(
        npm + ["run", "build"],
        env,
        "Building the program",
        "Run this again. If it fails again, run: python launch.py --reinstall",
    )
    if not os.path.isfile(server):
        raise LaunchError(
            "The build finished but dist/web/server.js is missing.",
            "Run: python launch.py --reinstall",
        )
    with open(os.path.join(dist, ".launch-built"), "w") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))
    say("      Built.")


def fetch_rules(node_exe, env):
    say("[4/5] Checking the Magic comprehensive rules text (docs/CR.txt)...")
    if os.path.isfile(os.path.join(ROOT, "docs", "CR.txt")):
        say("      Already downloaded.")
        return
    code = subprocess.call(
        [node_exe, os.path.join("scripts", "fetch-cr.mjs")], cwd=ROOT, env=env
    )
    if code == 0:
        say("      Downloaded.")
    else:
        # The web page does not need this file (only the developer rule-citation check reads it).
        say(
            "      It could not be downloaded right now. The web page works without it; it will be tried again next time."
        )


# ---- step 5: the web server --------------------------------------------------------------------


def port_free(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def pick_port(start):
    for port in range(start, min(start + 50, 65536)):
        if port_free(port):
            return port
    raise LaunchError(
        "Ports %d to %d are all in use." % (start, start + 49),
        "Close the other Matchup Lab windows (or restart the computer), then run this again.",
    )


def box(lines):
    width = max(len(x) for x in lines) + 4
    say("  +" + "-" * width + "+")
    for x in lines:
        say("  |  " + x.ljust(width - 4) + "  |")
    say("  +" + "-" * width + "+")


def serve(node_exe, env, port, open_browser):
    say("[5/5] Starting the web page...")
    chosen = pick_port(port)
    if chosen != port:
        say(
            "      Port %d is busy (maybe Matchup Lab is already open in another window); using %d."
            % (port, chosen)
        )
    url = "http://127.0.0.1:%d/" % chosen
    proc = subprocess.Popen(
        [node_exe, os.path.join("dist", "web", "server.js"), "--port", str(chosen)],
        cwd=ROOT,
        env=env,
    )
    try:
        deadline = time.time() + 60
        while True:
            if proc.poll() is not None:
                raise LaunchError(
                    "The web server stopped right after starting (exit code %d; the messages above say why)."
                    % proc.returncode,
                    "Run this again. If it fails again, run: python launch.py --reinstall",
                )
            try:
                with urllib.request.urlopen(url, timeout=2) as r:
                    if r.status == 200:
                        break
            except (urllib.error.URLError, OSError):
                pass
            if time.time() > deadline:
                raise LaunchError(
                    "The web server did not answer within 60 seconds.",
                    "Close this window, then run this again.",
                )
            time.sleep(0.3)
        say()
        box(
            [
                "Matchup Lab is running. Open this address in your browser:",
                "",
                url,
                "",
                "Keep this window open while you use the page.",
                "To stop: close this window, or press Ctrl+C in it.",
            ]
        )
        say()
        if open_browser:
            webbrowser.open(url)
        code = proc.wait()
        if code != 0:
            raise LaunchError(
                "The web server stopped unexpectedly (exit code %d; the messages above say why)."
                % code,
                "Run this again.",
            )
    except KeyboardInterrupt:
        say()
        say("Stopping Matchup Lab...")
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    say("Matchup Lab stopped. You can close this window.")


# ---- main --------------------------------------------------------------------------------------


def main(argv=None):
    p = argparse.ArgumentParser(description="Set up and start Matchup Lab's web page.")
    p.add_argument("--no-browser", action="store_true", help="do not open the browser")
    p.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="first port to try (default %d)" % DEFAULT_PORT,
    )
    p.add_argument(
        "--check",
        action="store_true",
        help="do steps 1 to 4 (Node.js, packages, build, rules text), then exit",
    )
    p.add_argument(
        "--reinstall",
        action="store_true",
        help="delete node_modules and dist first, then set up again",
    )
    args = p.parse_args(argv)
    pause = not args.check and sys.stdin is not None and sys.stdin.isatty()
    try:
        if not 1 <= args.port <= 65535:
            raise LaunchError(
                "--port must be a number from 1 to 65535.",
                "Run it again with another --port, or without --port.",
            )
        say(
            "Matchup Lab: getting ready (the first time takes a few minutes; later starts take seconds)."
        )
        _major, _version, node_exe = find_node()
        npm = npm_for(node_exe)
        if not npm:
            raise LaunchError(
                "Node.js was found but its npm tool was not.",
                "Delete the .node folder in this project folder (if there is one), then run this again.",
            )
        env = os.environ.copy()
        env["PATH"] = os.path.dirname(node_exe) + os.pathsep + env.get("PATH", "")
        if args.reinstall:
            say(
                "      --reinstall: deleting node_modules and dist so they are made again."
            )
            for d in ("node_modules", "dist"):
                shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)
        install_packages(npm, env)
        build(npm, env)
        fetch_rules(node_exe, env)
        if args.check:
            say(
                "Check done: everything is ready. Run python launch.py (or double-click Launch.bat) to start."
            )
            return 0
        serve(node_exe, env, args.port, not args.no_browser)
        return 0
    except LaunchError as e:
        say()
        say("PROBLEM: " + e.what)
        say("WHAT TO DO: " + e.next_step)
    except KeyboardInterrupt:
        say()
        say(
            "Stopped before the web page started. Run this again to continue where it left off."
        )
        return 1
    except (
        Exception
    ) as e:  # anything unforeseen still ends with a readable message and a pause
        say()
        say("PROBLEM: something unexpected went wrong: %s: %s" % (type(e).__name__, e))
        say(
            "WHAT TO DO: run this again; if it happens again, send a photo of this window to whoever shared the project."
        )
    if pause:
        try:
            input("Press Enter to close")
        except (EOFError, KeyboardInterrupt):
            pass
    return 1


if __name__ == "__main__":
    sys.exit(main())
