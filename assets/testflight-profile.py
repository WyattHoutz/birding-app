"""Validate native app contents, distribution profile and exported identity."""

import hashlib
import json
import plistlib
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


NATIVE_MARKERS = (
    b"FullReportPlugin",
    b"sharePersonalLists",
    b"BirdGenNotificationsPlugin",
    b"BirdGenNotificationService",
    b"BC_HIDDEN_WINDOW",
    b"BC_BIRDGEN_TRACE_V1",
    b"native-wall-and-system-uptime",
    b"SceneDelegate",
)
LOCATION_USAGE_KEYS = (
    "NSLocationWhenInUseUsageDescription",
    "NSLocationAlwaysAndWhenInUseUsageDescription",
)


def read(path):
    with open(path, "rb") as handle:
        return plistlib.load(handle)


def verify_toolchain(xcode, sdk):
    version = re.fullmatch(r"Xcode (\d+)(?:\.\d+)*\s+Build version ([A-Za-z0-9]+)", xcode.strip())
    if not version or int(version[1]) < 27:
        raise ValueError("Build requires Xcode 27 or later")
    sdk_version = re.fullmatch(r"(\d+)(?:\.\d+)+", sdk.strip())
    if not sdk_version or int(sdk_version[1]) < 27:
        raise ValueError("Build requires iOS SDK 27 or later")
    return {"xcode": xcode.splitlines()[0], "build": version[2], "iosSdk": sdk.strip()}


def verify_sdk_scene(info):
    sdk = info.get("DTSDKName")
    match = re.fullmatch(r"iphoneos(\d+)(?:\.\d+)+", sdk) if isinstance(sdk, str) else None
    if not match or int(match[1]) < 27 or info.get("DTPlatformName") != "iphoneos":
        raise ValueError("Packaged app must be built with the iOS device SDK 27 or later")
    xcode = info.get("DTXcode")
    if not isinstance(xcode, str) or not re.fullmatch(r"\d{4}", xcode) or int(xcode) < 2700:
        raise ValueError("Packaged app must be built with Xcode 27 or later")
    if info.get("MinimumOSVersion") != "15.0":
        raise ValueError("SDK upgrade must preserve the existing iOS 15.0 deployment target")
    manifest = info.get("UIApplicationSceneManifest")
    configurations = manifest.get("UISceneConfigurations") if isinstance(manifest, dict) else None
    scenes = configurations.get("UIWindowSceneSessionRoleApplication") if isinstance(configurations, dict) else None
    if (not isinstance(scenes, list) or len(scenes) != 1 or not isinstance(scenes[0], dict)
            or manifest.get("UIApplicationSupportsMultipleScenes") is not False
            or scenes[0].get("UISceneConfigurationName") != "Default Configuration"
            or scenes[0].get("UISceneStoryboardFile") != "Main"
            or not isinstance(scenes[0].get("UISceneDelegateClassName"), str)
            or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*\.SceneDelegate", scenes[0]["UISceneDelegateClassName"])):
        raise ValueError("Packaged app must declare the single-window Capacitor scene lifecycle")
    return {"iosSdk": sdk, "xcode": xcode, "minimumOs": "15.0", "sceneLifecycle": True}


def verify_native(app):
    app = Path(app)
    info = read(app / "Info.plist")
    if info.get("ITSAppUsesNonExemptEncryption") is not False:
        raise ValueError("App must preserve the reviewed ITSAppUsesNonExemptEncryption Boolean false")
    executable = info.get("CFBundleExecutable", "")
    if not isinstance(executable, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", executable) or executable in (".", ".."):
        raise ValueError("App must name a valid native executable")
    binary = (app / executable).read_bytes()
    for marker in NATIVE_MARKERS:
        if marker not in binary:
            raise ValueError(f"Native executable is missing {marker.decode('ascii')}")
    modes = info.get("UIBackgroundModes", [])
    if not isinstance(modes, list) or "fetch" not in modes or "location" in modes:
        raise ValueError("App must preserve background fetch without enabling background location")
    for key in LOCATION_USAGE_KEYS:
        value = info.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"App is missing a nonempty {key}")
    if info[LOCATION_USAGE_KEYS[0]] != info[LOCATION_USAGE_KEYS[1]]:
        raise ValueError("Location purpose strings must describe the same existing location use")
    if not (app / "public" / "birdgen-notifications.js").is_file():
        raise ValueError("App is missing the native notification JavaScript bridge")
    return {"nativeMarkers": len(NATIVE_MARKERS), "backgroundFetch": True, "locationPurposeStrings": 2,
            **verify_sdk_scene(info)}


def profile_info(profile, bundle_id):
    entitlements = profile.get("Entitlements", {})
    teams = profile.get("TeamIdentifier", [])
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    if len(teams) != 1 or len(prefixes) != 1:
        raise ValueError("Profile must name exactly one team and application prefix")
    if entitlements.get("application-identifier") != f"{prefixes[0]}.{bundle_id}":
        raise ValueError("Profile application identifier does not match the app")
    if entitlements.get("com.apple.developer.team-identifier") != teams[0]:
        raise ValueError("Profile entitlement team does not match its team")
    if entitlements.get("get-task-allow") is not False:
        raise ValueError("Distribution profile must disable debugging")
    if entitlements.get("beta-reports-active") is not True:
        raise ValueError("Profile is not enabled for App Store beta distribution")
    if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
        raise ValueError("Development, ad-hoc and enterprise profiles are not App Store profiles")
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, datetime) or expiry.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise ValueError("Profile is expired or has no valid expiry")
    uuid = profile.get("UUID", "")
    if not re.fullmatch(r"[A-Fa-f0-9-]{36}", uuid):
        raise ValueError("Profile UUID is invalid")
    certificates = profile.get("DeveloperCertificates", [])
    if not certificates:
        raise ValueError("Profile has no signing certificates")
    return {
        "uuid": uuid,
        "team": teams[0],
        "certificateSha1": [hashlib.sha1(cert).hexdigest().upper() for cert in certificates],
    }


