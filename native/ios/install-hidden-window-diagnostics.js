'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ORIGINAL_SELECTION = `    private func activeWindow() -> UIWindow? {
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }?
            .windows
            .first { $0.isKeyWindow }
    }`;

const INSTRUMENTED_SELECTION = `    private var birdChaserWindowState: [String: Any] = [:]

    private func activeWindow() -> UIWindow? {
        func sceneState(_ state: UIScene.ActivationState) -> String {
            switch state {
            case .foregroundActive: return "active"
            case .foregroundInactive: return "inactive"
            case .background: return "background"
            case .unattached: return "unattached"
            @unknown default: return "unknown"
            }
        }
        let applicationState: String
        switch UIApplication.shared.applicationState {
        case .active: applicationState = "active"
        case .inactive: applicationState = "inactive"
        case .background: applicationState = "background"
        @unknown default: applicationState = "unknown"
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let foreground = scenes.filter {
            $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive
        }
        let selected = foreground.first
        let window = selected?.windows.first { $0.isKeyWindow }
        birdChaserWindowState = [
            "atMs": Date().timeIntervalSince1970 * 1000,
            "applicationState": applicationState,
            "selectedSceneState": selected.map { sceneState($0.activationState) } ?? "none",
            "sceneCount": scenes.count,
            "foregroundSceneCount": foreground.count,
            "foregroundKeySceneCount": foreground.filter { $0.windows.contains { $0.isKeyWindow } }.count,
            "selectedWindowCount": selected?.windows.count ?? 0,
            "selectedKeyWindowCount": selected?.windows.filter { $0.isKeyWindow }.count ?? 0,
            "bridgeWindowAttached": self.bridge?.viewController?.viewIfLoaded?.window != nil,
            "windowFound": window != nil,
            "onMainThread": Thread.isMainThread
        ]
        return window
    }`;

const ORIGINAL_REJECTION = 'call.reject("Failed to get active window for hidden webview")';
const INSTRUMENTED_REJECTION = 'call.reject("Failed to get active window for hidden webview", "BC_HIDDEN_WINDOW", nil, ["windowState": self.birdChaserWindowState])';
const ORIGINAL_RESOLUTION = '            call.resolve(["id": webViewId])\n            // Only clear if this call still owns the slot';
const INSTRUMENTED_RESOLUTION = `            if hidden {
                call.resolve(["id": webViewId, "windowState": self.birdChaserWindowState])
            } else {
                call.resolve(["id": webViewId])
            }
            // Only clear if this call still owns the slot`;

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) {
    throw new Error(`Expected exactly one ${label}; review the installed InAppBrowser source`);
  }
  return source.replace(before, () => after);
}

function instrument(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes('private var birdChaserWindowState:')) {
    if (![INSTRUMENTED_SELECTION, INSTRUMENTED_REJECTION, INSTRUMENTED_RESOLUTION]
      .every(part => source.includes(part))) {
      throw new Error('Incomplete Bird Chaser hidden-window instrumentation');
    }
    return source;
  }
  source = replaceOnce(source, ORIGINAL_SELECTION, INSTRUMENTED_SELECTION, 'native window selection');
  source = replaceOnce(source, ORIGINAL_REJECTION, INSTRUMENTED_REJECTION, 'hidden-open rejection');
  return replaceOnce(source, ORIGINAL_RESOLUTION, INSTRUMENTED_RESOLUTION, 'managed-open resolution');
}

function install(root = path.join(__dirname, '..', '..')) {
  const target = path.join(root, 'node_modules', '@capgo', 'capacitor-inappbrowser',
    'ios', 'Sources', 'InAppBrowserPlugin', 'InAppBrowserPlugin.swift');
  fs.writeFileSync(target, instrument(fs.readFileSync(target, 'utf8')));
}

if (require.main === module) install(process.argv[2]);

module.exports = { install, instrument };
