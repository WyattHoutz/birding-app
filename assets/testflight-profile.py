"""Validate App Store distribution profile and exported app identity."""

import hashlib
import json
import plistlib
import re
import sys
from datetime import datetime, timezone


def read(path):
    with open(path, "rb") as handle:
        return plistlib.load(handle)


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
    if sys.argv[1] == "profile":
        result = profile_info(read(sys.argv[2]), sys.argv[3])
    elif sys.argv[1] == "verify":
        result = verify_app(read(sys.argv[2]), read(sys.argv[3]), read(sys.argv[4]), *sys.argv[5:])
    else:
        raise ValueError("Expected profile or verify command")
    print(json.dumps(result))