def verify_app(info, profile, entitlements, bundle_id, version, number, uuid):
    manifest = profile_info(profile, bundle_id)
    if manifest["uuid"] != uuid:
        raise ValueError("Exported profile is not the selected profile")
    for key, expected in (
        ("CFBundleIdentifier", bundle_id),
        ("CFBundleShortVersionString", version),
        ("CFBundleVersion", number),
    ):
        if info.get(key) != expected:
            raise ValueError(f"Exported {key} does not match the expected value")
    for key in ("application-identifier", "com.apple.developer.team-identifier", "beta-reports-active"):
        if entitlements.get(key) != profile["Entitlements"].get(key):
            raise ValueError(f"Exported entitlement {key} does not match the profile")
    if entitlements.get("get-task-allow", False) is not False:
        raise ValueError("Exported app allows debugging")
    return manifest


if __name__ == "__main__":
    if sys.argv[1] == "toolchain":
        result = verify_toolchain(
            subprocess.check_output(["xcodebuild", "-version"], text=True),
            subprocess.check_output(["xcrun", "--sdk", "iphoneos", "--show-sdk-version"], text=True))
    elif sys.argv[1] == "configure-export":
        path = Path(sys.argv[2])
        info = read(path)
        info["ITSAppUsesNonExemptEncryption"] = False
        path.write_bytes(plistlib.dumps(info))
        result = {"ITSAppUsesNonExemptEncryption": False}
    elif sys.argv[1] == "profile":
        result = profile_info(read(sys.argv[2]), sys.argv[3])
    elif sys.argv[1] == "verify":
        result = verify_app(read(sys.argv[2]), read(sys.argv[3]), read(sys.argv[4]), *sys.argv[5:])
        result["native"] = verify_native(Path(sys.argv[2]).parent)
    elif sys.argv[1] == "native":
        result = verify_native(sys.argv[2])
    else:
        raise ValueError("Expected toolchain, configure-export, profile, verify or native command")
    print(json.dumps(result))
